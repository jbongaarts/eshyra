-- Migration 0014: pack-bound inventory identity and validated per-instance
-- magic-item state. An inventory row is the item instance; mutable state has
-- the same lifetime through the cascading one-to-one foreign key.

ALTER TABLE inventory ADD COLUMN pack_ref TEXT
  CHECK (pack_ref IS NULL OR pack_ref GLOB 'magic-item:*');

CREATE TABLE item_state (
  inventory_id TEXT PRIMARY KEY
    REFERENCES inventory(id) ON DELETE CASCADE,
  state_json TEXT NOT NULL,
  provenance TEXT NOT NULL,
  session_id TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
