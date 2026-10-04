-- eshyra-ysr3: the 0-hit-point 'revert' rule splits into 'revert-object'
-- (Animate Objects: the creature leaves play, the object is not a combatant)
-- and 'revert-form' (Giant Insect: the same creature returns to its natural
-- form and stays in play), and an actor link may carry the natural form
-- (hit points and rules reference at cast) that its 'revert' cleanup restores.
-- Existing 'revert' rows are rewritten by their owning spell: a link held
-- (in any status) by an Animate Objects effect is 'revert-object', every
-- other one 'revert-form'. A legacy 'revert-form' row has no natural-form
-- snapshot (nothing was released with the old rule); durable-state validation
-- reports it.
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
  zero_hp_rule TEXT CHECK (zero_hp_rule IS NULL OR zero_hp_rule IN ('vanish', 'vanish-bonded', 'revert-object', 'revert-form')),
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
  damage_turn_key, head_died_this_turn, stable_recovery_settled, zero_hp_rule
)
SELECT campaign_id, combat_instance_id, source_encounter_id, combatant_id,
       identity_kind, identity_ref, display_label, rules_ref, side, faction,
       hp_current, hp_max, ac, conditions_json, status, location_id, placement,
       provenance, session_id, updated_at, death_rules, death_save_successes,
       death_save_failures, recovery_block, stable_recovery_roll,
       stable_recovery_anchor_elapsed_minutes,
       stable_recovery_deadline_elapsed_minutes, head_count,
       heads_died_since_own_turn, fire_damage_since_own_turn, damage_this_turn,
       damage_turn_key, head_died_this_turn, stable_recovery_settled,
       CASE WHEN zero_hp_rule = 'revert' THEN
         CASE WHEN EXISTS (
           SELECT 1 FROM active_effect_link l
           JOIN active_effect e ON e.campaign_id = l.campaign_id AND e.effect_id = l.effect_id
           WHERE l.campaign_id = encounter_combatant.campaign_id
             AND l.link_kind = 'actor'
             AND e.source_ref = 'spell:animate-objects'
             AND ((l.target_kind = 'combatant'
                   AND l.projection_ref = encounter_combatant.combatant_id)
               OR (encounter_combatant.identity_kind = 'campaign_actor'
                   AND l.campaign_actor_id = encounter_combatant.identity_ref))
         ) THEN 'revert-object' ELSE 'revert-form' END
       ELSE zero_hp_rule END
FROM encounter_combatant;
DROP TABLE encounter_combatant;
ALTER TABLE encounter_combatant_new RENAME TO encounter_combatant;
CREATE INDEX encounter_combatant_instance ON encounter_combatant(campaign_id, combat_instance_id);
CREATE INDEX encounter_combatant_identity ON encounter_combatant(campaign_id, identity_kind, identity_ref);
CREATE INDEX encounter_combatant_status ON encounter_combatant(campaign_id, status);

UPDATE campaign_actor
SET state_json = json_set(
  state_json, '$.combatLifecycle.zeroHpRule',
  CASE WHEN EXISTS (
    SELECT 1 FROM active_effect_link l
    JOIN active_effect e ON e.campaign_id = l.campaign_id AND e.effect_id = l.effect_id
    WHERE l.campaign_id = campaign_actor.campaign_id
      AND l.link_kind = 'actor'
      AND e.source_ref = 'spell:animate-objects'
      AND (l.campaign_actor_id = campaign_actor.actor_id
        OR (l.target_kind = 'campaign_actor' AND l.target_ref = campaign_actor.actor_id)
        OR EXISTS (
          SELECT 1 FROM encounter_combatant c
          WHERE c.campaign_id = l.campaign_id AND c.combatant_id = l.projection_ref
            AND c.identity_kind = 'campaign_actor' AND c.identity_ref = campaign_actor.actor_id))
  ) THEN 'revert-object' ELSE 'revert-form' END)
WHERE json_valid(state_json)
  AND json_extract(state_json, '$.combatLifecycle.zeroHpRule') = 'revert';

CREATE TABLE active_effect_link_new (
  campaign_id TEXT NOT NULL, effect_id TEXT NOT NULL,
  link_kind TEXT NOT NULL CHECK (link_kind IN ('condition','actor','zone','form')),
  target_kind TEXT NOT NULL CHECK (target_kind IN ('character','combatant','campaign_actor','scope')),
  target_ref TEXT NOT NULL, projection_ref TEXT NOT NULL, campaign_actor_id TEXT,
  cleanup_on_end TEXT NOT NULL DEFAULT 'remove' CHECK (cleanup_on_end IN ('remove','release','revert')),
  cleanup_on_break TEXT NOT NULL DEFAULT 'remove' CHECK (cleanup_on_break IN ('remove','release','revert')),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','removed','released')),
  removed_reason TEXT, removed_at TEXT, provenance TEXT NOT NULL,
  session_id TEXT NOT NULL, updated_at TEXT NOT NULL,
  natural_form_json TEXT,
  PRIMARY KEY (campaign_id,effect_id,link_kind,target_kind,target_ref,projection_ref),
  CHECK ((link_kind = 'zone' AND target_kind = 'scope')
         OR (link_kind != 'zone' AND target_kind != 'scope')),
  CHECK (link_kind NOT IN ('zone','form')
         OR (cleanup_on_end = 'remove' AND cleanup_on_break = 'remove')),
  CHECK (cleanup_on_end != 'revert' OR (link_kind = 'actor' AND natural_form_json IS NOT NULL)),
  CHECK (cleanup_on_break != 'revert' OR (link_kind = 'actor' AND natural_form_json IS NOT NULL)),
  CHECK (natural_form_json IS NULL OR link_kind = 'actor'),
  CHECK (status = 'active' OR (removed_reason IS NOT NULL AND removed_at IS NOT NULL)),
  CHECK (status != 'active' OR (removed_reason IS NULL AND removed_at IS NULL))
);
INSERT INTO active_effect_link_new (
  campaign_id, effect_id, link_kind, target_kind, target_ref, projection_ref,
  campaign_actor_id, cleanup_on_end, cleanup_on_break, status, removed_reason,
  removed_at, provenance, session_id, updated_at
)
SELECT campaign_id, effect_id, link_kind, target_kind, target_ref, projection_ref,
       campaign_actor_id, cleanup_on_end, cleanup_on_break, status, removed_reason,
       removed_at, provenance, session_id, updated_at
FROM active_effect_link;
DROP TABLE active_effect_link;
ALTER TABLE active_effect_link_new RENAME TO active_effect_link;
CREATE INDEX active_effect_link_target ON active_effect_link(campaign_id,target_kind,target_ref);
