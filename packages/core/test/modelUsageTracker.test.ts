import { describe, expect, it } from 'vitest';
import type {
  ModelClient,
  ModelCompleteInput,
  ModelCompleteResult,
} from '../src/model/client.js';
import { ModelClientError, ModelRateLimitError } from '../src/model/client.js';
import type { ModelUsageRecord, ModelUsageSink } from '../src/model/usage.js';
import { ModelUsageTracker } from '../src/model/usage.js';

/** Collecting sink for test assertions. */
class CaptureSink implements ModelUsageSink {
  readonly records: ModelUsageRecord[] = [];
  record(entry: ModelUsageRecord): void {
    this.records.push(entry);
  }
}

/** Fake model client that resolves with a fixed result. */
class FakeModel implements ModelClient {
  constructor(
    private readonly result: ModelCompleteResult | 'error',
    private readonly errorMsg = 'fake provider error',
  ) {}

  async complete(_input: ModelCompleteInput): Promise<ModelCompleteResult> {
    if (this.result === 'error') {
      throw new ModelClientError(this.result === 'error' ? this.errorMsg : '');
    }
    return this.result;
  }
}

function tracker(
  inner: ModelClient,
  sink: ModelUsageSink,
  opts?: { model?: string; authMode?: string; adapterFamily?: string },
) {
  let counter = 0;
  return new ModelUsageTracker(
    inner,
    {
      model: opts?.model ?? 'claude-test',
      authMode: opts?.authMode ?? 'oauth-token',
      adapterFamily: opts?.adapterFamily ?? 'agent-harness',
      sink,
    },
    () => `id-${++counter}`,
  );
}

