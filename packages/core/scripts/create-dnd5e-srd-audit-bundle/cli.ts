/**
 * Audit bundle creator for the committed D&D SRD 5.1 rules pack.
 *
 * Produces a self-contained directory under .audit-bundles/ (or the path given
 * as the first CLI argument) for external/manual review of the committed pack
 * against the vendored SRD 5.1 PDF. The bundle contains:
 *
 *   pack/         Committed pack artifacts (records.json, manifest.json)
 *   source/       Vendored source artifacts (PDF, manifest, README)
 *   command-output/  Captured stdout+stderr+exit-code for key npm scripts
 *   pdf-text/     Per-page plain text + all-pages.txt
 *   reports/      Machine-readable audit summaries (JSON + text)
 *   README.md     Bundle overview and file glossary
 *   metadata.json Git commit, branch, timestamp, and source artifact hash
 *
 * Usage:
 *   npm run audit-bundle:dnd5e-srd
 *     # writes to .audit-bundles/dnd5e-srd-audit-bundle
 *     # and copies .audit-bundles/dnd5e-srd-audit-bundle.zip to /mnt/d/dnd5e-srd-audit-bundle.zip
 *
 *   npm run audit-bundle:dnd5e-srd -- <bundle-dir> <zip-copy-path>
 *     # writes to <bundle-dir> and copies the zip to <zip-copy-path>
 *
 * Exit codes:
 *   0  Bundle created successfully.
 *   1  A required artifact was missing or an unrecoverable error occurred.
 */

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  cpSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import {
  assertEquipmentResolution,
  auditEquipmentResolution,
  auditHasFindings,
  auditPack,
  auditSrd,
  auditSrdChoiceProse,
  auditSrdPlayability,
  countSrdPlayabilityByCategory,
  type EquipmentResolutionResult,
  formatAuditReport,
  formatSrdAuditReport,
  formatSrdChoiceProseReport,
  formatSrdPlayabilityReport,
  getAncestryAbilityScoreIncrease,
  getAncestryLanguages,
  getBackgroundLanguages,
  getClassSpellcasting,
  getClassStartingEquipment,
  loadRulesPackFromDirectory,
  type RulesPack,
  RulesPackError,
  type RulesRecord,
  SRD_5_1_STANDALONE_TABLES,
  SRD_5_1_TABLE_OWNERS,
  type SrdAuditFinding,
  type SrdChoiceProseFinding,
  type SrdPlayabilityFinding,
  srdAuditHasFindings,
  srdChoiceProseHasFindings,
  srdPlayabilityHasFindings,
} from '../../src/internal.js';
import {
  EXPECTED_SRD_5_1_ANCESTRY_NAMES,
  EXPECTED_SRD_5_1_CREATURE_NAMES,
  EXPECTED_SRD_5_1_NPC_NAMES,
} from '../importers/dnd5e-srd-5.1/index.js';
import {
  SOURCE_EXPECTED_SRD_5_1_MAGIC_ITEM_NAMES,
  SOURCE_EXPECTED_SRD_5_1_RULE_KEYS,
  SOURCE_EXPECTED_SRD_5_1_TABLE_NAMES,
} from '../importers/dnd5e-srd-5.1/sourceCoverage.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, '../../../..');
const COMMITTED_PACK_DIR = join(
  REPO_ROOT,
  'packages/core/data/rules-packs/rules__dnd5e-srd-5.1',
);
const SOURCE_DIR = join(REPO_ROOT, 'packages/core/sources/dnd5e-srd-5.1');
const PDF_PATH = join(SOURCE_DIR, 'SRD_CC_v5.1.pdf');
const DEFAULT_OUT_DIR = join(
  REPO_ROOT,
  '.audit-bundles/dnd5e-srd-audit-bundle',
);
const DEFAULT_HOST_ZIP_COPY_PATH = '/mnt/d/dnd5e-srd-audit-bundle.zip';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function log(msg: string): void {
  process.stdout.write(`${msg}\n`);
}

function sha256File(path: string): string {
  const buf = readFileSync(path);
  return createHash('sha256').update(buf).digest('hex');
}

function captureCommand(
  script: string,
  extraArgs: string[] = [],
): { stdout: string; stderr: string; exitCode: number; combined: string } {
  const fullCmd = `npm run ${script}${extraArgs.length ? ` -- ${extraArgs.join(' ')}` : ''}`;
  const result = spawnSync(fullCmd, [], {
    cwd: REPO_ROOT,
    shell: true,
    encoding: 'utf8',
    timeout: 300_000,
    maxBuffer: 50 * 1024 * 1024,
  });
  const stdout = result.stdout ?? '';
  const stderr = result.stderr ?? '';
  const exitCode = result.status ?? 1;
  const header = [
    `Command: npm run ${script}${extraArgs.length ? ` -- ${extraArgs.join(' ')}` : ''}`,
    `Exit code: ${exitCode}`,
    '',
    '--- stdout ---',
    '',
  ].join('\n');
  const combined = [header, stdout, '', '--- stderr ---', '', stderr].join(
    '\n',
  );
  return { stdout, stderr, exitCode, combined };
}

// ---------------------------------------------------------------------------
// PDF text extraction
// ---------------------------------------------------------------------------

export interface PdfItem {
  readonly str: string;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

interface PageExtractResult {
  readonly pageNumber: number;
  /** Human-readable text: y-groups sorted top-to-bottom, items within each
   *  group sorted left-to-right by x-coordinate. Review aid only — not a
   *  canonical parser output; multi-column and stat-block pages may still
   *  interleave across columns at the same y-baseline. */
  readonly text: string;
  /** Raw coordinate-preserving items from pdfjs, in document stream order.
   *  Use these (with x/y) for position-sensitive source-vs-pack review. */
  readonly items: readonly PdfItem[];
}

async function extractPdfPages(pdfPath: string): Promise<PageExtractResult[]> {
  const buffer = readFileSync(pdfPath);
  const owned = new Uint8Array(buffer);
  const loadingTask = getDocument({ data: owned, verbosity: 0 });
  const pdf = await loadingTask.promise;
  try {
    const pages: PageExtractResult[] = [];
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      try {
        const content = await page.getTextContent();
        const items: PdfItem[] = [];
        // Bucket by y, keeping {str, x} so we can sort left-to-right before
        // joining. pdfjs stream order is not guaranteed to be left-to-right
        // within a y-band — especially on two-column and stat-block pages.
        const lineMap = new Map<number, Array<{ str: string; x: number }>>();
        for (const item of content.items) {
          const it = item as {
            str?: string;
            transform?: number[];
            width?: number;
            height?: number;
          };
          if (typeof it.str !== 'string' || !it.transform) continue;
          const x = it.transform[4] ?? 0;
          const y = it.transform[5] ?? 0;
          const width = it.width ?? 0;
          const height = it.height ?? 0;
          items.push({ str: it.str, x, y, width, height });
          const yKey = Math.round(y * 10) / 10;
          const bucket = lineMap.get(yKey);
          if (bucket === undefined) {
            lineMap.set(yKey, [{ str: it.str, x }]);
          } else {
            bucket.push({ str: it.str, x });
          }
        }
        const sortedYs = [...lineMap.keys()].sort((a, b) => b - a);
        const lines = sortedYs.map((yKey) => {
          const bucket = lineMap.get(yKey) ?? [];
          bucket.sort((a, b) => a.x - b.x);
          return bucket
            .map((e) => e.str)
            .join(' ')
            .trimEnd();
        });
        pages.push({ pageNumber: i, text: lines.join('\n'), items });
      } finally {
        page.cleanup();
      }
    }
    return pages;
  } finally {
    await pdf.cleanup();
    await pdf.destroy();
  }
}

// ---------------------------------------------------------------------------
// Unicode / control-character scan
// ---------------------------------------------------------------------------

interface UnicodeFinding {
  readonly key: string;
  readonly kind: string;
  readonly field: string;
  readonly codePoints: readonly string[];
}

// Code points for invisible hyphens the SRD importer normalizes away:
// U+00AD SOFT HYPHEN, U+2010 HYPHEN, U+2011 NON-BREAKING HYPHEN.
const INVISIBLE_HYPHEN_CPS = new Set([0x00ad, 0x2010, 0x2011]);

function cpHex(cp: number): string {
  return `U+${cp.toString(16).toUpperCase().padStart(4, '0')}`;
}

function isUnwantedControlChar(cp: number): boolean {
  if (cp === 0x09 || cp === 0x0a || cp === 0x0d) return false; // \t \n \r are fine
  return (
    cp <= 0x08 ||
    cp === 0x0b ||
    cp === 0x0c ||
    (cp >= 0x0e && cp <= 0x1f) ||
    (cp >= 0x7f && cp <= 0x9f)
  );
}

function scanRecordsForUnicode(
  records: readonly Record<string, unknown>[],
): UnicodeFinding[] {
  const findings: UnicodeFinding[] = [];
  for (const record of records) {
    const key = String(record.key ?? '');
    const kind = String(record.kind ?? '');
    scanObject(key, kind, record, '', findings);
  }
  return findings;
}

function scanObject(
  key: string,
  kind: string,
  obj: unknown,
  fieldPath: string,
  out: UnicodeFinding[],
): void {
  if (typeof obj === 'string') {
    const found: string[] = [];
    for (const ch of obj) {
      const cp = ch.codePointAt(0) ?? 0;
      if (INVISIBLE_HYPHEN_CPS.has(cp) || isUnwantedControlChar(cp)) {
        const s = cpHex(cp);
        if (!found.includes(s)) found.push(s);
      }
    }
    if (found.length > 0) {
      out.push({ key, kind, field: fieldPath || '(root)', codePoints: found });
    }
    return;
  }
  if (Array.isArray(obj)) {
    for (let i = 0; i < obj.length; i++) {
      scanObject(key, kind, obj[i], `${fieldPath}[${i}]`, out);
    }
    return;
  }
  if (obj !== null && typeof obj === 'object') {
    for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
      const path = fieldPath ? `${fieldPath}.${k}` : k;
      scanObject(key, kind, v, path, out);
    }
  }
}

// ---------------------------------------------------------------------------
// Source hash verification
// ---------------------------------------------------------------------------

function verifySourceHash(
  pdfPath: string,
  manifestPath: string,
): { actual: string; expected: string; match: boolean; report: string } {
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as {
    artifact?: { sha256?: string; sizeBytes?: number };
  };
  const expected = manifest.artifact?.sha256 ?? '(not in manifest)';
  const expectedSize = manifest.artifact?.sizeBytes ?? -1;
  const actual = sha256File(pdfPath);
  const actualSize = readFileSync(pdfPath).byteLength;
  const match = actual === expected;
  const lines = [
    `PDF: ${pdfPath}`,
    `Expected SHA-256: ${expected}`,
    `Actual SHA-256:   ${actual}`,
    `Hash match: ${match ? 'YES' : 'NO — MISMATCH'}`,
    `Expected size: ${expectedSize} bytes`,
    `Actual size:   ${actualSize} bytes`,
    `Size match: ${actualSize === expectedSize ? 'YES' : 'NO — MISMATCH'}`,
  ];
  return { actual, expected, match, report: lines.join('\n') };
}

// ---------------------------------------------------------------------------
// Record key listing
// ---------------------------------------------------------------------------

function recordKeysByKind(
  records: readonly Record<string, unknown>[],
): Record<string, string[]> {
  const byKind: Record<string, string[]> = {};
  for (const rec of records) {
    const kind = String(rec.kind ?? '');
    const key = String(rec.key ?? '');
    if (!byKind[kind]) byKind[kind] = [];
    byKind[kind].push(key);
  }
  for (const keys of Object.values(byKind)) keys.sort();
  return Object.fromEntries(
    Object.entries(byKind).sort(([a], [b]) => (a < b ? -1 : 1)),
  );
}

