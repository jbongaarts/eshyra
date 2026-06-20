import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Offline unit coverage for CodexSdkMcpModelClient (eshyra-jl8n).
 *
 * `@openai/codex-sdk` is mocked so the adapter's real logic runs with no codex
 * CLI / network: building the sterile CLI config + environment, configuring the
 * in-process MCP server pointer, mapping the streamed Codex events onto the
 * neutral ModelClient result, and classifying errors. The in-process MCP HTTP
 * server really starts (and is torn down) but the mock Codex never connects to
 * it, so these tests assert wiring + mapping; the round-trip tool execution is
 * covered by codexMcpHttpServer.test.ts.
 */

interface CodexCtorOptions {
  env?: Record<string, string>;
  config?: Record<string, unknown>;
}

const state = vi.hoisted(() => ({
  ctorOptions: [] as CodexCtorOptions[],
  threadOptions: [] as Record<string, unknown>[],
  prompts: [] as string[],
  events: [] as unknown[],
  runError: undefined as unknown,
  streamError: undefined as unknown,
}));

vi.mock('@openai/codex-sdk', () => {
  class Codex {
    constructor(options: CodexCtorOptions) {
      state.ctorOptions.push(options);
    }
    startThread(options: Record<string, unknown>) {
      state.threadOptions.push(options);
      return {
        async runStreamed(prompt: string) {
          state.prompts.push(prompt);
          if (state.runError !== undefined) {
            throw state.runError;
          }
          const events = state.events;
          return {
            events: (async function* () {
              for (const e of events) {
                yield e;
              }
              if (state.streamError !== undefined) {
                throw state.streamError;
              }
            })(),
          };
        },
      };
    }
  }
  return { Codex };
});

import type { ModelCallDebugEvent } from '../src/debug/sessionDebug.js';
import type {
  ModelToolExecutionResult,
  ProviderExecutedToolCall,
} from '../src/model/client.js';
import { ModelClientError, ModelRateLimitError } from '../src/model/client.js';
import {
  attachCallIds,
  bareToolName,
  CODEX_SDK_MCP_ADAPTER_CAPABILITIES,
  CODEX_SDK_MCP_CLIENT_NAME,
  CODEX_SDK_MCP_TOOL_PROTOCOL,
  CodexSdkMcpModelClient,
} from '../src/model/codexSdkMcpClient.js';
import type { ModelToolDefinition } from '../src/model/toolSchema.js';

/** Build a minimal Codex `mcp_tool_call` item for correlation tests. */
function toolCallItem(id: string, tool: string, server = 'eshyra') {
  return {
    id,
    type: 'mcp_tool_call' as const,
    server,
    tool,
    arguments: {},
    status: 'completed' as const,
  };
}

/** Build an executed-call record (deterministic result is irrelevant here). */
function executedCall(name: string): ProviderExecutedToolCall {
  const result: ModelToolExecutionResult = { ok: true, data: {} };
  return { name, args: {}, result };
}

const rollDef: ModelToolDefinition = {
  name: 'roll',
  description: 'roll dice',
  inputSchema: {
    type: 'object',
    properties: { dice: { type: 'string' } },
    required: ['dice'],
    additionalProperties: false,
  },
};

function collectingSink(captureContent = false): {
  captureContent: boolean;
  record: (e: ModelCallDebugEvent) => void;
  events: ModelCallDebugEvent[];
} {
  const events: ModelCallDebugEvent[] = [];
  return { captureContent, record: (e) => events.push(e), events };
}

function successEvents(text = 'You act.', usage?: unknown): unknown[] {
  return [
    { type: 'turn.started' },
    { type: 'item.completed', item: { id: 'a1', type: 'agent_message', text } },
    {
      type: 'turn.completed',
      usage: usage ?? {
        input_tokens: 10,
        cached_input_tokens: 2,
        output_tokens: 5,
        reasoning_output_tokens: 1,
      },
    },
  ];
}

const baseInput = {
  messages: [{ role: 'user' as const, content: 'go' }],
  tools: [rollDef],
};

