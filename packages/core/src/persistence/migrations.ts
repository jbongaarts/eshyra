import type { Db } from './db.js';
import { withTransaction } from './db.js';

export class SchemaMigrationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SchemaMigrationError';
  }
}

export type Migration = (db: Db) => void;

// v7 → v8: added campaign_arc (with one-open partial index), arc_id column on
// campaign_session, and campaign_rules_binding singleton.
const v7_to_v8: Migration = (db) => {
  db.exec(`
    CREATE TABLE IF NOT EXISTS campaign_arc (
      campaign_id  TEXT NOT NULL,
      arc_id       TEXT NOT NULL,
      sequence_no  INTEGER NOT NULL,
      status       TEXT NOT NULL CHECK (status IN ('open', 'closed')),
      opened_at    TEXT NOT NULL,
      closed_at    TEXT,
      PRIMARY KEY (campaign_id, arc_id)
    );
    CREATE UNIQUE INDEX IF NOT EXISTS campaign_arc_one_open
      ON campaign_arc(campaign_id) WHERE status = 'open';
    CREATE TABLE IF NOT EXISTS campaign_rules_binding (
      id              INTEGER PRIMARY KEY CHECK (id = 1),
      base_system_id  TEXT NOT NULL,
      base_pack_id    TEXT NOT NULL,
      base_version    TEXT NOT NULL,
      addons_json     TEXT NOT NULL DEFAULT '[]',
      resolved_at     TEXT NOT NULL
    );
  `);
  // SQLite ALTER TABLE does not support IF NOT EXISTS; guard with a pragma check.
  const cols = db.prepare('PRAGMA table_info(campaign_session)').all() as {
    name: string;
  }[];
  if (!cols.some((c) => c.name === 'arc_id')) {
    db.exec('ALTER TABLE campaign_session ADD COLUMN arc_id TEXT');
  }
};

// v8 → v9: party-oriented character model. Character table changes from
// singleton (INTEGER PK, CHECK id=1) to multi-row (TEXT PK, role column).
// Inventory gains a character_id FK. Active character tracked in meta.
const v8_to_v9: Migration = (db) => {
  const hasCharacterTable =
    db
      .prepare(
        "SELECT 1 AS present FROM sqlite_master WHERE type = 'table' AND name = 'character'",
      )
      .get() !== undefined;

  const defaultCharacterId = 'pc-1';

  if (hasCharacterTable) {
    db.exec(`
      CREATE TABLE character_new (
        id TEXT PRIMARY KEY,
        name TEXT,
        ancestry TEXT,
        class_name TEXT,
        level INTEGER NOT NULL DEFAULT 1 CHECK (level >= 1),
        hp_current INTEGER NOT NULL DEFAULT 0 CHECK (hp_current >= 0),
        hp_max INTEGER NOT NULL DEFAULT 0 CHECK (hp_max >= 0),
        ability_scores_json TEXT NOT NULL DEFAULT '{}',
        conditions_json TEXT NOT NULL DEFAULT '[]',
        role TEXT NOT NULL DEFAULT 'pc',
        provenance TEXT NOT NULL,
        session_id TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
    `);
    db.exec(`
      INSERT INTO character_new(id, name, ancestry, class_name, level,
        hp_current, hp_max, ability_scores_json, conditions_json,
        role, provenance, session_id, updated_at)
      SELECT '${defaultCharacterId}', name, ancestry, class_name, level,
        hp_current, hp_max, ability_scores_json, conditions_json,
        'pc', provenance, session_id, updated_at
      FROM character WHERE id = 1;
    `);
    db.exec('DROP TABLE character;');
    db.exec('ALTER TABLE character_new RENAME TO character;');
  }

  const hasInventoryTable =
    db
      .prepare(
        "SELECT 1 AS present FROM sqlite_master WHERE type = 'table' AND name = 'inventory'",
      )
      .get() !== undefined;

  if (hasInventoryTable) {
    const cols = db.prepare('PRAGMA table_info(inventory)').all() as {
      name: string;
    }[];
    if (!cols.some((c) => c.name === 'character_id')) {
      db.exec(
        'ALTER TABLE inventory ADD COLUMN character_id TEXT REFERENCES character(id)',
      );
      if (hasCharacterTable) {
        db.exec(`UPDATE inventory SET character_id = '${defaultCharacterId}'`);
      }
    }
  }

  db.prepare('INSERT OR REPLACE INTO meta(key, value) VALUES (?, ?)').run(
    'active_character_id',
    defaultCharacterId,
  );
};

// v9 → v10: record the acting player character on each turn trace so scene
// rollup can attribute state changes to the PC that caused them.
const v9_to_v10: Migration = (db) => {
  const hasTurnTrace =
    db
      .prepare(
        "SELECT 1 AS present FROM sqlite_master WHERE type = 'table' AND name = 'turn_trace'",
      )
      .get() !== undefined;
  if (!hasTurnTrace) {
    return;
  }
  const cols = db.prepare('PRAGMA table_info(turn_trace)').all() as {
    name: string;
  }[];
  if (!cols.some((c) => c.name === 'acting_character_id')) {
    db.exec('ALTER TABLE turn_trace ADD COLUMN acting_character_id TEXT');
  }
};

