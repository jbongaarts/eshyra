import { describe, expect, it } from 'vitest';
import {
  createSeededRng,
  formatRolledAbilityScore,
  getBundledDnd5eCharacterResolver,
  normalizeLegacyRolledAbilityScore,
  parseAbilityScoreCommand,
  parseDice,
  recommendClasses,
  rollAbilityScore,
  rollAbilityScoreSet,
  summarizePointBuy,
  summarizePoolAssignment,
  summarizeStandardArray,
  validateDiceRollEvidence,
  validateRolledAbilityScoreSet,
} from '../src/internal.js';

const resolver = getBundledDnd5eCharacterResolver();

const COMPLETE_POINT_BUY = {
  strength: 15,
  dexterity: 14,
  constitution: 14,
  intelligence: 10,
  wisdom: 10,
  charisma: 8,
} as const;

describe('summarizePointBuy', () => {
  it('reports remaining budget as scores are entered one at a time', () => {
    const empty = summarizePointBuy({});
    expect(empty.spent).toBe(0);
    expect(empty.remaining).toBe(27);
    expect(empty.complete).toBe(false);

    const partial = summarizePointBuy({ strength: 15 });
    expect(partial.spent).toBe(9);
    expect(partial.remaining).toBe(18);
    expect(partial.complete).toBe(false);
    expect(partial.lines.find((l) => l.ability === 'strength')).toMatchObject({
      score: 15,
      cost: 9,
      inRange: true,
    });
  });

  it('spends the full 27-point budget on a complete standard build', () => {
    const summary = summarizePointBuy(COMPLETE_POINT_BUY);
    expect(summary.spent).toBe(27);
    expect(summary.remaining).toBe(0);
    expect(summary.overBudget).toBe(false);
    expect(summary.complete).toBe(true);
  });

  it('does not count out-of-range scores toward the budget', () => {
    const summary = summarizePointBuy({ ...COMPLETE_POINT_BUY, strength: 17 });
    const strength = summary.lines.find((l) => l.ability === 'strength');
    expect(strength).toMatchObject({ score: 17, inRange: false });
    expect(strength?.cost).toBeUndefined();
    // The other five in-range scores still cost their points.
    expect(summary.spent).toBe(27 - 9);
    expect(summary.complete).toBe(false);
  });

  it('flags an over-budget build with a negative remaining', () => {
    const summary = summarizePointBuy({
      strength: 15,
      dexterity: 15,
      constitution: 15,
      intelligence: 15,
      wisdom: 15,
      charisma: 15,
    });
    expect(summary.spent).toBe(54);
    expect(summary.remaining).toBe(-27);
    expect(summary.overBudget).toBe(true);
    expect(summary.complete).toBe(false);
  });
});

describe('summarizeStandardArray / summarizePoolAssignment', () => {
  it('starts with the whole array unplaced', () => {
    const summary = summarizeStandardArray({});
    expect(summary.remainingValues).toEqual([15, 14, 13, 12, 10, 8]);
    expect(summary.complete).toBe(false);
    expect(summary.invalid).toEqual({});
  });

  it('consumes values as abilities are assigned', () => {
    const summary = summarizeStandardArray({ strength: 15, charisma: 8 });
    expect(summary.remainingValues).toEqual([14, 13, 12, 10]);
    expect(summary.complete).toBe(false);
  });

  it('is complete once every array value is placed exactly once', () => {
    const summary = summarizeStandardArray({
      strength: 15,
      dexterity: 14,
      constitution: 13,
      intelligence: 12,
      wisdom: 10,
      charisma: 8,
    });
    expect(summary.remainingValues).toEqual([]);
    expect(summary.invalid).toEqual({});
    expect(summary.complete).toBe(true);
  });

  it('reports an assignment drawn from outside the pool as invalid', () => {
    const summary = summarizeStandardArray({ strength: 16 });
    expect(summary.invalid).toEqual({ strength: 16 });
    expect(summary.remainingValues).toEqual([15, 14, 13, 12, 10, 8]);
    expect(summary.complete).toBe(false);
  });

  it('respects pool multiplicity for repeated values', () => {
    const summary = summarizePoolAssignment([12, 12, 10], {
      strength: 12,
      dexterity: 12,
      constitution: 12,
    });
    // Only two 12s exist; the third is invalid.
    expect(summary.invalid).toEqual({ constitution: 12 });
    expect(summary.remainingValues).toEqual([10]);
  });
});

