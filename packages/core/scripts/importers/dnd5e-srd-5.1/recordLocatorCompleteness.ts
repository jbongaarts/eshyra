/**
 * Record/field locator completeness gate for the D&D 5e SRD 5.1 importer
 * (eshyra-o9bd.19.2.2.3).
 *
 * Invariant: every page the source-region ledger attributes to a record —
 * via a `record:<key>` or `child-of:<key>` classified entry, whether or not
 * that entry also carries `contentMatch` — is cited by that record's own
 * `provenance.locator`. The denominator is the LEDGER (every such entry),
 * not the records: a record cannot pass by omission, only by actually
 * citing every page the ledger says is its own. `contentMatch` entries are
 * NOT excluded here (unlike `enrichProvenance.ts`'s page-union, which
 * deliberately excludes them so a document-wide cross-reference cannot
 * balloon a locator to cover an unrelated page): a page a `contentMatch`
 * entry claims for a record must already be covered by that record's own
 * locator through some other means (its own base page, or a genuine
 * continuation `enrichProvenanceFromRegionLedger` folded in). If it is not,
 * that is either a locator gap or, just as often, a WRONG-OWNERSHIP defect —
 * this gate's error text says so explicitly: fix ownership (reassign which
 * record the ledger region belongs to), never widen the locator to paper
 * over a mismatch.
 *
 * Three further checks extend the same source-vs-output discipline to
 * field-level provenance (`RecordProvenance.fieldLocators`, added alongside
 * this gate):
 *
 *   (b) `spell.data.classes`: every spell's `fieldLocators['/classes']`
 *       pages exactly match the pages on which a ledger
 *       `structured-field:spell.data.classes` entry naming that spell in its
 *       `structuredFieldEvidence.spellKeys` ALSO prints the spell's name as
 *       one of its own source lines — present if and only if `data.classes`
 *       is non-empty. The evidence is per (class, level) group, so a group
 *       whose list spans a page break names every member on each page's
 *       entry; the printed-line check narrows it to the page each spell is
 *       actually printed on. The line text comes from the extracted pages,
 *       independently of the spell-list parser that produces the locator.
 *   (c) every other `fieldLocators` entry: the pointed-to value (a string,
 *       or every string of a string array) is found as whole-token text on
 *       at least one of that entry's own cited pages, reusing the same
 *       anchor-matching helpers `recordSourceAnchors.ts` uses for whole
 *       records. Every equipment record with `data.capacity` and every class
 *       record with non-empty `data.primaryAbilities` (in this corpus, that
 *       field has exactly one source — the Multiclassing prerequisites
 *       index — so "non-empty" and "from the index" coincide) must carry the
 *       matching field locator; a silently-missing one fails closed here
 *       rather than passing by omission.
 *
 * `requireComplete` gates the PRESENCE requirements above — a spell's
 * non-empty `classes` needing `fieldLocators['/classes']` at all, and an
 * equipment/class record's `capacity`/`primaryAbilities` needing its field
 * locator at all — and the exact-pages comparison in (b), whose denominator is
 * the ledger's `structured-field:spell.data.classes` entries: a fixture's
 * coverage rules may classify its spell-list lines some other way (e.g. a
 * catch-all ignore), leaving the ledger no evidence to compare against. Mirrors `assertRecordsAnchoredInSource`'s
 * `requireDeclarationsLive` / `assertCreatureAttackLeadInsSegmented`'s
 * `requireComplete` elsewhere in this importer: a reduced fixture PDF's
 * `SpellExtraction`/`EquipmentExtraction` test data can set `classes` /
 * `capacity` directly without going through the real spell-list / Container
 * Capacity parsing this gate's field locators are sourced from, so demanding
 * their presence unconditionally would fail every such fixture closed for a
 * completeness property the fixture never claimed. Only the real CLI import
 * (`assertDeclarationsAreLive`) has the full corpus this presence check is
 * meaningful against. Every OTHER check here — record locator coverage (a),
 * an EXISTING field locator's anchor text (c), and the
 * source-label consistency check (d) — is unconditional: those check internal
 * consistency of whatever the pipeline actually emitted, which is meaningful
 * for any fixture, reduced or not.
 *   (d) `record.source` equals `SRD 5.1 ${provenance.locator}` for every
 *       record with a locator — a plain consistency check between the two
 *       independently-computed source-label and provenance-locator values
 *       every emitter function derives from the same page set.
 *
 * Throws ONE error listing every violation found (not just the first), so a
 * run that regenerates the pack reports the complete failure set in one
 * pass — mirroring `assertRecordsAnchoredInSource`'s aggregation shape.
 */

