import type {
  CharacterCreationDraft,
  Db,
  ResumeClassification,
} from '@eshyra/core';
import {
  acquireCustodyOnResume,
  CharacterCustodyError,
  catchUpCharacterToHead,
  checkoutCharacterIntoCampaign,
  classifyResumeConflict,
  completeCharacterCreation,
  createSqliteCharacterSheetStore,
  DEFAULT_DND5E_SRD_BINDING,
  finalizeCharacterDraft,
  getActiveCombatInstance,
  getSessionLaunchState,
  listParty,
  readCampaignRulesBinding,
  registerNewCharacter,
} from '@eshyra/core';
import { runCharacterWizard } from './characterWizard.js';
import { newDraftId } from './createCharacter.js';
import { offerContinuityBridge } from './playContinuity.js';
import { forkConflictedCharacterIntoCampaign } from './playFork.js';
import type { CliIO, PlayDeps } from './playTypes.js';

/** A stale-copy resume conflict narrowed from {@link ResumeClassification}. */
type StaleCopyConflict = Extract<ResumeClassification, { kind: 'stale-copy' }>;

/** The player's chosen resolution for one stale-copy conflict. */
type StaleResolution =
  | { readonly kind: 'cancel' }
  | { readonly kind: 'catchup'; readonly characterId: string }
  | {
      readonly kind: 'fork';
      readonly characterId: string;
      readonly globalCharacterId: string;
      readonly fromRevision: number | undefined;
    };

/** Deps the resume conflict-resolution UX needs. */
type ResumeDeps = Pick<
  PlayDeps,
  'characterRegistry' | 'io' | 'now' | 'model' | 'nextId'
>;

interface CharacterCanonRow {
  name: string | null;
  class_name: string | null;
  hp_max: number;
}

function isCanonical(row: CharacterCanonRow | undefined): boolean {
  return (
    row !== undefined &&
    row.name !== null &&
    row.name.trim().length > 0 &&
    row.class_name !== null &&
    row.class_name.trim().length > 0 &&
    row.hp_max > 0
  );
}

/** True once at least one player character has been fully created. */
function hasCanonicalCharacter(db: Db): boolean {
  return listParty(db)
    .filter((m) => m.role === 'pc')
    .some((m) =>
      isCanonical(
        db
          .prepare(
            'SELECT name, class_name, hp_max FROM character WHERE id = ?',
          )
          .get(m.id) as CharacterCanonRow | undefined,
      ),
    );
}

/** Allocate the next free `pc-<n>` id given the current party. */
function nextPlayerCharacterId(db: Db): string {
  let max = 0;
  for (const member of listParty(db)) {
    const match = /^pc-(\d+)$/.exec(member.id);
    if (match !== null) {
      max = Math.max(max, Number.parseInt(match[1] ?? '0', 10));
    }
  }
  return `pc-${max + 1}`;
}

async function promptCharacterDraft(
  io: CliIO,
): Promise<CharacterCreationDraft | 'defer' | undefined> {
  const name = await io.prompt('Character name [/defer]: ');
  if (name === undefined) {
    return undefined;
  }
  if (name.toLowerCase() === '/defer') {
    return 'defer';
  }

  const ancestry = await io.prompt('Ancestry: ');
  const className = await io.prompt('Class: ');
  const abilityScoreMethod = await io.prompt(
    'Ability score method [point_buy/standard_array]: ',
  );
  const strength = await io.prompt('Strength: ');
  const dexterity = await io.prompt('Dexterity: ');
  const constitution = await io.prompt('Constitution: ');
  const intelligence = await io.prompt('Intelligence: ');
  const wisdom = await io.prompt('Wisdom: ');
  const charisma = await io.prompt('Charisma: ');
  const maxHitPoints = await io.prompt('Level-1 max HP: ');
  const spells = await io.prompt('Spells, comma-separated [none]: ');

  if (
    ancestry === undefined ||
    className === undefined ||
    abilityScoreMethod === undefined ||
    strength === undefined ||
    dexterity === undefined ||
    constitution === undefined ||
    intelligence === undefined ||
    wisdom === undefined ||
    charisma === undefined ||
    maxHitPoints === undefined ||
    spells === undefined
  ) {
    return undefined;
  }

  return {
    name,
    ancestry,
    className,
    level: 1,
    abilityScoreMethod:
      abilityScoreMethod as CharacterCreationDraft['abilityScoreMethod'],
    abilityScores: {
      strength: Number.parseInt(strength, 10),
      dexterity: Number.parseInt(dexterity, 10),
      constitution: Number.parseInt(constitution, 10),
      intelligence: Number.parseInt(intelligence, 10),
      wisdom: Number.parseInt(wisdom, 10),
      charisma: Number.parseInt(charisma, 10),
    },
    maxHitPoints: Number.parseInt(maxHitPoints, 10),
    spells: spells
      .split(',')
      .map((spell) => spell.trim())
      .filter((spell) => spell.length > 0),
  };
}

