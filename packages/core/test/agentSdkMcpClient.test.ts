import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Offline unit coverage for AgentSdkMcpModelClient (eshyra-eznk).
 *
 * The Agent SDK is mocked so the adapter's real logic runs deterministically with
 * no network/subprocess: converting Eshyra tool definitions into in-process MCP
 * tools, mapping Eshyra <-> `mcp__eshyra__*` names, delegating tool handlers to
 * the deterministic executor bridge (never reimplementing gameplay), and
 * configuring `query()` with `mcpServers` / `allowedTools` / `tools: []`. No test
 * here makes a live model call.
 *
 * The mocks are thin: `tool()` captures (name, description, schema, handler);
 * `createSdkMcpServer()` echoes its options (with the captured tools); `query()`
 * is driven per-test so a test can simulate the model invoking a tool by calling
 * the captured handler off the server it was handed.
 */

const { queryMock, toolMock, createServerMock } = vi.hoisted(() => ({
  queryMock: vi.fn(),
  toolMock: vi.fn(
    (
      name: string,
      description: string,
      inputSchema: unknown,
      handler: unknown,
    ) => ({
      name,
      description,
      inputSchema,
      handler,
    }),
  ),
  createServerMock: vi.fn((opts: unknown) => ({
    ...(opts as Record<string, unknown>),
    instance: {},
  })),
}));

vi.mock('@anthropic-ai/claude-agent-sdk', () => ({
  query: queryMock,
  tool: toolMock,
  createSdkMcpServer: createServerMock,
}));

import type { ModelCallDebugEvent } from '../src/debug/sessionDebug.js';
import {
  AGENT_SDK_MCP_CLIENT_NAME,
  AGENT_SDK_MCP_TOOL_PROTOCOL,
  AgentSdkMcpModelClient,
  fromMcpToolName,
  toMcpToolName,
} from '../src/model/agentSdkMcpClient.js';
import type {
  ModelToolExecutionResult,
  ModelToolExecutor,
} from '../src/model/client.js';
import { ModelClientError } from '../src/model/client.js';
import type { ModelToolDefinition } from '../src/model/toolSchema.js';

interface CapturedTool {
  name: string;
  description: string;
  inputSchema: unknown;
  handler: (args: unknown, extra: unknown) => Promise<unknown>;
}

interface QueryArg {
  prompt: string;
  options: {
    model: string;
    systemPrompt?: string;
    mcpServers: Record<string, { tools: CapturedTool[] }>;
    allowedTools: string[];
    tools: unknown;
    env: Record<string, string>;
  };
}

/** A collecting {@link import('../src/debug/sessionDebug.js').SessionDebugSink}. */
function collectingSink(captureContent = false): {
  captureContent: boolean;
  record: (e: ModelCallDebugEvent) => void;
  events: ModelCallDebugEvent[];
} {
  const events: ModelCallDebugEvent[] = [];
  return { captureContent, record: (e) => events.push(e), events };
}

const rollDef: ModelToolDefinition = {
  name: 'roll',
  description: 'roll dice',
  inputSchema: {
    type: 'object',
    properties: {
      dice: { type: 'string' },
      reason: { type: 'string' },
    },
    required: ['dice'],
    additionalProperties: false,
  },
};

const worldQueryDef: ModelToolDefinition = {
  name: 'world_query',
  description: 'resolve world facts',
  inputSchema: {
    type: 'object',
    properties: { ref: { type: 'string' } },
    required: ['ref'],
    additionalProperties: false,
  },
};

/**
 * Build a fake SDK stream. Yields an init system message (with MCP server
 * status), optionally drives the captured tool handlers to simulate the model
 * calling tools, then yields the final success result.
 */
