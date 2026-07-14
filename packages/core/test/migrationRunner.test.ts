import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { Db } from '../src/persistence/db.js';
import { openDatabase } from '../src/persistence/db.js';
import {
  discoverMigrations,
  type MigrationLedgerRow,
  migrationChecksum,
  normalizeMigrationSql,
  readMigrationLedger,
  runMigrations,
  SchemaMigrationError,
} from '../src/persistence/migrationRunner.js';
import { initSchema } from '../src/persistence/schema.js';

const tempDirs: string[] = [];

function makeMigrationDir(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), 'eshyra-mig-'));
  tempDirs.push(dir);
  for (const [name, sql] of Object.entries(files)) {
    writeFileSync(join(dir, name), sql);
  }
  return dir;
}

/**
 * Whitespace-normalized set of CREATE statements for tables and indexes,
 * excluding runner infrastructure and SQLite's implicit autoindexes. Lets us
 * compare two databases structurally without depending on DDL formatting.
 */
function schemaShape(db: Db): string[] {
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
      // `IF NOT EXISTS` does not affect the resulting schema object; the
      // baseline migration drops it (ADR 0015) while initSchema still carries
      // it, so normalize it away for a structural comparison.
      .replace(/\bIF NOT EXISTS\b/gi, '')
      .replace(/\s+/g, ' ')
      .trim();
    return `${row.type} ${row.name}: ${sql}`;
  });
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir !== undefined) {
      rmSync(dir, { recursive: true, force: true });
    }
  }
});

describe('normalizeMigrationSql / migrationChecksum', () => {
  it('normalizes CRLF and trailing newlines to a stable form', () => {
    expect(normalizeMigrationSql('a\r\nb\r\n')).toBe('a\nb\n');
    expect(normalizeMigrationSql('a\nb')).toBe('a\nb\n');
    expect(normalizeMigrationSql('a\nb\n\n\n')).toBe('a\nb\n');
    expect(normalizeMigrationSql('a\rb')).toBe('a\nb\n');
  });

  it('produces identical checksums for CRLF and LF variants of the same text', () => {
    const lf = normalizeMigrationSql('CREATE TABLE t (id INTEGER);\n');
    const crlf = normalizeMigrationSql('CREATE TABLE t (id INTEGER);\r\n');
    expect(migrationChecksum(lf)).toBe(migrationChecksum(crlf));
  });
});

describe('discoverMigrations', () => {
  it('returns migrations in ascending version order with normalized text and checksums', () => {
    const dir = makeMigrationDir({
      '0002_second.sql': 'CREATE TABLE b (id INTEGER);\n',
      '0001_first.sql': 'CREATE TABLE a (id INTEGER);\r\n',
    });
    const migrations = discoverMigrations(dir);
    expect(migrations.map((m) => m.version)).toEqual([1, 2]);
    expect(migrations.map((m) => m.name)).toEqual(['first', 'second']);
    expect(migrations[0].sql).toBe('CREATE TABLE a (id INTEGER);\n');
    expect(migrations[0].checksum).toBe(migrationChecksum(migrations[0].sql));
  });

  it('rejects a malformed filename', () => {
    const dir = makeMigrationDir({ '1_first.sql': 'SELECT 1;\n' });
    expect(() => discoverMigrations(dir)).toThrow(SchemaMigrationError);
    expect(() => discoverMigrations(dir)).toThrow(
      /malformed migration filename/,
    );
  });

  it('rejects a gap in the version sequence', () => {
    const dir = makeMigrationDir({
      '0001_first.sql': 'SELECT 1;\n',
      '0003_third.sql': 'SELECT 1;\n',
    });
    expect(() => discoverMigrations(dir)).toThrow(/non-contiguous/);
  });

  it('rejects a sequence that does not start at 1', () => {
    const dir = makeMigrationDir({ '0002_second.sql': 'SELECT 1;\n' });
    expect(() => discoverMigrations(dir)).toThrow(/non-contiguous/);
  });

  it('rejects duplicate version numbers', () => {
    const dir = makeMigrationDir({
      '0001_first.sql': 'SELECT 1;\n',
      '0001_other.sql': 'SELECT 1;\n',
    });
    expect(() => discoverMigrations(dir)).toThrow(
      /duplicate migration version/,
    );
  });

  it('rejects duplicate names', () => {
    const dir = makeMigrationDir({
      '0001_dup.sql': 'SELECT 1;\n',
      '0002_dup.sql': 'SELECT 1;\n',
    });
    expect(() => discoverMigrations(dir)).toThrow(/duplicate migration name/);
  });

  it('throws when the directory cannot be read', () => {
    expect(() =>
      discoverMigrations(join(tmpdir(), 'eshyra-missing-xyz')),
    ).toThrow(/cannot read migrations directory/);
  });
});

