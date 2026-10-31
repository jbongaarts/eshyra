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
  /** eshyra-olc5.15: the grant prints that its source item is destroyed when
   *  the creature is reduced to 0 hit points (Staff of the Python). Stored at
   *  bind time, like `cooldownAnchored`, so the ending needs no pack lookup. */
  readonly destroysSourceAtZeroHp?: boolean;
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

/** Live (active or suppressed) grant bindings of one inventory instance, as
 *  [campaignId, effectId] pairs in a stable order. */
export function liveItemGrantBindingEffects(
  db: Db,
  itemInstanceId: string,
): readonly { campaignId: string; effectId: string }[] {
  const rows = db
    .prepare(
      `SELECT campaign_id, effect_id, item_grant_json FROM active_effect
       WHERE status IN ('active', 'suppressed') AND item_grant_json IS NOT NULL
       ORDER BY campaign_id, effect_id`,
    )
    .all() as {
    campaign_id: string;
    effect_id: string;
    item_grant_json: string;
  }[];
  return rows
    .filter(
      (row) =>
        itemGrantColumn.decode(row.item_grant_json).itemInstanceId ===
        itemInstanceId,
    )
    .map((row) => ({ campaignId: row.campaign_id, effectId: row.effect_id }));
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
  // First write only: a receipt is durable evidence of one consumption, so an
  // instance id that already carries one is never overwritten (allocators skip
  // retired ids, see itemInstanceIdTaken).
  if (
    db
      .prepare(
        'SELECT 1 FROM item_consumption_receipt WHERE item_instance_id = ?',
      )
      .get(receipt.itemInstanceId) !== undefined
  )
    throw new Error(
      `item instance '${receipt.itemInstanceId}' already has a consumption receipt; a receipt is never replaced`,
    );
  db.prepare(
    `INSERT INTO item_consumption_receipt(
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

/**
 * Whether an inventory instance id is taken: by a live inventory row, or
 * retired by a consumption receipt, by any item-grant binding (live or ended)
 * that names it, or by a variant establishment record (eshyra-0xaq: that trace
 * outlives the row and attributes the variant to this id). A retired id stays the identity of its consumed or destroyed
 * source in receipts, effect views and the DM context, so it is never issued
 * to another item. Every inventory id allocator probes through this.
 */
export function itemInstanceIdTaken(db: Db, itemInstanceId: string): boolean {
  return (
    db.prepare('SELECT 1 FROM inventory WHERE id = ?').get(itemInstanceId) !==
      undefined || itemInstanceIdRetired(db, itemInstanceId)
  );
}

/** Whether an id is retired (see itemInstanceIdTaken), ignoring live rows. */
export function itemInstanceIdRetired(db: Db, itemInstanceId: string): boolean {
  return (
    db
      .prepare(
        `SELECT 1 WHERE EXISTS (
           SELECT 1 FROM item_consumption_receipt WHERE item_instance_id = ?
         ) OR EXISTS (
           SELECT 1 FROM active_effect
           WHERE item_grant_json IS NOT NULL
             AND json_extract(item_grant_json, '$.itemInstanceId') = ?
         ) OR EXISTS (
           SELECT 1 FROM item_variant_establishment WHERE inventory_id = ?
         )`,
      )
      .get(itemInstanceId, itemInstanceId, itemInstanceId) !== undefined
  );
}

/** The engine roll of a grant's printed `countRoll`, made when the use issued
 *  its bind credit and persisted on that credit (eshyra-olc5.14). */
export interface ItemGrantRolledCount {
  readonly grantId: string;
  readonly notation: string;
  /** Every die generated, in RNG draw order. */
  readonly rolls: readonly number[];
  readonly modifier: number;
  readonly total: number;
}

/** The engine roll of a grant's printed `creatureRoll` (a die roll on a
 *  table whose rows name the creatures), made when the use issued its bind
 *  credit and persisted on that credit (eshyra-olc5.16). */
export interface ItemGrantRolledCreature {
  readonly grantId: string;
  readonly notation: string;
  /** The table row rolled (1..N). */
  readonly roll: number;
  /** The creature ref of that row. */
  readonly creatureRef: string;
}

/** One use of an item that paid for a non-anchored entity grant (olc5.12.3). */
export interface ItemGrantBindCredit {
  readonly creditId: string;
  readonly campaignId: string;
  readonly itemInstanceId: string;
  readonly packRef: string;
  readonly variantId: string | undefined;
  readonly economyId: string;
  readonly operationId: string;
}

/** Issues one credit with the deterministic id <instance>:<operation>:<n>,
 *  the smallest free n. Called only from useItem's transaction. */
export function issueItemGrantBindCredit(
  db: Db,
  credit: Omit<ItemGrantBindCredit, 'creditId'> & {
    readonly issuedAt: string;
    readonly issuedElapsedMinutes: number;
    readonly provenance: string;
    readonly sessionId: string;
    /** Engine rolls of the credit's grants that print a `countRoll`. */
    readonly rolledCounts?: readonly ItemGrantRolledCount[];
    /** Engine rolls of the credit's grants that print a `creatureRoll`. */
    readonly rolledCreatures?: readonly ItemGrantRolledCreature[];
  },
): string {
  const prefix = `${credit.itemInstanceId}:${credit.operationId}:`;
  let n = 1;
  const exists = db.prepare(
    'SELECT 1 FROM item_grant_bind_credit WHERE credit_id = ?',
  );
  while (exists.get(`${prefix}${n}`) !== undefined) n += 1;
  const creditId = `${prefix}${n}`;
  db.prepare(
    `INSERT INTO item_grant_bind_credit(
       credit_id, campaign_id, item_instance_id, pack_ref, variant_id,
       economy_id, operation_id, issued_at, issued_elapsed_minutes,
       provenance, session_id, rolled_counts_json, rolled_creatures_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    creditId,
    credit.campaignId,
    credit.itemInstanceId,
    credit.packRef,
    credit.variantId ?? null,
    credit.economyId,
    credit.operationId,
    credit.issuedAt,
    credit.issuedElapsedMinutes,
    credit.provenance,
    credit.sessionId,
    credit.rolledCounts === undefined || credit.rolledCounts.length === 0
      ? null
      : JSON.stringify(credit.rolledCounts),
    credit.rolledCreatures === undefined || credit.rolledCreatures.length === 0
      ? null
      : JSON.stringify(credit.rolledCreatures),
  );
  return creditId;
}

/** The engine roll persisted on a credit for a grant, or undefined when the
 *  credit holds none (a credit issued before the roll existed, or one whose
 *  stored value is not a well-formed roll of this grant). Never throws: an
 *  unreadable value is "no recorded roll" and the bind is refused. */
export function readItemGrantRolledCount(
  db: Db,
  creditId: string,
  grantId: string,
): ItemGrantRolledCount | undefined {
  const row = db
    .prepare(
      'SELECT rolled_counts_json FROM item_grant_bind_credit WHERE credit_id = ?',
    )
    .get(creditId) as { rolled_counts_json: string | null } | undefined;
  if (row?.rolled_counts_json == null) return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(row.rolled_counts_json);
  } catch {
    return undefined;
  }
  if (!Array.isArray(parsed)) return undefined;
  const hit = parsed.find(
    (entry) =>
      typeof entry === 'object' &&
      entry !== null &&
      (entry as { grantId?: unknown }).grantId === grantId,
  ) as ItemGrantRolledCount | undefined;
  if (
    hit === undefined ||
    typeof hit.notation !== 'string' ||
    !Number.isInteger(hit.total) ||
    hit.total < 1
  )
    return undefined;
  return hit;
}

