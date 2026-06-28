-- Migration 0004: structured character wallet audit ledger (eshyra-lupf.15).
--
-- The canonical wallet lives on the core-owned CharacterSheet JSON document so
-- coin travels with the character through registry custody/revisions. This
-- ledger records deterministic wallet mutations performed inside a campaign:
-- gains, exact-denomination spends, and explicit conversions. It is append-only
-- by convention; corrections should be compensating wallet events.
--
-- Conventions (ADR 0015): plain CREATE TABLE / CREATE INDEX, never IF NOT EXISTS.

CREATE TABLE character_wallet_event (
  id TEXT PRIMARY KEY,
  character_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('gain', 'spend', 'convert')),
  amounts_json TEXT NOT NULL,
  resulting_wallet_json TEXT NOT NULL,
  source TEXT NOT NULL,
  occurred_at TEXT NOT NULL,
  provenance TEXT NOT NULL,
  session_id TEXT NOT NULL
);

CREATE INDEX idx_character_wallet_event_character
  ON character_wallet_event (character_id, occurred_at, id);
