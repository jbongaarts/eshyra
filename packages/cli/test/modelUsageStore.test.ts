import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDatabase } from '@eshyra/core';
import type {
  ModelUsageRecord,
  ToolUsageRecord,
  TurnOutcomeRecord,
} from '@eshyra/core/internal';
import { afterEach, describe, expect, it } from 'vitest';
import { createUsageSink, ModelUsageStore } from '../src/modelUsageStore.js';

const tmpDirs: string[] = [];
function workDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'eshyra-usage-'));
  tmpDirs.push(dir);
  return dir;
}
afterEach(() => {
  while (tmpDirs.length > 0) {
    rmSync(tmpDirs.pop() as string, { recursive: true, force: true });
  }
});

function rec(overrides: Partial<ModelUsageRecord> = {}): ModelUsageRecord {
  return {
    id: `id-${Math.random().toString(36).slice(2)}`,
    at: '2026-01-15T12:00:00.000Z',
    campaignId: 'camp-1',
    sessionId: 'sess-1',
    turnId: 'turn-1',
    arcId: null,
    purpose: 'gameplay_turn',
    model: 'claude-opus-4-8',
    profile: 'premium_dm',
    authMode: 'oauth-token',
    adapterFamily: 'agent-harness',
    inputTokens: 1000,
    outputTokens: 250,
    cacheReadTokens: 800,
    cacheWriteTokens: null,
    elapsedMs: 3200,
    success: true,
    error: null,
    requestId: 'msg_abc',
    attempt: 1,
    round: 1,
    failureKind: null,
    ...overrides,
  };
}

function toolRec(overrides: Partial<ToolUsageRecord> = {}): ToolUsageRecord {
  return {
    id: `tid-${Math.random().toString(36).slice(2)}`,
    at: '2026-01-15T12:00:00.000Z',
    campaignId: 'camp-1',
    sessionId: 'sess-1',
    turnId: 'turn-1',
    attempt: 1,
    round: 1,
    tool: 'roll',
    source: 'native-mcp',
    mutates: false,
    ok: true,
    errorCode: null,
    elapsedMs: 120,
    ...overrides,
  };
}

function outcomeRec(
  overrides: Partial<TurnOutcomeRecord> = {},
): TurnOutcomeRecord {
  return {
    id: `oid-${Math.random().toString(36).slice(2)}`,
    at: '2026-01-15T12:00:00.000Z',
    campaignId: 'camp-1',
    sessionId: 'sess-1',
    turnId: 'turn-1',
    outcome: 'accepted',
    attempts: 1,
    modelRounds: 1,
    elapsedMs: 5000,
    reason: null,
    ...overrides,
  };
}