// v10 → v11: non-canon turn failure diagnostics written after rollback so
// failed model/protocol turns remain debuggable after the process exits.
const v10_to_v11: Migration = (db) => {
  db.exec(`
    CREATE TABLE IF NOT EXISTS turn_failure_diagnostic (
      campaign_id TEXT NOT NULL,
      session_id TEXT NOT NULL,
      turn_id TEXT NOT NULL,
      created_at TEXT NOT NULL,
      phase TEXT NOT NULL,
      error_name TEXT NOT NULL,
      error_message TEXT NOT NULL,
      model_rounds INTEGER NOT NULL CHECK (model_rounds >= 0),
      PRIMARY KEY (campaign_id, session_id, turn_id)
    );
  `);
};

// v11 → v12: campaign-owned adventure run / module binding (eshyra-eh54.4).
// Mutable campaign-instance state recording a campaign's progress through an
// immutable adventure module; the module source is never written back here.
const v11_to_v12: Migration = (db) => {
  db.exec(`
    CREATE TABLE IF NOT EXISTS adventure_run (
      campaign_id TEXT NOT NULL,
      run_id TEXT NOT NULL,
      module_id TEXT NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('active', 'completed', 'abandoned')),
      started_at_session_id TEXT,
      completed_at_session_id TEXT,
      progress_json TEXT NOT NULL DEFAULT '{}',
      notes TEXT NOT NULL DEFAULT '',
      provenance TEXT NOT NULL,
      session_id TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (campaign_id, run_id)
    );
  `);
};

// v12 → v13: typed campaign overlay lore for consequential improvised canon.
// These append-friendly records are distinct from module-template field
// overlays: they track improvised hooks, clues, reports, and beliefs with
// truth-status and visibility metadata.
const v12_to_v13: Migration = (db) => {
  db.exec(`
    CREATE TABLE IF NOT EXISTS campaign_overlay_lore (
      id TEXT PRIMARY KEY,
      kind TEXT NOT NULL CHECK (kind IN (
        'rumor',
        'clue',
        'npc_detail',
        'location_detail',
        'quest_hook',
        'threat_report',
        'scene_consequence',
        'player_created_detail',
        'other'
      )),
      subject_id TEXT,
      subject_text TEXT NOT NULL,
      location_id TEXT,
      npc_id TEXT,
      faction_id TEXT,
      fact TEXT NOT NULL,
      truth_status TEXT NOT NULL CHECK (truth_status IN (
        'confirmed',
        'true',
        'false',
        'disproven',
        'unknown',
        'rumored',
        'reported',
        'observed',
        'believed',
        'lie',
        'exaggeration'
      )),
      source TEXT NOT NULL CHECK (source IN (
        'dm_improvised',
        'player_declared',
        'module_derived',
        'tool_result',
        'consequence'
      )),
      scope TEXT NOT NULL CHECK (scope IN ('scene', 'session', 'campaign')),
      visibility TEXT NOT NULL CHECK (visibility IN (
        'player_visible',
        'dm_only',
        'mixed'
      )),
      introduced_at_turn_id TEXT NOT NULL,
      introduced_at_session_id TEXT NOT NULL,
      supersedes TEXT,
      invalidates TEXT,
      tags_json TEXT NOT NULL DEFAULT '[]',
      provenance TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS campaign_overlay_lore_location
      ON campaign_overlay_lore(location_id);
    CREATE INDEX IF NOT EXISTS campaign_overlay_lore_npc
      ON campaign_overlay_lore(npc_id);
    CREATE INDEX IF NOT EXISTS campaign_overlay_lore_kind
      ON campaign_overlay_lore(kind);
  `);
};

export const MIGRATIONS: Readonly<Record<number, Migration>> = {
  8: v7_to_v8,
  9: v8_to_v9,
  10: v9_to_v10,
  11: v10_to_v11,
  12: v11_to_v12,
  13: v12_to_v13,
};

/**
 * Run registered migrations in ascending version order from `fromVersion + 1`
 * to `toVersion` (inclusive). Each step is wrapped in its own transaction and
 * updates `meta.schema_version` atomically, so a partial run leaves the DB at
 * the last successfully migrated version.
 *
 * Throws `SchemaMigrationError` if any step is missing or fails.
 */
export function migrateSchema(
  db: Db,
  fromVersion: number,
  toVersion: number,
  migrations: Readonly<Record<number, Migration>> = MIGRATIONS,
): void {
  // Pre-flight: verify every required step exists before touching the DB.
  for (let v = fromVersion + 1; v <= toVersion; v++) {
    if (migrations[v] === undefined) {
      throw new SchemaMigrationError(`no migration defined for version ${v}`);
    }
  }
  for (let v = fromVersion + 1; v <= toVersion; v++) {
    const migration = migrations[v];
    if (migration === undefined) {
      throw new SchemaMigrationError(`no migration defined for version ${v}`);
    }
    try {
      withTransaction(db, (txnDb) => {
        migration(txnDb);
        txnDb
          .prepare('UPDATE meta SET value = ? WHERE key = ?')
          .run(String(v), 'schema_version');
      });
    } catch (err) {
      if (err instanceof SchemaMigrationError) throw err;
      throw new SchemaMigrationError(
        `migration to version ${v} failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
}
