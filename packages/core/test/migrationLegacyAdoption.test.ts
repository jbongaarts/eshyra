import { describe, expect, it } from 'vitest';
import type { Db } from '../src/persistence/db.js';
import { openDatabase } from '../src/persistence/db.js';
import {
  discoverMigrations,
  migrateDatabase,
  prepareDatabaseForMigrations,
  readMigrationLedger,
  runMigrations,
  SchemaResetRequiredError,
} from '../src/persistence/migrationRunner.js';

const NOW = () => '2026-06-26T00:00:00.000Z';

/**
 * A legacy pre-migration-first DB at the current baseline: a genuine legacy v15
 * database holds exactly the `0001` baseline schema and seed rows — no later
 * migrations and no `schema_migrations` ledger — marked with
 * `meta.schema_version = 15`. Build it from the baseline migration directly
 * (not the full migration set) so adoption, which compares against the 0001
 * baseline, sees a faithful legacy DB.
 */
function legacyBaselineDb(): Db {
  const db = openDatabase(':memory:');
  db.exec(discoverMigrations()[0].sql);
  db.prepare('INSERT INTO meta(key, value) VALUES (?, ?)').run(
    'schema_version',
    '15',
  );
  return db;
}

/** A minimal legacy DB at an arbitrary meta.schema_version with some content. */
function legacyDbAtVersion(version: string): Db {
  const db = openDatabase(':memory:');
  db.exec(`
    CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE legacy_table (id INTEGER PRIMARY KEY);
  `);
  db.prepare('INSERT INTO meta(key, value) VALUES (?, ?)').run(
    'schema_version',
    version,
  );
  return db;
}

function hasLedger(db: Db): boolean {
  return (
    db
      .prepare(
        "SELECT 1 FROM sqlite_master WHERE type='table' AND name='schema_migrations'",
      )
      .get() !== undefined
  );
}

