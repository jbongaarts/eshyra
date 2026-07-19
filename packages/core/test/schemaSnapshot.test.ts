import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { openDatabase } from '../src/persistence/db.js';
import {
  renderSchemaSnapshot,
  runMigrations,
  schemaFingerprint,
} from '../src/persistence/migrationRunner.js';
import { initSchema } from '../src/persistence/schema.js';

const SNAPSHOT_PATH = fileURLToPath(
  new URL('../data/schema.snapshot.sql', import.meta.url),
);

const BASELINE_MIGRATION_PATH = fileURLToPath(
  new URL('../data/migrations/0001_initial.sql', import.meta.url),
);

describe('schema snapshot (ADR 0015 §7)', () => {
  it('committed data/schema.snapshot.sql matches the schema produced by the migrations', () => {
    const db = openDatabase(':memory:');
    runMigrations(db);
    const generated = renderSchemaSnapshot(db);
    db.close();

    const committed = readFileSync(SNAPSHOT_PATH, 'utf8').replace(
      /\r\n/g,
      '\n',
    );
    expect(generated).toBe(committed);
    // If this fails after a schema change, regenerate the snapshot:
    //   npm run -w @eshyra/core schema:snapshot
  });

  it('the snapshot excludes the runner-owned schema_migrations ledger', () => {
    const db = openDatabase(':memory:');
    runMigrations(db);
    const snapshot = renderSchemaSnapshot(db);
    db.close();
    expect(snapshot).not.toContain('schema_migrations');
    expect(snapshot).toContain('inventory_claimable_world_location_id');
    expect(snapshot).toContain('inventory_location_insert_guard');
    expect(snapshot).toContain('inventory_location_update_guard');
  });
});

describe('migrated-vs-fresh schema parity (ADR 0015 §3/§7)', () => {
  it('a legacy-adopted database and a fresh migrated database have identical schema', () => {
    // A real legacy v15 database holds exactly the 0001 baseline schema (the
    // pre-migration-first state), with no later migrations and no ledger. Build
    // it from the baseline migration directly rather than from the full
    // migration set, then mark it with the legacy version so initSchema adopts
    // it in place and applies the pending post-baseline migrations.
    const legacy = openDatabase(':memory:');
    legacy.exec(readFileSync(BASELINE_MIGRATION_PATH, 'utf8'));
    legacy
      .prepare('INSERT INTO meta(key, value) VALUES (?, ?)')
      .run('schema_version', '15');

    initSchema(legacy); // adopts in place, then applies 0002+

    const fresh = openDatabase(':memory:');
    initSchema(fresh);

    expect(schemaFingerprint(legacy)).toEqual(schemaFingerprint(fresh));
    legacy.close();
    fresh.close();
  });
});
