import type { CharacterCreationDraft, Db } from '@eshyra/core';
import { completeCharacterCreation, listParty } from '@eshyra/core';
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

export async function ensureCharacterReady(
  deps: Pick<PlayDeps, 'io' | 'now'>,
  db: Db,
): Promise<boolean> {
  if (hasCanonicalCharacter(db)) {
    return true;
  }

  deps.io.write(
    'Character creation required before play. Type /defer to document a session-zero deferral.',
  );
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
  deps: Pick<PlayDeps, 'io' | 'now'>,
  db: Db,
): Promise<void> {
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
