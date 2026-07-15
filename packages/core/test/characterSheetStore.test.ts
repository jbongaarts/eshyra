import { beforeEach, describe, expect, it } from 'vitest';
import { ABILITY_SCORE_NAMES } from '../src/character/abilities.js';
import type { AbilityScoreName } from '../src/character/creation.js';
import type {
  CharacterSheet,
  FinalizedAbilityScore,
} from '../src/character/finalizeCharacter.js';
import {
  assertSheetMatchesPack,
  CharacterSheetPackMismatchError,
  CharacterSheetStoreError,
  createSqliteCharacterSheetStore,
  type Db,
  DND5E_SRD_PACK_ID,
  DND5E_SRD_SYSTEM_ID,
  initSchema,
  normalizeLegacyRolledAbilityScore,
  openDatabase,
  UnsupportedCharacterBuildError,
} from '../src/internal.js';

function makeSheet(overrides: Partial<CharacterSheet> = {}): CharacterSheet {
  const abilityScores = {} as Record<AbilityScoreName, FinalizedAbilityScore>;
  const savingThrows = {} as CharacterSheet['savingThrows'];
  for (const name of ABILITY_SCORE_NAMES) {
    abilityScores[name] = { base: 10, final: 10, modifier: 0 };
    savingThrows[name] = { modifier: 0, proficient: false };
  }
  return {
    schemaVersion: 1,
    system: DND5E_SRD_SYSTEM_ID,
    rulesPackId: DND5E_SRD_PACK_ID,
    recipeId: 'dnd5e-srd:concept-first',
    creationMode: 'concept-first',
    level: 1,
    identity: { name: 'Mira' },
    class: { key: 'class:fighter', name: 'Fighter' },
    ancestry: { key: 'ancestry:human', name: 'Human' },
    abilityScores,
    proficiencyBonus: 2,
    maxHitPoints: 12,
    savingThrows,
    skillProficiencies: ['Athletics'],
    toolProficiencies: [],
    armorProficiencies: ['light', 'medium', 'heavy', 'shields'],
    weaponProficiencies: ['simple', 'martial'],
    equipment: ['chain mail'],
    languages: ['Common'],
    spells: [],
    metadata: { createdAt: '2026-06-27T00:00:00.000Z' },
    ...overrides,
  };
}

const binding = {
  base: {
    systemId: DND5E_SRD_SYSTEM_ID,
    packId: DND5E_SRD_PACK_ID,
    version: '5.1',
  },
  addons: [],
  resolvedAt: '1970-01-01T00:00:00.000Z',
} as const;

