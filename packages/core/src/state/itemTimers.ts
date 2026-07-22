import { rollDice } from '../orchestrator/dice.js';
import type { Rng } from '../orchestrator/rng.js';
import type { Db } from '../persistence/db.js';
import type { MagicItemDurationSpec } from '../rules/magicItemMechanics.js';

export interface ItemStateTimer {
  readonly from: string;
  readonly to: string;
  readonly anchorElapsedMinutes: number;
  readonly deadlineElapsedMinutes: number;
  readonly amount: number;
  readonly unit: 'minute' | 'hour' | 'day';
  readonly roll?: {
    readonly notation: string;
    readonly rolls: readonly number[];
    readonly total: number;
  };
}

export interface PendingItemTimerDeclaration {
  readonly to: string;
  readonly timer: MagicItemDurationSpec;
}

export class ItemTimerError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ItemTimerError';
  }
}

function currentElapsedMinutes(db: Db): number {
  const row = db
    .prepare('SELECT elapsed_minutes FROM clock WHERE id=1')
    .get() as { elapsed_minutes: number } | undefined;
  if (
    row === undefined ||
    !Number.isSafeInteger(row.elapsed_minutes) ||
    row.elapsed_minutes < 0
  )
    throw new ItemTimerError('campaign clock elapsed_minutes is malformed');
  return row.elapsed_minutes;
}

function durationMinutes(amount: number, unit: ItemStateTimer['unit']): number {
  const multiplier = unit === 'minute' ? 1 : unit === 'hour' ? 60 : 1_440;
  const minutes = amount * multiplier;
  if (!Number.isSafeInteger(minutes) || minutes < 0)
    throw new ItemTimerError('item timer duration exceeds elapsed-world range');
  return minutes;
}

/** Resolve newly entered timed-state declarations against campaign world time. */
export function resolveItemStateTimers(
  db: Db,
  from: string,
  declarations: readonly PendingItemTimerDeclaration[],
  rng: Rng | undefined,
  options: {
    readonly anchorElapsedMinutes?: number;
    readonly preserved?: readonly ItemStateTimer[];
  } = {},
): readonly ItemStateTimer[] {
  if (declarations.length === 0) return [];
  let anchor = options.anchorElapsedMinutes;
  const getAnchor = (): number => {
    anchor ??= currentElapsedMinutes(db);
    if (!Number.isSafeInteger(anchor) || anchor < 0)
      throw new ItemTimerError(
        'item timer anchor must be a nonnegative safe integer',
      );
    return anchor;
  };
  return declarations.map(({ to, timer }) => {
    const preserved = options.preserved?.find(
      (candidate) => candidate.from === from && candidate.to === to,
    );
    if (preserved !== undefined) return preserved;
    if (timer.unit === 'round')
      throw new ItemTimerError(
        `item timer '${from}' -> '${to}' is round-based and requires the encounter-round scheduler`,
      );
    const resolved =
      typeof timer.amount === 'number'
        ? { amount: timer.amount }
        : (() => {
            if (rng === undefined)
              throw new ItemTimerError(
                `item timer is dice-defined (${timer.amount}); seeded RNG is required`,
              );
            const rolled = rollDice(timer.amount, rng);
            return {
              amount: rolled.total,
              roll: {
                notation: rolled.notation,
                rolls: rolled.rolls,
                total: rolled.total,
              },
            };
          })();
    if (!Number.isSafeInteger(resolved.amount) || resolved.amount < 0)
      throw new ItemTimerError(
        'item timer amount must be a nonnegative integer',
      );
    const resolvedAnchor = getAnchor();
    const deadlineElapsedMinutes =
      resolvedAnchor + durationMinutes(resolved.amount, timer.unit);
    if (!Number.isSafeInteger(deadlineElapsedMinutes))
      throw new ItemTimerError(
        'item timer deadline exceeds elapsed-world range',
      );
    return {
      from,
      to,
      anchorElapsedMinutes: resolvedAnchor,
      deadlineElapsedMinutes,
      amount: resolved.amount,
      unit: timer.unit,
      ...('roll' in resolved ? { roll: resolved.roll } : {}),
    };
  });
}

/**
 * A state machine has one current state, so timers from the state being left
 * are cancelled. Re-entry preserves matching pending timers unless the
 * transition explicitly opts into resetting their duration.
 */
export function reconcileItemStateTimers(
  transitionTo: string,
  resolvedForEnteredState: readonly ItemStateTimer[],
): readonly ItemStateTimer[] {
  if (resolvedForEnteredState.some((timer) => timer.from !== transitionTo))
    throw new ItemTimerError(
      `resolved item timers do not belong to entered state '${transitionTo}'`,
    );
  return [...resolvedForEnteredState];
}
