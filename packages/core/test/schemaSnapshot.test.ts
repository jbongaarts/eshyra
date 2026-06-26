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
  });
});

describe('migrated-vs-fresh schema parity (ADR 0015 §3/§7)', () => {
  it('a legacy-adopted database and a fresh migrated database have identical schema', () => {
    // A legacy v15 database, as built by the (now migration-backed) initSchema's
    // predecessor shape: simulate by adopting a database that already holds the
    // baseline schema and a meta.schema_version marker.
    const legacy = openDatabase(':memory:');
    runMigrations(legacy); // build the baseline schema
    // Make it look like a pre-migration-first DB: drop the ledger, add the
    // legacy version marker.
    legacy.exec('DROP TABLE schema_migrations;');
    legacy
      .prepare('INSERT INTO meta(key, value) VALUES (?, ?)')
      .run('schema_version', '15');

    initSchema(legacy); // adopts in place

    const fresh = openDatabase(':memory:');
    initSchema(fresh);

    expect(schemaFingerprint(legacy)).toEqual(schemaFingerprint(fresh));
    legacy.close();
    fresh.close();
  });
});
