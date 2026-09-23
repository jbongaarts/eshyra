/**
 * Fail-closed, output -> source RECORD ANCHOR GATE for the D&D 5e SRD 5.1
 * importer (eshyra-o9bd.19.1.3.2).
 *
 * Every prior coverage gate in this importer proves source -> output: that
 * every printed source structure became SOME record. None of them prove the
 * other direction — that an emitted record's provenance actually supports
 * what the record claims. That gap is exactly how `table:starting-wealth-
 * by-class` (removed in PR #504) carried "SRD 5.1 p. 38" provenance and the
 * full CC-BY-4.0 SRD attribution block while no starting-wealth text exists
 * anywhere in SRD 5.1: nothing ever checked the record against the page it
 * cited.
 *
 * The invariant this module enforces: every emitted record's ANCHOR text
 * occurs in the extracted text of at least one page its
 * `provenance.locator` cites. The anchor is the record's own `name` by
 * default. A record whose name is compiler-constructed (composed from
 * multiple printed headings, or otherwise not itself printed verbatim on
 * the cited page) must carry an explicit DECLARED anchor — real printed
 * text on that page — with a reason explaining what the text is. The
 * declared anchor is itself verified against the cited pages, so there is
 * no path by which a record passes this gate without a verified printed
 * anchor somewhere on a page it cites.
 *
 * A record whose only printed anchor lives on a page its locator does NOT
 * cite is a locator-completeness defect (owned by eshyra-o9bd.19.2.2), not a
 * declaration target: extending the locator, or declaring an off-page
 * anchor, would launder the defect instead of surfacing it. See this
 * module's caller in `index.ts` for how that case is handled.
 */
import type { RulesRecord } from '../../../src/rules/types.js';
import type { PageText } from './types.js';

export class RecordSourceAnchorError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RecordSourceAnchorError';
  }
}

const CURLY_APOSTROPHES = /[‘’]/g;
const CURLY_QUOTES = /[“”]/g;
// Hyphen-minus plus every dash/hyphen variant pdfjs can emit: non-breaking
// hyphen, figure dash, en dash, em dash, minus sign.
const DASH_VARIANTS = /[-‐‑‒–—−]/g;
// A hyphen immediately followed by whitespace is a PDF line-wrap
// hyphenation artifact ("guid-\nance"); collapse it away entirely rather
// than leaving a `-` that the final filter would drop anyway but that would
// otherwise coincide with the natural word boundary an editorial hyphen
// leaves. Order matters: this runs AFTER dash normalization, so it only
// needs to match the one canonical hyphen character.
const HYPHEN_LINE_BREAK = /-\s+/g;
const NON_ALPHANUMERIC = /[^a-z0-9]/g;

/**
 * Normalize printed / declared anchor text into a bare lower-case
 * alphanumeric run, so PDF line-wrap hyphenation, curly punctuation, dash
 * variants, and incidental whitespace differences between the extraction
 * and a hand-written declared anchor never cause a false negative (or,
 * symmetrically, so stray punctuation never causes a false positive). This
 * is the normalization the eshyra-o9bd.19.1.3.2 supervisor's probe used to
 * compute the 39-record failing baseline on `main@ddc231be`; keep it stable
 * unless it provably causes a false pass/fail.
 */
export function normalizeAnchorText(value: string): string {
  return value
    .toLowerCase()
    .replace(CURLY_APOSTROPHES, "'")
    .replace(CURLY_QUOTES, '"')
    .replace(DASH_VARIANTS, '-')
    .replace(HYPHEN_LINE_BREAK, '')
    .replace(NON_ALPHANUMERIC, '');
}

const SINGLE_PAGE_LOCATOR = /^p\.\s*(\d+)$/;
const PAGE_RANGE_LOCATOR = /^pp\.\s*(\d+)\s*[–—-]\s*(\d+)$/;
const PAGE_LIST_LOCATOR = /^pp\.\s*(\d+(?:\s*,\s*\d+)+)$/;

/**
 * Parse a `RecordProvenance.locator` into the page number(s) it cites.
 * Supports the three shapes this importer emits: `"p. N"` (single page),
 * `"pp. N, M, ..."` (a comma-joined list), and `"pp. N-M"` / `"pp. N–M"` (an
 * inclusive range). Throws on anything else, including a missing locator —
 * a gate that cannot determine which pages a record cites must fail closed,
 * never silently skip the check.
 */
