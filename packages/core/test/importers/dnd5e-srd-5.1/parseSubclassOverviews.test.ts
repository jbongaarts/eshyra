/**
 * The excerpts are reproduced from the System Reference Document 5.1 by
 * Wizards of the Coast LLC under CC-BY-4.0 and reformatted as extracted lines
 * with their rendered SRD font heights.
 */

import { describe, expect, it } from 'vitest';
import { parseSubclassOverviews } from '../../../scripts/importers/dnd5e-srd-5.1/parseSubclassOverviews.js';
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

describe('parseSubclassOverviews (eshyra-i2v4)', () => {
  it('captures category overview prose and stops before the first subclass', () => {
    const rules = parseSubclassOverviews([
      page(25, [
        ['Indomitable', 13.9],
        ['You can reroll a saving throw that you fail.', 9.8],
        ['Martial Archetypes', 18.0],
        ['Different fighters choose different approaches to', 9.8],
        ['perfecting their fighting prowess. The martial', 9.8],
        ['archetype you choose to emulate reflects your', 9.8],
        ['approach.', 9.8],
        ['Champion', 13.9],
        ['The archetypal Champion focuses on raw power.', 9.8],
      ]),
    ]);

    expect(rules).toHaveLength(1);
    const [rule] = rules;
    expect(rule.name).toBe('Martial Archetypes');
    expect(rule.keySlug).toBe('martial-archetypes');
    expect(rule.sourcePage).toBe(25);
    expect(rule.text).toContain(
      'Different fighters choose different approaches',
    );
    // The overview must not absorb the base feature above it or the first
    // subclass entry below it.
    expect(rule.text).not.toContain('Indomitable');
    expect(rule.text).not.toContain('Champion');
    expect(rule.text).not.toContain('raw power');
  });

  it('captures all categories present and sorts them by name', () => {
    const rules = parseSubclassOverviews([
      page(44, [
        ['Sorcerous Origins', 18.0],
        ['Different sorcerers claim different origins for their', 9.8],
        ['innate magic, such as a draconic bloodline.', 9.8],
        ['Draconic Bloodline', 13.9],
      ]),
      page(54, [
        ['Arcane Traditions', 18.0],
        ['The study of wizardry is ancient.', 9.8],
        ['School of Evocation', 13.9],
      ]),
    ]);

    expect(rules.map((r) => r.keySlug)).toEqual([
      'arcane-traditions',
      'sorcerous-origins',
    ]);
  });

  it('ignores non-category headings at the same tier', () => {
    // A base-class title at h≈18 must not be captured as a subclass category.
    const rules = parseSubclassOverviews([
      page(20, [
        ['Fighter', 18.0],
        ['A master of martial combat.', 9.8],
        ['Class Features', 13.9],
      ]),
    ]);
    expect(rules).toHaveLength(0);
  });

  it('ignores category titles that appear only as body-height text', () => {
    // The allowlist match must be gated on the heading tier, not body prose.
    const rules = parseSubclassOverviews([
      page(25, [
        ['The fighter chooses from the Martial Archetypes below.', 9.8],
      ]),
    ]);
    expect(rules).toHaveLength(0);
  });

  it('returns nothing for a uniform-font fixture slice', () => {
    const rules = parseSubclassOverviews([
      { pageNumber: 25, lines: ['Martial Archetypes', 'Different fighters'] },
    ]);
    expect(rules).toHaveLength(0);
  });
});
