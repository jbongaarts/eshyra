/**
 * Deep pre-freeze audit for the committed D&D 5e SRD 5.1 rules pack
 * (eshyra-o9bd.18.9.1).
 *
 * Durable port of the 2026-07-01 independent audit harness
 * (~/src/dnd5e-srd-audit-harness-070126): bidirectional token-shingle
 * verification between the vendored SRD PDF and the committed pack, plus the
 * internal consistency checks the repo's per-record gates don't already
 * cover. This is the independent oracle layer — it deliberately re-derives
 * everything from the PDF text and the committed pack alone, sharing no
 * parser code with the importer, so a parser bug cannot vouch for itself.
 *
 * Checks:
 *   1. record-check (pack → source): every strict prose field of every
 *      record must be reproducible from its cited pages (±1 page, +2
 *      forward, since blocks flow across pages/columns) via 6-gram token
 *      shingles; uncovered runs of ≥4 tokens fail.
 *   2. digit-check (pack → source): every digit-bearing token in a strict
 *      prose field must sit inside a covered shingle — single-number
 *      corruption (DCs, dice, ranges) is below the run-length threshold.
 *   3. page-coverage (source → pack): every content page's token stream is
 *      covered by shingles built from the whole pack; an uncovered run
 *      carrying novel tokens (absent from the entire pack vocabulary) fails
 *      — that is dropped source content. Runs whose tokens all exist in the
 *      pack ("reordered": statline labels, table projections) are reported
 *      for review but do not fail; the region-ledger emission gate
 *      (eshyra-o9bd.18.9.2) is the fail-closed owner of prose-level drops.
 *   4. consistency (pack-internal): dice averages vs printed means, class
 *      progression vs the class table record, creature attack bonuses / save
 *      DCs vs their own action text, and spell damage dice / save abilities /
 *      attack flags vs spell text. (Reference integrity, concentration,
 *      CR/XP, and statline fidelity are already fail-closed importer gates.)
 *
 * Runtime is minutes, not seconds, so this is NOT a per-PR CI gate: CI runs
 * `verify:dnd5e-srd-pack` (byte-exact regeneration) and the test suite; this
 * command is required before a freeze/sign-off decision. See
 * `docs/deep-audit-dnd5e-srd.md`.
 *
 * Usage:
 *   npm run audit:dnd5e-srd-deep            # writes reports to a temp dir
 *   npm run audit:dnd5e-srd-deep -- --out <dir>
 *
 * Exit codes: 0 clean, 1 findings, 2 operational failure.
 */

import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  loadRulesPackFromDirectory,
  type RulesPack,
  type RulesRecord,
} from '../../src/internal.js';
import { extractPdfText } from '../importers/dnd5e-srd-5.1/extract.js';
import type { PageText } from '../importers/dnd5e-srd-5.1/types.js';
import {
  addGrams,
  diceFormulaAverage,
  GRAM_SIZE,
  gramKey,
  isPageFooter,
  joinDehyphenated,
  locatorPages,
  pageTokens,
  shingleTokens,
  uncoveredRuns,
  walkStrings,
} from './shingles.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, '../../../..');
const VENDORED_PDF = resolve(
  REPO_ROOT,
  'packages/core/sources/dnd5e-srd-5.1/SRD_CC_v5.1.pdf',
);
const COMMITTED_PACK_DIR = resolve(
  REPO_ROOT,
  'packages/core/data/rules-packs/rules__dnd5e-srd-5.1',
);

/** Title/legal front matter; not rules content, never pack-covered. */
const FRONT_MATTER_MAX_PAGE = 2;

/**
 * Structural running headers and chapter/appendix banner lines: document
 * navigation, not rules content. The source-inventory coverage gates account
 * for headings; the deep audit verifies content, so these lines are dropped
 * from page streams before shingling.
 */
const STRUCTURAL_HEADER_LINE =
  /^(?:monsters \([a-z]\)|appendix (?:ph|mm)-[a-z]:?.*)$/i;

