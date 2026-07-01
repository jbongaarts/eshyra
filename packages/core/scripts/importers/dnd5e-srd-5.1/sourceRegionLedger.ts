/**
 * Source-region ledger for the D&D 5e SRD 5.1 importer.
 *
 * `sourceInventory.ts` accounts for typography-derived structures: headings,
 * tables, and stat blocks. This companion ledger accounts for contiguous
 * prose-height regions between those structures, so prose cannot hide behind a
 * broad heading-level ignore such as `ignored:document-structure`.
 *
 * Table-row accounting (eshyra-erf5.5): table-cell-height runs are normally
 * skipped here because their content is already represented by the owning
 * caption's coverage status (a `table:` record's rows, or rows emitted as
 * their own records — e.g. the Adventuring Gear price list's equipment
 * records). That is a deliberate design decision, not an omission — but it
 * must not let a PAGE disappear from the ledger entirely: a page consisting
 * only of table rows (p362's Norse Deities continuation, p69's price-list
 * body with its embedded sub-group captions, which render at cell height and
 * are typographically indistinguishable from rows) previously had zero ledger
 * entries while the summary still claimed `unrepresented: 0`. So any cell run
 * touching a page that would otherwise have no ledger entry now gets an
 * explicit `table-rows` entry stating what represents it, and the summary's
 * `unaccountedPages` lists any non-empty page with neither a ledger entry nor
 * a source-inventory coverage item — asserted empty by
 * `assertSourceRegionLedger`, so a page can no longer vanish silently.
 */

import {
  classifyTier,
  isTableCell,
  type SourceInventoryItem,
} from './sourceInventory.js';
import {
  type CoverageRecordRef,
  formatCoverageStatus,
  type SourceCoverageEntry,
} from './sourceInventoryCoverage.js';
import type { PageText } from './types.js';

export type SourceRegionType =
  | 'chapter-intro'
  | 'appendix-intro'
  | 'group-intro'
  | 'record-body'
  | 'table-preface'
  | 'orphan-prose'
  | 'pure-structure'
  | 'table-rows';

export type SourceRegionClassification =
  | `record:${string}`
  | `child-of:${string}`
  | `intentionally-ignored:${string}`
  | 'pure-document-structure'
  | 'unrepresented';

export interface SourceRegionLedgerEntry {
  readonly id: string;
  readonly pageStart: number;
  readonly pageEnd: number;
  readonly lineStart: number;
  readonly lineEnd: number;
  readonly headingPath: readonly string[];
  readonly sourceContext: string | null;
  readonly regionType: SourceRegionType;
  readonly firstPhrase: string;
  readonly lastPhrase: string;
  readonly normalizedCharCount: number;
  readonly classification: SourceRegionClassification;
  readonly targetKey?: string;
  readonly ignoreReason?: string;
  readonly guardNotes?: string;
  /**
   * True when `targetKey` came from a document-wide text-content search
   * (`findRepresentingRecord`) rather than from the region's own owning
   * heading. A content match proves the region's TEXT was reproduced
   * somewhere in the target record's data (e.g. a spell-list page's names
   * also projected into a table's rows); it says nothing about which PAGE
   * that record's own content lives on, so consumers computing a record's
   * physical page span (eshyra-lpk9) must exclude these entries.
   */
  readonly contentMatch?: boolean;
}

export interface SourceRegionLedger {
  readonly summary: {
    readonly entries: number;
    readonly proseRegions: number;
    readonly pureStructure: number;
    readonly record: number;
    readonly childOf: number;
    readonly intentionallyIgnored: Readonly<Record<string, number>>;
    readonly pureDocumentStructure: number;
    readonly unrepresented: number;
    readonly broadStructuralIgnores: number;
    /**
     * Non-empty source pages (beyond front matter) with neither a ledger
     * entry nor a source-inventory coverage item (eshyra-erf5.5). Must be
     * empty: a page silently owning no accounting at all is exactly the
     * failure mode this ledger exists to prevent.
     */
    readonly unaccountedPages: readonly number[];
  };
  readonly entries: readonly SourceRegionLedgerEntry[];
}

interface FlatLine {
  readonly page: number;
  readonly lineIndex: number;
  readonly text: string;
  readonly height: number | undefined;
  readonly gap: number | null | undefined;
}

interface ActiveOwner {
  readonly item: SourceInventoryItem;
  readonly status: string;
}