describe('prepareDatabaseForMigrations', () => {
  it('classifies an empty database as empty', () => {
    const db = openDatabase(':memory:');
    expect(prepareDatabaseForMigrations(db).action).toBe('empty');
    expect(hasLedger(db)).toBe(false);
    db.close();
  });

  it('classifies a migration-first database as ledger-present', () => {
    const db = openDatabase(':memory:');
    runMigrations(db, { now: NOW });
    expect(prepareDatabaseForMigrations(db).action).toBe('ledger-present');
    db.close();
  });

  it('adopts a legacy baseline-version database in place', () => {
    const db = legacyBaselineDb();
    // Prove user data is preserved across adoption.
    db.prepare(
      "INSERT INTO plot_flags(key, value_json, provenance, session_id, updated_at) VALUES ('flag', '1', 'test', 's', 't')",
    ).run();

    const result = prepareDatabaseForMigrations(db, { now: NOW });

    expect(result.action).toBe('adopted');
    expect(result.adoptedFromVersion).toBe(15);

    const ledger = readMigrationLedger(db);
    expect(ledger).toHaveLength(1);
    expect(ledger[0].version).toBe(1);
    expect(ledger[0].name).toBe('initial');
    const baseline = discoverMigrations().find((m) => m.version === 1);
    expect(ledger[0].checksum).toBe(baseline?.checksum);
    expect(ledger[0].applied_at).toBe(NOW());

    // Data and the legacy version marker are untouched.
    const flag = db
      .prepare("SELECT value_json FROM plot_flags WHERE key = 'flag'")
      .get() as { value_json: string } | undefined;
    expect(flag?.value_json).toBe('1');
    const version = db
      .prepare("SELECT value FROM meta WHERE key = 'schema_version'")
      .get() as { value: string };
    expect(version.value).toBe('15');
    db.close();
  });

  it('does not re-run baseline DDL on adoption (no duplicate-table error)', () => {
    const db = legacyBaselineDb();
    // Adoption marks 0001 applied; runMigrations must then skip it entirely.
    expect(() => migrateDatabase(db, { now: NOW })).not.toThrow();
    const result = migrateDatabase(db, { now: NOW });
    expect(result.legacy.action).toBe('ledger-present');
    expect(result.migrations.applied).toEqual([]);
    db.close();
  });

  it('rejects a legacy database below the baseline version', () => {
    const db = legacyDbAtVersion('14');
    expect(() => prepareDatabaseForMigrations(db)).toThrow(
      SchemaResetRequiredError,
    );
    expect(() => prepareDatabaseForMigrations(db)).toThrow(
      /schema_version 14 predates the migration-first baseline \(15\)/,
    );
    expect(hasLedger(db)).toBe(false);
    db.close();
  });

  it('rejects a legacy database above the baseline version with update advice', () => {
    const db = legacyDbAtVersion('16');
    expect(() => prepareDatabaseForMigrations(db)).toThrow(
      /schema_version 16 is newer than the migration-first baseline/,
    );
    expect(() => prepareDatabaseForMigrations(db)).toThrow(
      /Update your Eshyra installation/,
    );
    db.close();
  });

  it('rejects a database with tables but no meta table', () => {
    const db = openDatabase(':memory:');
    db.exec('CREATE TABLE orphan (id INTEGER PRIMARY KEY);');
    expect(() => prepareDatabaseForMigrations(db)).toThrow(
      /no schema_migrations ledger and no meta table/,
    );
    expect(hasLedger(db)).toBe(false);
    db.close();
  });

  it('rejects a database with a meta table but no schema_version', () => {
    const db = openDatabase(':memory:');
    db.exec(`
      CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE other (id INTEGER PRIMARY KEY);
    `);
    expect(() => prepareDatabaseForMigrations(db)).toThrow(
      /no meta\.schema_version/,
    );
    db.close();
  });

  it('rejects a non-integer schema_version', () => {
    const db = legacyDbAtVersion('not-a-number');
    expect(() => prepareDatabaseForMigrations(db)).toThrow(
      /schema_version is not a valid integer/,
    );
    db.close();
  });

  it('rejects a baseline-version database whose structure does not match the baseline', () => {
    const db = legacyDbAtVersion('15'); // says 15 but only has meta + legacy_table
    expect(() => prepareDatabaseForMigrations(db)).toThrow(
      /structure does not match the 0001 baseline/,
    );
    expect(hasLedger(db)).toBe(false);
    db.close();
  });
});

describe('migrateDatabase (end to end)', () => {
  it('applies all migrations to an empty database from zero', () => {
    const db = openDatabase(':memory:');
    const result = migrateDatabase(db, { now: NOW });
    expect(result.legacy.action).toBe('empty');
    expect(result.migrations.applied).toEqual([1, 2]);
    expect(readMigrationLedger(db).map((r) => r.version)).toEqual([1, 2]);
    db.close();
  });

  it('adopts a legacy baseline database and applies pending post-baseline migrations', () => {
    const db = legacyBaselineDb();
    const result = migrateDatabase(db, { now: NOW });
    expect(result.legacy.action).toBe('adopted');
    expect(result.legacy.adoptedFromVersion).toBe(15);
    // 0001 is adopted (already applied); the post-baseline migrations apply.
    expect(result.migrations.applied).toEqual([2]);
    expect(result.migrations.alreadyApplied).toEqual([1]);
    db.close();
  });

  it('is idempotent on an adopted database', () => {
    const db = legacyBaselineDb();
    migrateDatabase(db, { now: NOW });
    const second = migrateDatabase(db, { now: NOW });
    expect(second.legacy.action).toBe('ledger-present');
    expect(second.migrations.applied).toEqual([]);
    db.close();
  });

  it('surfaces a reset requirement without modifying the database', () => {
    const db = legacyDbAtVersion('14');
    expect(() => migrateDatabase(db, { now: NOW })).toThrow(
      SchemaResetRequiredError,
    );
    expect(hasLedger(db)).toBe(false);
    db.close();
  });
});