/**
 * Reviewed page-coverage exceptions: uncovered novel-token runs that are
 * document apparatus rather than dropped rules content. Each entry must say
 * why the text is intentionally not in the pack.
 */
const PAGE_COVERAGE_EXCEPTIONS: ReadonlyArray<{
  readonly page: number;
  readonly contains: string;
  readonly reason: string;
}> = [
  {
    page: 3,
    contains: 'if you note any errors',
    reason:
      'The p.3 errata-reporting notice ("please let us know by emailing askdnd@wizards.com") is document apparatus, not rules content; the adjacent Races/Racial Traits chapter headings are accounted as source structure.',
  },
];

/**
 * Strict prose fields: stored verbatim from the source, so they must be
 * shingle-reproducible from the cited pages. Everything else (structured
 * values, reconstructed headers) is covered by the importer's own
 * fail-closed gates.
 */
const STRICT_PROSE_LEAVES = new Set([
  'description',
  'text',
  'higherLevels',
  'componentMaterials',
  'suggestedCharacteristics',
  'sourceText',
  'speedSourceText',
]);

function isStrictProsePath(path: string): boolean {
  // `choices[n].sourceText` is a synthesized option-catalog label
  // ("Acolyte Ideals (d6)."), not verbatim source prose.
  if (/(^|\.)choices\[\d+\]\.sourceText$/.test(path)) return false;
  const leaf =
    path
      .replace(/\[\d+\]$/, '')
      .split('.')
      .pop() ?? '';
  if (STRICT_PROSE_LEAVES.has(leaf)) return true;
  // `effects[3]` — condition effect sentences are verbatim source prose.
  return /(^|\.)effects\[\d+\]$/.test(path);
}

interface StrictString {
  readonly key: string;
  readonly path: string;
  readonly text: string;
}

function strictStrings(record: RulesRecord): readonly StrictString[] {
  const leaves: Array<{ readonly path: string; readonly text: string }> = [];
  walkStrings(record.data, '', leaves);
  return leaves
    .filter((leaf) => isStrictProsePath(leaf.path))
    .map((leaf) => ({ key: record.key, path: leaf.path, text: leaf.text }));
}

// ---------------------------------------------------------------------------
// Page streams
// ---------------------------------------------------------------------------

interface PageStream {
  readonly pageNumber: number;
  readonly tokens: readonly string[];
}

function buildPageStreams(
  pages: readonly PageText[],
  vocabulary: ReadonlySet<string>,
): ReadonlyMap<number, PageStream> {
  const streams = new Map<number, PageStream>();
  for (const page of pages) {
    const body = joinDehyphenated(
      page.lines.filter(
        (line) =>
          !isPageFooter(line) && !STRUCTURAL_HEADER_LINE.test(line.trim()),
      ),
    );
    streams.set(page.pageNumber, {
      pageNumber: page.pageNumber,
      tokens: pageTokens(body, vocabulary),
    });
  }
  return streams;
}

/** Gram set for a contiguous page window, built over the concatenated
 * window stream so shingles spanning a page boundary stay covered. */
function windowGrams(
  window: readonly number[],
  streams: ReadonlyMap<number, PageStream>,
  cache: Map<string, ReadonlySet<string>>,
): ReadonlySet<string> {
  const key = window.join(',');
  const cached = cache.get(key);
  if (cached !== undefined) return cached;
  const tokens: string[] = [];
  for (const pageNumber of window) {
    const stream = streams.get(pageNumber);
    if (stream !== undefined) tokens.push(...stream.tokens);
  }
  const grams = new Set<string>();
  for (let i = 0; i + GRAM_SIZE <= tokens.length; i++) {
    grams.add(gramKey(tokens.slice(i, i + GRAM_SIZE)));
  }
  if (cache.size > 80) cache.clear();
  cache.set(key, grams);
  return grams;
}

