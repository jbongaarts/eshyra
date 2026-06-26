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
 * Scope: this module now contains the migration runner, the `0001_initial.sql`
 * baseline support, and the legacy adoption/reset entrypoint from
 * eshyra-4s0r.1.3 through eshyra-4s0r.1.5. Wiring it into the live `initSchema`
 * path and removing the hand-maintained latest-schema DDL is eshyra-4s0r.1.6.
 */

import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Db } from './db.js';
import { openDatabase, withTransaction } from './db.js';

export class SchemaMigrationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SchemaMigrationError';
  }
}

/**
 * Raised when an existing database cannot be brought onto the migration-first
 * system and must be recreated (ADR 0015 §5). Distinct from
 * {@link SchemaMigrationError}, which signals a defect/tamper in the migration
 * set itself: a reset is an expected pre-1.0 outcome the caller surfaces to the
 * user, not a bug. The message is always actionable and the database is never
 * modified before this is thrown.
 */
export class SchemaResetRequiredError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SchemaResetRequiredError';
  }
}

/**
 * The legacy `meta.schema_version` that the `0001_initial.sql` baseline encodes.
 * A pre-migration-first database at exactly this version is structurally
 * identical to a fresh baseline and can be adopted in place; any other version
 * fails closed (ADR 0015 §5).
 */
export const LEGACY_BASELINE_SCHEMA_VERSION = 15;

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

/** What {@link prepareDatabaseForMigrations} did to the database. */
export type LegacyDatabaseAction =
  /** A truly empty DB; {@link runMigrations} will apply every migration. */
  | 'empty'
  /** Already a migration-first DB with a ledger; nothing to adopt. */
  | 'ledger-present'
  /** A legacy `meta.schema_version` DB adopted in place at the baseline. */
  | 'adopted';

export interface PrepareDatabaseResult {
  action: LegacyDatabaseAction;
  /** The legacy `meta.schema_version` adopted (only set when `action` is `adopted`). */
  adoptedFromVersion?: number;
}

