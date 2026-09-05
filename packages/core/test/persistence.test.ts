import { describe, expect, it } from 'vitest';
import { openDatabase, withTransaction } from '../src/persistence/db.js';
import {
  readMigrationLedger,
  SchemaResetRequiredError,
} from '../src/persistence/migrationRunner.js';
import { initSchema } from '../src/persistence/schema.js';

describe('persistence', () => {
  it('initSchema applies the bundled migrations and records the ledger', () => {
    const db = openDatabase(':memory:');
    initSchema(db);
    const ledger = readMigrationLedger(db);
    // Contiguous 1..N baseline + post-baseline migrations, baseline first.
    expect(ledger.map((row) => row.version)).toEqual(
      ledger.map((_row, index) => index + 1),
    );
    expect(ledger[0].name).toBe('initial');
    expect(ledger.at(-1)).toMatchObject({
      version: 27,
      name: 'turn_trace_campaign_rules_evidence',
    });
    db.close();
  });

  it('initSchema is idempotent: a second call applies no further migrations', () => {
    const db = openDatabase(':memory:');
    initSchema(db);
    const afterFirst = readMigrationLedger(db).map((row) => row.version);
    initSchema(db);
    expect(readMigrationLedger(db).map((row) => row.version)).toEqual(
      afterFirst,
    );
    db.close();
  });

  it('initSchema rejects a newer legacy schema_version before mutating the database', () => {
    const db = openDatabase(':memory:');
    db.exec(`
      CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      INSERT INTO meta(key, value) VALUES ('schema_version', '16');
    `);

    expect(() => initSchema(db)).toThrow(SchemaResetRequiredError);

    const tables = db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name",
      )
      .all() as Array<{ name: string }>;
    expect(tables.map((row) => row.name)).toEqual(['meta']);
    db.close();
  });

  it('initSchema rejects a below-baseline legacy schema_version without mutation', () => {
    const db = openDatabase(':memory:');
    db.exec(`
      CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      INSERT INTO meta(key, value) VALUES ('schema_version', '1');
    `);

    expect(() => initSchema(db)).toThrow(SchemaResetRequiredError);

    const tables = db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name",
      )
      .all() as Array<{ name: string }>;
    expect(tables.map((row) => row.name)).toEqual(['meta']);
    db.close();
  });

  it('initSchema fails closed for a legacy unversioned database without mutation', () => {
    const db = openDatabase(':memory:');
    db.exec(`
      CREATE TABLE character (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        name TEXT
      );
    `);

    expect(() => initSchema(db)).toThrow(SchemaResetRequiredError);

    const tables = db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name",
      )
      .all() as Array<{ name: string }>;
    expect(tables.map((row) => row.name)).toEqual(['character']);
    const characterColumns = db
      .prepare('PRAGMA table_info(character)')
      .all() as Array<{ name: string }>;
    expect(characterColumns.map((column) => column.name)).toEqual([
      'id',
      'name',
    ]);
    db.close();
  });

  it('withTransaction commits on success', () => {
    const db = openDatabase(':memory:');
    initSchema(db);
    withTransaction(db, (d) =>
      d.prepare('INSERT INTO meta(key, value) VALUES (?, ?)').run('a', '1'),
    );
    const row = db.prepare('SELECT value FROM meta WHERE key = ?').get('a') as
      | { value: string }
      | undefined;
    expect(row?.value).toBe('1');
    db.close();
  });

  it('withTransaction rolls back when the function throws', () => {
    const db = openDatabase(':memory:');
    initSchema(db);
    expect(() =>
      withTransaction(db, (d) => {
        d.prepare('INSERT INTO meta(key, value) VALUES (?, ?)').run('b', '2');
        throw new Error('boom');
      }),
    ).toThrow('boom');
    const row = db.prepare('SELECT value FROM meta WHERE key = ?').get('b');
    expect(row).toBeUndefined();
    db.close();
  });

  it('creates the campaign_arc table with the one-open partial index', () => {
    const db = openDatabase(':memory:');
    initSchema(db);
    const tables = db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='campaign_arc'",
      )
      .all();
    expect(tables).toHaveLength(1);
    const indexes = db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='index' AND name='campaign_arc_one_open'",
      )
      .all();
    expect(indexes).toHaveLength(1);
    db.close();
  });

  it('adds an arc_id column to campaign_session', () => {
    const db = openDatabase(':memory:');
    initSchema(db);
    const cols = db
      .prepare('PRAGMA table_info(campaign_session)')
      .all() as Array<{ name: string }>;
    expect(cols.map((c) => c.name)).toContain('arc_id');
    db.close();
  });

  it('initSchema creates canonical game-state tables with provenance columns and seed rows', () => {
    const db = openDatabase(':memory:');
    initSchema(db);

    const expectedTables = [
      'character',
      'inventory',
      'plot_flags',
      'clock',
      'overlay_facts',
    ];
    const tables = db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name",
      )
      .all() as Array<{ name: string }>;
    expect(tables.map((row) => row.name)).toEqual(
      expect.arrayContaining(expectedTables),
    );

    for (const table of expectedTables) {
      const columns = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{
        name: string;
      }>;
      expect(columns.map((column) => column.name)).toEqual(
        expect.arrayContaining(['provenance', 'session_id', 'updated_at']),
      );
    }

    const characterRows = db.prepare('SELECT id FROM character').all();
    expect(characterRows).toEqual([{ id: 'pc-1' }]);

    const clockRows = db.prepare('SELECT id FROM clock').all();
    expect(clockRows).toEqual([{ id: 1 }]);

    const active = db
      .prepare("SELECT value FROM meta WHERE key = 'active_character_id'")
      .get() as { value: string } | undefined;
    expect(active?.value).toBe('pc-1');

    db.close();
  });
});
