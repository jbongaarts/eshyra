/**
 * Subclass parser for the D&D 5e SRD 5.1 importer.
 *
 * Input is a slice of `PageText[]` already narrowed to the SRD's "Classes"
 * chapter (the orchestrator in `index.ts` reuses the same `classes` slice it
 * feeds `parseClasses`, since each subclass is described inside its parent
 * class's section). Output is a `SubclassExtraction[]`, sorted by name, with one
 * entry per SRD 5.1 subclass.
 *
 * Scope (ADR 0009 / loreweaver-0m9.5.17): **subclasses only** (Champion, Life
 * domain, School of Evocation, …). Base classes are `class` records parsed by
 * `parseClasses` (loreweaver-0m9.5.2); class features are a separate `feature`
 * kind (loreweaver-0m9.5.18) and are NOT extracted here — subclass-granted
 * features are parsed into separate feature records by `parseFeatures`; this
 * parser only emits the subclass's own prose description.
 *
 * Boundary detection mirrors the conservative known-name approach used by the
 * ancestry / condition / hazard / action parsers: a line is a subclass heading
 * only when it exactly equals one of the known SRD 5.1 subclass names. The same
 * file also knows the 12 base-class names (the subclass parents), which serve as
 * additional description boundaries so the next class's intro prose cannot bleed
 * into the previous subclass's body. Per ADR 0007 only these structural anchors
 * (names + the subclass→parent relationship that is a fact of the SRD's
 * organization) are hard-coded; every field VALUE (`description`) is extracted
 * from the source, never authored from model knowledge.
 *
 * Whitespace normalization: like the base-class parser, every line is collapsed
 * to single spaces before matching (`normalizeLine`). `extract.ts` joins pdfjs
 * text items with no separator, so a column-spaced multi-word heading extracts
 * with runs of internal whitespace ("Life   Domain", "School\tof\tEvocation").
 * Normalizing first lets the single-spaced known names match the real extracted
 * shape rather than only pre-normalized fixtures.
 *
 * Parent linkage: each subclass carries its parent base-class NAME, which
 * `emit.ts` keys to the parent `class:<slug>` record under `data.parentClass`
 * (ADR 0009 data-side linkage; never `overrides`). This mirrors how
 * `parseAncestries` carries `subraceOf` as a name that emit keys.
 *
 * Fail-closed: a confirmed subclass (a known heading found in the slice) whose
 * body re-flows to an empty string is a malformed entry — the subclass
 * kindSchema requires a non-empty `description` — so the parser throws with the
 * subclass name + page rather than emit a record that can't satisfy the schema.
 */

import type { PageText, SubclassExtraction } from './types.js';

interface KnownSubclass {
  /** Exact heading text as printed in the SRD (also the record name). */
  readonly name: string;
  /** Parent base-class name. */
  readonly parent: string;
  /**
   * Leaf-tier sub-subsection headings whose body prose belongs on this subclass
   * as named sections — not granted features and not spell-table headings.
   * Only headings listed here are treated as sections; any other leaf heading
   * still bounds the subclass body (fail-closed).
   */
  readonly namedSections?: readonly string[];
}

// The 12 SRD 5.1 subclasses (one per base class) and their parent classes.
// Names are kept verbatim from the source headings; the parent relationship is
// a structural fact of the SRD's organization (the subclass is printed inside
// the parent class's section). Used as exact full-line heading anchors.
export const KNOWN_SUBCLASSES: readonly KnownSubclass[] = [
  { name: 'Path of the Berserker', parent: 'Barbarian' },
  { name: 'College of Lore', parent: 'Bard' },
  { name: 'Life Domain', parent: 'Cleric' },
  { name: 'Circle of the Land', parent: 'Druid' },
  { name: 'Champion', parent: 'Fighter' },
  { name: 'Way of the Open Hand', parent: 'Monk' },
  {
    name: 'Oath of Devotion',
    parent: 'Paladin',
    namedSections: ['Tenets of Devotion'],
  },
  { name: 'Hunter', parent: 'Ranger' },
  { name: 'Thief', parent: 'Rogue' },
  { name: 'Draconic Bloodline', parent: 'Sorcerer' },
  { name: 'The Fiend', parent: 'Warlock' },
  { name: 'School of Evocation', parent: 'Wizard' },
];

