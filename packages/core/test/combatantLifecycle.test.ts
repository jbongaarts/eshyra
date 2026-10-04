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
    zeroHpRule: null,
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

  it('zero-hit-point reversion rules: an object leaves play, a transformed creature stays alive for the adapter to restore', () => {
    const events: CombatantLifecycleEvent[] = [
      { type: 'damage', amount: 25 },
      { type: 'suffocationDrop' },
      { type: 'clampToEffectiveMax' },
    ];
    for (const event of events) {
      const base =
        event.type === 'clampToEffectiveMax'
          ? state({ hpCurrent: 5, effectiveHpMax: 0 })
          : state();
      const object = apply(
        { ...base, zeroHpRule: 'revert-object' },
        event,
      ).state;
      expect(object).toMatchObject({ status: 'absent', hpCurrent: 0 });
      const form = apply({ ...base, zeroHpRule: 'revert-form' }, event).state;
      expect(form).toMatchObject({
        status: 'alive',
        hpCurrent: 0,
        recoveryBlock: null,
        deathSaveFailures: 0,
      });
    }
    // Neither accepts a knockout or player-character death rules.
    for (const zeroHpRule of ['revert-object', 'revert-form'] as const) {
      const current = state({ zeroHpRule });
      expect(
        nextCombatantLifecycle(current, {
          type: 'knockout',
          damage: 12,
        }),
      ).toMatchObject({ ok: false });
      expect(
        nextCombatantLifecycle(current, {
          type: 'optIntoPlayerCharacterRules',
        }),
      ).toMatchObject({ ok: false });
    }
  });

  it('keeps dead terminal in both death-rule modes: positive heals and revival statuses are refused (D2 reversed)', () => {
    for (const current of [
      state({ hpCurrent: 0, status: 'dead' }),
      state({ hpCurrent: 0, status: 'dead', deathRules: 'player-character' }),
      state({ hpCurrent: 0, status: 'dead', exhaustionLevel: 6 }),
      state({ hpCurrent: 0, status: 'dead', headCount: 0 }),
    ]) {
      expect(
        nextCombatantLifecycle(current, { type: 'heal', amount: 2 }),
      ).toMatchObject({ ok: false });
      for (const status of ['alive', 'unconscious', 'stable', 'dying'] as const)
        expect(
          nextCombatantLifecycle(current, { type: 'setStatus', status }),
        ).toMatchObject({ ok: false });
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

  describe('ordinary-state x profile transition matrix (no terminal causes)', () => {
    const hydra = {
      damageThreshold: 25,
      deathWhenNoHeads: true,
      regrowHeadsPerHead: 2,
      hpPerHead: 10,
      regrowthSuppressedByFire: true,
    };
    const pc = { deathRules: 'player-character' as const };
    const dyingPc = (o: Partial<CombatantLifecycleState> = {}) =>
      state({
        ...pc,
        status: 'dying',
        hpCurrent: 0,
        deathSaveSuccesses: 1,
        deathSaveFailures: 1,
        ...o,
      });
    const stablePc = (o: Partial<CombatantLifecycleState> = {}) =>
      state({
        ...pc,
        status: 'stable',
        hpCurrent: 0,
        stableRecovery: schedule,
        ...o,
      });
    const blocked = { recoveryBlock: 'suffocating' as const };
    const zeroMax = { hpMax: 1, effectiveHpMax: 0, exhaustionLevel: 4 };
    const headed = { headCount: 3, headsDiedSinceOwnTurn: 1 };
    const regrowth: CombatantLifecycleEvent = {
      type: 'headsRegrown',
      count: 1,
      hpPerHead: 10,
    };
    const settledRegrowth = {
      headsDiedSinceOwnTurn: 0,
      fireDamageSinceOwnTurn: 0,
      damageThisTurn: 0,
      damageTurnKey: null,
      headDiedThisTurn: 0,
    };

    const cases: Array<{
      name: string;
      current: CombatantLifecycleState;
      event: CombatantLifecycleEvent;
      expected: CombatantLifecycleState | { refusal: RegExp };
      regained?: number;
    }> = [
      // ---- monster / alive
      {
        name: 'monster alive: damage',
        current: state({ hpCurrent: 6 }),
        event: { type: 'damage', amount: 3 },
        expected: state({ hpCurrent: 3, damageThisTurn: 3 }),
      },
      {
        name: 'monster alive: lethal damage',
        current: state({ hpCurrent: 6 }),
        event: { type: 'damage', amount: 9 },
        expected: state({ hpCurrent: 0, status: 'dead', damageThisTurn: 9 }),
      },
      {
        name: 'monster alive: heal caps at the effective maximum',
        current: state({ hpCurrent: 6 }),
        event: { type: 'heal', amount: 9 },
        expected: state({ hpCurrent: 10 }),
      },
      {
        name: 'monster alive: nonlethal knockout (S29)',
        current: state({ hpCurrent: 6 }),
        event: { type: 'knockout', damage: 20 },
        expected: state({
          hpCurrent: 0,
          status: 'unconscious',
          damageThisTurn: 20,
        }),
      },
      {
        name: 'monster alive: death save refused',
        current: state({ hpCurrent: 6 }),
        event: { type: 'deathSave', roll: 15 },
        expected: { refusal: /only a dying player-character/ },
      },
      {
        name: 'monster alive: stabilize refused',
        current: state({ hpCurrent: 6 }),
        event: { type: 'stabilize' },
        expected: { refusal: /only a dying player-character/ },
      },
      {
        name: 'monster alive: suffocation drop kills',
        current: state({ hpCurrent: 6 }),
        event: { type: 'suffocationDrop' },
        expected: state({ hpCurrent: 0, status: 'dead' }),
      },
      {
        name: 'monster alive: regrowth heals heads x hp',
        current: state({ hpCurrent: 6, ...headed }),
        event: regrowth,
        expected: state({
          hpCurrent: 10,
          ...headed,
          headCount: 4,
          ...settledRegrowth,
        }),
        regained: 4,
      },
      // ---- monster / unconscious knockout at 0
      {
        name: 'monster knocked out: further damage kills (S35)',
        current: state({ hpCurrent: 0, status: 'unconscious' }),
        event: { type: 'damage', amount: 1 },
        expected: state({
          hpCurrent: 0,
          status: 'dead',
          damageThisTurn: 1,
        }),
      },
      {
        name: 'monster knocked out: further critical damage kills (S35)',
        current: state({ hpCurrent: 0, status: 'unconscious' }),
        event: { type: 'damage', amount: 1, critical: true },
        expected: state({
          hpCurrent: 0,
          status: 'dead',
          damageThisTurn: 1,
        }),
      },
      {
        name: 'monster knocked out: stabilize and death save refused',
        current: state({ hpCurrent: 0, status: 'unconscious' }),
        event: { type: 'deathSave', roll: 12 },
        expected: { refusal: /only a dying player-character/ },
      },
      {
        name: 'monster knocked out: suffocation drop kills',
        current: state({ hpCurrent: 0, status: 'unconscious' }),
        event: { type: 'suffocationDrop' },
        expected: state({ hpCurrent: 0, status: 'dead' }),
      },
      {
        name: 'monster knockout dies when the last head dies (terminal wins)',
        current: state({ hpCurrent: 6, headCount: 1 }),
        event: { type: 'knockout', damage: 30, headMechanic: hydra },
        expected: state({
          hpCurrent: 0,
          status: 'dead',
          headCount: 0,
          headsDiedSinceOwnTurn: 1,
          headDiedThisTurn: 1,
          damageThisTurn: 30,
        }),
      },
      // ---- monster / dead
      {
        name: 'monster dead: healing refused (D2 reversed)',
        current: state({ hpCurrent: 0, status: 'dead' }),
        event: { type: 'heal', amount: 3 },
        expected: { refusal: /dead combatant cannot undergo/ },
      },
      {
        name: 'monster dead: damage refused',
        current: state({ hpCurrent: 0, status: 'dead' }),
        event: { type: 'damage', amount: 3 },
        expected: { refusal: /dead combatant cannot undergo/ },
      },
      {
        name: 'monster dead: knockout refused',
        current: state({ hpCurrent: 0, status: 'dead' }),
        event: { type: 'knockout', damage: 3 },
        expected: { refusal: /dead combatant cannot undergo/ },
      },
      // ---- player-character / alive
      {
        name: 'pc alive: damage to zero is dying with reset counters',
        current: state({ ...pc, hpCurrent: 6 }),
        event: { type: 'damage', amount: 6 },
        expected: state({
          ...pc,
          hpCurrent: 0,
          status: 'dying',
          damageThisTurn: 6,
        }),
      },
      {
        name: 'pc alive: overflow at the effective maximum is instant death',
        current: state({ ...pc, hpCurrent: 6 }),
        event: { type: 'damage', amount: 16 },
        expected: state({
          ...pc,
          hpCurrent: 0,
          status: 'dead',
          damageThisTurn: 16,
        }),
      },
      {
        name: 'pc alive: knockout is stable with a schedule',
        current: state({ ...pc, hpCurrent: 6 }),
        event: { type: 'knockout', damage: 9 },
        expected: state({
          ...pc,
          hpCurrent: 0,
          status: 'stable',
          stableRecovery: schedule,
          damageThisTurn: 9,
        }),
      },
      {
        name: 'pc alive: suffocation drop is blocked dying',
        current: state({ ...pc, hpCurrent: 6 }),
        event: { type: 'suffocationDrop' },
        expected: state({
          ...pc,
          hpCurrent: 0,
          status: 'dying',
          ...blocked,
        }),
      },
      {
        name: 'pc alive: death save refused',
        current: state({ ...pc, hpCurrent: 6 }),
        event: { type: 'deathSave', roll: 15 },
        expected: { refusal: /only a dying player-character/ },
      },
      // ---- player-character / dying
      {
        name: 'pc dying: ordinary success adds one',
        current: dyingPc(),
        event: { type: 'deathSave', roll: 12 },
        expected: dyingPc({ deathSaveSuccesses: 2 }),
      },
      {
        name: 'pc dying: third success stabilizes and resets both counters',
        current: dyingPc({ deathSaveSuccesses: 2, deathSaveFailures: 2 }),
        event: { type: 'deathSave', roll: 10 },
        expected: stablePc(),
      },
      {
        name: 'pc dying blocked: third success stays dying',
        current: dyingPc({ ...blocked, deathSaveSuccesses: 2 }),
        event: { type: 'deathSave', roll: 12 },
        expected: dyingPc({ ...blocked, deathSaveSuccesses: 3 }),
      },
      {
        name: 'pc dying blocked: successes cap at three (S28)',
        current: dyingPc({ ...blocked, deathSaveSuccesses: 3 }),
        event: { type: 'deathSave', roll: 12 },
        expected: dyingPc({ ...blocked, deathSaveSuccesses: 3 }),
      },
      {
        name: 'pc dying blocked: natural 20 beyond three stays capped',
        current: dyingPc({ ...blocked, deathSaveSuccesses: 3 }),
        event: { type: 'deathSave', roll: 20 },
        expected: dyingPc({ ...blocked, deathSaveSuccesses: 3 }),
      },
      {
        name: 'pc dying blocked: failure still accumulates beyond capped successes',
        current: dyingPc({ ...blocked, deathSaveSuccesses: 3 }),
        event: { type: 'deathSave', roll: 5 },
        expected: dyingPc({
          ...blocked,
          deathSaveSuccesses: 3,
          deathSaveFailures: 2,
        }),
      },
      {
        name: 'pc dying: natural 20 revives to 1 HP',
        current: dyingPc({ deathSaveSuccesses: 2 }),
        event: { type: 'deathSave', roll: 20 },
        expected: state({ ...pc, hpCurrent: 1 }),
      },
      {
        name: 'pc dying zero max: natural 20 counts as the third success (S34)',
        current: dyingPc({ ...zeroMax, deathSaveSuccesses: 2 }),
        event: { type: 'deathSave', roll: 20 },
        expected: stablePc({ ...zeroMax }),
      },
      {
        name: 'pc dying zero max: natural 20 as first success only counts',
        current: dyingPc({ ...zeroMax, deathSaveSuccesses: 0 }),
        event: { type: 'deathSave', roll: 20 },
        expected: dyingPc({ ...zeroMax, deathSaveSuccesses: 1 }),
      },
      {
        name: 'pc dying zero max blocked: third natural 20 stays dying',
        current: dyingPc({ ...zeroMax, ...blocked, deathSaveSuccesses: 2 }),
        event: { type: 'deathSave', roll: 20 },
        expected: dyingPc({ ...zeroMax, ...blocked, deathSaveSuccesses: 3 }),
      },
      {
        name: 'pc dying: failure adds one',
        current: dyingPc(),
        event: { type: 'deathSave', roll: 5 },
        expected: dyingPc({ deathSaveFailures: 2 }),
      },
      {
        name: 'pc dying: natural 1 on two failures is death',
        current: dyingPc({ deathSaveFailures: 2 }),
        event: { type: 'deathSave', roll: 1 },
        expected: dyingPc({ status: 'dead', deathSaveFailures: 3 }),
      },
      {
        name: 'pc dying: stabilize',
        current: dyingPc(),
        event: { type: 'stabilize' },
        expected: stablePc(),
      },
      {
        name: 'pc dying blocked: stabilize refused',
        current: dyingPc({ ...blocked }),
        event: { type: 'stabilize' },
        expected: { refusal: /cannot stabilize while suffocating/ },
      },
      {
        name: 'pc dying: healing wakes and resets counters',
        current: dyingPc({ deathSaveSuccesses: 2 }),
        event: { type: 'heal', amount: 4 },
        expected: state({ ...pc, hpCurrent: 4 }),
        regained: undefined,
      },
      {
        name: 'pc dying blocked: healing refused',
        current: dyingPc({ ...blocked }),
        event: { type: 'heal', amount: 4 },
        expected: { refusal: /cannot regain hit points while suffocating/ },
      },
      {
        name: 'pc dying: damage adds a failure, critical adds two',
        current: dyingPc(),
        event: { type: 'damage', amount: 1, critical: true },
        expected: dyingPc({
          deathSaveFailures: 3,
          status: 'dead',
          damageThisTurn: 1,
        }),
      },
      {
        name: 'pc dying: breathing with three banked successes stabilizes',
        current: dyingPc({ ...blocked, deathSaveSuccesses: 3 }),
        event: { type: 'suffocationBreathe' },
        expected: stablePc(),
      },
      {
        name: 'pc dying: breathing below three keeps dying counters',
        current: dyingPc({ ...blocked }),
        event: { type: 'suffocationBreathe' },
        expected: dyingPc(),
      },
      {
        name: 'pc dying: breathe without a block refused',
        current: dyingPc(),
        event: { type: 'suffocationBreathe' },
        expected: { refusal: /no recovery block/ },
      },
      {
        name: 'pc dying: dropping preserves earned counters',
        current: dyingPc({ deathSaveSuccesses: 2 }),
        event: { type: 'suffocationDrop' },
        expected: dyingPc({ ...blocked, deathSaveSuccesses: 2 }),
      },
      {
        name: 'pc dying: unblocked head regrowth is ordinary healing (S27)',
        current: dyingPc({ ...headed, deathSaveSuccesses: 2 }),
        event: regrowth,
        expected: state({
          ...pc,
          hpCurrent: 10,
          ...headed,
          headCount: 4,
          ...settledRegrowth,
        }),
        regained: 10,
      },
      {
        name: 'pc dying blocked: regrowth grows heads but keeps zero HP and counters',
        current: dyingPc({ ...headed, ...blocked, deathSaveSuccesses: 2 }),
        event: regrowth,
        expected: dyingPc({
          ...headed,
          ...blocked,
          deathSaveSuccesses: 2,
          headCount: 4,
          ...settledRegrowth,
        }),
        regained: 0,
      },
      // ---- player-character / stable
      {
        name: 'pc stable: healing wakes and clears the schedule',
        current: stablePc(),
        event: { type: 'heal', amount: 2 },
        expected: state({ ...pc, hpCurrent: 2 }),
      },
      {
        name: 'pc stable: damage becomes dying with a failure',
        current: stablePc(),
        event: { type: 'damage', amount: 2 },
        expected: dyingPc({
          deathSaveSuccesses: 0,
          deathSaveFailures: 1,
          damageThisTurn: 2,
        }),
      },
      {
        name: 'pc stable: death save and stabilize refused',
        current: stablePc(),
        event: { type: 'deathSave', roll: 12 },
        expected: { refusal: /only a dying player-character/ },
      },
      {
        name: 'pc stable: recovery due returns to 1 HP',
        current: stablePc(),
        event: { type: 'recoveryDue', elapsedMinutes: 180 },
        expected: state({ ...pc, hpCurrent: 1 }),
        regained: 1,
      },
      {
        name: 'pc stable: recovery before the deadline refused',
        current: stablePc(),
        event: { type: 'recoveryDue', elapsedMinutes: 179 },
        expected: { refusal: /not due/ },
      },
      {
        name: 'pc stable: regrowth is ordinary healing (S27)',
        current: stablePc({ ...headed, deathSaveSuccesses: 0 }),
        event: regrowth,
        expected: state({
          ...pc,
          hpCurrent: 10,
          ...headed,
          headCount: 4,
          ...settledRegrowth,
        }),
        regained: 10,
      },
      {
        name: 'pc stable: fire-suppressed regrowth refused',
        current: stablePc({ ...headed, fireDamageSinceOwnTurn: 1 }),
        event: { ...regrowth, fireDamage: true },
        expected: { refusal: /suppressed by fire/ },
      },
      {
        name: 'pc stable: suffocation drop becomes blocked dying with fresh counters',
        current: stablePc(),
        event: { type: 'suffocationDrop' },
        expected: dyingPc({
          ...blocked,
          deathSaveSuccesses: 0,
          deathSaveFailures: 0,
        }),
      },
      // ---- player-character / dead
      {
        name: 'pc dead: healing refused',
        current: state({ ...pc, hpCurrent: 0, status: 'dead' }),
        event: { type: 'heal', amount: 3 },
        expected: { refusal: /dead combatant cannot undergo/ },
      },
      {
        name: 'pc dead: death save refused',
        current: state({ ...pc, hpCurrent: 0, status: 'dead' }),
        event: { type: 'deathSave', roll: 20 },
        expected: { refusal: /dead combatant cannot undergo/ },
      },
      {
        name: 'pc dead: positive regrowth refused',
        current: state({ ...pc, hpCurrent: 0, status: 'dead', ...headed }),
        event: regrowth,
        expected: { refusal: /dead combatant cannot undergo/ },
      },
    ];

    it.each(cases)('$name', ({ current, event, expected, regained }) => {
      const result = nextCombatantLifecycle(current, event, {
        recoverySchedule: schedule,
      });
      if ('refusal' in expected) {
        expect(result.ok).toBe(false);
        if (!result.ok) expect(result.refusal).toMatch(expected.refusal);
        return;
      }
      expect(result).toMatchObject({ ok: true });
      if (!result.ok) return;
      expect(result.state).toEqual(expected);
      if (regained !== undefined) expect(result.regained).toBe(regained);
    });

    it('applies a third success through one path for ordinary and natural-20 saves across zero/positive maxima and blocks (S34)', () => {
      for (const last of [10, 12, 20]) {
        for (const max of [
          { effectiveHpMax: 10 },
          { hpMax: 1, effectiveHpMax: 0, exhaustionLevel: 4 },
        ]) {
          for (const block of [null, 'suffocating' as const]) {
            const current = dyingPc({
              ...max,
              recoveryBlock: block,
              deathSaveSuccesses: 2,
            });
            const result = nextCombatantLifecycle(
              current,
              { type: 'deathSave', roll: last },
              { recoverySchedule: schedule },
            );
            const label = `${last}/${max.effectiveHpMax}/${block}`;
            expect(result.ok, label).toBe(true);
            if (!result.ok) continue;
            const revives =
              last === 20 && block === null && max.effectiveHpMax > 0;
            if (revives) {
              expect(result.state.status, label).toBe('alive');
              expect(result.state.hpCurrent, label).toBe(1);
            } else if (block === null) {
              expect(result.state, label).toMatchObject({
                status: 'stable',
                deathSaveSuccesses: 0,
                deathSaveFailures: 0,
                stableRecovery: schedule,
              });
            } else {
              expect(result.state, label).toMatchObject({
                status: 'dying',
                deathSaveSuccesses: 3,
                stableRecovery: null,
              });
            }
          }
        }
      }
    });
  });
});
