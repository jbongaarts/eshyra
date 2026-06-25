import { describe, expect, it } from 'vitest';
import {
  chooseableLanguages,
  getAncestryLanguages,
  getBackgroundLanguages,
  getBundledDnd5eSrdPack,
  resolveRulesStack,
  SRD_STANDARD_LANGUAGES,
} from '../src/internal.js';

/**
 * The overlay (eshyra-b69j.12.4) supplies language grants the frozen pack carries
 * only as prose. These tests pin it to the frozen records: each ancestry
 * overlay's `sourceText` must be a faithful prefix of the pack's "Languages"
 * trait text, and each background overlay's `sourceText` must equal the pack's
 * `data.languages` verbatim — so the overlay can never silently drift.
 */

const stack = resolveRulesStack({ base: getBundledDnd5eSrdPack() });

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

describe('language overlay', () => {
  it('covers every frozen ancestry with source-faithful prose', () => {
    const traits = ancestryLanguageTraits();
    expect(traits.length).toBeGreaterThan(0);
    for (const { key, text } of traits) {
      const overlay = getAncestryLanguages(key);
      if (overlay === undefined) {
        throw new Error(`missing language overlay for ${key}`);
      }
      // The cited sentence is a verbatim prefix of the pack trait text.
      expect(
        text.startsWith(overlay.sourceText),
        `overlay sourceText for ${key} is not a faithful prefix`,
      ).toBe(true);
      expect(overlay.fixed).toContain('Common');
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
    const data = stack.recordsByKind
      .get('background')
      ?.byKey.get('background:acolyte')?.record.data as {
      languages?: string;
    };
    expect(acolyte?.sourceText).toBe(data.languages);
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
