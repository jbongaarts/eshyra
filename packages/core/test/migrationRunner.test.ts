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

  it('migration 0016 separates legacy unheld world placement from held storage', () => {
    const bundled = discoverMigrations();
    const dir = makeMigrationDir(
      Object.fromEntries(
        bundled
          .slice(0, 15)
          .map((migration) => [
            `${String(migration.version).padStart(4, '0')}_${migration.name}.sql`,
            migration.sql,
          ]),
      ),
    );
    const db = openDatabase(':memory:');
    expect(runMigrations(db, { dir, now: NOW }).currentVersion).toBe(15);
    db.prepare(
      `INSERT INTO inventory(
         id, character_id, name, location, provenance, session_id, updated_at
       ) VALUES
         ('held', 'pc-1', 'Held', 'backpack', 'test', 'session', ?),
         ('unheld', NULL, 'Unheld', 'old-road', 'test', 'session', ?),
         ('unheld-blank', NULL, 'Unheld Blank', '   ', 'test', 'session', ?)`,
    ).run(NOW(), NOW(), NOW());

    const migration16 = bundled[15];
    if (migration16 === undefined) throw new Error('missing migration 0016');
    writeFileSync(
      join(dir, '0016_inventory_world_location.sql'),
      migration16.sql,
    );
    expect(runMigrations(db, { dir, now: NOW }).applied).toEqual([16]);
    expect(
      db
        .prepare(
          `SELECT id, character_id, location, world_location_id
           FROM inventory ORDER BY id`,
        )
        .all(),
    ).toEqual([
      {
        id: 'held',
        character_id: 'pc-1',
        location: 'backpack',
        world_location_id: null,
      },
      {
        id: 'unheld',
        character_id: null,
        location: null,
        world_location_id: 'old-road',
      },
      {
        id: 'unheld-blank',
        character_id: null,
        location: null,
        world_location_id: null,
      },
    ]);
    expect(() =>
      db
        .prepare(
          "UPDATE inventory SET world_location_id='elsewhere' WHERE id='held'",
        )
        .run(),
    ).toThrow(/custody\/location invariant/);
    expect(() =>
      db.prepare("UPDATE inventory SET location='bag' WHERE id='unheld'").run(),
    ).toThrow(/custody\/location invariant/);
    for (const blank of ['', '   ']) {
      expect(() =>
        db
          .prepare("UPDATE inventory SET world_location_id=? WHERE id='unheld'")
          .run(blank),
      ).toThrow(/custody\/location invariant/);
      expect(() =>
        db
          .prepare(
            `INSERT INTO inventory(
               id, name, world_location_id, provenance, session_id, updated_at
             ) VALUES (?, 'Blank', ?, 'test', 'session', ?)`,
          )
          .run(`blank-${blank.length}`, blank, NOW()),
      ).toThrow(/custody\/location invariant/);
    }
    expect(
      db
        .prepare(
          `SELECT type, name FROM sqlite_master
           WHERE name IN (
             'inventory_unheld_world_location_id',
             'inventory_location_insert_guard',
             'inventory_location_update_guard'
           ) ORDER BY type, name`,
        )
        .all(),
    ).toEqual([
      { type: 'index', name: 'inventory_unheld_world_location_id' },
      { type: 'trigger', name: 'inventory_location_insert_guard' },
      { type: 'trigger', name: 'inventory_location_update_guard' },
    ]);
    db.close();
  });

  it('migration 0017 classifies legacy drops and enforces explicit unheld disposition', () => {
    const bundled = discoverMigrations();
    const dir = makeMigrationDir(
      Object.fromEntries(
        bundled
          .slice(0, 16)
          .map((migration) => [
            `${String(migration.version).padStart(4, '0')}_${migration.name}.sql`,
            migration.sql,
          ]),
      ),
    );
    const db = openDatabase(':memory:');
    expect(runMigrations(db, { dir, now: NOW }).currentVersion).toBe(16);
    db.prepare(
      `INSERT INTO inventory(
         id, name, world_location_id, provenance, session_id, updated_at
       ) VALUES ('legacy-drop', 'Legacy Drop', 'old-road', 'test', 'session', ?)`,
    ).run(NOW());

    const migration17 = bundled[16];
    if (migration17 === undefined) throw new Error('missing migration 0017');
    writeFileSync(
      join(dir, '0017_inventory_unheld_disposition.sql'),
      migration17.sql,
    );
    expect(runMigrations(db, { dir, now: NOW }).applied).toEqual([17]);
    expect(
      db
        .prepare(
          `SELECT character_id, world_location_id, unheld_disposition
           FROM inventory WHERE id='legacy-drop'`,
        )
        .get(),
    ).toEqual({
      character_id: null,
      world_location_id: 'old-road',
      unheld_disposition: 'dropped',
    });
    expect(() =>
      db
        .prepare(
          `INSERT INTO inventory(
             id, name, world_location_id, provenance, session_id, updated_at
           ) VALUES ('implicit', 'Implicit', 'old-road', 'test', 'session', ?)`,
        )
        .run(NOW()),
    ).toThrow(/custody\/location invariant/);
    expect(() =>
      db
        .prepare(
          `UPDATE inventory
           SET character_id='pc-1'
           WHERE id='legacy-drop'`,
        )
        .run(),
    ).toThrow(/custody\/location invariant/);
    expect(
      db
        .prepare(
          `SELECT type, name FROM sqlite_master
           WHERE name IN (
             'inventory_unheld_world_location_id',
             'inventory_claimable_world_location_id'
           ) ORDER BY name`,
        )
        .all(),
    ).toEqual([
      { type: 'index', name: 'inventory_claimable_world_location_id' },
    ]);
    db.close();
  });

  it('migration 0018 moves adoption review markers out of writable inventory JSON', () => {
    const bundled = discoverMigrations();
    const dir = makeMigrationDir(
      Object.fromEntries(
        bundled
          .slice(0, 17)
          .map((migration) => [
            `${String(migration.version).padStart(4, '0')}_${migration.name}.sql`,
            migration.sql,
          ]),
      ),
    );
    const db = openDatabase(':memory:');
    expect(runMigrations(db, { dir, now: NOW }).currentVersion).toBe(17);
    db.prepare(
      `INSERT INTO inventory(
         id, character_id, name, properties_json, provenance, session_id,
         updated_at
       ) VALUES ('legacy-review', 'pc-1', 'Legacy Review', ?, 'test', 'session', ?)`,
    ).run(
      JSON.stringify({
        material: 'silver',
        mechanics: { economies: { invented: { remaining: 3 } } },
        magicItemAdoption: {
          status: 'gm-review-required',
          requestedPackRef: 'magic-item:orb-of-dragonkind',
          requestedVariantId: 'red',
          reason: 'existing bond needs reconciliation',
        },
      }),
      NOW(),
    );
    db.prepare(
      `INSERT INTO item_state(
         inventory_id, state_json, provenance, session_id, updated_at
       ) VALUES ('legacy-review', '{', 'test', 'session', ?)`,
    ).run(NOW());

    const migration18 = bundled[17];
    if (migration18 === undefined) throw new Error('missing migration 0018');
    writeFileSync(
      join(dir, '0018_inventory_adoption_review.sql'),
      migration18.sql,
    );
    expect(runMigrations(db, { dir, now: NOW }).applied).toEqual([18]);
    expect(
      db
        .prepare(
          `SELECT requested_pack_ref, requested_variant_id, reason,
                  raw_properties_json, raw_item_state_json
           FROM inventory_adoption_review WHERE inventory_id='legacy-review'`,
        )
        .get(),
    ).toEqual({
      requested_pack_ref: 'magic-item:orb-of-dragonkind',
      requested_variant_id: 'red',
      reason: 'existing bond needs reconciliation',
      raw_properties_json: expect.stringContaining('invented'),
      raw_item_state_json: '{',
    });
    expect(
      db
        .prepare(
          "SELECT properties_json FROM inventory WHERE id='legacy-review'",
        )
        .get(),
    ).toEqual({ properties_json: '{"material":"silver"}' });
    expect(
      db
        .prepare(
          "SELECT state_json FROM item_state WHERE inventory_id='legacy-review'",
        )
        .get(),
    ).toBeUndefined();
    expect(
      db
        .prepare(
          `SELECT name FROM sqlite_master WHERE type='table'
           AND name='inventory_custody_event'`,
        )
        .get(),
    ).toEqual({ name: 'inventory_custody_event' });
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