/** Short strings (< one gram) check as a whole-token-subsequence search. */
function windowContainsTokens(
  needle: readonly string[],
  window: readonly number[],
  streams: ReadonlyMap<number, PageStream>,
): boolean {
  if (needle.length === 0) return true;
  for (const pageNumber of window) {
    const stream = streams.get(pageNumber);
    if (stream === undefined) continue;
    const tokens = stream.tokens;
    outer: for (let i = 0; i + needle.length <= tokens.length; i++) {
      for (let j = 0; j < needle.length; j++) {
        if (tokens[i + j] !== needle[j]) continue outer;
      }
      return true;
    }
  }
  return false;
}

function recordWindow(record: RulesRecord): readonly number[] {
  const pages = locatorPages(record.provenance.locator ?? '');
  const window = new Set<number>();
  for (const page of pages) {
    window.add(page - 1);
    window.add(page);
    window.add(page + 1);
    window.add(page + 2);
  }
  return [...window].sort((a, b) => a - b);
}

// ---------------------------------------------------------------------------
// Findings
// ---------------------------------------------------------------------------

interface Finding {
  readonly check:
    | 'record-check'
    | 'digit-check'
    | 'page-coverage'
    | 'consistency';
  readonly key: string;
  readonly detail: string;
}

interface PageCoverageEntry {
  readonly page: number;
  readonly tokens: number;
  readonly uncovered: number;
  readonly missing: readonly string[];
  readonly reordered: readonly string[];
}

// ---------------------------------------------------------------------------
// Checks
// ---------------------------------------------------------------------------

function runRecordAndDigitChecks(
  pack: RulesPack,
  streams: ReadonlyMap<number, PageStream>,
): readonly Finding[] {
  const findings: Finding[] = [];
  const cache = new Map<string, ReadonlySet<string>>();
  for (const record of pack.records) {
    const window = recordWindow(record);
    if (window.length === 0) {
      findings.push({
        check: 'record-check',
        key: record.key,
        detail: `provenance locator "${record.provenance.locator ?? ''}" names no pages`,
      });
      continue;
    }
    const grams = windowGrams(window, streams, cache);
    for (const { path, text } of strictStrings(record)) {
      const tokens = shingleTokens(text);
      if (tokens.length === 0) continue;
      if (tokens.length < GRAM_SIZE) {
        if (!windowContainsTokens(tokens, window, streams)) {
          findings.push({
            check: 'record-check',
            key: record.key,
            detail: `${path}: short string "${text.slice(0, 80)}" not found on cited pages ${window.join(',')}`,
          });
        }
        continue;
      }
      const runs = uncoveredRuns(tokens, grams, new Set());
      for (const run of runs) {
        findings.push({
          check: 'record-check',
          key: record.key,
          detail: `${path}: uncovered run "${run.tokens.join(' ').slice(0, 120)}" (${run.tokens.length} tokens) not reproducible from cited pages ${window.join(',')}`,
        });
      }
      // Digit check: covered[] granularity — recompute coverage to find
      // digit-bearing tokens outside any covered shingle.
      const covered = new Array<boolean>(tokens.length).fill(false);
      for (let i = 0; i + GRAM_SIZE <= tokens.length; i++) {
        if (grams.has(gramKey(tokens.slice(i, i + GRAM_SIZE)))) {
          for (let j = i; j < i + GRAM_SIZE; j++) covered[j] = true;
        }
      }
      tokens.forEach((token, index) => {
        if (!covered[index] && /\d/.test(token)) {
          const context = tokens
            .slice(Math.max(0, index - 5), index + 6)
            .join(' ');
          findings.push({
            check: 'digit-check',
            key: record.key,
            detail: `${path}: digit-bearing token "${token}" not shingle-covered on cited pages (context: "${context}")`,
          });
        }
      });
    }
  }
  return findings;
}

function collectScalarBagEntries(value: unknown, out: Set<string>): void {
  if (typeof value === 'number' && Number.isFinite(value)) {
    out.add(String(value));
    if (Number.isInteger(value) && Math.abs(value) >= 1000) {
      // Printed thousands separators tokenize apart ("5,900" → "5","900").
      out.add(value.toLocaleString('en-US'));
      for (const part of value.toLocaleString('en-US').split(',')) {
        out.add(part);
      }
    }
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectScalarBagEntries(item, out);
    return;
  }
  if (typeof value === 'object' && value !== null) {
    for (const child of Object.values(value)) {
      collectScalarBagEntries(child, out);
    }
  }
}

