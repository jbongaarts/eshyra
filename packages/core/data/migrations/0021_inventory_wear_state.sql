-- Migration 0021: authoritative inventory wear state.
--
-- Absence is deliberately not backfilled: legacy inventory.location is prose
-- and cannot prove whether an item is worn. New inventory instances receive
-- an explicit not-worn row at their domain creation boundary.
CREATE TABLE inventory_wear_state (
  inventory_id TEXT PRIMARY KEY
    REFERENCES inventory(id) ON DELETE CASCADE ON UPDATE CASCADE,
  character_id TEXT NOT NULL
    REFERENCES character(id) ON DELETE CASCADE ON UPDATE CASCADE,
  wear_state TEXT NOT NULL CHECK (wear_state IN ('worn', 'not_worn')),
  provenance TEXT NOT NULL,
  session_id TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX inventory_wear_state_character
  ON inventory_wear_state(character_id, wear_state, inventory_id);
