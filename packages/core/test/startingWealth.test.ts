import { describe, expect, it } from 'vitest';
import {
  createSeededRng,
  resolveStartingWealth,
  rollStartingWealth,
  validateStartingWealthResult,
} from '../src/internal.js';

describe('starting wealth', () => {
  it('resolves and rolls the source-backed class row deterministically', () => {
    expect(resolveStartingWealth('class:fighter')).toMatchObject({
      formula: '5d4',
      multiplierGp: 10,
    });
    const left = rollStartingWealth('class:fighter', createSeededRng(7));
    const right = rollStartingWealth('class:fighter', createSeededRng(7));
    expect(left).toEqual(right);
    expect(left.totalGp).toBe(left.roll.total * 10);
  });

  it('resolves every bundled class from the committed table', () => {
    const expected = {
      barbarian: ['2d4', 10],
      bard: ['5d4', 10],
      cleric: ['5d4', 10],
      druid: ['2d4', 10],
      fighter: ['5d4', 10],
      monk: ['5d4', 1],
      paladin: ['5d4', 10],
      ranger: ['5d4', 10],
      rogue: ['4d4', 10],
      sorcerer: ['3d4', 10],
      warlock: ['4d4', 10],
      wizard: ['4d4', 10],
    } as const;
    for (const [classKey, [formula, multiplierGp]] of Object.entries(
      expected,
    )) {
      expect(resolveStartingWealth(`class:${classKey}`)).toMatchObject({
        classKey: `class:${classKey}`,
        formula,
        multiplierGp,
      });
    }
  });

  it('rejects forged or inconsistent evidence', () => {
    const result = rollStartingWealth('class:wizard', createSeededRng(2));
    expect(() =>
      validateStartingWealthResult({ ...result, totalGp: result.totalGp + 1 }),
    ).toThrow(/inconsistent/);
  });
});
