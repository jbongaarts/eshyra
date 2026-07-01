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
 * record" ledger match dozens of pages away is a bare-heading-name collision
 * in source coverage, not a physical continuation — e.g. every class chapter
 * prints its own one-line "As a barbarian, you gain the following class
 * features" under a heading literally titled "Class Features", and since
 * `rule:class-features` (the general multiclassing rule on p57) is the only
 * record actually named that, the coverage auto-match collapses all 13
 * chapter-opening occurrences onto it. That is a pre-existing source-coverage
 * classification, not something eshyra-lpk9 introduces or fixes — but
 * provenance must not repeat it as thirteen unrelated pages.
 */

import type { RulesRecord } from '../../../src/rules/types.js';
import type { SourceRegionLedger } from './sourceRegionLedger.js';

const SINGLE_PAGE_LOCATOR = /^p\. (\d+)$/;
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
    return {
      ...record,
      provenance: {
        ...record.provenance,
        locator: `pp. ${allPages.join(', ')}`,
      },
    };
  });
}
