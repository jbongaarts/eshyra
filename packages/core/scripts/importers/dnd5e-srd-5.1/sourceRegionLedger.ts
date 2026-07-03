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
  SRD_5_1_SPELL_TABLE_OWNERS,
  SRD_5_1_TABLE_OWNERS,
} from '../../../src/rules/srdAudit.js';
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

/**
 * Emission proof for a prose region classified `record:`/`child-of:`
 * (eshyra-o9bd.18.9.2). Owner assignment alone proved only that a heading
 * OWNS the region — the `rule:skills` p.77–78 defect showed a region can be
 * owned while its post-list paragraphs are silently dropped from the emitted
 * record. Every owned prose region must therefore also prove its text was
 * emitted:
 *
 *   - `contained` — the full normalized region body is a substring of
 *     generated record data (the strongest proof; also what the document-wide
 *     content search establishes).
 *   - `sentences-contained` — the body as a whole is not contiguous in any
 *     record (embedded lists/tables interrupt the source flow, so parsers
 *     legitimately reflow or reorder it), but every sentence of it appears in
 *     the target record — or, failing that, in the pack corpus.
 *   - `structured-equivalent` — a reviewed entry in
 *     `STRUCTURED_EQUIVALENT_REGIONS` documents that the prose is represented
 *     as structured data whose serialized form intentionally differs from the
 *     printed sentence flow (e.g. a class's Hit Points/Proficiencies/
 *     Equipment block emitted as structured creation facts).
 *   - `unemitted` — none of the above: the region is owned but its text is
 *     provably absent from the pack. `assertSourceRegionLedger` fails closed
 *     on any such region.
 */
export type SourceRegionEmission =
  | 'contained'
  | 'sentences-contained'
  | 'structured-equivalent'
  | 'unemitted';

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
   * Emission proof for `record:`/`child-of:` prose regions
   * (eshyra-o9bd.18.9.2). Absent on non-owned classifications, on
   * zero-prose entries, and on `table-rows` entries (row content is proven
   * by the owning caption's coverage status per eshyra-erf5.5, not by prose
   * containment).
   */
  readonly emission?: SourceRegionEmission;
  /**
   * Reviewed reason when `emission` is `structured-equivalent`; the missing
   * sentences when `emission` is `unemitted`.
   */
  readonly emissionNotes?: string;
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
     * Emission-proof breakdown for owned (`record:`/`child-of:`) prose
     * regions (eshyra-o9bd.18.9.2). `unemitted` must be zero: an owned
     * region whose text is absent from the pack is exactly the
     * `rule:skills` failure mode this proof exists to catch. Asserted by
     * `assertSourceRegionLedger`.
     */
    readonly ownedEmission: {
      readonly contained: number;
      readonly sentencesContained: number;
      readonly structuredEquivalent: number;
      readonly unemitted: number;
    };
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

/**
 * Reviewed structured-equivalent regions (eshyra-o9bd.18.9.2): owned prose
 * whose emitted representation is structured data that intentionally does not
 * reproduce the printed sentence flow, so neither full-body nor
 * sentence-level containment can prove it. Keyed
 * `<targetKey>#<sourceContext>`. Every entry must say WHAT structured data
 * represents the prose; an entry here is a design decision, not an escape
 * hatch — prose that is merely dropped must stay `unemitted` and fail the
 * ledger assertion.
 */
export const STRUCTURED_EQUIVALENT_REGIONS: Readonly<Record<string, string>> =
  Object.freeze({
    'rule:class-features#Class Features':
      'The per-class lead-in sentence "As a <class>, you gain the following class features." is boilerplate whose content — the class grants these features — is the class record\'s structured features[] and progression advancement data.',
    'rule:equipment-packs#Equipment Packs':
      'The bulleted pack list ("Burglar\'s Pack (16 gp). Includes …") is emitted as equipment records: each pack is its own record with structured cost and contents[], verified by the equipment-pack contents gate.',
    'rule:sample-poisons#Sample Poisons':
      'The bulleted poison list ("Assassin\'s Blood (Ingested). …") is emitted as hazard records: each poison is its own record with structured delivery type and effect prose.',
  });

