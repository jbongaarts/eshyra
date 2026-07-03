/**
 * Unit tests for the deep pre-freeze audit's token-shingle primitives
 * (eshyra-o9bd.18.9.1). The end-to-end oracle (PDF ↔ committed pack) runs
 * via `npm run audit:dnd5e-srd-deep` before freeze/sign-off; these tests pin
 * the pure normalization/coverage behavior it depends on.
 */

import { describe, expect, it } from 'vitest';
import {
  addGrams,
  diceFormulaAverage,
  GRAM_SIZE,
  gramKey,
  isPageFooter,
  joinDehyphenated,
  locatorPages,
  pageTokens,
  shingleTokens,
  uncoveredRuns,
  walkStrings,
} from '../scripts/deep-audit-dnd5e-srd/shingles.js';

describe('shingleTokens', () => {
  it('equates compound hyphenation, apostrophe glyphs, and case across both sides', () => {
    expect(shingleTokens('Fire-Breathing Statue')).toEqual(
      shingleTokens('firebreathing statue'),
    );
    expect(shingleTokens('Artificer’s Lore')).toEqual(
      shingleTokens('artificers lore'),
    );
  });

  it('keeps dice and fraction tokens comparable', () => {
    expect(shingleTokens('19 (3d10 + 3)')).toEqual(['19', '3d10', '3']);
    expect(shingleTokens('Challenge ½ (100 XP)')).toEqual([
      'challenge',
      '1/2',
      '100',
      'xp',
    ]);
  });
});

describe('pageTokens', () => {
  it('repairs the pdfjs small-caps split only when the fused word is vocabulary', () => {
    const vocabulary = new Set(['senses', 'languages']);
    expect(pageTokens('Sense s darkvision', vocabulary)).toEqual([
      'senses',
      'darkvision',
    ]);
    // "cat s" does not fuse: "cats" is not vocabulary here.
    expect(pageTokens('cat s toy', vocabulary)).toEqual(['cat', 's', 'toy']);
  });
});

describe('uncoveredRuns', () => {
  const corpus =
    'The aboleth makes three tentacle attacks against one target it can see.';

  function corpusGrams(): { grams: Set<string>; short: Set<string> } {
    const grams = new Set<string>();
    const short = new Set<string>();
    addGrams(shingleTokens(corpus), grams, short);
    return { grams, short };
  }

  it('covers text reproduced from the corpus', () => {
    const { grams, short } = corpusGrams();
    expect(uncoveredRuns(shingleTokens(corpus), grams, short)).toEqual([]);
  });

  it('reports a dropped-run of at least the minimum length', () => {
    const { grams, short } = corpusGrams();
    const altered = `${corpus} This entire sentence was silently dropped from the generated record.`;
    const runs = uncoveredRuns(shingleTokens(altered), grams, short);
    expect(runs).toHaveLength(1);
    expect(runs[0].tokens.join(' ')).toContain('silently dropped');
  });

  it('checks short strings as whole tuples', () => {
    const grams = new Set<string>();
    const short = new Set<string>();
    addGrams(shingleTokens('natural armor'), grams, short);
    expect(uncoveredRuns(shingleTokens('natural armor'), grams, short)).toEqual(
      [],
    );
    expect(
      uncoveredRuns(shingleTokens('unnatural armor'), grams, short),
    ).toHaveLength(1);
  });

  it('uses fixed-size grams', () => {
    // A corrupted single number inside otherwise-covered text stays
    // uncovered for GRAM_SIZE positions around it — the digit check's basis.
    const { grams } = corpusGrams();
    const corrupted = corpus.replace('three', '4');
    const tokens = shingleTokens(corrupted);
    const covered = new Array(tokens.length).fill(false);
    for (let i = 0; i + GRAM_SIZE <= tokens.length; i++) {
      // mirror the digit check's coverage marking
      if (grams.has(gramKey(tokens.slice(i, i + GRAM_SIZE)))) {
        for (let j = i; j < i + GRAM_SIZE; j++) covered[j] = true;
      }
    }
    const index = tokens.indexOf('4');
    expect(index).toBeGreaterThanOrEqual(0);
    expect(covered[index]).toBe(false);
  });
});

describe('joinDehyphenated', () => {
  it('glues an end-of-line hyphen split back together', () => {
    expect(joinDehyphenated(['a devas-', 'tating blow'])).toBe(
      'a devastating blow',
    );
    expect(joinDehyphenated(['plain line', 'second line'])).toBe(
      'plain line second line',
    );
  });
});

describe('isPageFooter', () => {
  it('matches the SRD running footer and nothing else', () => {
    expect(isPageFooter('System Reference Document 5.1 261')).toBe(true);
    expect(isPageFooter('The aboleth is ancient.')).toBe(false);
  });
});

describe('diceFormulaAverage', () => {
  it('computes the floored 5e mean, including Unicode minus', () => {
    expect(diceFormulaAverage('18d10 + 36')).toBe(135);
    expect(diceFormulaAverage('2d6')).toBe(7);
    expect(diceFormulaAverage('1d4 − 1')).toBe(1);
    expect(diceFormulaAverage('not dice')).toBeNull();
  });
});

describe('locatorPages', () => {
  it('reads single and multi-page locators', () => {
    expect(locatorPages('p. 261')).toEqual([261]);
    expect(locatorPages('pp. 93, 94')).toEqual([93, 94]);
    expect(locatorPages('fixture')).toEqual([]);
  });
});

describe('walkStrings', () => {
  it('walks nested strings with dotted paths', () => {
    const out: Array<{ path: string; text: string }> = [];
    walkStrings({ a: 'x', b: { c: ['y', { text: 'z' }] } }, '', out);
    expect(out).toEqual([
      { path: 'a', text: 'x' },
      { path: 'b.c[0]', text: 'y' },
      { path: 'b.c[1].text', text: 'z' },
    ]);
  });
});