export function citedPages(locator: string | undefined): readonly number[] {
  const trimmed = (locator ?? '').trim();

  const single = SINGLE_PAGE_LOCATOR.exec(trimmed);
  if (single) return [Number(single[1])];

  const range = PAGE_RANGE_LOCATOR.exec(trimmed);
  if (range) {
    const start = Number(range[1]);
    const end = Number(range[2]);
    if (end < start) {
      throw new RecordSourceAnchorError(
        `Unparseable provenance locator ${JSON.stringify(locator)}: range end page precedes start page`,
      );
    }
    const pages: number[] = [];
    for (let page = start; page <= end; page += 1) pages.push(page);
    return pages;
  }

  const list = PAGE_LIST_LOCATOR.exec(trimmed);
  if (list) return list[1].split(',').map((part) => Number(part.trim()));

  throw new RecordSourceAnchorError(
    `Unparseable provenance locator: ${JSON.stringify(locator)}`,
  );
}

export interface DeclaredRecordSourceAnchor {
  /** Real printed text from the record's own cited page(s). */
  readonly anchor: string;
  /** What the anchor is and why the record's name cannot serve as one. */
  readonly reason: string;
}

/**
 * Minimum normalized length for a declared anchor. Guards against a
 * trivially-matching declaration (a single short common token that would
 * pass against almost any page and so proves nothing about the record it is
 * supposed to anchor).
 */
const MIN_DECLARED_ANCHOR_NORMALIZED_LENGTH = 8;

/**
 * Curated declared source anchors (eshyra-o9bd.19.1.3.2). Each entry is a
 * compiler-constructed record name that is not itself printed verbatim on
 * the record's cited page(s), paired with real printed text from that page
 * that the gate below verifies instead. This is a source-grounded curated
 * compiler INPUT (ADR 0017 §3), reviewed against the vendored SRD 5.1 PDF —
 * never a hand-edit of `records.json`.
 *
 * The default rule stays the record name; a declaration here is a deliberate,
 * reviewed exception, not a second general-purpose matching path. A
 * declaration for a record whose name IS found verbatim on its cited page is
 * redundant and rejected by `assertRecordsAnchoredInSource` (the default
 * must stay the rule).
 */
export const DECLARED_RECORD_SOURCE_ANCHORS: ReadonlyMap<
  string,
  DeclaredRecordSourceAnchor
