// Subclass-granted build choices at level-up (eshyra-91o0): Circle of the Land
// Bonus Cantrip (druid cantrip) and Circle Spells (land), College of Lore Bonus
// Proficiencies (three skills), the pack-side Dragon Ancestor choice, and the
// generalized coverage invariant that keeps any pack-modeled choice from being
// silently skipped. Always-prepared circle spells are eshyra-odpc; level-1
// choice collection at creation is eshyra-nnj6.

import { describe, expect, it } from 'vitest';
import {
  applyLevelUp,
  type CharacterSheet,
  createSqliteCharacterSheetStore,
  detectLevelUpRequiredChoices,
  getBundledDnd5eCharacterResolver,
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
const bundled = getBundledDnd5eCharacterResolver();
const allSpells = bundled.listSpells();

function buildSheet(o: {
  classKey: string;
  className: string;
  level: number;
  subclass?: { key: string; name: string };
  skills?: readonly string[];
  spellcasting?: CharacterSheet['spellcasting'];
  featureChoices?: CharacterSheet['featureChoices'];
}): CharacterSheet {
  const abilityScores = {} as CharacterSheet['abilityScores'];
  const savingThrows = {} as CharacterSheet['savingThrows'];
  for (const name of ABILITIES) {
    abilityScores[name] = { base: 14, final: 14, modifier: 2 };
    savingThrows[name] = { modifier: 0, proficient: false };
  }
  const sc = o.spellcasting;
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
    toolProficiencies: [],
    armorProficiencies: [],
    weaponProficiencies: [],
    equipment: [],
    languages: [],
    spells: [
      ...(sc?.cantrips ?? []),
      ...(sc?.known ?? []),
      ...(sc?.prepared ?? []),
    ],
    ...(sc !== undefined ? { spellcasting: sc } : {}),
    ...(o.featureChoices !== undefined
      ? { featureChoices: o.featureChoices }
      : {}),
    metadata: { createdAt: AT },
  };
}

function spellsOf(className: string, level: number, n: number): string[] {
  return allSpells
    .filter((s) => s.level === level && s.classes.includes(className))
    .slice(0, n)
    .map((s) => s.key);
}

/** Holds class spell growth constant so only the feature-choice path is under test. */
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

const LAND = 'level.3.feature.circle-of-the-land-circle-spells.land';
const CANTRIP =
  'level.2.feature.circle-of-the-land-bonus-cantrip.bonus-cantrip';
const SKILLS = 'level.3.feature.college-of-lore-bonus-proficiencies.skills';
const EXPERTISE = 'level.3.feature.bard-expertise.expertise';
const LORE = { key: 'subclass:college-of-lore', name: 'College of Lore' };
const LAND_SUBCLASS = {
  key: 'subclass:circle-of-the-land',
  name: 'Circle of the Land',
};

const landDruid = (level: number, cantrips = 2) =>
  buildSheet({
    classKey: 'class:druid',
    className: 'Druid',
    level,
    ...(level >= 2 ? { subclass: LAND_SUBCLASS } : {}),
    spellcasting: { cantrips: spellsOf('Druid', 0, cantrips), prepared: [] },
  });

const loreBard = (skills: readonly string[] = ['Insight', 'Stealth']) =>
  buildSheet({
    classKey: 'class:bard',
    className: 'Bard',
    level: 2,
    skills,
    spellcasting: {
      cantrips: spellsOf('Bard', 0, 2),
      known: spellsOf('Bard', 1, 5),
    },
  });

