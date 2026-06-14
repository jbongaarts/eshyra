/**
 * Appendix PH-B deity-table parser for the D&D 5e SRD 5.1 importer
 * (eshyra-4a7.10.5).
 *
 * The four "Fantasy-Historical Pantheons" deity tables (Celtic, Greek,
 * Egyptian, Norse) are four-column reference tables —
 * Deity | Alignment | Suggested Domains | Symbol — but PDF text extraction
 * does NOT preserve their column geometry. pdfjs emits each two-column page's
 * entire LEFT text column top-to-bottom, then the RIGHT text column, so the
 * deity-NAME column (left) and the alignment/domain/symbol columns (right)
 * arrive as separate, page-interleaved blocks rather than as rows. The blocks
 * also straddle page boundaries (Celtic spans pp360-361, Norse spans
 * pp361-362).
 *
 * Reconstruction relies on one robust invariant: across the whole appendix
 * both streams enumerate the SAME deities in the SAME pantheon order and the
 * same intra-pantheon order. So the parser collects two ordered streams and
 * zips them positionally:
 *
 *   - the NAME stream: every line shaped like "<Name>, god/goddess of …"
 *     (each deity row is a single extracted line), tagged with the pantheon of
 *     the most recent "<Pantheon> Deities" caption;
 *   - the RIGHT stream: every line that begins with an alignment code
 *     (LG/NG/CG/LN/N/CN/LE/NE/CE) starts a new "Alignment Suggested-Domains
 *     Symbol" row; a following line that does NOT begin with an alignment code
 *     is a wrapped symbol cell and is appended to the current row (e.g.
 *     "NG Life" + "Mare s head"). Column-group header lines ("Deity",
 *     "Deity Alignment", "Suggested Domains Symbol", "Alignment Suggested
 *     Domains Symbol") are skipped.
 *
 * The two streams must have equal length; each right row must split cleanly
 * into a valid alignment, one or more known cleric domains, and a non-empty
 * symbol. Any mismatch throws — a corrupted or partially extracted appendix
 * fails closed rather than emitting misaligned deity rows. A slice with no
 * deity captions at all (reduced fixture PDFs without PH-B) yields no tables.
 *
 * Note on apostrophes: a handful of symbol cells extract without their
 * apostrophe ("Mare s head", "Lion s head", "Woman s face", "cow s head") —
 * a pdfjs glyph artifact local to these table cells (the surrounding prose
 * keeps its U+2019). The text is emitted verbatim; restoring the glyph would
 * require a global extractor change with pack-wide blast radius.
 */

import type { PageText, TableExtraction } from './types.js';

/** Pantheon names in their canonical SRD column order. */
const PANTHEONS = ['Celtic', 'Greek', 'Egyptian', 'Norse'] as const;
type Pantheon = (typeof PANTHEONS)[number];

const CAPTION_BY_TEXT = new Map<string, Pantheon>(
  PANTHEONS.map((p) => [`${p} Deities`, p]),
);

/** The eight SRD 5.1 cleric domains that appear in the Suggested Domains cell. */
const DOMAINS = new Set([
  'Death',
  'Knowledge',
  'Life',
  'Light',
  'Nature',
  'Tempest',
  'Trickery',
  'War',
]);

/** Two-letter (and the lone "N") alignment codes that lead each right-side row. */
const ALIGNMENT_CODES = new Set([
  'LG',
  'NG',
  'CG',
  'LN',
  'N',
  'CN',
  'LE',
  'NE',
  'CE',
]);

/** Below this rendered font height a line is a deity-table cell, not prose. */
const CELL_MAX_H = 9.3;

const ALIGNMENT_START = /^(LG|LN|LE|NG|NE|CG|CN|CE|N)\s/;
const DEITY_NAME = /,\s+(god|goddess)\b/i;

function isColumnHeader(text: string): boolean {
  return (
    text === 'Deity' ||
    text === 'Deity Alignment' ||
    text.endsWith('Suggested Domains Symbol')
  );
}

export class DeityTableError extends Error {
  constructor(message: string) {
    super(`SRD 5.1 deity-table reconstruction failed: ${message}`);
    this.name = 'DeityTableError';
  }
}

interface DeityName {
  readonly text: string;
  readonly pantheon: Pantheon;
}

interface ParsedRight {
  readonly alignment: string;
  readonly domains: string;
  readonly symbol: string;
}

