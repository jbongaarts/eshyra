/**
 * Source-derived TOOLS-TABLE ROW GATE for the D&D 5e SRD 5.1 importer
 * (eshyra-o9bd.19.2.2.2, registry row vehicle-tool-row / opus:F-17).
 *
 * The invariant: every row the SRD prints in the Tools table (p. 70) has
 * exactly one emitted `equipment` record of category `tool` with the same
 * name and the same cost/weight cells, and no tool record exists that the
 * table does not print. The "Vehicles (land or water) * *" row was once used
 * only as the table terminator and never emitted.
 *
 * The denominator is taken from the extracted SOURCE, independently of
 * `collectTools`: the table is anchored by its "Tools" caption followed by
 * the "Item Cost Weight" column header and runs to the first footnote line
 * ("* …"). Each line in that span is either a reviewed cell-less group
 * header or a row "<name> <cost> <weight>", split by this module's own cell
 * grammar. Any other line is reported rather than guessed at.
 */
import type { RulesRecord } from '../../../src/rules/types.js';
import type { PageText } from './types.js';

export class ToolsTableRowParityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ToolsTableRowParityError';
  }
}

const CAPTION = /^Tools$/;
const COLUMN_HEADER = /^Item Cost Weight$/;
const FOOTNOTE = /^\* /;
// "*" is the footnote marker the Vehicles row prints in both cells.
const ROW =
  /^(.+?) (\d[\d,]* (?:cp|sp|ep|gp|pp)|\*) ((?:\d+|½|\d+\/\d+) lb\.|—|\*)$/;

/** The table's cell-less group headers; they name groups, not items. */
export const TOOLS_TABLE_GROUP_HEADERS: ReadonlySet<string> = new Set([
  'Artisan’s tools',
  'Gaming set',
  'Musical instrument',
]);

export interface ToolsTableSourceRow {
  readonly name: string;
  /** Printed cost cell, or undefined when the cell is the "*" marker. */
  readonly cost?: string;
  /** Printed weight cell, or undefined when the cell is "—" or "*". */
  readonly weight?: string;
}

export interface ToolsTableRowAudit {
  /** False when the caption + column header was not found in the source. */
  readonly anchored: boolean;
  readonly sourceRows: readonly ToolsTableSourceRow[];
  /** Table lines that are neither a row nor a reviewed group header. */
  readonly unclassified: readonly string[];
  readonly missing: readonly string[];
  readonly unexpected: readonly string[];
  readonly duplicated: readonly string[];
  readonly cellMismatches: readonly string[];
}

function cell(value: string, absent: readonly string[]): string | undefined {
  return absent.includes(value) ? undefined : value;
}

/** Observe the printed Tools rows and compare them to emitted tool records. */
export function auditToolsTableRows(
  records: readonly RulesRecord[],
  pages: readonly PageText[],
): ToolsTableRowAudit {
  const lines = pages.flatMap((page) => page.lines.map((line) => line.trim()));
  let start = -1;
  for (let i = 0; i + 1 < lines.length; i++) {
    if (CAPTION.test(lines[i]) && COLUMN_HEADER.test(lines[i + 1])) {
      start = i + 2;
      break;
    }
  }
  const sourceRows: ToolsTableSourceRow[] = [];
  const unclassified: string[] = [];
  if (start !== -1) {
    for (let i = start; i < lines.length && !FOOTNOTE.test(lines[i]); i++) {
      const line = lines[i];
      if (TOOLS_TABLE_GROUP_HEADERS.has(line)) continue;
      const row = ROW.exec(line);
      if (row === null) {
        unclassified.push(line);
        continue;
      }
      const cost = cell(row[2], ['*']);
      const weight = cell(row[3], ['*', '—']);
      sourceRows.push({
        name: row[1],
        ...(cost === undefined ? {} : { cost }),
        ...(weight === undefined ? {} : { weight }),
      });
    }
  }

  const tools = records.filter(
    (record) =>
      record.kind === 'equipment' &&
      (record.data as { category?: unknown }).category === 'tool',
  );
  const emittedByName = new Map<string, RulesRecord[]>();
  for (const record of tools) {
    emittedByName.set(record.name, [
      ...(emittedByName.get(record.name) ?? []),
      record,
    ]);
  }
  const sourceNames = new Set(sourceRows.map((row) => row.name));
  const missing: string[] = [];
  const cellMismatches: string[] = [];
  for (const row of sourceRows) {
    const emitted = emittedByName.get(row.name)?.[0];
    if (emitted === undefined) {
      missing.push(row.name);
      continue;
    }
    const data = emitted.data as { cost?: unknown; weight?: unknown };
    if (data.cost !== row.cost || data.weight !== row.weight) {
      cellMismatches.push(
        `${row.name}: source cost/weight ${row.cost ?? '(none)'}/${row.weight ?? '(none)'}, emitted ${String(data.cost ?? '(none)')}/${String(data.weight ?? '(none)')}`,
      );
    }
  }
  return {
    anchored: start !== -1,
    sourceRows,
    unclassified,
    missing,
    unexpected: tools
      .filter((record) => !sourceNames.has(record.name))
      .map((record) => record.key),
    duplicated: [
      ...[...emittedByName]
        .filter(([, list]) => list.length > 1)
        .map(([name]) => `emitted ${name}`),
      ...sourceRows
        .map((row) => row.name)
        .filter((name, i, all) => all.indexOf(name) !== i)
        .map((name) => `printed ${name}`),
    ],
    cellMismatches,
  };
}

/**
 * Fail closed when the emitted tool records disagree with the printed Tools
 * table rows. `requireComplete` is set only for the real import, where the
 * table must be found; reduced fixture PDFs without it check nothing.
 */
export function assertToolsTableRowParity(
  records: readonly RulesRecord[],
  pages: readonly PageText[],
  options: { readonly requireComplete: boolean },
): void {
  const audit = auditToolsTableRows(records, pages);
  const problems: string[] = [];
  if (!audit.anchored) {
    if (options.requireComplete) {
      problems.push('Tools caption + "Item Cost Weight" header not found');
    }
  } else {
    problems.push(
      ...audit.unclassified.map((line) => `unclassified table line: ${line}`),
      ...audit.missing.map((name) => `printed row not emitted: ${name}`),
      ...audit.unexpected.map((key) => `tool record not printed: ${key}`),
      ...audit.duplicated.map((name) => `duplicated row: ${name}`),
      ...audit.cellMismatches,
    );
  }
  if (problems.length > 0) {
    throw new ToolsTableRowParityError(
      `Tools table row parity gate failed (eshyra-o9bd.19.2.2.2):\n  ${problems.join('\n  ')}`,
    );
  }
}