/**
 * Pre-normalized record texts for emission proofs: `byKey` for
 * target-record containment, `corpus` (NUL-joined so no needle can span a
 * record boundary) for the pack-wide sentence fallback. Unlike the
 * classification search text (`buildSearchableRecords`), emission text also
 * inlines number scalars, so row/statline values ("Hit Points 135",
 * exhaustion's "1 Disadvantage on ability checks") stay contiguous with
 * their neighboring cell/field strings. `records` keeps the raw data for
 * the label-block fragment prover.
 */
interface EmissionIndex {
  readonly byKey: ReadonlyMap<string, string>;
  readonly corpus: string;
  readonly records: readonly CoverageRecordRef[];
}

/**
 * Printed label vocabulary for SRD header/statline blocks
 * (eshyra-o9bd.18.9.2). These are the words the PAGE prints around
 * structured values — field labels, ability abbreviations, connective
 * tokens — which parsers correctly do NOT store because the schema field
 * carries the meaning. The label-block prover may consume them for free;
 * everything else in a header sentence must match the target record's own
 * field strings. Keep this list strictly label-shaped: adding ordinary
 * prose words here would let a genuinely dropped sentence slip through.
 */
const HEADER_LABEL_VOCABULARY: readonly string[] = [
  'hit points at higher levels:',
  'hit points at 1st level:',
  '+ your constitution modifier',
  '(requires attunement)',
  'requires attunement',
  'condition immunities',
  'damage resistance',
  'damage vulnerabilities',
  'damage resistances',
  'damage immunities',
  'legendary actions',
  'saving throws:',
  'saving throws',
  'casting time:',
  'components:',
  'duration:',
  'hit dice:',
  'hit points',
  'armor class',
  'challenge',
  'languages',
  'ritual',
  'component:',
  'prerequisite:',
  'skill proficiencies:',
  'equipment:',
  'or higher',
  'weapons:',
  'cantrip',
  'skills:',
  'senses',
  'skills',
  'armor:',
  'tools:',
  'range:',
  'speed',
  'level',
  'after 1st',
  'alignment',
  'effect',
  'none',
  'str',
  'dex',
  'con',
  'int',
  'wis',
  'cha',
  'per',
  'ft.',
  'xp',
  'or',
].sort((a, b) => b.length - a.length || (a < b ? -1 : 1));

const ORDINAL_SUFFIX = (n: number): string => {
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 13) return 'th';
  switch (n % 10) {
    case 1:
      return 'st';
    case 2:
      return 'nd';
    case 3:
      return 'rd';
    default:
      return 'th';
  }
};

/**
 * Collect the label-block fragments a header sentence may be assembled
 * from: every string leaf of the record (normalized), the record name, and
 * printed variants of number scalars — plain, comma-grouped ("5,900"),
 * ordinal ("2nd"), and for `hitDie` the printed die forms ("1d12" and the
 * per-level average `die/2 + 1` shown as "(or 7)").
 */
function collectFragments(
  value: unknown,
  key: string | undefined,
  out: Set<string>,
): void {
  if (typeof value === 'string') {
    const normalized = normalizeForSearch(value);
    if (normalized.length > 0) out.add(normalized);
    return;
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    out.add(String(value));
    if (Number.isInteger(value)) {
      if (Math.abs(value) >= 1000) out.add(value.toLocaleString('en-US'));
      if (value > 0 && value <= 100) {
        out.add(`${value}${ORDINAL_SUFFIX(value)}`);
      }
      if (key === 'hitDie') {
        out.add(`1d${value}`);
        out.add(String(Math.floor(value / 2) + 1));
      }
    }
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectFragments(item, undefined, out);
    return;
  }
  if (typeof value === 'object' && value !== null) {
    for (const [childKey, child] of Object.entries(value)) {
      collectFragments(child, childKey, out);
    }
  }
}

/**
 * The records whose structured fields may prove a region's label-block
 * content: the target itself, plus — when the target is a table — the record
 * that owns it (a class whose `progressionTableRef` names it, or the
 * reviewed owner from `SRD_5_1_TABLE_OWNERS`/`SRD_5_1_SPELL_TABLE_OWNERS`),
 * because an owner's header block physically interleaves the table caption
 * in the two-column layout and so gets attributed to the table's region.
 */
