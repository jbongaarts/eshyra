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

/** D&D 5e ability modifier for a final score. */
export function abilityModifier(score: number): number {
  return Math.floor((score - 10) / 2);
}

/** Point-buy cost of a base score, or `undefined` if out of the 8–15 range. */
export function pointBuyCost(score: number): number | undefined {
  return POINT_BUY_COSTS.get(score);
}
