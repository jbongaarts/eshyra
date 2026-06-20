import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ModelCallDebugEvent } from '../src/debug/sessionDebug.js';
import { ModelClientError, ModelRateLimitError } from '../src/model/client.js';
import {
  OPENAI_NATIVE_ADAPTER_CAPABILITIES,
  OPENAI_NATIVE_TOOL_PROTOCOL,
  OpenAiNativeModelClient,
} from '../src/model/openaiNativeClient.js';

const fetchMock = vi.fn<typeof fetch>();

const auth = { env: { OPENAI_API_KEY: 'sk-openai-test' } };
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

function completion(
  options: {
    content?: string | null;
    toolCalls?: unknown[];
    finishReason?: string | null;
    usage?: unknown;
  } = {},
): Response {
  return Response.json({
    id: 'chatcmpl_1',
    choices: [
      {
        message: {
          role: 'assistant',
          content: options.content ?? null,
          ...(options.toolCalls ? { tool_calls: options.toolCalls } : {}),
        },
        finish_reason:
          options.finishReason === undefined ? 'stop' : options.finishReason,
      },
    ],
    usage: options.usage ?? {
      prompt_tokens: 12,
      completion_tokens: 4,
      prompt_tokens_details: { cached_tokens: 3 },
    },
  });
}

function requestBody(): Record<string, unknown> {
  const init = fetchMock.mock.calls[0][1];
  return JSON.parse(String(init?.body)) as Record<string, unknown>;
}

function collectingSink(): {
  captureContent: false;
  record: (event: ModelCallDebugEvent) => void;
  events: ModelCallDebugEvent[];
} {
  const events: ModelCallDebugEvent[] = [];
  return {
    captureContent: false,
    record: (event) => events.push(event),
    events,
  };
}

