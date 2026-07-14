/**
 * Ability-score entry and allocation domain layer (eshyra-b69j.7).
 *
 * The incremental engine (eshyra-b69j.5) already validates ability scores and
 * recomputes modifiers on every edit. This module is the UI-agnostic layer the
 * concept-first and ability-first wizard flows (eshyra-b69j.8 / .9) render on
 * top of it — the building blocks the engine deliberately does not own:
 *
 *   - {@link summarizePointBuy}: live point-buy budget (spent, remaining,
 *     per-score cost) so a player editing one score at a time sees the budget
 *     update immediately;
 *   - {@link summarizePoolAssignment} / {@link summarizeStandardArray}: placing
 *     a fixed set of values (the standard array, or a rolled set) onto the six
 *     abilities, reporting which values remain and which are misassigned;
 *   - {@link rollAbilityScoreSet}: deterministic 4d6-drop-lowest generation for
 *     the ability-first "let the dice inspire me" path;
 *   - {@link recommendClasses}: ranking classes by how well a set of scores fits
 *     their primary abilities, so ability-first can suggest classes *after*
 *     scores exist but *before* a class is chosen;
 *   - {@link parseAbilityScoreCommand}: parsing one-score-at-a-time entry
 *     commands (`str 12`, `reset`, `done`).
 *
 * Everything here is pure: no terminal I/O, no database, randomness only via an
 * injected {@link Rng}. The flows turn these structures into prompts and tables.
 */

import {
  type DiceRoll,
  parseDice,
  resolveParsedDiceRoll,
  rollDice,
  validateDiceRollEvidence,
} from '../orchestrator/dice.js';
import type { Rng } from '../orchestrator/rng.js';
import {
  ABILITY_FULL_NAMES,
  ABILITY_SCORE_NAMES,
  abilityModifier,
  abilityNameFromToken,
  POINT_BUY_BUDGET,
  pointBuyCost,
  STANDARD_ARRAY,
} from './abilities.js';
import type { AbilityScoreName } from './creation.js';
import type {
  ResolvedClassData,
  RulesPackCharacterResolver,
} from './rulesPackResolver.js';

/** Base scores keyed by ability; absent abilities are not yet entered. */
export type PartialAbilityScores = Partial<Record<AbilityScoreName, number>>;

// --- Point buy ---------------------------------------------------------------

/** One ability's contribution to the live point-buy budget. */
export interface PointBuyLine {
  readonly ability: AbilityScoreName;
  /** The entered base score, or `undefined` while unset. */
  readonly score?: number;
  /** Point cost of the score, present only when it is in the 8–15 range. */
  readonly cost?: number;
  /** True when the score is an integer within the point-buy 8–15 range. */
  readonly inRange: boolean;
}

/** Live point-buy budget for a (possibly partial) set of base scores. */
export interface PointBuySummary {
  readonly budget: number;
  /** Total cost of the in-range scores entered so far. */
  readonly spent: number;
  /** `budget - spent`; negative once the build is over budget. */
  readonly remaining: number;
  readonly overBudget: boolean;
  readonly lines: readonly PointBuyLine[];
  /** True when all six scores are in range and the build is within budget. */
  readonly complete: boolean;
}

/**
 * Compute the live point-buy budget. Out-of-range or non-integer scores carry
 * no cost (the engine reports those as field errors); they simply do not count
 * toward `spent`, so the displayed budget stays meaningful while the player
 * corrects them.
 */
export function summarizePointBuy(
  scores: PartialAbilityScores,
): PointBuySummary {
  let spent = 0;
  let inRangeCount = 0;
  const lines = ABILITY_SCORE_NAMES.map((ability): PointBuyLine => {
    const score = scores[ability];
    if (score === undefined) {
      return { ability, inRange: false };
    }
    const cost = pointBuyCost(score);
    if (cost === undefined) {
      return { ability, score, inRange: false };
    }
    spent += cost;
    inRangeCount += 1;
    return { ability, score, cost, inRange: true };
  });

  const remaining = POINT_BUY_BUDGET - spent;
  return {
    budget: POINT_BUY_BUDGET,
    spent,
    remaining,
    overBudget: remaining < 0,
    lines,
    complete: inRangeCount === ABILITY_SCORE_NAMES.length && remaining >= 0,
  };
}

// --- Fixed-pool assignment (standard array / rolled) -------------------------

/** Placement of a fixed multiset of values onto the six abilities. */
export interface PoolAssignment {
  /** The values the player may still place, in descending order. */
  readonly remainingValues: readonly number[];
  /**
   * Assigned values not drawn from the pool (or duplicated beyond the pool's
   * multiplicity), keyed by ability — the engine surfaces these as errors.
   */
  readonly invalid: PartialAbilityScores;
  /** True when every pool value is placed exactly once and nothing is invalid. */
  readonly complete: boolean;
}

/**
 * Report progress placing a fixed pool of values (the standard array, or a
 * rolled set) onto abilities. Values are consumed by multiplicity: assigning a
 * value the pool no longer has left is reported in {@link PoolAssignment.invalid}.
 */
