// Deterministic level-up application engine (eshyra-lupf.8). Tests assert exact
// pack-derived deltas for a martial class (Fighter) and a caster (Wizard),
// including proficiency-bonus crossings, spell DC recomputation, the HP floor,
// the live-row projection, the ledger audit row, and the fail-closed guards.

import { describe, expect, it } from 'vitest';
import {
  applyLevelUp,
  type CharacterSheet,
  CharacterSheetPackMismatchError,
  computeLevelUpChangeSet,
  createSqliteCharacterSheetStore,
  getProgressionState,
  LevelUpEngineError,
  listProgressionEvents,
  mutateState,
} from '../src/internal.js';
import { bareDb, DEFAULT_TEST_SESSION_ID } from './support/db.js';

const AT = '2026-05-27T12:00:00.000Z';
const APPLY = {
  source: 'guided-level-up',
  provenance: 'engine:level-up',
  sessionId: DEFAULT_TEST_SESSION_ID,
  at: AT,
};

const ABILITIES = [
  'strength',
  'dexterity',
  'constitution',
  'intelligence',
  'wisdom',
  'charisma',
] as const;

interface SheetOverrides {
  classKey?: string;
  className?: string;
  level?: number;
  maxHitPoints?: number;
  proficiencyBonus?: number;
  modifiers?: Partial<Record<(typeof ABILITIES)[number], number>>;
  spellSaveDc?: number;
  spellAttackModifier?: number;
  system?: string;
  rulesPackId?: string;
}

/** Build a minimal-but-valid CharacterSheet for the engine to advance. */
function buildSheet(overrides: SheetOverrides = {}): CharacterSheet {
  const modifiers = overrides.modifiers ?? {};
  const abilityScores = {} as CharacterSheet['abilityScores'];
  const savingThrows = {} as CharacterSheet['savingThrows'];
  for (const name of ABILITIES) {
    const modifier = modifiers[name] ?? 0;
    abilityScores[name] = { base: 10, final: 10 + modifier * 2, modifier };
    savingThrows[name] = { modifier, proficient: false };
  }
  return {
    schemaVersion: 1,
    system: overrides.system ?? 'dnd5e-srd',
    rulesPackId: overrides.rulesPackId ?? 'rules:dnd5e-srd-5.1',
    recipeId: 'dnd5e-srd-character',
    creationMode: 'test',
    level: overrides.level ?? 1,
    identity: { name: 'Test Hero' },
    class: {
      key: overrides.classKey ?? 'class:fighter',
      name: overrides.className ?? 'Fighter',
    },
    ancestry: { key: 'ancestry:human', name: 'Human' },
    abilityScores,
    proficiencyBonus: overrides.proficiencyBonus ?? 2,
    maxHitPoints: overrides.maxHitPoints ?? 12,
    savingThrows,
    ...(overrides.spellSaveDc !== undefined
      ? { spellSaveDc: overrides.spellSaveDc }
      : {}),
    ...(overrides.spellAttackModifier !== undefined
      ? { spellAttackModifier: overrides.spellAttackModifier }
      : {}),
    skillProficiencies: [],
    toolProficiencies: [],
    armorProficiencies: [],
    weaponProficiencies: [],
    equipment: [],
    languages: [],
    spells: [],
    metadata: { createdAt: AT },
  };
}

function seedLiveHp(
  db: ReturnType<typeof bareDb>,
  hpMax: number,
  hpCurrent: number,
): void {
  for (const [field, value] of [
    ['hp_max', hpMax],
    ['hp_current', hpCurrent],
  ] as const) {
    mutateState(db, {
      target: 'character',
      field,
      op: 'set',
      value,
      provenance: 'test:init',
      sessionId: DEFAULT_TEST_SESSION_ID,
      at: AT,
    });
  }
}

describe('applyLevelUp — martial (Fighter)', () => {
  it('applies a level-1→2 step with exact pack-derived deltas', () => {
    const db = bareDb();
    const store = createSqliteCharacterSheetStore(db, () => AT);
    // CON 14 (modifier +2); Fighter d10 → fixed average 6 → +8 HP.
    store.save(
      'pc-1',
      buildSheet({ maxHitPoints: 12, modifiers: { constitution: 2 } }),
    );
    seedLiveHp(db, 12, 9);

    const result = applyLevelUp(db, { store, ...APPLY });

    expect(result.changeSet).toMatchObject({
      classKey: 'class:fighter',
      level: { from: 1, to: 2 },
      proficiencyBonus: { from: 2, to: 2 },
      hitPoints: {
        method: 'fixed-average',
        hitDie: 10,
        constitutionModifier: 2,
        increment: 8,
        maxHitPoints: { from: 12, to: 20 },
      },
      featuresGained: ['feature:fighter:action-surge'],
    });
    expect(result.changeSet.spellcasting).toBeUndefined();

    // Authoritative sheet updated.
    const saved = store.load('pc-1');
    expect(saved?.level).toBe(2);
    expect(saved?.maxHitPoints).toBe(20);

    // Live projection: level + hp_max bumped, hp_current raised by the increment.
    const row = db
      .prepare('SELECT level, hp_max, hp_current FROM character WHERE id = ?')
      .get('pc-1') as { level: number; hp_max: number; hp_current: number };
    expect(row).toEqual({ level: 2, hp_max: 20, hp_current: 17 });
    expect(getProgressionState(db).level).toBe(2);
    db.close();
  });

  it('crosses the proficiency-bonus boundary at level 5 and audits the event', () => {
    const db = bareDb();
    const store = createSqliteCharacterSheetStore(db, () => AT);
    store.save(
      'pc-1',
      buildSheet({
        level: 4,
        proficiencyBonus: 2,
        maxHitPoints: 30,
        modifiers: { constitution: 1 },
      }),
    );
    seedLiveHp(db, 30, 30);

    const result = applyLevelUp(db, { store, ...APPLY });
    expect(result.changeSet).toMatchObject({
      level: { from: 4, to: 5 },
      proficiencyBonus: { from: 2, to: 3 },
      hitPoints: { increment: 7, maxHitPoints: { from: 30, to: 37 } },
      featuresGained: ['feature:fighter:extra-attack'],
    });

    const events = listProgressionEvents(db);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      kind: 'level-up',
      resultingLevel: 5,
      source: 'guided-level-up',
    });
    expect(events[0].appliedChanges).toMatchObject({
      level: { from: 4, to: 5 },
      proficiencyBonus: { from: 2, to: 3 },
    });
    expect(result.event.id).toBe(events[0].id);
    db.close();
  });
});

