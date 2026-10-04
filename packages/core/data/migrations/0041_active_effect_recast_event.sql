-- eshyra-s02z: the active-effect audit ledger gains the 'recast' event kind
-- (recast_bonded_summon: Find Familiar / Find Steed restoring an absent
-- bonded creature). SQLite cannot alter a CHECK constraint, so the table is
-- rebuilt with the widened kind list; existing rows are copied unchanged.
PRAGMA defer_foreign_keys = ON;

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