describe('CodexSdkMcpModelClient', () => {
  beforeEach(() => {
    state.ctorOptions.length = 0;
    state.threadOptions.length = 0;
    state.prompts.length = 0;
    state.events = successEvents();
    state.runError = undefined;
    state.streamError = undefined;
  });

  afterEach(() => {
    Reflect.deleteProperty(process.env, 'OPENAI_API_KEY');
  });

  it('declares agent-harness / agent-mcp / openai / gameplay-capable capabilities (ADR 0010)', () => {
    const client = new CodexSdkMcpModelClient('gpt-5.5');
    expect(client.capabilities).toEqual(CODEX_SDK_MCP_ADAPTER_CAPABILITIES);
    expect(client.capabilities.adapterFamily).toBe('agent-harness');
    expect(client.capabilities.toolTransport).toBe('agent-mcp');
    expect(client.capabilities.turnLoopOwner).toBe('provider-harness');
    expect(client.capabilities.vendor).toBe('openai');
    expect(client.capabilities.gameplayCapable).toBe(true);
  });

  it('requires and pre-approves the in-process MCP server and suppresses AGENTS.md', async () => {
    await new CodexSdkMcpModelClient('gpt-5.5').complete(baseInput);
    const config = state.ctorOptions[0].config as {
      mcp_servers: {
        eshyra: {
          url: string;
          bearer_token_env_var: string;
          required: boolean;
          default_tools_approval_mode: string;
        };
      };
      project_doc_max_bytes: number;
    };
    expect(config.mcp_servers.eshyra.url).toMatch(
      /^http:\/\/127\.0\.0\.1:\d+\/mcp$/,
    );
    expect(config.mcp_servers.eshyra.bearer_token_env_var).toBe(
      'ESHYRA_MCP_TOKEN',
    );
    expect(config.mcp_servers.eshyra.required).toBe(true);
    expect(config.mcp_servers.eshyra.default_tools_approval_mode).toBe(
      'approve',
    );
    // No project instructions (AGENTS.md) load into gameplay context.
    expect(config.project_doc_max_bytes).toBe(0);
    expect(config).not.toHaveProperty('experimental_use_rmcp_client');
  });

  it('strips an ambient OPENAI_API_KEY and injects the MCP bearer token', async () => {
    process.env.OPENAI_API_KEY = 'sk-must-not-bill';
    await new CodexSdkMcpModelClient('gpt-5.5').complete(baseInput);
    const env = state.ctorOptions[0].env ?? {};
    // Subscription billing is exclusive: the API key never reaches the CLI.
    expect('OPENAI_API_KEY' in env).toBe(false);
    expect(env.ESHYRA_MCP_TOKEN).toMatch(/^[0-9a-f]{64}$/);
  });

  it('does not configure an empty required MCP server for tool-less calls', async () => {
    await new CodexSdkMcpModelClient('gpt-5.4-mini').complete({
      messages: [{ role: 'user', content: 'audit this turn' }],
      tools: [],
    });

    expect(state.ctorOptions[0].config).not.toHaveProperty('mcp_servers');
  });

  it('runs a sterile, read-only, network/web-disabled thread in a temp workdir', async () => {
    await new CodexSdkMcpModelClient('gpt-5.5').complete(baseInput);
    const opts = state.threadOptions[0];
    expect(opts.model).toBe('gpt-5.5');
    expect(opts.sandboxMode).toBe('read-only');
    expect(opts.skipGitRepoCheck).toBe(true);
    expect(opts.networkAccessEnabled).toBe(false);
    expect(opts.webSearchEnabled).toBe(false);
    expect(opts.approvalPolicy).toBe('never');
    expect(String(opts.workingDirectory)).not.toContain('/eshyra/.worktrees');
  });

  it('returns the final agent message, end_turn stop reason, and mapped usage', async () => {
    const out = await new CodexSdkMcpModelClient('gpt-5.5').complete({
      ...baseInput,
      system: 'be a DM',
    });
    expect(out.text).toBe('You act.');
    expect(out.stopReason).toBe('end_turn');
    expect(out.usage).toEqual({
      inputTokens: 10,
      outputTokens: 5,
      cacheReadTokens: 2,
    });
    // System + messages are flattened into the single Codex prompt.
    expect(state.prompts[0]).toBe('be a DM\n\nuser: go');
  });

  it('throws ModelClientError when the turn ends without an agent message', async () => {
    state.events = [{ type: 'turn.completed', usage: null }];
    await expect(
      new CodexSdkMcpModelClient('gpt-5.5').complete(baseInput),
    ).rejects.toThrowError(ModelClientError);
  });

  it('classifies a usage-limit turn failure as ModelRateLimitError', async () => {
    state.events = [
      { type: 'turn.failed', error: { message: 'You hit your usage limit' } },
    ];
    await expect(
      new CodexSdkMcpModelClient('gpt-5.5').complete(baseInput),
    ).rejects.toBeInstanceOf(ModelRateLimitError);
  });

  it('reports a subscription auth failure clearly with no API-key fallback', async () => {
    state.runError = new Error('Not logged in. Please run codex login');
    const err = await new CodexSdkMcpModelClient('gpt-5.5')
      .complete(baseInput)
      .catch((e) => e);
    expect(err).toBeInstanceOf(ModelClientError);
    expect(err).not.toBeInstanceOf(ModelRateLimitError);
    expect(err.message).toContain('codex login');
  });

  it('reports a clear edition error when the Codex SDK is not installed', async () => {
    state.runError = Object.assign(
      new Error("Cannot find package '@openai/codex-sdk'"),
      { code: 'ERR_MODULE_NOT_FOUND' },
    );
    const err = await new CodexSdkMcpModelClient('gpt-5.5')
      .complete(baseInput)
      .catch((e) => e);
    expect(err).toBeInstanceOf(ModelClientError);
    expect(err.message).toMatch(/codex.*edition|edition.*Codex/i);
  });

  it('does not classify a generic connection failure as a rate limit', async () => {
    state.runError = new Error('connect ECONNREFUSED 127.0.0.1:1');
    const err = await new CodexSdkMcpModelClient('gpt-5.5')
      .complete(baseInput)
      .catch((e) => e);
    expect(err).toBeInstanceOf(ModelClientError);
    expect(err).not.toBeInstanceOf(ModelRateLimitError);
  });

  it('preserves a streamed provider failure when the CLI later exits nonzero', async () => {
    state.events = [
      {
        type: 'item.completed',
        item: {
          id: 'warning',
          type: 'error',
          message: 'Model metadata not found; using fallback metadata.',
        },
      },
      {
        type: 'error',
        message:
          "The 'gpt-5-codex' model is not supported when using Codex with a ChatGPT account.",
      },
      {
        type: 'turn.failed',
        error: {
          message:
            "The 'gpt-5-codex' model is not supported when using Codex with a ChatGPT account.",
        },
      },
    ];
    state.streamError = new Error(
      'Codex Exec exited with code 1: Reading prompt from stdin...',
    );

    const err = await new CodexSdkMcpModelClient('gpt-5.5')
      .complete(baseInput)
      .catch((e) => e);

    expect(err).toBeInstanceOf(ModelClientError);
    expect(err.message).toContain('not supported when using Codex');
    expect(err.message).not.toContain('Reading prompt from stdin');
  });

  describe('opt-in session debug logging', () => {
    it('records the codex-mcp protocol, forwarded MCP names, and server status', async () => {
      const sink = collectingSink();
      await new CodexSdkMcpModelClient('gpt-5.5', {
        debug: sink,
        profile: 'premium_dm',
        tier: 'premium',
      }).complete({
        ...baseInput,
        trace: { campaignId: 'c1', extra: { purpose: 'turn_model_loop' } },
      });

      expect(sink.events).toHaveLength(1);
      const ev = sink.events[0];
      expect(ev.toolProtocolMode).toBe(CODEX_SDK_MCP_TOOL_PROTOCOL);
      expect(ev.toolProtocolMode).not.toBe('fenced-text');
      expect(ev.clientName).toBe(CODEX_SDK_MCP_CLIENT_NAME);
      expect(ev.providedToolNames).toEqual(['roll']);
      expect(ev.forwardedToolNames).toEqual(['mcp__eshyra__roll']);
      expect(ev.mcpServers).toEqual([{ name: 'eshyra', status: 'connected' }]);
      expect(ev.authMode).toBe('codex-subscription');
    });

    it('records a failure event for a failed turn', async () => {
      state.events = [{ type: 'turn.failed', error: { message: 'boom' } }];
      const sink = collectingSink();
      await new CodexSdkMcpModelClient('gpt-5.5', { debug: sink })
        .complete(baseInput)
        .catch(() => {});
      const outcome = sink.events[0].outcome as { ok: false; error: string };
      expect(outcome.ok).toBe(false);
      expect(outcome.error).toContain('boom');
    });
  });
});

