import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Offline unit coverage for AgentSdkModelClient (loreweaver-bq1 / loreweaver-jmv).
 *
 * The adapter's only non-trivial logic — flattening structured messages into the
 * SDK's single `prompt` string, and the provider error path — was previously
 * exercised only by the gated live-API integration test. Here the Agent SDK is
 * mocked so the flattening and error semantics run deterministically with no
 * network access.
 */

const { queryMock } = vi.hoisted(() => ({ queryMock: vi.fn() }));

vi.mock('@anthropic-ai/claude-agent-sdk', () => ({
  query: queryMock,
}));

import type { ModelCallDebugEvent } from '../src/debug/sessionDebug.js';
import { AgentSdkModelClient } from '../src/model/agentSdkClient.js';
import { ModelClientError } from '../src/model/client.js';

/** A collecting {@link SessionDebugSink} for adapter tests. */
function collectingSink(captureContent = false): {
  captureContent: boolean;
  record: (e: ModelCallDebugEvent) => void;
  events: ModelCallDebugEvent[];
} {
  const events: ModelCallDebugEvent[] = [];
  return {
    captureContent,
    record: (e) => events.push(e),
    events,
  };
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

/** An async generator yielding the given SDK stream messages, in order. */
function sdkStream(...messages: unknown[]): AsyncGenerator<unknown> {
  return (async function* () {
    for (const m of messages) yield m;
  })();
}

const ok = (result: string) => ({ type: 'result', subtype: 'success', result });

describe('AgentSdkModelClient', () => {
  beforeEach(() => {
    queryMock.mockReset();
  });

  it('flattens messages into a "role: content" prompt and forwards model + system', async () => {
    queryMock.mockReturnValue(sdkStream(ok('narration')));

    const out = await new AgentSdkModelClient('claude-test').complete({
      system: 'be a DM',
      messages: [
        { role: 'user', content: 'i open the door' },
        { role: 'assistant', content: 'it creaks' },
        { role: 'user', content: 'i step through' },
      ],
    });

    expect(out.text).toBe('narration');
    // The adapter knows it received a successful result message and reports
    // `end_turn` accordingly — there is no native tool-call channel exposed.
    expect(out.stopReason).toBe('end_turn');
    expect(out.toolCalls).toBeUndefined();
    expect(queryMock).toHaveBeenCalledOnce();
    const arg = queryMock.mock.calls[0][0] as {
      prompt: string;
      options: { model: string; systemPrompt?: string };
    };
    expect(arg.prompt).toBe(
      'user: i open the door\nassistant: it creaks\nuser: i step through',
    );
    expect(arg.options.model).toBe('claude-test');
    expect(arg.options.systemPrompt).toBe('be a DM');
  });

  it('omits systemPrompt entirely when no system text is given', async () => {
    queryMock.mockReturnValue(sdkStream(ok('ok')));

    await new AgentSdkModelClient('m').complete({
      messages: [{ role: 'user', content: 'hi' }],
    });

    const arg = queryMock.mock.calls[0][0] as {
      options: Record<string, unknown>;
    };
    expect('systemPrompt' in arg.options).toBe(false);
  });

  it('takes the success result even when non-result messages precede it', async () => {
    queryMock.mockReturnValue(
      sdkStream({ type: 'system' }, { type: 'assistant' }, ok('final')),
    );

    const out = await new AgentSdkModelClient('m').complete({
      messages: [{ role: 'user', content: 'x' }],
    });

    expect(out.text).toBe('final');
  });

  it('ignores structured tools / responseFormat / profile / trace without failing (eshyra-0jq.11)', async () => {
    queryMock.mockReturnValue(sdkStream(ok('ok')));

    const out = await new AgentSdkModelClient('m').complete({
      messages: [{ role: 'user', content: 'hi' }],
      tools: [
        {
          name: 'roll',
          description: 'roll dice',
          inputSchema: {
            type: 'object',
            properties: { dice: { type: 'string' } },
            required: ['dice'],
            additionalProperties: false,
          },
        },
      ],
      responseFormat: 'text',
      profile: { profile: 'premium_dm', tier: 'premium', canonChanging: true },
      trace: { turnId: 'turn-1', campaignId: 'camp-1' },
    });

    // The Agent SDK has no native tool-use surface; the adapter accepts the
    // structured fields, ignores them, and still returns the text result.
    expect(out.text).toBe('ok');
    const arg = queryMock.mock.calls[0][0] as {
      options: Record<string, unknown>;
    };
    expect(arg.options).not.toHaveProperty('tools');
    expect(arg.options).not.toHaveProperty('trace');
  });

  it('throws ModelClientError on an SDK error result (loreweaver-jmv)', async () => {
    queryMock.mockReturnValue(
      sdkStream({ type: 'result', subtype: 'error_during_execution' }),
    );

    await expect(
      new AgentSdkModelClient('m').complete({
        messages: [{ role: 'user', content: 'x' }],
      }),
    ).rejects.toThrowError(
      /Agent SDK returned an error result \(subtype: error_during_execution\)/,
    );
  });

  it('throws ModelClientError when the stream ends without a result message', async () => {
    queryMock.mockReturnValue(
      sdkStream({ type: 'system' }, { type: 'assistant' }),
    );

    await expect(
      new AgentSdkModelClient('m').complete({
        messages: [{ role: 'user', content: 'x' }],
      }),
    ).rejects.toThrowError(ModelClientError);
  });

  describe('provider-auth injection seam (loreweaver-lus)', () => {
    it('omits options.env entirely when no auth source is given (ambient auth)', async () => {
      queryMock.mockReturnValue(sdkStream(ok('ok')));

      await new AgentSdkModelClient('m').complete({
        messages: [{ role: 'user', content: 'hi' }],
      });

      const arg = queryMock.mock.calls[0][0] as {
        options: Record<string, unknown>;
      };
      expect('env' in arg.options).toBe(false);
    });

    it('injects the auth env into the SDK process, merged over process.env', async () => {
      queryMock.mockReturnValue(sdkStream(ok('ok')));
      process.env.LW_TEST_AMBIENT = 'ambient-value';
      try {
        await new AgentSdkModelClient('m', {
          env: { ANTHROPIC_API_KEY: 'sk-injected' },
        }).complete({ messages: [{ role: 'user', content: 'hi' }] });
      } finally {
        Reflect.deleteProperty(process.env, 'LW_TEST_AMBIENT');
      }

      const arg = queryMock.mock.calls[0][0] as {
        options: { env: Record<string, string | undefined> };
      };
      // The explicit secret is present, and inherited env is preserved so the
      // SDK subprocess keeps PATH and friends.
      expect(arg.options.env.ANTHROPIC_API_KEY).toBe('sk-injected');
      expect(arg.options.env.LW_TEST_AMBIENT).toBe('ambient-value');
    });

    it('confines the secret to options.env — never the prompt, model, or system', async () => {
      queryMock.mockReturnValue(sdkStream(ok('narration')));
      const secret = 'sk-ant-secret-DO-NOT-LEAK';

      await new AgentSdkModelClient('claude-test', {
        env: { ANTHROPIC_API_KEY: secret },
      }).complete({
        system: 'be a DM',
        messages: [{ role: 'user', content: 'i open the door' }],
      });

      const arg = queryMock.mock.calls[0][0] as {
        prompt: string;
        options: Record<string, unknown>;
      };
      // Strip the one field the secret is *meant* to be in; the secret must
      // appear nowhere else in the call — not the prompt, model, or systemPrompt.
      const { env: _env, ...optionsWithoutEnv } = arg.options;
      const exposed = JSON.stringify({
        prompt: arg.prompt,
        options: optionsWithoutEnv,
      });
      expect(exposed).not.toContain(secret);
    });

    it('resolves a function auth source on every call (per-request secrets)', async () => {
      queryMock.mockReturnValue(sdkStream(ok('ok')));
      const keys = ['sk-rotation-1', 'sk-rotation-2'];
      let call = 0;
      const client = new AgentSdkModelClient('m', () => ({
        env: { ANTHROPIC_API_KEY: keys[call++] },
      }));

      await client.complete({ messages: [{ role: 'user', content: 'a' }] });
      queryMock.mockReturnValue(sdkStream(ok('ok')));
      await client.complete({ messages: [{ role: 'user', content: 'b' }] });

      const first = queryMock.mock.calls[0][0] as {
        options: { env: Record<string, string> };
      };
      const second = queryMock.mock.calls[1][0] as {
        options: { env: Record<string, string> };
      };
      expect(first.options.env.ANTHROPIC_API_KEY).toBe('sk-rotation-1');
      expect(second.options.env.ANTHROPIC_API_KEY).toBe('sk-rotation-2');
    });

    it('does not expose the auth source via enumeration or JSON serialization', () => {
      const secret = 'sk-ant-secret-DO-NOT-LEAK';
      const client = new AgentSdkModelClient('m', {
        env: { ANTHROPIC_API_KEY: secret },
      });
      // ECMAScript-private fields are invisible to Object.keys / JSON.stringify,
      // so a client accidentally captured into a trace or log cannot leak it.
      expect(Object.keys(client)).toEqual([]);
      expect(JSON.stringify(client)).not.toContain(secret);
    });
  });

  describe('opt-in session debug logging (eshyra-iu18)', () => {
    it('emits no debug record when no sink is wired (silent by default)', async () => {
      queryMock.mockReturnValue(sdkStream(ok('narration')));
      // Constructing without a debug option must not throw and not log.
      const out = await new AgentSdkModelClient('m', undefined).complete({
        messages: [{ role: 'user', content: 'hi' }],
      });
      expect(out.text).toBe('narration');
    });

    it('records one structural event on success with labels and the forwarded-tool gap', async () => {
      queryMock.mockReturnValue(sdkStream(ok('You stride forward.')));
      const sink = collectingSink();

      await new AgentSdkModelClient('claude-test', undefined, {
        debug: sink,
        profile: 'premium_dm',
        tier: 'premium',
        authMode: 'oauth-token',
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
      expect(ev.tier).toBe('premium');
      expect(ev.authMode).toBe('oauth-token');
      expect(ev.toolProtocolMode).toBe('fenced-text');
      expect(ev.trace).toMatchObject({
        campaignId: 'c1',
        sessionId: 's1',
        turnId: 't1',
        purpose: 'turn_model_loop',
        round: '1',
      });
      // The core handed `roll` to the client; the Agent SDK got no native tools.
      expect(ev.providedToolNames).toEqual(['roll']);
      expect(ev.forwardedToolNames).toEqual([]);
      expect(ev.outcome).toMatchObject({ ok: true, resultChars: 19 });
      // Structural by default: no captured content.
      expect(ev.content).toBeUndefined();
    });

    it('records a sanitized failure event for an SDK error result and still throws', async () => {
      queryMock.mockReturnValue(
        sdkStream({ type: 'result', subtype: 'error_during_execution' }),
      );
      const sink = collectingSink();

      await expect(
        new AgentSdkModelClient('m', undefined, { debug: sink }).complete({
          messages: [{ role: 'user', content: 'x' }],
          trace: { sessionId: 's1' },
        }),
      ).rejects.toThrowError(ModelClientError);

      expect(sink.events).toHaveLength(1);
      expect(sink.events[0].outcome).toMatchObject({ ok: false });
    });

    it('records a redacted failure event when the SDK call itself throws', async () => {
      queryMock.mockImplementation(() => {
        throw new Error('connect failed using Bearer sk-ant-leak-me-please');
      });
      const sink = collectingSink();

      await expect(
        new AgentSdkModelClient('m', undefined, { debug: sink }).complete({
          messages: [{ role: 'user', content: 'x' }],
        }),
      ).rejects.toThrowError(/connect failed/);

      const outcome = sink.events[0].outcome as { ok: false; error: string };
      expect(outcome.ok).toBe(false);
      expect(outcome.error).not.toContain('sk-ant-leak-me-please');
      expect(outcome.error).toContain('[redacted]');
    });

    it('attaches sanitized content only when the sink opts into capture', async () => {
      queryMock.mockReturnValue(sdkStream(ok('ok')));
      const sink = collectingSink(true);

      await new AgentSdkModelClient('m', undefined, { debug: sink }).complete({
        system: 'authorization: Bearer sk-ant-shh',
        messages: [{ role: 'user', content: 'hello' }],
      });

      const ev = sink.events[0];
      expect(ev.content).toBeDefined();
      expect(ev.content?.system).not.toContain('sk-ant-shh');
      expect(ev.content?.messages[0].content).toBe('hello');
    });

    it('never lets a throwing sink break the turn', async () => {
      queryMock.mockReturnValue(sdkStream(ok('narration')));
      const out = await new AgentSdkModelClient('m', undefined, {
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