/** The engine-rolled creature persisted on a credit for a grant, or undefined
 *  when the credit holds none (a credit issued before the roll existed, or one
 *  whose stored value is not a well-formed roll of this grant). Never throws:
 *  an unreadable value is "no recorded roll" and the bind is refused. */
export function readItemGrantRolledCreature(
  db: Db,
  creditId: string,
  grantId: string,
): ItemGrantRolledCreature | undefined {
  const row = db
    .prepare(
      'SELECT rolled_creatures_json FROM item_grant_bind_credit WHERE credit_id = ?',
    )
    .get(creditId) as { rolled_creatures_json: string | null } | undefined;
  if (row?.rolled_creatures_json == null) return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(row.rolled_creatures_json);
  } catch {
    return undefined;
  }
  if (!Array.isArray(parsed)) return undefined;
  const hit = parsed.find(
    (entry) =>
      typeof entry === 'object' &&
      entry !== null &&
      (entry as { grantId?: unknown }).grantId === grantId,
  ) as ItemGrantRolledCreature | undefined;
  if (hit === undefined || typeof hit.notation !== 'string') return undefined;
  const sides = /^1d(\d+)$/.exec(
    hit.notation.replace(/\s+/g, '').toLowerCase(),
  );
  if (
    sides === null ||
    !Number.isInteger(hit.roll) ||
    hit.roll < 1 ||
    hit.roll > Number(sides[1]) ||
    typeof hit.creatureRef !== 'string' ||
    hit.creatureRef === ''
  )
    return undefined;
  return hit;
}

