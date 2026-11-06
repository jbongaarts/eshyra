/**
 * Feat-entry parser for the D&D 5e SRD 5.1 importer.
 *
 * Input is a slice of `PageText[]` already narrowed to the feats section of
 * the SRD; output is a `FeatExtraction[]` with stable shape, sorted by name.
 *
 * Feat boundary detection uses a two-pass approach:
 *   1. Identify feat-name lines using a heuristic: a short title-case line that
 *      either appears at the start of the section / after a blank line, OR is
 *      immediately followed by a "Prerequisite(s):" line, and is not itself a
 *      "Prerequisite(s):" line or obvious body prose.
 *   2. For each identified name, collect lines up to the next feat name as the
 *      feat body, then parse out any leading "Prerequisite(s):" line and the
 *      remaining benefit text.
 *
 * The blank-line boundary alone is not enough on the real vendored SRD 5.1 PDF:
 * its Feats section (p75) opens with a 17-line intro paragraph that flows
 * directly into the lone "Grappler" name line with no intervening blank line,
 * so a pure blank-line heuristic both (a) promotes the intro's first line as a
 * feat and (b) never reaches "Grappler". The word-count guard in `isFeatName`
 * rejects multi-word prose lines like the intro, and the "Prerequisite:"
 * lookahead recovers a name line that a missing blank line would otherwise hide
 * (loreweaver-0m9.5.21). The pdfkit fixture is unaffected: its Grappler sits at
 * the slice start with no intro prose.
 *
 * The parser is deliberately conservative: it only promotes a line to a feat
 * name when the candidate passes the `isFeatName` heuristic. The caller is
 * responsible for slicing the input to the feats section (via `sliceSection`
 * in `sections.ts`).
 */

import {
  composedByField,
  joinParagraphsStrippingBullets,
} from './proseComposition.js';
import type { FeatExtraction, PageText } from './types.js';

interface FlatLine {
  readonly line: string;
  readonly page: number;
}

/**
 * pdfjs renders word-internal hyphens in the SRD 5.1 PDF as a cluster of
 * invisible presentation hyphens (U+00AD / U+2010 / U+2011) around the lone
 * ASCII hyphen — e.g. the "close-quarters" in the Grappler benefit text.
 * Collapse any run of these code points to a single ASCII hyphen so feat bodies
 * read cleanly; plain-ASCII fixture input round-trips unchanged. Mirrors the
 * same normalization in `parseSpells` / `parseCreatures`; the class is written
 * with explicit `\uXXXX` escapes so this source never embeds the invisible
 * code points the bug is about.
 */
const PDF_HYPHEN_CLUSTER_OR_HYPHEN_RUN = /[-\u00AD\u2010\u2011]+/g;

function normalizeHyphenCluster(line: string): string {
  return line.replace(PDF_HYPHEN_CLUSTER_OR_HYPHEN_RUN, '-');
}

function flatten(pages: readonly PageText[]): readonly FlatLine[] {
  const out: FlatLine[] = [];
  for (const page of pages) {
    for (const line of page.lines) {
      out.push({ line: normalizeHyphenCluster(line), page: page.pageNumber });
    }
  }
  return out;
}

// Prerequisite(s): line in the SRD (singular or plural).
const PREREQ_RE = /^Prerequisites?:\s*(.+)$/i;

function isPrereqLine(line: string): RegExpExecArray | null {
  return PREREQ_RE.exec(line.trim());
}

/**
 * True when the first non-blank line after `idx` is a "Prerequisite(s):" line.
 * A name line directly followed by a prerequisite is an unambiguous feat
 * boundary even when no blank line precedes the name (real SRD 5.1 Feats page).
 */
function nextNonBlankIsPrereq(flat: readonly FlatLine[], idx: number): boolean {
  for (let j = idx + 1; j < flat.length; j++) {
    const t = flat[j].line.trim();
    if (t.length === 0) continue;
    return isPrereqLine(t) !== null;
  }
  return false;
}

/** Feat names are short noun phrases; the SRD/PHB longest is ~4 words. */
const MAX_FEAT_NAME_WORDS = 6;

/**
 * Heuristic: a feat name is a short (<= 60 chars, <= 6 words), title-case line
 * whose first character is an uppercase letter. It must not look like a
 * "Prerequisite:" line, a bullet line, or obvious body prose (which starts with
 * "You", "While", "When", "If", "As", etc. - common benefit-text sentence
 * starters). The word-count cap rejects the SRD 5.1 Feats-section intro
 * paragraph ("A feat represents a talent or an area of expertise that …"),
 * whose first wrapped line is title-case and passes the other checks but is
 * plainly prose, not a name (loreweaver-0m9.5.21).
 */
