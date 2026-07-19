import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  advanceWorldTime,
  auditActiveEffectIntegrity,
  endActiveEffect,
  listActiveEffects,
} from '../src/internal.js';
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

function activeEffectTableNames(db: Db): string[] {
  return (
    db
      .prepare(
        `SELECT name FROM sqlite_master
         WHERE type = 'table' AND name LIKE 'active_effect%'
         ORDER BY name`,
      )
      .all() as { name: string }[]
  ).map((row) => row.name);
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

describe('migration 0013 elapsed-world transition', () => {
  it('backfills a version-12 world timer from elapsed minute zero', () => {
    const dir = mkdtempSync(join(tmpdir(), 'eshyra-pre0013-'));
    for (const migration of discoverMigrations()) {
      if (migration.version > 12) continue;
      writeFileSync(
        join(
          dir,
          `${String(migration.version).padStart(4, '0')}_${migration.name}.sql`,
        ),
        migration.sql,
      );
    }
    const db = openDatabase(':memory:');
    migrateDatabase(db, { now: NOW, dir });
    db.prepare(
      `INSERT INTO active_effect(
        campaign_id, effect_id, kind, display_name, source_kind,
        duration_kind, duration_amount, duration_unit, anchor_kind, anchor_at,
        status, created_at, provenance, session_id, updated_at
      ) VALUES (?, ?, 'condition-package', ?, 'ruling', 'timed', 1, 'hour',
        'effect-created', ?, 'active', ?, ?, ?, ?)`,
    ).run(
      'campaign-1',
      'fx-legacy-hour',
      'Legacy hour',
      NOW(),
      NOW(),
      'test:migration',
      'session-1',
      NOW(),
    );
    db.prepare(
      `INSERT INTO active_effect_event(
        campaign_id, effect_id, seq, event_kind, detail_json,
        occurred_at, provenance, session_id
      ) VALUES (?, ?, 1, 'created', '{}', ?, ?, ?),
               (?, ?, 2, 'ended', '{}', ?, ?, ?)`,
    ).run(
      'campaign-1',
      'fx-legacy-ended-hour',
      NOW(),
      'test:migration',
      'session-1',
      'campaign-1',
      'fx-legacy-ended-hour',
      NOW(),
      'test:migration',
      'session-1',
    );
    db.prepare(
      `INSERT INTO active_effect(
        campaign_id, effect_id, kind, display_name, source_kind,
        duration_kind, duration_amount, duration_unit, anchor_kind, anchor_at,
        status, end_reason, ended_at, created_at, provenance, session_id, updated_at
      ) VALUES (?, ?, 'condition-package', ?, 'ruling', 'timed', 1, 'hour',
        'effect-created', ?, 'ended', 'dismissed', ?, ?, ?, ?, ?)`,
    ).run(
      'campaign-1',
      'fx-legacy-ended-hour',
      'Legacy ended hour',
      NOW(),
      NOW(),
      NOW(),
      'test:migration',
      'session-1',
      NOW(),
    );
    expect(migrateDatabase(db, { now: NOW }).migrations.applied).toEqual([
      13, 14, 15, 16, 17, 18, 19,
    ]);
    expect(
      db
        .prepare(
          'SELECT anchor_elapsed_minutes, deadline_elapsed_minutes FROM active_effect WHERE effect_id=?',
        )
        .get('fx-legacy-hour'),
    ).toEqual({ anchor_elapsed_minutes: 0, deadline_elapsed_minutes: 60 });
    expect(
      listActiveEffects(db, 'campaign-1', { includeEnded: true }).some(
        (effect) => effect.effectId === 'fx-legacy-ended-hour',
      ),
    ).toBe(true);
    expect(auditActiveEffectIntegrity(db, 'campaign-1')).toEqual([]);
    db.prepare(
      'UPDATE active_effect SET anchor_elapsed_minutes=0 WHERE effect_id=?',
    ).run('fx-legacy-ended-hour');
    expect(auditActiveEffectIntegrity(db, 'campaign-1')).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ effectId: 'fx-legacy-ended-hour' }),
      ]),
    );
    expect(() =>
      endActiveEffect(db, {
        campaignId: 'campaign-1',
        effectId: 'fx-legacy-hour',
        reason: 'expired',
        provenance: 'test',
        sessionId: 'session-1',
        at: NOW(),
      }),
    ).toThrow(/has not expired yet/);
    advanceWorldTime(db, {
      campaignId: 'campaign-1',
      minutes: 60,
      provenance: 'test',
      sessionId: 'session-1',
      at: NOW(),
    });
    expect(
      endActiveEffect(db, {
        campaignId: 'campaign-1',
        effectId: 'fx-legacy-hour',
        reason: 'expired',
        provenance: 'test',
        sessionId: 'session-1',
        at: NOW(),
      }).effect.endReason,
    ).toBe('expired');
    db.close();
    rmSync(dir, { recursive: true, force: true });
  });
});

