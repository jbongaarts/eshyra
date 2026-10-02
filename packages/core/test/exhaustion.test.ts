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
