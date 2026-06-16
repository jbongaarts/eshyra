/**
 * The excerpts are reproduced from the System Reference Document 5.1 by
 * Wizards of the Coast LLC under CC-BY-4.0 and reformatted as extracted lines
 * with their rendered SRD font heights.
 */

import { describe, expect, it } from 'vitest';
import {
  parseSectionIntro,
  reflowProse,
} from '../../../scripts/importers/dnd5e-srd-5.1/parseSectionIntro.js';
import type { PageText } from '../../../scripts/importers/dnd5e-srd-5.1/types.js';

function page(
  pageNumber: number,
  rows: ReadonlyArray<readonly [string, number]>,
): PageText {
  return {
    pageNumber,
    lines: rows.map(([line]) => line),
    lineHeights: rows.map(([, height]) => height),
  };
}

/** A uniform-font slice (no per-line heights) as a reduced fixture would emit. */
function uniformPage(pageNumber: number, lines: string[]): PageText {
  return { pageNumber, lines };
}

describe('parseSectionIntro (eshyra-g9im)', () => {
  it('captures the Feats intro and stops before the first feat heading', () => {
    const rule = parseSectionIntro(
      [
        page(75, [
          ['A feat represents a talent or an area of expertise that', 9.8],
          ['gives a character special capabilities.', 9.8],
          ['At certain levels, your class gives you the Ability', 9.8],
          ['Score Improvement feature. Using the optional feats', 9.8],
          ['rule, you can forgo taking that feature to take a feat', 9.8],
          ['of your choice instead.', 9.8],
          ['Grappler', 13.9],
          ['Prerequisite: Strength 13 or higher', 9.8],
        ]),
      ],
      { name: 'Feats', keySlug: 'feats' },
    );

    expect(rule?.name).toBe('Feats');
    expect(rule?.keySlug).toBe('feats');
    expect(rule?.sourcePage).toBe(75);
    expect(rule?.text).toContain('Using the optional feats rule');
    // The intro must not absorb the Grappler entry that follows it.
    expect(rule?.text).not.toContain('Grappler');
    expect(rule?.text).not.toContain('Prerequisite');
  });

  it('preserves the Conditions general-rules sentinels (curly apostrophes)', () => {
    const rule = parseSectionIntro(
      [
        page(358, [
          ['A condition lasts either until it is countered (the', 9.8],
          ['prone condition is countered by standing up, for', 9.8],
          ['example) or for a duration specified by the effect.', 9.8],
          ['If multiple effects impose the same condition on a', 9.8],
          ['creature, each instance of the condition has its own', 9.8],
          ['duration, but the condition’s effects don’t get worse.', 9.8],
          ['Blinded', 12.0],
          ['• A blinded creature can’t see.', 9.8],
        ]),
      ],
      { name: 'Appendix PH-A: Conditions', keySlug: 'conditions' },
    );

    expect(rule?.text).toContain(
      'A condition lasts either until it is countered',
    );
    expect(rule?.text).toContain('the condition’s effects don’t get worse');
    expect(rule?.text).not.toContain('blinded creature');
  });

  it('rejoins soft line-break hyphenation', () => {
    const rule = parseSectionIntro(
      [
        page(76, [
          ['Ability scores define a creature’s assets as well as', 9.8],
          ['its weak-', 9.8],
          ['nesses.', 9.8],
          ['Ability Scores and Modifiers', 18.0],
        ]),
      ],
      { name: 'Using Ability Scores', keySlug: 'using-ability-scores' },
    );

    expect(rule?.text).toContain('weaknesses.');
    expect(rule?.text).not.toContain('weak- nesses');
  });

  it('returns undefined when no heading bounds the intro (uniform fixture)', () => {
    // No per-line heights: a heading-hierarchy feature must degrade to nothing
    // rather than swallow the whole slice.
    const rule = parseSectionIntro(
      [uniformPage(75, ['A feat represents a talent.', 'Grappler', 'benefit'])],
      { name: 'Feats', keySlug: 'feats' },
    );
    expect(rule).toBeUndefined();
  });

  it('returns undefined when the slice opens directly with a heading', () => {
    const rule = parseSectionIntro([page(75, [['Grappler', 13.9]])], {
      name: 'Feats',
      keySlug: 'feats',
    });
    expect(rule).toBeUndefined();
  });

  it('returns undefined for an empty slice', () => {
    expect(
      parseSectionIntro([], { name: 'Feats', keySlug: 'feats' }),
    ).toBeUndefined();
  });
});

describe('reflowProse', () => {
  it('joins wrapped lines and de-hyphenates lowercase continuations', () => {
    expect(
      reflowProse(['the multi-', 'verse is', 'vast', '', 'and old-', 'world.']),
    ).toBe('the multiverse is vast and oldworld.');
  });
});
