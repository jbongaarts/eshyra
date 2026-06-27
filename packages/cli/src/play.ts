import { dirname, join } from 'node:path';
import { createInterface } from 'node:readline/promises';
import {
  CheckpointStore,
  createDemoCampaign,
  DEMO_TURN_CAP,
  DoltRepo,
  getCampaign,
  initSchema,
  type SessionCheckpointRunner,
  validateMemoryConfig,
} from '@eshyra/core';
import {
  activateCampaignCustody,
  ensureCharacterReady,
} from './playCharacter.js';
import { launch, resolveCampaign } from './playSession.js';
import { turnLoop } from './playTurnLoop.js';
import type { CliIO, PlayDeps, PlayOptions } from './playTypes.js';

export type { CliIO, PlayDeps, PlayOptions } from './playTypes.js';

/**
 * Thin interactive front-end for the E6 session lifecycle.
 *
 * This module is a presentation layer only: it reads player input, prints DM
 * narration, and sequences create-campaign / launch / turn-loop / graceful-exit
 * by delegating every decision to the core. It contains NO game-rule logic —
 * no dice, no canon writes, no rulings. Turn execution goes to the core
 * orchestrator's `runTurn`; campaign and session lifecycle go to
 * `playSession.ts` / `playClose.ts` / `playTurnLoop.ts` / `playCharacter.ts`.
 *
 * Every core dependency and all I/O is injected through {@link PlayDeps}, so
 * the whole flow is testable without a terminal or a live model.
 */

/**
 * Run the interactive campaign front-end: open or create the campaign, launch
 * (resume an open session or start a new one), play turns, and on exit run the
 * graceful close pipeline. Returns a process exit code.
 */
export async function runPlay(
  deps: PlayDeps,
  options: PlayOptions,
): Promise<number> {
  validateMemoryConfig(deps.memoryConfig);
  const db = deps.openDb(options.dbPath);
  try {
    // initSchema is migration-first and idempotent: it applies pending
    // migrations (all of them for a brand-new database) and is a no-op on an
    // already up-to-date campaign.
    initSchema(db);
    const campaign = resolveCampaign(deps, db);
    const characterReady = await ensureCharacterReady(
      deps,
      db,
      campaign.campaignId,
    );
    if (!characterReady) {
      return 1;
    }
    // Reclaim the custody lock for any character already in this (resumed)
    // campaign before play begins; fail closed if it is held elsewhere or has
    // advanced past this campaign's copy (ADR 0012).
    if (!activateCampaignCustody(deps, db, campaign.campaignId)) {
      return 1;
    }
    const sessionId = await launch(deps, db, options.dbPath, campaign);
    await turnLoop(
      deps,
      db,
      options.dbPath,
      campaign.campaignId,
      sessionId,
      options.turnCap,
    );
    return 0;
  } finally {
    db.close();
  }
}

/**
 * Run the bounded public demo: an ordinary campaign restricted to demo-legal
 * content and capped at a turn budget. Creates a fresh demo campaign on first
 * run (or resumes an existing one), plays capped turns, and graceful-exits.
 * Returns a process exit code.
 */
export async function runDemo(
  deps: PlayDeps,
  options: PlayOptions,
): Promise<number> {
  const cap = options.turnCap ?? DEMO_TURN_CAP;
  const db = deps.openDb(options.dbPath);
  try {
    initSchema(db);
    const existing = getCampaign(db);
    let campaignId: string;
    let sessionId: string;
    if (existing === undefined) {
      const demo = createDemoCampaign(db, {
        campaignId: deps.nextId('campaign'),
        sessionId: deps.nextId('session'),
        startedAt: deps.now(),
        pack: deps.pack,
        turnCap: cap,
      });
      campaignId = demo.campaignId;
      sessionId = demo.session.sessionId;
      deps.io.write(`Demo campaign '${demo.campaignId}' — ${demo.packTitle}.`);
      deps.io.write(
        `Bounded demo: ${demo.turnCap} turns. Type /quit to save and exit.`,
      );
      if (demo.model.disclaimer !== undefined) {
        deps.io.write(demo.model.disclaimer);
      }
    } else {
      campaignId = existing.campaignId;
      deps.io.write(
        `Demo campaign: ${existing.title} (${existing.campaignId}).`,
      );
      sessionId = await launch(deps, db, options.dbPath, existing);
    }
    // A demo campaign can gain registry-linked characters via /addpc, so the
    // same custody-on-resume guard applies before play (ADR 0012). On a
    // brand-new demo the bundled character is not registry-linked and this is a
    // no-op.
    if (!activateCampaignCustody(deps, db, campaignId)) {
      return 1;
    }
    await turnLoop(deps, db, options.dbPath, campaignId, sessionId, cap);
    return 0;
  } finally {
    db.close();
  }
}

/**
 * Default {@link PlayDeps.makeCheckpointRunner}: a Dolt-backed checkpoint
 * runner for the campaign DB, or `undefined` when no `dolt` binary is
 * resolvable. The checkpoint repo lives in `<dbPath>.checkpoints`, kept
 * disjoint from any beads Dolt repo (the {@link CheckpointStore} separation
 * guard enforces it).
 */
export function doltCheckpointRunner(
  dbPath: string,
): SessionCheckpointRunner | undefined {
  if (!DoltRepo.available()) {
    return undefined;
  }
  const doltDir = `${dbPath}.checkpoints`;
  const beadsDir = join(dirname(dbPath), '.beads');
  return {
    liveDbPath: dbPath,
    run: (liveDbPath, message) =>
      new CheckpointStore(doltDir, beadsDir).checkpoint(liveDbPath, message),
  };
}

/**
 * A terminal-backed {@link CliIO} over Node's readline. `close()` releases the
 * readline interface; call it once the play flow returns.
 */
export function nodeIO(): CliIO & { close: () => void } {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  // On stdin EOF (Ctrl-D) or a closed stream, readline emits 'close' and a
  // pending `rl.question()` then never settles — it does not reject. A bare
  // `await rl.question()` would hang the turn loop forever and silently skip
  // the graceful close pipeline. Track the close and race every prompt against
  // it so a closed stream resolves as end-of-input (`undefined`) instead.
  let closed = false;
  const onClose = new Promise<undefined>((resolve) => {
    rl.once('close', () => {
      closed = true;
      resolve(undefined);
    });
  });
  return {
    write: (line: string) => {
      process.stdout.write(`${line}\n`);
    },
    prompt: async (question: string) => {
      if (closed) {
        return undefined;
      }
      try {
        // Whichever settles first wins: a typed answer, or stdin closing.
        const answer = await Promise.race([rl.question(question), onClose]);
        return answer?.trim();
      } catch {
        // Defensive: any other readline failure is also end of input.
        return undefined;
      }
    },
    close: () => {
      rl.close();
    },
  };
}
