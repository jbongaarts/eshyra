// HP write path: damage/heal with the temporary-HP buffer and the
// death/dying/stable/dead state machine (eshyra-2n1t.8, engine family F6).
//
// SRD 5.1 semantics, code-owned so the model can never silently violate them:
//
// - Damage consumes `hp_temp` before `hp_current` (temporary-hit-points).
// - Damage that would take `hp_current` below 0 surfaces the sub-zero
//   `overflow` instead of discarding it; overflow >= hp_max is instant death
//   (instant-death).
// - Dropping to 0 HP otherwise makes the character `dying` and resets the
//   death-save counters (falling-unconscious).
// - Damage taken at 0 HP escalates: one death-save failure, two on a critical
//   hit; a stable character knocked back to dying; three failures is death.
//   The failure applies even when temporary HP absorb every point — temp HP
//   reduce the HP loss, not the damage event itself (death-saving-throws,
//   damage-at-0 escalation).
// - A dead character's HP is gated: healing is refused (`healing` dead-gate;
//   revival magic is a distinct future act, not an adjust_hp call).
// - Any healing from 0 HP returns the character to `alive` and resets the
//   death-save counters.
// - Death saves themselves: 10+ succeeds, otherwise fails; natural 1 counts
//   as two failures; natural 20 restores 1 HP; three successes stabilize,
//   three failures kill. The d20 is rolled through the `roll` tool (seeded,
//   player-visible ledger); this module owns applying the outcome.
// - Temporary HP never stack: a new grant keeps either the existing or the
//   new pool (SRD makes that a choice — the caller passes it; the default
//   keeps the larger). Granting temp HP at 0 HP does not wake the character.
//   The long rest expires the buffer via {@link expireTemporaryHp} (F7 reset
//   hook).
//
// A stable character's automatic recovery (regain 1 HP after 1d4 hours if
// still at 0) has no durable deadline yet: scheduling is model-prompted and
// only the resulting transition lands through {@link adjustHp}. That gap
// keeps stabilizing-a-creature PARTIAL in the coverage registry and is owned
// by eshyra-2n1t.8.1 (needs a seeded roll recorded at stabilize time plus a
// deterministic in-game-clock resolution hook).

import type { Db } from '../persistence/db.js';
import { withTransaction } from '../persistence/db.js';
import { resolveCharacterId } from './activeCharacter.js';
import { endAllAttunementsOnDeath } from './attunement.js';
import type { DomainMutationContext } from './domainMutations.js';
import { MutateStateError, mutateStateBatch } from './mutateState.js';

export type LifeState = 'alive' | 'dying' | 'stable' | 'dead';

/**
 * Render the HP-machine fields as the compact status fragment the prompt and
 * CLI roster lines share, e.g. `HP 7/20 (+5 temp)` or
 * `HP 0/20 [dying, death saves 1S/2F]`.
 */
export function formatHpStatus(status: {
  hpCurrent: number;
  hpMax: number;
  hpTemp: number;
  lifeState: LifeState;
  deathSaveSuccesses: number;
  deathSaveFailures: number;
}): string {
  const temp = status.hpTemp > 0 ? ` (+${status.hpTemp} temp)` : '';
  let state = '';
  if (status.lifeState === 'dying') {
    state = ` [dying, death saves ${status.deathSaveSuccesses}S/${status.deathSaveFailures}F]`;
  } else if (status.lifeState === 'stable') {
    state = ' [stable at 0 HP]';
  } else if (status.lifeState === 'dead') {
    state = ' [DEAD]';
  }
  return `HP ${status.hpCurrent}/${status.hpMax}${temp}${state}`;
}

export interface AdjustHpResult {
  previousHp: number;
  newHp: number;
  hpMax: number;
  clamped: boolean;
  previousTempHp: number;
  newTempHp: number;
  /** Damage absorbed by the temporary-HP buffer before touching hp_current. */
  tempHpAbsorbed: number;
  /** Damage beyond 0 HP (the sub-zero remainder); 0 when none. */
  overflow: number;
  previousLifeState: LifeState;
  lifeState: LifeState;
  /** True when overflow >= hp_max killed the character outright. */
  instantDeath: boolean;
  /** Death-save failures added by damage taken at 0 HP (0, 1, or 2). */
  deathSaveFailuresAdded: number;
  deathSaveSuccesses: number;
  deathSaveFailures: number;
}

