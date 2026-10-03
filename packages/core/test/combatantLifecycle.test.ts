import { describe, expect, it } from 'vitest';
import {
  type CombatantLifecycleEvent,
  type CombatantLifecycleState,
  nextCombatantLifecycle,
} from '../src/state/combatantLifecycle.js';

const schedule = { roll: 2, anchor: 60, deadline: 180 };

function state(
  overrides: Partial<CombatantLifecycleState> = {},
): CombatantLifecycleState {
  return {
    status: 'alive',
    hpCurrent: 10,
    hpMax: 10,
    effectiveHpMax: 10,
    deathRules: 'monster',
    exhaustionLevel: 0,
    deathSaveSuccesses: 0,
    deathSaveFailures: 0,
    recoveryBlock: null,
    stableRecovery: null,
    stableRecoverySettled: false,
    projectionOwner: true,
    headCount: null,
    headsDiedSinceOwnTurn: 0,
    fireDamageSinceOwnTurn: 0,
    damageThisTurn: 0,
    damageTurnKey: null,
    headDiedThisTurn: 0,
    ...overrides,
  };
}

function apply(
  current: CombatantLifecycleState,
  event: CombatantLifecycleEvent,
) {
  const result = nextCombatantLifecycle(current, event, {
    recoverySchedule: schedule,
  });
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(result.refusal);
  return result;
}

