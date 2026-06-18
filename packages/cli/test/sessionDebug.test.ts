import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildModelCallEvent, type ModelMessage } from '@eshyra/core/internal';
import { afterEach, describe, expect, it } from 'vitest';
import {
  createFileSessionDebugSink,
  resolveSessionDebug,
  resolveSessionDebugMode,
} from '../src/sessionDebug.js';

const tmpDirs: string[] = [];
function workDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'eshyra-debug-'));
  tmpDirs.push(dir);
  return dir;
}
afterEach(() => {
  while (tmpDirs.length > 0) {
    rmSync(tmpDirs.pop() as string, { recursive: true, force: true });
  }
});

const messages: ModelMessage[] = [
  { role: 'user', content: '## Player Input\ngo north' },
];

function event(
  sessionId: string,
  outcome: Parameters<typeof buildModelCallEvent>[0]['outcome'],
  captureContent = false,
) {
  return buildModelCallEvent({
    trace: { sessionId, turnId: 't1', campaignId: 'c1' },
    model: 'claude-test',
    toolProtocolMode: 'fenced-text',
    system: 'authorization: Bearer sk-ant-secret-token',
    messages,
    outcome,
    captureContent,
  });
}

function readLines(path: string): Array<Record<string, unknown>> {
  return readFileSync(path, 'utf8')
    .trim()
    .split('\n')
    .filter((l) => l.length > 0)
    .map((l) => JSON.parse(l) as Record<string, unknown>);
}

describe('resolveSessionDebugMode', () => {
  it('treats unset / falsey values as off', () => {
    for (const v of [undefined, '', '0', 'off', 'false', '  OFF  ']) {
      expect(resolveSessionDebugMode({ ESHYRA_DEBUG_SESSION: v })).toBe('off');
    }
  });

  it('maps "full" to full and other truthy values to structural', () => {
    expect(resolveSessionDebugMode({ ESHYRA_DEBUG_SESSION: 'full' })).toBe(
      'full',
    );
    for (const v of ['1', 'on', 'true', 'structural']) {
      expect(resolveSessionDebugMode({ ESHYRA_DEBUG_SESSION: v })).toBe(
        'structural',
      );
    }
  });
});

describe('createFileSessionDebugSink', () => {
  it('writes a timestamped structural line and no content by default', () => {
    const dir = workDir();
    const sink = createFileSessionDebugSink({
      dir,
      captureContent: false,
      now: () => '2026-06-17T00:00:00.000Z',
    });
    sink.record(
      event('s1', { ok: true, resultChars: 3, resultApproxTokens: 1 }),
    );

    const lines = readLines(join(dir, 's1.jsonl'));
    expect(lines).toHaveLength(1);
    expect(lines[0].at).toBe('2026-06-17T00:00:00.000Z');
    expect(lines[0].kind).toBe('model_call');
    expect(lines[0].content).toBeUndefined();
    // The structural line carries sizes/sections, never the raw secret.
    expect(JSON.stringify(lines[0])).not.toContain('sk-ant-secret-token');
  });

  it('records both successful and failed turns to the same session file', () => {
    const dir = workDir();
    const sink = createFileSessionDebugSink({ dir, captureContent: false });
    sink.record(
      event('s1', { ok: true, resultChars: 3, resultApproxTokens: 1 }),
    );
    sink.record(event('s1', { ok: false, error: 'turn exploded' }));

    const lines = readLines(join(dir, 's1.jsonl'));
    expect(lines).toHaveLength(2);
    expect((lines[0].outcome as { ok: boolean }).ok).toBe(true);
    expect((lines[1].outcome as { ok: boolean }).ok).toBe(false);
  });

  it('writes sanitized content to a separate sensitive file under full capture', () => {
    const dir = workDir();
    const sink = createFileSessionDebugSink({ dir, captureContent: true });
    sink.record(
      event('s1', { ok: true, resultChars: 3, resultApproxTokens: 1 }, true),
    );

    const structural = readLines(join(dir, 's1.jsonl'));
    const sensitive = readLines(join(dir, 's1.sensitive.jsonl'));
    // Structural file still has NO content, even in full mode.
    expect(structural[0].content).toBeUndefined();
    // Sensitive file carries the sanitized content (secret redacted).
    const content = sensitive[0].content as { system: string };
    expect(content.system).not.toContain('sk-ant-secret-token');
    expect(content.system).toContain('[redacted]');
  });

  it('sanitizes the session id into a safe filename', () => {
    const dir = workDir();
    const sink = createFileSessionDebugSink({ dir, captureContent: false });
    sink.record(
      event('../../etc/passwd', {
        ok: true,
        resultChars: 1,
        resultApproxTokens: 1,
      }),
    );
    // The path separators are replaced, so the file stays inside `dir` (no
    // traversal); dots are kept but harmless without a separator.
    const lines = readLines(join(dir, '.._.._etc_passwd.jsonl'));
    expect(lines).toHaveLength(1);
  });

  it('is best-effort: a write failure is reported once and never throws', () => {
    const warnings: string[] = [];
    // A path whose parent is a file, not a directory, makes mkdir fail.
    const dir = workDir();
    const fileAsParent = join(dir, 's1.jsonl');
    const sink = createFileSessionDebugSink({
      dir: join(fileAsParent, 'nested'),
      captureContent: false,
      warn: (m) => warnings.push(m),
    });
    // Pre-create the blocking file via a sibling sink.
    createFileSessionDebugSink({ dir }).record(
      event('s1', { ok: true, resultChars: 1, resultApproxTokens: 1 }),
    );

    expect(() =>
      sink.record(
        event('s1', { ok: true, resultChars: 1, resultApproxTokens: 1 }),
      ),
    ).not.toThrow();
    expect(() =>
      sink.record(
        event('s1', { ok: true, resultChars: 1, resultApproxTokens: 1 }),
      ),
    ).not.toThrow();
    expect(warnings.length).toBe(1); // warns at most once
  });
});

describe('resolveSessionDebug', () => {
  it('returns no sink when disabled', () => {
    const resolved = resolveSessionDebug('/data/root', {
      ESHYRA_DEBUG_SESSION: 'off',
    });
    expect(resolved.mode).toBe('off');
    expect(resolved.sink).toBeUndefined();
    expect(resolved.notice).toBeUndefined();
  });

  it('builds a structural sink and notice when enabled', () => {
    const resolved = resolveSessionDebug('/data/root', {
      ESHYRA_DEBUG_SESSION: '1',
    });
    expect(resolved.mode).toBe('structural');
    expect(resolved.sink?.captureContent).toBe(false);
    expect(resolved.notice).toContain('structural');
  });

  it('builds a full-capture sink and a sensitive notice', () => {
    const resolved = resolveSessionDebug('/data/root', {
      ESHYRA_DEBUG_SESSION: 'full',
    });
    expect(resolved.mode).toBe('full');
    expect(resolved.sink?.captureContent).toBe(true);
    expect(resolved.notice).toContain('FULL');
  });
});
