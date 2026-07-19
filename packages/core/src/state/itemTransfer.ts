import type { Db } from '../persistence/db.js';
import { withTransaction } from '../persistence/db.js';
import { resolveCharacterId } from './activeCharacter.js';
import {
  AttunementError,
  assertInventoryAttunementCurseReady,
  assertInventoryCurseCustodyReady,
  MagicItemCustodyError,
} from './attunement.js';
import type { CampaignRulesPackResolver } from './campaignRecordLookup.js';
import type { DomainMutationContext } from './domainMutations.js';

export type ItemTransferAttunementPolicy = 'end' | 'require-unattuned';

export interface TransferItemInput {
  readonly campaignId: string;
  readonly itemId: string;
  readonly fromCharacterRef?: string;
  readonly toCharacterRef: string;
  readonly attunement: ItemTransferAttunementPolicy;
  readonly resolveRulesPack?: CampaignRulesPackResolver;
}

export interface TransferItemResult {
  readonly itemId: string;
  readonly name: string;
  readonly fromCharacterId: string;
  readonly toCharacterId: string;
  readonly packRef?: string;
  readonly variantId?: string;
  readonly quantity: number;
  readonly attunementEnded: boolean;
}

export class ItemTransferError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ItemTransferError';
  }
}

/** Move one durable inventory row without recreating its identity or state. */
export function transferItem(
  db: Db,
  input: TransferItemInput,
  ctx: DomainMutationContext,
): TransferItemResult {
  if (input.itemId.length === 0)
    throw new ItemTransferError('transfer itemId must be non-empty');
  if (input.attunement !== 'end' && input.attunement !== 'require-unattuned')
    throw new ItemTransferError(
      "transfer attunement must be 'end' or 'require-unattuned'",
    );
  return withTransaction(db, (txnDb) => {
    const fromCharacterId = resolveCharacterId(
      txnDb,
      input.fromCharacterRef ?? ctx.characterId,
    );
    const toCharacterId = resolveCharacterId(txnDb, input.toCharacterRef);
    if (fromCharacterId === toCharacterId)
      throw new ItemTransferError(
        'transfer source and destination are the same',
      );
    const row = txnDb
      .prepare(
        `SELECT id, name, quantity, pack_ref, variant_id
         FROM inventory WHERE id=? AND character_id=?`,
      )
      .get(input.itemId, fromCharacterId) as
      | {
          id: string;
          name: string;
          quantity: number;
          pack_ref: string | null;
          variant_id: string | null;
        }
      | undefined;
    if (row === undefined)
      throw new ItemTransferError(
        `character '${fromCharacterId}' holds no inventory instance '${input.itemId}'`,
      );
    const attunements = txnDb
      .prepare(
        `SELECT campaign_id, character_id FROM attunement
         WHERE item_id=?`,
      )
      .all(input.itemId) as {
      campaign_id: string;
      character_id: string;
    }[];
    if (attunements.length > 1)
      throw new ItemTransferError(
        `inventory instance '${input.itemId}' has multiple attunements; repair the inconsistent state before transfer`,
      );
    const attunement = attunements[0];
    if (
      attunement !== undefined &&
      (attunement.campaign_id !== input.campaignId ||
        attunement.character_id !== fromCharacterId)
    )
      throw new ItemTransferError(
        `inventory instance '${input.itemId}' has an attunement outside the asserted source/campaign; repair or end it explicitly before transfer`,
      );
    if (attunement !== undefined && input.attunement === 'require-unattuned')
      throw new ItemTransferError(
        `inventory instance '${input.itemId}' is attuned to '${attunement.character_id}'; choose attunement 'end' or end it first`,
      );
    try {
      assertInventoryCurseCustodyReady(
        txnDb,
        input.itemId,
        'transfer',
        input.resolveRulesPack,
      );
    } catch (error) {
      if (error instanceof MagicItemCustodyError)
        throw new ItemTransferError(error.message);
      throw error;
    }
    if (attunement !== undefined) {
      try {
        assertInventoryAttunementCurseReady(
          txnDb,
          input.itemId,
          'transfer-end',
          input.resolveRulesPack,
        );
      } catch (error) {
        if (error instanceof AttunementError)
          throw new ItemTransferError(error.message);
        throw error;
      }
      txnDb
        .prepare('DELETE FROM attunement WHERE campaign_id=? AND item_id=?')
        .run(input.campaignId, input.itemId);
    }
    txnDb
      .prepare(
        `UPDATE inventory
         SET character_id=?, location=NULL, world_location_id=NULL,
             unheld_disposition=NULL,
             provenance=?, session_id=?, updated_at=?
         WHERE id=? AND character_id=?`,
      )
      .run(
        toCharacterId,
        ctx.provenance,
        ctx.sessionId,
        ctx.at,
        input.itemId,
        fromCharacterId,
      );
    txnDb
      .prepare(
        `INSERT INTO inventory_wear_state(
           inventory_id, character_id, wear_state, provenance, session_id, updated_at
         ) VALUES (?, ?, 'not_worn', ?, ?, ?)
         ON CONFLICT(inventory_id) DO UPDATE SET
           character_id=excluded.character_id,
           wear_state='not_worn',
           provenance=excluded.provenance,
           session_id=excluded.session_id,
           updated_at=excluded.updated_at`,
      )
      .run(input.itemId, toCharacterId, ctx.provenance, ctx.sessionId, ctx.at);
    return {
      itemId: row.id,
      name: row.name,
      fromCharacterId,
      toCharacterId,
      ...(row.pack_ref === null ? {} : { packRef: row.pack_ref }),
      ...(row.variant_id === null ? {} : { variantId: row.variant_id }),
      quantity: row.quantity,
      attunementEnded: attunement !== undefined,
    };
  });
}
