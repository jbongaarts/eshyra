/**
 * F9 deterministic non-roll formula registry (eshyra-2n1t.11).
 *
 * A fail-closed alternative to a generic expression engine: only registered,
 * SRD-verified formulas run; each validates its own typed inputs and returns
 * named outputs plus a human-readable explanation of the arithmetic. The DM
 * model chooses the inputs (a ruling); the arithmetic is code-owned (Hybrid
 * Contract). Formula texts are verified against the committed SRD pack —
 * rule keys cited per formula. See docs/dice-and-resolution.md.
 */

export class CalcError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CalcError';
  }
}

export type CalcValue = number | string | boolean;

export interface CalcResult {
  readonly formula: string;
  /** Validated inputs, echoed for the trace/audit record. */
  readonly inputs: Readonly<Record<string, CalcValue>>;
  readonly outputs: Readonly<Record<string, CalcValue>>;
  /** Human-readable arithmetic, e.g. "10 + 3 (modifiers) + 5 (advantage) = 18". */
  readonly explanation: string;
}

interface CalcArgs {
  readonly [key: string]: unknown;
}

function requireInt(
  args: CalcArgs,
  name: string,
  min: number,
  max: number,
): number {
  const value = args[name];
  if (
    typeof value !== 'number' ||
    !Number.isInteger(value) ||
    value < min ||
    value > max
  ) {
    throw new CalcError(
      `${name} must be an integer in [${min}, ${max}] (got ${JSON.stringify(value)})`,
    );
  }
  return value;
}

function optionalBool(args: CalcArgs, name: string): boolean {
  const value = args[name];
  if (value === undefined) {
    return false;
  }
  if (typeof value !== 'boolean') {
    throw new CalcError(`${name} must be a boolean when present`);
  }
  return value;
}

function optionalEnum<T extends string>(
  args: CalcArgs,
  name: string,
  allowed: readonly T[],
  fallback: T,
): T {
  const value = args[name];
  if (value === undefined) {
    return fallback;
  }
  if (typeof value !== 'string' || !allowed.includes(value as T)) {
    throw new CalcError(`${name} must be one of ${allowed.join(', ')}`);
  }
  return value as T;
}

function rejectUnknownArgs(args: CalcArgs, known: readonly string[]): void {
  for (const key of Object.keys(args)) {
    if (!known.includes(key)) {
      throw new CalcError(
        `unknown argument '${key}'; expected: ${known.join(', ')}`,
      );
    }
  }
}

interface CalcFormula {
  /** One-line description surfaced in the tool schema/description. */
  readonly description: string;
  readonly evaluate: (args: CalcArgs) => CalcResult;
}

const SIZE_CATEGORIES = [
  'tiny',
  'small',
  'medium',
  'large',
  'huge',
  'gargantuan',
] as const;
type SizeCategory = (typeof SIZE_CATEGORIES)[number];

const SIZE_CAPACITY_MULTIPLIER: Record<SizeCategory, number> = {
  tiny: 0.5,
  small: 1,
  medium: 1,
  large: 2,
  huge: 4,
  gargantuan: 8,
};

