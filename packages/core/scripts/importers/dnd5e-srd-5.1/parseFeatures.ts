/**
 * Feature parser for the D&D 5e SRD 5.1 importer.
 *
 * Input is a slice of `PageText[]` already narrowed to the SRD's "Classes"
 * chapter (the same slice `parseClasses` / `parseSubclasses` consume — class
 * and subclass features are printed inside their grantor's section). Output is
 * a `FeatureExtraction[]`, sorted by name then grantor, with one entry per
 * class- or subclass-granted feature.
 *
 * Scope (ADR 0009 / loreweaver-0m9.5.18): class- and subclass-granted features
 * (Second Wind, Rage, Channel Divinity, Improved Critical, …). Base classes are
 * `class` records (loreweaver-0m9.5.2); subclasses are `subclass` records
 * (loreweaver-0m9.5.17). This parser extracts the *features* those grantors
 * confer.
 *
 * Grantor tracking: the parser walks the flattened lines maintaining the
 * current class and subclass context. On real multi-tier PDF input, a known
 * base-class name opens class context only at the chapter-heading font tier, so
 * a body-font table cell such as the Oath of Devotion spells table's "Paladin"
 * header cannot clear subclass context. Uniform/no-height fixtures retain the
 * exact-name fallback. A known subclass name opens context only when its known
 * parent matches the current class (or the implicit opening Barbarian section).
 * A feature is attributed to the current subclass when one is open, otherwise
 * to the current class. These are the same structural anchors
 * `parseSubclasses` uses; only structural anchors are hard-coded (ADR 0007) —
 * every field VALUE is extracted from the source.
 *
 * Feature-heading detection is table-driven where the source gives a table:
 * class/subclass progression rows populate grant-level anchors, and only
 * headings matching those anchors become feature records. Prose lead-ins such
 * as "At 3rd level" are a secondary fallback for subclass features whose grant
 * level is encoded directly in the body. Unanchored title-case option headings
 * inside a feature body (for example Fighting Style options) remain part of the
 * parent feature description rather than becoming records.
 *
 * Level: table anchors are the primary source. A leading clause in the body
 * ("Starting at 2nd level, …", "Beginning when you choose this archetype at
 * 3rd level, …", "At 2nd level, …") is used only when no table anchor exists.
 * A feature whose body opens with no such clause and lacks a table anchor is
 * not emitted; silently defaulting to level 1 would corrupt `data.level`.
 *
 * Fail-closed: a detected feature heading whose body re-flows to an empty
 * string is malformed (the feature kindSchema requires a non-empty
 * `description`), so the parser throws with the feature name + page rather than
 * emit a record that can't satisfy the schema.
 */

import {
  hasHeadingTiers,
  isCalloutBoxHeading,
  isParentClassHeading,
  KNOWN_SUBCLASSES,
  PARENT_CLASS_NAMES,
} from './parseSubclasses.js';
import type { FeatureExtraction, PageText } from './types.js';

const SUBCLASS_NAMES = new Set(KNOWN_SUBCLASSES.map((s) => s.name));
const SUBCLASS_PARENT_BY_NAME = new Map(
  KNOWN_SUBCLASSES.map((subclass) => [subclass.name, subclass.parent]),
);

// The 12 subclass-group headings the Classes chapter prints between a class's
// own features and its subclasses ("Martial Archetypes", "Divine Domains", …).
// They are structural headings, not features, so they must never be promoted.
const SUBCLASS_GROUP_HEADINGS = new Set([
  'Primal Paths',
  'Bardic Colleges',
  'Divine Domains',
  'Druid Circles',
  'Martial Archetypes',
  'Monastic Traditions',
  'Sacred Oaths',
  'Ranger Archetypes',
  'Roguish Archetypes',
  'Sorcerous Origins',
  'Otherworldly Patrons',
  'Arcane Traditions',
]);

// Class-block structural headings (the stat block before the feature list).
// Structural, never features.
const STRUCTURAL_HEADINGS = new Set([
  'Class Features',
  'Hit Points',
  'Proficiencies',
  'Equipment',
  'Quick Build',
  'Multiclassing',
  'Proficiency Bonus',
]);

