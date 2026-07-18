import type { Db } from '../persistence/db.js';
import { withTransaction } from '../persistence/db.js';
import type { AttunementEntry } from './attunement.js';

export interface InventoryDestructionContext {
  readonly provenance: string;
  readonly sessionId: string;
  readonly at: string;
}

export interface DestroyedItemAttunementEvidence {
  readonly ended: AttunementEntry;
  readonly reason: 'item_destroyed';
  readonly provenance: string;
  readonly sessionId: string;
  readonly endedAt: string;
}

export interface DestroyInventoryItemResult {
  readonly destroyed: boolean;
  readonly attunementsEnded: readonly DestroyedItemAttunementEvidence[];
}

interface AttunementRow {
  readonly character_id: string;
  readonly item_id: string;
  readonly item_key: string;
  readonly display_name: string;
  readonly attuned_at: string;
}

/**
 * Deletes an inventory instance and releases every bond to that physical item
 * in one transaction. The returned ending evidence uses the same canonical
 * `item_destroyed` reason accepted by the attunement mutation boundary.
 */
export function destroyInventoryItem(
  db: Db,
  itemId: string,
  ctx: InventoryDestructionContext,
): DestroyInventoryItemResult {
  return withTransaction(db, (txnDb) => {
    const exists = txnDb
      .prepare('SELECT 1 FROM inventory WHERE id = ?')
      .get(itemId);
    if (exists === undefined) return { destroyed: false, attunementsEnded: [] };

    const rows = txnDb
      .prepare(
        `SELECT character_id, item_id, item_key, display_name, attuned_at
         FROM attunement
         WHERE item_id = ?
         ORDER BY campaign_id, character_id`,
      )
      .all(itemId) as AttunementRow[];
    txnDb.prepare('DELETE FROM attunement WHERE item_id = ?').run(itemId);
    const deleted = txnDb
      .prepare('DELETE FROM inventory WHERE id = ?')
      .run(itemId);
    if (deleted.changes !== 1)
      throw new Error(`inventory item '${itemId}' disappeared during deletion`);

    return {
      destroyed: true,
      attunementsEnded: rows.map((row) => ({
        ended: {
          characterId: row.character_id,
          itemId: row.item_id,
          itemKey: row.item_key,
          displayName: row.display_name,
          attunedAt: row.attuned_at,
        },
        reason: 'item_destroyed',
        provenance: ctx.provenance,
        sessionId: ctx.sessionId,
        endedAt: ctx.at,
      })),
    };
  });
}
