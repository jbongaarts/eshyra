import type { DiceRoll } from '../orchestrator/dice.js';
import { parseDice, rollDice } from '../orchestrator/dice.js';
import type { Rng } from '../orchestrator/rng.js';

export interface ResolvedStartingWealth {
  readonly classKey: string;
  readonly formula: string;
  readonly multiplierGp: number;
  readonly sourceRef: string;
}

// Source-backed SRD 5.1 Starting Wealth by Class table (p. 38). This is a
// typed projection of the committed pack table; gameplay never parses prose.
const STARTING_WEALTH: Readonly<Record<string, ResolvedStartingWealth>> = {
  'class:barbarian': {
    classKey: 'class:barbarian',
    formula: '2d4',
    multiplierGp: 10,
    sourceRef: 'table:starting-wealth-by-class',
  },
  'class:bard': {
    classKey: 'class:bard',
    formula: '5d4',
    multiplierGp: 10,
    sourceRef: 'table:starting-wealth-by-class',
  },
  'class:cleric': {
    classKey: 'class:cleric',
    formula: '5d4',
    multiplierGp: 10,
    sourceRef: 'table:starting-wealth-by-class',
  },
  'class:druid': {
    classKey: 'class:druid',
    formula: '2d4',
    multiplierGp: 10,
    sourceRef: 'table:starting-wealth-by-class',
  },
  'class:fighter': {
    classKey: 'class:fighter',
    formula: '5d4',
    multiplierGp: 10,
    sourceRef: 'table:starting-wealth-by-class',
  },
  'class:monk': {
    classKey: 'class:monk',
    formula: '5d4',
    multiplierGp: 1,
    sourceRef: 'table:starting-wealth-by-class',
  },
  'class:paladin': {
    classKey: 'class:paladin',
    formula: '5d4',
    multiplierGp: 10,
    sourceRef: 'table:starting-wealth-by-class',
  },
  'class:ranger': {
    classKey: 'class:ranger',
    formula: '5d4',
    multiplierGp: 10,
    sourceRef: 'table:starting-wealth-by-class',
  },
  'class:rogue': {
    classKey: 'class:rogue',
    formula: '4d4',
    multiplierGp: 10,
    sourceRef: 'table:starting-wealth-by-class',
  },
  'class:sorcerer': {
    classKey: 'class:sorcerer',
    formula: '3d4',
    multiplierGp: 10,
    sourceRef: 'table:starting-wealth-by-class',
  },
  'class:warlock': {
    classKey: 'class:warlock',
    formula: '4d4',
    multiplierGp: 10,
    sourceRef: 'table:starting-wealth-by-class',
  },
  'class:wizard': {
    classKey: 'class:wizard',
    formula: '4d4',
    multiplierGp: 10,
    sourceRef: 'table:starting-wealth-by-class',
  },
};

export function resolveStartingWealth(
  classKey: string,
): ResolvedStartingWealth {
  const row = STARTING_WEALTH[classKey];
  if (row === undefined)
    throw new Error(`no starting-wealth row for ${classKey}`);
  const parsed = parseDice(row.formula);
  if (
    parsed.count < 1 ||
    parsed.faces < 2 ||
    parsed.modifier !== 0 ||
    parsed.keep !== undefined
  ) {
    throw new Error(`malformed starting-wealth formula for ${classKey}`);
  }
  return row;
}

export function validateStartingWealthResult(result: {
  readonly classKey: string;
  readonly formula: string;
  readonly roll: DiceRoll;
  readonly multiplierGp: number;
  readonly totalGp: number;
}): void {
  const current = resolveStartingWealth(result.classKey);
  const parsed = parseDice(current.formula);
  if (
    result.formula !== current.formula ||
    result.multiplierGp !== current.multiplierGp ||
    result.roll.notation.replace(/\s+/g, '') !== current.formula ||
    result.roll.count !== parsed.count ||
    result.roll.faces !== parsed.faces ||
    result.roll.modifier !== 0 ||
    result.roll.keep !== undefined ||
    result.roll.rolls.length !== result.roll.count ||
    result.roll.kept.length !== result.roll.count ||
    result.roll.natural !== result.roll.rolls.reduce((a, b) => a + b, 0) ||
    result.roll.total !== result.roll.natural ||
    result.totalGp !== result.roll.total * result.multiplierGp
  ) {
    throw new Error('starting-wealth roll evidence is inconsistent');
  }
}

export function rollStartingWealth(
  classKey: string,
  rng: Rng,
): import('./characterDraft.js').StartingWealthResult {
  const resolved = resolveStartingWealth(classKey);
  const roll = rollDice(resolved.formula, rng);
  const result = {
    classKey,
    formula: resolved.formula,
    roll,
    multiplierGp: resolved.multiplierGp,
    totalGp: roll.total * resolved.multiplierGp,
  };
  validateStartingWealthResult(result);
  return result;
}
