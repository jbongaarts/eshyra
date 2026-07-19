-- Migration 0017: distinguish a generally claimable drop from custody states
-- that merely have no player-character holder. Sold and lost rows retain their
-- physical identity and item state, but are not advertised or mutable as
-- ordinary nearby loot.

ALTER TABLE inventory ADD COLUMN unheld_disposition TEXT
  CHECK (
    unheld_disposition IS NULL OR
    unheld_disposition IN ('dropped', 'sold', 'lost')
  );

-- Migration 0016 established concrete world placement for pre-existing
-- unheld rows. Preserve their former pickup behavior by classifying only those
-- deterministically placed legacy rows as dropped; unknown rows remain hidden.
UPDATE inventory
SET unheld_disposition = 'dropped'
WHERE character_id IS NULL
  AND world_location_id IS NOT NULL
  AND trim(world_location_id) <> '';

DROP INDEX inventory_unheld_world_location_id;
CREATE INDEX inventory_claimable_world_location_id
ON inventory(world_location_id, id)
WHERE character_id IS NULL AND unheld_disposition = 'dropped';

DROP TRIGGER inventory_location_insert_guard;
DROP TRIGGER inventory_location_update_guard;

CREATE TRIGGER inventory_location_insert_guard
BEFORE INSERT ON inventory
WHEN
  (NEW.character_id IS NOT NULL AND (
    NEW.world_location_id IS NOT NULL OR NEW.unheld_disposition IS NOT NULL
  )) OR
  (NEW.character_id IS NULL AND NEW.location IS NOT NULL) OR
  (NEW.world_location_id IS NOT NULL AND trim(NEW.world_location_id) = '') OR
  (NEW.character_id IS NULL AND NEW.world_location_id IS NOT NULL AND
    NEW.unheld_disposition IS NULL) OR
  (NEW.unheld_disposition = 'dropped' AND NEW.world_location_id IS NULL)
BEGIN
  SELECT RAISE(ABORT, 'inventory custody/location invariant violated');
END;

CREATE TRIGGER inventory_location_update_guard
BEFORE UPDATE OF character_id, location, world_location_id, unheld_disposition
ON inventory
WHEN
  (NEW.character_id IS NOT NULL AND (
    NEW.world_location_id IS NOT NULL OR NEW.unheld_disposition IS NOT NULL
  )) OR
  (NEW.character_id IS NULL AND NEW.location IS NOT NULL) OR
  (NEW.world_location_id IS NOT NULL AND trim(NEW.world_location_id) = '') OR
  (NEW.character_id IS NULL AND NEW.world_location_id IS NOT NULL AND
    NEW.unheld_disposition IS NULL) OR
  (NEW.unheld_disposition = 'dropped' AND NEW.world_location_id IS NULL)
BEGIN
  SELECT RAISE(ABORT, 'inventory custody/location invariant violated');
END;
