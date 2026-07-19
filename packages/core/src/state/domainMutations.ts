import { adjustCharacterCurrency } from '../character/currency.js';
import type { CharacterWallet } from '../character/finalizeCharacter.js';
import type { Db } from '../persistence/db.js';
import { withTransaction } from '../persistence/db.js';
import { resolveCharacterId } from './activeCharacter.js';
// Function-level circular dependency with activeEffects.ts (which projects
// conditions through addCondition/removeCondition): safe because both sides
// only reference each other inside function bodies. The incapacitation
// reaction lives here so EVERY condition write — the add_condition tool and
// effect projections alike — carries the atomic concentration break.
import {
  anyConditionImpliesIncapacitated,
  breakConcentrationOnLifeEvent,
  conditionImpliesIncapacitated,
} from './activeEffects.js';
import { resolveCampaignAdvancementPolicy } from './advancementPolicy.js';
import {
  assertInventoryCurseCustodyReady,
  MagicItemCustodyError,
} from './attunement.js';
import type { CampaignRulesPackResolver } from './campaignRecordLookup.js';
import {
  type DestroyedItemAttunementEvidence,
  destroyInventoryItem,
} from './inventoryLifecycle.js';
import {
  InventoryWorldLocationError,
  isConcreteWorldLocation,
  requireCurrentWorldLocation,
} from './inventoryWorldLocation.js';
import { itemAdoptionReviewBlockMessage } from './itemAdoptionReview.js';
import { ItemStateError, validatePackRef } from './itemState.js';
import type { CharacterConditionEntry } from './liveStateSchema.js';
import {
  LiveStateSchemaError,
  validateInventoryPropertiesJson,
} from './liveStateSchema.js';
import {
  MutateStateError,
  type MutateStateInput,
  type MutateStateValue,
  mutateState,
  mutateStateBatch,
} from './mutateState.js';
import {
  getProgressionState,
  ProgressionError,
  type ProgressionEventRecord,
  recordProgressionEvent,
} from './progression.js';

export interface DomainMutationContext {
  provenance: string;
  sessionId: string;
  at: string;
  characterId?: string;
}

export interface AddConditionInput {
  id: string;
  [key: string]: unknown;
}

export interface AddConditionResult {
  added: boolean;
  conditions: readonly CharacterConditionEntry[];
  /** Set when this condition incapacitated a concentrating character: the
   *  F3 break + owned-projection cleanup happened in this transaction. */
  concentrationBroken?: {
    effectId: string;
    displayName: string;
    cause: 'incapacitated';
  };
}

export function addCondition(
  db: Db,
  condition: AddConditionInput,
  ctx: DomainMutationContext,
): AddConditionResult {
  if (typeof condition.id !== 'string' || condition.id.length === 0) {
    throw new MutateStateError('condition id must be a non-empty string');
  }

  return withTransaction(db, (txnDb) => {
    const charId = resolveCharacterId(txnDb, ctx.characterId);
    const current = readConditions(txnDb, charId);

    if (current.some((c) => c.id === condition.id)) {
      return { added: false, conditions: current };
    }

    const entry: CharacterConditionEntry = {
      ...condition,
    } as CharacterConditionEntry;
    const updated = [...current, entry];

    mutateState(txnDb, {
      target: 'character',
      id: charId,
      field: 'conditions_json',
      op: 'set',
      value: updated,
      ...ctx,
    });

    // F3 reaction: a condition whose structured record implies
    // `incapacitated` (or `incapacitated` itself) breaks the character's
    // concentration, atomically with the condition write. Transition-gated:
    // an already-incapacitated character triggers nothing further, and the
    // duplicate-id no-op above never reaches here.
    let concentrationBroken: AddConditionResult['concentrationBroken'];
    if (
      conditionImpliesIncapacitated(txnDb, condition.id) &&
      !anyConditionImpliesIncapacitated(
        txnDb,
        current.map((c) => c.id),
      )
    ) {
      const broken = breakConcentrationOnLifeEvent(
        txnDb,
        charId,
        'incapacitated',
        { provenance: ctx.provenance, sessionId: ctx.sessionId, at: ctx.at },
      );
      if (broken.broken && broken.effectId !== undefined) {
        concentrationBroken = {
          effectId: broken.effectId,
          displayName: broken.displayName ?? broken.effectId,
          cause: 'incapacitated',
        };
      }
    }

    return {
      added: true,
      // The break's cleanup may remove effect-owned conditions from this
      // same character, so re-read rather than returning the stale snapshot.
      conditions:
        concentrationBroken === undefined
          ? updated
          : readConditions(txnDb, charId),
      ...(concentrationBroken === undefined ? {} : { concentrationBroken }),
    };
  });
}

export interface RemoveConditionResult {
  removed: boolean;
  conditions: readonly CharacterConditionEntry[];
}

