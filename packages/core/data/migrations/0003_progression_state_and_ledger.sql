-- Migration 0003: durable character progression state + auditable event ledger
-- (eshyra-lupf.2; design: docs/design/character-progression.md).
--
-- Adds durable progression *state* only — no mechanics. Advancement policy
-- resolution (eshyra-lupf.4), award recording (eshyra-lupf.6), eligibility
-- (eshyra-lupf.7), and the deterministic level-up engine (eshyra-lupf.8) build
-- on this storage; this migration just makes the state durable and validated.
--
-- 1. Per-character progression state. `character.current_xp` is the running XP
--    total (meaningful in XP mode). Current *level* is the existing
--    `character.level` column, which remains the authority the resolver and
--    derived-value path read; this migration does not duplicate it.
--
-- 2. `campaign_progression_policy` — a singleton (id = 1) recording the
--    campaign-wide advancement mode (xp vs milestone). The design note fixes the
--    mode as a property of the campaign/rules binding, NOT independent
--    per-character authority: a whole party advances under one policy. It is
--    therefore stored at campaign scope here rather than as a `character`
--    column. eshyra-lupf.4 defines how the mode binds to / resolves from the
--    rules binding and how XP thresholds are read; this migration only provides
--    the durable, validated storage and leaves the row unset until written.
--
-- 3. `progression_event` — an append-only, auditable ledger of every XP award,
--    milestone award, and applied level-up. Corrections are new compensating
--    rows, never edits or deletes (the write helper treats it as insert-only).
--    `resulting_xp` is null in milestone mode; `milestone_label` is set only for
--    milestone awards; `applied_changes_json` carries the deterministic
--    level-up change set for replay/audit, with its internal shape owned by the
--    level-up engine (eshyra-lupf.8) and stored opaquely here.
--
-- Conventions (ADR 0015): plain CREATE TABLE / ALTER TABLE, never IF NOT EXISTS.

ALTER TABLE character
  ADD COLUMN current_xp INTEGER NOT NULL DEFAULT 0 CHECK (current_xp >= 0);

CREATE TABLE campaign_progression_policy (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  advancement_mode TEXT NOT NULL CHECK (advancement_mode IN ('xp', 'milestone')),
  provenance TEXT NOT NULL,
  session_id TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE progression_event (
  id TEXT PRIMARY KEY,
  character_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('xp-award', 'milestone-award', 'level-up')),
  amount INTEGER,
  milestone_label TEXT,
  source TEXT NOT NULL,
  resulting_xp INTEGER CHECK (resulting_xp IS NULL OR resulting_xp >= 0),
  resulting_level INTEGER NOT NULL CHECK (resulting_level >= 1),
  applied_changes_json TEXT,
  occurred_at TEXT NOT NULL,
  provenance TEXT NOT NULL,
  session_id TEXT NOT NULL
);

CREATE INDEX idx_progression_event_character
  ON progression_event (character_id, occurred_at, id);