> = new Map([
  [
    'equipment:saddle-military',
    {
      anchor: 'Military 20 gp 30 lb.',
      reason:
        'The Tack, Harness, and Drawn Vehicles table prints only the bare row label "Military" under a shared "Saddle" sub-heading, never the comma-joined "Saddle, Military" the record name uses; the printed row text (label + cost + weight) is the distinctive anchor, distinguishing this row from the adjacent Exotic/Pack/Riding saddle rows.',
    },
  ],
  [
    'equipment:saddle-pack',
    {
      anchor: 'Pack 5 gp 15 lb.',
      reason:
        'Same shared "Saddle" sub-heading as equipment:saddle-military; printed row text for the Pack saddle row.',
    },
  ],
  [
    'equipment:saddle-riding',
    {
      anchor: 'Riding 10 gp 25 lb.',
      reason:
        'Same shared "Saddle" sub-heading as equipment:saddle-military; printed row text for the Riding saddle row.',
    },
  ],
  [
    'rule:armor-guidance',
    {
      anchor: 'Armor Proficiency',
      reason:
        'Compiler-named guidance rule grouping the Equipment chapter\'s prose under the printed "Armor" heading; "Armor" alone is too generic (it also captions the Armor table itself), so the anchor is the printed subsection heading "Armor Proficiency" that opens this rule\'s prose.',
    },
  ],
  [
    'rule:coinage',
    {
      anchor: 'Standard Exchange Rates',
      reason:
        "Compiler-named rule for the Equipment chapter's currency prose, which has no printed section heading of its own; the anchor is the printed caption of the coin-exchange table embedded in the same prose block.",
    },
  ],
  [
    'rule:oath-of-devotion-oath-spells',
    {
      anchor: 'Oath of Devotion Spells',
      reason:
        'Compiler-appended a second "Oath" to the printed table caption; the SRD prints this progression table\'s caption as "Oath of Devotion Spells" (no repeated "Oath Spells").',
    },
  ],
  [
    'rule:the-fiend-expanded-spell-list',
    {
      anchor: 'Fiend Expanded Spells',
      reason:
        'Record name concatenates the patron heading "The Fiend" with the subsection heading "Expanded Spell List", which are not adjacent printed text (patron prose sits between them); the anchor is the printed caption of the actual spell-list table, "Fiend Expanded Spells".',
    },
  ],
  [
    'rule:weapons',
    {
      anchor: 'Weapon Proficiency',
      reason:
        'Compiler appended "Guidance" to the printed section heading "Weapons"; "Weapons" alone recurs generically on the page (e.g. "the Weapons table"), so the anchor is the printed subsection heading "Weapon Proficiency" that follows it.',
    },
  ],
  [
    'table:acolyte-bonds',
    {
      anchor: 'd6 Bond 1 I would die',
      reason:
        'Caption-less table; the printed header row is bare "d6 Bond" (6 normalized chars, below the anchor length floor), so the anchor extends into the immediately following printed row-1 text to clear it while staying a contiguous printed span unique to this table on the page.',
    },
  ],
  [
    'table:acolyte-flaws',
    {
      anchor: 'd6 Flaw 1 I judge others',
      reason:
        'Caption-less table; same "d6 Flaw" header shortfall as table:acolyte-bonds, extended into the immediately following printed row-1 text.',
    },
  ],
  [
    'table:acolyte-ideals',
    {
      anchor: 'd6 Ideal 1 Tradition',
      reason:
        'Caption-less table; same "d6 Ideal" header shortfall as table:acolyte-bonds, extended into the immediately following printed row-1 text.',
    },
  ],
  [
    'table:acolyte-personality-traits',
    {
      anchor: 'd8 Personality Trait',
      reason: 'Caption-less table; printed header row.',
    },
  ],
  [
    'table:armor-of-resistance',
    {
      anchor: 'd10 Damage Type',
      reason:
        'The "Armor of Resistance" item heading prints on the preceding page; the printed table header carried onto this record\'s cited page is "d10 Damage Type" (repeated for its two-column layout).',
    },
  ],
  [
    'table:circle-of-the-land-arctic',
    {
      anchor: 'Arctic Druid Level Circle Spells',
      reason:
        'Record name adds the compiler-composed "Circle of the Land (...)" wrapper; the printed text is the bare region heading "Arctic" immediately followed by the shared "Druid Level Circle Spells" column header, which together are unique to this region\'s sub-table on the page (the header alone repeats for all seven regions).',
    },
  ],
  [
    'table:circle-of-the-land-coast',
    {
      anchor: 'Coast Druid Level Circle Spells',
      reason:
        'Same composed-name shape as table:circle-of-the-land-arctic; region heading "Coast" immediately followed by the shared column header.',
    },
  ],
  [
    'table:circle-of-the-land-desert',
    {
      anchor: 'Desert Druid Level Circle Spells',
      reason:
        'Same composed-name shape as table:circle-of-the-land-arctic; region heading "Desert" immediately followed by the shared column header.',
    },
  ],
  [
    'table:circle-of-the-land-forest',
    {
      anchor: 'Forest Druid Level Circle Spells',
      reason:
        'Same composed-name shape as table:circle-of-the-land-arctic; region heading "Forest" immediately followed by the shared column header.',
    },
  ],
  [
    'table:circle-of-the-land-grassland',
    {
      anchor: 'Grassland Druid Level Circle Spells',
      reason:
        'Same composed-name shape as table:circle-of-the-land-arctic; region heading "Grassland" immediately followed by the shared column header.',
    },
  ],
  [
    'table:circle-of-the-land-mountain',
    {
      anchor: 'Mountain Druid Level Circle Spells',
      reason:
        'Same composed-name shape as table:circle-of-the-land-arctic; region heading "Mountain" immediately followed by the shared column header.',
    },
  ],
  [
    'table:circle-of-the-land-swamp',
    {
      anchor: 'Swamp Druid Level Circle Spells',
      reason:
        'Same composed-name shape as table:circle-of-the-land-arctic; region heading "Swamp" immediately followed by the shared column header.',
    },
  ],
  [
    'table:confusion-behavior',
    {
      anchor: 'd10 Behavior',
      reason: 'Caption-less table; printed header row for the Confusion spell.',
    },
  ],
  [
    'table:creation-material-duration',
    {
      anchor: 'Material Duration',
      reason:
        'Compiler prefixed the spell name "Creation"; the printed table caption is bare "Material Duration".',
    },
  ],
  [
    'table:cube-of-force-charges-lost',
    {
      anchor: 'Spell or Item Charges Lost',
      reason:
        'Compiler-composed name combines the item heading "Cube of Force" with a "Charges Lost" description; the printed table caption is "Spell or Item Charges Lost".',
    },
  ],
  [
    'table:deck-of-many-things',
    {
      anchor: 'Playing Card Card',
      reason:
        'The item heading prints on the preceding page; the printed table header carried onto this record\'s cited page is "Playing Card Card".',
    },
  ],
  [
    'table:draconic-bloodline-draconic-ancestry',
    {
      anchor: 'Draconic Ancestry',
      reason:
        'Record name concatenates the subclass heading "Draconic Bloodline" with the table caption "Draconic Ancestry", which are not adjacent printed text; the anchor is the printed table caption alone.',
    },
  ],
  [
    'table:half-dragon-breath-weapon',
    {
      anchor: 'Size Breath Weapon Prerequisite',
      reason:
        'Compiler-composed name; the printed (wrapped two-row) table header column line is "Size Breath Weapon Prerequisite".',
    },
  ],
  [
    'table:half-dragon-damage-resistance',
    {
      anchor: 'Color Damage Resistance',
      reason:
        'Compiler-composed name; the printed table caption is "Color Damage Resistance".',
    },
  ],
  [
    'table:reincarnate-race',
    {
      anchor: 'd100 Race',
      reason:
        'Compiler prefixed the spell name "Reincarnate"; the printed table caption is bare "d100 Race".',
    },
  ],
  [
    'table:scrying-connection',
    {
      anchor: 'Connection Save Modifier',
      reason:
        'Compiler-composed name; the printed table caption for this specific sub-table (of two on the page) is "Connection Save Modifier".',
    },
  ],
  [
    'table:scrying-knowledge',
    {
      anchor: 'Knowledge Save Modifier',
      reason:
        'Compiler-composed name; the printed table caption for this specific sub-table (of two on the page) is "Knowledge Save Modifier".',
    },
  ],
  [
    'table:sentient-magic-item-alignment',
    {
      anchor: 'd100 Alignment d100 Alignment',
      reason:
        'Compiler-composed name; the printed table header carried onto this record\'s cited page is "d100 Alignment" (repeated for its two-column layout).',
    },
  ],
  [
    'table:sentient-magic-item-communication',
    {
      anchor: 'd100 Communication',
      reason: 'Compiler-composed name; printed table header.',
    },
  ],
  [
    'table:sentient-magic-item-senses',
    {
      anchor: 'd4 Senses',
      reason: 'Compiler-composed name; printed table header.',
    },
  ],
  [
    'table:sentient-magic-item-special-purpose',
    {
      anchor: 'd10 Purpose',
      reason:
        "Compiler-composed name; printed table header on this record's own cited page.",
    },
  ],
  [
    'table:sphere-of-annihilation',
    {
      anchor: 'd100 Result',
      reason: 'Compiler-composed name; printed table header.',
    },
  ],
  [
    'table:staff-of-power',
    {
      anchor: 'Distance from Origin Damage',
      reason:
        'The "Staff of Power" item heading prints on the preceding page; the printed retributive-strike damage table this record captures is carried onto this record\'s cited page under the caption "Distance from Origin Damage".',
    },
  ],
  [
    'table:staff-of-the-magi',
    {
      anchor: 'Distance from Origin Damage',
      reason:
        "Same retributive-strike table shape as table:staff-of-power, printed under the same caption on this record's own cited page for the Staff of the Magi.",
    },
  ],
  [
    'table:teleport-familiarity',
    {
      anchor: 'Familiarity Mishap Area Target Target',
      reason:
        'Compiler-composed name; the SRD wraps this table\'s column headers across two printed lines, and the second (full) line reads "Familiarity Mishap Area Target Target".',
    },
  ],
  [
    'table:wand-of-wonder',
    {
      anchor: 'd100 Effect',
      reason: 'Compiler-composed name; printed table header.',
    },
  ],
]);

