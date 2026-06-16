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
  auditHasFindings,
  auditPack,
  auditSrd,
  formatAuditReport,
  formatSrdAuditReport,
  loadRulesPackFromDirectory,
  RulesPackError,
  srdAuditHasFindings,
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

  // 6c. Source-coverage artifacts (eshyra-4a7.1): copy the committed
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

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
