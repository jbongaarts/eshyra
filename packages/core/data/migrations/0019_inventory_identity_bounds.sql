-- Migration 0019: bounded exact inventory identity and legacy repair evidence.
-- Existing oversized identities remain intact: ids are actionable foreign keys
-- and must never be truncated. They are quarantined for an explicit repair.

CREATE TABLE inventory_identity_repair (
  inventory_id TEXT PRIMARY KEY
    REFERENCES inventory(id) ON DELETE CASCADE ON UPDATE CASCADE,
  id_bytes INTEGER NOT NULL CHECK (id_bytes > 0),
  name_bytes INTEGER NOT NULL CHECK (name_bytes > 0),
  reason TEXT NOT NULL
);

INSERT INTO inventory_identity_repair(inventory_id, id_bytes, name_bytes, reason)
SELECT id,
       length(CAST(id AS BLOB)),
       length(CAST(name AS BLOB)),
       CASE
         WHEN length(CAST(id AS BLOB)) > 256
              AND length(CAST(name AS BLOB)) > 256 THEN 'id-and-name-over-limit'
         WHEN length(CAST(id AS BLOB)) > 256 THEN 'id-over-limit'
         ELSE 'name-over-limit'
       END
FROM inventory
WHERE length(CAST(id AS BLOB)) > 256
   OR length(CAST(name AS BLOB)) > 256;

CREATE TRIGGER inventory_identity_insert_guard
BEFORE INSERT ON inventory
WHEN length(CAST(NEW.id AS BLOB)) > 256
  OR length(CAST(NEW.name AS BLOB)) > 256
BEGIN
  SELECT RAISE(ABORT, 'inventory id/name exceeds UTF-8 identity bounds');
END;

CREATE TRIGGER inventory_identity_update_guard
BEFORE UPDATE OF id, name ON inventory
WHEN (length(CAST(NEW.id AS BLOB)) > 256
      AND length(CAST(OLD.id AS BLOB)) <= 256)
  OR (length(CAST(NEW.name AS BLOB)) > 256
      AND length(CAST(OLD.name AS BLOB)) <= 256)
BEGIN
  SELECT RAISE(ABORT, 'inventory id/name exceeds UTF-8 identity bounds');
END;
