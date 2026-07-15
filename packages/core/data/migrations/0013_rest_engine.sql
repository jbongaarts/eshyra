-- F7: structured world time, hit dice, and durable rest events.
ALTER TABLE clock ADD COLUMN elapsed_minutes INTEGER NOT NULL DEFAULT 0
  CHECK (elapsed_minutes >= 0);

ALTER TABLE active_effect ADD COLUMN anchor_elapsed_minutes INTEGER
  CHECK (anchor_elapsed_minutes IS NULL OR anchor_elapsed_minutes >= 0);
ALTER TABLE active_effect ADD COLUMN deadline_elapsed_minutes INTEGER
  CHECK (deadline_elapsed_minutes IS NULL OR deadline_elapsed_minutes >= anchor_elapsed_minutes);

-- Transition policy: structured world time starts at elapsed minute zero when
-- this migration is applied. Existing live world-time effects receive their
-- full declared duration from that transition point. Round and trigger/
-- dismissal/removed effects remain unbackfilled because their clocks are not
-- elapsed-world clocks.
UPDATE active_effect
SET anchor_elapsed_minutes = 0,
    deadline_elapsed_minutes = duration_amount * CASE duration_unit
      WHEN 'minute' THEN 1
      WHEN 'hour' THEN 60
      WHEN 'day' THEN 1440
    END
WHERE status IN ('active', 'suppressed')
  AND duration_kind = 'timed'
  AND duration_unit IN ('minute', 'hour', 'day');

CREATE TABLE character_hit_dice (
  character_id TEXT PRIMARY KEY REFERENCES character(id),
  die_faces INTEGER NOT NULL CHECK (die_faces IN (6, 8, 10, 12)),
  dice_maximum INTEGER NOT NULL CHECK (dice_maximum >= 1),
  dice_used INTEGER NOT NULL DEFAULT 0 CHECK (dice_used BETWEEN 0 AND dice_maximum),
  provenance TEXT NOT NULL,
  session_id TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE rest_event (
  campaign_id TEXT NOT NULL,
  rest_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('short', 'long')),
  start_elapsed_minutes INTEGER NOT NULL CHECK (start_elapsed_minutes >= 0),
  end_elapsed_minutes INTEGER NOT NULL CHECK (end_elapsed_minutes >= start_elapsed_minutes),
  declared_duration_minutes INTEGER NOT NULL CHECK (declared_duration_minutes >= 0),
  qualification_json TEXT NOT NULL,
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

CREATE INDEX rest_event_long_benefit_time ON rest_event(campaign_id, kind, end_elapsed_minutes);