export const CALC_FORMULAS: Readonly<Record<string, CalcFormula>> =
  Object.freeze({
    // SRD rule:passive-checks — 10 + all modifiers; advantage +5,
    // disadvantage -5 (both cancel to neither, as everywhere).
    passive_score: {
      description:
        'Passive check score (passive Perception etc.): 10 + modifier, +5 with advantage / -5 with disadvantage. args: { modifier, advantage?, disadvantage? }',
      evaluate(args) {
        rejectUnknownArgs(args, ['modifier', 'advantage', 'disadvantage']);
        const modifier = requireInt(args, 'modifier', -100, 100);
        const advantage = optionalBool(args, 'advantage');
        const disadvantage = optionalBool(args, 'disadvantage');
        const adjustment = advantage === disadvantage ? 0 : advantage ? 5 : -5;
        const score = 10 + modifier + adjustment;
        return {
          formula: 'passive_score',
          inputs: { modifier, advantage, disadvantage },
          outputs: { score },
          explanation: `10 + ${modifier}${adjustment === 0 ? '' : adjustment > 0 ? ' + 5 (advantage)' : ' - 5 (disadvantage)'} = ${score}`,
        };
      },
    },
    // SRD rule:lifting-and-carrying (Str×15; push/drag/lift ×2; size
    // doubling above Medium, Tiny halves) + rule:mounts-and-vehicles
    // (vehicle pull = 5× base carrying capacity).
    carry_capacity: {
      description:
        'Carrying capacity: Strength score × 15 lb (size-adjusted); push/drag/lift ×2; vehicle pull ×5. args: { strength, size? }',
      evaluate(args) {
        rejectUnknownArgs(args, ['strength', 'size']);
        const strength = requireInt(args, 'strength', 1, 30);
        const size = optionalEnum(args, 'size', SIZE_CATEGORIES, 'medium');
        const multiplier = SIZE_CAPACITY_MULTIPLIER[size];
        const carryCapacityLb = Math.floor(strength * 15 * multiplier);
        const pushDragLiftLb = carryCapacityLb * 2;
        const vehiclePullLb = carryCapacityLb * 5;
        return {
          formula: 'carry_capacity',
          inputs: { strength, size },
          outputs: { carryCapacityLb, pushDragLiftLb, vehiclePullLb },
          explanation: `${strength} × 15${multiplier === 1 ? '' : ` × ${multiplier} (${size})`} = ${carryCapacityLb} lb carry; ×2 = ${pushDragLiftLb} lb push/drag/lift; ×5 = ${vehiclePullLb} lb vehicle pull`,
        };
      },
    },
    // SRD rule:variant-encumbrance — encumbered above 5×Str (speed -10),
    // heavily encumbered above 10×Str (speed -20 + disadvantage).
    encumbrance_thresholds: {
      description:
        'Variant-encumbrance thresholds: encumbered above 5×Str lb, heavily encumbered above 10×Str lb, maximum 15×Str lb. args: { strength }',
      evaluate(args) {
        rejectUnknownArgs(args, ['strength']);
        const strength = requireInt(args, 'strength', 1, 30);
        return {
          formula: 'encumbrance_thresholds',
          inputs: { strength },
          outputs: {
            encumberedAboveLb: strength * 5,
            heavilyEncumberedAboveLb: strength * 10,
            carryCapacityLb: strength * 15,
          },
          explanation: `5×${strength} = ${strength * 5} lb (encumbered above); 10×${strength} = ${strength * 10} lb (heavily encumbered above); 15×${strength} = ${strength * 15} lb (capacity)`,
        };
      },
    },
    // SRD rule:jumping — long jump: Strength score feet with a 10-ft running
    // start, half standing; high jump: 3 + Str modifier feet (floored at 0),
    // half standing; halving rounds down (SRD division rule).
    jump_distance: {
      description:
        'Jump distances: long jump = Strength score ft, high jump = 3 + Strength modifier ft; standing jumps are half. args: { strengthScore, strengthModifier, runningStart? }',
      evaluate(args) {
        rejectUnknownArgs(args, [
          'strengthScore',
          'strengthModifier',
          'runningStart',
        ]);
        const strengthScore = requireInt(args, 'strengthScore', 1, 30);
        const strengthModifier = requireInt(args, 'strengthModifier', -5, 10);
        const runningStart = optionalBool(args, 'runningStart');
        const longBase = strengthScore;
        const highBase = Math.max(0, 3 + strengthModifier);
        const longJumpFeet = runningStart ? longBase : Math.floor(longBase / 2);
        const highJumpFeet = runningStart ? highBase : Math.floor(highBase / 2);
        return {
          formula: 'jump_distance',
          inputs: { strengthScore, strengthModifier, runningStart },
          outputs: { longJumpFeet, highJumpFeet },
          explanation: `long: ${longBase} ft${runningStart ? '' : ' ÷ 2 (standing)'} = ${longJumpFeet} ft; high: max(0, 3 + ${strengthModifier}) = ${highBase} ft${runningStart ? '' : ' ÷ 2 (standing)'} = ${highJumpFeet} ft`,
        };
      },
    },
    // SRD rule:falling — 1d6 bludgeoning per 10 feet fallen, max 20d6.
    fall_damage_dice: {
      description:
        'Fall damage dice: floor(feet/10)d6 bludgeoning, maximum 20d6 — returns the expression to roll. args: { distanceFeet }',
      evaluate(args) {
        rejectUnknownArgs(args, ['distanceFeet']);
        const distanceFeet = requireInt(args, 'distanceFeet', 0, 100000);
        const diceCount = Math.min(Math.floor(distanceFeet / 10), 20);
        return {
          formula: 'fall_damage_dice',
          inputs: { distanceFeet },
          outputs: {
            diceCount,
            dice: diceCount === 0 ? 'none' : `${diceCount}d6`,
            damageType: 'bludgeoning',
          },
          explanation: `min(floor(${distanceFeet} / 10), 20) = ${diceCount} → ${diceCount === 0 ? 'no fall damage' : `${diceCount}d6 bludgeoning`}`,
        };
      },
    },
    // SRD rule:grapple-rules-for-monsters — if no escape DC is given, the DC
    // is 10 + the monster's Strength (Athletics) modifier.
    grapple_escape_dc: {
      description:
        "Default monster grapple escape DC: 10 + the monster's Strength (Athletics) modifier. args: { athleticsModifier }",
      evaluate(args) {
        rejectUnknownArgs(args, ['athleticsModifier']);
        const athleticsModifier = requireInt(args, 'athleticsModifier', -5, 20);
        const dc = 10 + athleticsModifier;
        return {
          formula: 'grapple_escape_dc',
          inputs: { athleticsModifier },
          outputs: { dc },
          explanation: `10 + ${athleticsModifier} = DC ${dc}`,
        };
      },
    },
    // SRD rule:food — a character can go without food for 3 + Constitution
    // modifier days (minimum 1).
    days_without_food_limit: {
      description:
        'Days a character can go without food before exhaustion: max(1, 3 + Constitution modifier). args: { constitutionModifier }',
      evaluate(args) {
        rejectUnknownArgs(args, ['constitutionModifier']);
        const constitutionModifier = requireInt(
          args,
          'constitutionModifier',
          -5,
          10,
        );
        const days = Math.max(1, 3 + constitutionModifier);
        return {
          formula: 'days_without_food_limit',
          inputs: { constitutionModifier },
          outputs: { days },
          explanation: `max(1, 3 + ${constitutionModifier}) = ${days} day(s)`,
        };
      },
    },
    // SRD rule:speed (Forced March) — Constitution save at the end of each
    // hour past 8; DC 10 + 1 per hour past 8.
    forced_march_dc: {
      description:
        'Forced-march Constitution save DC: 10 + 1 per hour of travel past 8. args: { hoursPastEight }',
      evaluate(args) {
        rejectUnknownArgs(args, ['hoursPastEight']);
        const hoursPastEight = requireInt(args, 'hoursPastEight', 1, 16);
        const dc = 10 + hoursPastEight;
        return {
          formula: 'forced_march_dc',
          inputs: { hoursPastEight },
          outputs: { dc },
          explanation: `10 + ${hoursPastEight} = DC ${dc}`,
        };
      },
    },
    // SRD rule:group-checks — if at least half the group succeeds, the whole
    // group succeeds.
    group_check_outcome: {
      description:
        'Group ability check outcome: the group succeeds if at least half its members succeeded. args: { successes, groupSize }',
      evaluate(args) {
        rejectUnknownArgs(args, ['successes', 'groupSize']);
        const groupSize = requireInt(args, 'groupSize', 1, 100);
        const successes = requireInt(args, 'successes', 0, groupSize);
        const needed = Math.ceil(groupSize / 2);
        const success = successes >= needed;
        return {
          formula: 'group_check_outcome',
          inputs: { successes, groupSize },
          outputs: { success, needed },
          explanation: `${successes} of ${groupSize} succeeded; needed at least ${needed} → group ${success ? 'succeeds' : 'fails'}`,
        };
      },
    },
  });

export const CALC_FORMULA_NAMES: readonly string[] = Object.freeze(
  Object.keys(CALC_FORMULAS).sort(),
);

export function evaluateCalc(formula: string, args: unknown): CalcResult {
  const entry = CALC_FORMULAS[formula];
  if (entry === undefined) {
    throw new CalcError(
      `unknown formula '${formula}'; known formulas: ${CALC_FORMULA_NAMES.join(', ')}`,
    );
  }
  if (typeof args !== 'object' || args === null || Array.isArray(args)) {
    throw new CalcError('args must be an object');
  }
  return entry.evaluate(args as CalcArgs);
}
