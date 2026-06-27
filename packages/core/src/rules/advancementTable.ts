/**
 * XP advancement-threshold resolver over the generated rules pack
 * (eshyra-lupf.4). Design: docs/design/character-progression.md.
 *
 * XP-mode advancement reads its level → XP thresholds from canonical pack data:
 * the SRD ships a `table:character-advancement` record (the Character
 * Advancement table, SRD 5.1 p. 56) with one row per level 1–20. Thresholds are
 * resolved from that record here — never hardcoded or overlaid — so the numbers
 * stay in sync with the audited pack.
 *
 * This module mirrors the character-creation resolver pattern
 * (`character/rulesPackResolver.ts`): it hides the generated-pack lookup
 * mechanics and narrows the `data: unknown` table shape once, through typed
 * guards, so callers (eligibility .7, awards .6, the level-up engine .8) receive
 * a concrete, sorted threshold table and pure lookup helpers.
 */

import { getBundledDnd5eSrdPack } from './bundledSrdPack.js';
import { lookupRulesRecord } from './lookup.js';
import { type ResolvedRulesStack, resolveRulesStack } from './stack.js';

/** Canonical key of the Character Advancement table in the SRD pack. */
export const ADVANCEMENT_TABLE_REF = 'table:character-advancement';

const XP_COLUMN = 'Experience Points';
const LEVEL_COLUMN = 'Level';
const PROFICIENCY_BONUS_COLUMN = 'Proficiency Bonus';

/** One resolved row of the advancement table: a level and its XP threshold. */
export interface AdvancementThreshold {
  readonly level: number;
  /** Minimum cumulative XP required to reach this level. */
  readonly xpThreshold: number;
  /** Proficiency bonus at this level, parsed to an integer (e.g. `+2` → 2). */
  readonly proficiencyBonus: number;
}

/** The resolved advancement table: thresholds sorted ascending by level. */
export interface ResolvedAdvancementTable {
  readonly thresholds: readonly AdvancementThreshold[];
}

/**
 * Outcome of resolving the advancement table. `malformed` means the record
 * exists but its generated `data` did not match the expected table shape — a
 * pack/importer defect the caller should surface, not a user error.
 */
export type AdvancementTableResolution =
  | { readonly ok: true; readonly table: ResolvedAdvancementTable }
  | {
      readonly ok: false;
      readonly code: 'not_found' | 'malformed';
      readonly message: string;
    };

export class AdvancementTableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AdvancementTableError';
  }
}

/**
 * Resolve the Character Advancement table from a rules stack into a typed,
 * level-sorted threshold table.
 */
export function resolveAdvancementTable(
  stack: ResolvedRulesStack,
): AdvancementTableResolution {
  const result = lookupRulesRecord(stack, {
    kind: 'table',
    ref: ADVANCEMENT_TABLE_REF,
  });
  if (!result.ok) {
    return {
      ok: false,
      code: 'not_found',
      message: `No advancement table '${ADVANCEMENT_TABLE_REF}' in the rules stack.`,
    };
  }
  return parseAdvancementTable(result.record.data, result.record.key);
}

let cachedTable: ResolvedAdvancementTable | undefined;

/**
 * The advancement table from the bundled D&D 5e SRD 5.1 pack, resolved once and
 * cached (reusing the pack cache in `bundledSrdPack.ts`).
 *
 * @throws {AdvancementTableError} if the bundled pack's table is missing or
 *   malformed — that is an audited-pack defect, not a recoverable runtime state.
 */
export function getBundledAdvancementTable(): ResolvedAdvancementTable {
  if (cachedTable !== undefined) {
    return cachedTable;
  }
  const resolution = resolveAdvancementTable(
    resolveRulesStack({ base: getBundledDnd5eSrdPack() }),
  );
  if (!resolution.ok) {
    throw new AdvancementTableError(
      `bundled SRD advancement table is unavailable: ${resolution.message}`,
    );
  }
  cachedTable = resolution.table;
  return cachedTable;
}

/**
 * The XP threshold required to reach `level`, or `undefined` when the level is
 * not in the table.
 */
