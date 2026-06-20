import { describe, expect, it } from 'vitest';
import type {
  AuditVerdict,
  Db,
  ModelClient,
  ModelCompleteInput,
  ModelCompleteResult,
  ProviderExecutedToolCall,
  SessionDebugSink,
  ToolUsageRecord,
  TurnAuditDebugEvent,
  TurnAuditInput,
  TurnAuditor,
  TurnCandidateDispositionEvent,
  TurnDiagnosticsSink,
  TurnOutcomeRecord,
} from '../src/internal.js';
import {
  createDefaultToolRegistry,
  ensureCharacterRow,
  getTurnFailureDiagnostic,
  getTurnTrace,
  listSceneLog,
  ModelRateLimitError,
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
        // roll writes no canon — classified non-mutating (eshyra-dwkm).
        mutates: false,
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

/** A {@link TurnAuditor} replaying a scripted sequence of verdicts. */
class ScriptedAuditor implements TurnAuditor {
  private index = 0;
  readonly seen: TurnAuditInput[] = [];
  readonly modelId = 'claude-audit-test';
  constructor(private readonly verdicts: AuditVerdict[]) {}
  audit(input: TurnAuditInput): Promise<AuditVerdict> {
    this.seen.push(input);
    const verdict = this.verdicts[this.index] ?? {
      verdict: 'accept',
      missingRequiredTools: [],
      missingRequiredCalls: [],
      disallowedToolCalls: [],
      reason: '',
      repairInstruction: '',
    };
    this.index += 1;
    return Promise.resolve(verdict);
  }
}

const accept: AuditVerdict = {
  verdict: 'accept',
  missingRequiredTools: [],
  missingRequiredCalls: [],
  disallowedToolCalls: [],
  reason: 'ok',
  repairInstruction: '',
};
const rejectRoll: AuditVerdict = {
  verdict: 'reject',
  missingRequiredTools: ['roll'],
  missingRequiredCalls: [{ tool: 'roll' }],
  disallowedToolCalls: [],
  reason: 'dice asserted without roll',
  repairInstruction: 'Call the roll tool before narrating the result.',
};

function collectingAuditSink(): SessionDebugSink & {
  audits: TurnAuditDebugEvent[];
} {
  const audits: TurnAuditDebugEvent[] = [];
  return {
    captureContent: false,
    record: () => {},
    recordAudit: (e) => audits.push(e),
    audits,
  };
}

describe('orchestrator mechanics-audit gate (eshyra-oobh)', () => {
  it('accepts a candidate whose mechanical claim is backed by an executed tool', async () => {
    const db = freshDbWithSession();
    withOpenScene(db);
    const model = new StructuredScriptedModel([
      {
        text: 'You strike for 11.',
        executedToolCalls: [
          {
            name: 'roll',
            args: { dice: '2d8' },
            result: { ok: true, data: { total: 11 } },
          },
        ],
        stopReason: 'end_turn',
      },
    ]);
    const auditor = new ScriptedAuditor([accept]);

    const result = await runTurn(
      { db, model, registry: createDefaultToolRegistry(), auditor },
      baseInput(),
    );

    expect(result.ok).toBe(true);
    expect(result.narration).toBe('You strike for 11.');
    // The auditor saw the executed (MCP) roll as evidence.
    expect(auditor.seen[0].executedToolCalls.map((c) => c.tool)).toEqual([
      'roll',
    ]);
    expect(auditor.seen[0].executedToolCalls[0].source).toBe('native-mcp');
    const trace = getTurnTrace(db, {
      campaignId: CAMPAIGN,
      sessionId: SESSION,
      turnId: 'turn-1',
    });
    expect(trace?.finalNarration).toBe('You strike for 11.');
    db.close();
  });

  it('accepts a purely narrative response with no mechanical claim', async () => {
    const db = freshDbWithSession();
    withOpenScene(db);
    const model = new ScriptedModel(['The tavern is warm and loud.']);
    const auditor = new ScriptedAuditor([accept]);

    const result = await runTurn(
      { db, model, registry: createDefaultToolRegistry(), auditor },
      baseInput(),
    );

    expect(result.ok).toBe(true);
    expect(auditor.seen).toHaveLength(1);
    db.close();
  });

  it('rejects an improvised dice result, retries once, and accepts the repaired candidate', async () => {
    const db = freshDbWithSession();
    withOpenScene(db);
    // 1st candidate: improvised dice, no tool. 2nd candidate: rolls properly.
    const model = new StructuredScriptedModel([
      { text: 'You rolled an 11 on 2d8.', stopReason: 'end_turn' },
      {
        text: 'The dice land: 11 total.',
        executedToolCalls: [
          {
            name: 'roll',
            args: { dice: '2d8' },
            result: { ok: true, data: { total: 11 } },
          },
        ],
        stopReason: 'end_turn',
      },
    ]);
    const auditor = new ScriptedAuditor([rejectRoll, accept]);
    const sink = collectingAuditSink();

    const result = await runTurn(
      {
        db,
        model,
        registry: createDefaultToolRegistry(),
        auditor,
        debug: sink,
      },
      baseInput(),
    );

    expect(result.ok).toBe(true);
    // Only the repaired candidate is shown/persisted.
    expect(result.narration).toBe('The dice land: 11 total.');
    const log = listSceneLog(db, {
      campaignId: CAMPAIGN,
      sessionId: SESSION,
      sceneId: 'scene-0',
    });
    const dmLines = log.filter((e) => e.role === 'dm').map((e) => e.content);
    expect(dmLines).toEqual(['The dice land: 11 total.']);
    expect(dmLines).not.toContain('You rolled an 11 on 2d8.');
    // The retry received a corrective note naming the missing tool.
    expect(model.seen).toHaveLength(2);
    expect(model.seen[1].messages[0].content).toContain('Correction Required');
    expect(model.seen[1].messages[0].content).toContain('roll');
    // Debug recorded both verdicts with their actions.
    expect(sink.audits.map((a) => `${a.verdict}:${a.action}`)).toEqual([
      'reject:retry',
      'accept:accept',
    ]);
    expect(sink.audits[0].missingRequiredTools).toEqual(['roll']);
    expect(sink.audits[0].auditorModel).toBe('claude-audit-test');
    db.close();
  });

  it('reports a target-specific missing lookup even when the tool was already executed (eshyra-znzn)', async () => {
    const db = freshDbWithSession();
    withOpenScene(db);
    // Candidate 1 DID call lookup_rules once (for armor generically) but asserts
    // stats for three specific records without looking each up. Candidate 2 is
    // accepted. This is the session-mqkis411-rlsh20 shape: the same tool is both
    // executed AND missing — coarse tool-name-only diagnostics looked
    // contradictory; the target-specific verdict explains which records were missed.
    const model = new StructuredScriptedModel([
      {
        text: 'Your chain mail (AC 16), shield (+2 AC), and longsword (1d8) are ready.',
        executedToolCalls: [
          {
            name: 'lookup_rules',
            args: { kind: 'equipment', name: 'armor' },
            result: { ok: true, data: { name: 'armor' } },
          },
        ],
        stopReason: 'end_turn',
      },
      {
        text: 'Your gear is confirmed against the rules.',
        executedToolCalls: [
          {
            name: 'lookup_rules',
            args: { kind: 'equipment', name: 'chain mail' },
            result: { ok: true, data: { name: 'chain mail' } },
          },
        ],
        stopReason: 'end_turn',
      },
    ]);
    const rejectTargets: AuditVerdict = {
      verdict: 'reject',
      missingRequiredTools: ['lookup_rules'],
      missingRequiredCalls: [
        { tool: 'lookup_rules', target: 'chain mail' },
        { tool: 'lookup_rules', target: 'shield' },
        { tool: 'lookup_rules', target: 'longsword' },
      ],
      disallowedToolCalls: [],
      reason: 'stats asserted for specific records without per-record lookups',
      repairInstruction:
        'Look up chain mail, shield, and longsword before narrating.',
    };
    const auditor = new ScriptedAuditor([rejectTargets, accept]);
    const sink = collectingAuditSink();

    const result = await runTurn(
      {
        db,
        model,
        registry: createDefaultToolRegistry(),
        auditor,
        debug: sink,
      },
      baseInput(),
    );

    expect(result.ok).toBe(true);
    // (1) A tool may have been executed and still be missing a specific target:
    // the rejected candidate's executed call includes lookup_rules, yet the
    // verdict still reports lookup_rules missing for three specific records.
    expect(auditor.seen[0].executedToolCalls.map((c) => c.tool)).toEqual([
      'lookup_rules',
    ]);
    expect(sink.audits[0].missingRequiredCalls).toEqual([
      { tool: 'lookup_rules', target: 'chain mail' },
      { tool: 'lookup_rules', target: 'shield' },
      { tool: 'lookup_rules', target: 'longsword' },
    ]);
    // (2) Debug output does not misleadingly imply the tool was never called:
    // the SAME tool appears in both the executed list and the missing list, and
    // the missing entries carry the targets that explain why.
    expect(sink.audits[0].executedToolNames).toContain('lookup_rules');
    expect(sink.audits[0].missingRequiredTools).toEqual(['lookup_rules']);
    // (3) The retry's corrective note carries the target-specific requirements,
    // not just the (already-satisfied) tool name.
    const retryNote = model.seen[1].messages[0].content;
    expect(retryNote).toContain('Correction Required');
    expect(retryNote).toContain('lookup_rules (target: chain mail)');
    expect(retryNote).toContain('lookup_rules (target: shield)');
    expect(retryNote).toContain('lookup_rules (target: longsword)');
    db.close();
  });

  it('fails the turn (rolling everything back) when the retry also fails audit', async () => {
    const db = freshDbWithSession();
    withOpenScene(db);
    const model = new ScriptedModel([
      'You rolled an 11 on 2d8.',
      'You still rolled an 11.',
    ]);
    const auditor = new ScriptedAuditor([rejectRoll, rejectRoll]);
    const sink = collectingAuditSink();

    const result = await runTurn(
      {
        db,
        model,
        registry: createDefaultToolRegistry(),
        auditor,
        debug: sink,
      },
      baseInput(),
    );

    expect(result.ok).toBe(false);
    expect(result.narration).toBe('');
    // Neither rejected candidate reached the scene log / turn trace.
    const log = listSceneLog(db, {
      campaignId: CAMPAIGN,
      sessionId: SESSION,
      sceneId: 'scene-0',
    });
    expect(log.filter((e) => e.role === 'dm')).toHaveLength(0);
    expect(
      getTurnTrace(db, {
        campaignId: CAMPAIGN,
        sessionId: SESSION,
        turnId: 'turn-1',
      }),
    ).toBeUndefined();
    // The second verdict's action is the terminal failure.
    expect(sink.audits.map((a) => a.action)).toEqual(['retry', 'fail']);
    db.close();
  });

  it('does not audit when no auditor is wired (legacy/test path)', async () => {
    const db = freshDbWithSession();
    withOpenScene(db);
    const model = new ScriptedModel(['You rolled an 11 with no tool.']);

    const result = await runTurn(
      { db, model, registry: createDefaultToolRegistry() },
      baseInput(),
    );

    // Without an auditor the candidate is accepted unconditionally.
    expect(result.ok).toBe(true);
    expect(result.narration).toBe('You rolled an 11 with no tool.');
    db.close();
  });
});

/**
 * One scripted round of the Agent SDK MCP path: the tools to run in-process
 * through the executeTool bridge, the final narration, and whether the
 * provider call throws AFTER running them (a provider session/rate limit).
 */
interface McpRound {
  readonly calls: ReadonlyArray<{ name: string; args: unknown }>;
  readonly text: string;
  readonly throwAfter?: boolean;
}

/**
 * Faithful stand-in for {@link AgentSdkMcpModelClient}: each `complete()`
 * ACTUALLY drives the deterministic tools through the `executeTool` bridge —
 * mutating canon inside the per-attempt SAVEPOINT exactly as the real adapter
 * does — then reports them as `executedToolCalls`. The pre-existing MCP test
 * fabricates results without touching the bridge, so it never exercises the
 * staged-mutation rollback this models (eshyra-dwkm).
 */
class BridgeMcpModel implements ModelClient {
  private index = 0;
  readonly seen: ModelCompleteInput[] = [];
  constructor(private readonly rounds: readonly McpRound[]) {}
  async complete(input: ModelCompleteInput): Promise<ModelCompleteResult> {
    this.seen.push(input);
    const round = this.rounds[this.index] ?? { calls: [], text: '' };
    this.index += 1;
    const executed: ProviderExecutedToolCall[] = [];
    const { executeTool } = input;
    for (const c of round.calls) {
      if (executeTool === undefined) {
        throw new Error('BridgeMcpModel requires an executeTool bridge');
      }
      // Same bridge the real adapter's in-process MCP handlers call.
      const result = await executeTool({ name: c.name, args: c.args });
      executed.push({ name: c.name, args: c.args, result });
    }
    if (round.throwAfter) {
      throw new Error('Agent SDK MCP call failed: provider session limit');
    }
    return {
      text: round.text,
      ...(executed.length > 0 ? { executedToolCalls: executed } : {}),
      stopReason: 'end_turn',
    };
  }
}

function inventoryIds(db: Db): string[] {
  return (
    db.prepare('SELECT id FROM inventory ORDER BY id').all() as Array<{
      id: string;
    }>
  ).map((r) => r.id);
}

function collectingDispositionSink(): SessionDebugSink & {
  dispositions: TurnCandidateDispositionEvent[];
} {
  const dispositions: TurnCandidateDispositionEvent[] = [];
  return {
    captureContent: false,
    record: () => {},
    recordCandidateDisposition: (e) => dispositions.push(e),
    dispositions,
  };
}

const rejectGiveItem: AuditVerdict = {
  verdict: 'reject',
  missingRequiredTools: [],
  missingRequiredCalls: [],
  disallowedToolCalls: ['give_item'],
  reason: 'mutated state for a read-style question',
  repairInstruction: 'Answer without mutating inventory.',
};

describe('orchestrator MCP staged-mutation transactionality (eshyra-dwkm)', () => {
  it('mutating MCP tool executes, auditor rejects, retry succeeds: only the accepted retry mutation persists', async () => {
    const db = freshDbWithSession();
    withOpenScene(db);
    // Candidate 1 wrongly grabs a sword (rejected); the repaired retry equips a
    // shield (accepted). Only the shield must survive.
    const model = new BridgeMcpModel([
      {
        calls: [{ name: 'give_item', args: { id: 'sword', name: 'Sword' } }],
        text: 'A sword appears.',
      },
      {
        calls: [{ name: 'give_item', args: { id: 'shield', name: 'Shield' } }],
        text: 'You ready your shield.',
      },
    ]);
    const auditor = new ScriptedAuditor([rejectGiveItem, accept]);

    const result = await runTurn(
      { db, model, registry: createDefaultToolRegistry(), auditor },
      baseInput(),
    );

    expect(result.ok).toBe(true);
    expect(result.narration).toBe('You ready your shield.');
    // The rejected candidate's give_item('sword') was rolled back; only the
    // accepted retry's give_item('shield') persists.
    expect(inventoryIds(db)).toEqual(['shield']);
    db.close();
  });

  it('mutating MCP tool executes, auditor rejects, retry fails (provider limit): no candidate mutation persists', async () => {
    const db = freshDbWithSession();
    withOpenScene(db);
    // Reproduces session-mqkis411-rlsh20: a read-style question triggers an
    // inventory mutation, the auditor rejects it, and the retry dies on a
    // provider session limit. Nothing the rejected/failed candidates wrote may
    // survive — "your last input was not applied" must be literally true.
    const model = new BridgeMcpModel([
      {
        calls: [{ name: 'give_item', args: { id: 'sword', name: 'Sword' } }],
        text: 'A sword appears.',
      },
      {
        calls: [{ name: 'give_item', args: { id: 'sword', name: 'Sword' } }],
        text: '',
        throwAfter: true,
      },
    ]);
    const auditor = new ScriptedAuditor([rejectGiveItem]);

    const result = await runTurn(
      { db, model, registry: createDefaultToolRegistry(), auditor },
      baseInput({ playerInput: 'What am I equipped with?' }),
    );

    expect(result.ok).toBe(false);
    // Both the rejected candidate AND the failed retry were discarded.
    expect(inventoryIds(db)).toEqual([]);
    // The failed turn is not written to the scene log or trace.
    expect(
      listSceneLog(db, {
        campaignId: CAMPAIGN,
        sessionId: SESSION,
        sceneId: 'scene-0',
      }).filter((e) => e.role === 'dm'),
    ).toHaveLength(0);
    expect(
      getTurnTrace(db, {
        campaignId: CAMPAIGN,
        sessionId: SESSION,
        turnId: 'turn-1',
      }),
    ).toBeUndefined();
    db.close();
  });

  it('read-only MCP tool needs no staged-mutation handling: accepted with no canon write', async () => {
    const db = freshDbWithSession();
    withOpenScene(db);
    const model = new BridgeMcpModel([
      {
        calls: [
          { name: 'roll', args: { dice: '1d20', reason: 'recall lore' } },
        ],
        text: 'You recall the sigil.',
      },
    ]);
    const auditor = new ScriptedAuditor([accept]);

    const result = await runTurn(
      { db, model, registry: createDefaultToolRegistry(), auditor },
      baseInput(),
    );

    expect(result.ok).toBe(true);
    // The roll is classified non-mutating, so there is nothing to stage.
    expect(result.toolCalls).toHaveLength(1);
    expect(result.toolCalls[0]).toMatchObject({ tool: 'roll', mutates: false });
    expect(inventoryIds(db)).toEqual([]);
    db.close();
  });

  it('records staged → committed and staged → rolled-back dispositions in debug traces', async () => {
    const db = freshDbWithSession();
    withOpenScene(db);
    const model = new BridgeMcpModel([
      {
        calls: [{ name: 'give_item', args: { id: 'sword', name: 'Sword' } }],
        text: 'A sword appears.',
      },
      {
        calls: [{ name: 'give_item', args: { id: 'shield', name: 'Shield' } }],
        text: 'You ready your shield.',
      },
    ]);
    const auditor = new ScriptedAuditor([rejectGiveItem, accept]);
    const sink = collectingDispositionSink();

    await runTurn(
      {
        db,
        model,
        registry: createDefaultToolRegistry(),
        auditor,
        debug: sink,
      },
      baseInput(),
    );

    // Attempt 1 rolled back (audit rejected), attempt 2 committed (accepted).
    expect(
      sink.dispositions.map((d) => `${d.disposition}:${d.reason}`),
    ).toEqual(['rolled_back:audit_rejected', 'committed:accepted']);
    expect(sink.dispositions[0]).toMatchObject({
      attempt: 1,
      mutatingToolCount: 1,
      toolCalls: [{ tool: 'give_item', mutates: true, ok: true }],
    });
    expect(sink.dispositions[1]).toMatchObject({
      attempt: 2,
      mutatingToolCount: 1,
    });
    db.close();
  });

  it('records a turn-error rollback disposition when a retry fails (eshyra-dwkm)', async () => {
    const db = freshDbWithSession();
    withOpenScene(db);
    const model = new BridgeMcpModel([
      {
        calls: [{ name: 'give_item', args: { id: 'sword', name: 'Sword' } }],
        text: 'A sword appears.',
      },
      { calls: [], text: '', throwAfter: true },
    ]);
    const auditor = new ScriptedAuditor([rejectGiveItem]);
    const sink = collectingDispositionSink();

    const result = await runTurn(
      {
        db,
        model,
        registry: createDefaultToolRegistry(),
        auditor,
        debug: sink,
      },
      baseInput(),
    );

    expect(result.ok).toBe(false);
    // The rejected candidate's rollback, then the turn-level error rollback.
    expect(sink.dispositions.map((d) => d.reason)).toEqual([
      'audit_rejected',
      'turn_error',
    ]);
    expect(
      sink.dispositions.every((d) => d.disposition === 'rolled_back'),
    ).toBe(true);
    db.close();
  });
});

/** Collecting turn-diagnostics sink for tool spans + outcomes (eshyra-17ng). */
function collectingDiagnosticsSink(): TurnDiagnosticsSink & {
  tools: ToolUsageRecord[];
  outcomes: TurnOutcomeRecord[];
} {
  const tools: ToolUsageRecord[] = [];
  const outcomes: TurnOutcomeRecord[] = [];
  return {
    tools,
    outcomes,
    recordTool: (e) => tools.push(e),
    recordOutcome: (e) => outcomes.push(e),
  };
}

/** A ModelClient that rejects every call with a provider rate-limit error. */
class RateLimitModel implements ModelClient {
  complete(): Promise<ModelCompleteResult> {
    return Promise.reject(new ModelRateLimitError('429 rate limited', 30));
  }
}

describe('orchestrator per-turn timing diagnostics (eshyra-17ng)', () => {
  it('records per-tool spans and an accepted outcome for a successful audited turn', async () => {
    const db = freshDbWithSession();
    withOpenScene(db);
    // Two MCP tool calls in one round: a read-only roll and a mutating give_item.
    const model = new BridgeMcpModel([
      {
        calls: [
          { name: 'roll', args: { dice: '1d20', reason: 'perception' } },
          { name: 'give_item', args: { id: 'torch', name: 'Torch' } },
        ],
        text: 'You light a torch and scan the room.',
      },
    ]);
    const auditor = new ScriptedAuditor([accept]);
    const diagnostics = collectingDiagnosticsSink();

    const result = await runTurn(
      {
        db,
        model,
        registry: createDefaultToolRegistry(),
        auditor,
        diagnostics,
      },
      baseInput(),
    );

    expect(result.ok).toBe(true);
    // Each MCP tool call is timed individually with its Eshyra name + transport.
    expect(diagnostics.tools.map((t) => t.tool)).toEqual(['roll', 'give_item']);
    expect(diagnostics.tools.map((t) => t.source)).toEqual([
      'native-mcp',
      'native-mcp',
    ]);
    // read-only vs mutating is captured from the registry classification.
    expect(diagnostics.tools.map((t) => t.mutates)).toEqual([false, true]);
    expect(
      diagnostics.tools.every(
        (t) =>
          t.attempt === 1 &&
          t.round === 1 &&
          t.ok === true &&
          typeof t.elapsedMs === 'number',
      ),
    ).toBe(true);
    expect(diagnostics.outcomes).toHaveLength(1);
    expect(diagnostics.outcomes[0]).toMatchObject({
      outcome: 'accepted',
      attempts: 1,
      modelRounds: 1,
      reason: null,
    });
    db.close();
  });

  it('records distinct attempt spans for a rejected-then-retried turn', async () => {
    const db = freshDbWithSession();
    withOpenScene(db);
    const model = new BridgeMcpModel([
      {
        calls: [{ name: 'give_item', args: { id: 'sword', name: 'Sword' } }],
        text: 'A sword appears.',
      },
      {
        calls: [{ name: 'give_item', args: { id: 'shield', name: 'Shield' } }],
        text: 'You ready your shield.',
      },
    ]);
    const auditor = new ScriptedAuditor([rejectGiveItem, accept]);
    const diagnostics = collectingDiagnosticsSink();

    const result = await runTurn(
      {
        db,
        model,
        registry: createDefaultToolRegistry(),
        auditor,
        diagnostics,
      },
      baseInput(),
    );

    expect(result.ok).toBe(true);
    // The rejected attempt's tool and the accepted retry's tool are separate
    // spans, distinguishable by attempt number.
    expect(diagnostics.tools.map((t) => `${t.attempt}:${t.tool}`)).toEqual([
      '1:give_item',
      '2:give_item',
    ]);
    expect(diagnostics.outcomes[0]).toMatchObject({
      outcome: 'accepted',
      attempts: 2,
    });
    db.close();
  });

  it('records a provider_limit outcome with the failed attempt and elapsed time', async () => {
    const db = freshDbWithSession();
    withOpenScene(db);
    const diagnostics = collectingDiagnosticsSink();

    const result = await runTurn(
      {
        db,
        model: new RateLimitModel(),
        registry: createDefaultToolRegistry(),
        diagnostics,
      },
      baseInput(),
    );

    expect(result.ok).toBe(false);
    expect(result.isRateLimit).toBe(true);
    expect(diagnostics.outcomes).toHaveLength(1);
    expect(diagnostics.outcomes[0]).toMatchObject({
      outcome: 'provider_limit',
      attempts: 1,
    });
    // The failed attempt's elapsed time and a (redacted) reason are recorded.
    expect(diagnostics.outcomes[0].reason).not.toBeNull();
    expect(diagnostics.outcomes[0].elapsedMs).toBeGreaterThanOrEqual(0);
    db.close();
  });

  it('records a failed_after_reject outcome when both candidates fail audit', async () => {
    const db = freshDbWithSession();
    withOpenScene(db);
    const model = new ScriptedModel([
      'You rolled an 11 on 2d8.',
      'You still rolled an 11.',
    ]);
    const auditor = new ScriptedAuditor([rejectRoll, rejectRoll]);
    const diagnostics = collectingDiagnosticsSink();

    const result = await runTurn(
      {
        db,
        model,
        registry: createDefaultToolRegistry(),
        auditor,
        diagnostics,
      },
      baseInput(),
    );

    expect(result.ok).toBe(false);
    expect(diagnostics.outcomes[0]).toMatchObject({
      outcome: 'failed_after_reject',
      attempts: 2,
    });
    db.close();
  });

  it('does not record any diagnostics when no sink is wired', async () => {
    const db = freshDbWithSession();
    withOpenScene(db);
    const model = new ScriptedModel(['The tavern is quiet.']);
    // No diagnostics in deps — must run exactly as before.
    const result = await runTurn(
      { db, model, registry: createDefaultToolRegistry() },
      baseInput(),
    );
    expect(result.ok).toBe(true);
    db.close();
  });
});
