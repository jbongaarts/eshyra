// F6 death/dying/temp-HP state machine on the HP write path (eshyra-2n1t.8).
// Evidence for the ENGINE_PROCEDURE_COVERAGE rows: death-saving-throws,
// falling-unconscious, instant-death, temporary-hit-points, and healing's
// dead-gate; stabilizing-a-creature's code-owned part is covered here too,
// but that row stays partial until the durable 1d4 h recovery deadline
// lands (eshyra-2n1t.8.1).

import { describe, expect, it } from 'vitest';
import {
  adjustHp,
  advanceWorldTime,
  createSeededRng,
  expireTemporaryHp,
  formatHpStatus,
  grantTemporaryHp,
  initSchema,
  type LifeState,
  MutateStateError,
  mutateState,
  mutateStateBatch,
  openDatabase,
  recordDeathSave,
  resolveStableRecoveries,
  stabilizeCharacter,
} from '../src/internal.js';

const CTX = {
  provenance: 'test:hp-lifecycle',
  sessionId: 'session-1',
  at: '2026-07-10T00:00:00.000Z',
};

function freshDb(hp: {
  max: number;
  current: number;
  temp?: number;
  lifeState?: LifeState;
  successes?: number;
  failures?: number;
}) {
  const db = openDatabase(':memory:');
  initSchema(db);
  mutateStateBatch(
    db,
    [
      { field: 'hp_max', value: hp.max },
      { field: 'hp_current', value: hp.current },
      { field: 'hp_temp', value: hp.temp ?? 0 },
      { field: 'life_state', value: hp.lifeState ?? 'alive' },
      { field: 'death_save_successes', value: hp.successes ?? 0 },
      { field: 'death_save_failures', value: hp.failures ?? 0 },
    ].map((m) => ({
      target: 'character' as const,
      op: 'set' as const,
      ...m,
      ...CTX,
    })),
  );
  return db;
}

function readMachine(db: ReturnType<typeof openDatabase>) {
  return db
    .prepare(
      `SELECT hp_current, hp_temp, life_state,
              death_save_successes, death_save_failures
              , stable_recovery_roll, stable_recovery_anchor_elapsed_minutes,
              stable_recovery_deadline_elapsed_minutes
       FROM character WHERE id = 'pc-1'`,
    )
    .get() as {
    hp_current: number;
    hp_temp: number;
    life_state: LifeState;
    death_save_successes: number;
    death_save_failures: number;
    stable_recovery_roll: number | null;
    stable_recovery_anchor_elapsed_minutes: number | null;
    stable_recovery_deadline_elapsed_minutes: number | null;
  };
}

describe('adjustHp — falling unconscious and instant death', () => {
  it('dropping to exactly 0 HP starts dying with fresh counters', () => {
    const db = freshDb({ max: 20, current: 5 });

    const result = adjustHp(db, -5, CTX);

    expect(result).toMatchObject({
      newHp: 0,
      overflow: 0,
      clamped: false,
      previousLifeState: 'alive',
      lifeState: 'dying',
      instantDeath: false,
      deathSaveSuccesses: 0,
      deathSaveFailures: 0,
    });
    expect(readMachine(db).life_state).toBe('dying');
    db.close();
  });

  it('surfaces sub-zero overflow instead of discarding it', () => {
    const db = freshDb({ max: 20, current: 4 });

    const result = adjustHp(db, -15, CTX);

    expect(result).toMatchObject({
      newHp: 0,
      overflow: 11,
      clamped: true,
      lifeState: 'dying',
      instantDeath: false,
    });
    db.close();
  });

  it('kills outright when overflow reaches the HP maximum', () => {
    const db = freshDb({ max: 10, current: 4 });

    const result = adjustHp(db, -14, CTX);

    expect(result).toMatchObject({
      newHp: 0,
      overflow: 10,
      lifeState: 'dead',
      instantDeath: true,
    });
    expect(readMachine(db).life_state).toBe('dead');
    db.close();
  });

  it('keeps legacy clamp behavior for uninitialized 0/0 sheets', () => {
    const db = freshDb({ max: 0, current: 0 });

    const result = adjustHp(db, -3, CTX);

    expect(result).toMatchObject({
      newHp: 0,
      lifeState: 'alive',
      instantDeath: false,
      deathSaveFailuresAdded: 0,
    });
    db.close();
  });
});