function driveSdk(options: {
  arg: QueryArg;
  serverStatus?: { name: string; status: string }[];
  calls?: { tool: string; args: unknown }[];
  result?: string;
  stopReason?: string;
}): AsyncGenerator<unknown> {
  return (async function* () {
    yield {
      type: 'system',
      subtype: 'init',
      mcp_servers: options.serverStatus ?? [
        { name: 'eshyra', status: 'connected' },
      ],
      tools: [],
    };
    for (const call of options.calls ?? []) {
      const server = options.arg.options.mcpServers.eshyra;
      const t = server.tools.find((x) => x.name === call.tool);
      if (t === undefined) throw new Error(`no such tool ${call.tool}`);
      await t.handler(call.args, {});
    }
    yield {
      type: 'result',
      subtype: 'success',
      result: options.result ?? 'You act.',
      stop_reason: options.stopReason ?? 'end_turn',
    };
  })();
}

/** An executor spy that returns a fixed deterministic result. */
function executorReturning(
  result: ModelToolExecutionResult,
): ModelToolExecutor & { calls: { name: string; args: unknown }[] } {
  const calls: { name: string; args: unknown }[] = [];
  const fn = ((call: { name: string; args: unknown }) => {
    calls.push({ name: call.name, args: call.args });
    return result;
  }) as ModelToolExecutor & { calls: { name: string; args: unknown }[] };
  fn.calls = calls;
  return fn;
}

describe('MCP tool-name mapping', () => {
  it('maps an Eshyra name to the generated MCP name', () => {
    expect(toMcpToolName('roll')).toBe('mcp__eshyra__roll');
    expect(toMcpToolName('world_query')).toBe('mcp__eshyra__world_query');
  });

  it('recovers the Eshyra name from a generated MCP name', () => {
    expect(fromMcpToolName('mcp__eshyra__roll')).toBe('roll');
    expect(fromMcpToolName('mcp__eshyra__world_query')).toBe('world_query');
  });

  it('returns undefined for a non-eshyra MCP name (no false match)', () => {
    expect(fromMcpToolName('mcp__other__roll')).toBeUndefined();
    expect(fromMcpToolName('Bash')).toBeUndefined();
  });

  it('round-trips every Eshyra name through both directions', () => {
    for (const name of ['roll', 'world_query', 'mark_scene', 'adjust_hp']) {
      expect(fromMcpToolName(toMcpToolName(name))).toBe(name);
    }
  });
});

