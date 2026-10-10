// Feature/option proficiency grants (eshyra-olc5.7.2): typed pack grants reach
// the durable sheet at creation and level-up, with an exact-removal ledger.
// Real SRD pack throughout; sheets are built directly for state-shaped cases.

import { describe, expect, it } from 'vitest';
import {
  type AbilityScoreName,
  applyLevelUp,
  applyProficiencyGrants,
  type CharacterSheet,
  collectGrantSources,
  createDefaultToolRegistry,
  createSeededRng,
  createSqliteCharacterSheetStore,
  finalizeCharacterDraft,
  getBundledDnd5eCharacterResolver,
  getDnd5eCharacterCreationEngine,
  grantsForSources,
  previewLevelUpChangeSet,
  removeOptionGrants,
  type ToolContext,
  validateCharacterSheetProficiencyGrants,
} from '../src/internal.js';
import { DEFAULT_TEST_SESSION_ID, freshDbWithSession } from './support/db.js';

const AT = '2026-05-27T12:00:00.000Z';
const APPLY = {
  source: 'guided-level-up',
  provenance: 'engine:level-up',
  sessionId: DEFAULT_TEST_SESSION_ID,
  at: AT,
};
const ABILITIES: readonly AbilityScoreName[] = [
  'strength',
  'dexterity',
  'constitution',
  'intelligence',
  'wisdom',
  'charisma',
];
const bundled = getBundledDnd5eCharacterResolver();
const MODS: Record<AbilityScoreName, number> = {
  strength: 0,
  dexterity: 3,
  constitution: 1,
  intelligence: 0,
  wisdom: 2,
  charisma: 1,
};

function buildSheet(o: {
  classKey: string;
  className: string;
  level: number;
  proficiencyBonus: number;
  saves?: readonly AbilityScoreName[];
  skills?: readonly string[];
  featureChoices?: CharacterSheet['featureChoices'];
  proficiencyGrants?: CharacterSheet['proficiencyGrants'];
  spellcasting?: CharacterSheet['spellcasting'];
}): CharacterSheet {
  const abilityScores = {} as CharacterSheet['abilityScores'];
  const savingThrows = {} as CharacterSheet['savingThrows'];
  for (const name of ABILITIES) {
    abilityScores[name] = {
      base: 10,
      final: 10 + MODS[name] * 2,
      modifier: MODS[name],
    };
    const proficient = o.saves?.includes(name) ?? false;
    savingThrows[name] = {
      modifier: MODS[name] + (proficient ? o.proficiencyBonus : 0),
      proficient,
    };
  }
  return {
    schemaVersion: 1,
    system: 'dnd5e-srd',
    rulesPackId: 'rules:dnd5e-srd-5.1',
    recipeId: 'dnd5e-srd-character',
    creationMode: 'test',
    level: o.level,
    identity: { name: 'Kira' },
    class: { key: o.classKey, name: o.className },
    ancestry: { key: 'ancestry:human', name: 'Human' },
    abilityScores,
    proficiencyBonus: o.proficiencyBonus,
    maxHitPoints: 100,
    savingThrows,
    skillProficiencies: [...(o.skills ?? [])],
    toolProficiencies: [],
    armorProficiencies: [],
    weaponProficiencies: [],
    equipment: [],
    languages: [],
    spells: [],
    ...(o.spellcasting !== undefined ? { spellcasting: o.spellcasting } : {}),
    ...(o.featureChoices !== undefined
      ? { featureChoices: o.featureChoices }
      : {}),
    ...(o.proficiencyGrants !== undefined
      ? { proficiencyGrants: o.proficiencyGrants }
      : {}),
    metadata: { createdAt: AT },
  };
}

const rogueAt = (
  level: number,
  extra: Partial<Parameters<typeof buildSheet>[0]> = {},
) =>
  buildSheet({
    classKey: 'class:rogue',
    className: 'Rogue',
    level,
    proficiencyBonus: level >= 13 ? 5 : 4,
    saves: ['dexterity', 'intelligence'],
    ...extra,
  });

function persist(sheet: CharacterSheet) {
  const db = freshDbWithSession();
  const store = createSqliteCharacterSheetStore(db, () => AT);
  store.save('pc-1', sheet);
  db.prepare("UPDATE character SET name = 'Kira' WHERE id = 'pc-1'").run();
  for (const [field, value] of [
    ['hp_max', sheet.maxHitPoints],
    ['hp_current', sheet.maxHitPoints],
  ] as const) {
    db.prepare(`UPDATE character SET ${field} = ? WHERE id = 'pc-1'`).run(
      value,
    );
  }
  return { db, store };
}

