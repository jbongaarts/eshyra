/**
 * Strip embedded-table linearizations from owner prose (eshyra-3anh).
 *
 * The SRD prints several tables *inside* another record's body (a magic item, a
 * spell, or a class/subclass feature). The prose joiners in `parseMagicItems`,
 * `parseSpells`, and the rule/feature parsers reflow every body line into the
 * record's `description`/`text`, so the table's caption/header/cell run is
 * absorbed as a flattened, column-interleaved run of cells — e.g. Necklace of
 * Prayer Beads ends "…20 Wind Wind walk walking", Teleport carries "…Off On
 * Familiarity Mishap Area Target Target…". That run is unreadable as prose and
 * duplicates data already modeled exactly by a `table:*` record.
 *
 * `parseDocumentTables` captures each table's verbatim source span
 * (`TableExtraction.proseSourceText`) and its reviewed owner
 * (`TableExtraction.ownerRecordKey`). This pass removes that span from the
 * owner's prose, leaving the structured `table:*` record as the sole
 * representation. The cell-tier run is, by construction, table content rather
 * than prose, so no authored prose is removed. The table records are untouched.
 *
 * Both functions are pure and operate on the assembled records, so the strip is
 * deterministic and the committed pack round-trips through it unchanged.
 */

import type { RulesRecord } from '../../../src/rules/types.js';
import type { TableExtraction } from './types.js';

export class EmbeddedTableProseError extends Error {
  override readonly name = 'EmbeddedTableProseError';
}

const PROSE_FIELDS = ['description', 'text'] as const;
type ProseField = (typeof PROSE_FIELDS)[number];

function proseFieldOf(record: RulesRecord): ProseField | undefined {
  const data = record.data;
  if (data === null || typeof data !== 'object' || Array.isArray(data)) {
    return undefined;
  }
  const obj = data as Record<string, unknown>;
  for (const field of PROSE_FIELDS) {
    if (typeof obj[field] === 'string') return field;
  }
  return undefined;
}

/**
 * Repair the seams left where a table span was removed: collapse the runs of
 * inline whitespace and the blank-line gaps the removal opens, without touching
 * the paragraph structure of the surrounding prose.
 */
function reflowProse(text: string): string {
  return text
    .replace(/[^\S\n]{2,}/g, ' ') // runs of spaces/tabs -> single space
    .replace(/[^\S\n]+\n/g, '\n') // trailing inline space before a newline
    .replace(/\n[^\S\n]+/g, '\n') // leading inline space after a newline
    .replace(/\n{3,}/g, '\n\n') // collapse blank-line runs
    .trim();
}

interface StripInput {
  readonly records: readonly RulesRecord[];
  readonly tables: readonly TableExtraction[];
}

/** Owner record key -> verbatim table spans to remove from that record's prose. */
function spansByOwner(
  tables: readonly TableExtraction[],
): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const table of tables) {
    const owner = table.ownerRecordKey;
    const span = table.proseSourceText;
    if (owner === undefined || span === undefined || span.length === 0)
      continue;
    const list = out.get(owner) ?? [];
    list.push(span);
    out.set(owner, list);
  }
  return out;
}

/**
 * Remove every reviewed embedded-table span from its owner record's prose.
 *
 * Fails closed if an owner key names no emitted record or names a record with no
 * prose field. A span that is absent from the owner's prose is a no-op: some
 * owners (e.g. `rule:half-dragon-template`) already exclude the table region in
 * their own parser, and the post-strip assertion proves nothing was missed.
 */
export function stripEmbeddedTableProse(input: StripInput): RulesRecord[] {
  const owners = spansByOwner(input.tables);
  const byKey = new Map(input.records.map((record) => [record.key, record]));
  for (const ownerKey of owners.keys()) {
    if (!byKey.has(ownerKey)) {
      throw new EmbeddedTableProseError(
        `embedded-table owner ${ownerKey} is not an emitted record`,
      );
    }
  }
  return input.records.map((record) => {
    const spans = owners.get(record.key);
    if (spans === undefined) return record;
    const field = proseFieldOf(record);
    if (field === undefined) {
      throw new EmbeddedTableProseError(
        `embedded-table owner ${record.key} has no description/text prose to strip`,
      );
    }
    const data = record.data as Record<string, unknown>;
    let text = data[field] as string;
    // Longest spans first so an overlapping super-span (e.g. Cube of Force's two
    // adjacent cell runs captured as one) is removed before any sub-span.
    for (const span of [...spans].sort((a, b) => b.length - a.length)) {
      if (text.includes(span)) {
        text = reflowProse(text.replaceAll(span, ' '));
      }
    }
    return { ...record, data: { ...data, [field]: text } };
  });
}

/**
 * Fail closed if any captured table span still appears verbatim in a prose
 * field. This is the completeness guard for the owner allowlist: a genuinely
 * embedded table with no (or a wrong) owner leaves its span in prose and trips
 * here, so a missed mapping cannot ship silently. Standalone tables whose spans
 * never appear in prose are inert.
 */
export function assertNoEmbeddedTableLinearization(input: StripInput): void {
  const proseRecords = input.records.flatMap((record) => {
    const field = proseFieldOf(record);
    if (field === undefined) return [];
    return [
      { key: record.key, text: (record.data as Record<string, string>)[field] },
    ];
  });
  const leaks: string[] = [];
  for (const table of input.tables) {
    const span = table.proseSourceText;
    // Short spans are too generic to attribute to a specific table; the real
    // embedded tables all carry a header line plus rows and clear this floor.
    if (span === undefined || span.length < 12) continue;
    for (const record of proseRecords) {
      if (record.text.includes(span)) {
        leaks.push(`${table.name} -> ${record.key}`);
      }
    }
  }
  if (leaks.length > 0) {
    throw new EmbeddedTableProseError(
      `embedded table linearization remains in prose after strip: ${[...new Set(leaks)].sort().join('; ')}`,
    );
  }
}