// Body-prose sentence starters: a candidate heading that opens with one of
// these is description text, not a feature name. Mirrors `parseFeats`, extended
// with the level-clause and list openers the Classes chapter uses.
const PROSE_STARTER =
  /^(You|When|While|If|As|Once|The|This|These|Each|At|Your|For|To|In|On|By|With|Through|Beginning|Starting|Whenever|Choose|Additionally|Also|A|An|Whether|After|Before|During|Until|Unless|Roll|Make|Add|Of|Their|They|From|Different)\b/;

// Grant-level clause at the START of a feature body. The level is captured from
// the first such clause only. "fighter level" / "your barbarian level" do not
// match because no digit+ordinal precedes "level". "Also" covers the Life
// Domain "Also starting at 1st level …" lead-in; "By" covers the Thief
// "By 13th level …" lead-in. "When you join" covers the College of Lore "When
// you join the College of Lore at 3rd level …" entry lead-in; "When you take
// this oath" covers the Oath of Devotion "When you take this oath at 3rd level
// …" entry lead-in (both subclass-entry phrasings occur exactly once each in
// the SRD 5.1 Classes chapter — eshyra-tzl). The trailing ordinal enumeration
// captures the FIRST grant level of a multi-level clause — the Circle of the
// Land "Circle Spells" grant "At 3rd, 5th, 7th, and 9th level you gain access …"
// is level 3, not the 9th that ends the list.
const LEVEL_LEAD_IN =
  /^(?:Beginning|Starting|Also|When you reach|When you choose|When you join|When you take this oath|At|By)\b[^.]*?\b(\d{1,2})(?:st|nd|rd|th)(?:,?\s+(?:and\s+)?\d{1,2}(?:st|nd|rd|th))*\s+level\b/i;

const PROGRESSION_ROW =
  /^(\d{1,2})(?:st|nd|rd|th)\s+(?:(?:\+\d+|[+\u2212-]\d+)\s+)?(.+)$/;
const TRAILING_TABLE_CELL =
  /\s+(?:\d+|[-—]|\+\d+|[+\u2212-]\d+|\d+d\d+(?:\s*\([^)]*\))?)$/i;

// A line consisting only of numbers, signs, and separators — the spell-slot
// sub-table rows ("2 4 3") and the bonus columns printed beside the feature
// column. Such a line is never a wrapped feature-cell fragment, so it bounds
// (rather than continues) a progression row.
const NUMERIC_TABLE_LINE = /^[\d\s+−/—-]+$/;

interface FlatLine {
  readonly line: string;
  readonly page: number;
  /** Rendered max font height (PDF points), when the source carried it. */
  readonly height?: number;
}

interface FeatureAnchor {
  readonly grantorKind: 'class' | 'subclass';
  readonly grantorName: string;
  readonly featureName: string;
  readonly level: number;
}

interface FeatureStart {
  readonly level: number;
}