describe('adjustHp — damage at 0 HP escalation', () => {
  it('adds one death-save failure per hit while dying', () => {
    const db = freshDb({ max: 20, current: 0, lifeState: 'dying' });

    const result = adjustHp(db, -3, CTX);

    expect(result).toMatchObject({
      newHp: 0,
      overflow: 3,
      lifeState: 'dying',
      deathSaveFailuresAdded: 1,
      deathSaveFailures: 1,
    });
    db.close();
  });

  it('adds two failures on a critical hit', () => {
    const db = freshDb({ max: 20, current: 0, lifeState: 'dying' });

    const result = adjustHp(db, -3, CTX, { critical: true });

    expect(result).toMatchObject({
      deathSaveFailuresAdded: 2,
      deathSaveFailures: 2,
      lifeState: 'dying',
    });
    db.close();
  });

  it('the third failure kills', () => {
    const db = freshDb({
      max: 20,
      current: 0,
      lifeState: 'dying',
      failures: 2,
    });

    const result = adjustHp(db, -1, CTX);

    expect(result).toMatchObject({
      lifeState: 'dead',
      deathSaveFailures: 3,
      instantDeath: false,
    });
    db.close();
  });

  it('damage at 0 HP with overflow >= max is instant death', () => {
    const db = freshDb({ max: 10, current: 0, lifeState: 'dying' });

    const result = adjustHp(db, -10, CTX);

    expect(result).toMatchObject({
      lifeState: 'dead',
      instantDeath: true,
      deathSaveFailuresAdded: 0,
    });
    db.close();
  });

  it('knocks a stable character back to dying with one failure', () => {
    const db = freshDb({ max: 20, current: 0, lifeState: 'stable' });

    const result = adjustHp(db, -2, CTX);

    expect(result).toMatchObject({
      previousLifeState: 'stable',
      lifeState: 'dying',
      deathSaveFailures: 1,
    });
    db.close();
  });
});

describe('adjustHp — temporary hit points', () => {
  it('damage consumes the temp-HP buffer before real HP', () => {
    const db = freshDb({ max: 20, current: 10, temp: 5 });

    const result = adjustHp(db, -8, CTX);

    expect(result).toMatchObject({
      tempHpAbsorbed: 5,
      newTempHp: 0,
      previousHp: 10,
      newHp: 7,
      lifeState: 'alive',
    });
    db.close();
  });

  it('damage at 0 HP fully absorbed by temp HP still costs a death-save failure', () => {
    // Temp HP reduce the HP loss, not the damage event: any hit taken at
    // 0 HP is a failed death save even when the buffer soaks every point.
    const db = freshDb({
      max: 20,
      current: 0,
      temp: 6,
      lifeState: 'dying',
      failures: 1,
    });

    const result = adjustHp(db, -4, CTX);

    expect(result).toMatchObject({
      tempHpAbsorbed: 4,
      newTempHp: 2,
      newHp: 0,
      overflow: 0,
      lifeState: 'dying',
      deathSaveFailuresAdded: 1,
      deathSaveFailures: 2,
    });
    db.close();
  });

  it('fully absorbed damage knocks a stable character back to dying', () => {
    const db = freshDb({ max: 20, current: 0, temp: 5, lifeState: 'stable' });

    const result = adjustHp(db, -3, CTX);

    expect(result).toMatchObject({
      tempHpAbsorbed: 3,
      newTempHp: 2,
      previousLifeState: 'stable',
      lifeState: 'dying',
      deathSaveFailures: 1,
    });
    db.close();
  });

  it('fully absorbed damage while above 0 HP has no death-state effect', () => {
    const db = freshDb({ max: 20, current: 10, temp: 6 });

    const result = adjustHp(db, -4, CTX);

    expect(result).toMatchObject({
      tempHpAbsorbed: 4,
      newHp: 10,
      lifeState: 'alive',
      deathSaveFailuresAdded: 0,
    });
    db.close();
  });

  it('healing does not restore temp HP', () => {
    const db = freshDb({ max: 20, current: 10, temp: 3 });

    const result = adjustHp(db, 5, CTX);

    expect(result).toMatchObject({ newHp: 15, newTempHp: 3 });
    db.close();
  });
});

