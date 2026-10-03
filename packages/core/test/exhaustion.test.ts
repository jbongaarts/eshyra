import { describe, expect, it } from 'vitest';
import type { ToolContext } from '../src/internal.js';
import {
  attuneItem,
  createDefaultToolRegistry,
  createSeededRng,
  getCampaignActor,
  getConcentrationEffect,
  giveItem,
  listAttunements,
  listCombatants,
  upsertCampaignActor,
} from '../src/internal.js';
import {
  resolveCombatantRecoveries,
  stabilizeCombatant,
} from '../src/state/encounterCombatants.js';
import { effectiveHpMax } from '../src/state/exhaustion.js';
import {
  resolveStableRecoveries,
  stabilizeCharacter,
} from '../src/state/hpLifecycle.js';
import {
  DEFAULT_TEST_CAMPAIGN_ID,
  DEFAULT_TEST_SESSION_ID,
  freshDbWithSession,
} from './support/db.js';

const at = '2026-05-20T10:00:00.000Z';

function setup() {
  const db = freshDbWithSession();
  const ctx: ToolContext = {
    db,
    rng: createSeededRng(13),
    campaignId: DEFAULT_TEST_CAMPAIGN_ID,
    sessionId: DEFAULT_TEST_SESSION_ID,
    turnId: 'exhaustion-test',
    at,
  };
  const registry = createDefaultToolRegistry();
  db.prepare(
    "UPDATE character SET hp_max=20, hp_current=20, conditions_json='[]' WHERE id='pc-1'",
  ).run();
  return { db, ctx, registry };
}

function level(
  db: ReturnType<typeof freshDbWithSession>,
  characterId = 'pc-1',
) {
  const row = db
    .prepare('SELECT conditions_json FROM character WHERE id=?')
    .get(characterId) as { conditions_json: string };
  return JSON.parse(row.conditions_json) as Array<{
    id: string;
    level?: number;
  }>;
}

function startCombatant(
  ctx: ToolContext,
  registry: ReturnType<typeof createDefaultToolRegistry>,
) {
  const result = registry.invoke(
    'start_encounter',
    {
      combatInstanceId: 'exhaustion-combat',
      actors: [
        {
          actorId: 'exhaustion-npc',
          displayName: 'Exhaustion NPC',
          rulesRef: 'creature:goblin',
          hpCurrent: 12,
          hpMax: 12,
        },
      ],
    },
    ctx,
  );
  expect(result.ok).toBe(true);
  return 'exhaustion-combat-exhaustion-npc';
}