interface SearchableRecord {
  readonly key: string;
  readonly text: string;
}

interface RegionSegment {
  readonly body: string;
  readonly idSuffix: string;
}

/**
 * A contiguous run of table-cell-height lines skipped by the prose walk
 * because their content is represented via the owning caption's coverage
 * status (eshyra-erf5.5). Tracked so a page consisting only of such runs can
 * still receive an explicit ledger entry instead of silently owning nothing.
 */
interface TableCellRun {
  readonly owner: ActiveOwner | undefined;
  readonly headingPath: readonly string[];
  readonly lines: FlatLine[];
}

const BROAD_STRUCTURAL_IGNORES = new Set([
  'ignored:document-structure',
  'ignored:record-group-heading',
]);

const PROSE_REQUIRES_REPRESENTATION_IGNORE_REASONS = new Set([
  'equipment-category-heading',
  'subclass-spell-table-heading',
  'table-rows-emitted-as-records',
]);

const FRONT_MATTER_MAX_PAGE = 2;
const PHRASE_WORD_LIMIT = 14;

function flattenPages(pages: readonly PageText[]): readonly FlatLine[] {
  return pages.flatMap((page) =>
    page.lines.map((line, lineIndex) => ({
      page: page.pageNumber,
      lineIndex,
      text: line.trim(),
      height: page.lineHeights?.[lineIndex],
      gap: page.lineGaps?.[lineIndex],
    })),
  );
}

function locationKey(page: number, lineIndex: number): string {
  return `${page}:${lineIndex}`;
}

function normalizeText(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

function normalizeForSearch(text: string): string {
  return normalizeText(text)
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/\s*([—–-])\s*/g, '$1')
    .toLowerCase();
}

