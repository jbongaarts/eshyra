CREATE TABLE retained_check (
  campaign_id TEXT NOT NULL,
  retained_check_id TEXT NOT NULL,
  label TEXT NOT NULL,
  participant_kind TEXT CHECK (participant_kind IN ('character', 'combatant')),
  participant_ref TEXT,
  combat_instance_id TEXT,
  dice TEXT NOT NULL,
  rolls_json TEXT NOT NULL,
  natural INTEGER NOT NULL,
  modifier_total INTEGER NOT NULL,
  total INTEGER NOT NULL,
  visibility TEXT NOT NULL CHECK (visibility IN ('player_visible', 'dm_only')),
  status TEXT NOT NULL CHECK (status IN ('active', 'ended')),
  end_reason TEXT,
  provenance TEXT NOT NULL,
  session_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  ended_at TEXT,
  PRIMARY KEY (campaign_id, retained_check_id),
  CHECK ((participant_kind IS NULL) = (participant_ref IS NULL)),
  CHECK ((status = 'active' AND ended_at IS NULL AND end_reason IS NULL)
      OR (status = 'ended' AND ended_at IS NOT NULL AND end_reason IS NOT NULL))
);

CREATE INDEX retained_check_campaign_status
  ON retained_check(campaign_id, status);

CREATE TABLE retained_check_comparison (
  campaign_id TEXT NOT NULL,
  comparison_id TEXT NOT NULL,
  retained_check_id TEXT NOT NULL,
  mode TEXT NOT NULL CHECK (mode IN ('search', 'passive')),
  observer_label TEXT NOT NULL,
  observer_kind TEXT CHECK (observer_kind IN ('character', 'combatant')),
  observer_ref TEXT,
  observer_total INTEGER NOT NULL,
  noticed INTEGER NOT NULL CHECK (noticed IN (0, 1)),
  resolution_json TEXT NOT NULL,
  provenance TEXT NOT NULL,
  session_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (campaign_id, comparison_id),
  FOREIGN KEY (campaign_id, retained_check_id)
    REFERENCES retained_check(campaign_id, retained_check_id),
  CHECK ((observer_kind IS NULL) = (observer_ref IS NULL))
);

CREATE INDEX retained_check_comparison_retained
  ON retained_check_comparison(campaign_id, retained_check_id, mode);