export interface AdjustHpOptions {
  /**
   * The damage was a critical hit. Only consulted for damage dealt at 0 HP,
   * where a critical costs two death-save failures instead of one.
   */
  critical?: boolean;
}

interface HpRow {
  hp_current: number;
  hp_max: number;
  hp_temp: number;
  life_state: LifeState;
  death_save_successes: number;
  death_save_failures: number;
}

function readHpRow(db: Db, charId: string): HpRow {
  const row = db
    .prepare(
      `SELECT hp_current, hp_max, hp_temp, life_state,
              death_save_successes, death_save_failures
       FROM character WHERE id = ?`,
    )
    .get(charId) as HpRow | undefined;
  if (row === undefined) {
    throw new MutateStateError('no character row exists');
  }
  return row;
}

/** Write the HP-machine fields that changed, as one atomic batch. */
function writeHpFields(
  db: Db,
  charId: string,
  before: HpRow,
  after: {
    hp_current: number;
    hp_temp: number;
    life_state: LifeState;
    death_save_successes: number;
    death_save_failures: number;
  },
  ctx: DomainMutationContext,
): void {
  const mutations = (
    Object.entries(after) as [keyof typeof after, number | string][]
  )
    .filter(([field, value]) => before[field] !== value)
    .map(([field, value]) => ({
      target: 'character' as const,
      id: charId,
      field,
      op: 'set' as const,
      value,
      ...ctx,
    }));
  if (mutations.length > 0) {
    mutateStateBatch(db, mutations);
  }
  // Death ends attunement (SRD ending condition, F5): every life_state
  // transition into 'dead' — instant death, third failure, damage-at-0
  // escalation — releases the character's attunement slots.
  if (after.life_state === 'dead' && before.life_state !== 'dead') {
    endAllAttunementsOnDeath(db, charId);
  }
}

export function adjustHp(
  db: Db,
  amount: number,
  ctx: DomainMutationContext,
  options: AdjustHpOptions = {},
): AdjustHpResult {
  if (!Number.isInteger(amount)) {
    throw new MutateStateError('adjust_hp amount must be an integer');
  }

  return withTransaction(db, (txnDb) => {
    const charId = resolveCharacterId(txnDb, ctx.characterId);
    const row = readHpRow(txnDb, charId);

    if (row.life_state === 'dead') {
      throw new MutateStateError(
        amount > 0
          ? 'character is dead: healing cannot restore a dead character ' +
              '(revival is a distinct act, not an adjust_hp call)'
          : 'character is dead: hp changes no longer apply',
      );
    }

    const state =
      amount < 0
        ? applyDamage(row, -amount, options.critical === true)
        : applyHealing(row, amount);

    writeHpFields(txnDb, charId, row, state.after, ctx);

    return {
      previousHp: row.hp_current,
      newHp: state.after.hp_current,
      hpMax: row.hp_max,
      clamped: state.clamped,
      previousTempHp: row.hp_temp,
      newTempHp: state.after.hp_temp,
      tempHpAbsorbed: state.tempHpAbsorbed,
      overflow: state.overflow,
      previousLifeState: row.life_state,
      lifeState: state.after.life_state,
      instantDeath: state.instantDeath,
      deathSaveFailuresAdded: state.deathSaveFailuresAdded,
      deathSaveSuccesses: state.after.death_save_successes,
      deathSaveFailures: state.after.death_save_failures,
    };
  });
}

interface HpTransition {
  after: {
    hp_current: number;
    hp_temp: number;
    life_state: LifeState;
    death_save_successes: number;
    death_save_failures: number;
  };
  clamped: boolean;
  tempHpAbsorbed: number;
  overflow: number;
  instantDeath: boolean;
  deathSaveFailuresAdded: number;
}