function fragmentRecordsFor(
  targetKey: string,
  records: readonly CoverageRecordRef[],
): readonly CoverageRecordRef[] {
  const ownerKeys = new Set([targetKey]);
  const reviewedOwner =
    SRD_5_1_TABLE_OWNERS[targetKey] ?? SRD_5_1_SPELL_TABLE_OWNERS[targetKey];
  if (reviewedOwner !== undefined) ownerKeys.add(reviewedOwner);
  const out: CoverageRecordRef[] = [];
  for (const record of records) {
    if (ownerKeys.has(record.key)) {
      out.push(record);
      continue;
    }
    const data = record.data;
    if (
      typeof data === 'object' &&
      data !== null &&
      !Array.isArray(data) &&
      (data as Record<string, unknown>).progressionTableRef === targetKey
    ) {
      out.push(record);
    }
  }
  return out;
}

function buildFragmentList(
  targetKey: string,
  records: readonly CoverageRecordRef[],
): readonly string[] {
  const fragments = new Set<string>();
  for (const record of fragmentRecordsFor(targetKey, records)) {
    fragments.add(normalizeForSearch(record.name));
    collectFragments(record.data, undefined, fragments);
  }
  return [...fragments].sort((a, b) => b.length - a.length || (a < b ? -1 : 1));
}

const PEEL_SEPARATORS = /^[\s•,.;:)\]}"'’“”—–\-/]+/;
/** Ability-grid modifiers ("(+5)", "(−1)") are derived from the stored
 * scores, never stored themselves; peel them structurally. */
const PEEL_DERIVED_MODIFIER = /^\([+−-]?\d+\)/;

