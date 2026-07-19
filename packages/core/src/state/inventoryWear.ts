import type { Db } from '../persistence/db.js';
import { withTransaction } from '../persistence/db.js';
import { effectiveMagicItemMechanics } from '../rules/magicItemVariants.js';
import { resolveCharacterId } from './activeCharacter.js';
import {
  assertInventoryCurseCustodyReady,
  MagicItemCustodyError,
} from './attunement.js';
import type { CampaignRulesPackResolver } from './campaignRecordLookup.js';
import { lookupStrictCampaignRecord } from './campaignRecordLookup.js';
import { addCondition } from './domainMutations.js';

export type InventoryWearState = 'worn' | 'not_worn';

export interface InventoryWearContext {
  readonly provenance: string;
  readonly sessionId: string;
  readonly at: string;
  readonly characterId?: string;
  readonly resolveRulesPack?: CampaignRulesPackResolver;
}

export interface InventoryWearInput extends InventoryWearContext {
  readonly itemId: string;
  readonly characterRef?: string;
}

export interface InventoryWearResult {
  readonly itemId: string;
  readonly characterId: string;
  readonly wearState: InventoryWearState;
  readonly curseStateAttached?: string;
}

export class InventoryWearError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InventoryWearError';
  }
}

function transition(
  db: Db,
  input: InventoryWearInput,
  target: InventoryWearState,
): InventoryWearResult {
  return withTransaction(db, (txnDb) => {
    const characterId = resolveCharacterId(
      txnDb,
      input.characterRef ?? input.characterId,
    );
    const item = txnDb
      .prepare(
        `SELECT id, character_id, pack_ref, variant_id
         FROM inventory WHERE id=?`,
      )
      .get(input.itemId) as
      | {
          id: string;
          character_id: string | null;
          pack_ref: string | null;
          variant_id: string | null;
        }
      | undefined;
    if (item === undefined)
      throw new InventoryWearError(
        `inventory item '${input.itemId}' does not exist`,
      );
    if (item.character_id !== characterId)
      throw new InventoryWearError(
        `character '${characterId}' does not hold inventory item '${input.itemId}'`,
      );
    const current = txnDb
      .prepare(
        'SELECT wear_state FROM inventory_wear_state WHERE inventory_id=? AND character_id=?',
      )
      .get(input.itemId, characterId) as
      | { wear_state: InventoryWearState }
      | undefined;
    if (current === undefined)
      throw new InventoryWearError(
        `inventory item '${input.itemId}' has ambiguous legacy placement; authoritative don/doff state is unavailable, so '${target === 'worn' ? 'don' : 'doff'}' fails closed`,
      );
    if (current.wear_state === target)
      throw new InventoryWearError(
        `inventory item '${input.itemId}' is already ${target === 'worn' ? 'worn' : 'not worn'}`,
      );

    if (target === 'not_worn') {
      try {
        assertInventoryCurseCustodyReady(
          txnDb,
          input.itemId,
          'doff',
          input.resolveRulesPack,
        );
      } catch (error) {
        if (error instanceof MagicItemCustodyError)
          throw new InventoryWearError(error.message);
        throw error;
      }
    }

    let curseStateAttached: string | undefined;
    if (target === 'worn' && item.pack_ref !== null) {
      const onset = findDonCurseState(
        txnDb,
        item.pack_ref,
        item.variant_id,
        input.resolveRulesPack,
      );
      if (onset !== undefined) {
        addCondition(
          txnDb,
          { id: onset },
          {
            provenance: input.provenance,
            sessionId: input.sessionId,
            at: input.at,
            characterId,
          },
        );
        curseStateAttached = onset;
      }
    }
    txnDb
      .prepare(
        `UPDATE inventory_wear_state
         SET wear_state=?, provenance=?, session_id=?, updated_at=?
         WHERE inventory_id=? AND character_id=?`,
      )
      .run(
        target,
        input.provenance,
        input.sessionId,
        input.at,
        input.itemId,
        characterId,
      );
    return {
      itemId: input.itemId,
      characterId,
      wearState: target,
      ...(curseStateAttached === undefined ? {} : { curseStateAttached }),
    };
  });
}

function findDonCurseState(
  db: Db,
  packRef: string,
  variantId: string | null,
  resolveRulesPack: CampaignRulesPackResolver | undefined,
): string | undefined {
  // Keep record resolution and variant selection in the existing attunement
  // boundary. A failed resolution is a hard error, never an inferred curse.
  const resolved = lookupStrictCampaignRecord(
    db,
    'magic-item',
    packRef,
    resolveRulesPack,
  )?.record;
  if (resolved === undefined)
    throw new InventoryWearError(
      `inventory packRef '${packRef}' cannot resolve for don`,
    );
  const state = effectiveMagicItemMechanics(
    resolved,
    variantId ?? undefined,
  )?.curse?.stateDefinitions?.find(
    (candidate) =>
      candidate.onset === 'don the armor' || candidate.onset.startsWith('don '),
  );
  return state?.id;
}

export function donItem(
  db: Db,
  input: InventoryWearInput,
): InventoryWearResult {
  return transition(db, input, 'worn');
}

export function doffItem(
  db: Db,
  input: InventoryWearInput,
): InventoryWearResult {
  return transition(db, input, 'not_worn');
}

export function getInventoryWearState(
  db: Db,
  itemId: string,
): InventoryWearState | undefined {
  return (
    db
      .prepare(
        'SELECT wear_state FROM inventory_wear_state WHERE inventory_id=?',
      )
      .get(itemId) as { wear_state: InventoryWearState } | undefined
  )?.wear_state;
}
