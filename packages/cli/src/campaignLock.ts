/**
 * CLI seam for the single-writer-per-campaign-database rule (ADR 0012).
 *
 * Every campaign-mutating entrypoint takes the lock before its first campaign
 * write and holds it for the command or session; read-only commands do not.
 * A refusal is reported and the command returns a failing exit code without
 * writing anything.
 */

import {
  acquireCampaignWriterLock,
  type CampaignWriterLock,
  CampaignWriterLockedError,
} from '@eshyra/core';

/** Acquire the writer lock for a campaign database path (throws when held). */
export type AcquireWriterLock = (dbPath: string) => CampaignWriterLock;

/** The production lock: an OS-released exclusive sidecar SQLite lock. */
export const acquireProductionWriterLock: AcquireWriterLock =
  acquireCampaignWriterLock;

/**
 * Try to take the lock. Returns the held lock, or `undefined` after reporting
 * the refusal through `report` when another writer already holds the campaign.
 * Any other failure propagates.
 */
export function tryAcquireWriterLock(
  acquire: AcquireWriterLock,
  dbPath: string,
  report: (message: string) => void,
): CampaignWriterLock | undefined {
  try {
    return acquire(dbPath);
  } catch (err) {
    if (err instanceof CampaignWriterLockedError) {
      report(err.message);
      return undefined;
    }
    throw err;
  }
}
