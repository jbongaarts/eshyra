import type { Db } from './db.js';
import { withTransaction } from './db.js';
import { migrateSchema } from './migrations.js';

/**
 * JSON columns: live state vs archival/generated
 *
 * Live queryable state — validated at both the mutateState write boundary and
 * the contextAssembler read boundary via `state/liveStateSchema.ts`:
 *   - `character.ability_scores_json`   (shape: AbilityScores — exactly 6 keys, int 0–30)
 *   - `character.conditions_json`       (shape: CharacterConditionEntry[] — array of {id}+)
 *   - `inventory.properties_json`       (shape: InventoryItemProperties — plain JSON object)
 *
 * Opaque extension points — validated as plain JSON root-type only:
 *   - `plot_flags.value_json`           (any JSON value)
 *   - `overlay_facts.value_json`        (any JSON value)
 *
 * Typed live campaign canon:
 *   - `campaign_overlay_lore`           (consequential improvised lore promoted
 *                                        during play; append-friendly rows with
 *                                        truth status and visibility)
 *
 * Archival / trace / generated — deliberately opaque, jsonColumn<TraceJsonValue[]>.
 * Do not add shape validation here; these blobs are owned by the memory subsystem:
 *   - `turn_trace.*_json`
 *   - `scene_summary.*_json`
 *   - `session_recap.*_json`
 *   - `arc_summary.*_json`
 *   - `campaign_bible.*_json`
 *
 * Module template columns (`module_*.data_json`) are read-only post-fork and
 * validated by the pack importer at load time — not by mutateState or the
 * context assembler.
 *
 * Campaign-owned adventure run progress — mutable campaign-instance state typed
 * at the adventure-run module's own read/write boundary
 * (`campaign/adventureRun.ts`), not by mutateState. The referenced adventure
 * module source is never written back here:
 *   - `adventure_run.progress_json`     (shape: AdventureRunProgress)
 *
 * Operational diagnostics are non-canon debugging records, not game history:
 *   - `turn_failure_diagnostic`
 */
export const SCHEMA_VERSION = 13;

export class SchemaCompatibilityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SchemaCompatibilityError';
  }
}

