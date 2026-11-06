/**
 * Producer-side reporting of composed prose (eshyra-o9bd.19.6.7.10, A3-F1/F2).
 *
 * `source-prose` is the only provenance class a consumer may present as a
 * verbatim quotation. A producer that removes printed lines from the interior
 * of a field, or joins printed bullets with their glyphs removed, no longer
 * emits one contiguous quotation. This module is the shared vocabulary those
 * producers use to REPORT that, so `emit.ts` can derive scoped `source-derived`
 * declarations from the reports (the o9bd.16.7.2/.7.5 mechanism) instead of
 * anyone hand-listing records.
 *
 * A removal at the very start or very end of a field leaves a contiguous
 * quotation and is NOT reported; whitespace, hyphenation and glyph-encoding
 * differences against the extraction are layout, not composition.
 */

import type { ProseCompositionCause } from './types.js';

export type { ProseCompositionCause } from './types.js';

/**
 * Is there a removed non-blank line with kept non-blank text both before and
 * after it? `lines` is the sequence of source lines in reading order, each
 * flagged `kept` (it contributes to the emitted text) or removed.
 */
export function hasInteriorRemoval(
  lines: readonly { readonly text: string; readonly kept: boolean }[],
): boolean {
  let lastKept: string | undefined;
  let removedAfterSentence = false;
  for (const line of lines) {
    const text = line.text.trim();
    if (text.length === 0) continue;
    if (line.kept) {
      if (removedAfterSentence) return true;
      lastKept = text;
    } else if (lastKept !== undefined && endsPrintedSentence(lastKept)) {
      removedAfterSentence = true;
    }
  }
  return false;
}

/**
 * Does `text` end a printed sentence? Rows removed right after a sentence end
 * were printed between two sentences. A removal in the middle of a sentence is
 * column-flow interleaving of another table's cells into the extraction order
 * (the printed prose is one contiguous passage, e.g. Weapon Proficiency "Most
 * people / [armor table cells] / can use simple weapons"), which is layout, not
 * composition.
 */
export function endsPrintedSentence(text: string): boolean {
  return /[.!?:]["”’')\]]*$/.test(text.trim());
}

/** The `composedBy` value a producer attaches to an extraction (absent when none). */
export function composedByField(causes: {
  readonly interiorRemoval?: boolean;
  readonly bulletJoin?: boolean;
}): { readonly composedBy?: readonly ProseCompositionCause[] } {
  const out: ProseCompositionCause[] = [];
  if (causes.interiorRemoval === true) out.push('interior-removal');
  if (causes.bulletJoin === true) out.push('bullet-join');
  return out.length > 0 ? { composedBy: out } : {};
}

const BULLET_MARKER = /^[•\-*]\s+/;

/**
 * Re-flow wrapped body lines into paragraphs, stripping per-line bullet
 * markers, and report whether a marker was dropped from anywhere other than
 * the first text line (a lone leading glyph is a trim; a glyph removed
 * between two printed items is a join).
 */
export function joinParagraphsStrippingBullets(lines: readonly string[]): {
  readonly text: string;
  readonly bulletJoin: boolean;
} {
  const paragraphs: string[] = [];
  let current: string[] = [];
  let seenText = false;
  let bulletJoin = false;
  for (const raw of lines) {
    const line = raw.trim();
    if (line.length === 0) {
      if (current.length > 0) {
        paragraphs.push(current.join(' '));
        current = [];
      }
      continue;
    }
    const stripped = line.replace(BULLET_MARKER, '');
    if (stripped !== line && seenText) bulletJoin = true;
    seenText = true;
    current.push(stripped);
  }
  if (current.length > 0) paragraphs.push(current.join(' '));
  return { text: paragraphs.join('\n\n').trim(), bulletJoin };
}
