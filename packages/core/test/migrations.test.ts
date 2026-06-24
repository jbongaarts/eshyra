import { describe, expect, it } from 'vitest';
import {
  canonicalize,
  serializeCampaign,
} from '../src/persistence/checkpoint/serialize.js';
import type { Db } from '../src/persistence/db.js';
import { openDatabase } from '../src/persistence/db.js';
import {
  MIGRATIONS,
  migrateSchema,
  SchemaMigrationError,
} from '../src/persistence/migrations.js';
import { initSchema, SCHEMA_VERSION } from '../src/persistence/schema.js';

describe('migrations', () => {
  it('SchemaMigrationError carries the expected name', () => {
    const err = new SchemaMigrationError('test');
    expect(err.name).toBe('SchemaMigrationError');
    expect(err.message).toBe('test');
    expect(err).toBeInstanceOf(Error);
  });

  it('migrateSchema is a no-op when fromVersion equals toVersion', () => {
    const db = openDatabase(':memory:');
    db.exec(`
      CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      INSERT INTO meta VALUES ('schema_version', '5');
    `);
    migrateSchema(db, 5, 5, {});
    const row = db
      .prepare('SELECT value FROM meta WHERE key = ?')
      .get('schema_version') as { value: string } | undefined;
    expect(row?.value).toBe('5');
    db.close();
  });

  it('migrateSchema applies a single migration step and advances schema_version', () => {
    const db = openDatabase(':memory:');
    db.exec(`
      CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      INSERT INTO meta VALUES ('schema_version', '1');
    `);
    const testMigrations: Record<number, (db: Db) => void> = {
      2: (d) => d.exec('CREATE TABLE migration_proof (id INTEGER PRIMARY KEY)'),
    };

    migrateSchema(db, 1, 2, testMigrations);

    const tables = db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='migration_proof'",
      )
      .all();
    expect(tables).toHaveLength(1);
    const row = db
      .prepare('SELECT value FROM meta WHERE key = ?')
      .get('schema_version') as { value: string } | undefined;
    expect(row?.value).toBe('2');
    db.close();
  });

  it('migrateSchema applies multiple migration steps in ascending version order', () => {
    const db = openDatabase(':memory:');
    db.exec(`
      CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      INSERT INTO meta VALUES ('schema_version', '5');
      CREATE TABLE base (id INTEGER PRIMARY KEY);
    `);
    const applied: number[] = [];
    const testMigrations: Record<number, (db: Db) => void> = {
      6: (_d) => applied.push(6),
      7: (_d) => applied.push(7),
      8: (_d) => applied.push(8),
    };

    migrateSchema(db, 5, 8, testMigrations);

    expect(applied).toEqual([6, 7, 8]);
    const row = db
      .prepare('SELECT value FROM meta WHERE key = ?')
      .get('schema_version') as { value: string } | undefined;
    expect(row?.value).toBe('8');
    db.close();
  });

  it('migrateSchema updates schema_version atomically with each step', () => {
    const db = openDatabase(':memory:');
    db.exec(`
      CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      INSERT INTO meta VALUES ('schema_version', '5');
    `);
    const testMigrations: Record<number, (db: Db) => void> = {
      6: (_d) => {},
      7: () => {
        throw new Error('step 7 fails');
      },
      8: (_d) => {},
    };

    expect(() => migrateSchema(db, 5, 8, testMigrations)).toThrow(
      SchemaMigrationError,
    );

    // Version should be 6 (step 6 committed) not 7 or 8 (step 7 rolled back)
    const row = db
      .prepare('SELECT value FROM meta WHERE key = ?')
      .get('schema_version') as { value: string } | undefined;
    expect(row?.value).toBe('6');
    db.close();
  });

  it('migrateSchema rolls back a failed step and throws SchemaMigrationError', () => {
    const db = openDatabase(':memory:');
    db.exec(`
      CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      INSERT INTO meta VALUES ('schema_version', '1');
    `);
    const testMigrations: Record<number, (db: Db) => void> = {
      2: (d) => {
        d.exec('CREATE TABLE will_be_rolled_back (id INTEGER PRIMARY KEY)');
        throw new Error('intentional failure');
      },
    };

    expect(() => migrateSchema(db, 1, 2, testMigrations)).toThrow(
      SchemaMigrationError,
    );

    const tables = db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='will_be_rolled_back'",
      )
      .all();
    expect(tables).toHaveLength(0);
    const row = db
      .prepare('SELECT value FROM meta WHERE key = ?')
      .get('schema_version') as { value: string } | undefined;
    expect(row?.value).toBe('1');
    db.close();
  });

  it('migrateSchema throws SchemaMigrationError when no migration is registered for a version', () => {
    const db = openDatabase(':memory:');
    db.exec(`
      CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      INSERT INTO meta VALUES ('schema_version', '5');
    `);

    expect(() => migrateSchema(db, 5, 6, {})).toThrow(SchemaMigrationError);
    expect(() => migrateSchema(db, 5, 6, {})).toThrow(
      /no migration defined for version 6/,
    );
    db.close();
  });

  it('migrateSchema pre-flight rejects a gap before applying any migration', () => {
    // fromVersion=5, toVersion=8; migrations has 6 and 8 but not 7.
    // No mutation should occur — not even migration 6.
    const db = openDatabase(':memory:');
    db.exec(`
      CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      INSERT INTO meta VALUES ('schema_version', '5');
    `);
    let migration6Applied = false;
    const testMigrations: Record<number, (db: Db) => void> = {
      6: (d) => {
        migration6Applied = true;
        d.exec('CREATE TABLE migration_6_proof (id INTEGER PRIMARY KEY)');
      },
      // 7 intentionally absent
      8: (_d) => {},
    };

    expect(() => migrateSchema(db, 5, 8, testMigrations)).toThrow(
      SchemaMigrationError,
    );
    expect(() => migrateSchema(db, 5, 8, testMigrations)).toThrow(
      /no migration defined for version 7/,
    );

    const row = db
      .prepare('SELECT value FROM meta WHERE key = ?')
      .get('schema_version') as { value: string } | undefined;
    expect(row?.value).toBe('5');

    const tables = db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='migration_6_proof'",
      )
      .all();
    expect(tables).toHaveLength(0);
    expect(migration6Applied).toBe(false);

    db.close();
  });

  it('production MIGRATIONS registry contains a migration for SCHEMA_VERSION', () => {
    expect(MIGRATIONS[SCHEMA_VERSION]).toBeDefined();
    expect(typeof MIGRATIONS[SCHEMA_VERSION]).toBe('function');
  });

  it('initSchema migrates a v7 database to the current schema version', () => {
    const db = openDatabase(':memory:');
    // Simulate a v7 campaign DB: has campaign_session but lacks campaign_arc and arc_id column
    db.exec(`
      CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      INSERT INTO meta VALUES ('schema_version', '7');
      CREATE TABLE campaign_session (
        campaign_id TEXT NOT NULL,
        session_id  TEXT NOT NULL,
        status      TEXT NOT NULL CHECK (status IN ('open', 'closed')),
        started_at  TEXT NOT NULL,
        closed_at   TEXT,
        PRIMARY KEY (campaign_id, session_id)
      );
      CREATE UNIQUE INDEX campaign_session_one_open
        ON campaign_session(campaign_id) WHERE status = 'open';
    `);

    initSchema(db);

    const versionRow = db
      .prepare('SELECT value FROM meta WHERE key = ?')
      .get('schema_version') as { value: string } | undefined;
    expect(versionRow?.value).toBe(String(SCHEMA_VERSION));

    const arcTable = db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='campaign_arc'",
      )
      .all();
    expect(arcTable).toHaveLength(1);

    const cols = db.prepare('PRAGMA table_info(campaign_session)').all() as {
      name: string;
    }[];
    expect(cols.map((c) => c.name)).toContain('arc_id');

    const rulesTable = db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='campaign_rules_binding'",
      )
      .all();
    expect(rulesTable).toHaveLength(1);

    db.close();
  });

  it('v9→v10 adds acting_character_id to an existing turn_trace', () => {
    const db = openDatabase(':memory:');
    db.exec(`
      CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      INSERT INTO meta VALUES ('schema_version', '9');
      CREATE TABLE turn_trace (
        campaign_id TEXT NOT NULL,
        session_id  TEXT NOT NULL,
        turn_id     TEXT NOT NULL,
        PRIMARY KEY (campaign_id, session_id, turn_id)
      );
    `);

    migrateSchema(db, 9, 10);

    const cols = db.prepare('PRAGMA table_info(turn_trace)').all() as {
      name: string;
    }[];
    expect(cols.map((c) => c.name)).toContain('acting_character_id');
    const versionRow = db
      .prepare('SELECT value FROM meta WHERE key = ?')
      .get('schema_version') as { value: string } | undefined;
    expect(versionRow?.value).toBe('10');
    db.close();
  });

  it('v10→v11 creates the non-canon turn failure diagnostic table', () => {
    const db = openDatabase(':memory:');
    db.exec(`
      CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      INSERT INTO meta VALUES ('schema_version', '10');
    `);

    migrateSchema(db, 10, 11);

    const tables = db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='turn_failure_diagnostic'",
      )
      .all();
    expect(tables).toHaveLength(1);
    const versionRow = db
      .prepare('SELECT value FROM meta WHERE key = ?')
      .get('schema_version') as { value: string } | undefined;
    expect(versionRow?.value).toBe('11');
    db.close();
  });

  it('v11→v12 creates the campaign-owned adventure_run table', () => {
    const db = openDatabase(':memory:');
    db.exec(`
      CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      INSERT INTO meta VALUES ('schema_version', '11');
    `);

    migrateSchema(db, 11, 12);

    const tables = db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='adventure_run'",
      )
      .all();
    expect(tables).toHaveLength(1);
    const cols = db.prepare('PRAGMA table_info(adventure_run)').all() as {
      name: string;
    }[];
    expect(cols.map((c) => c.name)).toEqual(
      expect.arrayContaining([
        'campaign_id',
        'run_id',
        'module_id',
        'progress_json',
      ]),
    );
    const versionRow = db
      .prepare('SELECT value FROM meta WHERE key = ?')
      .get('schema_version') as { value: string } | undefined;
    expect(versionRow?.value).toBe('12');
    db.close();
  });

  it('v12→v13 creates campaign_overlay_lore and preserves existing campaign data', () => {
    const db = openDatabase(':memory:');
    db.exec(`
      CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      INSERT INTO meta VALUES ('schema_version', '12');
      CREATE TABLE plot_flags (
        key TEXT PRIMARY KEY,
        value_json TEXT NOT NULL,
        provenance TEXT NOT NULL,
        session_id TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      INSERT INTO plot_flags VALUES (
        'existing_flag',
        '{"still":"readable"}',
        'test:v12',
        'session-1',
        '2026-05-20T09:00:00.000Z'
      );
      CREATE TABLE clock (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        in_game_time TEXT NOT NULL DEFAULT '',
        current_location_id TEXT,
        provenance TEXT NOT NULL,
        session_id TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      INSERT INTO clock VALUES (
        1,
        'morning',
        'hearthmere',
        'test:v12',
        'session-1',
        '2026-05-20T09:00:00.000Z'
      );
    `);

    migrateSchema(db, 12, 13);

    const versionRow = db
      .prepare('SELECT value FROM meta WHERE key = ?')
      .get('schema_version') as { value: string } | undefined;
    expect(versionRow?.value).toBe('13');

    const tables = db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='campaign_overlay_lore'",
      )
      .all();
    expect(tables).toHaveLength(1);

    const cols = db
      .prepare('PRAGMA table_info(campaign_overlay_lore)')
      .all() as {
      name: string;
    }[];
    expect(cols.map((c) => c.name)).toEqual(
      expect.arrayContaining([
        'id',
        'kind',
        'subject_id',
        'subject_text',
        'location_id',
        'npc_id',
        'faction_id',
        'fact',
        'truth_status',
        'source',
        'scope',
        'visibility',
        'introduced_at_turn_id',
        'introduced_at_session_id',
        'supersedes',
        'invalidates',
        'tags_json',
        'provenance',
        'updated_at',
      ]),
    );

    db.prepare(
      `INSERT INTO campaign_overlay_lore(
        id, kind, subject_id, subject_text, location_id, npc_id, faction_id,
        fact, truth_status, source, scope, visibility,
        introduced_at_turn_id, introduced_at_session_id, supersedes,
        invalidates, tags_json, provenance, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      'old-renn-hook',
      'quest_hook',
      'old-renn',
      'Old Renn',
      'hearthmere',
      null,
      null,
      'Old Renn and his charcoal cart are missing.',
      'reported',
      'dm_improvised',
      'campaign',
      'player_visible',
      'turn-1',
      'session-1',
      null,
      null,
      '["hearthmere","missing-cart"]',
      'model:turn-1',
      '2026-05-20T10:00:00.000Z',
    );

    const row = db
      .prepare(
        'SELECT subject_text, tags_json, visibility FROM campaign_overlay_lore WHERE id = ?',
      )
      .get('old-renn-hook') as {
      subject_text: string;
      tags_json: string;
      visibility: string;
    };
    expect(row.subject_text).toBe('Old Renn');
    expect(JSON.parse(row.tags_json)).toEqual(['hearthmere', 'missing-cart']);
    expect(row.visibility).toBe('player_visible');

    const flag = db
      .prepare('SELECT value_json FROM plot_flags WHERE key = ?')
      .get('existing_flag') as { value_json: string } | undefined;
    expect(flag?.value_json).toBe('{"still":"readable"}');
    expect(canonicalize(serializeCampaign(db))).toContain('old-renn-hook');
    db.close();
  });
});