describe('rollAbilityScore / rollAbilityScoreSet', () => {
  it('rolls 4d6 keeping the highest three', () => {
    const rng = createSeededRng(1);
    for (let i = 0; i < 50; i += 1) {
      const roll = rollAbilityScore(rng);
      expect(roll.notation).toBe('4d6dl1');
      expect(roll.rolls).toHaveLength(4);
      expect(roll.kept).toHaveLength(3);
      expect(roll.dropped).toHaveLength(1);
      expect([...roll.keptIndices, ...roll.droppedIndices].sort()).toEqual([
        0, 1, 2, 3,
      ]);
      expect(roll.natural).toBe(roll.total);
      expect(roll.modifier).toBe(0);
      expect(roll.total).toBeGreaterThanOrEqual(3);
      expect(roll.total).toBeLessThanOrEqual(18);
    }
  });

  it('drops exactly one die when the lowest value ties', () => {
    // A fixed RNG yielding 2,2,5,6 → drop one 2 → 2+5+6 = 13.
    const rolls = [2, 2, 5, 6];
    let index = 0;
    const rng = { nextInt: () => rolls[index++] - 1 };
    const roll = rollAbilityScore(rng);
    expect(roll.rolls).toEqual([2, 2, 5, 6]);
    expect(roll.keptIndices).toEqual([0, 2, 3]);
    expect(roll.droppedIndices).toEqual([1]);
    expect(roll.dropped).toEqual([2]);
    expect(roll.total).toBe(13);
    expect(formatRolledAbilityScore(roll)).toBe(
      '4d6dl1: [2, 2, 5, 6] → kept [2, 5, 6], dropped die #2 [2] → 13',
    );
  });

  it('rolls a full set of six and is deterministic under a fixed seed', () => {
    const a = rollAbilityScoreSet(createSeededRng(42));
    const b = rollAbilityScoreSet(createSeededRng(42));
    expect(a).toHaveLength(6);
    expect(a).toEqual(b);
  });

  it('consumes four draws for one score and twenty-four for a set', () => {
    let draws = 0;
    const rng = {
      nextInt: () => {
        draws += 1;
        return 0;
      },
    };
    rollAbilityScore(rng);
    expect(draws).toBe(4);
    rollAbilityScoreSet(rng);
    expect(draws).toBe(28);
  });

  it('validates complete evidence and rejects forged canonical fields', () => {
    const rolls = rollAbilityScoreSet(createSeededRng(42));
    expect(() => validateRolledAbilityScoreSet(rolls)).not.toThrow();
    expect(() =>
      validateDiceRollEvidence(rolls[0], parseDice('4d6dl1')),
    ).not.toThrow();
    expect(() =>
      validateRolledAbilityScoreSet([
        { ...rolls[0], total: rolls[0].total + 1 },
        ...rolls.slice(1),
      ]),
    ).toThrow(/totals/);
    expect(() =>
      validateRolledAbilityScoreSet([
        { ...rolls[0], notation: '4d6kh3' },
        ...rolls.slice(1),
      ]),
    ).toThrow(/exactly 4d6dl1/);
    expect(() =>
      validateRolledAbilityScoreSet([
        { ...rolls[0], keptIndices: [0, 0, 2] },
        ...rolls.slice(1),
      ]),
    ).toThrow(/indices/);
  });

  it('normalizes valid legacy evidence with current indexed tie selection', () => {
    const normalized = normalizeLegacyRolledAbilityScore({
      rolls: [2, 2, 5, 6],
      dropped: 2,
      total: 13,
    });
    expect(normalized.droppedIndices).toEqual([1]);
    expect(normalized.total).toBe(13);
    expect(() =>
      normalizeLegacyRolledAbilityScore({
        rolls: [2, 2, 5, 6],
        dropped: 2,
        total: 14,
      }),
    ).toThrow(/inconsistent/);
  });
});

