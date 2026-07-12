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

  it('rejects forged or inconsistent evidence', () => {
    const result = rollStartingWealth('class:wizard', createSeededRng(2));
    expect(() =>
      validateStartingWealthResult({ ...result, totalGp: result.totalGp + 1 }),
    ).toThrow(/inconsistent/);
  });
});
