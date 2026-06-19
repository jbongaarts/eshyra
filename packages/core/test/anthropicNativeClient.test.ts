import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Offline unit coverage for AnthropicNativeModelClient (eshyra-eznk).
 *
 * The Anthropic SDK is mocked so the adapter's real work runs deterministically
 * with no network: converting provider-neutral tool definitions into native
 * `tools`, projecting structured tool calls/results onto native message blocks,
 * parsing native `tool_use` blocks back into ModelToolCalls, the auth seam, the
 * native (not fenced) debug protocol mode, and the error path.
 */

const { createMock, ctorMock } = vi.hoisted(() => ({
  createMock: vi.fn(),
  ctorMock: vi.fn(),
}));

vi.mock('@anthropic-ai/sdk', () => {
  class MockAnthropic {
    messages = { create: createMock };
    constructor(options?: unknown) {
      ctorMock(options);
    }
  }
  return { default: MockAnthropic };
});

import type { ModelCallDebugEvent } from '../src/debug/sessionDebug.js';
import {
  ANTHROPIC_NATIVE_ADAPTER_CAPABILITIES,
  ANTHROPIC_NATIVE_TOOL_PROTOCOL,
  AnthropicNativeModelClient,
} from '../src/model/anthropicNativeClient.js';
import { ModelClientError } from '../src/model/client.js';

/** A collecting {@link import('../src/debug/sessionDebug.js').SessionDebugSink}. */
function collectingSink(captureContent = false): {
  captureContent: boolean;
  record: (e: ModelCallDebugEvent) => void;
  events: ModelCallDebugEvent[];
} {
  const events: ModelCallDebugEvent[] = [];
  return { captureContent, record: (e) => events.push(e), events };
}

const rollTool = {
  name: 'roll',
  description: 'roll dice',
  inputSchema: {
    type: 'object' as const,
    properties: { dice: { type: 'string' as const } },
    required: ['dice'],
    additionalProperties: false,
  },
};

/** Build a minimal Anthropic.Message-shaped response. */
function message(opts: {
  content: unknown[];
  stop_reason?: string | null;
}): unknown {
  return {
    id: 'msg_1',
    type: 'message',
    role: 'assistant',
    model: 'claude-test',
    content: opts.content,
    stop_reason: opts.stop_reason === undefined ? 'end_turn' : opts.stop_reason,
    stop_sequence: null,
    usage: { input_tokens: 1, output_tokens: 1 },
  };
}