export function summarizePoolAssignment(
  pool: readonly number[],
  scores: PartialAbilityScores,
): PoolAssignment {
  const remaining = new Map<number, number>();
  for (const value of pool) {
    remaining.set(value, (remaining.get(value) ?? 0) + 1);
  }

  const invalid: PartialAbilityScores = {};
  let assignedCount = 0;
  for (const ability of ABILITY_SCORE_NAMES) {
    const score = scores[ability];
    if (score === undefined) {
      continue;
    }
    assignedCount += 1;
    const left = remaining.get(score) ?? 0;
    if (left <= 0) {
      invalid[ability] = score;
      continue;
    }
    remaining.set(score, left - 1);
  }

  const remainingValues: number[] = [];
  for (const [value, count] of remaining) {
    for (let i = 0; i < count; i += 1) {
      remainingValues.push(value);
    }
  }
  remainingValues.sort((left, right) => right - left);

  return {
    remainingValues,
    invalid,
    complete:
      remainingValues.length === 0 &&
      Object.keys(invalid).length === 0 &&
      assignedCount === pool.length,
  };
}

/** Report progress placing the standard array (15, 14, 13, 12, 10, 8). */
export function summarizeStandardArray(
  scores: PartialAbilityScores,
): PoolAssignment {
  return summarizePoolAssignment(STANDARD_ARRAY, scores);
}

// --- Rolled scores -----------------------------------------------------------

export const ABILITY_SCORE_DICE_NOTATION = '4d6dl1';
const ABILITY_SCORE_DICE = parseDice(ABILITY_SCORE_DICE_NOTATION);

/** Canonical F1 evidence for one 4d6-drop-lowest ability roll. */
export type RolledAbilityScore = DiceRoll;

/** Roll one ability score as 4d6, dropping the single lowest die. */
export function rollAbilityScore(rng: Rng): RolledAbilityScore {
  return rollDice(ABILITY_SCORE_DICE_NOTATION, rng);
}

/**
 * Roll a full set of six ability scores (4d6 drop lowest each). The player then
 * assigns the {@link RolledAbilityScore.total}s onto abilities via
 * {@link summarizePoolAssignment}.
 */
export function rollAbilityScoreSet(rng: Rng): readonly RolledAbilityScore[] {
  return ABILITY_SCORE_NAMES.map(() => rollAbilityScore(rng));
}

/** Validate one caller-supplied or persisted ability roll at a trust boundary. */
export function validateRolledAbilityScore(roll: RolledAbilityScore): void {
  if (roll.notation !== ABILITY_SCORE_DICE_NOTATION) {
    throw new Error(
      `rolled ability evidence must use exactly ${ABILITY_SCORE_DICE_NOTATION}`,
    );
  }
  validateDiceRollEvidence(roll, ABILITY_SCORE_DICE);
}

/** Validate the complete immutable six-score pool. */
export function validateRolledAbilityScoreSet(
  rolls: readonly RolledAbilityScore[],
): void {
  if (!Array.isArray(rolls) || rolls.length !== ABILITY_SCORE_NAMES.length) {
    throw new Error('rolled ability evidence must contain exactly six rolls');
  }
  for (const roll of rolls) validateRolledAbilityScore(roll);
}

interface LegacyRolledAbilityScore {
  readonly rolls: readonly number[];
  readonly dropped: number;
  readonly total: number;
}

/** Normalize the former unindexed draft shape without trusting its drop claim. */
export function normalizeLegacyRolledAbilityScore(
  legacy: LegacyRolledAbilityScore,
): RolledAbilityScore {
  if (
    !legacy ||
    !Array.isArray(legacy.rolls) ||
    legacy.rolls.length !== 4 ||
    !legacy.rolls.every(
      (value) => Number.isSafeInteger(value) && value >= 1 && value <= 6,
    ) ||
    !Number.isSafeInteger(legacy.total)
  ) {
    throw new Error('legacy rolled ability evidence is malformed');
  }
  const canonical = resolveParsedDiceRoll(
    ABILITY_SCORE_DICE_NOTATION,
    ABILITY_SCORE_DICE,
    legacy.rolls,
  );
  if (canonical.total !== legacy.total) {
    throw new Error('legacy rolled ability total is inconsistent');
  }
  return canonical;
}

/** Canonicalize a persisted six-roll pool, including the former draft shape. */
export function normalizeRolledAbilityScoreSet(
  value: unknown,
): readonly RolledAbilityScore[] {
  if (!Array.isArray(value) || value.length !== ABILITY_SCORE_NAMES.length) {
    throw new Error('rolled ability evidence must contain exactly six rolls');
  }
  const normalized = value.map((entry) => {
    if (typeof entry !== 'object' || entry === null) {
      throw new Error('rolled ability evidence is malformed');
    }
    const record = entry as unknown as Record<string, unknown>;
    return typeof record.notation === 'string'
      ? (entry as RolledAbilityScore)
      : normalizeLegacyRolledAbilityScore(
          entry as unknown as LegacyRolledAbilityScore,
        );
  });
  validateRolledAbilityScoreSet(normalized);
  return normalized;
}

