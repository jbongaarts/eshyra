-- Migration 0018: make legacy magic-item recognition quarantine code-owned.
-- Review state and raw malformed evidence must not live in model-writable,
-- eagerly validated inventory/item_state JSON columns.

CREATE TABLE inventory_adoption_review (
  inventory_id TEXT PRIMARY KEY
    REFERENCES inventory(id) ON DELETE CASCADE,
  requested_pack_ref TEXT NOT NULL
    CHECK (requested_pack_ref GLOB 'magic-item:*'),
  requested_variant_id TEXT,
  reason TEXT NOT NULL CHECK (length(trim(reason)) > 0),
  raw_properties_json TEXT,
  raw_item_state_json TEXT,
  provenance TEXT NOT NULL,
  session_id TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE inventory_custody_event (
  inventory_id TEXT NOT NULL
    REFERENCES inventory(id) ON DELETE CASCADE,
  seq INTEGER NOT NULL CHECK (seq >= 1),
  from_disposition TEXT NOT NULL CHECK (from_disposition IN ('sold', 'lost')),
  basis TEXT NOT NULL CHECK (basis IN ('found', 'repurchased', 'returned')),
  evidence TEXT NOT NULL CHECK (length(trim(evidence)) > 0),
  to_character_id TEXT NOT NULL REFERENCES character(id),
  world_location_id TEXT NOT NULL,
  provenance TEXT NOT NULL,
  session_id TEXT NOT NULL,
  occurred_at TEXT NOT NULL,
  PRIMARY KEY (inventory_id, seq)
);

-- Move advisory markers written by the previous implementation into the
-- protected table. Only exact well-formed markers are migrated; malformed
-- properties never carried a successfully written marker.
INSERT INTO inventory_adoption_review(
  inventory_id, requested_pack_ref, requested_variant_id, reason,
  raw_properties_json, raw_item_state_json, provenance, session_id, updated_at
)
SELECT
  id,
  json_extract(properties_json, '$.magicItemAdoption.requestedPackRef'),
  json_extract(properties_json, '$.magicItemAdoption.requestedVariantId'),
  json_extract(properties_json, '$.magicItemAdoption.reason'),
  properties_json,
  (SELECT state_json FROM item_state WHERE inventory_id = inventory.id),
  provenance,
  session_id,
  updated_at
FROM inventory
WHERE json_valid(properties_json)
  AND json_extract(properties_json, '$.magicItemAdoption.status') =
      'gm-review-required'
  AND json_extract(properties_json, '$.magicItemAdoption.requestedPackRef')
      GLOB 'magic-item:*'
  AND length(trim(json_extract(
      properties_json, '$.magicItemAdoption.reason'))) > 0;

UPDATE inventory
SET properties_json = json_remove(
  properties_json,
  '$.magicItemAdoption',
  '$.mechanics'
)
WHERE id IN (SELECT inventory_id FROM inventory_adoption_review);

DELETE FROM item_state
WHERE inventory_id IN (SELECT inventory_id FROM inventory_adoption_review);
