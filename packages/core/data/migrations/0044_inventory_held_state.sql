-- Authoritative held-in-hand state for equipment prerequisites.
-- Existing and legacy inventory rows default to not held.
ALTER TABLE inventory_wear_state
  ADD COLUMN held INTEGER NOT NULL DEFAULT 0 CHECK (held IN (0, 1));
