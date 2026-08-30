import {
  type DiceRoll,
  parseDice,
  rollDice,
  validateDiceRollEvidence,
} from '../orchestrator/dice.js';
import type { Rng } from '../orchestrator/rng.js';
import type {
  ResolvedStartingWealth,
  RulesPackCharacterResolver,
} from './rulesPackResolver.js';
import {
  getBundledDnd5eCharacterResolver,
  STARTING_WEALTH_UNAVAILABLE_MESSAGE,
} from './rulesPackResolver.js';

export type { ResolvedStartingWealth };

export interface StartingWealthResult {
  readonly classKey: string;
  readonly formula: string;
  readonly roll: DiceRoll;
  readonly multiplierGp: number;
  readonly totalGp: number;
}

/**
 * Thrown when the active rules stack provides no starting-wealth table at all,
 * as opposed to providing one that is present but malformed. Callers that must
 * distinguish "this campaign has no starting-wealth rules" from "the pack is
 * broken" branch on this type rather than on message text.
 *
 * The bundled SRD 5.1 pack provides no such table — see
 * {@link STARTING_WEALTH_UNAVAILABLE_MESSAGE}.
 */
export class StartingWealthUnavailableError extends Error {
  constructor(message: string = STARTING_WEALTH_UNAVAILABLE_MESSAGE) {
    super(message);
    this.name = 'StartingWealthUnavailableError';
  }
}

export function resolveStartingWealth(
  classKey: string,
  resolver: RulesPackCharacterResolver = getBundledDnd5eCharacterResolver(),
): ResolvedStartingWealth {
  const result = resolver.resolveStartingWealth(classKey);
  if (!result.ok) {
    if (!resolver.startingWealthAvailable()) {
      throw new StartingWealthUnavailableError(result.message);
    }
    throw new Error(result.message);
  }
  return result.record;
}

export function rollStartingWealth(
  classKey: string,
  rng: Rng,
  resolver: RulesPackCharacterResolver = getBundledDnd5eCharacterResolver(),
): StartingWealthResult {
  const resolved = resolveStartingWealth(classKey, resolver);
  const roll = rollDice(resolved.formula, rng);
  const parsed = parseDice(resolved.formula);
  validateDiceRollEvidence(roll, parsed);
  if (
    !Number.isSafeInteger(resolved.multiplierGp) ||
    resolved.multiplierGp <= 0 ||
    !Number.isSafeInteger(roll.total) ||
    roll.total < 0 ||
    roll.total > Math.floor(Number.MAX_SAFE_INTEGER / resolved.multiplierGp)
  ) {
    throw new Error(
      'starting-wealth multiplication exceeds safe integer range',
    );
  }
  const result = {
    classKey,
    formula: resolved.formula,
    roll,
    multiplierGp: resolved.multiplierGp,
    totalGp: roll.total * resolved.multiplierGp,
  };
  validateStartingWealthResult(result, resolver);
  return result;
}

export function validateStartingWealthResult(
  result: StartingWealthResult,
  resolver: RulesPackCharacterResolver = getBundledDnd5eCharacterResolver(),
): void {
  if (
    typeof result !== 'object' ||
    result === null ||
    typeof result.classKey !== 'string' ||
    typeof result.formula !== 'string'
  ) {
    throw new Error('starting-wealth roll evidence is malformed');
  }
  const current = resolveStartingWealth(result.classKey, resolver);
  const parsed = parseDice(current.formula);
  const roll = result.roll;
  validateDiceRollEvidence(roll, parsed);
  if (
    result.formula !== current.formula ||
    result.multiplierGp !== current.multiplierGp ||
    !Number.isSafeInteger(result.multiplierGp) ||
    result.multiplierGp <= 0 ||
    !Number.isSafeInteger(result.totalGp) ||
    result.totalGp < 0 ||
    roll.total > Math.floor(Number.MAX_SAFE_INTEGER / result.multiplierGp) ||
    result.totalGp !== roll.total * result.multiplierGp
  ) {
    throw new Error('starting-wealth roll evidence is inconsistent');
  }
}