describe('ModelUsageTracker', () => {
  describe('successful calls', () => {
    it('records one entry per complete() call', async () => {
      const sink = new CaptureSink();
      const client = tracker(
        new FakeModel({ text: 'hello', stopReason: 'end_turn' }),
        sink,
      );
      await client.complete({ messages: [{ role: 'user', content: 'hi' }] });
      expect(sink.records).toHaveLength(1);
    });

    it('records the configured model, authMode, and adapterFamily labels', async () => {
      const sink = new CaptureSink();
      const client = tracker(new FakeModel({ text: '' }), sink, {
        model: 'claude-opus-4-8',
        authMode: 'api-key',
        adapterFamily: 'api-native',
      });
      await client.complete({ messages: [{ role: 'user', content: 'x' }] });
      const rec = sink.records[0];
      expect(rec.model).toBe('claude-opus-4-8');
      expect(rec.authMode).toBe('api-key');
      expect(rec.adapterFamily).toBe('api-native');
    });

    it('marks success=true and error=null on success', async () => {
      const sink = new CaptureSink();
      const client = tracker(new FakeModel({ text: 'ok' }), sink);
      await client.complete({ messages: [{ role: 'user', content: 'x' }] });
      expect(sink.records[0].success).toBe(true);
      expect(sink.records[0].error).toBeNull();
    });

    it('records a non-negative elapsed time', async () => {
      const sink = new CaptureSink();
      const client = tracker(new FakeModel({ text: 'ok' }), sink);
      await client.complete({ messages: [{ role: 'user', content: 'x' }] });
      expect(sink.records[0].elapsedMs).toBeGreaterThanOrEqual(0);
    });

    it('records token counts from the result usage field', async () => {
      const sink = new CaptureSink();
      const client = tracker(
        new FakeModel({
          text: 'ok',
          usage: {
            inputTokens: 120,
            outputTokens: 30,
            cacheReadTokens: 80,
            cacheWriteTokens: 40,
          },
        }),
        sink,
      );
      await client.complete({ messages: [{ role: 'user', content: 'x' }] });
      const rec = sink.records[0];
      expect(rec.inputTokens).toBe(120);
      expect(rec.outputTokens).toBe(30);
      expect(rec.cacheReadTokens).toBe(80);
      expect(rec.cacheWriteTokens).toBe(40);
    });

    it('records null token counts when usage is absent (e.g. Agent SDK path)', async () => {
      const sink = new CaptureSink();
      const client = tracker(new FakeModel({ text: 'ok' }), sink);
      await client.complete({ messages: [{ role: 'user', content: 'x' }] });
      const rec = sink.records[0];
      expect(rec.inputTokens).toBeNull();
      expect(rec.outputTokens).toBeNull();
      expect(rec.cacheReadTokens).toBeNull();
      expect(rec.cacheWriteTokens).toBeNull();
    });

    it('records requestId from the result', async () => {
      const sink = new CaptureSink();
      const client = tracker(
        new FakeModel({ text: 'ok', requestId: 'msg_abc123' }),
        sink,
      );
      await client.complete({ messages: [{ role: 'user', content: 'x' }] });
      expect(sink.records[0].requestId).toBe('msg_abc123');
    });

    it('records null requestId when absent', async () => {
      const sink = new CaptureSink();
      const client = tracker(new FakeModel({ text: 'ok' }), sink);
      await client.complete({ messages: [{ role: 'user', content: 'x' }] });
      expect(sink.records[0].requestId).toBeNull();
    });
  });

  describe('purpose mapping', () => {
    async function purposeFor(
      extra: Record<string, string> | undefined,
    ): Promise<string> {
      const sink = new CaptureSink();
      const client = tracker(new FakeModel({ text: '' }), sink);
      await client.complete({
        messages: [{ role: 'user', content: 'x' }],
        trace: { extra },
      });
      return sink.records[0].purpose;
    }

    it("maps 'turn_model_loop' to 'gameplay_turn'", async () => {
      expect(await purposeFor({ purpose: 'turn_model_loop' })).toBe(
        'gameplay_turn',
      );
    });

    it("maps 'turn_audit' to 'turn_audit'", async () => {
      expect(await purposeFor({ purpose: 'turn_audit' })).toBe('turn_audit');
    });

    it("maps 'session_recap' to 'session_recap'", async () => {
      expect(await purposeFor({ purpose: 'session_recap' })).toBe(
        'session_recap',
      );
    });

    it("maps 'campaign_bible' to 'campaign_bible'", async () => {
      expect(await purposeFor({ purpose: 'campaign_bible' })).toBe(
        'campaign_bible',
      );
    });

    it("maps 'arc_rollup' to 'arc_rollup'", async () => {
      expect(await purposeFor({ purpose: 'arc_rollup' })).toBe('arc_rollup');
    });

    it("maps 'live_test' to 'live_test'", async () => {
      expect(await purposeFor({ purpose: 'live_test' })).toBe('live_test');
    });

    it("maps unknown strings to 'maintenance'", async () => {
      expect(await purposeFor({ purpose: 'whatever' })).toBe('maintenance');
    });

    it("maps absent purpose to 'maintenance'", async () => {
      expect(await purposeFor(undefined)).toBe('maintenance');
    });
  });

  describe('trace metadata', () => {
    it('records campaignId, sessionId, turnId from the trace', async () => {
      const sink = new CaptureSink();
      const client = tracker(new FakeModel({ text: '' }), sink);
      await client.complete({
        messages: [{ role: 'user', content: 'x' }],
        trace: {
          campaignId: 'camp-1',
          sessionId: 'sess-1',
          turnId: 'turn-1',
        },
      });
      const rec = sink.records[0];
      expect(rec.campaignId).toBe('camp-1');
      expect(rec.sessionId).toBe('sess-1');
      expect(rec.turnId).toBe('turn-1');
    });

    it('records null trace ids when absent', async () => {
      const sink = new CaptureSink();
      const client = tracker(new FakeModel({ text: '' }), sink);
      await client.complete({ messages: [{ role: 'user', content: 'x' }] });
      const rec = sink.records[0];
      expect(rec.campaignId).toBeNull();
      expect(rec.sessionId).toBeNull();
      expect(rec.turnId).toBeNull();
      expect(rec.arcId).toBeNull();
    });

    it('records arcId from the trace for maintenance calls (eshyra-f0hj)', async () => {
      const sink = new CaptureSink();
      const client = tracker(new FakeModel({ text: '' }), sink);
      await client.complete({
        messages: [{ role: 'user', content: 'x' }],
        trace: {
          campaignId: 'camp-1',
          arcId: 'arc-7',
          extra: { purpose: 'arc_rollup' },
        },
      });
      const rec = sink.records[0];
      expect(rec.campaignId).toBe('camp-1');
      // Cross-session maintenance calls carry no single sessionId.
      expect(rec.sessionId).toBeNull();
      expect(rec.arcId).toBe('arc-7');
      expect(rec.purpose).toBe('arc_rollup');
    });

    it('records the profile from the profile metadata', async () => {
      const sink = new CaptureSink();
      const client = tracker(new FakeModel({ text: '' }), sink);
      await client.complete({
        messages: [{ role: 'user', content: 'x' }],
        profile: { profile: 'premium_dm', tier: 'premium' },
      });
      expect(sink.records[0].profile).toBe('premium_dm');
    });
  });

  describe('failure path', () => {
    it('re-throws the original error', async () => {
      const sink = new CaptureSink();
      const client = tracker(new FakeModel('error', 'timeout'), sink);
      await expect(
        client.complete({ messages: [{ role: 'user', content: 'x' }] }),
      ).rejects.toThrow(ModelClientError);
    });

    it('records success=false on error', async () => {
      const sink = new CaptureSink();
      const client = tracker(new FakeModel('error', 'timeout'), sink);
      await client
        .complete({ messages: [{ role: 'user', content: 'x' }] })
        .catch(() => {});
      expect(sink.records[0].success).toBe(false);
    });

    it('records a redacted error message without leaking secrets', async () => {
      const sink = new CaptureSink();
      const client = tracker(
        new FakeModel('error', 'API key sk-ant-secret123 is invalid'),
        sink,
      );
      await client
        .complete({ messages: [{ role: 'user', content: 'x' }] })
        .catch(() => {});
      const rec = sink.records[0];
      expect(rec.error).not.toBeNull();
      // The raw secret must not appear in the stored error message.
      expect(rec.error).not.toContain('sk-ant-secret123');
    });

    it('records null token counts on failure', async () => {
      const sink = new CaptureSink();
      const client = tracker(new FakeModel('error'), sink);
      await client
        .complete({ messages: [{ role: 'user', content: 'x' }] })
        .catch(() => {});
      const rec = sink.records[0];
      expect(rec.inputTokens).toBeNull();
      expect(rec.outputTokens).toBeNull();
    });
  });

  describe('sink resilience', () => {
    it('does not surface sink errors to the caller', async () => {
      const throwingSink: ModelUsageSink = {
        record: () => {
          throw new Error('sink broke');
        },
      };
      const client = tracker(new FakeModel({ text: 'ok' }), throwingSink);
      await expect(
        client.complete({ messages: [{ role: 'user', content: 'x' }] }),
      ).resolves.toMatchObject({ text: 'ok' });
    });
  });

  describe('attempt / round / failureKind (eshyra-17ng)', () => {
    it('forwards attempt and round from trace.extra as numbers', async () => {
      const sink = new CaptureSink();
      const client = tracker(new FakeModel({ text: 'ok' }), sink);
      await client.complete({
        messages: [{ role: 'user', content: 'x' }],
        trace: {
          extra: { purpose: 'turn_model_loop', attempt: '2', round: '3' },
        },
      });
      expect(sink.records[0].attempt).toBe(2);
      expect(sink.records[0].round).toBe(3);
    });

    it('leaves attempt/round null when the trace omits them', async () => {
      const sink = new CaptureSink();
      const client = tracker(new FakeModel({ text: 'ok' }), sink);
      await client.complete({ messages: [{ role: 'user', content: 'x' }] });
      expect(sink.records[0].attempt).toBeNull();
      expect(sink.records[0].round).toBeNull();
      expect(sink.records[0].failureKind).toBeNull();
    });

    it('classifies a rate-limit failure as provider_limit', async () => {
      const sink = new CaptureSink();
      const inner: ModelClient = {
        complete: () =>
          Promise.reject(new ModelRateLimitError('429 slow down', 30)),
      };
      const client = tracker(inner, sink);
      await client
        .complete({ messages: [{ role: 'user', content: 'x' }] })
        .catch(() => {});
      expect(sink.records[0].success).toBe(false);
      expect(sink.records[0].failureKind).toBe('provider_limit');
    });

    it('classifies any other provider failure as provider_error', async () => {
      const sink = new CaptureSink();
      const client = tracker(new FakeModel('error'), sink);
      await client
        .complete({ messages: [{ role: 'user', content: 'x' }] })
        .catch(() => {});
      expect(sink.records[0].failureKind).toBe('provider_error');
    });
  });

  describe('id uniqueness', () => {
    it('assigns a unique id to each record', async () => {
      const sink = new CaptureSink();
      const client = tracker(new FakeModel({ text: '' }), sink);
      await client.complete({ messages: [{ role: 'user', content: 'a' }] });
      await client.complete({ messages: [{ role: 'user', content: 'b' }] });
      expect(sink.records[0].id).not.toBe(sink.records[1].id);
    });
  });
});
