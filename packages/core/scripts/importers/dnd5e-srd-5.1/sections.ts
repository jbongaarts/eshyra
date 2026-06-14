/**
 * Deterministic section slicer for the D&D 5e SRD 5.1 importer.
 *
 * Each kind parser (parseSpells, future creature parser, etc.) is responsible
 * only for its narrow input shape. The orchestrator is responsible for
 * narrowing the extracted `PageText[]` to the section that parser cares
 * about. This module provides that narrowing.
 *
 * Boundary semantics:
 * - A section starts at the first line that matches `startHeading`. The
 *   heading line itself is excluded from the returned content.
 * - A section ends at the first line after `startHeading` that matches
 *   `endHeading`. The end-heading line is excluded from the returned content.
 * - If `endHeading` is unmatched the section continues to the end of the
 *   PDF UNLESS `requireEndHeading` is true, in which case the function
 *   throws `SectionNotFoundError`. If `startHeading` is unmatched the
 *   function always throws `SectionNotFoundError` — failing closed is the
 *   whole point of this module: better to refuse to run than silently parse
 *   the wrong content.
 *
 * The default anchors target the SRD 5.1 PDF's chapter headings. They are
 * exported so callers can override them when (a) a tuned anchor proves
 * necessary once the real PDF is vendored, or (b) a different SRD version /
 * structure is imported in the future.
 */

import type { PageText } from './types.js';

export interface SectionAnchorOptions {
  /**
   * Regex that matches the chapter / section heading line that starts the
   * section. Matched against `line.trim()`; usually anchored with `^...$`.
   */
  readonly startHeading: RegExp;
  /**
   * Regex that matches the chapter / section heading line that immediately
   * follows the section. The slice ends just before this line. If undefined
   * or unmatched, behavior depends on `requireEndHeading`.
   */
  readonly endHeading?: RegExp;
  /**
   * If true and `endHeading` is set but does not match any line after
   * `startHeading`, `sliceSection` throws `SectionNotFoundError('end', ...)`
   * instead of silently slicing to EOF. Use this for sections where
   * misidentifying the boundary would let later chapters bleed into a kind
   * parser (e.g. the spell-descriptions section, where a missing "Monsters"
   * end heading would feed monster stat blocks to `parseSpells`).
   *
   * Default: false (preserves the slice-to-EOF fallback for sections that
   * legitimately run to the end of the document).
   */
  readonly requireEndHeading?: boolean;
  /**
   * When true, the slicer's start- and end-heading patterns match only at
   * line POSITIONS the extractor flagged as headings — i.e. only at
   * indices listed in `PageText.headingLineIndexes`. This is the
   * disambiguation for anchors whose text also occurs as a class-block
   * subsection at body font size — e.g. the SRD 5.1 chapter title
   * "Equipment" (h=25.9) is shadowed in every base-class chapter by a
   * body-font "Equipment" subheading; without `matchHeadings`, the slicer
   * would lock onto the first class-block occurrence instead of the actual
   * chapter. Crucially, the same string can appear in `lines` as both a
   * heading and as body prose, so the disambiguation has to be by line
   * position, not by membership of a heading-text set.
   *
   * Backward-compat fallback: if a page's `headingLineIndexes` is
   * undefined (uniform-font fixture PDFs), `matchHeadings: true` falls
   * back to line matching. Real SRD 5.1 extraction always populates
   * `headingLineIndexes`.
   *
   * Default: false (match against all lines).
   */
  readonly matchHeadings?: boolean;
}

export class SectionNotFoundError extends Error {
  constructor(
    public readonly which: 'start' | 'end',
    public readonly pattern: RegExp,
  ) {
    super(
      `${which} heading not found: no line matched ${pattern}. Check the vendored PDF, or override the anchor patterns via the \`sectionAnchors\` option on runImporter.`,
    );
    this.name = 'SectionNotFoundError';
  }
}

interface Location {
  /** 0-based index into `PageText[]`. */
  readonly pageIdx: number;
  /** 0-based index into `pages[pageIdx].lines`. */
  readonly lineIdx: number;
}

function findFirstMatch(
  pages: readonly PageText[],
  pattern: RegExp,
  startAfter: Location | undefined,
  matchHeadings: boolean,
): Location | null {
  const startPage = startAfter?.pageIdx ?? 0;
  for (let p = startPage; p < pages.length; p++) {
    const page = pages[p];
    const lines = page.lines;
    // matchHeadings restricts matching to the line POSITIONS the extractor
    // marked as headings, not just the heading TEXT. The same string can
    // legitimately appear on a page as both a heading and as body prose
    // (e.g. "Equipment" as a class-block subsection title and as a chapter
    // title) — string-membership filtering would miss that distinction and
    // accept the body occurrence. Position-based filtering does not.
    const headingIdxSet =
      matchHeadings && page.headingLineIndexes !== undefined
        ? new Set<number>(page.headingLineIndexes)
        : null;
    const startLine =
      startAfter !== undefined && p === startAfter.pageIdx
        ? startAfter.lineIdx + 1
        : 0;
    for (let l = startLine; l < lines.length; l++) {
      if (headingIdxSet !== null && !headingIdxSet.has(l)) continue;
      const trimmed = lines[l].trim();
      if (pattern.test(trimmed)) {
        return { pageIdx: p, lineIdx: l };
      }
    }
  }
  return null;
}

