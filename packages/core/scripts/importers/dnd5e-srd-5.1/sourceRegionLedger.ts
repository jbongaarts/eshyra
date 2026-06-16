/**
 * Source-region ledger for the D&D 5e SRD 5.1 importer.
 *
 * `sourceInventory.ts` accounts for typography-derived structures: headings,
 * tables, and stat blocks. This companion ledger accounts for contiguous
 * prose-height regions between those structures, so prose cannot hide behind a
 * broad heading-level ignore such as `ignored:document-structure`.
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
  | 'pure-structure';

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

function regionTypeForOwner(owner: ActiveOwner | undefined): SourceRegionType {
  if (owner === undefined) return 'orphan-prose';
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

function classifyRegion(
  owner: ActiveOwner | undefined,
  pageStart: number,
  body: string,
  searchableRecords: readonly SearchableRecord[],
): Pick<
  SourceRegionLedgerEntry,
  'classification' | 'targetKey' | 'ignoreReason' | 'guardNotes'
> {
  if (pageStart <= FRONT_MATTER_MAX_PAGE) {
    return {
      classification: 'intentionally-ignored:front-matter',
      ignoreReason: 'front-matter',
      guardNotes: 'Front-matter prose is outside SRD rules content.',
    };
  }

  const representedRecordKey = findRepresentingRecord(
    body,
    owner,
    searchableRecords,
  );
  if (representedRecordKey !== undefined) {
    return {
      classification: `record:${representedRecordKey}`,
      targetKey: representedRecordKey,
      guardNotes:
        'Region text is contained in generated record data; heading status alone was not used.',
    };
  }

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
  const preferred = matches.find(
    (record) =>
      (sectionSlug !== undefined && record.key.includes(`:${sectionSlug}:`)) ||
      (headingSlug !== undefined &&
        (record.key.endsWith(`:${headingSlug}`) ||
          record.key.includes(`:${headingSlug}:`))),
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

function summarize(entries: readonly SourceRegionLedgerEntry[]) {
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
      headingPath = updateHeadingPath(headingPath, coverage.item);
      owner = {
        item: coverage.item,
        status: formatCoverageStatus(coverage.status),
      };
      continue;
    }

    if (
      line.text.length === 0 ||
      classifyTier(line.height) !== null ||
      isTableCell(line.height)
    ) {
      flushRegion();
      continue;
    }

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

  entries.sort(
    (a, b) =>
      a.pageStart - b.pageStart ||
      a.lineStart - b.lineStart ||
      a.id.localeCompare(b.id),
  );
  return { summary: summarize(entries), entries };
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
    super(
      `SRD source-region ledger has ${invalid.length} invalid prose-bearing region(s):\n${lines.join('\n')}`,
    );
    this.name = 'SourceRegionLedgerError';
  }
}

export function assertSourceRegionLedger(ledger: SourceRegionLedger): void {
  if (
    ledger.summary.unrepresented > 0 ||
    ledger.summary.broadStructuralIgnores > 0
  ) {
    throw new SourceRegionLedgerError(ledger);
  }
}
