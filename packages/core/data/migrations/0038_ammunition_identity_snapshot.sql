ALTER TABLE ammunition_expenditure ADD COLUMN name TEXT;
ALTER TABLE ammunition_expenditure ADD COLUMN pack_ref TEXT;
ALTER TABLE ammunition_expenditure ADD COLUMN variant_id TEXT;
ALTER TABLE ammunition_expenditure ADD COLUMN properties_json TEXT;

UPDATE ammunition_expenditure
SET name = (SELECT name FROM inventory WHERE id = expended_inventory_id),
    pack_ref = (SELECT pack_ref FROM inventory WHERE id = expended_inventory_id),
    variant_id = (SELECT variant_id FROM inventory WHERE id = expended_inventory_id),
    properties_json = (
      SELECT properties_json FROM inventory WHERE id = expended_inventory_id
    )
WHERE EXISTS (
  SELECT 1 FROM inventory WHERE id = expended_inventory_id
);
