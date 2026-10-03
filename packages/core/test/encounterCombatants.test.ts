import { describe, expect, it } from 'vitest';
import { closeSession, startSession } from '../src/index.js';
import type { AdventureModule, ToolContext } from '../src/internal.js';
import {
  advanceWorldTime,
  assembleContext,
  closeCombatInstance,
  createDefaultToolRegistry,
  createSeededRng,
  getCampaignActor,
  listCombatants,
  listCombatantsForInstance,
  renderContextMessage,
  startAdventureRun,
  startEncounter,
  updateCombatant,
  upsertCampaignActor,
} from '../src/internal.js';
import { deriveTraceFields } from '../src/orchestrator/turnTraceProjection.js';
import { ensureCampaignActorFromCombatant } from '../src/state/encounterCombatants.js';
import { makeTestAdventureModule } from './support/adventureModuleFixture.js';
import {
  DEFAULT_TEST_CAMPAIGN_ID,
  DEFAULT_TEST_CAMPAIGN_POSITION,
  DEFAULT_TEST_SESSION_ID,
  freshDbWithSession,
} from './support/db.js';

const NOW = '2026-05-20T10:05:00.000Z';

function goblinModule(): AdventureModule {
  const module = makeTestAdventureModule();
  return {
    ...module,
    encounters: [
      {
        id: 'enc-goblins',
        name: 'Goblin Ambush',
        description: 'Two goblins spring from the brush.',
        creatures: [
          { rulesRef: 'creature:goblin', count: 2, role: 'ambusher' },
        ],
        locationId: 'loc-cellar',
        reward: 'A few bent copper coins.',
      },
      {
        id: 'enc-road',
        name: 'Road Reinforcements',
        description: 'More goblins block the old road.',
        creatures: [{ rulesRef: 'creature:goblin', count: 1, role: 'guard' }],
        locationId: 'loc-road',
        reward: 'A cracked horn.',
      },
    ],
    scenes: module.scenes.map((scene) =>
      scene.id === 'scene-cellar'
        ? { ...scene, encounterIds: ['enc-goblins', 'enc-road'] }
        : scene,
    ),
  };
}

function setup() {
  const db = freshDbWithSession();
  const module = goblinModule();
  startAdventureRun(db, {
    campaignId: DEFAULT_TEST_CAMPAIGN_ID,
    runId: 'run-goblins',
    moduleId: module.id,
    provenance: 'test',
    sessionId: DEFAULT_TEST_SESSION_ID,
    updatedAt: NOW,
  });
  const registry = createDefaultToolRegistry();
  const ctx: ToolContext = {
    db,
    rng: createSeededRng(7),
    campaignId: DEFAULT_TEST_CAMPAIGN_ID,
    sessionId: DEFAULT_TEST_SESSION_ID,
    turnId: 'turn-1',
    at: NOW,
    resolveAdventureModule: (moduleId) =>
      moduleId === module.id ? module : undefined,
  };
  return { db, module, registry, ctx };
}

