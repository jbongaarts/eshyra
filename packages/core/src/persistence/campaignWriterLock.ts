import { existsSync, realpathSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import Database from 'better-sqlite3';

/**
 * Single writer per physical campaign database (ADR 0012, "Single writer per
 * campaign database", eshyra-o9bd.19.6.7.8).
 *
 * A writer takes an EXCLUSIVE SQLite lock on a sidecar lock database beside the
 * campaign database (`<campaign>.writer-lock`) and holds it for its whole
 * session. The operating system drops the lock when the process exits or
 * crashes, so there are no PID files and no stale-lock cleanup. SQLite also
 * tracks its file locks per process, so a second writer inside the same process
 * is refused too. Readers open the campaign database itself and never touch the
 * lock. The sidecar's contents are meaningless; only the lock matters.
 */

/** Suffix of the sidecar lock database that sits beside a campaign database. */
export const CAMPAIGN_WRITER_LOCK_SUFFIX = '.writer-lock';

/** Another writer (this or another process) already holds the campaign. */
export class CampaignWriterLockedError extends Error {
  readonly dbPath: string;
  readonly lockPath: string;

  constructor(dbPath: string, lockPath: string) {
    super(
      `campaign database ${dbPath} is already open for writing by another ` +
        'eshyra process. Only one process may write a campaign at a time; ' +
        'close the other session (or wait for it to finish) and try again.',
    );
    this.name = 'CampaignWriterLockedError';
    this.dbPath = dbPath;
    this.lockPath = lockPath;
  }
}

/** A held campaign writer lock. */
export interface CampaignWriterLock {
  /** The campaign database path this lock guards (as given). */
  readonly dbPath: string;
  /** The sidecar lock database path. */
  readonly lockPath: string;
  /** Release the lock. Idempotent. */
  release(): void;
}

/**
 * The sidecar lock path for a campaign database. Symlinks are resolved so two
 * spellings of one physical database share one lock.
 */
export function campaignWriterLockPath(dbPath: string): string {
  const absolute = resolve(dbPath);
  const canonical = existsSync(absolute)
    ? realpathSync(absolute)
    : join(realpathSync(dirname(absolute)), basename(absolute));
  return `${canonical}${CAMPAIGN_WRITER_LOCK_SUFFIX}`;
}

/**
 * Take the writer lock for `dbPath`, or throw {@link CampaignWriterLockedError}
 * without waiting. Call before the first campaign write and hold it for the
 * command or session; release it when done.
 */
export function acquireCampaignWriterLock(dbPath: string): CampaignWriterLock {
  const lockPath = campaignWriterLockPath(dbPath);
  // timeout: 0 — refuse immediately rather than wait on the other writer.
  const db = new Database(lockPath, { timeout: 0 });
  try {
    db.pragma('locking_mode = EXCLUSIVE');
    db.exec('BEGIN EXCLUSIVE');
  } catch (err) {
    db.close();
    if ((err as { code?: string }).code?.startsWith('SQLITE_BUSY')) {
      throw new CampaignWriterLockedError(dbPath, lockPath);
    }
    throw err;
  }
  let released = false;
  return {
    dbPath,
    lockPath,
    release() {
      if (released) return;
      released = true;
      db.close();
    },
  };
}