describe('OpenAiNativeModelClient', () => {
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('declares API-native, Eshyra-owned, gameplay-capable OpenAI capabilities', () => {
    const client = new OpenAiNativeModelClient('gpt-test', auth);
    expect(client.capabilities).toEqual(OPENAI_NATIVE_ADAPTER_CAPABILITIES);
    expect(client.capabilities).toMatchObject({
      adapterFamily: 'api-native',
      toolTransport: 'api-native',
      turnLoopOwner: 'eshyra',
      vendor: 'openai',
      gameplayCapable: true,
    });
  });

  it('sends developer context, messages, and native function declarations', async () => {
    fetchMock.mockResolvedValue(completion({ content: 'The door opens.' }));

    const out = await new OpenAiNativeModelClient('gpt-test', auth).complete({
      system: 'Be a DM.',
      messages: [{ role: 'user', content: 'Open the door.' }],
      tools: [rollTool],
    });

    expect(out).toMatchObject({
      text: 'The door opens.',
      stopReason: 'end_turn',
      requestId: 'chatcmpl_1',
      usage: { inputTokens: 12, outputTokens: 4, cacheReadTokens: 3 },
    });
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.openai.com/v1/chat/completions',
      expect.objectContaining({
        method: 'POST',
        headers: {
          authorization: 'Bearer sk-openai-test',
          'content-type': 'application/json',
        },
      }),
    );
    expect(requestBody()).toEqual({
      model: 'gpt-test',
      max_completion_tokens: 8192,
      messages: [
        { role: 'developer', content: 'Be a DM.' },
        { role: 'user', content: 'Open the door.' },
      ],
      tools: [
        {
          type: 'function',
          function: {
            name: 'roll',
            description: 'roll dice',
            parameters: rollTool.inputSchema,
          },
        },
      ],
    });
  });

  it('omits developer context and tools when they are absent', async () => {
    fetchMock.mockResolvedValue(completion({ content: 'hi' }));
    await new OpenAiNativeModelClient('m', auth).complete({
      messages: [{ role: 'user', content: 'hello' }],
    });
    expect(requestBody()).toEqual({
      model: 'm',
      max_completion_tokens: 8192,
      messages: [{ role: 'user', content: 'hello' }],
    });
  });

  it('parses parallel native tool calls and JSON arguments', async () => {
    fetchMock.mockResolvedValue(
      completion({
        content: 'Rolling.',
        finishReason: 'tool_calls',
        toolCalls: [
          {
            id: 'call_1',
            type: 'function',
            function: { name: 'roll', arguments: '{"dice":"1d20"}' },
          },
          {
            id: 'call_2',
            type: 'function',
            function: { name: 'lookup', arguments: '{"key":"armor"}' },
          },
        ],
      }),
    );

    const out = await new OpenAiNativeModelClient('m', auth).complete({
      messages: [{ role: 'user', content: 'act' }],
    });
    expect(out.text).toBe('Rolling.');
    expect(out.stopReason).toBe('tool_use');
    expect(out.toolCalls).toEqual([
      { id: 'call_1', name: 'roll', args: { dice: '1d20' } },
      { id: 'call_2', name: 'lookup', args: { key: 'armor' } },
    ]);
  });

  it('round-trips assistant calls and deterministic results in OpenAI history', async () => {
    fetchMock.mockResolvedValue(completion({ content: 'Done.' }));
    await new OpenAiNativeModelClient('m', auth).complete({
      messages: [
        {
          role: 'assistant',
          content: '',
          toolCalls: [{ id: 'call_1', name: 'roll', args: { dice: '1d20' } }],
        },
        {
          role: 'user',
          content: 'Continue.',
          toolResults: [
            {
              callId: 'call_1',
              name: 'roll',
              result: { ok: true, data: { total: 17 } },
            },
            {
              callId: 'call_2',
              name: 'lookup',
              result: { ok: false, code: 'missing', message: 'not found' },
            },
          ],
        },
      ],
    });

    expect(requestBody().messages).toEqual([
      {
        role: 'assistant',
        content: null,
        tool_calls: [
          {
            id: 'call_1',
            type: 'function',
            function: { name: 'roll', arguments: '{"dice":"1d20"}' },
          },
        ],
      },
      {
        role: 'tool',
        tool_call_id: 'call_1',
        content: '{"ok":true,"data":{"total":17}}',
      },
      {
        role: 'tool',
        tool_call_id: 'call_2',
        content: '{"ok":false,"code":"missing","message":"not found"}',
      },
      { role: 'user', content: 'Continue.' },
    ]);
  });

  it.each([
    ['stop', 'end_turn'],
    ['tool_calls', 'tool_use'],
    ['function_call', 'tool_use'],
    ['length', 'max_tokens'],
    ['content_filter', 'other'],
    [null, undefined],
  ])('maps finish reason %s to %s', async (finishReason, expected) => {
    fetchMock.mockResolvedValue(completion({ finishReason }));
    const out = await new OpenAiNativeModelClient('m', auth).complete({
      messages: [{ role: 'user', content: 'x' }],
    });
    expect(out.stopReason).toBe(expected);
  });

  it('supports fixed, rotating, and ambient authentication without exposing secrets', async () => {
    fetchMock.mockImplementation(async () => completion({ content: 'ok' }));
    let n = 0;
    const rotating = new OpenAiNativeModelClient('m', () => ({
      env: { OPENAI_API_KEY: `sk-${++n}` },
    }));
    await rotating.complete({ messages: [{ role: 'user', content: 'a' }] });
    await rotating.complete({ messages: [{ role: 'user', content: 'b' }] });
    expect(fetchMock.mock.calls[0][1]?.headers).toMatchObject({
      authorization: 'Bearer sk-1',
    });
    expect(fetchMock.mock.calls[1][1]?.headers).toMatchObject({
      authorization: 'Bearer sk-2',
    });

    const client = new OpenAiNativeModelClient('m', auth);
    expect(Object.keys(client)).not.toContain('auth');
    expect(JSON.stringify(client)).not.toContain('sk-openai-test');
  });

  it('fails before fetch when no API key is configured', async () => {
    await expect(
      new OpenAiNativeModelClient('m', { env: {} }).complete({
        messages: [{ role: 'user', content: 'x' }],
      }),
    ).rejects.toThrowError(/OPENAI_API_KEY/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects invalid tool argument JSON as a provider contract error', async () => {
    fetchMock.mockResolvedValue(
      completion({
        finishReason: 'tool_calls',
        toolCalls: [
          {
            id: 'call_1',
            type: 'function',
            function: { name: 'roll', arguments: '{bad' },
          },
        ],
      }),
    );
    await expect(
      new OpenAiNativeModelClient('m', auth).complete({
        messages: [{ role: 'user', content: 'x' }],
      }),
    ).rejects.toThrowError(/invalid JSON arguments.*roll/);
  });

  it('maps HTTP 429 to ModelRateLimitError with Retry-After', async () => {
    fetchMock.mockResolvedValue(
      Response.json(
        { error: { message: 'rate limit exceeded' } },
        { status: 429, headers: { 'retry-after': '45' } },
      ),
    );
    const err = await new OpenAiNativeModelClient('m', auth)
      .complete({ messages: [{ role: 'user', content: 'x' }] })
      .catch((error) => error);
    expect(err).toBeInstanceOf(ModelRateLimitError);
    expect(err).toBeInstanceOf(ModelClientError);
    expect((err as ModelRateLimitError).retryAfterSeconds).toBe(45);
  });

  it('normalizes HTTP, transport, malformed JSON, and missing-choice failures', async () => {
    fetchMock.mockResolvedValueOnce(
      Response.json({ error: { message: 'bad request' } }, { status: 400 }),
    );
    await expect(
      new OpenAiNativeModelClient('m', auth).complete({
        messages: [{ role: 'user', content: 'x' }],
      }),
    ).rejects.toThrowError(/OpenAI API call failed \(400\): bad request/);

    fetchMock.mockRejectedValueOnce(new Error('network failed Bearer sk-leak'));
    await expect(
      new OpenAiNativeModelClient('m', auth).complete({
        messages: [{ role: 'user', content: 'x' }],
      }),
    ).rejects.toThrowError(/\[redacted\]/);

    fetchMock.mockResolvedValueOnce(new Response('not json'));
    await expect(
      new OpenAiNativeModelClient('m', auth).complete({
        messages: [{ role: 'user', content: 'x' }],
      }),
    ).rejects.toThrowError(/non-JSON response/);

    fetchMock.mockResolvedValueOnce(Response.json({ id: 'x', choices: [] }));
    await expect(
      new OpenAiNativeModelClient('m', auth).complete({
        messages: [{ role: 'user', content: 'x' }],
      }),
    ).rejects.toThrowError(/no completion choice/);
  });

  it('records native protocol diagnostics and never lets the sink break a turn', async () => {
    fetchMock.mockImplementation(async () => completion({ content: 'ok' }));
    const sink = collectingSink();
    await new OpenAiNativeModelClient('gpt-test', auth, {
      debug: sink,
      profile: 'premium_dm',
      tier: 'premium',
      authMode: 'openai-api',
    }).complete({
      system: '## Persona\nDM',
      messages: [{ role: 'user', content: 'go' }],
      tools: [rollTool],
      trace: { sessionId: 's1', extra: { round: '1' } },
    });
    expect(sink.events[0]).toMatchObject({
      model: 'gpt-test',
      profile: 'premium_dm',
      authMode: 'openai-api',
      toolProtocolMode: OPENAI_NATIVE_TOOL_PROTOCOL,
      providedToolNames: ['roll'],
      forwardedToolNames: ['roll'],
      outcome: { ok: true },
    });

    const out = await new OpenAiNativeModelClient('m', auth, {
      debug: {
        captureContent: false,
        record: () => {
          throw new Error('sink failed');
        },
      },
    }).complete({ messages: [{ role: 'user', content: 'x' }] });
    expect(out.text).toBe('ok');
  });
});