describe('adjustHp — healing and the dead-gate', () => {
  it('any healing from dying returns the character to alive and resets counters', () => {
    const db = freshDb({
      max: 20,
      current: 0,
      lifeState: 'dying',
      successes: 2,
      failures: 2,
    });

    const result = adjustHp(db, 1, CTX);

    expect(result).toMatchObject({
      newHp: 1,
      previousLifeState: 'dying',
      lifeState: 'alive',
      deathSaveSuccesses: 0,
      deathSaveFailures: 0,
    });
    db.close();
  });

  it('healing wakes a stable character the same way', () => {
    const db = freshDb({ max: 20, current: 0, lifeState: 'stable' });

    expect(adjustHp(db, 4, CTX)).toMatchObject({
      newHp: 4,
      lifeState: 'alive',
    });
    db.close();
  });

  it('refuses to heal a dead character', () => {
    const db = freshDb({ max: 20, current: 0, lifeState: 'dead' });

    expect(() => adjustHp(db, 10, CTX)).toThrow(MutateStateError);
    expect(readMachine(db)).toMatchObject({
      hp_current: 0,
      life_state: 'dead',
    });
    db.close();
  });

  it('refuses further damage to a dead character', () => {
    const db = freshDb({ max: 20, current: 0, lifeState: 'dead' });

    expect(() => adjustHp(db, -5, CTX)).toThrow(MutateStateError);
    db.close();
  });
});

