/**
 * Multi-page provenance enrichment (eshyra-lpk9).
 *
 * `emit.ts` sets every record's `provenance.locator` to the single page its
 * extraction started on (`p. N`). For a record whose body prose actually
 * continues onto a later page, that under-reports discoverability: a primary
 * DM model following the locator to `p. N` alone would miss the rest of the
 * record's own text on `p. N+1`.
 *
 * The source-region ledger (`sourceRegionLedger.ts`) already computes, per
 * record key, every page range its OWN prose (`record:<key>` entries) and
 * child data (`child-of:<key>` entries — e.g. a creature's actions/legendary
 * actions) occupies. This module unions that ledger evidence into the
 * record's existing single-page locator, so provenance reflects the full
 * span without any parser having to track an end page itself.
 *
 * Locator format (documented per eshyra-lpk9's acceptance criteria):
 *   - Single-page record: `p. N` (unchanged).
 *   - Multi-page record, contiguous OR non-contiguous: `pp. N, M, ...` —
 *     ascending, comma-separated, deduplicated page numbers. This matches the
 *     existing convention already used for equipment items whose description
 *     lands on a different page than their table row (`equipmentProvenance`
 *     in emit.ts); eshyra-lpk9 does not introduce a second "N-M" dash-range
 *     notation for contiguous spans, to keep exactly one multi-page format in
 *     the pack.
 *
 * Only records whose CURRENT locator is the plain single-page `p. N` shape
 * are touched — already-multi-page locators (equipment's description-page
 * union) have their own more precise source and are left alone. Pure,
 * deterministic, and a no-op for any record the ledger has no evidence for
 * (fixture pipelines that don't run the full source-coverage gate).
 *
 * A ledger page more than `MAX_CONTINUATION_GAP` pages from the record's own
 * starting page is dropped rather than unioned in. Every genuine multi-page
 * continuation in the committed pack is exactly 2 sequential pages; a "same
 * record" ledger match dozens of pages away would be a same-heading-name
 * collision in source-region ownership, not a physical continuation, and
 * provenance must not repeat it as an unrelated far-away page. A page dropped
 * here for being out of gap range is not silently accepted: the
 * `recordLocatorCompleteness.ts` gate (eshyra-o9bd.19.2.2.3) re-checks every
 * `record:`/`child-of:` ledger entry against the record's FINAL locator and
 * fails the import closed if a genuine continuation's page was ever dropped —
 * the exact defect class this comment used to describe as unfixed.
 */

import type { RulesRecord } from '../../../src/rules/types.js';
import type { SourceRegionLedger } from './sourceRegionLedger.js';

const SINGLE_PAGE_LOCATOR = /^p\. (\d+)$/;
const SRD_5_1_SINGLE_PAGE_SOURCE = /^SRD 5\.1 p\. (\d+)$/;
export const MAX_CONTINUATION_GAP = 3;

/** Every page each record key's prose or child data occupies, per the ledger. */
export function pageSpansByRecordKey(
  regionLedger: SourceRegionLedger,
): ReadonlyMap<string, readonly number[]> {
  const pagesByKey = new Map<string, Set<number>>();
  for (const entry of regionLedger.entries) {
    if (entry.targetKey === undefined) continue;
    // A content-search match (eshyra-lpk9) proves the region's text was
    // reproduced somewhere in the target record's data — e.g. a Druid
    // spell-list page's names also projected into a Circle-of-the-Land table
    // far earlier in the document — not that the record's own content lives
    // on this page. Excluding it is what keeps a page-span from ballooning
    // to cover unrelated pages the record has nothing to do with physically.
    if (entry.contentMatch === true) continue;
    const pages = pagesByKey.get(entry.targetKey) ?? new Set<number>();
    for (let page = entry.pageStart; page <= entry.pageEnd; page++) {
      pages.add(page);
    }
    pagesByKey.set(entry.targetKey, pages);
  }
  const result = new Map<string, readonly number[]>();
  for (const [key, pages] of pagesByKey) {
    result.set(
      key,
      [...pages].sort((a, b) => a - b),
    );
  }
  return result;
}

