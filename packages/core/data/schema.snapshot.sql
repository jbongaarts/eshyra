-- GENERATED FILE — DO NOT EDIT.
--
-- A review-only snapshot of the cumulative schema produced by applying every
-- migration in packages/core/data/migrations/ to a fresh database (ADR 0015
-- §7). It is never executed and is not schema authority — the migrations are.
-- Regenerate with: npm run -w @eshyra/core schema:snapshot

CREATE TABLE "active_effect" (
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
  end_detail TEXT, ended_at TEXT, created_at TEXT NOT NULL, provenance TEXT NOT NULL, session_id TEXT NOT NULL, updated_at TEXT NOT NULL, anchor_elapsed_minutes INTEGER
  CHECK (anchor_elapsed_minutes IS NULL OR anchor_elapsed_minutes >= 0), deadline_elapsed_minutes INTEGER
  CHECK (deadline_elapsed_minutes IS NULL OR deadline_elapsed_minutes >= anchor_elapsed_minutes),
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

CREATE TABLE active_effect_event (
  campaign_id TEXT NOT NULL,
  effect_id TEXT NOT NULL,
  seq INTEGER NOT NULL CHECK (seq >= 1),
  event_kind TEXT NOT NULL CHECK (event_kind IN (
    'created',
    'refreshed',
    'suppressed',
    'unsuppressed',
    'concentration-check',
    'target-removed',
    'combat-closed',
    'ended'
  )),
  detail_json TEXT NOT NULL,
  occurred_at TEXT NOT NULL,
  provenance TEXT NOT NULL,
  session_id TEXT NOT NULL,
  PRIMARY KEY (campaign_id, effect_id, seq)
);

CREATE TABLE "active_effect_link" (
  campaign_id TEXT NOT NULL,effect_id TEXT NOT NULL,link_kind TEXT NOT NULL CHECK (link_kind IN ('condition','actor','zone','form')),
  target_kind TEXT NOT NULL CHECK (target_kind IN ('character','combatant','campaign_actor')),target_ref TEXT NOT NULL,projection_ref TEXT NOT NULL,
  campaign_actor_id TEXT,cleanup_on_end TEXT NOT NULL DEFAULT 'remove' CHECK (cleanup_on_end IN ('remove','release')),cleanup_on_break TEXT NOT NULL DEFAULT 'remove' CHECK (cleanup_on_break IN ('remove','release')),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','removed','released')),removed_reason TEXT,removed_at TEXT,provenance TEXT NOT NULL,session_id TEXT NOT NULL,updated_at TEXT NOT NULL,
  PRIMARY KEY (campaign_id,effect_id,link_kind,target_kind,target_ref,projection_ref), CHECK (status='active' OR (removed_reason IS NOT NULL AND removed_at IS NOT NULL)), CHECK (status!='active' OR (removed_reason IS NULL AND removed_at IS NULL))
);

CREATE TABLE "active_effect_target" (
  campaign_id TEXT NOT NULL,effect_id TEXT NOT NULL,target_kind TEXT NOT NULL CHECK (target_kind IN ('character','combatant','campaign_actor','scope')),target_ref TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','removed')),removed_reason TEXT,removed_at TEXT,provenance TEXT NOT NULL,session_id TEXT NOT NULL,updated_at TEXT NOT NULL,
  PRIMARY KEY (campaign_id,effect_id,target_kind,target_ref), CHECK (status != 'removed' OR (removed_reason IS NOT NULL AND removed_at IS NOT NULL)), CHECK (status = 'removed' OR (removed_reason IS NULL AND removed_at IS NULL))
);

CREATE TABLE adventure_run (
  campaign_id TEXT NOT NULL,
  run_id TEXT NOT NULL,
  module_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('active', 'completed', 'abandoned')),
  started_at_session_id TEXT,
  completed_at_session_id TEXT,
  progress_json TEXT NOT NULL DEFAULT '{}',
  notes TEXT NOT NULL DEFAULT '',
  provenance TEXT NOT NULL,
  session_id TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (campaign_id, run_id)
);

