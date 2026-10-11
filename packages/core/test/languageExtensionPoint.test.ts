import { describe, expect, it } from 'vitest';
import { applyLanguagesToSheet } from '../src/character/levelUpFeatureChoices.js';
import {
  type CharacterCreationEngine,
  type CharacterDraft,
  createCharacterCreationEngine,
  createRulesPackCharacterResolver,
  detectLevelUpRequiredChoices,
  finalizeCharacterDraft,
  getBundledDnd5eSrdPack,
  getDnd5eCharacterCreationEngine,
  resolveRulesStack,
  SRD_5_1_STANDARD_LANGUAGES,
  validateRulesPack,
} from '../src/internal.js';

/**
 * eshyra-o9bd.19.3.3.1 (indep:011): `rule:languages` lets a player pick a
 * language outside the Standard Languages table "with your GM's permission".
 * The pack carries that as an `extension` beside the unchanged default `from`
 * domain; creation accepts an outside pick only with an explicit GM-approval
 * input and never infers approval.
 */

const engine = getDnd5eCharacterCreationEngine();
const META = { createdAt: '2026-10-10T00:00:00.000Z', source: 'test' } as const;
const EXTENSION = {
  ruleRef: 'rule:languages',
  exoticTableRef: 'table:exotic-languages',
  requiresGmApproval: true,
};

interface LanguageEntry {
  readonly fixed: readonly string[];
  readonly choose?: number;
  readonly from?: readonly string[];
  readonly extension?: unknown;
  readonly sourceText: string;
}
interface ChoiceEntry {
  readonly category: string;
  readonly from?: readonly string[];
  readonly extension?: unknown;
  readonly sourceText: string;
}

function openLanguageGrants(): {
  key: string;
  entry: LanguageEntry | ChoiceEntry;
}[] {
  const out: { key: string; entry: LanguageEntry | ChoiceEntry }[] = [];
  for (const record of getBundledDnd5eSrdPack().records) {
    if (record.kind !== 'ancestry' && record.kind !== 'background') continue;
    const data = record.data as {
      languages?: readonly LanguageEntry[];
      choices?: readonly ChoiceEntry[];
    };
    for (const entry of data.languages ?? []) {
      if (entry.choose !== undefined) out.push({ key: record.key, entry });
    }
    for (const entry of data.choices ?? []) {
      if (entry.category === 'language') out.push({ key: record.key, entry });
    }
  }
  return out;
}

function draftWithOpenLanguage(): CharacterDraft {
  let draft = engine.createDraft({ id: 'hero', mode: 'concept-first' });
  draft = engine.setIdentity(draft, { name: 'Grok', concept: 'guard' });
  draft = engine.setClass(draft, 'Fighter');
  draft = engine.setAncestry(draft, 'Human');
  draft = engine.setAbilityScoreMethod(draft, 'point_buy');
  draft = engine.setAbilityScores(draft, {
    strength: 15,
    dexterity: 14,
    constitution: 13,
    intelligence: 12,
    wisdom: 10,
    charisma: 8,
  });
  for (const entry of engine.mechanicalChoices(draft)) {
    if (entry.choice.kind === 'languages') continue;
    const picks = (entry.choice.from ?? []).slice(0, entry.choice.choose ?? 0);
    draft = engine.setChoice(draft, entry.choice.id, picks);
  }
  return draft;
}

function languageState(draft: CharacterDraft) {
  const state = engine
    .mechanicalChoices(draft)
    .find((entry) => entry.choice.id === 'ancestry.languages');
  if (state === undefined) throw new Error('no ancestry.languages choice');
  return state;
}