describe('encounter combatants', () => {
  it('clamps model supplied actor HP to the condition-adjusted maximum on admission', () => {
    const { db } = setup();
    const started = startEncounter(db, {
      campaignId: DEFAULT_TEST_CAMPAIGN_ID,
      actors: [
        {
          actorId: 'admitted-odd',
          rulesRef: 'creature:goblin',
          hpMax: 19,
          hpCurrent: 19,
          conditions: [{ id: 'exhaustion', level: 4 }],
        },
      ],
      provenance: 'test',
      sessionId: DEFAULT_TEST_SESSION_ID,
      at: NOW,
    });
    expect(started.combatants[0]).toMatchObject({ hpCurrent: 9, hpMax: 19 });
    expect(
      getCampaignActor(db, DEFAULT_TEST_CAMPAIGN_ID, 'admitted-odd'),
    ).toMatchObject({ hpCurrent: 9, hpMax: 19 });
    db.close();
  });

  it.each([
    ['z-last-lexically', 'a-first-lexically'],
    ['a-first-lexically', 'z-last-lexically'],
    ['custom:latest', 'custom/older'],
  ])(
    'uses insertion order for equal timestamps (%s then %s)',
    (firstId, secondId) => {
      const { db } = setup();
      let started = startEncounter(db, {
        campaignId: DEFAULT_TEST_CAMPAIGN_ID,
        combatInstanceId: firstId,
        actors: [
          {
            actorId: 'projection-owner',
            rulesRef: 'creature:goblin',
            hpCurrent: 20,
            hpMax: 20,
          },
        ],
        provenance: 'test',
        sessionId: DEFAULT_TEST_SESSION_ID,
        at: NOW,
      });
      closeCombatInstance(db, {
        campaignId: DEFAULT_TEST_CAMPAIGN_ID,
        status: 'completed',
        provenance: 'test',
        sessionId: DEFAULT_TEST_SESSION_ID,
        at: NOW,
      });
      started = startEncounter(db, {
        campaignId: DEFAULT_TEST_CAMPAIGN_ID,
        combatInstanceId: secondId,
        actors: [{ actorId: 'projection-owner', rulesRef: 'creature:goblin' }],
        provenance: 'test',
        sessionId: DEFAULT_TEST_SESSION_ID,
        at: NOW,
      });
      const current = started.combatants[0];
      expect(current?.combatInstanceId).toBe(secondId);
      if (!current) throw new Error('current projection missing');
      updateCombatant(db, {
        campaignId: DEFAULT_TEST_CAMPAIGN_ID,
        combatantId: current.combatantId,
        hpDelta: -3,
        provenance: 'test',
        sessionId: DEFAULT_TEST_SESSION_ID,
        at: NOW,
      });
      expect(
        getCampaignActor(db, DEFAULT_TEST_CAMPAIGN_ID, 'projection-owner'),
      ).toMatchObject({ hpCurrent: 17 });
      db.close();
    },
  );

  it('transfers pending hydra regrowth facts and syncs settlement without healing', () => {
    const { db, registry, ctx } = setup();
    let started = startEncounter(db, {
      campaignId: DEFAULT_TEST_CAMPAIGN_ID,
      combatInstanceId: 'hydra-one',
      actors: [
        {
          actorId: 'persistent-hydra',
          rulesRef: 'creature:hydra',
          hpCurrent: 172,
          hpMax: 172,
        },
      ],
      provenance: 'test',
      sessionId: DEFAULT_TEST_SESSION_ID,
      at: NOW,
    });
    let hydra = started.combatants[0];
    if (!hydra) throw new Error('first hydra missing');
    updateCombatant(db, {
      campaignId: DEFAULT_TEST_CAMPAIGN_ID,
      combatantId: hydra.combatantId,
      hpDelta: -25,
      provenance: 'test',
      sessionId: DEFAULT_TEST_SESSION_ID,
      at: NOW,
    });
    closeCombatInstance(db, {
      campaignId: DEFAULT_TEST_CAMPAIGN_ID,
      status: 'completed',
      provenance: 'test',
      sessionId: DEFAULT_TEST_SESSION_ID,
      at: NOW,
    });
    started = startEncounter(db, {
      campaignId: DEFAULT_TEST_CAMPAIGN_ID,
      combatInstanceId: 'hydra-two',
      actors: [{ actorId: 'persistent-hydra', rulesRef: 'creature:hydra' }],
      provenance: 'test',
      sessionId: DEFAULT_TEST_SESSION_ID,
      at: NOW,
    });
    hydra = started.combatants[0] as NonNullable<typeof hydra>;
    expect(hydra).toMatchObject({ headCount: 4, hpCurrent: 147 });
    expect(
      db
        .prepare(`SELECT heads_died_since_own_turn,fire_damage_since_own_turn
      FROM encounter_combatant WHERE combatant_id=?`)
        .get(hydra.combatantId),
    ).toEqual({
      heads_died_since_own_turn: 1,
      fire_damage_since_own_turn: 0,
    });
    registry.invoke(
      'update_combatant',
      {
        combatantId: hydra.combatantId,
        deathRules: 'player-character',
        hpDelta: 0,
      },
      ctx,
    );
    registry.invoke(
      'set_suffocation',
      { combatantId: hydra.combatantId, event: 'drop' },
      ctx,
    );
    registry.invoke('begin_turn', { combatantId: hydra.combatantId }, ctx);
    const settled = registry.invoke(
      'begin_turn',
      { combatantId: hydra.combatantId },
      ctx,
    );
    expect(settled.ok).toBe(true);
    expect(
      getCampaignActor(db, DEFAULT_TEST_CAMPAIGN_ID, 'persistent-hydra')?.state
        .combatLifecycle,
    ).toMatchObject({
      headCount: 6,
      headsDiedSinceOwnTurn: 0,
      fireDamageSinceOwnTurn: 0,
      recoveryBlock: 'suffocating',
    });
    expect(listCombatants(db, DEFAULT_TEST_CAMPAIGN_ID)[0]).toMatchObject({
      headCount: 6,
      hpCurrent: 0,
      status: 'dying',
      recoveryBlock: 'suffocating',
    });
    db.close();
  });

  it('opts a combatant into player-character death saves through the tools', () => {
    const { db, registry, ctx } = setup();
    registry.invoke('start_encounter', { encounterId: 'enc-goblins' }, ctx);
    const target = listCombatants(db, DEFAULT_TEST_CAMPAIGN_ID)[0];
    expect(target).toBeDefined();
    if (!target) throw new Error('encounter did not create a combatant');
    const dropped = registry.invoke(
      'update_combatant',
      {
        combatantId: target.combatantId,
        deathRules: 'player-character',
        hpDelta: -target.hpCurrent,
      },
      ctx,
    );
    expect(dropped.ok).toBe(true);
    expect(listCombatants(db, DEFAULT_TEST_CAMPAIGN_ID)[0]).toMatchObject({
      status: 'dying',
      deathRules: 'player-character',
      deathSaveSuccesses: 0,
      deathSaveFailures: 0,
    });
    const save = registry.invoke(
      'record_death_save',
      {
        combatantId: target.combatantId,
        roll: 1,
      },
      ctx,
    );
    expect(save.ok).toBe(true);
    expect(listCombatants(db, DEFAULT_TEST_CAMPAIGN_ID)[0]).toMatchObject({
      status: 'dying',
      deathSaveFailures: 2,
    });
    db.close();
  });

  it('starts module creatures as anonymous combatants with instance-scoped ids', () => {
    const { db, registry, ctx } = setup();

    const result = registry.invoke(
      'start_encounter',
      { encounterId: 'enc-goblins' },
      ctx,
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data).toMatchObject({
        started: true,
        combatInstance: {
          combatInstanceId: 'ci-enc-goblins-1',
          sourceEncounterId: 'enc-goblins',
          status: 'active',
        },
      });
    }
    const combatants = listCombatants(db, DEFAULT_TEST_CAMPAIGN_ID);
    expect(combatants.map((c) => c.combatantId)).toEqual([
      'ci-enc-goblins-1-goblin-1',
      'ci-enc-goblins-1-goblin-2',
    ]);
    expect(combatants[0]).toMatchObject({
      combatInstanceId: 'ci-enc-goblins-1',
      identityKind: 'encounter_instance',
      identityRef: undefined,
      displayLabel: 'Goblin 1',
      rulesRef: 'creature:goblin',
      side: 'enemy',
      faction: 'ambusher',
      hpCurrent: 7,
      hpMax: 7,
      ac: 15,
      status: 'alive',
      locationId: 'loc-cellar',
    });
    db.close();
  });

  it('updates one current goblin while the other remains active', () => {
    const { db, registry, ctx } = setup();
    registry.invoke('start_encounter', { encounterId: 'enc-goblins' }, ctx);

    const damaged = registry.invoke(
      'update_combatant',
      { combatantId: 'ci-enc-goblins-1-goblin-1', hpDelta: -3 },
      ctx,
    );
    expect(damaged.ok).toBe(true);
    let combatants = listCombatants(db, DEFAULT_TEST_CAMPAIGN_ID);
    expect(
      combatants.find((c) => c.combatantId === 'ci-enc-goblins-1-goblin-1'),
    ).toMatchObject({ hpCurrent: 4, status: 'alive' });
    expect(
      combatants.find((c) => c.combatantId === 'ci-enc-goblins-1-goblin-2'),
    ).toMatchObject({ hpCurrent: 7, status: 'alive' });

    const killed = registry.invoke(
      'update_combatant',
      {
        combatantId: 'ci-enc-goblins-1-goblin-1',
        hpDelta: -10,
        addCondition: { id: 'dead' },
      },
      ctx,
    );
    expect(killed.ok).toBe(true);
    combatants = listCombatants(db, DEFAULT_TEST_CAMPAIGN_ID);
    expect(
      combatants.find((c) => c.combatantId === 'ci-enc-goblins-1-goblin-1'),
    ).toMatchObject({
      hpCurrent: 0,
      status: 'dead',
      conditions: [{ id: 'dead' }],
    });
    expect(
      combatants.find((c) => c.combatantId === 'ci-enc-goblins-1-goblin-2'),
    ).toMatchObject({ hpCurrent: 7, status: 'alive' });
    db.close();
  });

  it('enforces one active combat instance and never reactivates closed instances', () => {
    const { db, ctx } = setup();
    startEncounter(db, {
      campaignId: DEFAULT_TEST_CAMPAIGN_ID,
      encounterId: 'enc-goblins',
      resolveAdventureModule: ctx.resolveAdventureModule,
      provenance: 'test',
      sessionId: DEFAULT_TEST_SESSION_ID,
      at: NOW,
    });

    expect(() =>
      startEncounter(db, {
        campaignId: DEFAULT_TEST_CAMPAIGN_ID,
        encounterId: 'enc-road',
        resolveAdventureModule: ctx.resolveAdventureModule,
        provenance: 'test',
        sessionId: DEFAULT_TEST_SESSION_ID,
        at: NOW,
      }),
    ).toThrow(/already active/);

    const closed = closeCombatInstance(db, {
      campaignId: DEFAULT_TEST_CAMPAIGN_ID,
      status: 'interrupted',
      provenance: 'test',
      sessionId: DEFAULT_TEST_SESSION_ID,
      at: NOW,
    });
    expect(closed.status).toBe('interrupted');
    expect(() =>
      closeCombatInstance(db, {
        campaignId: DEFAULT_TEST_CAMPAIGN_ID,
        combatInstanceId: closed.combatInstanceId,
        status: 'completed',
        provenance: 'test',
        sessionId: DEFAULT_TEST_SESSION_ID,
        at: NOW,
      }),
    ).toThrow(/cannot be reactivated or closed again/);

    const next = startEncounter(db, {
      campaignId: DEFAULT_TEST_CAMPAIGN_ID,
      encounterId: 'enc-road',
      resolveAdventureModule: ctx.resolveAdventureModule,
      provenance: 'test',
      sessionId: DEFAULT_TEST_SESSION_ID,
      at: NOW,
    });
    expect(next.combatInstance.combatInstanceId).toBe('ci-enc-road-1');
    db.close();
  });

  it('keeps active combat campaign-scoped across quit and resumed sessions', () => {
    const { db, module, ctx } = setup();
    startEncounter(db, {
      campaignId: DEFAULT_TEST_CAMPAIGN_ID,
      encounterId: 'enc-goblins',
      resolveAdventureModule: ctx.resolveAdventureModule,
      provenance: 'test:session-a',
      sessionId: DEFAULT_TEST_SESSION_ID,
      at: NOW,
    });
    closeSession(db, {
      campaignId: DEFAULT_TEST_CAMPAIGN_ID,
      sessionId: DEFAULT_TEST_SESSION_ID,
      closedAt: '2026-05-20T10:10:00.000Z',
    });
    const sessionB = 'session-2';
    startSession(db, {
      campaignId: DEFAULT_TEST_CAMPAIGN_ID,
      sessionId: sessionB,
      startedAt: '2026-05-20T10:15:00.000Z',
    });

    expect(() =>
      startEncounter(db, {
        campaignId: DEFAULT_TEST_CAMPAIGN_ID,
        encounterId: 'enc-road',
        resolveAdventureModule: ctx.resolveAdventureModule,
        provenance: 'test:session-b',
        sessionId: sessionB,
        at: '2026-05-20T10:16:00.000Z',
      }),
    ).toThrow(/already active/);

    const assembled = assembleContext({
      db,
      campaignId: DEFAULT_TEST_CAMPAIGN_ID,
      campaignPosition: DEFAULT_TEST_CAMPAIGN_POSITION,
      sessionId: sessionB,
      playerInput: 'I resume the fight.',
      resolveAdventureModule: (moduleId) =>
        moduleId === module.id ? module : undefined,
    });
    const prompt = renderContextMessage(assembled);
    expect(prompt).toContain('Active combatants:');
    expect(prompt).toContain('ci-enc-goblins-1-goblin-1: Goblin 1 [alive]');

    const closed = closeCombatInstance(db, {
      campaignId: DEFAULT_TEST_CAMPAIGN_ID,
      status: 'interrupted',
      provenance: 'test:session-b',
      sessionId: sessionB,
      at: '2026-05-20T10:17:00.000Z',
    });
    expect(closed).toMatchObject({
      combatInstanceId: 'ci-enc-goblins-1',
      status: 'interrupted',
      sessionId: sessionB,
      updatedAt: '2026-05-20T10:17:00.000Z',
      closedAt: '2026-05-20T10:17:00.000Z',
    });

    const next = startEncounter(db, {
      campaignId: DEFAULT_TEST_CAMPAIGN_ID,
      encounterId: 'enc-road',
      resolveAdventureModule: ctx.resolveAdventureModule,
      provenance: 'test:session-b',
      sessionId: sessionB,
      at: '2026-05-20T10:18:00.000Z',
    });
    expect(next.combatInstance).toMatchObject({
      combatInstanceId: 'ci-enc-road-1',
      sessionId: sessionB,
      status: 'active',
    });
    db.close();
  });

  it('allows returning to the same module encounter as a new non-colliding combat instance', () => {
    const { db, ctx } = setup();
    const first = startEncounter(db, {
      campaignId: DEFAULT_TEST_CAMPAIGN_ID,
      encounterId: 'enc-goblins',
      resolveAdventureModule: ctx.resolveAdventureModule,
      provenance: 'test',
      sessionId: DEFAULT_TEST_SESSION_ID,
      at: NOW,
    });
    closeCombatInstance(db, {
      campaignId: DEFAULT_TEST_CAMPAIGN_ID,
      status: 'completed',
      provenance: 'test',
      sessionId: DEFAULT_TEST_SESSION_ID,
      at: NOW,
    });
    const second = startEncounter(db, {
      campaignId: DEFAULT_TEST_CAMPAIGN_ID,
      encounterId: 'enc-goblins',
      resolveAdventureModule: ctx.resolveAdventureModule,
      provenance: 'test',
      sessionId: DEFAULT_TEST_SESSION_ID,
      at: NOW,
    });

    expect(first.combatants.map((c) => c.combatantId)).toEqual([
      'ci-enc-goblins-1-goblin-1',
      'ci-enc-goblins-1-goblin-2',
    ]);
    expect(second.combatants.map((c) => c.combatantId)).toEqual([
      'ci-enc-goblins-2-goblin-1',
      'ci-enc-goblins-2-goblin-2',
    ]);

    expect(() =>
      updateCombatant(db, {
        campaignId: DEFAULT_TEST_CAMPAIGN_ID,
        combatantId: 'ci-enc-goblins-1-goblin-1',
        hpDelta: -1,
        provenance: 'test',
        sessionId: DEFAULT_TEST_SESSION_ID,
        at: NOW,
      }),
    ).toThrow(/inactive combat instance/);
    updateCombatant(db, {
      campaignId: DEFAULT_TEST_CAMPAIGN_ID,
      combatantId: 'ci-enc-goblins-2-goblin-1',
      hpDelta: -2,
      provenance: 'test',
      sessionId: DEFAULT_TEST_SESSION_ID,
      at: NOW,
    });
    expect(
      listCombatantsForInstance(
        db,
        DEFAULT_TEST_CAMPAIGN_ID,
        'ci-enc-goblins-1',
      )[0]?.hpCurrent,
    ).toBe(7);
    expect(
      listCombatantsForInstance(
        db,
        DEFAULT_TEST_CAMPAIGN_ID,
        'ci-enc-goblins-2',
      )[0]?.hpCurrent,
    ).toBe(5);
    db.close();
  });

  it('normalizes encounter and creature refs with repeated separators', () => {
    const db = freshDbWithSession();
    const module = makeTestAdventureModule();
    const encounterId = `scene:${'-'.repeat(64)}ambush${'/'.repeat(64)}vault`;
    const rulesRef = `creature:${'-'.repeat(64)}goblin${'/'.repeat(64)}boss`;
    const encounterModule: AdventureModule = {
      ...module,
      encounters: [
        {
          id: encounterId,
          name: 'Separator Ambush',
          description: 'A combat id normalization regression fixture.',
          creatures: [{ rulesRef, count: 1 }],
        },
      ],
    };
    startAdventureRun(db, {
      campaignId: DEFAULT_TEST_CAMPAIGN_ID,
      runId: 'run-separators',
      moduleId: encounterModule.id,
      provenance: 'test',
      sessionId: DEFAULT_TEST_SESSION_ID,
      updatedAt: NOW,
    });

    const result = startEncounter(db, {
      campaignId: DEFAULT_TEST_CAMPAIGN_ID,
      encounterId,
      resolveAdventureModule: (moduleId) =>
        moduleId === encounterModule.id ? encounterModule : undefined,
      provenance: 'test',
      sessionId: DEFAULT_TEST_SESSION_ID,
      at: NOW,
    });

    expect(result.combatInstance.combatInstanceId).toBe('ci-ambush-vault-1');
    expect(result.combatants.map((c) => c.combatantId)).toEqual([
      'ci-ambush-vault-1-goblin-boss-1',
    ]);
    db.close();
  });

  it('rejects invalid target labels and suggests current campaign-unique ids', () => {
    const { db, registry, ctx } = setup();
    registry.invoke('start_encounter', { encounterId: 'enc-goblins' }, ctx);

    const result = registry.invoke(
      'update_combatant',
      { combatantId: 'near goblin', hpDelta: -7 },
      ctx,
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('invalid_target');
      expect(result.message).toContain("unknown combatant 'near goblin'");
      expect(result.message).toContain(
        'Valid active combatant ids: ci-enc-goblins-1-goblin-1, ci-enc-goblins-1-goblin-2.',
      );
    }
    db.close();
  });

  it('renders active combatants and persistent identity without stale inactive overlays', () => {
    const { db, module, ctx } = setup();
    startEncounter(db, {
      campaignId: DEFAULT_TEST_CAMPAIGN_ID,
      encounterId: 'enc-goblins',
      actors: [
        {
          actorId: 'actor:grik',
          displayName: 'Grik',
          rulesRef: 'creature:goblin',
          hpCurrent: 12,
          hpMax: 12,
          status: 'alive',
        },
      ],
      resolveAdventureModule: ctx.resolveAdventureModule,
      provenance: 'test',
      sessionId: DEFAULT_TEST_SESSION_ID,
      at: NOW,
    });
    updateCombatant(db, {
      campaignId: DEFAULT_TEST_CAMPAIGN_ID,
      combatantId: 'ci-enc-goblins-1-grik',
      status: 'escaped',
      provenance: 'test',
      sessionId: DEFAULT_TEST_SESSION_ID,
      at: NOW,
    });
    closeCombatInstance(db, {
      campaignId: DEFAULT_TEST_CAMPAIGN_ID,
      status: 'fled',
      provenance: 'test',
      sessionId: DEFAULT_TEST_SESSION_ID,
      at: NOW,
    });
    startEncounter(db, {
      campaignId: DEFAULT_TEST_CAMPAIGN_ID,
      encounterId: 'enc-road',
      actors: [{ actorId: 'actor:grik', rulesRef: 'creature:goblin' }],
      resolveAdventureModule: ctx.resolveAdventureModule,
      provenance: 'test',
      sessionId: DEFAULT_TEST_SESSION_ID,
      at: NOW,
    });
    updateCombatant(db, {
      campaignId: DEFAULT_TEST_CAMPAIGN_ID,
      combatantId: 'ci-enc-road-1-grik',
      hpDelta: -5,
      provenance: 'test',
      sessionId: DEFAULT_TEST_SESSION_ID,
      at: NOW,
    });

    const assembled = assembleContext({
      db,
      campaignId: DEFAULT_TEST_CAMPAIGN_ID,
      campaignPosition: DEFAULT_TEST_CAMPAIGN_POSITION,
      sessionId: DEFAULT_TEST_SESSION_ID,
      playerInput: 'I face Grik again.',
      resolveAdventureModule: (moduleId) =>
        moduleId === module.id ? module : undefined,
    });
    const prompt = renderContextMessage(assembled);

    expect(prompt).toContain('Active combatants:');
    expect(prompt).toContain(
      'ci-enc-road-1-grik: Grik [alive], enemy, HP 7/12',
    );
    expect(prompt).toContain('identity: actor:grik');
    expect(prompt).toContain('Persistent actors:');
    expect(prompt).toContain('actor:grik: Grik [alive], creature');
    expect(prompt).not.toContain('ci-enc-goblins-1-grik: Grik');
    expect(prompt).not.toContain('HP 12/12, combat: ci-enc-goblins-1');
    db.close();
  });

  it('persists recurring actor HP across Grik fleeing and reappearing at old locations', () => {
    const { db, ctx } = setup();
    startEncounter(db, {
      campaignId: DEFAULT_TEST_CAMPAIGN_ID,
      encounterId: 'enc-goblins',
      actors: [
        {
          actorId: 'actor:grik',
          displayName: 'Grik',
          rulesRef: 'creature:goblin',
          hpCurrent: 12,
          hpMax: 12,
        },
      ],
      resolveAdventureModule: ctx.resolveAdventureModule,
      provenance: 'test',
      sessionId: DEFAULT_TEST_SESSION_ID,
      at: NOW,
    });
    updateCombatant(db, {
      campaignId: DEFAULT_TEST_CAMPAIGN_ID,
      combatantId: 'ci-enc-goblins-1-grik',
      status: 'escaped',
      provenance: 'test',
      sessionId: DEFAULT_TEST_SESSION_ID,
      at: NOW,
    });
    closeCombatInstance(db, {
      campaignId: DEFAULT_TEST_CAMPAIGN_ID,
      status: 'fled',
      provenance: 'test',
      sessionId: DEFAULT_TEST_SESSION_ID,
      at: NOW,
    });

    const road = startEncounter(db, {
      campaignId: DEFAULT_TEST_CAMPAIGN_ID,
      encounterId: 'enc-road',
      actors: [{ actorId: 'actor:grik', rulesRef: 'creature:goblin' }],
      resolveAdventureModule: ctx.resolveAdventureModule,
      provenance: 'test',
      sessionId: DEFAULT_TEST_SESSION_ID,
      at: NOW,
    });
    expect(
      road.combatants.find((c) => c.identityRef === 'actor:grik'),
    ).toMatchObject({ hpCurrent: 12, status: 'alive' });
    updateCombatant(db, {
      campaignId: DEFAULT_TEST_CAMPAIGN_ID,
      combatantId: 'ci-enc-road-1-grik',
      hpDelta: -5,
      provenance: 'test',
      sessionId: DEFAULT_TEST_SESSION_ID,
      at: NOW,
    });
    closeCombatInstance(db, {
      campaignId: DEFAULT_TEST_CAMPAIGN_ID,
      status: 'interrupted',
      provenance: 'test',
      sessionId: DEFAULT_TEST_SESSION_ID,
      at: NOW,
    });

    const returned = startEncounter(db, {
      campaignId: DEFAULT_TEST_CAMPAIGN_ID,
      encounterId: 'enc-goblins',
      actors: [{ actorId: 'actor:grik', rulesRef: 'creature:goblin' }],
      resolveAdventureModule: ctx.resolveAdventureModule,
      provenance: 'test',
      sessionId: DEFAULT_TEST_SESSION_ID,
      at: NOW,
    });
    expect(returned.combatInstance.combatInstanceId).toBe('ci-enc-goblins-2');
    expect(
      returned.combatants.find((c) => c.identityRef === 'actor:grik'),
    ).toMatchObject({ hpCurrent: 7, hpMax: 12, status: 'alive' });
    expect(
      getCampaignActor(db, DEFAULT_TEST_CAMPAIGN_ID, 'actor:grik'),
    ).toMatchObject({ hpCurrent: 7, hpMax: 12, status: 'alive' });
    db.close();
  });

  it('initializes altered actors from structured actor state while retaining rules ref', () => {
    const { db } = setup();
    upsertCampaignActor(db, {
      campaignId: DEFAULT_TEST_CAMPAIGN_ID,
      actorId: 'actor:injured-red-dragon',
      displayName: 'Injured Red Dragon',
      actorKind: 'monster',
      sourceKind: 'campaign_created',
      rulesRef: 'creature:red-dragon',
      hpCurrent: 80,
      hpMax: 200,
      conditions: [{ id: 'injured-wing' }],
      status: 'alive',
      currentLocationId: 'loc-cavern',
      provenance: 'test',
      sessionId: DEFAULT_TEST_SESSION_ID,
      at: NOW,
    });

    const started = startEncounter(db, {
      campaignId: DEFAULT_TEST_CAMPAIGN_ID,
      actors: [
        {
          actorId: 'actor:injured-red-dragon',
          rulesRef: 'creature:red-dragon',
          side: 'enemy',
        },
      ],
      provenance: 'test',
      sessionId: DEFAULT_TEST_SESSION_ID,
      at: NOW,
    });

    expect(started.combatants).toHaveLength(1);
    expect(started.combatants[0]).toMatchObject({
      combatantId: 'ci-combat-1-injured-red-dragon',
      identityKind: 'campaign_actor',
      identityRef: 'actor:injured-red-dragon',
      hpCurrent: 80,
      hpMax: 200,
      conditions: [{ id: 'injured-wing' }],
      rulesRef: 'creature:red-dragon',
    });
    db.close();
  });

  it('keeps a named NPC identity and structured damage across combats', () => {
    const { db } = setup();
    let started = startEncounter(db, {
      campaignId: DEFAULT_TEST_CAMPAIGN_ID,
      actors: [
        {
          actorId: 'npc:warden-sela',
          displayName: 'Warden Sela',
          actorKind: 'npc',
          sourceKind: 'module_npc',
          sourceRef: 'npc:sela',
          rulesRef: 'creature:goblin',
          hpCurrent: 18,
          hpMax: 18,
          side: 'ally',
        },
      ],
      provenance: 'test',
      sessionId: DEFAULT_TEST_SESSION_ID,
      at: NOW,
    });
    expect(started.combatants[0]).toMatchObject({
      identityKind: 'campaign_actor',
      identityRef: 'npc:warden-sela',
      side: 'ally',
    });
    updateCombatant(db, {
      campaignId: DEFAULT_TEST_CAMPAIGN_ID,
      combatantId: 'ci-combat-1-warden-sela',
      hpDelta: -4,
      provenance: 'test',
      sessionId: DEFAULT_TEST_SESSION_ID,
      at: NOW,
    });
    closeCombatInstance(db, {
      campaignId: DEFAULT_TEST_CAMPAIGN_ID,
      status: 'completed',
      provenance: 'test',
      sessionId: DEFAULT_TEST_SESSION_ID,
      at: NOW,
    });
    started = startEncounter(db, {
      campaignId: DEFAULT_TEST_CAMPAIGN_ID,
      actors: [{ actorId: 'npc:warden-sela', rulesRef: 'creature:goblin' }],
      provenance: 'test',
      sessionId: DEFAULT_TEST_SESSION_ID,
      at: NOW,
    });

    expect(
      getCampaignActor(db, DEFAULT_TEST_CAMPAIGN_ID, 'npc:warden-sela'),
    ).toMatchObject({ hpCurrent: 14, hpMax: 18, actorKind: 'npc' });
    expect(started.combatants[0]).toMatchObject({
      combatantId: 'ci-combat-2-warden-sela',
      hpCurrent: 14,
      hpMax: 18,
      identityRef: 'npc:warden-sela',
    });
    db.close();
  });

  it('includes combatant state tool changes in accepted trace deltas', () => {
    const fields = deriveTraceFields(
      [
        {
          tool: 'start_encounter',
          args: { encounterId: 'enc-goblins' },
          result: { ok: true, data: { started: true } },
          mutates: true,
          source: 'native',
        },
        {
          tool: 'update_combatant',
          args: { combatantId: 'ci-enc-goblins-1-goblin-1', hpDelta: -7 },
          result: {
            ok: true,
            data: { combatantId: 'ci-enc-goblins-1-goblin-1' },
          },
          mutates: true,
          source: 'native',
        },
        {
          tool: 'close_combat_instance',
          args: { status: 'completed' },
          result: { ok: true, data: { combatInstanceId: 'ci-enc-goblins-1' } },
          mutates: true,
          source: 'native',
        },
      ],
      [],
    );

    expect(fields.acceptedStateDelta).toHaveLength(3);
    expect(fields.acceptedStateDelta).toEqual([
      { encounterId: 'enc-goblins' },
      { combatantId: 'ci-enc-goblins-1-goblin-1', hpDelta: -7 },
      { status: 'completed' },
    ]);
  });
});

