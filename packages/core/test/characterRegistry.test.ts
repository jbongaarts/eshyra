import { beforeEach, describe, expect, it } from 'vitest';
import { ABILITY_SCORE_NAMES } from '../src/character/abilities.js';
import type { AbilityScoreName } from '../src/character/creation.js';
import type {
  CharacterSheet,
  FinalizedAbilityScore,
} from '../src/character/finalizeCharacter.js';
import {
  attachCharacterSheetToCampaign,
  CharacterSheetPackMismatchError,
  CharacterSheetStoreError,
  createCharacterRegistryStore,
  createSqliteCharacterSheetStore,
  type Db,
  DND5E_SRD_PACK_ID,
  DND5E_SRD_SYSTEM_ID,
  ensureCharacterRegistrySchema,
  getActiveCharacterId,
  initSchema,
  openDatabase,
} from '../src/internal.js';

function makeSheet(overrides: Partial<CharacterSheet> = {}): CharacterSheet {
  const abilityScores = {} as Record<AbilityScoreName, FinalizedAbilityScore>;
  const savingThrows = {} as CharacterSheet['savingThrows'];
  for (const name of ABILITY_SCORE_NAMES) {
    abilityScores[name] = { base: 12, final: 12, modifier: 1 };
    savingThrows[name] = { modifier: 1, proficient: false };
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
    armorProficiencies: ['light'],
    weaponProficiencies: ['simple'],
    equipment: ['chain mail'],
    languages: ['Common'],
    spells: [],
    metadata: { createdAt: '2026-06-27T00:00:00.000Z' },
    ...overrides,
  };
}

describe('character registry store', () => {
  let db: Db;

  beforeEach(() => {
    db = openDatabase(':memory:');
    ensureCharacterRegistrySchema(db);
  });

  it('round-trips a sheet keyed by global character id', () => {
    const registry = createCharacterRegistryStore(db, () => 'now');
    const sheet = makeSheet();
    registry.save('char-mira', sheet);
    expect(registry.load('char-mira')).toEqual(sheet);
    expect(registry.list()).toEqual(['char-mira']);
  });

  it('returns undefined for an unregistered id', () => {
    const registry = createCharacterRegistryStore(db);
    expect(registry.load('nope')).toBeUndefined();
  });

  it('lists ids in ascending order', () => {
    const registry = createCharacterRegistryStore(db, () => 'now');
    registry.save('b', makeSheet());
    registry.save('a', makeSheet());
    expect(registry.list()).toEqual(['a', 'b']);
  });

  it('preserves created_at across an in-place update', () => {
    let clock = 'created';
    const registry = createCharacterRegistryStore(db, () => clock);
    registry.save('char-mira', makeSheet({ level: 1 }));
    clock = 'updated';
    registry.save('char-mira', makeSheet({ level: 2 }));
    const row = db
      .prepare(
        'SELECT created_at, updated_at FROM character_registry WHERE global_character_id = ?',
      )
      .get('char-mira') as { created_at: string; updated_at: string };
    expect(row).toEqual({ created_at: 'created', updated_at: 'updated' });
    expect(registry.load('char-mira')?.level).toBe(2);
  });

  it('rejects an empty global id', () => {
    const registry = createCharacterRegistryStore(db);
    expect(() => registry.save('  ', makeSheet())).toThrow(
      CharacterSheetStoreError,
    );
  });

  it('throws when the mirrored binding columns disagree with the document', () => {
    const registry = createCharacterRegistryStore(db, () => 'now');
    registry.save('char-mira', makeSheet());
    db.prepare(
      'UPDATE character_registry SET system = ? WHERE global_character_id = ?',
    ).run('pathfinder2e', 'char-mira');
    expect(() => registry.load('char-mira')).toThrow(CharacterSheetStoreError);
  });
});

describe('attachCharacterSheetToCampaign', () => {
  let db: Db;

  beforeEach(() => {
    db = openDatabase(':memory:');
    initSchema(db);
  });

  it('attaches a registry sheet as the campaign authority with provenance', () => {
    const result = attachCharacterSheetToCampaign(db, {
      sheet: makeSheet(),
      globalCharacterId: 'char-mira',
      characterId: 'pc-1',
      sessionId: 'character-creation',
      at: '2026-06-27T12:00:00.000Z',
    });
    expect(result.ok).toBe(true);

    // Campaign sheet is authoritative and carries the registry linkage.
    const campaignSheet = createSqliteCharacterSheetStore(db).load('pc-1');
    expect(campaignSheet?.metadata.globalCharacterId).toBe('char-mira');
    expect(campaignSheet?.metadata.importedAt).toBe('2026-06-27T12:00:00.000Z');

    // Live row is projected (active character set, identity present).
    expect(getActiveCharacterId(db)).toBe('pc-1');
    const row = db
      .prepare('SELECT name, level, hp_max FROM character WHERE id = ?')
      .get('pc-1') as { name: string; level: number; hp_max: number };
    expect(row.name).toBe('Mira');
    expect(row.hp_max).toBe(12);
  });

  it('fails closed on a rules-pack mismatch (cross-pack is not an attach)', () => {
    expect(() =>
      attachCharacterSheetToCampaign(db, {
        sheet: makeSheet({ rulesPackId: 'rules:dnd5e-srd-9.9' }),
        globalCharacterId: 'char-mira',
        characterId: 'pc-1',
        sessionId: 'character-creation',
        at: '2026-06-27T12:00:00.000Z',
      }),
    ).toThrow(CharacterSheetPackMismatchError);
    // Nothing was written for the rejected character.
    expect(createSqliteCharacterSheetStore(db).load('pc-1')).toBeUndefined();
  });
});
