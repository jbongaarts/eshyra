/**
 * Verbatim sentence spans for the magic-item triage (eshyra-o9bd.19.4.6.6).
 *
 * An adjudicated-by-design clause carries a VERBATIM span of the item's printed
 * description. The triage layer locates the governing span by quoting a short
 * anchor from the printed text and widening it to whole sentences, so a
 * withheld typed predicate is replaced by the complete printed sentence rather
 * than a fragment that has lost a conjunct.
 */

/**
 * A single verbatim anchor (widened to its sentence) or a `[start, end]` pair
 * covering every sentence from the one holding `start` through the first one
 * holding `end` at or after it.
 */
export type SpanAnchor = string | readonly [string, string];

/** Sentence ranges `[start, end)` of `text`; every range is contiguous. */
export function sentenceRanges(text: string): readonly [number, number][] {
  const ranges: [number, number][] = [];
  // A sentence also ends before an embedded table's `d100`-style header, which
  // the importer strips from the description after compilation.
  const boundary = /[.!?][”"’)]*\s+(?=[“"(‘]?[A-Z0-9]|d\d+\b)/g;
  let start = 0;
  for (;;) {
    const match = boundary.exec(text);
    if (match === null) break;
    ranges.push([start, match.index + match[0].trimEnd().length]);
    start = match.index + match[0].length;
  }
  if (start < text.length) ranges.push([start, text.length]);
  return ranges;
}

function uniqueIndex(text: string, anchor: string, where: string): number {
  if (anchor.length === 0) throw new Error(`${where}: empty anchor`);
  const at = text.indexOf(anchor);
  if (at < 0)
    throw new Error(
      `${where}: anchor ${JSON.stringify(anchor)} is not in the printed description (${JSON.stringify(text.slice(Math.max(0, text.indexOf(anchor.slice(0, 12))), Math.max(0, text.indexOf(anchor.slice(0, 12))) + anchor.length + 20))})`,
    );
  if (text.indexOf(anchor, at + 1) >= 0)
    throw new Error(
      `${where}: anchor ${JSON.stringify(anchor)} is ambiguous in the printed description`,
    );
  return at;
}

function widen(
  text: string,
  from: number,
  to: number,
  where: string,
): readonly [number, number] {
  const touched = sentenceRanges(text).filter(([a, b]) => a < to && b > from);
  const first = touched[0];
  const last = touched[touched.length - 1];
  if (first === undefined || last === undefined)
    throw new Error(`${where}: anchor has no sentence`);
  return [first[0], last[1]];
}

function rangeOf(
  text: string,
  anchor: SpanAnchor,
  where: string,
): readonly [number, number] {
  if (typeof anchor === 'string') {
    const at = uniqueIndex(text, anchor, where);
    return widen(text, at, at + anchor.length, where);
  }
  const [start, end] = anchor;
  const from = uniqueIndex(text, start, where);
  const to = text.indexOf(end, from);
  if (to < 0)
    throw new Error(
      `${where}: range end ${JSON.stringify(end)} does not follow its start in the printed description`,
    );
  return widen(text, from, to + end.length, where);
}

/**
 * Contiguous verbatim spans covering the sentences around every anchor:
 * overlapping or directly adjacent sentence ranges merge into one span, so
 * each returned string is a substring of `text`.
 */
export function governingSpans(
  text: string,
  anchors: readonly SpanAnchor[],
  where: string,
): readonly string[] {
  const ranges = anchors
    .map((anchor) => rangeOf(text, anchor, where))
    .sort((a, b) => a[0] - b[0]);
  const merged: [number, number][] = [];
  for (const [from, to] of ranges) {
    const last = merged[merged.length - 1];
    if (last !== undefined && from <= last[1] + 1) {
      last[1] = Math.max(last[1], to);
    } else merged.push([from, to]);
  }
  return merged.map(([from, to]) => text.slice(from, to));
}
