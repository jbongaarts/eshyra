/**
 * PDF text extraction for the D&D 5e SRD 5.1 importer.
 *
 * Uses pdfjs-dist's "legacy" Node-friendly build to extract per-page text
 * content. The extractor groups text items into lines by their y-coordinate
 * (in PDF user space, origin at lower-left of the page) and sorts each line
 * left-to-right by x-coordinate.
 *
 * Column-aware emission: SRD 5.1 body chapters (spell descriptions, monster
 * stat blocks, …) render in two columns. pdfjs returns items in y-descending
 * order regardless of column, and items from both columns can share an
 * identical y-baseline (a wrap line at the bottom of one column lines up
 * exactly with a stat-block heading at the top of the next column on the
 * facing column). A naïve "bucket by y first" pass therefore concatenates
 * across columns into a single line ("… one Speed 40 ft., …"), erasing the
 * Speed row entirely. The extractor partitions ITEMS by x BEFORE bucketing
 * by y, then emits column-by-column (top-to-bottom within each column,
 * left-to-right between columns), which yields the natural reading order
 * with each column's contents kept intact. Pages whose item x values
 * collapse to a single cluster are emitted in their original y-descending
 * order, so single-column body pages and fixture PDFs are unaffected.
 *
 * Heading awareness: the SRD 5.1 PDF renders chapter titles ("Races",
 * "Equipment", "Using Ability Scores", "Appendix PH-A: Conditions") at a
 * larger font height than body prose. The extractor identifies items with
 * height ≥ `HEADING_H_THRESHOLD` as heading-class. Two consequences:
 *
 *   1. Multi-line chapter titles (e.g. "Using Ability" wrapping to "Scores"
 *      below it because the column is narrow) are merged back into a single
 *      logical line so `^Using Ability Scores$` anchors actually match.
 *
 *   2. Each `PageText` carries a `headingLineIndexes` array — indexes into
 *      `lines` for entries the extractor identified as chapter / section
 *      headings. The section slicer can opt into matching anchors only at
 *      these positions (see `matchHeadings` in `sections.ts`), so an
 *      `^Equipment$` line that appears as a class-block subsection at body
 *      font size does not shadow the actual "Equipment" chapter title even
 *      when their trimmed text is identical.
 *
 * Pure function: same PDF buffer always yields the same `PageText[]`.
 */

// pdfjs-dist's package "exports" map only exposes specific paths; "legacy/build/pdf.mjs" is the
// supported Node entry point that ships an ESM build without DOM-only code.
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import type { PageText } from './types.js';

// Minimal local shapes for pdfjs text-content items. The library's emitted
// types live behind a deep path (`pdfjs-dist/types/src/display/api`) that is
// not part of its public exports map; pinning a shallow structural type here
// avoids that coupling without losing meaningful type checking.
export interface PdfTextItem {
  readonly str: string;
  readonly transform: readonly number[];
  readonly height: number;
  /**
   * Rendered width of the text run in PDF user-space points. pdfjs populates
   * this for every text item and the line-joining pass uses it to detect a
   * visible gap between adjacent items on the same baseline (e.g. a
   * bold/regular font switch like "Armor Class" + "17 (natural armor)"
   * where pdfjs reports two items with no whitespace between their strs).
   */
  readonly width?: number;
}
interface PdfTextContent {
  readonly items: readonly unknown[];
}

/**
 * PDF hyphen-cluster normalization (applied to every extracted line, so all
 * downstream parsers and `sections.ts` see one canonical hyphen form).
 *
 * The SRD 5.1 PDF's embedded font emits every word-internal hyphen as a
 * presentation cluster of an ASCII hyphen plus invisible discretionary-break
 * hyphens:
 *   - U+002D HYPHEN-MINUS    (the only visible / ASCII member)
 *   - U+00AD SOFT HYPHEN     (non-printing discretionary break)
 *   - U+2010 HYPHEN
 *   - U+2011 NON-BREAKING HYPHEN
 * Rendered, the cluster looks like a single hyphen, but the raw extracted text
 * carries the whole run — e.g. "appendix PH-A", "10-year-old", "self- expression".
 * Left in place these invisible code points (1) break parser regexes that
 * expect a lone ASCII hyphen (the `LEVELED_MARKER` spell-heading miss in
 * loreweaver-qqc, the dropped compound creature names in loreweaver-w8h) and
 * (2) leak into the durable generated pack as hidden-Unicode artifacts
 * (loreweaver-6uy). Collapsing any run of these four code points to a single
 * ASCII hyphen normalizes heading detection AND body text in one place, at the
 * extraction boundary, so each parser no longer has to re-derive the same fix.
 *
 * The character class is written with explicit `\uXXXX` escapes so this source
 * file never embeds the invisible code points the normalization is about. Lines
 * that already carry a plain ASCII hyphen round-trip unchanged; en-dash (U+2013)
 * and em-dash (U+2014) are deliberately NOT in the class and are preserved.
 */
const PDF_HYPHEN_CLUSTER_OR_HYPHEN_RUN = /[-\u00AD\u2010\u2011]+/g;
const PDF_HYPHENATED_LINE_BREAK_ARTIFACT = /\b([A-Za-z0-9]+)- (?=([a-z]+)\b)/g;

function normalizePdfHyphenatedLineBreakArtifact(
  _match: string,
  previousToken: string,
  nextToken: string,
): string {
  if (/^\d+$/.test(previousToken) && nextToken === 'to') {
    return `${previousToken}- `;
  }
  return `${previousToken}-`;
}

/**
 * Collapse PDF hyphen presentation clusters in `text` to a single ASCII
 * hyphen. Exported so the committed-pack regression test and any parser that
 * wants a defensive local pass can reuse the exact same definition rather than
 * re-spelling the character class. Idempotent.
 */
export function normalizePdfHyphenCluster(text: string): string {
  return text
    .replace(PDF_HYPHEN_CLUSTER_OR_HYPHEN_RUN, '-')
    .replace(
      PDF_HYPHENATED_LINE_BREAK_ARTIFACT,
      normalizePdfHyphenatedLineBreakArtifact,
    );
}

/** Round y to this many decimal places when grouping items into lines. */
const Y_GROUP_PRECISION = 1;

/**
 * Item rendered-height (in PDF user-space points) at or above which a text
 * item counts as a chapter / section heading. SRD 5.1 body prose renders at
 * h ≈ 9.8, sub-subsection titles at 12.0 / 13.9, subsection titles at 18.0,
 * and chapter titles at 25.9. The 14 cutoff captures h=18 subsection titles
 * (Spell Lists, Spell Descriptions, Actions in Combat, Multiclassing, ...)
 * and h=25.9 chapter titles while excluding body and sub-subsection text.
 */
const HEADING_H_THRESHOLD = 14;

/**
 * Item rendered-height threshold for the multi-line MERGE pass. Only the
 * largest chapter-title style (h ≈ 25.9 in SRD 5.1) is subject to merging,
 * because that is where the narrow-column wrap actually happens
 * ("Using Ability" / "Scores", "Appendix PH-A:" / "Conditions"). Subsection
 * titles at h=18 are short enough that they do not wrap in the SRD.
 */
const HEADING_MERGE_H_THRESHOLD = 20;

/** Tolerance in PDF user-space points for treating two items as same-column. */
const COLUMN_X_TOLERANCE = 2;

/**
 * Minimum visible gap (in PDF user-space points) between adjacent items on
 * the same baseline before the line-joining pass inserts a space between
 * them. pdfjs returns each font-style run as a separate item, so SRD 5.1
 * stat-block rows ("Armor Class" + "17 (natural armor)") arrive as two
 * items with no whitespace between their `str` values; without this gap
 * detection the joined text would read "Armor Class17 (natural armor)" and
 * the `^Armor Class\s+(\d+)` parser regex would never match. A 1pt gap is
 * tight enough not to inject spaces between truly abutting items (e.g.
 * intra-word style changes) while still catching the ~10pt gutter between
 * a stat label and its value.
 */