function runPageCoverage(
  pack: RulesPack,
  streams: ReadonlyMap<number, PageStream>,
): {
  readonly findings: readonly Finding[];
  readonly report: readonly PageCoverageEntry[];
} {
  // Pack-side gram index over every record string (plus the record name).
  const grams = new Set<string>();
  const shortStrings = new Set<string>();
  const bag = new Set<string>();
  for (const record of pack.records) {
    const leaves: Array<{ readonly path: string; readonly text: string }> = [];
    walkStrings(record.data, '', leaves);
    for (const { text } of leaves) {
      const tokens = shingleTokens(text);
      addGrams(tokens, grams, shortStrings);
      for (const token of tokens) bag.add(token);
    }
    const nameTokens = shingleTokens(record.name);
    addGrams(nameTokens, grams, shortStrings);
    for (const token of nameTokens) bag.add(token);
    collectScalarBagEntries(record.data, bag);
  }

  const findings: Finding[] = [];
  const report: PageCoverageEntry[] = [];
  for (const stream of [...streams.values()].sort(
    (a, b) => a.pageNumber - b.pageNumber,
  )) {
    if (stream.pageNumber <= FRONT_MATTER_MAX_PAGE) continue;
    const tokens = stream.tokens;
    const runs = uncoveredRuns(tokens, grams, shortStrings);
    // Short-run rescue is line-based in the harness; here whole-page streams
    // make every run ≥ MIN_RUN reportable directly.
    const missing: string[] = [];
    const reordered: string[] = [];
    let uncovered = 0;
    for (const run of runs) {
      uncovered += run.tokens.length;
      const inBag = run.tokens.filter((token) => bag.has(token)).length;
      const text = run.tokens.join(' ').slice(0, 200);
      const excepted = PAGE_COVERAGE_EXCEPTIONS.some(
        (exception) =>
          exception.page === stream.pageNumber &&
          text.includes(exception.contains),
      );
      if (excepted) {
        reordered.push(`(reviewed exception) ${text}`);
      } else if (inBag >= 0.9 * run.tokens.length) {
        reordered.push(text);
      } else {
        missing.push(text);
        findings.push({
          check: 'page-coverage',
          key: `page:${stream.pageNumber}`,
          detail: `uncovered run with novel tokens: "${text}"`,
        });
      }
    }
    if (missing.length > 0 || reordered.length > 0) {
      report.push({
        page: stream.pageNumber,
        tokens: tokens.length,
        uncovered,
        missing,
        reordered,
      });
    }
  }
  return { findings, report };
}

// ---------------------------------------------------------------------------
// Consistency
// ---------------------------------------------------------------------------

function walkObjects(
  value: unknown,
  path: string,
  visit: (node: Record<string, unknown>, path: string) => void,
): void {
  if (Array.isArray(value)) {
    value.forEach((item, index) => {
      walkObjects(item, `${path}[${index}]`, visit);
    });
    return;
  }
  if (typeof value === 'object' && value !== null) {
    const node = value as Record<string, unknown>;
    visit(node, path);
    for (const [key, child] of Object.entries(node)) {
      walkObjects(child, path.length === 0 ? key : `${path}.${key}`, visit);
    }
  }
}

