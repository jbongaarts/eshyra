// Level-up spell selection (eshyra-ug4i.2): cantrips, known spells (+ optional
// replacement), wizard spellbook growth, feature spell choices (Magical
// Secrets, Mystic Arcanum, Spell Mastery, Tome cantrips), optional preparation
// for prepared casters, and legacy flat-list classification. Runs against the
// bundled SRD pack with REAL spell growth (no resolver stubs) except where a
// test says otherwise.

import { describe, expect, it } from 'vitest';
import {
  applyLevelUp,
  type CharacterSheet,
  createSqliteCharacterSheetStore,
  deriveFeatureChoiceInstances,
  detectLevelUpRequiredChoices,
  getBundledDnd5eCharacterResolver,
  getBundledDnd5eSrdPack,
  LevelUpRequiredChoicesError,
  listProgressionEvents,
  previewLevelUpChangeSet,
  type RulesPackCharacterResolver,
  validateCharacterSheetSpellcasting,
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
const bundled = getBundledDnd5eCharacterResolver();
const allSpells = bundled.listSpells();

function buildSheet(o: {
  classKey: string;
  className: string;
  level: number;
  subclass?: { key: string; name: string };
  modifiers?: Partial<Record<(typeof ABILITIES)[number], number>>;
  spells?: readonly string[];
  spellcasting?: CharacterSheet['spellcasting'];
  featureChoices?: CharacterSheet['featureChoices'];
}): CharacterSheet {
  const abilityScores = {} as CharacterSheet['abilityScores'];
  const savingThrows = {} as CharacterSheet['savingThrows'];
  for (const name of ABILITIES) {
    const modifier = o.modifiers?.[name] ?? 0;
    abilityScores[name] = { base: 10, final: 10 + modifier * 2, modifier };
    savingThrows[name] = { modifier: 0, proficient: false };
  }
  return {
    schemaVersion: 1,
    system: 'dnd5e-srd',
    rulesPackId: 'rules:dnd5e-srd-5.1',
    recipeId: 'dnd5e-srd-character',
    creationMode: 'test',
    level: o.level,
    identity: { name: 'Test Hero' },
    class: { key: o.classKey, name: o.className },
    ...(o.subclass !== undefined ? { subclass: o.subclass } : {}),
    ancestry: { key: 'ancestry:human', name: 'Human' },
    abilityScores,
    proficiencyBonus: 2,
    maxHitPoints: 30,
    savingThrows,
    skillProficiencies: [],
    toolProficiencies: [],
    armorProficiencies: [],
    weaponProficiencies: [],
    equipment: [],
    languages: [],
    spells: [...(o.spells ?? [])],
    ...(o.spellcasting !== undefined ? { spellcasting: o.spellcasting } : {}),
    ...(o.featureChoices !== undefined
      ? { featureChoices: o.featureChoices }
      : {}),
    metadata: { createdAt: AT },
  };
}

/** The first `n` pack spells of `level` on `className`'s list (stable order). */
function spellsOf(
  className: string,
  level: number,
  n: number,
  skip: readonly string[] = [],
): string[] {
  return allSpells
    .filter(
      (s) =>
        s.level === level &&
        s.classes.includes(className) &&
        !skip.includes(s.key),
    )
    .slice(0, n)
    .map((s) => s.key);
}

function levelOf(ref: string): number {
  const spell = bundled.resolveSpell(ref);
  if (!spell.ok) throw new Error(`no spell ${ref}`);
  return spell.record.level;
}

function descriptors(
  sheet: CharacterSheet,
  choices: Record<string, string[]> = {},
  resolver: RulesPackCharacterResolver = bundled,
) {
  return detectLevelUpRequiredChoices(sheet, resolver, undefined, choices);
}

function blockers(
  sheet: CharacterSheet,
  choices: Record<string, string[]>,
  resolver: RulesPackCharacterResolver = bundled,
) {
  const result = previewLevelUpChangeSet(sheet, { choices, resolver });
  return result.ok ? [] : result.requiredChoices;
}

/** Test-only: drop features other slices still fail closed on. */
function withoutFeatures(...refs: string[]): RulesPackCharacterResolver {
  return {
    ...bundled,
    resolveClassLevel(classKey, level) {
      const row = bundled.resolveClassLevel(classKey, level);
      if (!row.ok) return row;
      return {
        ok: true,
        record: {
          ...row.record,
          featureRefs: row.record.featureRefs.filter((r) => !refs.includes(r)),
        },
      };
    },
  };
}

function apply(
  sheet: CharacterSheet,
  choices: Record<string, string[]>,
  resolver: RulesPackCharacterResolver = bundled,
) {
  const db = bareDb();
  const store = createSqliteCharacterSheetStore(db, () => AT);
  store.save('pc-1', sheet);
  const result = applyLevelUp(db, { store, resolver, choices, ...APPLY });
  return { db, store, result };
}

const idsOf = (sheet: CharacterSheet, choices: Record<string, string[]> = {}) =>
  descriptors(sheet, choices).map((d) => d.id);

describe('bard 1 -> 2 (known caster)', () => {
  const cantrips = spellsOf('Bard', 0, 2);
  const known = spellsOf('Bard', 1, 4);
  const sheet = buildSheet({
    classKey: 'class:bard',
    className: 'Bard',
    level: 1,
    modifiers: { charisma: 3 },
    spellcasting: { cantrips, known },
  });

  it('offers +1 known spell and an optional replacement, no cantrip', () => {
    const found = descriptors(sheet);
    expect(found.find((d) => d.id === 'level.2.spells.known')).toMatchObject({
      status: 'supported',
      kind: 'spell-selection',
      choose: 1,
    });
    expect(found.find((d) => d.id === 'level.2.spells.replace')).toMatchObject({
      status: 'supported',
      optional: true,
      choose: 2,
    });
    expect(found.map((d) => d.id)).not.toContain('level.2.spells.cantrips');
    expect(found.some((d) => d.status === 'unsupported')).toBe(false);
    const known1 = found.find((d) => d.id === 'level.2.spells.known');
    // Class list, castable at level 2 (1st level only), none already held.
    for (const option of known1?.options ?? []) {
      expect(option.level).toBe(1);
      expect(known).not.toContain(option.id);
    }
  });

  it('persists a new known spell and a replacement; ledger lists the changes', () => {
    const fresh = spellsOf('Bard', 1, 1, known)[0] as string;
    const replacement = spellsOf('Bard', 1, 1, [...known, fresh])[0] as string;
    const { store, result, db } = apply(sheet, {
      'level.2.spells.known': [fresh],
      'level.2.spells.replace': [known[0] as string, replacement],
    });
    const next = result.sheet.spellcasting;
    expect(next?.known).toEqual([...known.slice(1), fresh, replacement]);
    expect(next?.cantrips).toEqual(cantrips);
    expect(new Set(result.sheet.spells)).toEqual(
      new Set([...cantrips, ...(next?.known ?? [])]),
    );
    expect(store.load('pc-1')?.spellcasting).toEqual(next);
    expect(result.changeSet.spellSelections?.changes.known).toEqual({
      added: [fresh, replacement],
      removed: [known[0]],
    });
    expect(listProgressionEvents(db)[0]?.appliedChanges).toMatchObject({
      spellSelections: { changes: { known: { removed: [known[0]] } } },
    });
    db.close();
  });

  it('skipping the optional replacement is fine; the known pick is required', () => {
    const fresh = spellsOf('Bard', 1, 1, known)[0] as string;
    expect(blockers(sheet, { 'level.2.spells.known': [fresh] })).toEqual([]);
    expect(blockers(sheet, {}).map((b) => b.id)).toEqual([
      'level.2.spells.known',
    ]);
  });

  it('refuses wrong, duplicate, held, off-list, and over-level picks', () => {
    const fresh = spellsOf('Bard', 1, 1, known)[0] as string;
    const wizardOnly = allSpells.find(
      (s) => s.level === 1 && !s.classes.includes('Bard'),
    )?.key as string;
    const secondLevel = spellsOf('Bard', 2, 1)[0] as string;
    for (const pick of [
      [known[0] as string],
      [wizardOnly],
      [secondLevel],
      ['spell:not-a-spell'],
      [fresh, fresh],
      [],
    ]) {
      expect(
        blockers(sheet, { 'level.2.spells.known': pick }).map((b) => b.id),
      ).toContain('level.2.spells.known');
    }
    // Replacement: old must be a held known spell; new must not be held.
    const bad = blockers(sheet, {
      'level.2.spells.known': [fresh],
      'level.2.spells.replace': [
        fresh,
        spellsOf('Bard', 1, 1, [...known, fresh])[0] as string,
      ],
    });
    expect(bad.map((b) => b.id)).toEqual(['level.2.spells.replace']);
  });

  it('a spell cannot be learned twice by two descriptors', () => {
    const fresh = spellsOf('Bard', 1, 1, known)[0] as string;
    const result = blockers(sheet, {
      'level.2.spells.known': [fresh],
      'level.2.spells.replace': [known[0] as string, fresh],
    });
    expect(result.map((b) => b.id).sort()).toEqual([
      'level.2.spells.known',
      'level.2.spells.replace',
    ]);
    expect(result[0]?.reason).toContain('learned only once');
  });
});

describe('bard 9 -> 10 (Magical Secrets)', () => {
  const known = spellsOf('Bard', 1, 12);
  const sheet = buildSheet({
    classKey: 'class:bard',
    className: 'Bard',
    level: 9,
    spellcasting: { cantrips: spellsOf('Bard', 0, 3), known },
  });
  const SECRETS = 'level.10.feature.bard-magical-secrets.magical-secrets';

  it('Magical Secrets (any list, cantrips allowed) replaces the ordinary known picks', () => {
    const found = descriptors(sheet);
    const secrets = found.find((d) => d.id === SECRETS);
    expect(secrets).toMatchObject({
      status: 'supported',
      choose: 2,
      featureRef: 'feature:bard:magical-secrets',
    });
    // Any class list including cantrips, but no spell above the castable 5th.
    const levels = new Set(secrets?.options?.map((o) => o.level));
    expect(levels.has(0)).toBe(true);
    expect(Math.max(...(levels as Set<number>))).toBe(5);
    expect(found.map((d) => d.id)).not.toContain('level.10.spells.known');
    // The new cantrip (3 -> 4) is still asked for.
    expect(found.map((d) => d.id)).toContain('level.10.spells.cantrips');
  });

  it('refuses a 6th-level spell and accepts a cantrip + off-list spell', () => {
    const sixth = allSpells.find((s) => s.level === 6)?.key as string;
    const offList = allSpells.find(
      (s) => s.level === 3 && !s.classes.includes('Bard'),
    )?.key as string;
    const cantrip = allSpells.find(
      (s) => s.level === 0 && !s.classes.includes('Bard'),
    )?.key as string;
    const bardCantrip = spellsOf('Bard', 0, 1, sheet.spellcasting?.cantrips)[0];
    const refused = blockers(sheet, { [SECRETS]: [sixth, offList] });
    expect(refused.map((b) => b.id)).toContain(SECRETS);
    // Persist (Expertise at 10 is owned by another slice: drop it for this test).
    const { result } = apply(
      sheet,
      {
        [SECRETS]: [cantrip, offList],
        'level.10.spells.cantrips': [bardCantrip as string],
      },
      withoutFeatures('feature:bard:expertise'),
    );
    expect(result.sheet.spellcasting?.known).toContain(offList);
    // A Magical Secrets cantrip is stored with the cantrips, not the leveled list.
    expect(result.sheet.spellcasting?.cantrips).toContain(cantrip);
    expect(result.sheet.spellcasting?.known).not.toContain(cantrip);
    expect(levelOf(cantrip)).toBe(0);
  });
});

describe('sorcerer 3 -> 4', () => {
  const sheet = buildSheet({
    classKey: 'class:sorcerer',
    className: 'Sorcerer',
    level: 3,
    modifiers: { charisma: 3 },
    spellcasting: {
      cantrips: spellsOf('Sorcerer', 0, 4),
      known: spellsOf('Sorcerer', 1, 3).concat(spellsOf('Sorcerer', 2, 1)),
    },
  });
  const ASI = { 'level.4.ability-score-improvement': ['Charisma'] };

  it('+1 cantrip and +1 known; a 3rd-level spell is refused at level 4', () => {
    const found = descriptors(sheet);
    expect(found.find((d) => d.id === 'level.4.spells.cantrips')).toMatchObject(
      {
        choose: 1,
        status: 'supported',
      },
    );
    expect(found.find((d) => d.id === 'level.4.spells.known')).toMatchObject({
      choose: 1,
      status: 'supported',
    });
    const third = spellsOf('Sorcerer', 3, 1)[0] as string;
    const cantrip = spellsOf(
      'Sorcerer',
      0,
      1,
      sheet.spellcasting?.cantrips,
    )[0] as string;
    expect(
      blockers(sheet, {
        ...ASI,
        'level.4.spells.cantrips': [cantrip],
        'level.4.spells.known': [third],
      }).map((b) => b.id),
    ).toEqual(['level.4.spells.known']);
    const second = spellsOf(
      'Sorcerer',
      2,
      1,
      sheet.spellcasting?.known,
    )[0] as string;
    const { result } = apply(sheet, {
      ...ASI,
      'level.4.spells.cantrips': [cantrip],
      'level.4.spells.known': [second],
    });
    expect(result.sheet.spellcasting?.cantrips).toHaveLength(5);
    expect(result.sheet.spellcasting?.known).toHaveLength(5);
  });
});

describe('warlock', () => {
  it('2 -> 3 with Pact of the Tome: 3 any-list cantrips; Chain gets none', () => {
    const sheet = buildSheet({
      classKey: 'class:warlock',
      className: 'Warlock',
      level: 2,
      spellcasting: {
        cantrips: spellsOf('Warlock', 0, 2),
        known: spellsOf('Warlock', 1, 3),
      },
      featureChoices: [
        {
          featureRef: 'feature:warlock:eldritch-invocations',
          choiceId: 'eldritch-invocations',
          optionIds: [
            'eldritch-invocation:beast-speech',
            'eldritch-invocation:devils-sight',
          ],
          level: 2,
        },
      ],
    });
    const PACT = 'level.3.feature.warlock-pact-boon.pact-boon';
    const TOME = 'level.3.feature.warlock-pact-boon.pact-of-the-tome-cantrips';
    expect(
      idsOf(sheet, { [PACT]: ['pact-boon:pact-of-the-chain'] }),
    ).not.toContain(TOME);
    const withTome = descriptors(sheet, {
      [PACT]: ['pact-boon:pact-of-the-tome'],
    });
    const tome = withTome.find((d) => d.id === TOME);
    expect(tome).toMatchObject({ status: 'supported', choose: 3 });
    // Any class list, cantrips only.
    expect(new Set(tome?.options?.map((o) => o.level))).toEqual(new Set([0]));
    const classesCovered = new Set(
      tome?.options?.flatMap(
        (o) =>
          (bundled.resolveSpell(o.id) as { record: { classes: string[] } })
            .record.classes,
      ),
    );
    expect(classesCovered.size).toBeGreaterThan(3);
    const cantrips = (tome?.from ?? []).slice(0, 3);
    const known = spellsOf(
      'Warlock',
      1,
      1,
      sheet.spellcasting?.known,
    )[0] as string;
    const { result } = apply(sheet, {
      [PACT]: ['pact-boon:pact-of-the-tome'],
      [TOME]: [...cantrips],
      'level.3.spells.known': [known],
    });
    expect(result.sheet.spellcasting?.cantrips).toEqual(
      expect.arrayContaining(cantrips),
    );
    expect(result.sheet.spellcasting?.cantrips).toHaveLength(5);
    expect(result.sheet.featureChoices?.at(-1)?.optionIds).toEqual([
      'pact-boon:pact-of-the-tome',
    ]);
  });

  it('10 -> 11 persists the 6th-level Mystic Arcanum in mysticArcanum', () => {
    const sheet = buildSheet({
      classKey: 'class:warlock',
      className: 'Warlock',
      level: 10,
      spellcasting: {
        cantrips: spellsOf('Warlock', 0, 4),
        known: spellsOf('Warlock', 1, 2).concat(
          spellsOf('Warlock', 2, 2),
          spellsOf('Warlock', 3, 2),
          spellsOf('Warlock', 4, 2),
          spellsOf('Warlock', 5, 2),
        ),
      },
    });
    const ARCANUM = 'level.11.feature.warlock-mystic-arcanum.arcanum-6';
    const found = descriptors(sheet);
    expect(found.find((d) => d.id === ARCANUM)).toMatchObject({
      status: 'supported',
      choose: 1,
    });
    // Only the 6th-level arcanum is due at 11 (7th-9th wait for 13/15/17).
    expect(
      found.map((d) => d.id).filter((id) => id.includes('arcanum')),
    ).toEqual([ARCANUM]);
    const sixth = spellsOf('Warlock', 6, 1)[0] as string;
    const fifth = spellsOf(
      'Warlock',
      5,
      1,
      sheet.spellcasting?.known,
    )[0] as string;
    expect(
      blockers(sheet, {
        [ARCANUM]: [fifth],
        'level.11.spells.known': [fifth],
      }).map((b) => b.id),
    ).toContain(ARCANUM);
    const { result } = apply(sheet, {
      [ARCANUM]: [sixth],
      'level.11.spells.known': [fifth],
    });
    expect(result.sheet.spellcasting?.mysticArcanum).toEqual([
      { level: 6, spellRef: sixth },
    ]);
    expect(result.sheet.spells).toContain(sixth);
    expect(result.changeSet.spellSelections?.changes.mysticArcanum).toEqual({
      added: [sixth],
      removed: [],
    });
  });

  it('1 -> 5 through the real resolver persists every pick end to end', () => {
    const db = bareDb();
    const store = createSqliteCharacterSheetStore(db, () => AT);
    const cantrips = spellsOf('Warlock', 0, 2);
    const known1 = spellsOf('Warlock', 1, 2);
    store.save(
      'pc-1',
      buildSheet({
        classKey: 'class:warlock',
        className: 'Warlock',
        level: 1,
        modifiers: { charisma: 3 },
        spellcasting: { cantrips, known: known1 },
      }),
    );
    const step = (choices: Record<string, string[]>) =>
      applyLevelUp(db, { store, choices, ...APPLY });
    const INV = (n: number) =>
      `level.${n}.feature.warlock-eldritch-invocations.eldritch-invocations`;
    const lvl1 = spellsOf('Warlock', 1, 8, known1);
    step({
      [INV(2)]: [
        'eldritch-invocation:beast-speech',
        'eldritch-invocation:devils-sight',
      ],
      'level.2.spells.known': [lvl1[0] as string],
    });
    step({
      'level.3.feature.warlock-pact-boon.pact-boon': [
        'pact-boon:pact-of-the-chain',
      ],
      'level.3.spells.known': [spellsOf('Warlock', 2, 1)[0] as string],
    });
    const cantrip4 = spellsOf('Warlock', 0, 1, cantrips)[0] as string;
    step({
      'level.4.ability-score-improvement': ['Charisma'],
      'level.4.spells.cantrips': [cantrip4],
      'level.4.spells.known': [lvl1[1] as string],
    });
    const result = step({
      [INV(5)]: ['eldritch-invocation:eldritch-sight'],
      'level.5.spells.known': [spellsOf('Warlock', 3, 1)[0] as string],
    });
    const saved = store.load('pc-1');
    expect(saved?.level).toBe(5);
    expect(saved?.spellcasting?.cantrips).toEqual([...cantrips, cantrip4]);
    expect(saved?.spellcasting?.known).toHaveLength(2 + 4);
    expect(new Set(saved?.spells)).toEqual(
      new Set([
        ...(saved?.spellcasting?.cantrips ?? []),
        ...(saved?.spellcasting?.known ?? []),
      ]),
    );
    expect(result.sheet.featureChoices?.map((c) => c.choiceId)).toEqual([
      'eldritch-invocations',
      'pact-boon',
      'eldritch-invocations',
    ]);
    expect(
      listProgressionEvents(db).filter((e) => e.kind === 'level-up'),
    ).toHaveLength(4);
    db.close();
  });
});

describe('wizard', () => {
  const book = spellsOf('Wizard', 1, 6);
  const sheet1 = buildSheet({
    classKey: 'class:wizard',
    className: 'Wizard',
    level: 1,
    modifiers: { intelligence: 3 },
    spellcasting: {
      cantrips: spellsOf('Wizard', 0, 3),
      spellbook: book,
      prepared: book.slice(0, 4),
    },
  });

  it('1 -> 2: +2 spellbook spells of a castable level; 2nd level refused', () => {
    const found = descriptors(sheet1);
    expect(
      found.find((d) => d.id === 'level.2.spells.spellbook'),
    ).toMatchObject({
      status: 'supported',
      choose: 2,
    });
    const prepare = found.find((d) => d.id === 'level.2.spells.prepare');
    expect(prepare).toMatchObject({ optional: true, choose: 5 }); // INT 3 + level 2
    const SUBCLASS = { 'level.2.subclass': ['School of Evocation'] };
    const second = spellsOf('Wizard', 2, 2);
    expect(
      blockers(sheet1, { ...SUBCLASS, 'level.2.spells.spellbook': second }).map(
        (b) => b.id,
      ),
    ).toEqual(['level.2.spells.spellbook']);
    const firsts = spellsOf('Wizard', 1, 2, book);
    const { result } = apply(sheet1, {
      ...SUBCLASS,
      'level.2.spells.spellbook': firsts,
      'level.2.spells.prepare': [...book.slice(0, 3), firsts[0] as string],
    });
    expect(result.sheet.spellcasting?.spellbook).toEqual([...book, ...firsts]);
    // Preparation can use a spell added by this very level-up.
    expect(result.sheet.spellcasting?.prepared).toEqual([
      ...book.slice(0, 3),
      firsts[0],
    ]);
    // Wizard 'prepare' is limited to the formula.
    expect(
      blockers(sheet1, {
        ...SUBCLASS,
        'level.2.spells.spellbook': firsts,
        'level.2.spells.prepare': [...book, ...firsts.slice(0, 0)],
      }).map((b) => b.id),
    ).toEqual(['level.2.spells.prepare']);
  });

  it('17 -> 18: Spell Mastery chooses from the spellbook and is stored as a designation', () => {
    const first = spellsOf('Wizard', 1, 2);
    const second = spellsOf('Wizard', 2, 2);
    const third = spellsOf('Wizard', 3, 1);
    const sheet = buildSheet({
      classKey: 'class:wizard',
      className: 'Wizard',
      level: 17,
      modifiers: { intelligence: 4 },
      spellcasting: {
        cantrips: spellsOf('Wizard', 0, 5),
        spellbook: [...first, ...second, ...third],
      },
    });
    const M1 = 'level.18.feature.wizard-spell-mastery.spell-mastery-1st-level';
    const M2 = 'level.18.feature.wizard-spell-mastery.spell-mastery-2nd-level';
    const found = descriptors(sheet);
    expect(found.find((d) => d.id === M1)?.from).toEqual(first);
    expect(found.find((d) => d.id === M2)?.from).toEqual(second);
    // A spell outside the spellbook is not legal.
    const outside = spellsOf('Wizard', 1, 1, first)[0] as string;
    expect(
      blockers(sheet, {
        [M1]: [outside],
        [M2]: [second[0] as string],
        'level.18.spells.spellbook': spellsOf('Wizard', 4, 2),
      }).map((b) => b.id),
    ).toEqual([M1]);
    const { result } = apply(sheet, {
      [M1]: [first[0] as string],
      [M2]: [second[1] as string],
      'level.18.spells.spellbook': spellsOf('Wizard', 4, 2),
    });
    expect(result.sheet.spellcasting?.designations).toEqual([
      { kind: 'spell-mastery', level: 1, spellRef: first[0] },
      { kind: 'spell-mastery', level: 2, spellRef: second[1] },
    ]);
    // Designating does not move or duplicate the spellbook entries.
    expect(result.sheet.spellcasting?.spellbook).toHaveLength(5 + 2);
  });
});

describe('prepared casters are never blocked at level-up', () => {
  it('cleric 2 -> 3: new spell level, no blocker, optional preparation within the formula', () => {
    const sheet = buildSheet({
      classKey: 'class:cleric',
      className: 'Cleric',
      level: 2,
      subclass: { key: 'subclass:life-domain', name: 'Life Domain' },
      modifiers: { wisdom: 3 },
      spellcasting: {
        cantrips: spellsOf('Cleric', 0, 3),
        prepared: spellsOf('Cleric', 1, 4),
      },
    });
    const found = descriptors(sheet);
    expect(found.filter((d) => d.status === 'unsupported')).toEqual([]);
    const prepare = found.find((d) => d.id === 'level.3.spells.prepare');
    expect(prepare).toMatchObject({ optional: true, choose: 6 }); // WIS 3 + 3
    expect(
      Math.max(...(prepare?.options?.map((o) => o.level ?? 0) ?? [])),
    ).toBe(2);
    // Advances with no choices at all.
    expect(apply(sheet, {}).result.sheet.level).toBe(3);
    const chosen = [...spellsOf('Cleric', 1, 4), ...spellsOf('Cleric', 2, 2)];
    const { result } = apply(sheet, { 'level.3.spells.prepare': chosen });
    // Domain spells that were chosen are always prepared instead (eshyra-kn38).
    const domain = result.sheet.spellcasting?.alwaysPrepared ?? [];
    expect(domain).toEqual(
      expect.arrayContaining([
        'spell:lesser-restoration',
        'spell:spiritual-weapon',
      ]),
    );
    expect(result.sheet.spellcasting?.prepared).toEqual(
      chosen.filter((ref) => !domain.includes(ref)),
    );
    const over = [...chosen, spellsOf('Cleric', 2, 3)[2] as string];
    expect(
      blockers(sheet, { 'level.3.spells.prepare': over }).map((b) => b.id),
    ).toEqual(['level.3.spells.prepare']);
    // A 3rd-level spell is not castable at cleric 3.
    expect(
      blockers(sheet, {
        'level.3.spells.prepare': [spellsOf('Cleric', 3, 1)[0] as string],
      }).map((b) => b.id),
    ).toEqual(['level.3.spells.prepare']);
  });

  it('paladin 1 -> 2: spellcasting begins; prepare limit is CHA modifier + half level', () => {
    const sheet = buildSheet({
      classKey: 'class:paladin',
      className: 'Paladin',
      level: 1,
      modifiers: { charisma: 3 },
    });
    const found = descriptors(sheet);
    const prepare = found.find((d) => d.id === 'level.2.spells.prepare');
    expect(prepare).toMatchObject({ optional: true, choose: 4 }); // 3 + floor(2/2)
    const style = found.find((d) => d.kind === 'fighting-style');
    expect(style?.status).toBe('supported');
    const spells = spellsOf('Paladin', 1, 5);
    const FS = { [style?.id as string]: [style?.from?.[0] as string] };
    expect(
      blockers(sheet, { ...FS, 'level.2.spells.prepare': spells }).map(
        (b) => b.id,
      ),
    ).toEqual(['level.2.spells.prepare']);
    const { result } = apply(sheet, {
      ...FS,
      'level.2.spells.prepare': spells.slice(0, 4),
    });
    expect(result.sheet.spellcasting).toEqual({
      cantrips: [],
      prepared: spells.slice(0, 4),
    });
    expect(result.sheet.spells).toEqual(spells.slice(0, 4));
  });

  it('the prepare limit follows an Ability Score Improvement taken in the same level-up', () => {
    const sheet = buildSheet({
      classKey: 'class:cleric',
      className: 'Cleric',
      level: 3,
      subclass: { key: 'subclass:life-domain', name: 'Life Domain' },
      modifiers: { wisdom: 3 }, // score 16
      spellcasting: { cantrips: spellsOf('Cleric', 0, 3), prepared: [] },
    });
    const without = descriptors(sheet).find(
      (d) => d.id === 'level.4.spells.prepare',
    );
    const withAsi = descriptors(sheet, {
      'level.4.ability-score-improvement': ['Wisdom'],
    }).find((d) => d.id === 'level.4.spells.prepare');
    expect(without?.choose).toBe(3 + 4);
    expect(withAsi?.choose).toBe(4 + 4); // 18 WIS => +4
  });
});

describe('ranger 1 -> 2', () => {
  it('learns 2 spells (spells known 0 -> 2); no replacement yet', () => {
    const sheet = buildSheet({
      classKey: 'class:ranger',
      className: 'Ranger',
      level: 1,
      modifiers: { wisdom: 3 },
    });
    const found = descriptors(sheet);
    expect(found.find((d) => d.id === 'level.2.spells.known')).toMatchObject({
      status: 'supported',
      choose: 2,
    });
    expect(found.map((d) => d.id)).not.toContain('level.2.spells.replace');
  });
});

describe('legacy flat spell lists', () => {
  it('classifies a legacy sheet at its first level-up, then levels it', () => {
    const legacy = buildSheet({
      classKey: 'class:sorcerer',
      className: 'Sorcerer',
      level: 1,
      modifiers: { charisma: 3 },
      spells: [
        'Fire Bolt', // by display name
        'spell:light',
        'Mage Hand',
        'spell:prestidigitation',
        'spell:magic-missile',
        'Shield',
      ],
    });
    const fresh = spellsOf('Sorcerer', 1, 1, [
      'spell:magic-missile',
      'spell:shield',
    ])[0] as string;
    const { result } = apply(legacy, { 'level.2.spells.known': [fresh] });
    expect(result.sheet.spellcasting).toEqual({
      cantrips: [
        'spell:fire-bolt',
        'spell:light',
        'spell:mage-hand',
        'spell:prestidigitation',
      ],
      known: ['spell:magic-missile', 'spell:shield', fresh],
    });
    expect(result.sheet.spells).toEqual([
      'spell:fire-bolt',
      'spell:light',
      'spell:mage-hand',
      'spell:prestidigitation',
      'spell:magic-missile',
      'spell:shield',
      fresh,
    ]);
    expect(result.changeSet.spellSelections?.classifiedFromLegacy).toBe(true);
  });

  it('classifies wizard leveled spells as spellbook and cleric as prepared', () => {
    const wizard = buildSheet({
      classKey: 'class:wizard',
      className: 'Wizard',
      level: 1,
      spells: ['spell:fire-bolt', 'spell:magic-missile', 'spell:shield'],
    });
    const { result } = apply(wizard, {
      'level.2.subclass': ['School of Evocation'],
      'level.2.spells.spellbook': spellsOf('Wizard', 1, 2, [
        'spell:magic-missile',
        'spell:shield',
      ]),
    });
    expect(result.sheet.spellcasting?.spellbook).toEqual(
      expect.arrayContaining(['spell:magic-missile', 'spell:shield']),
    );
    expect(result.sheet.spellcasting?.prepared).toBeUndefined();
    const cleric = buildSheet({
      classKey: 'class:cleric',
      className: 'Cleric',
      level: 2,
      subclass: { key: 'subclass:life-domain', name: 'Life Domain' },
      spells: ['spell:sacred-flame', 'spell:bless'],
    });
    expect(apply(cleric, {}).result.sheet.spellcasting).toEqual({
      cantrips: ['spell:sacred-flame'],
      prepared: [],
      alwaysPrepared: [
        'spell:bless',
        'spell:cure-wounds',
        'spell:lesser-restoration',
        'spell:spiritual-weapon',
      ],
    });
  });

  it('refuses the level-up naming an entry that does not resolve', () => {
    const legacy = buildSheet({
      classKey: 'class:sorcerer',
      className: 'Sorcerer',
      level: 1,
      spells: ['Fire Bolt', 'Flarble the Unreal'],
    });
    const found = descriptors(legacy);
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({
      id: 'level.2.spells.legacy-classification',
      status: 'unsupported',
    });
    expect(found[0]?.reason).toContain('Flarble the Unreal');
    const db = bareDb();
    const store = createSqliteCharacterSheetStore(db, () => AT);
    store.save('pc-1', legacy);
    expect(() => applyLevelUp(db, { store, ...APPLY })).toThrow(
      LevelUpRequiredChoicesError,
    );
    expect(store.load('pc-1')?.level).toBe(1);
    db.close();
  });

  it('non-casters and spell-less casters get no spellcasting field', () => {
    const db = bareDb();
    const store = createSqliteCharacterSheetStore(db, () => AT);
    store.save(
      'pc-1',
      buildSheet({ classKey: 'class:fighter', className: 'Fighter', level: 1 }),
    );
    const result = applyLevelUp(db, { store, ...APPLY });
    expect(result.sheet.spellcasting).toBeUndefined();
    db.close();
  });
});

describe('sheet spellcasting validation', () => {
  const base = buildSheet({
    classKey: 'class:wizard',
    className: 'Wizard',
    level: 1,
  });
  const withSc = (spellcasting: unknown) =>
    ({ ...base, spellcasting }) as unknown as CharacterSheet;

  it('accepts a well-formed field and old sheets without it', () => {
    expect(() => validateCharacterSheetSpellcasting(base)).not.toThrow();
    expect(() =>
      validateCharacterSheetSpellcasting(
        withSc({ cantrips: ['spell:light'], known: ['spell:bless'] }),
      ),
    ).not.toThrow();
  });

  it.each([
    ['not an object', 'x'],
    ['no cantrips', { known: [] }],
    ['non-ref entry', { cantrips: ['Light'] }],
    ['duplicate in a bucket', { cantrips: ['spell:light', 'spell:light'] }],
    [
      'ref in two buckets',
      { cantrips: ['spell:light'], known: ['spell:light'] },
    ],
    [
      'bad arcanum level',
      { cantrips: [], mysticArcanum: [{ level: 12, spellRef: 'spell:wish' }] },
    ],
    [
      'bad designation',
      {
        cantrips: [],
        designations: [{ kind: 'x', level: 1, spellRef: 'spell:bless' }],
      },
    ],
  ])('rejects %s', (_label, value) => {
    expect(() => validateCharacterSheetSpellcasting(withSc(value))).toThrow();
  });

  it('rejects a ref that is not a canonical pack spell when a resolver is supplied', () => {
    const resolve = (ref: string) => {
      const r = bundled.resolveSpell(ref);
      return r.ok ? r.record.key : undefined;
    };
    expect(() =>
      validateCharacterSheetSpellcasting(
        withSc({ cantrips: ['spell:nope'] }),
        resolve,
      ),
    ).toThrow(/canonical/);
  });
});

describe('fail closed', () => {
  it('Bonus Cantrip is a supported druid-cantrip choice, no longer an unmodeled grant (eshyra-91o0)', () => {
    const sheet = buildSheet({
      classKey: 'class:druid',
      className: 'Druid',
      level: 1,
      modifiers: { wisdom: 2 },
      spellcasting: { cantrips: spellsOf('Druid', 0, 2), prepared: [] },
    });
    const found = descriptors(sheet, {
      'level.2.subclass': ['Circle of the Land'],
    });
    const bonus = found.find(
      (d) => d.featureRef === 'feature:circle-of-the-land:bonus-cantrip',
    );
    expect(bonus).toMatchObject({ status: 'supported', choose: 1 });
    expect(bonus?.spellChoice).toBeDefined();
  });

  it('a feature spell choice the pack marks unsupported stays an unsupported descriptor', () => {
    const resolver: RulesPackCharacterResolver = {
      ...bundled,
      listFeatures: () =>
        bundled.listFeatures().map((feature) =>
          feature.key === 'feature:circle-of-the-land:bonus-cantrip'
            ? {
                ...feature,
                choices: feature.choices?.map((choice) => ({
                  id: choice.id,
                  category: choice.category,
                  prompt: choice.prompt,
                  level: choice.level,
                  unsupported: { reason: 'synthetic' },
                })),
              }
            : feature,
        ),
    };
    const sheet = buildSheet({
      classKey: 'class:druid',
      className: 'Druid',
      level: 1,
      modifiers: { wisdom: 2 },
      spellcasting: { cantrips: spellsOf('Druid', 0, 2), prepared: [] },
    });
    const found = descriptors(
      sheet,
      { 'level.2.subclass': ['Circle of the Land'] },
      resolver,
    );
    expect(
      found.filter(
        (d) => d.featureRef === 'feature:circle-of-the-land:bonus-cantrip',
      ),
    ).not.toHaveLength(0);
    expect(
      found
        .filter(
          (d) => d.featureRef === 'feature:circle-of-the-land:bonus-cantrip',
        )
        .every((d) => d.status === 'unsupported'),
    ).toBe(true);
  });

  it('an unknown spell filter key makes the descriptor unsupported, naming the key', () => {
    const resolver: RulesPackCharacterResolver = {
      ...bundled,
      listFeatures: () =>
        bundled.listFeatures().map((feature) =>
          feature.key === 'feature:sorcerer:spellcasting'
            ? {
                ...feature,
                choices: feature.choices?.map((choice) =>
                  choice.id === 'spells'
                    ? {
                        ...choice,
                        from: {
                          ...(choice.from as object),
                          mustBeFrobbed: true,
                        },
                      }
                    : choice,
                ),
              }
            : feature,
        ),
    };
    const sheet = buildSheet({
      classKey: 'class:sorcerer',
      className: 'Sorcerer',
      level: 1,
      spellcasting: {
        cantrips: spellsOf('Sorcerer', 0, 4),
        known: spellsOf('Sorcerer', 1, 2),
      },
    });
    const known = descriptors(sheet, {}, resolver).find(
      (d) => d.id === 'level.2.spells.known',
    );
    expect(known?.status).toBe('unsupported');
    expect(known?.unsupportedReason).toContain('mustBeFrobbed');
  });
});

// ---------------------------------------------------------------------------
// Generalized invariant: nothing spell-related at a target level is dropped.
// ---------------------------------------------------------------------------

describe('every spell-related need at every caster level has a descriptor', () => {
  const pack = getBundledDnd5eSrdPack();
  const featureRecords = pack.records.filter((r) => r.kind === 'feature');
  const subclasses = bundled.listSubclasses();
  const everyDue = new Set<string>();

  for (const cls of bundled.listClasses()) {
    it(`${cls.name}: levels 1->2 .. 19->20`, () => {
      const slug = cls.key.replace(/^class:/, '');
      const options: (typeof subclasses)[number][] = subclasses.filter(
        (s) => s.parentClass === cls.key,
      );
      for (let to = 2; to <= 20; to += 1) {
        for (const subclass of [undefined, ...options]) {
          const sheet = buildSheet({
            classKey: cls.key,
            className: cls.name,
            level: to - 1,
            ...(subclass !== undefined
              ? { subclass: { key: subclass.key, name: subclass.name } }
              : {}),
          });
          const ids = new Set(descriptors(sheet).map((d) => d.id));
          const where = `${cls.key} ${to - 1}->${to} ${subclass?.key ?? ''}`;

          // 1. Feature spell/cantrip choices due at the target level, derived
          //    independently from the pack's repeated-choice instantiation.
          const due: string[] = [];
          for (const record of featureRecords) {
            if (record.key === `feature:${slug}:spellcasting`) continue;
            if (record.key === `feature:${slug}:pact-magic`) continue;
            for (const instance of deriveFeatureChoiceInstances(pack, record)) {
              const category = instance.choice.category;
              if (category !== 'spell' && category !== 'cantrip') continue;
              if (instance.grantLevel !== to) continue;
              const from = instance.choice.from as
                | Record<string, unknown>
                | undefined;
              if (from?.requiresFeatureOption !== undefined) continue;
              if (!record.key.startsWith(`feature:${slug}:`)) continue;
              due.push(
                `level.${to}.feature.${record.key.replace(/^feature:/, '').replace(/:/g, '-')}.${instance.choiceId}`,
              );
            }
          }
          // Subclass spell choices at the subclass feature's own level.
          if (subclass !== undefined) {
            for (const featureRef of subclass.features) {
              const feature = bundled
                .listFeatures()
                .find((f) => f.key === featureRef);
              for (const choice of feature?.choices ?? []) {
                if (
                  (choice.category === 'spell' ||
                    choice.category === 'cantrip') &&
                  choice.level === to
                ) {
                  due.push(
                    `level.${to}.feature.${featureRef.replace(/^feature:/, '').replace(/:/g, '-')}.${choice.id}`,
                  );
                }
              }
            }
          }
          for (const id of due) {
            everyDue.add(id);
            expect(ids, `${where}: missing ${id}`).toContain(id);
          }

          // 2. Capacity growth.
          const fromRow = bundled.resolveClassLevel(cls.key, to - 1);
          const toRow = bundled.resolveClassLevel(cls.key, to);
          const fromSc = fromRow.ok ? fromRow.record.spellcasting : undefined;
          const toSc = toRow.ok ? toRow.record.spellcasting : undefined;
          if (toSc === undefined) continue;
          if ((toSc.cantripsKnown ?? 0) > (fromSc?.cantripsKnown ?? 0)) {
            expect(ids, `${where}: cantrips`).toContain(
              `level.${to}.spells.cantrips`,
            );
          }
          const knownGrowth =
            (toSc.spellsKnown ?? 0) - (fromSc?.spellsKnown ?? 0);
          if (cls.spellPreparation?.kind === 'known' && knownGrowth > 0) {
            // Feature picks that count against spells known (Magical Secrets)
            // account for the whole growth; otherwise the known descriptor exists.
            const secrets = [...ids].filter((id) =>
              id.startsWith(`level.${to}.feature.bard-magical-secrets.`),
            );
            expect(
              ids.has(`level.${to}.spells.known`) || secrets.length > 0,
              `${where}: spells known`,
            ).toBe(true);
          }
          if (cls.spellPreparation?.spellbookStartingSpells !== undefined) {
            expect(ids, `${where}: spellbook`).toContain(
              `level.${to}.spells.spellbook`,
            );
          }
          if (cls.spellPreparation?.kind === 'prepared') {
            expect(ids, `${where}: prepare`).toContain(
              `level.${to}.spells.prepare`,
            );
          }
        }
      }
    });
  }

  it('the pack-derived expectations were not vacuous', () => {
    const prefixes = [
      'feature.bard-magical-secrets.',
      'feature.college-of-lore-additional-magical-secrets.',
      'feature.warlock-mystic-arcanum.',
      'feature.wizard-spell-mastery.',
      'feature.wizard-signature-spells.',
    ];
    for (const prefix of prefixes) {
      expect(
        [...everyDue].some((id) => id.includes(prefix)),
        prefix,
      ).toBe(true);
    }
  });
});

describe('always-prepared refresh at level-up (eshyra-kn38)', () => {
  it('cleric 2 -> 3 adds the level-3 domain spells with no spell choice; ledger records the delta', () => {
    const sheet = buildSheet({
      classKey: 'class:cleric',
      className: 'Cleric',
      level: 2,
      subclass: { key: 'subclass:life-domain', name: 'Life Domain' },
      spellcasting: {
        cantrips: spellsOf('Cleric', 0, 3),
        prepared: ['spell:bless', ...spellsOf('Cleric', 1, 2, ['spell:bless'])],
        alwaysPrepared: ['spell:bless', 'spell:cure-wounds'],
      },
    });
    const { db, result } = apply(sheet, {});
    const always = result.sheet.spellcasting?.alwaysPrepared;
    expect(always).toEqual([
      'spell:bless',
      'spell:cure-wounds',
      'spell:lesser-restoration',
      'spell:spiritual-weapon',
    ]);
    expect(result.sheet.spells).toEqual(
      expect.arrayContaining(always as string[]),
    );
    expect(result.sheet.spellcasting?.prepared).not.toContain('spell:bless');
    expect(listProgressionEvents(db)[0]?.appliedChanges).toMatchObject({
      alwaysPrepared: {
        from: ['spell:bless', 'spell:cure-wounds'],
        to: always,
      },
      preparedRemoved: ['spell:bless'],
    });
  });

  it('paladin choosing Oath of Devotion at 2 -> 3 gets its oath spells in the same level-up', () => {
    const sheet = buildSheet({
      classKey: 'class:paladin',
      className: 'Paladin',
      level: 2,
      modifiers: { charisma: 3 },
      spellcasting: { cantrips: [], prepared: [] },
    });
    const { result } = apply(sheet, {
      'level.3.subclass': ['Oath of Devotion'],
    });
    expect(result.sheet.subclass?.key).toBe('subclass:oath-of-devotion');
    expect(result.sheet.spellcasting?.alwaysPrepared).toEqual([
      'spell:protection-from-evil-and-good',
      'spell:sanctuary',
    ]);
  });

  it('a Fiend warlock level-up never gains always-prepared spells', () => {
    const sheet = buildSheet({
      classKey: 'class:warlock',
      className: 'Warlock',
      level: 2,
      subclass: { key: 'subclass:the-fiend', name: 'The Fiend' },
      spellcasting: {
        cantrips: spellsOf('Warlock', 0, 2),
        known: spellsOf('Warlock', 1, 3),
      },
    });
    const preview = previewLevelUpChangeSet(sheet, {
      choices: {
        'level.3.feature.warlock-pact-boon.pact-boon': [
          'pact-boon:pact-of-the-blade',
        ],
        'level.3.spells.known': ['spell:darkness'],
      },
      resolver: bundled,
    });
    expect(preview.ok).toBe(true);
    const changeSet = preview.ok ? preview.changeSet : undefined;
    expect(changeSet?.alwaysPrepared).toBeUndefined();
    expect(
      changeSet?.spellSelections?.resulting.alwaysPrepared,
    ).toBeUndefined();
  });

  it('Circle of the Land without a land pick levels up with no circle spells', () => {
    const sheet = buildSheet({
      classKey: 'class:druid',
      className: 'Druid',
      level: 4,
      subclass: {
        key: 'subclass:circle-of-the-land',
        name: 'Circle of the Land',
      },
      modifiers: { wisdom: 3 },
      spellcasting: {
        cantrips: spellsOf('Druid', 0, 2),
        prepared: spellsOf('Druid', 1, 3),
      },
    });
    const { result } = apply(sheet, {});
    expect(result.sheet.level).toBe(5);
    expect(result.sheet.spellcasting?.alwaysPrepared).toBeUndefined();
  });
});

describe('prepared and always-prepared stay disjoint; ledger matches the sheet (eshyra-kn38 review S1/S2)', () => {
  const lifeCleric1 = () =>
    buildSheet({
      classKey: 'class:cleric',
      className: 'Cleric',
      level: 1,
      modifiers: { wisdom: 3 },
      subclass: { key: 'subclass:life-domain', name: 'Life Domain' },
      spellcasting: {
        cantrips: spellsOf('Cleric', 0, 3),
        prepared: ['spell:bane'],
        alwaysPrepared: ['spell:bless', 'spell:cure-wounds'],
      },
    });

  it('an always-prepared pick is not kept in prepared when the grant list is unchanged', () => {
    const { db, result } = apply(lifeCleric1(), {
      'level.2.spells.prepare': ['spell:bless', 'spell:bane'],
    });
    const sc = result.sheet.spellcasting;
    expect(sc?.alwaysPrepared).toEqual(['spell:bless', 'spell:cure-wounds']);
    expect(sc?.prepared).toEqual(['spell:bane']);
    const event = listProgressionEvents(db)[0]?.appliedChanges as {
      spellSelections?: { resulting: unknown };
      preparedRemoved?: string[];
      alwaysPrepared?: unknown;
    };
    expect(event.alwaysPrepared).toBeUndefined();
    expect(event.preparedRemoved).toEqual(['spell:bless']);
    expect(event.spellSelections?.resulting).toEqual(sc);
  });

  it('a legacy flat list classified at level-up records the same spellcasting it persists', () => {
    const sheet = buildSheet({
      classKey: 'class:cleric',
      className: 'Cleric',
      level: 2,
      modifiers: { wisdom: 3 },
      subclass: { key: 'subclass:life-domain', name: 'Life Domain' },
      spells: ['spell:sacred-flame', 'spell:bless', 'spell:bane'],
    });
    const { db, result } = apply(sheet, {});
    const sc = result.sheet.spellcasting;
    expect(sc?.prepared).toEqual(['spell:bane']);
    expect(sc?.alwaysPrepared).toContain('spell:bless');
    const event = listProgressionEvents(db)[0]?.appliedChanges as {
      spellSelections?: { resulting: unknown };
    };
    expect(event.spellSelections?.resulting).toEqual(sc);
    expect(result.changeSet.spellSelections?.resulting).toEqual(sc);
  });
});