describe('Circle of the Land Bonus Cantrip (level 2)', () => {
  it('is a SUPPORTED druid cantrip choice that a Land druid can apply on 1 -> 2', () => {
    const sheet = landDruid(1);
    const found = detectLevelUpRequiredChoices(sheet, bundled, undefined, {
      'level.2.subclass': ['Circle of the Land'],
    });
    const bonus = found.find((d) => d.id === CANTRIP);
    expect(bonus).toMatchObject({ status: 'supported', choose: 1 });
    // The unmodeled-spell-grant fallback is gone: nothing unsupported remains.
    expect(found.filter((d) => d.status === 'unsupported')).toEqual([]);

    const cantrip = spellsOf('Druid', 0, 5).find(
      (key) => !(sheet.spellcasting?.cantrips ?? []).includes(key),
    ) as string;
    const db = bareDb();
    const store = createSqliteCharacterSheetStore(db, () => AT);
    store.save('pc-1', sheet);
    const result = applyLevelUp(db, {
      store,
      choices: {
        'level.2.subclass': ['Circle of the Land'],
        [CANTRIP]: [cantrip],
      },
      ...APPLY,
    });
    expect(result.sheet.level).toBe(2);
    expect(result.sheet.spellcasting?.cantrips).toContain(cantrip);
    expect(result.sheet.spells).toContain(cantrip);
    db.close();
  });

  it('refuses an applied level-up that leaves the cantrip unchosen', () => {
    const result = previewLevelUpChangeSet(landDruid(1), {
      choices: { 'level.2.subclass': ['Circle of the Land'] },
    });
    expect(result.ok).toBe(false);
    expect(
      result.ok ? [] : result.requiredChoices.map((choice) => choice.id),
    ).toContain(CANTRIP);
  });
});

describe('Circle of the Land Circle Spells (level 3 land)', () => {
  const sheet = landDruid(2, 3);
  const resolver = withoutSpellGrowth(2);

  it('offers the seven SRD lands as a supported list choice with table text', () => {
    const land = detectLevelUpRequiredChoices(
      sheet,
      resolver,
      undefined,
      {},
    ).find((d) => d.id === LAND);
    expect(land).toMatchObject({ status: 'supported', choose: 1 });
    expect(land?.from).toEqual([
      'land:arctic',
      'land:coast',
      'land:desert',
      'land:forest',
      'land:grassland',
      'land:mountain',
      'land:swamp',
    ]);
  });

  it('blocks until a land is chosen, then persists it on featureChoices and the ledger row', () => {
    const blocked = previewLevelUpChangeSet(sheet, { resolver, choices: {} });
    expect(blocked.ok).toBe(false);
    expect(
      blocked.ok ? [] : blocked.requiredChoices.map((choice) => choice.id),
    ).toContain(LAND);

    const bad = previewLevelUpChangeSet(sheet, {
      resolver,
      choices: { [LAND]: ['land:atlantis'] },
    });
    expect(bad.ok).toBe(false);

    const db = bareDb();
    const store = createSqliteCharacterSheetStore(db, () => AT);
    store.save('pc-1', sheet);
    const result = applyLevelUp(db, {
      store,
      resolver,
      choices: { [LAND]: ['land:desert'] },
      ...APPLY,
    });
    expect(result.sheet.featureChoices).toEqual([
      {
        featureRef: 'feature:circle-of-the-land:circle-spells',
        choiceId: 'land',
        optionIds: ['land:desert'],
        level: 3,
      },
    ]);
    expect(store.load('pc-1')?.featureChoices).toEqual(
      result.sheet.featureChoices,
    );
    expect(listProgressionEvents(db)[0]?.appliedChanges).toMatchObject({
      choicesApplied: [{ id: LAND }],
    });
    db.close();
  });
});

