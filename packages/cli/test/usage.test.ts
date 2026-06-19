import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type {
  ModelUsageRecord,
  ToolUsageRecord,
  TurnOutcomeRecord,
} from '@eshyra/core/internal';
import { afterEach, describe, expect, it } from 'vitest';
import { createUsageSink } from '../src/modelUsageStore.js';
import { runUsageCommand } from '../src/usage.js';

const tmpDirs: string[] = [];
function workDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'eshyra-usage-cmd-'));
  tmpDirs.push(dir);
  return dir;
}
afterEach(() => {
  while (tmpDirs.length > 0) {
    rmSync(tmpDirs.pop() as string, { recursive: true, force: true });
  }
});

function model(overrides: Partial<ModelUsageRecord> = {}): ModelUsageRecord {
  return {
    id: `m-${Math.random().toString(36).slice(2)}`,
    at: '2026-01-15T12:00:00.000Z',
    campaignId: 'camp-1',
    sessionId: 'sess-1',
    turnId: 'turn-1',
    arcId: null,
    purpose: 'gameplay_turn',
    model: 'claude-opus-4-8',
    profile: null,
    authMode: null,
    adapterFamily: 'agent-harness',
    inputTokens: null,
    outputTokens: null,
    cacheReadTokens: null,
    cacheWriteTokens: null,
    elapsedMs: 38400,
    success: true,
    error: null,
    requestId: null,
    attempt: 1,
    round: 1,
    failureKind: null,
    ...overrides,
  };
}

function tool(overrides: Partial<ToolUsageRecord> = {}): ToolUsageRecord {
  return {
    id: `t-${Math.random().toString(36).slice(2)}`,
    at: '2026-01-15T12:00:00.000Z',
    campaignId: 'camp-1',
    sessionId: 'sess-1',
    turnId: 'turn-1',
    attempt: 1,
    round: 1,
    tool: 'lookup_rules',
    source: 'native-mcp',
    mutates: false,
    ok: true,
    errorCode: null,
    elapsedMs: 1200,
    ...overrides,
  };
}

function outcome(
  overrides: Partial<TurnOutcomeRecord> = {},
): TurnOutcomeRecord {
  return {
    id: `o-${Math.random().toString(36).slice(2)}`,
    at: '2026-01-15T12:00:00.000Z',
    campaignId: 'camp-1',
    sessionId: 'sess-1',
    turnId: 'turn-1',
    outcome: 'accepted',
    attempts: 1,
    modelRounds: 1,
    elapsedMs: 57000,
    reason: null,
    ...overrides,
  };
}

describe('runUsageCommand', () => {
  it('reports no data before any session is played', () => {
    const dataRoot = workDir();
    const lines: string[] = [];
    const code = runUsageCommand([], {
      dataRoot,
      log: (m) => lines.push(m),
    });
    expect(code).toBe(0);
    expect(lines.join('\n')).toContain('No usage data found');
  });

  it('rejects an unknown flag with usage help', () => {
    const dataRoot = workDir();
    const lines: string[] = [];
    const code = runUsageCommand(['--bogus'], {
      dataRoot,
      log: (m) => lines.push(m),
    });
    expect(code).toBe(1);
    expect(lines.join('\n')).toContain('--timeline');
  });

  it('--arc filters the summary to one campaign arc (eshyra-f0hj)', () => {
    const dataRoot = workDir();
    const sink = createUsageSink(dataRoot);
    sink.record(
      model({
        purpose: 'arc_rollup',
        sessionId: null,
        turnId: null,
        arcId: 'arc-1',
      }),
    );
    sink.record(
      model({
        purpose: 'arc_rollup',
        sessionId: null,
        turnId: null,
        arcId: 'arc-2',
      }),
    );
    sink.close();

    const lines: string[] = [];
    const code = runUsageCommand(['--arc', 'arc-1'], {
      dataRoot,
      log: (m) => lines.push(m),
    });
    const out = lines.join('\n');
    expect(code).toBe(0);
    expect(out).toContain('filter: arc=arc-1');
    expect(out).toContain('Total calls:   1');
    expect(out).toContain('arc_rollup');
  });

  it('--timeline renders a per-turn breakdown of model, audit, and tool time', () => {
    const dataRoot = workDir();
    const sink = createUsageSink(dataRoot);
    sink.record(model({ purpose: 'gameplay_turn', attempt: 1, round: 1 }));
    sink.recordTool(tool({ tool: 'lookup_rules', mutates: false }));
    sink.recordTool(tool({ tool: 'give_item', mutates: true, elapsedMs: 800 }));
    sink.record(
      model({
        purpose: 'turn_audit',
        model: 'claude-haiku-4-5',
        round: null,
        elapsedMs: 18300,
      }),
    );
    sink.recordOutcome(outcome({ outcome: 'accepted', attempts: 1 }));
    sink.close();

    const lines: string[] = [];
    const code = runUsageCommand(['--timeline'], {
      dataRoot,
      log: (m) => lines.push(m),
    });
    const out = lines.join('\n');

    expect(code).toBe(0);
    expect(out).toContain('turn turn-1');
    expect(out).toContain('outcome=accepted');
    expect(out).toContain('attempt 1 gameplay_turn claude-opus-4-8');
    expect(out).toContain('turn_audit claude-haiku-4-5');
    // Tools nest under the gameplay round, with read-only / mutating labels.
    expect(out).toContain('tool lookup_rules');
    expect(out).toContain('read-only');
    expect(out).toContain('tool give_item');
    expect(out).toContain('mutating');
  });

  it('--timeline reports a provider_limit failure attempt', () => {
    const dataRoot = workDir();
    const sink = createUsageSink(dataRoot);
    sink.record(
      model({
        success: false,
        failureKind: 'provider_limit',
        elapsedMs: 52300,
      }),
    );
    sink.recordOutcome(
      outcome({ outcome: 'provider_limit', reason: 'rate limited' }),
    );
    sink.close();

    const lines: string[] = [];
    runUsageCommand(['--timeline'], { dataRoot, log: (m) => lines.push(m) });
    const out = lines.join('\n');
    expect(out).toContain('outcome=provider_limit');
    expect(out).toContain('failed provider_limit');
  });
});
