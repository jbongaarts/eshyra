/**
 * `eshyra checkpoint` commands (loreweaver-v3k).
 *
 * Checkpoints are Dolt snapshots of campaign canon, written on graceful
 * session close. The core `CheckpointStore` can already list, restore, and
 * fork them; this module is the user-facing CLI workflow over it. Restore and
 * fork always build a new database at a caller-chosen path and never mutate
 * the active campaign.
 */

import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { CheckpointStore, DoltRepo } from '@eshyra/core';
import {
  type AcquireWriterLock,
  acquireProductionWriterLock,
  tryAcquireWriterLock,
} from './campaignLock.js';
import { resolveCampaignDbPath } from './campaigns.js';

/** Host seam for the checkpoint commands. */
export interface CheckpointDeps {
  /** The resolved per-user data root (for registry campaign lookup). */
  root: string;
  /** Environment map — read for the `ESHYRA_DB_PATH` explicit override. */
  env: Record<string, string | undefined>;
  /** Output sink. */
  log: (message: string) => void;
  /**
   * Take the single-writer lock for the source campaign (ADR 0012). Restore and
   * fork read its checkpoint history (fork also writes a branch there), so they
   * are refused while another process is writing the campaign. Defaults to the
   * production OS lock.
   */
  acquireWriterLock?: AcquireWriterLock;
}

/**
 * Run `body` under the source campaign's writer lock, or report the refusal and
 * fail closed (exit 1) before anything is read or written.
 */
function withCampaignWriterLock(
  deps: CheckpointDeps,
  dbPath: string,
  body: () => number,
): number {
  const lock = tryAcquireWriterLock(
    deps.acquireWriterLock ?? acquireProductionWriterLock,
    dbPath,
    deps.log,
  );
  if (lock === undefined) {
    return 1;
  }
  try {
    return body();
  } finally {
    lock.release();
  }
}

/** The Dolt checkpoint repo and beads directory for a campaign database. */
function checkpointPaths(dbPath: string): {
  doltDir: string;
  beadsDir: string;
} {
  return {
    doltDir: `${dbPath}.checkpoints`,
    beadsDir: join(dirname(dbPath), '.beads'),
  };
}

/** Report and refuse when no `dolt` binary is resolvable. */
function doltReady(log: (message: string) => void): boolean {
  if (DoltRepo.available()) {
    return true;
  }
  log(
    'Dolt is not available. Checkpoint commands need the dolt binary — ' +
      'install it or run `eshyra dolt install`.',
  );
  return false;
}

/** Resolve the campaign database a checkpoint command should act on. */
function resolveDb(
  deps: CheckpointDeps,
  campaignId: string | undefined,
): { ok: true; dbPath: string } | { ok: false } {
  const resolved = resolveCampaignDbPath(deps.root, {
    explicitDbPath: deps.env.ESHYRA_DB_PATH?.trim() || undefined,
    campaignId,
  });
  if (!resolved.ok) {
    deps.log(resolved.message);
    return { ok: false };
  }
  return { ok: true, dbPath: resolved.dbPath };
}

/** `eshyra checkpoint list [campaign-id]`. */
function runList(rest: string[], deps: CheckpointDeps): number {
  const db = resolveDb(deps, rest[0]);
  if (!db.ok) {
    return 1;
  }
  if (!doltReady(deps.log)) {
    return 1;
  }
  const { doltDir, beadsDir } = checkpointPaths(db.dbPath);
  if (!existsSync(doltDir)) {
    deps.log(
      'No checkpoints for this campaign yet. They are written on graceful ' +
        'session close when Dolt is available.',
    );
    return 0;
  }
  try {
    const checkpoints = new CheckpointStore(doltDir, beadsDir).list();
    if (checkpoints.length === 0) {
      deps.log('No checkpoints for this campaign yet.');
      return 0;
    }
    deps.log(`Checkpoints (${checkpoints.length}, newest first):`);
    for (const checkpoint of checkpoints) {
      deps.log(`  ${checkpoint.id}  ${checkpoint.message}`);
    }
    return 0;
  } catch (err) {
    deps.log(`could not list checkpoints: ${(err as Error).message}`);
    return 1;
  }
}

/** `eshyra checkpoint restore <checkpoint-id> <new-db-path> [campaign-id]`. */
function runRestore(rest: string[], deps: CheckpointDeps): number {
  const [checkpointId, dest, campaignId] = rest;
  if (!checkpointId || !dest) {
    deps.log(
      'usage: eshyra checkpoint restore <checkpoint-id> <new-db-path> [campaign-id]',
    );
    return 1;
  }
  const db = resolveDb(deps, campaignId);
  if (!db.ok) {
    return 1;
  }
  if (!doltReady(deps.log)) {
    return 1;
  }
  const { doltDir, beadsDir } = checkpointPaths(db.dbPath);
  if (!existsSync(doltDir)) {
    deps.log('No checkpoints for this campaign.');
    return 1;
  }
  const destPath = resolve(dest);
  return withCampaignWriterLock(deps, db.dbPath, () => {
    try {
      new CheckpointStore(doltDir, beadsDir).restoreToNewWorkingCopy(
        checkpointId,
        destPath,
      );
      deps.log(
        `Restored checkpoint ${checkpointId} to ${destPath} (the active campaign was not modified).`,
      );
      return 0;
    } catch (err) {
      deps.log(`restore failed: ${(err as Error).message}`);
      return 1;
    }
  });
}

/**
 * `eshyra checkpoint fork <checkpoint-id> <branch-name> <new-db-path>
 * [campaign-id]`.
 */
function runFork(rest: string[], deps: CheckpointDeps): number {
  const [checkpointId, branchName, dest, campaignId] = rest;
  if (!checkpointId || !branchName || !dest) {
    deps.log(
      'usage: eshyra checkpoint fork <checkpoint-id> <branch-name> ' +
        '<new-db-path> [campaign-id]',
    );
    return 1;
  }
  const db = resolveDb(deps, campaignId);
  if (!db.ok) {
    return 1;
  }
  if (!doltReady(deps.log)) {
    return 1;
  }
  const { doltDir, beadsDir } = checkpointPaths(db.dbPath);
  if (!existsSync(doltDir)) {
    deps.log('No checkpoints for this campaign.');
    return 1;
  }
  const destPath = resolve(dest);
  return withCampaignWriterLock(deps, db.dbPath, () => {
    try {
      new CheckpointStore(doltDir, beadsDir).forkFromCheckpoint(
        checkpointId,
        branchName,
        destPath,
      );
      deps.log(
        `Forked checkpoint ${checkpointId} onto branch '${branchName}' at ` +
          `${destPath} (the active campaign was not modified).`,
      );
      return 0;
    } catch (err) {
      deps.log(`fork failed: ${(err as Error).message}`);
      return 1;
    }
  });
}

/** `eshyra checkpoint <list|restore|fork>` dispatcher. */
export function runCheckpointCommand(
  args: string[],
  deps: CheckpointDeps,
): number {
  const [subcommand, ...rest] = args;
  switch (subcommand) {
    case 'list':
      return runList(rest, deps);
    case 'restore':
      return runRestore(rest, deps);
    case 'fork':
      return runFork(rest, deps);
    default:
      deps.log('usage: eshyra checkpoint <list|restore|fork> ...');
      return 1;
  }
}