function applyDamage(
  row: HpRow,
  damage: number,
  critical: boolean,
): HpTransition {
  const tempHpAbsorbed = Math.min(row.hp_temp, damage);
  const penetrating = damage - tempHpAbsorbed;
  const raw = row.hp_current - penetrating;
  const overflow = Math.max(0, -raw);
  const newHp = Math.max(0, raw);

  let lifeState: LifeState = row.life_state;
  let successes = row.death_save_successes;
  let failures = row.death_save_failures;
  let instantDeath = false;
  let failuresAdded = 0;

  if (row.hp_max === 0) {
    // Uninitialized sheet (bootstrap rows default to 0/0): keep the legacy
    // clamp behavior — a death machine keyed on hp_max would treat any hit
    // as instant death.
  } else if (row.hp_current > 0 && newHp === 0) {
    // Dropping to 0: instant death when the remainder reaches the maximum,
    // otherwise fall unconscious and start dying with fresh counters.
    if (overflow >= row.hp_max) {
      lifeState = 'dead';
      instantDeath = true;
    } else {
      lifeState = 'dying';
    }
    successes = 0;
    failures = 0;
  } else if (row.hp_current === 0) {
    // Damage at 0 HP: the damage *event* costs a death-save failure (double
    // on a crit) and knocks a stable character back to dying even when the
    // temp-HP buffer absorbs every point — temp HP reduce the HP loss, not
    // the hit. Only the penetrating remainder (= overflow here) feeds the
    // instant-death threshold, which applies first.
    if (overflow >= row.hp_max) {
      lifeState = 'dead';
      instantDeath = true;
    } else {
      failuresAdded = critical ? 2 : 1;
      failures = Math.min(3, failures + failuresAdded);
      lifeState = failures >= 3 ? 'dead' : 'dying';
    }
  }

  return {
    after: {
      hp_current: newHp,
      hp_temp: row.hp_temp - tempHpAbsorbed,
      life_state: lifeState,
      death_save_successes: successes,
      death_save_failures: failures,
    },
    clamped: overflow > 0,
    tempHpAbsorbed,
    overflow,
    instantDeath,
    deathSaveFailuresAdded: failuresAdded,
  };
}

function applyHealing(row: HpRow, amount: number): HpTransition {
  const raw = row.hp_current + amount;
  const newHp = Math.min(raw, row.hp_max);
  const revived = row.life_state !== 'alive' && newHp > 0;

  return {
    after: {
      hp_current: newHp,
      hp_temp: row.hp_temp,
      life_state: revived ? 'alive' : row.life_state,
      death_save_successes: revived ? 0 : row.death_save_successes,
      death_save_failures: revived ? 0 : row.death_save_failures,
    },
    clamped: raw !== newHp,
    tempHpAbsorbed: 0,
    overflow: 0,
    instantDeath: false,
    deathSaveFailuresAdded: 0,
  };
}

export type DeathSaveOutcome =
  | 'success'
  | 'failure'
  | 'critical-failure'
  | 'revived'
  | 'stabilized'
  | 'dead';

export interface DeathSaveResult {
  roll: number;
  outcome: DeathSaveOutcome;
  deathSaveSuccesses: number;
  deathSaveFailures: number;
  lifeState: LifeState;
  hpCurrent: number;
}

/**
 * Apply one already-rolled d20 death saving throw to a dying character.
 * The die goes through the `roll` tool (category `death_save`) so it is
 * seeded and ledgered; this mutation owns the outcome semantics.
 */
export function recordDeathSave(
  db: Db,
  roll: number,
  ctx: DomainMutationContext,
): DeathSaveResult {
  if (!Number.isInteger(roll) || roll < 1 || roll > 20) {
    throw new MutateStateError(
      'death save roll must be an integer between 1 and 20',
    );
  }

  return withTransaction(db, (txnDb) => {
    const charId = resolveCharacterId(txnDb, ctx.characterId);
    const row = readHpRow(txnDb, charId);

    if (row.life_state !== 'dying') {
      throw new MutateStateError(
        `death saves apply only to a dying character (current state: ${row.life_state})`,
      );
    }

    let outcome: DeathSaveOutcome;
    let hpCurrent = row.hp_current;
    let lifeState: LifeState = 'dying';
    let successes = row.death_save_successes;
    let failures = row.death_save_failures;

    if (roll === 20) {
      // Natural 20: regain 1 hit point; counters reset on regaining HP.
      outcome = 'revived';
      hpCurrent = Math.min(1, row.hp_max);
      lifeState = 'alive';
      successes = 0;
      failures = 0;
    } else if (roll === 1) {
      failures = Math.min(3, failures + 2);
      outcome = failures >= 3 ? 'dead' : 'critical-failure';
      lifeState = failures >= 3 ? 'dead' : 'dying';
    } else if (roll >= 10) {
      successes += 1;
      if (successes >= 3) {
        // Third success: stable; counters reset on becoming stable.
        outcome = 'stabilized';
        lifeState = 'stable';
        successes = 0;
        failures = 0;
      } else {
        outcome = 'success';
      }
    } else {
      failures += 1;
      outcome = failures >= 3 ? 'dead' : 'failure';
      lifeState = failures >= 3 ? 'dead' : 'dying';
    }

    writeHpFields(
      txnDb,
      charId,
      row,
      {
        hp_current: hpCurrent,
        hp_temp: row.hp_temp,
        life_state: lifeState,
        death_save_successes: successes,
        death_save_failures: failures,
      },
      ctx,
    );

    return {
      roll,
      outcome,
      deathSaveSuccesses: successes,
      deathSaveFailures: failures,
      lifeState,
      hpCurrent,
    };
  });
}

