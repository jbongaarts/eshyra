import { describe, expect, it } from 'vitest';
import { closeSession, startSession } from '../src/index.js';
import type { AdventureModule, ToolContext } from '../src/internal.js';
import {
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
import { makeTestAdventureModule } from './support/adventureModuleFixture.js';
import {
  DEFAULT_TEST_CAMPAIGN_ID,
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
        },
        {
          tool: 'update_combatant',
          args: { combatantId: 'ci-enc-goblins-1-goblin-1', hpDelta: -7 },
          result: {
            ok: true,
            data: { combatantId: 'ci-enc-goblins-1-goblin-1' },
          },
        },
        {
          tool: 'close_combat_instance',
          args: { status: 'completed' },
          result: { ok: true, data: { combatInstanceId: 'ci-enc-goblins-1' } },
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
