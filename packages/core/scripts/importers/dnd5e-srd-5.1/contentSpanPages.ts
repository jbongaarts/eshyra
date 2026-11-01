/**
 * Pages a record's retained content is actually printed on, derived from the
 * extracted page text rather than from the source-region ledger
 * (eshyra-o9bd.16.7.3, audit L1-F1).
 *
 * The ledger-based locator enrichment only sees pages the ledger assigns to a
 * record; a table that continues across a page break, or an ancestry that
 * flattens its parent race's traits, can have content on pages the ledger
 * never attributes to it. This module is the independent denominator: for each
 * retained content chunk (a table row, an ancestry trait's opening and closing
 * words, a magic-item variant entry) it finds the pages, within a small window
 * around the record's own start page, on which the chunk is printed as
 * whole-token text. A chunk printed on the start page is already covered; a
 * chunk printed only on another page of the window contributes that page.
 *
 * It is used twice: `enrichProvenanceFromContentSpans` unions the pages into
 * the locator (producer), and `recordLocatorCompleteness.ts` asserts that every
 * chunk printed in the window is printed on a CITED page (gate). Nothing
 * widens a locator by a hand list: every page added is one a chunk of the
 * record's own retained text was found on.
 */

import type { RulesRecord } from '../../../src/rules/types.js';
import { MAX_CONTINUATION_GAP } from './enrichProvenance.js';
import { citedPages, normalizeAnchorText } from './recordSourceAnchors.js';

type NormalizedPages = ReadonlyMap<number, readonly string[]>;

const CHUNK_TOKENS = 8;
const MIN_CELL_TOKENS = 5;

/** A chunk of retained text and the pages of the window it is printed on. */
export interface ContentChunk {
  readonly pointer: string;
  readonly text: string;
  readonly pages: readonly number[];
}

function windowPages(
  anchorPage: number,
  normalizedPages: NormalizedPages,
): readonly number[] {
  const out: number[] = [];
  for (
    let page = anchorPage - MAX_CONTINUATION_GAP;
    page <= anchorPage + MAX_CONTINUATION_GAP;
    page++
  ) {
    if (normalizedPages.has(page)) out.push(page);
  }
  return out;
}

function found(
  normalized: string,
  page: number,
  normalizedPages: NormalizedPages,
): boolean {
  const bounded = ` ${normalized} `;
  return (normalizedPages.get(page) ?? []).some((reading) =>
    reading.includes(bounded),
  );
}

function chunkPages(
  text: string,
  window: readonly number[],
  normalizedPages: NormalizedPages,
): readonly number[] {
  const normalized = normalizeAnchorText(text);
  if (normalized === '') return [];
  return window.filter((page) => found(normalized, page, normalizedPages));
}

function headTokens(text: string): string {
  return normalizeAnchorText(text).split(' ').slice(0, CHUNK_TOKENS).join(' ');
}

function tailTokens(text: string): string {
  return normalizeAnchorText(text).split(' ').slice(-CHUNK_TOKENS).join(' ');
}

function stringCells(value: unknown): string[] {
  if (typeof value === 'string') return [value];
  if (typeof value === 'number') return [String(value)];
  if (Array.isArray(value)) return value.flatMap(stringCells);
  return [];
}