import type { RulesRecord } from '../../../src/rules/types.js';
import {
  anchorFoundOnAnyPage,
  citedPages,
  normalizeAnchorText,
  normalizedPageTextByNumber,
  RecordSourceAnchorError,
} from './recordSourceAnchors.js';
import type { SourceRegionLedger } from './sourceRegionLedger.js';
import type { PageText } from './types.js';

export class RecordLocatorCompletenessError extends Error {
  constructor(violations: readonly string[]) {
    super(
      `record/field locator completeness gate failed for ${violations.length} violation(s):\n${violations.map((v) => `  ${v}`).join('\n')}`,
    );
    this.name = 'RecordLocatorCompletenessError';
  }
}

/** `citedPages`, but returns `undefined` instead of throwing. */
function safeCitedPages(
  locator: string | undefined,
): readonly number[] | undefined {
  try {
    return citedPages(locator);
  } catch (error) {
    if (error instanceof RecordSourceAnchorError) return undefined;
    throw error;
  }
}

/**
 * Resolve a JSON Pointer (RFC 6901) into a value. Mirrors
 * `src/rules/validate.ts`'s resolver (kept separate: `src/rules` cannot
 * depend on importer scripts, and this one function is small enough that
 * duplicating it is cheaper than introducing a shared module for it alone).
 */
function resolveJsonPointer(
  data: unknown,
  pointer: string,
): { readonly found: boolean; readonly value: unknown } {
  if (!pointer.startsWith('/')) return { found: false, value: undefined };
  const segments = pointer
    .slice(1)
    .split('/')
    .map((segment) => segment.replace(/~1/g, '/').replace(/~0/g, '~'));
  let current: unknown = data;
  for (const segment of segments) {
    if (typeof current !== 'object' || current === null) {
      return { found: false, value: undefined };
    }
    if (Array.isArray(current)) {
      const index = Number(segment);
      if (!Number.isInteger(index) || index < 0 || index >= current.length) {
        return { found: false, value: undefined };
      }
      current = current[index];
      continue;
    }
    if (!(segment in current)) {
      return { found: false, value: undefined };
    }
    current = (current as Record<string, unknown>)[segment];
  }
  return { found: true, value: current };
}

function arraysEqual(a: readonly number[], b: readonly number[]): boolean {
  return a.length === b.length && a.every((value, i) => value === b[i]);
}

/** (a) Record locator: every `record:`/`child-of:` ledger entry's pages. */
function checkRecordLocators(
  records: readonly RulesRecord[],
  ledger: SourceRegionLedger,
  violations: string[],
): void {
  const byKey = new Map(records.map((r) => [r.key, r] as const));
  const citedPagesByKey = new Map<string, readonly number[] | undefined>();
  const reported = new Set<string>();
  for (const entry of ledger.entries) {
    if (
      !entry.classification.startsWith('record:') &&
      !entry.classification.startsWith('child-of:')
    ) {
      continue;
    }
    const key = entry.targetKey;
    if (key === undefined) continue;
    const record = byKey.get(key);
    if (record === undefined) {
      const reportKey = `missing-record::${key}`;
      if (!reported.has(reportKey)) {
        reported.add(reportKey);
        violations.push(
          `${key}: ledger entry ${entry.id} (${entry.classification}) references this record key, but no record with that key was emitted`,
        );
      }
      continue;
    }
    if (!citedPagesByKey.has(key)) {
      citedPagesByKey.set(key, safeCitedPages(record.provenance.locator));
    }
    const citedRecordPages = citedPagesByKey.get(key);
    if (citedRecordPages === undefined) {
      const reportKey = `unparseable::${key}`;
      if (!reported.has(reportKey)) {
        reported.add(reportKey);
        violations.push(
          `${key}: provenance.locator ${JSON.stringify(record.provenance.locator)} is missing or unparseable, so ledger coverage cannot be verified (first offending entry: ${entry.id})`,
        );
      }
      continue;
    }
    const citedSet = new Set(citedRecordPages);
    for (let page = entry.pageStart; page <= entry.pageEnd; page++) {
      if (citedSet.has(page)) continue;
      const reportKey = `${key}::${page}`;
      if (reported.has(reportKey)) continue;
      reported.add(reportKey);
      violations.push(
        `${key}: ledger entry ${entry.id} (${entry.classification}) places page ${page} on this record, but provenance.locator (${JSON.stringify(record.provenance.locator)}) does not cite it — if page ${page} actually belongs to a DIFFERENT record, fix that region's ownership, never widen ${key}'s locator to cover a page that is not really its own`,
      );
    }
  }
}

