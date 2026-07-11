import { describe, expect, it } from 'vitest';
import {
  CALC_FORMULA_NAMES,
  CalcError,
  evaluateCalc,
} from '../src/internal.js';

/**
 * F9 non-roll formula registry (eshyra-2n1t.11). Each formula is verified
 * against the committed SRD pack text — rule keys cited in calc.ts.
 */

describe('calc registry (fail closed)', () => {
  it('rejects unknown formulas with the known list', () => {
    expect(() => evaluateCalc('fireball_damage', {})).toThrow(CalcError);
    expect(() => evaluateCalc('fireball_damage', {})).toThrow(
      /known formulas:/,
    );
  });

  it('rejects unknown and malformed arguments per formula', () => {
    expect(() =>
      evaluateCalc('passive_score', { modifier: 3, bogus: 1 }),
    ).toThrow(CalcError);
    expect(() => evaluateCalc('passive_score', { modifier: 'x' })).toThrow(
      CalcError,
    );
    expect(() => evaluateCalc('passive_score', { modifier: 3.5 })).toThrow(
      CalcError,
    );
    expect(() => evaluateCalc('carry_capacity', { strength: 31 })).toThrow(
      CalcError,
    );
    expect(() =>
      evaluateCalc('carry_capacity', { strength: 10, size: 'colossal' }),
    ).toThrow(CalcError);
    expect(() => evaluateCalc('passive_score', null)).toThrow(CalcError);
  });

  it('exposes a sorted stable formula name list', () => {
    expect(CALC_FORMULA_NAMES).toEqual([...CALC_FORMULA_NAMES].sort());
    expect(CALC_FORMULA_NAMES).toContain('passive_score');
  });
});

describe('passive_score (SRD passive-checks)', () => {
  it('computes 10 + modifiers with ±5 for advantage/disadvantage', () => {
    expect(evaluateCalc('passive_score', { modifier: 4 }).outputs.score).toBe(
      14,
    );
    expect(
      evaluateCalc('passive_score', { modifier: 4, advantage: true }).outputs
        .score,
    ).toBe(19);
    expect(
      evaluateCalc('passive_score', { modifier: 4, disadvantage: true }).outputs
        .score,
    ).toBe(9);
    // Both cancel to neither, as everywhere else.
    expect(
      evaluateCalc('passive_score', {
        modifier: 4,
        advantage: true,
        disadvantage: true,
      }).outputs.score,
    ).toBe(14);
  });

  it("matches the SRD's own example (Wis 15, proficient, level 1 → 14)", () => {
    expect(evaluateCalc('passive_score', { modifier: 4 }).outputs.score).toBe(
      14,
    );
  });
});

describe('carry_capacity (SRD lifting-and-carrying + mounts-and-vehicles)', () => {
  it('computes Str×15, ×2 push/drag/lift, ×5 vehicle pull', () => {
    const result = evaluateCalc('carry_capacity', { strength: 12 });
    expect(result.outputs).toEqual({
      carryCapacityLb: 180,
      pushDragLiftLb: 360,
      vehiclePullLb: 900,
    });
  });

  it('doubles per size category above Medium and halves for Tiny', () => {
    expect(
      evaluateCalc('carry_capacity', { strength: 10, size: 'large' }).outputs
        .carryCapacityLb,
    ).toBe(300);
    expect(
      evaluateCalc('carry_capacity', { strength: 10, size: 'gargantuan' })
        .outputs.carryCapacityLb,
    ).toBe(1200);
    expect(
      evaluateCalc('carry_capacity', { strength: 10, size: 'tiny' }).outputs
        .carryCapacityLb,
    ).toBe(75);
  });
});

describe('encumbrance_thresholds (SRD variant-encumbrance)', () => {
  it('computes the 5×/10×/15× Strength thresholds', () => {
    expect(
      evaluateCalc('encumbrance_thresholds', { strength: 14 }).outputs,
    ).toEqual({
      encumberedAboveLb: 70,
      heavilyEncumberedAboveLb: 140,
      carryCapacityLb: 210,
    });
  });
});

