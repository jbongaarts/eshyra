/**
 * Focused prose-rule extraction for the SRD 5.1 Madness and Objects sections.
 *
 * These sections need behavior outside the generic heading-hierarchy parser:
 * Madness emits its section introduction as a named root rule, while Objects
 * consolidates prose from both physical columns and excludes two reconstructed
 * table blocks. The rules and exclusions here are intentionally source-shaped.
 */

import { composedByField, hasInteriorRemoval } from './proseComposition.js';
import type { PageText, RuleExtraction } from './types.js';

interface FlatLine {
  readonly line: string;
  readonly page: number;
  readonly height?: number;
}

function flatten(pages: readonly PageText[]): FlatLine[] {
  const out: FlatLine[] = [];
  for (const page of pages) {
    for (let i = 0; i < page.lines.length; i++) {
      out.push({
        line: page.lines[i],
        page: page.pageNumber,
        height: page.lineHeights?.[i],
      });
    }
  }
  return out;
}

function joinWrappedLines(lines: readonly string[]): string {
  let out = '';
  for (const raw of lines) {
    const line = raw.replace(/\s+/g, ' ').trim();
    if (line.length === 0) continue;
    if (out.endsWith('-') && /^[a-z]/.test(line)) {
      out += line;
    } else {
      out += `${out.length === 0 ? '' : ' '}${line}`;
    }
  }
  return out;
}

function findHeading(flat: readonly FlatLine[], name: string): number {
  const heights = flat
    .map(({ height }) => height)
    .filter((height): height is number => height !== undefined);
  const hasHeadingTiers =
    new Set(heights).size > 1 && heights.some((height) => height >= 13);
  return flat.findIndex(
    ({ line, height }) =>
      line.trim() === name &&
      (hasHeadingTiers === false || height === undefined || height >= 13),
  );
}

function buildRule(
  name: string,
  keySlug: string,
  lines: readonly FlatLine[],
  sourcePage: number,
): RuleExtraction | undefined {
  const text = joinWrappedLines(lines.map(({ line }) => line));
  if (text.length === 0) return undefined;
  return { name, keySlug, text, sourcePage };
}

function parseMadnessRules(
  pages: readonly PageText[],
): readonly RuleExtraction[] {
  const flat = flatten(pages);
  if (flat.length === 0) return [];

  const goingMadIdx = findHeading(flat, 'Going Mad');
  const effectsIdx = findHeading(flat, 'Madness Effects');
  const shortTermTableIdx = flat.findIndex(
    ({ line }) => line.trim() === 'Short-Term Madness',
  );
  const curingIdx = findHeading(flat, 'Curing Madness');
  const rules: RuleExtraction[] = [];

  if (goingMadIdx > 0) {
    const rule = buildRule(
      'Madness',
      'madness',
      flat.slice(0, goingMadIdx),
      flat[0].page,
    );
    if (rule !== undefined) rules.push(rule);
  }
  if (goingMadIdx >= 0 && effectsIdx > goingMadIdx) {
    const rule = buildRule(
      'Going Mad',
      'going-mad',
      flat.slice(goingMadIdx + 1, effectsIdx),
      flat[goingMadIdx].page,
    );
    if (rule !== undefined) rules.push(rule);
  }
  if (effectsIdx >= 0 && shortTermTableIdx > effectsIdx) {
    const rule = buildRule(
      'Madness Effects',
      'madness-effects',
      flat.slice(effectsIdx + 1, shortTermTableIdx),
      flat[effectsIdx].page,
    );
    if (rule !== undefined) rules.push(rule);
  }
  if (curingIdx >= 0) {
    const rule = buildRule(
      'Curing Madness',
      'curing-madness',
      flat.slice(curingIdx + 1),
      flat[curingIdx].page,
    );
    if (rule !== undefined) rules.push(rule);
  }
  return rules;
}

const OBJECT_TABLE_LINE =
  /^(?:Object Armor Class|Substance AC|Cloth, paper, rope 11|Crystal, glass, ice 13|Wood, bone 15|Stone 17|Iron, steel 19|Mithral 21|Adamantine 23|Object Hit Points|Size|Tiny \(bottle, lock\)|Small \(chest, lute\)|Medium \(barrel, chandelier\)|Large \(cart, 10-ft\.-by-10-ft\. window\)|Fragile Resilient|\d+ \(\d+d\d+\) \d+ \(\d+d\d+\))$/i;
const OBJECT_HIT_POINTS_INLINE_TABLE_LINE =
  /^(?:Size Fragile Resilient|(?:Tiny|Small|Medium|Large) \([^)]*\) \d+ \(\d+d\d+\) \d+ \(\d+d\d+\))$/i;

function parseObjectsRule(
  pages: readonly PageText[],
): RuleExtraction | undefined {
  const flat = flatten(pages);
  if (flat.length === 0) return undefined;
  const isKept = ({ line }: FlatLine): boolean => {
    const text = line.trim();
    return (
      !OBJECT_TABLE_LINE.test(text) &&
      !OBJECT_HIT_POINTS_INLINE_TABLE_LINE.test(text)
    );
  };
  const prose = flat.filter(isKept);
  const rule = buildRule('Objects', 'objects', prose, flat[0].page);
  if (rule === undefined) return undefined;
  // The two reconstructed table blocks are removed from the middle of the
  // section's prose (eshyra-o9bd.19.6.7.10, A3-F2).
  const interiorRemoval = hasInteriorRemoval(
    flat.map((line) => ({ text: line.line, kept: isKept(line) })),
  );
  return { ...rule, ...composedByField({ interiorRemoval }) };
}

export function parseGamemasteringRules(
  madnessPages: readonly PageText[],
  objectPages: readonly PageText[],
): RuleExtraction[] {
  const rules = [...parseMadnessRules(madnessPages)];
  const objects = parseObjectsRule(objectPages);
  if (objects !== undefined) rules.push(objects);
  rules.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  return rules;
}