function isFeatName(line: string): boolean {
  const t = line.trim();
  if (t.length === 0 || t.length > 60) return false;
  if (t.split(/\s+/).length > MAX_FEAT_NAME_WORDS) return false;
  if (/^[•\-*]\s/.test(t)) return false;
  if (isPrereqLine(t) !== null) return false;
  if (/^[a-z]/.test(t)) return false;
  // Body-prose starters: multi-word sentences that open with common
  // English functional words found at the start of benefit paragraphs.
  if (
    /^(You|When|While|If|As |Once|The |This |These |Each |At |Your |For |To |In |By |With |Through )/.test(
      t,
    )
  ) {
    return false;
  }
  // Accept short title-case lines: letters, digits, spaces, hyphens,
  // apostrophes, slashes, and parens (covers names like "War Caster",
  // "Dual Wielder", "Athlete", "Elemental Adept (PHB p.166)").
  return /^[A-Z][A-Za-z0-9 ,'\-:/()]+$/.test(t);
}

interface FeatEntry {
  readonly nameIdx: number;
  readonly name: string;
}

function parseFeatBody(
  name: string,
  bodyLines: readonly string[],
  sourcePage: number,
): FeatExtraction {
  let i = 0;
  let prerequisites: string | undefined;

  // Skip leading blanks.
  while (i < bodyLines.length && bodyLines[i].trim().length === 0) {
    i++;
  }

  // Optional prerequisite line.
  if (i < bodyLines.length) {
    const match = isPrereqLine(bodyLines[i]);
    if (match !== null) {
      prerequisites = match[1].trim();
      i++;
    }
  }

  const descLines = bodyLines.slice(i);
  const { text: description, bulletJoin } =
    joinParagraphsStrippingBullets(descLines);

  return {
    name,
    ...(prerequisites !== undefined ? { prerequisites } : {}),
    description: description.length > 0 ? description : name,
    ...composedByField({ bulletJoin: bulletJoin && description.length > 0 }),
    sourcePage,
  };
}

/**
 * Parse feat entries from the narrowed feats-section `PageText[]`.
 * Returns a `FeatExtraction[]` sorted by name.
 */
export function parseFeats(pages: readonly PageText[]): FeatExtraction[] {
  const flat = flatten(pages);
  if (flat.length === 0) return [];

  // First pass: identify feat-name line indices.
  // A line is treated as a feat name when it satisfies `isFeatName` AND either:
  //   - it is the first non-blank line in the section, or
  //   - the previous non-blank line was blank, or
  //   - it starts a new page (page boundary resets the boundary state), or
  //   - its next non-blank line is a "Prerequisite(s):" line.
  // The last clause recovers a name line that has no preceding blank line, as
  // on the real SRD 5.1 Feats page where "Grappler" follows the intro prose
  // directly (loreweaver-0m9.5.21). Blank-line and prerequisite signals can
  // both point at the same line; the combined condition pushes it once.
  const entries: FeatEntry[] = [];
  let prevWasBoundary = true; // treat start-of-section as after a boundary
  let currentPage = flat[0]?.page;

  for (let i = 0; i < flat.length; i++) {
    const { line, page } = flat[i];
    const trimmed = line.trim();

    // Page boundary resets the "after blank" state.
    if (page !== currentPage) {
      currentPage = page;
      prevWasBoundary = true;
    }

    if (trimmed.length === 0) {
      prevWasBoundary = true;
      continue;
    }

    if (
      isFeatName(trimmed) &&
      (prevWasBoundary || nextNonBlankIsPrereq(flat, i))
    ) {
      entries.push({ nameIdx: i, name: trimmed });
    }

    prevWasBoundary = false;
  }

  if (entries.length === 0) return [];

  // Second pass: collect body for each entry.
  const out: FeatExtraction[] = [];
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    const bodyStart = entry.nameIdx + 1;
    const bodyEnd = entries[i + 1]?.nameIdx ?? flat.length;
    const bodyLines = flat.slice(bodyStart, bodyEnd).map((f) => f.line);
    const sourcePage = flat[entry.nameIdx].page;
    out.push(parseFeatBody(entry.name, bodyLines, sourcePage));
  }

  out.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  return out;
}
