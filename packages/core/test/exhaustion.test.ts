import { describe, expect, it } from 'vitest';
import type { ToolContext } from '../src/internal.js';
import {
  attuneItem,
  createDefaultToolRegistry,
  createSeededRng,
  getConcentrationEffect,
  giveItem,
  listAttunements,
  listCombatants,
} from '../src/internal.js';
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
    registry.invoke('adjust_exhaustion', { delta: 5 }, ctx);
    const result = registry.invoke('adjust_exhaustion', { delta: 4 }, ctx);
    expect(result).toMatchObject({
      ok: true,
      data: { previousLevel: 5, newLevel: 6, died: true },
    });
    expect(
      db.prepare("SELECT life_state FROM character WHERE id='pc-1'").get(),
    ).toEqual({ life_state: 'dead' });
    expect(
      getConcentrationEffect(db, DEFAULT_TEST_CAMPAIGN_ID, {
        kind: 'character',
        ref: 'pc-1',
      }),
    ).toBeUndefined();
    expect(listAttunements(db, DEFAULT_TEST_CAMPAIGN_ID, 'pc-1')).toEqual([]);
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