function resolveSave(
  db: ReturnType<typeof freshDbWithSession>,
  ability: string,
) {
  const ctx: ToolContext = {
    db,
    rng: createSeededRng(5),
    campaignId: 'campaign-1',
    sessionId: DEFAULT_TEST_SESSION_ID,
    turnId: 'turn-1',
    at: AT,
  };
  const result = createDefaultToolRegistry().invoke(
    'resolve_check',
    { reason: 'r', kind: 'saving_throw', actor: 'Kira', ability },
    ctx,
  );
  if (!result.ok) throw new Error(JSON.stringify(result));
  return result.data as {
    modifierTotal: number;
    proficiency?: { multiplier: string; applied: number };
  };
}

describe('pure grant functions', () => {
  const sheet = rogueAt(15);
  const source = (sourceRef: string, grant: object) => ({
    sourceRef,
    grant: grant as never,
  });

  it('adds only what is newly held and records exactly that', () => {
    const withDeception = rogueAt(15, { skills: ['deception'] });
    const { sheet: next, ledgerEntries } = applyProficiencyGrants(
      withDeception,
      [source('opt:x', { skills: ['Deception', 'Persuasion'] })],
    );
    expect(next.skillProficiencies).toEqual(['deception', 'Persuasion']);
    expect(ledgerEntries).toEqual([
      { sourceRef: 'opt:x', skills: ['Persuasion'] },
    ]);
  });

  it('records an empty entry for a source that adds nothing, and is idempotent', () => {
    const grant = source('feature:x', { savingThrows: ['dexterity'] });
    const once = applyProficiencyGrants(sheet, [grant]);
    expect(once.ledgerEntries).toEqual([{ sourceRef: 'feature:x' }]);
    const twice = applyProficiencyGrants(once.sheet, [grant]);
    expect(twice.ledgerEntries).toEqual([]);
    expect(twice.sheet).toBe(once.sheet);
    expect(grantsForSources(once.sheet, [grant])).toEqual([]);
  });

  it('sets a save with ability modifier + proficiency bonus', () => {
    const { sheet: next } = applyProficiencyGrants(sheet, [
      source('feature:x', { savingThrows: ['wisdom'] }),
    ]);
    expect(next.savingThrows.wisdom).toEqual({
      modifier: 2 + 5,
      proficient: true,
    });
  });

  it('removes only the recorded additions and refuses on Expertise', () => {
    const base = rogueAt(15, { skills: ['Deception'] });
    const granted = applyProficiencyGrants(base, [
      source('opt:x', {
        skills: ['Deception', 'Persuasion'],
        armor: ['shields'],
      }),
    ]).sheet;
    const removed = removeOptionGrants(granted, 'opt:x').sheet;
    expect(removed.skillProficiencies).toEqual(['Deception']);
    expect(removed.armorProficiencies).toEqual([]);
    expect(removed.proficiencyGrants).toBeUndefined();
    const withExpertise: CharacterSheet = {
      ...granted,
      featureChoices: [
        {
          featureRef: 'feature:rogue:expertise',
          choiceId: 'expertise',
          optionIds: ['skill:Persuasion'],
          level: 6,
        },
      ],
    };
    expect(() => removeOptionGrants(withExpertise, 'opt:x')).toThrow(
      /Expertise/,
    );
  });

  it('validator rejects a duplicate sourceRef and an unknown skill', () => {
    expect(() =>
      validateCharacterSheetProficiencyGrants({
        proficiencyGrants: [{ sourceRef: 'a' }, { sourceRef: 'a' }],
      }),
    ).toThrow(/duplicated/);
    expect(() =>
      validateCharacterSheetProficiencyGrants({
        proficiencyGrants: [{ sourceRef: 'a', skills: ['Lockpicking'] }],
      }),
    ).toThrow(/closed vocabulary/);
    expect(() =>
      validateCharacterSheetProficiencyGrants({
        proficiencyGrants: [
          { sourceRef: 'a', skills: ['Arcana'], armor: ['shields'] },
        ],
      }),
    ).not.toThrow();
  });
});

