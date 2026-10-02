import type { Db } from '../persistence/db.js';
import { withTransaction } from '../persistence/db.js';
import { resolveCharacterId } from './activeCharacter.js';
import { claimItem, removeItem } from './domainMutations.js';
import { destroyInventoryItem } from './inventoryLifecycle.js';
import {
  InventoryWorldLocationError,
  requireCurrentWorldLocation,
} from './inventoryWorldLocation.js';

export class AmmunitionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AmmunitionError';
  }
}

function currentWorldLocation(db: Db): string {
  try {
    return requireCurrentWorldLocation(db);
  } catch (error) {
    if (error instanceof InventoryWorldLocationError)
      throw new AmmunitionError(error.message);
    throw error;
  }
}

export interface AmmunitionMutationContext {
  readonly campaignId: string;
  readonly characterId?: string;
  readonly provenance: string;
  readonly sessionId: string;
  readonly at: string;
}

export interface ExpendAmmunitionInput {
  readonly itemId: string;
  readonly quantity?: number;
}

export function expendAmmunition(
  db: Db,
  input: ExpendAmmunitionInput,
  ctx: AmmunitionMutationContext,
): {
  combatInstanceId: string;
  expenditureId: string;
  expendedInventoryId: string;
  quantity: number;
} {
  if (!input.itemId)
    throw new AmmunitionError('itemId must be a non-empty string');
  const quantity = input.quantity ?? 1;
  if (!Number.isInteger(quantity) || quantity < 1)
    throw new AmmunitionError('quantity must be a positive integer');
  return withTransaction(db, (txnDb) => {
    const combat = txnDb
      .prepare(
        `SELECT combat_instance_id, location_id FROM combat_instance
       WHERE campaign_id=? AND status='active'`,
      )
      .get(ctx.campaignId) as
      | { combat_instance_id: string; location_id: string | null }
      | undefined;
    if (combat === undefined)
      throw new AmmunitionError(
        'expend_ammunition requires an active combat instance',
      );
    const characterId = resolveCharacterId(txnDb, ctx.characterId);
    const held = txnDb
      .prepare('SELECT quantity FROM inventory WHERE id=? AND character_id=?')
      .get(input.itemId, characterId) as { quantity: number } | undefined;
    if (held === undefined)
      throw new AmmunitionError(
        `character '${characterId}' does not hold inventory item '${input.itemId}'`,
      );
    if (held.quantity < quantity)
      throw new AmmunitionError(
        `inventory item '${input.itemId}' has ${held.quantity}; cannot expend ${quantity}`,
      );
    const locationId = currentWorldLocation(txnDb);
    const result = removeItem(
      txnDb,
      {
        itemId: input.itemId,
        quantity,
        disposition: 'dropped',
      },
      {
        characterId,
        provenance: ctx.provenance,
        sessionId: ctx.sessionId,
        at: ctx.at,
      },
    );
    if (!result.removed && result.relinquishedItemId === undefined)
      throw new AmmunitionError(
        `could not expend inventory item '${input.itemId}'`,
      );
    const expendedInventoryId = result.relinquishedItemId ?? input.itemId;
    const alreadyTracked = txnDb
      .prepare(
        `SELECT 1 FROM ammunition_expenditure
         WHERE expended_inventory_id=? LIMIT 1`,
      )
      .get(expendedInventoryId);
    if (alreadyTracked !== undefined)
      throw new AmmunitionError(
        `inventory row '${expendedInventoryId}' is already accounted for as ammunition`,
      );
    // Deterministic identity (replay and checkpoints compare state), not a
    // random id: one sequence per campaign.
    const sequence =
      (
        txnDb
          .prepare(
            'SELECT COUNT(*) AS n FROM ammunition_expenditure WHERE campaign_id=?',
          )
          .get(ctx.campaignId) as { n: number }
      ).n + 1;
    const expenditureId = `ammo-${combat.combat_instance_id}-${sequence}`;
    txnDb
      .prepare(
        `INSERT INTO ammunition_expenditure(
         campaign_id, expenditure_id, combat_instance_id, character_id,
         source_inventory_id, expended_inventory_id, quantity, world_location_id,
         status, provenance, session_id, created_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'expended', ?, ?, ?)`,
      )
      .run(
        ctx.campaignId,
        expenditureId,
        combat.combat_instance_id,
        characterId,
        input.itemId,
        expendedInventoryId,
        quantity,
        locationId,
        ctx.provenance,
        ctx.sessionId,
        ctx.at,
      );
    return {
      combatInstanceId: combat.combat_instance_id,
      expenditureId,
      expendedInventoryId,
      quantity,
    };
  });
}

interface ExpenditureRow {
  expenditure_id: string;
  expended_inventory_id: string;
  quantity: number;
  world_location_id: string;
}
interface ExpendedItemRow {
  id: string;
  name: string;
  quantity: number;
  properties_json: string;
  pack_ref: string | null;
  variant_id: string | null;
  character_id: string | null;
  world_location_id: string | null;
  unheld_disposition: string | null;
}

