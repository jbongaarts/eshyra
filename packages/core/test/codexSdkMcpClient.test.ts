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
            })(),
          };
        },
      };
    }
  }
  return { Codex };
});

import type { ModelCallDebugEvent } from '../src/debug/sessionDebug.js';
import { ModelClientError, ModelRateLimitError } from '../src/model/client.js';
import {
  CODEX_SDK_MCP_ADAPTER_CAPABILITIES,
  CODEX_SDK_MCP_CLIENT_NAME,
  CODEX_SDK_MCP_TOOL_PROTOCOL,
  CodexSdkMcpModelClient,
} from '../src/model/codexSdkMcpClient.js';
import type { ModelToolDefinition } from '../src/model/toolSchema.js';

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
  });

  afterEach(() => {
    Reflect.deleteProperty(process.env, 'OPENAI_API_KEY');
  });

  it('declares agent-harness / agent-mcp / openai / gameplay-capable capabilities (ADR 0010)', () => {
    const client = new CodexSdkMcpModelClient('gpt-5-codex');
    expect(client.capabilities).toEqual(CODEX_SDK_MCP_ADAPTER_CAPABILITIES);
    expect(client.capabilities.adapterFamily).toBe('agent-harness');
    expect(client.capabilities.toolTransport).toBe('agent-mcp');
    expect(client.capabilities.turnLoopOwner).toBe('provider-harness');
    expect(client.capabilities.vendor).toBe('openai');
    expect(client.capabilities.gameplayCapable).toBe(true);
  });

  it('points Codex at the in-process MCP server and suppresses AGENTS.md', async () => {
    await new CodexSdkMcpModelClient('gpt-5-codex').complete(baseInput);
    const config = state.ctorOptions[0].config as {
      mcp_servers: { eshyra: { url: string; bearer_token_env_var: string } };
      project_doc_max_bytes: number;
      experimental_use_rmcp_client: boolean;
    };
    expect(config.mcp_servers.eshyra.url).toMatch(
      /^http:\/\/127\.0\.0\.1:\d+\/mcp$/,
    );
    expect(config.mcp_servers.eshyra.bearer_token_env_var).toBe(
      'ESHYRA_MCP_TOKEN',
    );
    // No project instructions (AGENTS.md) load into gameplay context.
    expect(config.project_doc_max_bytes).toBe(0);
    expect(config.experimental_use_rmcp_client).toBe(true);
  });

  it('strips an ambient OPENAI_API_KEY and injects the MCP bearer token', async () => {
    process.env.OPENAI_API_KEY = 'sk-must-not-bill';
    await new CodexSdkMcpModelClient('gpt-5-codex').complete(baseInput);
    const env = state.ctorOptions[0].env ?? {};
    // Subscription billing is exclusive: the API key never reaches the CLI.
    expect('OPENAI_API_KEY' in env).toBe(false);
    expect(env.ESHYRA_MCP_TOKEN).toMatch(/^[0-9a-f]{64}$/);
  });

  it('runs a sterile, read-only, network/web-disabled thread in a temp workdir', async () => {
    await new CodexSdkMcpModelClient('gpt-5-codex').complete(baseInput);
    const opts = state.threadOptions[0];
    expect(opts.model).toBe('gpt-5-codex');
    expect(opts.sandboxMode).toBe('read-only');
    expect(opts.skipGitRepoCheck).toBe(true);
    expect(opts.networkAccessEnabled).toBe(false);
    expect(opts.webSearchEnabled).toBe(false);
    expect(opts.approvalPolicy).toBe('never');
    expect(String(opts.workingDirectory)).not.toContain('/eshyra/.worktrees');
  });

  it('returns the final agent message, end_turn stop reason, and mapped usage', async () => {
    const out = await new CodexSdkMcpModelClient('gpt-5-codex').complete({
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
      new CodexSdkMcpModelClient('gpt-5-codex').complete(baseInput),
    ).rejects.toThrowError(ModelClientError);
  });

  it('classifies a usage-limit turn failure as ModelRateLimitError', async () => {
    state.events = [
      { type: 'turn.failed', error: { message: 'You hit your usage limit' } },
    ];
    await expect(
      new CodexSdkMcpModelClient('gpt-5-codex').complete(baseInput),
    ).rejects.toBeInstanceOf(ModelRateLimitError);
  });

  it('reports a subscription auth failure clearly with no API-key fallback', async () => {
    state.runError = new Error('Not logged in. Please run codex login');
    const err = await new CodexSdkMcpModelClient('gpt-5-codex')
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
    const err = await new CodexSdkMcpModelClient('gpt-5-codex')
      .complete(baseInput)
      .catch((e) => e);
    expect(err).toBeInstanceOf(ModelClientError);
    expect(err.message).toMatch(/codex.*edition|edition.*Codex/i);
  });

  it('does not classify a generic connection failure as a rate limit', async () => {
    state.runError = new Error('connect ECONNREFUSED 127.0.0.1:1');
    const err = await new CodexSdkMcpModelClient('gpt-5-codex')
      .complete(baseInput)
      .catch((e) => e);
    expect(err).toBeInstanceOf(ModelClientError);
    expect(err).not.toBeInstanceOf(ModelRateLimitError);
  });

  describe('opt-in session debug logging', () => {
    it('records the codex-mcp protocol, forwarded MCP names, and server status', async () => {
      const sink = collectingSink();
      await new CodexSdkMcpModelClient('gpt-5-codex', {
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
      await new CodexSdkMcpModelClient('gpt-5-codex', { debug: sink })
        .complete(baseInput)
        .catch(() => {});
      const outcome = sink.events[0].outcome as { ok: false; error: string };
      expect(outcome.ok).toBe(false);
      expect(outcome.error).toContain('boom');
    });
  });
});
