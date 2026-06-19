import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ModelUsageRecord } from '@eshyra/core/internal';
import { afterEach, describe, expect, it } from 'vitest';
import { ModelUsageStore } from '../src/modelUsageStore.js';

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