function slug(text: string): string {
  return normalizeForSearch(text)
    .replace(/['"]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function phrase(text: string, fromEnd = false): string {
  const normalized = normalizeText(text);
  const words = normalized.split(' ').filter(Boolean);
  const selected = fromEnd
    ? words.slice(Math.max(0, words.length - PHRASE_WORD_LIMIT))
    : words.slice(0, PHRASE_WORD_LIMIT);
  return selected.join(' ');
}

function tierRank(tier: SourceInventoryItem['tier']): number {
  switch (tier) {
    case 'chapter':
      return 0;
    case 'section':
      return 1;
    case 'subsection':
      return 2;
    case 'leaf':
      return 3;
    case 'sidebar':
      return 4;
    case null:
      return 5;
  }
}

function updateHeadingPath(
  path: readonly string[],
  item: SourceInventoryItem,
): readonly string[] {
  if (item.tier === null) return path;
  const rank = tierRank(item.tier);
  return [...path.slice(0, rank), item.text];
}

/**
 * True when `owner` is a sidebar/callout heading that `sourceInventory.ts`
 * classified as a `table-caption` (eshyra-5c7f). Sidebar box body prose
 * renders in the same h≈8.9 table-cell band as real table rows/cells (see
 * `isTableCell`'s own doc comment), so a heading immediately followed by a
 * sidebar's body reads exactly like a heading immediately followed by a real
 * table. For a GENUINE table caption this is correct — its rows are already
 * accounted for by the emitted `table:` record, so skipping them here avoids
 * double-counting. But a sidebar has no such `table:` record: skipping its
 * body the same way silently drops the only prose that could ever attribute
 * a ledger entry to it, so its heading gets a correct coverage status but
 * zero owned ledger entries. Tier is the reliable discriminator: every
 * `table-caption` item this misclassifies as sidebar prose is `tier:
 * 'sidebar'` (h≈10.8), while every genuine table caption is `tier: 'leaf'`
 * or higher.
 */
function isSidebarBodyOwner(owner: ActiveOwner | undefined): boolean {
  return (
    owner !== undefined &&
    owner.item.tier === 'sidebar' &&
    owner.item.structure === 'table-caption'
  );
}

function regionTypeForOwner(owner: ActiveOwner | undefined): SourceRegionType {
  if (owner === undefined) return 'orphan-prose';
  // A sidebar's body is the record's own text, not a preface to a table that
  // doesn't exist (eshyra-5c7f) — check this before the general table-caption
  // case below.
  if (isSidebarBodyOwner(owner)) return 'record-body';
  if (owner.item.structure === 'table-caption') return 'table-preface';
  if (/^Appendix\b/.test(owner.item.text)) return 'appendix-intro';
  if (owner.item.tier === 'chapter') return 'chapter-intro';
  if (
    owner.item.tier === 'section' ||
    owner.item.tier === 'subsection' ||
    owner.status === 'ignored:record-group-heading'
  ) {
    return 'group-intro';
  }
  return 'record-body';
}

/**
 * Classify a region using only its owning heading's coverage status — never
 * the document-wide content search. Factored out so `classifyRegion` can
 * compare a content-search match against what the owner alone would have
 * produced (eshyra-lpk9's `contentMatch` discriminator).
 */
function classifyRegionByOwner(
  owner: ActiveOwner | undefined,
): Pick<
  SourceRegionLedgerEntry,
  'classification' | 'targetKey' | 'ignoreReason' | 'guardNotes'
> {
  if (owner === undefined) {
    return {
      classification: 'unrepresented',
      guardNotes: 'No preceding source structure owns this prose region.',
    };
  }

  const structuredClassKey = classChildDataKey(owner);
  if (structuredClassKey !== undefined) {
    return {
      classification: `child-of:${structuredClassKey}`,
      targetKey: structuredClassKey,
      guardNotes:
        'Class Features metadata is represented as structured child data on the class record.',
    };
  }

  const contextualRecordKey = contextualAmbiguousCandidate(owner);
  if (contextualRecordKey !== undefined) {
    return {
      classification: `record:${contextualRecordKey}`,
      targetKey: contextualRecordKey,
      guardNotes:
        'Duplicate source heading resolved by source section context.',
    };
  }

  const ambiguousRecordKey = nonTableAmbiguousCandidate(owner.status);
  if (ambiguousRecordKey !== undefined) {
    return {
      classification: `record:${ambiguousRecordKey}`,
      targetKey: ambiguousRecordKey,
      guardNotes:
        'Ambiguous source heading also names a table; prose is owned by the non-table record.',
    };
  }

  if (owner.status.startsWith('record:')) {
    const targetKey = owner.status.slice('record:'.length);
    return { classification: owner.status as `record:${string}`, targetKey };
  }
  if (owner.status.startsWith('child-of:')) {
    const targetKey = owner.status.slice('child-of:'.length);
    return {
      classification: owner.status as `child-of:${string}`,
      targetKey,
    };
  }
  if (owner.status.startsWith('ignored:')) {
    const reason = owner.status.slice('ignored:'.length);
    if (BROAD_STRUCTURAL_IGNORES.has(owner.status)) {
      return {
        classification: 'unrepresented',
        ignoreReason: reason,
        guardNotes:
          'Prose-bearing region is attached only to a broad structural ignore.',
      };
    }
    if (PROSE_REQUIRES_REPRESENTATION_IGNORE_REASONS.has(reason)) {
      return {
        classification: 'unrepresented',
        ignoreReason: reason,
        guardNotes:
          'This ignore reason is not valid for prose-bearing regions unless the prose is represented by a generated record.',
      };
    }
    return {
      classification: `intentionally-ignored:${reason}`,
      ignoreReason: reason,
    };
  }

  return {
    classification: 'unrepresented',
    guardNotes: `Owning source structure has non-covering status ${owner.status}.`,
  };
}

function classifyRegion(
  owner: ActiveOwner | undefined,
  pageStart: number,
  body: string,
  searchableRecords: readonly SearchableRecord[],
): Pick<
  SourceRegionLedgerEntry,
  | 'classification'
  | 'targetKey'
  | 'ignoreReason'
  | 'guardNotes'
  | 'contentMatch'
> {
  if (pageStart <= FRONT_MATTER_MAX_PAGE) {
    return {
      classification: 'intentionally-ignored:front-matter',
      ignoreReason: 'front-matter',
      guardNotes: 'Front-matter prose is outside SRD rules content.',
    };
  }

  const ownerBased = classifyRegionByOwner(owner);
  const representedRecordKey = findRepresentingRecord(
    body,
    owner,
    searchableRecords,
  );
  if (representedRecordKey !== undefined) {
    // A same-named heading disambiguates to `ambiguous:a|b` (no single
    // owner-implied key); the content search choosing one of those exact
    // candidates (e.g. "Ready" -> action:ready vs rule:ready) is a genuine,
    // intended disambiguation, not a cross-reference.
    const ambiguousCandidates = owner?.status.startsWith('ambiguous:')
      ? owner.status.slice('ambiguous:'.length).split('|')
      : [];
    // A content match that lands on the SAME key the owner already implies
    // (or on one of an ambiguous owner's own candidates) is just confirming
    // genuine physical containment — safe for page-span purposes. A match on
    // a DIFFERENT, unrelated key is a document-wide cross-reference (e.g. a
    // spell-list page's names also projected into an unrelated table's rows
    // far earlier in the document) and must be flagged (eshyra-lpk9's
    // `contentMatch`) so page-span consumers exclude it.
    const isSelfConsistent =
      ownerBased.targetKey === representedRecordKey ||
      ambiguousCandidates.includes(representedRecordKey);
    return {
      classification: `record:${representedRecordKey}`,
      targetKey: representedRecordKey,
      guardNotes:
        'Region text is contained in generated record data; heading status alone was not used.',
      ...(isSelfConsistent ? {} : { contentMatch: true }),
    };
  }

  return ownerBased;
}

function classChildDataKey(owner: ActiveOwner): string | undefined {
  if (
    owner.item.section === null ||
    !['Hit Points', 'Proficiencies', 'Equipment'].includes(owner.item.text)
  ) {
    return undefined;
  }
  return `class:${slug(owner.item.section)}`;
}

function nonTableAmbiguousCandidate(status: string): string | undefined {
  if (!status.startsWith('ambiguous:')) return undefined;
  const candidates = status.slice('ambiguous:'.length).split('|');
  const nonTable = candidates.filter(
    (candidate) => !candidate.startsWith('table:'),
  );
  if (nonTable.length !== 1) return undefined;
  if (
    nonTable[0].startsWith('magic-item:') ||
    nonTable[0].startsWith('hazard:') ||
    nonTable[0].startsWith('background:')
  ) {
    return nonTable[0];
  }
  return undefined;
}

function contextualAmbiguousCandidate(owner: ActiveOwner): string | undefined {
  if (!owner.status.startsWith('ambiguous:')) return undefined;
  const candidates = owner.status.slice('ambiguous:'.length).split('|');
  if (
    owner.item.text === 'Acolyte' &&
    candidates.includes('background:acolyte')
  ) {
    return 'background:acolyte';
  }
  if (owner.item.section === 'Magic Items') {
    const magicItem = candidates.find((candidate) =>
      candidate.startsWith('magic-item:'),
    );
    if (magicItem !== undefined) return magicItem;
  }
  if (owner.item.section === 'Spellcasting') {
    const hazard = candidates.find((candidate) =>
      candidate.startsWith('hazard:'),
    );
    if (hazard !== undefined) return hazard;
  }
  return undefined;
}

function collectStrings(value: unknown, out: string[]): void {
  if (typeof value === 'string') {
    out.push(value);
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectStrings(item, out);
    return;
  }
  if (typeof value === 'object' && value !== null) {
    for (const child of Object.values(value)) collectStrings(child, out);
  }
}

function buildSearchableRecords(
  records: readonly CoverageRecordRef[],
): readonly SearchableRecord[] {
  return records.map((record) => {
    const strings: string[] = [];
    collectStrings(record.data, strings);
    return {
      key: record.key,
      text: normalizeForSearch(strings.join(' ')),
    };
  });
}

function equipmentDescriptionLeadIns(
  records: readonly CoverageRecordRef[],
): readonly string[] {
  const leadIns = new Set<string>();
  for (const record of records) {
    if (record.kind !== 'equipment') continue;
    const description =
      typeof record.data === 'object' &&
      record.data !== null &&
      'description' in record.data &&
      typeof record.data.description === 'string'
        ? record.data.description
        : undefined;
    if (description === undefined) continue;
    const leadIn = /^(.{1,80}?)\.\s+/.exec(description)?.[1]?.trim();
    if (leadIn !== undefined && leadIn.length > 0) {
      leadIns.add(leadIn);
    }
  }
  return [...leadIns].sort((a, b) => b.length - a.length || a.localeCompare(b));
}

function splitAtLeadIns(
  body: string,
  leadIns: readonly string[],
): readonly string[] {
  const matches: Array<{ readonly index: number; readonly length: number }> =
    [];
  for (const leadIn of leadIns) {
    let offset = 0;
    const needle = `${leadIn}.`;
    while (offset < body.length) {
      const index = body.indexOf(needle, offset);
      if (index < 0) break;
      if (index === 0 || /\s/.test(body[index - 1] ?? '')) {
        matches.push({ index, length: needle.length });
      }
      offset = index + needle.length;
    }
  }
  const starts = new Set<number>([0]);
  let coveredUntil = 0;
  for (const match of matches.sort(
    (a, b) => a.index - b.index || b.length - a.length,
  )) {
    if (match.index < coveredUntil) continue;
    starts.add(match.index);
    coveredUntil = match.index + match.length;
  }
  const ordered = [...starts].sort((a, b) => a - b);
  const segments: string[] = [];
  for (let i = 0; i < ordered.length; i++) {
    const start = ordered[i];
    const end = ordered[i + 1] ?? body.length;
    const segment = body.slice(start, end).trim();
    if (segment.length > 0) segments.push(segment);
  }
  return segments;
}

function splitRegionBody(
  owner: ActiveOwner | undefined,
  body: string,
  leadIns: readonly string[],
): readonly RegionSegment[] {
  if (owner?.item.section !== 'Equipment') {
    return [{ body, idSuffix: '' }];
  }
  const adventuringIntro =
    'This section describes items that have special rules or require further explanation.';
  const parts =
    owner.item.text === 'Adventuring Gear' && body.startsWith(adventuringIntro)
      ? [adventuringIntro, body.slice(adventuringIntro.length).trim()].filter(
          (part) => part.length > 0,
        )
      : [body];
  return parts.flatMap((part, partIndex) =>
    splitAtLeadIns(part, leadIns).map((segment, segmentIndex) => ({
      body: segment,
      idSuffix:
        partIndex === 0 && segmentIndex === 0
          ? ''
          : `-segment-${partIndex}-${segmentIndex}`,
    })),
  );
}

function findRepresentingRecord(
  body: string,
  owner: ActiveOwner | undefined,
  records: readonly SearchableRecord[],
): string | undefined {
  const needle = normalizeForSearch(body);
  if (needle.length === 0) return undefined;
  const matches = records.filter((record) => record.text.includes(needle));
  if (matches.length === 0) return undefined;
  if (matches.length === 1) return matches[0].key;

  const sectionSlug =
    owner?.item.section === null || owner?.item.section === undefined
      ? undefined
      : slug(owner.item.section);
  const headingSlug = owner === undefined ? undefined : slug(owner.item.text);
  // Section-slug matches win outright: same-boilerplate headings recur across
  // sections (every class has an identically worded "Ability Score
  // Improvement" feature), so a heading-slug hit alone cannot distinguish the
  // owning section's record from its 11 siblings (eshyra-erf5.6).
  const preferred =
    matches.find(
      (record) =>
        sectionSlug !== undefined && record.key.includes(`:${sectionSlug}:`),
    ) ??
    matches.find(
      (record) =>
        headingSlug !== undefined &&
        (record.key.endsWith(`:${headingSlug}`) ||
          record.key.includes(`:${headingSlug}:`)),
    );
  if (preferred !== undefined) return preferred.key;
  if (matches.every((record) => record.key.startsWith('equipment:'))) {
    return [...matches].sort((a, b) => a.key.localeCompare(b.key))[0]?.key;
  }
  return undefined;
}

function pureStructureEntry(
  item: SourceInventoryItem,
  status: string,
  headingPath: readonly string[],
): SourceRegionLedgerEntry {
  const classification =
    status === 'ignored:document-structure' ||
    status === 'ignored:record-group-heading'
      ? 'pure-document-structure'
      : status.startsWith('ignored:')
        ? (`intentionally-ignored:${status.slice('ignored:'.length)}` as const)
        : 'pure-document-structure';
  const ignoreReason = classification.startsWith('intentionally-ignored:')
    ? classification.slice('intentionally-ignored:'.length)
    : undefined;
  return {
    id: `p${item.page}-l${item.lineIndex}-pure-structure`,
    pageStart: item.page,
    pageEnd: item.page,
    lineStart: item.lineIndex,
    lineEnd: item.lineIndex,
    headingPath,
    sourceContext: item.context,
    regionType: 'pure-structure',
    firstPhrase: item.text,
    lastPhrase: item.text,
    normalizedCharCount: 0,
    classification,
    ...(ignoreReason === undefined ? {} : { ignoreReason }),
    guardNotes: 'No prose-height source lines occur before the next structure.',
  };
}

function summarize(
  entries: readonly SourceRegionLedgerEntry[],
  unaccountedPages: readonly number[],
) {
  let record = 0;
  let childOf = 0;
  let pureDocumentStructure = 0;
  let unrepresented = 0;
  let broadStructuralIgnores = 0;
  const intentionallyIgnored = new Map<string, number>();
  for (const entry of entries) {
    if (entry.classification.startsWith('record:')) record += 1;
    else if (entry.classification.startsWith('child-of:')) childOf += 1;
    else if (entry.classification === 'pure-document-structure') {
      pureDocumentStructure += 1;
    } else if (entry.classification === 'unrepresented') {
      unrepresented += 1;
    } else if (entry.classification.startsWith('intentionally-ignored:')) {
      const reason = entry.classification.slice(
        'intentionally-ignored:'.length,
      );
      intentionallyIgnored.set(
        reason,
        (intentionallyIgnored.get(reason) ?? 0) + 1,
      );
    }
    if (
      entry.normalizedCharCount > 0 &&
      (entry.ignoreReason === 'document-structure' ||
        entry.ignoreReason === 'record-group-heading')
    ) {
      broadStructuralIgnores += 1;
    }
  }
  return {
    entries: entries.length,
    proseRegions: entries.filter((entry) => entry.normalizedCharCount > 0)
      .length,
    pureStructure: entries.filter(
      (entry) => entry.regionType === 'pure-structure',
    ).length,
    record,
    childOf,
    intentionallyIgnored: Object.fromEntries(
      [...intentionallyIgnored.entries()].sort(([a], [b]) =>
        a < b ? -1 : a > b ? 1 : 0,
      ),
    ),
    pureDocumentStructure,
    unrepresented,
    broadStructuralIgnores,
    unaccountedPages,
  };
}

export function buildSourceRegionLedger(
  pages: readonly PageText[],
  coverageEntries: readonly SourceCoverageEntry[],
  records: readonly CoverageRecordRef[],
): SourceRegionLedger {
  const coverageByLocation = new Map<string, SourceCoverageEntry>();
  for (const entry of coverageEntries) {
    coverageByLocation.set(
      locationKey(entry.item.page, entry.item.lineIndex),
      entry,
    );
  }

  const lines = flattenPages(pages);
  const searchableRecords = buildSearchableRecords(records);
  const equipmentLeadIns = equipmentDescriptionLeadIns(records);
  const entries: SourceRegionLedgerEntry[] = [];
  const ownersWithProse = new Set<string>();
  let headingPath: readonly string[] = [];
  let owner: ActiveOwner | undefined;
  let regionLines: FlatLine[] = [];
  let regionHeadingPath: readonly string[] = [];
  let regionOwner: ActiveOwner | undefined;
  const cellRuns: TableCellRun[] = [];
  let currentCellRun: TableCellRun | undefined;

  const flushRegion = () => {
    if (regionLines.length === 0) return;
    const body = normalizeText(regionLines.map((line) => line.text).join(' '));
    if (body.length === 0) {
      regionLines = [];
      return;
    }
    const first = regionLines[0];
    const last = regionLines[regionLines.length - 1];
    if (regionOwner !== undefined) {
      ownersWithProse.add(
        locationKey(regionOwner.item.page, regionOwner.item.lineIndex),
      );
    }
    for (const segment of splitRegionBody(
      regionOwner,
      body,
      equipmentLeadIns,
    )) {
      const classified = classifyRegion(
        regionOwner,
        first.page,
        segment.body,
        searchableRecords,
      );
      entries.push({
        id: `p${first.page}-l${first.lineIndex}-prose${segment.idSuffix}`,
        pageStart: first.page,
        pageEnd: last.page,
        lineStart: first.lineIndex,
        lineEnd: last.lineIndex,
        headingPath: regionHeadingPath,
        sourceContext: regionOwner?.item.text ?? null,
        regionType: regionTypeForOwner(regionOwner),
        firstPhrase: phrase(segment.body),
        lastPhrase: phrase(segment.body, true),
        normalizedCharCount: segment.body.length,
        ...classified,
      });
    }
    regionLines = [];
  };

  for (const line of lines) {
    const location = locationKey(line.page, line.lineIndex);
    const coverage = coverageByLocation.get(location);
    if (coverage !== undefined) {
      flushRegion();
      currentCellRun = undefined;
      headingPath = updateHeadingPath(headingPath, coverage.item);
      owner = {
        item: coverage.item,
        status: formatCoverageStatus(coverage.status),
      };
      continue;
    }

    if (
      line.text.length > 0 &&
      isTableCell(line.height) &&
      !isSidebarBodyOwner(owner)
    ) {
      flushRegion();
      // Track the skipped run so a table-rows-only page still gets explicit
      // accounting (eshyra-erf5.5). Owner identity groups a caption's rows.
      if (currentCellRun !== undefined && currentCellRun.owner === owner) {
        currentCellRun.lines.push(line);
      } else {
        currentCellRun = { owner, headingPath, lines: [line] };
        cellRuns.push(currentCellRun);
      }
      continue;
    }

    if (line.text.length === 0 || classifyTier(line.height) !== null) {
      flushRegion();
      currentCellRun = undefined;
      continue;
    }
    currentCellRun = undefined;

    if (
      regionLines.length > 0 &&
      (line.gap === null ||
        owner?.item.page !== regionOwner?.item.page ||
        owner?.item.lineIndex !== regionOwner?.item.lineIndex)
    ) {
      flushRegion();
    }

    if (regionLines.length === 0) {
      regionHeadingPath = headingPath;
      regionOwner = owner;
    }
    regionLines.push(line);
  }
  flushRegion();

  for (const coverage of coverageEntries) {
    if (
      coverage.status.kind !== 'ignored' ||
      !BROAD_STRUCTURAL_IGNORES.has(formatCoverageStatus(coverage.status))
    ) {
      continue;
    }
    const key = locationKey(coverage.item.page, coverage.item.lineIndex);
    if (ownersWithProse.has(key)) continue;
    entries.push(
      pureStructureEntry(
        coverage.item,
        formatCoverageStatus(coverage.status),
        [coverage.item.section, coverage.item.text].filter(
          (part): part is string => part !== null,
        ),
      ),
    );
  }

  // Table-rows-only page accounting (eshyra-erf5.5): a skipped cell run whose
  // pages all carry other ledger entries needs no entry of its own — the
  // owning caption's coverage status is the intended proof for row content.
  // But a run touching a page that would otherwise have NO ledger entry gets
  // an explicit entry stating what represents it, so the page cannot vanish
  // behind a zero-unrepresented summary.
  const pagesWithEntries = new Set<number>();
  for (const entry of entries) {
    for (let page = entry.pageStart; page <= entry.pageEnd; page++) {
      pagesWithEntries.add(page);
    }
  }
  for (const run of cellRuns) {
    const first = run.lines[0];
    const last = run.lines[run.lines.length - 1];
    let touchesUnaccountedPage = false;
    for (let page = first.page; page <= last.page; page++) {
      if (!pagesWithEntries.has(page)) touchesUnaccountedPage = true;
    }
    if (!touchesUnaccountedPage) continue;
    entries.push(tableRowsEntry(run));
  }

  entries.sort(
    (a, b) =>
      a.pageStart - b.pageStart ||
      a.lineStart - b.lineStart ||
      a.id.localeCompare(b.id),
  );
  const unaccountedPages = findUnaccountedPages(lines, coverageEntries, entries);
  return { summary: summarize(entries, unaccountedPages), entries };
}

/**
 * Build the explicit ledger entry for a table-cell run on an otherwise
 * unaccounted page (eshyra-erf5.5). Rows owned by a caption that resolves to
 * a `table:` record ARE that record's row data, so they classify as
 * `record:<key>` (which also lets provenance enrichment count the
 * continuation page — e.g. table:norse-deities' p362 rows). Rows owned by any
 * other specifically-accounted caption (the Adventuring Gear price list's
 * rows and embedded sub-group captions, all emitted as `equipment:` records)
 * classify under the same `table-rows-emitted-as-records` reason the coverage
 * report already uses for such captions. A run with no owner, or one hiding
 * behind a broad structural ignore, fails closed as `unrepresented`.
 */
function tableRowsEntry(run: TableCellRun): SourceRegionLedgerEntry {
  const first = run.lines[0];
  const last = run.lines[run.lines.length - 1];
  const body = normalizeText(run.lines.map((line) => line.text).join(' '));
  const base = {
    id: `p${first.page}-l${first.lineIndex}-table-rows`,
    pageStart: first.page,
    pageEnd: last.page,
    lineStart: first.lineIndex,
    lineEnd: last.lineIndex,
    headingPath: run.headingPath,
    sourceContext: run.owner?.item.text ?? null,
    regionType: 'table-rows' as const,
    firstPhrase: phrase(body),
    lastPhrase: phrase(body, true),
    normalizedCharCount: body.length,
  };
  if (first.page <= FRONT_MATTER_MAX_PAGE) {
    return {
      ...base,
      classification: 'intentionally-ignored:front-matter',
      ignoreReason: 'front-matter',
      guardNotes: 'Front-matter content is outside SRD rules content.',
    };
  }
  const status = run.owner?.status;
  if (status !== undefined && status.startsWith('record:table:')) {
    const targetKey = status.slice('record:'.length);
    return {
      ...base,
      classification: `record:${targetKey}`,
      targetKey,
      guardNotes:
        'Table rows on an otherwise unaccounted page; the rows are the owning table record’s row data.',
    };
  }
  if (
    status !== undefined &&
    !BROAD_STRUCTURAL_IGNORES.has(status) &&
    status.startsWith('ignored:')
  ) {
    // The owning structure already carries a specific, documented ignore
    // (e.g. deity-table-column-header); the run defers to that same reason.
    const reason = status.slice('ignored:'.length);
    return {
      ...base,
      classification: `intentionally-ignored:${reason}`,
      ignoreReason: reason,
      guardNotes:
        'Table rows on an otherwise unaccounted page; accounted under the owning structure’s documented ignore reason.',
    };
  }
  if (
    status !== undefined &&
    (status.startsWith('record:') ||
      status.startsWith('child-of:') ||
      status.startsWith('ambiguous:'))
  ) {
    return {
      ...base,
      classification: 'intentionally-ignored:table-rows-emitted-as-records',
      ignoreReason: 'table-rows-emitted-as-records',
      guardNotes:
        'Table rows on an otherwise unaccounted page; row content (including any embedded sub-group captions rendered at cell height) is emitted as its own records under the owning caption’s coverage status.',
    };
  }
  return {
    ...base,
    classification: 'unrepresented',
    guardNotes:
      'Table-cell run on an otherwise unaccounted page has no specifically-accounted owning structure.',
  };
}

/**
 * Non-empty pages (beyond front matter) with neither a ledger entry nor a
 * source-inventory coverage item (eshyra-erf5.5). Asserted empty by
 * `assertSourceRegionLedger`.
 */
function findUnaccountedPages(
  lines: readonly FlatLine[],
  coverageEntries: readonly SourceCoverageEntry[],
  entries: readonly SourceRegionLedgerEntry[],
): readonly number[] {
  const accounted = new Set<number>();
  for (const entry of entries) {
    for (let page = entry.pageStart; page <= entry.pageEnd; page++) {
      accounted.add(page);
    }
  }
  for (const coverage of coverageEntries) accounted.add(coverage.item.page);
  const unaccounted = new Set<number>();
  for (const line of lines) {
    if (
      line.text.length > 0 &&
      line.page > FRONT_MATTER_MAX_PAGE &&
      !accounted.has(line.page)
    ) {
      unaccounted.add(line.page);
    }
  }
  return [...unaccounted].sort((a, b) => a - b);
}

export class SourceRegionLedgerError extends Error {
  constructor(ledger: SourceRegionLedger) {
    const invalid = ledger.entries.filter(
      (entry) =>
        entry.classification === 'unrepresented' ||
        (entry.normalizedCharCount > 0 &&
          (entry.ignoreReason === 'document-structure' ||
            entry.ignoreReason === 'record-group-heading')),
    );
    const lines = invalid
      .slice(0, 50)
      .map(
        (entry) =>
          `  ${entry.id} [${entry.regionType}] ${entry.classification}: ${entry.firstPhrase}`,
      );
    if (ledger.summary.unaccountedPages.length > 0) {
      lines.push(
        `  pages with no ledger entry and no coverage item: ${ledger.summary.unaccountedPages.join(', ')}`,
      );
    }
    super(
      `SRD source-region ledger has ${invalid.length} invalid prose-bearing region(s):\n${lines.join('\n')}`,
    );
    this.name = 'SourceRegionLedgerError';
  }
}

export function assertSourceRegionLedger(ledger: SourceRegionLedger): void {
  if (
    ledger.summary.unrepresented > 0 ||
    ledger.summary.broadStructuralIgnores > 0 ||
    ledger.summary.unaccountedPages.length > 0
  ) {
    throw new SourceRegionLedgerError(ledger);
  }
}
