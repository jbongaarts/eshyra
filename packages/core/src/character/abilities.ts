/**
 * Shared D&D 5e ability-score math (eshyra-b69j.5).
 *
 * The ability-score constants and modifier formula are pure rules truth used in
 * three places — the whole-draft validator (`creation.ts`), the recipe's
 * derived-value hook (`dnd5eRecipe.ts`), and the incremental draft engine
 * (`characterDraft.ts`). Keeping them here is the single source so the three
 * paths cannot drift.
 */

import type { AbilityScoreName } from './creation.js';

/** The six ability scores, in canonical display order. */
export const ABILITY_SCORE_NAMES: readonly AbilityScoreName[] = [
  'strength',
  'dexterity',
  'constitution',
  'intelligence',
  'wisdom',
  'charisma',
];

/** Bounds for ability scores stored in the generic live character state. */
export const LIVE_STATE_MIN_ABILITY_SCORE = 1;
export const LIVE_STATE_MAX_ABILITY_SCORE = 30;

export function isValidLiveStateAbilityScore(value: unknown): value is number {
  return (
    typeof value === 'number' &&
    Number.isFinite(value) &&
    Number.isInteger(value) &&
    value >= LIVE_STATE_MIN_ABILITY_SCORE &&
    value <= LIVE_STATE_MAX_ABILITY_SCORE
  );
}

/** Point-buy cost per base score (8–15), before ancestry bonuses. */
export const POINT_BUY_COSTS: ReadonlyMap<number, number> = new Map([
  [8, 0],
  [9, 1],
  [10, 2],
  [11, 3],
  [12, 4],
  [13, 5],
  [14, 7],
  [15, 9],
]);

/** Total point-buy budget for the standard 27-point build. */
export const POINT_BUY_BUDGET = 27;

/** The standard array, highest first. */
export const STANDARD_ARRAY: readonly number[] = [15, 14, 13, 12, 10, 8];

/**
 * Plausibility bounds for `manual` / `rolled` base scores (before ancestry
 * bonuses). Those methods carry no point-buy/standard-array total constraint —
 * the player or the dice are the authority — so this is only a typo guard that
 * still admits the full 4d6-drop-lowest range (3–18) and hand-entered imports.
 */
export const FREE_ENTRY_MIN_SCORE = 1;
export const FREE_ENTRY_MAX_SCORE = 20;

/** Display (full) name for each ability score, as stored on class records. */
export const ABILITY_FULL_NAMES: Readonly<Record<AbilityScoreName, string>> = {
  strength: 'Strength',
  dexterity: 'Dexterity',
  constitution: 'Constitution',
  intelligence: 'Intelligence',
  wisdom: 'Wisdom',
  charisma: 'Charisma',
};

/** Three-letter abbreviation for each ability score (entry-command shorthand). */
export const ABILITY_ABBREVIATIONS: Readonly<Record<AbilityScoreName, string>> =
  {
    strength: 'str',
    dexterity: 'dex',
    constitution: 'con',
    intelligence: 'int',
    wisdom: 'wis',
    charisma: 'cha',
  };

const ABILITY_NAME_BY_TOKEN: ReadonlyMap<string, AbilityScoreName> = new Map(
  ABILITY_SCORE_NAMES.flatMap((name) => [
    [name, name] as const,
    [ABILITY_ABBREVIATIONS[name], name] as const,
    [ABILITY_FULL_NAMES[name].toLowerCase(), name] as const,
  ]),
);

/**
 * Resolve a user-typed ability token (full name, canonical key, or three-letter
 * abbreviation, case-insensitively) to a canonical {@link AbilityScoreName}.
 */
export function abilityNameFromToken(
  token: string,
): AbilityScoreName | undefined {
  return ABILITY_NAME_BY_TOKEN.get(token.trim().toLowerCase());
}

/** D&D 5e ability modifier for a final score. */
export function abilityModifier(score: number): number {
  return Math.floor((score - 10) / 2);
}

/** Point-buy cost of a base score, or `undefined` if out of the 8–15 range. */
export function pointBuyCost(score: number): number | undefined {
  return POINT_BUY_COSTS.get(score);
}

/** True when a `manual`/`rolled` base score is an integer within plausible bounds. */
export function isPlausibleFreeEntryScore(score: number): boolean {
  return (
    Number.isInteger(score) &&
    score >= FREE_ENTRY_MIN_SCORE &&
    score <= FREE_ENTRY_MAX_SCORE
  );
}
