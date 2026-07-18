// Magic-item attunement slot machine (eshyra-2n1t.7, engine family F5;
// source: docs/audits/dnd5e-srd-5.1-final/
// 2026-07-06-o9bd-18-7-8-execution-boundary-classification.md §4).
//
// SRD 5.1 semantics (attunement), code-owned so slots can never be silently
// overdrawn:
//
// - A creature can be attuned to no more than three magic items at a time,
//   and cannot attune to more than one copy of the same item (identity =
//   the resolved magic-item record key, or the normalized item name for
//   items outside the pack).
// - An item can be attuned to only one creature at a time: attuning to an
//   item some other character is still attuned to is refused until that
//   attunement is ended.
// - Whether an item requires attunement comes from the campaign rules
//   stack (`requiresAttunement` on the magic-item record), never from a
//   model-declared flag; an item whose record says it does not require
//   attunement is refused. Items with no resolvable record (module/homebrew
//   magic items) are accepted — the cap and identity rules still bind.
// - Endings are recorded with their SRD reason: voluntary (a short rest
//   spent breaking the bond), 100 ft/24 h separation, death, another
//   creature attuning, or the item being destroyed. Death ends every
//   attunement automatically via the F6 death machine (`hpLifecycle`
//   calls {@link endAllAttunementsOnDeath} when a character dies).
//
// Deliberately NOT code-owned: the short rest spent attuning (a narrated
// process), class/spellcaster prerequisites (`attunementRequirement` is
// surfaced as a note for the DM to adjudicate), and detecting the 100 ft /
// 24 h separation (the engine records the ending, the DM notices it).

import type { Db } from '../persistence/db.js';
import { withTransaction } from '../persistence/db.js';
import { resolveCharacterId } from './activeCharacter.js';
import { lookupCampaignRecord } from './campaignRecordLookup.js';
import type { LifeState } from './hpLifecycle.js';

export const ATTUNEMENT_SLOT_LIMIT = 3;

export type AttunementEndReason =
  | 'voluntary'
  | 'distance'
  | 'death'
  | 'replaced'
  | 'item_destroyed'
  | 'other';

export const ATTUNEMENT_END_REASONS: readonly AttunementEndReason[] = [
  'voluntary',
  'distance',
  'death',
  'replaced',
  'item_destroyed',
  'other',
];

export interface AttunementEntry {
  readonly characterId: string;
  readonly itemId: string;
  readonly itemKey: string;
  readonly displayName: string;
  readonly attunedAt: string;
}

export interface AttunementMutationContext {
  readonly provenance: string;
  readonly sessionId: string;
  readonly at: string;
}

export interface AttuneItemInput extends AttunementMutationContext {
  readonly campaignId: string;
  /** Character ref; defaults to the acting character. */
  readonly characterRef?: string;
  /** Inventory item id — the character must hold the item. */
  readonly itemId: string;
  /** Magic-item record key (e.g. "magic-item:wand-of-fireballs") when the
   *  DM knows it; otherwise the item name is resolved against the pack. */
  readonly itemRef?: string;
}

export interface AttuneItemResult {
  readonly characterId: string;
  readonly characterLabel: string;
  readonly attuned: AttunementEntry;
  readonly slotsUsed: number;
  readonly slotLimit: number;
  readonly attunements: readonly AttunementEntry[];
  /** The record's attunement prerequisite (e.g. "by a spellcaster") when it
   *  carries one — satisfying it stays a DM ruling. */
  readonly prerequisite?: string;
}

export interface EndAttunementInput extends AttunementMutationContext {
  readonly campaignId: string;
  readonly characterRef?: string;
  readonly itemId: string;
  readonly reason: AttunementEndReason;
}

export interface EndAttunementResult {
  readonly characterId: string;
  readonly ended: AttunementEntry;
  readonly reason: AttunementEndReason;
  readonly attunements: readonly AttunementEntry[];
}

export class AttunementError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AttunementError';
  }
}