describe('recordDeathSave', () => {
  it('10+ is a success', () => {
    const db = freshDb({ max: 20, current: 0, lifeState: 'dying' });

    const result = recordDeathSave(db, 10, CTX);

    expect(result).toMatchObject({
      outcome: 'success',
      deathSaveSuccesses: 1,
      lifeState: 'dying',
    });
    db.close();
  });

  it('9 or lower is a failure', () => {
    const db = freshDb({ max: 20, current: 0, lifeState: 'dying' });

    expect(recordDeathSave(db, 9, CTX)).toMatchObject({
      outcome: 'failure',
      deathSaveFailures: 1,
    });
    db.close();
  });

  it('a natural 1 counts as two failures', () => {
    const db = freshDb({ max: 20, current: 0, lifeState: 'dying' });

    expect(recordDeathSave(db, 1, CTX)).toMatchObject({
      outcome: 'critical-failure',
      deathSaveFailures: 2,
      lifeState: 'dying',
    });
    db.close();
  });

  it('a natural 1 with two failures banked kills', () => {
    const db = freshDb({
      max: 20,
      current: 0,
      lifeState: 'dying',
      failures: 2,
    });

    expect(recordDeathSave(db, 1, CTX)).toMatchObject({
      outcome: 'dead',
      lifeState: 'dead',
    });
    db.close();
  });

  it('a natural 20 restores 1 HP and resets the counters', () => {
    const db = freshDb({
      max: 20,
      current: 0,
      lifeState: 'dying',
      successes: 2,
      failures: 2,
    });

    const result = recordDeathSave(db, 20, CTX);

    expect(result).toMatchObject({
      outcome: 'revived',
      hpCurrent: 1,
      lifeState: 'alive',
      deathSaveSuccesses: 0,
      deathSaveFailures: 0,
    });
    expect(readMachine(db)).toMatchObject({
      hp_current: 1,
      life_state: 'alive',
    });
    db.close();
  });

  it('the third success stabilizes and resets the counters', () => {
    const db = freshDb({
      max: 20,
      current: 0,
      lifeState: 'dying',
      successes: 2,
      failures: 1,
    });

    expect(recordDeathSave(db, 15, CTX)).toMatchObject({
      outcome: 'stabilized',
      lifeState: 'stable',
      deathSaveSuccesses: 0,
      deathSaveFailures: 0,
    });
    db.close();
  });

  it('the third failure kills', () => {
    const db = freshDb({
      max: 20,
      current: 0,
      lifeState: 'dying',
      failures: 2,
    });

    expect(recordDeathSave(db, 4, CTX)).toMatchObject({
      outcome: 'dead',
      lifeState: 'dead',
      deathSaveFailures: 3,
    });
    db.close();
  });

  it('rejects rolls outside 1-20 and non-dying characters', () => {
    const dying = freshDb({ max: 20, current: 0, lifeState: 'dying' });
    expect(() => recordDeathSave(dying, 0, CTX)).toThrow(MutateStateError);
    expect(() => recordDeathSave(dying, 21, CTX)).toThrow(MutateStateError);
    dying.close();

    const alive = freshDb({ max: 20, current: 5 });
    expect(() => recordDeathSave(alive, 12, CTX)).toThrow(MutateStateError);
    alive.close();

    const stable = freshDb({ max: 20, current: 0, lifeState: 'stable' });
    expect(() => recordDeathSave(stable, 12, CTX)).toThrow(MutateStateError);
    stable.close();
  });
});