describe('adjust_exhaustion tool', () => {
  it('refuses encounter admission inputs that revive a dead campaign actor', () => {
    const { db, ctx, registry } = setup();
    expect(
      registry.invoke(
        'start_encounter',
        {
          combatInstanceId: 'terminal-admission',
          actors: [
            {
              actorId: 'terminal',
              rulesRef: 'creature:goblin',
              hpMax: 8,
              hpCurrent: 8,
            },
          ],
        },
        ctx,
      ).ok,
    ).toBe(true);
    const combatantId = 'terminal-admission-terminal';
    expect(
      registry.invoke(
        'update_combatant',
        { combatantId, deathRules: 'player-character' },
        ctx,
      ).ok,
    ).toBe(true);
    expect(
      registry.invoke('update_combatant', { combatantId, hpDelta: -40 }, ctx)
        .ok,
    ).toBe(true);
    expect(
      registry.invoke(
        'close_combat_instance',
        { combatInstanceId: 'terminal-admission', status: 'completed' },
        ctx,
      ).ok,
    ).toBe(true);
    expect(
      registry.invoke(
        'start_encounter',
        {
          combatInstanceId: 'terminal-reopen',
          actors: [
            {
              actorId: 'terminal',
              rulesRef: 'creature:goblin',
              hpCurrent: 8,
              status: 'alive',
            },
          ],
        },
        ctx,
      ),
    ).toMatchObject({
      ok: false,
      message: expect.stringContaining('lifecycle tools'),
    });
    db.close();
  });

  it('routes begin_turn resets through lifecycle repair before committing', () => {
    const { db, ctx, registry } = setup();
    const combatantId = startCombatant(ctx, registry);
    db.prepare(
      `UPDATE encounter_combatant
       SET conditions_json='[{"id":"exhaustion","level":6}]',
           hp_current=12, status='alive'
       WHERE combatant_id=?`,
    ).run(combatantId);

    const result = registry.invoke('begin_turn', { combatantId }, ctx);

    expect(result.ok).toBe(true);
    expect(
      db
        .prepare(
          'SELECT status, hp_current, damage_turn_key FROM encounter_combatant WHERE combatant_id=?',
        )
        .get(combatantId),
    ).toEqual({
      status: 'dead',
      hp_current: 6,
      damage_turn_key:
        'exhaustion-combat:1:combatant:exhaustion-combat-exhaustion-npc',
    });
    db.close();
  });

  it('settles and re-arms zero-maximum combatant recovery without blocking later clocks', () => {
    const { db, ctx, registry } = setup();
    expect(
      registry.invoke(
        'start_encounter',
        {
          combatInstanceId: 'settled-zero',
          actors: [
            {
              actorId: 'settled',
              rulesRef: 'creature:goblin',
              hpMax: 1,
              hpCurrent: 1,
            },
          ],
        },
        ctx,
      ).ok,
    ).toBe(true);
    const combatantId = 'settled-zero-settled';
    expect(
      registry.invoke(
        'update_combatant',
        { combatantId, deathRules: 'player-character' },
        ctx,
      ).ok,
    ).toBe(true);
    expect(
      registry.invoke('adjust_exhaustion', { combatantId, delta: 4 }, ctx).ok,
    ).toBe(true);
    expect(
      registry.invoke('stabilize_character', { combatantId }, ctx).ok,
    ).toBe(true);
    const deadline = (
      db
        .prepare(
          'SELECT stable_recovery_deadline_elapsed_minutes AS deadline FROM encounter_combatant WHERE combatant_id=?',
        )
        .get(combatantId) as { deadline: number }
    ).deadline;
    expect(registry.invoke('advance_time', { minutes: deadline }, ctx).ok).toBe(
      true,
    );
    expect(
      db
        .prepare(
          'SELECT status,stable_recovery_settled,stable_recovery_deadline_elapsed_minutes FROM encounter_combatant WHERE combatant_id=?',
        )
        .get(combatantId),
    ).toEqual({
      status: 'stable',
      stable_recovery_settled: 1,
      stable_recovery_deadline_elapsed_minutes: null,
    });
    expect(
      registry.invoke('update_combatant', { combatantId, hpDelta: 1 }, ctx).ok,
    ).toBe(true);
    expect(
      registry.invoke('adjust_exhaustion', { combatantId, delta: 1 }, ctx).ok,
    ).toBe(true);
    expect(
      db
        .prepare(
          'SELECT status,stable_recovery_settled,stable_recovery_deadline_elapsed_minutes FROM encounter_combatant WHERE combatant_id=?',
        )
        .get(combatantId),
    ).toEqual({
      status: 'stable',
      stable_recovery_settled: 1,
      stable_recovery_deadline_elapsed_minutes: null,
    });
    expect(
      registry.invoke('adjust_exhaustion', { combatantId, delta: -2 }, ctx).ok,
    ).toBe(true);
    for (let i = 0; i < 3; i += 1)
      expect(registry.invoke('advance_time', { minutes: 60 }, ctx).ok).toBe(
        true,
      );
    db.close();
  });

  it('rejects partial settled combatant schedules in both writes and clock scans', () => {
    const { db, ctx, registry } = setup();
    const combatantId = startCombatant(ctx, registry);
    expect(
      registry.invoke(
        'update_combatant',
        {
          combatantId,
          deathRules: 'player-character',
          hpDelta: -12,
          status: 'stable',
        },
        ctx,
      ).ok,
    ).toBe(true);
    db.prepare(
      `UPDATE encounter_combatant
       SET stable_recovery_roll=NULL, stable_recovery_settled=1
       WHERE campaign_id=? AND combatant_id=?`,
    ).run(ctx.campaignId, combatantId);
    const elapsedBefore = (
      db.prepare('SELECT elapsed_minutes FROM clock WHERE id=1').get() as {
        elapsed_minutes: number;
      }
    ).elapsed_minutes;
    expect(registry.invoke('advance_time', { minutes: 1 }, ctx)).toMatchObject({
      ok: false,
      message: expect.stringMatching(/stable recovery|schedule/i),
    });
    expect(
      (
        db.prepare('SELECT elapsed_minutes FROM clock WHERE id=1').get() as {
          elapsed_minutes: number;
        }
      ).elapsed_minutes,
    ).toBe(elapsedBefore);
    expect(
      registry.invoke(
        'update_combatant',
        { combatantId, addCondition: { id: 'unrelated-condition' } },
        ctx,
      ).ok,
    ).toBe(false);
    db.close();
  });

  it('generates state-aware lifecycle operations and checks outcomes, I8, I7, and projection parity', () => {
    const { db, ctx, registry } = setup();
    type LifecycleRow = {
      combat_instance_id: string;
      combatant_id: string;
      identity_kind: string;
      identity_ref: string | null;
      hp_current: number;
      hp_max: number;
      status: string;
      death_rules: 'monster' | 'player-character';
      death_save_successes: number;
      death_save_failures: number;
      recovery_block: string | null;
      stable_recovery_roll: number | null;
      stable_recovery_anchor_elapsed_minutes: number | null;
      stable_recovery_deadline_elapsed_minutes: number | null;
      stable_recovery_settled: number;
      head_count: number | null;
      heads_died_since_own_turn: number;
      fire_damage_since_own_turn: number;
      damage_this_turn: number;
      damage_turn_key: string | null;
      head_died_this_turn: number;
      conditions_json: string;
    };
    const readRows = () =>
      db
        .prepare(`SELECT combat_instance_id,combatant_id,identity_kind,identity_ref,
          hp_current,hp_max,status,death_rules,death_save_successes,
          death_save_failures,recovery_block,stable_recovery_roll,
          stable_recovery_anchor_elapsed_minutes,
          stable_recovery_deadline_elapsed_minutes,stable_recovery_settled,
          head_count,heads_died_since_own_turn,fire_damage_since_own_turn,
          damage_this_turn,damage_turn_key,head_died_this_turn,conditions_json
          FROM encounter_combatant WHERE campaign_id=? ORDER BY combatant_id`)
        .all(ctx.campaignId) as LifecycleRow[];
    const activeInstance = () => {
      const row = db
        .prepare(
          "SELECT combat_instance_id FROM combat_instance WHERE campaign_id=? AND status='active'",
        )
        .get(ctx.campaignId) as { combat_instance_id: string } | undefined;
      if (!row) throw new Error('expected an active combat instance');
      return row.combat_instance_id;
    };
    const activeRow = (actorId: string) => {
      const row = db
        .prepare(`SELECT * FROM encounter_combatant
          WHERE campaign_id=? AND combat_instance_id=?
            AND identity_kind='campaign_actor' AND identity_ref=?`)
        .get(ctx.campaignId, activeInstance(), actorId) as
        | LifecycleRow
        | undefined;
      if (!row) throw new Error(`missing active projection for '${actorId}'`);
      return row;
    };
    const activeId = (actorId: string) => activeRow(actorId).combatant_id;
    const successes: Record<string, number> = {};
    let operationCount = 0;
    const invoke = (
      eventClass: string,
      name: string,
      args: unknown,
      expectedSuccess = true,
      allowMonsterRevival = false,
    ) => {
      operationCount += 1;
      const before = readRows();
      const result = registry.invoke(name, args, ctx);
      expect(result.ok).toBe(expectedSuccess);
      const after = readRows();
      if (!expectedSuccess) expect(after).toEqual(before);
      if (expectedSuccess)
        successes[eventClass] = (successes[eventClass] ?? 0) + 1;
      const afterById = new Map(after.map((row) => [row.combatant_id, row]));
      for (const previous of before) {
        const next = afterById.get(previous.combatant_id);
        if (previous.status === 'dead' && next?.status !== 'dead') {
          const oldConditions = JSON.parse(previous.conditions_json) as Array<{
            id: string;
            level?: number;
          }>;
          const newConditions = JSON.parse(
            next?.conditions_json ?? '[]',
          ) as Array<{ id: string; level?: number }>;
          expect(allowMonsterRevival).toBe(true);
          expect(previous.death_rules).toBe('monster');
          expect(previous.head_count).not.toBe(0);
          expect(
            oldConditions.find((condition) => condition.id === 'exhaustion')
              ?.level,
          ).not.toBe(6);
          expect(
            newConditions.find((condition) => condition.id === 'exhaustion')
              ?.level,
          ).not.toBe(6);
          expect(next?.hp_current).toBeGreaterThan(previous.hp_current);
        }
      }
      assertState();
      return result;
    };
    const assertState = () => {
      const rows = readRows();
      const activeOwnerIds = new Map<string, string>();
      const actorIds = [
        ...new Set(
          rows
            .filter(
              (row) =>
                row.identity_kind === 'campaign_actor' &&
                row.identity_ref !== null,
            )
            .map((row) => row.identity_ref as string),
        ),
      ];
      for (const actorId of actorIds) {
        const owner = db
          .prepare(`SELECT c.combatant_id FROM encounter_combatant c
            JOIN combat_instance i USING(campaign_id,combat_instance_id)
            WHERE c.campaign_id=? AND c.identity_kind='campaign_actor'
              AND c.identity_ref=?
            ORDER BY (i.status='active') DESC,i.rowid DESC LIMIT 1`)
          .get(ctx.campaignId, actorId) as { combatant_id: string } | undefined;
        if (owner) activeOwnerIds.set(actorId, owner.combatant_id);
      }
      for (const row of rows) {
        const conditions = JSON.parse(row.conditions_json) as Array<{
          id: string;
          level?: number;
        }>;
        const exhaustion = conditions.find(
          (condition) => condition.id === 'exhaustion',
        )?.level;
        const pc = row.death_rules === 'player-character';
        const schedule = [
          row.stable_recovery_roll,
          row.stable_recovery_anchor_elapsed_minutes,
          row.stable_recovery_deadline_elapsed_minutes,
        ];
        const present = schedule.filter((value) => value !== null).length;
        const owner =
          row.identity_kind !== 'campaign_actor' ||
          activeOwnerIds.get(row.identity_ref ?? '') === row.combatant_id;
        expect(exhaustion === 6 ? row.status === 'dead' : true).toBe(true);
        expect(row.head_count === 0 ? row.status === 'dead' : true).toBe(true);
        expect(
          ['dying', 'stable'].includes(row.status)
            ? pc && row.hp_current === 0
            : true,
        ).toBe(true);
        expect(
          pc && row.hp_current === 0
            ? ['dying', 'stable', 'dead'].includes(row.status)
            : true,
        ).toBe(true);
        expect(
          row.recovery_block !== null ? row.status === 'dying' : true,
        ).toBe(true);
        expect(row.hp_current).toBeLessThanOrEqual(
          effectiveHpMax(row.hp_max, conditions),
        );
        expect([0, 3]).toContain(present);
        expect(
          row.stable_recovery_settled === 1
            ? row.status === 'stable' && present === 0
            : true,
        ).toBe(true);
        expect(row.status !== 'stable' ? present === 0 : true).toBe(true);
        expect(
          !owner ? present === 0 && row.stable_recovery_settled === 0 : true,
        ).toBe(true);
        expect(
          owner && row.status === 'stable' && present === 0
            ? row.stable_recovery_settled === 1
            : true,
        ).toBe(true);
        if (
          !owner ||
          row.identity_kind !== 'campaign_actor' ||
          row.identity_ref === null
        )
          continue;
        const actor = db
          .prepare(
            'SELECT hp_current,hp_max,status,conditions_json,state_json FROM campaign_actor WHERE campaign_id=? AND actor_id=?',
          )
          .get(ctx.campaignId, row.identity_ref) as {
          hp_current: number;
          hp_max: number;
          status: string;
          conditions_json: string;
          state_json: string;
        };
        expect(actor.hp_current).toBe(row.hp_current);
        expect(actor.hp_max).toBe(row.hp_max);
        expect(actor.status).toBe(row.status);
        expect(JSON.parse(actor.conditions_json)).toEqual(conditions);
        const lifecycle = JSON.parse(actor.state_json).combatLifecycle;
        expect(lifecycle).toMatchObject({
          deathRules: row.death_rules,
          deathSaveSuccesses: row.death_save_successes,
          deathSaveFailures: row.death_save_failures,
          recoveryBlock: row.recovery_block,
          stableRecovery:
            present === 3
              ? {
                  roll: row.stable_recovery_roll,
                  anchor: row.stable_recovery_anchor_elapsed_minutes,
                  deadline: row.stable_recovery_deadline_elapsed_minutes,
                }
              : null,
          stableRecoverySettled: row.stable_recovery_settled === 1,
          headCount: row.head_count,
          headsDiedSinceOwnTurn: row.heads_died_since_own_turn,
          fireDamageSinceOwnTurn: row.fire_damage_since_own_turn,
        });
      }
    };
    const start = (instance: string, initial = false) =>
      invoke('start', 'start_encounter', {
        combatInstanceId: instance,
        actors: [
          {
            actorId: 'pc',
            rulesRef: 'creature:goblin',
            ...(initial ? { hpMax: 7, hpCurrent: 7 } : {}),
          },
          {
            actorId: 'monster',
            rulesRef: 'creature:goblin',
            ...(initial ? { hpMax: 7, hpCurrent: 7 } : {}),
          },
          {
            actorId: 'hydra',
            rulesRef: 'creature:hydra',
            ...(initial ? { hpMax: 172, hpCurrent: 172 } : {}),
          },
        ],
      });
    expect(start('sequence-0', true).ok).toBe(true);
    invoke('opt-in', 'update_combatant', {
      combatantId: activeId('pc'),
      deathRules: 'player-character',
    });

    const ensurePcDying = () => {
      let pc = activeRow('pc');
      if (pc.status === 'dead')
        throw new Error(
          'state generator unexpectedly exhausted the PC lifecycle',
        );
      if (pc.recovery_block !== null) {
        invoke('support-breathe', 'set_suffocation', {
          combatantId: pc.combatant_id,
          event: 'breathe',
        });
        pc = activeRow('pc');
      }
      if (pc.status === 'alive') {
        invoke('support-damage', 'update_combatant', {
          combatantId: pc.combatant_id,
          hpDelta: -pc.hp_current,
        });
        pc = activeRow('pc');
      } else if (pc.status === 'stable') {
        invoke('support-damage', 'update_combatant', {
          combatantId: pc.combatant_id,
          hpDelta: -1,
        });
        pc = activeRow('pc');
      }
      expect(pc.status).toBe('dying');
      expect(pc.recovery_block).toBeNull();
    };
    const doPcDamage = () => {
      let pc = activeRow('pc');
      if (pc.status !== 'alive' || pc.hp_current < pc.hp_max) {
        if (pc.recovery_block !== null)
          invoke('support-breathe', 'set_suffocation', {
            combatantId: pc.combatant_id,
            event: 'breathe',
          });
        pc = activeRow('pc');
        const amount = Math.max(1, pc.hp_max - pc.hp_current);
        invoke('heal', 'update_combatant', {
          combatantId: pc.combatant_id,
          hpDelta: amount,
        });
        pc = activeRow('pc');
      }
      invoke('damage', 'update_combatant', {
        combatantId: pc.combatant_id,
        hpDelta: -pc.hp_current,
      });
    };
    const doDeathSave = () => {
      ensurePcDying();
      invoke('deathSave', 'record_death_save', {
        combatantId: activeId('pc'),
        roll: 20,
      });
    };
    const doStabilize = () => {
      ensurePcDying();
      invoke('stabilize', 'stabilize_character', {
        combatantId: activeId('pc'),
      });
    };
    const doPromotion = () =>
      invoke('promotion', 'start_effect', {
        effectId: 'sequence-summoning-promotion',
        kind: 'summoning',
        displayName: 'Lifecycle promotion',
        source: { kind: 'ruling' },
        duration: { kind: 'until-removed' },
        actors: [{ combatantId: activeId('pc'), campaignActorId: 'pc' }],
      });
    const doCloseReopen = (nextIndex: number) => {
      const old = activeInstance();
      invoke('close', 'close_combat_instance', {
        combatInstanceId: old,
        status: 'completed',
      });
      start(`sequence-${nextIndex}`);
      successes.reopen = (successes.reopen ?? 0) + 1;
    };
    const doRecovery = () => {
      const pc = activeRow('pc');
      const deadline = pc.stable_recovery_deadline_elapsed_minutes;
      if (pc.status !== 'stable' || deadline === null)
        throw new Error(
          'expected a pending stable recovery before clock advancement',
        );
      const elapsed = (
        db.prepare('SELECT elapsed_minutes FROM clock WHERE id=1').get() as {
          elapsed_minutes: number;
        }
      ).elapsed_minutes;
      invoke('recovery', 'advance_time', { minutes: deadline - elapsed + 1 });
    };
    const doSuffocation = () => {
      let pc = activeRow('pc');
      if (pc.status !== 'alive') {
        if (pc.recovery_block !== null)
          invoke('support-breathe', 'set_suffocation', {
            combatantId: pc.combatant_id,
            event: 'breathe',
          });
        pc = activeRow('pc');
        invoke('heal', 'update_combatant', {
          combatantId: pc.combatant_id,
          hpDelta: Math.max(1, pc.hp_max - pc.hp_current),
        });
        pc = activeRow('pc');
      }
      invoke('suffocationDrop', 'set_suffocation', {
        combatantId: pc.combatant_id,
        event: 'drop',
      });
      invoke('suffocationBreathe', 'set_suffocation', {
        combatantId: pc.combatant_id,
        event: 'breathe',
      });
      invoke('deathSave', 'record_death_save', {
        combatantId: activeId('pc'),
        roll: 20,
      });
    };
    const doMonsterDamage = () => {
      let monster = activeRow('monster');
      if (monster.status === 'dead') {
        invoke(
          'heal',
          'update_combatant',
          { combatantId: monster.combatant_id, hpDelta: 1 },
          true,
          true,
        );
        monster = activeRow('monster');
      }
      invoke('damage', 'update_combatant', {
        combatantId: monster.combatant_id,
        hpDelta: -monster.hp_current,
      });
    };
    const doMonsterHeal = () => {
      const monster = activeRow('monster');
      invoke(
        'heal',
        'update_combatant',
        { combatantId: monster.combatant_id, hpDelta: 1 },
        true,
        monster.status === 'dead',
      );
    };
    const doExhaustion = (delta: 1 | -1) => {
      let monster = activeRow('monster');
      if (monster.status === 'dead') {
        invoke(
          'heal',
          'update_combatant',
          { combatantId: monster.combatant_id, hpDelta: 1 },
          true,
          true,
        );
        monster = activeRow('monster');
      }
      invoke(
        delta === 1 ? 'exhaustionUp' : 'exhaustionDown',
        'adjust_exhaustion',
        { combatantId: monster.combatant_id, delta },
      );
    };
    const doHydraTurn = (round: number) => {
      const hydra = activeRow('hydra');
      invoke('beginTurn', 'begin_turn', {
        combatantId: hydra.combatant_id,
        round,
      });
      invoke('headDamage', 'update_combatant', {
        combatantId: activeId('hydra'),
        hpDelta: -25,
      });
    };

    for (let cycle = 0; cycle < 4; cycle += 1) {
      doPcDamage();
      doDeathSave();
      doStabilize();
      if (cycle === 0) doPromotion();
      doCloseReopen(cycle + 1);
      doRecovery();
      doSuffocation();
      doMonsterDamage();
      doMonsterHeal();
      doExhaustion(1);
      doExhaustion(-1);
      doHydraTurn(cycle + 1);
      invoke(
        'invalidDeathSave',
        'record_death_save',
        { combatantId: activeId('pc'), roll: 12 },
        false,
      );
      invoke(
        'invalidStabilize',
        'stabilize_character',
        { combatantId: activeId('pc') },
        false,
      );
    }
    expect(operationCount).toBeGreaterThanOrEqual(75);
    for (const [eventClass, minimum] of Object.entries({
      damage: 8,
      heal: 7,
      deathSave: 8,
      stabilize: 4,
      suffocationDrop: 4,
      suffocationBreathe: 4,
      exhaustionUp: 4,
      exhaustionDown: 4,
      close: 4,
      start: 5,
      reopen: 4,
      recovery: 4,
      promotion: 1,
      headDamage: 4,
      beginTurn: 4,
    }))
      expect(successes[eventClass] ?? 0, eventClass).toBeGreaterThanOrEqual(
        minimum,
      );
    db.close();
  });

  it('records +1 from absence and +2 on an existing level through the registry', () => {
    const { db, ctx, registry } = setup();
    expect(
      registry.invoke('adjust_exhaustion', { delta: 1 }, ctx),
    ).toMatchObject({ ok: true, data: { previousLevel: 0, newLevel: 1 } });
    expect(
      registry.invoke('adjust_exhaustion', { delta: 2 }, ctx),
    ).toMatchObject({ ok: true, data: { previousLevel: 1, newLevel: 3 } });
    expect(level(db)).toEqual([{ id: 'exhaustion', level: 3 }]);
    db.close();
  });

  it('clamps at six and applies the character death transition', () => {
    const { db, ctx, registry } = setup();
    giveItem(
      db,
      { id: 'death-ring', name: 'Ring of Protection' },
      { provenance: 'test', sessionId: ctx.sessionId, at },
    );
    attuneItem(db, {
      campaignId: ctx.campaignId,
      itemId: 'death-ring',
      provenance: 'test',
      sessionId: ctx.sessionId,
      at,
    });
    db.prepare("UPDATE character SET hp_current=15 WHERE id='pc-1'").run();
    registry.invoke(
      'start_effect',
      {
        effectId: 'character-exhaustion-concentration',
        kind: 'spell-effect',
        displayName: 'Focus',
        source: { kind: 'ruling' },
        concentrationOwner: { kind: 'character', ref: 'pc-1' },
        duration: { kind: 'until-removed' },
      },
      ctx,
    );
    const result = registry.invoke('adjust_exhaustion', { delta: 6 }, ctx);
    expect(result).toMatchObject({
      ok: true,
      data: { previousLevel: 0, newLevel: 6, died: true, hpCurrent: 10 },
    });
    expect(
      db
        .prepare("SELECT life_state,hp_current FROM character WHERE id='pc-1'")
        .get(),
    ).toEqual({ life_state: 'dead', hp_current: 10 });
    expect(
      getConcentrationEffect(db, DEFAULT_TEST_CAMPAIGN_ID, {
        kind: 'character',
        ref: 'pc-1',
      }),
    ).toBeUndefined();
    expect(listAttunements(db, DEFAULT_TEST_CAMPAIGN_ID, 'pc-1')).toEqual([]);
    expect(
      db
        .prepare(
          `SELECT COUNT(*) AS n FROM active_effect_event
           WHERE campaign_id=? AND effect_id='character-exhaustion-concentration'
             AND event_kind='ended'`,
        )
        .get(DEFAULT_TEST_CAMPAIGN_ID),
    ).toEqual({ n: 1 });
    db.close();
  });

  it('clamps negative deltas at zero and removes exhaustion below level one', () => {
    const { db, ctx, registry } = setup();
    registry.invoke('adjust_exhaustion', { delta: 2 }, ctx);
    expect(
      registry.invoke('adjust_exhaustion', { delta: -1 }, ctx),
    ).toMatchObject({ ok: true, data: { previousLevel: 2, newLevel: 1 } });
    expect(
      registry.invoke('adjust_exhaustion', { delta: -2 }, ctx),
    ).toMatchObject({ ok: true, data: { previousLevel: 1, newLevel: 0 } });
    expect(level(db)).toEqual([]);
    db.close();
  });

  it('halves effective maximum at level four and clamps current HP without changing hp_max', () => {
    const { db, ctx, registry } = setup();
    expect(
      registry.invoke('adjust_exhaustion', { delta: 4 }, ctx),
    ).toMatchObject({ ok: true, data: { hpMax: 10, hpCurrent: 10 } });
    expect(
      db
        .prepare("SELECT hp_current, hp_max FROM character WHERE id='pc-1'")
        .get(),
    ).toEqual({ hp_current: 10, hp_max: 20 });
    db.close();
  });

  it('caps healing at the derived maximum', () => {
    const { db, ctx, registry } = setup();
    registry.invoke('adjust_exhaustion', { delta: 4 }, ctx);
    db.prepare("UPDATE character SET hp_current=3 WHERE id='pc-1'").run();
    expect(registry.invoke('adjust_hp', { amount: 30 }, ctx)).toMatchObject({
      ok: true,
      data: { newHp: 10, hpMax: 10 },
    });
    db.close();
  });

  it('uses the effective maximum for instant-death overflow', () => {
    const { db, ctx, registry } = setup();
    registry.invoke('adjust_exhaustion', { delta: 4 }, ctx);
    db.prepare("UPDATE character SET hp_current=5 WHERE id='pc-1'").run();
    expect(registry.invoke('adjust_hp', { amount: -15 }, ctx)).toMatchObject({
      ok: true,
      data: { lifeState: 'dead', instantDeath: true, hpMax: 10 },
    });
    db.close();
  });

  it('removes the derived cap below level four without healing', () => {
    const { db, ctx, registry } = setup();
    registry.invoke('adjust_exhaustion', { delta: 4 }, ctx);
    db.prepare("UPDATE character SET hp_current=7 WHERE id='pc-1'").run();
    expect(
      registry.invoke('adjust_exhaustion', { delta: -1 }, ctx),
    ).toMatchObject({
      ok: true,
      data: { newLevel: 3, hpMax: 20, hpCurrent: 7 },
    });
    db.close();
  });

  it('normalizes the legacy exhausted id when adjusted', () => {
    const { db, ctx, registry } = setup();
    db.prepare(
      'UPDATE character SET conditions_json=\'[{"id":"exhausted","level":2}]\' WHERE id=\'pc-1\'',
    ).run();
    expect(
      registry.invoke('adjust_exhaustion', { delta: 1 }, ctx),
    ).toMatchObject({ ok: true, data: { previousLevel: 2, newLevel: 3 } });
    expect(level(db)).toEqual([{ id: 'exhaustion', level: 3 }]);
    db.close();
  });

  it('refuses condition-tool exhaustion writes and points to adjust_exhaustion', () => {
    const { db, ctx, registry } = setup();
    expect(
      registry.invoke('add_condition', { id: 'exhaustion', level: 1 }, ctx),
    ).toMatchObject({
      ok: false,
      message: expect.stringContaining('adjust_exhaustion'),
    });
    const combatantId = startCombatant(ctx, registry);
    expect(
      registry.invoke(
        'update_combatant',
        { combatantId, addCondition: { id: 'exhausted', level: 1 } },
        ctx,
      ),
    ).toMatchObject({
      ok: false,
      message: expect.stringContaining('adjust_exhaustion'),
    });
    db.close();
  });

  it('enforces actor exhaustion invariants without combatLifecycle and refuses condition projections', () => {
    const { db, ctx, registry } = setup();
    const actorInput = {
      campaignId: ctx.campaignId,
      actorId: 'legacy-actor',
      displayName: 'Legacy Actor',
      actorKind: 'monster' as const,
      sourceKind: 'campaign_created' as const,
      rulesRef: 'creature:goblin',
      hpCurrent: 20,
      hpMax: 20,
      conditions: [] as { id: string; level?: number }[],
      status: 'alive' as const,
      provenance: 'test',
      sessionId: ctx.sessionId,
      at: ctx.at,
    };
    upsertCampaignActor(db, actorInput);

    expect(
      registry.invoke(
        'start_effect',
        {
          effectId: 'legacy-exhaustion-projection',
          kind: 'condition-package',
          displayName: 'Exhaustion projection',
          source: { kind: 'ruling' },
          duration: { kind: 'until-removed' },
          conditions: [
            {
              target: { kind: 'campaign_actor', ref: 'legacy-actor' },
              condition: { id: 'exhaustion', level: 6 },
            },
          ],
        },
        ctx,
      ),
    ).toMatchObject({
      ok: false,
      message: expect.stringContaining('adjust_exhaustion'),
    });
    expect(getCampaignActor(db, ctx.campaignId, 'legacy-actor')).toMatchObject({
      hpCurrent: 20,
      status: 'alive',
      conditions: [],
      state: {},
    });

    expect(() =>
      upsertCampaignActor(db, {
        ...actorInput,
        conditions: [{ id: 'exhaustion', level: 6 }],
      }),
    ).toThrow(/I1/);
    expect(() =>
      upsertCampaignActor(db, {
        ...actorInput,
        hpCurrent: 11,
        conditions: [{ id: 'exhaustion', level: 4 }],
      }),
    ).toThrow(/I6/);
    expect(
      db
        .prepare(
          "SELECT COUNT(*) AS n FROM active_effect WHERE campaign_id=? AND effect_id='legacy-exhaustion-projection'",
        )
        .get(ctx.campaignId),
    ).toEqual({ n: 0 });
    db.close();
  });

  it('applies level-six death to combatants through updateCombatant', () => {
    const { db, ctx, registry } = setup();
    const combatantId = startCombatant(ctx, registry);
    registry.invoke(
      'start_effect',
      {
        effectId: 'exhaustion-concentration',
        kind: 'spell-effect',
        displayName: 'Focus',
        source: { kind: 'ruling' },
        concentrationOwner: { kind: 'combatant', ref: combatantId },
        duration: { kind: 'until-removed' },
      },
      ctx,
    );
    registry.invoke('adjust_exhaustion', { delta: 5, combatantId }, ctx);
    expect(
      registry.invoke('adjust_exhaustion', { delta: 1, combatantId }, ctx),
    ).toMatchObject({
      ok: true,
      data: {
        previousLevel: 5,
        newLevel: 6,
        died: true,
        concentrationBroken: {
          effectId: 'exhaustion-concentration',
          cause: 'dead',
        },
      },
    });
    expect(
      listCombatants(db, DEFAULT_TEST_CAMPAIGN_ID).find(
        (entry) => entry.combatantId === combatantId,
      ),
    ).toMatchObject({
      status: 'dead',
      conditions: [{ id: 'exhaustion', level: 6 }],
    });
    db.close();
  });

  it('applies direct level-six death and the effective HP clamp in one combatant transition', () => {
    const { db, ctx, registry } = setup();
    expect(
      registry.invoke(
        'start_encounter',
        {
          combatInstanceId: 'one-one-exhaustion',
          actors: [
            {
              actorId: 'goblin',
              rulesRef: 'creature:goblin',
              hpMax: 1,
              hpCurrent: 1,
            },
          ],
        },
        ctx,
      ).ok,
    ).toBe(true);
    const combatantId = 'one-one-exhaustion-goblin';
    expect(
      registry.invoke(
        'update_combatant',
        { combatantId, deathRules: 'player-character' },
        ctx,
      ).ok,
    ).toBe(true);
    expect(
      registry.invoke(
        'start_effect',
        {
          effectId: 'one-one-concentration',
          kind: 'spell-effect',
          displayName: 'Focus',
          source: { kind: 'ruling' },
          concentrationOwner: { kind: 'combatant', ref: combatantId },
          duration: { kind: 'until-removed' },
        },
        ctx,
      ).ok,
    ).toBe(true);

    expect(
      registry.invoke('adjust_exhaustion', { combatantId, delta: 6 }, ctx),
    ).toMatchObject({
      ok: true,
      data: {
        previousLevel: 0,
        newLevel: 6,
        hpMax: 0,
        hpCurrent: 0,
        died: true,
      },
    });
    expect(
      listCombatants(db, ctx.campaignId).find(
        (entry) => entry.combatantId === combatantId,
      ),
    ).toMatchObject({
      hpCurrent: 0,
      status: 'dead',
      conditions: [{ id: 'exhaustion', level: 6 }],
    });
    expect(
      db
        .prepare(
          `SELECT COUNT(*) AS n FROM active_effect_event
           WHERE campaign_id=? AND effect_id='one-one-concentration'
             AND event_kind='ended'`,
        )
        .get(ctx.campaignId),
    ).toEqual({ n: 1 });
    db.close();
  });

  it('raises a combatant level and applies the effective HP maximum through the registry', () => {
    const { db, ctx, registry } = setup();
    const combatantId = startCombatant(ctx, registry);
    expect(
      registry.invoke('adjust_exhaustion', { delta: 4, combatantId }, ctx),
    ).toMatchObject({
      ok: true,
      data: { previousLevel: 0, newLevel: 4, hpMax: 6, hpCurrent: 6 },
    });
    db.close();
  });

  it('caps player-combatant healing and instant-death overflow at the effective maximum', () => {
    const { db, ctx, registry } = setup();
    const combatantId = startCombatant(ctx, registry);
    registry.invoke('adjust_exhaustion', { delta: 4, combatantId }, ctx);
    registry.invoke(
      'update_combatant',
      { combatantId, deathRules: 'player-character', hpDelta: -4 },
      ctx,
    );
    expect(
      registry.invoke('update_combatant', { combatantId, hpDelta: 10 }, ctx),
    ).toMatchObject({ ok: true, data: { combatant: { hpCurrent: 6 } } });
    expect(
      registry.invoke('update_combatant', { combatantId, hpDelta: -12 }, ctx),
    ).toMatchObject({
      ok: true,
      data: { combatant: { hpCurrent: 0, status: 'dead' } },
    });
    db.close();
  });
});

