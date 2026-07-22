-- Canonical S3 spatial-zone and C1 transformation-form projections.
CREATE TABLE active_effect_link_new (
  campaign_id TEXT NOT NULL, effect_id TEXT NOT NULL,
  link_kind TEXT NOT NULL CHECK (link_kind IN ('condition','actor','zone','form')),
  target_kind TEXT NOT NULL CHECK (target_kind IN ('character','combatant','campaign_actor','scope')),
  target_ref TEXT NOT NULL, projection_ref TEXT NOT NULL, campaign_actor_id TEXT,
  cleanup_on_end TEXT NOT NULL DEFAULT 'remove' CHECK (cleanup_on_end IN ('remove','release')),
  cleanup_on_break TEXT NOT NULL DEFAULT 'remove' CHECK (cleanup_on_break IN ('remove','release')),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','removed','released')),
  removed_reason TEXT, removed_at TEXT, provenance TEXT NOT NULL,
  session_id TEXT NOT NULL, updated_at TEXT NOT NULL,
  PRIMARY KEY (campaign_id,effect_id,link_kind,target_kind,target_ref,projection_ref),
  CHECK ((link_kind = 'zone' AND target_kind = 'scope')
         OR (link_kind != 'zone' AND target_kind != 'scope')),
  CHECK (link_kind NOT IN ('zone','form')
         OR (cleanup_on_end = 'remove' AND cleanup_on_break = 'remove')),
  CHECK (status = 'active' OR (removed_reason IS NOT NULL AND removed_at IS NOT NULL)),
  CHECK (status != 'active' OR (removed_reason IS NULL AND removed_at IS NULL))
);
INSERT INTO active_effect_link_new SELECT * FROM active_effect_link;
DROP TABLE active_effect_link;
ALTER TABLE active_effect_link_new RENAME TO active_effect_link;
CREATE INDEX active_effect_link_target ON active_effect_link(campaign_id,target_kind,target_ref);

CREATE TABLE effect_spatial_zone (
  campaign_id TEXT NOT NULL, zone_id TEXT NOT NULL, scope_ref TEXT NOT NULL,
  shape TEXT NOT NULL CHECK (shape IN ('sphere','cube','cylinder','cone','line')),
  size_feet INTEGER NOT NULL CHECK (size_feet >= 1), provenance TEXT NOT NULL,
  session_id TEXT NOT NULL, updated_at TEXT NOT NULL,
  PRIMARY KEY (campaign_id, zone_id)
);
CREATE TABLE effect_transformation_form (
  campaign_id TEXT NOT NULL,
  target_kind TEXT NOT NULL CHECK (target_kind IN ('character','combatant','campaign_actor')),
  target_ref TEXT NOT NULL, form_ref TEXT NOT NULL, provenance TEXT NOT NULL,
  session_id TEXT NOT NULL, updated_at TEXT NOT NULL,
  PRIMARY KEY (campaign_id, target_kind, target_ref)
);