/** Deterministically recover floor(half) of the still-present expenditure. */
export function recoverAmmunition(
  db: Db,
  combatInstanceId: string,
  ctx: AmmunitionMutationContext,
): {
  combatInstanceId: string;
  characterId: string;
  recovered: number;
  destroyed: number;
  movedAway: number;
} {
  if (!combatInstanceId)
    throw new AmmunitionError('combatInstanceId must be non-empty');
  return withTransaction(db, (txnDb) => {
    const characterId = resolveCharacterId(txnDb, ctx.characterId);
    const combat = txnDb
      .prepare(
        'SELECT status FROM combat_instance WHERE campaign_id=? AND combat_instance_id=?',
      )
      .get(ctx.campaignId, combatInstanceId) as { status: string } | undefined;
    if (combat === undefined)
      throw new AmmunitionError(
        `unknown combat instance '${combatInstanceId}'`,
      );
    if (combat.status === 'active')
      throw new AmmunitionError(
        'ammunition can be recovered only after the combat instance is closed',
      );
    const locationId = currentWorldLocation(txnDb);
    const rows = txnDb
      .prepare(
        `SELECT expenditure_id, expended_inventory_id, quantity, world_location_id
       FROM ammunition_expenditure
       WHERE campaign_id=? AND combat_instance_id=? AND character_id=? AND status='expended'
       ORDER BY expenditure_id`,
      )
      .all(ctx.campaignId, combatInstanceId, characterId) as ExpenditureRow[];
    if (rows.length === 0)
      throw new AmmunitionError(
        'no expended ammunition remains for this character and combat instance',
      );
    if (rows.some((row) => row.world_location_id !== locationId))
      throw new AmmunitionError(
        `ammunition was expended at another location; current location is '${locationId}'`,
      );

    const groups = new Map<
      string,
      {
        rows: {
          expenditure: ExpenditureRow;
          item?: ExpendedItemRow;
          present: number;
        }[];
        total: number;
      }
    >();
    let movedAway = 0;
    for (const expenditure of rows) {
      const item = txnDb
        .prepare(
          `SELECT id, name, quantity, properties_json, pack_ref, variant_id,
                character_id, world_location_id, unheld_disposition
         FROM inventory WHERE id=?`,
        )
        .get(expenditure.expended_inventory_id) as ExpendedItemRow | undefined;
      const present =
        item !== undefined &&
        item.character_id === null &&
        item.unheld_disposition === 'dropped' &&
        item.world_location_id === locationId
          ? Math.min(item.quantity, expenditure.quantity)
          : 0;
      movedAway += expenditure.quantity - present;
      if (present === 0 || item === undefined) continue;
      const identity = JSON.stringify([
        item.pack_ref,
        item.variant_id,
        item.name,
        item.properties_json,
      ]);
      const group = groups.get(identity) ?? { rows: [], total: 0 };
      group.rows.push({ expenditure, item, present });
      group.total += present;
      groups.set(identity, group);
    }

    // Release the reservation before claimItem; the encompassing transaction
    // restores it if any custody change fails.
    txnDb
      .prepare(
        `UPDATE ammunition_expenditure SET status='resolved', resolved_at=?,
         provenance=?, session_id=?
       WHERE campaign_id=? AND combat_instance_id=? AND character_id=? AND status='expended'`,
      )
      .run(
        ctx.at,
        ctx.provenance,
        ctx.sessionId,
        ctx.campaignId,
        combatInstanceId,
        characterId,
      );

    let recovered = 0;
    let destroyed = 0;
    for (const group of groups.values()) {
      let toRecover = Math.floor(group.total / 2);
      for (const entry of group.rows) {
        const item = entry.item as ExpendedItemRow;
        const take = Math.min(toRecover, entry.present);
        toRecover -= take;
        if (take > 0) {
          // Unrecovered pieces of this row are destroyed first, so the row
          // holds exactly the recovered pieces; custody then returns through
          // claim_item's own path (co-location, quarantine, wear state).
          if (take !== item.quantity)
            txnDb
              .prepare(
                `UPDATE inventory SET quantity=?, provenance=?, session_id=?, updated_at=?
                 WHERE id=? AND character_id IS NULL`,
              )
              .run(take, ctx.provenance, ctx.sessionId, ctx.at, item.id);
          claimItem(txnDb, item.id, {
            provenance: ctx.provenance,
            sessionId: ctx.sessionId,
            at: ctx.at,
            characterId,
          });
          recovered += take;
        } else {
          destroyInventoryItem(txnDb, item.id, ctx);
        }
        destroyed += entry.present - take;
      }
    }
    return { combatInstanceId, characterId, recovered, destroyed, movedAway };
  });
}