export interface MigrateDatabaseResult {
  /** What the legacy preparation step decided. */
  legacy: PrepareDatabaseResult;
  /** The result of applying pending migrations afterward. */
  migrations: RunMigrationsResult;
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

function hasTable(db: Db, name: string): boolean {
  return (
    db
      .prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?")
      .get(name) !== undefined
  );
}

function countUserTables(db: Db): number {
  return (
    db
      .prepare(
        "SELECT COUNT(*) AS count FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'",
      )
      .get() as { count: number }
  ).count;
}

/**
 * A normalized fingerprint of a database's table and index definitions, used to
 * verify that a legacy database is structurally identical to the baseline before
 * adopting it. Excludes the `schema_migrations` ledger and SQLite's internal
 * objects, and normalizes whitespace and the no-op `IF NOT EXISTS` clause so it
 * compares the resulting schema, not its DDL formatting.
 */
export function schemaFingerprint(db: Db): string[] {
  const rows = db
    .prepare(
      `SELECT type, name, sql FROM sqlite_master
       WHERE type IN ('table', 'index')
         AND name <> 'schema_migrations'
         AND name NOT LIKE 'sqlite_%'
       ORDER BY type, name`,
    )
    .all() as { type: string; name: string; sql: string | null }[];
  return rows.map((row) => {
    const sql = (row.sql ?? '')
      .replace(/\s+/g, ' ')
      .replace(/\bIF NOT EXISTS\b/gi, '')
      .replace(/\s+/g, ' ')
      .trim();
    return `${row.type} ${row.name}: ${sql}`;
  });
}

/** The schema fingerprint a fresh `0001_initial.sql` baseline produces. */
function baselineSchemaFingerprint(baselineSql: string): string[] {
  const probe = openDatabase(':memory:');
  try {
    probe.exec(baselineSql);
    return schemaFingerprint(probe);
  } finally {
    probe.close();
  }
}

function fingerprintsEqual(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

/**
 * Decide how an existing database joins the migration-first system, and adopt it
 * in place if it is a legacy database at the baseline (ADR 0015 §5). Call this
 * before {@link runMigrations}.
 *
 * - **`schema_migrations` present** → `ledger-present`; the ledger is
 *   authoritative and `runMigrations` handles it.
 * - **No user tables** → `empty`; `runMigrations` applies every migration.
 * - **Legacy `meta.schema_version` exactly at {@link LEGACY_BASELINE_SCHEMA_VERSION}
 *   and structurally identical to the baseline** → `adopted`: the ledger is
 *   created and `0001_initial` is recorded as applied (with its real checksum)
 *   **without re-running its DDL**, so `runMigrations` then applies only later
 *   migrations.
 * - **Anything else** (no `meta`/`schema_version`, a non-integer version, a
 *   version other than the baseline, or a baseline-version DB whose structure
 *   does not match) → throws {@link SchemaResetRequiredError} with an actionable
 *   message. The database is **never** modified before throwing.
 */
export function prepareDatabaseForMigrations(
  db: Db,
  options: RunMigrationsOptions = {},
): PrepareDatabaseResult {
  const dir = options.dir ?? DEFAULT_MIGRATIONS_DIR;
  const now = options.now ?? (() => new Date().toISOString());

  if (hasTable(db, 'schema_migrations')) {
    return { action: 'ledger-present' };
  }

  if (countUserTables(db) === 0) {
    return { action: 'empty' };
  }

  // Has tables but no ledger: only a legacy DB at the exact baseline version is
  // adoptable. Everything else fails closed without modifying the database.
  if (!hasTable(db, 'meta')) {
    throw new SchemaResetRequiredError(
      'database has existing tables but no schema_migrations ledger and no meta table; ' +
        'it is not a recognized Eshyra database and will not be modified. ' +
        'Recreate the campaign (pre-1.0 databases are not migrated).',
    );
  }
  const versionRow = db
    .prepare('SELECT value FROM meta WHERE key = ?')
    .get('schema_version') as { value: string } | undefined;
  if (versionRow === undefined) {
    throw new SchemaResetRequiredError(
      'database has existing tables and a meta table but no meta.schema_version and ' +
        'no schema_migrations ledger; it is not a recognized Eshyra database and will ' +
        'not be modified. Recreate the campaign.',
    );
  }
  const version = Number.parseInt(versionRow.value, 10);
  if (!Number.isInteger(version) || String(version) !== versionRow.value) {
    throw new SchemaResetRequiredError(
      `database meta.schema_version is not a valid integer: "${versionRow.value}"; ` +
        'refusing to modify the database. Recreate the campaign.',
    );
  }
  if (version !== LEGACY_BASELINE_SCHEMA_VERSION) {
    const relation =
      version < LEGACY_BASELINE_SCHEMA_VERSION ? 'predates' : 'is newer than';
    const advice =
      version > LEGACY_BASELINE_SCHEMA_VERSION
        ? 'Update your Eshyra installation, or recreate the campaign (delete the database file and start a new one).'
        : 'Recreate the campaign (delete the database file and start a new one).';
    throw new SchemaResetRequiredError(
      `database schema_version ${version} ${relation} the migration-first baseline ` +
        `(${LEGACY_BASELINE_SCHEMA_VERSION}); pre-1.0 databases at other versions are not migrated. ${advice}`,
    );
  }

  // Baseline version: adopt only if the structure actually matches the baseline.
  const migrations = discoverMigrations(dir);
  const baseline = migrations.find((migration) => migration.version === 1);
  if (baseline === undefined) {
    throw new SchemaMigrationError(
      'no baseline migration (version 1) found; cannot adopt a legacy database',
    );
  }
  if (
    !fingerprintsEqual(
      baselineSchemaFingerprint(baseline.sql),
      schemaFingerprint(db),
    )
  ) {
    throw new SchemaResetRequiredError(
      `database reports schema_version ${LEGACY_BASELINE_SCHEMA_VERSION} but its structure ` +
        'does not match the 0001 baseline; refusing to adopt it. Recreate the campaign.',
    );
  }

  withTransaction(db, (txn) => {
    ensureMigrationLedger(txn);
    txn
      .prepare(
        'INSERT INTO schema_migrations(version, name, checksum, applied_at) VALUES (?, ?, ?, ?)',
      )
      .run(baseline.version, baseline.name, baseline.checksum, now());
  });
  return { action: 'adopted', adoptedFromVersion: version };
}

/**
 * Bring a database fully onto the latest schema: run legacy
 * adoption/reset preparation ({@link prepareDatabaseForMigrations}) and then
 * apply any pending migrations ({@link runMigrations}). This is the single entry
 * point a caller should use for an arbitrary on-disk database.
 *
 * Throws {@link SchemaResetRequiredError} if the database must be recreated, or
 * {@link SchemaMigrationError} on a defect in the migration set.
 */
export function migrateDatabase(
  db: Db,
  options: RunMigrationsOptions = {},
): MigrateDatabaseResult {
  const legacy = prepareDatabaseForMigrations(db, options);
  const migrations = runMigrations(db, options);
  return { legacy, migrations };
}

/** Header marking the generated snapshot as non-authoritative and non-editable. */
export const SCHEMA_SNAPSHOT_HEADER =
  '-- GENERATED FILE — DO NOT EDIT.\n' +
  '--\n' +
  '-- A review-only snapshot of the cumulative schema produced by applying every\n' +
  '-- migration in packages/core/data/migrations/ to a fresh database (ADR 0015\n' +
  '-- §7). It is never executed and is not schema authority — the migrations are.\n' +
  '-- Regenerate with: npm run -w @eshyra/core schema:snapshot\n';

/**
 * Render a deterministic, human-readable snapshot of `db`'s migration-authored
 * schema: every table and index DDL, tables then indexes, each ordered by name.
 * Excludes the runner-owned `schema_migrations` ledger and SQLite's internal
 * objects (including implicit autoindexes, whose `sql` is null). The result is
 * the committed `data/schema.snapshot.sql` review artifact (ADR 0015 §7); a test
 * regenerates it from the migrations and fails closed on drift.
 */
export function renderSchemaSnapshot(db: Db): string {
  const objects = db
    .prepare(
      `SELECT sql FROM sqlite_master
       WHERE type IN ('table', 'index')
         AND name <> 'schema_migrations'
         AND name NOT LIKE 'sqlite_%'
         AND sql IS NOT NULL
       ORDER BY CASE type WHEN 'table' THEN 0 ELSE 1 END, name`,
    )
    .all() as { sql: string }[];
  const body = objects.map((row) => `${row.sql.trim()};`).join('\n\n');
  return `${SCHEMA_SNAPSHOT_HEADER}\n${body}\n`;
}
