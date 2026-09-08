import { createHash } from 'node:crypto';
import type { RunTurnInput } from '../orchestrator/orchestrator.js';
import {
  type SnapshotRecord,
  serializeCampaign,
} from '../persistence/checkpoint/serialize.js';
import type { Db } from '../persistence/db.js';
import { quoteIdent } from '../persistence/sql.js';
import { CampaignRuleError } from './campaignRules.js';

const EXCLUDED = new Set([
  'turn_replay',
  'turn_replay_diagnostic',
  'turn_failure_diagnostic',
]);

export interface TurnReplayRow {
  campaign_id: string;
  session_id: string;
  turn_id: string;
  input_json: string;
  before_json: string;
  state_hash: string;
  status: 'available' | 'pending' | 'replayed';
}

export function replaySnapshot(db: Db): SnapshotRecord[] {
  return serializeCampaign(db).filter((record) => !EXCLUDED.has(record.table));
}

export function replayStateHash(db: Db): string {
  return createHash('sha256')
    .update(JSON.stringify(replaySnapshot(db)))
    .digest('hex');
}

export function readTurnReplay(
  db: Db,
  campaignId: string,
): TurnReplayRow | undefined {
  return db
    .prepare('SELECT * FROM turn_replay WHERE campaign_id = ?')
    .get(campaignId) as TurnReplayRow | undefined;
}

export function assertReplayState(db: Db, row: TurnReplayRow): void {
  if (replayStateHash(db) !== row.state_hash)
    throw new CampaignRuleError(
      'Campaign state changed after this adjudication; replay would erase later changes.',
    );
}

/** Called inside the turn transaction, after all canonical writes. */
export function retainTurnReplay(
  db: Db,
  input: RunTurnInput,
  before: SnapshotRecord[],
): void {
  const previous = readTurnReplay(db, input.campaignId);
  const replayed =
    previous?.status === 'pending' &&
    previous.turn_id === input.turnId &&
    previous.session_id === input.sessionId;
  db.prepare(`INSERT INTO turn_replay (campaign_id, session_id, turn_id, input_json, before_json, state_hash, status)
    VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(campaign_id) DO UPDATE SET
    session_id=excluded.session_id, turn_id=excluded.turn_id, input_json=excluded.input_json,
    before_json=excluded.before_json, state_hash=excluded.state_hash, status=excluded.status`).run(
    input.campaignId,
    input.sessionId,
    input.turnId,
    JSON.stringify(input),
    JSON.stringify(before),
    replayStateHash(db),
    replayed ? 'replayed' : 'available',
  );
}

/** Restore rows into the same connection, preserving schema, indexes and diagnostics. */
export function restoreReplaySnapshot(db: Db, records: SnapshotRecord[]): void {
  if (!db.inTransaction)
    throw new CampaignRuleError(
      'Replay restore requires an enclosing transaction.',
    );
  const schema = replaySnapshot(db).filter(
    (record) => record.kind === 'schema',
  );
  if (
    JSON.stringify(schema) !==
    JSON.stringify(records.filter((record) => record.kind === 'schema'))
  )
    throw new CampaignRuleError(
      'Replay snapshot schema differs from the current database.',
    );
  const triggers = db
    .prepare(
      "SELECT name, sql FROM sqlite_master WHERE type='trigger' ORDER BY name",
    )
    .all() as { name: string; sql: string }[];
  // Captured legacy rows may predate stricter insert guards. Restore the exact
  // accepted snapshot, then reinstate every guard in this same transaction.
  for (const trigger of triggers)
    db.exec(`DROP TRIGGER ${quoteIdent(trigger.name)}`);
  db.pragma('defer_foreign_keys = ON');
  for (const record of schema)
    db.exec(`DELETE FROM ${quoteIdent(record.table)}`);
  for (const record of records) {
    if (record.kind !== 'row') continue;
    const row = JSON.parse(record.payload) as Record<string, unknown>;
    const keys = Object.keys(row);
    const values = keys.map((key) => {
      const value = row[key];
      return typeof value === 'object' && value !== null && '__blob' in value
        ? Buffer.from(String(value.__blob), 'base64')
        : value;
    });
    db.prepare(
      `INSERT INTO ${quoteIdent(record.table)} (${keys.map(quoteIdent).join(',')}) VALUES (${keys.map(() => '?').join(',')})`,
    ).run(...values);
  }
  for (const trigger of triggers) db.exec(trigger.sql);
  if ((db.pragma('foreign_key_check') as unknown[]).length > 0)
    throw new CampaignRuleError(
      'Replay snapshot violates foreign-key integrity.',
    );
}