describe('AgentSdkMcpModelClient', () => {
  beforeEach(() => {
    queryMock.mockReset();
    toolMock.mockClear();
    createServerMock.mockClear();
  });

  it('converts each tool definition into an MCP tool() under the eshyra server', async () => {
    queryMock.mockImplementation((arg: QueryArg) => driveSdk({ arg }));

    await new AgentSdkMcpModelClient('claude-test').complete({
      system: 'be a DM',
      messages: [{ role: 'user', content: 'go' }],
      tools: [rollDef, worldQueryDef],
      executeTool: executorReturning({ ok: true, data: {} }),
    });

    // tool() was called once per definition with the bare Eshyra name.
    expect(toolMock).toHaveBeenCalledTimes(2);
    expect(toolMock.mock.calls.map((c) => c[0])).toEqual([
      'roll',
      'world_query',
    ]);
    // The server is named `eshyra` and carries those tools.
    const serverArg = createServerMock.mock.calls[0][0] as {
      name: string;
      tools: CapturedTool[];
    };
    expect(serverArg.name).toBe('eshyra');
    expect(serverArg.tools.map((t) => t.name)).toEqual(['roll', 'world_query']);
  });

  it('configures query with mcpServers, allowedTools (mcp names), and no built-in tools', async () => {
    queryMock.mockImplementation((arg: QueryArg) => driveSdk({ arg }));

    await new AgentSdkMcpModelClient('claude-test').complete({
      system: 'be a DM',
      messages: [{ role: 'user', content: 'go' }],
      tools: [rollDef, worldQueryDef],
      executeTool: executorReturning({ ok: true, data: {} }),
    });

    const arg = queryMock.mock.calls[0][0] as QueryArg;
    expect(Object.keys(arg.options.mcpServers)).toEqual(['eshyra']);
    expect(arg.options.allowedTools).toEqual([
      'mcp__eshyra__roll',
      'mcp__eshyra__world_query',
    ]);
    // Built-in Claude Code tools removed from gameplay context.
    expect(arg.options.tools).toEqual([]);
    // Tool search disabled so the small tool set loads upfront.
    expect(arg.options.env.ENABLE_TOOL_SEARCH).toBe('false');
  });

  it('delegates tool handlers to the executor bridge and records executed calls', async () => {
    const executor = executorReturning({ ok: true, data: { total: 17 } });
    queryMock.mockImplementation((arg: QueryArg) =>
      driveSdk({
        arg,
        calls: [{ tool: 'roll', args: { dice: '1d20+5', reason: 'attack' } }],
        result: 'Your blade strikes true.',
      }),
    );

    const out = await new AgentSdkMcpModelClient('claude-test').complete({
      messages: [{ role: 'user', content: 'attack' }],
      tools: [rollDef],
      executeTool: executor,
    });

    // The handler called the executor with the Eshyra name + args — the adapter
    // did NOT reimplement the roll.
    expect(executor.calls).toEqual([
      { name: 'roll', args: { dice: '1d20+5', reason: 'attack' } },
    ]);
    // The executed call is surfaced for the trace, under the Eshyra name.
    expect(out.executedToolCalls).toEqual([
      {
        name: 'roll',
        args: { dice: '1d20+5', reason: 'attack' },
        result: { ok: true, data: { total: 17 } },
      },
    ]);
    expect(out.text).toBe('Your blade strikes true.');
  });

  it('returns a tool error as an MCP result without crashing the loop', async () => {
    const executor = executorReturning({
      ok: false,
      code: 'invalid_args',
      message: 'bad dice',
    });
    let handlerResult: { isError?: boolean } | undefined;
    queryMock.mockImplementation((arg: QueryArg) =>
      (async function* () {
        yield { type: 'system', subtype: 'init', mcp_servers: [], tools: [] };
        const t = arg.options.mcpServers.eshyra.tools[0];
        handlerResult = (await t.handler({ dice: '??' }, {})) as {
          isError?: boolean;
        };
        yield {
          type: 'result',
          subtype: 'success',
          result: 'It fizzles.',
          stop_reason: 'end_turn',
        };
      })(),
    );

    const out = await new AgentSdkMcpModelClient('m').complete({
      messages: [{ role: 'user', content: 'x' }],
      tools: [rollDef],
      executeTool: executor,
    });

    expect(handlerResult?.isError).toBe(true);
    expect(out.text).toBe('It fizzles.');
    expect(out.executedToolCalls?.[0].result).toEqual({
      ok: false,
      code: 'invalid_args',
      message: 'bad dice',
    });
  });

  it('throws ModelClientError when the stream ends without a result', async () => {
    queryMock.mockImplementation(() =>
      (async function* () {
        yield { type: 'system', subtype: 'init', mcp_servers: [], tools: [] };
      })(),
    );

    await expect(
      new AgentSdkMcpModelClient('m').complete({
        messages: [{ role: 'user', content: 'x' }],
        tools: [rollDef],
        executeTool: executorReturning({ ok: true, data: {} }),
      }),
    ).rejects.toThrowError(ModelClientError);
  });

  describe('provider-auth seam (subscription path, no API key required)', () => {
    it('injects an OAuth subscription token into the SDK env, merged over process.env', async () => {
      queryMock.mockImplementation((arg: QueryArg) => driveSdk({ arg }));
      process.env.ESHYRA_MCP_AMBIENT = 'ambient';
      try {
        await new AgentSdkMcpModelClient('m', {
          env: { CLAUDE_CODE_OAUTH_TOKEN: 'oauth-sub-token' },
        }).complete({
          messages: [{ role: 'user', content: 'hi' }],
          tools: [rollDef],
          executeTool: executorReturning({ ok: true, data: {} }),
        });
      } finally {
        Reflect.deleteProperty(process.env, 'ESHYRA_MCP_AMBIENT');
      }
      const arg = queryMock.mock.calls[0][0] as QueryArg;
      expect(arg.options.env.CLAUDE_CODE_OAUTH_TOKEN).toBe('oauth-sub-token');
      expect(arg.options.env.ESHYRA_MCP_AMBIENT).toBe('ambient');
    });

    it('confines the secret to options.env — never the prompt or model', async () => {
      queryMock.mockImplementation((arg: QueryArg) => driveSdk({ arg }));
      const secret = 'oauth-DO-NOT-LEAK';
      await new AgentSdkMcpModelClient('claude-test', {
        env: { CLAUDE_CODE_OAUTH_TOKEN: secret },
      }).complete({
        system: 'be a DM',
        messages: [{ role: 'user', content: 'go' }],
        tools: [rollDef],
        executeTool: executorReturning({ ok: true, data: {} }),
      });
      const arg = queryMock.mock.calls[0][0] as QueryArg;
      const { env: _env, ...optionsWithoutEnv } = arg.options;
      expect(
        JSON.stringify({ prompt: arg.prompt, options: optionsWithoutEnv }),
      ).not.toContain(secret);
    });

    it('does not expose the auth source via enumeration or JSON serialization', () => {
      const secret = 'oauth-DO-NOT-LEAK';
      const client = new AgentSdkMcpModelClient('m', {
        env: { CLAUDE_CODE_OAUTH_TOKEN: secret },
      });
      expect(Object.keys(client)).toEqual([]);
      expect(JSON.stringify(client)).not.toContain(secret);
    });
  });

  describe('opt-in session debug logging', () => {
    it('reports the agent-sdk-mcp protocol, MCP names, and server status — never fenced', async () => {
      queryMock.mockImplementation((arg: QueryArg) =>
        driveSdk({
          arg,
          serverStatus: [{ name: 'eshyra', status: 'connected' }],
          result: 'You stride forward.',
        }),
      );
      const sink = collectingSink();

      await new AgentSdkMcpModelClient('claude-test', undefined, {
        debug: sink,
        profile: 'premium_dm',
        tier: 'premium',
        authMode: 'oauth-token',
      }).complete({
        system: '## Persona\nbe a DM',
        messages: [{ role: 'user', content: '## Player Input\ngo' }],
        tools: [rollDef, worldQueryDef],
        executeTool: executorReturning({ ok: true, data: {} }),
        trace: {
          campaignId: 'c1',
          sessionId: 's1',
          turnId: 't1',
          extra: { purpose: 'turn_model_loop', round: '1' },
        },
      });

      expect(sink.events).toHaveLength(1);
      const ev = sink.events[0];
      expect(ev.toolProtocolMode).toBe(AGENT_SDK_MCP_TOOL_PROTOCOL);
      expect(ev.toolProtocolMode).not.toBe('fenced-text');
      expect(ev.clientName).toBe(AGENT_SDK_MCP_CLIENT_NAME);
      // Core handed Eshyra names; the adapter forwarded the generated MCP names.
      expect(ev.providedToolNames).toEqual(['roll', 'world_query']);
      expect(ev.forwardedToolNames).toEqual([
        'mcp__eshyra__roll',
        'mcp__eshyra__world_query',
      ]);
      expect(ev.mcpServers).toEqual([{ name: 'eshyra', status: 'connected' }]);
      expect(ev.authMode).toBe('oauth-token');
    });

    it('records a redacted failure event when the SDK call throws', async () => {
      queryMock.mockImplementation(() => {
        throw new Error('connect failed using Bearer oauth-leak-me');
      });
      const sink = collectingSink();

      await expect(
        new AgentSdkMcpModelClient('m', undefined, { debug: sink }).complete({
          messages: [{ role: 'user', content: 'x' }],
          tools: [rollDef],
          executeTool: executorReturning({ ok: true, data: {} }),
        }),
      ).rejects.toThrowError(/connect failed/);

      const outcome = sink.events[0].outcome as { ok: false; error: string };
      expect(outcome.ok).toBe(false);
      expect(outcome.error).not.toContain('oauth-leak-me');
      expect(outcome.error).toContain('[redacted]');
    });
  });
});
