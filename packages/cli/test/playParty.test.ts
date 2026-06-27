import type {
  CharacterDraft,
  CharacterRegistryStore,
  CharacterSheet,
  Db,
} from '@eshyra/core';
import {
  createSeededRng,
  getBundledDnd5eCharacterResolver,
  getDnd5eCharacterCreationEngine,
  initSchema,
  openDatabase,
} from '@eshyra/core';
import {
  ensureCharacterRow,
  mutateState,
  setActiveCharacterId,
} from '@eshyra/core/internal';
import { describe, expect, it } from 'vitest';
import type { CharacterDraftStore } from '../src/characterDraftStore.js';
import { createAdditionalCharacter } from '../src/playCharacter.js';
import { showParty, switchActiveCharacter } from '../src/playParty.js';
import type { CliIO } from '../src/playTypes.js';

function scriptedIO(answers: ReadonlyArray<string>): {
  io: CliIO;
  lines: string[];
} {
  const lines: string[] = [];
  let next = 0;
  return {
    lines,
    io: {
      write: (l) => lines.push(l),
      prompt: async () => (next < answers.length ? answers[next++] : undefined),
    },
  };
}

function finalizedCharacter(name: string): CharacterSheet {
  return {
    schemaVersion: 1,
    system: 'dnd5e-srd',
    rulesPackId: 'rules:dnd5e-srd-5.1',
    recipeId: 'dnd5e-srd-level-1',
    creationMode: 'concept-first',
    level: 1,
    identity: { name },
    class: { key: 'class:fighter', name: 'Fighter' },
    ancestry: { key: 'ancestry:human', name: 'Human' },
    abilityScores: {
      strength: { base: 15, final: 16, modifier: 3 },
      dexterity: { base: 14, final: 15, modifier: 2 },
      constitution: { base: 14, final: 15, modifier: 2 },
      intelligence: { base: 10, final: 11, modifier: 0 },
      wisdom: { base: 10, final: 11, modifier: 0 },
      charisma: { base: 8, final: 9, modifier: -1 },
    },
    proficiencyBonus: 2,
    maxHitPoints: 12,
    savingThrows: {
      strength: { modifier: 5, proficient: true },
      dexterity: { modifier: 2, proficient: false },
      constitution: { modifier: 4, proficient: true },
      intelligence: { modifier: 0, proficient: false },
      wisdom: { modifier: 0, proficient: false },
      charisma: { modifier: -1, proficient: false },
    },
    skillProficiencies: [],
    toolProficiencies: [],
    armorProficiencies: [],
    weaponProficiencies: [],
    equipment: [],
    languages: ['Common'],
    spells: [],
    metadata: { createdAt: AT, source: 'test' },
  };
}

function memoryDraftStore(): CharacterDraftStore {
  const saved = new Map<string, CharacterDraft>();
  return {
    save: (draft) => {
      saved.set(draft.id, draft);
    },
    load: (id) => saved.get(id),
    list: () => [...saved.keys()].sort(),
  };
}

function memoryRegistryStore(): CharacterRegistryStore {
  const saved = new Map<string, CharacterSheet>([
    ['brielle', finalizedCharacter('Brielle')],
  ]);
  return {
    save: (id, character) => {
      saved.set(id, character);
    },
    load: (id) => saved.get(id),
    list: () => [...saved.keys()].sort(),
  };
}

function characterDeps(
  io: CliIO,
): Parameters<typeof createAdditionalCharacter>[0] {
  return {
    io,
    now: () => AT,
    characterDraftStore: memoryDraftStore(),
    characterRegistry: memoryRegistryStore(),
    characterEngine: getDnd5eCharacterCreationEngine(),
    characterResolver: getBundledDnd5eCharacterResolver(),
    characterRng: createSeededRng(1),
  };
}

const AT = '2026-05-28T00:00:00.000Z';

function freshDb(): Db {
  const db = openDatabase(':memory:');
  initSchema(db);
  return db;
}

function setName(db: Db, id: string, name: string) {
  mutateState(db, {
    target: 'character',
    id,
    field: 'name',
    op: 'set',
    value: name,
    provenance: 'test',
    sessionId: 'session-1',
    at: AT,
  });
}