function boundaryOk(rest: string, length: number): boolean {
  const next = rest[length];
  return next === undefined || /[\s,.;:()[\]{}"'’“”—–\-/]/.test(next);
}

/**
 * When the sentence splitter cuts inside a stored field (a trait whose text
 * spans a period boundary, e.g. Rock Gnome's Tinker options lead-in), the
 * resulting needle STARTS mid-fragment. Peel the fragment's tail: find a
 * fragment whose suffix (at least 12 chars, so common short phrases cannot
 * chain) is a prefix of the remainder.
 */
function peelFragmentSuffix(
  rest: string,
  fragments: readonly string[],
): number {
  const head = rest.slice(0, 12);
  if (head.length < 12) return 0;
  for (const fragment of fragments) {
    let pos = fragment.indexOf(head);
    while (pos > 0) {
      const tail = fragment.slice(pos);
      if (rest.startsWith(tail) && boundaryOk(rest, tail.length)) {
        return tail.length;
      }
      pos = fragment.indexOf(head, pos + 1);
    }
  }
  return 0;
}

/**
 * Greedy front-peel prover for header/label sentences (eshyra-o9bd.18.9.2).
 * A creature statline, spell header, magic-item type line, or class
 * hit-points/proficiencies block prints structured record fields interleaved
 * with label words; parsers store the fields, not the printed line, so no
 * contiguous containment can succeed. Peel the sentence front-to-back using
 * only (a) the target record's own field strings and printed number
 * variants, (b) the reviewed label vocabulary, (c) separators and derived
 * ability modifiers — and at every step accept the remainder if it is
 * verbatim-contained emitted prose. A genuinely dropped prose sentence fails
 * at its first content word: ordinary words are neither vocabulary nor
 * whole-field fragments.
 */
function labelBlockCovered(
  sentence: string,
  fragments: readonly string[],
  remainderContained: (rest: string) => boolean,
): string | null {
  let rest = sentence;
  for (;;) {
    rest = rest.replace(PEEL_SEPARATORS, '');
    if (rest.length === 0) return null;
    if (remainderContained(rest)) return null;
    const fragment = fragments.find(
      (candidate) =>
        rest.startsWith(candidate) && boundaryOk(rest, candidate.length),
    );
    if (fragment !== undefined) {
      rest = rest.slice(fragment.length);
      continue;
    }
    const suffixLength = peelFragmentSuffix(rest, fragments);
    if (suffixLength > 0) {
      rest = rest.slice(suffixLength);
      continue;
    }
    const label = HEADER_LABEL_VOCABULARY.find(
      (candidate) =>
        rest.startsWith(candidate) && boundaryOk(rest, candidate.length),
    );
    if (label !== undefined) {
      rest = rest.slice(label.length);
      continue;
    }
    const modifier = PEEL_DERIVED_MODIFIER.exec(rest);
    if (modifier !== null) {
      rest = rest.slice(modifier[0].length);
      continue;
    }
    if (rest.startsWith('(') || rest.startsWith('[')) {
      rest = rest.slice(1);
      continue;
    }
    return rest;
  }
}

/**
 * Split a region body into sentence-sized needles for containment checks. A
 * false split is harmless — any substring of contiguous emitted text still
 * matches — so the boundary regex only needs to be roughly right; what
 * matters is that genuinely reflowed units (paragraphs around an embedded
 * list or table) become separately checkable.
 */
function splitSentences(body: string): readonly string[] {
  return body
    .split(/(?<=[.!?…]["”’')\]]?)\s+(?=[A-Z0-9])|\s*•\s*/)
    .map((part) => normalizeForSearch(part))
    .filter((part) => part.length > 0);
}

/**
 * One sentence needle is contained when it appears verbatim, or — for run-in
 * bold labels the splitter isolates as their own "sentence" ("Age." /
 * "Ability Score Increase.") — when it appears with the trailing punctuation
 * stripped, because parsers legitimately lift such labels into structured
 * name fields without the period.
 */
function sentenceContained(sentence: string, haystack: string): boolean {
  if (haystack.includes(sentence)) return true;
  const label = sentence.replace(/[.:]+$/, '');
  return label.length > 0 && label !== sentence && haystack.includes(label);
}

function computeEmission(
  body: string,
  targetKey: string | undefined,
  sourceContext: string | null,
  index: EmissionIndex,
): Pick<SourceRegionLedgerEntry, 'emission' | 'emissionNotes'> {
  const needle = normalizeForSearch(body);
  const target =
    targetKey === undefined ? undefined : index.byKey.get(targetKey);
  if (target?.includes(needle)) {
    return { emission: 'contained' };
  }
  const sentences = splitSentences(body);
  if (
    target !== undefined &&
    sentences.every((sentence) => sentenceContained(sentence, target))
  ) {
    return { emission: 'sentences-contained' };
  }
  const corpusMissing = sentences.filter(
    (sentence) => !sentenceContained(sentence, index.corpus),
  );
  if (corpusMissing.length === 0) {
    return { emission: 'sentences-contained' };
  }
  // Header/statline blocks: prove the remaining sentences against the
  // target record's own structured fields plus the printed label
  // vocabulary.
  const fragments =
    targetKey === undefined ? [] : buildFragmentList(targetKey, index.records);
  const remainderContained = (rest: string): boolean =>
    (target !== undefined && sentenceContained(rest, target)) ||
    sentenceContained(rest, index.corpus);
  const missing: string[] = [];
  for (const sentence of corpusMissing) {
    const stuck = labelBlockCovered(sentence, fragments, remainderContained);
    if (stuck !== null) {
      missing.push(`${sentence.slice(0, 80)} …stuck at… ${stuck.slice(0, 60)}`);
    }
  }
  if (missing.length === 0) {
    return {
      emission: 'structured-equivalent',
      emissionNotes:
        'header/label content proven against the structured fields of the target record',
    };
  }
  const reason =
    STRUCTURED_EQUIVALENT_REGIONS[`${targetKey ?? ''}#${sourceContext ?? ''}`];
  if (reason !== undefined) {
    return { emission: 'structured-equivalent', emissionNotes: reason };
  }
  return {
    emission: 'unemitted',
    emissionNotes: `sentences absent from generated record data: ${missing
      .slice(0, 3)
      .map((sentence) => `"${sentence.slice(0, 160)}"`)
      .join(
        ' | ',
      )}${missing.length > 3 ? ` (+${missing.length - 3} more)` : ''}`,
  };
}

function classifyRegion(
  owner: ActiveOwner | undefined,
  pageStart: number,
  body: string,
  searchableRecords: readonly SearchableRecord[],
  emissionIndex: EmissionIndex,
): Pick<
  SourceRegionLedgerEntry,
  | 'classification'
  | 'targetKey'
  | 'ignoreReason'
  | 'guardNotes'
  | 'contentMatch'
  | 'emission'
  | 'emissionNotes'
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
      // The content search proved full-body containment by construction.
      emission: 'contained',
      ...(isSelfConsistent ? {} : { contentMatch: true }),
    };
  }

  if (
    ownerBased.classification.startsWith('record:') ||
    ownerBased.classification.startsWith('child-of:')
  ) {
    return {
      ...ownerBased,
      ...computeEmission(
        body,
        ownerBased.targetKey,
        owner?.item.text ?? null,
        emissionIndex,
      ),
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

/**
 * Like `collectStrings` but also inlines number scalars in walk order, so
 * emission proofs can match printed value-bearing runs (table rows like
 * exhaustion's "1 Disadvantage on ability checks", statline values) that
 * the schema stores as numbers adjacent to strings. Kept separate from the
 * classification search text so `findRepresentingRecord` behavior — and the
 * committed classifications derived from it — are unchanged.
 */
function collectEmissionStrings(value: unknown, out: string[]): void {
  if (typeof value === 'string') {
    out.push(value);
    return;
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    out.push(String(value));
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectEmissionStrings(item, out);
    return;
  }
  if (typeof value === 'object' && value !== null) {
    for (const child of Object.values(value))
      collectEmissionStrings(child, out);
  }
}

function buildEmissionIndex(
  records: readonly CoverageRecordRef[],
): EmissionIndex {
  const texts = records.map((record) => {
    const strings: string[] = [];
    collectEmissionStrings(record.data, strings);
    return {
      key: record.key,
      text: normalizeForSearch(strings.join(' ')),
    };
  });
  return {
    byKey: new Map(texts.map((entry) => [entry.key, entry.text])),
    corpus: texts.map((entry) => entry.text).join('\u0000'),
    records,
  };
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
  const ownedEmission = {
    contained: 0,
    sentencesContained: 0,
    structuredEquivalent: 0,
    unemitted: 0,
  };
  const intentionallyIgnored = new Map<string, number>();
  for (const entry of entries) {
    switch (entry.emission) {
      case 'contained':
        ownedEmission.contained += 1;
        break;
      case 'sentences-contained':
        ownedEmission.sentencesContained += 1;
        break;
      case 'structured-equivalent':
        ownedEmission.structuredEquivalent += 1;
        break;
      case 'unemitted':
        ownedEmission.unemitted += 1;
        break;
      case undefined:
        break;
    }
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
    ownedEmission,
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
  const emissionIndex = buildEmissionIndex(records);
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
        emissionIndex,
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
  const unaccountedPages = findUnaccountedPages(
    lines,
    coverageEntries,
    entries,
  );
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
  if (status !== undefined) {
    if (status.startsWith('record:table:')) {
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
      status.startsWith('record:') ||
      status.startsWith('child-of:') ||
      status.startsWith('ambiguous:')
    ) {
      return {
        ...base,
        classification: 'intentionally-ignored:table-rows-emitted-as-records',
        ignoreReason: 'table-rows-emitted-as-records',
        guardNotes:
          'Table rows on an otherwise unaccounted page; row content (including any embedded sub-group captions rendered at cell height) is emitted as its own records under the owning caption’s coverage status.',
      };
    }
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
  /** The full ledger, so callers can report beyond the 50-entry preview. */
  readonly ledger: SourceRegionLedger;

  constructor(ledger: SourceRegionLedger) {
    const invalid = ledger.entries.filter(
      (entry) =>
        entry.classification === 'unrepresented' ||
        entry.emission === 'unemitted' ||
        (entry.normalizedCharCount > 0 &&
          (entry.ignoreReason === 'document-structure' ||
            entry.ignoreReason === 'record-group-heading')),
    );
    const lines = invalid
      .slice(0, 50)
      .map(
        (entry) =>
          `  ${entry.id} [${entry.regionType}] ${entry.classification}${
            entry.emission === 'unemitted'
              ? ' (owned but not emitted: region text is absent from generated record data)'
              : ''
          }: ${entry.firstPhrase}`,
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
    this.ledger = ledger;
  }
}

export function assertSourceRegionLedger(ledger: SourceRegionLedger): void {
  if (
    ledger.summary.unrepresented > 0 ||
    ledger.summary.broadStructuralIgnores > 0 ||
    ledger.summary.ownedEmission.unemitted > 0 ||
    ledger.summary.unaccountedPages.length > 0
  ) {
    throw new SourceRegionLedgerError(ledger);
  }
}
