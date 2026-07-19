-- Migration 0018: make legacy magic-item recognition quarantine code-owned.
-- Review state and raw malformed evidence must not live in model-writable,
-- eagerly validated inventory/item_state JSON columns.

CREATE TABLE inventory_adoption_review (
  inventory_id TEXT PRIMARY KEY
    REFERENCES inventory(id) ON DELETE CASCADE,
  requested_pack_ref TEXT NOT NULL
    CHECK (requested_pack_ref GLOB 'magic-item:*'),
  requested_variant_id TEXT,
  review_kind TEXT NOT NULL CHECK (review_kind IN (
    'legacy-marker',
    'malformed-evidence',
    'oversized-stack',
    'legacy-attunement',
    'legacy-counter'
  )),
  reason TEXT NOT NULL CHECK (length(trim(reason)) > 0),
  raw_properties_json TEXT,
  raw_item_state_json TEXT,
  provenance TEXT NOT NULL,
  session_id TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE inventory_adoption_resolution (
  -- Append-only evidence intentionally survives later item destruction.
  inventory_id TEXT NOT NULL,
  seq INTEGER NOT NULL CHECK (seq >= 1),
  action TEXT NOT NULL CHECK (action IN (
    'discard-evidence',
    'set-reviewed-quantity',
    'discard-legacy-attunement',
    'discard-legacy-counter'
  )),
  evidence TEXT NOT NULL CHECK (length(trim(evidence)) > 0),
  previous_reason TEXT NOT NULL,
  previous_review_kind TEXT NOT NULL CHECK (previous_review_kind IN (
    'legacy-marker',
    'malformed-evidence',
    'oversized-stack',
    'legacy-attunement',
    'legacy-counter'
  )),
  previous_requested_pack_ref TEXT NOT NULL,
  previous_requested_variant_id TEXT,
  resulting_pack_ref TEXT NOT NULL CHECK (resulting_pack_ref GLOB 'magic-item:*'),
  resulting_variant_id TEXT,
  reviewed_quantity INTEGER CHECK (reviewed_quantity IS NULL OR reviewed_quantity >= 1),
  discarded_structure_json TEXT NOT NULL,
  provenance TEXT NOT NULL,
  session_id TEXT NOT NULL,
  resolved_at TEXT NOT NULL,
  CHECK ((action = 'set-reviewed-quantity') = (reviewed_quantity IS NOT NULL)),
  CHECK (
    (previous_review_kind IN ('legacy-marker', 'malformed-evidence')
      AND action = 'discard-evidence') OR
    (previous_review_kind = 'oversized-stack'
      AND action = 'set-reviewed-quantity') OR
    (previous_review_kind = 'legacy-attunement'
      AND action = 'discard-legacy-attunement') OR
    (previous_review_kind = 'legacy-counter'
      AND action = 'discard-legacy-counter')
  ),
  PRIMARY KEY (inventory_id, seq)
);

CREATE TABLE inventory_custody_event (
  -- Custody history remains auditable after the physical row is destroyed.
  inventory_id TEXT NOT NULL,
  seq INTEGER NOT NULL CHECK (seq >= 1),
  from_disposition TEXT NOT NULL CHECK (from_disposition IN ('sold', 'lost')),
  basis TEXT NOT NULL CHECK (basis IN ('found', 'repurchased', 'returned')),
  evidence TEXT NOT NULL CHECK (length(trim(evidence)) > 0),
  payment_event_id TEXT REFERENCES character_wallet_event(id),
  to_character_id TEXT NOT NULL REFERENCES character(id),
  world_location_id TEXT NOT NULL,
  provenance TEXT NOT NULL,
  session_id TEXT NOT NULL,
  occurred_at TEXT NOT NULL,
  CHECK ((basis = 'repurchased') = (payment_event_id IS NOT NULL)),
  PRIMARY KEY (inventory_id, seq)
);

-- Move advisory markers written by the previous implementation into the
-- protected table. Only exact well-formed markers are migrated; malformed
-- properties never carried a successfully written marker.
INSERT INTO inventory_adoption_review(
  inventory_id, requested_pack_ref, requested_variant_id, review_kind, reason,
  raw_properties_json, raw_item_state_json, provenance, session_id, updated_at
)
SELECT
  id,
  json_extract(properties_json, '$.magicItemAdoption.requestedPackRef'),
  json_extract(properties_json, '$.magicItemAdoption.requestedVariantId'),
  CASE
    WHEN json_extract(properties_json, '$.magicItemAdoption.reason')
      LIKE 'stateful legacy stack quantity % exceeds the reviewed adoption maximum of % singleton instances'
      THEN 'oversized-stack'
    WHEN json_extract(properties_json, '$.magicItemAdoption.reason')
      LIKE 'legacy item usage counter % requires GM reconciliation before canonical binding'
      AND EXISTS (
      SELECT 1 FROM entity_usage_counter
      WHERE owner_kind='item' AND owner_ref=inventory.id
    ) THEN 'legacy-counter'
    WHEN EXISTS (
      SELECT 1 FROM attunement WHERE item_id=inventory.id
    ) AND json_extract(properties_json, '$.magicItemAdoption.reason')
      LIKE 'legacy attunement cannot cross the canonical attunement boundary:%'
      THEN 'legacy-attunement'
    ELSE 'malformed-evidence'
  END,
  json_extract(properties_json, '$.magicItemAdoption.reason'),
  properties_json,
  (SELECT state_json FROM item_state WHERE inventory_id = inventory.id),
  provenance,
  session_id,
  updated_at
FROM inventory
WHERE json_valid(properties_json)
  AND pack_ref IS NULL
  AND character_id IS NOT NULL
  AND json_type(properties_json, '$.magicItemAdoption') = 'object'
  AND json_extract(properties_json, '$.magicItemAdoption.status') =
      'gm-review-required'
  AND json_type(
      properties_json, '$.magicItemAdoption.requestedPackRef') = 'text'
  AND json_extract(properties_json, '$.magicItemAdoption.requestedPackRef')
      GLOB 'magic-item:*'
  AND (
    json_type(properties_json, '$.magicItemAdoption.requestedVariantId') IS NULL OR
    (
      json_type(properties_json, '$.magicItemAdoption.requestedVariantId') = 'text' AND
      length(trim(json_extract(
        properties_json, '$.magicItemAdoption.requestedVariantId'))) > 0
    )
  )
  AND json_type(properties_json, '$.magicItemAdoption.reason') = 'text'
  AND length(trim(json_extract(
      properties_json, '$.magicItemAdoption.reason'))) > 0
  AND (
    json_extract(properties_json, '$.magicItemAdoption.reason')
      LIKE 'stateful legacy stack quantity % exceeds the reviewed adoption maximum of % singleton instances' OR
    json_extract(properties_json, '$.magicItemAdoption.reason')
      LIKE 'legacy item usage counter % requires GM reconciliation before canonical binding' OR
    json_extract(properties_json, '$.magicItemAdoption.reason') =
      'multiple legacy mechanics sources require GM reconciliation' OR
    json_extract(properties_json, '$.magicItemAdoption.reason')
      LIKE 'persisted legacy item state is not valid JSON:%' OR
    json_extract(properties_json, '$.magicItemAdoption.reason') =
      'the selected canonical item is stateless and cannot license legacy mechanics' OR
    json_extract(properties_json, '$.magicItemAdoption.reason')
      LIKE 'legacy attunement cannot cross the canonical attunement boundary:%' OR
    json_extract(properties_json, '$.magicItemAdoption.reason')
      LIKE 'legacy mechanics are not licensed by the selected canonical item:%'
  );

UPDATE inventory
SET properties_json = json_remove(
  properties_json,
  '$.magicItemAdoption',
  '$.mechanics'
)
WHERE id IN (SELECT inventory_id FROM inventory_adoption_review);

DELETE FROM item_state
WHERE inventory_id IN (SELECT inventory_id FROM inventory_adoption_review);