/**
 * Slice the section delimited by `anchors`. Throws `SectionNotFoundError` if
 * `startHeading` doesn't match; never silently returns the whole input.
 * `endHeading` may be unmatched — in that case the section runs to the end
 * of the input, UNLESS `requireEndHeading` is true, in which case the
 * unmatched end also throws `SectionNotFoundError`.
 */
export function sliceSection(
  pages: readonly PageText[],
  anchors: SectionAnchorOptions,
): readonly PageText[] {
  const matchHeadings = anchors.matchHeadings === true;
  const start = findFirstMatch(
    pages,
    anchors.startHeading,
    undefined,
    matchHeadings,
  );
  if (start === null) {
    throw new SectionNotFoundError('start', anchors.startHeading);
  }
  const end =
    anchors.endHeading === undefined
      ? null
      : findFirstMatch(pages, anchors.endHeading, start, matchHeadings);
  if (
    anchors.endHeading !== undefined &&
    anchors.requireEndHeading === true &&
    end === null
  ) {
    throw new SectionNotFoundError('end', anchors.endHeading);
  }
  return buildSlice(pages, start, end);
}

function buildSlice(
  pages: readonly PageText[],
  start: Location,
  end: Location | null,
): readonly PageText[] {
  const lastPageIdx = end?.pageIdx ?? pages.length - 1;
  const out: PageText[] = [];
  for (let p = start.pageIdx; p <= lastPageIdx; p++) {
    const page = pages[p];
    const firstLine = p === start.pageIdx ? start.lineIdx + 1 : 0;
    const lastLineExclusive =
      end !== null && p === end.pageIdx ? end.lineIdx : page.lines.length;
    const lines = page.lines.slice(firstLine, lastLineExclusive);
    if (lines.length > 0) {
      // Carry the parallel per-line font heights (sliced to the same window)
      // so heading-hierarchy-aware parsers like `parseRules` keep their font
      // signal after slicing. `headingLineIndexes` is intentionally not
      // re-projected here (its indexes are page-relative and no current slice
      // consumer reads it); `lineHeights` is positional, so a plain slice
      // stays aligned with `lines`.
      const lineHeights =
        page.lineHeights === undefined
          ? undefined
          : page.lineHeights.slice(firstLine, lastLineExclusive);
      out.push({
        pageNumber: page.pageNumber,
        lines,
        ...(lineHeights === undefined ? {} : { lineHeights }),
      });
    }
  }
  return out;
}

/**
 * Default section anchors for the SRD 5.1 PDF (the CC-BY-4.0 vendored
 * source at `packages/core/sources/dnd5e-srd-5.1/SRD_CC_v5.1.pdf`).
 *
 * Real-PDF mapping (loreweaver-0m9.5.20): the SRD 5.1 PDF differs from the
 * fixture-built layout the importer was originally drafted against in two
 * important ways. (1) Each base class is its own h=25.9 chapter title
 * ("Barbarian", "Bard", ..., "Wizard") — there is no aggregate "Classes"
 * chapter heading. (2) "Hazards" and a separate "Treasure" chapter do not
 * exist; orchestrator treats those sections as best-effort and emits empty
 * results when the anchor doesn't match.
 *
 * Most anchors set `matchHeadings: true` so they only fire against lines the
 * extractor flagged as chapter / section headings (font height ≥ heading
 * threshold). This is essential for anchors whose text also occurs at body
 * font size — e.g. the "Equipment" chapter title (h=25.9) is shadowed in
 * every base-class chapter by a body-font "Equipment" subheading. Fixture
 * PDFs built with a uniform font size have `headings` undefined, in which
 * case `matchHeadings` falls back to line matching.
 *
 * `requireEndHeading: true` on implemented kinds means a missing end anchor
 * is a hard error rather than a slice-to-EOF that could feed trailing
 * chapters into the parser. Override via the `sectionAnchors` option on
 * `runImporter` if a future vendored PDF differs.
 */