describe('nextCombatantLifecycle', () => {
  it.each([
    {
      name: 'damage records full damage and the final HP/status',
      current: state({ hpCurrent: 8 }),
      event: {
        type: 'damage',
        amount: 3,
        damageTypes: ['fire'],
        turnKey: 'r1:goblin',
      },
      expected: state({
        hpCurrent: 5,
        fireDamageSinceOwnTurn: 1,
        damageThisTurn: 3,
        damageTurnKey: 'r1:goblin',
      }),
    },
    {
      name: 'ordinary monster damage at zero is terminal',
      current: state({ hpCurrent: 4 }),
      event: { type: 'damage', amount: 4 },
      expected: state({ hpCurrent: 0, status: 'dead', damageThisTurn: 4 }),
    },
    {
      name: 'player-character damage enters dying and resets counters',
      current: state({
        hpCurrent: 2,
        deathRules: 'player-character',
        deathSaveFailures: 1,
      }),
      event: { type: 'damage', amount: 2 },
      expected: state({
        hpCurrent: 0,
        status: 'dying',
        deathRules: 'player-character',
        deathSaveSuccesses: 0,
        deathSaveFailures: 0,
        damageThisTurn: 2,
      }),
    },
    {
      name: 'damage at zero adds critical failures',
      current: state({
        hpCurrent: 0,
        status: 'dying',
        deathRules: 'player-character',
      }),
      event: { type: 'damage', amount: 1, critical: true },
      expected: state({
        hpCurrent: 0,
        status: 'dying',
        deathRules: 'player-character',
        deathSaveFailures: 2,
        damageThisTurn: 1,
      }),
    },
    {
      name: 'healing wakes a player-character and preserves unrelated state',
      current: state({
        hpCurrent: 0,
        status: 'dying',
        deathRules: 'player-character',
        deathSaveFailures: 2,
      }),
      event: { type: 'heal', amount: 3 },
      expected: state({
        hpCurrent: 3,
        status: 'alive',
        deathRules: 'player-character',
        deathSaveSuccesses: 0,
        deathSaveFailures: 0,
      }),
    },
    {
      name: 'effective maximum clamp cannot replace terminal exhaustion death',
      current: state({
        hpCurrent: 1,
        hpMax: 1,
        effectiveHpMax: 0,
        exhaustionLevel: 6,
      }),
      event: { type: 'clampToEffectiveMax' },
      expected: state({
        hpCurrent: 0,
        hpMax: 1,
        effectiveHpMax: 0,
        status: 'dead',
        exhaustionLevel: 6,
      }),
    },
    {
      name: 'manual participation status preserves valid hit points',
      current: state(),
      event: { type: 'setStatus', status: 'escaped' },
      expected: state({ status: 'escaped' }),
    },
    {
      name: 'opt-in switches the rules profile without changing other state',
      current: state(),
      event: { type: 'optIntoPlayerCharacterRules' },
      expected: state({ deathRules: 'player-character' }),
    },
    {
      name: 'stable recovery keeps its seeded schedule',
      current: state({
        hpCurrent: 0,
        status: 'dying',
        deathRules: 'player-character',
      }),
      event: { type: 'stabilize' },
      expected: state({
        hpCurrent: 0,
        status: 'stable',
        deathRules: 'player-character',
        stableRecovery: schedule,
      }),
    },
    {
      name: 'natural twenty returns a dying combatant to one HP',
      current: state({
        hpCurrent: 0,
        status: 'dying',
        deathRules: 'player-character',
      }),
      event: { type: 'deathSave', roll: 20 },
      expected: state({
        hpCurrent: 1,
        status: 'alive',
        deathRules: 'player-character',
      }),
    },
    {
      name: 'ordinary death-save success increments the success counter',
      current: state({
        hpCurrent: 0,
        status: 'dying',
        deathRules: 'player-character',
      }),
      event: { type: 'deathSave', roll: 12 },
      expected: state({
        hpCurrent: 0,
        status: 'dying',
        deathRules: 'player-character',
        deathSaveSuccesses: 1,
      }),
    },
    {
      name: 'knockout enters stable and records its seeded schedule atomically',
      current: state({ hpCurrent: 10, deathRules: 'player-character' }),
      event: { type: 'knockout', damage: 4 },
      expected: state({
        hpCurrent: 0,
        status: 'stable',
        deathRules: 'player-character',
        stableRecovery: schedule,
        damageThisTurn: 4,
      }),
    },
    {
      name: 'suffocation drop adds a recovery block to a PC-rules combatant',
      current: state({ hpCurrent: 5, deathRules: 'player-character' }),
      event: { type: 'suffocationDrop' },
      expected: state({
        hpCurrent: 0,
        status: 'dying',
        deathRules: 'player-character',
        recoveryBlock: 'suffocating',
      }),
    },
    {
      name: 'breathing clears the block without changing dying counters',
      current: state({
        hpCurrent: 0,
        status: 'dying',
        deathRules: 'player-character',
        recoveryBlock: 'suffocating',
        deathSaveSuccesses: 2,
      }),
      event: { type: 'suffocationBreathe' },
      expected: state({
        hpCurrent: 0,
        status: 'dying',
        deathRules: 'player-character',
        deathSaveSuccesses: 2,
      }),
    },
    {
      name: 'exhaustion at six kills and clamps in the same transition',
      current: state({ hpCurrent: 10 }),
      event: { type: 'exhaustionChanged', newLevel: 6, newEffectiveHpMax: 0 },
      expected: state({
        hpCurrent: 0,
        effectiveHpMax: 0,
        status: 'dead',
        exhaustionLevel: 6,
      }),
    },
    {
      name: 'head death increments pending facts and kills the last head',
      current: state({ headCount: 1 }),
      event: {
        type: 'headDied',
        headMechanic: {
          damageThreshold: 25,
          deathWhenNoHeads: true,
          regrowHeadsPerHead: 2,
          hpPerHead: 10,
          regrowthSuppressedByFire: true,
        },
      },
      expected: state({
        headCount: 0,
        headsDiedSinceOwnTurn: 1,
        status: 'dead',
      }),
    },
    {
      name: 'head regrowth restores tracked HP and count',
      current: state({ hpCurrent: 10, headCount: 3, headsDiedSinceOwnTurn: 1 }),
      event: { type: 'headsRegrown', count: 2, hpPerHead: 10 },
      expected: state({ hpCurrent: 10, headCount: 5 }),
    },
    {
      name: 'due recovery restores one HP and clears its schedule',
      current: state({
        hpCurrent: 0,
        status: 'stable',
        deathRules: 'player-character',
        stableRecovery: schedule,
      }),
      event: { type: 'recoveryDue', elapsedMinutes: 180 },
      expected: state({
        hpCurrent: 1,
        status: 'alive',
        deathRules: 'player-character',
      }),
    },
    {
      name: 'zero-maximum due recovery records settled stable state',
      current: state({
        hpCurrent: 0,
        status: 'stable',
        deathRules: 'player-character',
        effectiveHpMax: 0,
        stableRecovery: schedule,
      }),
      event: { type: 'recoveryDue', elapsedMinutes: 180 },
      expected: state({
        hpCurrent: 0,
        status: 'stable',
        deathRules: 'player-character',
        effectiveHpMax: 0,
        stableRecoverySettled: true,
      }),
    },
    {
      name: 'admission clamps supplied HP',
      current: state({ hpCurrent: 10, effectiveHpMax: 5 }),
      event: { type: 'admission', suppliedHp: 9 },
      expected: state({ hpCurrent: 5, effectiveHpMax: 5 }),
    },
    {
      name: 'begin-turn clears only the per-turn counters',
      current: state({
        damageThisTurn: 30,
        damageTurnKey: 'r1',
        headDiedThisTurn: 1,
      }),
      event: { type: 'beginTurn' },
      expected: state({
        damageThisTurn: 0,
        damageTurnKey: null,
        headDiedThisTurn: 0,
      }),
    },
    {
      name: 'projection invalidation does not pretend recovery settled',
      current: state({
        hpCurrent: 0,
        status: 'stable',
        deathRules: 'player-character',
        stableRecovery: schedule,
      }),
      event: { type: 'invalidateProjection' },
      expected: state({
        hpCurrent: 0,
        status: 'stable',
        deathRules: 'player-character',
        projectionOwner: false,
      }),
    },
    {
      name: 'schedule transfer copies the full pending schedule',
      current: state({
        hpCurrent: 0,
        status: 'stable',
        deathRules: 'player-character',
      }),
      event: { type: 'transferSchedule', schedule, settled: false },
      expected: state({
        hpCurrent: 0,
        status: 'stable',
        deathRules: 'player-character',
        stableRecovery: schedule,
      }),
    },
  ] as const)('$name', ({ current, event, expected }) => {
    expect(apply(current, event).state).toEqual(expected);
  });

  it('allows the I8 ordinary monster-healing exception and preserves terminal causes', () => {
    const ordinary = nextCombatantLifecycle(
      state({ hpCurrent: 0, status: 'dead' }),
      { type: 'heal', amount: 2 },
    );
    expect(ordinary.ok && ordinary.state).toEqual(
      state({ hpCurrent: 2, status: 'alive' }),
    );

    for (const current of [
      state({ hpCurrent: 0, status: 'dead', exhaustionLevel: 6 }),
      state({ hpCurrent: 0, status: 'dead', headCount: 0 }),
      state({ hpCurrent: 0, status: 'dead', deathRules: 'player-character' }),
    ]) {
      const terminal = nextCombatantLifecycle(current, {
        type: 'heal',
        amount: 2,
      });
      expect(terminal.ok).toBe(false);
      expect(terminal).toMatchObject({ ok: false });
    }
  });

  it('crosses every event, status, profile, and terminal cause with full-state expectations', () => {
    const eventCases: Array<{
      name: string;
      event: CombatantLifecycleEvent;
      success: boolean;
    }> = [
      { name: 'damage', event: { type: 'damage', amount: 1 }, success: false },
      { name: 'heal', event: { type: 'heal', amount: 1 }, success: false },
      {
        name: 'zero-regain heal',
        event: { type: 'heal', amount: 0 },
        success: true,
      },
      { name: 'clamp', event: { type: 'clampToEffectiveMax' }, success: true },
      {
        name: 'set status',
        event: { type: 'setStatus', status: 'alive' },
        success: false,
      },
      {
        name: 'opt in',
        event: { type: 'optIntoPlayerCharacterRules' },
        success: false,
      },
      {
        name: 'death save',
        event: { type: 'deathSave', roll: 20 },
        success: false,
      },
      { name: 'stabilize', event: { type: 'stabilize' }, success: false },
      {
        name: 'knockout',
        event: { type: 'knockout', damage: 1 },
        success: false,
      },
      {
        name: 'suffocation drop',
        event: { type: 'suffocationDrop' },
        success: false,
      },
      {
        name: 'suffocation breathe',
        event: { type: 'suffocationBreathe' },
        success: false,
      },
      {
        name: 'exhaustion change',
        event: {
          type: 'exhaustionChanged',
          newLevel: 2,
          newEffectiveHpMax: 2,
          newHpMax: 4,
        },
        success: true,
      },
      {
        name: 'head death',
        event: {
          type: 'headDied',
          headMechanic: {
            damageThreshold: 25,
            deathWhenNoHeads: true,
            regrowHeadsPerHead: 2,
            hpPerHead: 10,
            regrowthSuppressedByFire: true,
          },
        },
        success: false,
      },
      {
        name: 'zero-count regrowth',
        event: { type: 'headsRegrown', count: 0, hpPerHead: 10 },
        success: true,
      },
      {
        name: 'positive regrowth',
        event: { type: 'headsRegrown', count: 1, hpPerHead: 10 },
        success: false,
      },
      {
        name: 'recovery due',
        event: { type: 'recoveryDue', elapsedMinutes: 300 },
        success: false,
      },
      {
        name: 'admission',
        event: { type: 'admission', suppliedHp: 4, suppliedStatus: 'alive' },
        success: true,
      },
      {
        name: 'begin turn',
        event: { type: 'beginTurn', turnKey: 'next-turn' },
        success: true,
      },
      {
        name: 'invalidate projection',
        event: { type: 'invalidateProjection' },
        success: true,
      },
      {
        name: 'transfer schedule',
        event: { type: 'transferSchedule', schedule: null, settled: false },
        success: true,
      },
    ];

    for (const deathRules of ['monster', 'player-character'] as const) {
      for (const status of ['alive', 'dying', 'stable', 'dead'] as const) {
        for (const terminalCause of ['exhaustion', 'zero-heads'] as const) {
          const current = state({
            status,
            hpCurrent: status === 'alive' ? 3 : 0,
            hpMax: 4,
            effectiveHpMax: terminalCause === 'exhaustion' ? 2 : 4,
            deathRules,
            exhaustionLevel: terminalCause === 'exhaustion' ? 6 : 0,
            deathSaveSuccesses: 2,
            deathSaveFailures: 1,
            recoveryBlock: status === 'dying' ? 'suffocating' : null,
            stableRecovery: status === 'stable' ? schedule : null,
            headCount: terminalCause === 'zero-heads' ? 0 : 5,
            headsDiedSinceOwnTurn: 1,
            fireDamageSinceOwnTurn: 1,
            damageThisTurn: 25,
            damageTurnKey: 'previous-turn',
            headDiedThisTurn: 1,
          });
          const terminalBase = state({
            ...current,
            status: 'dead',
            hpCurrent: Math.min(current.hpCurrent, current.effectiveHpMax),
            recoveryBlock: null,
            stableRecovery: null,
            stableRecoverySettled: false,
          });

          for (const eventCase of eventCases) {
            const result = nextCombatantLifecycle(current, eventCase.event, {
              recoverySchedule: schedule,
            });
            expect(
              result.ok,
              `${deathRules}/${status}/${terminalCause}/${eventCase.name}`,
            ).toBe(eventCase.success);
            if (!eventCase.success) {
              expect(result).toMatchObject({
                ok: false,
                refusal: expect.any(String),
              });
              continue;
            }

            let expected = terminalBase;
            switch (eventCase.event.type) {
              case 'exhaustionChanged':
                expected = state({
                  ...terminalBase,
                  hpCurrent: Math.min(
                    terminalBase.hpCurrent,
                    eventCase.event.newEffectiveHpMax,
                  ),
                  hpMax: eventCase.event.newHpMax ?? terminalBase.hpMax,
                  effectiveHpMax: eventCase.event.newEffectiveHpMax,
                  exhaustionLevel: eventCase.event.newLevel,
                });
                break;
              case 'headsRegrown':
                expected = state({
                  ...terminalBase,
                  headsDiedSinceOwnTurn: 0,
                  fireDamageSinceOwnTurn: 0,
                  damageThisTurn: 0,
                  damageTurnKey: null,
                  headDiedThisTurn: 0,
                });
                break;
              case 'beginTurn':
                expected = state({
                  ...terminalBase,
                  damageThisTurn: 0,
                  damageTurnKey: 'next-turn',
                  headDiedThisTurn: 0,
                });
                break;
              case 'invalidateProjection':
                expected = state({ ...terminalBase, projectionOwner: false });
                break;
              case 'admission':
                expected = state({
                  ...terminalBase,
                  hpCurrent: Math.min(
                    eventCase.event.suppliedHp ?? terminalBase.hpCurrent,
                    terminalBase.effectiveHpMax,
                  ),
                  deathRules:
                    eventCase.event.deathRules ?? terminalBase.deathRules,
                  headCount:
                    eventCase.event.headCount ?? terminalBase.headCount,
                });
                break;
            }
            expect(result).toEqual({ ok: true, state: expected });
          }
        }
      }
    }
  });
});