export function removeCondition(
  db: Db,
  conditionId: string,
  ctx: DomainMutationContext,
): RemoveConditionResult {
  if (typeof conditionId !== 'string' || conditionId.length === 0) {
    throw new MutateStateError('condition id must be a non-empty string');
  }

  return withTransaction(db, (txnDb) => {
    const charId = resolveCharacterId(txnDb, ctx.characterId);
    const current = readConditions(txnDb, charId);
    const updated = current.filter((c) => c.id !== conditionId);

    if (updated.length === current.length) {
      return { removed: false, conditions: current };
    }

    mutateState(txnDb, {
      target: 'character',
      id: charId,
      field: 'conditions_json',
      op: 'set',
      value: updated,
      ...ctx,
    });

    return { removed: true, conditions: updated };
  });
}

export interface GiveItemInput {
  id: string;
  name: string;
  quantity?: number;
  location?: string | null;
  properties?: Record<string, unknown>;
  /** Immutable rules-record identity, separate from this row/instance id. */
  packRef?: string;
  /** Canonical emitted child identity when the pack record declares variants. */
  variantId?: string;
  /** Derived from the resolved pack record by the model-facing grant path. */
  stateful?: boolean;
}

export function giveItem(
  db: Db,
  item: GiveItemInput,
  ctx: DomainMutationContext,
): { id: string; variantId?: string } {
  if (typeof item.id !== 'string' || item.id.length === 0) {
    throw new MutateStateError('item id must be a non-empty string');
  }
  if (typeof item.name !== 'string' || item.name.length === 0) {
    throw new MutateStateError('item name must be a non-empty string');
  }
  if (item.packRef !== undefined) {
    try {
      validatePackRef(item.packRef, 'item packRef');
    } catch (error) {
      if (error instanceof ItemStateError) {
        throw new MutateStateError(error.message);
      }
      throw error;
    }
  }
  if (
    item.variantId !== undefined &&
    !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(item.variantId)
  )
    throw new MutateStateError(
      'item variantId must be a canonical kebab-case id',
    );
  if (item.variantId !== undefined && item.packRef === undefined)
    throw new MutateStateError('item variantId requires a packRef');

  return withTransaction(db, (txnDb) => {
    const charId = resolveCharacterId(txnDb, ctx.characterId);
    const quantity = item.quantity ?? 1;
    if (!Number.isInteger(quantity) || quantity < 0) {
      throw new MutateStateError(
        'item quantity must be a non-negative integer',
      );
    }
    if (item.stateful === true && quantity !== 1) {
      throw new MutateStateError('stateful pack items must have quantity 1');
    }
    let propertiesJson: string;
    try {
      const properties = item.properties ?? {};
      validateInventoryPropertiesJson(properties, 'inventory.properties_json');
      propertiesJson = JSON.stringify(properties);
    } catch (error) {
      if (error instanceof LiveStateSchemaError)
        throw new MutateStateError(error.message);
      throw error;
    }

    let rowId = item.id;
    let collision:
      | {
          character_id: string | null;
          pack_ref: string | null;
          variant_id: string | null;
          unheld_disposition: string | null;
        }
      | undefined;
    if (item.stateful === true) {
      if (item.packRef === undefined) {
        throw new MutateStateError('stateful items require a packRef');
      }
      const base = item.packRef.slice('magic-item:'.length);
      let suffix = 1;
      while (
        txnDb
          .prepare('SELECT 1 FROM inventory WHERE id = ?')
          .get(`${base}#${suffix}`) !== undefined
      ) {
        suffix += 1;
      }
      rowId = `${base}#${suffix}`;
    } else {
      collision = txnDb
        .prepare(
          `SELECT character_id, pack_ref, variant_id, unheld_disposition
           FROM inventory WHERE id = ?`,
        )
        .get(rowId) as
        | {
            character_id: string | null;
            pack_ref: string | null;
            variant_id: string | null;
            unheld_disposition: string | null;
          }
        | undefined;
      if (collision !== undefined) {
        const quarantine = itemAdoptionReviewBlockMessage(
          txnDb,
          rowId,
          'give_item',
        );
        if (quarantine !== undefined) throw new MutateStateError(quarantine);
      }
      if (collision !== undefined && collision.character_id !== charId) {
        throw new MutateStateError(
          collision.character_id === null
            ? collision.unheld_disposition === 'dropped'
              ? `inventory id '${rowId}' is a dropped physical row; use claim_item to take custody`
              : `inventory id '${rowId}' has unheld disposition '${collision.unheld_disposition ?? 'unknown'}' and is not available to give or claim`
            : `inventory id '${rowId}' is held by '${collision.character_id}'; use transfer_item to change custody`,
        );
      }
      if (
        item.packRef === undefined &&
        collision !== undefined &&
        collision.pack_ref !== null
      ) {
        throw new MutateStateError(
          `inventory id '${rowId}' belongs to pack-bound instance '${collision.pack_ref}' and cannot be overwritten by an ad-hoc grant`,
        );
      }
      if (
        item.packRef !== undefined &&
        collision !== undefined &&
        (collision.pack_ref !== item.packRef ||
          collision.variant_id !== (item.variantId ?? null))
      ) {
        throw new MutateStateError(
          `pack-bound inventory id '${rowId}' already belongs to another instance; choose a distinct id`,
        );
      }
    }

    const base = {
      target: 'inventory' as const,
      id: rowId,
      op: 'set' as const,
      ...ctx,
    };

    const mutations: MutateStateInput[] = [
      { ...base, field: 'name', value: item.name },
      { ...base, field: 'quantity', value: quantity },
    ];

    if (item.location !== undefined) {
      mutations.push({ ...base, field: 'location', value: item.location });
    }

    if (item.properties !== undefined) {
      mutations.push({
        ...base,
        field: 'properties_json',
        value: item.properties,
      });
    }

    if (collision === undefined) {
      txnDb
        .prepare(
          `INSERT INTO inventory(
             id, character_id, name, quantity, location, properties_json,
             provenance, session_id, updated_at, pack_ref, variant_id,
             world_location_id
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
        )
        .run(
          rowId,
          charId,
          item.name,
          quantity,
          item.location ?? null,
          propertiesJson,
          ctx.provenance,
          ctx.sessionId,
          ctx.at,
          item.packRef ?? null,
          item.variantId ?? null,
        );
    } else {
      mutateStateBatch(txnDb, mutations);
    }
    return {
      id: rowId,
      ...(item.variantId === undefined ? {} : { variantId: item.variantId }),
    };
  });
}

export interface RemoveItemResult {
  disposition: InventoryRemovalDisposition;
  removed: boolean;
  previousQuantity: number;
  newQuantity: number;
  relinquishedItemId?: string;
  attunementsEnded?: readonly DestroyedItemAttunementEvidence[];
  worldLocationId?: string;
}

export interface ClaimItemResult {
  readonly itemId: string;
  readonly characterId: string;
  readonly name: string;
  readonly quantity: number;
  readonly packRef?: string;
  readonly variantId?: string;
  readonly claimedFromWorldLocationId: string;
}

export type InventoryReacquisitionBasis = 'found' | 'repurchased' | 'returned';

export interface ReacquireItemInput {
  readonly itemId: string;
  readonly basis: InventoryReacquisitionBasis;
  readonly evidence: string;
  /** Exact-denomination atomic payment; required only for repurchase. */
  readonly payment?: Partial<CharacterWallet>;
}

export interface ReacquireItemResult extends ClaimItemResult {
  readonly previousDisposition: 'sold' | 'lost';
  readonly basis: InventoryReacquisitionBasis;
  readonly evidence: string;
  readonly paymentEventId?: string;
}

export interface RecoverableInventoryItem {
  readonly itemId: string;
  readonly name: string;
  readonly quantity: number;
  readonly disposition: 'sold' | 'lost';
  readonly worldLocationId: string;
  readonly packRef?: string;
  readonly variantId?: string;
  readonly priorReacquisitions: number;
}

/** Bounded identity discovery after the scene has established a recovery basis. */
export function listRecoverableItems(
  db: Db,
  basis: InventoryReacquisitionBasis,
): {
  readonly items: readonly RecoverableInventoryItem[];
  readonly truncated: boolean;
} {
  if (!['found', 'repurchased', 'returned'].includes(basis))
    throw new MutateStateError(
      'list_recoverable_items basis must be found, repurchased, or returned',
    );
  let currentLocation: string;
  try {
    currentLocation = requireCurrentWorldLocation(db);
  } catch (error) {
    if (error instanceof InventoryWorldLocationError)
      throw new MutateStateError(error.message);
    throw error;
  }
  const allowedDispositions =
    basis === 'found'
      ? ['lost']
      : basis === 'repurchased'
        ? ['sold']
        : ['sold', 'lost'];
  const placeholders = allowedDispositions.map(() => '?').join(', ');
  const rows = db
    .prepare(
      `SELECT i.id, i.name, i.quantity, i.unheld_disposition,
              i.world_location_id, i.pack_ref, i.variant_id,
              (SELECT COUNT(*) FROM inventory_custody_event e
               WHERE e.inventory_id=i.id) AS prior_reacquisitions
       FROM inventory i
       WHERE i.character_id IS NULL
         AND i.world_location_id=?
         AND i.unheld_disposition IN (${placeholders})
         AND NOT EXISTS (
           SELECT 1 FROM inventory_adoption_review r
           WHERE r.inventory_id=i.id
         )
       ORDER BY i.id
       LIMIT 21`,
    )
    .all(currentLocation, ...allowedDispositions) as {
    id: string;
    name: string;
    quantity: number;
    unheld_disposition: 'sold' | 'lost';
    world_location_id: string;
    pack_ref: string | null;
    variant_id: string | null;
    prior_reacquisitions: number;
  }[];
  return {
    items: rows.slice(0, 20).map((row) => ({
      itemId: row.id,
      name: row.name,
      quantity: row.quantity,
      disposition: row.unheld_disposition,
      worldLocationId: row.world_location_id,
      ...(row.pack_ref === null ? {} : { packRef: row.pack_ref }),
      ...(row.variant_id === null ? {} : { variantId: row.variant_id }),
      priorReacquisitions: row.prior_reacquisitions,
    })),
    truncated: rows.length > 20,
  };
}

/**
 * Claim one existing unheld physical row without recreating its identity.
 * Co-location is proven against the campaign clock before custody changes.
 * Pickup clears the unheld-only world placement atomically.
 */
export function claimItem(
  db: Db,
  itemId: string,
  ctx: DomainMutationContext,
): ClaimItemResult {
  if (typeof itemId !== 'string' || itemId.length === 0)
    throw new MutateStateError('claim_item item id must be non-empty');
  return withTransaction(db, (txnDb) => {
    const characterId = resolveCharacterId(txnDb, ctx.characterId);
    const row = txnDb
      .prepare(
        `SELECT name, quantity, character_id, pack_ref, variant_id,
                world_location_id, unheld_disposition
         FROM inventory WHERE id = ?`,
      )
      .get(itemId) as
      | {
          name: string;
          quantity: number;
          character_id: string | null;
          pack_ref: string | null;
          variant_id: string | null;
          world_location_id: string | null;
          unheld_disposition: string | null;
        }
      | undefined;
    if (row === undefined)
      throw new MutateStateError(`unheld inventory item '${itemId}' not found`);
    if (row.character_id !== null)
      throw new MutateStateError(
        `inventory item '${itemId}' is already held by '${row.character_id}'`,
      );
    const quarantine = itemAdoptionReviewBlockMessage(
      txnDb,
      itemId,
      'claim_item',
    );
    if (quarantine !== undefined) throw new MutateStateError(quarantine);
    if (row.unheld_disposition !== 'dropped')
      throw new MutateStateError(
        `inventory item '${itemId}' has unheld disposition '${row.unheld_disposition ?? 'unknown'}' and is not a generally claimable drop`,
      );
    let currentLocation: string;
    try {
      currentLocation = requireCurrentWorldLocation(txnDb);
    } catch (error) {
      if (error instanceof InventoryWorldLocationError)
        throw new MutateStateError(error.message);
      throw error;
    }
    if (
      !isConcreteWorldLocation(row.world_location_id) ||
      currentLocation !== row.world_location_id
    )
      throw new MutateStateError(
        `inventory item '${itemId}' cannot be claimed without deterministic co-location (item: ${row.world_location_id ?? 'unknown'}, character: ${currentLocation ?? 'unknown'})`,
      );
    const updated = txnDb
      .prepare(
        `UPDATE inventory
         SET character_id=?, world_location_id=NULL, unheld_disposition=NULL,
             provenance=?, session_id=?, updated_at=?
         WHERE id=? AND character_id IS NULL`,
      )
      .run(characterId, ctx.provenance, ctx.sessionId, ctx.at, itemId);
    if (updated.changes !== 1)
      throw new MutateStateError(
        `inventory item '${itemId}' was claimed concurrently`,
      );
    return {
      itemId,
      characterId,
      name: row.name,
      quantity: row.quantity,
      claimedFromWorldLocationId: row.world_location_id,
      ...(row.pack_ref === null ? {} : { packRef: row.pack_ref }),
      ...(row.variant_id === null ? {} : { variantId: row.variant_id }),
    };
  });
}

/**
 * Authorized reverse transition for a specifically identified sold/lost row.
 * Unlike general claim, this requires an explicit disposition-compatible basis
 * plus durable adjudication evidence and deterministic co-location.
 */
export function reacquireItem(
  db: Db,
  input: ReacquireItemInput,
  ctx: DomainMutationContext,
): ReacquireItemResult {
  if (typeof input.itemId !== 'string' || input.itemId.length === 0)
    throw new MutateStateError('reacquire_item item id must be non-empty');
  if (!['found', 'repurchased', 'returned'].includes(input.basis))
    throw new MutateStateError(
      'reacquire_item basis must be found, repurchased, or returned',
    );
  if (typeof input.evidence !== 'string' || input.evidence.trim().length === 0)
    throw new MutateStateError(
      'reacquire_item requires non-empty adjudicated custody evidence',
    );
  if (input.basis === 'repurchased' && input.payment === undefined)
    throw new MutateStateError(
      'reacquire_item repurchased basis requires an atomic exact-denomination payment',
    );
  if (input.basis !== 'repurchased' && input.payment !== undefined)
    throw new MutateStateError(
      'reacquire_item payment is valid only for repurchased custody',
    );
  return withTransaction(db, (txnDb) => {
    const characterId = resolveCharacterId(txnDb, ctx.characterId);
    const row = txnDb
      .prepare(
        `SELECT name, quantity, character_id, pack_ref, variant_id,
                world_location_id, unheld_disposition
         FROM inventory WHERE id=?`,
      )
      .get(input.itemId) as
      | {
          name: string;
          quantity: number;
          character_id: string | null;
          pack_ref: string | null;
          variant_id: string | null;
          world_location_id: string | null;
          unheld_disposition: string | null;
        }
      | undefined;
    if (row === undefined)
      throw new MutateStateError(
        `unheld inventory item '${input.itemId}' not found`,
      );
    if (row.character_id !== null)
      throw new MutateStateError(
        `inventory item '${input.itemId}' is already held by '${row.character_id}'`,
      );
    if (row.unheld_disposition !== 'sold' && row.unheld_disposition !== 'lost')
      throw new MutateStateError(
        `inventory item '${input.itemId}' has disposition '${row.unheld_disposition ?? 'unknown'}'; use claim_item for a dropped row`,
      );
    if (
      (row.unheld_disposition === 'sold' && input.basis === 'found') ||
      (row.unheld_disposition === 'lost' && input.basis === 'repurchased')
    )
      throw new MutateStateError(
        `reacquisition basis '${input.basis}' is incompatible with '${row.unheld_disposition}' custody`,
      );
    const quarantine = itemAdoptionReviewBlockMessage(
      txnDb,
      input.itemId,
      'reacquire_item',
    );
    if (quarantine !== undefined) throw new MutateStateError(quarantine);
    let currentLocation: string;
    try {
      currentLocation = requireCurrentWorldLocation(txnDb);
    } catch (error) {
      if (error instanceof InventoryWorldLocationError)
        throw new MutateStateError(error.message);
      throw error;
    }
    if (
      !isConcreteWorldLocation(row.world_location_id) ||
      currentLocation !== row.world_location_id
    )
      throw new MutateStateError(
        `inventory item '${input.itemId}' cannot be reacquired without deterministic co-location (item: ${row.world_location_id ?? 'unknown'}, character: ${currentLocation})`,
      );
    const sequence = txnDb
      .prepare(
        `SELECT COALESCE(MAX(seq), 0) + 1 AS seq
         FROM inventory_custody_event WHERE inventory_id=?`,
      )
      .get(input.itemId) as { seq: number };
    const payment =
      input.basis === 'repurchased'
        ? adjustCharacterCurrency(
            txnDb,
            {
              kind: 'spend',
              amounts: input.payment as Partial<CharacterWallet>,
            },
            {
              source: `inventory-repurchase:${input.itemId}`,
              provenance: ctx.provenance,
              sessionId: ctx.sessionId,
              at: ctx.at,
              characterId,
            },
          )
        : undefined;
    txnDb
      .prepare(
        `INSERT INTO inventory_custody_event(
           inventory_id, seq, from_disposition, basis, evidence,
           payment_event_id, to_character_id, world_location_id, provenance,
           session_id, occurred_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        input.itemId,
        sequence.seq,
        row.unheld_disposition,
        input.basis,
        input.evidence.trim(),
        payment?.event.id ?? null,
        characterId,
        currentLocation,
        ctx.provenance,
        ctx.sessionId,
        ctx.at,
      );
    const updated = txnDb
      .prepare(
        `UPDATE inventory
         SET character_id=?, world_location_id=NULL, unheld_disposition=NULL,
             provenance=?, session_id=?, updated_at=?
         WHERE id=? AND character_id IS NULL AND unheld_disposition=?`,
      )
      .run(
        characterId,
        ctx.provenance,
        ctx.sessionId,
        ctx.at,
        input.itemId,
        row.unheld_disposition,
      );
    if (updated.changes !== 1)
      throw new MutateStateError(
        `inventory item '${input.itemId}' was reacquired concurrently`,
      );
    return {
      itemId: input.itemId,
      characterId,
      name: row.name,
      quantity: row.quantity,
      claimedFromWorldLocationId: currentLocation,
      previousDisposition: row.unheld_disposition,
      basis: input.basis,
      evidence: input.evidence.trim(),
      ...(payment === undefined ? {} : { paymentEventId: payment.event.id }),
      ...(row.pack_ref === null ? {} : { packRef: row.pack_ref }),
      ...(row.variant_id === null ? {} : { variantId: row.variant_id }),
    };
  });
}

export type InventoryRemovalDisposition =
  | 'destroyed'
  | 'dropped'
  | 'sold'
  | 'lost';

export interface RemoveItemInput {
  readonly itemId: string;
  readonly quantity?: number;
  readonly disposition: InventoryRemovalDisposition;
  readonly resolveRulesPack?: CampaignRulesPackResolver;
}

function nextRelinquishedItemId(
  db: Db,
  itemId: string,
  disposition: Exclude<InventoryRemovalDisposition, 'destroyed'>,
): string {
  const base = `${itemId}#${disposition}`;
  let suffix = 1;
  while (
    db
      .prepare('SELECT 1 FROM inventory WHERE id = ?')
      .get(`${base}-${suffix}`) !== undefined
  )
    suffix += 1;
  return `${base}-${suffix}`;
}

export function removeItem(
  db: Db,
  input: RemoveItemInput,
  ctx: DomainMutationContext,
): RemoveItemResult {
  const { itemId, quantity, disposition } = input;
  if (typeof itemId !== 'string' || itemId.length === 0) {
    throw new MutateStateError('item id must be a non-empty string');
  }
  if (!['destroyed', 'dropped', 'sold', 'lost'].includes(disposition))
    throw new MutateStateError(
      'remove_item disposition must be destroyed, dropped, sold, or lost',
    );
  if (quantity !== undefined && (!Number.isInteger(quantity) || quantity < 1)) {
    throw new MutateStateError(
      'remove_item quantity must be a positive integer',
    );
  }

  return withTransaction(db, (txnDb) => {
    const charId = resolveCharacterId(txnDb, ctx.characterId);
    const row = txnDb
      .prepare(
        `SELECT id, character_id, name, quantity, location, world_location_id,
                properties_json, pack_ref, variant_id, unheld_disposition
         FROM inventory WHERE id = ?`,
      )
      .get(itemId) as
      | {
          id: string;
          character_id: string | null;
          name: string;
          quantity: number;
          location: string | null;
          world_location_id: string | null;
          properties_json: string;
          pack_ref: string | null;
          variant_id: string | null;
          unheld_disposition: string | null;
        }
      | undefined;

    if (row === undefined) {
      return {
        disposition,
        removed: false,
        previousQuantity: 0,
        newQuantity: 0,
      };
    }
    const quarantine = itemAdoptionReviewBlockMessage(
      txnDb,
      itemId,
      'remove_item',
    );
    if (quarantine !== undefined) throw new MutateStateError(quarantine);
    if (
      row.character_id !== charId &&
      !(row.character_id === null && disposition === 'destroyed')
    )
      throw new MutateStateError(
        row.character_id === null
          ? `inventory item '${itemId}' is unheld and cannot be ${disposition} by character '${charId}'`
          : `inventory item '${itemId}' is held by another character and cannot be removed by '${charId}'`,
      );

    if (disposition !== 'destroyed' && row.character_id !== null) {
      try {
        assertInventoryCurseCustodyReady(
          txnDb,
          itemId,
          disposition,
          input.resolveRulesPack,
        );
      } catch (error) {
        if (error instanceof MagicItemCustodyError)
          throw new MutateStateError(error.message);
        throw error;
      }
    }

    const clock = txnDb
      .prepare('SELECT current_location_id FROM clock WHERE id=1')
      .get() as { current_location_id: string | null } | undefined;
    let currentWorldLocation = clock?.current_location_id ?? null;
    if (row.character_id === null) {
      if (row.unheld_disposition !== 'dropped')
        throw new MutateStateError(
          `unheld inventory item '${itemId}' has disposition '${row.unheld_disposition ?? 'unknown'}' and is not under the acting character's custody`,
        );
      try {
        currentWorldLocation = requireCurrentWorldLocation(txnDb);
      } catch (error) {
        if (error instanceof InventoryWorldLocationError)
          throw new MutateStateError(error.message);
        throw error;
      }
      if (
        !isConcreteWorldLocation(row.world_location_id) ||
        currentWorldLocation !== row.world_location_id
      )
        throw new MutateStateError(
          `unheld inventory item '${itemId}' cannot be destroyed without deterministic co-location (item: ${row.world_location_id ?? 'unknown'}, character: ${currentWorldLocation ?? 'unknown'})`,
        );
    }

    const previousQuantity = row.quantity;
    const requestedQuantity = quantity ?? previousQuantity;
    const fullDisposition =
      quantity === undefined || previousQuantity - requestedQuantity <= 0;

    if (disposition === 'destroyed' && fullDisposition) {
      const destruction = destroyInventoryItem(txnDb, itemId, ctx);
      return {
        disposition,
        removed: destruction.destroyed,
        previousQuantity,
        newQuantity: 0,
        ...(destruction.attunementsEnded.length === 0
          ? {}
          : { attunementsEnded: destruction.attunementsEnded }),
      };
    }

    const newQuantity = previousQuantity - requestedQuantity;
    const hasInstanceState =
      txnDb
        .prepare('SELECT 1 FROM item_state WHERE inventory_id = ?')
        .get(itemId) !== undefined ||
      txnDb
        .prepare(
          `SELECT 1 FROM entity_usage_counter
           WHERE owner_kind='item' AND owner_ref=? LIMIT 1`,
        )
        .get(itemId) !== undefined ||
      txnDb
        .prepare('SELECT 1 FROM attunement WHERE item_id=? LIMIT 1')
        .get(itemId) !== undefined;
    if (!fullDisposition && hasInstanceState)
      throw new MutateStateError(
        `inventory item '${itemId}' has per-instance state and cannot be partially disposed; act on the whole physical instance`,
      );
    let relinquishmentLocation: string | undefined;
    if (disposition !== 'destroyed') {
      try {
        relinquishmentLocation = requireCurrentWorldLocation(txnDb);
      } catch (error) {
        if (error instanceof InventoryWorldLocationError)
          throw new MutateStateError(error.message);
        throw error;
      }
    }
    if (disposition !== 'destroyed') {
      const worldLocation = relinquishmentLocation as string;
      if (fullDisposition) {
        txnDb
          .prepare(
            `UPDATE inventory
             SET character_id=NULL, location=NULL, world_location_id=?,
                 unheld_disposition=?,
                 provenance=?, session_id=?, updated_at=?
             WHERE id=? AND character_id=?`,
          )
          .run(
            worldLocation,
            disposition,
            ctx.provenance,
            ctx.sessionId,
            ctx.at,
            itemId,
            charId,
          );
        return {
          disposition,
          removed: true,
          previousQuantity,
          newQuantity: 0,
          relinquishedItemId: itemId,
          worldLocationId: worldLocation,
        };
      }
      const relinquishedItemId = nextRelinquishedItemId(
        txnDb,
        itemId,
        disposition,
      );
      txnDb
        .prepare(
          `INSERT INTO inventory(
             id, character_id, name, quantity, location, world_location_id,
             properties_json, provenance, session_id, updated_at, pack_ref,
             variant_id, unheld_disposition
           ) VALUES (?, NULL, ?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          relinquishedItemId,
          row.name,
          requestedQuantity,
          worldLocation,
          row.properties_json,
          ctx.provenance,
          ctx.sessionId,
          ctx.at,
          row.pack_ref,
          row.variant_id,
          disposition,
        );
      mutateState(txnDb, {
        target: 'inventory',
        id: itemId,
        field: 'quantity',
        op: 'set',
        value: newQuantity,
        ...ctx,
      });
      return {
        disposition,
        removed: false,
        previousQuantity,
        newQuantity,
        relinquishedItemId,
        worldLocationId: worldLocation,
      };
    }

    mutateState(txnDb, {
      target: 'inventory',
      id: itemId,
      field: 'quantity',
      op: 'set',
      value: newQuantity,
      ...ctx,
    });

    return { disposition, removed: false, previousQuantity, newQuantity };
  });
}

export interface UpdateClockInput {
  inGameTime?: string;
  locationId?: string | null;
}

export function updateClock(
  db: Db,
  input: UpdateClockInput,
  ctx: DomainMutationContext,
): void {
  if (
    typeof input.locationId === 'string' &&
    input.locationId.trim().length === 0
  )
    throw new MutateStateError(
      'update_clock location_id must contain a non-whitespace character or be null',
    );
  const base = {
    target: 'clock' as const,
    op: 'set' as const,
    ...ctx,
  };

  const mutations = [];

  if (input.inGameTime !== undefined) {
    mutations.push({ ...base, field: 'in_game_time', value: input.inGameTime });
    const elapsed = db
      .prepare('SELECT elapsed_minutes FROM clock WHERE id=1')
      .get() as { elapsed_minutes: number } | undefined;
    if (elapsed === undefined)
      throw new MutateStateError('campaign clock is missing');
    mutations.push({
      ...base,
      field: 'in_game_time_elapsed_minutes',
      value: elapsed.elapsed_minutes,
    });
  }
  if (input.locationId !== undefined) {
    mutations.push({
      ...base,
      field: 'current_location_id',
      value: input.locationId as MutateStateValue,
    });
  }

  if (mutations.length === 0) {
    throw new MutateStateError(
      'update_clock requires at least one of in_game_time or location_id',
    );
  }

  mutateStateBatch(db, mutations);
}

export function setPlotFlag(
  db: Db,
  key: string,
  value: MutateStateValue,
  ctx: DomainMutationContext,
): void {
  mutateState(db, {
    target: 'plot_flags',
    field: key,
    op: 'set',
    value,
    ...ctx,
  });
}

export function setWorldFact(
  db: Db,
  key: string,
  value: MutateStateValue,
  ctx: DomainMutationContext,
): void {
  mutateState(db, {
    target: 'overlay_facts',
    field: key,
    op: 'set',
    value,
    ...ctx,
  });
}

// ---------------------------------------------------------------------------
// Progression awards (eshyra-lupf.6)
// ---------------------------------------------------------------------------
//
// Higher-level, policy-aware wrappers that record an advancement award as one
// atomic, auditable mutation: they update durable state (XP) and append the
// matching `progression_event` ledger row in a single transaction, consulting
// the campaign advancement policy so the two modes can't be mixed.
//
// Awards never change the character's *level*: crossing a threshold only makes
// the character eligible (eshyra-lupf.7), and applying the level-up is a
// separate deterministic step (eshyra-lupf.8). So every award row records the
// current level as its `resultingLevel`.

/** Result of an {@link awardXp} mutation. */
export interface AwardXpResult {
  readonly previousXp: number;
  readonly newXp: number;
  /** Character level after the award — unchanged; awards never level up. */
  readonly level: number;
  readonly event: ProgressionEventRecord;
}

/** Result of a {@link grantMilestone} mutation. */
export interface GrantMilestoneResult {
  /** Character level after the grant — unchanged; grants never level up. */
  readonly level: number;
  readonly event: ProgressionEventRecord;
}

/**
 * Award experience points to a character. Valid only in XP mode: the campaign
 * advancement policy is consulted and this **fails closed** under a
 * milestone-mode (or otherwise non-XP) policy rather than silently writing an
 * XP total that mode never consults.
 *
 * The new XP total is written through the validated `current_xp` mutateState
 * seam and an `xp-award` ledger row is appended in the same transaction, so the
 * persisted total and its audit row can never diverge.
 *
 * @param amount  XP to add; must be a positive integer.
 * @param source  Who/what caused the award (encounter, quest, DM ruling, …).
 * @throws {MutateStateError} if `amount` is not a positive integer.
 * @throws {ProgressionError} if the campaign is not in XP mode.
 */
export function awardXp(
  db: Db,
  amount: number,
  source: string,
  ctx: DomainMutationContext,
): AwardXpResult {
  if (!Number.isInteger(amount) || amount <= 0) {
    throw new MutateStateError('award_xp amount must be a positive integer');
  }

  return withTransaction(db, (txnDb) => {
    const policy = resolveCampaignAdvancementPolicy(txnDb);
    if (policy.mode !== 'xp') {
      throw new ProgressionError(
        `cannot award XP under '${policy.mode}' advancement mode; ` +
          'use grantMilestone for milestone-mode campaigns',
      );
    }

    const charId = resolveCharacterId(txnDb, ctx.characterId);
    const before = getProgressionState(txnDb, charId);
    const newXp = before.currentXp + amount;

    mutateState(txnDb, {
      target: 'character',
      id: charId,
      field: 'current_xp',
      op: 'set',
      value: newXp,
      ...ctx,
    });

    const event = recordProgressionEvent(txnDb, {
      characterId: charId,
      kind: 'xp-award',
      amount,
      source,
      resultingXp: newXp,
      resultingLevel: before.level,
      occurredAt: ctx.at,
      provenance: ctx.provenance,
      sessionId: ctx.sessionId,
    });

    return {
      previousXp: before.currentXp,
      newXp,
      level: before.level,
      event,
    };
  });
}

/**
 * Grant a milestone to a character. Valid only in milestone mode: the campaign
 * advancement policy is consulted and this **fails closed** under an XP-mode
 * policy rather than recording a milestone the campaign never consults.
 *
 * A milestone has no XP total; the grant is recorded purely as an append-only
 * `milestone-award` ledger row (the ledger is the milestone's durable state).
 * Eligibility from an outstanding milestone is computed downstream
 * (eshyra-lupf.7).
 *
 * @param milestoneLabel  Human-readable description of the milestone.
 * @param source          Who/what granted it (DM ruling, quest, …).
 * @throws {MutateStateError} if `milestoneLabel` is empty.
 * @throws {ProgressionError} if the campaign is not in milestone mode.
 */
export function grantMilestone(
  db: Db,
  milestoneLabel: string,
  source: string,
  ctx: DomainMutationContext,
): GrantMilestoneResult {
  if (
    typeof milestoneLabel !== 'string' ||
    milestoneLabel.trim().length === 0
  ) {
    throw new MutateStateError('milestone label must be a non-empty string');
  }

  return withTransaction(db, (txnDb) => {
    const policy = resolveCampaignAdvancementPolicy(txnDb);
    if (policy.mode !== 'milestone') {
      throw new ProgressionError(
        `cannot grant a milestone under '${policy.mode}' advancement mode; ` +
          'use awardXp for XP-mode campaigns',
      );
    }

    const charId = resolveCharacterId(txnDb, ctx.characterId);
    const before = getProgressionState(txnDb, charId);

    const event = recordProgressionEvent(txnDb, {
      characterId: charId,
      kind: 'milestone-award',
      milestoneLabel,
      source,
      resultingLevel: before.level,
      occurredAt: ctx.at,
      provenance: ctx.provenance,
      sessionId: ctx.sessionId,
    });

    return { level: before.level, event };
  });
}

function readConditions(
  db: Db,
  characterId: string,
): CharacterConditionEntry[] {
  const row = db
    .prepare('SELECT conditions_json FROM character WHERE id = ?')
    .get(characterId) as { conditions_json: string } | undefined;

  if (row === undefined) {
    throw new MutateStateError('no character row exists');
  }

  return JSON.parse(row.conditions_json) as CharacterConditionEntry[];
}