function asString(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function runConsistencyChecks(pack: RulesPack): readonly Finding[] {
  const findings: Finding[] = [];
  const byKey = new Map(pack.records.map((record) => [record.key, record]));

  for (const record of pack.records) {
    // 1. Every {dice, average} node: average must equal the floored mean.
    walkObjects(record.data, '', (node, path) => {
      if (!('dice' in node) || !('average' in node)) return;
      const printed = diceFormulaAverage(String(node.dice));
      if (printed !== null && printed !== node.average) {
        findings.push({
          check: 'consistency',
          key: record.key,
          detail: `${path}: dice "${String(node.dice)}" average ${String(node.average)} != floored mean ${printed}`,
        });
      }
    });

    // 2. Creature/NPC/stat-block attack bonuses and save DCs must match the
    //    entry's own printed text.
    if (record.kind === 'creature' || record.kind === 'stat-block') {
      const data = record.data as Record<string, unknown>;
      const groups: Array<readonly unknown[]> = [];
      for (const groupName of ['actions', 'traits', 'reactions']) {
        const group = data[groupName];
        if (Array.isArray(group)) groups.push(group);
      }
      const legendary = data.legendaryActions;
      if (
        typeof legendary === 'object' &&
        legendary !== null &&
        Array.isArray((legendary as Record<string, unknown>).entries)
      ) {
        groups.push(
          (legendary as Record<string, unknown>).entries as unknown[],
        );
      }
      for (const group of groups) {
        for (const entryValue of group) {
          if (typeof entryValue !== 'object' || entryValue === null) continue;
          const entry = entryValue as Record<string, unknown>;
          const text = asString(entry.text) ?? '';
          const mechanics =
            typeof entry.mechanics === 'object' && entry.mechanics !== null
              ? (entry.mechanics as Record<string, unknown>)
              : null;
          if (mechanics === null || text.length === 0) continue;
          const attacks = Array.isArray(mechanics.attacks)
            ? mechanics.attacks
            : [];
          for (const attackValue of attacks) {
            if (typeof attackValue !== 'object' || attackValue === null) {
              continue;
            }
            const attack = attackValue as Record<string, unknown>;
            const printed = /([+−-]\d+) to hit/.exec(text);
            if (printed !== null) {
              const want = Number(printed[1].replace('−', '-'));
              if (attack.attackBonus !== want) {
                findings.push({
                  check: 'consistency',
                  key: record.key,
                  detail: `${String(entry.name)}: attackBonus ${String(attack.attackBonus)} != printed "${printed[1]} to hit"`,
                });
              }
            }
          }
          const saves = Array.isArray(mechanics.saves) ? mechanics.saves : [];
          for (const saveValue of saves) {
            if (typeof saveValue !== 'object' || saveValue === null) continue;
            const save = saveValue as Record<string, unknown>;
            if (
              typeof save.dc === 'number' &&
              !text.includes(`DC ${save.dc}`)
            ) {
              findings.push({
                check: 'consistency',
                key: record.key,
                detail: `${String(entry.name)}: save DC ${save.dc} not printed in the entry text`,
              });
            }
          }
        }
      }
    }

    // 3. Spell mechanics must be grounded in the spell's own text.
    if (record.kind === 'spell') {
      const data = record.data as Record<string, unknown>;
      const mechanics =
        typeof data.mechanics === 'object' && data.mechanics !== null
          ? (data.mechanics as Record<string, unknown>)
          : null;
      const text = `${asString(data.description) ?? ''} ${asString(data.higherLevels) ?? ''}`;
      const flattened = text.replace(/\s+/g, '');
      if (mechanics !== null) {
        const damage = Array.isArray(mechanics.damage) ? mechanics.damage : [];
        for (const damageValue of damage) {
          if (typeof damageValue !== 'object' || damageValue === null) {
            continue;
          }
          const dice = asString((damageValue as Record<string, unknown>).dice);
          if (dice !== null && !flattened.includes(dice.replace(/\s+/g, ''))) {
            findings.push({
              check: 'consistency',
              key: record.key,
              detail: `mechanics.damage dice "${dice}" not present in spell text`,
            });
          }
        }
        const saves = Array.isArray(mechanics.saves) ? mechanics.saves : [];
        for (const saveValue of saves) {
          if (typeof saveValue !== 'object' || saveValue === null) continue;
          const ability = asString(
            (saveValue as Record<string, unknown>).ability,
          );
          if (ability !== null && ability.length > 0) {
            const phrase = `${ability.charAt(0).toUpperCase()}${ability.slice(1)} saving throw`;
            if (!text.includes(phrase)) {
              findings.push({
                check: 'consistency',
                key: record.key,
                detail: `mechanics.saves ability "${ability}" has no "${phrase}" in spell text`,
              });
            }
          }
        }
        if (
          mechanics.spellAttack === true &&
          !text.toLowerCase().includes('spell attack')
        ) {
          findings.push({
            check: 'consistency',
            key: record.key,
            detail:
              'mechanics.spellAttack is true but "spell attack" never appears in spell text',
          });
        }
      }
    }

    // 4. Class progression rows must agree with the class table record.
    if (record.kind === 'class') {
      const data = record.data as Record<string, unknown>;
      const tableRef = asString(data.progressionTableRef);
      const table = tableRef === null ? undefined : byKey.get(tableRef);
      if (table === undefined) {
        findings.push({
          check: 'consistency',
          key: record.key,
          detail: `progressionTableRef ${String(tableRef)} does not resolve`,
        });
        continue;
      }
      const tableData = table.data as Record<string, unknown>;
      const columns = Array.isArray(tableData.columns)
        ? tableData.columns.map(String)
        : [];
      const rows = Array.isArray(tableData.rows)
        ? (tableData.rows as unknown[][])
        : [];
      const rowByLevel = new Map(rows.map((row) => [String(row[0]), row]));
      const ordinal = (level: number): string => {
        const suffix =
          level === 1 ? 'st' : level === 2 ? 'nd' : level === 3 ? 'rd' : 'th';
        return `${level}${suffix}`;
      };
      const progression = Array.isArray(data.progression)
        ? data.progression
        : [];
      for (const rowValue of progression) {
        if (typeof rowValue !== 'object' || rowValue === null) continue;
        const row = rowValue as Record<string, unknown>;
        const level = Number(row.level);
        const tableRow = rowByLevel.get(ordinal(level));
        if (tableRow === undefined) {
          findings.push({
            check: 'consistency',
            key: record.key,
            detail: `level ${level} missing from ${String(tableRef)}`,
          });
          continue;
        }
        const pbIndex = columns.indexOf('Proficiency Bonus');
        if (pbIndex >= 0) {
          const printed = String(tableRow[pbIndex]);
          if (
            String(row.proficiencyBonus).replace('+', '') !==
            printed.replace('+', '')
          ) {
            findings.push({
              check: 'consistency',
              key: record.key,
              detail: `level ${level}: proficiencyBonus ${String(row.proficiencyBonus)} != table "${printed}"`,
            });
          }
        }
        const featuresIndex = columns.indexOf('Features');
        const advancement = Array.isArray(row.advancement)
          ? row.advancement
          : [];
        if (featuresIndex >= 0) {
          const cell = String(tableRow[featuresIndex]).toLowerCase();
          for (const advValue of advancement) {
            if (typeof advValue !== 'object' || advValue === null) continue;
            const adv = advValue as Record<string, unknown>;
            if (adv.kind !== 'featureGrant') continue;
            const name = asString(adv.name);
            if (name === null) continue;
            const bare = name.split(' (')[0].toLowerCase();
            if (!cell.includes(bare)) {
              findings.push({
                check: 'consistency',
                key: record.key,
                detail: `level ${level}: featureGrant "${name}" not named in the table's Features cell "${String(tableRow[featuresIndex])}"`,
              });
            }
          }
        }
        const spellcasting = advancement.find(
          (advValue) =>
            typeof advValue === 'object' &&
            advValue !== null &&
            (advValue as Record<string, unknown>).kind ===
              'spellcastingProgression',
        ) as Record<string, unknown> | undefined;
        if (spellcasting !== undefined) {
          const slotColumns = columns
            .map((column, index) => ({ column, index }))
            .filter(({ column }) => /^\d+(?:st|nd|rd|th)$/.test(column));
          const slots =
            typeof spellcasting.slots === 'object' &&
            spellcasting.slots !== null
              ? (spellcasting.slots as Record<string, unknown>)
              : {};
          for (const { column, index } of slotColumns) {
            const printed = String(tableRow[index]).trim();
            const printedCount = /^\d+$/.test(printed) ? Number(printed) : null;
            const slotLevel = String(Number.parseInt(column, 10));
            const modeled = slots[slotLevel];
            const modeledCount = typeof modeled === 'number' ? modeled : null;
            if ((printedCount ?? null) !== (modeledCount ?? null)) {
              findings.push({
                check: 'consistency',
                key: record.key,
                detail: `level ${level}: slot level ${slotLevel} table "${printed}" != progression ${String(modeled)}`,
              });
            }
          }
          const cantripsIndex = columns.indexOf('Cantrips Known');
          if (cantripsIndex >= 0) {
            const printed = String(tableRow[cantripsIndex]).trim();
            const printedCount = /^\d+$/.test(printed) ? Number(printed) : null;
            const modeled = spellcasting.cantripsKnown;
            const modeledCount = typeof modeled === 'number' ? modeled : null;
            if ((printedCount ?? null) !== (modeledCount ?? null)) {
              findings.push({
                check: 'consistency',
                key: record.key,
                detail: `level ${level}: cantrips known table "${printed}" != progression ${String(modeled)}`,
              });
            }
          }
        }
      }
    }
  }
  return findings;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const outFlag = process.argv.indexOf('--out');
  const outArg = outFlag >= 0 ? process.argv[outFlag + 1] : undefined;
  const outDir =
    outArg !== undefined
      ? resolve(outArg)
      : mkdtempSync(join(tmpdir(), 'deep-audit-dnd5e-srd-'));
  mkdirSync(outDir, { recursive: true });

  console.log(`Vendored PDF: ${VENDORED_PDF}`);
  console.log(`Committed pack: ${COMMITTED_PACK_DIR}`);
  console.log(`Reports: ${outDir}`);
  console.log('');

  const pack = loadRulesPackFromDirectory(COMMITTED_PACK_DIR);
  const pdf = new Uint8Array(readFileSync(VENDORED_PDF));
  const pages = await extractPdfText(pdf);

  // Pack vocabulary drives the page-side small-caps token repair.
  const vocabulary = new Set<string>();
  for (const record of pack.records) {
    const leaves: Array<{ readonly path: string; readonly text: string }> = [];
    walkStrings(record.data, '', leaves);
    for (const { text } of leaves) {
      for (const token of shingleTokens(text)) vocabulary.add(token);
    }
    for (const token of shingleTokens(record.name)) vocabulary.add(token);
  }
  const streams = buildPageStreams(pages, vocabulary);

  const recordFindings = runRecordAndDigitChecks(pack, streams);
  const pageCoverage = runPageCoverage(pack, streams);
  const consistencyFindings = runConsistencyChecks(pack);

  const allFindings = [
    ...recordFindings,
    ...pageCoverage.findings,
    ...consistencyFindings,
  ];

  writeFileSync(
    join(outDir, 'deep-audit-findings.json'),
    JSON.stringify(allFindings, null, 1),
    'utf8',
  );
  writeFileSync(
    join(outDir, 'page-coverage-report.json'),
    JSON.stringify(pageCoverage.report, null, 1),
    'utf8',
  );

  const byCheck = new Map<string, number>();
  for (const finding of allFindings) {
    byCheck.set(finding.check, (byCheck.get(finding.check) ?? 0) + 1);
  }
  console.log(
    `records: ${pack.records.length}  pages: ${streams.size}  findings: ${allFindings.length}`,
  );
  for (const [check, count] of [...byCheck.entries()].sort()) {
    console.log(`  ${check}: ${count}`);
  }
  const reorderedPages = pageCoverage.report.filter(
    (entry) => entry.reordered.length > 0,
  ).length;
  console.log(
    `  page-coverage reordered runs (review-only): ${pageCoverage.report.reduce((sum, entry) => sum + entry.reordered.length, 0)} across ${reorderedPages} pages`,
  );
  for (const finding of allFindings.slice(0, 60)) {
    console.log(`- [${finding.check}] ${finding.key}: ${finding.detail}`);
  }
  if (allFindings.length > 60) {
    console.log(`… ${allFindings.length - 60} more (see reports)`);
  }

  process.exit(allFindings.length === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error(error);
  process.exit(2);
});
