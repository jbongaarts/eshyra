import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type {
  AdventureModule,
  AuditVerdict,
  ModelClient,
  ModelCompleteInput,
  ModelCompleteResult,
  Tool,
  TurnAuditInput,
  TurnAuditor,
} from '../src/internal.js';
import {
  createDefaultToolRegistry,
  DEFAULT_TOOLS,
  getTurnTrace,
  listCombatants,
  openScene,
  readStateSnapshot,
  runTurn,
  startAdventureRun,
  ToolRegistry,
} from '../src/internal.js';
import { rollTool } from '../src/orchestrator/toolRoll.js';
import { makeTestAdventureModule } from './support/adventureModuleFixture.js';
import { freshDbWithSession } from './support/db.js';

const CAMPAIGN = 'campaign-combat-fixture';
const SESSION = 'session-combat-fixture';
const NOW = '2026-05-20T10:05:00.000Z';

class ScriptedModel implements ModelClient {
  private index = 0;
  readonly seen: ModelCompleteInput[] = [];

  constructor(private readonly replies: string[]) {}

  complete(input: ModelCompleteInput): Promise<ModelCompleteResult> {
    this.seen.push(input);
    const text = this.replies[this.index] ?? '';
    this.index += 1;
    return Promise.resolve({ text });
  }
}

class ScriptedAuditor implements TurnAuditor {
  private index = 0;
  readonly seen: TurnAuditInput[] = [];
  readonly modelId = 'combat-fixture-auditor';

  constructor(private readonly verdicts: AuditVerdict[]) {}

  audit(input: TurnAuditInput): Promise<AuditVerdict> {
    this.seen.push(input);
    const verdict = this.verdicts[this.index] ?? ACCEPT;
    this.index += 1;
    return Promise.resolve(verdict);
  }
}

const ACCEPT: AuditVerdict = {
  verdict: 'accept',
  missingRequiredTools: [],
  missingRequiredCalls: [],
  disallowedToolCalls: [],
  reason: 'ok',
  repairInstruction: '',
};

const REJECT_MISSING_ROLL: AuditVerdict = {
  verdict: 'reject',
  missingRequiredTools: ['roll'],
  missingRequiredCalls: [{ tool: 'roll' }],
  disallowedToolCalls: [],
  reason: 'narrated combat result without an executed roll',
  repairInstruction: 'Replay the combat turn with roll tool calls.',
};

interface PlannedRoll {
  readonly dice: string;
  readonly reason: string;
  readonly rolls: readonly number[];
  readonly modifier: number;
}

function plannedRollTool(plan: readonly PlannedRoll[]): Tool {
  const queue = [...plan];
  return {
    ...rollTool,
    run(args) {
      const a =
        typeof args === 'object' && args !== null && !Array.isArray(args)
          ? (args as Record<string, unknown>)
          : undefined;
      if (
        a === undefined ||
        typeof a.dice !== 'string' ||
        typeof a.reason !== 'string'
      ) {
        return {
          ok: false,
          code: 'invalid_args',
          message: 'roll requires dice and reason',
        };
      }
      const next = queue.shift();
      if (next === undefined) {
        return {
          ok: false,
          code: 'roll_plan_exhausted',
          message: `no planned roll remains for ${a.reason}`,
        };
      }
      if (next.dice !== a.dice || next.reason !== a.reason) {
        return {
          ok: false,
          code: 'roll_plan_mismatch',
          message: `expected ${next.dice} for ${next.reason}; got ${a.dice} for ${a.reason}`,
        };
      }
      return {
        ok: true,
        data: {
          dice: a.dice,
          reason: a.reason,
          ...(typeof a.visibility === 'string'
            ? { visibility: a.visibility }
            : {}),
          ...(typeof a.category === 'string' ? { category: a.category } : {}),
          rolls: [...next.rolls],
          modifier: next.modifier,
          total:
            next.rolls.reduce((sum, value) => sum + value, 0) + next.modifier,
        },
      };
    },
  };
}

function createCombatFixtureRegistry(
  plan: readonly PlannedRoll[],
): ToolRegistry {
  const registry = new ToolRegistry();
  for (const tool of DEFAULT_TOOLS) {
    if (tool.name !== 'roll') {
      registry.register(tool);
    }
  }
  return registry.register(plannedRollTool(plan));
}

function toolCall(tool: string, args: unknown): string {
  return ['```tool_call', JSON.stringify({ tool, args }), '```'].join('\n');
}

