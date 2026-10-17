import type { Db } from '../persistence/db.js';
import { jsonColumn } from '../persistence/jsonColumn.js';

/** The item instance and printed grant a summoning effect was bound to (olc5.12). */
export interface ItemGrantBindingRecord {
  readonly grantId: string;
  readonly itemInstanceId: string;
  readonly packRef: string;
  /** 'as spell:<id>': the spell whose lifetime the summoned creature follows (S2). */
  readonly spellRef?: string;
  /** Whether an item cooldown economy is anchored to this grant's end (S7: lets
   *  unanchored grants end without resolving the item's rules). */
  readonly cooldownAnchored?: boolean;
  /** S11 tombstone: the ISO time the bound inventory instance was destroyed.
   *  A tombstoned binding ends normally but schedules no cooldown (there is no
   *  item to cool down), and no reader may require the deleted inventory row
   *  or resolve the item's pack record for it. Absent on a live source, so
   *  older stored bindings decode unchanged. */
  readonly sourceDestroyedAt?: string;
}

export const itemGrantColumn = jsonColumn<ItemGrantBindingRecord>(
  'active_effect.item_grant_json',
);

/**
 * Marks every live (active or suppressed) effect bound to this inventory
 * instance as source-destroyed. Called inside destroyInventoryItem, the single
 * choke point of inventory destruction, so a destroyed source never strands a
 * grant that can no longer end. Idempotent.
 */
export function tombstoneItemGrantBindings(
  db: Db,
  itemInstanceId: string,
  at: string,
): number {
  const rows = db
    .prepare(
      `SELECT campaign_id, effect_id, item_grant_json FROM active_effect
       WHERE status IN ('active', 'suppressed') AND item_grant_json IS NOT NULL`,
    )
    .all() as {
    campaign_id: string;
    effect_id: string;
    item_grant_json: string;
  }[];
  const update = db.prepare(
    'UPDATE active_effect SET item_grant_json = ? WHERE campaign_id = ? AND effect_id = ?',
  );
  let marked = 0;
  for (const row of rows) {
    const binding = itemGrantColumn.decode(row.item_grant_json);
    if (
      binding.itemInstanceId !== itemInstanceId ||
      binding.sourceDestroyedAt !== undefined
    )
      continue;
    update.run(
      itemGrantColumn.encode({ ...binding, sourceDestroyedAt: at }),
      row.campaign_id,
      row.effect_id,
    );
    marked += 1;
  }
  return marked;
}

/**
 * A one-time receipt for an item instance whose printed activation consumed it
 * (last-unit spend or onDepleted destroyed) while its effective mechanics
 * declare an entity grant. Written only by useItem's consumption path; every
 * other destruction route (remove_item, ammunition, item-reset) writes none, so
 * destroying an item never pays for a grant. Scoped to the campaign of the use
 * (the same campaignId useItem scopes attunement by).
 */
export interface ItemConsumptionReceipt {
  readonly campaignId: string;
  readonly itemInstanceId: string;
  readonly packRef: string;
  readonly variantId: string | undefined;
  readonly operationId: string;
  readonly consumedAt: string;
  readonly redeemedEffectId: string | undefined;
}

interface ReceiptRow {
  campaign_id: string;
  item_instance_id: string;
  pack_ref: string;
  variant_id: string | null;
  operation_id: string;
  consumed_at: string;
  redeemed_effect_id: string | null;
}

export function writeItemConsumptionReceipt(
  db: Db,
  receipt: {
    readonly campaignId: string;
    readonly itemInstanceId: string;
    readonly packRef: string;
    readonly variantId: string | undefined;
    readonly operationId: string;
    readonly consumedAt: string;
    readonly consumedElapsedMinutes: number;
    readonly provenance: string;
    readonly sessionId: string;
  },
): void {
  db.prepare(
    `INSERT OR REPLACE INTO item_consumption_receipt(
       campaign_id, item_instance_id, pack_ref, variant_id, operation_id,
       consumed_at, consumed_elapsed_minutes, provenance, session_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    receipt.campaignId,
    receipt.itemInstanceId,
    receipt.packRef,
    receipt.variantId ?? null,
    receipt.operationId,
    receipt.consumedAt,
    receipt.consumedElapsedMinutes,
    receipt.provenance,
    receipt.sessionId,
  );
}

export function readItemConsumptionReceipt(
  db: Db,
  itemInstanceId: string,
): ItemConsumptionReceipt | undefined {
  const row = db
    .prepare(
      `SELECT campaign_id, item_instance_id, pack_ref, variant_id, operation_id,
              consumed_at, redeemed_effect_id
       FROM item_consumption_receipt WHERE item_instance_id = ?`,
    )
    .get(itemInstanceId) as ReceiptRow | undefined;
  return row === undefined
    ? undefined
    : {
        campaignId: row.campaign_id,
        itemInstanceId: row.item_instance_id,
        packRef: row.pack_ref,
        variantId: row.variant_id ?? undefined,
        operationId: row.operation_id,
        consumedAt: row.consumed_at,
        redeemedEffectId: row.redeemed_effect_id ?? undefined,
      };
}

export function redeemItemConsumptionReceipt(
  db: Db,
  itemInstanceId: string,
  effectId: string,
  at: string,
): void {
  const result = db
    .prepare(
      `UPDATE item_consumption_receipt SET redeemed_effect_id = ?, redeemed_at = ?
       WHERE item_instance_id = ? AND redeemed_effect_id IS NULL`,
    )
    .run(effectId, at, itemInstanceId);
  if (result.changes !== 1)
    throw new Error(
      `consumption receipt for '${itemInstanceId}' was already redeemed`,
    );
}