describe('runMigrations', () => {
  const NOW = () => '2026-06-26T00:00:00.000Z';

  it('applies all migrations to an empty database and records the ledger', () => {
    const dir = makeMigrationDir({
      '0001_first.sql': 'CREATE TABLE a (id INTEGER PRIMARY KEY);\n',
      '0002_second.sql': 'CREATE TABLE b (id INTEGER PRIMARY KEY);\n',
    });
    const db = openDatabase(':memory:');

    const result = runMigrations(db, { dir, now: NOW });

    expect(result.applied).toEqual([1, 2]);
    expect(result.alreadyApplied).toEqual([]);
    expect(result.currentVersion).toBe(2);

    const ledger = readMigrationLedger(db);
    expect(ledger.map((r) => r.version)).toEqual([1, 2]);
    expect(ledger.map((r) => r.name)).toEqual(['first', 'second']);
    expect(ledger.every((r) => r.applied_at === NOW())).toBe(true);
    const tables = db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name IN ('a','b') ORDER BY name",
      )
      .all() as { name: string }[];
    expect(tables.map((t) => t.name)).toEqual(['a', 'b']);
    db.close();
  });

  it('is idempotent: a second run applies nothing', () => {
    const dir = makeMigrationDir({
      '0001_first.sql': 'CREATE TABLE a (id INTEGER PRIMARY KEY);\n',
    });
    const db = openDatabase(':memory:');
    runMigrations(db, { dir, now: NOW });

    const second = runMigrations(db, { dir, now: NOW });
    expect(second.applied).toEqual([]);
    expect(second.alreadyApplied).toEqual([1]);
    expect(second.currentVersion).toBe(1);
    db.close();
  });

  it('applies only pending migrations when a new file is added', () => {
    const db = openDatabase(':memory:');
    const dir = makeMigrationDir({
      '0001_first.sql': 'CREATE TABLE a (id INTEGER PRIMARY KEY);\n',
    });
    runMigrations(db, { dir, now: NOW });

    // Add a second migration to the same directory and re-run.
    writeFileSync(
      join(dir, '0002_second.sql'),
      'CREATE TABLE b (id INTEGER PRIMARY KEY);\n',
    );
    const result = runMigrations(db, { dir, now: NOW });

    expect(result.applied).toEqual([2]);
    expect(result.alreadyApplied).toEqual([1]);
    expect(readMigrationLedger(db).map((r) => r.version)).toEqual([1, 2]);
    db.close();
  });

  it('migration 0012 preserves populated effects from the 0011 column order', () => {
    const bundled = discoverMigrations();
    const dir = makeMigrationDir(
      Object.fromEntries(
        bundled
          .slice(0, 11)
          .map((migration) => [
            `${String(migration.version).padStart(4, '0')}_${migration.name}.sql`,
            migration.sql,
          ]),
      ),
    );
    const db = openDatabase(':memory:');
    expect(runMigrations(db, { dir, now: NOW }).currentVersion).toBe(11);

    const insert = db.prepare(
      `INSERT INTO active_effect(
         campaign_id, effect_id, kind, display_name, source_kind, source_ref,
         source_actor_kind, source_actor_ref, requires_concentration,
         concentration_owner_kind, concentration_owner_ref, duration_kind,
         duration_amount, duration_unit, anchor_kind, anchor_at,
         anchor_game_time, anchor_combat_instance_id, anchor_round,
         expiry_trigger, dismissible, status, end_reason, end_detail, ended_at,
         created_at, provenance, session_id, updated_at,
         anchor_participant_kind, anchor_participant_ref,
         anchor_participant_turn_ordinal, anchor_trigger
       ) VALUES (
         ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
         ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
       )`,
    );
    insert.run(
      'campaign-1',
      'fx-ordinary',
      'curse',
      'Ordinary Effect',
      'ruling',
      'ruling:ordinary',
      'character',
      'pc-1',
      0,
      null,
      null,
      'until-removed',
      null,
      null,
      null,
      null,
      '1492-01-02T03:04:05.000Z',
      null,
      null,
      null,
      1,
      'suppressed',
      null,
      null,
      null,
      '2026-07-14T01:00:00.000Z',
      'test:migration',
      'session-old',
      '2026-07-14T02:00:00.000Z',
      null,
      null,
      null,
      null,
    );
    insert.run(
      'campaign-1',
      'fx-turn',
      'spell-effect',
      'Turn Effect',
      'spell',
      'spell:bless',
      'character',
      'pc-1',
      1,
      'character',
      'pc-1',
      'timed',
      3,
      'round',
      'source-turn-start',
      '2026-07-14T03:00:00.000Z',
      '1492-01-02T03:05:00.000Z',
      'ci-existing',
      4,
      null,
      0,
      'active',
      null,
      null,
      null,
      '2026-07-14T03:00:00.000Z',
      'test:turn-migration',
      'session-turn',
      '2026-07-14T03:00:00.000Z',
      'character',
      'pc-1',
      9,
      null,
    );
    const before = db
      .prepare('SELECT * FROM active_effect ORDER BY effect_id')
      .all() as Record<string, unknown>[];

    const migration12 = bundled[11];
    if (migration12 === undefined) throw new Error('missing migration 0012');
    writeFileSync(
      join(dir, '0012_campaign_actor_effect_rebinding.sql'),
      migration12.sql,
    );
    expect(runMigrations(db, { dir, now: NOW }).applied).toEqual([12]);
    expect(
      db.prepare('SELECT * FROM active_effect ORDER BY effect_id').all(),
    ).toEqual(before);
    db.close();
  });

  it('refuses to start when an applied migration file was edited (checksum drift)', () => {
    const db = openDatabase(':memory:');
    const dir = makeMigrationDir({
      '0001_first.sql': 'CREATE TABLE a (id INTEGER PRIMARY KEY);\n',
    });
    runMigrations(db, { dir, now: NOW });

    // Tamper with the already-applied migration file.
    writeFileSync(
      join(dir, '0001_first.sql'),
      'CREATE TABLE a (id INTEGER PRIMARY KEY, extra TEXT);\n',
    );
    expect(() => runMigrations(db, { dir, now: NOW })).toThrow(
      SchemaMigrationError,
    );
    expect(() => runMigrations(db, { dir, now: NOW })).toThrow(
      /checksum mismatch for applied migration 1/,
    );
    db.close();
  });

  it('refuses to start when an applied migration file is missing', () => {
    const db = openDatabase(':memory:');
    const dir = makeMigrationDir({
      '0001_first.sql': 'CREATE TABLE a (id INTEGER PRIMARY KEY);\n',
      '0002_second.sql': 'CREATE TABLE b (id INTEGER PRIMARY KEY);\n',
    });
    runMigrations(db, { dir, now: NOW });

    // Remove a file that was already applied, then add a fresh empty dir entry
    // so discovery still sees a contiguous prefix (only 0001 present).
    rmSync(join(dir, '0002_second.sql'), { force: true });
    expect(() => runMigrations(db, { dir, now: NOW })).toThrow(
      /applied migration 2 \(second\) has no migration file/,
    );
    db.close();
  });

  it('rolls back a failing migration and records nothing for it', () => {
    const db = openDatabase(':memory:');
    const dir = makeMigrationDir({
      '0001_first.sql': 'CREATE TABLE a (id INTEGER PRIMARY KEY);\n',
      '0002_bad.sql':
        'CREATE TABLE b (id INTEGER PRIMARY KEY);\nNOT VALID SQL;\n',
    });

    expect(() => runMigrations(db, { dir, now: NOW })).toThrow();

    // 0001 committed; 0002 rolled back entirely (no table, no ledger row).
    expect(readMigrationLedger(db).map((r) => r.version)).toEqual([1]);
    const bTable = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='b'")
      .all();
    expect(bTable).toHaveLength(0);
    db.close();
  });
});

