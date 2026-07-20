-- Reclassify legacy oversized-stack reviews that are no longer oversized.
-- Preserve the original reason and quarantined evidence for GM review.

UPDATE inventory_adoption_review
SET review_kind = 'malformed-evidence',
    reason = reason || ' [reclassified by 0023: inventory quantity <= 100]'
WHERE review_kind = 'oversized-stack'
  AND EXISTS (
    SELECT 1
    FROM inventory
    WHERE inventory.id = inventory_adoption_review.inventory_id
      AND inventory.quantity <= 100
  );