describe('migrateDatabase (end to end)', () => {
  it('applies all migrations to an empty database from zero', () => {
    const db = openDatabase(':memory:');
    const result = migrateDatabase(db, { now: NOW });
    expect(result.legacy.action).toBe('empty');
    expect(result.migrations.applied).toEqual([
      1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19,
    ]);
    expect(readMigrationLedger(db).map((r) => [r.version, r.name])).toEqual([
      [1, 'initial'],
      [2, 'character_sheet'],
      [3, 'progression_state_and_ledger'],
      [4, 'character_wallet_event'],
      [5, 'death_state_and_temp_hp'],
      [6, 'action_economy_turn_budget'],
      [7, 'usage_attunement_inspiration'],
      [8, 'character_spell_slots'],
      [9, 'legal_default_ability_scores'],
      [10, 'active_effects'],
      [11, 'active_effect_anchor_evidence'],
      [12, 'campaign_actor_effect_rebinding'],
      [13, 'rest_engine'],
      [14, 'magic_item_instance_state'],
      [15, 'magic_item_variant_identity'],
      [16, 'inventory_world_location'],
      [17, 'inventory_unheld_disposition'],
      [18, 'inventory_adoption_review'],
      [19, 'inventory_identity_bounds'],
    ]);
    expect(activeEffectTableNames(db)).toEqual([
      'active_effect',
      'active_effect_event',
      'active_effect_link',
      'active_effect_target',
    ]);
    db.close();
  });

  it('adopts a legacy baseline database and applies pending post-baseline migrations', () => {
    const db = legacyBaselineDb();
    const result = migrateDatabase(db, { now: NOW });
    expect(result.legacy.action).toBe('adopted');
    expect(result.legacy.adoptedFromVersion).toBe(15);
    // 0001 is adopted (already applied); the post-baseline migrations apply.
    expect(result.migrations.applied).toEqual([
      2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19,
    ]);
    expect(result.migrations.alreadyApplied).toEqual([1]);
    expect(
      readMigrationLedger(db)
        .slice(-4)
        .map((r) => [r.version, r.name]),
    ).toEqual([
      [16, 'inventory_world_location'],
      [17, 'inventory_unheld_disposition'],
      [18, 'inventory_adoption_review'],
      [19, 'inventory_identity_bounds'],
    ]);
    expect(activeEffectTableNames(db)).toEqual([
      'active_effect',
      'active_effect_event',
      'active_effect_link',
      'active_effect_target',
    ]);
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

describe('migration 0005 death-state backfill (eshyra-2n1t.8)', () => {
  /** A database migrated only through 0004 — genuinely pre-death-machine. */
  function pre0005Db(): { db: Db; dir: string } {
    const dir = mkdtempSync(join(tmpdir(), 'eshyra-pre0005-'));
    for (const migration of discoverMigrations()) {
      if (migration.version >= 5) continue;
      writeFileSync(
        join(
          dir,
          `${String(migration.version).padStart(4, '0')}_${migration.name}.sql`,
        ),
        migration.sql,
      );
    }
    const db = openDatabase(':memory:');
    migrateDatabase(db, { now: NOW, dir });
    return { db, dir };
  }

  it('reconciles a pre-0005 character persisted at 0 HP to stable', () => {
    const { db, dir } = pre0005Db();
    // Pre-0005 play could clamp-and-persist a character at 0 HP; the row has
    // no life_state yet.
    db.prepare(
      "UPDATE character SET hp_max = 20, hp_current = 0 WHERE id = 'pc-1'",
    ).run();

    const result = migrateDatabase(db, { now: NOW });

    expect(result.migrations.applied).toEqual([
      5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19,
    ]);
    const row = db
      .prepare(
        `SELECT life_state, death_save_successes, death_save_failures
         FROM character WHERE id = 'pc-1'`,
      )
      .get() as Record<string, unknown>;
    expect(row).toEqual({
      life_state: 'stable',
      death_save_successes: 0,
      death_save_failures: 0,
    });
    db.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it('leaves positive-HP characters and uninitialized 0/0 sheets alive', () => {
    const { db, dir } = pre0005Db();
    // pc-1 stays the untouched 0/0 bootstrap sheet; pc-2 is a healthy PC.
    db.prepare(
      `INSERT INTO character(id, hp_current, hp_max, role, provenance, session_id, updated_at)
       VALUES ('pc-2', 12, 20, 'pc', 'test:migration', 'session-1', ?)`,
    ).run(NOW());

    migrateDatabase(db, { now: NOW });

    const states = db
      .prepare('SELECT id, life_state FROM character ORDER BY id')
      .all() as { id: string; life_state: string }[];
    expect(states).toEqual([
      { id: 'pc-1', life_state: 'alive' },
      { id: 'pc-2', life_state: 'alive' },
    ]);
    db.close();
    rmSync(dir, { recursive: true, force: true });
  });
});