/** The oldest unredeemed credit (issued_at, then insertion order, which
 *  orders n=10 after n=9 where credit_id text would not) for this
 *  campaign, instance, pack record, variant and economy. */
export function oldestOpenItemGrantBindCredit(
  db: Db,
  scope: {
    readonly campaignId: string;
    readonly itemInstanceId: string;
    readonly packRef: string;
    readonly variantId: string | undefined;
    readonly economyId: string;
  },
): string | undefined {
  const row = db
    .prepare(
      `SELECT credit_id FROM item_grant_bind_credit
       WHERE campaign_id = ? AND item_instance_id = ? AND economy_id = ?
         AND pack_ref = ? AND variant_id IS ? AND redeemed_effect_id IS NULL
       ORDER BY issued_at, rowid LIMIT 1`,
    )
    .get(
      scope.campaignId,
      scope.itemInstanceId,
      scope.economyId,
      scope.packRef,
      scope.variantId ?? null,
    ) as { credit_id: string } | undefined;
  return row?.credit_id;
}

/** Whether `creditId` is an unredeemed credit of exactly this campaign,
 *  instance, pack record, variant and economy (an explicitly named credit,
 *  eshyra-olc5.14). */
export function itemGrantBindCreditOpenInScope(
  db: Db,
  creditId: string,
  scope: {
    readonly campaignId: string;
    readonly itemInstanceId: string;
    readonly packRef: string;
    readonly variantId: string | undefined;
    readonly economyId: string;
  },
): boolean {
  return (
    db
      .prepare(
        `SELECT 1 FROM item_grant_bind_credit
         WHERE credit_id = ? AND campaign_id = ? AND item_instance_id = ?
           AND economy_id = ? AND pack_ref = ? AND variant_id IS ?
           AND redeemed_effect_id IS NULL`,
      )
      .get(
        creditId,
        scope.campaignId,
        scope.itemInstanceId,
        scope.economyId,
        scope.packRef,
        scope.variantId ?? null,
      ) !== undefined
  );
}

export function redeemItemGrantBindCredit(
  db: Db,
  creditId: string,
  effectId: string,
  at: string,
): void {
  const result = db
    .prepare(
      `UPDATE item_grant_bind_credit SET redeemed_effect_id = ?, redeemed_at = ?
       WHERE credit_id = ? AND redeemed_effect_id IS NULL`,
    )
    .run(effectId, at, creditId);
  if (result.changes !== 1)
    throw new Error(`bind credit '${creditId}' was already redeemed`);
}

/** Voids (deletes) the unredeemed bind credits of an instance being destroyed:
 *  a credit pays for a bind against that live item only, and a later item may
 *  legitimately reuse the id (a credit does not retire it). Redeemed credits
 *  stay as evidence; their effects' bindings retire the id themselves. */
export function voidOpenItemGrantBindCredits(
  db: Db,
  itemInstanceId: string,
): number {
  return db
    .prepare(
      'DELETE FROM item_grant_bind_credit WHERE item_instance_id = ? AND redeemed_effect_id IS NULL',
    )
    .run(itemInstanceId).changes;
}
