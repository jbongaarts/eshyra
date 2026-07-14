-- F3 persistent actor identity.  This migration rebuilds the three effect
-- tables whose reference-kind checks are part of their durable contract.
CREATE TABLE active_effect_new (
  campaign_id TEXT NOT NULL, effect_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('spell-effect','summoning','ward','curse','transformation','item-power','condition-package')),
  display_name TEXT NOT NULL, source_kind TEXT NOT NULL CHECK (source_kind IN ('spell','magic-item','feature','creature-trait','hazard','ruling')),
  source_ref TEXT, source_actor_kind TEXT CHECK (source_actor_kind IS NULL OR source_actor_kind IN ('character','combatant','campaign_actor')),
  source_actor_ref TEXT, requires_concentration INTEGER NOT NULL DEFAULT 0 CHECK (requires_concentration IN (0,1)),
  concentration_owner_kind TEXT CHECK (concentration_owner_kind IS NULL OR concentration_owner_kind IN ('character','combatant')),
  concentration_owner_ref TEXT, duration_kind TEXT NOT NULL CHECK (duration_kind IN ('timed','until-dismissed','until-removed','until-trigger')),
  duration_amount INTEGER CHECK (duration_amount IS NULL OR duration_amount >= 1), duration_unit TEXT CHECK (duration_unit IS NULL OR duration_unit IN ('round','minute','hour','day')),
  anchor_kind TEXT CHECK (anchor_kind IS NULL OR anchor_kind IN ('spell-cast','effect-created','trigger-occurred','source-turn-start','target-turn-start')),
  anchor_at TEXT, anchor_game_time TEXT, anchor_combat_instance_id TEXT, anchor_round INTEGER CHECK (anchor_round IS NULL OR anchor_round >= 1),
  anchor_participant_kind TEXT CHECK (anchor_participant_kind IS NULL OR anchor_participant_kind IN ('character','combatant')),
  anchor_participant_ref TEXT, anchor_participant_turn_ordinal INTEGER, anchor_trigger TEXT, expiry_trigger TEXT,
  dismissible INTEGER NOT NULL DEFAULT 0 CHECK (dismissible IN (0,1)), status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','suppressed','ended')),
  end_reason TEXT CHECK (end_reason IS NULL OR end_reason IN ('expired','dismissed','concentration-broken','dispelled','replaced','source-removed','ruled')),
  end_detail TEXT, ended_at TEXT, created_at TEXT NOT NULL, provenance TEXT NOT NULL, session_id TEXT NOT NULL, updated_at TEXT NOT NULL,
  PRIMARY KEY (campaign_id,effect_id),
  CHECK (requires_concentration = 0 OR (concentration_owner_kind IS NOT NULL AND concentration_owner_ref IS NOT NULL)),
  CHECK (requires_concentration = 1 OR (concentration_owner_kind IS NULL AND concentration_owner_ref IS NULL)),
  CHECK ((source_actor_kind IS NULL) = (source_actor_ref IS NULL)), CHECK (status != 'ended' OR (end_reason IS NOT NULL AND ended_at IS NOT NULL)),
  CHECK (status = 'ended' OR (end_reason IS NULL AND end_detail IS NULL AND ended_at IS NULL)),
  CHECK (duration_kind != 'timed' OR (duration_amount IS NOT NULL AND duration_unit IS NOT NULL AND anchor_kind IS NOT NULL AND anchor_at IS NOT NULL)),
  CHECK (duration_kind = 'timed' OR (duration_amount IS NULL AND duration_unit IS NULL AND anchor_kind IS NULL)),
  CHECK ((duration_kind = 'until-trigger') = (expiry_trigger IS NOT NULL)), CHECK (duration_kind != 'until-dismissed' OR dismissible = 1),
  CHECK (duration_unit IS NULL OR duration_unit != 'round' OR (anchor_combat_instance_id IS NOT NULL AND anchor_round IS NOT NULL)),
  CHECK (CASE WHEN anchor_kind IN ('source-turn-start','target-turn-start') THEN CASE WHEN anchor_participant_kind IS NOT NULL AND anchor_participant_kind IN ('character','combatant') AND duration_kind = 'timed' AND duration_unit = 'round' THEN 1 ELSE 0 END ELSE CASE WHEN anchor_participant_kind IS NULL THEN 1 ELSE 0 END END),
  CHECK (CASE WHEN anchor_kind IN ('source-turn-start','target-turn-start') THEN CASE WHEN anchor_participant_ref IS NOT NULL AND length(trim(anchor_participant_ref)) > 0 THEN 1 ELSE 0 END ELSE CASE WHEN anchor_participant_ref IS NULL THEN 1 ELSE 0 END END),
  CHECK (CASE WHEN anchor_kind IN ('source-turn-start','target-turn-start') THEN CASE WHEN anchor_participant_turn_ordinal IS NOT NULL AND anchor_participant_turn_ordinal >= 0 THEN 1 ELSE 0 END ELSE CASE WHEN anchor_participant_turn_ordinal IS NULL THEN 1 ELSE 0 END END),
  CHECK (CASE WHEN anchor_kind = 'trigger-occurred' THEN CASE WHEN anchor_trigger IS NOT NULL AND length(trim(anchor_trigger)) > 0 THEN 1 ELSE 0 END ELSE CASE WHEN anchor_trigger IS NULL THEN 1 ELSE 0 END END)
);
INSERT INTO active_effect_new(
  campaign_id, effect_id, kind, display_name, source_kind, source_ref,
  source_actor_kind, source_actor_ref, requires_concentration,
  concentration_owner_kind, concentration_owner_ref, duration_kind,
  duration_amount, duration_unit, anchor_kind, anchor_at, anchor_game_time,
  anchor_combat_instance_id, anchor_round, anchor_participant_kind,
  anchor_participant_ref, anchor_participant_turn_ordinal, anchor_trigger,
  expiry_trigger, dismissible, status, end_reason, end_detail, ended_at,
  created_at, provenance, session_id, updated_at
)
SELECT
  campaign_id, effect_id, kind, display_name, source_kind, source_ref,
  source_actor_kind, source_actor_ref, requires_concentration,
  concentration_owner_kind, concentration_owner_ref, duration_kind,
  duration_amount, duration_unit, anchor_kind, anchor_at, anchor_game_time,
  anchor_combat_instance_id, anchor_round, anchor_participant_kind,
  anchor_participant_ref, anchor_participant_turn_ordinal, anchor_trigger,
  expiry_trigger, dismissible, status, end_reason, end_detail, ended_at,
  created_at, provenance, session_id, updated_at
