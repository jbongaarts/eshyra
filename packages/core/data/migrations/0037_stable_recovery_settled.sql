ALTER TABLE character
  ADD COLUMN stable_recovery_settled INTEGER NOT NULL DEFAULT 0
  CHECK (stable_recovery_settled IN (0, 1));

ALTER TABLE encounter_combatant
  ADD COLUMN stable_recovery_settled INTEGER NOT NULL DEFAULT 0
  CHECK (stable_recovery_settled IN (0, 1));
