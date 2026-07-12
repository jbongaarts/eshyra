import { describe, expect, it } from 'vitest';
import {
  createSeededRng,
  DiceError,
  parseDice,
  rollDice,
  validateDiceRollEvidence,
} from '../src/internal.js';

/**
 * F1 dice-grammar extension (eshyra-2n1t.3): keep/drop notation, canonical
 * rolled/kept/dropped/natural representation, deterministic selection, and
 * adversarial rejection of meaningless clauses.
 */

describe('F1 keep/drop grammar parsing', () => {
  it('parses keep-highest/lowest and drop-highest/lowest clauses', () => {
    expect(parseDice('2d20kh1')).toEqual({
      count: 2,
      faces: 20,
      modifier: 0,
      keep: { mode: 'kh', count: 1 },
    });
    expect(parseDice('2d20kl1')).toEqual({
      count: 2,
      faces: 20,
      modifier: 0,
      keep: { mode: 'kl', count: 1 },
    });
    expect(parseDice('4d6dl1')).toEqual({
      count: 4,
      faces: 6,
      modifier: 0,
      keep: { mode: 'dl', count: 1 },
    });
    expect(parseDice('5d8dh2+3')).toEqual({
      count: 5,
      faces: 8,
      modifier: 3,
      keep: { mode: 'dh', count: 2 },
    });
  });

  it('is case-insensitive and whitespace-tolerant like the base grammar', () => {
    expect(parseDice('2D20KH1')).toEqual(parseDice('2d20kh1'));
    expect(parseDice(' 4d6 dl1 + 2 ')).toEqual(parseDice('4d6dl1+2'));
  });

  it('keeps plain notation unchanged (no keep field)', () => {
    expect(parseDice('2d6+3')).toEqual({ count: 2, faces: 6, modifier: 3 });
  });

  it('rejects identity keeps and total drops (fail closed)', () => {
    // Keeping every die is model confusion ("2d20kh2 advantage").
    expect(() => parseDice('2d20kh2')).toThrow(DiceError);
    expect(() => parseDice('2d20kl2')).toThrow(DiceError);
    // Dropping every die leaves nothing to sum.
    expect(() => parseDice('4d6dl4')).toThrow(DiceError);
    expect(() => parseDice('4d6dh4')).toThrow(DiceError);
    // Over-length clauses.
    expect(() => parseDice('2d20kh3')).toThrow(DiceError);
    expect(() => parseDice('4d6dl5')).toThrow(DiceError);
  });

  it('rejects keep/drop on a single die and zero clauses', () => {
    expect(() => parseDice('1d20kh1')).toThrow(DiceError);
    expect(() => parseDice('d20kh1')).toThrow(DiceError);
    expect(() => parseDice('4d6kh0')).toThrow(DiceError);
    expect(() => parseDice('4d6dl0')).toThrow(DiceError);
  });

  it('rejects malformed clause variants', () => {
    expect(() => parseDice('4d6k3')).toThrow(DiceError);
    expect(() => parseDice('4d6kh')).toThrow(DiceError);
    expect(() => parseDice('4d6khx')).toThrow(DiceError);
    expect(() => parseDice('4d6kh1kl1')).toThrow(DiceError);
    expect(() => parseDice('4d6kh-1')).toThrow(DiceError);
  });
});

describe('F1 canonical roll representation', () => {
  it('rejects forged keep/drop selection and unsafe evidence', () => {
    const roll = rollDice('4d6dl1', createSeededRng(7));
    const forged = { ...roll, keptIndices: [0, 1, 2], droppedIndices: [3] };
    expect(() => validateDiceRollEvidence(forged, parseDice('4d6dl1'))).toThrow(
      /wrong kept dice|accounting/,
    );
    expect(() =>
      validateDiceRollEvidence(
        { ...roll, total: Number.MAX_SAFE_INTEGER + 1 },
        parseDice('4d6dl1'),
      ),
    ).toThrow();
  });
  it('separates rolled facts from selection: kept ∪ dropped = rolls', () => {
    const roll = rollDice('4d6dl1', createSeededRng(7));
    expect(roll.rolls).toHaveLength(4);
    expect(roll.kept).toHaveLength(3);
    expect(roll.dropped).toHaveLength(1);
    const reconstructed = [...roll.keptIndices, ...roll.droppedIndices].sort(
      (a, b) => a - b,
    );
    expect(reconstructed).toEqual([0, 1, 2, 3]);
    expect(roll.keptIndices.map((i) => roll.rolls[i])).toEqual(roll.kept);
    expect(roll.droppedIndices.map((i) => roll.rolls[i])).toEqual(roll.dropped);
    // The dropped die is the minimum.
    expect(Math.min(...roll.rolls)).toBe(roll.dropped[0]);
  });

  it('holds natural = Σ kept and total = natural + modifier', () => {
    for (const notation of ['4d6dl1+2', '2d20kh1-3', '3d8', '2d20kl1']) {
      const roll = rollDice(notation, createSeededRng(99));
      expect(roll.natural).toBe(roll.kept.reduce((s, r) => s + r, 0));
      expect(roll.total).toBe(roll.natural + roll.modifier);
    }
  });

  it('keeps the higher die for kh1 and the lower for kl1', () => {
    const advantage = rollDice('2d20kh1', createSeededRng(3));
    expect(advantage.kept[0]).toBe(Math.max(...advantage.rolls));
    const disadvantage = rollDice('2d20kl1', createSeededRng(3));
    expect(disadvantage.kept[0]).toBe(Math.min(...disadvantage.rolls));
  });

  it('draws the same RNG sequence as an unclause roll (selection is post-hoc)', () => {
    const plain = rollDice('2d20', createSeededRng(41));
    const kept = rollDice('2d20kh1', createSeededRng(41));
    expect(kept.rolls).toEqual(plain.rolls);
  });

  it('resolves ties deterministically (earlier-rolled die kept)', () => {
    // Find a seed producing equal d20s so the tie path is actually exercised.
    let seed = 0;
    let roll = rollDice('2d20kh1', createSeededRng(seed));
    while (roll.rolls[0] !== roll.rolls[1]) {
      seed += 1;
      roll = rollDice('2d20kh1', createSeededRng(seed));
    }
    expect(roll.keptIndices).toEqual([0]);
    expect(roll.droppedIndices).toEqual([1]);
    const again = rollDice('2d20kh1', createSeededRng(seed));
    expect(again).toEqual(roll);
  });

  it('replays byte-identically under a fixed seed', () => {
    const first = rollDice('4d6dl1+1', createSeededRng(20260711));
    const second = rollDice('4d6dl1+1', createSeededRng(20260711));
    expect(second).toEqual(first);
  });

  it('gives plain rolls the uniform shape (all dice kept, none dropped)', () => {
    const roll = rollDice('3d6+2', createSeededRng(5));
    expect(roll.kept).toEqual(roll.rolls);
    expect(roll.keptIndices).toEqual([0, 1, 2]);
    expect(roll.dropped).toEqual([]);
    expect(roll.droppedIndices).toEqual([]);
    expect(roll.keep).toBeUndefined();
  });

  it('normalizes dhX/dlX to the complementary keep', () => {
    const dropHigh = rollDice('4d6dh1', createSeededRng(13));
    expect(dropHigh.kept).toHaveLength(3);
    expect(dropHigh.dropped[0]).toBe(Math.max(...dropHigh.rolls));
    const keepLow = rollDice('4d6kl3', createSeededRng(13));
    expect(keepLow.kept).toEqual(dropHigh.kept);
  });
});
