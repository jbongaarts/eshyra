/**
 * Migration-first SQLite schema runner (ADR 0015).
 *
 * Versioned SQL migration files are the single executable source of truth for
 * the campaign SQLite schema. This module discovers those files, validates that
 * they form a clean, contiguous, append-only sequence, records applied
 * migrations in the `schema_migrations` ledger, and applies only pending
 * migrations — each in its own transaction together with its ledger row.
 *
 * Bundled location. Migration `.sql` files ship under
 * `packages/core/data/migrations/` and are resolved relative to this module via
 * `import.meta.url`. `data/` is two levels above both the TypeScript source
 * (`src/persistence/` → `data/`) and the compiled output (`dist/persistence/` →
 * `data/`), and is listed in `packages/core/package.json` `files`, so the same
 * relative URL resolves under vitest and from the published package alike. This
 * mirrors the bundled SRD pack loader (`rules/bundledSrdPack.ts`); it is the
 * load mechanism ADR 0015 left to this bead, and supersedes the ADR's
 * provisional `src/persistence/migrations/` location (a `src` path would not
 * survive `tsc --build`, which does not copy non-TS assets into `dist`).
 *
 * The `schema_migrations` ledger is the sole runner-owned infrastructure
 * exception to "only `.sql` files create schema": it is created and maintained
 * here and is never declared in a migration file.
 *
 * Scope (eshyra-4s0r.1.3 / .1.4): this module is the runner plus the
 * `0001_initial.sql` baseline. Wiring it into the live `initSchema` path and
 * removing the hand-maintained latest-schema DDL is eshyra-4s0r.1.6; legacy
 * `meta.schema_version` adoption/reset is eshyra-4s0r.1.5.
 */

import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Db } from './db.js';
import { withTransaction } from './db.js';

export class SchemaMigrationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SchemaMigrationError';
  }
}

/** A migration file discovered on disk, with its normalized text and checksum. */
export interface DiscoveredMigration {
  /** The zero-padded numeric prefix, parsed to an integer (e.g. 1). */
  version: number;
  /** The snake_case name, without the `NNNN_` prefix or `.sql` suffix. */
  name: string;
  /** The normalized migration SQL (see {@link normalizeMigrationSql}). */
  sql: string;
  /** SHA-256 hex digest of the normalized SQL (see {@link migrationChecksum}). */
  checksum: string;
}

/** One row of the `schema_migrations` ledger. */
export interface MigrationLedgerRow {
  version: number;
  name: string;
  checksum: string;
  applied_at: string;
}

export interface RunMigrationsResult {
  /** Versions applied during this call, in order. */
  applied: number[];
  /** Versions that were already applied before this call. */
  alreadyApplied: number[];
  /** The highest applied version after this call (0 if there are no migrations). */
  currentVersion: number;
}

export interface RunMigrationsOptions {
  /** Override the migrations directory (defaults to the bundled `data/migrations`). */
  dir?: string;
  /** Override the applied-at timestamp source (defaults to `new Date().toISOString()`). */
  now?: () => string;
}

/** Bundled migrations directory, resolved relative to this module. */
const DEFAULT_MIGRATIONS_DIR = fileURLToPath(
  new URL('../../data/migrations/', import.meta.url),
);

/** `NNNN_snake_case_name.sql`, four-digit zero-padded version prefix. */
const MIGRATION_FILENAME = /^(\d{4})_([a-z0-9]+(?:_[a-z0-9]+)*)\.sql$/;

const LEDGER_DDL = `CREATE TABLE IF NOT EXISTS schema_migrations (
  version INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  checksum TEXT NOT NULL,
  applied_at TEXT NOT NULL
)`;

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * Normalize migration text so its checksum is stable across platforms and git
 * autocrlf settings: decode as UTF-8 (the caller reads with 'utf8'), convert
 * CRLF/CR to LF, and collapse trailing newlines to exactly one.
 */
export function normalizeMigrationSql(raw: string): string {
  const lf = raw.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  return `${lf.replace(/\n+$/, '')}\n`;
}

/** SHA-256 hex digest of already-normalized migration SQL. */
export function migrationChecksum(normalizedSql: string): string {
  return createHash('sha256').update(normalizedSql, 'utf8').digest('hex');
}

/**
 * Discover and validate the migration files in `dir`, returned in ascending
 * version order. Throws {@link SchemaMigrationError} on a malformed filename, a
 * duplicate version or name, or a non-contiguous sequence (versions must run
 * `1, 2, 3, …` with no gaps).
 *
 * Every `.sql` in `dir` is treated as a migration, so the migrations directory
 * must hold **only** `NNNN_name.sql` files. A non-migration artifact such as the
 * generated review snapshot is rejected here as malformed; it belongs on a
 * non-migration path (`data/schema.snapshot.sql`), not in this directory
 * (ADR 0015 §7).
 */
