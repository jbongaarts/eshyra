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

-- A retired instance id (named by a receipt or by any item-grant binding while
-- no inventory row holds it) is the durable identity of a consumed or destroyed
-- source; it is never issued to another item. Allocators skip retired ids; this
-- trigger is the backstop for every other insert path. Upserts onto a live row
-- are unaffected.
CREATE TRIGGER inventory_refuse_retired_instance_id
BEFORE INSERT ON inventory
WHEN NOT EXISTS (SELECT 1 FROM inventory WHERE id = NEW.id)
  AND (
    EXISTS (
      SELECT 1 FROM item_consumption_receipt
      WHERE item_instance_id = NEW.id
    )
    OR EXISTS (
      SELECT 1 FROM active_effect
      WHERE item_grant_json IS NOT NULL
        AND json_extract(item_grant_json, '$.itemInstanceId') = NEW.id
    )
  )
BEGIN
  SELECT RAISE(ABORT, 'inventory id is retired: a consumption receipt or item grant still names it');
END;