const SUBCLASS_BY_NAME = new Map(KNOWN_SUBCLASSES.map((s) => [s.name, s]));
// The 12 base-class names. Used only as description boundaries (the start of
// the next class's section ends the previous subclass's body).
export const PARENT_CLASS_NAMES = new Set(
  KNOWN_SUBCLASSES.map((s) => s.parent),
);

// Rendered font-height band (PDF user-space points) of a gray callout-box
// heading in the SRD 5.1 Classes chapter. These boxes ("Your Spellbook",
// "Your Pact Boon", "Breaking Your Oath", "Sacred Plants and Wood", "Druids
// and the Gods") are generic class/DM procedure sidebars, not subclass or
// feature content; each renders its title at h≈10.8 and its body at h≈8.9,
// sitting in the gap below the leaf feature-heading tier (h≈12.0, which
// includes in-feature option headings like the Fighter's "Archery"/"Defense"
// Fighting Style choices) and above main-flow body prose (h≈9.8). Keying on
// this band lets `parseSubclasses` / `parseFeatures` stop a subclass or
// feature body at the box without special-casing any heading text or page
// (ADR 0007). Mirrors the tier bands `parseRules` uses. The bounds are
// inclusive-exclusive: [SIDEBAR_MIN_H, LEAF_MIN_H). Fixture PDFs render at a
// uniform font (no `lineHeights`), so `height` is undefined and no fixture
// body is bounded here — only the real extraction is affected (loreweaver-6fw).
const CALLOUT_BOX_MIN_H = 10.3;
const CALLOUT_BOX_MAX_H = 11.5;
// A subclass-granted feature heading renders at the leaf tier (h≈12.0 in the
// real SRD, e.g. Champion's "Improved Critical", Circle of the Land's "Bonus
// Cantrip"); the subclass-group / class-features section titles above it render
// higher still (h≈18). Any heading at or above the callout-box ceiling that is
// not itself a class or subclass heading therefore bounds the preceding
// subclass's OVERVIEW prose, so the feature bodies — emitted as their own
// `feature` records by `parseFeatures` — do not bleed into the subclass
// description (eshyra-4a7.2). Using the callout-box ceiling keeps the tier band
// contiguous: body < CALLOUT_BOX_MIN_H ≤ callout box < CALLOUT_BOX_MAX_H ≤
// feature/section heading. Gated on `tiersPresent`, like the callout-box bound.
const FEATURE_LEAF_MIN_H = CALLOUT_BOX_MAX_H;
// Base-class chapter headings render at h≈25.9 in the real SRD, above every
// nested class/subclass heading. Exact class-name text below this tier can be a
// table cell (notably the "Paladin" header in the Oath of Devotion spells
// table), so it must not move grantor context or bound a subclass body.
const CLASS_CHAPTER_MIN_H = 20;

/**
 * Is `height` a Classes-chapter gray callout-box heading (a generic class/DM
 * procedure sidebar), as opposed to a feature/subclass heading or body prose?
 * Undefined heights (uniform-font fixtures) are never callout boxes.
 *
 * Only meaningful once `hasHeadingTiers` confirms the slice carries the SRD's
 * real multi-tier font structure — a uniform-font fixture renders every line at
 * one body size that may itself fall inside this band, so callers must gate on
 * `hasHeadingTiers` before treating a band hit as a box.
 */
export function isCalloutBoxHeading(height: number | undefined): boolean {
  return (
    height !== undefined &&
    height >= CALLOUT_BOX_MIN_H &&
    height < CALLOUT_BOX_MAX_H
  );
}

// A class-grantor feature's own printed 12pt subheadings ("Cantrips", "Spell
// Slots", "Spellcasting Ability", …, all measured at h≈12.0) sit in the same
// band as a subclass-granted feature heading (FEATURE_LEAF_MIN_H) but below
// the 13.9 sub-subsection/class-feature-heading tier a repeat of the owning
// "Spellcasting"/"Pact Magic" heading (or the NEXT class feature, e.g. Divine
// Domain) would render at. Capping below that tier is what lets
// `parseFeatures` tell "one more subheading inside this body" apart from "the
// body has ended" using height alone, with no heading-text allowlist
// (eshyra-o9bd.19.2.2.4).
const FEATURE_HEADING_MIN_H = 13.5;

/**
 * Is `height` a class-grantor feature's own printed subheading tier (h≈12.0),
 * as opposed to body prose, a callout box, or a sub-subsection/feature
 * heading? Only meaningful once `hasHeadingTiers` confirms the slice carries
 * the SRD's real multi-tier font structure, like `isCalloutBoxHeading`.
 */
