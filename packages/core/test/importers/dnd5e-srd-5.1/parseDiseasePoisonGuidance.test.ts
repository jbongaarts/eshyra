import { describe, expect, it } from 'vitest';
import {
  parseRules,
  removeTableCellLines,
} from '../../../scripts/importers/dnd5e-srd-5.1/parseRules.js';
import type { PageText } from '../../../scripts/importers/dnd5e-srd-5.1/types.js';

function page(
  pageNumber: number,
  rows: readonly (readonly [string, number])[],
): PageText {
  return {
    pageNumber,
    lines: rows.map(([line]) => line),
    lineHeights: rows.map(([, height]) => height),
  };
}

describe('Diseases and Poisons guidance rules', () => {
  it('emits the disease intro and distinct sample-disease guidance', () => {
    const rules = parseRules(
      [
        page(199, [
          ['A disease can form the basis of one or more adventures.', 9.84],
          ['Sample Diseases', 13.92],
          ['The diseases here illustrate how disease can work.', 9.84],
        ]),
      ],
      new Set(),
      { name: 'Diseases', keySlug: 'diseases' },
    );
    expect(rules.map((rule) => rule.keySlug)).toEqual([
      'diseases',
      'sample-diseases',
    ]);
    expect(rules.find((rule) => rule.keySlug === 'diseases')?.text).toContain(
      'basis of one or more adventures',
    );
  });

  it('preserves all four poison delivery rules and excludes the price table', () => {
    const rules = parseRules(
      removeTableCellLines([
        page(204, [
          ['Poisons come in the following four types.', 9.84],
          ['Contact. Contact poison remains potent until touched.', 9.84],
          ['Ingested. A creature must swallow an entire dose.', 9.84],
          ['Inhaled. Holding one’s breath is ineffective.', 9.84],
          ['Injury. Injury poison remains potent until delivered.', 9.84],
          ['Poisons', 12],
          ['Item Type Price per Dose', 8.88],
          ['Sample Poisons', 13.92],
          ['Each type of poison has its own debilitating effects.', 9.84],
        ]),
      ]),
      new Set(),
      { name: 'Poisons', keySlug: 'poisons' },
    );
    const poisonText = rules.find((rule) => rule.keySlug === 'poisons')?.text;
    for (const phrase of ['Contact.', 'Ingested.', 'Inhaled.', 'Injury.']) {
      expect(poisonText).toContain(phrase);
    }
    expect(poisonText).not.toContain('Price per Dose');
    expect(rules.map((rule) => rule.keySlug)).toEqual([
      'poisons',
      'sample-poisons',
    ]);
  });
});
