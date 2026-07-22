import { describe, expect, it } from 'vitest';
import type { Rng } from '../src/orchestrator/rng.js';
import {
  ItemTimerError,
  reconcileItemStateTimers,
  resolveItemStateTimers,
} from '../src/state/itemTimers.js';
import { freshDbWithSession } from './support/db.js';

const fixedRng: Rng = { nextInt: () => 2 };

describe('magic-item elapsed-world timers', () => {
  it('anchors fixed and rolled timers to the campaign elapsed clock', () => {
    const db = freshDbWithSession();
    db.prepare('UPDATE clock SET elapsed_minutes=90 WHERE id=1').run();
    expect(
      resolveItemStateTimers(
        db,
        'active',
        [
          { to: 'spent', timer: { amount: 2, unit: 'hour' } },
          { to: 'ready', timer: { amount: '1d4', unit: 'day' } },
        ],
        fixedRng,
      ),
    ).toEqual([
      {
        from: 'active',
        to: 'spent',
        anchorElapsedMinutes: 90,
        deadlineElapsedMinutes: 210,
        amount: 2,
        unit: 'hour',
      },
      {
        from: 'active',
        to: 'ready',
        anchorElapsedMinutes: 90,
        deadlineElapsedMinutes: 4_410,
        amount: 3,
        unit: 'day',
        roll: { notation: '1d4', rolls: [3], total: 3 },
      },
    ]);
    db.close();
  });

  it('preserves matching timers and leaves unrelated declarations fresh', () => {
    const db = freshDbWithSession();
    const first = resolveItemStateTimers(
      db,
      'active',
      [{ to: 'inactive', timer: { amount: 10, unit: 'minute' } }],
      undefined,
    );
    db.prepare('UPDATE clock SET elapsed_minutes=5 WHERE id=1').run();
    const reentered = resolveItemStateTimers(
      db,
      'active',
      [{ to: 'inactive', timer: { amount: 10, unit: 'minute' } }],
      undefined,
      { preserved: first },
    );
    expect(
      reconcileItemStateTimers('active', first)[0]?.deadlineElapsedMinutes,
    ).toBe(10);
    expect(reentered).toEqual(first);
    const preservedRolled = {
      from: 'active',
      to: 'ready',
      anchorElapsedMinutes: 2,
      deadlineElapsedMinutes: 6,
      amount: 4,
      unit: 'minute' as const,
      roll: { notation: '1d4', rolls: [4], total: 4 },
    };
    const noRng: Rng = {
      nextInt: () => {
        throw new Error('preserved timer must not roll');
      },
    };
    const unmatched = resolveItemStateTimers(
      db,
      'active',
      [{ to: 'ready', timer: { amount: '1d4', unit: 'minute' } }],
      noRng,
      { preserved: [preservedRolled] },
    );
    expect(unmatched).toEqual([preservedRolled]);
    expect(reconcileItemStateTimers('inactive', [])).toEqual([]);
    db.close();
  });

  it('fails closed for round timers until an encounter scheduler owns them', () => {
    const db = freshDbWithSession();
    expect(() =>
      resolveItemStateTimers(
        db,
        'active',
        [{ to: 'ready', timer: { amount: 2, unit: 'round' } }],
        undefined,
      ),
    ).toThrow(ItemTimerError);
    db.close();
  });
});