describe('bareToolName (namespace-tolerant tool-name recovery)', () => {
  it('returns a bare tool name unchanged', () => {
    expect(bareToolName(toolCallItem('c', 'roll'))).toBe('roll');
  });

  it('strips the mcp__<server>__ namespace Codex may report', () => {
    expect(bareToolName(toolCallItem('c', 'mcp__eshyra__roll'))).toBe('roll');
  });

  it('strips <server>__ and <server>/ namespace forms', () => {
    expect(bareToolName(toolCallItem('c', 'eshyra__roll'))).toBe('roll');
    expect(bareToolName(toolCallItem('c', 'eshyra/roll'))).toBe('roll');
  });

  it('does not strip an unrelated server prefix', () => {
    expect(bareToolName(toolCallItem('c', 'mcp__other__roll'))).toBe(
      'mcp__other__roll',
    );
  });
});

describe('attachCallIds (transcript correlation, not execution)', () => {
  it('attaches ids by tool name in call order', () => {
    const out = attachCallIds(
      [executedCall('roll'), executedCall('roll'), executedCall('world_query')],
      [
        toolCallItem('id-roll-1', 'roll'),
        toolCallItem('id-roll-2', 'roll'),
        toolCallItem('id-wq', 'world_query'),
      ],
    );
    expect(out.map((c) => c.callId)).toEqual([
      'id-roll-1',
      'id-roll-2',
      'id-wq',
    ]);
  });

  it('correlates even when Codex reports namespaced tool labels', () => {
    const out = attachCallIds(
      [executedCall('roll')],
      [toolCallItem('id-1', 'mcp__eshyra__roll')],
    );
    expect(out[0].callId).toBe('id-1');
  });

  it('leaves a record without a matching item untouched', () => {
    const out = attachCallIds([executedCall('roll')], []);
    expect(out[0].callId).toBeUndefined();
  });
});
