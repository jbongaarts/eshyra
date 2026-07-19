import type { Db } from '../persistence/db.js';

export interface ItemAdoptionReview {
  readonly inventoryId: string;
  readonly requestedPackRef: string;
  readonly requestedVariantId?: string;
  readonly reason: string;
  readonly rawPropertiesJson?: string;
  readonly rawItemStateJson?: string;
}

interface ItemAdoptionReviewRow {
  readonly inventory_id: string;
  readonly requested_pack_ref: string;
  readonly requested_variant_id: string | null;
  readonly reason: string;
  readonly raw_properties_json: string | null;
  readonly raw_item_state_json: string | null;
}

function rowToReview(row: ItemAdoptionReviewRow): ItemAdoptionReview {
  return {
    inventoryId: row.inventory_id,
    requestedPackRef: row.requested_pack_ref,
    ...(row.requested_variant_id === null
      ? {}
      : { requestedVariantId: row.requested_variant_id }),
    reason: row.reason,
    ...(row.raw_properties_json === null
      ? {}
      : { rawPropertiesJson: row.raw_properties_json }),
    ...(row.raw_item_state_json === null
      ? {}
      : { rawItemStateJson: row.raw_item_state_json }),
  };
}

export function readItemAdoptionReview(
  db: Db,
  inventoryId: string,
): ItemAdoptionReview | undefined {
  const row = db
    .prepare(
      `SELECT inventory_id, requested_pack_ref, requested_variant_id, reason,
              raw_properties_json, raw_item_state_json
       FROM inventory_adoption_review WHERE inventory_id=?`,
    )
    .get(inventoryId) as ItemAdoptionReviewRow | undefined;
  return row === undefined ? undefined : rowToReview(row);
}

export interface WriteItemAdoptionReviewInput {
  readonly inventoryId: string;
  readonly requestedPackRef: string;
  readonly requestedVariantId?: string;
  readonly reason: string;
  readonly rawPropertiesJson?: string;
  readonly rawItemStateJson?: string;
  readonly provenance: string;
  readonly sessionId: string;
  readonly at: string;
}

export function writeItemAdoptionReview(
  db: Db,
  input: WriteItemAdoptionReviewInput,
): void {
  const existing = readItemAdoptionReview(db, input.inventoryId);
  db.prepare(
    `INSERT INTO inventory_adoption_review(
       inventory_id, requested_pack_ref, requested_variant_id, reason,
       raw_properties_json, raw_item_state_json, provenance, session_id,
       updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(inventory_id) DO UPDATE SET
       requested_pack_ref=excluded.requested_pack_ref,
       requested_variant_id=excluded.requested_variant_id,
       reason=excluded.reason,
       raw_properties_json=excluded.raw_properties_json,
       raw_item_state_json=excluded.raw_item_state_json,
       provenance=excluded.provenance,
       session_id=excluded.session_id,
       updated_at=excluded.updated_at`,
  ).run(
    input.inventoryId,
    input.requestedPackRef,
    input.requestedVariantId ?? null,
    input.reason,
    input.rawPropertiesJson ?? existing?.rawPropertiesJson ?? null,
    input.rawItemStateJson ?? existing?.rawItemStateJson ?? null,
    input.provenance,
    input.sessionId,
    input.at,
  );
}

export function clearItemAdoptionReview(db: Db, inventoryId: string): void {
  db.prepare('DELETE FROM inventory_adoption_review WHERE inventory_id=?').run(
    inventoryId,
  );
}

export function itemAdoptionReviewBlockMessage(
  db: Db,
  inventoryId: string,
  operation: string,
): string | undefined {
  const review = readItemAdoptionReview(db, inventoryId);
  if (review === undefined) return undefined;
  return `inventory item '${inventoryId}' is quarantined for GM adoption review (${review.requestedPackRef}: ${review.reason}); '${operation}' cannot mutate its identity, custody, attunement, or live state until adopt_item explicitly resolves the review`;
}