interface AttunementRow {
  readonly character_id: string;
  readonly item_id: string;
  readonly item_key: string;
  readonly display_name: string;
  readonly attuned_at: string;
}

function rowToEntry(row: AttunementRow): AttunementEntry {
  return {
    characterId: row.character_id,
    itemId: row.item_id,
    itemKey: row.item_key,
    displayName: row.display_name,
    attunedAt: row.attuned_at,
  };
}

function normalizeItemKey(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export function listAttunements(
  db: Db,
  campaignId: string,
  characterId: string,
): AttunementEntry[] {
  const rows = db
    .prepare(
      `SELECT character_id, item_id, item_key, display_name, attuned_at
       FROM attunement
       WHERE campaign_id = ? AND character_id = ?
       ORDER BY attuned_at, item_id`,
    )
    .all(campaignId, characterId) as AttunementRow[];
  return rows.map(rowToEntry);
}

function resolveLivingCharacter(
  db: Db,
  characterRef: string | undefined,
): { id: string; label: string } {
  const charId = resolveCharacterId(db, characterRef);
  const character = db
    .prepare('SELECT name, life_state FROM character WHERE id = ?')
    .get(charId) as { name: string | null; life_state: LifeState } | undefined;
  if (character === undefined) {
    throw new AttunementError(`no character row exists for '${charId}'`);
  }
  if (character.life_state === 'dead') {
    throw new AttunementError(
      `character '${character.name ?? charId}' is dead; the dead hold no attunements`,
    );
  }
  return { id: charId, label: character.name ?? charId };
}

export function attuneItem(db: Db, input: AttuneItemInput): AttuneItemResult {
  return withTransaction(db, (txnDb) => {
    const character = resolveLivingCharacter(txnDb, input.characterRef);

    const item = txnDb
      .prepare(
        'SELECT name, pack_ref FROM inventory WHERE id = ? AND character_id = ?',
      )
      .get(input.itemId, character.id) as
      | { name: string; pack_ref: string | null }
      | undefined;
    if (item === undefined) {
      throw new AttunementError(
        `${character.label} holds no inventory item '${input.itemId}'; attunement requires possessing the item`,
      );
    }

    // Item identity and the requires-attunement gate come from the rules
    // record when one resolves; a homebrew/module item falls back to its
    // normalized name for the no-duplicates rule.
    if (
      item.pack_ref !== null &&
      input.itemRef !== undefined &&
      input.itemRef !== item.pack_ref
    )
      throw new AttunementError(
        `itemRef '${input.itemRef}' does not match inventory packRef '${item.pack_ref}' for '${input.itemId}'`,
      );
    const candidateRef =
      item.pack_ref ??
      input.itemRef ??
      `magic-item:${normalizeItemKey(item.name)}`;
    const record = lookupCampaignRecord(txnDb, 'magic-item', candidateRef);
    if (input.itemRef !== undefined && record === undefined) {
      throw new AttunementError(
        `itemRef '${input.itemRef}' does not resolve to a magic-item record in the campaign rules stack; find the exact key via lookup_rules or omit itemRef`,
      );
    }
    let prerequisite: string | undefined;
    let itemKey = `name:${normalizeItemKey(item.name)}`;
    if (record !== undefined) {
      const data = record.data as Record<string, unknown>;
      if (data.requiresAttunement !== true) {
        throw new AttunementError(
          `'${item.name}' (${record.key}) does not require attunement per its record; its properties work without a slot`,
        );
      }
      itemKey = record.key;
      if (typeof data.attunementRequirement === 'string') {
        prerequisite = data.attunementRequirement;
      }
    }

    const existing = listAttunements(txnDb, input.campaignId, character.id);
    if (existing.some((entry) => entry.itemId === input.itemId)) {
      throw new AttunementError(
        `${character.label} is already attuned to '${item.name}'`,
      );
    }
    if (existing.some((entry) => entry.itemKey === itemKey)) {
      throw new AttunementError(
        `${character.label} is already attuned to a copy of '${item.name}'; a creature cannot attune to more than one copy of the same item`,
      );
    }
    if (existing.length >= ATTUNEMENT_SLOT_LIMIT) {
      throw new AttunementError(
        `${character.label} is already attuned to ${ATTUNEMENT_SLOT_LIMIT} items (${existing
          .map((entry) => entry.displayName)
          .join(', ')}); end one attunement first (end_attunement)`,
      );
    }

    const otherHolder = txnDb
      .prepare(
        `SELECT character_id FROM attunement
         WHERE campaign_id = ? AND item_id = ? AND character_id != ?`,
      )
      .get(input.campaignId, input.itemId, character.id) as
      | { character_id: string }
      | undefined;
    if (otherHolder !== undefined) {
      throw new AttunementError(
        `item '${item.name}' is still attuned to character '${otherHolder.character_id}'; an item can be attuned to only one creature at a time — end that attunement first`,
      );
    }

    txnDb
      .prepare(
        `INSERT INTO attunement(
           campaign_id, character_id, item_id, item_key, display_name,
           attuned_at, provenance, session_id, updated_at
         )
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        input.campaignId,
        character.id,
        input.itemId,
        itemKey,
        item.name,
        input.at,
        input.provenance,
        input.sessionId,
        input.at,
      );

    const attunements = listAttunements(txnDb, input.campaignId, character.id);
    const attuned = attunements.find(
      (entry) => entry.itemId === input.itemId,
    ) as AttunementEntry;
    return {
      characterId: character.id,
      characterLabel: character.label,
      attuned,
      slotsUsed: attunements.length,
      slotLimit: ATTUNEMENT_SLOT_LIMIT,
      attunements,
      ...(prerequisite === undefined ? {} : { prerequisite }),
    };
  });
}

export function endAttunement(
  db: Db,
  input: EndAttunementInput,
): EndAttunementResult {
  if (!ATTUNEMENT_END_REASONS.includes(input.reason)) {
    throw new AttunementError(
      `reason must be one of: ${ATTUNEMENT_END_REASONS.join(', ')}`,
    );
  }
  return withTransaction(db, (txnDb) => {
    // The dead-character guard deliberately does not apply here: ending an
    // attunement (reason 'death' included) is exactly what death requires.
    const charId = resolveCharacterId(txnDb, input.characterRef);
    const row = txnDb
      .prepare(
        `SELECT character_id, item_id, item_key, display_name, attuned_at
         FROM attunement
         WHERE campaign_id = ? AND character_id = ? AND item_id = ?`,
      )
      .get(input.campaignId, charId, input.itemId) as AttunementRow | undefined;
    if (row === undefined) {
      const current = listAttunements(txnDb, input.campaignId, charId);
      throw new AttunementError(
        `no attunement to item '${input.itemId}' exists for '${charId}'. Current attunements: ${
          current
            .map((entry) => `${entry.displayName} (${entry.itemId})`)
            .join(', ') || '(none)'
        }`,
      );
    }
    txnDb
      .prepare(
        `DELETE FROM attunement
         WHERE campaign_id = ? AND character_id = ? AND item_id = ?`,
      )
      .run(input.campaignId, charId, input.itemId);
    return {
      characterId: charId,
      ended: rowToEntry(row),
      reason: input.reason,
      attunements: listAttunements(txnDb, input.campaignId, charId),
    };
  });
}

/**
 * Death ends attunement (SRD ending condition), enforced by the F6 death
 * machine: `hpLifecycle` calls this when a character's life_state reaches
 * 'dead'. Campaign-agnostic on purpose — the character id is the identity
 * the death machine knows, and a character's attunements all end regardless
 * of which campaign row recorded them.
 */
export function endAllAttunementsOnDeath(db: Db, characterId: string): number {
  const result = db
    .prepare('DELETE FROM attunement WHERE character_id = ?')
    .run(characterId);
  return result.changes;
}
