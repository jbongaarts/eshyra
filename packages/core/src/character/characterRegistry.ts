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
 * unlike the campaign schema (migration-first, ADR 0015), its schema is created
 * idempotently here with `IF NOT EXISTS` (additive only; an older DB from
 * eshyra-lupf.14.2 that lacks the revision/custody tables gains them on next
 * open). Importing a registry character into a campaign is copy-with-provenance,
 * not a fork (ADR 0012 §3): the campaign sheet is stamped with the source
 * `globalCharacterId`.
 *
 * The custody lifecycle (eshyra-lupf.14.3) adds two tables to this database:
 *
 *   - `character_revision`: a per-character linear, append-only revision history
 *     (revision 1 = initial registration; each campaign sync-back appends the
 *     next revision built from the campaign sheet). The `character_registry`
 *     head row mirrors the latest revision for fast load/list.
 *   - `character_custody`: at most one row per `globalCharacterId`, present
 *     exactly while a campaign holds custody. This is the cross-DB write lock
 *     that guards against silently attaching one character to two active
 *     campaigns; the lifecycle helpers in `characterCustody.ts` consult it.
 */

import type { Db } from '../persistence/db.js';
import { jsonColumn } from '../persistence/jsonColumn.js';
import { CharacterSheetStoreError } from './characterSheetStore.js';
import type { CharacterSheet } from './finalizeCharacter.js';

/** How a registry revision came to exist (ADR 0012, eshyra-lupf.14.3). */
export type CharacterRevisionSource = 'register' | 'sync-back' | 'fork';

/** One entry on a character's linear, append-only registry timeline. */
export interface CharacterRevision {
  readonly globalCharacterId: string;
  /** 1-based, strictly increasing per `globalCharacterId`. */
  readonly revision: number;
  readonly sheet: CharacterSheet;
  readonly source: CharacterRevisionSource;
  /**
   * Provenance for a `fork` revision: the `(globalCharacterId, revision)` the
   * alternate timeline branched from. Unset for `register`/`sync-back`.
   */
  readonly parent?: {
    readonly globalCharacterId: string;
    readonly revision: number;
  };
  readonly createdAt: string;
}

/**
 * Custody of a character by a campaign — the cross-DB write lock. Present
 * exactly while a campaign is the active writer for `globalCharacterId`.
 */
export interface CustodyRecord {
  readonly globalCharacterId: string;
  /** The campaign currently holding the character. */
  readonly campaignId: string;
  /** The campaign-local character id (e.g. `pc-1`) it is attached as. */
  readonly characterId: string;
  /** The registry revision that was checked out. */
  readonly revision: number;
  readonly attachedAt: string;
}

/** Persistence for the cross-campaign character registry, keyed by global id. */
export interface CharacterRegistryStore {
  /**
   * Persist (insert or update in place) the head sheet for `globalCharacterId`.
   * Low-level head writer that does **not** touch revision history; lifecycle
   * callers should use {@link CharacterRegistryStore.appendRevision} so the
   * timeline and head stay consistent.
   */
  save(globalCharacterId: string, sheet: CharacterSheet): void;
  /** Load the head (latest) sheet, or `undefined` when none is stored. */
  load(globalCharacterId: string): CharacterSheet | undefined;
  /** Every registered global character id, in stable (ascending) order. */
  list(): readonly string[];

  /**
   * Append the next revision for `globalCharacterId` (atomically updating the
   * head row) and return it. The revision number is `headRevision + 1`, or 1
   * for a never-registered id. `source` records why; `parent` is for forks.
   */
  appendRevision(
    globalCharacterId: string,
    sheet: CharacterSheet,
    source: CharacterRevisionSource,
    parent?: CharacterRevision['parent'],
  ): CharacterRevision;
  /** The latest revision number, or `undefined` when none is registered. */
  headRevision(globalCharacterId: string): number | undefined;
  /** The full linear revision history, oldest first. */
  listRevisions(globalCharacterId: string): readonly CharacterRevision[];
  /** A single revision, or `undefined` when it does not exist. */
  loadRevision(
    globalCharacterId: string,
    revision: number,
  ): CharacterRevision | undefined;