describe('jump_distance (SRD jumping)', () => {
  it('long jump = Str score with a running start, half standing', () => {
    const running = evaluateCalc('jump_distance', {
      strengthScore: 15,
      strengthModifier: 2,
      runningStart: true,
    });
    expect(running.outputs.longJumpFeet).toBe(15);
    expect(running.outputs.highJumpFeet).toBe(5);
    const standing = evaluateCalc('jump_distance', {
      strengthScore: 15,
      strengthModifier: 2,
    });
    expect(standing.outputs.longJumpFeet).toBe(7);
    expect(standing.outputs.highJumpFeet).toBe(2);
  });

  it('floors the high jump at 0 for very negative Strength modifiers', () => {
    const result = evaluateCalc('jump_distance', {
      strengthScore: 3,
      strengthModifier: -4,
      runningStart: true,
    });
    expect(result.outputs.highJumpFeet).toBe(0);
  });
});

describe('fall_damage_dice (SRD falling)', () => {
  it('computes floor(feet/10)d6 with the 20d6 cap', () => {
    expect(
      evaluateCalc('fall_damage_dice', { distanceFeet: 45 }).outputs,
    ).toEqual({ diceCount: 4, dice: '4d6', damageType: 'bludgeoning' });
    expect(
      evaluateCalc('fall_damage_dice', { distanceFeet: 500 }).outputs.diceCount,
    ).toBe(20);
    expect(
      evaluateCalc('fall_damage_dice', { distanceFeet: 5 }).outputs.dice,
    ).toBe('none');
  });
});

describe('grapple_escape_dc (SRD grapple-rules-for-monsters)', () => {
  it('computes 10 + Strength (Athletics) modifier', () => {
    expect(
      evaluateCalc('grapple_escape_dc', { athleticsModifier: 5 }).outputs.dc,
    ).toBe(15);
  });
});

describe('days_without_food_limit (SRD food)', () => {
  it('computes max(1, 3 + Con modifier)', () => {
    expect(
      evaluateCalc('days_without_food_limit', { constitutionModifier: 2 })
        .outputs.days,
    ).toBe(5);
    expect(
      evaluateCalc('days_without_food_limit', { constitutionModifier: -4 })
        .outputs.days,
    ).toBe(1);
  });
});

describe('forced_march_dc (SRD speed)', () => {
  it('computes 10 + 1 per hour past 8', () => {
    expect(
      evaluateCalc('forced_march_dc', { hoursPastEight: 1 }).outputs.dc,
    ).toBe(11);
    expect(
      evaluateCalc('forced_march_dc', { hoursPastEight: 4 }).outputs.dc,
    ).toBe(14);
    expect(() =>
      evaluateCalc('forced_march_dc', { hoursPastEight: 0 }),
    ).toThrow(CalcError);
  });
});

describe('group_check_outcome (SRD group-checks)', () => {
  it('succeeds iff at least half the group succeeded', () => {
    expect(
      evaluateCalc('group_check_outcome', { successes: 2, groupSize: 4 })
        .outputs,
    ).toEqual({ success: true, needed: 2 });
    expect(
      evaluateCalc('group_check_outcome', { successes: 2, groupSize: 5 })
        .outputs.success,
    ).toBe(false);
    expect(
      evaluateCalc('group_check_outcome', { successes: 3, groupSize: 5 })
        .outputs.success,
    ).toBe(true);
  });

  it('rejects more successes than group members', () => {
    expect(() =>
      evaluateCalc('group_check_outcome', { successes: 5, groupSize: 4 }),
    ).toThrow(CalcError);
  });
});

describe('calc result shape', () => {
  it('echoes formula, validated inputs, and an explanation for the trace', () => {
    const result = evaluateCalc('passive_score', { modifier: 3 });
    expect(result.formula).toBe('passive_score');
    expect(result.inputs).toEqual({
      modifier: 3,
      advantage: false,
      disadvantage: false,
    });
    expect(result.explanation).toContain('= 13');
  });
});
