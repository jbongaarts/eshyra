import type { CharacterCreationDraft, CharacterSheet, Db } from '@eshyra/core';
import {
  attachCharacterSheetToCampaign,
  completeCharacterCreation,
  DEFAULT_DND5E_SRD_BINDING,
  finalizeCharacterDraft,
  listParty,
  readCampaignRulesBinding,
} from '@eshyra/core';
import { runCharacterWizard } from './characterWizard.js';
import { newDraftId } from './createCharacter.js';
import type { CliIO, PlayDeps } from './playTypes.js';

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

  return importFinalizedIntoCampaign(
    deps,
    db,
    character,
    characterId,
    selectedId,
  );
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

  // Register the new character (its cross-campaign identity is the draft id),
  // then attach it into this campaign (ADR 0012).
  deps.characterRegistry.save(draftId, finalized.character);
  deps.io.write(
    `Registered character ${draftId} (${finalized.character.identity.name}).`,
  );
  return importFinalizedIntoCampaign(
    deps,
    db,
    finalized.character,
    characterId,
    draftId,
  );
}

function importFinalizedIntoCampaign(
  deps: Pick<PlayDeps, 'io' | 'now'>,
  db: Db,
  character: CharacterSheet,
  characterId: string,
  globalCharacterId: string,
): boolean {
  // Attach is copy-with-provenance, not a fork (ADR 0012): the core helper
  // fails closed on a rules-pack mismatch, stamps the source registry identity,
  // persists the per-campaign authority, and projects the live character row.
  let result: ReturnType<typeof attachCharacterSheetToCampaign>;
  try {
    result = attachCharacterSheetToCampaign(db, {
      sheet: character,
      globalCharacterId,
      characterId,
      sessionId: 'character-creation',
      at: deps.now(),
    });
  } catch (error) {
    deps.io.write(error instanceof Error ? error.message : String(error));
    return false;
  }
  deps.io.write(result.prompt);
  return result.ok;
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
      if (await importSelectedFinalizedCharacter(deps, db, characterId)) {
        return 'created';
      }
      continue;
    }
    if (normalized === 'wizard' || normalized.length === 0) {
      if (await runGuidedWizardAndImport(deps, db, characterId)) {
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
): Promise<boolean> {
  if (hasCanonicalCharacter(db)) {
    return true;
  }

  deps.io.write(
    'Character creation required before play. Type /defer to document a session-zero deferral.',
  );
  if (campaignSystem(db) === 'dnd5e-srd') {
    const result = await setupDnd5eCharacter(deps, db, 'pc-1', true);
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
): Promise<void> {
  if (campaignSystem(db) === 'dnd5e-srd') {
    const result = await setupDnd5eCharacter(
      deps,
      db,
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
