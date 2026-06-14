/**
 * Rule-text parser for the D&D 5e SRD 5.1 importer.
 *
 * Input is a slice of `PageText[]` already narrowed to SRD core-rules
 * chapters (Using Ability Scores, Adventuring, Combat); output is a
 * `RuleExtraction[]` with stable shape, sorted by name.
 *
 * Two parsing paths (loreweaver-yli):
 *
 *  1. **Heading-hierarchy path** — used when the slice carries per-line font
 *     heights (`PageText.lineHeights`, the real SRD extraction). The SRD core
 *     rules nest four font tiers: chapter (h≈25.9, rendered as a rotated page
 *     banner that pdfjs drops from the slice), subsection (h≈18, e.g. "Making
 *     an Attack"), sub-subsection (h≈13.9, e.g. "Attack Rolls"), and leaf
 *     (h≈12, e.g. "Death Saving Throws"). The parser emits a rule per heading
 *     and bounds each body at the NEXT heading of ANY tier, so a parent keeps
 *     only its intro prose and every child becomes its own record (no
 *     wrapper-drop, no parent→child body-bleed). Cross-chapter name collisions
 *     ("Hit Points" in both Constitution and Damage and Healing; "Initiative"
 *     in Dexterity and The Order of Combat; the three per-ability "Spellcasting
 *     Ability" sidebars) are disambiguated with parent-qualified record keys —
 *     the leaf `name` stays the SRD title, but `keySlug` prepends just enough
 *     ancestor titles to stay unique.
 *
 *  2. **Legacy text-heuristic path** — used when the slice has NO font heights
 *     (fixture PDFs built at a uniform size). Heading boundaries are detected
 *     from heading-cased lines at paragraph/page boundaries, a flat (un-nested)
 *     emission. This preserves the original behavior the fixture unit tests
 *     assert against.
 */

import type { PageText, RuleExtraction } from './types.js';

/**
 * Remove table-cell-height lines before parsing a prose-only bounded slice.
 *
 * This is intentionally opt-in. General rule slices contain legitimate gray
 * sidebar prose at h≈8.9, but the Equipment guidance slices have no such body
 * prose and are interrupted by armor/weapon table cells at that height.
 */
export function removeTableCellLines(
  pages: readonly PageText[],
): readonly PageText[] {
  return pages
    .map((page) => {
      if (page.lineHeights === undefined) return page;
      const lines: string[] = [];
      const lineHeights: number[] = [];
      for (let i = 0; i < page.lines.length; i++) {
        const height = page.lineHeights[i];
        if (height !== undefined && height < BODY_PROSE_MIN_H) continue;
        lines.push(page.lines[i]);
        if (height !== undefined) lineHeights.push(height);
      }
      return {
        pageNumber: page.pageNumber,
        lines,
        lineHeights,
      };
    })
    .filter((page) => page.lines.length > 0);
}

interface FlatLine {
  readonly line: string;
  readonly page: number;
  /** Rendered max font height for this line, when the source carried it. */
  readonly height?: number;
}

function flatten(pages: readonly PageText[]): FlatLine[] {
  const out: FlatLine[] = [];
  for (const page of pages) {
    const heights = page.lineHeights;
    for (let i = 0; i < page.lines.length; i++) {
      out.push({
        line: page.lines[i],
        page: page.pageNumber,
        height: heights?.[i],
      });
    }
  }
  return out;
}

const CONNECTOR_WORDS = new Set([
  'a',
  'an',
  'and',
  'as',
  'at',
  'by',
  'for',
  'from',
  'in',
  'of',
  'on',
  'or',
  'the',
  'to',
  'with',
]);

function normalizeToken(token: string): string {
  return token.replace(/^[^A-Za-z0-9]+|[^A-Za-z0-9]+$/g, '');
}

