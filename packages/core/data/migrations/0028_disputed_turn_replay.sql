-- One bounded recovery snapshot per campaign; no recursive snapshot history.
CREATE TABLE turn_replay (
  campaign_id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  turn_id TEXT NOT NULL,
  input_json TEXT NOT NULL,
  before_json TEXT NOT NULL,
  state_hash TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('available', 'pending', 'replayed'))
);
-- Abandoned adjudications are diagnostics, never continuing scene/turn canon.
CREATE TABLE turn_replay_diagnostic (
  campaign_id TEXT NOT NULL,
  session_id TEXT NOT NULL,
  turn_id TEXT NOT NULL,
  original_trace_json TEXT NOT NULL,
  rule_identity TEXT NOT NULL,
  PRIMARY KEY (campaign_id, session_id, turn_id)
);