describe('recommendClasses', () => {
  it('ranks classes by ability-modifier fit over their primary abilities', () => {
    const scores = {
      strength: 16,
      dexterity: 12,
      constitution: 14,
      intelligence: 8,
      wisdom: 10,
      charisma: 10,
    };
    const ranked = recommendClasses(scores, resolver);
    expect(ranked).toHaveLength(12);
    // Fighter (Strength +3, Dexterity +1) sums to +4, beating single-stat
    // Strength classes like Barbarian (+3).
    expect(ranked[0].className).toBe('Fighter');
    expect(ranked[0].score).toBe(4);
    expect(ranked[0].matchedAbilities).toEqual(['strength', 'dexterity']);
  });

  it('honors the limit option and breaks ties deterministically by name', () => {
    // Only Charisma is entered, so every class whose primaries include Charisma
    // ties at +2 with one matched ability; the tie breaks by class name.
    const top = recommendClasses({ charisma: 14 }, resolver, { limit: 4 });
    expect(top.map((r) => r.className)).toEqual([
      'Bard',
      'Paladin',
      'Sorcerer',
      'Warlock',
    ]);
    expect(top.every((r) => r.score === 2)).toBe(true);
  });

  it('only counts primary abilities that have been entered', () => {
    const ranked = recommendClasses({ charisma: 15 }, resolver);
    const sorcerer = ranked.find((r) => r.className === 'Sorcerer');
    expect(sorcerer?.matchedAbilities).toEqual(['charisma']);
    expect(sorcerer?.score).toBe(2);
    const fighter = ranked.find((r) => r.className === 'Fighter');
    // Neither of Fighter's primary abilities is set yet.
    expect(fighter?.matchedAbilities).toEqual([]);
    expect(fighter?.score).toBe(0);
  });
});

describe('parseAbilityScoreCommand', () => {
  it('parses a set command with an abbreviation, full name, or key', () => {
    expect(parseAbilityScoreCommand('str 12')).toEqual({
      kind: 'set',
      ability: 'strength',
      value: 12,
    });
    expect(parseAbilityScoreCommand('Wisdom 14')).toEqual({
      kind: 'set',
      ability: 'wisdom',
      value: 14,
    });
    expect(parseAbilityScoreCommand('  CON   16 ')).toEqual({
      kind: 'set',
      ability: 'constitution',
      value: 16,
    });
  });

  it('parses reset and done case-insensitively', () => {
    expect(parseAbilityScoreCommand('reset')).toEqual({ kind: 'reset' });
    expect(parseAbilityScoreCommand('DONE')).toEqual({ kind: 'done' });
  });

  it('rejects unknown abilities and non-integer values with a field message', () => {
    expect(parseAbilityScoreCommand('luck 12')).toMatchObject({
      kind: 'error',
    });
    const nonInteger = parseAbilityScoreCommand('dex 13.5');
    expect(nonInteger.kind).toBe('error');
    expect(nonInteger.kind === 'error' ? nonInteger.message : '').toMatch(
      /Dexterity/,
    );
  });

  it('rejects empty and malformed input', () => {
    expect(parseAbilityScoreCommand('')).toMatchObject({ kind: 'error' });
    expect(parseAbilityScoreCommand('str')).toMatchObject({ kind: 'error' });
    expect(parseAbilityScoreCommand('str 12 13')).toMatchObject({
      kind: 'error',
    });
  });
});