describe('effectiveHpMax floor (eshyra-o9bd.19.5.7.3)', () => {
  it('clamps encounter actor HP at admission and enters the zero-HP lifecycle', () => {
    const { db, ctx, registry } = setup();
    expect(
      registry.invoke(
        'start_encounter',
        {
          combatInstanceId: 'admission-clamp',
          actors: [
            {
              actorId: 'odd-exhausted',
              rulesRef: 'creature:goblin',
              hpMax: 19,
              hpCurrent: 19,
              conditions: [{ id: 'exhaustion', level: 4 }],
            },
          ],
        },
        ctx,
      ),
    ).toMatchObject({ ok: true });
    expect(getCampaignActor(db, ctx.campaignId, 'odd-exhausted')).toMatchObject(
      {
        hpCurrent: 9,
        hpMax: 19,
      },
    );
    expect(listCombatants(db, ctx.campaignId)[0]).toMatchObject({
      hpCurrent: 9,
      hpMax: 19,
      status: 'alive',
    });
    db.close();
  });

  it('rejects model injection of actor combat lifecycle at encounter admission', () => {
    const { db, ctx, registry } = setup();
    expect(
      registry.invoke(
        'start_encounter',
        {
          actors: [
            {
              actorId: 'forged',
              rulesRef: 'creature:hydra',
              state: { combatLifecycle: { headCount: 999 } },
            },
          ],
        },
        ctx,
      ),
    ).toMatchObject({
      ok: false,
      message: expect.stringContaining('combatLifecycle is engine-owned'),
    });
    db.close();
  });

  it('uses non-damage clamps without consuming temp HP or inventing hydra damage', () => {
    const { db, ctx, registry } = setup();
    db.prepare("UPDATE character SET hp_temp=10 WHERE id='pc-1'").run();
    expect(registry.invoke('adjust_exhaustion', { delta: 4 }, ctx).ok).toBe(
      true,
    );
    expect(
      db
        .prepare("SELECT hp_current,hp_temp FROM character WHERE id='pc-1'")
        .get(),
    ).toEqual({ hp_current: 10, hp_temp: 10 });
    db.close();

    const hydra = setup();
    expect(
      hydra.registry.invoke(
        'start_encounter',
        {
          combatInstanceId: 'clamp-hydra',
          actors: [
            {
              actorId: 'clamp-hydra-actor',
              rulesRef: 'creature:hydra',
              hpMax: 172,
              hpCurrent: 172,
            },
          ],
        },
        hydra.ctx,
      ).ok,
    ).toBe(true);
    const combatantId = 'clamp-hydra-clamp-hydra-actor';
    hydra.registry.invoke(
      'update_combatant',
      { combatantId, hpDelta: -5 },
      hydra.ctx,
    );
    hydra.registry.invoke(
      'adjust_exhaustion',
      { combatantId, delta: 4 },
      hydra.ctx,
    );
    expect(
      hydra.db
        .prepare(`SELECT hp_current,head_count,heads_died_since_own_turn,
      fire_damage_since_own_turn,damage_this_turn,head_died_this_turn
      FROM encounter_combatant WHERE combatant_id=?`)
        .get(combatantId),
    ).toEqual({
      hp_current: 86,
      head_count: 5,
      heads_died_since_own_turn: 0,
      fire_damage_since_own_turn: 0,
      damage_this_turn: 5,
      head_died_this_turn: 0,
    });
    hydra.db.close();
  });

  it('does not revive at zero effective maximum on a natural 20', () => {
    const character = setup();
    character.db
      .prepare(
        "UPDATE character SET hp_max=1,hp_current=1,life_state='alive' WHERE id='pc-1'",
      )
      .run();
    character.registry.invoke('adjust_exhaustion', { delta: 4 }, character.ctx);
    expect(
      character.registry.invoke('adjust_hp', { amount: 5 }, character.ctx),
    ).toMatchObject({ ok: true, data: { newHp: 0, lifeState: 'dying' } });
    expect(
      character.registry.invoke(
        'record_death_save',
        { roll: 20 },
        character.ctx,
      ),
    ).toMatchObject({
      ok: true,
      data: {
        outcome: 'success',
        lifeState: 'dying',
        hpCurrent: 0,
        deathSaveSuccesses: 1,
      },
    });
    character.db.close();

    const combatant = setup();
    const id = startCombatant(combatant.ctx, combatant.registry);
    combatant.db
      .prepare(
        'UPDATE encounter_combatant SET hp_max=1,hp_current=1 WHERE combatant_id=?',
      )
      .run(id);
    combatant.registry.invoke(
      'update_combatant',
      { combatantId: id, deathRules: 'player-character', hpDelta: 0 },
      combatant.ctx,
    );
    combatant.registry.invoke(
      'adjust_exhaustion',
      { combatantId: id, delta: 4 },
      combatant.ctx,
    );
    expect(
      combatant.registry.invoke(
        'update_combatant',
        { combatantId: id, hpDelta: 5 },
        combatant.ctx,
      ),
    ).toMatchObject({
      ok: true,
      data: { combatant: { hpCurrent: 0, status: 'dying' } },
    });
    expect(
      combatant.registry.invoke(
        'record_death_save',
        { combatantId: id, roll: 20 },
        combatant.ctx,
      ),
    ).toMatchObject({
      ok: true,
      data: {
        outcome: 'success',
        lifeState: 'dying',
        hpCurrent: 0,
        deathSaveSuccesses: 1,
      },
    });
    combatant.db.close();
  });

  it('clears due stable recovery at zero maximum without reviving either target', () => {
    const character = setup();
    character.db
      .prepare("UPDATE character SET hp_max=1,hp_current=1 WHERE id='pc-1'")
      .run();
    character.registry.invoke('adjust_exhaustion', { delta: 4 }, character.ctx);
    const characterMutation = {
      characterId: 'pc-1',
      provenance: 'test',
      sessionId: character.ctx.sessionId,
      at: character.ctx.at,
    };
    stabilizeCharacter(character.db, characterMutation);
    const characterRecovery = resolveStableRecoveries(
      character.db,
      1000,
      characterMutation,
    );
    expect(characterRecovery[0]?.hp).toMatchObject({
      newHp: 0,
      lifeState: 'stable',
    });
    expect(
      character.db
        .prepare(
          "SELECT life_state,stable_recovery_deadline_elapsed_minutes FROM character WHERE id='pc-1'",
        )
        .get(),
    ).toEqual({
      life_state: 'stable',
      stable_recovery_deadline_elapsed_minutes: null,
    });
    character.db.close();

    const combatant = setup();
    const id = startCombatant(combatant.ctx, combatant.registry);
    combatant.db
      .prepare(
        'UPDATE encounter_combatant SET hp_max=1,hp_current=1 WHERE combatant_id=?',
      )
      .run(id);
    combatant.registry.invoke(
      'update_combatant',
      {
        combatantId: id,
        deathRules: 'player-character',
        hpDelta: 0,
      },
      combatant.ctx,
    );
    combatant.registry.invoke(
      'adjust_exhaustion',
      {
        combatantId: id,
        delta: 4,
      },
      combatant.ctx,
    );
    stabilizeCombatant(combatant.db, combatant.ctx.campaignId, id, {
      provenance: 'test',
      sessionId: combatant.ctx.sessionId,
      at: combatant.ctx.at,
    });
    resolveCombatantRecoveries(combatant.db, 1000, {
      provenance: 'test',
      sessionId: combatant.ctx.sessionId,
      at: combatant.ctx.at,
    });
    expect(
      combatant.db
        .prepare(
          'SELECT status,hp_current,stable_recovery_deadline_elapsed_minutes FROM encounter_combatant WHERE combatant_id=?',
        )
        .get(id),
    ).toEqual({
      status: 'stable',
      hp_current: 0,
      stable_recovery_deadline_elapsed_minutes: null,
    });
    combatant.db.close();
  });

  it('halves uniformly and uses the character 0-HP lifecycle when the clamp reaches zero', () => {
    const level4 = [{ id: 'exhaustion', level: 4 }];
    expect(effectiveHpMax(1, level4)).toBe(0);
    expect(effectiveHpMax(3, level4)).toBe(1);
    expect(effectiveHpMax(20, level4)).toBe(10);
    expect(effectiveHpMax(0, level4)).toBe(0);
    for (const [maximum, expectedMaximum, expectedLife] of [
      [1, 0, 'dying'],
      [3, 1, 'alive'],
      [4, 2, 'alive'],
    ] as const) {
      const { db, ctx, registry } = setup();
      db.prepare(
        "UPDATE character SET hp_max=?, hp_current=? WHERE id='pc-1'",
      ).run(maximum, maximum);
      expect(
        registry.invoke('adjust_exhaustion', { delta: 4 }, ctx),
      ).toMatchObject({
        ok: true,
        data: { hpMax: expectedMaximum, hpCurrent: expectedMaximum },
      });
      expect(
        db
          .prepare(
            "SELECT hp_current, life_state FROM character WHERE id='pc-1'",
          )
          .get(),
      ).toEqual({ hp_current: expectedMaximum, life_state: expectedLife });
      db.close();
    }
  });

  it.each([
    [1, 0, 'dead'],
    [3, 1, 'alive'],
    [4, 2, 'alive'],
  ] as const)(
    'routes combatant exhaustion at maximum %i through its lifecycle',
    (maximum, expectedMaximum, expectedStatus) => {
      const { db, ctx, registry } = setup();
      const combatantId = startCombatant(ctx, registry);
      db.prepare(
        'UPDATE encounter_combatant SET hp_max=?, hp_current=? WHERE combatant_id=?',
      ).run(maximum, maximum, combatantId);
      expect(
        registry.invoke('adjust_exhaustion', { delta: 4, combatantId }, ctx),
      ).toMatchObject({
        ok: true,
        data: { hpMax: expectedMaximum, hpCurrent: expectedMaximum },
      });
      expect(
        registry.invoke('update_combatant', { combatantId, hpDelta: 0 }, ctx),
      ).toMatchObject({
        ok: true,
        data: {
          combatant: { status: expectedStatus, hpCurrent: expectedMaximum },
        },
      });
      db.close();
    },
  );

  it('makes a player-character combatant dying, not dead, when the clamp reaches zero', () => {
    const { db, ctx, registry } = setup();
    const combatantId = startCombatant(ctx, registry);
    expect(
      registry.invoke(
        'update_combatant',
        { combatantId, deathRules: 'player-character', hpDelta: 0 },
        ctx,
      ).ok,
    ).toBe(true);
    db.prepare(
      'UPDATE encounter_combatant SET hp_max=1, hp_current=1 WHERE combatant_id=?',
    ).run(combatantId);
    expect(
      registry.invoke('adjust_exhaustion', { delta: 4, combatantId }, ctx),
    ).toMatchObject({ ok: true, data: { hpMax: 0, hpCurrent: 0 } });
    expect(
      db
        .prepare(
          'SELECT status, hp_current FROM encounter_combatant WHERE combatant_id=?',
        )
        .get(combatantId),
    ).toEqual({ status: 'dying', hp_current: 0 });
    db.close();
  });
});