export interface StabilizeResult {
  lifeState: LifeState;
  hpCurrent: number;
}

/**
 * Mark a dying character stable (successful DC 10 Wisdom (Medicine) check or
 * equivalent magic — the check itself is adjudicated through `roll`). A stable
 * character stays at 0 HP and unconscious but makes no death saves; the
 * counters reset on becoming stable.
 */
export function stabilizeCharacter(
  db: Db,
  ctx: DomainMutationContext,
): StabilizeResult {
  return withTransaction(db, (txnDb) => {
    const charId = resolveCharacterId(txnDb, ctx.characterId);
    const row = readHpRow(txnDb, charId);

    if (row.life_state !== 'dying') {
      throw new MutateStateError(
        `only a dying character can be stabilized (current state: ${row.life_state})`,
      );
    }

    writeHpFields(
      txnDb,
      charId,
      row,
      {
        hp_current: row.hp_current,
        hp_temp: row.hp_temp,
        life_state: 'stable',
        death_save_successes: 0,
        death_save_failures: 0,
      },
      ctx,
    );

    return { lifeState: 'stable', hpCurrent: row.hp_current };
  });
}

export interface GrantTemporaryHpOptions {
  /**
   * Resolution of the SRD no-stacking choice when a buffer already exists:
   * `true` replaces the existing pool with the new one, `false` keeps the
   * existing pool. Omitted keeps whichever is larger.
   */
  replace?: boolean;
}

export interface GrantTemporaryHpResult {
  previousTempHp: number;
  newTempHp: number;
  /** Which pool survived the no-stacking choice. */
  kept: 'new' | 'existing';
}

/**
 * Grant temporary hit points. Temp HP never stack and are not healing:
 * granting them to a character at 0 HP does not restore consciousness or
 * change the death state.
 */
export function grantTemporaryHp(
  db: Db,
  amount: number,
  ctx: DomainMutationContext,
  options: GrantTemporaryHpOptions = {},
): GrantTemporaryHpResult {
  if (!Number.isInteger(amount) || amount <= 0) {
    throw new MutateStateError(
      'temporary hp amount must be a positive integer',
    );
  }

  return withTransaction(db, (txnDb) => {
    const charId = resolveCharacterId(txnDb, ctx.characterId);
    const row = readHpRow(txnDb, charId);

    if (row.life_state === 'dead') {
      throw new MutateStateError(
        'character is dead: temporary hit points no longer apply',
      );
    }

    const keepNew =
      row.hp_temp === 0 || (options.replace ?? amount >= row.hp_temp);
    const newTempHp = keepNew ? amount : row.hp_temp;

    writeHpFields(
      txnDb,
      charId,
      row,
      {
        hp_current: row.hp_current,
        hp_temp: newTempHp,
        life_state: row.life_state,
        death_save_successes: row.death_save_successes,
        death_save_failures: row.death_save_failures,
      },
      ctx,
    );

    return {
      previousTempHp: row.hp_temp,
      newTempHp,
      kept: keepNew ? 'new' : 'existing',
    };
  });
}

export interface ExpireTemporaryHpResult {
  previousTempHp: number;
}

/**
 * Clear the temporary-HP buffer. This is the long-rest expiry reset hook the
 * rest engine (F7, eshyra-2n1t.9) calls; temp HP granted with a shorter
 * stated duration are expired by the DM model calling the same operation.
 */
export function expireTemporaryHp(
  db: Db,
  ctx: DomainMutationContext,
): ExpireTemporaryHpResult {
  return withTransaction(db, (txnDb) => {
    const charId = resolveCharacterId(txnDb, ctx.characterId);
    const row = readHpRow(txnDb, charId);

    writeHpFields(
      txnDb,
      charId,
      row,
      {
        hp_current: row.hp_current,
        hp_temp: 0,
        life_state: row.life_state,
        death_save_successes: row.death_save_successes,
        death_save_failures: row.death_save_failures,
      },
      ctx,
    );

    return { previousTempHp: row.hp_temp };
  });
}
