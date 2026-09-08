-- Capture the existing chronology before snapshots or replay can reassign rowids.
-- Producers allocate the next order within the INSERT write lock. Named columns
-- survive the ordinary checkpoint and replay serialization paths.
ALTER TABLE scene_log ADD COLUMN insertion_order INTEGER NOT NULL DEFAULT 0;
UPDATE scene_log SET insertion_order = rowid;
CREATE UNIQUE INDEX scene_log_insertion_order ON scene_log(insertion_order);

ALTER TABLE character_wallet_event ADD COLUMN insertion_order INTEGER NOT NULL DEFAULT 0;
UPDATE character_wallet_event SET insertion_order = rowid;
CREATE UNIQUE INDEX character_wallet_event_insertion_order ON character_wallet_event(insertion_order);
