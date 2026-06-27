-- Migration 0002: core-owned canonical character sheet (ADR 0011).
--
-- The character_sheet table is the durable, rules-pack-bound authority for a
-- character's build-defining facts (class refs, proficiencies, features,
-- spells, ability scores, level, max HP, and later progression state). It
-- replaces the former CLI-side JSON persistence of finalized characters.
--
-- The sheet is stored as a versioned JSON document (sheet_json) rather than a
-- wide normalized schema; the binding columns (schema_version, system,
-- rules_pack_id) are mirrored out of the document so reads can validate and
-- route without parsing the blob, and so a future query layer can be added
-- behind the same store API. The live `character` row projects a few of these
-- fields (identity/class/level/hp_max) for the per-turn path; per-turn HP and
-- conditions remain owned by the live row.
--
-- Conventions (ADR 0015): plain CREATE TABLE, never IF NOT EXISTS.

CREATE TABLE character_sheet (
  character_id TEXT PRIMARY KEY,
  schema_version INTEGER NOT NULL,
  system TEXT NOT NULL,
  rules_pack_id TEXT NOT NULL,
  sheet_json TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
