/**
 * Parse the Equipment chapter's bounded Self-Sufficiency sidebar (SRD p73).
 *
 * The sidebar body renders at the same h≈8.9 tier as table cells, so the
 * general heading-hierarchy rule parser cannot distinguish it once the
 * section slicer removes the h≈10.8 heading. The orchestrator supplies only
 * the lines between Self-Sufficiency and Food, Drink, and Lodging.
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

export function parseSelfSufficiency(
  pages: readonly PageText[],
): RuleExtraction | undefined {
  const text = reflow(pages);
  const sourcePage = pages[0]?.pageNumber;
  if (text.length === 0 || sourcePage === undefined) return undefined;
  return {
    name: 'Self-Sufficiency',
    keySlug: 'self-sufficiency',
    text,
    sourcePage,
  };
}
