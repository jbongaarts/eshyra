import { describe, expect, it } from 'vitest';
import {
  awardXp,
  type CharacterSheet,
  createSqliteCharacterSheetStore,
  getBundledAdvancementTable,
  listProgressionEvents,
  mutateState,
  runGuidedLevelUp,
  UnsupportedCharacterBuildError,
} from '../src/internal.js';
import { bareDb, DEFAULT_TEST_SESSION_ID } from './support/db.js';

const AT = '2026-06-28T02:30:00.000Z';
const FLOW = {
  source: 'guided-level-up',
  provenance: 'flow:guided-level-up',
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
const xpTable = getBundledAdvancementTable();
const L2 = xpTable.thresholds[1].xpThreshold;
const L3 = xpTable.thresholds[2].xpThreshold;

interface SheetOverrides {
  classKey?: string;
  className?: string;
  level?: number;
  maxHitPoints?: number;
  proficiencyBonus?: number;
  modifiers?: Partial<Record<(typeof ABILITIES)[number], number>>;
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

function setLiveCharacter(
  db: ReturnType<typeof bareDb>,
  level: number,
  hpMax: number,
  hpCurrent: number,
): void {
  for (const [field, value] of [
    ['level', level],
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

describe('runGuidedLevelUp', () => {
  it('refuses an advancement target before the guided flow can preview or mutate state', () => {
    const db = bareDb();
    const store = createSqliteCharacterSheetStore(db, () => AT);
    const sheet = buildSheet();
    store.save('pc-1', sheet);
    setLiveCharacter(db, 1, 12, 9);
    awardXp(db, L2, 'test threshold', FLOW);
    const before = db
      .prepare('SELECT level, hp_max, hp_current FROM character WHERE id = ?')
      .get('pc-1');

    expect(() =>
      runGuidedLevelUp(db, {
        store,
        ...FLOW,
        targetClass: 'Wizard',
      } as Parameters<typeof runGuidedLevelUp>[1]),
    ).toThrow(UnsupportedCharacterBuildError);
    expect(store.load('pc-1')).toEqual(sheet);
    expect(
      db
        .prepare('SELECT level, hp_max, hp_current FROM character WHERE id = ?')
        .get('pc-1'),
    ).toEqual(before);
    expect(
      listProgressionEvents(db).filter((event) => event.kind === 'level-up'),
    ).toEqual([]);
    db.close();
  });

  it('reports not eligible without previewing or committing', () => {
    const db = bareDb();
    const store = createSqliteCharacterSheetStore(db, () => AT);
    store.save('pc-1', buildSheet());

    const result = runGuidedLevelUp(db, { store, ...FLOW });

    expect(result).toMatchObject({
      outcome: 'not-eligible',
      eligibility: { eligible: false, currentLevel: 1, targetLevel: 1 },
    });
    expect(listProgressionEvents(db)).toHaveLength(0);
    db.close();
  });

  it('collects required supported choices before previewing', () => {
    const db = bareDb();
    const store = createSqliteCharacterSheetStore(db, () => AT);
    store.save(
      'pc-1',
      buildSheet({
        level: 2,
        maxHitPoints: 20,
        modifiers: { constitution: 2 },
      }),
    );
    setLiveCharacter(db, 2, 20, 18);
    awardXp(db, L3, 'test threshold', FLOW);

    const result = runGuidedLevelUp(db, { store, ...FLOW });

    expect(result).toMatchObject({
      outcome: 'needs-choices',
      eligibility: { eligible: true, currentLevel: 2, targetLevel: 3 },
      requiredChoices: [
        {
          id: 'level.3.subclass',
          kind: 'subclass',
          status: 'supported',
          from: ['Champion'],
        },
      ],
    });
    expect(
      listProgressionEvents(db).filter((e) => e.kind === 'level-up'),
    ).toHaveLength(0);
    db.close();
  });

  it('previews selected subclass consequences without committing', () => {
    const db = bareDb();
    const store = createSqliteCharacterSheetStore(db, () => AT);
    store.save('pc-1', buildSheet({ level: 2, maxHitPoints: 20 }));
    setLiveCharacter(db, 2, 20, 18);
    awardXp(db, L3, 'test threshold', FLOW);

    const result = runGuidedLevelUp(db, {
      store,
      choices: { 'level.3.subclass': ['Champion'] },
      ...FLOW,
    });

    expect(result).toMatchObject({
      outcome: 'preview',
      changeSet: {
        level: { from: 2, to: 3 },
        featuresGained: [
          'feature:fighter:martial-archetype',
          'feature:champion:improved-critical',
        ],
      },
    });
    expect(store.load('pc-1')?.level).toBe(2);
    expect(
      listProgressionEvents(db).filter((e) => e.kind === 'level-up'),
    ).toHaveLength(0);
    db.close();
  });

  it('commits a confirmed preview through the auditable apply path', () => {
    const db = bareDb();
    const store = createSqliteCharacterSheetStore(db, () => AT);
    store.save(
      'pc-1',
      buildSheet({
        level: 2,
        maxHitPoints: 20,
        modifiers: { constitution: 2 },
      }),
    );
    setLiveCharacter(db, 2, 20, 18);
    awardXp(db, L3, 'test threshold', FLOW);

    const result = runGuidedLevelUp(db, {
      store,
      choices: { 'level.3.subclass': ['Champion'] },
      confirm: true,
      ...FLOW,
    });

    expect(result).toMatchObject({
      outcome: 'committed',
      sheet: {
        level: 3,
        subclass: { key: 'subclass:champion', name: 'Champion' },
      },
      changeSet: {
        featuresGained: [
          'feature:fighter:martial-archetype',
          'feature:champion:improved-critical',
        ],
      },
    });
    expect(
      listProgressionEvents(db).filter((e) => e.kind === 'level-up'),
    ).toHaveLength(1);
    db.close();
  });

  it('halts on unsupported spell choices even when supported choices are supplied', () => {
    const db = bareDb();
    const store = createSqliteCharacterSheetStore(db, () => AT);
    store.save(
      'pc-1',
      buildSheet({
        classKey: 'class:wizard',
        className: 'Wizard',
        modifiers: { intelligence: 3 },
      }),
    );
    awardXp(db, L2, 'test threshold', FLOW);

    const result = runGuidedLevelUp(db, {
      store,
      choices: { 'level.2.subclass': ['School of Evocation'] },
      confirm: true,
      ...FLOW,
    });

    expect(result).toMatchObject({
      outcome: 'blocked',
      requiredChoices: [
        {
          id: 'level.2.spell-selection',
          status: 'unsupported',
          unsupportedReason: expect.stringContaining(
            'deterministic spell application is not implemented yet',
          ),
        },
      ],
    });
    expect(store.load('pc-1')?.level).toBe(1);
    expect(
      listProgressionEvents(db).filter((e) => e.kind === 'level-up'),
    ).toHaveLength(0);
    db.close();
  });
});