function toolCalls(calls: readonly { tool: string; args: unknown }[]): string {
  return calls.map((call) => toolCall(call.tool, call.args)).join('\n');
}

function combatModule(): AdventureModule {
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
    ],
    scenes: module.scenes.map((scene) =>
      scene.id === 'scene-cellar'
        ? { ...scene, encounterIds: ['enc-goblins'] }
        : scene,
    ),
  };
}

function setupDb() {
  const db = freshDbWithSession({
    campaignId: CAMPAIGN,
    sessionId: SESSION,
  });
  db.prepare(
    `UPDATE character
     SET name = 'Bob', hp_current = 10, hp_max = 10
     WHERE id = 'pc-1'`,
  ).run();
  openScene(db, {
    campaignId: CAMPAIGN,
    sessionId: SESSION,
    sceneId: 'scene-combat',
    title: 'Watchtower Hollow',
    at: '2026-05-20T10:00:00.000Z',
  });
  const module = combatModule();
  startAdventureRun(db, {
    campaignId: CAMPAIGN,
    runId: 'run-watchtower',
    moduleId: module.id,
    provenance: 'test',
    sessionId: SESSION,
    updatedAt: NOW,
  });
  return { db, module };
}

function baseInput(overrides: Record<string, unknown> = {}) {
  return {
    campaignId: CAMPAIGN,
    sessionId: SESSION,
    turnId: 'turn-combat-1',
    playerInput: 'Run the deterministic combat regression.',
    seed: 1,
    at: NOW,
    ...overrides,
  };
}

function deterministicCombatCalls() {
  return [
    { tool: 'lookup_rules', args: { kind: 'creature', name: 'Goblin' } },
    { tool: 'start_encounter', args: { encounterId: 'enc-goblins' } },
    {
      tool: 'roll',
      args: {
        dice: '1d20+2',
        reason: 'Bob initiative',
        visibility: 'player_visible',
        category: 'initiative',
      },
    },
    {
      tool: 'roll',
      args: {
        dice: '1d20+5',
        reason: 'Bob first longsword attack against goblin-1',
        visibility: 'player_visible',
        category: 'attack',
      },
    },
    {
      tool: 'roll',
      args: {
        dice: '1d20+4',
        reason: 'goblin-1 scimitar attack against Bob',
        visibility: 'player_visible',
        category: 'attack',
      },
    },
    {
      tool: 'roll',
      args: {
        dice: '1d20+4',
        reason: 'goblin-2 scimitar attack against Bob',
        visibility: 'player_visible',
        category: 'attack',
      },
    },
    {
      tool: 'roll',
      args: {
        dice: '1d20+5',
        reason: 'Bob second longsword attack against goblin-1',
        visibility: 'player_visible',
        category: 'attack',
      },
    },
    {
      tool: 'roll',
      args: {
        dice: '1d8+3',
        reason: 'Bob longsword damage against goblin-1',
        visibility: 'player_visible',
        category: 'damage',
      },
    },
    {
      tool: 'update_combatant',
      args: {
        combatantId: 'ci-enc-goblins-1-goblin-1',
        hpDelta: -7,
        addCondition: { id: 'dead' },
      },
    },
    {
      tool: 'roll',
      args: {
        dice: '1d20+4',
        reason: 'goblin-2 critical scimitar attack against Bob',
        visibility: 'player_visible',
        category: 'attack',
      },
    },
    {
      tool: 'roll',
      args: {
        dice: '2d6+4',
        reason: 'goblin-2 critical damage against Bob',
        visibility: 'player_visible',
        category: 'damage',
      },
    },
    { tool: 'adjust_hp', args: { amount: -10, character: 'Bob' } },
    { tool: 'add_condition', args: { id: 'dying', character: 'Bob' } },
    {
      tool: 'roll',
      args: {
        dice: '1d20',
        reason: 'Bob death save',
        visibility: 'player_visible',
        category: 'death_save',
      },
    },
  ] as const;
}

