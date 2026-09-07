-- Durable A3 evidence of the active campaign rules supplied for accepted turns.
ALTER TABLE turn_trace ADD COLUMN campaign_rules_evidence TEXT;