// ---------------------------------------------------------------------------
// Modeling-usability reports
// ---------------------------------------------------------------------------

function dataObject(record: RulesRecord): Record<string, unknown> | null {
  const data = record.data;
  return data !== null && typeof data === 'object' && !Array.isArray(data)
    ? (data as Record<string, unknown>)
    : null;
}

function sortedJson(value: unknown): string {
  return JSON.stringify(value, (_key, entry: unknown) => {
    if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) {
      return entry;
    }
    return Object.fromEntries(
      Object.entries(entry as Record<string, unknown>).sort(([a], [b]) =>
        a < b ? -1 : a > b ? 1 : 0,
      ),
    );
  });
}

function valuesEqual(a: unknown, b: unknown): boolean {
  return sortedJson(a) === sortedJson(b);
}

function objectValue(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function arrayValue(value: unknown): readonly unknown[] {
  return Array.isArray(value) ? value : [];
}

function stringValue(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value : null;
}

function classRecords(pack: RulesPack): RulesRecord[] {
  return pack.records
    .filter((record) => record.kind === 'class')
    .sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
}

function buildTypedAdvancementCoverageReport(pack: RulesPack): {
  readonly summary: {
    readonly classes: number;
    readonly expectedRows: number;
    readonly rowsPresent: number;
    readonly rowsWithTypedAdvancement: number;
    readonly rowsMissingTypedAdvancement: number;
    readonly unknownAdvancementKinds: number;
  };
  readonly classes: readonly {
    readonly key: string;
    readonly name: string;
    readonly rowsPresent: number;
    readonly levelsPresent: readonly number[];
    readonly missingLevels: readonly number[];
    readonly rowsWithTypedAdvancement: number;
    readonly rowsMissingTypedAdvancement: readonly number[];
    readonly advancementKinds: Readonly<Record<string, number>>;
    readonly unknownAdvancementEntries: readonly {
      readonly level: number | string;
      readonly value: unknown;
    }[];
  }[];
} {
  const knownKinds = new Set([
    'featureGrant',
    'subclassFeatureSlot',
    'featureImprovement',
    'resourceProgression',
    'spellcastingProgression',
  ]);
  const expectedLevels = Array.from({ length: 20 }, (_, index) => index + 1);
  const classes = classRecords(pack).map((record) => {
    const data = dataObject(record);
    const progression = arrayValue(data?.progression);
    const levelsPresent: number[] = [];
    const missingTyped: number[] = [];
    const advancementKinds: Record<string, number> = {};
    const unknownAdvancementEntries: {
      level: number | string;
      value: unknown;
    }[] = [];
    let rowsWithTypedAdvancement = 0;

    for (const rowValue of progression) {
      const row = objectValue(rowValue);
      const level = typeof row?.level === 'number' ? row.level : '(unknown)';
      if (typeof level === 'number') levelsPresent.push(level);
      const advancement = row === null ? [] : arrayValue(row.advancement);
      if (!Array.isArray(row?.advancement)) {
        if (typeof level === 'number') missingTyped.push(level);
        continue;
      }
      rowsWithTypedAdvancement += 1;
      for (const entryValue of advancement) {
        const entry = objectValue(entryValue);
        const kind = stringValue(entry?.kind);
        if (kind !== null && knownKinds.has(kind)) {
          advancementKinds[kind] = (advancementKinds[kind] ?? 0) + 1;
        } else {
          unknownAdvancementEntries.push({ level, value: entryValue });
        }
      }
    }

    const presentSet = new Set(levelsPresent);
    return {
      key: record.key,
      name: record.name,
      rowsPresent: progression.length,
      levelsPresent: levelsPresent.sort((a, b) => a - b),
      missingLevels: expectedLevels.filter((level) => !presentSet.has(level)),
      rowsWithTypedAdvancement,
      rowsMissingTypedAdvancement: missingTyped,
      advancementKinds: Object.fromEntries(
        Object.entries(advancementKinds).sort(([a], [b]) =>
          a < b ? -1 : a > b ? 1 : 0,
        ),
      ),
      unknownAdvancementEntries,
    };
  });
  const summary = {
    classes: classes.length,
    expectedRows: classes.length * 20,
    rowsPresent: classes.reduce((sum, entry) => sum + entry.rowsPresent, 0),
    rowsWithTypedAdvancement: classes.reduce(
      (sum, entry) => sum + entry.rowsWithTypedAdvancement,
      0,
    ),
    rowsMissingTypedAdvancement: classes.reduce(
      (sum, entry) => sum + entry.rowsMissingTypedAdvancement.length,
      0,
    ),
    unknownAdvancementKinds: classes.reduce(
      (sum, entry) => sum + entry.unknownAdvancementEntries.length,
      0,
    ),
  };
  return { summary, classes };
}

function formatTypedAdvancementCoverageReport(
  report: ReturnType<typeof buildTypedAdvancementCoverageReport>,
): string {
  const lines = [
    'Typed advancement coverage',
    `Classes: ${report.summary.classes}`,
    `Expected class/level rows: ${report.summary.expectedRows}`,
    `Rows present: ${report.summary.rowsPresent}`,
    `Rows with typed advancement[]: ${report.summary.rowsWithTypedAdvancement}`,
    `Rows missing typed advancement[]: ${report.summary.rowsMissingTypedAdvancement}`,
    `Unknown advancement entries: ${report.summary.unknownAdvancementKinds}`,
    '',
  ];
  for (const cls of report.classes) {
    lines.push(`${cls.key} (${cls.name})`);
    lines.push(
      `  rows=${cls.rowsPresent}, typed=${cls.rowsWithTypedAdvancement}, missingLevels=${cls.missingLevels.join(', ') || 'none'}, missingTyped=${cls.rowsMissingTypedAdvancement.join(', ') || 'none'}`,
    );
    lines.push(`  advancementKinds=${JSON.stringify(cls.advancementKinds)}`);
    if (cls.unknownAdvancementEntries.length > 0) {
      lines.push(
        `  unknownEntries=${cls.unknownAdvancementEntries.length} (see JSON)`,
      );
    }
  }
  return `${lines.join('\n')}\n`;
}

function choiceCategoryCounts(pack: RulesPack): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const record of pack.records) {
    const data = dataObject(record);
    for (const choice of arrayValue(data?.choices)) {
      const category = stringValue(objectValue(choice)?.category);
      if (category !== null) counts[category] = (counts[category] ?? 0) + 1;
    }
  }
  return Object.fromEntries(
    Object.entries(counts).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
  );
}

function buildChoiceCoverageReport(
  pack: RulesPack,
  findings: readonly SrdPlayabilityFinding[],
): {
  readonly summary: {
    readonly featureRecordsWithChoices: number;
    readonly structuredChoiceEntries: number;
    readonly findings: number;
  };
  readonly categories: Readonly<Record<string, number>>;
  readonly findings: readonly SrdPlayabilityFinding[];
} {
  let featureRecordsWithChoices = 0;
  let structuredChoiceEntries = 0;
  for (const record of pack.records) {
    if (record.kind !== 'feature') continue;
    const choices = arrayValue(dataObject(record)?.choices);
    if (choices.length === 0) continue;
    featureRecordsWithChoices += 1;
    structuredChoiceEntries += choices.length;
  }
  const choiceFindings = findings.filter(
    (finding) => finding.category === 'choice-coverage',
  );
  return {
    summary: {
      featureRecordsWithChoices,
      structuredChoiceEntries,
      findings: choiceFindings.length,
    },
    categories: choiceCategoryCounts(pack),
    findings: choiceFindings,
  };
}

function formatChoiceCoverageReport(
  report: ReturnType<typeof buildChoiceCoverageReport>,
): string {
  const lines = [
    'Choice coverage',
    `Feature records with choices[]: ${report.summary.featureRecordsWithChoices}`,
    `Structured choice entries: ${report.summary.structuredChoiceEntries}`,
    `Choice findings: ${report.summary.findings}`,
    `Choice categories: ${JSON.stringify(report.categories)}`,
    '',
  ];
  if (report.findings.length === 0) {
    lines.push('(no choice-coverage findings)');
  } else {
    for (const finding of report.findings) {
      lines.push(`${finding.key} — ${finding.detail} (${finding.bead})`);
    }
  }
  return `${lines.join('\n')}\n`;
}

function buildTableReachabilityReport(
  pack: RulesPack,
  srdFindings: readonly SrdAuditFinding[],
): {
  readonly summary: {
    readonly tableRecords: number;
    readonly ownedTablesExpected: number;
    readonly standaloneTablesExpected: number;
    readonly tableLinkFindings: number;
  };
  readonly ownedTables: readonly {
    readonly tableKey: string;
    readonly ownerKey: string;
    readonly tablePresent: boolean;
    readonly ownerPresent: boolean;
    readonly ownerReferencesTable: boolean;
  }[];
  readonly standaloneTables: readonly {
    readonly tableKey: string;
    readonly tablePresent: boolean;
  }[];
  readonly findings: readonly SrdAuditFinding[];
} {
  const byKey = new Map(pack.records.map((record) => [record.key, record]));
  const tableFindings = srdFindings.filter((finding) =>
    [
      'spell-table-link',
      'table-owner-link',
      'table-reachability',
      'reference-integrity',
    ].includes(finding.category),
  );
  const ownedTables = Object.entries(SRD_5_1_TABLE_OWNERS)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([tableKey, ownerKey]) => {
      const owner = byKey.get(ownerKey);
      const ownerRefs = new Set(
        owner === undefined ? [] : arrayValue(dataObject(owner)?.tableRefs),
      );
      return {
        tableKey,
        ownerKey,
        tablePresent: byKey.get(tableKey)?.kind === 'table',
        ownerPresent: owner !== undefined,
        ownerReferencesTable: ownerRefs.has(tableKey),
      };
    });
  const standaloneTables = [...SRD_5_1_STANDALONE_TABLES]
    .sort()
    .map((tableKey) => ({
      tableKey,
      tablePresent: byKey.get(tableKey)?.kind === 'table',
    }));
  return {
    summary: {
      tableRecords: pack.records.filter((record) => record.kind === 'table')
        .length,
      ownedTablesExpected: ownedTables.length,
      standaloneTablesExpected: standaloneTables.length,
      tableLinkFindings: tableFindings.length,
    },
    ownedTables,
    standaloneTables,
    findings: tableFindings,
  };
}

function formatTableReachabilityReport(
  report: ReturnType<typeof buildTableReachabilityReport>,
): string {
  const linked = report.ownedTables.filter(
    (entry) =>
      entry.tablePresent && entry.ownerPresent && entry.ownerReferencesTable,
  ).length;
  const lines = [
    'Table link / reachability',
    `Table records: ${report.summary.tableRecords}`,
    `Reviewed owned tables: ${linked}/${report.summary.ownedTablesExpected} linked from expected owner`,
    `Standalone tables: ${report.standaloneTables.filter((entry) => entry.tablePresent).length}/${report.summary.standaloneTablesExpected} present`,
    `Table-link findings: ${report.summary.tableLinkFindings}`,
    '',
  ];
  if (report.findings.length === 0) {
    lines.push('(no table-link/reachability findings)');
  } else {
    for (const finding of report.findings) {
      lines.push(`${finding.category}: ${finding.key} — ${finding.detail}`);
    }
  }
  return `${lines.join('\n')}\n`;
}

