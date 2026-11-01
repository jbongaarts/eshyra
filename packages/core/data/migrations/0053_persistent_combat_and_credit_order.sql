-- Preserve runtime-significant insertion chronology across checkpoint and replay
-- restoration, which re-inserts named columns and assigns fresh rowids.
ALTER TABLE encounter_combatant ADD COLUMN insertion_order INTEGER NOT NULL DEFAULT 0;
UPDATE encounter_combatant SET insertion_order = rowid;
CREATE UNIQUE INDEX encounter_combatant_insertion_order ON encounter_combatant(insertion_order);

ALTER TABLE combat_instance ADD COLUMN insertion_order INTEGER NOT NULL DEFAULT 0;
UPDATE combat_instance SET insertion_order = rowid;
CREATE UNIQUE INDEX combat_instance_insertion_order ON combat_instance(insertion_order);

ALTER TABLE item_grant_bind_credit ADD COLUMN insertion_order INTEGER NOT NULL DEFAULT 0;
UPDATE item_grant_bind_credit SET insertion_order = rowid;
CREATE UNIQUE INDEX item_grant_bind_credit_insertion_order ON item_grant_bind_credit(insertion_order);