export function discoverMigrations(
  dir: string = DEFAULT_MIGRATIONS_DIR,
): DiscoveredMigration[] {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch (err) {
    throw new SchemaMigrationError(
      `cannot read migrations directory ${dir}: ${errorMessage(err)}`,
    );
  }

  const parsed = entries
    .filter((file) => file.endsWith('.sql'))
    .map((file) => {
      const match = MIGRATION_FILENAME.exec(file);
      if (match === null) {
        throw new SchemaMigrationError(
          `malformed migration filename: ${file} (expected NNNN_snake_case_name.sql)`,
        );
      }
      const sql = normalizeMigrationSql(readFileSync(join(dir, file), 'utf8'));
      return {
        version: Number.parseInt(match[1], 10),
        name: match[2],
        sql,
        checksum: migrationChecksum(sql),
      };
    })
    .sort((a, b) => a.version - b.version);

  const seenVersions = new Set<number>();
  const seenNames = new Set<string>();
  parsed.forEach((migration, index) => {
    if (seenVersions.has(migration.version)) {
      throw new SchemaMigrationError(
        `duplicate migration version ${migration.version}`,
      );
    }
    seenVersions.add(migration.version);
    if (seenNames.has(migration.name)) {
      throw new SchemaMigrationError(
        `duplicate migration name "${migration.name}"`,
      );
    }
    seenNames.add(migration.name);
    const expected = index + 1;
    if (migration.version !== expected) {
      throw new SchemaMigrationError(
        `non-contiguous migration versions: expected ${expected} but found ${migration.version} (${migration.name})`,
      );
    }
  });

  return parsed;
}

/** Create the `schema_migrations` ledger table if it does not already exist. */
export function ensureMigrationLedger(db: Db): void {
  db.exec(LEDGER_DDL);
}

/** Read the `schema_migrations` ledger in ascending version order. */
export function readMigrationLedger(db: Db): MigrationLedgerRow[] {
  return db
    .prepare(
      'SELECT version, name, checksum, applied_at FROM schema_migrations ORDER BY version',
    )
    .all() as MigrationLedgerRow[];
}

/**
 * Bring `db` up to date with the migration files in the bundled (or supplied)
 * directory.
 *
 * - Empty/new DB: applies every migration in order from `0001`.
 * - Existing migration-first DB: verifies the checksum, name, and contiguity of
 *   every already-applied migration, then applies only pending migrations.
 *
 * Each pending migration runs inside its own transaction together with its
 * ledger insert, so applying a migration and recording it are atomic; a partial
 * multi-migration run leaves the DB at the last fully-applied version.
 *
 * Throws {@link SchemaMigrationError} if an already-applied migration's file is
 * missing or its checksum/name no longer matches the ledger, or if the ledger
 * is not a contiguous `1..N` prefix.
 */
export function runMigrations(
  db: Db,
  options: RunMigrationsOptions = {},
): RunMigrationsResult {
  const dir = options.dir ?? DEFAULT_MIGRATIONS_DIR;
  const now = options.now ?? (() => new Date().toISOString());

  const migrations = discoverMigrations(dir);
  ensureMigrationLedger(db);
  const ledger = readMigrationLedger(db);

  const byVersion = new Map(migrations.map((m) => [m.version, m]));
  ledger.forEach((row, index) => {
    const file = byVersion.get(row.version);
    if (file === undefined) {
      throw new SchemaMigrationError(
        `applied migration ${row.version} (${row.name}) has no migration file; ` +
          'a committed migration was deleted/renamed or the database was written by a newer build',
      );
    }
    if (file.checksum !== row.checksum) {
      throw new SchemaMigrationError(
        `checksum mismatch for applied migration ${row.version} (${row.name}): ` +
          'a committed, already-applied migration file was edited after it was applied',
      );
    }
    if (file.name !== row.name) {
      throw new SchemaMigrationError(
        `name mismatch for applied migration ${row.version}: ledger has "${row.name}" but file is "${file.name}"`,
      );
    }
    const expected = index + 1;
    if (row.version !== expected) {
      throw new SchemaMigrationError(
        `schema_migrations ledger is not contiguous: expected version ${expected} but found ${row.version}`,
      );
    }
  });

  const maxApplied = ledger.length > 0 ? ledger[ledger.length - 1].version : 0;
  const pending = migrations.filter((m) => m.version > maxApplied);

  const applied: number[] = [];
  for (const migration of pending) {
    withTransaction(db, (txn) => {
      txn.exec(migration.sql);
      txn
        .prepare(
          'INSERT INTO schema_migrations(version, name, checksum, applied_at) VALUES (?, ?, ?, ?)',
        )
        .run(migration.version, migration.name, migration.checksum, now());
    });
    applied.push(migration.version);
  }

  return {
    applied,
    alreadyApplied: ledger.map((row) => row.version),
    currentVersion:
      pending.length > 0 ? pending[pending.length - 1].version : maxApplied,
  };
}