export const SRD_5_1_DEFAULT_SECTION_ANCHORS = {
  // SRD 5.1 opens with the "Races" chapter (Dwarf, Elf, ... Tiefling). It
  // closes at the first base-class chapter heading "Barbarian" (the SRD has
  // no aggregate "Classes" heading; each class is its own chapter title).
  // requireEndHeading is true because ancestry is an implemented kind.
  races: {
    startHeading: /^Races$/,
    // Real SRD: ends at "Barbarian" (first class chapter — no aggregate
    // "Classes" heading exists in the PDF). Fixtures: end at "Classes",
    // which the fixture authors put between the races and class pages.
    endHeading: /^Barbarian$|^Classes$/,
    requireEndHeading: true,
    matchHeadings: true,
  },
  // Introductory race-trait category guidance on p3. The h≈13.9 start and
  // h≈18 Dwarf boundary are below/at different extractor heading tiers, so
  // match all exact lines inside the already source-specific full document.
  racialTraits: {
    startHeading: /^Racial Traits$/,
    endHeading: /^Dwarf$/,
    requireEndHeading: true,
  },
  // SRD 5.1 base-classes span from "Barbarian" (first class chapter) to
  // "Beyond 1st Level" (the multiclassing / customization chapter that
  // immediately follows Wizard). The parser keys off each class's "Hit Dice:
  // 1dN per <class> level" signature line, so an over-wide slice cannot
  // promote arbitrary headings as classes, but failing closed keeps the
  // slice honest. See ADR 0009 and loreweaver-0m9.5.2.
  classes: {
    // Real SRD: "Barbarian" is the first class chapter title. Fixtures use
    // an aggregate "Classes" heading. The class parser keys off each class's
    // "Hit Dice: 1dN per <class> level" signature line, so a slightly wider
    // start can't promote arbitrary headings as classes.
    startHeading: /^Barbarian$|^Classes$/,
    // Real SRD: classes section closes at "Beyond 1st Level" (the chapter
    // immediately after Wizard, containing Multiclassing). Fixtures put
    // "Using Ability Scores" immediately after the classes page.
    endHeading: /^Beyond 1st Level$|^Using Ability Scores$/,
    requireEndHeading: true,
    matchHeadings: true,
  },
  // Core-rules chapter (ability checks, adventuring, combat, etc.) begins
  // at "Using Ability Scores" (which the extractor re-joins from its
  // two-line "Using Ability" / "Scores" wrap on p76) and runs up to (but
  // not including) the "Spellcasting" chapter.
  coreRules: {
    startHeading: /^Using Ability Scores$/,
    // Real SRD: closes at "Spellcasting" (the chapter title that introduces
    // Spell Lists and Spell Descriptions). Fixtures jump straight from the
    // core-rules pages into the "Spell Lists" subsection page.
    endHeading: /^Spellcasting$|^Spell Lists$/,
    requireEndHeading: true,
    matchHeadings: true,
  },
  // The general Spellcasting-rules chapter (loreweaver-3hp): the chapter title
  // "Spellcasting" (h≈25.9) introduces What Is a Spell, Spell Level, Spell
  // Slots, Casting Time, Components, Range, Areas of Effect, Duration, Targets,
  // Combining Magical Effects, etc. — the general rules that govern every spell
  // in the pack. The `coreRules` slice deliberately ENDS at "Spellcasting"
  // (its endHeading), so this chapter is fed to `parseRules` separately and its
  // records concatenated. It runs to the next subsection heading "Spell Lists"
  // (the start of the spell-data slices). requireEndHeading is true because the
  // rules emitted here are gated by `EXPECTED_SRD_5_1_RULE_KEYS`, so a missing
  // boundary that let "Spell Lists"/"Spell Descriptions" bleed in must fail
  // closed. matchHeadings keeps "^Spellcasting$" on the real chapter heading
  // rather than any body-prose mention. The orchestrator slices this
  // best-effort (a reduced fixture PDF with no Spellcasting chapter degrades to
  // no spellcasting rules).
  spellcastingRules: {
    startHeading: /^Spellcasting$/,
    endHeading: /^Spell Lists$|^Spell Descriptions$/,
    requireEndHeading: true,
    matchHeadings: true,
  },
  // "Spell Lists" and "Spell Descriptions" are subsection titles (h=18)
  // inside the Spellcasting chapter — both appear at heading font, so they
  // remain heading-matched but at the subsection level rather than the
  // chapter level.
  spellLists: {
    startHeading: /^Spell Lists$/,
    endHeading: /^Spells$|^Spell Descriptions$/,
    requireEndHeading: true,
    matchHeadings: true,
  },
  // The last spell in the SRD 5.1 alphabetic Spell Descriptions section is
  // "Zone of Truth"; the heading-flagged line that immediately follows it is
  // the gamemastering "Traps" subsection (then Diseases, Madness, Objects,
  // Poisons, then "Magic Items"). Without "Traps" in the end anchor the slice
  // ran on to the first match further down ("Magic Items", p206), absorbing the
  // entire Traps→Poisons run into Zone of Truth's body (loreweaver-7ok). "Traps"
  // is the true end boundary; the later headings stay in the alternation as
  // defense-in-depth in case a future re-extraction shifts the first one.
  spellDescriptions: {
    startHeading: /^Spells$|^Spell Descriptions$/,
    endHeading:
      /^(Traps|Diseases|Madness|Monsters|Magic Items|Creatures|NPCs|Treasure|Appendix)\b/,
    requireEndHeading: true,
    matchHeadings: true,
  },
  // SRD 5.1 "Actions in Combat" subsection (h=18 inside the core-rules
  // chapter), bounded by the subsection that follows ("Making an Attack",
  // "Movement and Position", etc.).
  combatActions: {
    startHeading: /^Actions in Combat$/,
    endHeading:
      /^(Making an Attack|Movement and Position|Reactions?|Bonus Actions?|Mounted Combat|Underwater Combat|Contests in Combat|Cover)$/i,
    requireEndHeading: true,
    matchHeadings: true,
  },
  // SRD 5.1 places conditions in "Appendix PH-A: Conditions" (one multi-
  // line h=25.9 chapter heading — the extractor merges it on p358). The
  // end anchor matches the following appendix heading.
  conditions: {
    startHeading:
      /^(Appendix [A-Z]{0,3}-?[A-Z]?:?\s*)?Conditions$|^Appendix [A-Z]{0,3}-?[A-Z]?: Conditions$/,
    endHeading:
      /^Appendix [A-Z]{0,3}-?[A-Z]?:|^Open Game License|^Legal Information/i,
    matchHeadings: true,
  },
  // SRD 5.1 "Feats" chapter (Grappler is the only entry in this edition).
  // The chapter ends at "Using Ability Scores" — the next chapter title.
  feats: {
    startHeading: /^Feats?$|^Feat Descriptions?$/,
    endHeading:
      /^(Using Ability Scores|Adventuring|Combat|Equipment|Monsters|Magic Items|Running the Game|Spell Lists?|Spellcasting)$|^Appendix\b/i,
    requireEndHeading: true,
    matchHeadings: true,
  },
  // SRD 5.1 gamemastering "Traps" subsection. It is the heading-flagged line
  // that immediately follows the alphabetic Spell Descriptions section (the
  // spell slice ends here — see `spellDescriptions` and loreweaver-7ok). The
  // section carries the general trap-running guidance, the two trap reference
  // tables (Trap Save DCs and Attack Bonuses; Damage Severity by Level), and the
  // alphabetic Sample Traps (Collapsing Roof … Sphere of Annihilation). It ends
  // at the next gamemastering subsection heading ("Diseases"); the later
  // headings stay in the alternation as defense-in-depth. requireEndHeading is
  // true because trap (emitted as `hazard`) is now an implemented kind, so a
  // missing end boundary must fail closed rather than run the parser past the
  // section. matchHeadings keeps `^Traps$` on the real subsection heading rather
  // than a body-prose mention.
  traps: {
    startHeading: /^Traps$/,
    endHeading:
      /^(Diseases|Madness|Objects|Poisons|Monsters|Magic Items|Appendix)\b/,
    requireEndHeading: true,
    matchHeadings: true,
  },
  // SRD 5.1 gamemastering "Diseases" section (loreweaver-6ra). It is an h≈18
  // subsection heading that follows the Traps section (Traps → Diseases →
  // Madness → Objects → Poisons → Magic Items). It carries the general
  // disease-as-plot-device guidance, a "Sample Diseases" caption, and the three
  // named sample diseases (Cackle Fever, Sewer Plague, Sight Rot). It ends at
  // the next gamemastering heading ("Madness"); the later headings stay in the
  // alternation as defense-in-depth. requireEndHeading is true because disease
  // (emitted as `hazard`) is now an implemented kind, so a missing end boundary
  // must fail closed rather than run the parser into Madness/Objects. The word
  // "Diseases" also occurs as body prose in the section's own intro, so
  // matchHeadings keeps `^Diseases$` on the real subsection heading. The
  // orchestrator slices this best-effort on its start so fixture PDFs without
  // the section degrade to no diseases.
  diseases: {
    startHeading: /^Diseases$/,
    endHeading: /^(Madness|Objects|Poisons|Monsters|Magic Items|Appendix)\b/,
    requireEndHeading: true,
    matchHeadings: true,
  },
  // SRD 5.1 gamemastering "Poisons" section (loreweaver-6ra). An h≈18 subsection
  // heading after Objects (… → Objects → Poisons → Magic Items). It carries the
  // four poison-type definitions, a "Poisons" reference table (Item / Type /
  // Price per Dose), a "Sample Poisons" caption, and the 14 named sample poisons
  // (Assassin's Blood … Wyvern Poison). It ends at the "Magic Items" chapter
  // title that follows. requireEndHeading is true because poison (emitted as
  // `hazard`) is an implemented kind. matchHeadings keeps `^Poisons$` on the
  // real h≈18 subsection heading rather than the h≈12 "Poisons" table title (it
  // is below the heading-flag threshold) or the body-prose mentions. Best-effort
  // start, like Diseases/Traps.
  poisons: {
    startHeading: /^Poisons$/,
    endHeading: /^(Magic Items|Monsters|Appendix)\b/,
    requireEndHeading: true,
    matchHeadings: true,
  },
  // SRD 5.1 gamemastering "Madness" section (p201-202): introductory prose,
  // Going Mad, Madness Effects, three effect tables, and Curing Madness.
  madness: {
    startHeading: /^Madness$/,
    endHeading: /^Objects$/,
    requireEndHeading: true,
    matchHeadings: true,
  },
  // SRD 5.1 gamemastering "Objects" section (p203): object-damage guidance and
  // the Object Armor Class / Object Hit Points tables. It ends at "Poisons".
  objects: {
    startHeading: /^Objects$/,
    endHeading: /^Poisons$/,
    requireEndHeading: true,
    matchHeadings: true,
  },
  // SRD 5.1 has no "Dungeon Hazards" / "Hazards" chapter — the canonical
  // hazard set (Brown Mold, Green Slime, Webs, Yellow Mold) is absent from
  // the SRD 5.1 PDF entirely. The orchestrator wraps this anchor in a
  // best-effort try/catch (like `multiclassing`); these regexes remain so a
  // future SRD edition / fixture that DOES carry a hazards section is still
  // sliced correctly. requireEndHeading is true to keep the failing-closed
  // bound consistent with other implemented kinds when the section IS found.
  hazards: {
    startHeading: /^Dungeon Hazards$|^Hazards$/,
    endHeading:
      /^(Traps|Sample Traps|Wilderness Hazards|Monsters|Magic Items|Appendix|Open Game License|Legal Information)$/i,
    requireEndHeading: true,
    matchHeadings: true,
  },
  // SRD 5.1 "Equipment" chapter (p62). matchHeadings is essential: every
  // base-class chapter has a body-font "Equipment" subsection that would
  // otherwise shadow the chapter title at h=25.9.
  equipment: {
    startHeading: /^Equipment$/,
    endHeading:
      /^(Mounts and Vehicles|Trade Goods|Expenses|Trinkets|Multiclassing|Spellcasting|Using Ability Scores|Adventuring|Combat|Monsters|Magic Items|Feats)$/i,
    requireEndHeading: true,
    matchHeadings: true,
  },
  // Equipment prose around the armor and weapon reference tables (pp64-65).
  // These are separate slices because the physical tables interrupt prose in
  // extraction order; parseRules drops the reviewed table captions/rows and
  // reattaches prose-height lines that resume below them.
  armorGuidance: {
    startHeading: /^Getting Into and Out of Armor$/,
    endHeading: /^Weapons$/,
    requireEndHeading: true,
  },
  weaponGuidance: {
    startHeading: /^Weapons$/,
    endHeading: /^Adventuring Gear$/,
    requireEndHeading: true,
    matchHeadings: true,
  },
  // SRD 5.1 "Mounts and Vehicles" section (p71), which sits immediately after
  // the Equipment chapter's tables (the `equipment` anchor ends here). It holds
  // the Mounts and Other Animals, Tack/Harness/Drawn Vehicles, and Waterborne
  // Vehicles tables, and closes at the next section heading "Trade Goods" (the
  // end anchor narrows the slice when present). The string "Mounts and Vehicles"
  // also occurs as body prose later (p84), so matchHeadings keeps the anchor on
  // the real section heading. Unlike the fail-closed kinds, requireEndHeading is
  // intentionally left off: `parseMountsAndVehicles` is internally header-bounded
  // (each sub-table is keyed off its own "Item Cost …" column header and stops
  // at the next sub-table title or first non-matching row), so a slice that runs
  // to EOF cannot over-extract. This also lets reduced fixture PDFs that carry a
  // bare "Mounts and Vehicles" chapter terminator (with no Trade Goods after)
  // degrade to no records instead of throwing.
  mountsAndVehicles: {
    startHeading: /^Mounts and Vehicles$/,
    endHeading:
      /^(Trade Goods|Expenses|Selling Treasure|Spellcasting|Using Ability Scores|Adventuring|Combat|Monsters|Magic Items|Feats)$/i,
    matchHeadings: true,
  },
  // SRD 5.1 "Magic Items" chapter intro (pp206-207, eshyra-0m9.21): the
  // general usage rules that precede the A-Z item entries — Attunement,
  // Wearing and Wielding Items (Multiple Items of the Same Kind, Paired
  // Items), and Activating an Item (Command Word, Consumables, Spells,
  // Charges). The orchestrator feeds this slice to the nesting-aware
  // `parseRules` (the chapter-intro paragraph emits via the `chapterIntro`
  // option, like Beyond 1st Level). matchHeadings is essential: "Magic Items"
  // occurs constantly as body prose, but the only heading-flagged exact
  // occurrence is the h≈25.9 chapter title on p206 (the preceding Poisons
  // section's end anchor stops just before it). The slice ends at the "Magic
  // Items A-Z" heading that the item parser owns; requireEndHeading is true
  // because the emitted rules are gated by `EXPECTED_SRD_5_1_RULE_KEYS`, so a
  // missing boundary that let item entries bleed into the rules must fail
  // closed. Best-effort on its START so reduced fixture PDFs without the
  // chapter degrade to no magic-item rules.
  magicItemRules: {
    startHeading: /^Magic Items$/,
    endHeading: /^Magic Items A-Z$/,
    requireEndHeading: true,
    matchHeadings: true,
  },
  // SRD 5.1 "Magic Items A-Z" (p207-p251) carries lookupable magic-item
  // entries. The introductory "Magic Items" chapter before it carries the
  // general usage rules (imported as `rule` records via the `magicItemRules`
  // slice above; eshyra-0m9.21); the following "Sentient Magic Items" heading
  // is DM-facing construction guidance, so the implemented item parser is
  // bounded to the A-Z run and fails closed if the end is missing. The
  // "Artifacts" subsection that follows IS parsed — but as its own slice (see
  // `artifacts` below), because the lone artifact entry (Orb of Dragonkind)
  // sits after the Sentient Magic Items guidance, not inside the A-Z run.
  magicItems: {
    startHeading: /^Magic Items A-Z$/,
    endHeading: /^(Sentient Magic Items|Artifacts|Monsters|Appendix)\b/i,
    requireEndHeading: true,
    matchHeadings: true,
  },
  // SRD 5.1 "Artifacts" subsection (p252-p253). Unlike "Sentient Magic Items"
  // (pure DM construction guidance), the Artifacts subsection contains one real,
  // lookupable magic-item entry — Orb of Dragonkind — in the same
  // name/category/rarity/body shape as the A-Z items (its category line is
  // "Wondrous item, artifact (requires attunement)"). It was previously dropped
  // because the A-Z slice ends at the preceding "Sentient Magic Items" heading
  // (eshyra-0m9.16). The orchestrator parses this slice with the same
  // `parseMagicItems` and concatenates the result with the A-Z items. The slice
  // ends at the "Monsters" chapter that follows. requireEndHeading is true
  // because magic-item is an implemented kind, so a missing end boundary must
  // fail closed rather than run the parser into the Monsters chapter.
  // matchHeadings keeps `^Artifacts$` on the real heading rather than a
  // body-prose mention.
  artifacts: {
    startHeading: /^Artifacts$/,
    endHeading: /^(Monsters|Appendix)\b/i,
    requireEndHeading: true,
    matchHeadings: true,
  },
  // SRD 5.1 "Monsters" chapter (p254). End anchor matches the conditions
  // appendix that follows the monsters alphabetic chapter, so trailing
  // appendix text doesn't leak into the creature parser.
  monsters: {
    startHeading: /^Monsters$/,
    endHeading:
      /^(Nonplayer Characters|NPCs|Appendix |Open Game License|Legal Information)/i,
    requireEndHeading: true,
    matchHeadings: true,
  },
  // SRD 5.1 "Appendix MM-A: Miscellaneous Creatures" (p366). This appendix
  // holds the canonical animals/beasts (Cat, Wolf, Bear, Ape, Horse, …) and
  // a handful of mounts and swarms — none of which appear in the main
  // Monsters alphabetic chapter. The orchestrator parses this slice with
  // the same `parseCreatures` and concatenates the result with the main
  // Monsters slice. End anchor is the next appendix ("Appendix MM-B:
  // Nonplayer Characters"), which keeps the NPC stat blocks (Bandit, Cultist,
  // …) out of THIS slice — they are imported separately via the
  // `nonplayerCharacters` anchor below and tagged `category: 'npc'`
  // (loreweaver-bn0). Keeping the boundary here means the monster coverage
  // baseline (exactly 296) is unaffected by the NPC import. See loreweaver-w8h.
  miscellaneousCreatures: {
    startHeading: /^Appendix MM-A:\s*Miscellaneous Creatures$/,
    endHeading:
      /^(Appendix MM-B|Appendix [A-Z]{0,3}-?[A-Z]?:|Open Game License|Legal Information)/i,
    requireEndHeading: true,
    matchHeadings: true,
  },
  // SRD 5.1 "Appendix MM-B: Nonplayer Characters" (p395-403). This appendix
  // holds the 21 generic NPC stat blocks (Acolyte, Bandit, Bandit Captain,
  // Berserker, Commoner, Cultist, Druid, Guard, Knight, Mage, Noble, Priest,
  // Scout, Spy, Thug, Veteran, …) — encounter-usable stat blocks in the exact
  // same AC/HP/speed/ability/CR shape as the Monsters chapter, so the
  // orchestrator parses this slice with the same `parseCreatures` (tagging the
  // results `category: 'npc'`) and concatenates them with the monster set
  // (loreweaver-bn0). MM-B is the SRD's last content section — the only thing
  // after Veteran (p403) is the Open Game License / Legal Information back
  // matter, which the extractor does not flag as a heading — so there is no
  // trailing heading to bound the slice and it legitimately runs to EOF
  // (requireEndHeading omitted). The trailing license prose carries no
  // stat-block signature, so `parseCreatures` ignores it; the exact NPC
  // name-set coverage gate (`EXPECTED_SRD_5_1_NPC_NAMES`) is what fails closed
  // if the slice ever over- or under-extracts. matchHeadings keeps the start
  // anchor on the real appendix heading rather than a body/TOC mention.
  nonplayerCharacters: {
    startHeading: /^Appendix MM-B:\s*Nonplayer Characters$/,
    matchHeadings: true,
  },
  // SRD 5.1 has no standalone "Treasure" chapter — magic items are under
  // the "Magic Items" chapter, and the treasure tables that the original
  // anchor targeted are not present in the SRD 5.1 PDF. Like `hazards`,
  // the orchestrator treats this slice as best-effort and emits empty
  // results when the anchor doesn't match. The regex is retained for
  // fixtures and future editions.
  treasureTables: {
    startHeading: /^Treasure$/,
    endHeading: /^Using (a )?Magic Items?$/i,
    requireEndHeading: true,
  },
  // SRD 5.1 "Multiclassing" subsection (h=18, inside "Beyond 1st Level"
  // p56). Only the "Prerequisites" listing is consumed (parseMulticlassing),
  // so the end boundary is the subsection that follows ("Proficiencies"
  // or the next subsection). requireEndHeading is intentionally left off
  // (best-effort): the prerequisites enrichment is NOT fail-closed (ADR
  // 0007 — primaryAbilities is left empty when the source doesn't provide
  // it), and the orchestrator already treats a missing Multiclassing
  // section as "no enrichment available".
  multiclassing: {
    startHeading: /^Multiclassing$/,
    endHeading:
      /^(Proficiencies|Class Features|Alignment|Using Ability Scores|Beyond 1st Level|Adventuring|Combat|Spell Lists?|Spellcasting|Monsters|Magic Items|Equipment|Languages|Inspiration|Backgrounds|Appendix\b)/i,
    matchHeadings: true,
  },
  // SRD 5.1 "Beyond 1st Level" chapter (p56-59). It immediately follows the
  // last base class (Wizard) — it is the `classes` anchor's end boundary — and
  // carries the five reference tables this slice feeds to `parseTables`:
  // Character Advancement, Multiclassing Prerequisites, Multiclassing
  // Proficiencies, Standard Languages, and Exotic Languages (eshyra-0m9.23).
  // The chapter also holds the Multiclassing prose and the Inspiration
  // subsection (DM-facing prose, not tabular), and ends at the "Backgrounds"
  // chapter title. requireEndHeading is true so a missing "Backgrounds"
  // boundary fails closed rather than letting Backgrounds / Equipment / Feats
  // content run into the table slice; the later headings stay in the
  // alternation as defense-in-depth. matchHeadings keeps the anchors on real
  // chapter titles (the strings "Backgrounds"/"Equipment" also occur at body
  // font in this and other chapters). The orchestrator slices this best-effort
  // on its START, so a reduced fixture PDF without the chapter degrades to no
  // Beyond-1st-Level tables.
  beyondFirstLevel: {
    startHeading: /^Beyond 1st Level$/,
    endHeading:
      /^(Backgrounds|Equipment|Feats|Using Ability Scores|Adventuring|Combat|Monsters|Magic Items|Appendix)\b/,
    requireEndHeading: true,
    matchHeadings: true,
  },
  // SRD 5.1 "Backgrounds" chapter (p60-61, eshyra-0m9.17): the chapter intro
  // sections (Proficiencies, Languages, Equipment, Suggested Characteristics,
  // Customizing a Background — all h≈12 leaves) followed by the lone Acolyte
  // background entry (an h≈13.9 sub-subsection heading). It sits between
  // "Beyond 1st Level" (whose anchor ends here) and the "Equipment" chapter.
  // matchHeadings is essential for the END anchor: the chapter's own intro has
  // an h≈12 "Equipment" leaf that is below the heading-flag threshold, so only
  // the real h≈25.9 "Equipment" chapter title can close the slice. Best-effort
  // on its START so reduced fixture PDFs without the chapter degrade to no
  // background records; requireEndHeading is true so a missing "Equipment"
  // boundary fails closed rather than running the background parser into the
  // Equipment chapter's tables. The orchestrator carves the chapter-intro
  // rules region from this slice with `truncateBeforeFirst(/^Acolyte$/)` (the
  // entry heading is h≈13.9, below the heading-flag threshold, so it cannot be
  // a matchHeadings boundary — same pattern as the Traps "Sample Traps" cut).
  // The end alternation is EXACT-line ($-anchored) rather than the prefix
  // (\b) form other anchors use: every background entry carries a body-font
  // "Equipment: <package>" labeled line, and on uniform-font fixture PDFs
  // (where matchHeadings falls back to line matching) a prefix "^Equipment\b"
  // would close the slice at that label, truncating the entry.
  backgrounds: {
    startHeading: /^Backgrounds$/,
    endHeading:
      /^(Equipment|Feats|Using Ability Scores|Adventuring|Combat|Monsters|Magic Items)$|^Appendix\b/,
    requireEndHeading: true,
    matchHeadings: true,
  },
  // SRD 5.1 "Expenses" region (p72-74), the tail of the Equipment chapter after
  // the Mounts and Vehicles tables. It starts at the "Trade Goods" section
  // heading (matchHeadings keeps the anchor on the h-level heading, not the
  // lower-font "Trade Goods" table caption that follows it, nor the body-prose
  // mentions) and runs to the "Feats" chapter heading. The slice carries the
  // Trade Goods, Lifestyle Expenses, Food/Drink/Lodging, and Services cost
  // tables plus the Spellcasting Services prose (eshyra-0m9.19); the
  // orchestrator feeds it to `parseTables` and `parseSpellcastingServices`.
  // Best-effort start so a reduced fixture PDF without this region degrades to
  // no expenses tables; requireEndHeading is true so a missing "Feats" boundary
  // fails closed rather than running the table/rule parsers into later chapters.
  expenses: {
    startHeading: /^Trade Goods$/,
    endHeading:
      /^(Feats?|Using Ability Scores|Adventuring|Combat|Monsters|Magic Items|Appendix)\b/,
    requireEndHeading: true,
    matchHeadings: true,
  },
  // The p73 gray sidebar renders its body at table-cell height, so it gets a
  // dedicated bounded prose parser rather than running the whole Expenses
  // slice through parseRules.
  selfSufficiency: {
    startHeading: /^Self-Sufficiency$/,
    endHeading: /^Food, Drink, and Lodging$/,
    requireEndHeading: true,
  },
} as const satisfies Record<string, SectionAnchorOptions>;

