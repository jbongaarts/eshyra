CREATE TABLE ammunition_expenditure (
  campaign_id TEXT NOT NULL,
  expenditure_id TEXT NOT NULL,
  combat_instance_id TEXT NOT NULL,
  character_id TEXT NOT NULL,
  source_inventory_id TEXT NOT NULL,
  expended_inventory_id TEXT NOT NULL,
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  world_location_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('expended', 'resolved')),
  provenance TEXT NOT NULL,
  session_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  resolved_at TEXT,
  PRIMARY KEY (campaign_id, expenditure_id)
);

CREATE INDEX ammunition_expenditure_combat_character
  ON ammunition_expenditure(campaign_id, combat_instance_id, character_id);