CREATE TABLE arc_summary (
  campaign_id TEXT NOT NULL,
  arc_id TEXT NOT NULL,
  summary TEXT NOT NULL,
  source_session_ids_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (campaign_id, arc_id)
);

CREATE TABLE attunement (
  campaign_id TEXT NOT NULL,
  character_id TEXT NOT NULL,
  item_id TEXT NOT NULL,
  item_key TEXT NOT NULL,
  display_name TEXT NOT NULL,
  attuned_at TEXT NOT NULL,
  provenance TEXT NOT NULL,
  session_id TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (campaign_id, character_id, item_id)
);

CREATE TABLE campaign_actor (
  campaign_id TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  display_name TEXT NOT NULL,
  actor_kind TEXT NOT NULL CHECK (actor_kind IN (
    'npc',
    'creature',
    'monster',
    'companion',
    'other'
  )),
  source_kind TEXT NOT NULL CHECK (source_kind IN (
    'module_npc',
    'module_creature',
    'encounter_instance',
    'campaign_created'
  )),
  source_ref TEXT,
  rules_ref TEXT,
  hp_current INTEGER CHECK (hp_current IS NULL OR hp_current >= 0),
  hp_max INTEGER CHECK (hp_max IS NULL OR hp_max >= 0),
  conditions_json TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL CHECK (status IN (
    'alive',
    'dead',
    'unconscious',
    'escaped',
    'inactive',
    'unknown'
  )),
  current_location_id TEXT,
  state_json TEXT NOT NULL DEFAULT '{}',
  provenance TEXT NOT NULL,
  session_id TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (campaign_id, actor_id)
);

CREATE TABLE campaign_arc (
  campaign_id  TEXT NOT NULL,
  arc_id       TEXT NOT NULL,
  sequence_no  INTEGER NOT NULL,
  status       TEXT NOT NULL CHECK (status IN ('open', 'closed')),
  opened_at    TEXT NOT NULL,
  closed_at    TEXT,
  PRIMARY KEY (campaign_id, arc_id)
);