const ITEM_GAP_SPACE_THRESHOLD = 1;

/**
 * Apostrophe reconstruction (eshyra-g9im.1). The SRD 5.1 PDF font's ToUnicode
 * CMap maps a handful of apostrophe glyphs to a zero-HEIGHT, near-zero-width
 * U+0020 SPACE item. That item is dropped by the height filter above, leaving a
 * ~2.2–2.5pt gap between the surrounding fragments, so the line-joining pass's
 * gap detection inserts a plain space: "a monster s attack" / "it can t be used"
 * instead of "a monster’s attack" / "it can’t be used".
 *
 * Such a gap is an apostrophe — not a word space — when the FOLLOWING fragment
 * begins with a possessive/contraction enclitic at a word boundary
 * (`POSSESSIVE_ENCLITIC`): `'s`, `'t`, `'d`, `'m`, `'re`, `'ve`, `'ll`. No
 * English word is a bare enclitic, so a real word boundary (the far more
 * numerous zero-width space at an italic style-run seam, e.g. "System" |
 * "Reference") is always followed by a full word and is never matched. The
 * `APOSTROPHE_GAP_MAX` bound additionally keeps wide label/value tabs out.
 * Across the whole SRD 5.1 PDF this matches exactly seven instances (Land’s
 * Stride p35, can’t p232, monster’s p358, the Mare’s/Lion’s/cow’s head and
 * Woman’s face deity-symbol prose p361-362).
 */