describe('character sheet store', () => {
  let db: Db;

  beforeEach(() => {
    db = openDatabase(':memory:');
    initSchema(db);
  });

  it('round-trips a sheet through SQLite', () => {
    const store = createSqliteCharacterSheetStore(db, () => 'now');
    const sheet = makeSheet();
    store.save('pc-1', sheet);
    expect(store.load('pc-1')).toEqual(sheet);
  });

  it('round-trips canonical creation rolls byte-identically and rejects forgery', () => {
    const store = createSqliteCharacterSheetStore(db, () => 'now');
    const rolledAbilityScores = Array.from({ length: 6 }, () =>
      normalizeLegacyRolledAbilityScore({
        rolls: [1, 3, 3, 4],
        dropped: 1,
        total: 10,
      }),
    );
    const sheet = makeSheet({ rolledAbilityScores });
    store.save('pc-1', sheet);
    expect(JSON.stringify(store.load('pc-1')?.rolledAbilityScores)).toBe(
      JSON.stringify(rolledAbilityScores),
    );

    expect(() =>
      store.save('forged', {
        ...sheet,
        rolledAbilityScores: [
          { ...rolledAbilityScores[0], total: 11 },
          ...rolledAbilityScores.slice(1),
        ],
      }),
    ).toThrow(/totals/);
  });

  it('persists the binding columns out of the document', () => {
    const store = createSqliteCharacterSheetStore(db, () => 'now');
    store.save('pc-1', makeSheet());
    const row = db
      .prepare(
        'SELECT schema_version, system, rules_pack_id FROM character_sheet WHERE character_id = ?',
      )
      .get('pc-1') as {
      schema_version: number;
      system: string;
      rules_pack_id: string;
    };
    expect(row).toEqual({
      schema_version: 1,
      system: DND5E_SRD_SYSTEM_ID,
      rules_pack_id: DND5E_SRD_PACK_ID,
    });
  });

  it('replaces an existing sheet on re-save', () => {
    const store = createSqliteCharacterSheetStore(db, () => 'now');
    store.save('pc-1', makeSheet({ level: 1 }));
    store.save('pc-1', makeSheet({ level: 2, maxHitPoints: 20 }));
    expect(store.load('pc-1')?.level).toBe(2);
    expect(store.list()).toEqual(['pc-1']);
  });

  it('updates the row in place on re-save (stable rowid, not delete+insert)', () => {
    // A true upsert preserves the row identity so a future append-only ledger
    // keyed to character_sheet(character_id) is never broken by a re-save.
    const store = createSqliteCharacterSheetStore(db, () => 'now');
    store.save('pc-1', makeSheet({ level: 1 }));
    const rowidBefore = (
      db
        .prepare('SELECT rowid FROM character_sheet WHERE character_id = ?')
        .get('pc-1') as { rowid: number }
    ).rowid;
    store.save('pc-1', makeSheet({ level: 2 }));
    const rowidAfter = (
      db
        .prepare('SELECT rowid FROM character_sheet WHERE character_id = ?')
        .get('pc-1') as { rowid: number }
    ).rowid;
    expect(rowidAfter).toBe(rowidBefore);
  });

  it('returns undefined for a missing sheet', () => {
    const store = createSqliteCharacterSheetStore(db);
    expect(store.load('pc-9')).toBeUndefined();
  });

  it('lists stored ids in ascending order', () => {
    const store = createSqliteCharacterSheetStore(db, () => 'now');
    store.save('pc-2', makeSheet());
    store.save('pc-1', makeSheet());
    expect(store.list()).toEqual(['pc-1', 'pc-2']);
  });

  it('rejects an empty character id on save', () => {
    const store = createSqliteCharacterSheetStore(db);
    expect(() => store.save('  ', makeSheet())).toThrow(
      CharacterSheetStoreError,
    );
  });

  it('throws when the mirrored binding columns disagree with the document', () => {
    const store = createSqliteCharacterSheetStore(db, () => 'now');
    store.save('pc-1', makeSheet());
    // Tamper with a binding column out of band.
    db.prepare(
      'UPDATE character_sheet SET rules_pack_id = ? WHERE character_id = ?',
    ).run('rules:other-pack', 'pc-1');
    expect(() => store.load('pc-1')).toThrow(CharacterSheetStoreError);
  });

  it('rejects known multiclass fields from a hand-edited document before they can be discarded', () => {
    const store = createSqliteCharacterSheetStore(db, () => 'now');
    const sheet = makeSheet();
    store.save('pc-1', sheet);
    const handEdited = {
      ...sheet,
      classes: [sheet.class, { key: 'class:wizard', name: 'Wizard' }],
    };
    db.prepare(
      'UPDATE character_sheet SET sheet_json = ? WHERE character_id = ?',
    ).run(JSON.stringify(handEdited), 'pc-1');

    let thrown: unknown;
    try {
      store.load('pc-1');
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(UnsupportedCharacterBuildError);
    expect(thrown).toMatchObject({
      code: 'MULTICLASS_UNSUPPORTED',
      operation: 'character-sheet load',
      message:
        'character-sheet load was refused: Eshyra currently supports one class only.',
    });
    const stored = db
      .prepare('SELECT sheet_json FROM character_sheet WHERE character_id = ?')
      .get('pc-1') as { sheet_json: string };
    expect(JSON.parse(stored.sheet_json).classes).toEqual(handEdited.classes);
  });

  describe('assertSheetMatchesPack', () => {
    it('accepts a sheet built under the bound pack', () => {
      expect(() => assertSheetMatchesPack(makeSheet(), binding)).not.toThrow();
    });

    it('rejects a system mismatch', () => {
      expect(() =>
        assertSheetMatchesPack(makeSheet({ system: 'pathfinder2e' }), binding),
      ).toThrow(CharacterSheetPackMismatchError);
    });

    it('rejects a rules-pack mismatch', () => {
      expect(() =>
        assertSheetMatchesPack(
          makeSheet({ rulesPackId: 'rules:dnd5e-srd-9.9' }),
          binding,
        ),
      ).toThrow(CharacterSheetPackMismatchError);
    });
  });
});
