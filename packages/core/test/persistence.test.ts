import { describe, expect, it } from 'vitest';
import { openDatabase, withTransaction } from '../src/persistence/db.js';
import { SchemaMigrationError } from '../src/persistence/migrations.js';
import {
  initSchema,
  SCHEMA_VERSION,
  SchemaCompatibilityError,
} from '../src/persistence/schema.js';

describe('persistence', () => {
  it('initSchema records the schema version', () => {
    const db = openDatabase(':memory:');
    initSchema(db);
    const row = db
      .prepare('SELECT value FROM meta WHERE key = ?')
      .get('schema_version') as { value: string } | undefined;
    expect(row?.value).toBe(String(SCHEMA_VERSION));
    db.close();
  });

  it('accepts a current schema without changing the version', () => {
    const db = openDatabase(':memory:');
    initSchema(db);

    initSchema(db);

    const row = db
      .prepare('SELECT value FROM meta WHERE key = ?')
      .get('schema_version') as { value: string } | undefined;
    expect(row?.value).toBe(String(SCHEMA_VERSION));
    db.close();
  });

  it('refuses newer schema versions before mutating the database', () => {
    const db = openDatabase(':memory:');
    db.exec(`
      CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      INSERT INTO meta(key, value) VALUES ('schema_version', '${SCHEMA_VERSION + 1}');
    `);

    expect(() => initSchema(db)).toThrow(SchemaCompatibilityError);

    const tables = db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name",
      )
      .all() as Array<{ name: string }>;
    expect(tables.map((row) => row.name)).toEqual(['meta']);
    const row = db
      .prepare('SELECT value FROM meta WHERE key = ?')
      .get('schema_version') as { value: string } | undefined;
    expect(row?.value).toBe(String(SCHEMA_VERSION + 1));
    db.close();
  });

  it('throws SchemaMigrationError without partial mutation when no migration covers the database version', () => {
    // Version 1 has no registered migration path (MIGRATIONS starts at v8), so
    // the pre-flight check must fail clearly without altering the database.
    const db = openDatabase(':memory:');
    db.exec(`
      CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      INSERT INTO meta(key, value) VALUES ('schema_version', '1');
    `);

    expect(() => initSchema(db)).toThrow(SchemaMigrationError);

    const tables = db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name",
      )
      .all() as Array<{ name: string }>;
    expect(tables.map((row) => row.name)).toEqual(['meta']);
    const row = db
      .prepare('SELECT value FROM meta WHERE key = ?')
      .get('schema_version') as { value: string } | undefined;
    expect(row?.value).toBe('1');
    db.close();
  });

  it('fails clearly for legacy unversioned databases without partial mutation', () => {
    const db = openDatabase(':memory:');
    db.exec(`
      CREATE TABLE character (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        name TEXT
      );
    `);

    expect(() => initSchema(db)).toThrow(SchemaCompatibilityError);

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

  it('exports SCHEMA_VERSION 14', () => {
    expect(SCHEMA_VERSION).toBe(14);
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
      .all() as Array<{
      name: string;
    }>;
    expect(cols.map((c) => c.name)).toContain('arc_id');
    db.close();
  });

  it('initSchema creates canonical game-state tables with provenance columns', () => {
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

    db.close();
  });
});