describe('level-up applies feature proficiency grants', () => {
  it('Rogue 14->15 gains Wisdom save proficiency, visible in resolve_check', () => {
    const before = rogueAt(14);
    expect(before.savingThrows.wisdom.proficient).toBe(false);
    const { db, store } = persist(before);
    expect(resolveSave(db, 'wisdom').proficiency).toBeUndefined();

    const preview = previewLevelUpChangeSet(before, { resolver: bundled });
    expect(preview.ok).toBe(true);
    if (!preview.ok) return;
    expect(preview.changeSet.savingThrows?.wisdom).toEqual({
      from: { modifier: 2, proficient: false },
      to: { modifier: 7, proficient: true },
    });
    expect(preview.changeSet.proficienciesGained).toEqual({
      savingThrows: ['wisdom'],
    });

    const result = applyLevelUp(db, { store, ...APPLY });
    expect(result.sheet.savingThrows.wisdom).toEqual({
      modifier: 7,
      proficient: true,
    });
    expect(result.sheet.proficiencyGrants).toEqual([
      { sourceRef: 'feature:rogue:slippery-mind', savingThrows: ['wisdom'] },
    ]);
    expect(store.load('pc-1')?.savingThrows.wisdom.proficient).toBe(true);
    expect(resolveSave(db, 'wisdom')).toMatchObject({
      modifierTotal: 7,
      proficiency: { multiplier: 'normal', applied: 5 },
    });
    db.close();
  });

  it('reconciles a legacy level-15 sheet at its next level-up, once', () => {
    const legacy = rogueAt(15);
    expect(legacy.proficiencyGrants).toBeUndefined();
    const { db, store } = persist(legacy);
    const first = applyLevelUp(db, {
      store,
      choices: { 'level.16.ability-score-improvement': ['Dexterity'] },
      ...APPLY,
    });
    expect(first.sheet.savingThrows.wisdom.proficient).toBe(true);
    expect(first.sheet.proficiencyGrants).toHaveLength(1);
    // Running reconciliation again over the converged sheet adds nothing.
    const sources = collectGrantSources(
      bundled,
      Array.from({ length: 16 }, (_, i) =>
        bundled.resolveClassLevel('class:rogue', i + 1),
      ).flatMap((row) => (row.ok ? row.record.featureRefs : [])),
      first.sheet.featureChoices,
    );
    expect(sources.length).toBeGreaterThan(0);
    expect(grantsForSources(first.sheet, sources)).toEqual([]);
    db.close();
  });

  it('Monk 13->14 gains all six saves; the ledger records only the four new ones', () => {
    const monk = buildSheet({
      classKey: 'class:monk',
      className: 'Monk',
      level: 13,
      proficiencyBonus: 5,
      saves: ['strength', 'dexterity'],
    });
    const { db, store } = persist(monk);
    const result = applyLevelUp(db, { store, ...APPLY });
    for (const ability of ABILITIES) {
      expect(result.sheet.savingThrows[ability].proficient).toBe(true);
      expect(result.sheet.savingThrows[ability].modifier).toBe(
        MODS[ability] + 5,
      );
    }
    expect(result.sheet.proficiencyGrants).toEqual([
      {
        sourceRef: 'feature:monk:diamond-soul',
        savingThrows: ['constitution', 'intelligence', 'wisdom', 'charisma'],
      },
    ]);
    db.close();
  });
});

describe('Eldritch Invocation: Beguiling Influence', () => {
  const INV = 'feature:warlock:eldritch-invocations';
  const BEGUILING = 'eldritch-invocation:beguiling-influence';
  const levelKey = (n: number) =>
    `level.${n}.feature.warlock-eldritch-invocations.eldritch-invocations`;
  const warlock = (extra: Partial<Parameters<typeof buildSheet>[0]> = {}) =>
    buildSheet({
      classKey: 'class:warlock',
      className: 'Warlock',
      level: 4,
      proficiencyBonus: 2,
      saves: ['wisdom', 'charisma'],
      spellcasting: { cantrips: [], known: [] },
      featureChoices: [
        {
          featureRef: INV,
          choiceId: 'eldritch-invocations',
          optionIds: ['eldritch-invocation:beast-speech', BEGUILING],
          level: 2,
        },
      ],
      ...extra,
    });

  const SPELL = { 'level.5.spells.known': ['spell:charm-person'] };

  function chooseAtFive(sheet: CharacterSheet) {
    return previewLevelUpChangeSet(sheet, {
      resolver: bundled,
      choices: {
        [levelKey(5)]: ['eldritch-invocation:mire-the-mind'],
        ...SPELL,
      },
    });
  }

  it('records Deception and Persuasion for a held Beguiling Influence', () => {
    const preview = chooseAtFive(warlock());
    expect(preview.ok).toBe(true);
    if (!preview.ok) return;
    expect(preview.changeSet.proficienciesGained).toEqual({
      skills: ['Deception', 'Persuasion'],
    });
    expect(preview.changeSet.proficiencyLedger).toEqual([
      { sourceRef: BEGUILING, skills: ['Deception', 'Persuasion'] },
    ]);
  });

  it('records only Persuasion when Deception is held, and replacing it keeps Deception', () => {
    const first = chooseAtFive(warlock({ skills: ['Deception'] }));
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(first.changeSet.proficiencyLedger).toEqual([
      { sourceRef: BEGUILING, skills: ['Persuasion'] },
    ]);
    const ledgered = warlock({
      skills: ['Deception', 'Persuasion'],
      proficiencyGrants: [{ sourceRef: BEGUILING, skills: ['Persuasion'] }],
    });
    const { db, store } = persist(ledgered);
    const result = applyLevelUp(db, {
      store,
      choices: {
        [levelKey(5)]: ['eldritch-invocation:mire-the-mind'],
        [`${levelKey(5)}.replace`]: [
          BEGUILING,
          'eldritch-invocation:eldritch-sight',
        ],
        ...SPELL,
      },
      ...APPLY,
    });
    expect(result.changeSet.proficienciesRemoved).toEqual({
      skills: ['Persuasion'],
    });
    expect(result.sheet.skillProficiencies).toEqual(['Deception']);
    expect(result.sheet.proficiencyGrants).toBeUndefined();
    expect(store.load('pc-1')?.skillProficiencies).toEqual(['Deception']);
    db.close();
  });

  it('refuses the replacement when a recorded skill has Expertise', () => {
    const sheet = warlock({
      skills: ['Deception', 'Persuasion'],
      proficiencyGrants: [
        { sourceRef: BEGUILING, skills: ['Deception', 'Persuasion'] },
      ],
      featureChoices: [
        {
          featureRef: INV,
          choiceId: 'eldritch-invocations',
          optionIds: [BEGUILING],
          level: 2,
        },
        {
          featureRef: 'feature:rogue:expertise',
          choiceId: 'expertise',
          optionIds: ['skill:Persuasion'],
          level: 1,
        },
      ],
    });
    expect(() =>
      previewLevelUpChangeSet(sheet, {
        resolver: bundled,
        choices: {
          [levelKey(5)]: ['eldritch-invocation:mire-the-mind'],
          [`${levelKey(5)}.replace`]: [
            BEGUILING,
            'eldritch-invocation:eldritch-sight',
          ],
          ...SPELL,
        },
      }),
    ).toThrow(/Expertise/);
  });
});