export function initSchema(db: Db): void {
  assertSchemaCompatible(db);
  withTransaction(db, (txnDb) => {
    txnDb.exec(
      `
    CREATE TABLE IF NOT EXISTS meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS character (
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

    CREATE TABLE IF NOT EXISTS inventory (
      id TEXT PRIMARY KEY,
      character_id TEXT REFERENCES character(id),
      name TEXT NOT NULL,
      quantity INTEGER NOT NULL DEFAULT 1 CHECK (quantity >= 0),
      location TEXT,
      properties_json TEXT NOT NULL DEFAULT '{}',
      provenance TEXT NOT NULL,
      session_id TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS plot_flags (
      key TEXT PRIMARY KEY,
      value_json TEXT NOT NULL,
      provenance TEXT NOT NULL,
      session_id TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS clock (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      in_game_time TEXT NOT NULL DEFAULT '',
      current_location_id TEXT,
      provenance TEXT NOT NULL,
      session_id TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS overlay_facts (
      key TEXT PRIMARY KEY,
      value_json TEXT NOT NULL,
      provenance TEXT NOT NULL,
      session_id TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

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

    -- E2: immutable campaign template forked from an authored module pack.
    -- These rows are never mutated during play; live divergence is recorded
    -- as overlay_facts and resolved by worldQuery.
    CREATE TABLE IF NOT EXISTS module_meta (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      pack_id TEXT NOT NULL,
      title TEXT NOT NULL,
      pack_type TEXT NOT NULL,
      description TEXT NOT NULL,
      starting_location_id TEXT NOT NULL,
      license_json TEXT NOT NULL,
      data_json TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS module_location (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      summary TEXT NOT NULL,
      data_json TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS module_encounter (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      location_id TEXT NOT NULL,
      data_json TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS module_npc (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      location_id TEXT NOT NULL,
      data_json TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS module_trigger (
      id TEXT PRIMARY KEY,
      data_json TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS module_lore (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      scope TEXT NOT NULL,
      data_json TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS turn_trace (
      campaign_id TEXT NOT NULL,
      session_id TEXT NOT NULL,
      turn_id TEXT NOT NULL,
      consent_scope TEXT NOT NULL,
      player_input TEXT NOT NULL,
      acting_character_id TEXT,
      retrieved_context_json TEXT NOT NULL,
      prompt_profile TEXT NOT NULL,
      model_output TEXT NOT NULL,
      tool_calls_json TEXT NOT NULL,
      rules_resolution_json TEXT NOT NULL,
      accepted_state_delta_json TEXT NOT NULL,
      rejected_candidates_json TEXT NOT NULL,
      final_narration TEXT NOT NULL,
      memory_updates_json TEXT NOT NULL,
      human_corrections_json TEXT NOT NULL,
      quality_flags_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      PRIMARY KEY (campaign_id, session_id, turn_id)
    );

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

    CREATE TABLE IF NOT EXISTS scene_summary (
      campaign_id TEXT NOT NULL,
      session_id TEXT NOT NULL,
      scene_id TEXT NOT NULL,
      summary TEXT NOT NULL,
      salient_refs_json TEXT NOT NULL,
      source_turn_ids_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (campaign_id, session_id, scene_id)
    );

    CREATE TABLE IF NOT EXISTS session_recap (
      campaign_id TEXT NOT NULL,
      session_id TEXT NOT NULL,
      recap TEXT NOT NULL,
      source_scene_ids_json TEXT NOT NULL,
      state_delta_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (campaign_id, session_id)
    );

    CREATE TABLE IF NOT EXISTS arc_summary (
      campaign_id TEXT NOT NULL,
      arc_id TEXT NOT NULL,
      summary TEXT NOT NULL,
      source_session_ids_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (campaign_id, arc_id)
    );

    CREATE TABLE IF NOT EXISTS campaign_bible (
      campaign_id TEXT PRIMARY KEY,
      world_facts_json TEXT NOT NULL,
      major_npcs_json TEXT NOT NULL,
      factions_json TEXT NOT NULL,
      open_threads_json TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    -- E5: scene boundaries. Exactly one scene is 'open' per session at a time;
    -- the mark_scene tool closes one before opening the next.
    CREATE TABLE IF NOT EXISTS scene (
      campaign_id TEXT NOT NULL,
      session_id TEXT NOT NULL,
      scene_id TEXT NOT NULL,
      title TEXT NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('open', 'closed')),
      opened_at TEXT NOT NULL,
      closed_at TEXT,
      PRIMARY KEY (campaign_id, session_id, scene_id)
    );

    -- E5: live per-scene transcript. The Context Assembler feeds a bounded
    -- current-scene tail; closed scenes roll up into scene_summary.
    CREATE TABLE IF NOT EXISTS scene_log (
      campaign_id TEXT NOT NULL,
      session_id TEXT NOT NULL,
      scene_id TEXT NOT NULL,
      seq INTEGER NOT NULL,
      turn_id TEXT NOT NULL,
      role TEXT NOT NULL CHECK (role IN ('player', 'dm')),
      content TEXT NOT NULL,
      created_at TEXT NOT NULL,
      PRIMARY KEY (campaign_id, session_id, scene_id, seq)
    );

    -- E6: session lifecycle. Graceful close is idempotent; a crash leaves the
    -- session open so launch code can offer resume or close-and-recap.
    CREATE TABLE IF NOT EXISTS campaign_session (
      campaign_id TEXT NOT NULL,
      session_id TEXT NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('open', 'closed')),
      started_at TEXT NOT NULL,
      closed_at TEXT,
      arc_id TEXT,
      PRIMARY KEY (campaign_id, session_id)
    );

    CREATE UNIQUE INDEX IF NOT EXISTS campaign_session_one_open
      ON campaign_session(campaign_id)
      WHERE status = 'open';

    -- Multi-session arc lifecycle. Exactly one arc is 'open' per campaign at a
    -- time; the partial unique index enforces that invariant at the DB level.
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

    -- Authoritative campaign rules binding. Singleton row identifies the base
    -- rules pack and an ordered JSON list of compatible add-on packs. Campaign
    -- DBs without a row are treated as the default D&D SRD binding by the
    -- read path so legacy campaigns keep working at the same schema version.
    CREATE TABLE IF NOT EXISTS campaign_rules_binding (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      base_system_id TEXT NOT NULL,
      base_pack_id TEXT NOT NULL,
      base_version TEXT NOT NULL,
      addons_json TEXT NOT NULL DEFAULT '[]',
      resolved_at TEXT NOT NULL
    );

    -- Campaign-owned adventure run / module binding (eshyra-eh54.4). Mutable
    -- campaign-instance state: each row binds the campaign to one immutable
    -- adventure module by id and records that campaign's progress through it.
    -- A campaign may hold several runs. The authored module source is never
    -- written back here; progress lives only in progress_json.
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
    `,
    );
    const now = new Date(0).toISOString();
    const defaultAbilityScores =
      '{"strength":0,"dexterity":0,"constitution":0,"intelligence":0,"wisdom":0,"charisma":0}';
    const defaultCharacterId = 'pc-1';
    txnDb
      .prepare(
        `INSERT OR IGNORE INTO character(id, ability_scores_json, role, provenance, session_id, updated_at)
     VALUES (?, ?, 'pc', ?, ?, ?)`,
      )
      .run(
        defaultCharacterId,
        defaultAbilityScores,
        'system:init_schema',
        'bootstrap',
        now,
      );
    txnDb
      .prepare(
        `INSERT OR IGNORE INTO clock(id, provenance, session_id, updated_at)
     VALUES (1, ?, ?, ?)`,
      )
      .run('system:init_schema', 'bootstrap', now);
    txnDb
      .prepare('INSERT OR IGNORE INTO meta(key, value) VALUES (?, ?)')
      .run('active_character_id', defaultCharacterId);
    txnDb
      .prepare('INSERT OR REPLACE INTO meta(key, value) VALUES (?, ?)')
      .run('schema_version', String(SCHEMA_VERSION));
  });
}