describe('player-character death rules for combatants (eshyra-o9bd.19.5.7.5)', () => {
  it('promotes a combatant with its complete lifecycle into a durable actor and reprojects it', () => {
    const { db, registry, ctx } = setup();
    expect(
      registry.invoke(
        'start_encounter',
        {
          combatInstanceId: 'promotion-life',
          actors: [
            {
              actorId: 'source',
              rulesRef: 'creature:goblin',
              hpMax: 7,
              hpCurrent: 7,
            },
          ],
        },
        ctx,
      ).ok,
    ).toBe(true);
    const combatantId = 'promotion-life-source';
    expect(
      registry.invoke(
        'update_combatant',
        { combatantId, deathRules: 'player-character' },
        ctx,
      ).ok,
    ).toBe(true);
    expect(
      registry.invoke('update_combatant', { combatantId, hpDelta: -7 }, ctx).ok,
    ).toBe(true);
    expect(
      registry.invoke('set_suffocation', { combatantId, event: 'drop' }, ctx)
        .ok,
    ).toBe(true);
    const promoted = ensureCampaignActorFromCombatant(db, {
      campaignId: ctx.campaignId,
      combatantId,
      actorId: 'durable-promotion',
      provenance: 'test',
      sessionId: ctx.sessionId,
      at: ctx.at,
    });
    expect(promoted.state.combatLifecycle).toMatchObject({
      deathRules: 'player-character',
      deathSaveSuccesses: 0,
      deathSaveFailures: 0,
      recoveryBlock: 'suffocating',
    });
    expect(
      registry.invoke(
        'close_combat_instance',
        { combatInstanceId: 'promotion-life', status: 'completed' },
        ctx,
      ).ok,
    ).toBe(true);
    expect(
      registry.invoke(
        'start_encounter',
        {
          combatInstanceId: 'promotion-reopen',
          actors: [
            { actorId: 'durable-promotion', rulesRef: 'creature:goblin' },
          ],
        },
        ctx,
      ).ok,
    ).toBe(true);
    const projected = db
      .prepare(
        'SELECT status,death_rules,recovery_block,hp_current FROM encounter_combatant WHERE combat_instance_id=?',
      )
      .get('promotion-reopen') as {
      status: string;
      death_rules: string;
      recovery_block: string;
      hp_current: number;
    };
    expect(projected).toEqual({
      status: 'dying',
      death_rules: 'player-character',
      recovery_block: 'suffocating',
      hp_current: 0,
    });
    db.close();
  });

  // rule:monsters-and-death lets the GM run a creature under the character
  // death rules; the engine then owns dying, death saves, and stabilizing.
  function optedIn() {
    const harness = setup();
    harness.registry.invoke(
      'start_encounter',
      { encounterId: 'enc-goblins' },
      harness.ctx,
    );
    const target = listCombatants(harness.db, DEFAULT_TEST_CAMPAIGN_ID)[0];
    if (!target) throw new Error('encounter did not create a combatant');
    const id = target.combatantId;
    const update = (args: Record<string, unknown>) =>
      harness.registry.invoke(
        'update_combatant',
        { combatantId: id, ...args },
        harness.ctx,
      );
    const read = () =>
      listCombatants(harness.db, DEFAULT_TEST_CAMPAIGN_ID).find(
        (c) => c.combatantId === id,
      );
    expect(update({ deathRules: 'player-character', hpDelta: 0 }).ok).toBe(
      true,
    );
    return { ...harness, id, hpMax: target.hpMax, update, read };
  }
  const advance = (db: ReturnType<typeof setup>['db'], minutes: number) =>
    advanceWorldTime(db, {
      campaignId: DEFAULT_TEST_CAMPAIGN_ID,
      minutes,
      provenance: 'test',
      sessionId: DEFAULT_TEST_SESSION_ID,
      at: NOW,
    });

  it('dies outright when the overflow reaches the hit point maximum', () => {
    const { db, update, read, hpMax } = optedIn();
    expect(update({ hpDelta: -(hpMax * 2) }).ok).toBe(true);
    expect(read()).toMatchObject({ status: 'dead', hpCurrent: 0 });
    db.close();
  });

  it('revives ordinary monster-rules death by healing but preserves terminal death causes', () => {
    const { db, registry, ctx } = setup();
    expect(
      registry.invoke('start_encounter', { encounterId: 'enc-goblins' }, ctx)
        .ok,
    ).toBe(true);
    const combatants = listCombatants(db, DEFAULT_TEST_CAMPAIGN_ID);
    const ordinary = combatants[0];
    const terminal = combatants[1];
    if (!ordinary || !terminal) throw new Error('goblin encounter is incomplete');

    expect(
      registry.invoke(
        'update_combatant',
        { combatantId: ordinary.combatantId, hpDelta: -ordinary.hpMax },
        ctx,
      ).ok,
    ).toBe(true);
    expect(
      listCombatants(db, DEFAULT_TEST_CAMPAIGN_ID).find(
        (combatant) => combatant.combatantId === ordinary.combatantId,
      ),
    ).toMatchObject({ status: 'dead', hpCurrent: 0, deathRules: 'monster' });
    expect(
      registry.invoke(
        'update_combatant',
        { combatantId: ordinary.combatantId, hpDelta: 2 },
        ctx,
      ).ok,
    ).toBe(true);
    expect(
      listCombatants(db, DEFAULT_TEST_CAMPAIGN_ID).find(
        (combatant) => combatant.combatantId === ordinary.combatantId,
      ),
    ).toMatchObject({ status: 'alive', hpCurrent: 2 });

    expect(
      registry.invoke(
        'adjust_exhaustion',
        { combatantId: terminal.combatantId, delta: 6 },
        ctx,
      ).ok,
    ).toBe(true);
    expect(
      registry.invoke(
        'update_combatant',
        { combatantId: terminal.combatantId, hpDelta: 2 },
        ctx,
      ).ok,
    ).toBe(false);
    expect(
      listCombatants(db, DEFAULT_TEST_CAMPAIGN_ID).find(
        (combatant) => combatant.combatantId === terminal.combatantId,
      ),
    ).toMatchObject({
      status: 'dead',
      hpCurrent: 3,
      conditions: [{ id: 'exhaustion', level: 6 }],
    });
    db.close();
  });

  it('escalates damage at 0 hit points and refuses to heal the dead', () => {
    const { db, update, read, hpMax } = optedIn();
    update({ hpDelta: -hpMax });
    expect(read()).toMatchObject({ status: 'dying', deathSaveFailures: 0 });
    update({ hpDelta: -1 });
    expect(read()).toMatchObject({ status: 'dying', deathSaveFailures: 1 });
    update({ hpDelta: -1, critical: true });
    expect(read()).toMatchObject({ status: 'dead', deathSaveFailures: 3 });
    const heal = update({ hpDelta: 5 });
    expect(heal.ok).toBe(false);
    expect(read()).toMatchObject({ status: 'dead', hpCurrent: 0 });
    db.close();
  });

  it('uses the effective maximum for damage at 0 HP from dying or stable', () => {
    const dying = optedIn();
    dying.update({ hpDelta: -dying.hpMax });
    dying.update({ hpDelta: -(dying.hpMax - 1) });
    expect(dying.read()).toMatchObject({
      status: 'dying',
      deathSaveFailures: 1,
    });
    dying.update({ hpDelta: -dying.hpMax });
    expect(dying.read()).toMatchObject({ status: 'dead' });
    dying.db.close();

    const stable = optedIn();
    stable.update({ hpDelta: -stable.hpMax });
    expect(stable.update({ status: 'stable', hpDelta: -stable.hpMax }).ok).toBe(
      false,
    );
    // Stabilize by recording three successful saves, then test the exact
    // lethal threshold while the recovery schedule is active.
    stable.registry.invoke(
      'record_death_save',
      { combatantId: stable.id, roll: 10 },
      stable.ctx,
    );
    stable.registry.invoke(
      'record_death_save',
      { combatantId: stable.id, roll: 10 },
      stable.ctx,
    );
    stable.registry.invoke(
      'record_death_save',
      { combatantId: stable.id, roll: 10 },
      stable.ctx,
    );
    expect(stable.read()?.status).toBe('stable');
    stable.update({ hpDelta: -stable.hpMax });
    expect(stable.read()?.status).toBe('dead');
    stable.db.close();

    const critical = optedIn();
    critical.update({ hpDelta: -critical.hpMax });
    critical.update({ hpDelta: -1, critical: true });
    expect(critical.read()).toMatchObject({
      status: 'dying',
      deathSaveFailures: 2,
    });
    critical.db.close();

    const exhausted = optedIn();
    expect(
      exhausted.registry.invoke(
        'adjust_exhaustion',
        { combatantId: exhausted.id, delta: 4 },
        exhausted.ctx,
      ).ok,
    ).toBe(true);
    exhausted.update({ hpDelta: -3 });
    exhausted.update({ hpDelta: -2 });
    expect(exhausted.read()).toMatchObject({
      status: 'dying',
      deathSaveFailures: 1,
    });
    exhausted.update({ hpDelta: -3 });
    expect(exhausted.read()).toMatchObject({ status: 'dead' });
    exhausted.db.close();
  });

  it('preserves dying counters across suffocation and prevents dead status bypasses', () => {
    const { db, registry, ctx, id, update, read, hpMax } = optedIn();
    update({ hpDelta: -hpMax });
    registry.invoke('record_death_save', { combatantId: id, roll: 1 }, ctx);
    registry.invoke('set_suffocation', { combatantId: id, event: 'drop' }, ctx);
    expect(read()).toMatchObject({
      status: 'dying',
      deathSaveFailures: 2,
      recoveryBlock: 'suffocating',
    });
    registry.invoke(
      'set_suffocation',
      { combatantId: id, event: 'breathe' },
      ctx,
    );
    registry.invoke('set_suffocation', { combatantId: id, event: 'drop' }, ctx);
    expect(read()).toMatchObject({
      status: 'dying',
      deathSaveFailures: 2,
      recoveryBlock: 'suffocating',
    });
    expect(update({ status: 'alive' }).ok).toBe(false);
    db.close();
  });

  it('keeps dead player-character combatants terminal and rejects removal status', () => {
    const { db, update, read, hpMax } = optedIn();
    update({ hpDelta: -hpMax * 2 });
    for (const status of ['escaped', 'unconscious', 'alive'])
      expect(update({ status }).ok).toBe(false);
    expect(update({ hpDelta: 1 }).ok).toBe(false);
    expect(update({ status: 'inactive' }).ok).toBe(false);
    expect(read()).toMatchObject({ status: 'dead', hpCurrent: 0 });
    db.close();
  });

  it('keeps exhaustion-six player-character combatants dead on every update', () => {
    const { db, registry, ctx, id, update, read } = optedIn();
    expect(
      registry.invoke('adjust_exhaustion', { combatantId: id, delta: 6 }, ctx)
        .ok,
    ).toBe(true);
    expect(read()).toMatchObject({ status: 'dead' });
    const hpAtDeath = read()?.hpCurrent;
    expect(update({ status: 'alive' }).ok).toBe(false);
    expect(update({ hpDelta: 1 }).ok).toBe(false);
    expect(read()).toMatchObject({ status: 'dead', hpCurrent: hpAtDeath });
    db.close();
  });

  it('derives lethal lifecycle before participation status and keeps monster exhaustion-six terminal', () => {
    const pc = optedIn();
    expect(pc.update({ hpDelta: -pc.hpMax, status: 'escaped' }).ok).toBe(false);
    expect(pc.read()).toMatchObject({ status: 'alive', hpCurrent: pc.hpMax });
    pc.update({ hpDelta: -pc.hpMax * 2 });
    expect(pc.read()?.status).toBe('dead');
    expect(pc.update({ status: 'inactive' }).ok).toBe(false);
    expect(pc.update({ hpDelta: 1 }).ok).toBe(false);
    pc.db.close();

    const monster = setup();
    monster.registry.invoke(
      'start_encounter',
      { encounterId: 'enc-goblins' },
      monster.ctx,
    );
    const target = listCombatants(monster.db, DEFAULT_TEST_CAMPAIGN_ID)[0];
    if (!target) throw new Error('monster combatant missing');
    expect(
      monster.registry.invoke(
        'adjust_exhaustion',
        { combatantId: target.combatantId, delta: 6 },
        monster.ctx,
      ).ok,
    ).toBe(true);
    expect(
      monster.registry.invoke(
        'update_combatant',
        { combatantId: target.combatantId, hpDelta: 1 },
        monster.ctx,
      ).ok,
    ).toBe(false);
    expect(
      monster.registry.invoke(
        'update_combatant',
        { combatantId: target.combatantId, status: 'inactive' },
        monster.ctx,
      ).ok,
    ).toBe(false);
    monster.db.close();
  });

  it('reports truthful continued refusal for an unknown recurring hydra head count', () => {
    const { db, registry, ctx } = setup();
    const started = startEncounter(db, {
      campaignId: DEFAULT_TEST_CAMPAIGN_ID,
      actors: [{ actorId: 'old-hydra', rulesRef: 'creature:hydra' }],
      provenance: 'test',
      sessionId: DEFAULT_TEST_SESSION_ID,
      at: NOW,
    });
    const hydra = started.combatants[0];
    if (!hydra) throw new Error('hydra projection missing');
    db.prepare(
      'UPDATE encounter_combatant SET head_count=NULL WHERE combatant_id=?',
    ).run(hydra.combatantId);
    updateCombatant(db, {
      campaignId: DEFAULT_TEST_CAMPAIGN_ID,
      combatantId: hydra.combatantId,
      locationId: 'loc-road',
      provenance: 'test',
      sessionId: DEFAULT_TEST_SESSION_ID,
      at: NOW,
    });
    closeCombatInstance(db, {
      campaignId: DEFAULT_TEST_CAMPAIGN_ID,
      status: 'completed',
      provenance: 'test',
      sessionId: DEFAULT_TEST_SESSION_ID,
      at: NOW,
    });
    const retry = registry.invoke(
      'start_encounter',
      {
        actors: [{ actorId: 'old-hydra', rulesRef: 'creature:hydra' }],
      },
      ctx,
    );
    expect(retry.ok).toBe(true);
    const refused = registry.invoke(
      'update_combatant',
      {
        combatantId: 'ci-combat-2-old-hydra',
        hpDelta: -1,
      },
      ctx,
    );
    expect(refused).toMatchObject({
      ok: false,
      message: expect.stringContaining('Eshyra cannot reconstruct it'),
    });
    expect(refused).toMatchObject({
      message: expect.stringContaining(
        'head-dependent damage, healing, turn settlement, and extra reactions are refused',
      ),
    });
    db.close();
  });

  it('preserves actor lifecycle when unrelated state metadata is updated', () => {
    const { db } = setup();
    startEncounter(db, {
      campaignId: DEFAULT_TEST_CAMPAIGN_ID,
      actors: [{ actorId: 'state-owner', rulesRef: 'creature:hydra' }],
      provenance: 'test',
      sessionId: DEFAULT_TEST_SESSION_ID,
      at: NOW,
    });
    const actor = getCampaignActor(db, DEFAULT_TEST_CAMPAIGN_ID, 'state-owner');
    if (!actor) throw new Error('campaign actor missing');
    upsertCampaignActor(db, {
      campaignId: actor.campaignId,
      actorId: actor.actorId,
      displayName: actor.displayName,
      actorKind: actor.actorKind,
      sourceKind: actor.sourceKind,
      rulesRef: actor.rulesRef,
      hpCurrent: actor.hpCurrent,
      hpMax: actor.hpMax,
      conditions: actor.conditions,
      status: actor.status,
      state: { note: 'preserved metadata' },
      provenance: 'test',
      sessionId: DEFAULT_TEST_SESSION_ID,
      at: NOW,
    });
    expect(
      getCampaignActor(db, DEFAULT_TEST_CAMPAIGN_ID, 'state-owner')?.state,
    ).toMatchObject({
      note: 'preserved metadata',
      combatLifecycle: { headCount: 5 },
    });
    db.close();
  });

  it('carries a recurring actor combat lifecycle through encounter projections', () => {
    const { db, registry, ctx } = setup();
    const first = startEncounter(db, {
      campaignId: DEFAULT_TEST_CAMPAIGN_ID,
      actors: [
        { actorId: 'recurring', rulesRef: 'creature:goblin', hpCurrent: 7 },
        {
          actorId: 'stable-recurring',
          rulesRef: 'creature:goblin',
          hpCurrent: 7,
        },
        {
          actorId: 'hydra-recurring',
          rulesRef: 'creature:hydra',
          hpCurrent: 172,
        },
      ],
      provenance: 'test',
      sessionId: DEFAULT_TEST_SESSION_ID,
      at: NOW,
    });
    const old = first.combatants.find((c) => c.identityRef === 'recurring');
    if (!old) throw new Error('actor projection missing');
    const stableOld = first.combatants.find(
      (c) => c.identityRef === 'stable-recurring',
    );
    const hydraOld = first.combatants.find(
      (c) => c.identityRef === 'hydra-recurring',
    );
    if (!stableOld || !hydraOld)
      throw new Error('recurring actor projections missing');
    registry.invoke(
      'update_combatant',
      {
        combatantId: stableOld.combatantId,
        deathRules: 'player-character',
        hpDelta: -7,
      },
      ctx,
    );
    for (let i = 0; i < 3; i += 1)
      registry.invoke(
        'record_death_save',
        { combatantId: stableOld.combatantId, roll: 10 },
        ctx,
      );
    registry.invoke(
      'update_combatant',
      { combatantId: hydraOld.combatantId, hpDelta: -25 },
      ctx,
    );
    const oldDeadline = (
      db
        .prepare(
          'SELECT stable_recovery_deadline_elapsed_minutes AS deadline FROM encounter_combatant WHERE campaign_id=? AND combatant_id=?',
        )
        .get(DEFAULT_TEST_CAMPAIGN_ID, stableOld.combatantId) as {
        deadline: number;
      }
    ).deadline;
    expect(
      registry.invoke(
        'update_combatant',
        {
          combatantId: old.combatantId,
          deathRules: 'player-character',
          hpDelta: -7,
        },
        ctx,
      ).ok,
    ).toBe(true);
    expect(
      registry.invoke(
        'set_suffocation',
        { combatantId: old.combatantId, event: 'drop' },
        ctx,
      ).ok,
    ).toBe(true);
    closeCombatInstance(db, {
      campaignId: DEFAULT_TEST_CAMPAIGN_ID,
      combatInstanceId: first.combatInstance.combatInstanceId,
      status: 'completed',
      provenance: 'test',
      sessionId: DEFAULT_TEST_SESSION_ID,
      at: NOW,
    });
    const second = startEncounter(db, {
      campaignId: DEFAULT_TEST_CAMPAIGN_ID,
      actors: [
        { actorId: 'recurring', rulesRef: 'creature:goblin' },
        { actorId: 'stable-recurring', rulesRef: 'creature:goblin' },
        { actorId: 'hydra-recurring', rulesRef: 'creature:hydra' },
      ],
      provenance: 'test',
      sessionId: DEFAULT_TEST_SESSION_ID,
      at: NOW,
    });
    const projected = second.combatants.find(
      (c) => c.identityRef === 'recurring',
    );
    const stableProjected = second.combatants.find(
      (c) => c.identityRef === 'stable-recurring',
    );
    const hydraProjected = second.combatants.find(
      (c) => c.identityRef === 'hydra-recurring',
    );
    expect(projected).toMatchObject({
      deathRules: 'player-character',
      status: 'dying',
      hpCurrent: 0,
      recoveryBlock: 'suffocating',
    });
    expect(stableProjected).toMatchObject({
      status: 'stable',
      stableRecoveryDeadlineElapsedMinutes: oldDeadline,
    });
    expect(hydraProjected?.headCount).toBe(4);
    expect(
      (
        db
        .prepare(
            'SELECT stable_recovery_deadline_elapsed_minutes AS deadline, stable_recovery_settled AS settled FROM encounter_combatant WHERE campaign_id=? AND combatant_id=?',
          )
          .get(DEFAULT_TEST_CAMPAIGN_ID, stableOld.combatantId) as {
          deadline: number | null;
          settled: number;
        }
      ).deadline,
    ).toBeNull();
    expect(
      (
        db
          .prepare(
            'SELECT stable_recovery_settled AS settled FROM encounter_combatant WHERE campaign_id=? AND combatant_id=?',
          )
          .get(DEFAULT_TEST_CAMPAIGN_ID, stableOld.combatantId) as {
          settled: number;
        }
      ).settled,
    ).toBe(0);
    expect(
      registry.invoke(
        'update_combatant',
        {
          combatantId: stableProjected?.combatantId,
          hpDelta: -(stableProjected?.hpMax ?? 7),
        },
        ctx,
      ).ok,
    ).toBe(true);
    const elapsed = (
      db.prepare('SELECT elapsed_minutes FROM clock WHERE id=1').get() as {
        elapsed_minutes: number;
      }
    ).elapsed_minutes;
    advanceWorldTime(db, {
      campaignId: DEFAULT_TEST_CAMPAIGN_ID,
      minutes: oldDeadline - elapsed + 1,
      provenance: 'test',
      sessionId: DEFAULT_TEST_SESSION_ID,
      at: NOW,
    });
    expect(
      getCampaignActor(db, DEFAULT_TEST_CAMPAIGN_ID, 'stable-recurring')
        ?.status,
    ).toBe('dead');
    expect(
      registry.invoke(
        'update_combatant',
        { combatantId: projected?.combatantId, hpDelta: 1 },
        ctx,
      ).ok,
    ).toBe(false);
    expect(
      registry.invoke(
        'record_death_save',
        { combatantId: old.combatantId, roll: 10 },
        ctx,
      ).ok,
    ).toBe(false);
    expect(
      getCampaignActor(db, DEFAULT_TEST_CAMPAIGN_ID, 'recurring')?.state
        .combatLifecycle,
    ).toMatchObject({
      deathRules: 'player-character',
      recoveryBlock: 'suffocating',
    });
    db.close();
  });

  it('promotes stable recovery through a summoning effect and transfers its single owner', () => {
    const { db, registry, ctx } = setup();
    expect(
      registry.invoke('start_encounter', { encounterId: 'enc-goblins' }, ctx)
        .ok,
    ).toBe(true);
    const source = listCombatants(db, ctx.campaignId)[0];
    if (!source) throw new Error('encounter did not create a combatant');
    expect(
      registry.invoke(
        'update_combatant',
        { combatantId: source.combatantId, deathRules: 'player-character' },
        ctx,
      ).ok,
    ).toBe(true);
    expect(
      registry.invoke(
        'update_combatant',
        { combatantId: source.combatantId, hpDelta: -source.hpMax },
        ctx,
      ).ok,
    ).toBe(true);
    expect(
      registry.invoke(
        'stabilize_character',
        { combatantId: source.combatantId },
        ctx,
      ).ok,
    ).toBe(true);
    const scheduleOf = (combatantId: string) =>
      db
        .prepare(
          `SELECT stable_recovery_roll AS roll,
                  stable_recovery_anchor_elapsed_minutes AS anchor,
                  stable_recovery_deadline_elapsed_minutes AS deadline,
                  stable_recovery_settled AS settled
           FROM encounter_combatant WHERE campaign_id=? AND combatant_id=?`,
        )
        .get(ctx.campaignId, combatantId) as {
        roll: number | null;
        anchor: number | null;
        deadline: number | null;
        settled: number;
      };
    const originalSchedule = scheduleOf(source.combatantId);
    expect(originalSchedule).toMatchObject({
      roll: expect.any(Number),
      anchor: expect.any(Number),
      deadline: expect.any(Number),
      settled: 0,
    });

    expect(
      registry.invoke(
        'start_effect',
        {
          effectId: 'promote-stable-goblin',
          kind: 'summoning',
          displayName: 'Promote the goblin',
          source: { kind: 'ruling' },
          duration: { kind: 'until-removed' },
          actors: [
            {
              combatantId: source.combatantId,
              campaignActorId: 'durable-stable-goblin',
            },
          ],
        },
        ctx,
      ).ok,
    ).toBe(true);
    expect(scheduleOf(source.combatantId)).toEqual(originalSchedule);
    expect(
      getCampaignActor(db, ctx.campaignId, 'durable-stable-goblin')?.state
        .combatLifecycle,
    ).toMatchObject({
      stableRecovery: {
        roll: originalSchedule.roll,
        anchor: originalSchedule.anchor,
        deadline: originalSchedule.deadline,
      },
      stableRecoverySettled: false,
    });

    const promotionInput = {
      campaignId: ctx.campaignId,
      combatantId: source.combatantId,
      actorId: 'durable-stable-goblin',
      provenance: 'test:repeat-promotion',
      sessionId: ctx.sessionId,
      at: ctx.at,
    };
    ensureCampaignActorFromCombatant(db, promotionInput);
    expect(scheduleOf(source.combatantId)).toEqual(originalSchedule);

    expect(
      registry.invoke(
        'close_combat_instance',
        { combatInstanceId: source.combatInstanceId, status: 'completed' },
        ctx,
      ).ok,
    ).toBe(true);
    expect(
      registry.invoke(
        'start_encounter',
        {
          combatInstanceId: 'promotion-next',
          actors: [
            {
              actorId: 'durable-stable-goblin',
              rulesRef: source.rulesRef,
            },
          ],
        },
        ctx,
      ).ok,
    ).toBe(true);
    const projectedId = 'promotion-next-durable-stable-goblin';
    expect(scheduleOf(source.combatantId)).toEqual({
      roll: null,
      anchor: null,
      deadline: null,
      settled: 0,
    });
    expect(scheduleOf(projectedId)).toEqual(originalSchedule);

    ensureCampaignActorFromCombatant(db, promotionInput);
    expect(scheduleOf(projectedId)).toEqual(originalSchedule);
    const elapsed = (
      db.prepare('SELECT elapsed_minutes FROM clock WHERE id=1').get() as {
        elapsed_minutes: number;
      }
    ).elapsed_minutes;
    expect(
      registry.invoke(
        'advance_time',
        { minutes: (originalSchedule.deadline as number) - elapsed + 1 },
        ctx,
      ).ok,
    ).toBe(true);
    expect(
      listCombatants(db, ctx.campaignId).find(
        (combatant) => combatant.combatantId === projectedId,
      ),
    ).toMatchObject({ status: 'alive', hpCurrent: 1 });
    expect(
      getCampaignActor(db, ctx.campaignId, 'durable-stable-goblin'),
    ).toMatchObject({ status: 'alive', hpCurrent: 1 });
    db.close();
  });

  it('heals a dying combatant back to alive with fresh counters', () => {
    const { db, update, read, hpMax } = optedIn();
    update({ hpDelta: -hpMax });
    update({ hpDelta: -1 });
    expect(update({ hpDelta: 2 }).ok).toBe(true);
    expect(read()).toMatchObject({
      status: 'alive',
      hpCurrent: 2,
      deathSaveFailures: 0,
    });
    db.close();
  });

  it('keeps dying and stable engine-owned', () => {
    const { db, update, read, hpMax } = optedIn();
    expect(update({ status: 'dying' }).ok).toBe(false);
    expect(update({ status: 'stable' }).ok).toBe(false);
    update({ hpDelta: -hpMax });
    expect(update({ status: 'alive' }).ok).toBe(false);
    expect(read()).toMatchObject({ status: 'dying' });
    db.close();
  });

  it('refuses dying and stable for a combatant under monster rules', () => {
    const { db, registry, ctx } = setup();
    registry.invoke('start_encounter', { encounterId: 'enc-goblins' }, ctx);
    const target = listCombatants(db, DEFAULT_TEST_CAMPAIGN_ID)[0];
    if (!target) throw new Error('encounter did not create a combatant');
    for (const status of ['dying', 'stable'])
      expect(
        registry.invoke(
          'update_combatant',
          {
            combatantId: target.combatantId,
            hpDelta: -target.hpCurrent,
            status,
          },
          ctx,
        ).ok,
      ).toBe(false);
    db.close();
  });

  it('records a knockout as stable and recovers on the world clock', () => {
    const { db, update, read, hpMax } = optedIn();
    expect(update({ hpDelta: -(hpMax * 2), status: 'stable' }).ok).toBe(true);
    const stable = read();
    expect(stable).toMatchObject({ status: 'stable', hpCurrent: 0 });
    expect(stable?.stableRecoveryDeadlineElapsedMinutes).not.toBeNull();
    advance(db, 4 * 60);
    expect(read()).toMatchObject({ status: 'alive', hpCurrent: 1 });
    db.close();
  });

  it('stabilizes through stabilize_character and recovers on the clock', () => {
    const { db, registry, ctx, id, update, read, hpMax } = optedIn();
    update({ hpDelta: -hpMax });
    expect(
      registry.invoke('stabilize_character', { combatantId: id }, ctx).ok,
    ).toBe(true);
    expect(read()).toMatchObject({ status: 'stable' });
    advance(db, 4 * 60);
    expect(read()).toMatchObject({ status: 'alive', hpCurrent: 1 });
    db.close();
  });

  it('blocks recovery while suffocating and stabilizes on breathing', () => {
    const { db, registry, ctx, id, update, read } = optedIn();
    const suffocate = (event: string) =>
      registry.invoke('set_suffocation', { combatantId: id, event }, ctx);
    const save = (roll: number) =>
      registry.invoke('record_death_save', { combatantId: id, roll }, ctx);
    expect(suffocate('drop').ok).toBe(true);
    expect(read()).toMatchObject({
      status: 'dying',
      hpCurrent: 0,
      recoveryBlock: 'suffocating',
    });
    expect(update({ hpDelta: 3 }).ok).toBe(false);
    expect(
      registry.invoke('stabilize_character', { combatantId: id }, ctx).ok,
    ).toBe(false);
    save(20);
    expect(read()).toMatchObject({ hpCurrent: 0, deathSaveSuccesses: 1 });
    save(15);
    save(15);
    expect(read()).toMatchObject({ status: 'dying', deathSaveSuccesses: 3 });
    expect(suffocate('breathe').ok).toBe(true);
    expect(read()).toMatchObject({ status: 'stable', recoveryBlock: null });
    db.close();
  });

  it('clears the block when a suffocating combatant dies', () => {
    const { db, registry, ctx, id, read } = optedIn();
    registry.invoke('set_suffocation', { combatantId: id, event: 'drop' }, ctx);
    registry.invoke('record_death_save', { combatantId: id, roll: 1 }, ctx);
    registry.invoke('record_death_save', { combatantId: id, roll: 1 }, ctx);
    expect(read()).toMatchObject({ status: 'dead', recoveryBlock: null });
    db.close();
  });

  it('applies the monster default when a monster-rules combatant suffocates', () => {
    const { db, registry, ctx } = setup();
    registry.invoke('start_encounter', { encounterId: 'enc-goblins' }, ctx);
    const target = listCombatants(db, DEFAULT_TEST_CAMPAIGN_ID)[0];
    if (!target) throw new Error('encounter did not create a combatant');
    expect(
      registry.invoke(
        'set_suffocation',
        { combatantId: target.combatantId, event: 'drop' },
        ctx,
      ).ok,
    ).toBe(true);
    expect(listCombatants(db, DEFAULT_TEST_CAMPAIGN_ID)[0]).toMatchObject({
      status: 'dead',
      hpCurrent: 0,
      recoveryBlock: null,
    });
    db.close();
  });
});