function isHeadingCase(line: string): boolean {
  const tokens = line
    .split(/\s+/)
    .map((t) => normalizeToken(t))
    .filter((t) => t.length > 0);
  if (tokens.length === 0) return false;
  let hasCapitalizedContent = false;
  for (const token of tokens) {
    const lower = token.toLowerCase();
    if (CONNECTOR_WORDS.has(lower)) {
      continue;
    }
    if (/^\d+$/.test(token)) {
      hasCapitalizedContent = true;
      continue;
    }
    if (/^[A-Z][A-Za-z0-9'/-]*$/.test(token)) {
      hasCapitalizedContent = true;
      continue;
    }
    return false;
  }
  return hasCapitalizedContent;
}

/** Re-flow wrapped body lines into paragraph-separated prose. */
function joinParagraphs(lines: readonly string[]): string {
  const paragraphs: string[] = [];
  let current: string[] = [];
  for (const raw of lines) {
    const line = raw.trim();
    if (line.length === 0) {
      if (current.length > 0) {
        paragraphs.push(current.join(' '));
        current = [];
      }
      continue;
    }
    current.push(line);
  }
  if (current.length > 0) {
    paragraphs.push(current.join(' '));
  }
  return paragraphs.join('\n\n').trim();
}

function slug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[’']/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

// ---------------------------------------------------------------------------
// Heading-hierarchy path (real SRD extraction with per-line font heights)
// ---------------------------------------------------------------------------

/**
 * Font-height tier bands (PDF user-space points). SRD 5.1 core-rules headings
 * render in a single heading font (`g_d0_f2`) at chapter h≈25.9, subsection
 * h≈18.0, sub-subsection h≈13.9, leaf h≈12.0, and — in the gray callout boxes
 * (Hiding, Combat Step by Step, Interacting with Objects Around You, Contests
 * in Combat) — a sidebar size h≈10.8. Body prose renders at h≈9.8 and sidebar
 * body at h≈8.9, so `SIDEBAR_MIN_H` sits in the gap above both. Capturing the
 * h≈10.8 box tier is load-bearing: without it the box heading is treated as
 * body and its whole rule (e.g. the Hiding / Stealth rules) is swallowed into
 * the preceding record's body (the corruption that buried Hiding under the
 * Dexterity "Initiative" sidebar). A line below `SIDEBAR_MIN_H` is body.
 */
const SIDEBAR_MIN_H = 10.3;
const LEAF_MIN_H = 11.5;
const SUBSUB_MIN_H = 13;
const SUB_MIN_H = 16;
const CHAPTER_MIN_H = 20;

/**
 * Heading tier for a line height. 1 = subsection, 2 = sub-subsection, 3 = leaf,
 * 4 = sidebar/callout box (all rule-emitting); 0 = chapter (a structural
 * wrapper, never emitted but kept as an ancestor); -1 = body prose. Larger
 * height ⇒ shallower tier. The h≈10.8 sidebar tier is the deepest, so a box
 * heading is always popped from the ancestor stack by any following real
 * heading and never parents main-flow content.
 */
function headingTier(height: number | undefined): number {
  if (height === undefined) return -1;
  if (height >= CHAPTER_MIN_H) return 0;
  if (height >= SUB_MIN_H) return 1;
  if (height >= SUBSUB_MIN_H) return 2;
  if (height >= LEAF_MIN_H) return 3;
  if (height >= SIDEBAR_MIN_H) return 4;
  return -1;
}

function endsWithConnector(text: string): boolean {
  const tokens = text.trim().split(/\s+/);
  const last = normalizeToken(tokens[tokens.length - 1] ?? '').toLowerCase();
  return CONNECTOR_WORDS.has(last) || text.trim().endsWith('&');
}

interface TieredLine extends FlatLine {
  readonly tier: number;
}

/**
 * Merge a heading that wraps across two visual rows back into one line. SRD 5.1
 * subsection (h=18) and sub-subsection (h=13.9) titles whose text is too wide
 * for the narrow column wrap onto a second row ("Advantage and" / "Disadvantage",
 * "Damage Resistance and" / "Vulnerability"); the extractor only merges the
 * largest chapter-title tier (h≥20), so these arrive as two same-tier heading
 * lines. A wrap is recognized when the first row ends with a connector word
 * (and / or / to / of …) — sibling headings ("Short Rest" then "Long Rest")
 * never do, so they are left as separate rules.
 */
function mergeWrappedHeadings(flat: readonly FlatLine[]): TieredLine[] {
  const out: TieredLine[] = [];
  let i = 0;
  while (i < flat.length) {
    const cur = flat[i];
    const tier = headingTier(cur.height);
    if (tier >= 0 && endsWithConnector(cur.line)) {
      // Greedily absorb following same-tier heading rows until one does not
      // continue the wrap (does not end with a connector).
      let text = cur.line.trim();
      let j = i + 1;
      while (j < flat.length && headingTier(flat[j].height) === tier) {
        text = `${text} ${flat[j].line.trim()}`;
        if (endsWithConnector(flat[j].line)) {
          j++;
          continue;
        }
        j++;
        break;
      }
      if (j > i + 1) {
        out.push({ line: text, page: cur.page, height: cur.height, tier });
        i = j;
        continue;
      }
    }
    out.push({ line: cur.line, page: cur.page, height: cur.height, tier });
    i++;
  }
  return out;
}

interface HeadingEntry {
  readonly name: string;
  readonly tier: number;
  /** Ancestor heading names, outermost first. */
  readonly ancestors: readonly string[];
  readonly bodyLines: readonly string[];
  readonly page: number;
}

/**
 * True when the first prose of a heading's body is a bullet item — the
 * signature of the SRD "Skills" per-ability skill captions (the h=12
 * "Strength" → "• Athletics", "Charisma" → "• Deception …" list under Ability
 * Checks), which are list scaffolding rather than adjudication rules and also
 * collide by name with the real "Using Each Ability" sections (h=13.9). Real
 * core rules always open with prose, so a leading bullet is a reliable
 * exclusion.
 */
function bodyLeadsWithBullet(bodyLines: readonly string[]): boolean {
  for (const raw of bodyLines) {
    const line = raw.trim();
    if (line.length === 0) continue;
    return /^[•*]\s/.test(line) || /^-\s/.test(line);
  }
  return false;
}

/**
 * Leaf (h=12) heading titles whose body the importer reconstructs as a `table`
 * record (parseTables owns the same slices), so they must not also be emitted
 * as prose `rule` records: the core-rules captions (the Ability Scores and
 * Modifiers score table, the Typical Difficulty Classes DC table, the Travel
 * Pace table, and the creature Size Categories table) and the Beyond-1st-Level
 * chapter captions (Character Advancement, Multiclassing Prerequisites /
 * Proficiencies, Standard / Exotic Languages, and the two-line "Multiclass
 * Spellcaster:" / "Spell Slots per Spell Level" caption; eshyra-0m9.18 — the
 * caption renders as two consecutive h=12 lines that do not merge because the
 * first does not end with a connector word, so both lines are excluded). Gated
 * to the leaf tier so the same-named "Ability Scores and Modifiers" h=18
 * subsection (a real prose rule) is kept.
 */
const TABLE_CAPTION_LEAF_TITLES = new Set([
  'Ability Scores and Modifiers',
  'Typical Difficulty Classes',
  'Travel Pace',
  'Size Categories',
  'Character Advancement',
  'Multiclassing Prerequisites',
  'Multiclassing Proficiencies',
  'Multiclass Spellcaster:',
  'Spell Slots per Spell Level',
  'Standard Languages',
  'Exotic Languages',
  // Gamemastering Traps section (eshyra-0m9.20): the two h≈12 trap reference
  // table captions. The `table` kind owns these records; the `rule` kind must
  // not also emit them as prose rules.
  'Trap Save DCs and Attack Bonuses',
  'Damage Severity by Level',
  // Monsters-chapter stat-block rules (eshyra-0m9.22): the chapter's three
  // remaining h≈12 reference-table captions ("Size Categories" is shared with
  // the core-rules Combat chapter and already listed above). The `table` kind
  // owns these records.
  'Hit Dice by Size',
  'Proficiency Bonus by Challenge Rating',
  'Experience Points by Challenge Rating',
  // Equipment chapter (eshyra-4a7.10.1): these h≈12 captions are structured
  // table records. The surrounding h≈13.9/h≈18 prose headings remain rules.
  'Donning and Doffing Armor',
  'Weapons',
]);

const INLINE_PROSE_RESUMPTION_TABLE_CAPTIONS = new Set(['Weapons']);

function isExcludedHeading(
  name: string,
  tier: number,
  bodyLines: readonly string[],
): boolean {
  const trimmed = name.trim();
  if (/^Variant\b/i.test(trimmed)) return true;
  if (isTableCaptionHeading(name, tier)) return true;
  if (bodyLeadsWithBullet(bodyLines)) return true;
  return false;
}

function isTableCaptionHeading(name: string, tier: number): boolean {
  return tier === 3 && TABLE_CAPTION_LEAF_TITLES.has(name.trim());
}

/**
 * Minimum font height for a line inside an excluded table caption's body to
 * count as SECTION PROSE rather than a table row. SRD 5.1 table rows and
 * column headers render at h≈8.9 while main-flow body prose renders at h≈9.8,
 * so the cut sits in the gap. Several captioned tables are printed in the
 * MIDDLE of their section's prose — the section text resumes below the table
 * (e.g. the Hit Points monster section's Constitution-modifier paragraph after
 * the Hit Dice by Size table, the Ability Checks intro after Typical
 * Difficulty Classes, the travel rules after Travel Pace). Excluding the
 * caption must drop only the table rows the `table` kind owns, not swallow
 * that resuming prose (eshyra-0m9.22).
 */
const BODY_PROSE_MIN_H = 9.3;

function collectHeadingEntries(
  merged: readonly TieredLine[],
  chapterName?: string,
): HeadingEntry[] {
  const entries: HeadingEntry[] = [];
  // Section slices exclude their own chapter title line (it is the slice's
  // start anchor), so a chapter parsed with `chapterIntro` restores that title
  // as a synthetic tier-0 ancestor (eshyra-0m9.22). Without it, a top-tier
  // heading that collides with a key another slice already owns has no
  // ancestor to qualify with and would degrade to a numeric suffix — e.g. the
  // Monsters chapter's "Alignment" vs the Beyond-1st-Level `alignment` key
  // must become `monsters-alignment`, not `alignment-2`. Tier 0 is only ever
  // popped by another chapter heading, so the seed parents the whole slice.
  const stack: { name: string; tier: number }[] =
    chapterName === undefined ? [] : [{ name: chapterName, tier: 0 }];
  for (let i = 0; i < merged.length; i++) {
    const cur = merged[i];
    if (cur.tier < 0) continue; // body prose
    // Pop ancestors at this tier or deeper so the stack holds strict parents.
    while (stack.length > 0 && stack[stack.length - 1].tier >= cur.tier) {
      stack.pop();
    }
    if (cur.tier === 0) {
      // Chapter wrapper: keep as ancestor context, never emit.
      stack.push({ name: cur.line.trim(), tier: cur.tier });
      continue;
    }
    const body: TieredLine[] = [];
    for (let j = i + 1; j < merged.length && merged[j].tier < 0; j++) {
      body.push(merged[j]);
    }
    const bodyLines = body.map((b) => b.line);
    const ancestors = stack.map((s) => s.name);
    stack.push({ name: cur.line.trim(), tier: cur.tier });
    if (isExcludedHeading(cur.line, cur.tier, bodyLines)) {
      // An excluded TABLE CAPTION owns only its table rows (h≈8.9, dropped
      // here; the `table` kind reconstructs them). Any prose-height lines
      // after the rows are the enclosing section's text resuming below the
      // printed table, so they re-flow into the most recent emitted rule as a
      // fresh paragraph instead of being swallowed with the caption
      // (eshyra-0m9.22). Other exclusion classes (Variant boxes, bullet
      // scaffolding) keep their drop-everything behavior.
      if (isTableCaptionHeading(cur.line, cur.tier) && entries.length > 0) {
        const resumingProse = body
          .filter((b) => (b.height ?? 0) >= BODY_PROSE_MIN_H)
          .map((b) => b.line);
        if (resumingProse.length > 0) {
          const prev = entries[entries.length - 1];
          entries[entries.length - 1] = {
            ...prev,
            bodyLines: [
              ...prev.bodyLines,
              ...(INLINE_PROSE_RESUMPTION_TABLE_CAPTIONS.has(cur.line.trim())
                ? []
                : ['']),
              ...resumingProse,
            ],
          };
        }
      }
      continue;
    }
    entries.push({
      name: cur.line.trim(),
      tier: cur.tier,
      ancestors,
      bodyLines,
      page: cur.page,
    });
  }
  return entries;
}

/**
 * Assign a unique record key slug per entry. The leaf title slug is used when
 * it is unique across the parsed set; colliding leaves (cross-chapter repeats
 * and per-ability sidebars) gain just enough nearest-ancestor titles, prepended,
 * to disambiguate — and, as a final guard against an exact path repeat, a
 * numeric suffix.
 *
 * `reserved` carries key slugs already emitted by an EARLIER `parseRules` call
 * over a sibling slice (loreweaver-3hp): the SRD 5.1 Spellcasting-rules chapter
 * is sliced and parsed separately from the core-rules chapters, but it repeats
 * a handful of titles those chapters already own ("Range" and "Attack Rolls"
 * under Making an Attack, "Saving Throws", "Reactions" under The Order of
 * Combat). A bare-slug emission would collide cross-slice and produce duplicate
 * `rule:` keys in the pack. Treating a reserved slug as an occupied slot forces
 * the colliding spellcasting entry to parent-qualify (e.g. `range` →
 * `casting-a-spell-range`) exactly as an intra-slice collision would, leaving
 * the already-reviewed core-rules keys untouched.
 */
function assignKeySlugs(
  entries: readonly HeadingEntry[],
  reserved: ReadonlySet<string>,
): string[] {
  const depths = entries.map(() => 0);
  const keyAt = (idx: number): string => {
    const e = entries[idx];
    const depth = depths[idx];
    if (depth === 0) return slug(e.name);
    const prefix = e.ancestors.slice(Math.max(0, e.ancestors.length - depth));
    return slug([...prefix, e.name].join(' '));
  };
  // Increase qualification depth on any colliding group until keys are unique
  // or every member has consumed its full ancestor path. A key that matches a
  // reserved sibling-slice slug counts as a collision even when it is unique
  // within this slice, so it qualifies away from the reserved key.
  for (let guard = 0; guard < 64; guard++) {
    const byKey = new Map<string, number[]>();
    for (let i = 0; i < entries.length; i++) {
      const k = keyAt(i);
      const bucket = byKey.get(k);
      if (bucket === undefined) byKey.set(k, [i]);
      else bucket.push(i);
    }
    let changed = false;
    for (const [k, idxs] of byKey.entries()) {
      const collides = idxs.length > 1 || reserved.has(k);
      if (!collides) continue;
      for (const i of idxs) {
        if (depths[i] < entries[i].ancestors.length) {
          depths[i]++;
          changed = true;
        }
      }
    }
    if (!changed) break;
  }
  // Final exact-duplicate guard: append a numeric suffix to any key that is
  // still shared after ancestors are exhausted (degenerate, shouldn't occur).
  // Reserved keys seed the used-map so a slug that could not be qualified away
  // from a reserved sibling-slice key still gains a suffix rather than colliding.
  const used = new Map<string, number>();
  for (const k of reserved) used.set(k, 1);
  return entries.map((_, i) => {
    let k = keyAt(i);
    const seen = used.get(k);
    if (seen !== undefined) {
      const next = seen + 1;
      used.set(k, next);
      k = `${k}-${next}`;
    }
    used.set(k, used.get(k) ?? 1);
    return k;
  });
}

/**
 * Build the chapter-intro rule from the body prose that precedes the FIRST
 * heading-tier line of the slice. Section slices exclude their own chapter
 * title line (it is the slice's start anchor), so a chapter whose opening
 * prose carries real rules — e.g. "Beyond 1st Level", whose intro IS the SRD's
 * character-advancement rules (gaining levels, hit-point increases, the
 * ability-score cap; eshyra-0m9.18) — would otherwise silently drop that prose:
 * `collectHeadingEntries` only collects body lines that FOLLOW a heading.
 * Callers that want the intro pass `chapterIntro` with the chapter's name and
 * a fixed key slug. Returns undefined when the slice opens directly with a
 * heading or the leading prose is empty.
 */
function buildChapterIntroRule(
  merged: readonly TieredLine[],
  chapterIntro: ChapterIntroOptions,
): RuleExtraction | undefined {
  const introLines: string[] = [];
  for (const line of merged) {
    if (line.tier >= 0) break;
    introLines.push(line.line);
  }
  const text = joinParagraphs(introLines);
  if (text.length === 0) return undefined;
  return {
    name: chapterIntro.name,
    keySlug: chapterIntro.keySlug,
    text,
    sourcePage: merged[0].page,
  };
}

function parseRulesByHeadings(
  flat: readonly FlatLine[],
  reserved: ReadonlySet<string>,
  chapterIntro: ChapterIntroOptions | undefined,
): RuleExtraction[] {
  const merged = mergeWrappedHeadings(flat);
  const entries = collectHeadingEntries(merged, chapterIntro?.name);
  const intro =
    chapterIntro === undefined
      ? undefined
      : buildChapterIntroRule(merged, chapterIntro);
  if (entries.length === 0) return intro === undefined ? [] : [intro];
  // The intro's fixed slug occupies its slot up front so a same-named heading
  // inside the chapter parent-qualifies away from it instead of colliding.
  const reservedWithIntro =
    intro === undefined || chapterIntro === undefined
      ? reserved
      : new Set<string>([...reserved, chapterIntro.keySlug]);
  const keySlugs = assignKeySlugs(entries, reservedWithIntro);
  const out: RuleExtraction[] = entries.map((entry, i) => {
    const text = joinParagraphs(entry.bodyLines);
    return {
      name: entry.name,
      keySlug: keySlugs[i],
      text: text.length > 0 ? text : entry.name,
      sourcePage: entry.page,
    };
  });
  if (intro !== undefined) out.push(intro);
  out.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  return out;
}

// ---------------------------------------------------------------------------
// Legacy text-heuristic path (fixture PDFs without per-line font heights)
// ---------------------------------------------------------------------------

const NON_RULE_HEADINGS = new Set([
  'Using Ability Scores',
  'Adventuring',
  'Combat',
  'Spellcasting',
  'Equipment',
  'Conditions',
  'Appendix A: Conditions',
]);

function isRuleHeading(line: string): boolean {
  const trimmed = line.trim();
  if (trimmed.length === 0 || trimmed.length > 80) return false;
  if (/^[*-]\s/.test(trimmed)) return false;
  if (/[.:;!?]$/.test(trimmed)) return false;
  if (NON_RULE_HEADINGS.has(trimmed)) return false;
  return isHeadingCase(trimmed);
}

function nextNonBlankLine(
  flat: readonly FlatLine[],
  idx: number,
): string | undefined {
  for (let i = idx + 1; i < flat.length; i++) {
    const candidate = flat[i].line.trim();
    if (candidate.length > 0) return candidate;
  }
  return undefined;
}

interface RuleEntry {
  readonly nameIdx: number;
  readonly name: string;
}

function parseRulesByHeuristic(flat: readonly FlatLine[]): RuleExtraction[] {
  const entries: RuleEntry[] = [];
  for (let i = 0; i < flat.length; i++) {
    const { line } = flat[i];
    const trimmed = line.trim();
    if (trimmed.length === 0 || isRuleHeading(trimmed) === false) continue;

    const previous = flat[i - 1]?.line.trim();
    const atSliceStart = i === 0;
    const atPageStart = i > 0 && flat[i - 1]?.page !== flat[i].page;
    const afterBlank = previous === undefined || previous.length === 0;
    if (atSliceStart === false && atPageStart === false && afterBlank === false)
      continue;

    // If the next non-blank line is also a heading, treat this as a chapter/
    // section wrapper rather than an extractable rule body.
    const next = nextNonBlankLine(flat, i);
    if (next === undefined) continue;
    if (isRuleHeading(next)) continue;

    entries.push({ nameIdx: i, name: trimmed });
  }

  if (entries.length === 0) return [];

  const out: RuleExtraction[] = [];
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    const bodyStart = entry.nameIdx + 1;
    const bodyEnd = entries[i + 1]?.nameIdx ?? flat.length;
    const bodyLines = flat.slice(bodyStart, bodyEnd).map((f) => f.line);
    const text = joinParagraphs(bodyLines);
    out.push({
      name: entry.name,
      text: text.length > 0 ? text : entry.name,
      sourcePage: flat[entry.nameIdx].page,
    });
  }

  out.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  return out;
}

/**
 * Chapter-intro emission request for `parseRules` (eshyra-0m9.18). When set,
 * the heading-hierarchy path emits the body prose that precedes the slice's
 * first heading as a rule named `name` with the fixed key slug `keySlug`. See
 * `buildChapterIntroRule`. `name` additionally seeds the heading stack as a
 * synthetic tier-0 chapter ancestor (eshyra-0m9.22), so a top-tier heading
 * that collides with a reserved sibling-slice key can parent-qualify with the
 * chapter title instead of degrading to a numeric suffix. The legacy fixture
 * heuristic ignores it (it has no font tiers and treats heading-cased lines as
 * boundaries instead).
 */
export interface ChapterIntroOptions {
  readonly name: string;
  readonly keySlug: string;
}

/**
 * Parse a core-rules-style slice into `rule` records.
 *
 * `reservedKeySlugs` (loreweaver-3hp) lets a second slice be parsed against the
 * key slugs an earlier slice already emitted, so cross-slice title repeats
 * disambiguate by parent-qualified key instead of producing duplicate `rule:`
 * keys. The SRD 5.1 importer parses the core-rules chapters first, then parses
 * the separate Spellcasting-rules chapter with those core keys reserved. Only
 * the heading-hierarchy path honors it; the legacy fixture heuristic does not
 * assign key slugs.
 *
 * `chapterIntro` (eshyra-0m9.18) requests that the prose BEFORE the slice's
 * first heading be emitted as a named rule — used for the "Beyond 1st Level"
 * chapter, whose intro paragraphs are the SRD's character-advancement rules.
 * Heading-hierarchy path only.
 */
export function parseRules(
  pages: readonly PageText[],
  reservedKeySlugs: ReadonlySet<string> = new Set(),
  chapterIntro?: ChapterIntroOptions,
): RuleExtraction[] {
  const flat = flatten(pages);
  if (flat.length === 0) return [];
  // Use the font-height hierarchy only when the slice carries the SRD's
  // genuine multi-tier font structure: at least one line at a real heading
  // height (≥ LEAF_MIN_H) AND more than one distinct height present.
  // Uniform-font fixture PDFs render every line at a single body size, so they
  // fail the distinct-height test and fall back to the text heuristic the
  // fixture unit/pipeline tests assert against — even though that single size
  // may sit inside a heading band.
  const definedHeights = flat
    .map((f) => f.height)
    .filter((h): h is number => h !== undefined);
  const distinctHeights = new Set(definedHeights);
  const hasHeadingTiers =
    distinctHeights.size > 1 && definedHeights.some((h) => h >= LEAF_MIN_H);
  return hasHeadingTiers
    ? parseRulesByHeadings(flat, reservedKeySlugs, chapterIntro)
    : parseRulesByHeuristic(flat);
}
