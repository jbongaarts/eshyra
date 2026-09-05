import { existsSync, renameSync, rmSync } from 'node:fs';
import { openDatabase, withTransaction } from '../db.js';
import { quoteIdent } from '../sql.js';
import { type Checkpoint, DoltRepo } from './doltRepo.js';
import { assertSeparateFromBeads } from './separation.js';
import type { SnapshotRecord } from './serialize.js';
import { serializeCampaign } from './serialize.js';

const RESTORE_TEMP_SUFFIX = 'restore';

export class CheckpointError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CheckpointError';
  }
}

export class CheckpointStore {
  private readonly repo: DoltRepo;

  constructor(doltDir: string, beadsDir: string) {
    assertSeparateFromBeads(doltDir, beadsDir);
    this.repo = new DoltRepo(doltDir);
  }

  checkpoint(liveDbPath: string, message: string): string {
    const db = openDatabase(liveDbPath);
    try {
      const records = serializeCampaign(db);
      this.repo.init();
      this.repo.applySnapshot(records);
      return this.repo.commit(message);
    } finally {
      db.close();
    }
  }

  list(): Checkpoint[] {
    return this.repo.log();
  }

  restoreToNewWorkingCopy(checkpointId: string, destDbPath: string): string {
    const records = this.repo.readSnapshotAt(checkpointId);
    materializeSnapshot(records, destDbPath);
    return destDbPath;
  }

  forkFromCheckpoint(
    checkpointId: string,
    branchName: string,
    destDbPath: string,
  ): string {
    this.repo.branch(branchName, checkpointId);
    return this.restoreToNewWorkingCopy(checkpointId, destDbPath);
  }
}

/**
 * Rebuild a campaign snapshot into a SQLite file. Restore is destination-safe
 * and atomic: it refuses to overwrite an existing destination, and it builds
 * into a sibling temp file that is renamed into place only after every record
 * has been applied. Any failure removes the temp file, so a partial restore
 * can never leave a usable-looking database at `destDbPath`.
 *
 * Schema and rows are applied in one transaction with `defer_foreign_keys`, so
 * snapshot rows can be inserted in table-name order — the order `serialize`
 * emits them — without a dependency-ordered topological sort. Foreign-key
 * enforcement is checked once at commit, when every table and row is present.
 */
export function materializeSnapshot(
  records: SnapshotRecord[],
  destDbPath: string,
): void {
  if (existsSync(destDbPath)) {
    throw new CheckpointError(
      `restore destination already exists: ${destDbPath}`,
    );
  }
  const tmpDbPath = `${destDbPath}.${RESTORE_TEMP_SUFFIX}-${process.pid}-${Date.now()}.tmp`;
  try {
    const db = openDatabase(tmpDbPath);
    try {
      withTransaction(db, (txnDb) => {
        // Resets automatically at commit; must be set per transaction.
        txnDb.pragma('defer_foreign_keys = ON');
        for (const r of records.filter((x) => x.kind === 'schema')) {
          const { create } = JSON.parse(r.payload) as { create: string };
          txnDb.exec(`${create};`);
        }
        for (const r of records.filter((x) => x.kind === 'row')) {
          const row = JSON.parse(r.payload) as Record<string, unknown>;
          const cols = Object.keys(row);
          const ph = cols.map(() => '?').join(', ');
          const vals = cols.map((c) => {
            const v = row[c] as unknown;
            if (v && typeof v === 'object' && '__blob' in (v as object)) {
              return Buffer.from((v as { __blob: string }).__blob, 'base64');
            }
            return v as string | number | null;
          });
          // Snapshot table/column names come from our own serialized SQLite
          // schema metadata; quote them centrally before splicing into SQL.
          txnDb
            .prepare(
              `INSERT INTO ${quoteIdent(r.table)} (${cols
                .map((c) => quoteIdent(c))
                .join(', ')}) VALUES (${ph})`,
            )
            .run(...vals);
        }
      });
    } finally {
      db.close();
    }
    renameSync(tmpDbPath, destDbPath);
  } catch (e) {
    removeDbFiles(tmpDbPath);
    throw e;
  }
}

/** Remove a SQLite file and any WAL/SHM/journal sidecars left behind. */
function removeDbFiles(dbPath: string): void {
  for (const suffix of ['', '-wal', '-shm', '-journal']) {
    rmSync(`${dbPath}${suffix}`, { force: true });
  }
}