describe('applyLevelUp — caster (Wizard)', () => {
  it('grants the new spell slots and keeps the DC steady when prof is unchanged', () => {
    const db = bareDb();
    const store = createSqliteCharacterSheetStore(db, () => AT);
    // Wizard d6, INT 16 (+3): DC 8+2+3=13, attack +5 at level 1.
    store.save(
      'pc-1',
      buildSheet({
        classKey: 'class:wizard',
        className: 'Wizard',
        level: 1,
        maxHitPoints: 8,
        modifiers: { constitution: 1, intelligence: 3 },
        spellSaveDc: 13,
        spellAttackModifier: 5,
      }),
    );
    seedLiveHp(db, 8, 8);

    const result = applyLevelUp(db, { store, ...APPLY });
    expect(result.changeSet).toMatchObject({
      level: { from: 1, to: 2 },
      proficiencyBonus: { from: 2, to: 2 },
      hitPoints: { hitDie: 6, increment: 5 },
      featuresGained: ['feature:wizard:arcane-tradition'],
      spellcasting: { cantripsKnown: 3, slots: { '1': 3 } },
      spellSaveDc: { from: 13, to: 13 },
      spellAttackModifier: { from: 5, to: 5 },
    });
    db.close();
  });

  it('recomputes the spell DC when level 5 raises the proficiency bonus', () => {
    const db = bareDb();
    const store = createSqliteCharacterSheetStore(db, () => AT);
    store.save(
      'pc-1',
      buildSheet({
        classKey: 'class:wizard',
        className: 'Wizard',
        level: 4,
        proficiencyBonus: 2,
        maxHitPoints: 22,
        modifiers: { constitution: 1, intelligence: 3 },
        spellSaveDc: 13,
        spellAttackModifier: 5,
      }),
    );
    seedLiveHp(db, 22, 22);

    const result = applyLevelUp(db, { store, ...APPLY });
    expect(result.changeSet).toMatchObject({
      proficiencyBonus: { from: 2, to: 3 },
      spellcasting: { cantripsKnown: 4, slots: { '1': 4, '2': 3, '3': 2 } },
      spellSaveDc: { from: 13, to: 14 },
      spellAttackModifier: { from: 5, to: 6 },
    });
    const saved = store.load('pc-1');
    expect(saved?.spellSaveDc).toBe(14);
    expect(saved?.spellAttackModifier).toBe(6);
    db.close();
  });
});

describe('applyLevelUp — HP floor and fail-closed guards', () => {
  it('floors the HP increment at 1 for a very low Constitution', () => {
    // CON 3 → modifier -4; Wizard d6 average 4 → 4 + (-4) = 0, floored to 1.
    const sheet = buildSheet({
      classKey: 'class:wizard',
      className: 'Wizard',
      modifiers: { constitution: -4 },
    });
    const changeSet = computeLevelUpChangeSet(sheet);
    expect(changeSet.hitPoints.increment).toBe(1);
  });

  it('throws when no sheet is stored for the character', () => {
    const db = bareDb();
    const store = createSqliteCharacterSheetStore(db, () => AT);
    expect(() => applyLevelUp(db, { store, ...APPLY })).toThrow(
      LevelUpEngineError,
    );
    db.close();
  });

  it('fails closed when the sheet pack does not match the campaign binding', () => {
    const db = bareDb();
    const store = createSqliteCharacterSheetStore(db, () => AT);
    store.save('pc-1', buildSheet({ system: 'pathfinder-2e' }));
    expect(() => applyLevelUp(db, { store, ...APPLY })).toThrow(
      CharacterSheetPackMismatchError,
    );
    // No ledger row written on a failed step.
    expect(listProgressionEvents(db)).toHaveLength(0);
    db.close();
  });

  it('throws when the target level is past the tabulated maximum', () => {
    const sheet = buildSheet({ level: 20 });
    expect(() => computeLevelUpChangeSet(sheet)).toThrow(LevelUpEngineError);
  });
});