describe('ModelUsageStore', () => {
  it('creates the database and table on first open', () => {
    const dir = workDir();
    const dbPath = join(dir, 'diagnostics', 'usage.db');
    const store = new ModelUsageStore(dbPath);
    store.close();
    // If the store created the file the query returns an empty summary (not throws).
    const store2 = new ModelUsageStore(dbPath);
    const summary = store2.query();
    store2.close();
    expect(summary.totalCalls).toBe(0);
  });

  it('creates parent directories when they are absent', () => {
    const dir = workDir();
    const dbPath = join(dir, 'a', 'b', 'c', 'usage.db');
    const store = new ModelUsageStore(dbPath);
    store.close();
  });

  describe('record()', () => {
    it('writes a record and reflects it in the summary', () => {
      const dir = workDir();
      const store = new ModelUsageStore(join(dir, 'usage.db'));
      store.record(rec());
      const summary = store.query();
      store.close();
      expect(summary.totalCalls).toBe(1);
    });

    it('ignores duplicate ids (INSERT OR IGNORE)', () => {
      const dir = workDir();
      const store = new ModelUsageStore(join(dir, 'usage.db'));
      const r = rec({ id: 'dup' });
      store.record(r);
      store.record(r);
      const summary = store.query();
      store.close();
      expect(summary.totalCalls).toBe(1);
    });

    it('stores null token counts without error', () => {
      const dir = workDir();
      const store = new ModelUsageStore(join(dir, 'usage.db'));
      store.record(
        rec({
          inputTokens: null,
          outputTokens: null,
          cacheReadTokens: null,
          cacheWriteTokens: null,
        }),
      );
      const summary = store.query();
      store.close();
      expect(summary.totalCalls).toBe(1);
      expect(summary.inputTokens).toBeNull();
    });

    it('stores failure records with error text', () => {
      const dir = workDir();
      const store = new ModelUsageStore(join(dir, 'usage.db'));
      store.record(
        rec({
          success: false,
          error: 'provider timed out',
          inputTokens: null,
          outputTokens: null,
        }),
      );
      const summary = store.query();
      store.close();
      expect(summary.failures).toBe(1);
    });
  });

  describe('query() totals', () => {
    it('aggregates token counts across records', () => {
      const dir = workDir();
      const store = new ModelUsageStore(join(dir, 'usage.db'));
      store.record(
        rec({
          inputTokens: 100,
          outputTokens: 30,
          cacheReadTokens: 50,
          cacheWriteTokens: null,
        }),
      );
      store.record(
        rec({
          inputTokens: 200,
          outputTokens: 60,
          cacheReadTokens: null,
          cacheWriteTokens: null,
        }),
      );
      const summary = store.query();
      store.close();
      expect(summary.totalCalls).toBe(2);
      expect(summary.inputTokens).toBe(300);
      expect(summary.outputTokens).toBe(90);
      // SQLite SUM ignores NULLs; 50 + NULL = 50
      expect(summary.cacheReadTokens).toBe(50);
    });

    it('returns null token totals when all records have null tokens', () => {
      const dir = workDir();
      const store = new ModelUsageStore(join(dir, 'usage.db'));
      store.record(rec({ inputTokens: null, outputTokens: null }));
      const summary = store.query();
      store.close();
      expect(summary.inputTokens).toBeNull();
      expect(summary.outputTokens).toBeNull();
    });

    it('counts failures correctly', () => {
      const dir = workDir();
      const store = new ModelUsageStore(join(dir, 'usage.db'));
      store.record(rec({ success: true, error: null }));
      store.record(
        rec({
          success: false,
          error: 'err',
          inputTokens: null,
          outputTokens: null,
        }),
      );
      const summary = store.query();
      store.close();
      expect(summary.totalCalls).toBe(2);
      expect(summary.failures).toBe(1);
    });
  });

  describe('query() by-dimension breakdowns', () => {
    it('groups by purpose', () => {
      const dir = workDir();
      const store = new ModelUsageStore(join(dir, 'usage.db'));
      store.record(
        rec({ purpose: 'gameplay_turn', inputTokens: 100, outputTokens: 20 }),
      );
      store.record(
        rec({ purpose: 'gameplay_turn', inputTokens: 50, outputTokens: 10 }),
      );
      store.record(
        rec({ purpose: 'turn_audit', inputTokens: 30, outputTokens: 5 }),
      );
      const summary = store.query();
      store.close();

      const byPurpose = Object.fromEntries(
        summary.byPurpose.map((r) => [r.label, r]),
      );
      expect(byPurpose.gameplay_turn.calls).toBe(2);
      expect(byPurpose.gameplay_turn.inputTokens).toBe(150);
      expect(byPurpose.turn_audit.calls).toBe(1);
      expect(byPurpose.turn_audit.inputTokens).toBe(30);
    });

    it('groups by model', () => {
      const dir = workDir();
      const store = new ModelUsageStore(join(dir, 'usage.db'));
      store.record(rec({ model: 'claude-opus-4-8', inputTokens: 200 }));
      store.record(rec({ model: 'claude-haiku-4-5', inputTokens: 50 }));
      const summary = store.query();
      store.close();

      const byModel = Object.fromEntries(
        summary.byModel.map((r) => [r.label, r]),
      );
      expect(byModel['claude-opus-4-8'].calls).toBe(1);
      expect(byModel['claude-haiku-4-5'].calls).toBe(1);
    });
  });

  describe('query() filters', () => {
    function populatedStore(dir: string): ModelUsageStore {
      const store = new ModelUsageStore(join(dir, 'usage.db'));
      store.record(
        rec({
          campaignId: 'camp-1',
          sessionId: 'sess-1',
          at: '2026-01-10T00:00:00.000Z',
        }),
      );
      store.record(
        rec({
          campaignId: 'camp-1',
          sessionId: 'sess-2',
          at: '2026-02-01T00:00:00.000Z',
        }),
      );
      store.record(
        rec({
          campaignId: 'camp-2',
          sessionId: 'sess-3',
          at: '2026-03-01T00:00:00.000Z',
        }),
      );
      return store;
    }

    it('filters by campaignId', () => {
      const dir = workDir();
      const store = populatedStore(dir);
      const summary = store.query({ campaignId: 'camp-1' });
      store.close();
      expect(summary.totalCalls).toBe(2);
    });

    it('filters by sessionId', () => {
      const dir = workDir();
      const store = populatedStore(dir);
      const summary = store.query({ sessionId: 'sess-2' });
      store.close();
      expect(summary.totalCalls).toBe(1);
    });

    it('persists and filters by arcId for maintenance calls (eshyra-f0hj)', () => {
      const dir = workDir();
      const store = new ModelUsageStore(join(dir, 'usage.db'));
      store.record(
        rec({
          purpose: 'arc_rollup',
          campaignId: 'camp-1',
          sessionId: null,
          turnId: null,
          arcId: 'arc-1',
        }),
      );
      store.record(
        rec({
          purpose: 'arc_rollup',
          campaignId: 'camp-1',
          sessionId: null,
          turnId: null,
          arcId: 'arc-2',
        }),
      );
      const summary = store.query({ arcId: 'arc-1' });
      store.close();
      expect(summary.totalCalls).toBe(1);
      expect(summary.byPurpose).toEqual([
        expect.objectContaining({ label: 'arc_rollup', calls: 1 }),
      ]);
    });

    it('filters by since (inclusive)', () => {
      const dir = workDir();
      const store = populatedStore(dir);
      const summary = store.query({ since: '2026-02-01' });
      store.close();
      expect(summary.totalCalls).toBe(2);
    });

    it('combines multiple filters (AND)', () => {
      const dir = workDir();
      const store = populatedStore(dir);
      const summary = store.query({
        campaignId: 'camp-1',
        since: '2026-02-01',
      });
      store.close();
      expect(summary.totalCalls).toBe(1);
    });

    it('returns zero-calls summary when no records match', () => {
      const dir = workDir();
      const store = populatedStore(dir);
      const summary = store.query({ campaignId: 'no-such-campaign' });
      store.close();
      expect(summary.totalCalls).toBe(0);
      expect(summary.byPurpose).toHaveLength(0);
      expect(summary.byModel).toHaveLength(0);
    });
  });
});