function spellPreparationFromOverlay(classKey: string): unknown {
  const overlay = getClassSpellcasting(classKey);
  if (overlay === undefined) return undefined;
  return {
    kind: overlay.preparation,
    ...(overlay.spellbookStartingSpells === undefined
      ? {}
      : { spellbookStartingSpells: overlay.spellbookStartingSpells }),
    // The overlay itself carries preparationFormula for prepared casters
    // (cleric/druid/paladin/wizard); omitting it here made the generated
    // pack's source-backed preparationFormula field look like an unexpected
    // mismatch instead of an already-modeled overlay fact (eshyra-jk4d).
    ...(overlay.preparationFormula === undefined
      ? {}
      : { preparationFormula: overlay.preparationFormula }),
    sourceText: overlay.sourceText,
  };
}

export function buildOverlayParityReport(pack: RulesPack): {
  readonly summary: {
    readonly checkedFacts: number;
    readonly matchedFacts: number;
    readonly missingFacts: number;
    readonly mismatchedFacts: number;
  };
  readonly checks: readonly {
    readonly key: string;
    readonly kind: string;
    readonly field: string;
    readonly status: 'match' | 'missing' | 'mismatch';
    readonly expected?: unknown;
    readonly actual?: unknown;
  }[];
} {
  const checks: {
    key: string;
    kind: string;
    field: string;
    status: 'match' | 'missing' | 'mismatch';
    expected?: unknown;
    actual?: unknown;
  }[] = [];
  const push = (
    record: RulesRecord,
    field: string,
    expected: unknown,
    actual: unknown,
  ): void => {
    if (expected === undefined) return;
    const status =
      actual === undefined
        ? 'missing'
        : valuesEqual(actual, expected)
          ? 'match'
          : 'mismatch';
    checks.push({
      key: record.key,
      kind: record.kind,
      field,
      status,
      expected: status === 'match' ? undefined : expected,
      actual: status === 'match' ? undefined : actual,
    });
  };

  for (const record of pack.records) {
    const data = dataObject(record);
    if (record.kind === 'ancestry') {
      push(
        record,
        'abilityScoreIncreases',
        [getAncestryAbilityScoreIncrease(record.key)].filter(
          (entry) => entry !== undefined,
        ),
        data?.abilityScoreIncreases,
      );
      push(
        record,
        'languages',
        [getAncestryLanguages(record.key)].filter(
          (entry) => entry !== undefined,
        ),
        data?.languages,
      );
    } else if (record.kind === 'background') {
      push(
        record,
        'languages',
        [getBackgroundLanguages(record.key)].filter(
          (entry) => entry !== undefined,
        ),
        data?.languages,
      );
    } else if (record.kind === 'class') {
      const spellcasting = getClassSpellcasting(record.key);
      push(
        record,
        'spellcastingAbility',
        spellcasting?.ability,
        data?.spellcastingAbility,
      );
      push(
        record,
        'spellPreparation',
        spellPreparationFromOverlay(record.key),
        data?.spellPreparation,
      );
      push(
        record,
        'startingEquipment.entries',
        getClassStartingEquipment(record.key)?.entries,
        objectValue(data?.startingEquipment)?.entries,
      );
    }
  }

  const summary = {
    checkedFacts: checks.length,
    matchedFacts: checks.filter((check) => check.status === 'match').length,
    missingFacts: checks.filter((check) => check.status === 'missing').length,
    mismatchedFacts: checks.filter((check) => check.status === 'mismatch')
      .length,
  };
  return {
    summary,
    checks: checks.sort((a, b) => {
      if (a.status !== b.status) return a.status < b.status ? -1 : 1;
      if (a.key !== b.key) return a.key < b.key ? -1 : 1;
      return a.field < b.field ? -1 : a.field > b.field ? 1 : 0;
    }),
  };
}

function formatOverlayParityReport(
  report: ReturnType<typeof buildOverlayParityReport>,
): string {
  const lines = [
    'Overlay vs pack parity',
    `Checked facts: ${report.summary.checkedFacts}`,
    `Matched facts: ${report.summary.matchedFacts}`,
    `Missing facts: ${report.summary.missingFacts}`,
    `Mismatched facts: ${report.summary.mismatchedFacts}`,
    '',
  ];
  const nonMatches = report.checks.filter((check) => check.status !== 'match');
  if (nonMatches.length === 0) {
    lines.push('(all checked overlay facts match pack data)');
  } else {
    for (const check of nonMatches) {
      lines.push(`${check.status}: ${check.key} data.${check.field}`);
    }
  }
  return `${lines.join('\n')}\n`;
}

function hasStructuredChoices(record: RulesRecord): boolean {
  const data = dataObject(record);
  if (data === null) return false;
  if (arrayValue(data.choices).length > 0) return true;
  if (arrayValue(data.skillChoices).length > 0) return true;
  if (arrayValue(data.toolProficiencyChoices).length > 0) return true;
  const startingEquipment = objectValue(data.startingEquipment);
  if (
    arrayValue(startingEquipment?.entries).some((entry) => {
      const e = objectValue(entry);
      return e?.kind === 'choice' || arrayValue(e?.options).length > 0;
    })
  ) {
    return true;
  }
  if (record.kind === 'ancestry') {
    return arrayValue(data.traits).some((trait) => {
      const t = objectValue(trait);
      return (
        arrayValue(t?.choices).length > 0 ||
        arrayValue(t?.abilityScoreIncreases).length > 0 ||
        arrayValue(t?.languages).length > 0
      );
    });
  }
  return false;
}

function hasDeterministicGrants(record: RulesRecord): boolean {
  const data = dataObject(record);
  if (data === null) return false;
  if (arrayValue(data.equipmentGrants).length > 0) return true;
  if (arrayValue(data.features).length > 0) return true;
  if (arrayValue(data.abilityScoreIncreases).length > 0) return true;
  if (arrayValue(data.languages).length > 0) return true;
  const startingEquipment = objectValue(data.startingEquipment);
  if (
    arrayValue(startingEquipment?.entries).some((entry) => {
      const e = objectValue(entry);
      if (arrayValue(e?.grants).length > 0) return true;
      return arrayValue(e?.options).some(
        (option) => arrayValue(objectValue(option)?.grants).length > 0,
      );
    })
  ) {
    return true;
  }
  return arrayValue(data.progression).some((row) =>
    arrayValue(objectValue(row)?.advancement).some((entry) => {
      const kind = stringValue(objectValue(entry)?.kind);
      return kind !== null && /Grant$/.test(kind);
    }),
  );
}

/**
 * Nested creature mechanics projections (eshyra-txxa): actions, reactions,
 * and legendary actions each carry their own `mechanics` object (attacks,
 * saves, damage) independent of any top-level `data.mechanics`. Missing these
 * undercounted `recordsWithMechanicsProjections` against the 314/317 figure
 * used elsewhere in the audit docs, which does scan these nested arrays.
 */
function hasNestedCreatureMechanicsProjection(
  data: Record<string, unknown>,
): boolean {
  if (
    arrayValue(data.actions).some(
      (action) => objectValue(objectValue(action)?.mechanics) !== null,
    )
  ) {
    return true;
  }
  if (
    arrayValue(data.reactions).some(
      (reaction) => objectValue(objectValue(reaction)?.mechanics) !== null,
    )
  ) {
    return true;
  }
  const legendaryActions = objectValue(data.legendaryActions);
  return arrayValue(legendaryActions?.entries).some(
    (entry) => objectValue(objectValue(entry)?.mechanics) !== null,
  );
}

function hasMechanicsProjection(record: RulesRecord): boolean {
  const data = dataObject(record);
  if (data === null) return false;
  if (objectValue(data.mechanics) !== null) return true;
  if (objectValue(data.projection) !== null) return true;
  if (
    arrayValue(data.traits).some(
      (trait) => objectValue(objectValue(trait)?.mechanics) !== null,
    )
  ) {
    return true;
  }
  if (objectValue(objectValue(data.feature)?.mechanics) !== null) return true;
  return hasNestedCreatureMechanicsProjection(data);
}

function hasPartialStructure(record: RulesRecord): boolean {
  const data = dataObject(record);
  if (data === null) return false;
  if (arrayValue(data.effects).length > 0) return true;
  if (arrayValue(data.levels).length > 0) return true;
  if (arrayValue(data.traits).length > 0) return true;
  if (arrayValue(data.actions).length > 0) return true;
  if (arrayValue(data.reactions).length > 0) return true;
  if (arrayValue(data.legendaryActions).length > 0) return true;
  if (arrayValue(data.tableRefs).length > 0) return true;
  if (arrayValue(data.contents).length > 0) return true;
  if (arrayValue(data.variants).length > 0) return true;
  if (objectValue(data.feature) !== null) return true;
  return false;
}

function hasProse(record: RulesRecord): boolean {
  const data = dataObject(record);
  if (data === null) return false;
  if (stringValue(data.description) !== null) return true;
  if (stringValue(data.text) !== null) return true;
  if (stringValue(data.suggestedCharacteristics) !== null) return true;
  if (stringValue(objectValue(data.feature)?.text) !== null) return true;
  return arrayValue(data.traits).some(
    (trait) => stringValue(objectValue(trait)?.text) !== null,
  );
}

function firstKeys(
  records: readonly RulesRecord[],
  predicate: (record: RulesRecord) => boolean,
  limit = 5,
): readonly string[] {
  return records
    .filter(predicate)
    .map((record) => record.key)
    .sort()
    .slice(0, limit);
}

// ---------------------------------------------------------------------------
// Gameplay-readiness dispositions (eshyra-o9bd.18.9.6)
// ---------------------------------------------------------------------------

/**
 * The readiness buckets that require an explicit reviewed disposition when
 * they contain records that are not already modeled (no structured choices,
 * deterministic grants, or mechanics projection).
 */
export type GameplayReadinessBucket =
  | 'unresolved-choice-prose'
  | 'partial-structure'
  | 'prose-only'
  // Nested creature-entry buckets (eshyra-o9bd.18.7.3): individual
  // trait/action/reaction/legendary-action entries without a typed
  // `mechanics` object, split by whether their prose carries mechanical
  // vocabulary (dice, DCs, modifiers) or reads as situational/narrative.
  | 'mechanical-prose'
  | 'narrative-prose';

/**
 * A reviewed decision about one kind×bucket of not-yet-modeled records:
 *
 *   - `accepted-prose-only` — the prose IS the intended representation;
 *     `reason` says why no deterministic projection is owed.
 *   - `unsupported` — a projection is not applicable; `reason` documents it.
 *   - `finding` — deterministic modeling is owed and `bead` names the open
 *     issue that will drive the bucket to zero.
 *
 * Records that are already modeled never need an entry. The policy is
 * fail-closed both ways (`assertGameplayReadinessDispositions`): a non-empty
 * bucket without an entry fails the bundle build, and a stale entry naming a
 * now-empty bucket also fails, so closing a bucket requires an explicit
 * policy update — a future audit can never silently rediscover (or silently
 * lose) a broad readiness bucket (eshyra-o9bd.18.9.6).
 */
export interface GameplayReadinessDispositionPolicyEntry {
  readonly status: 'accepted-prose-only' | 'unsupported' | 'finding';
  readonly reason: string;
  /** Required when `status` is `finding`. */
  readonly bead?: string;
}

/**
 * Mechanical vocabulary in an unmodeled creature entry (eshyra-o9bd.18.7.3):
 * anything matching this is reported as `mechanical-prose` rather than
 * `narrative-prose`, so residual gameplay language can never hide inside the
 * "descriptive text" bucket.
 */
export const CREATURE_ENTRY_MECHANICAL_SIGNAL =
  /\bDC\s*\d|\b\d+d\d+\b|saving throw|advantage|disadvantage|hit point|attack roll|to hit|damage|\bimmune\b|resistance|is (?:blinded|charmed|deafened|frightened|grappled|incapacitated|paralyzed|petrified|poisoned|prone|restrained|stunned|unconscious)\b/i;