function campaignSystem(db: Db): string {
  return (readCampaignRulesBinding(db) ?? DEFAULT_DND5E_SRD_BINDING).base
    .systemId;
}

async function importSelectedFinalizedCharacter(
  deps: Pick<PlayDeps, 'characterRegistry' | 'io' | 'now'>,
  db: Db,
  campaignId: string,
  characterId: string,
): Promise<boolean> {
  const ids = deps.characterRegistry.list();
  if (ids.length === 0) {
    deps.io.write('No characters found in the character registry.');
    return false;
  }

  deps.io.write('Registered characters:');
  for (const id of ids) {
    const character = deps.characterRegistry.load(id);
    const label =
      character === undefined
        ? id
        : `${id}: ${character.identity.name}, level ${character.level} ${character.ancestry.name} ${character.class.name}`;
    deps.io.write(`  ${label}`);
  }

  const selected = await deps.io.prompt('Character id to import: ');
  if (selected === undefined || selected.trim().length === 0) {
    deps.io.write('Character import cancelled.');
    return false;
  }

  const selectedId = selected.trim();
  const character = deps.characterRegistry.load(selectedId);
  if (character === undefined) {
    deps.io.write(`No registered character found for id "${selectedId}".`);
    return false;
  }

  return checkoutIntoCampaign(deps, db, campaignId, characterId, selectedId);
}

async function runGuidedWizardAndImport(
  deps: Pick<
    PlayDeps,
    | 'characterDraftStore'
    | 'characterEngine'
    | 'characterResolver'
    | 'characterRng'
    | 'characterRegistry'
    | 'io'
    | 'now'
  >,
  db: Db,
  campaignId: string,
  characterId: string,
): Promise<boolean> {
  const draftId = newDraftId();
  deps.io.write(
    `New draft id: ${draftId} (resume later with create-character --resume ${draftId}).`,
  );
  const result = await runCharacterWizard(
    {
      io: deps.io,
      engine: deps.characterEngine,
      resolver: deps.characterResolver,
      store: deps.characterDraftStore,
      rng: deps.characterRng,
    },
    { mode: 'concept-first', draftId },
  );
  if (result.outcome !== 'completed') {
    deps.io.write('Character creation cancelled.');
    return false;
  }

  const finalized = finalizeCharacterDraft(
    result.draft,
    { createdAt: deps.now(), source: 'play:guided-wizard' },
    deps.characterResolver,
    deps.characterEngine,
  );
  if (!finalized.ok) {
    deps.io.write('Could not finalize the character:');
    for (const choice of finalized.missing) {
      deps.io.write(`  - ${choice.label}`);
    }
    for (const error of finalized.errors) {
      deps.io.write(`  x ${error}`);
    }
    return false;
  }

  // Register the new character as revision 1 (its cross-campaign identity is
  // the draft id), then check it out into this campaign (ADR 0012).
  registerNewCharacter(deps.characterRegistry, {
    globalCharacterId: draftId,
    sheet: finalized.character,
  });
  deps.io.write(
    `Registered character ${draftId} (${finalized.character.identity.name}).`,
  );
  return checkoutIntoCampaign(deps, db, campaignId, characterId, draftId);
}

/**
 * Check a registered character out of the registry into this campaign: take
 * custody (the cross-DB write lock), attach the head revision as the campaign's
 * authoritative sheet, and project the live row (ADR 0012, eshyra-lupf.14.3).
 * The double-attach guard surfaces as a friendly message — the character is
 * still in active play in another campaign and must be released there first (its
 * progress carries forward; forking is not the path for moving between
 * campaigns).
 */
