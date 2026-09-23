/**
 * Disease-parser unit tests for the D&D 5e SRD 5.1 importer (loreweaver-6ra).
 *
 * Disease text excerpts in this file are reproduced from the System Reference
 * Document 5.1 by Wizards of the Coast LLC, available under the Creative
 * Commons Attribution 4.0 International License (CC-BY-4.0). Excerpts are used
 * as parser test input; no modification has been made beyond reformatting to
 * match the importer's extracted-line input shape.
 */

import { describe, expect, it } from 'vitest';
import { parseDiseases } from '../../../scripts/importers/dnd5e-srd-5.1/parseDiseases.js';
import type { PageText } from '../../../scripts/importers/dnd5e-srd-5.1/types.js';

function page(pageNumber: number, lines: string[]): PageText {
  return { pageNumber, lines };
}

// The general "Diseases" guidance prose + "Sample Diseases" caption that
// precede the first named disease. None of these lines is a known disease name,
// so the parser must treat them as non-entries (they are not emitted).
const GUIDANCE_LINES = [
  'Diseases',
  'A plague ravages the kingdom, setting the',
  'adventurers on a quest to find a cure.',
  'Sample Diseases',
  'The diseases here illustrate the variety of ways',
  'disease can work in the game.',
];

const CACKLE_FEVER_LINES = [
  'Cackle Fever',
  'This disease targets humanoids, although gnomes',
  'are strangely immune. While in the grips of this',
  'disease, victims frequently succumb to fits of mad',
  'laughter.',
  'Symptoms manifest 1d4 hours after infection and',
  'include fever and disorientation. The infected',
  'creature gains one level of exhaustion that can’t be',
  'removed until the disease is cured.',
];

const SEWER_PLAGUE_LINES = [
  'Sewer Plague',
  'Sewer plague is a generic term for a broad category',
  'of illnesses that incubate in sewers, refuse heaps,',
  'and stagnant swamps.',
];

const SIGHT_ROT_LINES = [
  'Sight Rot',
  'This painful infection causes bleeding from the eyes',
  'and eventually blinds the victim.',
];

describe('parseDiseases — single entry (Cackle Fever)', () => {
  const results = parseDiseases([page(199, CACKLE_FEVER_LINES)]);

  it('extracts exactly one disease', () => {
    expect(results).toHaveLength(1);
  });

  it('extracts the disease name', () => {
    expect(results[0].name).toBe('Cackle Fever');
  });

  it('records the source page', () => {
    expect(results[0].sourcePage).toBe(199);
  });

  it('does not include the name line as prose', () => {
    expect(results[0].description).not.toMatch(/^Cackle Fever$/m);
  });

  it('re-flows wrapped lines and keeps mechanical text', () => {
    expect(results[0].description).toMatch(/one level of exhaustion/);
    expect(results[0].description).toMatch(/targets humanoids/);
  });
});

describe('parseDiseases — all three SRD 5.1 diseases with leading guidance', () => {
  const results = parseDiseases([
    page(198, [
      ...GUIDANCE_LINES,
      ...CACKLE_FEVER_LINES,
      ...SEWER_PLAGUE_LINES,
      ...SIGHT_ROT_LINES,
    ]),
  ]);

  it('extracts the three names sorted', () => {
    expect(results.map((d) => d.name)).toEqual([
      'Cackle Fever',
      'Sewer Plague',
      'Sight Rot',
    ]);
  });

  it('does not emit the general guidance prose or the Sample Diseases caption', () => {
    for (const r of results) {
      expect(r.description).not.toMatch(/plague ravages the kingdom/);
      expect(r.description).not.toMatch(/illustrate the variety of ways/);
    }
  });

  it('bounds each disease body at the next disease name', () => {
    const cackle = results.find((d) => d.name === 'Cackle Fever');
    expect(cackle?.description).not.toMatch(/Sewer plague is a generic term/);
    const sewer = results.find((d) => d.name === 'Sewer Plague');
    expect(sewer?.description).toMatch(/incubate in sewers/);
    expect(sewer?.description).not.toMatch(/painful infection/);
  });
});

describe('parseDiseases — empty when no known disease name present', () => {
  it('returns an empty array for guidance-only input', () => {
    expect(parseDiseases([page(198, GUIDANCE_LINES)])).toEqual([]);
  });
});
