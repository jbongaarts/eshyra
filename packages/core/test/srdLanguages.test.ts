import { describe, expect, it } from 'vitest';
import {
  chooseableLanguages,
  getAncestryLanguages,
  getBackgroundLanguages,
  getBundledDnd5eCharacterResolver,
  getBundledDnd5eSrdPack,
  resolveRulesStack,
  SRD_STANDARD_LANGUAGES,
} from '../src/internal.js';

/**
 * Source-cited language constants are retained as regression oracles. Runtime
 * creation reads generated pack fields; these tests assert that generated
 * language grants still match the SRD-derived oracle values and source prose.
 */

const stack = resolveRulesStack({ base: getBundledDnd5eSrdPack() });
const resolver = getBundledDnd5eCharacterResolver();

interface AncestryTrait {
  readonly name: string;
  readonly text: string;
}

function ancestryLanguageTraits(): { key: string; text: string }[] {
  const index = stack.recordsByKind.get('ancestry');
  if (index === undefined) {
    throw new Error('no ancestry records in the bundled pack');
  }
  const out: { key: string; text: string }[] = [];
  for (const { record } of index.byKey.values()) {
    const data = record.data as { traits?: readonly AncestryTrait[] };
    const trait = (data.traits ?? []).find((t) => /languages?/i.test(t.name));
    if (trait === undefined) {
      throw new Error(`ancestry ${record.key} has no Languages trait`);
    }
    out.push({ key: record.key, text: trait.text });
  }
  return out;
}

describe('language oracle', () => {
  it('matches every frozen ancestry generated pack field', () => {
    const traits = ancestryLanguageTraits();
    expect(traits.length).toBeGreaterThan(0);
    for (const { key, text } of traits) {
      const oracle = getAncestryLanguages(key);
      if (oracle === undefined) {
        throw new Error(`missing language oracle for ${key}`);
      }
      const actual = resolver.resolveAncestry(key);
      if (!actual.ok) {
        throw new Error(`ancestry ${key} did not resolve`);
      }
      expect(actual.record.languages).toEqual([oracle]);
      // The cited sentence is a verbatim prefix of the pack trait text.
      expect(
        text.startsWith(oracle.sourceText),
        `oracle sourceText for ${key} is not a faithful prefix`,
      ).toBe(true);
      expect(oracle.fixed).toContain('Common');
    }
  });

  it('interprets representative fixed grants and choices', () => {
    expect(getAncestryLanguages('ancestry:elf')).toMatchObject({
      fixed: ['Common', 'Elvish'],
    });
    expect(getAncestryLanguages('ancestry:elf')?.choose).toBeUndefined();
    expect(getAncestryLanguages('ancestry:tiefling')?.fixed).toEqual([
      'Common',
      'Infernal',
    ]);
    // Half-Elf: Common + Elvish fixed, plus one free choice.
    expect(getAncestryLanguages('ancestry:half-elf')).toMatchObject({
      fixed: ['Common', 'Elvish'],
      choose: 1,
    });
    // Human: Common fixed, plus one free choice.
    expect(getAncestryLanguages('ancestry:human')).toMatchObject({
      fixed: ['Common'],
      choose: 1,
    });
  });

  it('lists the ancestries that grant a free language choice', () => {
    const withChoice = ancestryLanguageTraits()
      .map(({ key }) => key)
      .filter((key) => getAncestryLanguages(key)?.choose !== undefined)
      .sort();
    expect(withChoice).toEqual(['ancestry:half-elf', 'ancestry:human']);
  });

  it('structures the Acolyte background language choice verbatim', () => {
    const acolyte = getBackgroundLanguages('background:acolyte');
    expect(acolyte).toEqual({
      fixed: [],
      choose: 2,
      sourceText: 'Two of your choice',
    });
    const actual = resolver.resolveBackground('background:acolyte');
    if (!actual.ok) {
      throw new Error('acolyte background did not resolve');
    }
    expect(actual.record.languages).toEqual([acolyte]);
  });

  it('chooseableLanguages excludes already-granted languages', () => {
    expect(chooseableLanguages(['Common', 'Elvish'])).not.toContain('Common');
    expect(chooseableLanguages(['Common', 'Elvish'])).not.toContain('Elvish');
    expect(chooseableLanguages(['Common'])).toContain('Dwarvish');
    // An empty grant leaves the whole standard list.
    expect(chooseableLanguages([])).toEqual(SRD_STANDARD_LANGUAGES);
  });

  it('returns undefined for unmodeled keys', () => {
    expect(getAncestryLanguages('ancestry:warforged')).toBeUndefined();
    expect(getBackgroundLanguages('background:pirate')).toBeUndefined();
  });
});