describe('language extension point (rule:languages)', () => {
  it('every open "of your choice" language grant carries the extension and keeps the Standard default domain', () => {
    const grants = openLanguageGrants();
    expect(grants.map((g) => g.key).sort()).toEqual([
      'ancestry:half-elf',
      'ancestry:high-elf',
      'ancestry:human',
      'background:acolyte',
    ]);
    for (const { key, entry } of grants) {
      expect(/of your choice/i.test(entry.sourceText), key).toBe(true);
      expect(entry.extension, key).toEqual(EXTENSION);
      expect(entry.from, key).toEqual([...SRD_5_1_STANDARD_LANGUAGES]);
    }
    // The referenced rule and table exist in the pack.
    const keys = new Set(getBundledDnd5eSrdPack().records.map((r) => r.key));
    expect(keys.has(EXTENSION.ruleRef)).toBe(true);
    expect(keys.has(EXTENSION.exoticTableRef)).toBe(true);
  });

  it('rejects an extension whose approval flag is not literally true', () => {
    const pack = structuredClone(getBundledDnd5eSrdPack());
    const human = pack.records.find((r) => r.key === 'ancestry:human');
    const grant = (human?.data as { languages: LanguageEntry[] } | undefined)
      ?.languages[0];
    (grant as { extension: unknown }).extension = {
      ...EXTENSION,
      requiresGmApproval: false,
    };
    expect(() => validateRulesPack(pack)).toThrow(/requiresGmApproval/);
  });

  it('surfaces the extension on the required choice without widening its options', () => {
    const state = languageState(draftWithOpenLanguage());
    expect(state.choice.extension).toEqual(EXTENSION);
    expect(state.choice.from).toEqual(
      SRD_5_1_STANDARD_LANGUAGES.filter((l) => l !== 'Common'),
    );
  });

  it('refuses a language outside the default domain without GM approval', () => {
    let draft = draftWithOpenLanguage();
    draft = engine.setChoice(draft, 'ancestry.languages', ['Abyssal']);
    expect(languageState(draft).satisfied).toBe(false);
    expect(finalizeCharacterDraft(draft, META).ok).toBe(false);
  });

  it('refuses an approval recorded for a different language or choice', () => {
    let draft = draftWithOpenLanguage();
    draft = engine.setChoice(draft, 'ancestry.languages', ['Abyssal']);
    draft = engine.setGmApprovedLanguages(draft, 'ancestry.languages', [
      'Sylvan',
    ]);
    draft = engine.setGmApprovedLanguages(draft, 'background.languages', [
      'Abyssal',
    ]);
    expect(languageState(draft).satisfied).toBe(false);
  });

  it.each([
    ['an Exotic Languages table language', 'Abyssal'],
    ['a secret language', 'Thieves’ cant'],
    ['a campaign-common language', 'Sahuagin'],
  ])('accepts %s with explicit GM approval', (_label, language) => {
    let draft = draftWithOpenLanguage();
    draft = engine.setChoice(draft, 'ancestry.languages', [language]);
    draft = engine.setGmApprovedLanguages(draft, 'ancestry.languages', [
      language,
    ]);
    expect(languageState(draft).satisfied).toBe(true);
    const result = finalizeCharacterDraft(draft, META);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.character.languages).toEqual(
      expect.arrayContaining(['Common', language]),
    );
  });

  it('never admits an approved language the character already holds or a blank name', () => {
    let draft = draftWithOpenLanguage();
    draft = engine.setChoice(draft, 'ancestry.languages', ['common']);
    draft = engine.setGmApprovedLanguages(draft, 'ancestry.languages', [
      'common',
    ]);
    expect(languageState(draft).satisfied).toBe(false);
    draft = engine.setChoice(draft, 'ancestry.languages', [' ']);
    draft = engine.setGmApprovedLanguages(draft, 'ancestry.languages', [' ']);
    expect(languageState(draft).satisfied).toBe(false);
  });

  it('leaves the default domain unchanged: a standard pick needs no approval', () => {
    let draft = draftWithOpenLanguage();
    draft = engine.setChoice(draft, 'ancestry.languages', ['Giant']);
    expect(languageState(draft).satisfied).toBe(true);
    expect(finalizeCharacterDraft(draft, META).ok).toBe(true);
  });

  it('does not accept approval on a choice without the source extension', () => {
    // A class-skill choice is not a language choice: approval has no effect.
    let draft = draftWithOpenLanguage();
    draft = engine.setChoice(draft, 'class.skills', ['Alchemy']);
    draft = engine.setGmApprovedLanguages(draft, 'class.skills', ['Alchemy']);
    const skills = engine
      .mechanicalChoices(draft)
      .find((e) => e.choice.id === 'class.skills');
    expect(skills?.satisfied).toBe(false);
  });
});