describe('College of Lore Bonus Proficiencies (level 3 skills)', () => {
  // Spell growth is held constant so only the skill/expertise interaction is
  // under test; the REAL bard level-3 row (with Expertise) is otherwise used.
  const resolver: RulesPackCharacterResolver = withoutSpellGrowth(2);
  const base = { 'level.3.subclass': ['College of Lore'] };

  it('offers three skills excluding held proficiencies', () => {
    const skills = detectLevelUpRequiredChoices(
      loreBard(),
      resolver,
      undefined,
      base,
    ).find((d) => d.id === SKILLS);
    expect(skills).toMatchObject({ status: 'supported', choose: 3 });
    expect(skills?.from).not.toContain('Insight');
    expect(skills?.from).not.toContain('Stealth');
    expect(skills?.from).toContain('Arcana');
  });

  it('appends the three skills to skillProficiencies and records a featureChoices entry and ledger row', () => {
    const db = bareDb();
    const store = createSqliteCharacterSheetStore(db, () => AT);
    store.save('pc-1', loreBard());
    const result = applyLevelUp(db, {
      store,
      resolver,
      choices: {
        ...base,
        [SKILLS]: ['Arcana', 'History', 'Persuasion'],
        [EXPERTISE]: ['skill:Insight', 'skill:Stealth'],
      },
      ...APPLY,
    });
    expect(result.sheet.subclass).toEqual(LORE);
    expect(result.sheet.skillProficiencies).toEqual([
      'Insight',
      'Stealth',
      'Arcana',
      'History',
      'Persuasion',
    ]);
    expect(result.sheet.featureChoices).toEqual(
      expect.arrayContaining([
        {
          featureRef: 'feature:college-of-lore:bonus-proficiencies',
          choiceId: 'skills',
          optionIds: ['Arcana', 'History', 'Persuasion'],
          level: 3,
        },
      ]),
    );
    expect(store.load('pc-1')?.skillProficiencies).toEqual(
      result.sheet.skillProficiencies,
    );
    expect(listProgressionEvents(db)[0]?.appliedChanges).toMatchObject({
      choicesApplied: expect.arrayContaining([
        expect.objectContaining({
          id: SKILLS,
          skillProficiencies: ['Arcana', 'History', 'Persuasion'],
        }),
      ]),
    });
    db.close();
  });

  it.each([
    ['too few', ['Arcana', 'History']],
    ['too many', ['Arcana', 'History', 'Persuasion', 'Nature']],
    ['a held skill', ['Insight', 'History', 'Persuasion']],
    ['a duplicate', ['Arcana', 'Arcana', 'History']],
    ['a non-skill', ['Arcana', 'History', 'Basketweaving']],
  ])('refuses %s', (_label, picked) => {
    const result = previewLevelUpChangeSet(loreBard(), {
      resolver,
      choices: { ...base, [SKILLS]: picked },
    });
    expect(result.ok).toBe(false);
    const blocker = result.ok
      ? undefined
      : result.requiredChoices.find((choice) => choice.id === SKILLS);
    expect(blocker?.reason).toContain('selection refused');
  });

  describe('same-level Expertise on newly picked Lore skills', () => {
    const lore = ['Arcana', 'History', 'Persuasion'];
    const expertiseOptions = (picked: readonly string[]) =>
      detectLevelUpRequiredChoices(loreBard(), resolver, undefined, {
        ...base,
        [SKILLS]: picked,
      }).find((d) => d.id === EXPERTISE)?.from;

    it('makes a validly picked Lore skill eligible for Expertise in the same step', () => {
      const db = bareDb();
      const store = createSqliteCharacterSheetStore(db, () => AT);
      store.save('pc-1', loreBard());
      const result = applyLevelUp(db, {
        store,
        resolver,
        choices: {
          ...base,
          [SKILLS]: lore,
          [EXPERTISE]: ['skill:Arcana', 'skill:Insight'],
        },
        ...APPLY,
      });
      expect(result.sheet.skillProficiencies).toEqual(
        expect.arrayContaining(lore),
      );
      expect(result.sheet.featureChoices).toEqual(
        expect.arrayContaining([
          {
            featureRef: 'feature:college-of-lore:bonus-proficiencies',
            choiceId: 'skills',
            optionIds: lore,
            level: 3,
          },
          {
            featureRef: 'feature:bard:expertise',
            choiceId: 'expertise',
            optionIds: ['skill:Arcana', 'skill:Insight'],
            level: 3,
          },
        ]),
      );
      db.close();
    });

    it('offers no pending skill before the Lore picks are valid', () => {
      expect(expertiseOptions(lore)).toContain('skill:Arcana');
      expect(
        detectLevelUpRequiredChoices(
          loreBard(),
          resolver,
          undefined,
          base,
        ).find((d) => d.id === EXPERTISE)?.from,
      ).not.toContain('skill:Arcana');
      // 'Insight' is already held: the whole Lore selection is invalid.
      expect(
        expertiseOptions(['Insight', 'History', 'Persuasion']),
      ).not.toContain('skill:History');
    });

    it.each([
      [
        'Expertise on a skill only in an invalid (held) Lore selection',
        ['Insight', 'History', 'Persuasion'],
        ['skill:History', 'skill:Insight'],
      ],
      [
        'Expertise on a skill only in a duplicate Lore selection',
        ['Arcana', 'Arcana', 'History'],
        ['skill:Arcana', 'skill:Insight'],
      ],
      ['a duplicate Expertise pick', lore, ['skill:Arcana', 'skill:Arcana']],
    ])('blocks %s', (_label, skills, expertise) => {
      const result = previewLevelUpChangeSet(loreBard(), {
        resolver,
        choices: { ...base, [SKILLS]: skills, [EXPERTISE]: expertise },
      });
      expect(result.ok).toBe(false);
      const blocked = result.ok ? [] : result.requiredChoices.map((c) => c.id);
      expect(blocked).toContain(EXPERTISE);
    });
  });
});