const ROLL_PLAN: readonly PlannedRoll[] = [
  {
    dice: '1d20+2',
    reason: 'Bob initiative',
    rolls: [15],
    modifier: 2,
  },
  {
    dice: '1d20+5',
    reason: 'Bob first longsword attack against goblin-1',
    rolls: [3],
    modifier: 5,
  },
  {
    dice: '1d20+4',
    reason: 'goblin-1 scimitar attack against Bob',
    rolls: [6],
    modifier: 4,
  },
  {
    dice: '1d20+4',
    reason: 'goblin-2 scimitar attack against Bob',
    rolls: [7],
    modifier: 4,
  },
  {
    dice: '1d20+5',
    reason: 'Bob second longsword attack against goblin-1',
    rolls: [13],
    modifier: 5,
  },
  {
    dice: '1d8+3',
    reason: 'Bob longsword damage against goblin-1',
    rolls: [4],
    modifier: 3,
  },
  {
    dice: '1d20+4',
    reason: 'goblin-2 critical scimitar attack against Bob',
    rolls: [20],
    modifier: 4,
  },
  {
    dice: '2d6+4',
    reason: 'goblin-2 critical damage against Bob',
    rolls: [3, 3],
    modifier: 4,
  },
  {
    dice: '1d20',
    reason: 'Bob death save',
    rolls: [15],
    modifier: 0,
  },
];

