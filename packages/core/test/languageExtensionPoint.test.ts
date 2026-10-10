import { describe, expect, it } from 'vitest';
import {
  type CharacterDraft,
  finalizeCharacterDraft,
  getBundledDnd5eSrdPack,
  getDnd5eCharacterCreationEngine,
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
    const result = finalizeCharacterDraft(draft, META);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.character.wallet?.gp).toBe(15);
    expect(result.character.equipment).toContain('holy symbol');
  });
});
