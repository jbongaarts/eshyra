-- Migration 0001: initial baseline schema.
--
-- This is the squashed baseline for migration-first SQLite schema management
-- (ADR 0015). It encodes the complete intended campaign schema as of the
-- pre-migration-first state (former SCHEMA_VERSION = 15) in one authoritative
-- file. It is NOT a replay of the historical v7..v15 TypeScript migration
-- chain; legacy databases are handled by the adoption/reset path
-- (eshyra-4s0r.1.5), not by replaying steps here.
--
-- Conventions (ADR 0015):
--   * Plain CREATE TABLE / CREATE INDEX, never IF NOT EXISTS. A migration runs
--     exactly once against a database (the schema_migrations ledger guarantees
--     this), so IF NOT EXISTS guards would only serve to mask incompleteness.
--   * The schema_migrations ledger itself is runner-owned infrastructure and is
--     never declared in a migration file.
--   * meta.schema_version is retired as schema authority and is deliberately
--     NOT seeded here; applied-state lives in the schema_migrations ledger.
--   * Default/bootstrap rows (the pc-1 character, the clock singleton, and the
--     active_character_id pointer) are one-time seed data applied with this
--     baseline, not always-on startup repair.

CREATE TABLE meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE character (
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

CREATE TABLE inventory (
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

CREATE TABLE plot_flags (
  key TEXT PRIMARY KEY,
  value_json TEXT NOT NULL,
  provenance TEXT NOT NULL,
  session_id TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE clock (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  in_game_time TEXT NOT NULL DEFAULT '',
  current_location_id TEXT,
  provenance TEXT NOT NULL,
  session_id TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE overlay_facts (
  key TEXT PRIMARY KEY,
  value_json TEXT NOT NULL,
  provenance TEXT NOT NULL,
  session_id TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE campaign_overlay_lore (
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
  significance TEXT NOT NULL DEFAULT 'consequence' CHECK (significance IN (
    'atmosphere',
    'continuity',
    'clue',
    'hook',
    'consequence'
  )),
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

CREATE INDEX campaign_overlay_lore_location
  ON campaign_overlay_lore(location_id);
CREATE INDEX campaign_overlay_lore_npc
  ON campaign_overlay_lore(npc_id);
CREATE INDEX campaign_overlay_lore_kind
  ON campaign_overlay_lore(kind);

CREATE TABLE combat_instance (
  campaign_id TEXT NOT NULL,
  combat_instance_id TEXT NOT NULL,
  source_encounter_id TEXT,
  source_run_id TEXT,
  status TEXT NOT NULL CHECK (status IN (
    'active',
    'completed',
    'abandoned',
    'fled',
    'interrupted'
  )),
  location_id TEXT,
  provenance TEXT NOT NULL,
  session_id TEXT NOT NULL,
  opened_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  closed_at TEXT,
  PRIMARY KEY (campaign_id, combat_instance_id)
);
CREATE UNIQUE INDEX combat_instance_one_active_per_campaign
  ON combat_instance(campaign_id) WHERE status = 'active';
CREATE INDEX combat_instance_source
  ON combat_instance(campaign_id, source_encounter_id);

CREATE TABLE campaign_actor (
  campaign_id TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  display_name TEXT NOT NULL,
  actor_kind TEXT NOT NULL CHECK (actor_kind IN (
    'npc',
    'creature',
    'monster',
    'companion',
    'other'
  )),
  source_kind TEXT NOT NULL CHECK (source_kind IN (
    'module_npc',
    'module_creature',
    'encounter_instance',
    'campaign_created'
  )),
  source_ref TEXT,
  rules_ref TEXT,
  hp_current INTEGER CHECK (hp_current IS NULL OR hp_current >= 0),
  hp_max INTEGER CHECK (hp_max IS NULL OR hp_max >= 0),
  conditions_json TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL CHECK (status IN (
    'alive',
    'dead',
    'unconscious',
    'escaped',
    'inactive',
    'unknown'
  )),
  current_location_id TEXT,
  state_json TEXT NOT NULL DEFAULT '{}',
  provenance TEXT NOT NULL,
  session_id TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (campaign_id, actor_id)
);
CREATE INDEX campaign_actor_location
  ON campaign_actor(campaign_id, current_location_id);
CREATE INDEX campaign_actor_source
  ON campaign_actor(campaign_id, source_kind, source_ref);

CREATE TABLE encounter_combatant (
  campaign_id TEXT NOT NULL,
  combat_instance_id TEXT NOT NULL,
  source_encounter_id TEXT,
  combatant_id TEXT NOT NULL,
  identity_kind TEXT NOT NULL CHECK (identity_kind IN (
    'encounter_instance',
    'module_npc',
    'module_creature',
    'campaign_actor'
  )),
  identity_ref TEXT,
  display_label TEXT NOT NULL,
  rules_ref TEXT NOT NULL,
  side TEXT NOT NULL,
  faction TEXT,
  hp_current INTEGER NOT NULL CHECK (hp_current >= 0),
  hp_max INTEGER NOT NULL CHECK (hp_max >= 0),
  ac INTEGER CHECK (ac IS NULL OR ac >= 0),
  conditions_json TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL CHECK (status IN (
    'alive',
    'dead',
    'unconscious',
    'escaped',
    'inactive'
  )),
  location_id TEXT,
  placement TEXT,
  provenance TEXT NOT NULL,
  session_id TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (campaign_id, combatant_id)
);
CREATE INDEX encounter_combatant_instance
  ON encounter_combatant(campaign_id, combat_instance_id);
CREATE INDEX encounter_combatant_identity
  ON encounter_combatant(campaign_id, identity_kind, identity_ref);
CREATE INDEX encounter_combatant_status
  ON encounter_combatant(campaign_id, status);

-- E2: immutable campaign template forked from an authored module pack.
-- These rows are never mutated during play; live divergence is recorded
-- as overlay_facts and resolved by worldQuery.
CREATE TABLE module_meta (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  pack_id TEXT NOT NULL,
  title TEXT NOT NULL,
  pack_type TEXT NOT NULL,
  description TEXT NOT NULL,
  starting_location_id TEXT NOT NULL,
  license_json TEXT NOT NULL,
  data_json TEXT NOT NULL
);

CREATE TABLE module_location (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  summary TEXT NOT NULL,
  data_json TEXT NOT NULL
);

CREATE TABLE module_encounter (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  location_id TEXT NOT NULL,
  data_json TEXT NOT NULL
);

CREATE TABLE module_npc (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  location_id TEXT NOT NULL,
  data_json TEXT NOT NULL
);

CREATE TABLE module_trigger (
  id TEXT PRIMARY KEY,
  data_json TEXT NOT NULL
);

CREATE TABLE module_lore (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  scope TEXT NOT NULL,
  data_json TEXT NOT NULL
);

CREATE TABLE turn_trace (
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

CREATE TABLE turn_failure_diagnostic (
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

CREATE TABLE scene_summary (
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

CREATE TABLE session_recap (
  campaign_id TEXT NOT NULL,
  session_id TEXT NOT NULL,
  recap TEXT NOT NULL,
  source_scene_ids_json TEXT NOT NULL,
  state_delta_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (campaign_id, session_id)
);

CREATE TABLE arc_summary (
  campaign_id TEXT NOT NULL,
  arc_id TEXT NOT NULL,
  summary TEXT NOT NULL,
  source_session_ids_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (campaign_id, arc_id)
);

CREATE TABLE campaign_bible (
  campaign_id TEXT PRIMARY KEY,
  world_facts_json TEXT NOT NULL,
  major_npcs_json TEXT NOT NULL,
  factions_json TEXT NOT NULL,
  open_threads_json TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- E5: scene boundaries. Exactly one scene is 'open' per session at a time;
-- the mark_scene tool closes one before opening the next.
CREATE TABLE scene (
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
CREATE TABLE scene_log (
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
CREATE TABLE campaign_session (
  campaign_id TEXT NOT NULL,
  session_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('open', 'closed')),
  started_at TEXT NOT NULL,
  closed_at TEXT,
  arc_id TEXT,
  PRIMARY KEY (campaign_id, session_id)
);

CREATE UNIQUE INDEX campaign_session_one_open
  ON campaign_session(campaign_id)
  WHERE status = 'open';

-- Multi-session arc lifecycle. Exactly one arc is 'open' per campaign at a
-- time; the partial unique index enforces that invariant at the DB level.
CREATE TABLE campaign_arc (
  campaign_id  TEXT NOT NULL,
  arc_id       TEXT NOT NULL,
  sequence_no  INTEGER NOT NULL,
  status       TEXT NOT NULL CHECK (status IN ('open', 'closed')),
  opened_at    TEXT NOT NULL,
  closed_at    TEXT,
  PRIMARY KEY (campaign_id, arc_id)
);

CREATE UNIQUE INDEX campaign_arc_one_open
  ON campaign_arc(campaign_id) WHERE status = 'open';

-- Authoritative campaign rules binding. Singleton row identifies the base
-- rules pack and an ordered JSON list of compatible add-on packs. Campaign
-- DBs without a row are treated as the default D&D SRD binding by the
-- read path so legacy campaigns keep working at the same schema version.
CREATE TABLE campaign_rules_binding (
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
CREATE TABLE adventure_run (
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

-- Bootstrap seed rows (one-time initial state, applied with this baseline).
INSERT INTO character (
  id, ability_scores_json, role, provenance, session_id, updated_at
) VALUES (
  'pc-1',
  '{"strength":0,"dexterity":0,"constitution":0,"intelligence":0,"wisdom":0,"charisma":0}',
  'pc',
  'system:init_schema',
  'bootstrap',
  '1970-01-01T00:00:00.000Z'
);

INSERT INTO clock (
  id, provenance, session_id, updated_at
) VALUES (
  1,
  'system:init_schema',
  'bootstrap',
  '1970-01-01T00:00:00.000Z'
);

INSERT INTO meta (key, value) VALUES ('active_character_id', 'pc-1');
