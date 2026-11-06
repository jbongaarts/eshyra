import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  acquireCampaignWriterLock,
  DEFAULT_MEMORY_CONFIG,
  DoltRepo,
} from '@eshyra/core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { runCheckpointCommand } from '../src/checkpoints.js';
import { runDemo, runPlay } from '../src/play.js';
import type { PlayDeps } from '../src/playTypes.js';

/**
 * ADR 0012 "Single writer per campaign database" at the CLI layer: while one
 * process holds a campaign, a second mutating command on it fails closed with a
 * clear error and writes nothing.
 */

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0))
    rmSync(dir, { recursive: true, force: true });
});

function campaignDb(): string {
  const dir = mkdtempSync(join(tmpdir(), 'eshyra-cli-writer-lock-'));
  dirs.push(dir);
  return join(dir, 'campaign.db');
}

function playHarness() {
  const lines: string[] = [];
  const openDb = vi.fn(() => {
    throw new Error('the campaign database must not be opened');
  });
  const deps = {
    io: { write: (line: string) => lines.push(line), prompt: async () => '' },
    openDb,
    acquireWriterLock: acquireCampaignWriterLock,
    memoryConfig: { ...DEFAULT_MEMORY_CONFIG },
  } as unknown as PlayDeps;
  return { deps, lines, openDb };
}

describe('second writer on one campaign database', () => {
  it('play is refused with a clear error and opens nothing', async () => {
    const dbPath = campaignDb();
    const holder = acquireCampaignWriterLock(dbPath);
    try {
      const { deps, lines, openDb } = playHarness();
      expect(await runPlay(deps, { dbPath })).toBe(1);
      expect(lines.join('\n')).toContain('already open for writing');
      expect(openDb).not.toHaveBeenCalled();
      expect(existsSync(dbPath)).toBe(false);
    } finally {
      holder.release();
    }
  });

  it('demo is refused with a clear error and opens nothing', async () => {
    const dbPath = campaignDb();
    const holder = acquireCampaignWriterLock(dbPath);
    try {
      const { deps, lines, openDb } = playHarness();
      expect(await runDemo(deps, { dbPath })).toBe(1);
      expect(lines.join('\n')).toContain('already open for writing');
      expect(openDb).not.toHaveBeenCalled();
      expect(existsSync(dbPath)).toBe(false);
    } finally {
      holder.release();
    }
  });

  it('releases the lock when a refused play ends, so the holder can finish and a later play proceeds', async () => {
    const dbPath = campaignDb();
    const holder = acquireCampaignWriterLock(dbPath);
    const { deps } = playHarness();
    await runPlay(deps, { dbPath });
    holder.release();
    // The refused run must not have left a lock behind.
    acquireCampaignWriterLock(dbPath).release();
  });

  it.skipIf(!DoltRepo.available())(
    'checkpoint restore and fork are refused and create nothing',
    () => {
      const dbPath = campaignDb();
      const dir = join(dbPath, '..');
      mkdirSync(`${dbPath}.checkpoints`);
      writeFileSync(dbPath, '');
      const holder = acquireCampaignWriterLock(dbPath);
      try {
        const logs: string[] = [];
        const deps = {
          root: dir,
          env: { ESHYRA_DB_PATH: dbPath },
          log: (message: string) => logs.push(message),
        };
        const restoreDest = join(dir, 'restored.db');
        const forkDest = join(dir, 'forked.db');
        expect(
          runCheckpointCommand(['restore', 'cp-1', restoreDest], deps),
        ).toBe(1);
        expect(
          runCheckpointCommand(['fork', 'cp-1', 'branch', forkDest], deps),
        ).toBe(1);
        expect(
          logs.filter((l) => l.includes('already open for writing')),
        ).toHaveLength(2);
        expect(existsSync(restoreDest)).toBe(false);
        expect(existsSync(forkDest)).toBe(false);
      } finally {
        holder.release();
      }
    },
    30_000,
  );
});