function assertDeclaredAnchorsWellFormed(
  declarations: ReadonlyMap<string, DeclaredRecordSourceAnchor>,
): void {
  const malformed: string[] = [];
  for (const [key, declaration] of declarations) {
    if (declaration.reason.trim() === '') {
      malformed.push(`${key}: reason must not be empty`);
    }
    const normalizedLength = normalizeAnchorText(declaration.anchor).length;
    if (normalizedLength < MIN_DECLARED_ANCHOR_NORMALIZED_LENGTH) {
      malformed.push(
        `${key}: declared anchor ${JSON.stringify(declaration.anchor)} normalizes to ${normalizedLength} char(s), below the ${MIN_DECLARED_ANCHOR_NORMALIZED_LENGTH}-char floor`,
      );
    }
  }
  if (malformed.length > 0) {
    throw new RecordSourceAnchorError(
      `malformed DECLARED_RECORD_SOURCE_ANCHORS entries:\n${malformed.join('\n')}`,
    );
  }
}
assertDeclaredAnchorsWellFormed(DECLARED_RECORD_SOURCE_ANCHORS);

function normalizedPageTextByNumber(
  pages: readonly PageText[],
): ReadonlyMap<number, string> {
  const map = new Map<number, string>();
  for (const page of pages) {
    map.set(page.pageNumber, normalizeAnchorText(page.lines.join('\n')));
  }
  return map;
}

