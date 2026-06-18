import { describe, expect, it } from 'vitest';
import type {
  Db,
  ModelClient,
  ModelCompleteInput,
  ModelCompleteResult,
} from '../src/internal.js';
import {
  createDefaultToolRegistry,
  ensureCharacterRow,
  getTurnFailureDiagnostic,
  getTurnTrace,
  listSceneLog,
  mutateState,
  openScene,
  runTurn,
} from '../src/internal.js';
import { freshDbWithSession } from './support/db.js';

const CAMPAIGN = 'campaign-1';
const SESSION = 'session-1';

/** A ModelClient that replays a fixed script of replies, one per call. */
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

/** A ModelClient that always throws — simulates an SDK/model failure. */
class FailingModel implements ModelClient {
  constructor(private readonly error = new Error('model unavailable')) {}
  complete(): Promise<ModelCompleteResult> {
    return Promise.reject(this.error);
  }
}

/** A ModelClient that replays structured provider results. */
class StructuredScriptedModel implements ModelClient {
  private index = 0;
  readonly seen: ModelCompleteInput[] = [];
  constructor(private readonly results: ModelCompleteResult[]) {}
  complete(input: ModelCompleteInput): Promise<ModelCompleteResult> {
    this.seen.push(input);
    const result = this.results[this.index] ?? { text: '' };
    this.index += 1;
    return Promise.resolve(result);
  }
}

function withOpenScene(db: Db): void {
  openScene(db, {
    campaignId: CAMPAIGN,
    sessionId: SESSION,
    sceneId: 'scene-0',
    title: 'The Tavern',
    at: '2026-05-20T09:00:00.000Z',
  });
}

const toolCall = (tool: string, args: unknown): string =>
  ['```tool_call', JSON.stringify({ tool, args }), '```'].join('\n');

function baseInput(overrides: Record<string, unknown> = {}) {
  return {
    campaignId: CAMPAIGN,
    sessionId: SESSION,
    turnId: 'turn-1',
    playerInput: 'I look around the tavern.',
    seed: 42,
    at: '2026-05-20T10:00:00.000Z',
    ...overrides,
  };
}