FROM active_effect;
DROP TABLE active_effect;
ALTER TABLE active_effect_new RENAME TO active_effect;
CREATE UNIQUE INDEX active_effect_one_concentration_per_owner ON active_effect(campaign_id,concentration_owner_kind,concentration_owner_ref) WHERE requires_concentration=1 AND status IN ('active','suppressed');
CREATE INDEX active_effect_status ON active_effect(campaign_id,status);

CREATE TABLE active_effect_target_new (
  campaign_id TEXT NOT NULL,effect_id TEXT NOT NULL,target_kind TEXT NOT NULL CHECK (target_kind IN ('character','combatant','campaign_actor','scope')),target_ref TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','removed')),removed_reason TEXT,removed_at TEXT,provenance TEXT NOT NULL,session_id TEXT NOT NULL,updated_at TEXT NOT NULL,
  PRIMARY KEY (campaign_id,effect_id,target_kind,target_ref), CHECK (status != 'removed' OR (removed_reason IS NOT NULL AND removed_at IS NOT NULL)), CHECK (status = 'removed' OR (removed_reason IS NULL AND removed_at IS NULL))
);
INSERT INTO active_effect_target_new SELECT * FROM active_effect_target;
DROP TABLE active_effect_target; ALTER TABLE active_effect_target_new RENAME TO active_effect_target;

CREATE TABLE active_effect_link_new (
  campaign_id TEXT NOT NULL,effect_id TEXT NOT NULL,link_kind TEXT NOT NULL CHECK (link_kind IN ('condition','actor','zone','form')),
  target_kind TEXT NOT NULL CHECK (target_kind IN ('character','combatant','campaign_actor')),target_ref TEXT NOT NULL,projection_ref TEXT NOT NULL,
  campaign_actor_id TEXT,cleanup_on_end TEXT NOT NULL DEFAULT 'remove' CHECK (cleanup_on_end IN ('remove','release')),cleanup_on_break TEXT NOT NULL DEFAULT 'remove' CHECK (cleanup_on_break IN ('remove','release')),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','removed','released')),removed_reason TEXT,removed_at TEXT,provenance TEXT NOT NULL,session_id TEXT NOT NULL,updated_at TEXT NOT NULL,
  PRIMARY KEY (campaign_id,effect_id,link_kind,target_kind,target_ref,projection_ref), CHECK (status='active' OR (removed_reason IS NOT NULL AND removed_at IS NOT NULL)), CHECK (status!='active' OR (removed_reason IS NULL AND removed_at IS NULL))
);
INSERT INTO active_effect_link_new(campaign_id,effect_id,link_kind,target_kind,target_ref,projection_ref,cleanup_on_end,cleanup_on_break,status,removed_reason,removed_at,provenance,session_id,updated_at)
 SELECT campaign_id,effect_id,link_kind,target_kind,target_ref,projection_ref,cleanup_on_end,cleanup_on_break,status,removed_reason,removed_at,provenance,session_id,updated_at FROM active_effect_link;
DROP TABLE active_effect_link; ALTER TABLE active_effect_link_new RENAME TO active_effect_link;
CREATE INDEX active_effect_link_target ON active_effect_link(campaign_id,target_kind,target_ref);