export type Srd51SectionAnchors = {
  readonly races: SectionAnchorOptions;
  readonly racialTraits: SectionAnchorOptions;
  readonly classes: SectionAnchorOptions;
  readonly coreRules: SectionAnchorOptions;
  readonly spellcastingRules: SectionAnchorOptions;
  readonly spellLists: SectionAnchorOptions;
  readonly spellDescriptions: SectionAnchorOptions;
  readonly combatActions: SectionAnchorOptions;
  readonly monsters: SectionAnchorOptions;
  readonly miscellaneousCreatures: SectionAnchorOptions;
  readonly nonplayerCharacters: SectionAnchorOptions;
  readonly mountsAndVehicles: SectionAnchorOptions;
  readonly magicItemRules: SectionAnchorOptions;
  readonly magicItems: SectionAnchorOptions;
  readonly artifacts: SectionAnchorOptions;
  readonly conditions: SectionAnchorOptions;
  readonly feats: SectionAnchorOptions;
  readonly traps: SectionAnchorOptions;
  readonly diseases: SectionAnchorOptions;
  readonly poisons: SectionAnchorOptions;
  readonly madness: SectionAnchorOptions;
  readonly objects: SectionAnchorOptions;
  readonly hazards: SectionAnchorOptions;
  readonly equipment: SectionAnchorOptions;
  readonly armorGuidance: SectionAnchorOptions;
  readonly weaponGuidance: SectionAnchorOptions;
  readonly treasureTables: SectionAnchorOptions;
  readonly multiclassing: SectionAnchorOptions;
  readonly beyondFirstLevel: SectionAnchorOptions;
  readonly backgrounds: SectionAnchorOptions;
  readonly expenses: SectionAnchorOptions;
  readonly selfSufficiency: SectionAnchorOptions;
};