describe('Draconic Bloodline Dragon Ancestor (pack-side only)', () => {
  it('carries a ten-option dragon choice for creation consumption (eshyra-nnj6)', () => {
    const feature = bundled
      .listFeatures()
      .find((f) => f.key === 'feature:draconic-bloodline:dragon-ancestor');
    const choice = feature?.choices?.find((c) => c.id === 'dragon-ancestor');
    expect(choice).toMatchObject({ category: 'other', choose: 1, level: 1 });
    expect(choice?.options).toHaveLength(10);
    expect(choice?.options?.map((o) => o.id)).toContain(
      'dragon-ancestor:black',
    );
    expect(
      choice?.options?.find((o) => o.id === 'dragon-ancestor:black'),
    ).toMatchObject({
      text: 'Dragon: Black; Damage Type: Acid',
    });
  });
});

describe('generalized choice-coverage invariant', () => {
  it('turns a pack-modeled choice no detector handles into an unsupported descriptor', () => {
    // A synthetic `weirdness` category no detector understands, on a feature
    // granted at the target level.
    const resolver: RulesPackCharacterResolver = {
      ...bundled,
      listFeatures: () =>
        bundled.listFeatures().map((feature) =>
          feature.key === 'feature:college-of-lore:cutting-words'
            ? {
                ...feature,
                choices: [
                  {
                    id: 'weirdness',
                    category: 'other' as const,
                    prompt: 'Pick the weird thing.',
                    level: 3,
                    choose: 1,
                    from: { kind: 'someFutureFilter' },
                  },
                ],
              }
            : feature,
        ),
    };
    const found = detectLevelUpRequiredChoices(
      loreBard(),
      resolver,
      undefined,
      { 'level.3.subclass': ['College of Lore'] },
    );
    expect(
      found.find(
        (d) =>
          d.id === 'level.3.feature.college-of-lore-cutting-words.weirdness',
      ),
    ).toMatchObject({
      status: 'unsupported',
      kind: 'class-feature-choice',
      featureRef: 'feature:college-of-lore:cutting-words',
    });
  });

  describe('per-choice-instance coverage on one feature', () => {
    const CUTTING = 'feature:college-of-lore:cutting-words';
    const overlay = (
      choices: readonly Record<string, unknown>[],
    ): RulesPackCharacterResolver => ({
      ...bundled,
      listFeatures: () =>
        bundled
          .listFeatures()
          .map((feature) =>
            feature.key === CUTTING
              ? { ...feature, choices: choices as never }
              : feature,
          ),
    });
    const handledList = {
      id: 'style',
      category: 'other',
      prompt: 'Pick a style.',
      level: 3,
      choose: 1,
      from: ['a', 'b'],
    };
    const unhandled = {
      id: 'weirdness',
      category: 'other',
      prompt: 'Pick the weird thing.',
      level: 3,
      choose: 1,
      from: { kind: 'someFutureFilter' },
    };
    const conditionalSpell = {
      id: 'tome-style-cantrips',
      category: 'cantrip',
      prompt: 'If you choose X, choose cantrips.',
      level: 3,
      choose: 3,
      from: { requiresFeatureOption: 'pact-boon:not-picked' },
    };
    const picks = { 'level.3.subclass': ['College of Lore'] };
    const idOf = (choiceId: string) =>
      `level.3.feature.college-of-lore-cutting-words.${choiceId}`;

    it('blocks an unhandled choice that shares a feature with a handled one, and apply refuses', () => {
      const resolver = overlay([handledList, unhandled]);
      const found = detectLevelUpRequiredChoices(
        loreBard(),
        resolver,
        undefined,
        picks,
      );
      expect(found.find((d) => d.id === idOf('style'))).toMatchObject({
        status: 'supported',
      });
      expect(found.find((d) => d.id === idOf('weirdness'))).toMatchObject({
        status: 'unsupported',
        featureRef: CUTTING,
      });
      const preview = previewLevelUpChangeSet(loreBard(), {
        resolver: resolver,
        choices: {
          ...picks,
          [idOf('style')]: ['a'],
          [SKILLS]: ['Arcana', 'History', 'Persuasion'],
          [EXPERTISE]: ['skill:Arcana', 'skill:Insight'],
        },
      });
      expect(preview.ok).toBe(false);
      expect(
        preview.ok ? [] : preview.requiredChoices.map((c) => c.id),
      ).toContain(idOf('weirdness'));
    });

    it('does not require an untriggered conditional sibling', () => {
      const found = detectLevelUpRequiredChoices(
        loreBard(),
        overlay([handledList, conditionalSpell]),
        undefined,
        picks,
      );
      expect(found.map((d) => d.id)).not.toContain(idOf(conditionalSpell.id));
    });

    it('blocks a repeated grant whose skill choice no module handles', () => {
      const SKILL_FEATURE = 'feature:college-of-lore:bonus-proficiencies';
      const repeat: RulesPackCharacterResolver = {
        ...bundled,
        resolveClassLevel(classKey, level) {
          const row = bundled.resolveClassLevel(classKey, level);
          return row.ok && classKey === 'class:bard' && level === 2
            ? {
                ok: true,
                record: {
                  ...row.record,
                  featureRefs: [...row.record.featureRefs, SKILL_FEATURE],
                },
              }
            : row;
        },
      };
      const sheet = buildSheet({
        classKey: 'class:bard',
        className: 'Bard',
        level: 2,
        subclass: LORE,
        skills: ['Insight', 'Stealth'],
        spellcasting: {
          cantrips: spellsOf('Bard', 0, 2),
          known: spellsOf('Bard', 1, 5),
        },
      });
      const found = detectLevelUpRequiredChoices(sheet, repeat);
      expect(found.find((d) => d.id === SKILLS)).toMatchObject({
        status: 'unsupported',
        featureRef: SKILL_FEATURE,
      });
    });
  });

  it('does not block on use-time Channel Divinity markers', () => {
    const cleric = buildSheet({
      classKey: 'class:cleric',
      className: 'Cleric',
      level: 1,
      subclass: { key: 'subclass:life-domain', name: 'Life Domain' },
    });
    const ids = detectLevelUpRequiredChoices(cleric, bundled).map((d) => d.id);
    expect(ids.some((id) => id.endsWith('.channel-divinity'))).toBe(false);
  });

  it('every class x subclass x level 1->20 transition reports no uncovered choice instance', () => {
    const uncovered: string[] = [];
    for (const cls of bundled.listClasses()) {
      const subclasses = bundled
        .listSubclasses()
        .filter((s) => s.parentClass === cls.key);
      for (const sub of subclasses) {
        for (let level = 1; level < 20; level += 1) {
          const bare = buildSheet({
            classKey: cls.key,
            className: cls.name,
            level,
          });
          const selector = detectLevelUpRequiredChoices(bare, bundled).find(
            (d) => d.kind === 'subclass' && d.status === 'supported',
          );
          const found = detectLevelUpRequiredChoices(
            selector === undefined
              ? buildSheet({
                  classKey: cls.key,
                  className: cls.name,
                  level,
                  subclass: { key: sub.key, name: sub.name },
                })
              : bare,
            bundled,
            undefined,
            selector === undefined ? {} : { [selector.id]: [sub.key] },
          );
          for (const d of found) {
            if (d.reason.includes('has no level-up handling')) {
              uncovered.push(`${sub.key} ${level}->${level + 1}: ${d.id}`);
            }
          }
        }
      }
    }
    expect(uncovered).toEqual([]);
  });
});
