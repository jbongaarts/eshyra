/** Pure transitions for encounter-combatant lifecycle state.
 *
 * Persistence adapters own rule-pack lookup, rolling, side effects, and SQL.
 * They pass the resolved facts here and persist the complete state returned by
 * this function. Keeping the transition pure makes death priority, recovery,
 * and head tracking independent of which tool produced an event.
 */

export type CombatantLifeStatus =
  | 'alive'
  | 'dead'
  | 'unconscious'
  | 'escaped'
  | 'inactive'
  | 'dying'
  | 'stable'
  /** Out of play under a rule (vanished at 0 HP, melted, or removed by its
   *  owning effect). Engine-owned; never returns to another status. */
  | 'absent';

/** What a creature's own rules say happens when it drops to 0 hit points:
 *  'vanish' = it disappears (Conjure Animals, Find Familiar, Simulacrum);
 *  'revert' = it returns to its original form (Animate Objects, Giant
 *  Insect). Only 'vanish' changes the lifecycle automatically. */
export type ZeroHpRule = 'vanish' | 'revert';

export interface StableRecoverySchedule {
  readonly roll: number;
  readonly anchor: number;
  readonly deadline: number;
}

export interface CombatantLifecycleState {
  readonly status: CombatantLifeStatus;
  readonly hpCurrent: number;
  readonly hpMax: number;
  readonly effectiveHpMax: number;
  readonly deathRules: 'monster' | 'player-character';
  readonly exhaustionLevel: number;
  readonly deathSaveSuccesses: number;
  readonly deathSaveFailures: number;
  readonly recoveryBlock: 'suffocating' | null;
  readonly stableRecovery: StableRecoverySchedule | null;
  readonly stableRecoverySettled: boolean;
  /** True only for the actor's selected schedule-owning projection row. */
  readonly projectionOwner: boolean;
  readonly headCount: number | null;
  readonly headsDiedSinceOwnTurn: number;
  readonly fireDamageSinceOwnTurn: number;
  readonly damageThisTurn: number;
  readonly damageTurnKey: string | null;
  readonly headDiedThisTurn: number;
  /** Durable creature property set by the owning effect (see ZeroHpRule). */
  readonly zeroHpRule: ZeroHpRule | null;
}

export interface CombatantHeadMechanic {
  readonly damageThreshold: number;
  readonly deathWhenNoHeads: boolean;
  readonly regrowHeadsPerHead: number;
  readonly hpPerHead: number;
  readonly regrowthSuppressedByFire: boolean;
}

export type CombatantLifecycleEvent =
  | {
      readonly type: 'damage';
      readonly amount: number;
      readonly critical?: boolean;
      readonly damageTypes?: readonly string[];
      readonly turnKey?: string;
      readonly headMechanic?: CombatantHeadMechanic;
    }
  | { readonly type: 'heal'; readonly amount: number }
  | { readonly type: 'clampToEffectiveMax' }
  | { readonly type: 'setStatus'; readonly status: CombatantLifeStatus }
  | { readonly type: 'optIntoPlayerCharacterRules' }
  /** F3 remove: take the combatant out of play (status absent). */
  | { readonly type: 'removeFromPlay' }
  | { readonly type: 'deathSave'; readonly roll: number }
  | { readonly type: 'stabilize' }
  | {
      readonly type: 'knockout';
      readonly damage: number;
      readonly damageTypes?: readonly string[];
      readonly turnKey?: string;
      readonly headMechanic?: CombatantHeadMechanic;
    }
  | { readonly type: 'suffocationDrop' }
  | { readonly type: 'suffocationBreathe' }
  | {
      readonly type: 'exhaustionChanged';
      readonly newLevel: number;
      readonly newEffectiveHpMax: number;
      readonly newHpMax?: number;
    }
  | { readonly type: 'headDied'; readonly headMechanic: CombatantHeadMechanic }
  | {
      readonly type: 'headsRegrown';
      readonly count: number;
      readonly hpPerHead: number;
      readonly fireDamage?: boolean;
      readonly allowHealing?: boolean;
    }
  | { readonly type: 'recoveryDue'; readonly elapsedMinutes: number }
  | {
      readonly type: 'admission';
      readonly suppliedHp?: number;
      readonly suppliedStatus?: CombatantLifeStatus;
      readonly deathRules?: 'monster' | 'player-character';
      readonly headCount?: number | null;
    }
  | { readonly type: 'beginTurn'; readonly turnKey?: string }
  | { readonly type: 'invalidateProjection' }
  | {
      readonly type: 'transferSchedule';
      readonly schedule: StableRecoverySchedule | null;
      readonly settled: boolean;
    };

