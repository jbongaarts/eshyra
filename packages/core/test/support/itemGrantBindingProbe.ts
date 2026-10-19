import type { Db } from '../../src/persistence/db.js';
import { itemGrantColumn } from '../../src/state/itemGrantBinding.js';

/** The decoded item-grant binding stored on one effect (test probe). */
export function readItemGrantBindingForTest(db: Db, effectId: string) {
  const row = db
    .prepare('SELECT item_grant_json FROM active_effect WHERE effect_id = ?')
    .get(effectId) as { item_grant_json: string | null } | undefined;
  return row?.item_grant_json == null
    ? undefined
    : itemGrantColumn.decode(row.item_grant_json);
}
