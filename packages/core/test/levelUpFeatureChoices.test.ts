// Option-catalog / list feature choices at level-up (eshyra-ug4i.3): fighting
// style, metamagic, eldritch invocations (+ growth, replacement), pact boon and
// hunter options are detected from the pack's feature choices, validated against
// the option catalog and structured prerequisites, applied, and persisted on the
// sheet's optional featureChoices. Mechanical effects of the picks are not
// implemented (DM-adjudicated). Spell selection (eshyra-ug4i.2) is covered in
// levelUpSpellSelection.test.ts; the persistence tests here run through a
// resolver that holds spell growth constant to isolate the feature-choice path.

import { describe, expect, it } from 'vitest';
import {
  applyLevelUp,
  type CharacterSheet,
  characterExpertise,
  createSqliteCharacterSheetStore,
  detectLevelUpRequiredChoices,
  getBundledDnd5eCharacterResolver,
  LevelUpRequiredChoicesError,
  listProgressionEvents,
  previewLevelUpChangeSet,
  type RulesPackCharacterResolver,
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

function buildSheet(o: {
  classKey: string;
  className: string;
  level: number;
  subclass?: { key: string; name: string };
  featureChoices?: CharacterSheet['featureChoices'];
  spells?: readonly string[];
  skills?: readonly string[];
  tools?: readonly string[];
}): CharacterSheet {
  const abilityScores = {} as CharacterSheet['abilityScores'];
  const savingThrows = {} as CharacterSheet['savingThrows'];
  for (const name of ABILITIES) {
    abilityScores[name] = { base: 10, final: 10, modifier: 0 };
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
    skillProficiencies: [...(o.skills ?? [])],
    toolProficiencies: [...(o.tools ?? [])],
    armorProficiencies: [],
    weaponProficiencies: [],
    equipment: [],
    languages: [],
    spells: [...(o.spells ?? [])],
    ...(o.featureChoices !== undefined
      ? { featureChoices: o.featureChoices }
      : {}),
    metadata: { createdAt: AT },
  };
}

const bundled = getBundledDnd5eCharacterResolver();

/**
 * Test-only resolver: caster rows keep the previous level's cantrips/spells/
 * slots so the (separately tested) spell-selection descriptors do not require
 * picks in the feature-choice path under test. invocationsKnown is left intact.
 */
function withoutSpellGrowth(baseLevel: number): RulesPackCharacterResolver {
  return {
    ...bundled,
    resolveClassLevel(classKey, level) {
      const row = bundled.resolveClassLevel(classKey, level);
      const base = bundled.resolveClassLevel(classKey, baseLevel);
      if (
        !row.ok ||
        !base.ok ||
        level < baseLevel ||
        row.record.spellcasting === undefined
      ) {
        return row;
      }
      return {
        ok: true,
        record: {
          ...row.record,
          spellcasting: {
            ...row.record.spellcasting,
            cantripsKnown: base.record.spellcasting?.cantripsKnown,
            spellsKnown: base.record.spellcasting?.spellsKnown,
            slots: base.record.spellcasting?.slots,
          },
        },
      };
    },
  };
}

const INV = (level: number) =>
  `level.${level}.feature.warlock-eldritch-invocations.eldritch-invocations`;
const PACT = 'level.3.feature.warlock-pact-boon.pact-boon';
const TOME_CANTRIPS =
  'level.3.feature.warlock-pact-boon.pact-of-the-tome-cantrips';
const BLADE = 'pact-boon:pact-of-the-blade';
const CHAIN = 'pact-boon:pact-of-the-chain';
const invocation = (slug: string) => `eldritch-invocation:${slug}`;

const warlock = (
  level: number,
  extra: Partial<Parameters<typeof buildSheet>[0]> = {},
) =>
  buildSheet({
    classKey: 'class:warlock',
    className: 'Warlock',
    level,
    ...extra,
  });

function blockerIds(sheet: CharacterSheet, choices: Record<string, string[]>) {
  const result = previewLevelUpChangeSet(sheet, { choices });
  return result.ok ? [] : result.requiredChoices.map((c) => c.id);
}
function blockerFor(
  sheet: CharacterSheet,
  choices: Record<string, string[]>,
  id: string,
) {
  const result = previewLevelUpChangeSet(sheet, { choices });
  return result.ok
    ? undefined
    : result.requiredChoices.find((c) => c.id === id);
}

const held = (
  featureRef: string,
  choiceId: string,
  optionIds: string[],
  level: number,
) => ({ featureRef, choiceId, optionIds, level });
const INV_FEATURE = 'feature:warlock:eldritch-invocations';

describe('warlock Eldritch Invocations (level 2)', () => {
  const sheet = warlock(1);

  it('emits one supported list descriptor with option names and prerequisites', () => {
    const descriptor = detectLevelUpRequiredChoices(sheet).find(
      (c) => c.id === INV(2),
    );
    expect(descriptor).toMatchObject({
      status: 'supported',
      choose: 2,
      featureRef: INV_FEATURE,
    });
    const blast = descriptor?.options?.find(
      (o) => o.id === invocation('agonizing-blast'),
    );
    expect(blast?.name).toBe('Agonizing Blast');
    expect(blast?.prerequisite).toBe('eldritch blast cantrip');
    expect(descriptor?.from).toContain(invocation('agonizing-blast'));
  });

  it('accepts prerequisite-free invocations (only the spell pick remains)', () => {
    const ids = blockerIds(sheet, {
      [INV(2)]: [invocation('armor-of-shadows'), invocation('beast-speech')],
    });
    expect(ids).not.toContain(INV(2));
    expect(ids).toContain('level.2.spells.known');
  });

  it('refuses an Eldritch Blast invocation without the cantrip and accepts it with the cantrip', () => {
    const picks = {
      [INV(2)]: [invocation('agonizing-blast'), invocation('beast-speech')],
    };
    const refused = blockerFor(sheet, picks, INV(2));
    expect(refused?.reason).toContain(invocation('agonizing-blast'));
    expect(refused?.reason).toContain('spell:eldritch-blast');
    const withCantrip = warlock(1, { spells: ['spell:eldritch-blast'] });
    expect(blockerIds(withCantrip, picks)).not.toContain(INV(2));
  });

  it('refuses a level-5 prerequisite invocation at level 2', () => {
    const refused = blockerFor(
      sheet,
      { [INV(2)]: [invocation('mire-the-mind'), invocation('beast-speech')] },
      INV(2),
    );
    expect(refused?.reason).toContain(invocation('mire-the-mind'));
  });

  it.each([
    ['too few', [invocation('beast-speech')]],
    [
      'too many',
      [
        invocation('beast-speech'),
        invocation('devils-sight'),
        invocation('eldritch-sight'),
      ],
    ],
    ['duplicate', [invocation('beast-speech'), invocation('beast-speech')]],
    ['unknown', [invocation('beast-speech'), invocation('not-a-thing')]],
    ['missing', []],
  ])('refuses %s selections, naming the descriptor', (_label, picks) => {
    const blocker = blockerFor(sheet, { [INV(2)]: picks }, INV(2));
    expect(blocker?.id).toBe(INV(2));
  });

  it('refuses an invocation requiring a pact boon that is not held', () => {
    const refused = blockerFor(
      warlock(4, {
        featureChoices: [
          held(
            INV_FEATURE,
            'eldritch-invocations',
            [invocation('beast-speech'), invocation('devils-sight')],
            2,
          ),
          held('feature:warlock:pact-boon', 'pact-boon', [BLADE], 3),
        ],
      }),
      { [INV(5)]: [invocation('voice-of-the-chain-master')] },
      INV(5),
    );
    expect(refused?.reason).toContain(CHAIN);
  });
});

describe('warlock Pact Boon, growth, and replacement', () => {
  const twoInvocations = [
    held(
      INV_FEATURE,
      'eldritch-invocations',
      [invocation('beast-speech'), invocation('devils-sight')],
      2,
    ),
  ];

  it('persists the pact boon on the sheet and in the ledger row', () => {
    const db = bareDb();
    const store = createSqliteCharacterSheetStore(db, () => AT);
    store.save('pc-1', warlock(2, { featureChoices: twoInvocations }));
    const result = applyLevelUp(db, {
      store,
      resolver: withoutSpellGrowth(2),
      choices: { [PACT]: [CHAIN] },
      ...APPLY,
    });
    expect(result.sheet.featureChoices).toEqual([
      ...twoInvocations,
      held('feature:warlock:pact-boon', 'pact-boon', [CHAIN], 3),
    ]);
    expect(store.load('pc-1')?.featureChoices).toEqual(
      result.sheet.featureChoices,
    );
    expect(result.changeSet.choicesApplied).toEqual([
      expect.objectContaining({
        id: PACT,
        featureChoice: expect.objectContaining({ optionIds: [CHAIN] }),
      }),
    ]);
    expect(listProgressionEvents(db)[0]?.appliedChanges).toMatchObject({
      choicesApplied: [{ id: PACT }],
    });
    db.close();
  });

  it('asks for Pact of the Tome cantrips (supported); Chain and Blade do not', () => {
    const sheet = warlock(2, { featureChoices: twoInvocations });
    const tome = blockerIds(sheet, {
      [PACT]: ['pact-boon:pact-of-the-tome'],
    });
    expect(tome).toContain(TOME_CANTRIPS);
    const tomeDescriptor = detectLevelUpRequiredChoices(
      sheet,
      bundled,
      undefined,
      { [PACT]: ['pact-boon:pact-of-the-tome'] },
    ).find((c) => c.id === TOME_CANTRIPS);
    expect(tomeDescriptor?.status).toBe('supported');
    for (const boon of [CHAIN, BLADE]) {
      expect(blockerIds(sheet, { [PACT]: [boon] })).not.toContain(
        TOME_CANTRIPS,
      );
      expect(
        detectLevelUpRequiredChoices(sheet, bundled, undefined, {
          [PACT]: [boon],
        }).map((c) => c.id),
      ).not.toContain(TOME_CANTRIPS);
    }
    expect(detectLevelUpRequiredChoices(sheet).map((c) => c.id)).not.toContain(
      TOME_CANTRIPS,
    );
  });

  it('detects invocation growth from the invocationsKnown column (+1 at 5)', () => {
    const sheet = warlock(4, { featureChoices: twoInvocations });
    const descriptor = detectLevelUpRequiredChoices(sheet).find(
      (c) => c.id === INV(5),
    );
    expect(descriptor).toMatchObject({ status: 'supported', choose: 1 });
    expect(descriptor?.from).not.toContain(invocation('beast-speech'));
    // No growth where the column is unchanged (level 3 keeps 2).
    expect(
      detectLevelUpRequiredChoices(
        warlock(2, { featureChoices: twoInvocations }),
      ).map((c) => c.id),
    ).not.toContain(INV(3));
  });

  it('accepts a Chain invocation once Chain is held, and a level-5 prerequisite at 5', () => {
    const sheet = warlock(4, {
      featureChoices: [
        ...twoInvocations,
        held('feature:warlock:pact-boon', 'pact-boon', [CHAIN], 3),
      ],
    });
    expect(
      blockerIds(sheet, {
        [INV(5)]: [invocation('voice-of-the-chain-master')],
      }),
    ).not.toContain(INV(5));
    expect(
      blockerIds(sheet, { [INV(5)]: [invocation('mire-the-mind')] }),
    ).not.toContain(INV(5));
    expect(
      blockerFor(sheet, { [INV(5)]: [invocation('beast-speech')] }, INV(5))
        ?.reason,
    ).toContain(invocation('beast-speech'));
  });

  it('applies growth and persists a replacement that swaps exactly one invocation', () => {
    const db = bareDb();
    const store = createSqliteCharacterSheetStore(db, () => AT);
    store.save('pc-1', warlock(4, { featureChoices: twoInvocations }));
    const result = applyLevelUp(db, {
      store,
      resolver: withoutSpellGrowth(4),
      choices: {
        [INV(5)]: [invocation('mire-the-mind')],
        [`${INV(5)}.replace`]: [
          invocation('devils-sight'),
          invocation('eldritch-sight'),
        ],
      },
      ...APPLY,
    });
    const ids = (result.sheet.featureChoices ?? []).flatMap((e) => e.optionIds);
    expect(ids).toEqual(
      expect.arrayContaining([
        invocation('beast-speech'),
        invocation('eldritch-sight'),
        invocation('mire-the-mind'),
      ]),
    );
    expect(ids).not.toContain(invocation('devils-sight'));
    expect(ids).toHaveLength(3);
    expect(result.changeSet.choicesApplied).toContainEqual(
      expect.objectContaining({
        featureChoice: expect.objectContaining({
          replaces: invocation('devils-sight'),
        }),
      }),
    );
    db.close();
  });

  it('keeps the replacement optional and refuses replacing an unheld invocation', () => {
    const sheet = warlock(4, { featureChoices: twoInvocations });
    const replace = detectLevelUpRequiredChoices(sheet).find(
      (c) => c.id === `${INV(5)}.replace`,
    );
    expect(replace).toMatchObject({ optional: true, status: 'supported' });
    expect(
      blockerIds(sheet, { [INV(5)]: [invocation('mire-the-mind')] }),
    ).not.toContain(`${INV(5)}.replace`);
    expect(
      blockerFor(
        sheet,
        {
          [INV(5)]: [invocation('mire-the-mind')],
          [`${INV(5)}.replace`]: [
            invocation('witch-sight'),
            invocation('eldritch-sight'),
          ],
        },
        `${INV(5)}.replace`,
      )?.reason,
    ).toContain('not currently held');
    // No replacement offered when nothing is held yet.
    expect(
      detectLevelUpRequiredChoices(warlock(1)).map((c) => c.id),
    ).not.toContain(`${INV(2)}.replace`);
  });

  it('refuses the same invocation as both the growth pick and the replacement', () => {
    const sheet = warlock(4, { featureChoices: twoInvocations });
    const choices = {
      [INV(5)]: [invocation('mire-the-mind')],
      [`${INV(5)}.replace`]: [
        invocation('devils-sight'),
        invocation('mire-the-mind'),
      ],
    };
    expect(blockerFor(sheet, choices, `${INV(5)}.replace`)?.reason).toContain(
      'can be taken only once',
    );
    expect(
      previewLevelUpChangeSet(sheet, { choices }).ok,
      'a duplicated invocation must block the level-up',
    ).toBe(false);
  });

  it('replacing Book of Ancient Secrets away does not trigger its rituals', () => {
    const sheet = warlock(4, {
      featureChoices: [
        held(
          'feature:warlock:pact-boon',
          'pact-boon',
          ['pact-boon:pact-of-the-tome'],
          3,
        ),
        held(
          INV_FEATURE,
          'eldritch-invocations',
          [invocation('book-of-ancient-secrets'), invocation('beast-speech')],
          2,
        ),
      ],
    });
    const ids = detectLevelUpRequiredChoices(sheet, undefined, undefined, {
      [INV(5)]: [invocation('mire-the-mind')],
      [`${INV(5)}.replace`]: [
        invocation('book-of-ancient-secrets'),
        invocation('eldritch-sight'),
      ],
    }).map((c) => c.id);
    expect(
      ids.some((id) => id.endsWith('book-of-ancient-secrets-rituals')),
    ).toBe(false);
  });

  it('Book of Ancient Secrets picked at a later level still asks for its rituals', () => {
    const sheet = warlock(4, {
      featureChoices: [
        held(
          'feature:warlock:pact-boon',
          'pact-boon',
          ['pact-boon:pact-of-the-tome'],
          3,
        ),
        ...twoInvocations,
      ],
    });
    for (const choices of [
      { [INV(5)]: [invocation('book-of-ancient-secrets')] },
      {
        [INV(5)]: [invocation('mire-the-mind')],
        [`${INV(5)}.replace`]: [
          invocation('devils-sight'),
          invocation('book-of-ancient-secrets'),
        ],
      },
    ]) {
      const rituals = detectLevelUpRequiredChoices(
        sheet,
        undefined,
        undefined,
        choices,
      ).find((c) => c.id.endsWith('book-of-ancient-secrets-rituals'));
      expect(rituals).toMatchObject({ status: 'supported', choose: 2 });
    }
  });
});

describe('sorcerer Metamagic', () => {
  const META = (level: number) =>
    `level.${level}.feature.sorcerer-metamagic.metamagic`;
  const sorcerer = (
    level: number,
    featureChoices?: CharacterSheet['featureChoices'],
  ) =>
    buildSheet({
      classKey: 'class:sorcerer',
      className: 'Sorcerer',
      level,
      ...(featureChoices !== undefined ? { featureChoices } : {}),
    });

  it('requires exactly two distinct picks at 3 and persists them', () => {
    expect(
      detectLevelUpRequiredChoices(sorcerer(2)).find((c) => c.id === META(3)),
    ).toMatchObject({ status: 'supported', choose: 2 });
    expect(
      blockerFor(
        sorcerer(2),
        { [META(3)]: ['metamagic:careful-spell'] },
        META(3),
      ),
    ).toBeDefined();
    const db = bareDb();
    const store = createSqliteCharacterSheetStore(db, () => AT);
    store.save('pc-1', sorcerer(2));
    const result = applyLevelUp(db, {
      store,
      resolver: withoutSpellGrowth(2),
      choices: {
        [META(3)]: ['metamagic:careful-spell', 'metamagic:quickened-spell'],
      },
      ...APPLY,
    });
    expect(result.sheet.featureChoices).toEqual([
      held(
        'feature:sorcerer:metamagic',
        'metamagic',
        ['metamagic:careful-spell', 'metamagic:quickened-spell'],
        3,
      ),
    ]);
    db.close();
  });

  it('grows by exactly one option at 10 and never re-offers a held one', () => {
    const sheet = sorcerer(9, [
      held(
        'feature:sorcerer:metamagic',
        'metamagic',
        ['metamagic:careful-spell', 'metamagic:quickened-spell'],
        3,
      ),
    ]);
    const descriptor = detectLevelUpRequiredChoices(sheet).find(
      (c) => c.id === META(10),
    );
    expect(descriptor).toMatchObject({ status: 'supported', choose: 1 });
    expect(descriptor?.from).not.toContain('metamagic:careful-spell');
    expect(
      blockerFor(sheet, { [META(10)]: ['metamagic:careful-spell'] }, META(10)),
    ).toBeDefined();
  });
});

describe('fighting styles', () => {
  const STYLE = (cls: string, level: number) =>
    `level.${level}.feature.${cls}-fighting-style.fighting-style`;

  it('offers paladin and ranger their own catalogs at level 2', () => {
    const paladin = detectLevelUpRequiredChoices(
      buildSheet({ classKey: 'class:paladin', className: 'Paladin', level: 1 }),
    ).find((c) => c.id === STYLE('paladin', 2));
    expect(paladin).toMatchObject({ status: 'supported', choose: 1 });
    expect(paladin?.from).toContain('fighting-style:protection');
    expect(paladin?.from).not.toContain('fighting-style:archery');
    const ranger = buildSheet({
      classKey: 'class:ranger',
      className: 'Ranger',
      level: 1,
    });
    const rangerStyle = detectLevelUpRequiredChoices(ranger).find(
      (c) => c.id === STYLE('ranger', 2),
    );
    expect(rangerStyle?.from).toContain('fighting-style:archery');
    expect(
      blockerFor(
        ranger,
        { [STYLE('ranger', 2)]: ['fighting-style:protection'] },
        STYLE('ranger', 2),
      ),
    ).toBeDefined();
    expect(
      blockerIds(ranger, { [STYLE('ranger', 2)]: ['fighting-style:archery'] }),
    ).not.toContain(STYLE('ranger', 2));
  });

  const CHAMPION =
    'level.10.feature.champion-additional-fighting-style.additional-fighting-style';
  const champion = (featureChoices?: CharacterSheet['featureChoices']) =>
    buildSheet({
      classKey: 'class:fighter',
      className: 'Fighter',
      level: 9,
      subclass: { key: 'subclass:champion', name: 'Champion' },
      ...(featureChoices !== undefined ? { featureChoices } : {}),
    });
  const fighterStyle = (id: string) =>
    held('feature:fighter:fighting-style', 'fighting-style', [id], 1);

  it('lets a champion take a second style at 10 but never repeat the first', () => {
    const sheet = champion([fighterStyle('fighting-style:defense')]);
    expect(
      blockerFor(sheet, { [CHAMPION]: ['fighting-style:defense'] }, CHAMPION),
    ).toBeDefined();
    const db = bareDb();
    const store = createSqliteCharacterSheetStore(db, () => AT);
    store.save('pc-1', sheet);
    const result = applyLevelUp(db, {
      store,
      choices: { [CHAMPION]: ['fighting-style:dueling'] },
      ...APPLY,
    });
    expect(result.sheet.featureChoices).toEqual([
      fighterStyle('fighting-style:defense'),
      held(
        'feature:champion:additional-fighting-style',
        'additional-fighting-style',
        ['fighting-style:dueling'],
        10,
      ),
    ]);
    expect(store.load('pc-1')?.level).toBe(10);
    db.close();
  });

  it('accepts any style when the level-1 style was never recorded (eshyra-nnj6)', () => {
    expect(
      blockerIds(champion(), { [CHAMPION]: ['fighting-style:defense'] }),
    ).toEqual([]);
  });

  it('blocks a champion level-up until the second style is chosen', () => {
    const db = bareDb();
    const store = createSqliteCharacterSheetStore(db, () => AT);
    store.save('pc-1', champion());
    expect(() => applyLevelUp(db, { store, ...APPLY })).toThrow(
      LevelUpRequiredChoicesError,
    );
    expect(store.load('pc-1')?.level).toBe(9);
    db.close();
  });
});

describe('hunter options and unsupported growth', () => {
  const ranger = (level: number, subclass?: { key: string; name: string }) =>
    buildSheet({
      classKey: 'class:ranger',
      className: 'Ranger',
      level,
      ...(subclass !== undefined ? { subclass } : {}),
    });
  const PREY = 'level.3.feature.hunter-hunters-prey.hunters-prey';

  it("offers Hunter's Prey only once the Hunter subclass is chosen in the same level-up", () => {
    const sheet = ranger(2);
    const subclassId = detectLevelUpRequiredChoices(sheet).find(
      (c) => c.kind === 'subclass',
    )?.id as string;
    expect(detectLevelUpRequiredChoices(sheet).map((c) => c.id)).not.toContain(
      PREY,
    );
    const withSubclass = detectLevelUpRequiredChoices(
      sheet,
      bundled,
      undefined,
      {
        [subclassId]: ['subclass:hunter'],
      },
    );
    expect(withSubclass.find((c) => c.id === PREY)).toMatchObject({
      status: 'supported',
      choose: 1,
    });
    expect(
      blockerIds(sheet, {
        [subclassId]: ['subclass:hunter'],
        [PREY]: ['hunters-prey:colossus-slayer'],
      }),
    ).not.toContain(PREY);
  });

  it('offers the level-7 Defensive Tactics choice to an existing Hunter', () => {
    const id = 'level.7.feature.hunter-defensive-tactics.defensive-tactics';
    expect(
      detectLevelUpRequiredChoices(
        ranger(6, { key: 'subclass:hunter', name: 'Hunter' }),
      ).find((c) => c.id === id),
    ).toMatchObject({ status: 'supported', choose: 1 });
  });

  it('keeps Favored Enemy / Natural Explorer growth (feature improvements) unsupported, not skipped', () => {
    const blockers = detectLevelUpRequiredChoices(ranger(5)).filter(
      (c) => c.status === 'unsupported',
    );
    expect(blockers.map((c) => c.kind)).toContain('class-feature-choice');
    expect(blockers.map((c) => c.id)).toContain(
      'level.6.feature-improvement.favored-enemy-and-natural-explorer-improvements',
    );
  });
});

describe('level-up expertise (eshyra-ug4i.1)', () => {
  const ROGUE_6 = 'level.6.feature.rogue-expertise.expertise';
  const BARD_3 = 'level.3.feature.bard-expertise.expertise';
  const BARD_10 = 'level.10.feature.bard-expertise.expertise';
  const SKILLS = ['Acrobatics', 'Stealth', 'Perception', 'Deception'];
  const rogue = (extra: Partial<Parameters<typeof buildSheet>[0]> = {}) =>
    buildSheet({
      classKey: 'class:rogue',
      className: 'Rogue',
      level: 5,
      skills: SKILLS,
      tools: ['Thieves’ tools'],
      ...extra,
    });
  const bard = (
    level: number,
    extra: Partial<Parameters<typeof buildSheet>[0]> = {},
  ) =>
    buildSheet({
      classKey: 'class:bard',
      className: 'Bard',
      level,
      skills: SKILLS,
      tools: ["Thieves' tools"],
      ...extra,
    });
  const rogueExpertise = held(
    'feature:rogue:expertise',
    'expertise',
    ['skill:Stealth', 'tool:thieves-tools'],
    1,
  );

  it('offers a rogue at 6 the held skills and thieves tools minus level-1 expertise', () => {
    const choice = detectLevelUpRequiredChoices(
      rogue({ featureChoices: [rogueExpertise] }),
    ).find((c) => c.id === ROGUE_6);
    expect(choice).toMatchObject({
      kind: 'expertise',
      status: 'supported',
      choose: 2,
      featureRef: 'feature:rogue:expertise',
      featureChoice: {
        featureRef: 'feature:rogue:expertise',
        choiceId: 'expertise',
      },
    });
    expect(choice?.from).toEqual([
      'skill:Acrobatics',
      'skill:Perception',
      'skill:Deception',
    ]);
    const fresh = detectLevelUpRequiredChoices(rogue()).find(
      (c) => c.id === ROGUE_6,
    );
    expect(fresh?.options?.map((o) => [o.id, o.name])).toContainEqual([
      'tool:thieves-tools',
      'Thieves’ tools',
    ]);
  });

  it('no longer emits the legacy unsupported expertise descriptor', () => {
    for (const choices of [
      detectLevelUpRequiredChoices(rogue()),
      detectLevelUpRequiredChoices(bard(2)),
      detectLevelUpRequiredChoices(bard(9)),
    ]) {
      expect(choices.filter((c) => c.kind === 'expertise')).toHaveLength(1);
      expect(choices.find((c) => c.kind === 'expertise')?.status).toBe(
        'supported',
      );
      expect(choices.some((c) => /^level\.\d+\.expertise$/.test(c.id))).toBe(
        false,
      );
    }
  });

  it('persists a valid rogue pick on the sheet and in the ledger row', () => {
    const db = bareDb();
    const store = createSqliteCharacterSheetStore(db, () => AT);
    store.save('pc-1', rogue({ featureChoices: [rogueExpertise] }));
    const picks = ['skill:Perception', 'skill:Deception'];
    const result = applyLevelUp(db, {
      store,
      choices: { [ROGUE_6]: picks },
      ...APPLY,
    });
    expect(result.sheet.featureChoices).toEqual([
      rogueExpertise,
      held('feature:rogue:expertise', 'expertise', picks, 6),
    ]);
    expect(store.load('pc-1')?.featureChoices).toEqual(
      result.sheet.featureChoices,
    );
    expect(listProgressionEvents(db)[0]?.appliedChanges).toMatchObject({
      choicesApplied: [
        { id: ROGUE_6, kind: 'expertise', featureChoice: { level: 6 } },
      ],
    });
    db.close();
  });

  it('refuses non-held, already-expert, duplicate and wrong-count picks with a reason', () => {
    const sheet = rogue({ featureChoices: [rogueExpertise] });
    const refused = (picks: string[]) =>
      blockerFor(sheet, { [ROGUE_6]: picks }, ROGUE_6)?.reason;
    expect(refused(['skill:Perception', 'skill:Arcana'])).toMatch(
      /'skill:Arcana' is not an eligible/,
    );
    expect(refused(['skill:Perception', 'skill:Stealth'])).toMatch(
      /'skill:Stealth' is not an eligible/,
    );
    expect(refused(['skill:Perception', 'skill:Perception'])).toMatch(
      /distinct/,
    );
    expect(refused(['skill:Perception'])).toMatch(/exactly 2/);
    expect(refused([])).toMatch(/exactly 2/);
    expect(refused(['skill:Perception', 'skill:Deception'])).toBeUndefined();
  });

  it('gives a bard first-grant expertise with skills only, even holding thieves tools', () => {
    const choice = detectLevelUpRequiredChoices(bard(2)).find(
      (c) => c.id === BARD_3,
    );
    expect(choice).toMatchObject({ status: 'supported', choose: 2 });
    expect(choice?.from).toEqual(SKILLS.map((s) => `skill:${s}`));
  });

  it('repeats at bard 10 for two more, excluding the level-3 picks', () => {
    const level3 = held(
      'feature:bard:expertise',
      'expertise',
      ['skill:Stealth', 'skill:Deception'],
      3,
    );
    const sheet = bard(9, { featureChoices: [level3] });
    const choice = detectLevelUpRequiredChoices(sheet).find(
      (c) => c.id === BARD_10,
    );
    expect(choice).toMatchObject({ status: 'supported', choose: 2 });
    expect(choice?.from).toEqual(['skill:Acrobatics', 'skill:Perception']);
    expect(characterExpertise(sheet)).toEqual(
      new Set(['skill:Stealth', 'skill:Deception']),
    );
  });

  it('fails closed, never auto-picking, when too few proficiencies are held', () => {
    const choice = detectLevelUpRequiredChoices(
      bard(2, { skills: ['Arcana'] }),
    ).find((c) => c.id === BARD_3);
    expect(choice?.status).toBe('unsupported');
    expect(choice?.unsupportedReason).toMatch(/needs 2 eligible/);
  });
});

describe('sheet featureChoices persistence', () => {
  it('loads and levels sheets that predate featureChoices without adding the field', () => {
    const db = bareDb();
    const store = createSqliteCharacterSheetStore(db, () => AT);
    store.save(
      'pc-1',
      buildSheet({ classKey: 'class:fighter', className: 'Fighter', level: 1 }),
    );
    const result = applyLevelUp(db, { store, ...APPLY });
    expect(result.sheet.featureChoices).toBeUndefined();
    expect(store.load('pc-1')?.level).toBe(2);
    db.close();
  });

  it('rejects a malformed featureChoices on save', () => {
    const db = bareDb();
    const store = createSqliteCharacterSheetStore(db, () => AT);
    const base = buildSheet({
      classKey: 'class:fighter',
      className: 'Fighter',
      level: 1,
    });
    for (const bad of [
      [
        {
          featureRef: 'not-a-feature',
          choiceId: 'x',
          optionIds: ['a'],
          level: 1,
        },
      ],
      [{ featureRef: 'feature:a:b', choiceId: 'x', optionIds: [], level: 1 }],
      [
        {
          featureRef: 'feature:a:b',
          choiceId: 'x',
          optionIds: ['a', 'a'],
          level: 1,
        },
      ],
      [
        {
          featureRef: 'feature:a:b',
          choiceId: 'x',
          optionIds: ['a'],
          level: 0,
        },
      ],
    ]) {
      expect(() =>
        store.save('pc-1', { ...base, featureChoices: bad } as CharacterSheet),
      ).toThrow(/featureChoices/);
    }
    db.close();
  });
});
