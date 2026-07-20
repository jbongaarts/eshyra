import type { Rng } from '../orchestrator/rng.js';
import type { Db } from '../persistence/db.js';
import { withTransaction } from '../persistence/db.js';
import { lookupRulesRecord } from '../rules/lookup.js';
import {
  magicItemVariantTypeKey,
  resolveMagicItemVariant,
} from '../rules/magicItemVariants.js';
import type { RulesRecord } from '../rules/types.js';
import {
  AttunementError,
  resolveCanonicalAttunementContract,
} from './attunement.js';
import {
  type CampaignRulesPackResolver,
  lookupStrictCampaignRecord,
} from './campaignRecordLookup.js';
import {
  clearItemAdoptionReview,
  type ItemAdoptionResolution,
  type ItemAdoptionReviewKind,
  readItemAdoptionReview,
  recordItemAdoptionResolution,
  requiredItemAdoptionResolutionAction,
  writeItemAdoptionReview,
} from './itemAdoptionReview.js';
import {
  createInitialItemState,
  type ItemInstanceState,
  isStatefulMagicItem,
  validateItemStateForRecord,
  validatePackRef,
  writeItemState,
} from './itemState.js';

type Obj = Record<string, unknown>;

/**
 * A single compatibility action may materialize at most this many stateful
 * instances. Larger historical stacks need a reviewed GM reconciliation so a
 * malformed quantity cannot drive unbounded rows, RNG draws, or state writes.
 */
export const MAX_MAGIC_ITEM_ADOPTION_SINGLETONS = 100;

interface LegacyInventoryRow {
  readonly id: string;
  readonly character_id: string | null;
  readonly name: string;
  quantity: number;
  readonly location: string | null;
  readonly world_location_id: string | null;
  readonly properties_json: string;
  readonly pack_ref: string | null;
  readonly variant_id: string | null;
}

export interface AdoptMagicItemInput {
  readonly campaignId: string;
  readonly inventoryId: string;
  readonly characterId: string;
  readonly packRef: string;
  readonly variantId?: string;
  /** Typed GM reconciliation applied atomically before canonical adoption. */
  readonly resolution?: ItemAdoptionResolution;
  readonly resolveRulesPack?: CampaignRulesPackResolver;
  readonly rng?: Rng;
  readonly provenance: string;
  readonly sessionId: string;
  readonly at: string;
}

export interface AdoptMagicItemResult {
  readonly adopted: boolean;
  readonly reviewRequired: boolean;
  readonly originalInstanceId: string;
  readonly instanceIds: readonly string[];
  readonly packRef: string;
  readonly variantId?: string;
  readonly stateful: boolean;
  readonly alreadyBound?: boolean;
  readonly liftedLegacyState?: boolean;
  readonly reason?: string;
  readonly reviewKind?: ItemAdoptionReviewKind;
  readonly requiredResolutionAction?: ItemAdoptionResolution['action'];
}

export class ItemAdoptionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ItemAdoptionError';
  }
}

function object(value: unknown, path: string): Obj {
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    throw new ItemAdoptionError(`${path} must be an object`);
  return value as Obj;
}

function decodeInventoryProperties(row: LegacyInventoryRow): Obj {
  let decoded: unknown;
  try {
    decoded = JSON.parse(row.properties_json) as unknown;
  } catch {
    throw new ItemAdoptionError(
      `inventory[${row.id}].properties_json contains invalid JSON`,
    );
  }
  return object(decoded, `inventory[${row.id}].properties_json`);
}

function nextSplitId(db: Db, sourceId: string, ordinal: number): string {
  let suffix = ordinal;
  while (true) {
    const candidate = `${sourceId}#${suffix}`;
    if (
      db.prepare('SELECT 1 FROM inventory WHERE id = ?').get(candidate) ===
      undefined
    )
      return candidate;
    suffix += 1;
  }
}

function compatibleLegacyState(
  value: unknown,
  packRef: string,
  variantId: string | undefined,
  record: Parameters<typeof validateItemStateForRecord>[2],
  resolveTable: (ref: string) => RulesRecord | undefined,
): ItemInstanceState {
  const raw = object(value, 'legacy magic-item mechanics');
  const candidate = {
    ...raw,
    packRef: raw.packRef === undefined ? packRef : raw.packRef,
    ...(raw.variantId === undefined && variantId !== undefined
      ? { variantId }
      : {}),
  };
  return validateItemStateForRecord(candidate, packRef, record, variantId, {
    resolveTable,
  });
}