/** Shared character-creation rendering with unambiguous one-based die indices. */
export function formatRolledAbilityScore(roll: RolledAbilityScore): string {
  validateRolledAbilityScore(roll);
  const dropped = roll.droppedIndices
    .map((index, position) => `#${index + 1} [${roll.dropped[position]}]`)
    .join(', ');
  return `${roll.notation}: [${roll.rolls.join(', ')}] → kept [${roll.kept.join(', ')}], dropped die ${dropped} → ${roll.total}`;
}

// --- Class recommendations ---------------------------------------------------

/** How well a class fits a set of ability scores. */
export interface ClassRecommendation {
  readonly classKey: string;
  readonly className: string;
  /** The class's primary abilities that the character has entered scores for. */
  readonly matchedAbilities: readonly AbilityScoreName[];
  /** Sum of ability modifiers over the matched primary abilities. */
  readonly score: number;
  readonly primaryAbilities: readonly string[];
}

/** Options for {@link recommendClasses}. */
export interface RecommendClassesOptions {
  /** Cap the number of recommendations returned (after ranking). */
  readonly limit?: number;
}

/**
 * Rank classes by how well a set of ability scores fits their primary
 * abilities — the deterministic, recipe-data-driven recommendation the
 * ability-first flow uses once scores exist but no class is chosen. The match
 * score sums the ability modifiers over each class's primary abilities (absent
 * abilities contribute nothing). Ranked by match score, then by how many
 * primary abilities matched, then by class name — never by model judgment.
 */
export function recommendClasses(
  scores: PartialAbilityScores,
  resolver: RulesPackCharacterResolver,
  options: RecommendClassesOptions = {},
): readonly ClassRecommendation[] {
  const recommendations = resolver
    .listClasses()
    .map((classData) => scoreClassFit(classData, scores))
    .sort(compareRecommendations);

  return options.limit === undefined
    ? recommendations
    : recommendations.slice(0, Math.max(0, options.limit));
}

function scoreClassFit(
  classData: ResolvedClassData,
  scores: PartialAbilityScores,
): ClassRecommendation {
  const matchedAbilities: AbilityScoreName[] = [];
  let score = 0;
  for (const primary of classData.primaryAbilities) {
    const ability = abilityNameFromToken(primary);
    if (ability === undefined) {
      continue;
    }
    const value = scores[ability];
    if (value === undefined) {
      continue;
    }
    matchedAbilities.push(ability);
    score += abilityModifier(value);
  }
  return {
    classKey: classData.key,
    className: classData.name,
    matchedAbilities,
    score,
    primaryAbilities: classData.primaryAbilities,
  };
}

function compareRecommendations(
  left: ClassRecommendation,
  right: ClassRecommendation,
): number {
  if (left.score !== right.score) {
    return right.score - left.score;
  }
  if (left.matchedAbilities.length !== right.matchedAbilities.length) {
    return right.matchedAbilities.length - left.matchedAbilities.length;
  }
  return left.className.localeCompare(right.className);
}

// --- Entry commands ----------------------------------------------------------

/**
 * A parsed ability-entry command. `set` carries a resolved ability and the raw
 * numeric value (range/budget validation stays with the engine so one path
 * owns the rules); `error` carries an actionable message for unparseable input.
 */
export type AbilityScoreCommand =
  | {
      readonly kind: 'set';
      readonly ability: AbilityScoreName;
      readonly value: number;
    }
  | { readonly kind: 'reset' }
  | { readonly kind: 'done' }
  | { readonly kind: 'error'; readonly message: string };

/**
 * Parse a one-score-at-a-time entry command: `str 12`, `wisdom 14`, `reset`, or
 * `done`. Ability tokens accept the full name, canonical key, or three-letter
 * abbreviation (case-insensitively). A non-integer value yields a field-specific
 * error so the caller can echo it without consulting the engine.
 */
export function parseAbilityScoreCommand(input: string): AbilityScoreCommand {
  const trimmed = input.trim();
  if (trimmed.length === 0) {
    return {
      kind: 'error',
      message: 'Enter an ability and a score, e.g. "str 12".',
    };
  }

  const lowered = trimmed.toLowerCase();
  if (lowered === 'reset') {
    return { kind: 'reset' };
  }
  if (lowered === 'done') {
    return { kind: 'done' };
  }

  const parts = trimmed.split(/\s+/);
  if (parts.length !== 2) {
    return {
      kind: 'error',
      message: 'Enter an ability and a score, e.g. "str 12".',
    };
  }

  const [token, rawValue] = parts;
  const ability = abilityNameFromToken(token);
  if (ability === undefined) {
    return { kind: 'error', message: `Unknown ability: "${token}".` };
  }

  if (!/^[+-]?\d+$/.test(rawValue)) {
    return {
      kind: 'error',
      message: `${ABILITY_FULL_NAMES[ability]} score must be a whole number (got "${rawValue}").`,
    };
  }

  return { kind: 'set', ability, value: Number.parseInt(rawValue, 10) };
}
