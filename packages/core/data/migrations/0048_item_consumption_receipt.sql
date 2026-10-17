-- eshyra-olc5.12.13: one-time receipt for an item instance whose printed
-- activation consumed it (a last-unit spend or onDepleted destroyed) while its
-- effective mechanics declare an entity grant. The row is deleted with the
-- inventory instance, so the receipt is the only durable evidence that lets
-- start_effect bind the grant the consumption paid for. It is redeemed once.
CREATE TABLE item_consumption_receipt (
  campaign_id TEXT NOT NULL,
  item_instance_id TEXT PRIMARY KEY,
  pack_ref TEXT NOT NULL,
  variant_id TEXT,
  operation_id TEXT NOT NULL,
  consumed_at TEXT NOT NULL,
  consumed_elapsed_minutes INTEGER,
  redeemed_effect_id TEXT,
  redeemed_at TEXT,
  provenance TEXT NOT NULL,
  session_id TEXT NOT NULL
);