describe('background equipment is structured and credited (opus:F-18)', () => {
  it('credits the Acolyte pouch gp to the starting wallet from the structured grant', () => {
    let draft = draftWithOpenLanguage();
    draft = engine.setBackground(draft, 'background:acolyte');
    for (const entry of engine.mechanicalChoices(draft)) {
      if (entry.satisfied) continue;
      const picks = (entry.choice.from ?? []).slice(
        0,
        entry.choice.choose ?? 0,
      );
      draft = engine.setChoice(draft, entry.choice.id, picks);
    }
    // Language grants must be distinct identities (eshyra-o9bd.19.3.3.3).
    draft = engine.setChoice(draft, 'background.languages', [
      'Elvish',
      'Giant',
    ]);
    const result = finalizeCharacterDraft(draft, META);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.character.wallet?.gp).toBe(15);
    expect(result.character.equipment).toContain('holy symbol');
  });
});

describe('High Elf extra language reaches creation as a language choice', () => {
  const EXTRA = 'ancestry.languages.extra-language';

  function highElfDraft(): CharacterDraft {
    let draft = engine.createDraft({ id: 'hero', mode: 'concept-first' });
    draft = engine.setIdentity(draft, { name: 'Aelar', concept: 'scout' });
    draft = engine.setClass(draft, 'Fighter');
    draft = engine.setAncestry(draft, 'High Elf');
    draft = engine.setAbilityScoreMethod(draft, 'point_buy');
    draft = engine.setAbilityScores(draft, {
      strength: 15,
      dexterity: 14,
      constitution: 13,
      intelligence: 12,
      wisdom: 10,
      charisma: 8,
    });
    for (const entry of engine.mechanicalChoices(draft)) {
      if (entry.choice.id === EXTRA) continue;
      const picks = (entry.choice.from ?? []).slice(
        0,
        entry.choice.choose ?? 0,
      );
      draft = engine.setChoice(draft, entry.choice.id, picks);
    }
    return draft;
  }

  const state = (draft: CharacterDraft) =>
    engine.mechanicalChoices(draft).find((e) => e.choice.id === EXTRA);

  it('requires the extra language, with the default domain and extension', () => {
    const draft = highElfDraft();
    const entry = state(draft);
    expect(entry?.satisfied).toBe(false);
    expect(entry?.choice.extension).toEqual(EXTENSION);
    expect(entry?.choice.from).toEqual(
      SRD_5_1_STANDARD_LANGUAGES.filter(
        (l) => l !== 'Common' && l !== 'Elvish',
      ),
    );
    expect(finalizeCharacterDraft(draft, META).ok).toBe(false);
  });

  it('records a standard pick', () => {
    const draft = engine.setChoice(highElfDraft(), EXTRA, ['Giant']);
    const result = finalizeCharacterDraft(draft, META);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.character.languages).toEqual(
      expect.arrayContaining(['Common', 'Elvish', 'Giant']),
    );
  });

  it('refuses an outside language without approval and accepts it with approval', () => {
    let draft = engine.setChoice(highElfDraft(), EXTRA, ['Sylvan']);
    expect(state(draft)?.satisfied).toBe(false);
    expect(finalizeCharacterDraft(draft, META).ok).toBe(false);
    draft = engine.setGmApprovedLanguages(draft, EXTRA, ['Sylvan']);
    const result = finalizeCharacterDraft(draft, META);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.character.languages).toContain('Sylvan');
  });
});

/**
 * eshyra-o9bd.19.3.3.3 (Sol S1-S3): language choices are validated as DISTINCT
 * additional language identities, an exhausted default domain is never an open
 * pool, and custom-background language picks use the same approval path.
 */