describe('AnthropicNativeModelClient', () => {
  beforeEach(() => {
    createMock.mockReset();
    ctorMock.mockReset();
  });

  it('declares api-native / api-native / gameplay-capable capabilities (ADR 0010)', () => {
    const client = new AnthropicNativeModelClient('m');
    expect(client.capabilities).toEqual(ANTHROPIC_NATIVE_ADAPTER_CAPABILITIES);
    expect(client.capabilities.adapterFamily).toBe('api-native');
    expect(client.capabilities.toolTransport).toBe('api-native');
    expect(client.capabilities.turnLoopOwner).toBe('eshyra');
    expect(client.capabilities.vendor).toBe('anthropic');
    expect(client.capabilities.gameplayCapable).toBe(true);
  });

  it('converts ModelToolDefinition[] into native tools and sends them on the request', async () => {
    createMock.mockResolvedValue(
      message({ content: [{ type: 'text', text: 'narration' }] }),
    );

    const out = await new AnthropicNativeModelClient('claude-test').complete({
      system: 'be a DM',
      messages: [{ role: 'user', content: 'i open the door' }],
      tools: [rollTool],
    });

    expect(out.text).toBe('narration');
    expect(out.stopReason).toBe('end_turn');
    expect(out.toolCalls).toBeUndefined();

    expect(createMock).toHaveBeenCalledOnce();
    const arg = createMock.mock.calls[0][0] as {
      model: string;
      max_tokens: number;
      system?: string;
      messages: unknown[];
      tools?: Array<{
        name: string;
        description: string;
        input_schema: unknown;
      }>;
    };
    expect(arg.model).toBe('claude-test');
    expect(arg.max_tokens).toBeGreaterThan(0);
    expect(arg.system).toBe('be a DM');
    // The provider-neutral tool was lifted into a native tool declaration.
    expect(arg.tools).toEqual([
      {
        name: 'roll',
        description: 'roll dice',
        input_schema: rollTool.inputSchema,
      },
    ]);
    expect(arg.messages).toEqual([
      { role: 'user', content: 'i open the door' },
    ]);
  });

  it('omits system and tools from the request when none are provided', async () => {
    createMock.mockResolvedValue(
      message({ content: [{ type: 'text', text: 'ok' }] }),
    );

    await new AnthropicNativeModelClient('m').complete({
      messages: [{ role: 'user', content: 'hi' }],
    });

    const arg = createMock.mock.calls[0][0] as Record<string, unknown>;
    expect('system' in arg).toBe(false);
    expect('tools' in arg).toBe(false);
  });

  it('parses native tool_use blocks into ModelToolCall[] with id, name, and parsed args', async () => {
    createMock.mockResolvedValue(
      message({
        content: [
          { type: 'text', text: 'You ready your blade.' },
          {
            type: 'tool_use',
            id: 'toolu_abc',
            name: 'roll',
            input: { dice: '1d20+5', reason: 'attack' },
          },
        ],
        stop_reason: 'tool_use',
      }),
    );

    const out = await new AnthropicNativeModelClient('m').complete({
      messages: [{ role: 'user', content: 'i attack' }],
      tools: [rollTool],
    });

    expect(out.text).toBe('You ready your blade.');
    expect(out.stopReason).toBe('tool_use');
    expect(out.toolCalls).toEqual([
      {
        id: 'toolu_abc',
        name: 'roll',
        args: { dice: '1d20+5', reason: 'attack' },
      },
    ]);
  });

  it('projects assistant tool calls and user tool results onto native blocks for follow-up rounds', async () => {
    createMock.mockResolvedValue(
      message({ content: [{ type: 'text', text: 'done' }] }),
    );

    await new AnthropicNativeModelClient('m').complete({
      messages: [
        { role: 'user', content: 'i attack' },
        {
          role: 'assistant',
          content: 'rolling',
          toolCalls: [
            { id: 'toolu_abc', name: 'roll', args: { dice: '1d20' } },
          ],
          stopReason: 'tool_use',
        },
        {
          role: 'user',
          content: '',
          toolResults: [
            {
              callId: 'toolu_abc',
              name: 'roll',
              result: { ok: true, data: { total: 17 } },
            },
          ],
        },
      ],
      tools: [rollTool],
    });

    const arg = createMock.mock.calls[0][0] as { messages: unknown[] };
    expect(arg.messages).toEqual([
      { role: 'user', content: 'i attack' },
      {
        role: 'assistant',
        content: [
          { type: 'text', text: 'rolling' },
          {
            type: 'tool_use',
            id: 'toolu_abc',
            name: 'roll',
            input: { dice: '1d20' },
          },
        ],
      },
      {
        role: 'user',
        content: [
          {
            type: 'tool_result',
            tool_use_id: 'toolu_abc',
            content: JSON.stringify({ ok: true, data: { total: 17 } }),
          },
        ],
      },
    ]);
  });

  it('marks a failed tool result as is_error in the native block', async () => {
    createMock.mockResolvedValue(
      message({ content: [{ type: 'text', text: 'ok' }] }),
    );

    await new AnthropicNativeModelClient('m').complete({
      messages: [
        {
          role: 'user',
          content: '',
          toolResults: [
            {
              callId: 'toolu_x',
              name: 'roll',
              result: { ok: false, code: 'invalid_args', message: 'bad dice' },
            },
          ],
        },
      ],
    });

    const arg = createMock.mock.calls[0][0] as {
      messages: Array<{ content: Array<Record<string, unknown>> }>;
    };
    expect(arg.messages[0].content[0]).toEqual({
      type: 'tool_result',
      tool_use_id: 'toolu_x',
      content: JSON.stringify({
        ok: false,
        code: 'invalid_args',
        message: 'bad dice',
      }),
      is_error: true,
    });
  });

  it('maps provider stop reasons onto the neutral vocabulary', async () => {
    const cases: Array<[string | null, string | undefined]> = [
      ['max_tokens', 'max_tokens'],
      ['refusal', 'other'],
      [null, undefined],
    ];
    for (const [provider, expected] of cases) {
      createMock.mockResolvedValue(
        message({
          content: [{ type: 'text', text: 'x' }],
          stop_reason: provider,
        }),
      );
      const out = await new AnthropicNativeModelClient('m').complete({
        messages: [{ role: 'user', content: 'hi' }],
      });
      expect(out.stopReason).toBe(expected);
    }
  });

  describe('usage and request id (eshyra-cuxm)', () => {
    it('surfaces input/output token counts from the API response usage field', async () => {
      createMock.mockResolvedValue({
        id: 'msg_usage_test',
        type: 'message',
        role: 'assistant',
        model: 'claude-test',
        content: [{ type: 'text', text: 'ok' }],
        stop_reason: 'end_turn',
        stop_sequence: null,
        usage: { input_tokens: 450, output_tokens: 120 },
      });
      const out = await new AnthropicNativeModelClient('claude-test').complete({
        messages: [{ role: 'user', content: 'hello' }],
      });
      expect(out.usage).toEqual({ inputTokens: 450, outputTokens: 120 });
    });

    it('includes cacheReadTokens when cache_read_input_tokens is non-null', async () => {
      createMock.mockResolvedValue({
        id: 'msg_cache',
        type: 'message',
        role: 'assistant',
        model: 'claude-test',
        content: [{ type: 'text', text: 'ok' }],
        stop_reason: 'end_turn',
        stop_sequence: null,
        usage: {
          input_tokens: 100,
          output_tokens: 20,
          cache_read_input_tokens: 80,
          cache_creation_input_tokens: 40,
        },
      });
      const out = await new AnthropicNativeModelClient('claude-test').complete({
        messages: [{ role: 'user', content: 'hello' }],
      });
      expect(out.usage?.cacheReadTokens).toBe(80);
      expect(out.usage?.cacheWriteTokens).toBe(40);
    });

    it('omits cacheReadTokens when cache_read_input_tokens is null', async () => {
      createMock.mockResolvedValue({
        id: 'msg_no_cache',
        type: 'message',
        role: 'assistant',
        model: 'claude-test',
        content: [{ type: 'text', text: 'ok' }],
        stop_reason: 'end_turn',
        stop_sequence: null,
        usage: {
          input_tokens: 100,
          output_tokens: 20,
          cache_read_input_tokens: null,
        },
      });
      const out = await new AnthropicNativeModelClient('claude-test').complete({
        messages: [{ role: 'user', content: 'hello' }],
      });
      expect(out.usage?.cacheReadTokens).toBeUndefined();
    });

    it('surfaces the provider-assigned message id as requestId', async () => {
      createMock.mockResolvedValue(
        message({ content: [{ type: 'text', text: 'ok' }] }),
      );
      const out = await new AnthropicNativeModelClient('m').complete({
        messages: [{ role: 'user', content: 'hi' }],
      });
      expect(out.requestId).toBe('msg_1');
    });
  });

  describe('provider-auth injection seam', () => {
    it('uses ambient auth (no constructor options) when no auth source is given', async () => {
      createMock.mockResolvedValue(
        message({ content: [{ type: 'text', text: 'ok' }] }),
      );
      await new AnthropicNativeModelClient('m').complete({
        messages: [{ role: 'user', content: 'hi' }],
      });
      expect(ctorMock).toHaveBeenCalledWith(undefined);
    });

    it('passes an ANTHROPIC_API_KEY credential as the SDK apiKey', async () => {
      createMock.mockResolvedValue(
        message({ content: [{ type: 'text', text: 'ok' }] }),
      );
      await new AnthropicNativeModelClient('m', {
        env: { ANTHROPIC_API_KEY: 'sk-injected' },
      }).complete({ messages: [{ role: 'user', content: 'hi' }] });
      expect(ctorMock).toHaveBeenCalledWith({ apiKey: 'sk-injected' });
    });

    it('passes a CLAUDE_CODE_OAUTH_TOKEN as a bearer token with the oauth beta header', async () => {
      createMock.mockResolvedValue(
        message({ content: [{ type: 'text', text: 'ok' }] }),
      );
      await new AnthropicNativeModelClient('m', {
        env: { CLAUDE_CODE_OAUTH_TOKEN: 'oauth-tok' },
      }).complete({ messages: [{ role: 'user', content: 'hi' }] });
      expect(ctorMock).toHaveBeenCalledWith({
        apiKey: null,
        authToken: 'oauth-tok',
        defaultHeaders: { 'anthropic-beta': 'oauth-2025-04-20' },
      });
    });

    it('resolves a function auth source on every call', async () => {
      createMock.mockResolvedValue(
        message({ content: [{ type: 'text', text: 'ok' }] }),
      );
      const keys = ['sk-1', 'sk-2'];
      let i = 0;
      const client = new AnthropicNativeModelClient('m', () => ({
        env: { ANTHROPIC_API_KEY: keys[i++] },
      }));
      await client.complete({ messages: [{ role: 'user', content: 'a' }] });
      await client.complete({ messages: [{ role: 'user', content: 'b' }] });
      expect(ctorMock).toHaveBeenNthCalledWith(1, { apiKey: 'sk-1' });
      expect(ctorMock).toHaveBeenNthCalledWith(2, { apiKey: 'sk-2' });
    });

    it('does not expose the auth source via enumeration or JSON serialization', () => {
      const secret = 'sk-ant-secret-DO-NOT-LEAK';
      const client = new AnthropicNativeModelClient('m', {
        env: { ANTHROPIC_API_KEY: secret },
      });
      // ECMAScript-private `#auth` / `#model` / `#debug` are invisible to
      // Object.keys / JSON.stringify — a captured client cannot leak the secret.
      // `capabilities` IS enumerable (it is public metadata, not a secret).
      const keys = Object.keys(client);
      expect(keys).not.toContain('auth');
      expect(keys).not.toContain('model');
      expect(keys).not.toContain('debug');
      expect(JSON.stringify(client)).not.toContain(secret);
    });
  });

  describe('error path (loreweaver-jmv contract)', () => {
    it('throws a ModelClientError when the SDK call fails', async () => {
      createMock.mockRejectedValue(new Error('overloaded'));
      await expect(
        new AnthropicNativeModelClient('m').complete({
          messages: [{ role: 'user', content: 'x' }],
        }),
      ).rejects.toThrowError(ModelClientError);
    });

    it('redacts secrets from the thrown error message', async () => {
      createMock.mockRejectedValue(
        new Error('connect failed using Bearer sk-ant-leak-me-please'),
      );
      await expect(
        new AnthropicNativeModelClient('m').complete({
          messages: [{ role: 'user', content: 'x' }],
        }),
      ).rejects.toThrowError(/\[redacted\]/);
    });
  });

  describe('opt-in session debug logging', () => {
    it('records a native protocol mode and the forwarded tool names (eshyra-eznk)', async () => {
      createMock.mockResolvedValue(
        message({ content: [{ type: 'text', text: 'You stride forward.' }] }),
      );
      const sink = collectingSink();

      await new AnthropicNativeModelClient('claude-test', undefined, {
        debug: sink,
        profile: 'premium_dm',
        tier: 'premium',
        authMode: 'api-key',
      }).complete({
        system: '## Persona\nbe a DM',
        messages: [{ role: 'user', content: '## Player Input\ngo' }],
        tools: [rollTool],
        trace: {
          campaignId: 'c1',
          sessionId: 's1',
          turnId: 't1',
          extra: { purpose: 'turn_model_loop', round: '1' },
        },
      });

      expect(sink.events).toHaveLength(1);
      const ev = sink.events[0];
      expect(ev.model).toBe('claude-test');
      expect(ev.profile).toBe('premium_dm');
      expect(ev.authMode).toBe('api-key');
      // The whole point of the fix: a native protocol mode, never fenced-text...
      expect(ev.toolProtocolMode).toBe(ANTHROPIC_NATIVE_TOOL_PROTOCOL);
      expect(ev.toolProtocolMode).not.toBe('fenced-text');
      // ...and the forwarded tools match what the core provided.
      expect(ev.providedToolNames).toEqual(['roll']);
      expect(ev.forwardedToolNames).toEqual(['roll']);
      expect(ev.outcome).toMatchObject({ ok: true });
    });

    it('records a sanitized failure event and still throws', async () => {
      createMock.mockRejectedValue(new Error('boom Bearer sk-ant-x'));
      const sink = collectingSink();

      await expect(
        new AnthropicNativeModelClient('m', undefined, {
          debug: sink,
        }).complete({
          messages: [{ role: 'user', content: 'x' }],
          trace: { sessionId: 's1' },
        }),
      ).rejects.toThrowError(ModelClientError);

      expect(sink.events).toHaveLength(1);
      const outcome = sink.events[0].outcome as { ok: false; error: string };
      expect(outcome.ok).toBe(false);
      expect(outcome.error).not.toContain('sk-ant-x');
    });

    it('never lets a throwing sink break the turn', async () => {
      createMock.mockResolvedValue(
        message({ content: [{ type: 'text', text: 'narration' }] }),
      );
      const out = await new AnthropicNativeModelClient('m', undefined, {
        debug: {
          captureContent: false,
          record: () => {
            throw new Error('sink exploded');
          },
        },
      }).complete({ messages: [{ role: 'user', content: 'hi' }] });
      expect(out.text).toBe('narration');
    });
  });
});