export function enrichProvenanceFromRegionLedger(
  records: readonly RulesRecord[],
  regionLedger: SourceRegionLedger,
): RulesRecord[] {
  const pageSpans = pageSpansByRecordKey(regionLedger);
  return records.map((record) => {
    const ledgerPages = pageSpans.get(record.key);
    if (ledgerPages === undefined || ledgerPages.length === 0) return record;
    const currentLocator = record.provenance.locator;
    if (currentLocator === undefined) return record;
    const match = SINGLE_PAGE_LOCATOR.exec(currentLocator);
    if (match === null) return record;
    const startPage = Number(match[1]);
    const nearbyPages = ledgerPages.filter(
      (page) => Math.abs(page - startPage) <= MAX_CONTINUATION_GAP,
    );
    const allPages = [...new Set([startPage, ...nearbyPages])].sort(
      (a, b) => a - b,
    );
    if (allPages.length <= 1) return record;
    const locator = `pp. ${allPages.join(', ')}`;
    return {
      ...record,
      source:
        SRD_5_1_SINGLE_PAGE_SOURCE.exec(record.source)?.[1] === match[1]
          ? `SRD 5.1 ${locator}`
          : record.source,
      provenance: {
        ...record.provenance,
        locator,
      },
    };
  });
}

/**
 * Field-level provenance for `spell.data.classes` (eshyra-o9bd.19.2.2.3.1
 * F4), derived from the SAME `structured-field:spell.data.classes` ledger
 * entries the `recordLocatorCompleteness.ts` gate (eshyra-o9bd.19.2.2.3)
 * checks it against — deliberately NOT from a separate, line-level scan of
 * the spell-list pages (`parseSpellClassLevelLists`).
 *
 * `sourceInventoryCoverage.ts`'s `spellListStructuredFieldRules` attaches one
 * shared evidence object — naming every spell in a whole (class, level) group
 * — to that group's owning heading. When the group's printed list spans a
 * page break, `buildSourceRegionLedger` still splits it into one ledger
 * entry per physical page (a page boundary always starts a new region), and
 * every one of those split entries carries the SAME, whole-group evidence.
 * So the ledger's own notion of "the page(s) a spell's class membership is
 * sourced from" is the union of every page any entry naming that spell's key
 * touches — not just the one line the spell's name happens to print on. A
 * field locator computed from `parseSpellClassLevelLists`'s per-line pages
 * would disagree with that whenever a group spans a page break — verified
 * against the real SRD 5.1 corpus: 6 of the 70 (class, level) groups do,
 * affecting 93 spell records — so this function and the gate are built from
 * one shared source instead, which cannot drift apart.
 */
export function enrichSpellClassFieldLocatorsFromRegionLedger(
  records: readonly RulesRecord[],
  regionLedger: SourceRegionLedger,
): RulesRecord[] {
  const pagesBySpellKey = new Map<string, Set<number>>();
  for (const entry of regionLedger.entries) {
    if (entry.classification !== 'structured-field:spell.data.classes') {
      continue;
    }
    const evidence = entry.structuredFieldEvidence;
    if (evidence === undefined) continue;
    for (const spellKey of evidence.spellKeys) {
      const pages = pagesBySpellKey.get(spellKey) ?? new Set<number>();
      for (let page = entry.pageStart; page <= entry.pageEnd; page++) {
        pages.add(page);
      }
      pagesBySpellKey.set(spellKey, pages);
    }
  }

  return records.map((record) => {
    if (record.kind !== 'spell') return record;
    const data = record.data as { readonly classes?: unknown };
    const classes = Array.isArray(data.classes) ? data.classes : [];
    if (classes.length === 0) return record;
    const pages = pagesBySpellKey.get(record.key);
    if (pages === undefined || pages.size === 0) return record;
    const sortedPages = [...pages].sort((a, b) => a - b);
    const locator =
      sortedPages.length === 1
        ? `p. ${sortedPages[0]}`
        : `pp. ${sortedPages.join(', ')}`;
    return {
      ...record,
      provenance: {
        ...record.provenance,
        fieldLocators: {
          ...record.provenance.fieldLocators,
          '/classes': locator,
        },
      },
    };
  });
}
