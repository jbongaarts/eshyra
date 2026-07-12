import { type DiceRoll, parseDice, rollDice } from '../orchestrator/dice.js';
import type { Rng } from '../orchestrator/rng.js';
import type {
  ResolvedStartingWealth,
  RulesPackCharacterResolver,
} from './rulesPackResolver.js';
import { getBundledDnd5eCharacterResolver } from './rulesPackResolver.js';

export type { ResolvedStartingWealth };

export interface StartingWealthResult {
  readonly classKey: string;
  readonly formula: string;
  readonly roll: DiceRoll;
  readonly multiplierGp: number;
  readonly totalGp: number;
}

export function resolveStartingWealth(
  classKey: string,
  resolver: RulesPackCharacterResolver = getBundledDnd5eCharacterResolver(),
): ResolvedStartingWealth {
  const result = resolver.resolveStartingWealth(classKey);
  if (!result.ok) throw new Error(result.message);
  return result.record;
}

export function rollStartingWealth(
  classKey: string,
  rng: Rng,
  resolver: RulesPackCharacterResolver = getBundledDnd5eCharacterResolver(),
): StartingWealthResult {
  const resolved = resolveStartingWealth(classKey, resolver);
  const roll = rollDice(resolved.formula, rng);
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
  const current = resolveStartingWealth(result.classKey, resolver);
  const parsed = parseDice(current.formula);
  const roll = result.roll;
  if (
    result.formula !== current.formula ||
    result.multiplierGp !== current.multiplierGp ||
    roll.notation.replace(/\s+/g, '') !== current.formula ||
    roll.count !== parsed.count ||
    roll.faces !== parsed.faces ||
    roll.modifier !== 0 ||
    roll.keep !== undefined ||
    roll.rolls.length !== roll.count ||
    roll.kept.length !== roll.count ||
    roll.natural !== roll.rolls.reduce((sum, value) => sum + value, 0) ||
    roll.total !== roll.natural ||
    result.totalGp !== roll.total * result.multiplierGp
  ) {
    throw new Error('starting-wealth roll evidence is inconsistent');
  }
}
