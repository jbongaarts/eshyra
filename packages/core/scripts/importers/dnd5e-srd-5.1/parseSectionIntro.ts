/**
 * Generic "section intro prose" parser for the D&D 5e SRD 5.1 importer
 * (eshyra-g9im).
 *
 * Several SRD chapters and appendices open with body prose BEFORE their first
 * heading-tier child section, and the section slicer drops the chapter/appendix
 * title (it is the slice's start anchor). That leaves the intro as header-less
 * body prose with no heading tier, which the heading-hierarchy rule parser
 * (`parseRules`) cannot emit — a single-height slice falls to its text
 * heuristic, which yields nothing for header-less prose. The result was that
 * gameplay-relevant intro prose (the optional Feats rule p75, the general
 * Conditions rules p358, the Using Ability Scores chapter intro p76, the
 * Appendix MM-B preamble p395) was silently hidden behind
 * `ignored:document-structure` source coverage.
 *
 * This parser captures the LEADING body prose of an already-bounded section
 * slice as a single `rule` record, stopping at the first heading-height line
 * (the section's first child heading). Naming the rule after its chapter/
 * appendix heading lets the source-coverage evaluator auto-match the heading to
 * the emitted record (the same mechanism `parseMiscellaneousCreaturesIntro`
 * relies on for Appendix MM-A), so the heading resolves to `record:rule:<slug>`
 * instead of `ignored:document-structure`.
 *
 * Mirrors `parseMiscellaneousCreaturesIntro` (which captures the MM-A intro from
 * a pre-truncated slice) and `parseSelfSufficiency`, but bounds the intro region
 * by font height rather than requiring the caller to truncate before a known
 * first-entry name.
 */

import type { PageText, RuleExtraction } from './types.js';

/**
 * Rendered max font height (PDF user-space points) at/above which a line is
 * treated as a heading that ENDS the leading-intro region. Matches
 * `LEAF_MIN_H` in `parseRules.ts`: SRD 5.1 body prose renders at h≈9.8 while
 * the shallowest child headings these intros stop at render at h≈12.0
 * (Conditions "Blinded" leaf) up through h≈13.9 (Feats "Grappler", MM-B
 * "Customizing NPCs") and h≈18 (Using Ability Scores "Ability Scores and
 * Modifiers" subsection), so the cut sits in the gap above body prose.
 */
const HEADING_MIN_HEIGHT = 11.5;

export interface SectionIntroOptions {
  /** Record name; should match the source heading so coverage auto-matches. */
  readonly name: string;
  /** Record key slug (the part after `rule:`). */
  readonly keySlug: string;
  /**
   * Override the heading-height cut. Lines at/above this height end the intro
   * region. Defaults to {@link HEADING_MIN_HEIGHT}.
   */
  readonly headingMinHeight?: number;
}

/**
 * Re-flow wrapped prose lines into one paragraph, joining soft line-break
 * hyphenation (a line ending in `-` followed by a lowercase continuation).
 * Shared with `parseMiscellaneousCreaturesIntro`.
 */
export function reflowProse(lines: readonly string[]): string {
  const parts: string[] = [];
  for (const raw of lines) {
    const part = raw.replace(/\s+/g, ' ').trim();
    if (part.length === 0) continue;
    if (
      parts.length > 0 &&
      parts[parts.length - 1].endsWith('-') &&
      /^[a-z]/.test(part)
    ) {
      parts[parts.length - 1] = parts[parts.length - 1].slice(0, -1) + part;
    } else {
      parts.push(part);
    }
  }
  return parts.join(' ').trim();
}

/**
 * Capture the leading body prose of `pages` (up to the first heading-height
 * line) as a single `rule` record.
 *
 * Emission REQUIRES that a heading-height line was actually found to bound the
 * intro: this is a heading-hierarchy feature, so it degrades to undefined when
 * the slice carries no font-height structure (uniform-font fixture PDFs, whose
 * lines have no `lineHeights` — the same degradation as `parseRules`'
 * `chapterIntro`) and, on a real slice, refuses to run on past the section's
 * first child heading and swallow child content. Also returns undefined when
 * the slice opens directly with a heading (empty intro) or carries no leading
 * prose.
 */
export function parseSectionIntro(
  pages: readonly PageText[],
  options: SectionIntroOptions,
): RuleExtraction | undefined {
  const headingMinHeight = options.headingMinHeight ?? HEADING_MIN_HEIGHT;
  const introLines: string[] = [];
  let sourcePage: number | undefined;
  let boundaryFound = false;
  outer: for (const page of pages) {
    for (let i = 0; i < page.lines.length; i++) {
      const height = page.lineHeights?.[i];
      if (height !== undefined && height >= headingMinHeight) {
        boundaryFound = true;
        break outer;
      }
      const line = page.lines[i];
      if (sourcePage === undefined && line.trim().length > 0) {
        sourcePage = page.pageNumber;
      }
      introLines.push(line);
    }
  }
  if (!boundaryFound) return undefined;
  const text = reflowProse(introLines);
  if (text.length === 0 || sourcePage === undefined) return undefined;
  return {
    name: options.name,
    keySlug: options.keySlug,
    text,
    sourcePage,
  };
}