describe('first combat playtest deterministic regression fixture', () => {
  it('forces the combat path while asserting mechanical invariants, not prose', async () => {
    const { db, module } = setupDb();
    const registry = createCombatFixtureRegistry(ROLL_PLAN);
    const model = new ScriptedModel([
      toolCalls(deterministicCombatCalls()),
      'Steel flashes in the hollow. One goblin falls, but Bob is dropped and clings to life.',
    ]);

    const result = await runTurn(
      {
        db,
        model,
        registry,
        resolveAdventureModule: (moduleId) =>
          moduleId === module.id ? module : undefined,
      },
      baseInput(),
    );

    expect(result.ok).toBe(true);
    expect(result.toolCalls.map((call) => call.tool)).toEqual([
      'lookup_rules',
      'start_encounter',
      'roll',
      'roll',
      'roll',
      'roll',
      'roll',
      'roll',
      'update_combatant',
      'roll',
      'roll',
      'adjust_hp',
      'add_condition',
      'roll',
    ]);
    expect(
      result.toolCalls
        .filter((call) => call.tool === 'roll')
        .map((call) => (call.result.ok ? call.result.data : undefined)),
    ).toEqual([
      expect.objectContaining({ reason: 'Bob initiative', total: 17 }),
      expect.objectContaining({
        reason: 'Bob first longsword attack against goblin-1',
        total: 8,
      }),
      expect.objectContaining({
        reason: 'goblin-1 scimitar attack against Bob',
        total: 10,
      }),
      expect.objectContaining({
        reason: 'goblin-2 scimitar attack against Bob',
        total: 11,
      }),
      expect.objectContaining({
        reason: 'Bob second longsword attack against goblin-1',
        total: 18,
      }),
      expect.objectContaining({
        reason: 'Bob longsword damage against goblin-1',
        total: 7,
      }),
      expect.objectContaining({
        reason: 'goblin-2 critical scimitar attack against Bob',
        total: 24,
      }),
      expect.objectContaining({
        reason: 'goblin-2 critical damage against Bob',
        total: 10,
      }),
      expect.objectContaining({ reason: 'Bob death save', total: 15 }),
    ]);

    expect(result.narration).toContain('Rolls:');
    for (const label of [
      'Initiative (Bob initiative)',
      'Attack (Bob first longsword attack against goblin-1)',
      'Attack (goblin-1 scimitar attack against Bob)',
      'Attack (goblin-2 scimitar attack against Bob)',
      'Attack (Bob second longsword attack against goblin-1)',
      'Damage (Bob longsword damage against goblin-1)',
      'Attack (goblin-2 critical scimitar attack against Bob)',
      'Damage (goblin-2 critical damage against Bob)',
      'Death save (Bob death save)',
    ]) {
      expect(result.narration).toContain(label);
    }

    const combatants = listCombatants(db, CAMPAIGN);
    expect(combatants.map((combatant) => combatant.combatantId)).toEqual([
      'ci-enc-goblins-1-goblin-1',
      'ci-enc-goblins-1-goblin-2',
    ]);
    expect(
      combatants.find(
        (combatant) => combatant.combatantId === 'ci-enc-goblins-1-goblin-1',
      ),
    ).toMatchObject({
      hpCurrent: 0,
      status: 'dead',
      conditions: [{ id: 'dead' }],
    });
    expect(
      combatants.find(
        (combatant) => combatant.combatantId === 'ci-enc-goblins-1-goblin-2',
      ),
    ).toMatchObject({ hpCurrent: 7, status: 'alive' });

    const bob = readStateSnapshot(db, 'pc-1').character;
    expect(bob.hpCurrent).toBe(0);
    expect(bob.conditions).toEqual([{ id: 'dying' }]);

    const trace = getTurnTrace(db, {
      campaignId: CAMPAIGN,
      sessionId: SESSION,
      turnId: 'turn-combat-1',
    });
    expect(trace?.acceptedStateDelta).toEqual([
      { encounterId: 'enc-goblins' },
      {
        combatantId: 'ci-enc-goblins-1-goblin-1',
        hpDelta: -7,
        addCondition: { id: 'dead' },
      },
      { amount: -10, character: 'Bob' },
      { id: 'dying', character: 'Bob' },
    ]);
    db.close();
  });

  it('rolls back rejected combat state and avoids duplicate writes on retry', async () => {
    const { db, module } = setupDb();
    const model = new ScriptedModel([
      toolCalls([
        { tool: 'start_encounter', args: { encounterId: 'enc-goblins' } },
        {
          tool: 'update_combatant',
          args: {
            combatantId: 'ci-enc-goblins-1-goblin-1',
            hpDelta: -7,
            addCondition: { id: 'dead' },
          },
        },
      ]),
      'The goblin dies without a visible attack roll.',
      toolCalls([
        { tool: 'start_encounter', args: { encounterId: 'enc-goblins' } },
        {
          tool: 'roll',
          args: {
            dice: '1d20+5',
            reason: 'Bob repaired attack against goblin-1',
            visibility: 'player_visible',
            category: 'attack',
          },
        },
        {
          tool: 'update_combatant',
          args: {
            combatantId: 'ci-enc-goblins-1-goblin-1',
            hpDelta: -7,
            addCondition: { id: 'dead' },
          },
        },
      ]),
      'The repaired turn records the state-backed goblin death.',
    ]);
    const auditor = new ScriptedAuditor([REJECT_MISSING_ROLL, ACCEPT]);

    const result = await runTurn(
      {
        db,
        model,
        registry: createDefaultToolRegistry(),
        auditor,
        resolveAdventureModule: (moduleId) =>
          moduleId === module.id ? module : undefined,
      },
      baseInput({ turnId: 'turn-retry' }),
    );

    expect(result.ok).toBe(true);
    expect(auditor.seen).toHaveLength(2);
    expect(model.seen[2].messages[0].content).toContain(
      'All tool calls from that rejected\ncandidate were rolled back and did not apply',
    );
    expect(model.seen[2].messages[0].content).toContain(
      'Recreate the full intended\naccepted outcome from scratch',
    );
    expect(result.narration).toContain(
      'The repaired turn records the state-backed goblin death.',
    );
    expect(result.narration).toContain(
      'Attack (Bob repaired attack against goblin-1)',
    );
    expect(result.toolCalls.map((call) => call.tool)).toEqual([
      'start_encounter',
      'roll',
      'update_combatant',
    ]);

    const combatInstanceCount = db
      .prepare('SELECT COUNT(*) AS n FROM combat_instance')
      .get() as { n: number };
    const combatantCount = db
      .prepare('SELECT COUNT(*) AS n FROM encounter_combatant')
      .get() as { n: number };
    expect(combatInstanceCount.n).toBe(1);
    expect(combatantCount.n).toBe(2);
    expect(listCombatants(db, CAMPAIGN)).toEqual([
      expect.objectContaining({
        combatantId: 'ci-enc-goblins-1-goblin-1',
        hpCurrent: 0,
        status: 'dead',
      }),
      expect.objectContaining({
        combatantId: 'ci-enc-goblins-1-goblin-2',
        hpCurrent: 7,
        status: 'alive',
      }),
    ]);
    db.close();
  });

  it('documents the live RNG recipe as branch-tolerant rather than exact-prose exact-path', () => {
    const recipe = readFileSync(
      'docs/playtests/first-combat-regression.md',
      'utf8',
    );

    expect(recipe).toContain('## Live RNG Playtest');
    expect(recipe).toContain('transcript as branch-tolerant');
    expect(recipe).toContain(
      'If Bob attacks, the player attack roll is visible.',
    );
    expect(recipe).toContain('If Bob hits, the damage roll is visible.');
    expect(recipe).toContain(
      'If a goblin attacks Bob, the enemy attack roll is visible.',
    );
    expect(recipe).toContain(
      'If Bob reaches 0 HP, unconscious/dying state and death-save flow are visible.',
    );
  });
});