export function xpThresholdForLevel(
  table: ResolvedAdvancementTable,
  level: number,
): number | undefined {
  return table.thresholds.find((row) => row.level === level)?.xpThreshold;
}

/**
 * The highest level whose XP threshold is at or below `xp`. Clamps to the
 * lowest tabulated level (1 in the SRD) for XP below the first threshold.
 */
export function levelForXp(
  table: ResolvedAdvancementTable,
  xp: number,
): number {
  let level = table.thresholds[0]?.level ?? 1;
  for (const row of table.thresholds) {
    if (xp >= row.xpThreshold) {
      level = row.level;
    } else {
      break;
    }
  }
  return level;
}

/** The highest level the table tabulates. */
export function maxAdvancementLevel(table: ResolvedAdvancementTable): number {
  return table.thresholds[table.thresholds.length - 1]?.level ?? 1;
}

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

function parseAdvancementTable(
  data: unknown,
  key: string,
): AdvancementTableResolution {
  if (!isRecord(data)) {
    return malformed(key, 'table data is not an object');
  }
  const { columns, rows } = data;
  if (!isStringArray(columns)) {
    return malformed(key, 'table is missing a string `columns` array');
  }
  if (!Array.isArray(rows)) {
    return malformed(key, 'table is missing a `rows` array');
  }

  const xpIndex = columns.indexOf(XP_COLUMN);
  const levelIndex = columns.indexOf(LEVEL_COLUMN);
  const profIndex = columns.indexOf(PROFICIENCY_BONUS_COLUMN);
  if (xpIndex === -1 || levelIndex === -1 || profIndex === -1) {
    return malformed(
      key,
      `table columns must include '${XP_COLUMN}', '${LEVEL_COLUMN}', and '${PROFICIENCY_BONUS_COLUMN}'`,
    );
  }

  const thresholds: AdvancementThreshold[] = [];
  for (const row of rows) {
    if (!Array.isArray(row)) {
      return malformed(key, 'a table row is not an array');
    }
    const level = row[levelIndex];
    const xpThreshold = row[xpIndex];
    const proficiencyBonus = parseProficiencyBonus(row[profIndex]);
    if (
      !isNonNegativeInteger(level) ||
      level < 1 ||
      !isNonNegativeInteger(xpThreshold) ||
      proficiencyBonus === undefined
    ) {
      return malformed(key, `row for level ${String(level)} is malformed`);
    }
    thresholds.push({ level, xpThreshold, proficiencyBonus });
  }

  thresholds.sort((a, b) => a.level - b.level);

  // Levels must be unique and contiguous, and XP thresholds strictly increasing
  // with level — otherwise eligibility lookups would be ambiguous.
  for (let i = 0; i < thresholds.length; i++) {
    if (thresholds[i].level !== i + 1) {
      return malformed(
        key,
        `levels must run 1..N with no gaps (found ${thresholds[i].level} at position ${i + 1})`,
      );
    }
    if (i > 0 && thresholds[i].xpThreshold <= thresholds[i - 1].xpThreshold) {
      return malformed(
        key,
        `XP thresholds must strictly increase with level (level ${thresholds[i].level})`,
      );
    }
  }
  if (thresholds.length === 0) {
    return malformed(key, 'table has no rows');
  }

  return { ok: true, table: { thresholds } };
}

function parseProficiencyBonus(value: unknown): number | undefined {
  if (isNonNegativeInteger(value)) {
    return value;
  }
  if (typeof value !== 'string') {
    return undefined;
  }
  const match = /^\+?(\d+)$/.exec(value.trim());
  return match === null ? undefined : Number.parseInt(match[1], 10);
}

function malformed(key: string, reason: string): AdvancementTableResolution {
  return {
    ok: false,
    code: 'malformed',
    message: `Generated advancement table ${key} is malformed: ${reason}.`,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isStringArray(value: unknown): value is readonly string[] {
  return (
    Array.isArray(value) && value.every((item) => typeof item === 'string')
  );
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0;
}