/**
 * Reviewed accepted-prose creature-entry MEMBERSHIP (eshyra-o9bd.18.7.3
 * review). The bucket dispositions below accept these exact entries and no
 * others: an entry that newly loses its typed mechanics (or a new unmodeled
 * entry) is NOT covered by the blanket disposition — it fails the build
 * until explicitly reviewed here, and an entry that gains mechanics goes
 * stale here and must be removed. This is what makes the accepted buckets
 * fail-closed at the entry level rather than only at the bucket level.
 */
export const ACCEPTED_PROSE_CREATURE_ENTRY_REFS: Readonly<
  Record<'mechanical-prose' | 'narrative-prose', readonly string[]>
> = Object.freeze({
  'mechanical-prose': [
    'creature:adult-bronze-dragon#actions:Change Shape',
    'creature:adult-gold-dragon#actions:Change Shape',
    'creature:adult-silver-dragon#actions:Change Shape',
    'creature:ancient-brass-dragon#actions:Change Shape',
    'creature:ancient-bronze-dragon#actions:Change Shape',
    'creature:ancient-copper-dragon#actions:Change Shape',
    'creature:ancient-gold-dragon#actions:Change Shape',
    'creature:ancient-silver-dragon#actions:Change Shape',
    'creature:androsphinx#traits:Inscrutable',
    'creature:bugbear#traits:Brute',
    'creature:cloaker#traits:Damage Transfer',
    'creature:couatl#traits:Shielded Mind',
    'creature:doppelganger#actions:Read Thoughts',
    'creature:fire-elemental#traits:Water Susceptibility',
    'creature:gelatinous-cube#traits:Transparent',
    'creature:gladiator#traits:Brute',
    'creature:gray-ooze#traits:Corrode Metal',
    'creature:green-hag#actions:Illusory Appearance',
    'creature:green-hag#traits:Mimicry',
    'creature:gynosphinx#traits:Inscrutable',
    'creature:lemure#traits:Hellish Rejuvenation',
    'creature:mummy-lord#traits:Rejuvenation',
    'creature:nightmare#traits:Confer Fire Resistance',
    'creature:raven#traits:Mimicry',
    'creature:roper#traits:Grasping Tendrils',
    'creature:rust-monster#traits:Rust Metal',
    'creature:sea-hag#actions:Illusory Appearance',
    'creature:shield-guardian#traits:Bound',
    'creature:swarm-of-bats#traits:Swarm',
    'creature:swarm-of-insects#traits:Swarm',
    'creature:swarm-of-poisonous-snakes#traits:Swarm',
    'creature:swarm-of-quippers#traits:Swarm',
    'creature:swarm-of-rats#traits:Swarm',
    'creature:swarm-of-ravens#traits:Swarm',
    'creature:tarrasque#traits:Reflective Carapace',
    'creature:vampire#traits:Harmed by Running Water',
    'creature:vampire-spawn#traits:Harmed by Running Water',
    'creature:violet-fungus#actions:Multiattack',
  ],
  'narrative-prose': [
    'creature:adult-white-dragon#traits:Ice Walk',
    'creature:air-elemental#traits:Air Form',
    'creature:ancient-white-dragon#traits:Ice Walk',
    'creature:animated-armor#traits:False Appearance',
    'creature:awakened-shrub#traits:False Appearance',
    'creature:awakened-tree#traits:False Appearance',
    'creature:azer#traits:Illumination',
    'creature:balor#actions:Teleport',
    'creature:barbed-devil#traits:Devil’s Sight',
    'creature:bearded-devil#traits:Devil’s Sight',
    'creature:black-pudding#traits:Amorphous',
    'creature:black-pudding#traits:Spider Climb',
    'creature:bone-devil#traits:Devil’s Sight',
    'creature:chain-devil#traits:Devil’s Sight',
    'creature:chuul#traits:Sense Magic',
    'creature:cloaker#traits:False Appearance',
    'creature:couatl#actions:Change Shape',
    'creature:darkmantle#traits:False Appearance',
    'creature:deva#actions:Change Shape',
    'creature:doppelganger#traits:Shapechanger',
    'creature:drider#traits:Spider Climb',
    'creature:drider#traits:Web Walker',
    'creature:dryad#traits:Speak with Beasts and Plants',
    'creature:dryad#traits:Tree Stride',
    'creature:earth-elemental#traits:Earth Glide',
    'creature:ettercap#traits:Spider Climb',
    'creature:ettercap#traits:Web Sense',
    'creature:ettercap#traits:Web Walker',
    'creature:fire-elemental#traits:Illumination',
    'creature:flying-snake#traits:Flyby',
    'creature:flying-sword#traits:False Appearance',
    'creature:gargoyle#traits:False Appearance',
    'creature:ghost#actions:Etherealness',
    'creature:ghost#traits:Ethereal Sight',
    'creature:giant-fire-beetle#traits:Illumination',
    'creature:giant-owl#traits:Flyby',
    'creature:giant-spider#traits:Spider Climb',
    'creature:giant-spider#traits:Web Sense',
    'creature:giant-spider#traits:Web Walker',
    'creature:giant-wolf-spider#traits:Spider Climb',
    'creature:giant-wolf-spider#traits:Web Sense',
    'creature:giant-wolf-spider#traits:Web Walker',
    'creature:goblin#traits:Nimble Escape',
    'creature:gray-ooze#traits:Amorphous',
    'creature:gray-ooze#traits:False Appearance',
    'creature:homunculus#traits:Telepathic Bond',
    'creature:horned-devil#traits:Devil’s Sight',
    'creature:hydra#actions:Multiattack',
    'creature:hydra#traits:Reactive Heads',
    'creature:hydra#traits:Wakeful',
    'creature:ice-devil#traits:Devil’s Sight',
    'creature:ice-mephit#traits:False Appearance',
    'creature:imp#traits:Devil’s Sight',
    'creature:imp#traits:Shapechanger',
    'creature:invisible-stalker#traits:Faultless Tracker',
    'creature:kraken#legendaryActions:Tentacle Attack or Fling',
    'creature:lemure#traits:Devil’s Sight',
    'creature:lich#legendaryActions:Cantrip',
    'creature:lion#traits:Running Leap',
    'creature:magma-mephit#traits:False Appearance',
    'creature:magmin#traits:Ignited Illumination',
    'creature:manticore#traits:Tail Spike Regrowth',
    'creature:marilith#actions:Multiattack',
    'creature:marilith#actions:Teleport',
    'creature:marilith#traits:Reactive',
    'creature:medusa#actions:Multiattack',
    'creature:mimic#traits:False Appearance (Object Form Only)',
    'creature:mimic#traits:Shapechanger',
    'creature:minotaur#traits:Labyrinthine Recall',
    'creature:mule#traits:Beast of Burden',
    'creature:mummy-lord#legendaryActions:Attack',
    'creature:nalfeshnee#actions:Teleport',
    'creature:night-hag#actions:Change Shape',
    'creature:night-hag#actions:Etherealness',
    'creature:nightmare#actions:Ethereal Stride',
    'creature:nightmare#traits:Illumination',
    'creature:ochre-jelly#traits:Amorphous',
    'creature:ochre-jelly#traits:Spider Climb',
    'creature:oni#actions:Change Shape',
    'creature:orc#traits:Aggressive',
    'creature:otyugh#traits:Limited Telepathy',
    'creature:owl#traits:Flyby',
    'creature:phase-spider#traits:Ethereal Jaunt',
    'creature:phase-spider#traits:Spider Climb',
    'creature:phase-spider#traits:Web Walker',
    'creature:planetar#traits:Divine Awareness',
    'creature:pseudodragon#traits:Limited Telepathy',
    'creature:purple-worm#traits:Tunneler',
    'creature:quasit#traits:Shapechanger',
    'creature:roper#traits:False Appearance',
    'creature:roper#traits:Spider Climb',
    'creature:rug-of-smothering#traits:False Appearance',
    'creature:rust-monster#traits:Iron Scent',
    'creature:sahuagin#traits:Shark Telepathy',
    'creature:shadow#traits:Amorphous',
    'creature:shadow#traits:Shadow Stealth',
    'creature:shield-guardian#traits:Spell Storing',
    'creature:shrieker#traits:False Appearance',
    'creature:solar#actions:Flying Sword',
    'creature:solar#legendaryActions:Teleport',
    'creature:solar#traits:Divine Awareness',
    'creature:spider#traits:Spider Climb',
    'creature:spider#traits:Web Sense',
    'creature:spider#traits:Web Walker',
    'creature:spy#traits:Cunning Action',
    'creature:succubus-incubus#actions:Etherealness',
    'creature:succubus-incubus#traits:Shapechanger',
    'creature:tarrasque#legendaryActions:Attack',
    'creature:tarrasque#legendaryActions:Move',
    'creature:treant#traits:False Appearance',
    'creature:unicorn#legendaryActions:Hooves',
    'creature:vampire#legendaryActions:Move',
    'creature:vampire#legendaryActions:Unarmed Strike',
    'creature:vampire#traits:Forbiddance',
    'creature:vampire#traits:Spider Climb',
    'creature:vampire#traits:Vampire Weaknesses',
    'creature:vampire-spawn#traits:Forbiddance',
    'creature:vampire-spawn#traits:Spider Climb',
    'creature:vampire-spawn#traits:Vampire Weaknesses',
    'creature:violet-fungus#traits:False Appearance',
    'creature:water-elemental#traits:Water Form',
    'creature:werebear#traits:Shapechanger',
    'creature:wereboar#traits:Shapechanger',
    'creature:wererat#traits:Shapechanger',
    'creature:weretiger#traits:Shapechanger',
    'creature:werewolf#traits:Shapechanger',
    'creature:will-o-wisp#traits:Ephemeral',
    'creature:will-o-wisp#traits:Variable Illumination',
    'creature:wraith#actions:Create Specter',
    'creature:xorn#traits:Earth Glide',
    'creature:xorn#traits:Treasure Sense',
    'creature:young-white-dragon#traits:Ice Walk',
  ],
});

export const GAMEPLAY_READINESS_DISPOSITIONS: Readonly<
  Record<string, GameplayReadinessDispositionPolicyEntry>
> = Object.freeze({
  // Nested creature-entry dispositions (eshyra-o9bd.18.7.3). The typed
  // entry projections cover attacks, saves, damage, conditions, recharge,
  // per-day/rest use economies, legendary resistance, regeneration, healing,
  // multiattack counts, save/check/attack-roll modifiers, spellcasting spell
  // lists, breathing/jump grammars, and triggered-effect markers. The
  // remaining unmodeled entries were reviewed with that bead: their
  // adjudication is inherently situational (form changes, telepathic bonds,
  // terrain interaction, sensory description), so the verbatim prose is the
  // intended representation for the DM model, with numeric hooks already
  // projected wherever the entry prints them.
  'creature-entry#mechanical-prose': {
    status: 'accepted-prose-only',
    reason:
      'Entries whose remaining mechanical language is situational (movement-style traits, form/terrain interactions, rider clauses on already-projected attacks); the deterministic hooks these entries print (DCs, dice, conditions, uses) are projected — the residue is DM-adjudicated prose by design (eshyra-o9bd.18.7.3).',
  },
  'creature-entry#narrative-prose': {
    status: 'accepted-prose-only',
    reason:
      'Entries with no mechanical vocabulary at all (descriptive/sensory traits such as False Appearance or Illumination); prose is the intended representation (eshyra-o9bd.18.7.3).',
  },
  'hazard#prose-only': {
    status: 'finding',
    bead: 'eshyra-o9bd.18.7.7',
    reason:
      "Sphere of Annihilation's contact/destruction mechanics are prose-only pending the magic-item deterministic-effect epic.",
  },
  'equipment#partial-structure': {
    status: 'finding',
    bead: 'eshyra-o9bd.18.7.6',
    reason:
      'Equipment records with variants/contents structure but no deterministic use mechanics (adventuring gear and consumables).',
  },
  'equipment#prose-only': {
    status: 'finding',
    bead: 'eshyra-o9bd.18.7.6',
    reason:
      'Adventuring gear and consumables whose usable effects (acid, healing potion, caltrops, …) are described in prose only.',
  },
  'feature#partial-structure': {
    status: 'finding',
    bead: 'eshyra-o9bd.18.7.5',
    reason:
      'Class features with structured child data but no runtime effect projection.',
  },
  'feature#prose-only': {
    status: 'finding',
    bead: 'eshyra-o9bd.18.7.5',
    reason:
      'Class features whose runtime effects (Rage, Sneak Attack dice, Evasion, …) are prose-only.',
  },
  'magic-item#partial-structure': {
    status: 'finding',
    bead: 'eshyra-o9bd.18.7.7',
    reason:
      'Magic items with variant/table structure but no deterministic effect or charge-economy projection.',
  },
  'magic-item#prose-only': {
    status: 'finding',
    bead: 'eshyra-o9bd.18.7.7',
    reason:
      'Magic items whose effects, charges, and bonuses are prose-only pending the phased effect-modeling epic.',
  },
  'rule#partial-structure': {
    status: 'finding',
    bead: 'eshyra-o9bd.18.7.8',
    reason:
      'Rule records with table structure but no classified deterministic mechanics.',
  },
  'rule#prose-only': {
    status: 'finding',
    bead: 'eshyra-o9bd.18.7.8',
    reason:
      'Rule records pending the classify-and-model pass that decides deterministic vs narrative-only rules.',
  },
});

