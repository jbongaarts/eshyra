import { rollDice } from '../orchestrator/dice.js';
import type { Rng } from '../orchestrator/rng.js';

/**
 * Roll provenance for tools whose d20/recharge die the engine owns
 * (ADR 0020 section 3; eshyra-o9bd.19.5.16). By default the engine rolls from
 * the seeded RNG. A DM-supplied natural result is accepted only with a
 * recorded override, following the start_effect `durationOverride` precedent.
 * Both shapes are plain JSON so they ride in tool results and persisted
 * records; a record without this field (written before 19.5.16) is a legacy
 * caller-supplied roll.
 */

export const ROLL_OVERRIDE_BASES = ['dm-adjudicated', 'house-rule'] as const;
export type RollOverrideBasis = (typeof ROLL_OVERRIDE_BASES)[number];

/** The recorded justification for a DM-supplied natural result. */
export interface RollOverride {
  readonly basis: RollOverrideBasis;
  readonly reason: string;
  readonly ruleId?: string;
}

export interface EngineRollEvidence {
  readonly source: 'engine';
  /** Expression the engine rolled, e.g. 1d20, 2d20kh1, 1d6. */
  readonly dice: string;
  readonly rolls: readonly number[];
  readonly kept: readonly number[];
  readonly dropped: readonly number[];
  /** The kept die (the natural result). */
  readonly natural: number;
  /** Kept sum plus the flat modifier (e.g. the 1d6+1 dawn recharge). Present
   *  only when the expression carries a modifier. */
  readonly total?: number;
}

export interface DmSuppliedRollEvidence extends RollOverride {
  readonly source: 'dm-supplied';
  readonly natural: number;
  /** Present for a DM-supplied uses amount (a rechargeFormula restore). No die
   *  was rolled, so the supplied amount is recorded as both natural and total. */
  readonly total?: number;
}

export type RollEvidence = EngineRollEvidence | DmSuppliedRollEvidence;

export function engineRollEvidence(
  notation: string,
  rng: Rng,
): EngineRollEvidence {
  const roll = rollDice(notation, rng);
  return {
    source: 'engine',
    dice: notation,
    rolls: roll.rolls,
    kept: roll.kept,
    dropped: roll.dropped,
    natural: roll.natural,
    ...(roll.modifier === 0 ? {} : { total: roll.total }),
  };
}

export function dmSuppliedRollEvidence(
  natural: number,
  override: RollOverride,
): DmSuppliedRollEvidence {
  return {
    source: 'dm-supplied',
    natural,
    basis: override.basis,
    reason: override.reason,
    ...(override.ruleId === undefined ? {} : { ruleId: override.ruleId }),
  };
}

/** A DM-supplied uses amount restored from a rechargeFormula counter. */
export function dmSuppliedAmountEvidence(
  amount: number,
  override: RollOverride,
): DmSuppliedRollEvidence {
  return { ...dmSuppliedRollEvidence(amount, override), total: amount };
}

/** Uses regained by an evidence record: the total when present, else the natural. */
export function regainedFromEvidence(evidence: RollEvidence): number {
  return evidence.total ?? evidence.natural;
}

/** Compact audit-trail suffix for a mutation `provenance` string. */
export function dmRollProvenanceSuffix(override: RollOverride): string {
  return `#dm-roll:${override.basis}${override.ruleId === undefined ? '' : `:${override.ruleId}`}`;
}