function anchorFoundOnAnyPage(
  anchor: string,
  pageNumbers: readonly number[],
  normalizedPages: ReadonlyMap<number, string>,
): boolean {
  const normalizedAnchor = normalizeAnchorText(anchor);
  if (normalizedAnchor === '') return false;
  return pageNumbers.some((pageNumber) => {
    const pageText = normalizedPages.get(pageNumber);
    return pageText?.includes(normalizedAnchor) ?? false;
  });
}

export interface AssertRecordsAnchoredInSourceOptions {
  /**
   * Also fail closed on a STALE declaration: a `DECLARED_RECORD_SOURCE_
   * ANCHORS` entry whose key matches no record in `records`. This is a
   * complete-corpus claim (a reduced fixture legitimately omits most
   * declared keys), so it mirrors `assertDeclarationsAreLive`'s opt-in
   * scoping for record-relationship declarations: only the real CLI import
   * turns it on.
   */
  readonly requireDeclarationsLive: boolean;
}

/**
 * The record anchor gate. Runs over the FINAL record list about to be
 * written to `records.json`. Throws ONE error listing every failing record
 * key (never just the first), so a run that regenerates the pack reports
 * the complete failure set in one pass.
 *
 * A record fails when:
 *  (a) it has no declaration, and its own `name` is not found on any page
 *      its `provenance.locator` cites;
 *  (b) it has a declaration, and the declared anchor is not found on any
 *      cited page;
 *  (c) it has a declaration, but its `name` IS found on a cited page — the
 *      declaration is redundant; the default (name-as-anchor) must stay the
 *      rule, so a redundant declaration is rejected rather than silently
 *      tolerated;
 *  (d) with `requireDeclarationsLive`, a declared key matches no emitted
 *      record (stale).
 */
export function assertRecordsAnchoredInSource(
  records: readonly RulesRecord[],
  pages: readonly PageText[],
  options: AssertRecordsAnchoredInSourceOptions,
): void {
  const normalizedPages = normalizedPageTextByNumber(pages);
  const failures: string[] = [];
  const declaredKeysSeen = new Set<string>();

  for (const record of records) {
    const pageNumbers = citedPages(record.provenance.locator);
    const declaration = DECLARED_RECORD_SOURCE_ANCHORS.get(record.key);
    const nameFound = anchorFoundOnAnyPage(
      record.name,
      pageNumbers,
      normalizedPages,
    );

    if (declaration === undefined) {
      if (!nameFound) {
        failures.push(
          `${record.key}: record name ${JSON.stringify(record.name)} not found on cited page(s) (${record.provenance.locator ?? '<no locator>'}); declare an explicit anchor in DECLARED_RECORD_SOURCE_ANCHORS or fix the record name/locator`,
        );
      }
      continue;
    }

    declaredKeysSeen.add(record.key);
    if (nameFound) {
      failures.push(
        `${record.key}: redundant declared anchor ${JSON.stringify(declaration.anchor)} — record name ${JSON.stringify(record.name)} is already found verbatim on its cited page(s); remove the declaration`,
      );
      continue;
    }
    if (
      !anchorFoundOnAnyPage(declaration.anchor, pageNumbers, normalizedPages)
    ) {
      failures.push(
        `${record.key}: declared anchor ${JSON.stringify(declaration.anchor)} not found on cited page(s) (${record.provenance.locator ?? '<no locator>'})`,
      );
    }
  }

  if (options.requireDeclarationsLive) {
    for (const key of DECLARED_RECORD_SOURCE_ANCHORS.keys()) {
      if (!declaredKeysSeen.has(key)) {
        failures.push(
          `${key}: declared source anchor matches no emitted record (stale declaration)`,
        );
      }
    }
  }

  if (failures.length > 0) {
    throw new RecordSourceAnchorError(
      `record source anchor gate failed for ${failures.length} record(s):\n${failures.join('\n')}`,
    );
  }
}