export interface GameplayReadinessDisposition {
  readonly kind: string;
  readonly bucket: GameplayReadinessBucket;
  readonly count: number;
  readonly examples: readonly string[];
  readonly status: GameplayReadinessDispositionPolicyEntry['status'];
  readonly reason: string;
  readonly bead?: string;
}

export type GameplayReadinessReport = {
  readonly packId: string;
  readonly byKind: Record<
    string,
    {
      readonly totalRecords: number;
      readonly recordsWithStructuredChoices: number;
      readonly recordsWithUnresolvedChoiceProse: number;
      readonly recordsWithDeterministicGrants: number;
      readonly recordsWithMechanicsProjections: number;
      readonly recordsWithPartialStructure: number;
      readonly proseOnlyRecords: number;
      readonly examples: {
        readonly structuredChoices: readonly string[];
        readonly unresolvedChoiceProse: readonly string[];
        readonly deterministicGrants: readonly string[];
        readonly mechanicsProjections: readonly string[];
        readonly partialStructure: readonly string[];
        readonly proseOnly: readonly string[];
      };
    }
  >;
  readonly highImpactExamples: readonly {
    readonly key: string;
    readonly kind: string;
    readonly signal: string;
  }[];
  /**
   * Nested creature-entry mechanics coverage (eshyra-o9bd.18.7.3): every
   * trait/action/reaction/legendary-action entry across `creature` and
   * `stat-block` records, split into typed-mechanics vs prose-only (further
   * split by mechanical vs narrative vocabulary). This is what distinguishes
   * "modeled nested mechanics" from "intentionally prose" for readiness.
   */
  readonly creatureEntries: {
    readonly totalEntries: number;
    readonly entriesWithMechanics: number;
    readonly mechanicalProse: number;
    readonly narrativeProse: number;
    readonly examples: {
      readonly mechanicalProse: readonly string[];
      readonly narrativeProse: readonly string[];
    };
  };
  /**
   * Resolved kind×bucket dispositions for not-yet-modeled records
   * (eshyra-o9bd.18.9.6): every non-empty bucket paired with its reviewed
   * policy entry.
   */
  readonly dispositions: readonly GameplayReadinessDisposition[];
  /**
   * Fail-closed policy violations: non-empty buckets without a policy
   * entry, stale policy entries whose bucket is now empty, and `finding`
   * entries without a bead. Must be empty;
   * `assertGameplayReadinessDispositions` throws otherwise.
   */
  readonly dispositionErrors: readonly string[];
};

export function buildGameplayReadinessReport(
  pack: RulesPack,
  choiceProseFindings: readonly SrdChoiceProseFinding[],
): GameplayReadinessReport {
  const choiceFindingKeys = new Set(choiceProseFindings.map((f) => f.key));
  const kinds = [...new Set(pack.records.map((record) => record.kind))].sort();
  const byKind: GameplayReadinessReport['byKind'] = {};
  for (const kind of kinds) {
    const records = pack.records
      .filter((record) => record.kind === kind)
      .sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
    const structured = records.filter(hasStructuredChoices);
    const unresolved = records.filter((record) =>
      choiceFindingKeys.has(record.key),
    );
    const grants = records.filter(hasDeterministicGrants);
    const mechanics = records.filter(hasMechanicsProjection);
    const partial = records.filter(hasPartialStructure);
    const proseOnly = records.filter(
      (record) =>
        hasProse(record) &&
        !hasStructuredChoices(record) &&
        !choiceFindingKeys.has(record.key) &&
        !hasDeterministicGrants(record) &&
        !hasMechanicsProjection(record) &&
        !hasPartialStructure(record),
    );
    byKind[kind] = {
      totalRecords: records.length,
      recordsWithStructuredChoices: structured.length,
      recordsWithUnresolvedChoiceProse: unresolved.length,
      recordsWithDeterministicGrants: grants.length,
      recordsWithMechanicsProjections: mechanics.length,
      recordsWithPartialStructure: partial.length,
      proseOnlyRecords: proseOnly.length,
      examples: {
        structuredChoices: firstKeys(records, hasStructuredChoices),
        unresolvedChoiceProse: firstKeys(records, (record) =>
          choiceFindingKeys.has(record.key),
        ),
        deterministicGrants: firstKeys(records, hasDeterministicGrants),
        mechanicsProjections: firstKeys(records, hasMechanicsProjection),
        partialStructure: firstKeys(records, hasPartialStructure),
        proseOnly: firstKeys(records, (record) => proseOnly.includes(record)),
      },
    };
  }
  // Nested creature-entry coverage (eshyra-o9bd.18.7.3): scan every
  // trait/action/reaction/legendary-action entry for a typed `mechanics`
  // object; entries without one are split by mechanical vocabulary.
  const creatureEntryRefs: {
    readonly ref: string;
    readonly text: string;
    readonly hasMechanics: boolean;
  }[] = [];
  for (const record of pack.records) {
    if (record.kind !== 'creature' && record.kind !== 'stat-block') continue;
    const data = dataObject(record);
    if (data === null) continue;
    const sections: readonly (readonly [string, readonly unknown[]])[] = [
      ['traits', arrayValue(data.traits)],
      ['actions', arrayValue(data.actions)],
      ['reactions', arrayValue(data.reactions)],
      [
        'legendaryActions',
        arrayValue(objectValue(data.legendaryActions)?.entries),
      ],
    ];
    for (const [section, entries] of sections) {
      for (const rawEntry of entries) {
        const entry = objectValue(rawEntry);
        if (entry === null) continue;
        const name = stringValue(entry.name) ?? '(unnamed)';
        creatureEntryRefs.push({
          ref: `${record.key}#${section}:${name}`,
          text: stringValue(entry.text) ?? '',
          hasMechanics: objectValue(entry.mechanics) !== null,
        });
      }
    }
  }
  const proseEntries = creatureEntryRefs.filter((entry) => !entry.hasMechanics);
  const mechanicalProseEntries = proseEntries.filter((entry) =>
    CREATURE_ENTRY_MECHANICAL_SIGNAL.test(entry.text),
  );
  const narrativeProseEntries = proseEntries.filter(
    (entry) => !CREATURE_ENTRY_MECHANICAL_SIGNAL.test(entry.text),
  );
  const creatureEntries: GameplayReadinessReport['creatureEntries'] = {
    totalEntries: creatureEntryRefs.length,
    entriesWithMechanics: creatureEntryRefs.filter(
      (entry) => entry.hasMechanics,
    ).length,
    mechanicalProse: mechanicalProseEntries.length,
    narrativeProse: narrativeProseEntries.length,
    examples: {
      mechanicalProse: mechanicalProseEntries
        .map((entry) => entry.ref)
        .sort()
        .slice(0, 5),
      narrativeProse: narrativeProseEntries
        .map((entry) => entry.ref)
        .sort()
        .slice(0, 5),
    },
  };
  // Resolve dispositions (eshyra-o9bd.18.9.6): every non-empty bucket of
  // not-yet-modeled records must map to a reviewed policy entry, and every
  // policy entry must still name a non-empty bucket.
  const isModeled = (record: RulesRecord): boolean =>
    hasStructuredChoices(record) ||
    hasDeterministicGrants(record) ||
    hasMechanicsProjection(record);
  const dispositions: GameplayReadinessDisposition[] = [];
  const dispositionErrors: string[] = [];
  const seenPolicyKeys = new Set<string>();
  for (const kind of kinds) {
    const records = pack.records.filter((record) => record.kind === kind);
    const unmodeled = records.filter((record) => !isModeled(record));
    const buckets: ReadonlyArray<
      readonly [GameplayReadinessBucket, readonly RulesRecord[]]
    > = [
      [
        'unresolved-choice-prose',
        records.filter((record) => choiceFindingKeys.has(record.key)),
      ],
      ['partial-structure', unmodeled.filter(hasPartialStructure)],
      [
        'prose-only',
        unmodeled.filter(
          (record) =>
            hasProse(record) &&
            !hasPartialStructure(record) &&
            !choiceFindingKeys.has(record.key),
        ),
      ],
    ];
    for (const [bucket, bucketRecords] of buckets) {
      if (bucketRecords.length === 0) continue;
      const policyKey = `${kind}#${bucket}`;
      seenPolicyKeys.add(policyKey);
      const policy = GAMEPLAY_READINESS_DISPOSITIONS[policyKey];
      if (policy === undefined) {
        dispositionErrors.push(
          `${policyKey}: ${bucketRecords.length} not-yet-modeled record(s) have no reviewed disposition (e.g. ${bucketRecords
            .slice(0, 3)
            .map((record) => record.key)
            .join(', ')})`,
        );
        continue;
      }
      if (policy.status === 'finding' && policy.bead === undefined) {
        dispositionErrors.push(
          `${policyKey}: disposition is a finding but names no bead`,
        );
      }
      dispositions.push({
        kind,
        bucket,
        count: bucketRecords.length,
        examples: bucketRecords.slice(0, 5).map((record) => record.key),
        status: policy.status,
        reason: policy.reason,
        ...(policy.bead === undefined ? {} : { bead: policy.bead }),
      });
    }
  }
  // Nested creature-entry buckets go through the same fail-closed policy
  // (eshyra-o9bd.18.7.3): a non-empty prose bucket without a reviewed
  // disposition fails, and an entry naming a now-empty bucket goes stale.
  const entryBuckets: ReadonlyArray<
    readonly [GameplayReadinessBucket, readonly { readonly ref: string }[]]
  > = [
    ['mechanical-prose', mechanicalProseEntries],
    ['narrative-prose', narrativeProseEntries],
  ];
  for (const [bucket, bucketEntries] of entryBuckets) {
    if (bucketEntries.length === 0) continue;
    const policyKey = `creature-entry#${bucket}`;
    seenPolicyKeys.add(policyKey);
    const policy = GAMEPLAY_READINESS_DISPOSITIONS[policyKey];
    if (policy === undefined) {
      dispositionErrors.push(
        `${policyKey}: ${bucketEntries.length} prose-only creature entr(ies) have no reviewed disposition (e.g. ${bucketEntries
          .slice(0, 3)
          .map((entry) => entry.ref)
          .join(', ')})`,
      );
      continue;
    }
    // Fail closed by MEMBERSHIP, not just bucket type: the accepted
    // disposition covers exactly the reviewed refs. A projection regression
    // (entry newly losing mechanics) or a new unmodeled entry surfaces as an
    // unreviewed ref; an entry that gained mechanics goes stale in the list.
    const reviewed = new Set(
      ACCEPTED_PROSE_CREATURE_ENTRY_REFS[
        bucket as keyof typeof ACCEPTED_PROSE_CREATURE_ENTRY_REFS
      ] ?? [],
    );
    const present = new Set(bucketEntries.map((entry) => entry.ref));
    const unreviewed = bucketEntries
      .map((entry) => entry.ref)
      .filter((ref) => !reviewed.has(ref));
    if (unreviewed.length > 0) {
      dispositionErrors.push(
        `${policyKey}: ${unreviewed.length} entr(ies) not in the reviewed accepted-prose membership (e.g. ${unreviewed
          .slice(0, 3)
          .join(', ')}) — review and add, or restore the typed projection`,
      );
    }
    const staleRefs = [...reviewed].filter((ref) => !present.has(ref));
    if (staleRefs.length > 0) {
      dispositionErrors.push(
        `${policyKey}: ${staleRefs.length} reviewed ref(s) no longer in the bucket (e.g. ${staleRefs
          .slice(0, 3)
          .join(', ')}) — remove them from ACCEPTED_PROSE_CREATURE_ENTRY_REFS`,
      );
    }
    if (policy.status === 'finding' && policy.bead === undefined) {
      dispositionErrors.push(
        `${policyKey}: disposition is a finding but names no bead`,
      );
    }
    dispositions.push({
      kind: 'creature-entry',
      bucket,
      count: bucketEntries.length,
      examples: bucketEntries.slice(0, 5).map((entry) => entry.ref),
      status: policy.status,
      reason: policy.reason,
      ...(policy.bead === undefined ? {} : { bead: policy.bead }),
    });
  }
  for (const policyKey of Object.keys(GAMEPLAY_READINESS_DISPOSITIONS)) {
    if (!seenPolicyKeys.has(policyKey)) {
      dispositionErrors.push(
        `${policyKey}: stale disposition — the bucket is now empty; record the closure by removing the entry`,
      );
    }
  }

  return {
    packId: pack.meta.packId,
    byKind,
    creatureEntries,
    highImpactExamples: choiceProseFindings.slice(0, 10).map((finding) => ({
      key: finding.key,
      kind: finding.kind,
      signal: finding.matchedPhrases.join(', '),
    })),
    dispositions,
    dispositionErrors,
  };
}