  /** The current custody record, or `undefined` when the character is idle. */
  custody(globalCharacterId: string): CustodyRecord | undefined;
  /** Insert or replace the custody record (acquire the write lock). */
  setCustody(record: CustodyRecord): void;
  /** Remove any custody record (release the write lock). Idempotent. */
  clearCustody(globalCharacterId: string): void;
}

interface CharacterRegistryRow {
  readonly schema_version: number;
  readonly system: string;
  readonly rules_pack_id: string;
  readonly sheet_json: string;
}

interface CharacterRevisionRow {
  readonly global_character_id: string;
  readonly revision: number;
  readonly schema_version: number;
  readonly system: string;
  readonly rules_pack_id: string;
  readonly sheet_json: string;
  readonly source: CharacterRevisionSource;
  readonly parent_global_id: string | null;
  readonly parent_revision: number | null;
  readonly created_at: string;
}

interface CustodyRow {
  readonly global_character_id: string;
  readonly campaign_id: string;
  readonly character_id: string;
  readonly revision: number;
  readonly attached_at: string;
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

const REVISION_SCHEMA = `CREATE TABLE IF NOT EXISTS character_revision (
  global_character_id TEXT NOT NULL,
  revision INTEGER NOT NULL,
  schema_version INTEGER NOT NULL,
  system TEXT NOT NULL,
  rules_pack_id TEXT NOT NULL,
  sheet_json TEXT NOT NULL,
  source TEXT NOT NULL,
  parent_global_id TEXT,
  parent_revision INTEGER,
  created_at TEXT NOT NULL,
  PRIMARY KEY (global_character_id, revision)
)`;

const CUSTODY_SCHEMA = `CREATE TABLE IF NOT EXISTS character_custody (
  global_character_id TEXT PRIMARY KEY,
  campaign_id TEXT NOT NULL,
  character_id TEXT NOT NULL,
  revision INTEGER NOT NULL,
  attached_at TEXT NOT NULL
)`;

/**
 * Create the registry tables if they do not exist. The registry is a standalone
 * data-root database, so (unlike the campaign schema) `IF NOT EXISTS` is the
 * correct idempotent bootstrap. The statements are additive: opening a 14.2-era
 * database that has only `character_registry` adds the revision/custody tables
 * without disturbing existing rows.
 */
export function ensureCharacterRegistrySchema(db: Db): void {
  db.exec(REGISTRY_SCHEMA);
  db.exec(REVISION_SCHEMA);
  db.exec(CUSTODY_SCHEMA);
}

function rowToRevision(row: CharacterRevisionRow): CharacterRevision {
  const sheet = sheetColumn.decode(row.sheet_json);
  if (
    sheet.schemaVersion !== row.schema_version ||
    sheet.system !== row.system ||
    sheet.rulesPackId !== row.rules_pack_id
  ) {
    throw new CharacterSheetStoreError(
      `character_revision row for "${row.global_character_id}"@${row.revision} disagrees with its document binding ` +
        '(schema_version / system / rules_pack_id)',
    );
  }
  return {
    globalCharacterId: row.global_character_id,
    revision: row.revision,
    sheet,
    source: row.source,
    ...(row.parent_global_id !== null && row.parent_revision !== null
      ? {
          parent: {
            globalCharacterId: row.parent_global_id,
            revision: row.parent_revision,
          },
        }
      : {}),
    createdAt: row.created_at,
  };
}

/**
 * A {@link CharacterRegistryStore} backed by `db`'s registry tables. Call
 * {@link ensureCharacterRegistrySchema} on `db` first. `now` supplies
 * timestamps and defaults to wall-clock ISO-8601; `created_at` is preserved
 * across head updates.
 */
export function createCharacterRegistryStore(
  db: Db,
  now: () => string = () => new Date().toISOString(),
): CharacterRegistryStore {
  function requireId(globalCharacterId: string): string {
    const id = globalCharacterId.trim();
    if (id.length === 0) {
      throw new CharacterSheetStoreError(
        'global character id must be non-empty',
      );
    }
    return id;
  }

  function writeHead(id: string, sheet: CharacterSheet, at: string): void {
    // True upsert (preserve created_at; never delete-then-insert) so the
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
  }

  function headRevisionNumber(id: string): number | undefined {
    const row = db
      .prepare(
        'SELECT MAX(revision) AS head FROM character_revision WHERE global_character_id = ?',
      )
      .get(id) as { head: number | null } | undefined;
    return row?.head ?? undefined;
  }

  return {
    save(globalCharacterId: string, sheet: CharacterSheet): void {
      writeHead(requireId(globalCharacterId), sheet, now());
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

    appendRevision(
      globalCharacterId: string,
      sheet: CharacterSheet,
      source: CharacterRevisionSource,
      parent?: CharacterRevision['parent'],
    ): CharacterRevision {
      const id = requireId(globalCharacterId);
      const at = now();
      // Append + head update must be atomic so the head row always mirrors the
      // latest revision (a torn write would leave them disagreeing).
      const append = db.transaction((): CharacterRevision => {
        const revision = (headRevisionNumber(id) ?? 0) + 1;
        db.prepare(
          `INSERT INTO character_revision(
             global_character_id, revision, schema_version, system, rules_pack_id,
             sheet_json, source, parent_global_id, parent_revision, created_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        ).run(
          id,
          revision,
          sheet.schemaVersion,
          sheet.system,
          sheet.rulesPackId,
          sheetColumn.encode(sheet),
          source,
          parent?.globalCharacterId ?? null,
          parent?.revision ?? null,
          at,
        );
        writeHead(id, sheet, at);
        return {
          globalCharacterId: id,
          revision,
          sheet,
          source,
          ...(parent !== undefined ? { parent } : {}),
          createdAt: at,
        };
      });
      return append();
    },

    headRevision(globalCharacterId: string): number | undefined {
      return headRevisionNumber(globalCharacterId.trim());
    },

    listRevisions(globalCharacterId: string): readonly CharacterRevision[] {
      const rows = db
        .prepare(
          `SELECT global_character_id, revision, schema_version, system, rules_pack_id,
                  sheet_json, source, parent_global_id, parent_revision, created_at
             FROM character_revision WHERE global_character_id = ? ORDER BY revision`,
        )
        .all(globalCharacterId.trim()) as CharacterRevisionRow[];
      return rows.map(rowToRevision);
    },

    loadRevision(
      globalCharacterId: string,
      revision: number,
    ): CharacterRevision | undefined {
      const row = db
        .prepare(
          `SELECT global_character_id, revision, schema_version, system, rules_pack_id,
                  sheet_json, source, parent_global_id, parent_revision, created_at
             FROM character_revision WHERE global_character_id = ? AND revision = ?`,
        )
        .get(globalCharacterId.trim(), revision) as
        | CharacterRevisionRow
        | undefined;
      return row === undefined ? undefined : rowToRevision(row);
    },

    custody(globalCharacterId: string): CustodyRecord | undefined {
      const row = db
        .prepare(
          `SELECT global_character_id, campaign_id, character_id, revision, attached_at
             FROM character_custody WHERE global_character_id = ?`,
        )
        .get(globalCharacterId.trim()) as CustodyRow | undefined;
      if (row === undefined) {
        return undefined;
      }
      return {
        globalCharacterId: row.global_character_id,
        campaignId: row.campaign_id,
        characterId: row.character_id,
        revision: row.revision,
        attachedAt: row.attached_at,
      };
    },

    setCustody(record: CustodyRecord): void {
      const id = requireId(record.globalCharacterId);
      db.prepare(
        `INSERT INTO character_custody(
           global_character_id, campaign_id, character_id, revision, attached_at
         ) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(global_character_id) DO UPDATE SET
           campaign_id = excluded.campaign_id,
           character_id = excluded.character_id,
           revision = excluded.revision,
           attached_at = excluded.attached_at`,
      ).run(
        id,
        record.campaignId,
        record.characterId,
        record.revision,
        record.attachedAt,
      );
    },

    clearCustody(globalCharacterId: string): void {
      db.prepare(
        'DELETE FROM character_custody WHERE global_character_id = ?',
      ).run(globalCharacterId.trim());
    },
  };
}
