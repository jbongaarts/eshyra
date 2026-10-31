-- eshyra-0xaq.2: the one-time establishment of the variant of a held row that
-- is already bound to its canonical pack ref but was held with no variant (for
-- example a Horn of Valhalla held before its type variants existed). adopt_item
-- writes this row in the same transaction that sets the row's variant_id from
-- NULL. The primary key on inventory_id makes the establishment once-only at
-- the database level; the row is never updated or deleted by the code, and it
-- outlives the inventory row as durable evidence of who set the identity.
CREATE TABLE item_variant_establishment (
  inventory_id TEXT PRIMARY KEY,
  campaign_id TEXT NOT NULL,
  pack_ref TEXT NOT NULL CHECK (pack_ref GLOB 'magic-item:*'),
  variant_id TEXT NOT NULL,
  established_at TEXT NOT NULL,
  provenance TEXT NOT NULL,
  session_id TEXT NOT NULL
);
