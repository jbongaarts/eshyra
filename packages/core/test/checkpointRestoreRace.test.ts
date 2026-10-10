/** eshyra-o9bd.19.5.15.1: restore must not clobber a destination that appears after the existence check. */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it, vi } from 'vitest';

const racing = vi.hoisted(() => ({ dest: '' }));
vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  return {
    ...actual,
    existsSync: (p: string) =>
      p === racing.dest ? false : actual.existsSync(p),
  };
});

import { readFileSync } from 'node:fs';
import { materializeSnapshot } from '../src/internal.js';

it('refuses, without replacing it, a destination created after the check', () => {
  const dir = mkdtempSync(join(tmpdir(), 'restore-race-'));
  try {
    const dest = join(dir, 'campaign.db');
    writeFileSync(dest, 'precious');
    racing.dest = dest; // existsSync lies: the race window
    expect(() => materializeSnapshot([], dest)).toThrow(/already exists/);
    expect(readFileSync(dest, 'utf8')).toBe('precious');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