function capture(): { io: CliIO; lines: string[] } {
  const lines: string[] = [];
  return {
    lines,
    io: { write: (l) => lines.push(l), prompt: async () => undefined },
  };
}

describe('showParty', () => {
  it('lists each member and flags the active one', () => {
    const db = freshDb();
    setName(db, 'pc-1', 'Aldric');
    ensureCharacterRow(db, 'pc-2', 'test', 'session-1', AT);
    setName(db, 'pc-2', 'Brielle');

    const { io, lines } = capture();
    showParty(io, db);

    const text = lines.join('\n');
    expect(text).toContain('Aldric');
    expect(text).toContain('Brielle');
    expect(text).toMatch(/Aldric.*\[active\]/);
  });
});

describe('switchActiveCharacter', () => {
  it('switches the active character by name', () => {
    const db = freshDb();
    setName(db, 'pc-1', 'Aldric');
    ensureCharacterRow(db, 'pc-2', 'test', 'session-1', AT);
    setName(db, 'pc-2', 'Brielle');

    const { io, lines } = capture();
    switchActiveCharacter(io, db, 'Brielle');

    expect(
      (
        db
          .prepare("SELECT value FROM meta WHERE key = 'active_character_id'")
          .get() as { value: string }
      ).value,
    ).toBe('pc-2');
    expect(lines.join('\n')).toContain('Brielle');
  });

  it('reports an unknown character without changing the active one', () => {
    const db = freshDb();
    setName(db, 'pc-1', 'Aldric');
    setActiveCharacterId(db, 'pc-1');

    const { io, lines } = capture();
    switchActiveCharacter(io, db, 'ghost');

    expect(
      (
        db
          .prepare("SELECT value FROM meta WHERE key = 'active_character_id'")
          .get() as { value: string }
      ).value,
    ).toBe('pc-1');
    expect(lines.join('\n')).toContain('unknown character');
  });

  it('prints usage when no reference is given', () => {
    const db = freshDb();
    const { io, lines } = capture();
    switchActiveCharacter(io, db, '');
    expect(lines.join('\n')).toContain('Usage:');
  });

  it('refuses to switch to a non-PC party member and leaves the active PC unchanged', () => {
    const db = freshDb();
    setName(db, 'pc-1', 'Aldric');
    setActiveCharacterId(db, 'pc-1');
    ensureCharacterRow(db, 'comp-1', 'test', 'session-1', AT);
    db.prepare(
      "UPDATE character SET role = 'companion', name = 'Wolf' WHERE id = ?",
    ).run('comp-1');

    const { io, lines } = capture();
    switchActiveCharacter(io, db, 'Wolf');

    expect(
      (
        db
          .prepare("SELECT value FROM meta WHERE key = 'active_character_id'")
          .get() as { value: string }
      ).value,
    ).toBe('pc-1');
    expect(lines.join('\n')).toContain('not a player character');
  });

  it('still switches to a second player character', () => {
    const db = freshDb();
    setName(db, 'pc-1', 'Aldric');
    setActiveCharacterId(db, 'pc-1');
    ensureCharacterRow(db, 'pc-2', 'test', 'session-1', AT);
    setName(db, 'pc-2', 'Brielle');

    const { io } = capture();
    switchActiveCharacter(io, db, 'pc-2');

    expect(
      (
        db
          .prepare("SELECT value FROM meta WHERE key = 'active_character_id'")
          .get() as { value: string }
      ).value,
    ).toBe('pc-2');
  });
});

describe('createAdditionalCharacter', () => {
  it('creates the next pc-<n> and makes it active', async () => {
    const db = freshDb();
    // pc-1 already exists from bootstrap; add a second PC.
    const { io } = scriptedIO(['import', 'brielle']);
    await createAdditionalCharacter(characterDeps(io), db);

    const row = db
      .prepare('SELECT name, class_name FROM character WHERE id = ?')
      .get('pc-2') as { name: string; class_name: string } | undefined;
    expect(row?.name).toBe('Brielle');
    expect(row?.class_name).toBe('Fighter');
    expect(
      (
        db
          .prepare("SELECT value FROM meta WHERE key = 'active_character_id'")
          .get() as { value: string }
      ).value,
    ).toBe('pc-2');
  });
});