/**
 * Fail-closed gate for audit/freeze work (eshyra-o9bd.18.9.6): the bundle
 * build fails when any readiness bucket lacks a reviewed disposition, a
 * finding lacks a bead, or the policy carries a stale entry.
 */
export function assertGameplayReadinessDispositions(
  report: GameplayReadinessReport,
): void {
  if (report.dispositionErrors.length === 0) return;
  throw new Error(
    `gameplay-readiness dispositions are not fail-closed:\n${report.dispositionErrors
      .map((error) => `  ${error}`)
      .join('\n')}`,
  );
}

export function formatGameplayReadinessReport(
  report: ReturnType<typeof buildGameplayReadinessReport>,
): string {
  const lines = [
    'Gameplay readiness',
    `Pack: ${report.packId}`,
    '',
    '| kind | total | structured choices | unresolved choice prose | deterministic grants | mechanics projections | partial structure | prose-only |',
    '| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |',
  ];
  for (const [kind, summary] of Object.entries(report.byKind)) {
    lines.push(
      `| ${kind} | ${summary.totalRecords} | ${summary.recordsWithStructuredChoices} | ${summary.recordsWithUnresolvedChoiceProse} | ${summary.recordsWithDeterministicGrants} | ${summary.recordsWithMechanicsProjections} | ${summary.recordsWithPartialStructure} | ${summary.proseOnlyRecords} |`,
    );
  }
  lines.push('', 'Examples by kind');
  for (const [kind, summary] of Object.entries(report.byKind)) {
    lines.push(
      `- ${kind}: choices [${summary.examples.structuredChoices.join(', ') || 'none'}]; unresolved [${summary.examples.unresolvedChoiceProse.join(', ') || 'none'}]; grants [${summary.examples.deterministicGrants.join(', ') || 'none'}]; mechanics [${summary.examples.mechanicsProjections.join(', ') || 'none'}]; partial [${summary.examples.partialStructure.join(', ') || 'none'}]; prose-only [${summary.examples.proseOnly.join(', ') || 'none'}]`,
    );
  }
  lines.push(
    '',
    'Nested creature-entry mechanics (eshyra-o9bd.18.7.3)',
    `- entries: ${report.creatureEntries.totalEntries}; with typed mechanics: ${report.creatureEntries.entriesWithMechanics}; mechanical prose: ${report.creatureEntries.mechanicalProse}; narrative prose: ${report.creatureEntries.narrativeProse}`,
    `- mechanical-prose examples: [${report.creatureEntries.examples.mechanicalProse.join(', ') || 'none'}]`,
    `- narrative-prose examples: [${report.creatureEntries.examples.narrativeProse.join(', ') || 'none'}]`,
  );
  lines.push('', 'High-impact unresolved choice-prose examples');
  if (report.highImpactExamples.length === 0) {
    lines.push('(none)');
  } else {
    for (const example of report.highImpactExamples) {
      lines.push(`${example.kind}: ${example.key} — ${example.signal}`);
    }
  }
  lines.push(
    '',
    'Dispositions for not-yet-modeled buckets (eshyra-o9bd.18.9.6)',
  );
  if (report.dispositions.length === 0) {
    lines.push('(all records modeled)');
  } else {
    for (const disposition of report.dispositions) {
      lines.push(
        `- ${disposition.kind}#${disposition.bucket} (${disposition.count}): ${disposition.status}${
          disposition.bead === undefined ? '' : ` → ${disposition.bead}`
        } — ${disposition.reason}`,
      );
    }
  }
  if (report.dispositionErrors.length > 0) {
    lines.push('', 'DISPOSITION ERRORS (fail-closed)');
    for (const error of report.dispositionErrors) {
      lines.push(`- ${error}`);
    }
  }
  return `${lines.join('\n')}\n`;
}

/**
 * Format the equipment filter/proficiency resolution audit (eshyra-erf5.3.3)
 * as a reviewable text report: every distinct starting-equipment filter and
 * class equipment proficiency phrase, its candidate count, and up to 5
 * representative candidate keys.
 */
export function formatEquipmentResolutionReport(
  results: readonly EquipmentResolutionResult[],
): string {
  const lines = [
    'SRD equipment filter / proficiency resolution',
    '',
    '| source | phrase | candidates | examples |',
    '| --- | --- | ---: | --- |',
  ];
  for (const result of results) {
    const examples = result.candidateKeys.slice(0, 5).join(', ') || '(none)';
    lines.push(
      `| ${result.source} | ${result.phrase} | ${result.candidateKeys.length} | ${examples} |`,
    );
  }
  return `${lines.join('\n')}\n`;
}

// ---------------------------------------------------------------------------
// README
// ---------------------------------------------------------------------------