function assertSchemaCompatible(db: Db): void {
  const tableCount = (
    db
      .prepare(
        "SELECT COUNT(*) AS count FROM sqlite_master WHERE type = 'table'",
      )
      .get() as { count: number }
  ).count;
  if (tableCount === 0) {
    return;
  }

  const hasMeta =
    db
      .prepare(
        "SELECT 1 AS present FROM sqlite_master WHERE type = 'table' AND name = 'meta'",
      )
      .get() !== undefined;
  if (!hasMeta) {
    throw new SchemaCompatibilityError(
      'database has existing tables but no schema_version; automatic migration is not available',
    );
  }

  const row = db
    .prepare('SELECT value FROM meta WHERE key = ?')
    .get('schema_version') as { value: string } | undefined;
  if (row === undefined) {
    throw new SchemaCompatibilityError(
      'database is missing schema_version; automatic migration is not available',
    );
  }

  const version = Number.parseInt(row.value, 10);
  if (!Number.isInteger(version) || String(version) !== row.value) {
    throw new SchemaCompatibilityError(
      `database schema_version is not a valid integer: ${row.value}`,
    );
  }
  if (version > SCHEMA_VERSION) {
    throw new SchemaCompatibilityError(
      `database schema_version ${version} is newer than supported version ${SCHEMA_VERSION}`,
    );
  }
  if (version < SCHEMA_VERSION) {
    migrateSchema(db, version, SCHEMA_VERSION);
  }
}