function collectOptionSourcePages(
  body: readonly FlatLine[],
): Readonly<Record<string, number>> | undefined {
  const pages: Record<string, number> = {};
  for (const { line, page } of body) {
    if (!isFeatureHeading(line)) continue;
    pages[line] ??= page;
  }
  return Object.keys(pages).length > 0 ? pages : undefined;
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

/**
 * A class progression table wraps a single feature cell across two extracted
 * lines when the cell text is wider than its column. The continuation line
 * carries the rest of the cell — a wrapped word ("Ability Score" / "Improvement"),
 * a die-size tag ("(d6)"), or a repeated-use parenthetical that belongs to a
 * later grant ("Action Surge (two uses)," / "Indomitable (three uses)"). A
 * continuation candidate is any non-empty line that is not itself a progression
 * row, not a structural anchor, not a numeric sub-table line, and does not open
 * like body prose.
 */
function isRowContinuation(line: string): boolean {
  return (
    line.length > 0 &&
    !PROGRESSION_ROW.test(line) &&
    !isStructuralText(line) &&
    !NUMERIC_TABLE_LINE.test(line) &&
    !PROSE_STARTER.test(line)
  );
}

/**
 * Strip trailing table-column cells (bare integers, em-dashes, signed bonuses,
 * dice tags) off the end of a progression-row tail, repeatedly, leaving just the
 * Features-column text. The level + proficiency-bonus prefix is protected: those
 * tokens sit to the LEFT of the feature text, so the right-anchored strip never
 * reaches them once any feature word is present.
 */
function stripTrailingTableCells(text: string): string {
  let out = text;
  while (TRAILING_TABLE_CELL.test(out)) {
    out = out.replace(TRAILING_TABLE_CELL, '').trim();
  }
  return out;
}

/**
 * Stitch wrapped progression-table cells back onto their row before any feature
 * detection runs. A wrapped cell always sits BETWEEN two progression rows, so a
 * run of continuation candidates is merged into the preceding row only when it
 * is terminated by another progression row. A run terminated by anything else
 * (the numeric spell-slot sub-table, a structural heading, or body prose) is the
 * table's bottom edge and is left untouched so the following content — e.g. a
 * feature's body paragraph — is never absorbed into the last row.
 *
 * Without this pass two failure modes appear (eshyra-0m9.14): a repeated feature
 * whose EARLIEST grant row wraps loses that row's level to a later un-wrapped row
 * (Druid "Ability Score Improvement", Bard "Magical Secrets"), and a wrapped
 * repeated-use fragment ("Indomitable (three uses)") is mistaken for a standalone
 * feature heading and overrides the canonical name.
 *
 * Continuation position (eshyra-ai9): the wrapped continuation belongs to the
 * Features cell, which is bounded on the right by any numeric columns printed
 * after it on the row's first extracted line. The Barbarian table is the only
 * SRD 5.1 class table whose Features column is followed by numeric columns
 * (Rages, Rage Damage), so its 1st-level row extracts as "1st +2 Rage, 2 +2"
 * with the wrapped "Unarmored Defense" on the following lines. Appending the
 * continuation onto the raw row would interleave those numerics inside the cell
 * ("Rage, 2 +2 Unarmored Defense") and corrupt the second feature's anchor. So
 * the row's trailing table-column cells are stripped before the continuation is
 * joined, reuniting the cell as "Rage, Unarmored Defense". For every other class
 * the row has no trailing numeric column, so the strip is a no-op and the merge
 * is unchanged.
 */
function stitchProgressionRows(flat: readonly FlatLine[]): FlatLine[] {
  const out: FlatLine[] = [];
  let i = 0;
  while (i < flat.length) {
    const row = flat[i];
    if (!PROGRESSION_ROW.test(row.line)) {
      out.push(row);
      i++;
      continue;
    }
    let j = i + 1;
    const continuation: string[] = [];
    while (j < flat.length && isRowContinuation(flat[j].line)) {
      continuation.push(flat[j].line);
      j++;
    }
    if (
      continuation.length > 0 &&
      j < flat.length &&
      PROGRESSION_ROW.test(flat[j].line)
    ) {
      const head = stripTrailingTableCells(row.line);
      out.push({ ...row, line: `${head} ${continuation.join(' ')}` });
      i = j;
    } else {
      out.push(row);
      i++;
    }
  }
  return out;
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

function normalizeFeatureName(name: string): string {
  return name
    .replace(/\s*\([^)]*\)\s*$/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function anchorKey(
  grantorKind: 'class' | 'subclass',
  grantorName: string,
  featureName: string,
): string {
  return `${grantorKind}\0${grantorName}\0${normalizeFeatureName(featureName)}`;
}

function isTableHeaderLine(line: string): boolean {
  return /^Level\b/.test(line) && /\bFeatures\b/.test(line);
}

/**
 * Is `line` a known structural anchor (class name, subclass name, subclass-
 * group heading, or class-block / table heading)? Such lines bound a feature
 * body and are never themselves features.
 */
function isStructuralLine(flatLine: FlatLine, tiersPresent: boolean): boolean {
  const { line, height } = flatLine;
  return (
    isParentClassHeading(line, height, tiersPresent) ||
    SUBCLASS_NAMES.has(line) ||
    SUBCLASS_GROUP_HEADINGS.has(line) ||
    isTableHeaderLine(line) ||
    STRUCTURAL_HEADINGS.has(line)
  );
}

function isStructuralText(line: string): boolean {
  return (
    PARENT_CLASS_NAMES.has(line) ||
    SUBCLASS_NAMES.has(line) ||
    SUBCLASS_GROUP_HEADINGS.has(line) ||
    isTableHeaderLine(line) ||
    STRUCTURAL_HEADINGS.has(line)
  );
}

// Allowed characters in a feature name: letters, spaces, straight AND curly
// apostrophes, hyphen, slash, parentheses. The curly apostrophe (U+2019) is the
// glyph the SRD 5.1 PDF actually renders in possessive headings — "Land's
// Stride", "Superior Hunter's Defense", "Thief's Reflexes", "Nature's Ward" —
// so a straight-apostrophe-only class silently dropped every one of them.
const FEATURE_NAME = /^[A-Z][A-Za-z '’\-/()]+$/;

/**
 * Heuristic: a feature name is a short (<= 50 char) title-case line that is not
 * a label, not body prose, not a structural anchor, and carries no digits
 * (table rows / "Hit Points at 1st Level" are excluded). Letters, spaces,
 * apostrophes, hyphens, slashes, and parens are allowed in names.
 *
 * Colon-qualified headings ("Channel Divinity: Preserve Life") are admitted as
 * a special case: exactly one ": " splitting two Title-Case names. That matches
 * the SRD's Channel Divinity options while still rejecting a proficiency
 * label/value line, which either carries a comma ("Saving Throws: Wisdom,
 * Charisma") or a non-heading value, and never confirms as a feature without a
 * level lead-in or table anchor (`featureStartAt`) regardless.
 */
function isFeatureHeading(line: string): boolean {
  if (line.length === 0 || line.length > 50) return false;
  if (/\d/.test(line)) return false; // table rows, level lines
  if (PROSE_STARTER.test(line)) return false;
  if (isStructuralText(line)) return false;
  if (line.includes(':')) {
    if (/[.;,]/.test(line)) return false; // sentence punctuation / list value
    const parts = line.split(': ');
    return (
      parts.length === 2 &&
      FEATURE_NAME.test(parts[0]) &&
      FEATURE_NAME.test(parts[1])
    );
  }
  if (/[.;,]/.test(line)) return false; // sentence punctuation
  return FEATURE_NAME.test(line);
}

function splitFeatureCell(cell: string): readonly string[] {
  return cell
    .split(/\s*,\s*/)
    .map((part) => part.replace(/\s*\([^)]*\)\s*$/g, '').trim())
    .filter((part) => part.length > 0 && !/^[-—]+$/.test(part));
}

function progressionFeaturesFromLine(
  line: string,
): { readonly level: number; readonly features: readonly string[] } | null {
  const match = PROGRESSION_ROW.exec(line);
  if (match === null) return null;

  const featureCell = stripTrailingTableCells(match[2].trim());

  return {
    level: Number.parseInt(match[1], 10),
    features: splitFeatureCell(featureCell),
  };
}

function collectFeatureAnchors(
  flat: readonly FlatLine[],
  tiersPresent: boolean,
): ReadonlyMap<string, FeatureAnchor> {
  const anchors = new Map<string, FeatureAnchor>();
  // The classes slice begins AFTER the "Barbarian" chapter heading (consumed by
  // sectionAnchors.classes as the start anchor), so Barbarian is the implicit
  // class context for the slice's leading content: its base-class progression
  // rows (Rage … Primal Champion) are printed before any base-class heading
  // line. Mirror parseSubclasses' `currentParent = 'Barbarian'` default so those
  // anchors are attributed to Barbarian instead of being dropped while
  // currentClass stays null until the first subclass heading arrives
  // (eshyra-7tc). Fixtures that name the parent class explicitly as their first
  // line override this before any progression row is reached.
  let currentClass = 'Barbarian';
  let currentSubclass: string | null = null;

  for (const flatLine of flat) {
    const { line, height } = flatLine;
    if (isParentClassHeading(line, height, tiersPresent)) {
      currentClass = line;
      currentSubclass = null;
      continue;
    }
    if (SUBCLASS_NAMES.has(line)) {
      // A subclass heading opens subclass context only when its known parent is
      // the currently open class; the implicit Barbarian default makes Path of
      // the Berserker resolve correctly even though the Barbarian heading was
      // sliced away.
      if (SUBCLASS_PARENT_BY_NAME.get(line) === currentClass) {
        currentSubclass = line;
      }
      continue;
    }

    const parsed = progressionFeaturesFromLine(line);
    if (parsed === null) continue;

    const grantorKind = currentSubclass === null ? 'class' : 'subclass';
    const grantorName = currentSubclass ?? currentClass;
    for (const featureName of parsed.features) {
      const key = anchorKey(grantorKind, grantorName, featureName);
      if (anchors.has(key)) continue;
      anchors.set(key, {
        grantorKind,
        grantorName,
        featureName,
        level: parsed.level,
      });
    }
  }

  return anchors;
}

function anchorFor(
  anchors: ReadonlyMap<string, FeatureAnchor>,
  grantorKind: 'class' | 'subclass',
  grantorName: string,
  featureName: string,
): FeatureAnchor | undefined {
  return anchors.get(anchorKey(grantorKind, grantorName, featureName));
}

function leadingLevelFromFollowingLines(
  flat: readonly FlatLine[],
  startIdx: number,
  tiersPresent: boolean,
): number | null {
  // Collect the opening prose lines up to a small window or the second
  // sentence end, stopping at a structural boundary.
  const parts: string[] = [];
  let sentenceEnds = 0;
  for (let i = startIdx; i < flat.length && parts.length < 6; i++) {
    const line = flat[i].line.trim();
    if (line.length === 0) continue;
    if (isStructuralLine(flat[i], tiersPresent)) break;
    parts.push(line);
    if (/[.?!]/.test(line) && ++sentenceEnds >= 2) break;
  }

  // Test the grant lead-in against the START of each of the first two
  // sentences; the first match wins. A feature whose grant clause opens its
  // FIRST sentence ("At 2nd level, …") matches as before; one whose first
  // sentence is a one-line intro and whose grant clause opens the SECOND
  // sentence — the Circle of the Land "Circle Spells" shape ("Your mystical
  // connection to the land infuses you … . At 3rd, 5th, 7th, and 9th level you
  // gain access …") — matches on that second sentence. Capping at two sentences
  // keeps a later in-body scaling mention ("At 11th level, the bonus increases")
  // from being mistaken for the grant level.
  const sentences = parts
    .join(' ')
    .trim()
    .split(/(?<=[.?!])\s+/)
    .slice(0, 2);
  for (const sentence of sentences) {
    const match = LEVEL_LEAD_IN.exec(sentence.trim());
    if (match !== null) return Number.parseInt(match[1], 10);
  }
  return null;
}

function featureStartAt(
  flat: readonly FlatLine[],
  idx: number,
  grantorKind: 'class' | 'subclass',
  grantorName: string,
  anchors: ReadonlyMap<string, FeatureAnchor>,
  tiersPresent: boolean,
): FeatureStart | null {
  const line = flat[idx].line;
  if (!isFeatureHeading(line)) return null;

  const anchor = anchorFor(anchors, grantorKind, grantorName, line);
  if (anchor !== undefined) {
    return { level: anchor.level };
  }

  const proseLevel = leadingLevelFromFollowingLines(
    flat,
    idx + 1,
    tiersPresent,
  );
  if (proseLevel !== null) {
    return { level: proseLevel };
  }

  return null;
}

/**
 * Parse class- and subclass-granted features from the narrowed
 * Classes-chapter `PageText[]`. Returns a `FeatureExtraction[]` sorted by name
 * then grantor.
 */
export function parseFeatures(pages: readonly PageText[]): FeatureExtraction[] {
  const flat = stitchProgressionRows(flatten(pages));
  if (flat.length === 0) return [];

  // Only honor callout-box font heights on a genuinely multi-tier slice;
  // uniform-font fixtures render body lines inside the callout band and must
  // not be bounded as boxes (loreweaver-6fw).
  const tiersPresent = hasHeadingTiers(flat.map((f) => f.height));
  const anchors = collectFeatureAnchors(flat, tiersPresent);
  const out: FeatureExtraction[] = [];
  const emittedIndexByKey = new Map<string, number>();
  // Implicit Barbarian context: the slice starts after the "Barbarian" chapter
  // heading, so Barbarian's base-class features (Rage … Primal Champion) precede
  // any base-class heading. Mirror collectFeatureAnchors / parseSubclasses so
  // those features are attributed to Barbarian rather than dropped (eshyra-7tc).
  let currentClass = 'Barbarian';
  let currentSubclass: string | null = null;

  for (let i = 0; i < flat.length; i++) {
    const { line, page } = flat[i];

    // Known-name anchors update grantor context and are not themselves features.
    if (isParentClassHeading(line, flat[i].height, tiersPresent)) {
      currentClass = line;
      currentSubclass = null;
      continue;
    }
    if (SUBCLASS_NAMES.has(line)) {
      // Open subclass context only when the subclass's known parent is the
      // currently open class (Barbarian by default until a base-class heading
      // moves it), keeping Path of the Berserker correct after the sliced-away
      // Barbarian heading.
      if (SUBCLASS_PARENT_BY_NAME.get(line) === currentClass) {
        currentSubclass = line;
      }
      continue;
    }
    if (isStructuralLine(flat[i], tiersPresent)) continue;
    // A gray callout-box heading (e.g. Wizard "Your Spellbook") is generic
    // class/DM sidebar prose printed after the last subclass feature, not a
    // feature — never promote it (loreweaver-6fw).
    if (tiersPresent && isCalloutBoxHeading(flat[i].height)) continue;

    const grantorKind = currentSubclass === null ? 'class' : 'subclass';
    const grantorName = currentSubclass ?? currentClass;
    const start = featureStartAt(
      flat,
      i,
      grantorKind,
      grantorName,
      anchors,
      tiersPresent,
    );
    if (start === null) continue;

    // Collect the body: every line up to the next structural anchor or the next
    // feature heading.
    const body: FlatLine[] = [];
    let j = i + 1;
    for (; j < flat.length; j++) {
      if (isStructuralLine(flat[j], tiersPresent)) break;
      // The next subclass feature's own grant-level callout box (e.g. Wizard
      // "Your Spellbook" after Overchannel) bounds this feature's body so the
      // generic class/DM sidebar does not bleed in (loreweaver-6fw).
      if (tiersPresent && isCalloutBoxHeading(flat[j].height)) break;
      if (
        featureStartAt(
          flat,
          j,
          grantorKind,
          grantorName,
          anchors,
          tiersPresent,
        ) !== null
      ) {
        break;
      }
      body.push(flat[j]);
    }

    const description = joinParagraphs(body.map((entry) => entry.line));
    if (description.length === 0) {
      throw new Error(
        `feature "${line}" at page ${page} has no description text`,
      );
    }
    const optionSourcePages = collectOptionSourcePages(body);

    // A given (grantor, name) pair may legitimately have its heading repeated
    // in the source: an in-body reference table caption that re-states the
    // feature name (e.g. Cleric's "Destroy Undead" CR-threshold table), or an
    // end-of-chapter section heading that introduces a list of options (e.g.
    // Warlock's "Eldritch Invocations" with all invocation choices listed at
    // the end of the class chapter). Both legitimately belong to the original
    // feature, so when the same anchor matches twice, merge the additional
    // body into the existing record rather than emitting a duplicate that the
    // pack writer would reject as a duplicate `feature:<class>:<name>` key.
    const key = anchorKey(grantorKind, grantorName, line);
    const existingIdx = emittedIndexByKey.get(key);
    if (existingIdx !== undefined) {
      const existing = out[existingIdx];
      out[existingIdx] = {
        ...existing,
        description: `${existing.description}\n\n${description}`.trim(),
        optionSourcePages: {
          ...(existing.optionSourcePages ?? {}),
          ...(optionSourcePages ?? {}),
        },
      };
      i = j - 1;
      continue;
    }

    emittedIndexByKey.set(key, out.length);
    out.push({
      name: line,
      grantorKind,
      grantorName,
      level: start.level,
      description,
      ...(optionSourcePages !== undefined ? { optionSourcePages } : {}),
      sourcePage: page,
    });

    // Resume scanning from the line after the body (j is the boundary line, so
    // -1 keeps it for the next iteration's anchor/heading handling).
    i = j - 1;
  }

  out.sort((a, b) => {
    if (a.name !== b.name) return a.name < b.name ? -1 : 1;
    return a.grantorName < b.grantorName
      ? -1
      : a.grantorName > b.grantorName
        ? 1
        : 0;
  });
  return out;
}