/** (b) Spell `/classes` field locator vs. the ledger's structured-field evidence. */
function checkSpellClassFieldLocators(
  records: readonly RulesRecord[],
  ledger: SourceRegionLedger,
  pages: readonly PageText[],
  requireComplete: boolean,
  violations: string[],
): void {
  const recordNameByKey = new Map(
    records
      .filter((record) => record.kind === 'spell')
      .map((record) => [record.key, normalizeAnchorText(record.name)] as const),
  );
  const linesByPage = new Map(
    pages.map((page) => [page.pageNumber, page.lines] as const),
  );
  const pagesBySpellKey = new Map<string, Set<number>>();
  for (const entry of ledger.entries) {
    if (entry.classification !== 'structured-field:spell.data.classes') {
      continue;
    }
    const evidence = entry.structuredFieldEvidence;
    if (evidence === undefined) continue;
    for (let page = entry.pageStart; page <= entry.pageEnd; page++) {
      const lines = linesByPage.get(page) ?? [];
      const first = page === entry.pageStart ? entry.lineStart : 0;
      const last =
        page === entry.pageEnd ? entry.lineEnd : Math.max(lines.length - 1, 0);
      const printed = new Set(
        lines.slice(first, last + 1).map((line) => normalizeAnchorText(line)),
      );
      for (const spellKey of evidence.spellKeys) {
        const name = recordNameByKey.get(spellKey);
        if (name === undefined || !printed.has(name)) continue;
        const spellPages = pagesBySpellKey.get(spellKey) ?? new Set<number>();
        spellPages.add(page);
        pagesBySpellKey.set(spellKey, spellPages);
      }
    }
  }

  for (const record of records) {
    if (record.kind !== 'spell') continue;
    const data = record.data as { readonly classes?: unknown };
    const classes = Array.isArray(data.classes) ? data.classes : [];
    const expectedPages = [
      ...(pagesBySpellKey.get(record.key) ?? new Set<number>()),
    ].sort((a, b) => a - b);
    const locatorValue = record.provenance.fieldLocators?.['/classes'];

    if (classes.length === 0) {
      if (locatorValue !== undefined) {
        violations.push(
          `${record.key}: fieldLocators['/classes'] must be absent when data.classes is empty, found ${JSON.stringify(locatorValue)}`,
        );
      }
      continue;
    }
    if (locatorValue === undefined) {
      if (requireComplete) {
        violations.push(
          `${record.key}: fieldLocators['/classes'] is required when data.classes is non-empty (expected pages [${expectedPages.join(', ')}] from the ledger's structured-field:spell.data.classes entries)`,
        );
      }
      continue;
    }
    // Exact pages need the ledger's spell-list classification, which only
    // the real corpus's coverage rules supply (see `requireComplete`).
    if (!requireComplete) continue;
    const actualPages = safeCitedPages(locatorValue) ?? [];
    if (!arraysEqual(actualPages, expectedPages)) {
      violations.push(
        `${record.key}: fieldLocators['/classes'] cites pages [${actualPages.join(', ')}], but the spell-list lines printing this spell (ledger structured-field:spell.data.classes entries) are on [${expectedPages.join(', ')}]`,
      );
    }
  }
}

