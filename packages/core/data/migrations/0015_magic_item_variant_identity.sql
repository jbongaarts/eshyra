-- Migration 0015: canonical identity for a selected inline magic-item variant.
-- NULL means the resolved magic-item record declares no variants.

ALTER TABLE inventory ADD COLUMN variant_id TEXT
  CHECK (
    variant_id IS NULL OR
    pack_ref IS NOT NULL AND
    variant_id GLOB '[a-z0-9]*' AND
    variant_id NOT GLOB '*[^a-z0-9-]*' AND
    variant_id NOT GLOB '*--*' AND
    variant_id NOT GLOB '-*' AND
    variant_id NOT GLOB '*-'
  );
