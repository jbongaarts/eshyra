/**
 * Condition-entry parser for the D&D 5e SRD 5.1 importer.
 *
 * Input is a slice of `PageText[]` already narrowed to the conditions section
 * of the SRD (e.g. "Appendix A: Conditions"); output is a
 * `ConditionExtraction[]` with stable shape, sorted by name.
 *
 * Each condition is identified by an exact match against the 15 known SRD
 * condition names. Lines preceding the first match and any lines that don't
 * fit the known-name set are silently skipped — this is safe because the
 * caller is responsible for narrowing the input to the conditions section.
 *
 * Bullet-point effects use any of the common PDF-extraction bullet markers
 * (•, -, *) followed by whitespace. Lines that start with a bullet begin a
 * new effect. Non-blank, non-heading lines that immediately follow a bullet
 * (with no blank-line separator) are appended to the preceding effect — this
 * handles the wrapped-line artifact common in pdfjs-dist output. A blank line
 * always closes the current effect and switches back to prose mode. Non-bullet
 * lines that appear before the first bullet, or after a blank line that closed
 * an effect, are treated as prose.
 *
 * Exhaustion decision: exhaustion is modeled as a single condition record
 * (not a paired `kind=table` record) whose `data.levels` carries the
 * structured level table `[{level: 1, effect: "..."}, …, {level: 6}]`.
 * Rationale: the level data is only meaningful in the context of the
 * exhaustion condition — a free-standing table record would require
 * consumers to infer the relationship by naming convention. Keeping it
 * co-located in the condition record is simpler for callers.
 *
 * Exhaustion level-table lines are recognized as `^\s*([1-6])\s+(.+)$` after
 * the table-header line (`/^(Exhaustion )?Level\s+Effect$/i`). The header is
 * consumed and not emitted. Because pdfjs-dist may extract the two-column
 * table rows as separate fragments, the parser also accepts lines of the
 * shape `^([1-6])$` (level number alone) followed by the effect on the next
 * non-blank line — the two are merged into one level entry.
 */

import { composedByField } from './proseComposition.js';
import type {
  ConditionExtraction,
  ExhaustionLevel,
  PageText,
} from './types.js';

export const CONDITION_NAMES = [
  'Blinded',
  'Charmed',
  'Deafened',
  'Exhaustion',
  'Frightened',
  'Grappled',
  'Incapacitated',
  'Invisible',
  'Paralyzed',
  'Petrified',
  'Poisoned',
  'Prone',
  'Restrained',
  'Stunned',
  'Unconscious',
] as const;

export type ConditionName = (typeof CONDITION_NAMES)[number];

const CONDITION_NAME_SET = new Set<string>(CONDITION_NAMES);

function isConditionName(line: string): line is ConditionName {
  return CONDITION_NAME_SET.has(line.trim());
}

// Bullet-marker patterns used by SRD PDF extraction.
const BULLET_RE = /^[•\-*]\s+/;

function isBulletLine(line: string): boolean {
  return BULLET_RE.test(line.trim());
}

function stripBullet(line: string): string {
  return line.trim().replace(BULLET_RE, '').trim();
}

// Exhaustion level-table header: "Level Effect", "Exhaustion Level Effect", etc.
const LEVEL_HEADER_RE = /^(Exhaustion\s+)?Level\s+Effect$/i;

// Exhaustion level row: "1 Disadvantage on ability checks" or just "1"
const LEVEL_ROW_RE = /^([1-6])\s+(.+)$/;
const LEVEL_DIGIT_RE = /^([1-6])$/;

interface FlatLine {
  readonly line: string;
  readonly page: number;
}

function flatten(pages: readonly PageText[]): readonly FlatLine[] {
  const out: FlatLine[] = [];
  for (const page of pages) {
    for (const line of page.lines) {
      out.push({ line, page: page.pageNumber });
    }
  }
  return out;
}