/** (c) Every other fieldLocators entry: anchor-verify + presence checks. */
function checkOtherFieldLocators(
  records: readonly RulesRecord[],
  pages: readonly PageText[],
  requireComplete: boolean,
  violations: string[],
): void {
  const normalizedPages = normalizedPageTextByNumber(pages);

  for (const record of records) {
    const locators = record.provenance.fieldLocators;
    if (locators !== undefined) {
      for (const [pointer, locatorValue] of Object.entries(locators)) {
        if (record.kind === 'spell' && pointer === '/classes') continue; // gate (b)
        const citedFieldPages = safeCitedPages(locatorValue);
        if (citedFieldPages === undefined || citedFieldPages.length === 0) {
          violations.push(
            `${record.key}: fieldLocators['${pointer}'] value ${JSON.stringify(locatorValue)} is not a parseable page locator`,
          );
          continue;
        }
        const resolved = resolveJsonPointer(record.data, pointer);
        if (!resolved.found) {
          violations.push(
            `${record.key}: fieldLocators['${pointer}'] does not resolve to a value in data (validateRulesPack should already reject this)`,
          );
          continue;
        }
        const texts: readonly string[] =
          typeof resolved.value === 'string'
            ? [resolved.value]
            : Array.isArray(resolved.value) &&
                resolved.value.every((v) => typeof v === 'string')
              ? (resolved.value as readonly string[])
              : [];
        if (texts.length === 0) {
          violations.push(
            `${record.key}: fieldLocators['${pointer}'] points to a value that is neither a string nor a string array; cannot verify it against source text`,
          );
          continue;
        }
        for (const text of texts) {
          if (!anchorFoundOnAnyPage(text, citedFieldPages, normalizedPages)) {
            violations.push(
              `${record.key}: fieldLocators['${pointer}'] value ${JSON.stringify(text)} was not found as whole-token text on its cited page(s) (${locatorValue})`,
            );
          }
        }
      }
    }

    if (!requireComplete) continue;

    if (record.kind === 'equipment') {
      const data = record.data as { readonly capacity?: unknown };
      if (
        data.capacity !== undefined &&
        (locators === undefined || locators['/capacity'] === undefined)
      ) {
        violations.push(
          `${record.key}: has data.capacity but no fieldLocators['/capacity']`,
        );
      }
    }
    if (record.kind === 'class') {
      const data = record.data as { readonly primaryAbilities?: unknown };
      const primaryAbilities = Array.isArray(data.primaryAbilities)
        ? data.primaryAbilities
        : [];
      if (
        primaryAbilities.length > 0 &&
        (locators === undefined || locators['/primaryAbilities'] === undefined)
      ) {
        violations.push(
          `${record.key}: has non-empty data.primaryAbilities but no fieldLocators['/primaryAbilities']`,
        );
      }
    }
  }
}

/** (d) record.source must equal "SRD 5.1 ${provenance.locator}" when a locator is present. */
function checkSourceLabelMatchesLocator(
  records: readonly RulesRecord[],
  violations: string[],
): void {
  for (const record of records) {
    const locator = record.provenance.locator;
    if (locator === undefined) continue;
    const expected = `SRD 5.1 ${locator}`;
    if (record.source !== expected) {
      violations.push(
        `${record.key}: record.source ${JSON.stringify(record.source)} does not match ${JSON.stringify(expected)} derived from provenance.locator`,
      );
    }
  }
}

export interface AssertRecordLocatorCompletenessOptions {
  /**
   * Also require the field-locator PRESENCE checks in (b) and (c) — see the
   * module header. Only the real CLI import has the full corpus these
   * presence requirements are meaningful against; mirrors
   * `AssertRecordsAnchoredInSourceOptions.requireDeclarationsLive` and
   * `requireComplete` elsewhere in this importer.
   */
  readonly requireComplete: boolean;
}

/**
 * Assert record/field locator completeness across the final emitted record
 * set. See the module header for the full invariant. Call this AFTER
 * `enrichProvenanceFromRegionLedger` (so multi-page continuations are
 * already folded into `provenance.locator`) and before any output is
 * written.
 */
export function assertRecordLocatorCompleteness(
  records: readonly RulesRecord[],
  ledger: SourceRegionLedger,
  pages: readonly PageText[],
  options: AssertRecordLocatorCompletenessOptions,
): void {
  const violations: string[] = [];
  checkRecordLocators(records, ledger, violations);
  checkSpellClassFieldLocators(
    records,
    ledger,
    pages,
    options.requireComplete,
    violations,
  );
  checkOtherFieldLocators(records, pages, options.requireComplete, violations);
  checkSourceLabelMatchesLocator(records, violations);
  if (violations.length > 0) {
    throw new RecordLocatorCompletenessError(violations);
  }
}
