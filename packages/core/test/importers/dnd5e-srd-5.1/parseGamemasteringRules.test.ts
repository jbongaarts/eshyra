import { describe, expect, it } from 'vitest';
import { parseGamemasteringRules } from '../../../scripts/importers/dnd5e-srd-5.1/parseGamemasteringRules.js';
import type { PageText } from '../../../scripts/importers/dnd5e-srd-5.1/types.js';

function page(
  pageNumber: number,
  entries: readonly (readonly [string, number])[],
): PageText {
  return {
    pageNumber,
    lines: entries.map(([line]) => line),
    lineHeights: entries.map(([, height]) => height),
  };
}

const BODY = 9.84;
const TABLE = 8.88;
const LEAF = 12;
const SUBSECTION = 13.92;

const MADNESS_PAGES = [
  page(201, [
    [
      'In a typical campaign, characters aren’t driven mad by every horror.',
      BODY,
    ],
    ['A horror-themed campaign can use madness to reinforce that theme.', BODY],
    ['Going Mad', SUBSECTION],
    [
      'Magical effects, diseases, poisons, and planar effects can inflict madness.',
      BODY,
    ],
    [
      'Resisting the effect usually requires a Wisdom or Charisma saving throw.',
      BODY,
    ],
    ['Madness Effects', SUBSECTION],
    ['Madness can be short-term, long-term, or indefinite.', BODY],
    ['Short-term madness lasts for 1d10 minutes.', BODY],
    ['Long-term madness lasts for 1d10 × 10 hours.', BODY],
    ['Short-Term Madness', LEAF],
    ['d100 Effect (lasts 1d10 minutes)', TABLE],
    ['01–20 The character becomes paralyzed.', TABLE],
    ['Long-Term Madness', LEAF],
    ['d100 Effect (lasts 1d10 × 10 hours)', TABLE],
    ['01–10 The character repeats an activity.', TABLE],
  ]),
  page(202, [
    ['Indefinite Madness', LEAF],
    ['d100 Flaw (lasts until cured)', TABLE],
    ['01–15 “Being drunk keeps me sane.”', TABLE],
    ['Curing Madness', SUBSECTION],
    ['A calm emotions spell can suppress the effects of madness.', BODY],
    ['Greater restoration can end indefinite madness.', BODY],
  ]),
];

const OBJECT_PAGES = [
  page(203, [
    [
      'Characters can destroy any destructible object with enough time and the right tools.',
      BODY,
    ],
    [
      'Use common sense when determining whether an attack can damage an object.',
      BODY,
    ],
    ['Statistics for Objects', LEAF],
    ['When time is a factor, assign Armor Class and hit points.', BODY],
    ['Armor Class. The table suggests AC values for common substances.', BODY],
    ['Object Armor Class', LEAF],
    ['Substance AC', TABLE],
    ['Cloth, paper, rope 11', TABLE],
    ['Adamantine 23', TABLE],
    [
      'Hit Points. Resilient objects have more hit points than fragile ones.',
      BODY,
    ],
    ['Object Hit Points', LEAF],
    ['Size Fragile Resilient', TABLE],
    ['Tiny (bottle, lock) 2 (1d4) 5 (2d4)', TABLE],
    ['Small (chest, lute) 3 (1d6) 10 (3d6)', TABLE],
    ['Medium (barrel, chandelier) 4 (1d8) 18 (4d8)', TABLE],
    ['Large (cart, 10-ft.-by-10-ft. window) 5 (1d10) 27 (5d10)', TABLE],
    ['Huge and Gargantuan Objects. Track smaller sections separately.', BODY],
    [
      'Objects and Damage Types. Objects are immune to poison and psychic damage.',
      BODY,
    ],
    ['Damage Threshold. Superficial damage does not reduce hit points.', BODY],
  ]),
];

describe('parseGamemasteringRules', () => {
  it('extracts exactly the five approved rules without table rows', () => {
    const rules = parseGamemasteringRules(MADNESS_PAGES, OBJECT_PAGES);
    expect(rules).toEqual([
      {
        name: 'Curing Madness',
        keySlug: 'curing-madness',
        text: 'A calm emotions spell can suppress the effects of madness. Greater restoration can end indefinite madness.',
        sourcePage: 202,
      },
      {
        name: 'Going Mad',
        keySlug: 'going-mad',
        text: 'Magical effects, diseases, poisons, and planar effects can inflict madness. Resisting the effect usually requires a Wisdom or Charisma saving throw.',
        sourcePage: 201,
      },
      {
        name: 'Madness',
        keySlug: 'madness',
        text: 'In a typical campaign, characters aren’t driven mad by every horror. A horror-themed campaign can use madness to reinforce that theme.',
        sourcePage: 201,
      },
      {
        name: 'Madness Effects',
        keySlug: 'madness-effects',
        text: 'Madness can be short-term, long-term, or indefinite. Short-term madness lasts for 1d10 minutes. Long-term madness lasts for 1d10 × 10 hours.',
        sourcePage: 201,
      },
      {
        name: 'Objects',
        keySlug: 'objects',
        // The producer now reports the two table blocks removed from the
        // middle of the prose (eshyra-o9bd.19.6.7.10); the text is unchanged.
        composedBy: ['interior-removal'],
        text: 'Characters can destroy any destructible object with enough time and the right tools. Use common sense when determining whether an attack can damage an object. Statistics for Objects When time is a factor, assign Armor Class and hit points. Armor Class. The table suggests AC values for common substances. Hit Points. Resilient objects have more hit points than fragile ones. Huge and Gargantuan Objects. Track smaller sections separately. Objects and Damage Types. Objects are immune to poison and psychic damage. Damage Threshold. Superficial damage does not reduce hit points.',
        sourcePage: 203,
      },
    ]);

    const allText = rules.map((rule) => rule.text).join('\n');
    for (const excluded of [
      'Object Armor Class',
      'Substance AC',
      'Cloth, paper, rope 11',
      'Object Hit Points',
      'Size Fragile Resilient',
      'Tiny (bottle, lock) 2 (1d4) 5 (2d4)',
      'd100 Effect',
      '01–20',
      'd100 Flaw',
    ]) {
      expect(allText).not.toContain(excluded);
    }
  });

  it('returns no rules when both optional fixture slices are absent', () => {
    expect(parseGamemasteringRules([], [])).toEqual([]);
  });
});