describe('language choice identity, exhausted domains and custom backgrounds', () => {
  const ALL_STANDARD = [...SRD_5_1_STANDARD_LANGUAGES];

  function build(
    eng: CharacterCreationEngine,
    ancestry: string,
    background = 'Acolyte',
    className = 'Fighter',
  ): CharacterDraft {
    let draft = eng.createDraft({ id: 'hero', mode: 'concept-first' });
    draft = eng.setIdentity(draft, { name: 'Grok', concept: 'guard' });
    draft = eng.setClass(draft, className);
    draft = eng.setAncestry(draft, ancestry);
    draft = eng.setBackground(draft, background);
    draft = eng.setAbilityScoreMethod(draft, 'point_buy');
    draft = eng.setAbilityScores(draft, {
      strength: 15,
      dexterity: 14,
      constitution: 13,
      intelligence: 12,
      wisdom: 10,
      charisma: 8,
    });
    for (const entry of eng.mechanicalChoices(draft)) {
      if (entry.choice.kind === 'languages') continue;
      const picks = (entry.choice.from ?? []).slice(
        0,
        entry.choice.choose ?? 0,
      );
      draft = eng.setChoice(draft, entry.choice.id, picks);
    }
    return draft;
  }

  function apply(
    eng: CharacterCreationEngine,
    base: CharacterDraft,
    picks: Record<string, string[]>,
    approvals: Record<string, string[]>,
  ): CharacterDraft {
    let draft = base;
    for (const [id, values] of Object.entries(picks)) {
      draft = eng.setChoice(draft, id, values);
    }
    for (const [id, values] of Object.entries(approvals)) {
      draft = eng.setGmApprovedLanguages(draft, id, values);
    }
    return draft;
  }

  const satisfied = (
    eng: CharacterCreationEngine,
    draft: CharacterDraft,
    id: string,
  ) => eng.mechanicalChoices(draft).find((e) => e.choice.id === id)?.satisfied;

  // S1: a pack whose Acolyte fixed grant holds every Standard language leaves
  // zero default choices for both grant shapes.
  const exhaustedPack = structuredClone(getBundledDnd5eSrdPack());
  const acolyte = exhaustedPack.records.find(
    (r) => r.key === 'background:acolyte',
  );
  const acolyteGrants = (
    acolyte?.data as { languages: { fixed: string[] }[] } | undefined
  )?.languages;
  if (acolyteGrants?.[0] === undefined) throw new Error('no Acolyte grant');
  acolyteGrants[0].fixed = [...ALL_STANDARD];
  const exhaustedResolver = createRulesPackCharacterResolver(
    resolveRulesStack({ base: exhaustedPack, addons: [] }),
  );
  const exhaustedEngine = createCharacterCreationEngine(exhaustedResolver);

  it.each([
    ['Human', 'ancestry.languages'],
    ['High Elf', 'ancestry.languages.extra-language'],
  ])(
    'S1: an exhausted default domain still needs per-choice approval (%s)',
    (ancestry, id) => {
      const base = build(exhaustedEngine, ancestry);
      expect(
        exhaustedEngine.mechanicalChoices(base).find((e) => e.choice.id === id)
          ?.choice.from,
      ).toEqual([]);
      const cases: [string[], Record<string, string[]>, boolean][] = [
        [['Sylvan'], {}, false], // missing approval
        [['Sylvan'], { [id]: ['Sylvan'] }, true], // present approval
        [['Sylvan'], { 'background.languages': ['Sylvan'] }, false], // wrong choice
        [['Sylvan'], { [id]: ['Abyssal'] }, false], // wrong language
        [[' '], { [id]: [' '] }, false], // blank pick
        [['Elvish'], { [id]: ['Elvish'] }, false], // already held fixed language
        [[], {}, false],
      ];
      for (const [picks, approvals, expected] of cases) {
        const draft = apply(exhaustedEngine, base, { [id]: picks }, approvals);
        expect(
          satisfied(exhaustedEngine, draft, id),
          JSON.stringify(picks),
        ).toBe(expected);
      }
      // Both shapes together: the background grant behaves the same.
      let draft = apply(
        exhaustedEngine,
        base,
        { [id]: ['Sylvan'], 'background.languages': ['Abyssal', 'Celestial'] },
        { [id]: ['Sylvan'] },
      );
      expect(
        finalizeCharacterDraft(draft, META, exhaustedResolver, exhaustedEngine)
          .ok,
      ).toBe(false);
      draft = exhaustedEngine.setGmApprovedLanguages(
        draft,
        'background.languages',
        ['Abyssal', 'Celestial'],
      );
      const done = finalizeCharacterDraft(
        draft,
        META,
        exhaustedResolver,
        exhaustedEngine,
      );
      expect(done.ok).toBe(true);
      if (done.ok) {
        expect(done.character.languages).toEqual(
          expect.arrayContaining(['Sylvan', 'Abyssal', 'Celestial']),
        );
      }
    },
  );

  // S2: bundled pack, distinct identities within and across choice grants.
  const EXTRA = 'ancestry.languages.extra-language';
  it.each([
    [
      'cross-group collision',
      'High Elf',
      { [EXTRA]: ['Sylvan'], 'background.languages': ['Sylvan', 'Giant'] },
    ],
    [
      'same-group case variant',
      'Human',
      {
        'ancestry.languages': ['Giant'],
        'background.languages': ['Abyssal', 'abyssal'],
      },
    ],
    [
      'same-group whitespace variant',
      'Human',
      {
        'ancestry.languages': ['Giant'],
        'background.languages': ['Deep Speech', ' deep  speech '],
      },
    ],
    [
      'standard cross-group collision',
      'Human',
      {
        'ancestry.languages': ['Giant'],
        'background.languages': ['Giant', 'Orc'],
      },
    ],
    [
      'case variant across groups',
      'High Elf',
      { [EXTRA]: ['Sylvan'], 'background.languages': ['sylvan', 'Giant'] },
    ],
  ])(
    'S2: refuses %s and never finalizes a lost grant',
    (_label, ancestry, picks) => {
      const approvals = Object.fromEntries(
        Object.entries(picks).map(([id, v]) => [id, [...v]]),
      );
      const eng = engine;
      const draft = apply(eng, build(eng, ancestry), picks, approvals);
      const states = eng
        .mechanicalChoices(draft)
        .filter((e) => e.choice.kind === 'languages');
      expect(states.some((e) => !e.satisfied)).toBe(true);
      expect(finalizeCharacterDraft(draft, META).ok).toBe(false);
    },
  );

  it('S2: distinct additional languages across both grants finalize intact', () => {
    const draft = apply(
      engine,
      build(engine, 'High Elf'),
      { [EXTRA]: ['Sylvan'], 'background.languages': ['Abyssal', 'Giant'] },
      { [EXTRA]: ['Sylvan'], 'background.languages': ['Abyssal'] },
    );
    const result = finalizeCharacterDraft(draft, META);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect([...result.character.languages].sort()).toEqual(
      ['Abyssal', 'Common', 'Elvish', 'Giant', 'Sylvan'].sort(),
    );
  });

  // S3: supported custom background uses the canonical grant's extension.
  const custom = (languages: string[]) => ({
    name: 'Temple Archivist',
    skillProficiencies: ['Arcana', 'History'],
    toolProficiencies: [],
    languages,
    feature: 'background:acolyte#feature:shelter-of-the-faithful',
  });
  function customDraft(
    languages: string[],
    approvals: Record<string, string[]>,
  ): CharacterDraft {
    let draft = build(engine, 'Human');
    for (const [id, v] of Object.entries(approvals)) {
      draft = engine.setGmApprovedLanguages(draft, id, v);
    }
    draft = engine.setBackgroundCustomization(draft, custom(languages));
    return engine.setChoice(draft, 'ancestry.languages', ['Giant']);
  }

  it.each([
    [
      'approved outside picks',
      ['Abyssal', 'Sylvan'],
      { 'background.languages': ['Abyssal', 'Sylvan'] },
      true,
    ],
    [
      'normalized approval',
      ['Abyssal', 'Sylvan'],
      { 'background.languages': [' abyssal', 'SYLVAN '] },
      true,
    ],
    ['no approval', ['Abyssal', 'Sylvan'], {}, false],
    [
      'wrong choice id',
      ['Abyssal', 'Sylvan'],
      { 'ancestry.languages': ['Abyssal', 'Sylvan'] },
      false,
    ],
    [
      'partial approval',
      ['Abyssal', 'Sylvan'],
      { 'background.languages': ['Abyssal'] },
      false,
    ],
    ['standard control', ['Elvish', 'Dwarvish'], {}, true],
    ['held ancestry language', ['Common', 'Dwarvish'], {}, false],
    [
      'duplicate identity',
      ['Abyssal', 'abyssal'],
      { 'background.languages': ['Abyssal'] },
      false,
    ],
  ])('S3: custom background %s', (_label, languages, approvals, ok) => {
    const result = finalizeCharacterDraft(
      customDraft(languages, approvals),
      META,
    );
    expect(result.ok).toBe(ok);
    if (result.ok) {
      expect(result.character.languages).toEqual(
        expect.arrayContaining(languages),
      );
    }
  });

  // Identity closure (eshyra-o9bd.19.3.3.5): one languageKey identity from
  // creation producers through the class-feature pick, finalization and the
  // durable-sheet level-up consumer.
  describe('language identity reaches class-feature and durable-sheet consumers', () => {
    const LANG1 = 'class.feature.ranger-favored-enemy.favored-enemy-language';
    const ENEMY1 = 'class.feature.ranger-favored-enemy.favored-enemy';
    const LANG6 = 'level.6.feature.ranger-favored-enemy.favored-enemy-language';
    const SPELLINGS = [
      'Deep Speech',
      'deep speech',
      'Deep  Speech',
      '  DEEP\tSPEECH ',
    ];
    // Ranger skills avoid the Acolyte's (no duplicate-proficiency replacement).
    const rangerBase = (): CharacterDraft =>
      engine.setChoice(
        engine.setChoice(
          build(engine, 'Human', 'Acolyte', 'Ranger'),
          'class.skills',
          ['Animal Handling', 'Athletics', 'Nature'],
        ),
        ENEMY1,
        ['aberrations'],
      );
    const rangerDraft = (
      producer: 'ordinary' | 'custom',
      spelling: string,
    ): CharacterDraft => {
      let draft = rangerBase();
      if (producer === 'ordinary') {
        draft = apply(
          engine,
          draft,
          {
            'ancestry.languages': [spelling],
            'background.languages': ['Giant', 'Orc'],
          },
          { 'ancestry.languages': [spelling] },
        );
      } else {
        draft = engine.setGmApprovedLanguages(draft, 'background.languages', [
          spelling,
        ]);
        draft = engine.setBackgroundCustomization(draft, {
          name: 'Temple Archivist',
          skillProficiencies: ['Arcana', 'History'],
          toolProficiencies: [],
          languages: [spelling, 'Giant'],
          feature: 'background:acolyte#feature:shelter-of-the-faithful',
        });
        draft = engine.setChoice(draft, 'ancestry.languages', ['Orc']);
      }
      return draft;
    };
    const deepSpeechCount = (languages: readonly string[]) =>
      languages.filter((l) => /^deep\s+speech$/i.test(l.trim())).length;

    it.each(
      SPELLINGS.flatMap((spelling) =>
        (['ordinary', 'custom'] as const).map(
          (producer) => [producer, spelling] as const,
        ),
      ),
    )(
      '%s producer %j: held language is neither offered nor learned again',
      (producer, spelling) => {
        const draft = rangerDraft(producer, spelling);
        const offered = engine
          .mechanicalChoices(draft)
          .find((e) => e.choice.id === LANG1);
        expect(offered?.choice.from).not.toContain('Deep Speech');
        // Forcing the pick through stored input is still refused.
        const forced = engine.setChoice(draft, LANG1, ['Deep Speech']);
        expect(finalizeCharacterDraft(forced, META).ok).toBe(false);
        // Without the pick the sheet persists exactly one canonical spelling.
        const result = finalizeCharacterDraft(draft, META);
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(result.character.languages).toContain('Deep Speech');
        expect(deepSpeechCount(result.character.languages)).toBe(1);
        // Durable consumer: the finalized sheet never re-offers it at level 6.
        const sheet = { ...result.character, level: 5 };
        const next = detectLevelUpRequiredChoices(sheet).find(
          (c) => c.id === LANG6,
        );
        expect(next?.from ?? []).not.toContain('Deep Speech');
      },
    );

    it.each(SPELLINGS)(
      'durable sheet holding raw spelling %j excludes it and dedupes learning',
      (spelling) => {
        const base = finalizeCharacterDraft(
          rangerDraft('ordinary', 'Deep Speech'),
          META,
        );
        expect(base.ok).toBe(true);
        if (!base.ok) return;
        const languages = ['Common', spelling];
        const sheet = { ...base.character, level: 5, languages };
        const offered = detectLevelUpRequiredChoices(sheet).find(
          (c) => c.id === LANG6,
        );
        expect(offered?.from ?? []).not.toContain('Deep Speech');
        expect(
          applyLanguagesToSheet(languages, [
            { languages: ['Deep Speech'] } as never,
          ]),
        ).toEqual(languages);
      },
    );

    it('control: a distinct favored-enemy language is learned once', () => {
      let draft = rangerBase();
      draft = apply(
        engine,
        draft,
        {
          'ancestry.languages': ['Giant'],
          'background.languages': ['Orc', 'Gnomish'],
          [LANG1]: ['Deep Speech'],
        },
        {},
      );
      const result = finalizeCharacterDraft(draft, META);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(deepSpeechCount(result.character.languages)).toBe(1);
      expect(result.character.languages).toEqual(
        expect.arrayContaining(['Giant', 'Orc', 'Gnomish', 'Deep Speech']),
      );
      expect(
        detectLevelUpRequiredChoices({ ...result.character, level: 5 }).find(
          (c) => c.id === LANG6,
        )?.from ?? [],
      ).not.toContain('Deep Speech');
    });
  });
});