describe('stabilizeCharacter', () => {
  it('marks a dying character stable and resets the counters', () => {
    const db = freshDb({
      max: 20,
      current: 0,
      lifeState: 'dying',
      successes: 1,
      failures: 2,
    });

    expect(stabilizeCharacter(db, CTX)).toEqual({
      lifeState: 'stable',
      hpCurrent: 0,
    });
    expect(readMachine(db)).toMatchObject({
      life_state: 'stable',
      death_save_successes: 0,
      death_save_failures: 0,
    });
    db.close();
  });

  it('rejects characters that are not dying', () => {
    for (const lifeState of ['alive', 'stable', 'dead'] as const) {
      const db = freshDb({ max: 20, current: 0, lifeState });
      expect(() => stabilizeCharacter(db, CTX)).toThrow(MutateStateError);
      db.close();
    }
  });

  it('persists a seeded 1d4-hour deadline and resolves it at the boundary', () => {
    const db = freshDb({ max: 20, current: 0, lifeState: 'dying' });
    stabilizeCharacter(db, CTX, createSeededRng(42));
    const scheduled = db
      .prepare(
        `SELECT stable_recovery_roll, stable_recovery_anchor_elapsed_minutes,
                stable_recovery_deadline_elapsed_minutes
         FROM character WHERE id='pc-1'`,
      )
      .get() as {
      stable_recovery_roll: number;
      stable_recovery_anchor_elapsed_minutes: number;
      stable_recovery_deadline_elapsed_minutes: number;
    };
    expect(scheduled.stable_recovery_roll).toBeGreaterThanOrEqual(1);
    expect(scheduled.stable_recovery_roll).toBeLessThanOrEqual(4);
    expect(scheduled.stable_recovery_anchor_elapsed_minutes).toBe(0);
    expect(scheduled.stable_recovery_deadline_elapsed_minutes).toBe(
      scheduled.stable_recovery_roll * 60,
    );

    const before = advanceWorldTime(db, {
      ...CTX,
      campaignId: 'campaign-1',
      minutes: scheduled.stable_recovery_deadline_elapsed_minutes - 1,
    });
    expect(before.stableRecoveries).toEqual([]);
    expect(readMachine(db).life_state).toBe('stable');

    const due = advanceWorldTime(db, {
      ...CTX,
      campaignId: 'campaign-1',
      minutes: 1,
    });
    expect(due.stableRecoveries).toHaveLength(1);
    expect(due.stableRecoveries[0]?.hp).toMatchObject({
      previousHp: 0,
      newHp: 1,
      previousLifeState: 'stable',
      lifeState: 'alive',
    });
    expect(readMachine(db)).toMatchObject({
      hp_current: 1,
      life_state: 'alive',
      stable_recovery_roll: null,
      stable_recovery_anchor_elapsed_minutes: null,
      stable_recovery_deadline_elapsed_minutes: null,
    });
    db.close();
  });

  it('cancels the deadline when damage knocks a stable character back to dying', () => {
    const db = freshDb({ max: 20, current: 0, lifeState: 'dying' });
    stabilizeCharacter(db, CTX, createSeededRng(42));
    adjustHp(db, -1, CTX);
    expect(readMachine(db)).toMatchObject({
      life_state: 'dying',
      stable_recovery_roll: null,
      stable_recovery_anchor_elapsed_minutes: null,
      stable_recovery_deadline_elapsed_minutes: null,
    });
    db.close();
  });

  it('rolls back the clock when stable recovery fails', () => {
    const db = freshDb({ max: 20, current: 0, lifeState: 'dying' });
    stabilizeCharacter(db, CTX, createSeededRng(42));
    db.exec(
      `CREATE TRIGGER fail_stable_recovery
       BEFORE UPDATE OF hp_current ON character
       WHEN NEW.id = 'pc-1'
       BEGIN SELECT RAISE(ABORT, 'injected stable recovery failure'); END`,
    );

    expect(() =>
      advanceWorldTime(db, {
        ...CTX,
        campaignId: 'campaign-1',
        minutes: 240,
      }),
    ).toThrow(/injected stable recovery failure/);
    expect(
      db.prepare('SELECT elapsed_minutes FROM clock WHERE id=1').get(),
    ).toEqual({
      elapsed_minutes: 0,
    });
    expect(readMachine(db)).toMatchObject({
      hp_current: 0,
      life_state: 'stable',
      stable_recovery_deadline_elapsed_minutes: 180,
    });
    db.close();
  });

  it('fails closed when a stable-at-zero recovery schedule is incomplete', () => {
    const db = freshDb({ max: 20, current: 0, lifeState: 'dying' });
    stabilizeCharacter(db, CTX, createSeededRng(42));
    db.prepare(
      `UPDATE character SET stable_recovery_anchor_elapsed_minutes = NULL
       WHERE id = 'pc-1'`,
    ).run();

    expect(() => resolveStableRecoveries(db, 240, CTX)).toThrow(
      /incomplete.*pc-1/,
    );
    db.close();
  });
});

