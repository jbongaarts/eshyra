-- eshyra-82uk: a bonded summon's pocket-dimension presence and its
-- action-triggered presence transitions (transition_bonded_summon).
-- campaign_actor.status gains 'pocketed' (Find Familiar's temporary dismissal:
-- out of play but not terminal, hit points and conditions kept), and the
-- active-effect audit ledger gains the 'presence-transition' event kind.
-- SQLite cannot alter a CHECK constraint, so both tables are rebuilt with the
-- widened lists; existing rows are copied unchanged.
PRAGMA defer_foreign_keys = ON;

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
  status TEXT NOT NULL CHECK (status IN ('alive', 'dead', 'unconscious', 'escaped', 'inactive', 'unknown', 'dying', 'stable', 'absent', 'pocketed')),
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

CREATE TABLE active_effect_event_new (
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
    'recast',
    'presence-transition',
    'ended'
  )),
  detail_json TEXT NOT NULL,
  occurred_at TEXT NOT NULL,
  provenance TEXT NOT NULL,
  session_id TEXT NOT NULL,
  PRIMARY KEY (campaign_id, effect_id, seq)
);
INSERT INTO active_effect_event_new (
  campaign_id, effect_id, seq, event_kind, detail_json, occurred_at,
  provenance, session_id
)
SELECT campaign_id, effect_id, seq, event_kind, detail_json, occurred_at,
       provenance, session_id
FROM active_effect_event;
DROP TABLE active_effect_event;
ALTER TABLE active_effect_event_new RENAME TO active_effect_event;
