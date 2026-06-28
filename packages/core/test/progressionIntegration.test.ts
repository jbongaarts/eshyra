import { describe, expect, it } from 'vitest';
import {
  awardXp,
  type CharacterSheet,
  createSqliteCharacterSheetStore,
  getBundledAdvancementTable,
  getLevelUpEligibility,
  getProgressionState,
  grantMilestone,
  listProgressionEvents,
  mutateState,
  runGuidedLevelUp,
  writeCampaignProgressionPolicy,
} from '../src/internal.js';
import { bareDb, DEFAULT_TEST_SESSION_ID } from './support/db.js';

const AT = '2026-06-28T03:00:00.000Z';
const FLOW = {
  source: 'guided-level-up',
  provenance: 'integration:progression',
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
const L2 = getBundledAdvancementTable().thresholds[1].xpThreshold;

interface SheetOverrides {
  classKey?: string;
  className?: string;
  subclassKey?: string;
  subclassName?: string;
  level?: number;
  maxHitPoints?: number;
  modifiers?: Partial<Record<(typeof ABILITIES)[number], number>>;
  spellSaveDc?: number;
  spellAttackModifier?: number;
}

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
    system: 'dnd5e-srd',
    rulesPackId: 'rules:dnd5e-srd-5.1',
    recipeId: 'dnd5e-srd-character',
    creationMode: 'test',
    level: overrides.level ?? 1,
    identity: { name: 'Integration Hero' },
    class: {
      key: overrides.classKey ?? 'class:fighter',
      name: overrides.className ?? 'Fighter',
    },
    ...(overrides.subclassKey !== undefined
      ? {
          subclass: {
            key: overrides.subclassKey,
            name: overrides.subclassName ?? overrides.subclassKey,
          },
        }
      : {}),
    ancestry: { key: 'ancestry:human', name: 'Human' },
    abilityScores,
    proficiencyBonus: 2,
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

function seedLiveCharacter(
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

function selectMilestoneMode(db: ReturnType<typeof bareDb>): void {
  writeCampaignProgressionPolicy(db, {
    advancementMode: 'milestone',
    provenance: 'test:policy',
    sessionId: DEFAULT_TEST_SESSION_ID,
    at: AT,
  });
}

describe('progression integration — award to guided apply', () => {
  it('advances a martial Fighter through XP mode with audited deltas', () => {
    const db = bareDb();
    const store = createSqliteCharacterSheetStore(db, () => AT);
    store.save(
      'pc-1',
      buildSheet({ maxHitPoints: 12, modifiers: { constitution: 2 } }),
    );
    seedLiveCharacter(db, 12, 10);

    const award = awardXp(db, L2, 'encounter: ogres', FLOW);
    expect(award).toMatchObject({ previousXp: 0, newXp: L2, level: 1 });
    expect(getLevelUpEligibility(db)).toMatchObject({
      mode: 'xp',
      eligible: true,
      currentLevel: 1,
      targetLevel: 2,
    });

    const result = runGuidedLevelUp(db, { store, confirm: true, ...FLOW });

    expect(result).toMatchObject({
      outcome: 'committed',
      changeSet: {
        classKey: 'class:fighter',
        level: { from: 1, to: 2 },
        hitPoints: {
          hitDie: 10,
          constitutionModifier: 2,
          increment: 8,
          maxHitPoints: { from: 12, to: 20 },
        },
        featuresGained: ['feature:fighter:action-surge'],
      },
    });
    expect(getProgressionState(db)).toMatchObject({
      level: 2,
      currentXp: L2,
    });
    expect(getLevelUpEligibility(db)).toMatchObject({ eligible: false });
    expect(store.load('pc-1')).toMatchObject({ level: 2, maxHitPoints: 20 });

    const events = listProgressionEvents(db);
    expect(events.map((event) => event.kind)).toEqual(['xp-award', 'level-up']);
    expect(events[0]).toMatchObject({
      kind: 'xp-award',
      amount: L2,
      source: 'encounter: ogres',
      resultingXp: L2,
      resultingLevel: 1,
      provenance: FLOW.provenance,
      sessionId: FLOW.sessionId,
    });
    expect(events[1]).toMatchObject({
      kind: 'level-up',
      source: 'guided-level-up',
      resultingLevel: 2,
      provenance: FLOW.provenance,
      sessionId: FLOW.sessionId,
      appliedChanges: {
        classKey: 'class:fighter',
        featuresGained: ['feature:fighter:action-surge'],
      },
    });
    db.close();
  });

  it('advances a martial Fighter through milestone mode with audited deltas', () => {
    const db = bareDb();
    selectMilestoneMode(db);
    const store = createSqliteCharacterSheetStore(db, () => AT);
    store.save(
      'pc-1',
      buildSheet({ maxHitPoints: 12, modifiers: { constitution: 2 } }),
    );
    seedLiveCharacter(db, 12, 9);

    const milestone = grantMilestone(db, 'Cleared Emberfall vault', 'DM', FLOW);
    expect(milestone).toMatchObject({ level: 1 });
    expect(getLevelUpEligibility(db)).toMatchObject({
      mode: 'milestone',
      eligible: true,
      currentLevel: 1,
      targetLevel: 2,
    });

    const result = runGuidedLevelUp(db, { store, confirm: true, ...FLOW });

    expect(result).toMatchObject({
      outcome: 'committed',
      changeSet: {
        classKey: 'class:fighter',
        level: { from: 1, to: 2 },
        hitPoints: { increment: 8, maxHitPoints: { from: 12, to: 20 } },
        featuresGained: ['feature:fighter:action-surge'],
      },
    });
    expect(getLevelUpEligibility(db)).toMatchObject({ eligible: false });
    expect(getProgressionState(db)).toMatchObject({
      level: 2,
      currentXp: 0,
    });

    const events = listProgressionEvents(db);
    expect(events.map((event) => event.kind)).toEqual([
      'milestone-award',
      'level-up',
    ]);
    expect(events[0]).toMatchObject({
      kind: 'milestone-award',
      milestoneLabel: 'Cleared Emberfall vault',
      source: 'DM',
      resultingLevel: 1,
    });
    expect(events[1]).toMatchObject({
      kind: 'level-up',
      resultingLevel: 2,
      appliedChanges: {
        level: { from: 1, to: 2 },
        featuresGained: ['feature:fighter:action-surge'],
      },
    });
    db.close();
  });

  it('advances a full-caster Cleric through XP mode with exact spell slots', () => {
    const db = bareDb();
    const store = createSqliteCharacterSheetStore(db, () => AT);
    store.save(
      'pc-1',
      buildSheet({
        classKey: 'class:cleric',
        className: 'Cleric',
        subclassKey: 'subclass:life-domain',
        subclassName: 'Life Domain',
        maxHitPoints: 9,
        modifiers: { constitution: 1, wisdom: 3 },
        spellSaveDc: 13,
        spellAttackModifier: 5,
      }),
    );
    seedLiveCharacter(db, 9, 7);

    awardXp(db, L2, 'sanctuary defended', FLOW);

    const result = runGuidedLevelUp(db, { store, confirm: true, ...FLOW });

    expect(result).toMatchObject({
      outcome: 'committed',
      changeSet: {
        classKey: 'class:cleric',
        level: { from: 1, to: 2 },
        hitPoints: {
          hitDie: 8,
          constitutionModifier: 1,
          increment: 6,
          maxHitPoints: { from: 9, to: 15 },
        },
        featuresGained: [
          'feature:cleric:channel-divinity',
          'feature:life-domain:channel-divinity-preserve-life',
        ],
        spellcasting: { cantripsKnown: 3, slots: { '1': 3 } },
        spellSaveDc: { from: 13, to: 13 },
        spellAttackModifier: { from: 5, to: 5 },
      },
    });
    expect(store.load('pc-1')).toMatchObject({
      level: 2,
      maxHitPoints: 15,
      spellSaveDc: 13,
      spellAttackModifier: 5,
    });

    const events = listProgressionEvents(db);
    expect(events.map((event) => event.kind)).toEqual(['xp-award', 'level-up']);
    expect(events[1]?.appliedChanges).toMatchObject({
      classKey: 'class:cleric',
      spellcasting: { cantripsKnown: 3, slots: { '1': 3 } },
      featuresGained: [
        'feature:cleric:channel-divinity',
        'feature:life-domain:channel-divinity-preserve-life',
      ],
    });
    db.close();
  });

  it('advances a full-caster Cleric through milestone mode with exact spell slots', () => {
    const db = bareDb();
    selectMilestoneMode(db);
    const store = createSqliteCharacterSheetStore(db, () => AT);
    store.save(
      'pc-1',
      buildSheet({
        classKey: 'class:cleric',
        className: 'Cleric',
        subclassKey: 'subclass:life-domain',
        subclassName: 'Life Domain',
        maxHitPoints: 9,
        modifiers: { constitution: 1, wisdom: 3 },
        spellSaveDc: 13,
        spellAttackModifier: 5,
      }),
    );
    seedLiveCharacter(db, 9, 8);

    grantMilestone(db, 'Consecrated the shrine', 'DM', FLOW);

    const result = runGuidedLevelUp(db, { store, confirm: true, ...FLOW });

    expect(result).toMatchObject({
      outcome: 'committed',
      changeSet: {
        classKey: 'class:cleric',
        level: { from: 1, to: 2 },
        hitPoints: { increment: 6, maxHitPoints: { from: 9, to: 15 } },
        featuresGained: [
          'feature:cleric:channel-divinity',
          'feature:life-domain:channel-divinity-preserve-life',
        ],
        spellcasting: { cantripsKnown: 3, slots: { '1': 3 } },
      },
    });
    expect(getLevelUpEligibility(db)).toMatchObject({ eligible: false });
    expect(getProgressionState(db)).toMatchObject({
      level: 2,
      currentXp: 0,
    });

    const events = listProgressionEvents(db);
    expect(events.map((event) => event.kind)).toEqual([
      'milestone-award',
      'level-up',
    ]);
    expect(events[1]).toMatchObject({
      kind: 'level-up',
      resultingLevel: 2,
      appliedChanges: {
        classKey: 'class:cleric',
        spellcasting: { cantripsKnown: 3, slots: { '1': 3 } },
        featuresGained: [
          'feature:cleric:channel-divinity',
          'feature:life-domain:channel-divinity-preserve-life',
        ],
      },
    });
    db.close();
  });
});