describe('grantTemporaryHp', () => {
  it('grants a fresh buffer', () => {
    const db = freshDb({ max: 20, current: 10 });

    expect(grantTemporaryHp(db, 5, CTX)).toEqual({
      previousTempHp: 0,
      newTempHp: 5,
      kept: 'new',
    });
    db.close();
  });

  it('never stacks: keeps the larger pool by default', () => {
    const db = freshDb({ max: 20, current: 10, temp: 8 });

    expect(grantTemporaryHp(db, 5, CTX)).toEqual({
      previousTempHp: 8,
      newTempHp: 8,
      kept: 'existing',
    });
    expect(grantTemporaryHp(db, 12, CTX)).toEqual({
      previousTempHp: 8,
      newTempHp: 12,
      kept: 'new',
    });
    db.close();
  });

  it('honors an explicit replace choice both ways', () => {
    const db = freshDb({ max: 20, current: 10, temp: 8 });

    expect(grantTemporaryHp(db, 3, CTX, { replace: true })).toEqual({
      previousTempHp: 8,
      newTempHp: 3,
      kept: 'new',
    });
    expect(grantTemporaryHp(db, 10, CTX, { replace: false })).toEqual({
      previousTempHp: 3,
      newTempHp: 3,
      kept: 'existing',
    });
    db.close();
  });

  it('is not healing: does not wake a character at 0 HP', () => {
    const db = freshDb({ max: 20, current: 0, lifeState: 'dying' });

    grantTemporaryHp(db, 5, CTX);

    expect(readMachine(db)).toMatchObject({
      hp_current: 0,
      hp_temp: 5,
      life_state: 'dying',
    });
    db.close();
  });

  it('rejects non-positive amounts and dead characters', () => {
    const db = freshDb({ max: 20, current: 10 });
    expect(() => grantTemporaryHp(db, 0, CTX)).toThrow(MutateStateError);
    expect(() => grantTemporaryHp(db, -2, CTX)).toThrow(MutateStateError);
    db.close();

    const dead = freshDb({ max: 20, current: 0, lifeState: 'dead' });
    expect(() => grantTemporaryHp(dead, 5, CTX)).toThrow(MutateStateError);
    dead.close();
  });
});

describe('expireTemporaryHp (long-rest reset hook)', () => {
  it('clears the buffer and reports what was lost', () => {
    const db = freshDb({ max: 20, current: 10, temp: 7 });

    expect(expireTemporaryHp(db, CTX)).toEqual({ previousTempHp: 7 });
    expect(readMachine(db).hp_temp).toBe(0);
    db.close();
  });
});

describe('mutateState validation of the new character fields', () => {
  it('rejects an unknown life_state and out-of-range counters', () => {
    const db = freshDb({ max: 20, current: 10 });
    expect(() =>
      mutateState(db, {
        target: 'character',
        field: 'life_state',
        op: 'set',
        value: 'mostly-dead',
        ...CTX,
      }),
    ).toThrow(MutateStateError);
    expect(() =>
      mutateState(db, {
        target: 'character',
        field: 'death_save_failures',
        op: 'set',
        value: 4,
        ...CTX,
      }),
    ).toThrow(MutateStateError);
    expect(() =>
      mutateState(db, {
        target: 'character',
        field: 'hp_temp',
        op: 'set',
        value: -1,
        ...CTX,
      }),
    ).toThrow(MutateStateError);
    db.close();
  });
});

describe('formatHpStatus', () => {
  it('renders temp HP and death state fragments', () => {
    const base = {
      hpMax: 20,
      deathSaveSuccesses: 0,
      deathSaveFailures: 0,
    };
    expect(
      formatHpStatus({
        ...base,
        hpCurrent: 7,
        hpTemp: 0,
        lifeState: 'alive',
      }),
    ).toBe('HP 7/20');
    expect(
      formatHpStatus({
        ...base,
        hpCurrent: 7,
        hpTemp: 5,
        lifeState: 'alive',
      }),
    ).toBe('HP 7/20 (+5 temp)');
    expect(
      formatHpStatus({
        ...base,
        hpCurrent: 0,
        hpTemp: 0,
        lifeState: 'dying',
        deathSaveSuccesses: 1,
        deathSaveFailures: 2,
      }),
    ).toBe('HP 0/20 [dying, death saves 1S/2F]');
    expect(
      formatHpStatus({
        ...base,
        hpCurrent: 0,
        hpTemp: 0,
        lifeState: 'stable',
      }),
    ).toBe('HP 0/20 [stable at 0 HP]');
    expect(
      formatHpStatus({
        ...base,
        hpCurrent: 0,
        hpTemp: 0,
        lifeState: 'dead',
      }),
    ).toBe('HP 0/20 [DEAD]');
  });
});
