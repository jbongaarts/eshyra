import type { Db } from '@eshyra/core';
import {
  type InstalledAdventureModule,
  listAdventureRuns,
  startAdventureRun,
} from '@eshyra/core/internal';
import type { PlayDeps } from './playTypes.js';

/**
 * Fresh-campaign adventure-module selector (eshyra-47ob).
 *
 * When a brand-new campaign starts (no prior DM output), the player is offered
 * the installed adventure modules and may bind one to the campaign as an
 * adventure run. This is a thin presentation layer over the core
 * `startAdventureRun` binding and the injected `listAdventureModules` source: it
 * prints a menu, reads a choice, and records the binding. It contains no game
 * rules — the module source is referenced by id only and never mutated.
 *
 * Selection and binding are split because binding needs the new session's id
 * (a run records the session it started in), which only exists after the
 * session is started: {@link chooseAdventureModule} prompts and returns the
 * choice with no writes, then {@link bindAdventureModule} records it once the
 * session id is known.
 */

/** How many malformed menu answers to tolerate before falling back. */
const MAX_SELECTION_ATTEMPTS = 3;

/**
 * Offer the installed adventure modules and return the player's choice, or
 * `undefined` to keep the default campaign content (no bound adventure).
 *
 * Returns `undefined` without prompting when there is nothing to choose: the
 * campaign already has an adventure run bound (so a prior launch already chose,
 * or play is underway), or no modules are installed. An empty answer, a `0`
 * choice, or end-of-input (EOF) is treated as "keep the default". Malformed
 * answers are re-prompted up to {@link MAX_SELECTION_ATTEMPTS} times, then fall
 * back to the default so a stream of bad input can never hang session start.
 */
export async function chooseAdventureModule(
  deps: PlayDeps,
  db: Db,
  campaignId: string,
): Promise<InstalledAdventureModule | undefined> {
  // A campaign that already has an adventure run was bound on a prior launch
  // (e.g. the player chose a module then quit before the first turn). Do not
  // re-prompt or bind a second run.
  if (listAdventureRuns(db, { campaignId }).length > 0) {
    return undefined;
  }

  const modules = deps.listAdventureModules();
  if (modules.length === 0) {
    return undefined;
  }

  deps.io.write('Choose an adventure to begin this campaign:');
  modules.forEach((entry, index) => {
    const { title, summary, intendedLevels } = entry.module;
    deps.io.write(
      `  ${index + 1}. ${title} (levels ${intendedLevels.min}–${intendedLevels.max}) — ${summary}`,
    );
  });
  deps.io.write('  0. None — start without a bound adventure.');

  for (let attempt = 0; attempt < MAX_SELECTION_ATTEMPTS; attempt++) {
    const answer = await deps.io.prompt(
      `Enter a number [0–${modules.length}], or press Enter for the default: `,
    );
    // EOF (closed stream) keeps the default.
    if (answer === undefined) {
      return undefined;
    }
    const trimmed = answer.trim();
    // An empty or whitespace-only answer keeps the default.
    if (trimmed.length === 0) {
      return undefined;
    }
    // Require a pure run of digits: `Number.parseInt` would accept a trailing
    // tail (e.g. '1abc' -> 1), silently binding a module the player did not
    // clearly choose, so reject anything non-numeric and re-prompt instead.
    if (!/^\d+$/.test(trimmed)) {
      deps.io.write(
        `'${answer}' is not one of 0–${modules.length}. Please try again.`,
      );
      continue;
    }
    const choice = Number(trimmed);
    if (choice === 0) {
      return undefined;
    }
    if (choice >= 1 && choice <= modules.length) {
      return modules[choice - 1];
    }
    deps.io.write(
      `'${answer}' is not one of 0–${modules.length}. Please try again.`,
    );
  }

  deps.io.write('No valid selection — starting without a bound adventure.');
  return undefined;
}

/**
 * Bind the chosen adventure module to the campaign as a new active adventure
 * run started in `sessionId`, and confirm it to the player. The module is
 * referenced by id only; its authored source is never copied or mutated.
 */
export function bindAdventureModule(
  deps: PlayDeps,
  db: Db,
  campaignId: string,
  sessionId: string,
  chosen: InstalledAdventureModule,
): void {
  startAdventureRun(db, {
    campaignId,
    runId: deps.nextId('run'),
    moduleId: chosen.module.id,
    startedAtSessionId: sessionId,
    provenance: 'cli:module-selector',
    sessionId,
    updatedAt: deps.now(),
  });
  deps.io.write(`Beginning adventure: ${chosen.module.title}.`);
}