const APOSTROPHE_GAP_MAX = 5;
const POSSESSIVE_ENCLITIC = /^(?:s|t|d|m|re|ve|ll)(?=$|[\s,.;:!?'")])/;

/**
 * y-coordinate (PDF user space) at or below which a text item is treated as
 * the running page footer. The SRD 5.1 body pages print a footer band
 * ("System Reference Document 5.1" + page number) at y ≈ 31.9 on every page;
 * with column-aware emission those items would otherwise concatenate with
 * the bottom-of-column text and corrupt downstream parsers (e.g.
 * `parseSpells` saw a "Components: V" row immediately followed by the
 * footer and interpreted the SRD string as a continuation of the components
 * field). SRD 5.1 body content never descends below y ≈ 96, so a 45pt
 * cutoff drops the footer cleanly without risking any real content.
 */
const FOOTER_MAX_Y = 45;

/**
 * Minimum gap (in PDF user-space points) between adjacent sorted item x
 * values before they're considered as a column-cut candidate. SRD 5.1
 * two-column body pages have a left column at x ≈ 57 (continuation
 * indents up to ~144) and a right column starting at x ≈ 328, but the
 * effective gutter width varies page-by-page — most monster pages have
 * a ~78pt gutter (x≈251→329) while denser ones (e.g. pages 269, 320)
 * narrow it to ~49pt. The widest intra-column jump observed on a real
 * SRD 5.1 page is ≈37pt (intra-stat-block tabbing), so 45pt clears the
 * intra-column noise floor while still catching the narrow-gutter
 * monster pages. The per-side validation guards below (item count and
 * distinct-x diversity) catch any false positive that slips through.
 */
const COLUMN_GAP_THRESHOLD = 45;

/**
 * Maximum visible gap (in PDF user-space points) between two items on the same
 * baseline for them to count as a CONTIGUOUS run of flowing text rather than
 * two sides of a column gutter (`cutCrossesContiguousLine`). SRD 5.1 body prose
 * renders at h≈9.8 where an inter-word space is ≈2–3pt and a justified line's
 * stretched space stays well under ~10pt, whereas a real two-column gutter's
 * visible whitespace is ≈43pt (SRD p124: a left line ending at x≈286 and the
 * right column's "Range:" starting at x≈329). 20pt sits with wide margin above
 * any inter-word space and well below the narrowest genuine gutter, so the
 * contiguity guard catches an inline run split by a spurious start-x gap (the
 * p104 "bless on the same" case) without ever rejecting a real page gutter.
 * Deliberately distinct from `COLUMN_GAP_THRESHOLD`, which is a START-x gap on
 * sorted column candidates, not an end-to-start visible gap on one line.
 */
const INLINE_TEXT_FLOW_MAX_GAP = 20;

/**
 * Minimum item count any candidate column must contain before
 * `partitionItemsByColumn` accepts a column-cut. Real SRD body columns
 * carry hundreds of items, so a min of 2 is comfortably permissive while
 * still rejecting one-row stray splits.
 */
const MIN_ITEMS_PER_COLUMN = 2;

/**
 * Maximum smaller-side item count for a valid but suspicious cut to be treated
 * as a tiny outlier island rather than the page's structural split. SRD p236
 * has exactly two far-right text runs ("jump" + "spell") that satisfy the
 * minimum guards and open a wider x-gap than the real page gutter.
 *
 * The Magic Items A-Z pages (SRD p217-p218) push three line-final words flush
 * to the page edge. The Objects page (p203) pushes five fragments into the
 * same shape: they open a wider x-gap than the real page gutter and otherwise
 * look like a phantom third column. A ceiling of 5 lets the tiny-outlier guard
 * divert to the better-supported real-gutter cut on all reviewed cases; the
 * per-side item/distinct-x guards plus `reassignGutterStragglers` keep the
 * fragments attached to their true column. Split-column table pages carry
 * substantially more items on each side and do not qualify as tiny islands.
 */
const TINY_OUTLIER_SIDE_MAX_ITEMS = 5;

/**
 * The original tiny-island fallback handled 2-3 fragments by choosing the
 * most balanced supported cut. Keep that behavior for the sparse inline-flow
 * regressions it was designed around. Larger 4-5-fragment islands occur on
 * dense two-column pages where an embedded table can make an internal cut look
 * more balanced than the actual page gutter; those use the rightmost
 * well-supported cut instead.
 */
const BALANCED_TINY_OUTLIER_SIDE_MAX_ITEMS = 3;

/**
 * Minimum number of distinct rounded x-coordinates a candidate column
 * must contain. The real page-column gutter is the *only* gap in body
 * content where items on each side draw from a rich set of x indents
 * (left edge, wrap continuation, list-item dent, inline tabbing). A
 * multi-row label/value layout has every label at the same x and every
 * value at the same x, so each "side" of the candidate cut collapses to
 * a single distinct x — that's the signature this guard rejects, even
 * when the label/value x-gap exceeds `COLUMN_GAP_THRESHOLD`.
 */
const MIN_DISTINCT_X_PER_COLUMN = 2;

/**
 * Minimum line-start count for an x-coordinate to count as a dense column
 * margin during gutter-straggler repair. Sparse two-start table columns can
 * still be accepted when their text shape is structural rather than prose.
 */
const MIN_LINE_STARTS_FOR_DENSE_MARGIN = 3;

/**
 * x-gap (in PDF user-space points) at or above which a candidate cut is
 * accepted as a genuine page-column gutter even if one side collapses to a
 * single distinct x. The distinct-x guard (`MIN_DISTINCT_X_PER_COLUMN`)
 * rejects intra-column label/value tab stops, whose two halves each sit at a
 * single x; but the SRD 5.1 "Spell Lists" pages lay each class's spell names
 * flush-left in two columns with NO wrap indent, so a real column legitimately
 * draws from a single x. There the left column sits at x≈58 and the right at
 * x≈329 — a ≈271pt gutter — and the single-x left column was being rejected,
 * collapsing both columns into one y-interleaved flow that scrambled every
 * class list after the first column (loreweaver-xbh: Sorcerer cantrips after
 * "Acid Splash" were lost because the opposite column's "Ranger Spells" header
 * interleaved into them). A label/value tab is a far narrower gap (≈70pt in
 * the SRD stat blocks) and real two-column body gutters that DO need the
 * distinct-x guard are narrower still (≈49–78pt on monster pages, where both
 * columns carry rich indents anyway), so a 150pt floor cleanly separates the
 * wide spell-list gutter from every gap the distinct-x guard must still
 * scrutinize.
 */
const WIDE_GUTTER_GAP_THRESHOLD = 150;

/**
 * x-bin width (in PDF user-space points) for detecting vertically-aligned table
 * cell columns in `partitionItemsIntoReadingOrder`. Item start-x values are
 * binned at this width so a column's slight per-row drift (the SRD class table's
 * level cell wobbles x≈58→62) lands in one bin while genuinely distinct cell
 * columns (≈20–40pt apart) stay separate.
 */
const TABLE_COLUMN_BIN = 5;

/**
 * Minimum number of rows that must start an item in the same x-bin for that bin
 * to count as a structural (vertically-aligned) cell column. Random prose word
 * positions never recur this often at one x; a table's cell columns recur on
 * every row.
 */
const MIN_COLUMN_ROW_SUPPORT = 4;

/**
 * A full-width table row must occupy at least `MIN_LEFT_CELL_COLUMNS` structural
 * columns whose x is below `TABLE_LEFT_REGION_MAX_X` AND at least
 * `MIN_RIGHT_CELL_COLUMNS` whose x is at or above `TABLE_RIGHT_REGION_MIN_X`.
 * This is what separates the SRD class level-progression table (cells at the
 * level x≈58, bonus x≈104, feature x≈140 columns plus spell-slot columns out
 * past x≈326 — a true full-width table) from a right-column-only in-spell /
 * in-item stat table (the Animate Objects Size/HP/AC table sits wholly at
 * x≈329–545) and from a two-column prose line that coincidentally shares a
 * baseline (only the x≈58 left margin and the x≈329 right margin, never two
 * distinct LEFT cell columns). Only a row spanning real cells on BOTH sides of
 * the page bands the page.
 *
 * The right side requires ≥2 cell columns, not 1: every affected first-feature
 * class (Bard, Cleric, Druid, Monk, Paladin, Ranger, Warlock, Wizard) prints a
 * progression table with multiple right-side columns — the spellcasters' spell-
 * slot / spells-known cells, or the Monk's Martial Arts / Ki Points / Unarmored
 * Movement cells — whereas a two-column prose line or a label:value metadata
 * line ("Components: V, S, M …" at x≈58/120) reaches the right side only through
 * the single x≈329 prose margin of a coincidental shared baseline. The classes
 * whose table is printed AFTER the proficiency block (Barbarian, Fighter, Rogue)
 * are unaffected by the band path — their first feature was never split — so a
 * Fighter table with no right columns simply stays on the unbanded
 * `partitionItemsByColumn` path, unchanged.
 */
const TABLE_LEFT_REGION_MAX_X = 200;
const TABLE_RIGHT_REGION_MIN_X = 260;
const MIN_LEFT_CELL_COLUMNS = 2;
const MIN_RIGHT_CELL_COLUMNS = 2;

/**
 * Minimum length of a CONTIGUOUS (gap-filled) run of table rows for that run to
 * be confirmed as a full-width table band. A genuine class progression table is
 * 20 rows and the Armor/Weapons equipment tables are a dozen-plus consecutive
 * rows, whereas the only other pages whose rows pass the per-row left+right
 * structural test — two-column monster stat blocks, where a left creature's
 * attack line and a right creature's attack line coincidentally share aligned
 * cells — produce only short, scattered clusters (≤4 rows separated by prose).
 * Requiring a long contiguous run keeps those pages on the unchanged
 * `partitionItemsByColumn` path. A page with no confirmed run is never banded.
 */
const MIN_CONTIGUOUS_TABLE_ROWS = 8;

/**
 * Maximum number of consecutive non-table rows that may sit between two table
 * rows and still be absorbed into the table band. A progression table's
 * interior continuation rows (a wrapped feature name "(d6)" / "Inspiration", a
 * sub-header like "Medium Armor") are isolated 1–2 row gaps; genuine prose
 * between two separate tables is many rows and stays its own band.
 */
const TABLE_GAP_FILL_MAX_ROWS = 2;

export interface ExtractOptions {
  /**
   * Page range to extract (1-based, inclusive). If omitted, extracts all
   * pages. Useful for tests and for partial-PDF debugging.
   */
  readonly pageRange?: { start: number; end: number };
}

export async function extractPdfText(
  buffer: Uint8Array,
  options: ExtractOptions = {},
): Promise<PageText[]> {
  // Defensive copy: pdfjs documents detach the input buffer in some builds.
  const owned = new Uint8Array(buffer);
  const loadingTask = getDocument({
    data: owned,
    // Silence font / cmap warnings; we only consume extracted text.
    verbosity: 0,
  });
  const pdf = await loadingTask.promise;
  try {
    const start = options.pageRange?.start ?? 1;
    const end = options.pageRange?.end ?? pdf.numPages;
    interface RawPage {
      readonly pageNumber: number;
      readonly lines: readonly string[];
      readonly lineHeights: readonly number[];
      readonly lineGaps: readonly (number | null)[];
      readonly headingLineIndexes: readonly number[];
      readonly hasHeadingItem: boolean;
    }
    const raw: RawPage[] = [];
    for (let i = start; i <= end; i++) {
      const page = await pdf.getPage(i);
      try {
        const content = await page.getTextContent();
        const {
          lines,
          lineHeights,
          lineGaps,
          headingLineIndexes,
          hasHeadingItem,
        } = textContentToPage(content);
        raw.push({
          pageNumber: i,
          lines,
          lineHeights,
          lineGaps,
          headingLineIndexes,
          hasHeadingItem,
        });
      } finally {
        page.cleanup();
      }
    }
    // Document-level fall-back: when NO page contained any heading-class
    // item (e.g. fixture PDFs built with a uniform font size), don't carry
    // an empty `headingLineIndexes` array on each page — leave it
    // undefined so anchors with `matchHeadings: true` fall back to line
    // matching. When even ONE page has heading info, every page gets a
    // `headingLineIndexes` array (possibly empty for content-only pages);
    // the anchor stays heading-scoped so a body line spelling the regex
    // can't lock the slice onto the wrong place.
    const documentHasHeadings = raw.some((r) => r.hasHeadingItem);
    return raw.map((r) => ({
      pageNumber: r.pageNumber,
      lines: r.lines,
      // `lineHeights` carries the rendered max font height of each emitted
      // line, parallel to `lines`. Unlike `headingLineIndexes` (a coarse
      // h ≥ HEADING_H_THRESHOLD chapter/subsection flag tuned for section
      // anchoring), this exposes the full per-line height so a consumer can
      // reconstruct the finer rule heading hierarchy — the SRD core rules
      // nest four font tiers (chapter h≈25.9, subsection h≈18, and the
      // sub-/sub-subsection rule leaves at h≈13.9 / h≈12 that fall BELOW the
      // anchor threshold). `parseRules` reads this to emit a rule per leaf
      // without dropping parents (loreweaver-yli). Always populated.
      lineHeights: r.lineHeights,
      // `lineGaps` carries the per-line vertical gap from the previous line in
      // the same column (null at a column/page start). Always populated and
      // parallel to `lines`, like `lineHeights` (eshyra-76b7).
      lineGaps: r.lineGaps,
      ...(documentHasHeadings
        ? { headingLineIndexes: r.headingLineIndexes }
        : {}),
    }));
  } finally {
    await pdf.cleanup();
    await pdf.destroy();
  }
}

interface LineRecord {
  /** Items contributing to this line, left-to-right within the y bucket. */
  readonly items: readonly PdfTextItem[];
  /** Joined and trimmed text for this line. */
  readonly text: string;
  /** y-coordinate (rounded) of the line in PDF user space. */
  readonly y: number;
  /** Minimum x-coordinate of any item in the line. */
  readonly minX: number;
  /** Maximum rendered height of any item in the line. */
  readonly maxH: number;
  /** True when every item in the line has h ≥ HEADING_MERGE_H_THRESHOLD. */
  readonly isMergeHeading: boolean;
  /** True when every item in the line has h ≥ HEADING_H_THRESHOLD. */
  readonly isHeading: boolean;
}

function textContentToPage(content: PdfTextContent): {
  lines: readonly string[];
  lineHeights: readonly number[];
  lineGaps: readonly (number | null)[];
  headingLineIndexes: readonly number[];
  hasHeadingItem: boolean;
} {
  // pdfjs gives mixed items. Only text items carry a string we want; pdfjs
  // also emits zero-height "EOL" marker items (empty str, h=0) on the same
  // y as the line's real text — those would corrupt the heading-height
  // checks below (an empty marker on the same row as a chapter title would
  // make row.every(h ≥ threshold) false), so they're dropped up front.
  // Footer items (the persistent "System Reference Document 5.1 / <page#>"
  // band at y ≈ 31.9) are also dropped here so they don't appear as a
  // trailing line on every page's column-emit and corrupt parsers that
  // treat unrecognized lines as continuations of the previous field.
  const items: PdfTextItem[] = content.items.filter(
    (item): item is PdfTextItem => {
      if (
        typeof item !== 'object' ||
        item === null ||
        !('str' in item) ||
        !('transform' in item) ||
        !('height' in item)
      ) {
        return false;
      }
      const a = item as {
        str: unknown;
        height: unknown;
        transform: unknown;
      };
      if (
        typeof a.str !== 'string' ||
        a.str.length === 0 ||
        typeof a.height !== 'number' ||
        a.height <= 0
      ) {
        return false;
      }
      const t = a.transform as readonly number[];
      if (t.length < 6 || typeof t[5] !== 'number') return false;
      return t[5] >= FOOTER_MAX_Y;
    },
  );
  if (items.length === 0) {
    return {
      lines: [],
      lineHeights: [],
      lineGaps: [],
      headingLineIndexes: [],
      hasHeadingItem: false,
    };
  }
  // Partition items into columns BEFORE y-bucketing. Two items on the same
  // y but in different columns (e.g. SRD page 299, where the previous
  // monster's body text ends in the left column at y=710.40 while Adult
  // Gold Dragon's "Speed" line begins in the right column at y=710.40)
  // must not share a row bucket — otherwise the joined line text becomes
  // "Breath Weapons … one Speed 40 ft., …" and the speed regex misses.
  // Band-aware: a page that stacks a full-width region (a progression table
  // spanning both columns) above/below multi-column prose is first split into
  // horizontal bands so each band partitions on its own gutter (see
  // `partitionItemsIntoReadingOrder`); a uniform page collapses back to the
  // single page-wide cut.
  const itemsByColumn = partitionItemsIntoReadingOrder(items);
  const ordered: LineRecord[] = [];
  // Baseline-to-baseline vertical gap from the PREVIOUS line WITHIN the same
  // column, parallel to `lines`. Computed per column so an intra-column
  // paragraph break (a larger-than-line-height gap) is visible to consumers,
  // while the first line of every column (a reading-order discontinuity — a new
  // column or the top of a page) is `null` rather than a meaningless
  // cross-column delta. `parseCreatures` uses this to tell a stat block's
  // mechanical body from the trailing flavor paragraph the SRD prints after it,
  // which carry the same font height and so are otherwise indistinguishable
  // (eshyra-76b7).
  const lineGaps: (number | null)[] = [];
  for (const columnItems of itemsByColumn) {
    const records = bucketItemsIntoRecords(columnItems);
    const merged = mergeWrappedHeadings(records, columnItems);
    for (let k = 0; k < merged.length; k++) {
      lineGaps.push(k === 0 ? null : merged[k - 1].y - merged[k].y);
    }
    ordered.push(...merged);
  }
  const lines = ordered.map((r) => normalizePdfHyphenCluster(r.text));
  const lineHeights = ordered.map((r) => r.maxH);
  const headingLineIndexes: number[] = [];
  for (let idx = 0; idx < ordered.length; idx++) {
    if (ordered[idx].isHeading) headingLineIndexes.push(idx);
  }
  const hasHeadingItem = items.some((it) => it.height >= HEADING_H_THRESHOLD);
  return { lines, lineHeights, lineGaps, headingLineIndexes, hasHeadingItem };
}

/**
 * Group items into y-buckets and build per-line records in y-descending
 * (top-of-page-first) order. Operates on a single column's items; cross-
 * column y-bucketing is the caller's responsibility.
 */
function bucketItemsIntoRecords(items: readonly PdfTextItem[]): LineRecord[] {
  if (items.length === 0) return [];
  const byY = new Map<number, PdfTextItem[]>();
  for (const item of items) {
    const y = round(item.transform[5], Y_GROUP_PRECISION);
    const bucket = byY.get(y);
    if (bucket === undefined) {
      byY.set(y, [item]);
    } else {
      bucket.push(item);
    }
  }
  const yKeys = Array.from(byY.keys()).sort((a, b) => b - a);
  const records: LineRecord[] = [];
  for (const y of yKeys) {
    const row = byY.get(y);
    if (row === undefined) continue;
    row.sort((a, b) => a.transform[4] - b.transform[4]);
    const text = joinRowText(row);
    if (text.length === 0) continue;
    const minX = Math.min(...row.map((i) => i.transform[4]));
    const maxH = Math.max(...row.map((i) => i.height));
    records.push({
      items: row,
      text,
      y,
      minX,
      maxH,
      isMergeHeading: row.every((i) => i.height >= HEADING_MERGE_H_THRESHOLD),
      isHeading: row.every((i) => i.height >= HEADING_H_THRESHOLD),
    });
  }
  return records;
}

/**
 * Pick at most one column cut and return up to two columns of items in
 * left-to-right order. Pages whose candidate cuts all fall below
 * `COLUMN_GAP_THRESHOLD` (or all fail the per-column validation below)
 * return a single bucket containing all items, so single-column pages and
 * uniform-font fixture PDFs round-trip unchanged.
 *
 * Why item-level (not row-level) partitioning: a row spanning two columns
 * (the previous spell's wrap line in the left column at the same y as the
 * next spell's name in the right column) shares a y-bucket only because
 * the items happen to share an identical baseline. Splitting at the item
 * level keeps each column's reading order intact — the merged-text "Breath
 * Weapons … one Speed 40 ft., …" was the exact symptom of partitioning
 * after y-bucketing rather than before.
 *
 * Cut selection: we consider every x-gap that clears
 * `COLUMN_GAP_THRESHOLD` and keep only those where each side passes the
 * per-side guards (item count + distinct-x diversity). Among the
 * surviving cuts we normally keep the widest gap, except when that cut leaves
 * only a tiny outlier island on one side. Why not just the single absolute largest
 * gap, validate, and bail on failure (the prior approach): on monster
 * pages a far-right outlier item (e.g. a stray "The" at x=539 next to a
 * right-column body at x=329) creates an isolated x-gap of ~90pt that
 * exceeds the real gutter (~78pt at x≈251→329). The absolute-largest cut
 * lands at the outlier, the right side fails the MIN_ITEMS guard, and
 * the whole page falls back to unpartitioned y-bucketing — interleaving
 * the two columns line-by-line and silently dropping ~50% of creature
 * stat blocks (loreweaver-w8h). Scanning all qualifying gaps and keeping
 * only valid ones survives the outlier and still rejects intra-column
 * label/value tabbing (those gaps fail the distinct-x guard on both
 * sides — single label x, single value x — so they're filtered out).
 *
 * Gutter-straggler correction (`reassignGutterStragglers`, applied to the
 * chosen split): the SRD 5.1 body justifies paragraphs, so each paragraph's
 * last word is pushed flush to its column's right edge. A left-column last
 * word can therefore land close to the gutter, and the widest valid gap on
 * the page may be an internal left-column gap whose midpoint falls to the
 * LEFT of that word — sweeping it into the right column, where it buckets by
 * y between real right-column lines and scrambles reading order. SRD 5.1 p193
 * (end of the "Wish" spell): the widest valid gap is the internal left-column
 * gap 162→242 (midpoint ≈202), left of the right-aligned word "wish" (x≈259);
 * "wish" was swept into the right column and interleaved into "Word of
 * Recall"'s body (loreweaver-7ok). The correction moves such lone stragglers
 * back to the left column. It keys off line-start DENSITY rather than gap
 * width because the true right-column margin (x≈328.6 throughout the SRD,
 * 24–48 line-starts) is unmistakable next to a one-off justified word, while
 * gap width alone cannot tell the two apart on a justified page.
 */
/**
 * Reading-order partition for pages that stack a full-width band over (or under)
 * multi-column prose. `partitionItemsByColumn` chooses a SINGLE page-wide column
 * cut, which cannot represent the SRD 5.1 Classes-chapter layout: each class's
 * level-progression table spans both columns in the middle of the page, with the
 * class header above it and the first feature's prose below it, each in two
 * columns. The widest page-wide gap is the table's internal gutter, so the
 * single cut slices the table AND the prose along the table's narrower seam,
 * emitting the right-column feature continuation AFTER the table's entire right
 * half instead of immediately after the left-column prose. The Bard "Spellcasting"
 * and Druid "Druidic" first features were split this way: their right-column
 * remainder ("Your spells are part…", "(Perception) check… without magic.") was
 * displaced past the table and the left-column header's proficiency setup block
 * (Weapons:/Tools:/Saving Throws:/Skills:) bled into the feature body.
 *
 * The fix detects the table by STRUCTURE rather than by whitespace gaps:
 *   1. Item start-x values are binned (`TABLE_COLUMN_BIN`); a bin that recurs
 *      across at least `MIN_COLUMN_ROW_SUPPORT` rows is a structural cell column.
 *   2. A row is a full-width table row when it occupies at least
 *      `MIN_LEFT_CELL_COLUMNS` structural columns left of `TABLE_LEFT_REGION_MAX_X`
 *      AND at least `MIN_RIGHT_CELL_COLUMNS` at or beyond `TABLE_RIGHT_REGION_MIN_X`
 *      — cells on BOTH sides of the page, which two-column prose and
 *      right-column-only in-spell tables never have.
 *   3. Short non-table gaps between table rows (a wrapped feature-name "(d6)", a
 *      sub-header) are filled (`TABLE_GAP_FILL_MAX_ROWS`), and only a CONTIGUOUS
 *      run of at least `MIN_CONTIGUOUS_TABLE_ROWS` is confirmed as a table band —
 *      so the short, scattered aligned clusters on a two-column monster page are
 *      never banded.
 *   4. The page is split into bands around the confirmed table band, and each
 *      band is partitioned independently, so a prose band cuts on the real
 *      x≈329 prose gutter while the table band keeps its own internal cut.
 *   5. A SANDWICH GATE only diverges from the whole-page partition when a table
 *      band sits between two-column prose bands (the class-page signature: header
 *      above, first-feature prose below). The Equipment chapter's full-width
 *      tables sit at the page top with no two-column prose above, so they fail
 *      the gate and keep `parseEquipment`'s row form (e.g. the Shield row).
 * A page with no confirmed, sandwiched table band goes straight through
 * `partitionItemsByColumn` and round-trips unchanged.
 */
function partitionItemsIntoReadingOrder(
  items: readonly PdfTextItem[],
): readonly (readonly PdfTextItem[])[] {
  if (items.length <= 1) return partitionItemsByColumn(items);
  // Group items into y-buckets, top-of-page first.
  const byY = new Map<number, PdfTextItem[]>();
  for (const item of items) {
    const y = round(item.transform[5], Y_GROUP_PRECISION);
    const bucket = byY.get(y);
    if (bucket === undefined) byY.set(y, [item]);
    else bucket.push(item);
  }
  const ys = Array.from(byY.keys()).sort((a, b) => b - a);

  // Detect a full-width table band by vertically-aligned cell columns. Each
  // row's item start-x values are binned; a bin that recurs across many rows is
  // a structural column. A FULL-WIDTH table row occupies cells on both sides of
  // the page — ≥`MIN_LEFT_CELL_COLUMNS` structural columns in the left region
  // and ≥`MIN_RIGHT_CELL_COLUMNS` in the right region — like an SRD class
  // progression row (level/bonus/feature cells plus spell-slot columns). This
  // excludes a right-column-only in-spell/in-item stat table (Animate Objects'
  // Size/HP/AC table sits wholly at x≈329–545) and a two-column prose line that
  // coincidentally shares a baseline (only the left and right margins, never two
  // distinct left cell columns). A page with no such table (every prose page,
  // the straggler/tiny-island fixtures) goes straight through
  // `partitionItemsByColumn` unchanged.
  const bin = (x: number): number => Math.round(x / TABLE_COLUMN_BIN);
  const leftBinMax = TABLE_LEFT_REGION_MAX_X / TABLE_COLUMN_BIN;
  const rightBinMin = TABLE_RIGHT_REGION_MIN_X / TABLE_COLUMN_BIN;
  const rowBins = ys.map((y) => {
    const row = byY.get(y);
    return new Set(
      row === undefined ? [] : row.map((it) => bin(it.transform[4])),
    );
  });
  const support = new Map<number, number>();
  for (const bins of rowBins) {
    for (const b of bins) support.set(b, (support.get(b) ?? 0) + 1);
  }
  const structural = new Set(
    Array.from(support.entries())
      .filter(([, count]) => count >= MIN_COLUMN_ROW_SUPPORT)
      .map(([b]) => b),
  );
  const isTableRow = rowBins.map((bins) => {
    let leftHits = 0;
    let rightHits = 0;
    for (const b of bins) {
      if (!structural.has(b)) continue;
      if (b < leftBinMax) leftHits++;
      else if (b >= rightBinMin) rightHits++;
    }
    return (
      leftHits >= MIN_LEFT_CELL_COLUMNS && rightHits >= MIN_RIGHT_CELL_COLUMNS
    );
  });
  if (!isTableRow.some((t) => t)) return partitionItemsByColumn(items);

  // Fill short non-table gaps that sit BETWEEN table rows so an interior
  // continuation row (a feature-name wrap "(d6)" / "Inspiration", a sub-header
  // "Medium Armor") stays inside its table band instead of splitting it. A gap
  // wider than `TABLE_GAP_FILL_MAX_ROWS` (real prose between two separate
  // tables) is left as its own band.
  const inTable = isTableRow.slice();
  let lastTable = -1;
  for (let i = 0; i < ys.length; i++) {
    if (!isTableRow[i]) continue;
    if (lastTable >= 0 && i - lastTable - 1 <= TABLE_GAP_FILL_MAX_ROWS) {
      for (let k = lastTable + 1; k < i; k++) inTable[k] = true;
    }
    lastTable = i;
  }

  // Confirm only CONTIGUOUS table runs of at least `MIN_CONTIGUOUS_TABLE_ROWS`.
  // Short clusters (the coincidental aligned rows on a two-column monster page)
  // are demoted back to prose; if nothing remains the page is never banded and
  // takes the unchanged whole-page `partitionItemsByColumn` path.
  const confirmed = new Array<boolean>(ys.length).fill(false);
  for (let i = 0; i < ys.length; ) {
    if (!inTable[i]) {
      i++;
      continue;
    }
    let j = i;
    while (j < ys.length && inTable[j]) j++;
    if (j - i >= MIN_CONTIGUOUS_TABLE_ROWS) {
      for (let k = i; k < j; k++) confirmed[k] = true;
    }
    i = j;
  }
  if (!confirmed.some((t) => t)) return partitionItemsByColumn(items);

  // Build contiguous bands of one class (table vs prose), top-to-bottom.
  interface Band {
    readonly table: boolean;
    readonly items: PdfTextItem[];
  }
  const bands: Band[] = [];
  for (let i = 0; i < ys.length; i++) {
    const bucket = byY.get(ys[i]);
    if (bucket === undefined) continue;
    const last = bands[bands.length - 1];
    if (last === undefined || last.table !== confirmed[i]) {
      bands.push({ table: confirmed[i], items: [...bucket] });
    } else {
      last.items.push(...bucket);
    }
  }
  if (bands.length <= 1) return partitionItemsByColumn(items);

  // Partition every band independently. The ONLY behavioral change vs the
  // whole-page partition is that each band cuts on its OWN gutter: the class
  // first-feature prose band cuts on the real x≈193 prose gutter and re-joins
  // its displaced right-column continuation ("Your spells are part…") directly
  // after the left-column intro, instead of inheriting the table band's
  // table-driven cut and emitting it after the table's right half. The table
  // band itself still partitions exactly as before (the table dominates its own
  // cut), so its emitted line form — which `parseFeatures` reads for grant-level
  // anchors — is unchanged.
  const partitioned = bands.map((band) => partitionItemsByColumn(band.items));

  // Gate: only band a table that is SANDWICHED between two-column prose, the
  // class-page signature (two-column class header above the progression table,
  // two-column first-feature prose below it). The Equipment chapter's full-width
  // Armor/Weapons tables sit at the TOP of their page with no two-column prose
  // above, so they fail this gate and stay on the unchanged whole-page partition
  // — preserving `parseEquipment`'s row form (e.g. the Shield row). A monster /
  // spell page never reaches here (no confirmed table band).
  const proseTwoColumn = bands.map(
    (band, i) => !band.table && partitioned[i].length >= 2,
  );
  const sandwiched = bands.some(
    (band, i) =>
      band.table &&
      proseTwoColumn.slice(0, i).some(Boolean) &&
      proseTwoColumn.slice(i + 1).some(Boolean),
  );
  if (!sandwiched) return partitionItemsByColumn(items);

  // Emit bands top-to-bottom, columns left-to-right within each band.
  const out: (readonly PdfTextItem[])[] = [];
  for (const cols of partitioned) out.push(...cols);
  return out;
}

function partitionItemsByColumn(
  items: readonly PdfTextItem[],
): readonly (readonly PdfTextItem[])[] {
  if (items.length <= 1) return [items];
  const sortedXs = items
    .map((it) => it.transform[4])
    .slice()
    .sort((a, b) => a - b);
  // Collect every candidate cut whose x-gap clears the threshold AND
  // whose induced split passes the per-side validation. The widest accepted
  // cut stays the default for parser compatibility with split-column tables;
  // a tiny two-item island can be replaced by the best-supported candidate.
  let widestGap = 0;
  let widestMinSideItems = 0;
  let widestCutAt = 0;
  let widestLeft: PdfTextItem[] | null = null;
  let widestRight: PdfTextItem[] | null = null;
  let supportedGap = 0;
  let supportedMinSideItems = 0;
  let supportedLeft: PdfTextItem[] | null = null;
  let supportedRight: PdfTextItem[] | null = null;
  let rightmostSupportedCutAt = Number.NEGATIVE_INFINITY;
  let rightmostSupportedLeft: PdfTextItem[] | null = null;
  let rightmostSupportedRight: PdfTextItem[] | null = null;
  for (let i = 1; i < sortedXs.length; i++) {
    const gap = sortedXs[i] - sortedXs[i - 1];
    if (gap < COLUMN_GAP_THRESHOLD) continue;
    const cutAt = (sortedXs[i] + sortedXs[i - 1]) / 2;
    const left: PdfTextItem[] = [];
    const right: PdfTextItem[] = [];
    for (const item of items) {
      if (item.transform[4] < cutAt) left.push(item);
      else right.push(item);
    }
    // Item-count guard: protects one-row fixtures and stray-item splits.
    if (
      left.length < MIN_ITEMS_PER_COLUMN ||
      right.length < MIN_ITEMS_PER_COLUMN
    ) {
      continue;
    }
    const minSideItems = Math.min(left.length, right.length);
    // Distinct-x guard: protects repeated label/value layouts. A real
    // page column has body content at multiple x indents; a label or a
    // value column collapses to a single distinct x. Skipped for a
    // wide-gutter cut, where a single-x column is a real flush-left list
    // column (the SRD "Spell Lists" pages) rather than a tab stop.
    if (
      gap < WIDE_GUTTER_GAP_THRESHOLD &&
      (distinctRoundedXCount(left) < MIN_DISTINCT_X_PER_COLUMN ||
        distinctRoundedXCount(right) < MIN_DISTINCT_X_PER_COLUMN)
    ) {
      continue;
    }
    if (gap > widestGap) {
      widestGap = gap;
      widestMinSideItems = minSideItems;
      widestCutAt = cutAt;
      widestLeft = left;
      widestRight = right;
    }
    if (
      minSideItems > supportedMinSideItems ||
      (minSideItems === supportedMinSideItems && gap > supportedGap)
    ) {
      supportedGap = gap;
      supportedMinSideItems = minSideItems;
      supportedLeft = left;
      supportedRight = right;
    }
    if (
      minSideItems > TINY_OUTLIER_SIDE_MAX_ITEMS &&
      cutAt > rightmostSupportedCutAt
    ) {
      rightmostSupportedCutAt = cutAt;
      rightmostSupportedLeft = left;
      rightmostSupportedRight = right;
    }
  }
  if (widestLeft === null || widestRight === null) return [items];
  if (widestMinSideItems <= TINY_OUTLIER_SIDE_MAX_ITEMS) {
    // The widest cut leaves only a tiny island on one side. Prefer a
    // better-supported real-gutter cut when one exists (SRD p217/p218/p236
    // justified-straggler pages); otherwise check whether the tiny island is a
    // phantom column made of inline text continuations rather than a real
    // column. A real page-column gutter is vertical whitespace that no LINE of
    // text crosses; a spurious cut on a sparse, effectively single-column page
    // slices through a contiguous run on one baseline. SRD 5.1 p104
    // (loreweaver-3hp): "For example, if two clerics cast" (x≈67, ends ≈198) is
    // followed on the SAME line by the italic run "bless" (x≈200) and "on the
    // same" (x≈222); with nothing starting between x≈139 and x≈200 the 61pt
    // start-x gap swept "bless on the same" into a phantom right column emitted
    // after the rest of the paragraph, corrupting the Combining Magical Effects
    // rule body. Scoping the contiguity test to the tiny-island case keeps
    // genuine multi-item gutters — where one justified left line can legitimately
    // end ≈43pt from the right column — untouched.
    if (
      widestMinSideItems > BALANCED_TINY_OUTLIER_SIDE_MAX_ITEMS &&
      rightmostSupportedLeft !== null &&
      rightmostSupportedRight !== null
    ) {
      return reassignGutterStragglers(
        rightmostSupportedLeft,
        rightmostSupportedRight,
      );
    }
    if (
      supportedLeft !== null &&
      supportedRight !== null &&
      supportedMinSideItems > widestMinSideItems
    ) {
      return reassignGutterStragglers(supportedLeft, supportedRight);
    }
    if (cutCrossesContiguousLine(items, widestCutAt)) {
      return [items];
    }
  }
  // Even past the tiny-island bar, a sparse single-column page can present a
  // phantom gutter when each entry opens with a short indented bold lead-in and
  // the justified remainder of that first line starts well to the right. SRD 5.1
  // p205 "Sample Poisons" (loreweaver-6ra): "Pale Tincture (Ingested)." (x≈67,
  // indented) is followed on the SAME baseline by "A creature subjected to"
  // (x≈180), and five entries open this way. The widest gap (x≈67→145) clears
  // COLUMN_GAP_THRESHOLD and both sides pass the item-count / distinct-x guards,
  // so the page was split into a phantom right column and every lead-in's
  // remainder was emitted after the body — scrambling each poison's first
  // sentence. Such a cut straddles several contiguous first lines and not one
  // real column gutter; a genuine two-column gutter is vertical whitespace no
  // line of text crosses, so its shared-y pairs always clear the full ~43pt
  // gutter and never read as contiguous (gutterPairs > 0). Requiring two or more
  // contiguous crossings and zero gutter crossings targets the inline-lead-in
  // pattern without touching real columns. Unlike the tiny-island contiguity
  // check above, this fires regardless of island size, gated by TWO further
  // conditions that each rule out a different real two-column page whose widest
  // cut happens to read as contiguous:
  //   - The widest cut must also be the most balanced one on the page
  //     (`widestMinSideItems >= supportedMinSideItems`). On SRD 5.1 p238 (Robe
  //     of Eyes) and p226 (Immovable Rod | Horn of Valhalla) the WIDEST gap is a
  //     mid-line italic/embedded-table run rather than the real gutter, so the
  //     real gutter is a strictly more balanced cut and the page is not merged.
  //   - The right side of the cut must have NO standalone line
  //     (`rightSideHasStandaloneLine` false): every right-side item shares its
  //     baseline with a left-side item. On the SRD 5.1 p63 armor table the
  //     AC→Strength cut reads as contiguous (the AC cell ends ≈20pt from the
  //     Strength column) and is the most balanced cut, but the right side owns
  //     the real right-hand prose column on its own baselines, so it stays split.
  // The sparse single-column p205 Sample Poisons page is the one case that
  // satisfies both: its only cut is the most balanced, and its right side is
  // purely lead-in remainders sharing the left lead-ins' baselines.
  const crossings = classifyCutCrossings(items, widestCutAt);
  if (
    widestMinSideItems >= supportedMinSideItems &&
    crossings.gutterPairs === 0 &&
    crossings.contiguousPairs >= 2 &&
    !rightSideHasStandaloneLine(items, widestCutAt)
  ) {
    return [items];
  }
  return reassignGutterStragglers(widestLeft, widestRight);
}

/**
 * Move right-column items that sit left of the right column's true left margin
 * back to the left column. See `partitionItemsByColumn` for the justified-text
 * failure this corrects.
 *
 * The margin is the SMALLEST rounded x with dense line-start support: a
 * genuine column edge always has multiple line-starts, whereas left-column
 * fragments swept across the gutter have only one or two starts to their left.
 * Defining the margin by line-start density (not by "most frequent x",
 * which can be a deeper wrap indent, nor by the leftmost x, which can be the
 * straggler itself) keeps clean pages untouched: when the right column's
 * leftmost item already starts the densest margin, nothing lies left of it and
 * the split is returned unchanged. Only stragglers more than
 * `COLUMN_X_TOLERANCE` left of the margin move. A final guard refuses any move
 * that would shrink the right column below `MIN_ITEMS_PER_COLUMN`, so a
 * genuinely small right column is never dismantled.
 */
function reassignGutterStragglers(
  left: readonly PdfTextItem[],
  right: readonly PdfTextItem[],
): readonly (readonly PdfTextItem[])[] {
  const startsByX = new Map<number, PdfTextItem[]>();
  for (const it of right) {
    const x = Math.round(it.transform[4]);
    const bucket = startsByX.get(x);
    if (bucket === undefined) {
      startsByX.set(x, [it]);
    } else {
      bucket.push(it);
    }
  }
  let margin: number | undefined;
  for (const [x, starts] of startsByX) {
    if (
      isSupportedGutterMargin(starts) &&
      (margin === undefined || x < margin)
    ) {
      margin = x;
    }
  }
  if (margin === undefined) return [left, right];
  const threshold = margin - COLUMN_X_TOLERANCE;
  const keptRight: PdfTextItem[] = [];
  const movedLeft: PdfTextItem[] = [];
  for (const it of right) {
    if (it.transform[4] < threshold) movedLeft.push(it);
    else keptRight.push(it);
  }
  if (movedLeft.length === 0 || keptRight.length < MIN_ITEMS_PER_COLUMN) {
    return [left, right];
  }
  return [[...left, ...movedLeft], keptRight];
}

function isSupportedGutterMargin(starts: readonly PdfTextItem[]): boolean {
  if (starts.length >= MIN_LINE_STARTS_FOR_DENSE_MARGIN) return true;
  return (
    starts.length === 2 &&
    starts.some((item) => !/^[a-z]/.test(item.str.trim()))
  );
}

/**
 * True when the vertical line at `cutAt` passes through a contiguous run of
 * text on any single baseline — i.e. some line has an item ending just left of
 * the cut immediately followed (within `INLINE_TEXT_FLOW_MAX_GAP`) by an item
 * starting just right of it. Such a cut slices through flowing text rather than
 * a page-column gutter. A genuine two-column baseline (a left-column line and a
 * right-column line sharing a y) leaves a real gutter gap (≈43pt in the SRD) at
 * the cut, well above the inline-flow threshold, so it does not trip this guard.
 * `partitionItemsByColumn` applies this only to a tiny-island widest cut (see
 * its call site for the SRD 5.1 p104 "bless on the same" corruption this fixes).
 */
function cutCrossesContiguousLine(
  items: readonly PdfTextItem[],
  cutAt: number,
): boolean {
  return classifyCutCrossings(items, cutAt).contiguousPairs > 0;
}

/** Count of same-baseline item pairs straddling a candidate cut, split by
 *  whether the visible gap between them reads as inline text flow
 *  (`contiguousPairs`, gap < `INLINE_TEXT_FLOW_MAX_GAP`) or as a real column
 *  gutter (`gutterPairs`). A genuine two-column gutter yields only
 *  `gutterPairs`; a phantom cut through flowing single-column text yields
 *  `contiguousPairs`. See `partitionItemsByColumn` for both call sites. */
interface CutCrossings {
  readonly contiguousPairs: number;
  readonly gutterPairs: number;
}

function classifyCutCrossings(
  items: readonly PdfTextItem[],
  cutAt: number,
): CutCrossings {
  const byY = new Map<number, PdfTextItem[]>();
  for (const item of items) {
    const y = round(item.transform[5], Y_GROUP_PRECISION);
    const bucket = byY.get(y);
    if (bucket === undefined) byY.set(y, [item]);
    else bucket.push(item);
  }
  let contiguousPairs = 0;
  let gutterPairs = 0;
  for (const row of byY.values()) {
    row.sort((a, b) => a.transform[4] - b.transform[4]);
    for (let k = 1; k < row.length; k++) {
      const prev = row[k - 1];
      const curr = row[k];
      // The cut falls between this consecutive pair's start-x values.
      if (prev.transform[4] >= cutAt || curr.transform[4] < cutAt) continue;
      const prevEndX = prev.transform[4] + (prev.width ?? 0);
      const visibleGap = curr.transform[4] - prevEndX;
      if (visibleGap < INLINE_TEXT_FLOW_MAX_GAP) contiguousPairs++;
      else gutterPairs++;
    }
  }
  return { contiguousPairs, gutterPairs };
}

/**
 * True when some baseline has items only on the RIGHT of `cutAt` (none on the
 * left) — i.e. the right side of the cut owns at least one standalone line. A
 * genuine right page-column always has such lines; a phantom column made only of
 * inline continuations of left-side lines (each sharing its left line's
 * baseline) has none. `partitionItemsByColumn` uses this to tell the SRD 5.1
 * p205 Sample Poisons inline lead-in case (merge) apart from a real right column
 * whose widest cut happens to read as contiguous (keep split).
 */
function rightSideHasStandaloneLine(
  items: readonly PdfTextItem[],
  cutAt: number,
): boolean {
  const byY = new Map<number, { left: boolean; right: boolean }>();
  for (const item of items) {
    const y = round(item.transform[5], Y_GROUP_PRECISION);
    const flags = byY.get(y) ?? { left: false, right: false };
    if (item.transform[4] < cutAt) flags.left = true;
    else flags.right = true;
    byY.set(y, flags);
  }
  for (const flags of byY.values()) {
    if (flags.right && !flags.left) return true;
  }
  return false;
}

function distinctRoundedXCount(items: readonly PdfTextItem[]): number {
  const xs = new Set<number>();
  for (const item of items) {
    xs.add(Math.round(item.transform[4]));
  }
  return xs.size;
}

/**
 * Concatenate the strings of items on the same baseline, injecting a space
 * between adjacent items when their visual x-gap exceeds
 * `ITEM_GAP_SPACE_THRESHOLD` and neither end already carries whitespace.
 * This is the join used to derive a line's text. The pre-existing naive
 * `.join('')` was correct for items whose `str` carried their own
 * inter-run spacing, but SRD 5.1 stat blocks render "Armor Class" (bold)
 * and "17 (natural armor)" (regular) as two abutting items with no
 * whitespace in either `str`; joining without a gap-aware space produces
 * "Armor Class17 (natural armor)" and the stat-line regexes miss.
 */
export function joinRowText(row: readonly PdfTextItem[]): string {
  if (row.length === 0) return '';
  let text = row[0].str;
  for (let i = 1; i < row.length; i++) {
    const prev = row[i - 1];
    const curr = row[i];
    const prevWidth = prev.width ?? 0;
    const prevEndX = prev.transform[4] + prevWidth;
    const currStartX = curr.transform[4];
    const gap = currStartX - prevEndX;
    const prevEndsWithSpace = /\s$/.test(prev.str);
    const currStartsWithSpace = /^\s/.test(curr.str);
    if (
      gap > ITEM_GAP_SPACE_THRESHOLD &&
      !prevEndsWithSpace &&
      !currStartsWithSpace
    ) {
      // A small gap left by a dropped zero-height apostrophe glyph, between a
      // letter and a possessive/contraction enclitic, is an apostrophe rather
      // than a word space (eshyra-g9im.1).
      if (
        gap < APOSTROPHE_GAP_MAX &&
        /[A-Za-z]$/.test(prev.str) &&
        POSSESSIVE_ENCLITIC.test(curr.str)
      ) {
        text += '’';
        text += curr.str;
        continue;
      }
      text += ' ';
    }
    text += curr.str;
  }
  return text.trim();
}

/**
 * Merge chapter-title lines that wrap across two or more visual rows in the
 * same column. The SRD 5.1 PDF puts narrow chapter titles on a left sidebar
 * that wraps into two or three lines ("Using Ability" / "Scores",
 * "Appendix PH-A:" / "Conditions"); pdfjs sees each visual row as a separate
 * y-coordinate, and a side-by-side table in the opposite column interleaves
 * its own rows between them in y-desc order. Without merging, a section
 * anchor like `^Using Ability Scores$` cannot match the heading at all.
 *
 * Merging is intentionally conservative. For each heading line A, we scan
 * forward (descending y) and consider each subsequent line B:
 *   - lines in a different column are ignored (the sidebar table case);
 *   - the first line in the SAME column that is body-prose stops the scan
 *     (we have left the heading block);
 *   - a heading line in the same column is added to the merge group only if
 *     no other item exists in that column between A's y and B's y (so a
 *     subsection title or paragraph inside the heading sidebar would block).
 * Every item in the merged set must clear `HEADING_MERGE_H_THRESHOLD`, so
 * subsection titles (h=18 in the SRD) are never folded into chapter titles
 * (h=25.9) and body prose is never folded into anything.
 */
function mergeWrappedHeadings(
  records: readonly LineRecord[],
  allItems: readonly PdfTextItem[],
): LineRecord[] {
  const groups: number[][] = [];
  const claimed = new Set<number>();
  for (let i = 0; i < records.length; i++) {
    if (claimed.has(i)) continue;
    const head = records[i];
    if (!head.isMergeHeading) continue;
    const group = [i];
    let lastIdx = i;
    for (let j = i + 1; j < records.length; j++) {
      if (claimed.has(j)) continue;
      const next = records[j];
      const sameColumn = Math.abs(next.minX - head.minX) <= COLUMN_X_TOLERANCE;
      if (!sameColumn) continue;
      if (!next.isMergeHeading) break;
      const last = records[lastIdx];
      if (intersectingItemInColumn(allItems, last, next, head.minX)) break;
      group.push(j);
      lastIdx = j;
    }
    if (group.length > 1) {
      groups.push(group);
      for (const idx of group) claimed.add(idx);
    }
  }
  if (groups.length === 0) {
    return [...records];
  }
  const headIndex = new Map<number, number[]>();
  const dropped = new Set<number>();
  for (const group of groups) {
    headIndex.set(group[0], group);
    for (const idx of group.slice(1)) dropped.add(idx);
  }
  const out: LineRecord[] = [];
  for (let i = 0; i < records.length; i++) {
    if (dropped.has(i)) continue;
    const group = headIndex.get(i);
    if (group === undefined) {
      out.push(records[i]);
      continue;
    }
    const members = group.map((idx) => records[idx]);
    const mergedItems = members.flatMap((m) => m.items);
    out.push({
      items: mergedItems,
      text: members.map((m) => m.text).join(' '),
      y: members[0].y,
      minX: members[0].minX,
      maxH: Math.max(...members.map((m) => m.maxH)),
      isMergeHeading: true,
      isHeading: true,
    });
  }
  return out;
}

/**
 * True when any item in the heading's column lies strictly between two
 * candidate heading lines' y-coordinates. "Same column" means within
 * `COLUMN_X_TOLERANCE` of the supplied column anchor (the original heading's
 * minX, so a multi-line title with slight per-row x drift still anchors back
 * to the chapter title's column). This is what prevents a sidebar table on
 * the opposite half of the page from blocking the legitimate merge of two
 * chapter-title rows, while still refusing to merge across an intervening
 * subsection title or paragraph in the heading's own column.
 */
function intersectingItemInColumn(
  allItems: readonly PdfTextItem[],
  upper: LineRecord,
  lower: LineRecord,
  columnX: number,
): boolean {
  // Compare with the SAME rounding the line bucket uses, so an item whose
  // raw y happens to fall slightly below the rounded bucket key (e.g. raw
  // 664.59 in a bucket keyed at 664.6) is not falsely counted as "between"
  // the upper and lower bucket boundaries.
  const yHi = upper.y;
  const yLo = lower.y;
  for (const item of allItems) {
    const iy = round(item.transform[5], Y_GROUP_PRECISION);
    if (iy >= yHi || iy <= yLo) continue;
    const ix = item.transform[4];
    if (Math.abs(ix - columnX) <= COLUMN_X_TOLERANCE) {
      return true;
    }
  }
  return false;
}

function round(value: number, decimals: number): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}
