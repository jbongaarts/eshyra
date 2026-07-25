import { describe, expect, it } from 'vitest';
import type {
  Db,
  ExecutedToolCall,
  ModelClient,
  ModelCompleteInput,
  ModelCompleteResult,
} from '../src/internal.js';
import {
  closeScene,
  createDefaultToolRegistry,
  getTurnTrace,
  listSceneLog,
  openScene,
  rollupSessionRecap,
  runTurn,
} from '../src/internal.js';
import { freshDbWithSession } from './support/db.js';

/**
 * E5 epic verification (loreweaver-ws9.7): one integration test exercising
 * all five acceptance criteria of the Orchestrator + turn loop epic.
 */

const CAMPAIGN = 'campaign-e5';
const SESSION = 'session-3';

class ScriptedModel implements ModelClient {
  private index = 0;
  readonly seen: ModelCompleteInput[] = [];
  constructor(private readonly replies: string[]) {}
  complete(input: ModelCompleteInput): Promise<ModelCompleteResult> {
    this.seen.push(input);
    const reply = this.replies[this.index] ?? '';
    this.index += 1;
    return Promise.resolve({ text: reply });
  }
}

const toolCall = (tool: string, args: unknown): string =>
  ['```tool_call', JSON.stringify({ tool, args }), '```'].join('\n');

function openCurrentScene(db: Db): void {
  openScene(db, {
    campaignId: CAMPAIGN,
    sessionId: SESSION,
    sceneId: 'scene-now',
    title: 'The Goblin Ambush',
    at: '2026-05-20T10:00:00.000Z',
  });
}

function baseInput(overrides: Record<string, unknown> = {}) {
  return {
    campaignId: CAMPAIGN,
    sessionId: SESSION,
    turnId: 'turn-1',
    playerInput: 'I draw my sword and face the goblin.',
    seed: 1234,
    at: '2026-05-20T10:05:00.000Z',
    ...overrides,
  };
}

const indexOfTool = (calls: ExecutedToolCall[], tool: string): number =>
  calls.findIndex((c) => c.tool === tool);