export interface CombatantLifecycleContext {
  /** A seeded roll and clock anchor prepared by the persistence adapter. */
  readonly recoverySchedule?: StableRecoverySchedule;
}

export type CombatantLifecycleResult =
  | {
      readonly ok: true;
      readonly state: CombatantLifecycleState;
      readonly regained?: number;
    }
  | { readonly ok: false; readonly refusal: string };

function refusal(refusal: string): CombatantLifecycleResult {
  return { ok: false, refusal };
}

/** Leave a combatant out of play with no residual life-state bookkeeping. */
function toAbsent(
  next: {
    -readonly [K in keyof CombatantLifecycleState]: CombatantLifecycleState[K];
  },
): void {
  next.status = 'absent';
  next.deathSaveSuccesses = 0;
  next.deathSaveFailures = 0;
  next.recoveryBlock = null;
  next.stableRecovery = null;
  next.stableRecoverySettled = false;
}

function scheduleFor(
  context: CombatantLifecycleContext,
): StableRecoverySchedule | null {
  return context.recoverySchedule ?? null;
}

/** Apply one lifecycle event and return a complete, invariant-valid state. */
export function nextCombatantLifecycle(
  current: CombatantLifecycleState,
  event: CombatantLifecycleEvent,
  context: CombatantLifecycleContext = {},
): CombatantLifecycleResult {
  const next: {
    -readonly [K in keyof CombatantLifecycleState]: CombatantLifecycleState[K];
  } = { ...current };
  let regained: number | undefined;

  // Terminal causes are applied before the event. A level/head death cannot be
  // undone by the effective-maximum clamp at the end of another transition.
  if (
    next.status !== 'absent' &&
    (next.exhaustionLevel === 6 || next.headCount === 0)
  ) {
    next.status = 'dead';
    next.hpCurrent = Math.min(next.hpCurrent, next.effectiveHpMax);
    next.recoveryBlock = null;
    next.stableRecovery = null;
    next.stableRecoverySettled = false;
  }

  if (next.status === 'absent') {
    // An absent combatant is out of play: no turn, no death saves, no
    // stabilizing, no recovery, no suffocation, no healing or damage. Only
    // bookkeeping that cannot change its participation is accepted.
    if (event.type === 'beginTurn') {
      next.damageThisTurn = 0;
      next.damageTurnKey = event.turnKey ?? null;
      next.headDiedThisTurn = 0;
    } else if (event.type === 'invalidateProjection') {
      next.projectionOwner = false;
    } else if (event.type === 'removeFromPlay') {
      // Idempotent: already out of play.
    } else if (
      event.type !== 'admission' &&
      event.type !== 'clampToEffectiveMax' &&
      event.type !== 'exhaustionChanged' &&
      !(event.type === 'headsRegrown' && event.count === 0) &&
      !(event.type === 'transferSchedule' && event.schedule === null)
    ) {
      return refusal(
        event.type === 'setStatus'
          ? 'an absent combatant cannot change status'
          : 'an absent combatant is out of play and cannot undergo this lifecycle event',
      );
    }
    if (event.type === 'exhaustionChanged') {
      next.exhaustionLevel = event.newLevel;
      next.effectiveHpMax = event.newEffectiveHpMax;
      if (event.newHpMax !== undefined) next.hpMax = event.newHpMax;
    }
    next.hpCurrent = Math.min(next.hpCurrent, next.effectiveHpMax);
  } else if (event.type === 'removeFromPlay') {
    // F3 remove. Dying and stable creatures are unreachable here: a creature
    // whose owner can remove it never has player-character death rules.
    if (next.status === 'dying' || next.status === 'stable')
      return refusal(
        `internal invariant: a ${next.status} combatant cannot be removed from play`,
      );
    toAbsent(next);
  } else if (next.status === 'dead') {
    // D2 (reversed): a dead combatant stays dead in both death-rule modes
    // (SRD rule:healing); no revival event exists, so positive heals refuse.
    if (
      event.type === 'exhaustionChanged' ||
      event.type === 'clampToEffectiveMax' ||
      event.type === 'beginTurn' ||
      (event.type === 'headsRegrown' && event.count === 0) ||
      event.type === 'transferSchedule' ||
      event.type === 'invalidateProjection' ||
      event.type === 'admission'
    ) {
      // A non-damage clamp or unrelated write never revives a dead combatant.
      if (event.type === 'exhaustionChanged') {
        next.exhaustionLevel = event.newLevel;
        next.effectiveHpMax = event.newEffectiveHpMax;
        if (event.newHpMax !== undefined) next.hpMax = event.newHpMax;
      }
      if (event.type === 'headsRegrown' && event.count === 0) {
        next.headsDiedSinceOwnTurn = 0;
        next.fireDamageSinceOwnTurn = 0;
        next.damageThisTurn = 0;
        next.damageTurnKey = null;
        next.headDiedThisTurn = 0;
      }
      if (event.type === 'beginTurn') {
        next.damageThisTurn = 0;
        next.damageTurnKey = event.turnKey ?? null;
        next.headDiedThisTurn = 0;
      }
      if (event.type === 'invalidateProjection') {
        next.stableRecovery = null;
        next.stableRecoverySettled = false;
        next.projectionOwner = false;
      }
      if (event.type === 'transferSchedule') {
        next.stableRecovery = event.schedule;
        next.stableRecoverySettled = event.settled;
      }
      if (event.type === 'admission') {
        if (event.suppliedHp !== undefined) next.hpCurrent = event.suppliedHp;
        if (event.deathRules !== undefined) next.deathRules = event.deathRules;
        if (event.headCount !== undefined) next.headCount = event.headCount;
        // Admission data cannot overwrite an already-terminal status.
        next.status = 'dead';
      }
      next.hpCurrent = Math.min(next.hpCurrent, next.effectiveHpMax);
    } else if (event.type === 'heal' && event.amount === 0) {
      // A zero-regain heal is an unrelated write.
    } else if (event.type === 'setStatus') {
      return refusal('dead combatant cannot change status');
    } else {
      return refusal('a dead combatant cannot undergo this lifecycle event');
    }
  } else {
    switch (event.type) {
      case 'damage': {
        if (!Number.isInteger(event.amount) || event.amount <= 0)
          return refusal('damage amount must be a positive integer');
        if (
          event.turnKey !== undefined &&
          next.damageTurnKey !== event.turnKey
        ) {
          next.damageTurnKey = event.turnKey;
          next.damageThisTurn = 0;
          next.headDiedThisTurn = 0;
        }
        next.damageThisTurn += event.amount;
        if (event.damageTypes?.includes('fire'))
          next.fireDamageSinceOwnTurn = 1;
        const oldHp = next.hpCurrent;
        next.hpCurrent = Math.max(
          0,
          Math.min(next.effectiveHpMax, oldHp - event.amount),
        );

        if (
          next.headCount !== null &&
          event.headMechanic &&
          next.headDiedThisTurn === 0 &&
          next.damageThisTurn >= event.headMechanic.damageThreshold
        ) {
          next.headCount = Math.max(0, next.headCount - 1);
          next.headsDiedSinceOwnTurn += 1;
          next.headDiedThisTurn = 1;
        }
        if (next.headCount === 0 && event.headMechanic?.deathWhenNoHeads) {
          next.status = 'dead';
        } else if (
          next.zeroHpRule === 'vanish' &&
          oldHp > 0 &&
          next.hpCurrent === 0
        ) {
          // The creature's own rules say it disappears at 0 hit points.
          toAbsent(next);
        } else if (next.deathRules === 'player-character') {
          if (oldHp > 0 && next.hpCurrent === 0) {
            const overflow = Math.max(0, event.amount - oldHp);
            next.status =
              overflow > 0 && overflow >= next.effectiveHpMax
                ? 'dead'
                : 'dying';
            next.deathSaveSuccesses = 0;
            next.deathSaveFailures = 0;
          } else if (
            oldHp === 0 &&
            (next.status === 'dying' || next.status === 'stable')
          ) {
            if (event.amount >= next.effectiveHpMax) {
              next.status = 'dead';
            } else {
              next.deathSaveFailures = Math.min(
                3,
                next.deathSaveFailures + (event.critical ? 2 : 1),
              );
              next.status = next.deathSaveFailures >= 3 ? 'dead' : 'dying';
            }
          }
        } else if (
          next.hpCurrent === 0 &&
          (oldHp > 0 || next.status === 'unconscious')
        ) {
          // Monster rules: dropping to 0 kills, and so does any damage to a
          // knocked-out (unconscious at 0 HP) monster (S35).
          next.status = 'dead';
        }
        if (next.status !== 'stable') {
          next.stableRecovery = null;
          next.stableRecoverySettled = false;
        }
        if (next.status === 'dead') next.recoveryBlock = null;
        break;
      }
      case 'heal': {
        if (!Number.isInteger(event.amount) || event.amount < 0)
          return refusal('healing amount must be a non-negative integer');
        if (event.amount > 0 && next.recoveryBlock !== null)
          return refusal(
            `cannot regain hit points while ${next.recoveryBlock}`,
          );
        next.hpCurrent = Math.min(
          next.effectiveHpMax,
          next.hpCurrent + event.amount,
        );
        if (
          next.status === 'stable' &&
          next.stableRecoverySettled &&
          next.effectiveHpMax > 0
        ) {
          const schedule = scheduleFor(context);
          if (!schedule)
            return refusal(
              're-arming stable recovery requires a seeded schedule',
            );
          next.stableRecovery = schedule;
          next.stableRecoverySettled = false;
        }
        if (
          next.hpCurrent > 0 &&
          (next.status === 'dying' || next.status === 'stable')
        ) {
          next.status = 'alive';
          next.deathSaveSuccesses = 0;
          next.deathSaveFailures = 0;
          next.stableRecovery = null;
          next.stableRecoverySettled = false;
        }
        break;
      }
      case 'clampToEffectiveMax':
        next.hpCurrent = Math.min(next.hpCurrent, next.effectiveHpMax);
        if (current.hpCurrent > 0 && next.hpCurrent === 0) {
          if (next.zeroHpRule === 'vanish') {
            toAbsent(next);
          } else {
            next.status =
              next.deathRules === 'player-character' ? 'dying' : 'dead';
            next.deathSaveSuccesses = 0;
            next.deathSaveFailures = 0;
          }
        }
        if (next.status !== 'stable') {
          next.stableRecovery = null;
          next.stableRecoverySettled = false;
        }
        if (next.status === 'dead') next.recoveryBlock = null;
        break;
      case 'setStatus':
        if (event.status === 'absent')
          return refusal(
            "status 'absent' is engine-owned: a creature leaves play through its owning effect or its zero-hit-point rule",
          );
        if (event.status === 'dying' && next.deathRules !== 'player-character')
          return refusal(
            "status 'dying' requires player-character death rules",
          );
        if (
          event.status === 'stable' &&
          (next.deathRules !== 'player-character' ||
            next.hpCurrent !== 0 ||
            next.recoveryBlock !== null)
        )
          return refusal(
            'stable requires an unblocked player-character at 0 HP',
          );
        if (
          (event.status === 'alive' || event.status === 'unconscious') &&
          next.deathRules === 'player-character' &&
          next.hpCurrent === 0
        )
          return refusal(`status '${event.status}' needs hit points above 0`);
        next.status = event.status;
        if (event.status === 'stable') {
          next.deathSaveSuccesses = 0;
          next.deathSaveFailures = 0;
          const schedule = scheduleFor(context);
          if (!schedule)
            return refusal('stabilizing requires a seeded recovery schedule');
          next.stableRecovery = schedule;
          next.stableRecoverySettled = false;
        } else {
          next.stableRecovery = null;
          next.stableRecoverySettled = false;
        }
        if (event.status === 'dead') next.recoveryBlock = null;
        break;
      case 'optIntoPlayerCharacterRules':
        if (next.zeroHpRule !== null)
          return refusal(
            `cannot opt a creature whose spell says it ${
              next.zeroHpRule === 'vanish'
                ? 'disappears'
                : 'returns to its original form'
            } at 0 hit points into player-character death rules`,
          );
        if (next.hpCurrent === 0 && current.status !== 'dead')
          return refusal(
            'cannot opt a 0 HP combatant into player-character death rules unless it is dead',
          );
        next.deathRules = 'player-character';
        break;
      case 'deathSave': {
        if (!Number.isInteger(event.roll) || event.roll < 1 || event.roll > 20)
          return refusal('death save roll must be between 1 and 20');
        if (next.deathRules !== 'player-character' || next.status !== 'dying')
          return refusal(
            'only a dying player-character combatant may make death saves',
          );
        if (
          event.roll === 20 &&
          next.recoveryBlock === null &&
          next.effectiveHpMax > 0
        ) {
          next.hpCurrent = Math.min(1, next.effectiveHpMax);
          next.status = 'alive';
          next.deathSaveSuccesses = 0;
          next.deathSaveFailures = 0;
        } else if (event.roll >= 10) {
          // Ordinary success, and a natural 20 that cannot regain HP, share
          // one capped-success path (S28/S34).
          next.deathSaveSuccesses = Math.min(3, next.deathSaveSuccesses + 1);
          if (next.deathSaveSuccesses >= 3 && next.recoveryBlock === null) {
            next.status = 'stable';
            next.deathSaveSuccesses = 0;
            next.deathSaveFailures = 0;
            const schedule = scheduleFor(context);
            if (!schedule)
              return refusal('stabilizing requires a seeded recovery schedule');
            next.stableRecovery = schedule;
            next.stableRecoverySettled = false;
          }
        } else {
          next.deathSaveFailures = Math.min(
            3,
            next.deathSaveFailures + (event.roll === 1 ? 2 : 1),
          );
          if (next.deathSaveFailures >= 3) {
            next.status = 'dead';
            next.recoveryBlock = null;
          }
        }
        break;
      }
      case 'stabilize':
        if (next.deathRules !== 'player-character' || next.status !== 'dying')
          return refusal(
            'only a dying player-character combatant can be stabilized',
          );
        if (next.recoveryBlock !== null)
          return refusal(`cannot stabilize while ${next.recoveryBlock}`);
        next.status = 'stable';
        next.deathSaveSuccesses = 0;
        next.deathSaveFailures = 0;
        if (!scheduleFor(context))
          return refusal('stabilizing requires a seeded recovery schedule');
        next.stableRecovery = scheduleFor(context);
        next.stableRecoverySettled = false;
        break;
      case 'knockout': {
        if (next.zeroHpRule !== null)
          return refusal(
            `a knockout is refused: the creature's spell says it ${
              next.zeroHpRule === 'vanish'
                ? 'disappears'
                : 'returns to its original form'
            } when it drops to 0 hit points`,
          );
        if (
          !Number.isInteger(event.damage) ||
          event.damage <= 0 ||
          current.hpCurrent <= 0 ||
          next.recoveryBlock !== null
        )
          return refusal(
            'a knockout requires positive damage against an unblocked combatant above 0 HP',
          );
        next.hpCurrent = 0;
        if (
          event.turnKey !== undefined &&
          next.damageTurnKey !== event.turnKey
        ) {
          next.damageTurnKey = event.turnKey;
          next.damageThisTurn = 0;
          next.headDiedThisTurn = 0;
        }
        next.damageThisTurn += event.damage;
        if (event.damageTypes?.includes('fire'))
          next.fireDamageSinceOwnTurn = 1;
        if (
          next.headCount !== null &&
          event.headMechanic &&
          next.headDiedThisTurn === 0 &&
          next.damageThisTurn >= event.headMechanic.damageThreshold
        ) {
          next.headCount = Math.max(0, next.headCount - 1);
          next.headsDiedSinceOwnTurn += 1;
          next.headDiedThisTurn = 1;
        }
        if (next.headCount === 0 && event.headMechanic?.deathWhenNoHeads) {
          next.status = 'dead';
          next.recoveryBlock = null;
          next.stableRecovery = null;
          next.stableRecoverySettled = false;
          break;
        }
        if (next.deathRules === 'monster') {
          // Default monster rules: a nonlethal knockout leaves the creature
          // unconscious at 0 HP with no death-save or recovery state.
          next.status = 'unconscious';
          next.deathSaveSuccesses = 0;
          next.deathSaveFailures = 0;
          next.stableRecovery = null;
          next.stableRecoverySettled = false;
          break;
        }
        next.status = 'stable';
        next.deathSaveSuccesses = 0;
        next.deathSaveFailures = 0;
        if (!scheduleFor(context))
          return refusal('knockout requires a seeded recovery schedule');
        next.stableRecovery = scheduleFor(context);
        next.stableRecoverySettled = false;
        break;
      }
      case 'suffocationDrop':
        if (current.status === 'dead')
          return refusal('cannot begin suffocation for a dead combatant');
        if (next.recoveryBlock === null) {
          const wasDying = next.status === 'dying';
          next.hpCurrent = 0;
          if (next.zeroHpRule === 'vanish') {
            toAbsent(next);
            break;
          }
          next.status =
            next.deathRules === 'player-character' ? 'dying' : 'dead';
          next.recoveryBlock = next.status === 'dying' ? 'suffocating' : null;
          if (next.status === 'dying' && !wasDying) {
            next.deathSaveSuccesses = 0;
            next.deathSaveFailures = 0;
          }
          next.stableRecovery = null;
          next.stableRecoverySettled = false;
        }
        break;
      case 'suffocationBreathe':
        if (next.recoveryBlock === null)
          return refusal('combatant has no recovery block to clear');
        next.recoveryBlock = null;
        if (next.status === 'dying' && next.deathSaveSuccesses >= 3) {
          next.status = 'stable';
          next.deathSaveSuccesses = 0;
          next.deathSaveFailures = 0;
          if (!scheduleFor(context))
            return refusal(
              'breathing into stability requires a seeded recovery schedule',
            );
          next.stableRecovery = scheduleFor(context);
          next.stableRecoverySettled = false;
        }
        break;
      case 'exhaustionChanged': {
        if (
          !Number.isInteger(event.newLevel) ||
          event.newLevel < 0 ||
          event.newLevel > 6 ||
          !Number.isInteger(event.newEffectiveHpMax) ||
          event.newEffectiveHpMax < 0
        )
          return refusal('invalid exhaustion lifecycle facts');
        next.exhaustionLevel = event.newLevel;
        next.effectiveHpMax = event.newEffectiveHpMax;
        if (event.newHpMax !== undefined) next.hpMax = event.newHpMax;
        if (event.newLevel === 6) {
          next.status = 'dead';
          next.hpCurrent = Math.min(next.hpCurrent, next.effectiveHpMax);
          next.recoveryBlock = null;
          next.stableRecovery = null;
          next.stableRecoverySettled = false;
        } else {
          next.hpCurrent = Math.min(next.hpCurrent, next.effectiveHpMax);
          if (current.hpCurrent > 0 && next.hpCurrent === 0) {
            if (next.zeroHpRule === 'vanish') {
              toAbsent(next);
            } else {
              next.status =
                next.deathRules === 'player-character' ? 'dying' : 'dead';
              next.deathSaveSuccesses = 0;
              next.deathSaveFailures = 0;
            }
          }
          if (current.stableRecoverySettled && event.newEffectiveHpMax > 0) {
            if (!scheduleFor(context))
              return refusal(
                're-arming stable recovery requires a seeded schedule',
              );
            next.stableRecovery = scheduleFor(context);
            next.stableRecoverySettled = false;
          }
        }
        break;
      }
      case 'headDied':
        if (next.headCount === null)
          return refusal('tracked head count is unavailable');
        next.headCount = Math.max(0, next.headCount - 1);
        next.headsDiedSinceOwnTurn += 1;
        if (next.headCount === 0 && event.headMechanic.deathWhenNoHeads) {
          next.status = 'dead';
          next.recoveryBlock = null;
          next.stableRecovery = null;
          next.stableRecoverySettled = false;
        }
        break;
      case 'headsRegrown':
        if (
          next.headCount === null ||
          !Number.isInteger(event.count) ||
          event.count < 0 ||
          !Number.isInteger(event.hpPerHead) ||
          event.hpPerHead < 0
        )
          return refusal('tracked head count or regrowth values are invalid');
        if (event.fireDamage && next.fireDamageSinceOwnTurn > 0)
          return refusal('head regrowth is suppressed by fire damage');
        next.headsDiedSinceOwnTurn = 0;
        next.fireDamageSinceOwnTurn = 0;
        next.damageThisTurn = 0;
        next.damageTurnKey = null;
        next.headDiedThisTurn = 0;
        next.headCount += event.count;
        regained =
          event.allowHealing === false || next.recoveryBlock !== null
            ? 0
            : Math.min(
                next.effectiveHpMax - next.hpCurrent,
                event.count * event.hpPerHead,
              );
        next.hpCurrent += Math.max(0, regained);
        if (
          regained > 0 &&
          next.hpCurrent > 0 &&
          (next.status === 'stable' || next.status === 'dying')
        ) {
          // Actual HP regain is ordinary healing for lifecycle purposes (S27).
          next.status = 'alive';
          next.deathSaveSuccesses = 0;
          next.deathSaveFailures = 0;
          next.stableRecovery = null;
          next.stableRecoverySettled = false;
        }
        break;
      case 'recoveryDue':
        if (
          next.status !== 'stable' ||
          next.stableRecovery === null ||
          event.elapsedMinutes < next.stableRecovery.deadline
        )
          return refusal('stable recovery is not due');
        if (next.effectiveHpMax === 0) {
          next.stableRecovery = null;
          next.stableRecoverySettled = true;
        } else {
          next.hpCurrent = Math.min(1, next.effectiveHpMax);
          next.status = 'alive';
          next.deathSaveSuccesses = 0;
          next.deathSaveFailures = 0;
          next.stableRecovery = null;
          next.stableRecoverySettled = false;
          regained = next.hpCurrent;
        }
        break;
      case 'admission':
        if (event.suppliedHp !== undefined) next.hpCurrent = event.suppliedHp;
        if (event.suppliedStatus !== undefined)
          next.status = event.suppliedStatus;
        if (event.deathRules !== undefined) next.deathRules = event.deathRules;
        if (event.headCount !== undefined) next.headCount = event.headCount;
        next.hpCurrent = Math.min(next.hpCurrent, next.effectiveHpMax);
        break;
      case 'beginTurn':
        next.damageThisTurn = 0;
        next.damageTurnKey = event.turnKey ?? null;
        next.headDiedThisTurn = 0;
        break;
      case 'invalidateProjection':
        next.stableRecovery = null;
        next.stableRecoverySettled = false;
        next.projectionOwner = false;
        break;
      case 'transferSchedule':
        next.stableRecovery = event.schedule;
        next.stableRecoverySettled = event.settled;
        break;
    }
  }

  // D5: settled is a resolved zero-regain outcome, never a generic way to
  // represent an absent owner. Preserve it on unrelated writes at max 0.
  if (
    next.stableRecoverySettled &&
    (next.status !== 'stable' || next.stableRecovery !== null)
  )
    return refusal('settled recovery requires stable status and no schedule');
  if (next.stableRecovery !== null && next.status !== 'stable')
    return refusal('a recovery schedule requires stable status');
  if (
    next.status === 'stable' &&
    next.stableRecovery === null &&
    !next.stableRecoverySettled &&
    next.projectionOwner
  )
    return refusal(
      'stable status requires a complete recovery schedule or settled recovery',
    );
  if (!next.projectionOwner && next.stableRecovery !== null)
    return refusal('a historical actor projection cannot own stable recovery');
  if (
    next.exhaustionLevel === 6 &&
    next.status !== 'dead' &&
    next.status !== 'absent'
  )
    return refusal('exhaustion level 6 requires dead status');
  if (
    next.headCount === 0 &&
    next.status !== 'dead' &&
    next.status !== 'absent'
  )
    return refusal('zero heads requires dead status');
  if (next.status === 'dying' || next.status === 'stable') {
    if (next.deathRules !== 'player-character' || next.hpCurrent !== 0)
      return refusal('dying and stable require player-character rules at 0 HP');
  }
  if (
    next.deathRules === 'player-character' &&
    next.hpCurrent === 0 &&
    !['dying', 'stable', 'dead', 'absent'].includes(next.status)
  )
    return refusal(
      '0 HP player-character state must be dying, stable, dead, or absent',
    );
  if (next.status === 'absent') {
    if (
      next.stableRecovery !== null ||
      next.stableRecoverySettled ||
      next.recoveryBlock !== null ||
      next.deathSaveSuccesses !== 0 ||
      next.deathSaveFailures !== 0
    )
      return refusal(
        'absent requires no recovery schedule, no recovery block, and no death-save counters',
      );
  }
  if (
    next.zeroHpRule === 'vanish' &&
    next.hpCurrent === 0 &&
    next.status !== 'absent' &&
    !(
      next.status === 'dead' &&
      (next.exhaustionLevel === 6 || next.headCount === 0)
    )
  )
    return refusal(
      'a creature that disappears at 0 hit points cannot be present at 0 HP',
    );
  if (next.recoveryBlock !== null && next.status !== 'dying')
    return refusal('recovery block requires dying status');
  if (next.hpCurrent < 0 || next.hpCurrent > next.effectiveHpMax)
    return refusal('HP is outside the effective maximum');
  // I8 (amended): dead is terminal except that it may become absent.
  if (
    current.status === 'dead' &&
    next.status !== 'dead' &&
    next.status !== 'absent'
  )
    return refusal('dead status is terminal');
  if (current.status === 'absent' && next.status !== 'absent')
    return refusal('absent status is terminal');

  return {
    ok: true,
    state: next,
    ...(regained === undefined ? {} : { regained }),
  };
}