describe('orchestrator turn loop', () => {
  it('runs a full turn: model called, tool executed, narration + scene_log', async () => {
    const db = freshDbWithSession();
    withOpenScene(db);
    const model = new ScriptedModel([
      toolCall('roll', { dice: '1d20+2', reason: 'perception' }),
      'You scan the room. The barkeep meets your eye and nods.',
    ]);

    const result = await runTurn(
      { db, model, registry: createDefaultToolRegistry() },
      baseInput(),
    );

    expect(result.ok).toBe(true);
    expect(result.narration).toContain('barkeep');
    expect(result.toolCalls.map((c) => c.tool)).toEqual(['roll']);
    expect(result.toolCalls[0].result.ok).toBe(true);

    const log = listSceneLog(db, {
      campaignId: CAMPAIGN,
      sessionId: SESSION,
      sceneId: 'scene-0',
    });
    expect(log.map((e) => e.role)).toEqual(['player', 'dm']);
    expect(log[0].content).toBe('I look around the tavern.');

    const trace = getTurnTrace(db, {
      campaignId: CAMPAIGN,
      sessionId: SESSION,
      turnId: 'turn-1',
    });
    expect(trace?.finalNarration).toContain('barkeep');
    db.close();
  });

  it('does not mutate canon when the model changes state in prose only', async () => {
    const db = freshDbWithSession();
    withOpenScene(db);
    const model = new ScriptedModel([
      'A gleaming +1 longsword appears in your pack. You now have 500 gold.',
    ]);

    const result = await runTurn(
      { db, model, registry: createDefaultToolRegistry() },
      baseInput(),
    );

    expect(result.ok).toBe(true);
    expect(result.toolCalls).toHaveLength(0);
    const inventory = db
      .prepare('SELECT COUNT(*) AS n FROM inventory')
      .get() as {
      n: number;
    };
    expect(inventory.n).toBe(0);
    db.close();
  });

  it('mutates canon when the model uses a domain mutation tool', async () => {
    const db = freshDbWithSession();
    withOpenScene(db);
    db.prepare(
      `UPDATE character SET hp_max = 20, hp_current = 15 WHERE id = 'pc-1'`,
    ).run();
    const model = new ScriptedModel([
      toolCall('adjust_hp', { amount: -3 }),
      'You bandage your wounds and feel steadier.',
    ]);

    const result = await runTurn(
      { db, model, registry: createDefaultToolRegistry() },
      baseInput(),
    );

    expect(result.ok).toBe(true);
    const row = db
      .prepare(`SELECT hp_current FROM character WHERE id = 'pc-1'`)
      .get() as { hp_current: number };
    expect(row.hp_current).toBe(12);
    db.close();
  });

  it('feeds a structured tool error back to the model and still completes', async () => {
    const db = freshDbWithSession();
    withOpenScene(db);
    const model = new ScriptedModel([
      toolCall('adjust_hp', { amount: 'not_a_number' }),
      'You reconsider and simply step forward.',
    ]);

    const result = await runTurn(
      { db, model, registry: createDefaultToolRegistry() },
      baseInput(),
    );

    expect(result.ok).toBe(true);
    expect(result.toolCalls[0].result.ok).toBe(false);
    // The second model call received the tool_result error.
    expect(model.seen).toHaveLength(2);
    expect(model.seen[1].messages.at(-1)?.content).toContain('tool_result');
    db.close();
  });

  it('leaves pre-turn state intact when the model fails', async () => {
    const db = freshDbWithSession();
    withOpenScene(db);
    mutateState(db, {
      target: 'character',
      field: 'name',
      op: 'set',
      value: 'Mira',
      provenance: 'setup',
      sessionId: SESSION,
      at: '2026-05-20T09:00:00.000Z',
    });

    const result = await runTurn(
      { db, model: new FailingModel(), registry: createDefaultToolRegistry() },
      baseInput(),
    );

    expect(result.ok).toBe(false);
    const row = db
      .prepare(`SELECT name FROM character WHERE id = 'pc-1'`)
      .get() as {
      name: string;
    };
    expect(row.name).toBe('Mira');
    expect(
      listSceneLog(db, {
        campaignId: CAMPAIGN,
        sessionId: SESSION,
        sceneId: 'scene-0',
      }),
    ).toEqual([]);
    db.close();
  });

  it.each([
    { provider: 'Anthropic', callId: 'toolu_01ABC' },
    { provider: 'OpenAI', callId: 'call_01XYZ' },
  ])('executes a representative $provider native tool call and returns a correlated result', async ({
    callId,
  }) => {
    const db = freshDbWithSession();
    withOpenScene(db);
    db.prepare(
      `UPDATE character SET hp_max = 20, hp_current = 15 WHERE id = 'pc-1'`,
    ).run();
    const model = new StructuredScriptedModel([
      {
        text: 'You take a hard hit.',
        toolCalls: [{ id: callId, name: 'adjust_hp', args: { amount: -3 } }],
        stopReason: 'tool_use',
      },
      {
        text: 'Pain flashes through you, but you remain standing.',
        stopReason: 'end_turn',
      },
    ]);

    const result = await runTurn(
      { db, model, registry: createDefaultToolRegistry() },
      baseInput(),
    );

    expect(result.ok).toBe(true);
    expect(result.narration).toContain('remain standing');
    expect(result.toolCalls).toMatchObject([
      {
        tool: 'adjust_hp',
        args: { amount: -3 },
        source: 'native',
        callId,
        stopReason: 'tool_use',
        result: { ok: true },
      },
    ]);
    const row = db
      .prepare(`SELECT hp_current FROM character WHERE id = 'pc-1'`)
      .get() as { hp_current: number };
    expect(row.hp_current).toBe(12);

    const secondCall = model.seen[1];
    expect(secondCall.messages.at(-2)).toMatchObject({
      role: 'assistant',
      content: 'You take a hard hit.',
      stopReason: 'tool_use',
      toolCalls: [{ id: callId, name: 'adjust_hp' }],
    });
    expect(secondCall.messages.at(-1)).toMatchObject({
      role: 'user',
      toolResults: [
        {
          callId,
          name: 'adjust_hp',
          result: { ok: true },
        },
      ],
    });

    const trace = getTurnTrace(db, {
      campaignId: CAMPAIGN,
      sessionId: SESSION,
      turnId: 'turn-1',
    });
    expect(trace?.toolCalls[0]).toMatchObject({
      tool: 'adjust_hp',
      source: 'native',
      callId,
      stopReason: 'tool_use',
    });
    db.close();
  });

  it('does not accept narration when native toolCalls are present without a stop reason', async () => {
    const db = freshDbWithSession();
    withOpenScene(db);
    const model = new StructuredScriptedModel([
      {
        text: 'This is not final narration because a roll is still pending.',
        toolCalls: [
          {
            id: 'call_without_stop',
            name: 'roll',
            args: { dice: '1d20', reason: 'notice danger' },
          },
        ],
      },
      { text: 'You notice movement in the shadows.' },
    ]);

    const result = await runTurn(
      { db, model, registry: createDefaultToolRegistry() },
      baseInput(),
    );

    expect(result.ok).toBe(true);
    expect(result.narration).toBe('You notice movement in the shadows.');
    expect(result.toolCalls).toMatchObject([
      {
        tool: 'roll',
        source: 'native',
        callId: 'call_without_stop',
        result: { ok: true },
      },
    ]);
    expect(model.seen).toHaveLength(2);
    db.close();
  });

  it('executes native and fenced requests in one response before accepting narration', async () => {
    const db = freshDbWithSession();
    withOpenScene(db);
    db.prepare(
      `UPDATE character SET hp_max = 20, hp_current = 15 WHERE id = 'pc-1'`,
    ).run();
    const model = new StructuredScriptedModel([
      {
        text: [
          'The exchange is still being resolved.',
          toolCall('roll', { dice: '1d20+2', reason: 'resistance' }),
        ].join('\n'),
        toolCalls: [
          {
            id: 'call_mixed',
            name: 'adjust_hp',
            args: { amount: -2 },
          },
        ],
        stopReason: 'tool_use',
      },
      { text: 'You absorb the blow and recover your footing.' },
    ]);

    const result = await runTurn(
      { db, model, registry: createDefaultToolRegistry() },
      baseInput(),
    );

    expect(result.ok).toBe(true);
    expect(result.toolCalls.map((call) => call.source)).toEqual([
      'native',
      'fenced',
    ]);
    expect(result.toolCalls.map((call) => call.tool)).toEqual([
      'adjust_hp',
      'roll',
    ]);
    expect(model.seen[1].messages.at(-1)?.content).toContain('tool_result');
    expect(model.seen[1].messages.at(-1)?.toolResults).toMatchObject([
      { callId: 'call_mixed', name: 'adjust_hp' },
    ]);
    const row = db
      .prepare(`SELECT hp_current FROM character WHERE id = 'pc-1'`)
      .get() as { hp_current: number };
    expect(row.hp_current).toBe(13);
    db.close();
  });

  it('feeds malformed native arguments through the normal recoverable tool error path', async () => {
    const db = freshDbWithSession();
    withOpenScene(db);
    const model = new StructuredScriptedModel([
      {
        text: '',
        toolCalls: [
          {
            id: 'call_bad_args',
            name: 'adjust_hp',
            args: '{"amount":-3}',
          },
        ],
        stopReason: 'tool_use',
      },
      { text: 'You reconsider and hold your position.' },
    ]);

    const result = await runTurn(
      { db, model, registry: createDefaultToolRegistry() },
      baseInput(),
    );

    expect(result.ok).toBe(true);
    expect(result.toolCalls[0]).toMatchObject({
      tool: 'adjust_hp',
      source: 'native',
      callId: 'call_bad_args',
      result: { ok: false, code: 'invalid_args' },
    });
    expect(model.seen[1].messages.at(-1)?.toolResults).toMatchObject([
      {
        callId: 'call_bad_args',
        name: 'adjust_hp',
        result: { ok: false, code: 'invalid_args' },
      },
    ]);
    db.close();
  });

  it('rejects a stopReason="tool_use" result with no consumable native calls', async () => {
    const db = freshDbWithSession();
    withOpenScene(db);
    const model = new StructuredScriptedModel([
      {
        text: 'You ready your blade.',
        stopReason: 'tool_use',
      },
    ]);

    const result = await runTurn(
      { db, model, registry: createDefaultToolRegistry() },
      baseInput(),
    );

    expect(result.ok).toBe(false);
    expect(result.error).toContain(
      'stopReason="tool_use" without any consumable native tool calls',
    );
    db.close();
  });

  it('records a non-canon diagnostic when model failure rolls back turn writes', async () => {
    const db = freshDbWithSession();
    withOpenScene(db);
    const error = new Error('model unavailable api_key=sk-provider-secret');

    const result = await runTurn(
      {
        db,
        model: new FailingModel(error),
        registry: createDefaultToolRegistry(),
      },
      baseInput({ turnId: 'turn-model-failure' }),
    );

    expect(result.ok).toBe(false);
    expect(result.error).toContain('model unavailable');
    expect(result.error).toContain('[redacted]');
    expect(result.error).not.toContain('sk-provider-secret');
    expect(
      listSceneLog(db, {
        campaignId: CAMPAIGN,
        sessionId: SESSION,
        sceneId: 'scene-0',
      }),
    ).toEqual([]);
    expect(
      getTurnTrace(db, {
        campaignId: CAMPAIGN,
        sessionId: SESSION,
        turnId: 'turn-model-failure',
      }),
    ).toBeUndefined();

    const diagnostic = getTurnFailureDiagnostic(db, {
      campaignId: CAMPAIGN,
      sessionId: SESSION,
      turnId: 'turn-model-failure',
    });
    expect(diagnostic).toMatchObject({
      campaignId: CAMPAIGN,
      sessionId: SESSION,
      turnId: 'turn-model-failure',
      createdAt: '2026-05-20T10:00:00.000Z',
      phase: 'model_loop',
      errorName: 'Error',
      modelRounds: 1,
    });
    expect(diagnostic?.errorMessage).toContain('model unavailable');
    expect(diagnostic?.errorMessage).toContain('[redacted]');
    expect(diagnostic?.errorMessage).not.toContain('sk-provider-secret');
    db.close();
  });

  it('rolls back tool mutations applied before a later-round model failure', async () => {
    const db = freshDbWithSession();
    withOpenScene(db);
    db.prepare(
      `UPDATE character SET hp_max = 20, hp_current = 10 WHERE id = 'pc-1'`,
    ).run();

    // Round 1 applies a mutation, round 2 throws.
    let call = 0;
    const model: ModelClient = {
      complete(): Promise<ModelCompleteResult> {
        call += 1;
        if (call === 1) {
          return Promise.resolve({
            text: toolCall('adjust_hp', { amount: 5 }),
          });
        }
        return Promise.reject(new Error('model crashed mid-turn'));
      },
    };

    const result = await runTurn(
      { db, model, registry: createDefaultToolRegistry() },
      baseInput(),
    );

    expect(result.ok).toBe(false);
    const row = db
      .prepare(`SELECT hp_current FROM character WHERE id = 'pc-1'`)
      .get() as { hp_current: number };
    expect(row.hp_current).toBe(10); // pre-turn state — mutation rolled back
    db.close();
  });

  it('records a scene_summary when the model closes a scene', async () => {
    const db = freshDbWithSession();
    withOpenScene(db);
    // Give the closing scene some prior narration to summarize.
    const setup = new ScriptedModel(['The fire crackles as you settle in.']);
    await runTurn(
      { db, model: setup, registry: createDefaultToolRegistry() },
      baseInput({ turnId: 'turn-0' }),
    );

    const model = new ScriptedModel([
      toolCall('mark_scene', { boundary: 'close' }),
      'The night draws to a close.',
    ]);
    const result = await runTurn(
      { db, model, registry: createDefaultToolRegistry() },
      baseInput({ turnId: 'turn-1' }),
    );

    expect(result.ok).toBe(true);
    const summary = db
      .prepare(
        `SELECT summary FROM scene_summary
         WHERE campaign_id = ? AND session_id = ? AND scene_id = ?`,
      )
      .get(CAMPAIGN, SESSION, 'scene-0') as { summary: string } | undefined;
    expect(summary).toBeDefined();

    // The scene rollup is recorded as a memory update on the turn trace.
    const trace = getTurnTrace(db, {
      campaignId: CAMPAIGN,
      sessionId: SESSION,
      turnId: 'turn-1',
    });
    expect(trace?.memoryUpdates).toContainEqual({
      kind: 'scene_summary',
      sceneId: 'scene-0',
    });
    db.close();
  });

  it('records structured trace fields for a turn with roll and domain mutation', async () => {
    const db = freshDbWithSession();
    withOpenScene(db);
    db.prepare(
      `UPDATE character SET hp_max = 20, hp_current = 15 WHERE id = 'pc-1'`,
    ).run();
    const model = new ScriptedModel([
      toolCall('roll', { dice: '1d20+2', reason: 'perception' }),
      toolCall('adjust_hp', { amount: -6 }),
      'You steady yourself and take in the room.',
    ]);

    await runTurn(
      { db, model, registry: createDefaultToolRegistry() },
      baseInput(),
    );

    const trace = getTurnTrace(db, {
      campaignId: CAMPAIGN,
      sessionId: SESSION,
      turnId: 'turn-1',
    });
    expect(trace?.acceptedStateDelta).toHaveLength(1);
    expect(trace?.acceptedStateDelta[0]).toMatchObject({ amount: -6 });
    const rules = trace?.rulesResolution as {
      rolls: unknown[];
      rulesLookups: unknown[];
    };
    expect(rules.rolls).toHaveLength(1);
    expect(trace?.rejectedCandidates).toEqual([]);
    expect(trace?.qualityFlags).toEqual([]);
    db.close();
  });

  it('records rejected candidates and a quality flag when a tool call fails', async () => {
    const db = freshDbWithSession();
    withOpenScene(db);
    const model = new ScriptedModel([
      toolCall('adjust_hp', { amount: 'not_a_number' }),
      'The attempt comes to nothing.',
    ]);

    await runTurn(
      { db, model, registry: createDefaultToolRegistry() },
      baseInput(),
    );

    const trace = getTurnTrace(db, {
      campaignId: CAMPAIGN,
      sessionId: SESSION,
      turnId: 'turn-1',
    });
    expect(trace?.acceptedStateDelta).toEqual([]);
    expect(trace?.rejectedCandidates).toHaveLength(1);
    expect(trace?.rejectedCandidates[0]).toMatchObject({
      tool: 'adjust_hp',
    });
    expect(trace?.qualityFlags).toContain('tool_error');
    db.close();
  });

  it('persists the turn into a fallback scene when the model never marks one', async () => {
    const db = freshDbWithSession();
    // No withOpenScene, and the model narrates without calling mark_scene.
    const model = new ScriptedModel(['You step into the misty clearing.']);

    const result = await runTurn(
      { db, model, registry: createDefaultToolRegistry() },
      baseInput(),
    );

    expect(result.ok).toBe(true);
    expect(result.sceneId).toBeDefined();
    const log = listSceneLog(db, {
      campaignId: CAMPAIGN,
      sessionId: SESSION,
      sceneId: result.sceneId as string,
    });
    expect(log.map((e) => e.role)).toEqual(['player', 'dm']);
    expect(log[0].content).toBe('I look around the tavern.');
    expect(log[1].content).toBe('You step into the misty clearing.');
    db.close();
  });

  it('fails the turn when tool rounds are exhausted without narration', async () => {
    const db = freshDbWithSession();
    withOpenScene(db);
    // Always returns a tool call — never final narration.
    const model: ModelClient = {
      complete: () =>
        Promise.resolve({
          text: toolCall('roll', { dice: '1d6', reason: 'loop' }),
        }),
    };

    const result = await runTurn(
      { db, model, registry: createDefaultToolRegistry() },
      baseInput({ maxToolRounds: 3 }),
    );

    expect(result.ok).toBe(false);
    db.close();
  });

  it('records a protocol diagnostic while rolling back tool mutations', async () => {
    const db = freshDbWithSession();
    withOpenScene(db);
    db.prepare(
      `UPDATE character SET hp_max = 20, hp_current = 10 WHERE id = 'pc-1'`,
    ).run();
    const model: ModelClient = {
      complete: () =>
        Promise.resolve({
          text: toolCall('adjust_hp', { amount: 5 }),
        }),
    };

    const result = await runTurn(
      { db, model, registry: createDefaultToolRegistry() },
      baseInput({ maxToolRounds: 1, turnId: 'turn-protocol-failure' }),
    );

    expect(result.ok).toBe(false);
    const hp = db
      .prepare(`SELECT hp_current FROM character WHERE id = 'pc-1'`)
      .get() as { hp_current: number };
    expect(hp.hp_current).toBe(10);
    expect(
      getTurnTrace(db, {
        campaignId: CAMPAIGN,
        sessionId: SESSION,
        turnId: 'turn-protocol-failure',
      }),
    ).toBeUndefined();

    const diagnostic = getTurnFailureDiagnostic(db, {
      campaignId: CAMPAIGN,
      sessionId: SESSION,
      turnId: 'turn-protocol-failure',
    });
    expect(diagnostic).toMatchObject({
      phase: 'model_loop',
      errorName: 'OrchestratorError',
      modelRounds: 1,
    });
    expect(diagnostic?.errorMessage).toContain(
      'turn exceeded 1 tool rounds without final narration',
    );
    db.close();
  });

  it('is deterministic under a fixed seed', async () => {
    const run = async (): Promise<unknown> => {
      const db = freshDbWithSession();
      withOpenScene(db);
      const model = new ScriptedModel([
        toolCall('roll', { dice: '4d8+3', reason: 'damage' }),
        'The blow lands hard.',
      ]);
      const result = await runTurn(
        { db, model, registry: createDefaultToolRegistry() },
        baseInput({ seed: 777 }),
      );
      db.close();
      return result.toolCalls[0].result;
    };
    expect(await run()).toEqual(await run());
  });

  it('rejects a non-PC actingCharacterId without writing a trace or mutating canon', async () => {
    const db = freshDbWithSession();
    withOpenScene(db);
    db.prepare(
      "UPDATE character SET hp_max = 20, hp_current = 20 WHERE id = 'pc-1'",
    ).run();
    ensureCharacterRow(
      db,
      'comp-1',
      'test',
      SESSION,
      '2026-05-20T09:00:00.000Z',
    );
    db.prepare(
      "UPDATE character SET role = 'companion' WHERE id = 'comp-1'",
    ).run();

    // The model would damage the acting PC — but the turn must fail before any
    // tool runs because comp-1 is not a player character.
    const model = new ScriptedModel([
      toolCall('adjust_hp', { amount: -5 }),
      'The companion is hurt.',
    ]);

    const result = await runTurn(
      { db, model, registry: createDefaultToolRegistry() },
      baseInput({ actingCharacterId: 'comp-1' }),
    );

    expect(result.ok).toBe(false);
    expect(result.error).toContain('not a player character');
    // Model never invoked, no trace written, HP unchanged.
    expect(model.seen).toHaveLength(0);
    expect(
      getTurnTrace(db, {
        campaignId: CAMPAIGN,
        sessionId: SESSION,
        turnId: 'turn-1',
      }),
    ).toBeUndefined();
    const hp = db
      .prepare("SELECT hp_current FROM character WHERE id = 'pc-1'")
      .get() as { hp_current: number };
    expect(hp.hp_current).toBe(20);
    db.close();
  });

  it('accepts a valid non-active PC as the acting character', async () => {
    const db = freshDbWithSession();
    withOpenScene(db);
    ensureCharacterRow(db, 'pc-2', 'test', SESSION, '2026-05-20T09:00:00.000Z');
    const model = new ScriptedModel(['You step forward, blade ready.']);

    const result = await runTurn(
      { db, model, registry: createDefaultToolRegistry() },
      baseInput({ actingCharacterId: 'pc-2' }),
    );

    expect(result.ok).toBe(true);
    const trace = getTurnTrace(db, {
      campaignId: CAMPAIGN,
      sessionId: SESSION,
      turnId: 'turn-1',
    });
    expect(trace?.actingCharacterId).toBe('pc-2');
    db.close();
  });

  it('executes a native roll tool call and feeds the result back before final narration (eshyra-eznk)', async () => {
    const db = freshDbWithSession();
    withOpenScene(db);
    const model = new StructuredScriptedModel([
      {
        text: 'You swing at the goblin.',
        toolCalls: [
          {
            id: 'toolu_roll',
            name: 'roll',
            args: { dice: '1d20+5', reason: 'attack roll' },
          },
        ],
        stopReason: 'tool_use',
      },
      { text: 'Your blade bites deep.', stopReason: 'end_turn' },
    ]);

    const result = await runTurn(
      { db, model, registry: createDefaultToolRegistry() },
      baseInput(),
    );

    expect(result.ok).toBe(true);
    expect(result.narration).toBe('Your blade bites deep.');
    // The deterministic dice tool ran and produced a numeric total.
    expect(result.toolCalls).toMatchObject([
      {
        tool: 'roll',
        source: 'native',
        callId: 'toolu_roll',
        result: { ok: true },
      },
    ]);
    const rollData = result.toolCalls[0].result as {
      ok: true;
      data: { total: number };
    };
    expect(typeof rollData.data.total).toBe('number');

    // The second model call received the executed roll as a native tool result.
    const secondCall = model.seen[1];
    expect(secondCall.messages.at(-1)).toMatchObject({
      role: 'user',
      toolResults: [
        { callId: 'toolu_roll', name: 'roll', result: { ok: true } },
      ],
    });
    db.close();
  });

  it('records provider-executed (Agent SDK MCP) tool calls without re-running them (eshyra-eznk)', async () => {
    const db = freshDbWithSession();
    withOpenScene(db);
    // Simulate the Agent SDK MCP adapter: it ran `roll` in-process via the
    // executeTool bridge and reports the executed call + final narration in one
    // complete() result. The sentinel total (99) is not a value the real dice
    // tool could have produced for this seed, so seeing it back proves the
    // orchestrator recorded the provider's result rather than re-executing.
    const model = new StructuredScriptedModel([
      {
        text: 'The blow lands hard.',
        executedToolCalls: [
          {
            name: 'roll',
            args: { dice: '1d20+5', reason: 'attack roll' },
            result: { ok: true, data: { total: 99 } },
          },
        ],
        stopReason: 'end_turn',
      },
    ]);

    const result = await runTurn(
      { db, model, registry: createDefaultToolRegistry() },
      baseInput(),
    );

    expect(result.ok).toBe(true);
    expect(result.narration).toBe('The blow lands hard.');
    // Exactly one model round: the provider drove its own tool loop internally.
    expect(model.seen).toHaveLength(1);
    // The provider also received the executeTool bridge to delegate through.
    expect(model.seen[0].executeTool).toBeTypeOf('function');
    expect(result.toolCalls).toEqual([
      {
        tool: 'roll',
        args: { dice: '1d20+5', reason: 'attack roll' },
        result: { ok: true, data: { total: 99 } },
        source: 'native-mcp',
        stopReason: 'end_turn',
      },
    ]);
    db.close();
  });

  it('drives released gameplay with native tool prompting, not fenced-text, when tools are provided (eshyra-eznk)', async () => {
    const db = freshDbWithSession();
    withOpenScene(db);
    const model = new ScriptedModel(['You survey the room.']);

    const result = await runTurn(
      { db, model, registry: createDefaultToolRegistry() },
      // No explicit toolProtocol: the released default must be native.
      baseInput(),
    );

    expect(result.ok).toBe(true);
    const firstCall = model.seen[0];
    // The core handed the model the provider-neutral tool definitions...
    expect((firstCall.tools ?? []).map((t) => t.name)).toContain('roll');
    // ...and the system prompt uses the native tool interface, not the legacy
    // fenced ```tool_call protocol.
    expect(firstCall.system).toBeDefined();
    expect(firstCall.system).not.toContain('```tool_call');
    expect(firstCall.system).toContain('native tool interface');
    db.close();
  });

  it('still honors the fenced legacy prompt path when explicitly requested', async () => {
    const db = freshDbWithSession();
    withOpenScene(db);
    const model = new ScriptedModel(['You survey the room.']);

    await runTurn(
      { db, model, registry: createDefaultToolRegistry() },
      baseInput({ toolProtocol: 'fenced' }),
    );

    expect(model.seen[0].system).toContain('```tool_call');
    db.close();
  });
});
