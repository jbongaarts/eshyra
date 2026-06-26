/**
 * `eshyra create-character` subcommand (eshyra-b69j.8 / eshyra-b69j.10).
 *
 * Thin wiring around {@link runCharacterWizard}: it resolves the data root,
 * builds the on-disk draft store, the bundled D&D 5e engine and resolver, and a
 * terminal {@link CliIO}, parses the mode/id/resume flags, then runs the guided
 * flow. All rules logic lives in core; all interaction lives in the wizard. The
 * dependency object is injectable so tests can drive the same command with
 * scripted IO and an in-memory store.
 */

import { randomBytes } from 'node:crypto';
import {
  createSeededRng,
  finalizeCharacterDraft,
  getBundledDnd5eCharacterResolver,
  getDnd5eCharacterCreationEngine,
} from '@eshyra/core';
import {
  type CharacterDraftStore,
  createFileCharacterDraftStore,
  createFileFinalizedCharacterStore,
  draftFileStem,
  type FinalizedCharacterStore,
} from './characterDraftStore.js';
import {
  type CharacterWizardDeps,
  type CharacterWizardResult,
  runCharacterWizard,
} from './characterWizard.js';
import {
  characterDraftsDir,
  charactersDir,
  resolveDataRoot,
} from './dataRoot.js';
import { nodeIO } from './play.js';
import type { CliIO } from './playTypes.js';

/** Optional finalization collaborators (injectable for tests). */
export interface CreateCharacterOptions {
  /** Where a completed draft's finalized record is written. */
  readonly characterStore?: FinalizedCharacterStore;
  /** ISO-8601 clock for finalization provenance (defaults to wall clock). */
  readonly now?: () => string;
}

/** Parsed `create-character` invocation. */
export interface CreateCharacterArgs {
  readonly mode: string;
  readonly draftId?: string;
  readonly resumeId?: string;
}

const VALID_MODES = new Set(['concept-first', 'ability-first']);

/**
 * Parse `create-character` flags:
 *   --mode <concept-first|ability-first>  (default concept-first)
 *   --id <draft-id>                        (default derived from the name later)
 *   --resume <draft-id>
 */
export function parseCreateCharacterArgs(
  argv: readonly string[],
): { ok: true; args: CreateCharacterArgs } | { ok: false; message: string } {
  let mode = 'concept-first';
  let draftId: string | undefined;
  let resumeId: string | undefined;
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    const value = argv[i + 1];
    switch (flag) {
      case '--mode':
        if (value === undefined) {
          return { ok: false, message: '--mode requires a value.' };
        }
        mode = value;
        i += 1;
        break;
      case '--id':
        if (value === undefined) {
          return { ok: false, message: '--id requires a value.' };
        }
        draftId = value;
        i += 1;
        break;
      case '--resume':
        if (value === undefined) {
          return { ok: false, message: '--resume requires a value.' };
        }
        resumeId = value;
        i += 1;
        break;
      default:
        return { ok: false, message: `Unknown option: ${flag}` };
    }
  }
  if (!VALID_MODES.has(mode)) {
    return {
      ok: false,
      message: `Unknown mode "${mode}". Use concept-first or ability-first.`,
    };
  }
  return { ok: true, args: { mode, draftId, resumeId } };
}

/**
 * Run the guided creation flow with injected collaborators. Returns a process
 * exit code. `deps.io` is closed by the caller (the terminal entrypoint).
 */
