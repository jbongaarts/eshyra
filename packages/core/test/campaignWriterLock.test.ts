import { type ChildProcess, spawn } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import {
  acquireCampaignWriterLock,
  CampaignWriterLockedError,
  campaignWriterLockPath,
} from '../src/persistence/campaignWriterLock.js';

/**
 * ADR 0012 "Single writer per campaign database": one writing process per
 * physical campaign database, released by the OS when the holder dies.
 */

const LOCK_MODULE_URL = pathToFileURL(
  join(process.cwd(), 'packages/core/src/persistence/campaignWriterLock.ts'),
).href;

// The lock module imports only node builtins and better-sqlite3, so a child
// can load the TypeScript source directly (Node strips the types).
const CHILD_SCRIPT = `
import { acquireCampaignWriterLock } from ${JSON.stringify(LOCK_MODULE_URL)};
const [mode, dbPath] = process.argv.slice(1);
try {
  const lock = acquireCampaignWriterLock(dbPath);
  if (mode === 'hold') {
    console.log('LOCKED');
    setInterval(() => {}, 1000);
  } else {
    console.log('ACQUIRED');
    lock.release();
  }
} catch (err) {
  console.log(err.name === 'CampaignWriterLockedError' ? 'REFUSED' : 'ERROR ' + err);
}
`;

const dirs: string[] = [];
const children: ChildProcess[] = [];
afterEach(() => {
  for (const child of children.splice(0)) child.kill('SIGKILL');
  for (const dir of dirs.splice(0))
    rmSync(dir, { recursive: true, force: true });
});

function campaignDb(): string {
  const dir = mkdtempSync(join(tmpdir(), 'eshyra-writer-lock-'));
  dirs.push(dir);
  const dbPath = join(dir, 'campaign.db');
  writeFileSync(dbPath, '');
  return dbPath;
}

function startChild(
  mode: 'hold' | 'try',
  dbPath: string,
): { child: ChildProcess; firstLine: Promise<string>; exited: Promise<void> } {
  const child = spawn(
    process.execPath,
    ['--input-type=module', '-e', CHILD_SCRIPT, mode, dbPath],
    { stdio: ['ignore', 'pipe', 'inherit'] },
  );
  children.push(child);
  const firstLine = new Promise<string>((resolve, reject) => {
    let buffer = '';
    child.stdout?.on('data', (chunk: Buffer) => {
      buffer += chunk.toString();
      const end = buffer.indexOf('\n');
      if (end >= 0) resolve(buffer.slice(0, end).trim());
    });
    child.on('error', reject);
    child.on('exit', () => reject(new Error(`child exited: ${buffer}`)));
  });
  const exited = new Promise<void>((resolve) =>
    child.on('exit', () => resolve()),
  );
  // A resolved firstLine makes the later exit rejection a harmless no-op.
  firstLine.catch(() => {});
  return { child, firstLine, exited };
}

describe('campaign writer lock (in process)', () => {
  it('refuses a second writer connection and allows one after release', () => {
    const dbPath = campaignDb();
    const first = acquireCampaignWriterLock(dbPath);
    expect(() => acquireCampaignWriterLock(dbPath)).toThrow(
      CampaignWriterLockedError,
    );
    first.release();
    first.release(); // idempotent
    const again = acquireCampaignWriterLock(dbPath);
    again.release();
  });

  it('names the campaign in a clear refusal and does not wait', () => {
    const dbPath = campaignDb();
    const first = acquireCampaignWriterLock(dbPath);
    try {
      const started = Date.now();
      let message = '';
      try {
        acquireCampaignWriterLock(dbPath);
      } catch (err) {
        message = (err as Error).message;
      }
      expect(Date.now() - started).toBeLessThan(2000);
      expect(message).toContain(dbPath);
      expect(message).toContain('another eshyra process');
    } finally {
      first.release();
    }
  });

  it('guards different campaigns independently and one physical file under one lock', () => {
    const a = campaignDb();
    const b = campaignDb();
    expect(campaignWriterLockPath(a)).not.toBe(campaignWriterLockPath(b));
    const lockA = acquireCampaignWriterLock(a);
    const lockB = acquireCampaignWriterLock(b);
    lockA.release();
    lockB.release();
  });

  it('works for a campaign database that does not exist yet', () => {
    const dbPath = campaignDb();
    rmSync(dbPath);
    const lock = acquireCampaignWriterLock(dbPath);
    expect(existsSync(dbPath)).toBe(false);
    expect(() => acquireCampaignWriterLock(dbPath)).toThrow(
      CampaignWriterLockedError,
    );
    lock.release();
  });
});

describe('campaign writer lock (across processes)', () => {
  it('refuses a second process while held, and admits one after release', async () => {
    const dbPath = campaignDb();
    const holder = acquireCampaignWriterLock(dbPath);
    const refused = startChild('try', dbPath);
    expect(await refused.firstLine).toBe('REFUSED');
    await refused.exited;
    holder.release();
    const admitted = startChild('try', dbPath);
    expect(await admitted.firstLine).toBe('ACQUIRED');
  }, 30_000);

  it('refuses this process while another process holds the lock', async () => {
    const dbPath = campaignDb();
    const holder = startChild('hold', dbPath);
    expect(await holder.firstLine).toBe('LOCKED');
    expect(() => acquireCampaignWriterLock(dbPath)).toThrow(
      CampaignWriterLockedError,
    );
  }, 30_000);

  it('releases the lock when the holder is killed without cleanup', async () => {
    const dbPath = campaignDb();
    const holder = startChild('hold', dbPath);
    expect(await holder.firstLine).toBe('LOCKED');
    expect(() => acquireCampaignWriterLock(dbPath)).toThrow(
      CampaignWriterLockedError,
    );
    holder.child.kill('SIGKILL');
    await holder.exited;
    const lock = acquireCampaignWriterLock(dbPath);
    lock.release();
  }, 30_000);
});
