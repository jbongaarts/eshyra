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