export async function runCreateCharacter(
  deps: CharacterWizardDeps,
  argv: readonly string[],
  options: CreateCharacterOptions = {},
): Promise<number> {
  const parsed = parseCreateCharacterArgs(argv);
  if (!parsed.ok) {
    deps.io.write(parsed.message);
    return 1;
  }
  const { mode, draftId, resumeId } = parsed.args;

  if (resumeId !== undefined) {
    const resume = deps.store.load(resumeId);
    if (resume === undefined) {
      deps.io.write(`No saved draft found for id "${resumeId}".`);
      const ids = deps.store.list();
      if (ids.length > 0) {
        deps.io.write(`Available drafts: ${ids.join(', ')}`);
      }
      return 1;
    }
    const result = await runCharacterWizard(deps, {
      mode: resume.creationMode,
      draftId: resume.id,
      resume,
    });
    finalizeIfComplete(deps, result, options);
    return 0;
  }

  const id = draftId ?? newDraftId();
  if (draftId === undefined) {
    // An auto-generated id is unmemorable, so surface it up front — it is the
    // handle the player passes to `--resume`.
    deps.io.write(`New draft id: ${id} (resume later with --resume ${id}).`);
  }
  const result = await runCharacterWizard(deps, { mode, draftId: id });
  finalizeIfComplete(deps, result, options);
  return 0;
}

/**
 * When the wizard completed (every required choice made), finalize the draft
 * into a canonical {@link finalizeCharacterDraft} record and persist it
 * (eshyra-b69j.14). A non-completed run (quit / end-of-input) leaves only the
 * resumable draft. The completeness gate lives in core, so a defensive
 * not-ok result is reported rather than written.
 */
function finalizeIfComplete(
  deps: CharacterWizardDeps,
  result: CharacterWizardResult,
  options: CreateCharacterOptions,
): void {
  if (result.outcome !== 'completed') {
    return;
  }
  const createdAt = (options.now ?? (() => new Date().toISOString()))();
  const finalized = finalizeCharacterDraft(
    result.draft,
    { createdAt, source: `create-character:${result.draft.creationMode}` },
    deps.resolver,
    deps.engine,
  );
  if (!finalized.ok) {
    deps.io.write('Could not finalize the character:');
    for (const choice of finalized.missing) {
      deps.io.write(`  • ${choice.label}`);
    }
    for (const error of finalized.errors) {
      deps.io.write(`  ✗ ${error}`);
    }
    return;
  }
  const { character } = finalized;
  if (options.characterStore !== undefined) {
    const path = options.characterStore.save(result.draft.id, character);
    deps.io.write(
      `Finalized ${character.identity.name}, level ${character.level} ${character.ancestry.name} ${character.class.name} → ${path}`,
    );
  } else {
    deps.io.write(
      `Finalized ${character.identity.name}, level ${character.level} ${character.ancestry.name} ${character.class.name}.`,
    );
  }
}

/**
 * A fresh, collision-resistant draft id. Callers that want a stable, memorable
 * id pass `--id`; otherwise this generates `character-<timestamp>-<random>`. The
 * random suffix is the load-bearing part: each `eshyra create-character` run is
 * a fresh process, so a per-process counter would make every first unnamed
 * draft `character-1` and silently overwrite the previous run's saved draft
 * (`CharacterDraftStore.save` overwrites by stem). The timestamp only adds
 * rough sortability.
 */
export function newDraftId(): string {
  const stamp = Date.now().toString(36);
  const random = randomBytes(4).toString('hex');
  return draftFileStem(`character-${stamp}-${random}`);
}

/** Terminal entrypoint: build real collaborators, run, and close IO. */
export async function runCreateCharacterSubcommand(
  argv: readonly string[],
): Promise<number> {
  const dataRoot = resolveDataRoot();
  const store: CharacterDraftStore = createFileCharacterDraftStore(
    characterDraftsDir(dataRoot),
  );
  const characterStore: FinalizedCharacterStore =
    createFileFinalizedCharacterStore(charactersDir(dataRoot));
  const terminal = nodeIO();
  const io: CliIO = terminal;
  try {
    return await runCreateCharacter(
      {
        io,
        engine: getDnd5eCharacterCreationEngine(),
        resolver: getBundledDnd5eCharacterResolver(),
        store,
        // Seed the dice with process entropy so rolled scores differ per run.
        rng: createSeededRng(randomBytes(4).readUInt32LE(0)),
      },
      argv,
      { characterStore },
    );
  } finally {
    terminal.close();
  }
}
