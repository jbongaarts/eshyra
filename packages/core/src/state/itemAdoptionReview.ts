import type { Db } from '../persistence/db.js';

export interface ItemAdoptionReview {
  readonly inventoryId: string;
  readonly requestedPackRef: string;
  readonly requestedVariantId?: string;
  readonly reviewKind: ItemAdoptionReviewKind;
  readonly reason: string;
  readonly rawPropertiesJson?: string;
  readonly rawItemStateJson?: string;
}

export type ItemAdoptionReviewKind =
  | 'legacy-marker'
  | 'malformed-evidence'
  | 'oversized-stack'
  | 'legacy-attunement'
  | 'legacy-counter';

export type ItemAdoptionResolutionAction =
  | 'discard-evidence'
  | 'set-reviewed-quantity'
  | 'discard-legacy-attunement'
  | 'discard-legacy-counter';

export type ItemAdoptionResolution =
  | {
      readonly action: 'set-reviewed-quantity';
      readonly evidence: string;
      readonly quantity: number;
    }
  | {
      readonly action: Exclude<
        ItemAdoptionResolutionAction,
        'set-reviewed-quantity'
      >;
      readonly evidence: string;
      readonly quantity?: never;
    };

export function requiredItemAdoptionResolutionAction(
  reviewKind: ItemAdoptionReviewKind,
): ItemAdoptionResolutionAction {
  switch (reviewKind) {
    case 'legacy-marker':
    case 'malformed-evidence':
      return 'discard-evidence';
    case 'oversized-stack':
      return 'set-reviewed-quantity';
    case 'legacy-attunement':
      return 'discard-legacy-attunement';
    case 'legacy-counter':
      return 'discard-legacy-counter';
  }
}

interface ItemAdoptionReviewRow {
  readonly inventory_id: string;
  readonly requested_pack_ref: string;
  readonly requested_variant_id: string | null;
  readonly review_kind: ItemAdoptionReviewKind;
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
    reviewKind: row.review_kind,
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
      `SELECT inventory_id, requested_pack_ref, requested_variant_id,
              review_kind, reason,
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
  readonly reviewKind: ItemAdoptionReviewKind;
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
       inventory_id, requested_pack_ref, requested_variant_id, review_kind, reason,
       raw_properties_json, raw_item_state_json, provenance, session_id,
       updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(inventory_id) DO UPDATE SET
       requested_pack_ref=excluded.requested_pack_ref,
       requested_variant_id=excluded.requested_variant_id,
       review_kind=excluded.review_kind,
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
    input.reviewKind,
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

export function recordItemAdoptionResolution(
  db: Db,
  input: {
    readonly inventoryId: string;
    readonly action: ItemAdoptionResolutionAction;
    readonly evidence: string;
    readonly previousReview: ItemAdoptionReview;
    readonly resultingPackRef: string;
    readonly resultingVariantId?: string;
    readonly reviewedQuantity?: number;
    readonly discardedStructureJson?: string;
    readonly provenance: string;
    readonly sessionId: string;
    readonly at: string;
  },
): void {
  const sequence = db
    .prepare(
      `SELECT COALESCE(MAX(seq), 0) + 1 AS seq
       FROM inventory_adoption_resolution WHERE inventory_id=?`,
    )
    .get(input.inventoryId) as { seq: number };
  db.prepare(
    `INSERT INTO inventory_adoption_resolution(
       inventory_id, seq, action, evidence, previous_reason,
       previous_review_kind,
       previous_requested_pack_ref, previous_requested_variant_id,
       resulting_pack_ref, resulting_variant_id, reviewed_quantity,
       discarded_structure_json, provenance, session_id, resolved_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    input.inventoryId,
    sequence.seq,
    input.action,
    input.evidence.trim(),
    input.previousReview.reason,
    input.previousReview.reviewKind,
    input.previousReview.requestedPackRef,
    input.previousReview.requestedVariantId ?? null,
    input.resultingPackRef,
    input.resultingVariantId ?? null,
    input.reviewedQuantity ?? null,
    input.discardedStructureJson ?? null,
    input.provenance,
    input.sessionId,
    input.at,
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
