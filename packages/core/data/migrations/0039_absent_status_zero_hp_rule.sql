PRAGMA defer_foreign_keys = ON;

CREATE TABLE encounter_combatant_new (
  campaign_id TEXT NOT NULL,
  combat_instance_id TEXT NOT NULL,
  source_encounter_id TEXT,
  combatant_id TEXT NOT NULL,
  identity_kind TEXT NOT NULL CHECK (identity_kind IN (
    'encounter_instance', 'module_npc', 'module_creature', 'campaign_actor'
  )),
  identity_ref TEXT,
  display_label TEXT NOT NULL,
  rules_ref TEXT NOT NULL,
  side TEXT NOT NULL,
  faction TEXT,
  hp_current INTEGER NOT NULL CHECK (hp_current >= 0),
  hp_max INTEGER NOT NULL CHECK (hp_max >= 0),
  ac INTEGER CHECK (ac IS NULL OR ac >= 0),
  conditions_json TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL CHECK (status IN (
    'alive', 'dead', 'unconscious', 'escaped', 'inactive', 'dying', 'stable',
    'absent'
  )),
  location_id TEXT,
  placement TEXT,
  provenance TEXT NOT NULL,
  session_id TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  death_rules TEXT NOT NULL DEFAULT 'monster' CHECK (death_rules IN ('monster', 'player-character')),
  death_save_successes INTEGER NOT NULL DEFAULT 0 CHECK (death_save_successes BETWEEN 0 AND 3),
  death_save_failures INTEGER NOT NULL DEFAULT 0 CHECK (death_save_failures BETWEEN 0 AND 3),
  recovery_block TEXT CHECK (recovery_block IS NULL OR recovery_block = 'suffocating'),
  stable_recovery_roll INTEGER CHECK (stable_recovery_roll BETWEEN 1 AND 4),
  stable_recovery_anchor_elapsed_minutes INTEGER CHECK (stable_recovery_anchor_elapsed_minutes >= 0),
  stable_recovery_deadline_elapsed_minutes INTEGER CHECK (stable_recovery_deadline_elapsed_minutes >= 0),
  head_count INTEGER CHECK (head_count IS NULL OR head_count >= 0),
  heads_died_since_own_turn INTEGER NOT NULL DEFAULT 0,
  fire_damage_since_own_turn INTEGER NOT NULL DEFAULT 0
  CHECK (fire_damage_since_own_turn IN (0, 1)),
  damage_this_turn INTEGER NOT NULL DEFAULT 0,
  damage_turn_key TEXT,
  head_died_this_turn INTEGER NOT NULL DEFAULT 0,
  stable_recovery_settled INTEGER NOT NULL DEFAULT 0
  CHECK (stable_recovery_settled IN (0, 1)),
  zero_hp_rule TEXT CHECK (zero_hp_rule IS NULL OR zero_hp_rule IN ('vanish', 'vanish-bonded', 'revert')),
  PRIMARY KEY (campaign_id, combatant_id)
);
INSERT INTO encounter_combatant_new (
  campaign_id, combat_instance_id, source_encounter_id, combatant_id,
  identity_kind, identity_ref, display_label, rules_ref, side, faction,
  hp_current, hp_max, ac, conditions_json, status, location_id, placement,
  provenance, session_id, updated_at, death_rules, death_save_successes,
  death_save_failures, recovery_block, stable_recovery_roll,
  stable_recovery_anchor_elapsed_minutes,
  stable_recovery_deadline_elapsed_minutes, head_count,
  heads_died_since_own_turn, fire_damage_since_own_turn, damage_this_turn,
  damage_turn_key, head_died_this_turn, stable_recovery_settled
)
SELECT campaign_id, combat_instance_id, source_encounter_id, combatant_id,
       identity_kind, identity_ref, display_label, rules_ref, side, faction,
       hp_current, hp_max, ac, conditions_json, status, location_id, placement,
       provenance, session_id, updated_at, death_rules, death_save_successes,
       death_save_failures, recovery_block, stable_recovery_roll,
       stable_recovery_anchor_elapsed_minutes,
       stable_recovery_deadline_elapsed_minutes, head_count,
       heads_died_since_own_turn, fire_damage_since_own_turn, damage_this_turn,
       damage_turn_key, head_died_this_turn, stable_recovery_settled
FROM encounter_combatant;
DROP TABLE encounter_combatant;
ALTER TABLE encounter_combatant_new RENAME TO encounter_combatant;
CREATE INDEX encounter_combatant_instance ON encounter_combatant(campaign_id, combat_instance_id);
CREATE INDEX encounter_combatant_identity ON encounter_combatant(campaign_id, identity_kind, identity_ref);
CREATE INDEX encounter_combatant_status ON encounter_combatant(campaign_id, status);

CREATE TABLE campaign_actor_new (
  campaign_id TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  display_name TEXT NOT NULL,
  actor_kind TEXT NOT NULL CHECK (actor_kind IN ('npc', 'creature', 'monster', 'companion', 'other')),
  source_kind TEXT NOT NULL CHECK (source_kind IN ('module_npc', 'module_creature', 'encounter_instance', 'campaign_created')),
  source_ref TEXT,
  rules_ref TEXT,
  hp_current INTEGER CHECK (hp_current IS NULL OR hp_current >= 0),
  hp_max INTEGER CHECK (hp_max IS NULL OR hp_max >= 0),
  conditions_json TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL CHECK (status IN ('alive', 'dead', 'unconscious', 'escaped', 'inactive', 'unknown', 'dying', 'stable', 'absent')),
  current_location_id TEXT,
  state_json TEXT NOT NULL DEFAULT '{}',
  provenance TEXT NOT NULL,
  session_id TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (campaign_id, actor_id)
);
INSERT INTO campaign_actor_new SELECT * FROM campaign_actor;
DROP TABLE campaign_actor;
ALTER TABLE campaign_actor_new RENAME TO campaign_actor;
CREATE INDEX campaign_actor_location ON campaign_actor(campaign_id, current_location_id);
CREATE INDEX campaign_actor_source ON campaign_actor(campaign_id, source_kind, source_ref);
