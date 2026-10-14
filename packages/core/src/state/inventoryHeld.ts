import type { Db } from '../persistence/db.js';
import { withTransaction } from '../persistence/db.js';
import { resolveCharacterId } from './activeCharacter.js';

export interface InventoryHeldContext {
  readonly provenance: string;
  readonly sessionId: string;
  readonly at: string;
  readonly characterId?: string;
}

export interface InventoryHeldInput extends InventoryHeldContext {
  readonly itemId: string;
  readonly characterRef?: string;
}

export interface InventoryHeldResult {
  readonly itemId: string;
  readonly characterId: string;
  readonly held: boolean;
}

export class InventoryHeldError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InventoryHeldError';
  }
}

function setHeld(
  db: Db,
  input: InventoryHeldInput,
  held: boolean,
): InventoryHeldResult {
  return withTransaction(db, (txnDb) => {
    const characterId = resolveCharacterId(
      txnDb,
      input.characterRef ?? input.characterId,
    );
    const item = txnDb
      .prepare('SELECT id, character_id FROM inventory WHERE id=?')
      .get(input.itemId) as
      | { id: string; character_id: string | null }
      | undefined;
    if (item === undefined)
      throw new InventoryHeldError(
        `inventory item '${input.itemId}' does not exist`,
      );
    if (item.character_id !== characterId)
      throw new InventoryHeldError(
        `character '${characterId}' does not hold inventory item '${input.itemId}'`,
      );
    const current = txnDb
      .prepare(
        'SELECT held FROM inventory_wear_state WHERE inventory_id=? AND character_id=?',
      )
      .get(input.itemId, characterId) as { held: number } | undefined;
    if (current === undefined)
      throw new InventoryHeldError(
        `inventory item '${input.itemId}' has ambiguous legacy placement; authoritative hold state is unavailable, so ${held ? 'hold' : 'stow'} fails closed`,
      );
    if (Boolean(current.held) === held)
      throw new InventoryHeldError(
        `inventory item '${input.itemId}' is already ${held ? 'held' : 'stowed'}`,
      );
    txnDb
      .prepare(
        `UPDATE inventory_wear_state
         SET held=?, provenance=?, session_id=?, updated_at=?
         WHERE inventory_id=? AND character_id=?`,
      )
      .run(
        held ? 1 : 0,
        input.provenance,
        input.sessionId,
        input.at,
        input.itemId,
        characterId,
      );
    return { itemId: input.itemId, characterId, held };
  });
}

export function holdItem(
  db: Db,
  input: InventoryHeldInput,
): InventoryHeldResult {
  return setHeld(db, input, true);
}

export function stowItem(
  db: Db,
  input: InventoryHeldInput,
): InventoryHeldResult {
  return setHeld(db, input, false);
}

export function isInventoryItemHeld(
  db: Db,
  itemId: string,
  characterId: string,
): boolean {
  const row = db
    .prepare(
      'SELECT held FROM inventory_wear_state WHERE inventory_id=? AND character_id=?',
    )
    .get(itemId, characterId) as { held: number } | undefined;
  return row?.held === 1;
}