/** Retained-content chunks (text only) of the record kinds this module covers. */
function rawChunks(
  record: RulesRecord,
): readonly { pointer: string; texts: readonly string[] }[] {
  const data = record.data as Record<string, unknown>;
  if (record.kind === 'table' && Array.isArray(data.rows)) {
    return data.rows.map((row, i) => {
      const cells = stringCells(row).filter((cell) => cell.trim() !== '');
      const longest = [...cells].sort((a, b) => b.length - a.length)[0];
      // Whole row first (a row's cells print contiguously on one line), then
      // the longest cell's words when the row wraps across lines.
      // The fallback needs a long cell: a short wrapped cell ("Ability Score
      // Improvement") collides with unrelated prose headings on a
      // neighbouring page, which would cite a page the row is not printed on.
      const longCell =
        longest !== undefined &&
        normalizeAnchorText(longest).split(' ').length >= MIN_CELL_TOKENS
          ? [longest]
          : [];
      return { pointer: `/rows/${i}`, texts: [cells.join(' '), ...longCell] };
    });
  }
  if (record.kind === 'ancestry' && Array.isArray(data.traits)) {
    return (data.traits as { text?: unknown }[]).flatMap((trait, i) =>
      typeof trait.text === 'string'
        ? [
            {
              pointer: `/traits/${i}/text#head`,
              texts: [headTokens(trait.text)],
            },
            {
              pointer: `/traits/${i}/text#tail`,
              texts: [tailTokens(trait.text)],
            },
          ]
        : [],
    );
  }
  if (record.kind === 'magic-item' && Array.isArray(data.variants)) {
    return (data.variants as { text?: unknown }[]).flatMap((variant, i) => {
      if (typeof variant.text !== 'string') return [];
      // "d8 creatures: 1 Weasel; 2 Giant rat; ..." — each "N Name" entry is a
      // printed table row's cells.
      const items = variant.text.includes(':')
        ? variant.text.slice(variant.text.indexOf(':') + 1).split(/;\s*/)
        : [];
      return items
        .map((item) => item.trim())
        .filter((item) => item.split(/\s+/).length >= 2)
        .map((item, j) => ({
          pointer: `/variants/${i}/text#${j}`,
          texts: [item],
        }));
    });
  }
  return [];
}

/** Each retained chunk of `record` with the window pages it is printed on. */
export function contentChunks(
  record: RulesRecord,
  normalizedPages: NormalizedPages,
): readonly ContentChunk[] {
  const locator = record.provenance.locator;
  let anchor: number;
  try {
    anchor = citedPages(locator)[0];
  } catch {
    return [];
  }
  const window = windowPages(anchor, normalizedPages);
  const out: ContentChunk[] = [];
  for (const { pointer, texts } of rawChunks(record)) {
    for (const text of texts) {
      const pages = chunkPages(text, window, normalizedPages);
      if (pages.length > 0) {
        out.push({ pointer, text, pages });
        break; // the first reading that is printed anywhere decides
      }
    }
  }
  return out;
}

/** Pages to add to `record`'s locator so every printed chunk is cited. */
export function missingContentPages(
  record: RulesRecord,
  normalizedPages: NormalizedPages,
): readonly number[] {
  let cited: readonly number[];
  try {
    cited = citedPages(record.provenance.locator);
  } catch {
    return [];
  }
  const start = cited[0];
  const have = new Set(cited);
  const add = new Set<number>();
  for (const chunk of contentChunks(record, normalizedPages)) {
    if (chunk.pages.some((page) => have.has(page) || add.has(page))) continue;
    // Nearest page of the window to the record's own start.
    const nearest = [...chunk.pages].sort(
      (a, b) => Math.abs(a - start) - Math.abs(b - start) || a - b,
    )[0];
    add.add(nearest);
  }
  return [...add].sort((a, b) => a - b);
}

const SINGLE_PAGE_SOURCE = /^SRD 5\.1 p\. (\d+)$/;

/** Producer: fold content-derived continuation/inheritance pages into locators. */
export function enrichProvenanceFromContentSpans(
  records: readonly RulesRecord[],
  normalizedPages: NormalizedPages,
): RulesRecord[] {
  return records.map((record) => {
    const extra = missingContentPages(record, normalizedPages);
    if (extra.length === 0) return record;
    const pages = [
      ...new Set([...citedPages(record.provenance.locator), ...extra]),
    ].sort((a, b) => a - b);
    const locator = `pp. ${pages.join(', ')}`;
    return {
      ...record,
      source: SINGLE_PAGE_SOURCE.test(record.source)
        ? `SRD 5.1 ${locator}`
        : record.source,
      provenance: { ...record.provenance, locator },
    };
  });
}