function buildReadme(meta: {
  commitSha: string;
  branch: string;
  timestamp: string;
  sourceHashMatch: boolean;
  recordCount: number;
}): string {
  return [
    '# D&D SRD 5.1 Rules-Pack Audit Bundle',
    '',
    'This bundle was generated from the eshyra repository to support a',
    'field-by-field external review of the committed D&D SRD 5.1 rules pack',
    'against the vendored SRD 5.1 PDF.',
    '',
    '## Bundle metadata',
    '',
    `- **Repo commit**: ${meta.commitSha}`,
    `- **Branch**: ${meta.branch}`,
    `- **Generated**: ${meta.timestamp}`,
    `- **Source PDF hash match**: ${meta.sourceHashMatch ? 'YES' : 'NO — see reports/source-hash-verification.txt'}`,
    '',
    '## File glossary',
    '',
    '### pack/',
    `- \`records.json\` — committed pack records (all ${meta.recordCount} entries)`,
    '- `manifest.json` — committed pack manifest (packId, license, source hash)',
    '',
    '### source/',
    '- `SRD_CC_v5.1.pdf` — vendored SRD 5.1 PDF (CC-BY-4.0)',
    '- `manifest.json` — source manifest (SHA-256, size, license, attribution)',
    '- `README.md` — importer README',
    '',
    '### command-output/',
    'Each `.txt` file captures stdout + stderr + exit code for one npm script.',
    '- `verify-dnd5e-srd-pack.txt` — regenerates pack from PDF and diffs vs committed',
    '- `audit-rules-pack.txt` — runs heuristic audit on the committed pack',
    '- `check.txt` — Biome format + lint check',
    '- `typecheck.txt` — full TypeScript build (tsc --build --force)',
    '- `test.txt` — full Vitest test suite',
    '',
    '### pdf-text/',
    'PDF content extracted by pdfjs-dist. Two artifacts per page:',
    '',
    '- `page-NNN.txt` — human-readable text: items grouped by y-coordinate,',
    '  sorted left-to-right by x within each line. **Review aid only** — not a',
    '  canonical parser output. On two-column and stat-block pages, items at',
    '  the same y-baseline across columns may still interleave. Use the',
    '  coordinate JSON (below) plus the original PDF for position-sensitive review.',
    '- `page-NNN.items.json` — coordinate-preserving raw items: `[{str, x, y,',
    '  width, height}, ...]` in pdfjs document stream order. Use x/y to',
    '  reconstruct exact layout and verify field extraction from source.',
    '- `all-pages.txt` — concatenated pages with page-break markers',
    '',
    '### reports/',
    '- `record-counts-by-kind.json` — how many records of each kind',
    '- `record-keys-by-kind.json` — all record keys grouped by kind (sorted)',
    '- `audit-full.json` — full auditPack output (JSON)',
    '- `audit-full.txt` — full auditPack output (human-readable)',
    '- `srd-structure-audit.json` — SRD-specific structure + coverage findings',
    '  (class proficiency / feature / subclass / ancestry parser bleed, plus',
    '  missing expected records). JSON form.',
    '- `srd-structure-audit.txt` — the same findings, human-readable by category',
    '- `suspicious-records.json` — records flagged by the generic audit heuristics',
    '- `partial-fields.json` — fields present on some but not all records of a kind',
    '- `unicode-scan.json` — records containing invisible hyphens or control chars',
    '- `source-inventory.json` — typography-derived inventory of every source',
    '  structure in the PDF (headings, table captions, stat blocks, table runs)',
    '- `source-coverage.json` — per-structure accounting status (record /',
    '  child-of / ignored / known-gap) with a roll-up summary; `unaccounted`',
    '  must be 0 or the importer refuses to write the pack (eshyra-4a7.1)',
    '- `source-region-ledger.json` — contiguous prose-region accounting ledger',
    '  showing where prose exists, which record/child/ignore owns it, and',
    '  whether any prose is unrepresented or hidden by broad structural ignores',
    '- `typed-advancement-coverage.{json,txt}` — per-class/level coverage of',
    '  typed `progression[].advancement[]` rows and advancement-entry kinds',
    '- `choice-coverage.{json,txt}` — structured class-feature choice coverage',
    '  plus any playable-model `choice-coverage` findings',
    '- `table-link-reachability.{json,txt}` — reviewed owner/table links,',
    '  standalone table presence, and table-link/reachability findings',
    '- `overlay-vs-pack-parity.{json,txt}` — parity between the old',
    '  source-backed character-creation overlays and the generated pack facts',
    '- `srd-playability-audit.{json,txt}` — full playable-model gate output',
    '- `srd-choice-prose-audit.{json,txt}` — choice-bearing prose coverage gate:',
    '  records whose prose announces a build choice but carry no structured',
    '  option catalog/filter (eshyra-ngcj.1)',
    '- `gameplay-readiness.{json,txt}` — per-kind readiness summary for',
    '  structured choices, unresolved choice prose, deterministic grants,',
    '  mechanics projections, and prose-only records',
    '- `source-hash-verification.txt` — SHA-256 and size check for the vendored PDF',
    '',
    '## How to reproduce',
    '',
    '```bash',
    'cd <eshyra-repo>',
    `git checkout ${meta.commitSha}`,
    'npm install',
    'npm run audit-bundle:dnd5e-srd',
    '```',
  ].join('\n');
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const outDir = resolve(process.argv[2] ?? DEFAULT_OUT_DIR);
  const copyZipPath = resolve(process.argv[3] ?? DEFAULT_HOST_ZIP_COPY_PATH);
  log(`Creating audit bundle at: ${outDir}`);
  log(`Repo root: ${REPO_ROOT}`);
  log('');

  // 1. Clean and create output directories
  rmSync(outDir, { recursive: true, force: true });
  for (const sub of [
    '',
    'pack',
    'source',
    'command-output',
    'pdf-text',
    'reports',
  ]) {
    mkdirSync(join(outDir, sub), { recursive: true });
  }

  // 2. Copy committed pack artifacts
  log('Copying committed pack artifacts...');
  cpSync(
    join(COMMITTED_PACK_DIR, 'records.json'),
    join(outDir, 'pack/records.json'),
  );
  cpSync(
    join(COMMITTED_PACK_DIR, 'manifest.json'),
    join(outDir, 'pack/manifest.json'),
  );

  // 3. Copy source artifacts
  log('Copying source artifacts...');
  cpSync(PDF_PATH, join(outDir, 'source/SRD_CC_v5.1.pdf'));
  cpSync(
    join(SOURCE_DIR, 'manifest.json'),
    join(outDir, 'source/manifest.json'),
  );
  cpSync(join(SOURCE_DIR, 'README.md'), join(outDir, 'source/README.md'));

  // 4. Source hash verification
  log('Verifying source PDF hash...');
  const hashVerification = verifySourceHash(
    PDF_PATH,
    join(SOURCE_DIR, 'manifest.json'),
  );
  writeFileSync(
    join(outDir, 'reports/source-hash-verification.txt'),
    hashVerification.report,
    'utf8',
  );
  log(
    `  Hash match: ${hashVerification.match ? 'YES' : 'NO — MISMATCH (see reports/source-hash-verification.txt)'}`,
  );

  // 5. Capture command outputs
  const commands: Array<{
    name: string;
    script: string;
    extraArgs?: string[];
  }> = [
    {
      name: 'audit-rules-pack',
      script: 'audit:rules-pack',
      extraArgs: ['packages/core/data/rules-packs/rules__dnd5e-srd-5.1'],
    },
    { name: 'check', script: 'check' },
    { name: 'typecheck', script: 'typecheck' },
    { name: 'test', script: 'test' },
    { name: 'verify-dnd5e-srd-pack', script: 'verify:dnd5e-srd-pack' },
  ];

  for (const cmd of commands) {
    log(
      `Running: npm run ${cmd.script}${cmd.extraArgs ? ` -- ${cmd.extraArgs.join(' ')}` : ''} ...`,
    );
    const result = captureCommand(cmd.script, cmd.extraArgs);
    writeFileSync(
      join(outDir, `command-output/${cmd.name}.txt`),
      result.combined,
      'utf8',
    );
    log(`  Exit code: ${result.exitCode}`);
  }

  // 6. Audit reports from the loaded pack
  log('Running pack audit...');
  let packAudit: ReturnType<typeof auditPack> | null = null;
  try {
    const pack = loadRulesPackFromDirectory(COMMITTED_PACK_DIR);
    packAudit = auditPack(pack);
    writeFileSync(
      join(outDir, 'reports/audit-full.json'),
      JSON.stringify(packAudit, null, 2),
      'utf8',
    );
    writeFileSync(
      join(outDir, 'reports/audit-full.txt'),
      formatAuditReport(packAudit),
      'utf8',
    );
    writeFileSync(
      join(outDir, 'reports/record-counts-by-kind.json'),
      JSON.stringify(packAudit.countsByKind, null, 2),
      'utf8',
    );
    writeFileSync(
      join(outDir, 'reports/suspicious-records.json'),
      JSON.stringify(packAudit.suspiciousRecords, null, 2),
      'utf8',
    );
    writeFileSync(
      join(outDir, 'reports/partial-fields.json'),
      JSON.stringify(packAudit.missingFieldSummary, null, 2),
      'utf8',
    );
    log(
      `  ${packAudit.recordCount} records, ${packAudit.suspiciousRecords.length} suspicious, ${packAudit.missingFieldSummary.length} partial-field groups`,
    );
  } catch (cause) {
    const msg =
      cause instanceof RulesPackError
        ? `pack validation failed: ${cause.message}`
        : `failed to load pack: ${(cause as Error).message}`;
    log(`  ERROR: ${msg}`);
    writeFileSync(
      join(outDir, 'reports/audit-full.txt'),
      `ERROR: ${msg}\n`,
      'utf8',
    );
  }

  // 6b. SRD-specific structure + coverage audit. The generic auditPack above
  // is system-agnostic and reported 0 suspicious records against parser-bleed
  // that it cannot see (eshyra-0m9.24); this run applies SRD-shaped structure
  // checks plus name/key coverage against the importer's expectation sets.
  log('Running SRD structure/coverage audit...');
  let srdAudit: ReturnType<typeof auditSrd> | null = null;
  try {
    const pack = loadRulesPackFromDirectory(COMMITTED_PACK_DIR);
    // Magic items, tables, and rule sections use the SOURCE-coverage lists
    // (emitted baseline + known source gaps) so any item present in the SRD
    // source is reported as missing if it ever drops out of the pack. Orb of
    // Dragonkind is now emitted (eshyra-0m9.16) but is retained in the source
    // gap list as durable source truth, so a regression that dropped it would
    // be caught here. Creature and ancestry sets are already exact source
    // name-sets in the importer's own coverage gates, so they keep the emitted
    // EXPECTED_* lists.
    srdAudit = auditSrd(pack, {
      requiredNamesByKind: {
        'magic-item': SOURCE_EXPECTED_SRD_5_1_MAGIC_ITEM_NAMES,
        ancestry: EXPECTED_SRD_5_1_ANCESTRY_NAMES,
        table: SOURCE_EXPECTED_SRD_5_1_TABLE_NAMES,
        creature: [
          ...EXPECTED_SRD_5_1_CREATURE_NAMES,
          ...EXPECTED_SRD_5_1_NPC_NAMES,
        ],
      },
      requiredKeys: SOURCE_EXPECTED_SRD_5_1_RULE_KEYS,
    });
    writeFileSync(
      join(outDir, 'reports/srd-structure-audit.json'),
      JSON.stringify(srdAudit, null, 2),
      'utf8',
    );
    writeFileSync(
      join(outDir, 'reports/srd-structure-audit.txt'),
      formatSrdAuditReport(srdAudit),
      'utf8',
    );
    log(
      `  ${srdAudit.findings.length} structure/coverage findings (${srdAuditHasFindings(srdAudit) ? 'NEEDS REVIEW' : 'clean'})`,
    );
  } catch (cause) {
    const msg =
      cause instanceof RulesPackError
        ? `pack validation failed: ${cause.message}`
        : `failed to load pack: ${(cause as Error).message}`;
    log(`  ERROR: ${msg}`);
    writeFileSync(
      join(outDir, 'reports/srd-structure-audit.txt'),
      `ERROR: ${msg}\n`,
      'utf8',
    );
  }

  // 6c. Modeling-usability reports for the re-freeze evidence bundle. These
  // are report projections over the committed pack, not generated-pack edits.
  log('Generating modeling-usability reports...');
  let playabilityFindings: readonly SrdPlayabilityFinding[] = [];
  let choiceProseFindings: readonly SrdChoiceProseFinding[] = [];
  let typedAdvancementReport: ReturnType<
    typeof buildTypedAdvancementCoverageReport
  > | null = null;
  let choiceCoverageReport: ReturnType<
    typeof buildChoiceCoverageReport
  > | null = null;
  let tableReachabilityReport: ReturnType<
    typeof buildTableReachabilityReport
  > | null = null;
  let overlayParityReport: ReturnType<typeof buildOverlayParityReport> | null =
    null;
  let gameplayReadinessReport: ReturnType<
    typeof buildGameplayReadinessReport
  > | null = null;
  let equipmentResolutionResults: readonly EquipmentResolutionResult[] = [];
  try {
    const pack = loadRulesPackFromDirectory(COMMITTED_PACK_DIR);
    playabilityFindings = auditSrdPlayability(pack);
    writeFileSync(
      join(outDir, 'reports/srd-playability-audit.json'),
      JSON.stringify(
        {
          packId: pack.meta.packId,
          findings: playabilityFindings,
          countsByCategory: countSrdPlayabilityByCategory(playabilityFindings),
        },
        null,
        2,
      ),
      'utf8',
    );
    writeFileSync(
      join(outDir, 'reports/srd-playability-audit.txt'),
      formatSrdPlayabilityReport(pack.meta.packId, playabilityFindings),
      'utf8',
    );

    // Choice-bearing prose coverage gate (eshyra-ngcj.1): records whose prose
    // announces a build choice but carry no structured option catalog/filter.
    choiceProseFindings = auditSrdChoiceProse(pack);
    writeFileSync(
      join(outDir, 'reports/srd-choice-prose-audit.json'),
      JSON.stringify(
        { packId: pack.meta.packId, findings: choiceProseFindings },
        null,
        2,
      ),
      'utf8',
    );
    writeFileSync(
      join(outDir, 'reports/srd-choice-prose-audit.txt'),
      formatSrdChoiceProseReport(pack.meta.packId, choiceProseFindings),
      'utf8',
    );

    typedAdvancementReport = buildTypedAdvancementCoverageReport(pack);
    writeFileSync(
      join(outDir, 'reports/typed-advancement-coverage.json'),
      JSON.stringify(typedAdvancementReport, null, 2),
      'utf8',
    );
    writeFileSync(
      join(outDir, 'reports/typed-advancement-coverage.txt'),
      formatTypedAdvancementCoverageReport(typedAdvancementReport),
      'utf8',
    );

    choiceCoverageReport = buildChoiceCoverageReport(pack, playabilityFindings);
    writeFileSync(
      join(outDir, 'reports/choice-coverage.json'),
      JSON.stringify(choiceCoverageReport, null, 2),
      'utf8',
    );
    writeFileSync(
      join(outDir, 'reports/choice-coverage.txt'),
      formatChoiceCoverageReport(choiceCoverageReport),
      'utf8',
    );

    tableReachabilityReport = buildTableReachabilityReport(
      pack,
      srdAudit?.findings ?? [],
    );
    writeFileSync(
      join(outDir, 'reports/table-link-reachability.json'),
      JSON.stringify(tableReachabilityReport, null, 2),
      'utf8',
    );
    writeFileSync(
      join(outDir, 'reports/table-link-reachability.txt'),
      formatTableReachabilityReport(tableReachabilityReport),
      'utf8',
    );

    overlayParityReport = buildOverlayParityReport(pack);
    writeFileSync(
      join(outDir, 'reports/overlay-vs-pack-parity.json'),
      JSON.stringify(overlayParityReport, null, 2),
      'utf8',
    );
    writeFileSync(
      join(outDir, 'reports/overlay-vs-pack-parity.txt'),
      formatOverlayParityReport(overlayParityReport),
      'utf8',
    );

    gameplayReadinessReport = buildGameplayReadinessReport(
      pack,
      choiceProseFindings,
    );
    // Fail-closed disposition gate (eshyra-o9bd.18.9.6): the bundle build
    // aborts when a readiness bucket has no reviewed disposition, so a
    // future audit can never silently rediscover a broad bucket.
    assertGameplayReadinessDispositions(gameplayReadinessReport);
    writeFileSync(
      join(outDir, 'reports/gameplay-readiness.json'),
      JSON.stringify(gameplayReadinessReport, null, 2),
      'utf8',
    );
    writeFileSync(
      join(outDir, 'reports/gameplay-readiness.txt'),
      formatGameplayReadinessReport(gameplayReadinessReport),
      'utf8',
    );

    // Equipment filter / class-proficiency resolution audit (eshyra-erf5.3.3):
    // proves every starting-equipment filter and class equipment proficiency
    // phrase actually resolves to at least one catalog candidate. Throws
    // (failing the bundle build) on a zero-candidate result or an unreviewed
    // proficiency phrase — this is a fail-closed gate, not just a report.
    equipmentResolutionResults = auditEquipmentResolution(pack);
    assertEquipmentResolution(equipmentResolutionResults);
    writeFileSync(
      join(outDir, 'reports/equipment-resolution-audit.json'),
      JSON.stringify(equipmentResolutionResults, null, 2),
      'utf8',
    );
    writeFileSync(
      join(outDir, 'reports/equipment-resolution-audit.txt'),
      formatEquipmentResolutionReport(equipmentResolutionResults),
      'utf8',
    );

    log(
      `  Playability findings: ${playabilityFindings.length} (${srdPlayabilityHasFindings(playabilityFindings) ? 'NEEDS REVIEW' : 'clean'})`,
    );
    log(
      `  Choice-prose findings: ${choiceProseFindings.length} (${srdChoiceProseHasFindings(choiceProseFindings) ? 'NEEDS REVIEW' : 'clean'})`,
    );
    log(
      `  Typed advancement rows: ${typedAdvancementReport.summary.rowsWithTypedAdvancement}/${typedAdvancementReport.summary.expectedRows}`,
    );
    log(
      `  Choice findings: ${choiceCoverageReport.summary.findings}; table-link findings: ${tableReachabilityReport.summary.tableLinkFindings}; overlay mismatches: ${overlayParityReport.summary.mismatchedFacts}`,
    );
    log(
      `  Gameplay-readiness kinds: ${Object.keys(gameplayReadinessReport.byKind).length}`,
    );
    log(
      `  Equipment resolution: ${equipmentResolutionResults.length} filter/proficiency phrases, all resolved`,
    );
  } catch (cause) {
    const msg =
      cause instanceof RulesPackError
        ? `pack validation failed: ${cause.message}`
        : `failed to load pack: ${(cause as Error).message}`;
    log(`  ERROR: ${msg}`);
    writeFileSync(
      join(outDir, 'reports/srd-playability-audit.txt'),
      `ERROR: ${msg}\n`,
      'utf8',
    );
  }

  // 6d. Source-coverage artifacts (eshyra-4a7.1): copy the committed
  // typography-derived source inventory + coverage report into reports/ and
  // summarize the accounting so the bundle shows which source structures are
  // records, child data, reasoned ignores, or tracked known gaps.
  log('Copying source-coverage artifacts...');
  cpSync(
    join(COMMITTED_PACK_DIR, 'source-inventory.json'),
    join(outDir, 'reports/source-inventory.json'),
  );
  cpSync(
    join(COMMITTED_PACK_DIR, 'source-coverage.json'),
    join(outDir, 'reports/source-coverage.json'),
  );
  cpSync(
    join(COMMITTED_PACK_DIR, 'source-region-ledger.json'),
    join(outDir, 'reports/source-region-ledger.json'),
  );
  const sourceCoverage = JSON.parse(
    readFileSync(join(COMMITTED_PACK_DIR, 'source-coverage.json'), 'utf8'),
  ) as {
    summary: {
      record: number;
      childOf: number;
      ambiguous: number;
      ignored: Record<string, number>;
      knownGap: Record<string, number>;
      unaccounted: number;
    };
    entries: unknown[];
  };
  const knownGapTotal = Object.values(sourceCoverage.summary.knownGap).reduce(
    (a, b) => a + b,
    0,
  );
  log(
    `  ${sourceCoverage.entries.length} source structures: ${sourceCoverage.summary.unaccounted} unaccounted, ${sourceCoverage.summary.ambiguous} ambiguous, ${knownGapTotal} known-gap`,
  );
  const sourceRegionLedger = JSON.parse(
    readFileSync(join(COMMITTED_PACK_DIR, 'source-region-ledger.json'), 'utf8'),
  ) as {
    summary: {
      proseRegions: number;
      unrepresented: number;
      broadStructuralIgnores: number;
    };
  };
  log(
    `  ${sourceRegionLedger.summary.proseRegions} prose regions: ${sourceRegionLedger.summary.unrepresented} unrepresented, ${sourceRegionLedger.summary.broadStructuralIgnores} broad-structural-ignore`,
  );

  // 7. Record keys by kind
  log('Generating record key listing...');
  const rawRecords = JSON.parse(
    readFileSync(join(COMMITTED_PACK_DIR, 'records.json'), 'utf8'),
  ) as Record<string, unknown>[];
  const keysByKind = recordKeysByKind(rawRecords);
  writeFileSync(
    join(outDir, 'reports/record-keys-by-kind.json'),
    JSON.stringify(keysByKind, null, 2),
    'utf8',
  );

  // 8. Unicode scan
  log('Scanning records for invisible hyphens / control characters...');
  const unicodeFindings = scanRecordsForUnicode(rawRecords);
  writeFileSync(
    join(outDir, 'reports/unicode-scan.json'),
    JSON.stringify(
      {
        scanned: rawRecords.length,
        findingCount: unicodeFindings.length,
        findings: unicodeFindings,
      },
      null,
      2,
    ),
    'utf8',
  );
  log(
    `  ${unicodeFindings.length} records with invisible hyphens or control chars`,
  );

  // 9. PDF text extraction — plain text (x-sorted) + coordinate JSON per page
  log('Extracting PDF text (this may take a moment)...');
  const pages = await extractPdfPages(PDF_PATH);
  const pageLines: string[] = [];
  for (const page of pages) {
    const base = `page-${String(page.pageNumber).padStart(3, '0')}`;
    writeFileSync(join(outDir, `pdf-text/${base}.txt`), page.text, 'utf8');
    writeFileSync(
      join(outDir, `pdf-text/${base}.items.json`),
      JSON.stringify(page.items, null, 2),
      'utf8',
    );
    pageLines.push(
      `\n\n${'='.repeat(72)}\nPAGE ${page.pageNumber}\n${'='.repeat(72)}\n\n${page.text}`,
    );
  }
  writeFileSync(
    join(outDir, 'pdf-text/all-pages.txt'),
    pageLines.join(''),
    'utf8',
  );
  log(`  Extracted ${pages.length} pages`);

  // 10. Git metadata
  const gitSha = spawnSync('git', ['rev-parse', 'HEAD'], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
  }).stdout.trim();
  const gitBranch = spawnSync('git', ['branch', '--show-current'], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
  }).stdout.trim();
  const timestamp = new Date().toISOString();
  const metadata = {
    commitSha: gitSha,
    branch: gitBranch,
    generatedAt: timestamp,
    repoRoot: REPO_ROOT,
    sourceArtifact: {
      path: PDF_PATH,
      sha256Actual: hashVerification.actual,
      sha256Expected: hashVerification.expected,
      hashMatch: hashVerification.match,
    },
    packAuditSummary: packAudit
      ? {
          packId: packAudit.packId,
          recordCount: packAudit.recordCount,
          countsByKind: packAudit.countsByKind,
          suspiciousCount: packAudit.suspiciousRecords.length,
          partialFieldGroups: packAudit.missingFieldSummary.length,
          hasFindings: auditHasFindings(packAudit),
        }
      : null,
    srdStructureAudit: srdAudit
      ? {
          findingCount: srdAudit.findings.length,
          hasFindings: srdAuditHasFindings(srdAudit),
        }
      : null,
    srdPlayabilityAudit: {
      findingCount: playabilityFindings.length,
      hasFindings: srdPlayabilityHasFindings(playabilityFindings),
    },
    srdChoiceProseAudit: {
      findingCount: choiceProseFindings.length,
      hasFindings: srdChoiceProseHasFindings(choiceProseFindings),
    },
    modelingUsabilityReports: {
      typedAdvancementCoverage: typedAdvancementReport?.summary ?? null,
      choiceCoverage: choiceCoverageReport?.summary ?? null,
      tableLinkReachability: tableReachabilityReport?.summary ?? null,
      overlayVsPackParity: overlayParityReport?.summary ?? null,
    },
    sourceCoverage: {
      inventoryItems: sourceCoverage.entries.length,
      unaccounted: sourceCoverage.summary.unaccounted,
      ambiguous: sourceCoverage.summary.ambiguous,
      knownGapTotal,
      knownGapByBead: sourceCoverage.summary.knownGap,
    },
    pdfPages: pages.length,
    unicodeScan: {
      scanned: rawRecords.length,
      findings: unicodeFindings.length,
    },
  };
  writeFileSync(
    join(outDir, 'metadata.json'),
    JSON.stringify(metadata, null, 2),
    'utf8',
  );

  // 11. README
  writeFileSync(
    join(outDir, 'README.md'),
    buildReadme({
      commitSha: gitSha,
      branch: gitBranch,
      timestamp,
      sourceHashMatch: hashVerification.match,
      recordCount: rawRecords.length,
    }),
    'utf8',
  );

  // 12. Zip the bundle directory and copy the archive to the Windows host drive.
  const zipPath = `${outDir}.zip`;
  log(`Zipping bundle to: ${zipPath}`);
  rmSync(zipPath, { force: true });

  const zipResult = spawnSync('zip', ['-qr', zipPath, '.'], {
    cwd: outDir,
    encoding: 'utf8',
    timeout: 120_000,
  });

  if (zipResult.status !== 0) {
    log(`  ERROR: zip failed (exit ${zipResult.status ?? 'null'})`);
    if (zipResult.error) log(`  ${zipResult.error.message}`);
    if (zipResult.stdout) log(`  ${zipResult.stdout.trim()}`);
    if (zipResult.stderr) log(`  ${zipResult.stderr.trim()}`);
    process.exitCode = 1;
    return;
  }

  log(`  Done: ${zipPath}`);
  log(`Copying archive to: ${copyZipPath}`);
  mkdirSync(dirname(copyZipPath), { recursive: true });
  cpSync(zipPath, copyZipPath);
  log(`  Copied: ${copyZipPath}`);

  log('');
  log(`Bundle complete: ${outDir}`);
  log(`Archive:         ${zipPath}`);
  log(`Copied archive:  ${copyZipPath}`);
  log(`  Commit: ${gitSha}`);
  log(`  Branch: ${gitBranch}`);
  log(`  PDF pages: ${pages.length}`);
  if (packAudit) {
    log(`  Records: ${packAudit.recordCount}`);
    log(`  Suspicious: ${packAudit.suspiciousRecords.length}`);
    log(`  Unicode findings: ${unicodeFindings.length}`);
  }
  if (srdAudit) {
    log(`  SRD structure/coverage findings: ${srdAudit.findings.length}`);
  }
  log(
    `  Source coverage: ${sourceCoverage.entries.length} structures, ${sourceCoverage.summary.unaccounted} unaccounted, ${sourceCoverage.summary.ambiguous} ambiguous, ${knownGapTotal} known-gap`,
  );
}

if (resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