function checkoutIntoCampaign(
  deps: Pick<PlayDeps, 'characterRegistry' | 'io' | 'now'>,
  db: Db,
  campaignId: string,
  characterId: string,
  globalCharacterId: string,
): boolean {
  try {
    const result = checkoutCharacterIntoCampaign(deps.characterRegistry, db, {
      globalCharacterId,
      campaignId,
      characterId,
      sessionId: 'character-creation',
      at: deps.now(),
    });
    deps.io.write(result.attach.prompt);
    return result.attach.ok;
  } catch (error) {
    if (error instanceof CharacterCustodyError) {
      deps.io.write(error.message);
      return false;
    }
    deps.io.write(error instanceof Error ? error.message : String(error));
    return false;
  }
}

async function setupDnd5eCharacter(
  deps: Pick<
    PlayDeps,
    | 'characterDraftStore'
    | 'characterEngine'
    | 'characterResolver'
    | 'characterRng'
    | 'characterRegistry'
    | 'io'
    | 'now'
  >,
  db: Db,
  campaignId: string,
  characterId: string,
  allowDefer: boolean,
): Promise<'created' | 'defer' | 'cancelled'> {
  for (;;) {
    const prompt = allowDefer
      ? 'Character setup [wizard/import/defer]: '
      : 'Character setup [wizard/import]: ';
    const choice = await deps.io.prompt(prompt);
    if (choice === undefined) {
      return 'cancelled';
    }
    const normalized = choice.trim().toLowerCase();
    if (allowDefer && (normalized === '/defer' || normalized === 'defer')) {
      return 'defer';
    }
    if (normalized === 'import') {
      if (
        await importSelectedFinalizedCharacter(
          deps,
          db,
          campaignId,
          characterId,
        )
      ) {
        return 'created';
      }
      continue;
    }
    if (normalized === 'wizard' || normalized.length === 0) {
      if (await runGuidedWizardAndImport(deps, db, campaignId, characterId)) {
        return 'created';
      }
      continue;
    }
    deps.io.write(
      allowDefer
        ? 'Choose wizard, import, or /defer.'
        : 'Choose wizard or import.',
    );
  }
}

export async function ensureCharacterReady(
  deps: Pick<
    PlayDeps,
    | 'characterDraftStore'
    | 'characterEngine'
    | 'characterResolver'
    | 'characterRng'
    | 'characterRegistry'
    | 'io'
    | 'now'
  >,
  db: Db,
  campaignId: string,
): Promise<boolean> {
  if (hasCanonicalCharacter(db)) {
    return true;
  }

  deps.io.write(
    'Character creation required before play. Type /defer to document a session-zero deferral.',
  );
  if (campaignSystem(db) === 'dnd5e-srd') {
    const result = await setupDnd5eCharacter(
      deps,
      db,
      campaignId,
      'pc-1',
      true,
    );
    if (result === 'created') {
      return true;
    }
    if (result === 'defer') {
      deps.io.write(
        'Character creation deferred. Normal turns may begin, but canonical character creation is still required for this campaign.',
      );
      return true;
    }
    deps.io.write('Character creation required before normal turns can begin.');
    return false;
  }

  for (;;) {
    const draft = await promptCharacterDraft(deps.io);
    if (draft === 'defer') {
      deps.io.write(
        'Character creation deferred. Normal turns may begin, but canonical character creation is still required for this campaign.',
      );
      return true;
    }
    if (draft === undefined) {
      deps.io.write(
        'Character creation required before normal turns can begin.',
      );
      return false;
    }

    const result = completeCharacterCreation(db, {
      draft,
      sessionId: 'character-creation',
      at: deps.now(),
    });
    deps.io.write(result.prompt);
    if (result.ok) {
      return true;
    }
  }
}

/**
 * Warn and require confirmation before catching up / forking a character while a
 * scene or combat is active (ADR 0012, eshyra-lupf.14.4). A scene-boundary
 * resume (no open scene, no active combat) needs no warning and returns true
 * silently. Returns false when the player declines (or input ends).
 */
async function confirmDuringEncounter(
  deps: Pick<ResumeDeps, 'io'>,
  db: Db,
  campaignId: string,
  action: string,
): Promise<boolean> {
  const combat = getActiveCombatInstance(db, campaignId);
  const launch = getSessionLaunchState(db, { campaignId });
  const openScene = launch.kind === 'resume' ? launch.openScene : undefined;
  if (combat === undefined && openScene === undefined) {
    return true;
  }
  const what =
    combat !== undefined
      ? `active combat (${combat.combatInstanceId})`
      : `an open scene ("${openScene?.title}")`;
  deps.io.write(
    `Warning: there is ${what}. Choosing to ${action} now changes the ` +
      'character’s stats (HP, level, gear) underneath the active encounter.',
  );
  const confirm = (await deps.io.prompt('Proceed anyway? [y/N]: '))
    ?.trim()
    .toLowerCase();
  if (confirm === 'y' || confirm === 'yes') {
    return true;
  }
  deps.io.write('Cancelled.');
  return false;
}

