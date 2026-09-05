-- Durable campaign-owned rulings and house rules.  The campaign rule domain
-- remains prose-only; this table stores its lossless provenance and timing.
CREATE TABLE campaign_rule (
  campaign_id TEXT NOT NULL,
  rule_identity TEXT NOT NULL,
  rule_kind TEXT NOT NULL CHECK (rule_kind IN ('ruling','house-rule')),
  status TEXT NOT NULL CHECK (status IN ('active','revoked','superseded')),
  origin TEXT NOT NULL CHECK (origin IN ('player-authored','player-approved','oracle-supplied')),
  provenance_kind TEXT NOT NULL CHECK (provenance_kind IN ('ambiguity','recurring-question','house-rule')),
  ambiguity_id TEXT,
  selected_interpretation_id TEXT,
  question_id TEXT,
  rationale TEXT,
  effective_position TEXT NOT NULL,
  temporal_mode TEXT NOT NULL CHECK (temporal_mode IN ('prospective','disputed-turn')),
  disputed_position TEXT,
  superseded_by TEXT,
  revoked_position TEXT,
  scope TEXT NOT NULL,
  governing_record_keys_json TEXT NOT NULL,
  prose TEXT NOT NULL,
  provenance TEXT NOT NULL,
  session_id TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (campaign_id, rule_identity),
  CHECK ((provenance_kind = 'ambiguity' AND ambiguity_id IS NOT NULL AND selected_interpretation_id IS NOT NULL AND question_id IS NULL AND rationale IS NULL)
      OR (provenance_kind = 'recurring-question' AND question_id IS NOT NULL AND ambiguity_id IS NULL AND selected_interpretation_id IS NULL AND rationale IS NULL)
      OR (provenance_kind = 'house-rule' AND ambiguity_id IS NULL AND selected_interpretation_id IS NULL AND question_id IS NULL)),
  CHECK ((temporal_mode = 'prospective' AND disputed_position IS NULL)
      OR (temporal_mode = 'disputed-turn' AND disputed_position IS NOT NULL)),
  CHECK ((status = 'superseded' AND superseded_by IS NOT NULL)
      OR (status != 'superseded' AND superseded_by IS NULL)),
  CHECK (status != 'revoked' OR revoked_position IS NOT NULL)
);
CREATE INDEX campaign_rule_effective_position
  ON campaign_rule(campaign_id, effective_position, rule_identity);
CREATE INDEX campaign_rule_status_position
  ON campaign_rule(campaign_id, status, effective_position, rule_identity);
CREATE INDEX campaign_rule_ambiguity
  ON campaign_rule(campaign_id, provenance_kind, ambiguity_id, effective_position, rule_identity);