export function isFeatureSubheading(height: number | undefined): boolean {
  return (
    height !== undefined &&
    height >= FEATURE_LEAF_MIN_H &&
    height < FEATURE_HEADING_MIN_H
  );
}

/**
 * Does this slice carry the SRD's genuine multi-tier font structure — more than
 * one distinct line height AND at least one real heading-tier line (a
 * feature/subclass heading at h ≥ `CALLOUT_BOX_MAX_H`)? Only then is a line in
 * the callout band a real gray sidebar box rather than ordinary body prose.
 * Uniform-font fixture PDFs render every line at a single body size (often
 * inside the callout band itself), so they fail this test and no fixture body
 * is bounded as a box. Mirrors the path gate in `parseRules` (loreweaver-6fw).
 */
export function hasHeadingTiers(
  heights: readonly (number | undefined)[],
): boolean {
  const defined = heights.filter((h): h is number => h !== undefined);
  return (
    new Set(defined).size > 1 && defined.some((h) => h >= CALLOUT_BOX_MAX_H)
  );
}

/**
 * Is this exact class-name line a base-class chapter heading?
 *
 * Real multi-tier extraction requires the chapter font tier. Uniform/no-height
 * fixtures retain the historical exact-text fallback.
 */
export function isParentClassHeading(
  line: string,
  height: number | undefined,
  tiersPresent: boolean,
): boolean {
  if (!PARENT_CLASS_NAMES.has(line)) return false;
  return (
    !tiersPresent || (height !== undefined && height >= CLASS_CHAPTER_MIN_H)
  );
}

interface FlatLine {
  readonly line: string;
  readonly page: number;
  /** Rendered max font height (PDF points), when the source carried it. */
  readonly height?: number;
}

/** Collapse internal whitespace runs to single spaces and trim. */
function normalizeLine(line: string): string {
  return line.replace(/\s+/g, ' ').trim();
}

function flatten(pages: readonly PageText[]): readonly FlatLine[] {
  const out: FlatLine[] = [];
  for (const page of pages) {
    for (let i = 0; i < page.lines.length; i++) {
      out.push({
        line: normalizeLine(page.lines[i]),
        page: page.pageNumber,
        height: page.lineHeights?.[i],
      });
    }
  }
  return out;
}

/** Re-flow wrapped lines into paragraph-separated prose (blank line = break). */
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

/**
 * Parse subclass entries from the narrowed Classes-chapter `PageText[]`.
 * Returns a `SubclassExtraction[]` sorted by name.
 */