describe('E5 epic verification', () => {
  it('AC1: a full player turn runs end to end', async () => {
    const db = freshDbWithSession({
      campaignId: CAMPAIGN,
      sessionId: SESSION,
    });
    openCurrentScene(db);
    const model = new ScriptedModel([
      toolCall('roll', { dice: '1d20+3', reason: 'initiative' }),
      'You move first — steel rasps free of its scabbard.',
    ]);

    const result = await runTurn(
      { db, model, registry: createDefaultToolRegistry() },
      baseInput(),
    );

    // prompt assembled + model called
    expect(model.seen.length).toBeGreaterThanOrEqual(1);
    expect(model.seen[0].system).toContain('Dungeon Master');
    // tools executed
    expect(result.ok).toBe(true);
    expect(result.toolCalls.map((c) => c.tool)).toContain('roll');
    // narration produced
    expect(result.narration).toContain('steel');
    // scene_log appended
    const log = listSceneLog(db, {
      campaignId: CAMPAIGN,
      sessionId: SESSION,
      sceneId: 'scene-now',
    });
    expect(log.map((e) => e.role)).toEqual(['player', 'dm']);
    db.close();
  });

  it('AC2: the assembled prompt contains only the bounded set', async () => {
    const db = freshDbWithSession({
      campaignId: CAMPAIGN,
      sessionId: SESSION,
    });

    // Older closed scene — its transcript must be excluded.
    openScene(db, {
      campaignId: CAMPAIGN,
      sessionId: SESSION,
      sceneId: 'scene-ancient',
      title: 'Long Ago',
      at: '2026-05-20T08:00:00.000Z',
    });
    closeScene(db, {
      campaignId: CAMPAIGN,
      sessionId: SESSION,
      sceneId: 'scene-ancient',
      at: '2026-05-20T08:30:00.000Z',
    });

    // Several past sessions — only the most recent should inline.
    for (const n of [1, 2, 3]) {
      rollupSessionRecap(db, {
        campaignId: CAMPAIGN,
        sessionId: `past-${n}`,
        recap: `RECAP_MARKER_${n}`,
        stateDelta: [],
        createdAt: `2026-05-1${n}T20:00:00.000Z`,
      });
    }

    openCurrentScene(db);
    const model = new ScriptedModel(['The goblin snarls and lunges.']);
    await runTurn(
      { db, model, registry: createDefaultToolRegistry() },
      baseInput({ recentSessionLimit: 1 }),
    );

    const prompt = model.seen[0].messages[0].content;
    // current scene present
    expect(prompt).toContain('The Goblin Ambush');
    // only the newest recap inlined; older ones excluded
    expect(prompt).toContain('RECAP_MARKER_3');
    expect(prompt).not.toContain('RECAP_MARKER_1');
    // and the model is told drilldown can reach the omitted history
    expect(prompt).toContain('memory_drilldown');
    db.close();
  });

  it('AC3: roll RNG is code-owned and reproducible under a seed', async () => {
    const runOnce = async (): Promise<unknown> => {
      const db = freshDbWithSession({
        campaignId: CAMPAIGN,
        sessionId: SESSION,
      });
      openCurrentScene(db);
      const model = new ScriptedModel([
        toolCall('roll', { dice: '2d20+5', reason: 'attack' }),
        'The blade flashes.',
      ]);
      const result = await runTurn(
        { db, model, registry: createDefaultToolRegistry() },
        baseInput({ seed: 9090 }),
      );
      db.close();
      return result.toolCalls[0].result;
    };
    const a = await runOnce();
    const b = await runOnce();
    expect(a).toEqual(b);
    expect(a).toMatchObject({ ok: true });
  });

  it('surfaces player-visible attack rolls in final narration', async () => {
    const db = freshDbWithSession({
      campaignId: CAMPAIGN,
      sessionId: SESSION,
    });
    openCurrentScene(db);
    const model = new ScriptedModel([
      toolCall('roll', {
        dice: '1d20+5',
        reason: 'Bob longsword attack',
        visibility: 'player_visible',
        category: 'attack',
      }),
      'Your blade flashes wide of the goblin.',
    ]);

    const result = await runTurn(
      { db, model, registry: createDefaultToolRegistry() },
      baseInput({ seed: 9090 }),
    );

    expect(result.ok).toBe(true);
    expect(result.narration).toContain('Rolls:');
    expect(result.narration).toContain('Attack (Bob longsword attack)');
    db.close();
  });

  it.each([
    {
      reason: 'Bob longsword damage',
      category: 'damage',
      expected: 'Damage (Bob longsword damage)',
    },
    {
      reason: 'goblin scimitar attack against Bob',
      category: 'attack',
      expected: 'Attack (goblin scimitar attack against Bob)',
    },
    {
      reason: 'goblin critical damage against Bob',
      category: 'damage',
      expected: 'Damage (goblin critical damage against Bob)',
    },
    {
      reason: 'death save',
      category: 'death_save',
      expected: 'Death save (death save)',
    },
  ] as const)(
    'surfaces $reason rolls in final narration',
    async ({ reason, category, expected }) => {
      const db = freshDbWithSession({
        campaignId: CAMPAIGN,
        sessionId: SESSION,
      });
      openCurrentScene(db);
      const model = new ScriptedModel([
        toolCall('roll', {
          dice: '1d20+3',
          reason,
          visibility: 'player_visible',
          category,
        }),
        'The exchange resolves.',
      ]);

      const result = await runTurn(
        { db, model, registry: createDefaultToolRegistry() },
        baseInput({ seed: 9090 }),
      );

      expect(result.ok).toBe(true);
      expect(result.narration).toContain('Rolls:');
      expect(result.narration).toContain(expected);
      db.close();
    },
  );

  it('does not surface hidden ambush checks in final narration', async () => {
    const db = freshDbWithSession({
      campaignId: CAMPAIGN,
      sessionId: SESSION,
    });
    openCurrentScene(db);
    const model = new ScriptedModel([
      toolCall('roll', {
        dice: '1d20+6',
        reason: 'hidden ambush stealth check',
        visibility: 'dm_only',
        category: 'ability_check',
      }),
      'The brush stirs somewhere ahead.',
    ]);

    const result = await runTurn(
      { db, model, registry: createDefaultToolRegistry() },
      baseInput({ seed: 9090 }),
    );

    expect(result.ok).toBe(true);
    expect(result.narration).not.toContain('Rolls:');
    expect(result.narration).not.toContain('hidden ambush stealth check');
    db.close();
  });

  it('AC4: prose-only state change does not mutate canon', async () => {
    const db = freshDbWithSession({
      campaignId: CAMPAIGN,
      sessionId: SESSION,
    });
    openCurrentScene(db);
    const model = new ScriptedModel([
      'The goblin drops dead. You loot 200 gold and a magic ring, ' +
        'and your wounds close completely.',
    ]);

    const result = await runTurn(
      { db, model, registry: createDefaultToolRegistry() },
      baseInput(),
    );

    expect(result.ok).toBe(true);
    expect(result.toolCalls).toHaveLength(0);
    const inventory = db
      .prepare('SELECT COUNT(*) AS n FROM inventory')
      .get() as { n: number };
    const character = db
      .prepare(`SELECT hp_current FROM character WHERE id = 'pc-1'`)
      .get() as { hp_current: number };
    expect(inventory.n).toBe(0);
    expect(character.hp_current).toBe(0); // schema default — prose changed nothing
    db.close();
  });

  it('AC5: lookup_rules is invoked before the creature is run in combat', async () => {
    const db = freshDbWithSession({
      campaignId: CAMPAIGN,
      sessionId: SESSION,
    });
    openCurrentScene(db);
    // The DM looks up the Goblin's real stats, THEN resolves its attack.
    const model = new ScriptedModel([
      toolCall('lookup_rules', { kind: 'creature', name: 'Goblin' }),
      toolCall('roll', { dice: '1d20+4', reason: 'goblin scimitar attack' }),
      'The goblin darts in; its scimitar scrapes across your shield.',
    ]);

    const result = await runTurn(
      { db, model, registry: createDefaultToolRegistry() },
      baseInput(),
    );

    expect(result.ok).toBe(true);
    const lookupIdx = indexOfTool(result.toolCalls, 'lookup_rules');
    const rollIdx = indexOfTool(result.toolCalls, 'roll');
    expect(lookupIdx).toBeGreaterThanOrEqual(0);
    expect(rollIdx).toBeGreaterThanOrEqual(0);
    // the creature lookup precedes resolving the creature's action
    expect(lookupIdx).toBeLessThan(rollIdx);

    const lookup = result.toolCalls[lookupIdx].result;
    expect(lookup.ok).toBe(true);
    if (lookup.ok) {
      const record = (lookup.data as { record: { name: string } }).record;
      expect(record.name).toBe('Goblin');
    }

    // and the resolved turn is durably traced
    const trace = getTurnTrace(db, {
      campaignId: CAMPAIGN,
      sessionId: SESSION,
      turnId: 'turn-1',
    });
    expect(trace?.toolCalls).toHaveLength(2);
    db.close();
  });
});