function persistReviewResult(
  db: Db,
  row: LegacyInventoryRow,
  properties: Obj,
  input: AdoptMagicItemInput,
  packRef: string,
  stateful: boolean,
  reviewKind: ItemAdoptionReviewKind,
  reason: string,
  rawPropertiesJson?: string,
): AdoptMagicItemResult {
  const persistedStateRow = db
    .prepare('SELECT state_json FROM item_state WHERE inventory_id=?')
    .get(row.id) as { state_json: string } | undefined;
  const adoptedProperties = Object.fromEntries(
    Object.entries(properties).filter(
      ([key]) => key !== 'mechanics' && key !== 'magicItemAdoption',
    ),
  );
  writeItemAdoptionReview(db, {
    inventoryId: row.id,
    requestedPackRef: packRef,
    ...(input.variantId === undefined
      ? {}
      : { requestedVariantId: input.variantId }),
    reviewKind,
    reason,
    ...(rawPropertiesJson === undefined && properties.mechanics === undefined
      ? {}
      : { rawPropertiesJson: rawPropertiesJson ?? row.properties_json }),
    ...(persistedStateRow === undefined
      ? {}
      : { rawItemStateJson: persistedStateRow.state_json }),
    provenance: input.provenance,
    sessionId: input.sessionId,
    at: input.at,
  });
  db.prepare(
    `UPDATE inventory
     SET properties_json=?, provenance=?, session_id=?, updated_at=?
     WHERE id=? AND character_id=? AND pack_ref IS NULL`,
  ).run(
    JSON.stringify(adoptedProperties),
    input.provenance,
    input.sessionId,
    input.at,
    row.id,
    input.characterId,
  );
  if (persistedStateRow !== undefined)
    db.prepare('DELETE FROM item_state WHERE inventory_id=?').run(row.id);
  return {
    adopted: false,
    reviewRequired: true,
    originalInstanceId: row.id,
    instanceIds: [row.id],
    packRef,
    ...(input.variantId === undefined ? {} : { variantId: input.variantId }),
    stateful,
    reason,
    reviewKind,
    requiredResolutionAction: requiredItemAdoptionResolutionAction(reviewKind),
  };
}

function reviewResultOrFail(
  db: Db,
  row: LegacyInventoryRow,
  properties: Obj,
  input: AdoptMagicItemInput,
  packRef: string,
  stateful: boolean,
  reviewKind: ItemAdoptionReviewKind,
  reason: string,
  rawPropertiesJson?: string,
): AdoptMagicItemResult {
  if (input.resolution !== undefined)
    throw new ItemAdoptionError(
      `review resolution '${input.resolution.action}' did not resolve the quarantined structure: ${reason}`,
    );
  return persistReviewResult(
    db,
    row,
    properties,
    input,
    packRef,
    stateful,
    reviewKind,
    reason,
    rawPropertiesJson,
  );
}

/**
 * Bind an explicitly recognized legacy inventory row to one exact record in
 * the active campaign stack. This operation deliberately never guesses by
 * display name: the caller owns recognition and supplies the canonical ref.
 */