CREATE TABLE campaign_bible (
  campaign_id TEXT PRIMARY KEY,
  world_facts_json TEXT NOT NULL,
  major_npcs_json TEXT NOT NULL,
  factions_json TEXT NOT NULL,
  open_threads_json TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE campaign_overlay_lore (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN (
    'rumor',
    'clue',
    'npc_detail',
    'location_detail',
    'quest_hook',
    'threat_report',
    'scene_consequence',
    'player_created_detail',
    'other'
  )),
  subject_id TEXT,
  subject_text TEXT NOT NULL,
  location_id TEXT,
  npc_id TEXT,
  faction_id TEXT,
  fact TEXT NOT NULL,
  truth_status TEXT NOT NULL CHECK (truth_status IN (
    'confirmed',
    'true',
    'false',
    'disproven',
    'unknown',
    'rumored',
    'reported',
    'observed',
    'believed',
    'lie',
    'exaggeration'
  )),
  source TEXT NOT NULL CHECK (source IN (
    'dm_improvised',
    'player_declared',
    'module_derived',
    'tool_result',
    'consequence'
  )),
  scope TEXT NOT NULL CHECK (scope IN ('scene', 'session', 'campaign')),
  significance TEXT NOT NULL DEFAULT 'consequence' CHECK (significance IN (
    'atmosphere',
    'continuity',
    'clue',
    'hook',
    'consequence'
  )),
  visibility TEXT NOT NULL CHECK (visibility IN (
    'player_visible',
    'dm_only',
    'mixed'
  )),
  introduced_at_turn_id TEXT NOT NULL,
  introduced_at_session_id TEXT NOT NULL,
  supersedes TEXT,
  invalidates TEXT,
  tags_json TEXT NOT NULL DEFAULT '[]',
  provenance TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE campaign_progression_policy (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  advancement_mode TEXT NOT NULL CHECK (advancement_mode IN ('xp', 'milestone')),
  provenance TEXT NOT NULL,
  session_id TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE campaign_rules_binding (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  base_system_id TEXT NOT NULL,
  base_pack_id TEXT NOT NULL,
  base_version TEXT NOT NULL,
  addons_json TEXT NOT NULL DEFAULT '[]',
  resolved_at TEXT NOT NULL
);

CREATE TABLE campaign_session (
  campaign_id TEXT NOT NULL,
  session_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('open', 'closed')),
  started_at TEXT NOT NULL,
  closed_at TEXT,
  arc_id TEXT,
  PRIMARY KEY (campaign_id, session_id)
);

CREATE TABLE character (
  id TEXT PRIMARY KEY,
  name TEXT,
  ancestry TEXT,
  class_name TEXT,
  level INTEGER NOT NULL DEFAULT 1 CHECK (level >= 1),
  hp_current INTEGER NOT NULL DEFAULT 0 CHECK (hp_current >= 0),
  hp_max INTEGER NOT NULL DEFAULT 0 CHECK (hp_max >= 0),
  ability_scores_json TEXT NOT NULL DEFAULT '{}',
  conditions_json TEXT NOT NULL DEFAULT '[]',
  role TEXT NOT NULL DEFAULT 'pc',
  provenance TEXT NOT NULL,
  session_id TEXT NOT NULL,
  updated_at TEXT NOT NULL
, current_xp INTEGER NOT NULL DEFAULT 0 CHECK (current_xp >= 0), hp_temp INTEGER NOT NULL DEFAULT 0 CHECK (hp_temp >= 0), life_state TEXT NOT NULL DEFAULT 'alive'
    CHECK (life_state IN ('alive', 'dying', 'stable', 'dead')), death_save_successes INTEGER NOT NULL DEFAULT 0
    CHECK (death_save_successes BETWEEN 0 AND 3), death_save_failures INTEGER NOT NULL DEFAULT 0
    CHECK (death_save_failures BETWEEN 0 AND 3), inspiration INTEGER NOT NULL DEFAULT 0
    CHECK (inspiration IN (0, 1)));

CREATE TABLE character_hit_dice (
  character_id TEXT PRIMARY KEY REFERENCES character(id),
  die_faces INTEGER NOT NULL CHECK (die_faces IN (6, 8, 10, 12)),
  dice_maximum INTEGER NOT NULL CHECK (dice_maximum >= 1),
  dice_used INTEGER NOT NULL DEFAULT 0 CHECK (dice_used BETWEEN 0 AND dice_maximum),
  provenance TEXT NOT NULL,
  session_id TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE character_sheet (
  character_id TEXT PRIMARY KEY,
  schema_version INTEGER NOT NULL,
  system TEXT NOT NULL,
  rules_pack_id TEXT NOT NULL,
  sheet_json TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE character_spell_slot (
  character_id TEXT NOT NULL REFERENCES character(id),
  pool_kind TEXT NOT NULL CHECK (pool_kind IN ('spellcasting', 'pact_magic')),
  spell_level INTEGER NOT NULL CHECK (spell_level BETWEEN 1 AND 9),
  slots_max INTEGER NOT NULL CHECK (slots_max >= 1),
  slots_used INTEGER NOT NULL DEFAULT 0
    CHECK (slots_used >= 0 AND slots_used <= slots_max),
  provenance TEXT NOT NULL,
  session_id TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (character_id, pool_kind, spell_level)
);

CREATE TABLE character_wallet_event (
  id TEXT PRIMARY KEY,
  character_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('gain', 'spend', 'convert')),
  amounts_json TEXT NOT NULL,
  resulting_wallet_json TEXT NOT NULL,
  source TEXT NOT NULL,
  occurred_at TEXT NOT NULL,
  provenance TEXT NOT NULL,
  session_id TEXT NOT NULL
);

CREATE TABLE clock (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  in_game_time TEXT NOT NULL DEFAULT '',
  current_location_id TEXT,
  provenance TEXT NOT NULL,
  session_id TEXT NOT NULL,
  updated_at TEXT NOT NULL
, elapsed_minutes INTEGER NOT NULL DEFAULT 0
  CHECK (elapsed_minutes >= 0), in_game_time_elapsed_minutes INTEGER NOT NULL DEFAULT 0
  CHECK (in_game_time_elapsed_minutes >= 0));

CREATE TABLE combat_instance (
  campaign_id TEXT NOT NULL,
  combat_instance_id TEXT NOT NULL,
  source_encounter_id TEXT,
  source_run_id TEXT,
  status TEXT NOT NULL CHECK (status IN (
    'active',
    'completed',
    'abandoned',
    'fled',
    'interrupted'
  )),
  location_id TEXT,
  provenance TEXT NOT NULL,
  session_id TEXT NOT NULL,
  opened_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  closed_at TEXT, round_number INTEGER NOT NULL DEFAULT 0
    CHECK (round_number >= 0), active_participant_kind TEXT
    CHECK (
      active_participant_kind IS NULL
      OR active_participant_kind IN ('character', 'combatant')
    ), active_participant_ref TEXT,
  PRIMARY KEY (campaign_id, combat_instance_id)
);

CREATE TABLE combat_turn_budget (
  campaign_id TEXT NOT NULL,
  combat_instance_id TEXT NOT NULL,
  participant_kind TEXT NOT NULL
    CHECK (participant_kind IN ('character', 'combatant')),
  participant_ref TEXT NOT NULL,
  surprised INTEGER NOT NULL DEFAULT 0 CHECK (surprised IN (0, 1)),
  turns_taken INTEGER NOT NULL DEFAULT 0 CHECK (turns_taken >= 0),
  action_used INTEGER NOT NULL DEFAULT 0 CHECK (action_used IN (0, 1)),
  action_activity TEXT,
  bonus_action_used INTEGER NOT NULL DEFAULT 0
    CHECK (bonus_action_used IN (0, 1)),
  bonus_action_activity TEXT,
  reactions_used INTEGER NOT NULL DEFAULT 0 CHECK (reactions_used >= 0),
  reaction_allowance INTEGER NOT NULL DEFAULT 1
    CHECK (reaction_allowance >= 1),
  reaction_refresh TEXT NOT NULL DEFAULT 'own_turn'
    CHECK (reaction_refresh IN ('own_turn', 'every_turn')),
  reaction_activity TEXT,
  free_interaction_used INTEGER NOT NULL DEFAULT 0
    CHECK (free_interaction_used IN (0, 1)),
  free_interaction_activity TEXT,
  movement_note TEXT,
  bonus_action_spell_cast INTEGER NOT NULL DEFAULT 0
    CHECK (bonus_action_spell_cast IN (0, 1)),
  other_spell_cast TEXT NOT NULL DEFAULT 'none'
    CHECK (other_spell_cast IN ('none', 'action-cantrip', 'other')),
  provenance TEXT NOT NULL,
  session_id TEXT NOT NULL,
  updated_at TEXT NOT NULL, legendary_action_allowance INTEGER NOT NULL DEFAULT 0
    CHECK (legendary_action_allowance >= 0), legendary_actions_used INTEGER NOT NULL DEFAULT 0
    CHECK (legendary_actions_used >= 0), legendary_action_activity TEXT, legendary_last_spend_token TEXT,
  PRIMARY KEY (
    campaign_id, combat_instance_id, participant_kind, participant_ref
  )
);

CREATE TABLE encounter_combatant (
  campaign_id TEXT NOT NULL,
  combat_instance_id TEXT NOT NULL,
  source_encounter_id TEXT,
  combatant_id TEXT NOT NULL,
  identity_kind TEXT NOT NULL CHECK (identity_kind IN (
    'encounter_instance',
    'module_npc',
    'module_creature',
    'campaign_actor'
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
    'alive',
    'dead',
    'unconscious',
    'escaped',
    'inactive'
  )),
  location_id TEXT,
  placement TEXT,
  provenance TEXT NOT NULL,
  session_id TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (campaign_id, combatant_id)
);

CREATE TABLE entity_usage_counter (
  campaign_id TEXT NOT NULL,
  owner_kind TEXT NOT NULL
    CHECK (owner_kind IN ('character', 'combatant', 'item')),
  owner_ref TEXT NOT NULL,
  counter_key TEXT NOT NULL,
  display_name TEXT NOT NULL,
  uses_max INTEGER NOT NULL CHECK (uses_max >= 1),
  uses_used INTEGER NOT NULL DEFAULT 0
    CHECK (uses_used >= 0 AND uses_used <= uses_max),
  reset_kind TEXT NOT NULL CHECK (reset_kind IN (
    'recharge_roll',
    'short_rest',
    'short_or_long_rest',
    'long_rest',
    'dawn'
  )),
  recharge_roll TEXT,
  recharge_minimum INTEGER
    CHECK (recharge_minimum IS NULL OR recharge_minimum >= 1),
  recharge_formula TEXT,
  last_recharge_attempt TEXT,
  last_spend_turn TEXT,
  source TEXT NOT NULL CHECK (source IN ('record', 'declared')),
  provenance TEXT NOT NULL,
  session_id TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (campaign_id, owner_kind, owner_ref, counter_key)
);

CREATE TABLE inventory (
  id TEXT PRIMARY KEY,
  character_id TEXT REFERENCES character(id),
  name TEXT NOT NULL,
  quantity INTEGER NOT NULL DEFAULT 1 CHECK (quantity >= 0),
  location TEXT,
  properties_json TEXT NOT NULL DEFAULT '{}',
  provenance TEXT NOT NULL,
  session_id TEXT NOT NULL,
  updated_at TEXT NOT NULL
, pack_ref TEXT
  CHECK (pack_ref IS NULL OR pack_ref GLOB 'magic-item:*'), variant_id TEXT
  CHECK (
    variant_id IS NULL OR
    pack_ref IS NOT NULL AND
    variant_id GLOB '[a-z0-9]*' AND
    variant_id NOT GLOB '*[^a-z0-9-]*' AND
    variant_id NOT GLOB '*--*' AND
    variant_id NOT GLOB '-*' AND
    variant_id NOT GLOB '*-'
  ), world_location_id TEXT, unheld_disposition TEXT
  CHECK (
    unheld_disposition IS NULL OR
    unheld_disposition IN ('dropped', 'sold', 'lost')
  ));

CREATE TABLE inventory_adoption_resolution (
  -- Append-only evidence intentionally survives later item destruction.
  inventory_id TEXT NOT NULL,
  seq INTEGER NOT NULL CHECK (seq >= 1),
  action TEXT NOT NULL CHECK (action IN (
    'discard-evidence',
    'set-reviewed-quantity',
    'discard-legacy-attunement',
    'discard-legacy-counter'
  )),
  evidence TEXT NOT NULL CHECK (length(trim(evidence)) > 0),
  previous_reason TEXT NOT NULL,
  previous_review_kind TEXT NOT NULL CHECK (previous_review_kind IN (
    'legacy-marker',
    'malformed-evidence',
    'oversized-stack',
    'legacy-attunement',
    'legacy-counter'
  )),
  previous_requested_pack_ref TEXT NOT NULL,
  previous_requested_variant_id TEXT,
  resulting_pack_ref TEXT NOT NULL CHECK (resulting_pack_ref GLOB 'magic-item:*'),
  resulting_variant_id TEXT,
  reviewed_quantity INTEGER CHECK (reviewed_quantity IS NULL OR reviewed_quantity >= 1),
  discarded_structure_json TEXT NOT NULL,
  provenance TEXT NOT NULL,
  session_id TEXT NOT NULL,
  resolved_at TEXT NOT NULL,
  CHECK ((action = 'set-reviewed-quantity') = (reviewed_quantity IS NOT NULL)),
  CHECK (
    (previous_review_kind IN ('legacy-marker', 'malformed-evidence')
      AND action = 'discard-evidence') OR
    (previous_review_kind = 'oversized-stack'
      AND action = 'set-reviewed-quantity') OR
    (previous_review_kind = 'legacy-attunement'
      AND action = 'discard-legacy-attunement') OR
    (previous_review_kind = 'legacy-counter'
      AND action = 'discard-legacy-counter')
  ),
  PRIMARY KEY (inventory_id, seq)
);

CREATE TABLE inventory_adoption_review (
  inventory_id TEXT PRIMARY KEY
    REFERENCES inventory(id) ON DELETE CASCADE,
  requested_pack_ref TEXT NOT NULL
    CHECK (requested_pack_ref GLOB 'magic-item:*'),
  requested_variant_id TEXT,
  review_kind TEXT NOT NULL CHECK (review_kind IN (
    'legacy-marker',
    'malformed-evidence',
    'oversized-stack',
    'legacy-attunement',
    'legacy-counter'
  )),
  reason TEXT NOT NULL CHECK (length(trim(reason)) > 0),
  raw_properties_json TEXT,
  raw_item_state_json TEXT,
  provenance TEXT NOT NULL,
  session_id TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE inventory_custody_event (
  -- Custody history remains auditable after the physical row is destroyed.
  inventory_id TEXT NOT NULL,
  seq INTEGER NOT NULL CHECK (seq >= 1),
  from_disposition TEXT NOT NULL CHECK (from_disposition IN ('sold', 'lost')),
  basis TEXT NOT NULL CHECK (basis IN ('found', 'repurchased', 'returned')),
  evidence TEXT NOT NULL CHECK (length(trim(evidence)) > 0),
  payment_event_id TEXT REFERENCES character_wallet_event(id),
  to_character_id TEXT NOT NULL REFERENCES character(id),
  world_location_id TEXT NOT NULL,
  provenance TEXT NOT NULL,
  session_id TEXT NOT NULL,
  occurred_at TEXT NOT NULL,
  CHECK ((basis = 'repurchased') = (payment_event_id IS NOT NULL)),
  PRIMARY KEY (inventory_id, seq)
);

CREATE TABLE inventory_identity_repair (
  inventory_id TEXT PRIMARY KEY
    REFERENCES inventory(id) ON DELETE CASCADE ON UPDATE CASCADE,
  id_bytes INTEGER NOT NULL CHECK (id_bytes > 0),
  name_bytes INTEGER NOT NULL CHECK (name_bytes > 0),
  reason TEXT NOT NULL
);

CREATE TABLE item_state (
  inventory_id TEXT PRIMARY KEY
    REFERENCES inventory(id) ON DELETE CASCADE,
  state_json TEXT NOT NULL,
  provenance TEXT NOT NULL,
  session_id TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE module_encounter (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  location_id TEXT NOT NULL,
  data_json TEXT NOT NULL
);

CREATE TABLE module_location (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  summary TEXT NOT NULL,
  data_json TEXT NOT NULL
);

CREATE TABLE module_lore (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  scope TEXT NOT NULL,
  data_json TEXT NOT NULL
);

CREATE TABLE module_meta (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  pack_id TEXT NOT NULL,
  title TEXT NOT NULL,
  pack_type TEXT NOT NULL,
  description TEXT NOT NULL,
  starting_location_id TEXT NOT NULL,
  license_json TEXT NOT NULL,
  data_json TEXT NOT NULL
);

CREATE TABLE module_npc (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  location_id TEXT NOT NULL,
  data_json TEXT NOT NULL
);

CREATE TABLE module_trigger (
  id TEXT PRIMARY KEY,
  data_json TEXT NOT NULL
);

CREATE TABLE overlay_facts (
  key TEXT PRIMARY KEY,
  value_json TEXT NOT NULL,
  provenance TEXT NOT NULL,
  session_id TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE plot_flags (
  key TEXT PRIMARY KEY,
  value_json TEXT NOT NULL,
  provenance TEXT NOT NULL,
  session_id TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE progression_event (
  id TEXT PRIMARY KEY,
  character_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('xp-award', 'milestone-award', 'level-up')),
  amount INTEGER,
  milestone_label TEXT,
  source TEXT NOT NULL,
  resulting_xp INTEGER CHECK (resulting_xp IS NULL OR resulting_xp >= 0),
  resulting_level INTEGER NOT NULL CHECK (resulting_level >= 1),
  applied_changes_json TEXT,
  occurred_at TEXT NOT NULL,
  provenance TEXT NOT NULL,
  session_id TEXT NOT NULL
);

CREATE TABLE rest_event (
  campaign_id TEXT NOT NULL,
  rest_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('short', 'long')),
  start_elapsed_minutes INTEGER NOT NULL CHECK (start_elapsed_minutes >= 0),
  end_elapsed_minutes INTEGER NOT NULL CHECK (end_elapsed_minutes >= start_elapsed_minutes),
  declared_duration_minutes INTEGER NOT NULL CHECK (declared_duration_minutes >= 0),
  qualification_json TEXT NOT NULL,
  narrative_label TEXT,
  status TEXT NOT NULL CHECK (status IN ('in_progress', 'completed', 'failed')),
  benefits_json TEXT NOT NULL DEFAULT '{}',
  provenance TEXT NOT NULL,
  session_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (campaign_id, rest_id)
);

CREATE TABLE rest_participant (
  campaign_id TEXT NOT NULL,
  rest_id TEXT NOT NULL,
  character_id TEXT NOT NULL REFERENCES character(id),
  start_hp INTEGER NOT NULL CHECK (start_hp >= 0),
  start_life_state TEXT NOT NULL,
  short_recovery_open INTEGER NOT NULL DEFAULT 0 CHECK (short_recovery_open IN (0,1)),
  benefit_json TEXT NOT NULL DEFAULT '{}',
  PRIMARY KEY (campaign_id, rest_id, character_id),
  FOREIGN KEY (campaign_id, rest_id) REFERENCES rest_event(campaign_id, rest_id)
);

CREATE TABLE scene (
  campaign_id TEXT NOT NULL,
  session_id TEXT NOT NULL,
  scene_id TEXT NOT NULL,
  title TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('open', 'closed')),
  opened_at TEXT NOT NULL,
  closed_at TEXT,
  PRIMARY KEY (campaign_id, session_id, scene_id)
);

CREATE TABLE scene_log (
  campaign_id TEXT NOT NULL,
  session_id TEXT NOT NULL,
  scene_id TEXT NOT NULL,
  seq INTEGER NOT NULL,
  turn_id TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('player', 'dm')),
  content TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (campaign_id, session_id, scene_id, seq)
);

CREATE TABLE scene_summary (
  campaign_id TEXT NOT NULL,
  session_id TEXT NOT NULL,
  scene_id TEXT NOT NULL,
  summary TEXT NOT NULL,
  salient_refs_json TEXT NOT NULL,
  source_turn_ids_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (campaign_id, session_id, scene_id)
);

CREATE TABLE session_recap (
  campaign_id TEXT NOT NULL,
  session_id TEXT NOT NULL,
  recap TEXT NOT NULL,
  source_scene_ids_json TEXT NOT NULL,
  state_delta_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (campaign_id, session_id)
);

CREATE TABLE turn_failure_diagnostic (
  campaign_id TEXT NOT NULL,
  session_id TEXT NOT NULL,
  turn_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  phase TEXT NOT NULL,
  error_name TEXT NOT NULL,
  error_message TEXT NOT NULL,
  model_rounds INTEGER NOT NULL CHECK (model_rounds >= 0),
  PRIMARY KEY (campaign_id, session_id, turn_id)
);

CREATE TABLE turn_trace (
  campaign_id TEXT NOT NULL,
  session_id TEXT NOT NULL,
  turn_id TEXT NOT NULL,
  consent_scope TEXT NOT NULL,
  player_input TEXT NOT NULL,
  acting_character_id TEXT,
  retrieved_context_json TEXT NOT NULL,
  prompt_profile TEXT NOT NULL,
  model_output TEXT NOT NULL,
  tool_calls_json TEXT NOT NULL,
  rules_resolution_json TEXT NOT NULL,
  accepted_state_delta_json TEXT NOT NULL,
  rejected_candidates_json TEXT NOT NULL,
  final_narration TEXT NOT NULL,
  memory_updates_json TEXT NOT NULL,
  human_corrections_json TEXT NOT NULL,
  quality_flags_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (campaign_id, session_id, turn_id)
);

CREATE INDEX active_effect_link_target ON active_effect_link(campaign_id,target_kind,target_ref);

CREATE UNIQUE INDEX active_effect_one_concentration_per_owner ON active_effect(campaign_id,concentration_owner_kind,concentration_owner_ref) WHERE requires_concentration=1 AND status IN ('active','suppressed');

CREATE INDEX active_effect_status ON active_effect(campaign_id,status);

CREATE INDEX attunement_item ON attunement(campaign_id, item_id);

CREATE INDEX campaign_actor_location
  ON campaign_actor(campaign_id, current_location_id);

CREATE INDEX campaign_actor_source
  ON campaign_actor(campaign_id, source_kind, source_ref);

CREATE UNIQUE INDEX campaign_arc_one_open
  ON campaign_arc(campaign_id) WHERE status = 'open';

CREATE INDEX campaign_overlay_lore_kind
  ON campaign_overlay_lore(kind);

CREATE INDEX campaign_overlay_lore_location
  ON campaign_overlay_lore(location_id);

CREATE INDEX campaign_overlay_lore_npc
  ON campaign_overlay_lore(npc_id);

CREATE UNIQUE INDEX campaign_session_one_open
  ON campaign_session(campaign_id)
  WHERE status = 'open';

CREATE INDEX character_spell_slot_character
  ON character_spell_slot(character_id, pool_kind, spell_level);

CREATE UNIQUE INDEX combat_instance_one_active_per_campaign
  ON combat_instance(campaign_id) WHERE status = 'active';

CREATE INDEX combat_instance_source
  ON combat_instance(campaign_id, source_encounter_id);

CREATE INDEX combat_turn_budget_instance
  ON combat_turn_budget(campaign_id, combat_instance_id);

CREATE INDEX encounter_combatant_identity
  ON encounter_combatant(campaign_id, identity_kind, identity_ref);

CREATE INDEX encounter_combatant_instance
  ON encounter_combatant(campaign_id, combat_instance_id);

CREATE INDEX encounter_combatant_status
  ON encounter_combatant(campaign_id, status);

CREATE INDEX entity_usage_counter_owner
  ON entity_usage_counter(campaign_id, owner_kind, owner_ref);

CREATE INDEX idx_character_wallet_event_character
  ON character_wallet_event (character_id, occurred_at, id);

CREATE INDEX idx_progression_event_character
  ON progression_event (character_id, occurred_at, id);

CREATE INDEX inventory_claimable_world_location_id
ON inventory(world_location_id, id)
WHERE character_id IS NULL AND unheld_disposition = 'dropped';

CREATE INDEX rest_event_long_benefit_time ON rest_event(campaign_id, kind, end_elapsed_minutes);

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
