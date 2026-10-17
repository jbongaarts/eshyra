-- eshyra-olc5.12.3: a completed use_item that charges an item's cooldown
-- economy while a non-anchored entity grant names that economy issues one bind
-- credit. start_effect redeems the oldest unredeemed credit of the same
-- campaign, instance and economy when it binds such a grant, so a grant is
-- never bound without the spend that paid for it. Anchored grants and consumed
-- instances keep their own coupling (the economy state and the consumption
-- receipt). credit_id is deterministic: <instance>:<operation>:<n>.
CREATE TABLE item_grant_bind_credit (
  credit_id TEXT PRIMARY KEY,
  campaign_id TEXT NOT NULL,
  item_instance_id TEXT NOT NULL,
  pack_ref TEXT NOT NULL,
  variant_id TEXT,
  economy_id TEXT NOT NULL,
  operation_id TEXT NOT NULL,
  issued_at TEXT NOT NULL,
  issued_elapsed_minutes INTEGER,
  redeemed_effect_id TEXT,
  redeemed_at TEXT,
  provenance TEXT NOT NULL,
  session_id TEXT NOT NULL
);

CREATE INDEX item_grant_bind_credit_open
  ON item_grant_bind_credit(campaign_id, item_instance_id, economy_id)
  WHERE redeemed_effect_id IS NULL;
