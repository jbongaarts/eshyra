/**
 * Unit tests for the Appendix PH-B deity-table parser (eshyra-4a7.10.5).
 *
 * The fixtures are synthetic line shapes that reproduce the SRD 5.1
 * extraction's defining quirks — page-interleaved left (deity name) and right
 * (alignment/domain/symbol) column blocks, a deity table that spans a page
 * boundary, a wrapped symbol cell, single- and multi-domain rows, and the lone
 * "N" alignment code — without copying SRD prose. The end-to-end parse against
 * the real vendored PDF is covered by the committed-pack tests.
 */

import { describe, expect, it } from 'vitest';
import {
  DeityTableError,
  parseDeityTables,
} from '../../../scripts/importers/dnd5e-srd-5.1/parseDeityTables.js';
import type { PageText } from '../../../scripts/importers/dnd5e-srd-5.1/types.js';

const CAPTION_H = 12;
const PROSE_H = 9.8;
const CELL_H = 8.9;

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

// Celtic spans pages 1->2 (its third name and corresponding right row land on
// page 2 with no repeated caption); Greek opens on page 2. The right-column
// blocks are emitted after each page's left column, exactly as pdfjs orders a
// two-column page, so the name and attribute streams interleave.
const PAGE_1 = page(1, [
  ['Appendix PH-B: Fantasy-Historical Pantheons', 25.9],
  [
    'Some appendix intro prose that must be ignored by the table parser.',
    PROSE_H,
  ],
  ['Celtic Deities', CAPTION_H],
  ['Deity Alignment', CELL_H],
  ['God A, god of test', CELL_H],
  ['God B, goddess of stuff', CELL_H],
  ['Suggested Domains Symbol', CELL_H],
  ['CG Nature, Trickery Round shield', CELL_H],
  ['NG Life', CELL_H],
  ['Mare s head', CELL_H],
]);

const PAGE_2 = page(2, [
  ['God C, god of foo', CELL_H],
  ['Greek Deities', CAPTION_H],
  ['Deity Alignment', CELL_H],
  ['God D, god of bar', CELL_H],
  ['N War Spear', CELL_H],
  ['Suggested Domains Symbol', CELL_H],
  ['LE Death, War Black ram', CELL_H],
]);

describe('parseDeityTables', () => {
  it('reconstructs page-interleaved deity tables by positional zip', () => {
    const tables = parseDeityTables([PAGE_1, PAGE_2]);
    expect(tables.map((t) => t.name)).toEqual([
      'Celtic Deities',
      'Greek Deities',
    ]);
    for (const table of tables) {
      expect(table.columns).toEqual([
        'Deity',
        'Alignment',
        'Suggested Domains',
        'Symbol',
      ]);
    }

    const celtic = tables[0];
    expect(celtic.sourcePage).toBe(1);
    expect(celtic.rows).toEqual([
      ['God A, god of test', 'CG', 'Nature, Trickery', 'Round shield'],
      // Wrapped symbol cell merged from the continuation line.
      ['God B, goddess of stuff', 'NG', 'Life', 'Mare s head'],
      // Name continues onto page 2 under no caption; the lone "N" alignment.
      ['God C, god of foo', 'N', 'War', 'Spear'],
    ]);

    const greek = tables[1];
    expect(greek.sourcePage).toBe(2);
    expect(greek.rows).toEqual([
      ['God D, god of bar', 'LE', 'Death, War', 'Black ram'],
    ]);
  });

  it('returns no tables for a slice without deity captions', () => {
    const prosePage = page(1, [
      ['Appendix PH-C: The Planes of Existence', 25.9],
      ['Pure prose with no deity table.', PROSE_H],
    ]);
    expect(parseDeityTables([prosePage])).toEqual([]);
    expect(parseDeityTables([])).toEqual([]);
  });

  it('fails closed when the name and attribute streams differ in length', () => {
    const truncated = page(1, [
      ['Celtic Deities', CAPTION_H],
      ['Deity Alignment', CELL_H],
      ['God A, god of test', CELL_H],
      ['God B, goddess of stuff', CELL_H],
      ['Suggested Domains Symbol', CELL_H],
      // Only one attribute row for two deities.
      ['CG Nature Round shield', CELL_H],
    ]);
    expect(() => parseDeityTables([truncated])).toThrow(DeityTableError);
  });

  it('fails closed when an attribute row has no recognized domain', () => {
    const badDomain = page(1, [
      ['Celtic Deities', CAPTION_H],
      ['Deity Alignment', CELL_H],
      ['God A, god of test', CELL_H],
      ['Suggested Domains Symbol', CELL_H],
      ['CG Notadomain Round shield', CELL_H],
    ]);
    expect(() => parseDeityTables([badDomain])).toThrow(/Suggested Domain/);
  });
});