describe('creation', () => {
  const engine = getDnd5eCharacterCreationEngine();
  const META = { createdAt: AT, source: 'test' } as const;

  function finalize(className: string, ancestry: string) {
    let draft = engine.createDraft({ id: 'x', mode: 'concept-first' });
    draft = engine.setIdentity(draft, { name: 'Hero' });
    draft = engine.setClass(draft, className);
    draft = engine.setAncestry(draft, ancestry);
    draft = engine.setBackground(draft, 'Acolyte');
    draft = engine.setAbilityScoreMethod(draft, 'point_buy');
    draft = engine.setAbilityScores(draft, {
      strength: 13,
      dexterity: 12,
      constitution: 14,
      intelligence: 10,
      wisdom: 15,
      charisma: 8,
    });
    for (let pass = 0; pass < 3; pass += 1) {
      for (const entry of engine.mechanicalChoices(draft)) {
        if (entry.satisfied) continue;
        draft = engine.setChoice(
          draft,
          entry.choice.id,
          (entry.choice.from ?? []).slice(0, entry.choice.choose ?? 0),
        );
      }
    }
    if (className === 'Cleric') {
      const spells = bundled
        .listSpells()
        .filter((s) => s.classes.includes('Cleric'));
      draft = engine.setSpells(draft, [
        ...spells
          .filter((s) => s.level === 0)
          .slice(0, 3)
          .map((s) => s.name),
        ...spells
          .filter((s) => s.level === 1)
          .slice(0, 1)
          .map((s) => s.name),
      ]);
    }
    const result = finalizeCharacterDraft(draft, META);
    if (!result.ok) throw new Error(JSON.stringify(result));
    return result.character;
  }

  it('Life Domain cleric gets heavy armor with a ledger entry; a non-Life cleric would not', () => {
    const cleric = finalize('Cleric', 'Hill Dwarf');
    expect(cleric.subclass?.key).toBe('subclass:life-domain');
    expect(cleric.armorProficiencies).toContain('heavy armor');
    expect(cleric.proficiencyGrants).toEqual([
      {
        sourceRef: 'feature:life-domain:bonus-proficiency',
        armor: ['heavy armor'],
      },
    ]);
    // Defective state: the class record alone does not carry heavy armor.
    const classRecord = bundled.resolveClass('Cleric');
    expect(
      classRecord.ok && classRecord.record.armorProficiencies,
    ).not.toContain('heavy armor');
  });

  it('a class with no typed grants emits no ledger; an elf keeps one Perception and no ancestry source', () => {
    const wizard = finalize('Fighter', 'High Elf');
    expect(wizard.proficiencyGrants).toBeUndefined();
    expect(
      wizard.skillProficiencies.filter((s) => s === 'Perception'),
    ).toHaveLength(1);
  });
});