/**
 * Present the stale-copy conflict for one character and resolve it to a
 * decision (ADR 0012, eshyra-lupf.14.4.2). Prompts only — no mutation — so a
 * cancel anywhere leaves the registry untouched. EOF / unrecognized input
 * defaults to cancel (fail-closed). Catch-up and fork both confirm through the
 * mid-encounter warning before committing the player to that path.
 */
async function resolveStaleCopyConflict(
  deps: Pick<ResumeDeps, 'io'>,
  db: Db,
  campaignId: string,
  characterId: string,
  conflict: StaleCopyConflict,
): Promise<StaleResolution> {
  deps.io.write(
    `Character "${conflict.globalCharacterId}" (${characterId}) has advanced in another ` +
      'campaign since this one last held it.',
  );
  deps.io.write(
    `  This campaign is at revision ${conflict.localRevision ?? '?'}; the registry head ` +
      `is revision ${conflict.headRevision}.`,
  );
  deps.io.write('  [cancel]  abort resume and change nothing');
  deps.io.write(
    '  [catchup] adopt the latest revision into this campaign (replaces this campaign’s copy)',
  );
  deps.io.write(
    '  [fork]    keep this campaign’s version as a new, separate character (breaks continuity)',
  );
  const choice = (
    await deps.io.prompt('Resolve conflict [cancel/catchup/fork]: ')
  )
    ?.trim()
    .toLowerCase();

  if (choice === 'catchup') {
    if (!(await confirmDuringEncounter(deps, db, campaignId, 'catch up'))) {
      return { kind: 'cancel' };
    }
    return { kind: 'catchup', characterId };
  }
  if (choice === 'fork') {
    if (!(await confirmDuringEncounter(deps, db, campaignId, 'fork'))) {
      return { kind: 'cancel' };
    }
    return {
      kind: 'fork',
      characterId,
      globalCharacterId: conflict.globalCharacterId,
      fromRevision: conflict.localRevision,
    };
  }
  return { kind: 'cancel' };
}

/**
 * Apply a resolved stale-copy decision (the only place mutations happen). For a
 * catch-up it adopts the registry head and then offers an optional continuity
 * bridge (eshyra-lupf.14.4.3); for a fork it branches a new identity and checks
 * it into the slot (eshyra-lupf.14.4.4). Returns false on an unexpected failure.
 */
async function applyStaleResolution(
  deps: ResumeDeps,
  db: Db,
  campaignId: string,
  resolution: Exclude<StaleResolution, { kind: 'cancel' }>,
  at: string,
): Promise<boolean> {
  if (resolution.kind === 'fork') {
    return forkConflictedCharacterIntoCampaign(
      deps,
      db,
      campaignId,
      resolution.characterId,
      {
        globalCharacterId: resolution.globalCharacterId,
        fromRevision: resolution.fromRevision,
      },
    );
  }

  const store = createSqliteCharacterSheetStore(db);
  // Capture the stale sheet before catch-up overwrites it (continuity bridge).
  const priorSheet = store.load(resolution.characterId);
  const characterName = priorSheet?.identity.name ?? resolution.characterId;
  try {
    const result = catchUpCharacterToHead(deps.characterRegistry, db, {
      campaignId,
      characterId: resolution.characterId,
      sessionId: 'resume-catchup',
      at,
    });
    deps.io.write(
      `Caught ${characterName} up: adopted ${result.globalCharacterId}@${result.toRevision}` +
        `${result.fromRevision !== undefined ? ` (was at revision ${result.fromRevision})` : ''}.`,
    );
    const newSheet = store.load(resolution.characterId);
    if (newSheet !== undefined) {
      await offerContinuityBridge(deps, db, campaignId, {
        characterName,
        priorSheet,
        newSheet,
      });
    }
    return true;
  } catch (error) {
    deps.io.write(error instanceof Error ? error.message : String(error));
    return false;
  }
}

