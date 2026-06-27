/**
 * Core-owned cross-campaign character registry (ADR 0012).
 *
 * A character is a continuing entity with a stable `globalCharacterId` and a
 * personal timeline; campaigns take custody of it during play. The registry is
 * the authority for a character **between** campaigns: it persists the canonical
 * {@link CharacterSheet} document keyed by `globalCharacterId`. The per-campaign
 * `character_sheet` table ({@link createSqliteCharacterSheetStore}) is the
 * authoritative playable instance **during** play.
 *
 * The registry lives in its own data-root SQLite database (e.g.
 * `<dataRoot>/characters.db`), separate from the per-campaign databases — so,
 * unlike the campaign schema (migration-first, ADR 0015), its single-table
 * schema is created idempotently here. Importing a registry character into a
 * campaign is copy-with-provenance, not a fork (ADR 0012 §3): the campaign sheet
 * is stamped with the source `globalCharacterId`. Revision history and
 * exit/sync-back are a later concern (eshyra-lupf.14.3) and are deliberately not
 * modeled here.
 */

import type { Db } from '../persistence/db.js';
import { jsonColumn } from '../persistence/jsonColumn.js';
import { CharacterSheetStoreError } from './characterSheetStore.js';
import type { CharacterSheet } from './finalizeCharacter.js';

/** Persistence for the cross-campaign character registry, keyed by global id. */
export interface CharacterRegistryStore {
  /** Persist (insert or update in place) the sheet for `globalCharacterId`. */
  save(globalCharacterId: string, sheet: CharacterSheet): void;
  /** Load the registered sheet, or `undefined` when none is stored. */
  load(globalCharacterId: string): CharacterSheet | undefined;
  /** Every registered global character id, in stable (ascending) order. */
  list(): readonly string[];
}

interface CharacterRegistryRow {
  readonly schema_version: number;
  readonly system: string;
  readonly rules_pack_id: string;
  readonly sheet_json: string;
}

const sheetColumn = jsonColumn<CharacterSheet>('character_registry.sheet_json');

const REGISTRY_SCHEMA = `CREATE TABLE IF NOT EXISTS character_registry (
  global_character_id TEXT PRIMARY KEY,
  schema_version INTEGER NOT NULL,
  system TEXT NOT NULL,
  rules_pack_id TEXT NOT NULL,
  sheet_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
)`;

/**
 * Create the `character_registry` table if it does not exist. The registry is a
 * standalone data-root database, so (unlike the campaign schema) `IF NOT EXISTS`
 * is the correct idempotent bootstrap rather than a migration.
 */
export function ensureCharacterRegistrySchema(db: Db): void {
  db.exec(REGISTRY_SCHEMA);
}

/**
 * A {@link CharacterRegistryStore} backed by `db`'s `character_registry` table.
 * Call {@link ensureCharacterRegistrySchema} on `db` first. `now` supplies
 * timestamps and defaults to wall-clock ISO-8601; `created_at` is preserved
 * across updates.
 */
export function createCharacterRegistryStore(
  db: Db,
  now: () => string = () => new Date().toISOString(),
): CharacterRegistryStore {
  return {
    save(globalCharacterId: string, sheet: CharacterSheet): void {
      const id = globalCharacterId.trim();
      if (id.length === 0) {
        throw new CharacterSheetStoreError(
          'global character id must be non-empty',
        );
      }
      const at = now();
      // True upsert (preserve created_at; never delete-then-insert) so a future
      // revision history keyed to the registry id is not disturbed by a re-save.
      db.prepare(
        `INSERT INTO character_registry(
           global_character_id, schema_version, system, rules_pack_id, sheet_json, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(global_character_id) DO UPDATE SET
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
        at,
        at,
      );
    },

    load(globalCharacterId: string): CharacterSheet | undefined {
      const row = db
        .prepare(
          `SELECT schema_version, system, rules_pack_id, sheet_json
             FROM character_registry WHERE global_character_id = ?`,
        )
        .get(globalCharacterId.trim()) as CharacterRegistryRow | undefined;
      if (row === undefined) {
        return undefined;
      }
      const sheet = sheetColumn.decode(row.sheet_json);
      if (
        sheet.schemaVersion !== row.schema_version ||
        sheet.system !== row.system ||
        sheet.rulesPackId !== row.rules_pack_id
      ) {
        throw new CharacterSheetStoreError(
          `character_registry row for "${globalCharacterId}" disagrees with its document binding ` +
            '(schema_version / system / rules_pack_id)',
        );
      }
      return sheet;
    },

    list(): readonly string[] {
      const rows = db
        .prepare(
          'SELECT global_character_id FROM character_registry ORDER BY global_character_id',
        )
        .all() as { global_character_id: string }[];
      return rows.map((row) => row.global_character_id);
    },
  };
}
