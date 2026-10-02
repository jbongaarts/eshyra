ALTER TABLE encounter_combatant
  ADD COLUMN head_count INTEGER CHECK (head_count IS NULL OR head_count >= 0);

ALTER TABLE encounter_combatant
  ADD COLUMN heads_died_since_own_turn INTEGER NOT NULL DEFAULT 0;

ALTER TABLE encounter_combatant
  ADD COLUMN fire_damage_since_own_turn INTEGER NOT NULL DEFAULT 0
  CHECK (fire_damage_since_own_turn IN (0, 1));

ALTER TABLE encounter_combatant
  ADD COLUMN damage_this_turn INTEGER NOT NULL DEFAULT 0;

ALTER TABLE encounter_combatant
  ADD COLUMN damage_turn_key TEXT;

ALTER TABLE encounter_combatant
  ADD COLUMN head_died_this_turn INTEGER NOT NULL DEFAULT 0;