export function parseSubclasses(
  pages: readonly PageText[],
): SubclassExtraction[] {
  const flat = flatten(pages);
  if (flat.length === 0) return [];

  // Boundary lines: any base-class name (which also moves a "current parent"
  // cursor) and any subclass heading whose known parent matches that cursor.
  // The parent guard disambiguates stray subclass-name occurrences that fall
  // inside the wrong chapter — e.g. the Barbarian level-20 capstone row
  // "Primal Champion" column-wraps in the SRD 5.1 PDF so that "Champion"
  // extracts on its own line, which has the same exact text as the Fighter
  // subclass Champion's heading. Without the guard, the parser emits a
  // duplicate `subclass:champion` record and the pack writer rejects it
  // (loreweaver-9bu).
  //
  // The slice begins AFTER the "Barbarian" chapter heading (consumed by
  // sectionAnchors.classes as the start anchor), so the implicit parent at
  // the slice's leading content is Barbarian. Test fixtures that include the
  // parent name explicitly as their first line override this default before
  // any subclass-name line is reached.
  // Only honor callout-box font heights when the slice has the SRD's genuine
  // multi-tier structure; uniform-font fixtures render body lines inside the
  // callout band and must not be bounded as boxes (loreweaver-6fw).
  const tiersPresent = hasHeadingTiers(flat.map((f) => f.height));

  const boundaries: number[] = [];
  let currentParent: string = 'Barbarian';
  // The active subclass while collecting its body; used to identify named prose
  // sections (leaf headings that extend the subclass rather than bounding it).
  let currentSubclass: KnownSubclass | undefined;
  for (let i = 0; i < flat.length; i++) {
    // `flat[i].line` is already whitespace-normalized (see `flatten`).
    const line = flat[i].line;
    if (isParentClassHeading(line, flat[i].height, tiersPresent)) {
      currentParent = line;
      currentSubclass = undefined;
      boundaries.push(i);
      continue;
    }
    // A gray callout-box heading (e.g. Wizard "Your Spellbook") is a generic
    // class/DM sidebar that follows the last subclass feature, not subclass
    // content. It bounds the preceding subclass body so the box prose does not
    // bleed in; the box index is not itself a subclass, so the emit loop skips
    // it (`SUBCLASS_BY_NAME.get` is undefined). It does not move the parent
    // cursor. (loreweaver-6fw)
    if (tiersPresent && isCalloutBoxHeading(flat[i].height)) {
      currentSubclass = undefined;
      boundaries.push(i);
      continue;
    }
    const sc = SUBCLASS_BY_NAME.get(line);
    if (sc !== undefined && sc.parent === currentParent) {
      currentSubclass = sc;
      boundaries.push(i);
      continue;
    }
    // A leaf/section heading (font tier at or above the callout-box ceiling)
    // that is not itself a class or subclass heading is either:
    //   (a) a named prose section declared on the current subclass (e.g.
    //       "Tenets of Devotion" on Oath of Devotion — eshyra-citg): do NOT
    //       create a boundary; the heading and its body prose belong on the
    //       subclass and are collected as a named section in the body loop; or
    //   (b) a subclass FEATURE heading (h≈12.0) or a structural group/section
    //       title: creates a boundary that ends the preceding subclass's body
    //       so feature prose stays out of the subclass description (eshyra-4a7.2).
    // Gated on tiersPresent: uniform-font fixtures have no tier signal and keep
    // the conservative bound-at-next-subclass fallback.
    if (
      tiersPresent &&
      flat[i].height !== undefined &&
      (flat[i].height as number) >= FEATURE_LEAF_MIN_H
    ) {
      if (currentSubclass?.namedSections?.includes(line)) {
        // Named prose section — extend the subclass body past this heading.
        continue;
      }
      currentSubclass = undefined;
      boundaries.push(i);
    }
  }

  const out: SubclassExtraction[] = [];
  for (let b = 0; b < boundaries.length; b++) {
    const idx = boundaries[b];
    const name = flat[idx].line;
    const known = SUBCLASS_BY_NAME.get(name);
    // A base-class-name boundary is not itself a subclass — skip it.
    if (known === undefined) continue;

    const bodyStart = idx + 1;
    const bodyEnd = boundaries[b + 1] ?? flat.length;
    const body = flat.slice(bodyStart, bodyEnd);

    // Split the body into the intro prose and any named sub-subsections.
    // Named sections are leaf-tier headings (h ≥ FEATURE_LEAF_MIN_H) whose
    // text appears in the subclass's `namedSections` list; they extend the body
    // rather than bounding it (eshyra-citg). Only meaningful when tiersPresent.
    const namedSectionSet = new Set(known.namedSections ?? []);
    const sectionStarts: number[] = [];
    if (tiersPresent && namedSectionSet.size > 0) {
      for (let j = 0; j < body.length; j++) {
        const fl = body[j];
        if (
          fl.height !== undefined &&
          fl.height >= FEATURE_LEAF_MIN_H &&
          namedSectionSet.has(fl.line)
        ) {
          sectionStarts.push(j);
        }
      }
    }

    // Intro: body lines before the first section heading (or the whole body).
    const introEnd = sectionStarts.length > 0 ? sectionStarts[0] : body.length;
    const description = joinParagraphs(
      body.slice(0, introEnd).map((f) => f.line),
    );

    // A confirmed subclass with no body is malformed (or a layout these anchors
    // don't yet match) — fail closed rather than emit a record that violates
    // the kindSchema's non-empty `description` requirement.
    if (description.length === 0) {
      throw new Error(
        `subclass "${name}" at page ${flat[idx].page} has no description text`,
      );
    }

    // Named sections: each section heading + its body prose until the next.
    const sections: Array<{ name: string; text: string }> = [];
    for (let s = 0; s < sectionStarts.length; s++) {
      const headingIdx = sectionStarts[s];
      const sectionName = body[headingIdx].line;
      const sectionBodyStart = headingIdx + 1;
      const sectionBodyEnd = sectionStarts[s + 1] ?? body.length;
      const text = joinParagraphs(
        body.slice(sectionBodyStart, sectionBodyEnd).map((f) => f.line),
      );
      sections.push({ name: sectionName, text });
    }

    out.push({
      name,
      parentClass: known.parent,
      description,
      ...(sections.length > 0 ? { sections } : {}),
      sourcePage: flat[idx].page,
    });
  }

  out.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  return out;
}
