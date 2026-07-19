-- Migration 0016: separate held storage/equipment placement from the world
-- location of an unheld physical inventory row. Ownership changes must never
-- leave a backpack/equipment label masquerading as a campaign location (or
-- retain a stale world location after pickup).

ALTER TABLE inventory ADD COLUMN world_location_id TEXT;

-- Before this migration `location` carried both meanings. Existing held rows
-- retain it as storage/equipment placement; existing unheld rows are migrated
-- to world placement and have their held-only field cleared.
UPDATE inventory
SET world_location_id = CASE
      WHEN location IS NULL OR trim(location) = '' THEN NULL
      ELSE location
    END,
    location = NULL
WHERE character_id IS NULL;

CREATE INDEX inventory_unheld_world_location_id
ON inventory(world_location_id, id)
WHERE character_id IS NULL;

CREATE TRIGGER inventory_location_insert_guard
BEFORE INSERT ON inventory
WHEN
  (NEW.character_id IS NOT NULL AND NEW.world_location_id IS NOT NULL) OR
  (NEW.character_id IS NULL AND NEW.location IS NOT NULL) OR
  (NEW.world_location_id IS NOT NULL AND trim(NEW.world_location_id) = '')
BEGIN
  SELECT RAISE(ABORT, 'inventory custody/location invariant violated');
END;

CREATE TRIGGER inventory_location_update_guard
BEFORE UPDATE OF character_id, location, world_location_id ON inventory
WHEN
  (NEW.character_id IS NOT NULL AND NEW.world_location_id IS NOT NULL) OR
  (NEW.character_id IS NULL AND NEW.location IS NOT NULL) OR
  (NEW.world_location_id IS NOT NULL AND trim(NEW.world_location_id) = '')
BEGIN
  SELECT RAISE(ABORT, 'inventory custody/location invariant violated');
END;
