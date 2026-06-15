/**
 * Parse the Appendix MM-A: Miscellaneous Creatures intro prose (SRD p366).
 *
 * The appendix opens with two scaffolding sentences before its first creature
 * stat block ("Ape"):
 *
 *   "This appendix contains statistics for various animals, vermin, and other
 *    critters. The stat blocks are organized alphabetically by creature name."
 *
 * The section slicer removes the h≈25.9 appendix title (it is the slice's start
 * anchor), leaving the intro as pure body prose with no heading tier, so the
 * heading-hierarchy rule parser (`parseRules`, even with `chapterIntro`) cannot
 * pick it up — a single-height slice falls to the text heuristic, which emits
 * nothing for header-less prose. Earlier this text leaked into the preceding
 * creature's last action (Ogre Zombie's Morningstar) and eshyra-76b7 cut that
 * bleed; this dedicated bounded-prose parser captures it as its own `rule`
 * record instead of dropping it. The orchestrator supplies only the lines before
 * the first creature. Mirrors `parseSelfSufficiency`.
 */

import type { PageText, RuleExtraction } from './types.js';

function reflow(pages: readonly PageText[]): string {
  const parts: string[] = [];
  for (const page of pages) {
    for (const raw of page.lines) {
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
  }
  return parts.join(' ').trim();
}

export function parseMiscellaneousCreaturesIntro(
  pages: readonly PageText[],
): RuleExtraction | undefined {
  const text = reflow(pages);
  const sourcePage = pages[0]?.pageNumber;
  if (text.length === 0 || sourcePage === undefined) return undefined;
  return {
    name: 'Appendix MM-A: Miscellaneous Creatures',
    keySlug: 'appendix-mm-a-miscellaneous-creatures',
    text,
    sourcePage,
  };
}