interface ConditionEntry {
  readonly nameIdx: number;
  readonly name: ConditionName;
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

/**
 * Parse the body lines for a single condition. Returns the structured
 * extraction: effects (bullets), description (prose), and for exhaustion, the
 * level table.
 *
 * State machine:
 *   - `inTable`: parsing the exhaustion level table.
 *   - `currentEffect`: the effect string currently being accumulated; a
 *     defined value means the last meaningful line was a bullet or its
 *     continuation. `undefined` means we are in prose mode.
 *
 * Blank lines close `currentEffect` and switch to prose mode. Non-blank,
 * non-bullet, non-header lines that follow a bullet (i.e. `currentEffect` is
 * defined) are appended to `currentEffect` rather than treated as prose.
 */
function parseConditionBody(
  name: ConditionName,
  bodyLines: readonly string[],
  sourcePage: number,
): ConditionExtraction {
  const effects: string[] = [];
  const proseLines: string[] = [];
  const levels: ExhaustionLevel[] = [];

  let inTable = false;
  let pendingLevel: number | undefined;
  let currentEffect: string | undefined;
  // Composition reporting (eshyra-o9bd.19.6.7.10): prose before a removed
  // table/bullet region and prose after it means the description is spliced.
  let proseBeforeRemoval = false;
  let removalSeen = false;
  let interiorRemoval = false;
  const notePlainProse = (): void => {
    if (removalSeen) {
      if (proseBeforeRemoval) interiorRemoval = true;
    } else {
      proseBeforeRemoval = true;
    }
  };

  function closeEffect(): void {
    if (currentEffect !== undefined) {
      effects.push(currentEffect);
      currentEffect = undefined;
    }
  }

  for (const raw of bodyLines) {
    const trimmed = raw.trim();

    if (inTable) {
      // Blank lines inside the table area are skipped.
      if (trimmed.length === 0) continue;

      // Combined row: "1 Disadvantage on ability checks"
      const combined = LEVEL_ROW_RE.exec(trimmed);
      if (combined !== null) {
        levels.push({
          level: Number.parseInt(combined[1], 10),
          effect: combined[2].trim(),
        });
        pendingLevel = undefined;
        continue;
      }
      // Level number alone (two-column PDF extraction artifact).
      const digitOnly = LEVEL_DIGIT_RE.exec(trimmed);
      if (digitOnly !== null) {
        pendingLevel = Number.parseInt(digitOnly[1], 10);
        continue;
      }
      // Effect for a pending split-column level digit.
      if (pendingLevel !== undefined) {
        levels.push({ level: pendingLevel, effect: trimmed });
        pendingLevel = undefined;
        continue;
      }
      // Not a recognized table pattern — exit table mode and fall through
      // to prose handling for this line.
      inTable = false;
    }

    // Blank line: close any open effect and mark paragraph boundary.
    if (trimmed.length === 0) {
      closeEffect();
      proseLines.push('');
      continue;
    }

    // Level-table header: begin exhaustion level table.
    if (LEVEL_HEADER_RE.test(trimmed)) {
      closeEffect();
      inTable = true;
      removalSeen = true;
      continue;
    }

    // Bullet-point: start a new effect.
    if (isBulletLine(trimmed)) {
      closeEffect();
      currentEffect = stripBullet(trimmed);
      removalSeen = true;
      continue;
    }

    // Continuation of current effect: a non-blank, non-bullet, non-header
    // line that immediately follows a bullet (or a previous continuation).
    if (currentEffect !== undefined) {
      currentEffect = `${currentEffect} ${trimmed}`;
      continue;
    }

    // Otherwise: plain prose line.
    notePlainProse();
    proseLines.push(trimmed);
  }

  closeEffect();

  // Build description: prose paragraphs take priority. For bullet-only
  // conditions (no prose), fall back to joining effects so the record always
  // carries a non-empty description.
  let description: string;
  let bulletJoin = false;
  if (proseLines.some((l) => l.length > 0)) {
    description = joinParagraphs(proseLines);
  } else {
    description = effects.join(' ');
    // Printed bullet items joined with their glyphs removed. A single bullet
    // only loses its leading glyph (a trim, still one contiguous quotation).
    bulletJoin = effects.length > 1;
  }

  // Fallback — should not happen with valid SRD input.
  if (description.length === 0) {
    description = name;
  }

  return {
    name,
    description,
    effects,
    ...(levels.length > 0 ? { levels } : {}),
    ...composedByField({ interiorRemoval, bulletJoin }),
    sourcePage,
  };
}

/**
 * Parse condition entries from the narrowed conditions-section `PageText[]`.
 * Returns a `ConditionExtraction[]` sorted by name.
 */
export function parseConditions(
  pages: readonly PageText[],
): ConditionExtraction[] {
  const flat = flatten(pages);

  // First pass: find every condition-name line.
  const entries: ConditionEntry[] = [];
  for (let i = 0; i < flat.length; i++) {
    const line = flat[i].line.trim();
    if (isConditionName(line)) {
      entries.push({ nameIdx: i, name: line as ConditionName });
    }
  }

  // Second pass: collect body for each entry.
  const out: ConditionExtraction[] = [];
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    const bodyStart = entry.nameIdx + 1;
    const bodyEnd = entries[i + 1]?.nameIdx ?? flat.length;
    const bodyLines = flat.slice(bodyStart, bodyEnd).map((f) => f.line);
    const sourcePage = flat[entry.nameIdx].page;
    out.push(parseConditionBody(entry.name, bodyLines, sourcePage));
  }

  out.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  return out;
}