export function adoptMagicItem(
  db: Db,
  input: AdoptMagicItemInput,
): AdoptMagicItemResult {
  return withTransaction(db, (txnDb) => {
    const packRef = validatePackRef(input.packRef, 'adopt_item.packRef');
    const hit = lookupStrictCampaignRecord(
      txnDb,
      'magic-item',
      packRef,
      input.resolveRulesPack,
    );
    if (hit === undefined)
      throw new ItemAdoptionError(
        `packRef '${packRef}' does not resolve in the active campaign rules stack`,
      );
    const variant = resolveMagicItemVariant(hit.record, input.variantId);
    const variantId = variant?.id;
    const stateful = isStatefulMagicItem(hit.record, variantId);
    const row = txnDb
      .prepare(
        `SELECT id, character_id, name, quantity, location, world_location_id,
                properties_json, pack_ref, variant_id
         FROM inventory WHERE id = ?`,
      )
      .get(input.inventoryId) as LegacyInventoryRow | undefined;
    if (row === undefined)
      throw new ItemAdoptionError(
        `inventory instance '${input.inventoryId}' does not exist`,
      );
    if (row.character_id !== input.characterId)
      throw new ItemAdoptionError(
        `character '${input.characterId}' does not hold inventory instance '${input.inventoryId}'`,
      );
    if (row.world_location_id !== null)
      throw new ItemAdoptionError(
        `held inventory instance '${input.inventoryId}' has invalid world placement`,
      );
    const existingReview = readItemAdoptionReview(txnDb, row.id);
    if (
      !Number.isInteger(row.quantity) ||
      (row.quantity < 1 &&
        !(
          row.quantity === 0 &&
          existingReview !== undefined &&
          input.resolution !== undefined
        ))
    )
      throw new ItemAdoptionError(
        `inventory instance '${input.inventoryId}' must have a positive integer quantity`,
      );
    if (
      existingReview !== undefined &&
      (existingReview.requestedPackRef !== packRef ||
        existingReview.requestedVariantId !== variantId)
    )
      throw new ItemAdoptionError(
        `inventory instance '${row.id}' is quarantined for exact identity '${existingReview.requestedPackRef}'${existingReview.requestedVariantId === undefined ? '' : ` variant '${existingReview.requestedVariantId}'`}; resolve that reviewed identity rather than substituting '${packRef}'${variantId === undefined ? '' : ` variant '${variantId}'`}`,
      );
    if (existingReview !== undefined && input.resolution === undefined)
      return {
        adopted: false,
        reviewRequired: true,
        originalInstanceId: row.id,
        instanceIds: [row.id],
        packRef: existingReview.requestedPackRef,
        ...(existingReview.requestedVariantId === undefined
          ? {}
          : { variantId: existingReview.requestedVariantId }),
        stateful,
        reason: existingReview.reason,
        reviewKind: existingReview.reviewKind,
        requiredResolutionAction: requiredItemAdoptionResolutionAction(
          existingReview.reviewKind,
        ),
      };
    if (existingReview === undefined && input.resolution !== undefined)
      throw new ItemAdoptionError(
        `inventory instance '${row.id}' has no adoption review to resolve`,
      );
    let discardedStructureJson: string | undefined;
    if (existingReview !== undefined && input.resolution !== undefined) {
      const resolution = input.resolution;
      if (
        typeof resolution.evidence !== 'string' ||
        resolution.evidence.trim().length === 0
      )
        throw new ItemAdoptionError(
          'review resolution requires non-empty GM evidence',
        );
      const expectedAction = requiredItemAdoptionResolutionAction(
        existingReview.reviewKind,
      );
      if (resolution.action !== expectedAction)
        throw new ItemAdoptionError(
          `review kind '${existingReview.reviewKind}' requires resolution action '${expectedAction}', not '${resolution.action}'`,
        );
      switch (resolution.action) {
        case 'discard-evidence':
          if (
            existingReview.rawPropertiesJson === undefined &&
            existingReview.rawItemStateJson === undefined
          )
            throw new ItemAdoptionError(
              'discard-evidence requires quarantined raw properties or item state',
            );
          discardedStructureJson = JSON.stringify({
            rawPropertiesJson: existingReview.rawPropertiesJson ?? null,
            rawItemStateJson: existingReview.rawItemStateJson ?? null,
          });
          break;
        case 'set-reviewed-quantity':
          if (row.quantity <= MAX_MAGIC_ITEM_ADOPTION_SINGLETONS)
            throw new ItemAdoptionError(
              `set-reviewed-quantity applies only to a quarantined stack above ${MAX_MAGIC_ITEM_ADOPTION_SINGLETONS}`,
            );
          if (
            !Number.isInteger(resolution.quantity) ||
            (resolution.quantity as number) < 1 ||
            (resolution.quantity as number) > MAX_MAGIC_ITEM_ADOPTION_SINGLETONS
          )
            throw new ItemAdoptionError(
              `reviewed quantity must be an integer from 1 to ${MAX_MAGIC_ITEM_ADOPTION_SINGLETONS}`,
            );
          discardedStructureJson = JSON.stringify({
            previousQuantity: row.quantity,
          });
          txnDb
            .prepare('UPDATE inventory SET quantity=? WHERE id=?')
            .run(resolution.quantity, row.id);
          row.quantity = resolution.quantity as number;
          break;
        case 'discard-legacy-attunement': {
          const attunements = txnDb
            .prepare(
              `SELECT campaign_id, character_id, item_id, item_key,
                      display_name, attuned_at, provenance, session_id,
                      updated_at
               FROM attunement WHERE item_id=?`,
            )
            .all(row.id) as Record<string, unknown>[];
          if (attunements.length === 0)
            throw new ItemAdoptionError(
              'discard-legacy-attunement requires a quarantined legacy bond',
            );
          discardedStructureJson = JSON.stringify({ attunements });
          txnDb.prepare('DELETE FROM attunement WHERE item_id=?').run(row.id);
          break;
        }
        case 'discard-legacy-counter': {
          const counters = txnDb
            .prepare(
              `SELECT * FROM entity_usage_counter
               WHERE owner_kind='item' AND owner_ref=?
               ORDER BY campaign_id, counter_key`,
            )
            .all(row.id) as Record<string, unknown>[];
          if (counters.length === 0)
            throw new ItemAdoptionError(
              'discard-legacy-counter requires a quarantined item counter',
            );
          discardedStructureJson = JSON.stringify({ counters });
          txnDb
            .prepare(
              `DELETE FROM entity_usage_counter
               WHERE owner_kind='item' AND owner_ref=?`,
            )
            .run(row.id);
          break;
        }
      }
    }
    if (
      row.quantity === 0 &&
      existingReview !== undefined &&
      input.resolution !== undefined
    ) {
      // Attunement has no FK to inventory, and end_attunement is itself
      // blocked by this quarantine — so reconcile any surviving legacy
      // attunement here, atomically: preserve it in the append-only
      // discarded-structure evidence, then delete it with the empty row.
      const survivingAttunements = txnDb
        .prepare(
          `SELECT * FROM attunement WHERE item_id=?
           ORDER BY campaign_id, character_id`,
        )
        .all(row.id) as Record<string, unknown>[];
      if (survivingAttunements.length > 0) {
        const discardedBase =
          discardedStructureJson === undefined
            ? {}
            : (JSON.parse(discardedStructureJson) as Record<string, unknown>);
        discardedStructureJson = JSON.stringify({
          ...discardedBase,
          attunements: survivingAttunements,
        });
        txnDb.prepare('DELETE FROM attunement WHERE item_id=?').run(row.id);
      }
      recordItemAdoptionResolution(txnDb, {
        inventoryId: row.id,
        action: input.resolution.action,
        evidence: input.resolution.evidence,
        previousReview: existingReview,
        resultingPackRef: packRef,
        ...(variantId === undefined ? {} : { resultingVariantId: variantId }),
        ...(discardedStructureJson === undefined
          ? {}
          : { discardedStructureJson }),
        provenance: input.provenance,
        sessionId: input.sessionId,
        at: input.at,
      });
      clearItemAdoptionReview(txnDb, row.id);
      txnDb.prepare('DELETE FROM inventory WHERE id=?').run(row.id);
      return {
        adopted: true,
        reviewRequired: false,
        originalInstanceId: row.id,
        instanceIds: [],
        packRef,
        ...(variantId === undefined ? {} : { variantId }),
        stateful,
      };
    }
    const attunementRows = txnDb
      .prepare(
        `SELECT campaign_id, character_id FROM attunement
         WHERE item_id=?`,
      )
      .all(row.id) as { campaign_id: string; character_id: string }[];
    const staleAttunement = attunementRows.find(
      ({ campaign_id, character_id }) =>
        campaign_id !== input.campaignId || character_id !== input.characterId,
    );
    if (staleAttunement !== undefined)
      throw new ItemAdoptionError(
        `inventory instance '${row.id}' has attunement outside asserted campaign '${input.campaignId}' and holder '${input.characterId}' (found campaign '${staleAttunement.campaign_id}', character '${staleAttunement.character_id}')`,
      );
    if (row.pack_ref !== null) {
      if (row.pack_ref !== packRef || row.variant_id !== (variantId ?? null))
        throw new ItemAdoptionError(
          `inventory instance '${input.inventoryId}' is already bound to a different canonical item`,
        );
      if (stateful && row.quantity !== 1)
        throw new ItemAdoptionError(
          `bound stateful inventory instance '${input.inventoryId}' must have quantity 1`,
        );
      if (existingReview !== undefined && input.resolution !== undefined)
        recordItemAdoptionResolution(txnDb, {
          inventoryId: row.id,
          action: input.resolution.action,
          evidence: input.resolution.evidence,
          previousReview: existingReview,
          resultingPackRef: packRef,
          ...(variantId === undefined ? {} : { resultingVariantId: variantId }),
          ...(input.resolution.quantity === undefined
            ? {}
            : { reviewedQuantity: input.resolution.quantity }),
          ...(discardedStructureJson === undefined
            ? {}
            : { discardedStructureJson }),
          provenance: input.provenance,
          sessionId: input.sessionId,
          at: input.at,
        });
      clearItemAdoptionReview(txnDb, row.id);
      return {
        adopted: true,
        reviewRequired: false,
        originalInstanceId: row.id,
        instanceIds: [row.id],
        packRef,
        ...(variantId === undefined ? {} : { variantId }),
        stateful,
        alreadyBound: true,
      };
    }

    const rehydrateReviewedEvidence =
      existingReview !== undefined &&
      input.resolution !== undefined &&
      input.resolution.action !== 'discard-evidence';
    const propertiesRow =
      rehydrateReviewedEvidence &&
      existingReview.rawPropertiesJson !== undefined
        ? { ...row, properties_json: existingReview.rawPropertiesJson }
        : row;
    let properties: Obj;
    try {
      properties = decodeInventoryProperties(propertiesRow);
    } catch (error) {
      if (error instanceof ItemAdoptionError)
        return reviewResultOrFail(
          txnDb,
          row,
          {},
          input,
          packRef,
          stateful,
          'malformed-evidence',
          error.message,
          propertiesRow.properties_json,
        );
      throw error;
    }
    if (stateful && row.quantity > MAX_MAGIC_ITEM_ADOPTION_SINGLETONS)
      return reviewResultOrFail(
        txnDb,
        row,
        properties,
        input,
        packRef,
        stateful,
        'oversized-stack',
        `stateful legacy stack quantity ${row.quantity} exceeds the reviewed adoption maximum of ${MAX_MAGIC_ITEM_ADOPTION_SINGLETONS} singleton instances`,
      );
    const legacyPropertiesState = properties.mechanics;
    const legacyCounter = txnDb
      .prepare(
        `SELECT counter_key FROM entity_usage_counter
         WHERE owner_kind='item' AND owner_ref=?
         ORDER BY campaign_id, counter_key LIMIT 1`,
      )
      .get(row.id) as { counter_key: string } | undefined;
    if (legacyCounter !== undefined)
      return reviewResultOrFail(
        txnDb,
        row,
        properties,
        input,
        packRef,
        stateful,
        'legacy-counter',
        `legacy item usage counter '${legacyCounter.counter_key}' requires GM reconciliation before canonical binding`,
      );
    const persistedStateRow =
      rehydrateReviewedEvidence && existingReview.rawItemStateJson !== undefined
        ? { state_json: existingReview.rawItemStateJson }
        : (txnDb
            .prepare('SELECT state_json FROM item_state WHERE inventory_id = ?')
            .get(row.id) as { state_json: string } | undefined);
    if (legacyPropertiesState !== undefined && persistedStateRow !== undefined)
      return reviewResultOrFail(
        txnDb,
        row,
        properties,
        input,
        packRef,
        stateful,
        'malformed-evidence',
        'multiple legacy mechanics sources require GM reconciliation',
      );
    let persistedState: unknown;
    if (persistedStateRow !== undefined) {
      try {
        persistedState = JSON.parse(persistedStateRow.state_json) as unknown;
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        return reviewResultOrFail(
          txnDb,
          row,
          properties,
          input,
          packRef,
          stateful,
          'malformed-evidence',
          `persisted legacy item state is not valid JSON: ${detail}`,
        );
      }
    }
    const legacyState = legacyPropertiesState ?? persistedState;
    if (!stateful && legacyState !== undefined)
      return reviewResultOrFail(
        txnDb,
        row,
        properties,
        input,
        packRef,
        stateful,
        'malformed-evidence',
        'the selected canonical item is stateless and cannot license legacy mechanics',
      );

    const resolveTable = (ref: string) => {
      const result = lookupRulesRecord(hit.stack, { kind: 'table', ref });
      return result.ok ? result.record : undefined;
    };
    if (attunementRows.length > 0) {
      let canonicalType: string;
      try {
        canonicalType = resolveCanonicalAttunementContract(
          hit.record,
          variantId,
          row.name,
        ).itemKey;
      } catch (error) {
        if (error instanceof AttunementError)
          return reviewResultOrFail(
            txnDb,
            row,
            properties,
            input,
            packRef,
            stateful,
            'legacy-attunement',
            `legacy attunement cannot cross the canonical attunement boundary: ${error.message}`,
          );
        throw error;
      }
      const duplicate = txnDb
        .prepare(
          `SELECT item_id FROM attunement
           WHERE campaign_id=? AND character_id=? AND item_key=? AND item_id!=?
           LIMIT 1`,
        )
        .get(input.campaignId, input.characterId, canonicalType, row.id) as
        | { item_id: string }
        | undefined;
      if (duplicate !== undefined)
        throw new ItemAdoptionError(
          `canonical adoption would duplicate an existing attunement to '${canonicalType}' on item '${duplicate.item_id}'`,
        );
    }
    let lifted: ItemInstanceState | undefined;
    if (legacyState !== undefined) {
      try {
        lifted = compatibleLegacyState(
          legacyState,
          packRef,
          variantId,
          hit.record,
          resolveTable,
        );
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        return reviewResultOrFail(
          txnDb,
          row,
          properties,
          input,
          packRef,
          stateful,
          'malformed-evidence',
          `legacy mechanics are not licensed by the selected canonical item: ${detail}`,
        );
      }
    }

    const adoptedProperties = Object.fromEntries(
      Object.entries(properties).filter(
        ([key]) => key !== 'mechanics' && key !== 'magicItemAdoption',
      ),
    );
    txnDb
      .prepare(
        `UPDATE inventory
         SET quantity=?, properties_json=?, pack_ref=?, variant_id=?,
             provenance=?, session_id=?, updated_at=?
         WHERE id=? AND character_id=? AND pack_ref IS NULL`,
      )
      .run(
        stateful ? 1 : row.quantity,
        JSON.stringify(adoptedProperties),
        packRef,
        variantId ?? null,
        input.provenance,
        input.sessionId,
        input.at,
        row.id,
        input.characterId,
      );

    const instanceIds = [row.id];
    for (let ordinal = 2; stateful && ordinal <= row.quantity; ordinal += 1) {
      const id = nextSplitId(txnDb, row.id, ordinal);
      txnDb
        .prepare(
          `INSERT INTO inventory(
             id, character_id, name, quantity, location, world_location_id,
             properties_json, provenance, session_id, updated_at, pack_ref,
             variant_id
           ) VALUES (?, ?, ?, 1, ?, NULL, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          id,
          input.characterId,
          row.name,
          row.location,
          JSON.stringify(adoptedProperties),
          input.provenance,
          input.sessionId,
          input.at,
          packRef,
          variantId ?? null,
        );
      instanceIds.push(id);
    }

    for (const id of instanceIds) {
      txnDb
        .prepare(
          `INSERT OR IGNORE INTO inventory_wear_state(
             inventory_id, character_id, wear_state, provenance, session_id, updated_at
           ) VALUES (?, ?, 'not_worn', ?, ?, ?)`,
        )
        .run(
          id,
          input.characterId,
          input.provenance,
          input.sessionId,
          input.at,
        );
    }

    if (stateful) {
      for (const [index, id] of instanceIds.entries()) {
        const state =
          index === 0 && lifted !== undefined
            ? lifted
            : createInitialItemState(packRef, hit.record, {
                variantId,
                rng: input.rng,
                resolveTable,
              });
        writeItemState(txnDb, id, state, input);
      }
    }

    txnDb
      .prepare(
        `UPDATE attunement
         SET item_key=?, display_name=?, provenance=?, session_id=?, updated_at=?
         WHERE campaign_id=? AND item_id=?`,
      )
      .run(
        magicItemVariantTypeKey(packRef, variantId),
        variant?.name ?? hit.record.name,
        input.provenance,
        input.sessionId,
        input.at,
        input.campaignId,
        row.id,
      );

    if (existingReview !== undefined && input.resolution !== undefined)
      recordItemAdoptionResolution(txnDb, {
        inventoryId: row.id,
        action: input.resolution.action,
        evidence: input.resolution.evidence,
        previousReview: existingReview,
        resultingPackRef: packRef,
        ...(variantId === undefined ? {} : { resultingVariantId: variantId }),
        ...(input.resolution.quantity === undefined
          ? {}
          : { reviewedQuantity: input.resolution.quantity }),
        ...(discardedStructureJson === undefined
          ? {}
          : { discardedStructureJson }),
        provenance: input.provenance,
        sessionId: input.sessionId,
        at: input.at,
      });
    clearItemAdoptionReview(txnDb, row.id);

    return {
      adopted: true,
      reviewRequired: false,
      originalInstanceId: row.id,
      instanceIds,
      packRef,
      ...(variantId === undefined ? {} : { variantId }),
      stateful,
      ...(lifted === undefined ? {} : { liftedLegacyState: true }),
    };
  });
}
