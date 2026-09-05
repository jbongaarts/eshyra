-- Stable campaign-wide chronology anchors for replayable turns.
CREATE TABLE campaign_turn_position (
  campaign_id TEXT NOT NULL,
  session_id TEXT NOT NULL,
  turn_id TEXT NOT NULL,
  ordinal INTEGER NOT NULL CHECK (ordinal > 0),
  PRIMARY KEY (campaign_id, session_id, turn_id),
  UNIQUE (campaign_id, ordinal)
);
CREATE INDEX campaign_turn_position_ordinal
  ON campaign_turn_position(campaign_id, ordinal);