/** Split one stitched right-side row into its three cells, or throw. */
function parseRightRow(row: string): ParsedRight {
  const tokens = row.split(/\s+/).filter((t) => t.length > 0);
  const alignment = tokens[0];
  if (alignment === undefined || !ALIGNMENT_CODES.has(alignment)) {
    throw new DeityTableError(
      `right-side row does not start with an alignment code: "${row}"`,
    );
  }
  let i = 1;
  const domains: string[] = [];
  while (i < tokens.length) {
    const word = tokens[i].replace(/,$/, '');
    if (!DOMAINS.has(word)) break;
    domains.push(word);
    i++;
  }
  if (domains.length === 0) {
    throw new DeityTableError(
      `row "${row}" has no recognized Suggested Domain`,
    );
  }
  const symbol = tokens.slice(i).join(' ');
  if (symbol.length === 0) {
    throw new DeityTableError(`row "${row}" has an empty Symbol cell`);
  }
  return { alignment, domains: domains.join(', '), symbol };
}

/**
 * Reconstruct the four PH-B deity tables from the Fantasy-Historical Pantheons
 * slice. Returns `[]` when the slice carries no deity captions (a reduced
 * fixture without the appendix); otherwise returns exactly the captioned
 * tables in source order, or throws on any structural inconsistency.
 */
export function parseDeityTables(
  pages: readonly PageText[],
): readonly TableExtraction[] {
  const names: DeityName[] = [];
  const rights: string[] = [];
  const captionPage = new Map<Pantheon, number>();
  const order: Pantheon[] = [];
  let current: Pantheon | undefined;

  for (const page of pages) {
    const heights = page.lineHeights;
    for (let i = 0; i < page.lines.length; i++) {
      const text = page.lines[i].trim();
      if (text.length === 0) continue;
      const caption = CAPTION_BY_TEXT.get(text);
      if (caption !== undefined) {
        current = caption;
        if (!captionPage.has(caption)) {
          captionPage.set(caption, page.pageNumber);
          order.push(caption);
        }
        continue;
      }
      const height = heights?.[i];
      // Only the cell-tier lines (h≈8.9) carry deity-table content; prose
      // (h≈9.8) and headings (h≥12) are not table rows. Slices without
      // per-line heights (uniform-font fixtures) never reach the captions
      // above and so produce no tables.
      if (height === undefined || height >= CELL_MAX_H) continue;
      if (isColumnHeader(text)) continue;
      if (DEITY_NAME.test(text)) {
        if (current === undefined) {
          throw new DeityTableError(
            `deity row "${text}" appears before any pantheon caption`,
          );
        }
        names.push({ text, pantheon: current });
        continue;
      }
      if (ALIGNMENT_START.test(text)) {
        rights.push(text);
        continue;
      }
      // A non-alignment, non-name cell line is a wrapped Symbol continuation.
      const last = rights.length - 1;
      if (last < 0) {
        throw new DeityTableError(
          `unexpected cell line before any alignment row: "${text}"`,
        );
      }
      rights[last] = `${rights[last]} ${text}`;
    }
  }

  if (order.length === 0) return [];
  if (names.length !== rights.length) {
    throw new DeityTableError(
      `deity name/attribute count mismatch: ${names.length} name(s) vs ${rights.length} attribute row(s)`,
    );
  }

  const rowsByPantheon = new Map<Pantheon, (readonly string[])[]>(
    order.map((p) => [p, []]),
  );
  for (let i = 0; i < names.length; i++) {
    const { text, pantheon } = names[i];
    const right = parseRightRow(rights[i]);
    const bucket = rowsByPantheon.get(pantheon);
    if (bucket === undefined) {
      throw new DeityTableError(
        `deity "${text}" has pantheon "${pantheon}" with no caption`,
      );
    }
    bucket.push([text, right.alignment, right.domains, right.symbol]);
  }

  return order.map((pantheon) => {
    const rows = rowsByPantheon.get(pantheon) ?? [];
    if (rows.length === 0) {
      throw new DeityTableError(
        `pantheon "${pantheon}" produced no deity rows`,
      );
    }
    return {
      name: `${pantheon} Deities`,
      columns: ['Deity', 'Alignment', 'Suggested Domains', 'Symbol'],
      rows,
      sourcePage: captionPage.get(pantheon) ?? pages[0]?.pageNumber ?? 0,
    };
  });
}