/**
 * Re-establish custody for every registry-linked character already in this
 * campaign before a (resumed) session begins, surfacing timeline conflicts as
 * explicit player choices (ADR 0012, eshyra-lupf.14.3 + eshyra-lupf.14.4).
 *
 * `ensureCharacterReady` returns early once a campaign has a canonical PC, so a
 * resumed campaign would otherwise start with no custody lock — the character
 * was released on the previous `/quit`. This reclaims the lock so the
 * "one active writer" guard holds for the whole session. A character in active
 * play in **another** campaign is a hard stop (release it there first). A
 * **stale copy** (the registry head advanced past this campaign's copy) is no
 * longer a dead end: the player chooses to cancel, catch this campaign up to the
 * registry head, or fork an alternate timeline.
 *
 * Order matters for all-or-nothing safety: every linked character is classified
 * first (no mutation); a held-elsewhere conflict or a cancelled choice aborts
 * before any lock or sheet is touched, so a failed activation never leaves
 * partial state behind. Caught-up / forked characters already hold custody and
 * report `already-held` when the locks are taken at the end.
 */
export async function activateCampaignCustody(
  deps: ResumeDeps,
  db: Db,
  campaignId: string,
): Promise<boolean> {
  const at = deps.now();
  const characterIds = createSqliteCharacterSheetStore(db).list();
  const classified = characterIds.map((characterId) => ({
    characterId,
    classification: classifyResumeConflict(deps.characterRegistry, db, {
      campaignId,
      characterId,
    }),
  }));

  // 1. Held-elsewhere is a hard stop — no resume UX resolves it (release from
  //    the other campaign). Check before any prompt or mutation.
  for (const { characterId, classification } of classified) {
    if (classification.kind === 'held-elsewhere') {
      deps.io.write(
        `Cannot resume: character "${classification.globalCharacterId}" (${characterId}) is in ` +
          `active play in campaign "${classification.heldBy.campaignId}" (as ` +
          `${classification.heldBy.characterId}). Exit that campaign to release it — its ` +
          'progress carries forward — then resume this one.',
      );
      return false;
    }
  }

  // 2. Resolve every stale-copy conflict to a decision (prompts only). A cancel
  //    aborts the whole activation before any mutation.
  const resolutions: Array<Exclude<StaleResolution, { kind: 'cancel' }>> = [];
  for (const { characterId, classification } of classified) {
    if (classification.kind !== 'stale-copy') {
      continue;
    }
    const resolution = await resolveStaleCopyConflict(
      deps,
      db,
      campaignId,
      characterId,
      classification,
    );
    if (resolution.kind === 'cancel') {
      deps.io.write('Resume cancelled. Nothing was changed.');
      return false;
    }
    resolutions.push(resolution);
  }

  // 3. Apply resolved decisions (mutations happen only now).
  for (const resolution of resolutions) {
    if (!(await applyStaleResolution(deps, db, campaignId, resolution, at))) {
      return false;
    }
  }

  // 4. Take the locks for every now-consistent character. Caught-up / forked
  //    characters already hold custody and report already-held (a no-op).
  for (const { characterId } of classified) {
    acquireCustodyOnResume(deps.characterRegistry, db, {
      campaignId,
      characterId,
      at,
    });
  }
  return true;
}

/**
 * Prompt for and create an additional player character, allocating the next
 * free `pc-<n>` id. On success the new PC becomes the active character (the
 * player can `/switch` back). Used by the `/addpc` session command.
 */
export async function createAdditionalCharacter(
  deps: Pick<
    PlayDeps,
    | 'characterDraftStore'
    | 'characterEngine'
    | 'characterResolver'
    | 'characterRng'
    | 'characterRegistry'
    | 'io'
    | 'now'
  >,
  db: Db,
  campaignId: string,
): Promise<void> {
  if (campaignSystem(db) === 'dnd5e-srd') {
    const result = await setupDnd5eCharacter(
      deps,
      db,
      campaignId,
      nextPlayerCharacterId(db),
      false,
    );
    if (result !== 'created') {
      deps.io.write('Character creation cancelled.');
    }
    return;
  }

  const draft = await promptCharacterDraft(deps.io);
  if (draft === 'defer' || draft === undefined) {
    deps.io.write('Character creation cancelled.');
    return;
  }
  const result = completeCharacterCreation(db, {
    draft,
    sessionId: 'character-creation',
    at: deps.now(),
    characterId: nextPlayerCharacterId(db),
  });
  deps.io.write(result.prompt);
}
