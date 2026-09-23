/**
 * Poison-parser unit tests for the D&D 5e SRD 5.1 importer (loreweaver-6ra).
 *
 * Poison text excerpts in this file are reproduced from the System Reference
 * Document 5.1 by Wizards of the Coast LLC, available under the Creative
 * Commons Attribution 4.0 International License (CC-BY-4.0). Excerpts are used
 * as parser test input; no modification has been made beyond reformatting to
 * match the importer's extracted-line input shape.
 */

import { describe, expect, it } from 'vitest';
import { parsePoisons } from '../../../scripts/importers/dnd5e-srd-5.1/parsePoisons.js';
import type { PageText } from '../../../scripts/importers/dnd5e-srd-5.1/types.js';

function page(pageNumber: number, lines: string[]): PageText {
  return { pageNumber, lines };
}

// The general guidance + four-type definitions + reference table + caption that
// precede the sample entries. The four-type prose ("Contact. Contact poison…")
// has no parenthetical type, so it must NOT be detected as a sample entry; the
// reference-table rows supply prices.
const PRELUDE_LINES = [
  'Poisons',
  'Given their insidious and deadly nature, poisons are',
  'illegal in most societies.',
  'Poisons come in the following four types.',
  'Contact. Contact poison can be smeared on an',
  'object and remains potent until it is touched.',
  'Ingested. A creature must swallow an entire dose',
  'of ingested poison to suffer its effects.',
  // Reference table (Item / Type / Price per Dose).
  'Poisons',
  'Item Type Price per Dose',
  'Assassin’s blood Ingested 150 gp',
  'Midnight tears Ingested 1,500 gp',
  'Wyvern poison Injury 1,200 gp',
  'Sample Poisons',
  'Each type of poison has its own debilitating effects.',
];

const ASSASSINS_BLOOD_LINES = [
  'Assassin’s Blood (Ingested). A creature subjected',
  'to this poison must make a DC 10 Constitution',
  'saving throw. On a failed save, it takes 6 (1d12)',
  'poison damage and is poisoned for 24 hours.',
];

const MIDNIGHT_TEARS_LINES = [
  'Midnight Tears (Ingested). A creature that',
  'ingests this poison suffers no effect until the stroke',
  'of midnight.',
];

const WYVERN_POISON_LINES = [
  'Wyvern Poison (Injury). This poison must be',
  'harvested from a dead or incapacitated wyvern. A',
  'creature subjected to this poison must make a DC 15',
  'Constitution saving throw.',
];

describe('parsePoisons — single entry with table price', () => {
  const results = parsePoisons([
    page(204, [
      'Item Type Price per Dose',
      'Assassin’s blood Ingested 150 gp',
      'Sample Poisons',
      ...ASSASSINS_BLOOD_LINES,
    ]),
  ]);

  it('extracts exactly one poison', () => {
    expect(results).toHaveLength(1);
  });

  it('extracts the name, type, and price', () => {
    expect(results[0].name).toBe('Assassin’s Blood');
    expect(results[0].poisonType).toBe('ingested');
    expect(results[0].price).toBe('150 gp');
  });

  it('joins the lead-in remainder into the description and strips the lead-in', () => {
    expect(results[0].description).toMatch(
      /^A creature subjected to this poison must make a DC 10/,
    );
    expect(results[0].description).not.toMatch(/\(Ingested\)\./);
  });

  it('records the source page of the lead-in', () => {
    expect(results[0].sourcePage).toBe(204);
  });
});

describe('parsePoisons — full prelude + three sample entries', () => {
  const results = parsePoisons([
    page(204, [
      ...PRELUDE_LINES,
      ...ASSASSINS_BLOOD_LINES,
      ...MIDNIGHT_TEARS_LINES,
      ...WYVERN_POISON_LINES,
    ]),
  ]);

  it('extracts names sorted, with types', () => {
    expect(results.map((p) => [p.name, p.poisonType])).toEqual([
      ['Assassin’s Blood', 'ingested'],
      ['Midnight Tears', 'ingested'],
      ['Wyvern Poison', 'injury'],
    ]);
  });

  it('attaches the matching reference-table price per dose by normalized name', () => {
    const byName = new Map(results.map((p) => [p.name, p.price]));
    expect(byName.get('Assassin’s Blood')).toBe('150 gp');
    expect(byName.get('Midnight Tears')).toBe('1,500 gp');
    expect(byName.get('Wyvern Poison')).toBe('1,200 gp');
  });

  it('does not treat Contact./Ingested. type-definition prose as an entry', () => {
    expect(results.map((p) => p.name)).not.toContain('Contact');
    expect(results.map((p) => p.name)).not.toContain('Ingested');
  });

  it('bounds each entry body at the next lead-in', () => {
    const assassin = results.find((p) => p.name === 'Assassin’s Blood');
    expect(assassin?.description).not.toMatch(/suffers no effect until/);
  });
});

describe('parsePoisons — empty when no sample lead-in present', () => {
  it('returns an empty array for table-only input', () => {
    expect(
      parsePoisons([
        page(204, [
          'Item Type Price per Dose',
          'Assassin’s blood Ingested 150 gp',
        ]),
      ]),
    ).toEqual([]);
  });
});
