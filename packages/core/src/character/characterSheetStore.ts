/**
 * Core-owned persistence for the canonical {@link CharacterSheet} (ADR 0011).
 *
 * The character sheet is the durable, rules-pack-bound authority for a
 * character's build-defining facts. This store replaces the former CLI-side
 * JSON persistence of finalized characters: the CLI, and any future web/app UX,
 * read and write sheets through this one core API rather than owning their own
 * sheet files.
 *
 * Storage shape (see `0002_character_sheet.sql`): the sheet is persisted as a
 * versioned JSON document (`sheet_json`) with the binding identity
 * (`schema_version`, `system`, `rules_pack_id`) mirrored into columns so reads
 * can validate and route without parsing the blob. The live `character` row is
 * a separate projection for the per-turn path (it owns `hp_current` /
 * `conditions_json`); the sheet→live projection is `importFinalizedCharacter`.
 */

import type { Db } from '../persistence/db.js';
import { jsonColumn } from '../persistence/jsonColumn.js';
import type { CampaignRulesBinding } from '../rules/binding.js';
import type { CharacterSheet } from './finalizeCharacter.js';

export class CharacterSheetStoreError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CharacterSheetStoreError';
  }
}

/**
 * Raised when a sheet is used under a rules pack that did not produce it. A
 * sheet is valid only for its own `system` / `rulesPackId`; progression and
 * other mechanical operations fail closed on a mismatch rather than applying
 * rules from a different pack (ADR 0011 §3).
 */
export class CharacterSheetPackMismatchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CharacterSheetPackMismatchError';
  }
}

/** Persistence for canonical character sheets, keyed by character id. */
export interface CharacterSheetStore {
  /** Persist (insert or replace) the sheet for `characterId`. */
  save(characterId: string, sheet: CharacterSheet): void;
  /** Load the sheet for `characterId`, or `undefined` when none is stored. */
  load(characterId: string): CharacterSheet | undefined;
  /** Every stored character id, in stable (ascending) order. */
  list(): readonly string[];
}

interface CharacterSheetRow {
  readonly schema_version: number;
  readonly system: string;
  readonly rules_pack_id: string;
  readonly sheet_json: string;
}

const sheetColumn = jsonColumn<CharacterSheet>('character_sheet.sheet_json');

/**
 * A {@link CharacterSheetStore} backed by the campaign SQLite database's
 * `character_sheet` table (migration `0002`). `now` supplies the `updated_at`
 * timestamp and defaults to wall-clock ISO-8601.
 */
export function createSqliteCharacterSheetStore(
  db: Db,
  now: () => string = () => new Date().toISOString(),
): CharacterSheetStore {
  return {
    save(characterId: string, sheet: CharacterSheet): void {
      const id = characterId.trim();
      if (id.length === 0) {
        throw new CharacterSheetStoreError('character id must be non-empty');
      }
      // A true upsert (not INSERT OR REPLACE, which is delete-then-insert):
      // re-saving a sheet must update the existing row in place so a future
      // append-only ledger keyed to character_sheet(character_id) cannot be
      // broken or cascade-deleted by a re-save (ADR 0011).
      db.prepare(
        `INSERT INTO character_sheet(
           character_id, schema_version, system, rules_pack_id, sheet_json, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(character_id) DO UPDATE SET
           schema_version = excluded.schema_version,
           system = excluded.system,
           rules_pack_id = excluded.rules_pack_id,
           sheet_json = excluded.sheet_json,
           updated_at = excluded.updated_at`,
      ).run(
        id,
        sheet.schemaVersion,
        sheet.system,
        sheet.rulesPackId,
        sheetColumn.encode(sheet),
        now(),
      );
    },

    load(characterId: string): CharacterSheet | undefined {
      const row = db
        .prepare(
          `SELECT schema_version, system, rules_pack_id, sheet_json
             FROM character_sheet WHERE character_id = ?`,
        )
        .get(characterId.trim()) as CharacterSheetRow | undefined;
      if (row === undefined) {
        return undefined;
      }
      const sheet = sheetColumn.decode(row.sheet_json);
      // The mirrored binding columns must agree with the document; a mismatch
      // means the row was written or tampered with out of band.
      if (
        sheet.schemaVersion !== row.schema_version ||
        sheet.system !== row.system ||
        sheet.rulesPackId !== row.rules_pack_id
      ) {
        throw new CharacterSheetStoreError(
          `character_sheet row for "${characterId}" disagrees with its document binding ` +
            '(schema_version / system / rules_pack_id)',
        );
      }
      return sheet;
    },

    list(): readonly string[] {
      const rows = db
        .prepare(
          'SELECT character_id FROM character_sheet ORDER BY character_id',
        )
        .all() as { character_id: string }[];
      return rows.map((row) => row.character_id);
    },
  };
}

/**
 * Assert that `sheet` was produced by the campaign's bound rules pack. Throws
 * {@link CharacterSheetPackMismatchError} when the sheet's `system` or
 * `rulesPackId` does not match the binding's base pack. Mechanical operations
 * (progression, level-up) call this to fail closed rather than apply rules from
 * a pack the sheet was not built under (ADR 0011 §3).
 */
export function assertSheetMatchesPack(
  sheet: CharacterSheet,
  binding: CampaignRulesBinding,
): void {
  if (sheet.system !== binding.base.systemId) {
    throw new CharacterSheetPackMismatchError(
      `character sheet system "${sheet.system}" does not match campaign rules system "${binding.base.systemId}"`,
    );
  }
  if (sheet.rulesPackId !== binding.base.packId) {
    throw new CharacterSheetPackMismatchError(
      `character sheet rules pack "${sheet.rulesPackId}" does not match campaign rules pack "${binding.base.packId}"`,
    );
  }
}
