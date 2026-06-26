/**
 * Regenerate the committed schema snapshot (ADR 0015 §7).
 *
 * Applies every migration in `packages/core/data/migrations/` to a fresh
 * in-memory database and writes the rendered schema to
 * `packages/core/data/schema.snapshot.sql`. The snapshot is a review-only
 * artifact — never executed and never schema authority. `schemaSnapshot.test.ts`
 * regenerates it the same way and fails closed if the committed file drifts.
 *
 * Run with: npm run -w @eshyra/core schema:snapshot
 */

import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { openDatabase } from '../src/persistence/db.js';
import {
  renderSchemaSnapshot,
  runMigrations,
} from '../src/persistence/migrationRunner.js';

const SNAPSHOT_PATH = fileURLToPath(
  new URL('../data/schema.snapshot.sql', import.meta.url),
);

const db = openDatabase(':memory:');
try {
  runMigrations(db);
  writeFileSync(SNAPSHOT_PATH, renderSchemaSnapshot(db));
  console.log(`Wrote schema snapshot to ${SNAPSHOT_PATH}`);
} finally {
  db.close();
}