describe('0001_initial baseline (bundled)', () => {
  it('produces a schema structurally equivalent to initSchema for a fresh DB', () => {
    const migrated = openDatabase(':memory:');
    runMigrations(migrated);

    const legacy = openDatabase(':memory:');
    initSchema(legacy);

    expect(schemaShape(migrated)).toEqual(schemaShape(legacy));
    migrated.close();
    legacy.close();
  });

  it('seeds the bootstrap rows (pc-1 character, clock singleton, active_character_id)', () => {
    const db = openDatabase(':memory:');
    runMigrations(db);

    const character = db
      .prepare(
        'SELECT id, role, provenance, session_id FROM character WHERE id = ?',
      )
      .get('pc-1') as
      | { id: string; role: string; provenance: string; session_id: string }
      | undefined;
    expect(character).toEqual({
      id: 'pc-1',
      role: 'pc',
      provenance: 'system:init_schema',
      session_id: 'bootstrap',
    });

    const clock = db.prepare('SELECT id FROM clock WHERE id = 1').get() as
      | { id: number }
      | undefined;
    expect(clock?.id).toBe(1);

    const active = db
      .prepare("SELECT value FROM meta WHERE key = 'active_character_id'")
      .get() as { value: string } | undefined;
    expect(active?.value).toBe('pc-1');
    db.close();
  });

  it('records 0001_initial in the ledger and does not seed meta.schema_version', () => {
    const db = openDatabase(':memory:');
    const result = runMigrations(db);

    const ledger: MigrationLedgerRow[] = readMigrationLedger(db);
    expect(ledger[0].version).toBe(1);
    expect(ledger[0].name).toBe('initial');
    expect(ledger[0].checksum).toMatch(/^[0-9a-f]{64}$/);
    // The baseline is followed by the bundled post-baseline migrations
    // (0002_character_sheet, …); currentVersion tracks the latest applied.
    expect(ledger.map((r) => r.version)).toEqual(ledger.map((_r, i) => i + 1));
    expect(result.currentVersion).toBe(ledger.length);

    // meta.schema_version is retired as schema authority (ADR 0015) and is not
    // seeded by the baseline.
    const version = db
      .prepare("SELECT value FROM meta WHERE key = 'schema_version'")
      .get();
    expect(version).toBeUndefined();
    db.close();
  });

  it('is idempotent against the bundled directory', () => {
    const db = openDatabase(':memory:');
    const first = runMigrations(db);
    const second = runMigrations(db);
    expect(second.applied).toEqual([]);
    expect(second.alreadyApplied).toEqual(first.applied);
    db.close();
  });
});
