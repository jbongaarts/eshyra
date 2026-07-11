import { describe, expect, it } from 'vitest';
import {
  buildCharacterCreationMutations,
  CharacterCreationError,
  type CharacterSheet,
  completeCharacterCreation,
  createCampaign,
  EMBERFALL_HOLLOW,
  getActiveCharacterId,
  importFinalizedCharacter,
  initSchema,
  openDatabase,
  PATHFINDER2E_REMASTER_RULES_PACK,
  UnsupportedCharacterBuildError,
  validateCharacterDraft,
  writeCampaignRulesBinding,
} from '../src/internal.js';

const validDraft = {
  name: 'Mira',
  ancestry: 'Human',
  className: 'Fighter',
  level: 1,
  abilityScoreMethod: 'point_buy',
  abilityScores: {
    strength: 15,
    dexterity: 14,
    constitution: 14,
    intelligence: 10,
    wisdom: 10,
    charisma: 8,
  },
  maxHitPoints: 12,
  spells: [],
} as const;

describe('character creation', () => {
  it('validates an SRD-legal level-1 character draft', () => {
    expect(validateCharacterDraft(validDraft)).toEqual({
      ok: true,
      character: {
        name: 'Mira',
        ancestry: 'Human',
        className: 'Fighter',
        level: 1,
        abilityScores: validDraft.abilityScores,
        maxHitPoints: 12,
        spells: [],
      },
    });
  });

  it('rejects illegal class, point-buy, standard-array, and spell choices', () => {
    // Artificer is not in the SRD 5.1 pack; the twelve SRD classes (including
    // Warlock) now resolve from the generated pack.
    expect(() =>
      validateCharacterDraft({ ...validDraft, className: 'Artificer' }),
    ).toThrow(CharacterCreationError);

    expect(() =>
      validateCharacterDraft({
        ...validDraft,
        abilityScores: { ...validDraft.abilityScores, strength: 16 },
      }),
    ).toThrow(CharacterCreationError);

    expect(() =>
      validateCharacterDraft({
        ...validDraft,
        abilityScoreMethod: 'standard_array',
        abilityScores: {
          strength: 15,
          dexterity: 14,
          constitution: 13,
          intelligence: 12,
          wisdom: 10,
          charisma: 10,
        },
      }),
    ).toThrow(CharacterCreationError);

    expect(() =>
      validateCharacterDraft({
        ...validDraft,
        spells: ['Fire Bolt'],
      }),
    ).toThrow(CharacterCreationError);
  });

  it('accepts manual/rolled scores free of point-buy and array constraints', () => {
    // A rolled spread that is neither point-buy-legal nor the standard array.
    const rolledDraft = {
      ...validDraft,
      abilityScoreMethod: 'rolled',
      abilityScores: {
        strength: 17,
        dexterity: 16,
        constitution: 16,
        intelligence: 9,
        wisdom: 12,
        charisma: 11,
      },
      // Fighter d10 + CON +3 = 13.
      maxHitPoints: 13,
    } as const;
    expect(validateCharacterDraft(rolledDraft).ok).toBe(true);

    // Still bounded: a wildly out-of-range manual score is rejected.
    expect(() =>
      validateCharacterDraft({
        ...rolledDraft,
        abilityScoreMethod: 'manual',
        abilityScores: { ...rolledDraft.abilityScores, strength: 25 },
      }),
    ).toThrow(CharacterCreationError);
  });

  it('builds mutate_state-compatible writes for the canonical character row', () => {
    expect(
      buildCharacterCreationMutations(validDraft, {
        provenance: 'character_creation:session-zero',
        sessionId: 'session-0',
        at: '2026-05-20T22:45:00.000Z',
      }),
    ).toEqual([
      {
        target: 'character',
        id: 'pc-1',
        field: 'name',
        op: 'set',
        value: 'Mira',
        provenance: 'character_creation:session-zero',
        sessionId: 'session-0',
        at: '2026-05-20T22:45:00.000Z',
      },
      {
        target: 'character',
        id: 'pc-1',
        field: 'ancestry',
        op: 'set',
        value: 'Human',
        provenance: 'character_creation:session-zero',
        sessionId: 'session-0',
        at: '2026-05-20T22:45:00.000Z',
      },
      {
        target: 'character',
        id: 'pc-1',
        field: 'class_name',
        op: 'set',
        value: 'Fighter',
        provenance: 'character_creation:session-zero',
        sessionId: 'session-0',
        at: '2026-05-20T22:45:00.000Z',
      },
      {
        target: 'character',
        id: 'pc-1',
        field: 'level',
        op: 'set',
        value: 1,
        provenance: 'character_creation:session-zero',
        sessionId: 'session-0',
        at: '2026-05-20T22:45:00.000Z',
      },
      {
        target: 'character',
        id: 'pc-1',
        field: 'hp_current',
        op: 'set',
        value: 12,
        provenance: 'character_creation:session-zero',
        sessionId: 'session-0',
        at: '2026-05-20T22:45:00.000Z',
      },
      {
        target: 'character',
        id: 'pc-1',
        field: 'hp_max',
        op: 'set',
        value: 12,
        provenance: 'character_creation:session-zero',
        sessionId: 'session-0',
        at: '2026-05-20T22:45:00.000Z',
      },
      {
        target: 'character',
        id: 'pc-1',
        field: 'ability_scores_json',
        op: 'set',
        value: JSON.stringify(validDraft.abilityScores),
        provenance: 'character_creation:session-zero',
        sessionId: 'session-0',
        at: '2026-05-20T22:45:00.000Z',
      },
      {
        target: 'character',
        id: 'pc-1',
        field: 'conditions_json',
        op: 'set',
        value: JSON.stringify([]),
        provenance: 'character_creation:session-zero',
        sessionId: 'session-0',
        at: '2026-05-20T22:45:00.000Z',
      },
    ]);
  });

  it('returns correction guidance without writes when a guided draft is illegal', () => {
    const db = openDatabase(':memory:');
    initSchema(db);

    const result = completeCharacterCreation(db, {
      draft: { ...validDraft, className: 'Artificer' },
      sessionId: 'session-0',
      at: '2026-05-20T22:46:00.000Z',
    });

    expect(result).toEqual({
      ok: false,
      errors: [
        'unsupported SRD class: Artificer',
        'level-1 hit point maximum must be 2',
      ],
      prompt:
        'Revise the character draft before persisting it: unsupported SRD class: Artificer; level-1 hit point maximum must be 2',
    });
    expect(
      db
        .prepare(`SELECT name, class_name FROM character WHERE id = 'pc-1'`)
        .get(),
    ).toEqual({ name: null, class_name: null });

    db.close();
  });

  it('refuses a multiclass-shaped creation draft before persisting state', () => {
    const db = openDatabase(':memory:');
    initSchema(db);
    const draft = {
      ...validDraft,
      targetClass: 'Wizard',
    };

    expect(() =>
      completeCharacterCreation(db, {
        draft: draft as typeof validDraft,
        sessionId: 'session-0',
        at: '2026-05-20T22:46:00.000Z',
      }),
    ).toThrow(UnsupportedCharacterBuildError);
    expect(
      db
        .prepare(`SELECT name, class_name FROM character WHERE id = 'pc-1'`)
        .get(),
    ).toEqual({ name: null, class_name: null });
    db.close();
  });

  it('dispatches to the D&D validator when the campaign binding is D&D SRD', () => {
    const db = openDatabase(':memory:');
    initSchema(db);
    createCampaign(db, { campaignId: 'dnd-camp', pack: EMBERFALL_HOLLOW });

    const result = completeCharacterCreation(db, {
      draft: validDraft,
      sessionId: 'session-0',
      at: '2026-05-23T13:00:00.000Z',
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.character.className).toBe('Fighter');
    }
    db.close();
  });

  it('refuses a D&D-shaped draft when the campaign binding is Pathfinder', () => {
    const db = openDatabase(':memory:');
    initSchema(db);
    // Hand-write a Pathfinder binding without going through createCampaign so
    // we bypass module-compatibility validation (D&D Emberfall requires the
    // D&D binding). The dispatcher in completeCharacterCreation should still
    // route by the persisted binding's systemId — and the Pathfinder validator
    // should reject the D&D-shaped draft (no background / classFeat / ancestry
    // feat / equipment fields).
    writeCampaignRulesBinding(db, {
      base: {
        systemId: PATHFINDER2E_REMASTER_RULES_PACK.meta.systemId,
        packId: PATHFINDER2E_REMASTER_RULES_PACK.meta.packId,
        version: PATHFINDER2E_REMASTER_RULES_PACK.meta.version,
      },
      addons: [],
      resolvedAt: '2026-05-23T13:00:00.000Z',
    });

    const result = completeCharacterCreation(db, {
      draft: validDraft,
      sessionId: 'session-0',
      at: '2026-05-23T13:00:00.000Z',
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      // The Pathfinder validator surfaces concrete missing-field errors.
      expect(result.errors.length).toBeGreaterThan(0);
    }
    // No D&D character row was written.
    const row = db
      .prepare(`SELECT name, class_name FROM character WHERE id = 'pc-1'`)
      .get() as { name: string | null; class_name: string | null };
    expect(row.name).toBeNull();
    expect(row.class_name).toBeNull();
    db.close();
  });

  it('persists an accepted guided draft into canonical state', () => {
    const db = openDatabase(':memory:');
    initSchema(db);

    const result = completeCharacterCreation(db, {
      draft: validDraft,
      sessionId: 'session-0',
      at: '2026-05-20T22:47:00.000Z',
    });

    expect(result).toEqual({
      ok: true,
      character: {
        name: 'Mira',
        ancestry: 'Human',
        className: 'Fighter',
        level: 1,
        abilityScores: validDraft.abilityScores,
        maxHitPoints: 12,
        spells: [],
      },
      mutationsApplied: 8,
      prompt: 'Character creation complete: Mira is a level 1 Human Fighter.',
    });
    expect(
      db
        .prepare(
          `SELECT name, ancestry, class_name, level, hp_current, hp_max,
                  ability_scores_json, provenance, session_id, updated_at
           FROM character
           WHERE id = 'pc-1'`,
        )
        .get(),
    ).toEqual({
      name: 'Mira',
      ancestry: 'Human',
      class_name: 'Fighter',
      level: 1,
      hp_current: 12,
      hp_max: 12,
      ability_scores_json: JSON.stringify(validDraft.abilityScores),
      provenance: 'character_creation:complete',
      session_id: 'session-0',
      updated_at: '2026-05-20T22:47:00.000Z',
    });

    db.close();
  });

  it('imports a finalized character as the active canonical pc-1', () => {
    const db = openDatabase(':memory:');
    initSchema(db);
    const character: CharacterSheet = {
      schemaVersion: 1,
      system: 'dnd5e-srd',
      rulesPackId: 'dnd5e-srd-5.1',
      recipeId: 'dnd5e-srd-level-1',
      creationMode: 'concept-first',
      level: 1,
      identity: { name: 'Tamsin' },
      class: { key: 'class:rogue', name: 'Rogue' },
      ancestry: { key: 'ancestry:halfling', name: 'Halfling' },
      abilityScores: {
        strength: { base: 8, final: 8, modifier: -1 },
        dexterity: { base: 15, final: 17, modifier: 3 },
        constitution: { base: 14, final: 14, modifier: 2 },
        intelligence: { base: 10, final: 10, modifier: 0 },
        wisdom: { base: 12, final: 12, modifier: 1 },
        charisma: { base: 13, final: 14, modifier: 2 },
      },
      proficiencyBonus: 2,
      maxHitPoints: 10,
      savingThrows: {
        strength: { modifier: -1, proficient: false },
        dexterity: { modifier: 5, proficient: true },
        constitution: { modifier: 2, proficient: false },
        intelligence: { modifier: 2, proficient: true },
        wisdom: { modifier: 1, proficient: false },
        charisma: { modifier: 2, proficient: false },
      },
      skillProficiencies: ['Stealth'],
      toolProficiencies: ['thieves tools'],
      armorProficiencies: ['light armor'],
      weaponProficiencies: ['simple weapons'],
      equipment: ['shortsword'],
      languages: ['Common', 'Halfling'],
      spells: [],
      metadata: { createdAt: '2026-06-26T00:00:00.000Z', source: 'test' },
    };

    const result = importFinalizedCharacter(db, {
      character,
      sessionId: 'session-0',
      at: '2026-06-26T01:00:00.000Z',
    });

    expect(result.ok).toBe(true);
    expect(getActiveCharacterId(db)).toBe('pc-1');
    expect(
      db
        .prepare(
          `SELECT name, ancestry, class_name, hp_current, hp_max,
                  ability_scores_json, provenance
           FROM character
           WHERE id = 'pc-1'`,
        )
        .get(),
    ).toEqual({
      name: 'Tamsin',
      ancestry: 'Halfling',
      class_name: 'Rogue',
      hp_current: 10,
      hp_max: 10,
      ability_scores_json: JSON.stringify({
        strength: 8,
        dexterity: 17,
        constitution: 14,
        intelligence: 10,
        wisdom: 12,
        charisma: 14,
      }),
      provenance: 'character_creation:import_finalized',
    });

    db.close();
  });

  it('refuses a multiclass-shaped finalized import before projecting live state', () => {
    const db = openDatabase(':memory:');
    initSchema(db);
    const character = {
      schemaVersion: 1,
      system: 'dnd5e-srd',
      rulesPackId: 'dnd5e-srd-5.1',
      recipeId: 'dnd5e-srd-level-1',
      creationMode: 'concept-first',
      level: 1,
      identity: { name: 'Tamsin' },
      class: { key: 'class:rogue', name: 'Rogue' },
      ancestry: { key: 'ancestry:halfling', name: 'Halfling' },
      abilityScores: {},
      proficiencyBonus: 2,
      maxHitPoints: 10,
      savingThrows: {},
      skillProficiencies: [],
      toolProficiencies: [],
      armorProficiencies: [],
      weaponProficiencies: [],
      equipment: [],
      languages: [],
      spells: [],
      metadata: { createdAt: '2026-06-26T00:00:00.000Z' },
      classLevels: { 'class:rogue': 1, 'class:wizard': 1 },
    };

    expect(() =>
      importFinalizedCharacter(db, {
        character: character as CharacterSheet,
        sessionId: 'session-0',
        at: '2026-06-26T01:00:00.000Z',
      }),
    ).toThrow(UnsupportedCharacterBuildError);
    expect(
      db
        .prepare(`SELECT name, class_name FROM character WHERE id = 'pc-1'`)
        .get(),
    ).toEqual({ name: null, class_name: null });
    db.close();
  });

  it('creates a second character (pc-2) without disturbing pc-1', () => {
    const db = openDatabase(':memory:');
    initSchema(db);

    completeCharacterCreation(db, {
      draft: validDraft,
      sessionId: 'session-0',
      at: '2026-05-20T22:47:00.000Z',
    });

    const pc2Draft = {
      ...validDraft,
      name: 'Korvin',
      abilityScores: {
        strength: 8,
        dexterity: 15,
        constitution: 14,
        intelligence: 10,
        wisdom: 14,
        charisma: 8,
      },
      maxHitPoints: 12,
    };

    const result = completeCharacterCreation(db, {
      draft: pc2Draft,
      characterId: 'pc-2',
      sessionId: 'session-0',
      at: '2026-05-20T22:48:00.000Z',
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.character.name).toBe('Korvin');
    }

    const pc2 = db
      .prepare(
        `SELECT name, class_name, hp_current, hp_max FROM character WHERE id = 'pc-2'`,
      )
      .get() as {
      name: string;
      class_name: string;
      hp_current: number;
      hp_max: number;
    };
    expect(pc2.name).toBe('Korvin');
    expect(pc2.hp_current).toBe(12);

    const pc1 = db
      .prepare(`SELECT name FROM character WHERE id = 'pc-1'`)
      .get() as { name: string };
    expect(pc1.name).toBe('Mira');

    expect(getActiveCharacterId(db)).toBe('pc-2');

    db.close();
  });
});