describe('turn timing diagnostics (eshyra-17ng)', () => {
  it('reconstructs a per-turn timeline with separate model, audit, and tool spans', () => {
    const dir = workDir();
    const store = new ModelUsageStore(join(dir, 'usage.db'));
    // A successful turn: one gameplay model round, two MCP tools, one audit call.
    store.record(rec({ purpose: 'gameplay_turn', attempt: 1, round: 1 }));
    store.recordTool(toolRec({ tool: 'roll', mutates: false }));
    store.recordTool(
      toolRec({ tool: 'give_item', mutates: true, elapsedMs: 80 }),
    );
    store.record(
      rec({
        purpose: 'turn_audit',
        model: 'claude-haiku-4-5',
        attempt: 1,
        round: null,
        elapsedMs: 1800,
      }),
    );
    store.recordOutcome(outcomeRec({ outcome: 'accepted', attempts: 1 }));

    const timeline = store.timeline();
    store.close();

    expect(timeline).toHaveLength(1);
    const turn = timeline[0];
    expect(turn.turnId).toBe('turn-1');
    expect(turn.outcome).toBe('accepted');
    expect(turn.attempts).toBe(1);
    // Primary model and audit are distinct spans.
    expect(turn.modelCalls.map((c) => c.purpose)).toEqual([
      'gameplay_turn',
      'turn_audit',
    ]);
    // Each tool is timed individually with its name.
    expect(turn.toolCalls.map((t) => t.tool)).toEqual(['roll', 'give_item']);
    expect(turn.toolCalls.map((t) => t.mutates)).toEqual([false, true]);
  });

  it('keeps initial and retry attempts distinguishable in the timeline', () => {
    const dir = workDir();
    const store = new ModelUsageStore(join(dir, 'usage.db'));
    store.record(rec({ purpose: 'gameplay_turn', attempt: 1, round: 1 }));
    store.recordTool(toolRec({ tool: 'give_item', attempt: 1, round: 1 }));
    store.record(
      rec({
        purpose: 'gameplay_turn',
        attempt: 2,
        round: 1,
        elapsedMs: 5200,
      }),
    );
    store.recordTool(toolRec({ tool: 'give_item', attempt: 2, round: 1 }));
    store.recordOutcome(outcomeRec({ attempts: 2 }));

    const turn = store.timeline()[0];
    store.close();

    expect(turn.modelCalls.map((c) => c.attempt)).toEqual([1, 2]);
    expect(turn.toolCalls.map((t) => t.attempt)).toEqual([1, 2]);
    expect(turn.attempts).toBe(2);
  });

  it('records a provider_limit failure attempt with its elapsed time', () => {
    const dir = workDir();
    const store = new ModelUsageStore(join(dir, 'usage.db'));
    store.record(
      rec({
        purpose: 'gameplay_turn',
        success: false,
        failureKind: 'provider_limit',
        error: 'rate limited',
        elapsedMs: 52000,
      }),
    );
    store.recordOutcome(
      outcomeRec({
        outcome: 'provider_limit',
        reason: 'rate limited',
        elapsedMs: 52000,
      }),
    );

    const turn = store.timeline()[0];
    store.close();
    expect(turn.outcome).toBe('provider_limit');
    expect(turn.modelCalls[0].failureKind).toBe('provider_limit');
    expect(turn.modelCalls[0].success).toBe(false);
    expect(turn.totalElapsedMs).toBe(52000);
  });

  it('omits calls without a turn id from the timeline', () => {
    const dir = workDir();
    const store = new ModelUsageStore(join(dir, 'usage.db'));
    store.record(rec({ purpose: 'maintenance', turnId: null }));
    store.record(rec({ turnId: 'turn-1' }));
    const timeline = store.timeline();
    store.close();
    expect(timeline.map((t) => t.turnId)).toEqual(['turn-1']);
  });

  it('migrates a pre-eshyra-17ng model_usage table by adding the new columns', () => {
    const dir = workDir();
    const dbPath = join(dir, 'usage.db');
    // Create an old-schema model_usage table without
    // attempt/round/failure_kind/arc_id.
    const legacy = openDatabase(dbPath);
    legacy.exec(`
      CREATE TABLE model_usage (
        id TEXT PRIMARY KEY, at TEXT NOT NULL, campaign_id TEXT,
        session_id TEXT, turn_id TEXT, purpose TEXT NOT NULL, model TEXT NOT NULL,
        profile TEXT, auth_mode TEXT, adapter_family TEXT,
        input_tokens INTEGER, output_tokens INTEGER, cache_read_tokens INTEGER,
        cache_write_tokens INTEGER, elapsed_ms INTEGER NOT NULL,
        success INTEGER NOT NULL, error TEXT, request_id TEXT
      )`);
    legacy.close();

    // Opening the store must add the missing columns rather than fail on insert.
    const store = new ModelUsageStore(dbPath);
    expect(() => store.record(rec({ attempt: 3, round: 2 }))).not.toThrow();
    // The arc_id column added by eshyra-f0hj must also exist after migration.
    expect(() =>
      store.record(rec({ purpose: 'arc_rollup', arcId: 'arc-9' })),
    ).not.toThrow();
    const turn = store.timeline()[0];
    const arcMatch = store.query({ arcId: 'arc-9' });
    store.close();
    expect(turn.modelCalls[0].attempt).toBe(3);
    expect(arcMatch.totalCalls).toBe(1);
  });
});

describe('createUsageSink', () => {
  it('returns a working store when the data root is valid', () => {
    const dataRoot = workDir();
    const warnings: string[] = [];
    const sink = createUsageSink(dataRoot, (msg) => warnings.push(msg));
    sink.record(rec());
    sink.recordTool(toolRec());
    sink.recordOutcome(outcomeRec());
    sink.close();
    expect(warnings).toHaveLength(0);
  });

  it('falls back to a noop sink when the diagnostics directory cannot be created', () => {
    // Block mkdirSync by placing a file at the path where the directory must go.
    const dataRoot = workDir();
    const diagnosticsPath = join(dataRoot, 'diagnostics');
    writeFileSync(diagnosticsPath, 'not-a-directory');

    const warnings: string[] = [];
    const sink = createUsageSink(dataRoot, (msg) => warnings.push(msg));

    // The noop sink must accept every record method and close() without throwing.
    expect(() => sink.record(rec())).not.toThrow();
    expect(() => sink.recordTool(toolRec())).not.toThrow();
    expect(() => sink.recordOutcome(outcomeRec())).not.toThrow();
    expect(() => sink.close()).not.toThrow();
    // One warning must have been emitted.
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatch(/Usage tracking disabled/);
  });
});
