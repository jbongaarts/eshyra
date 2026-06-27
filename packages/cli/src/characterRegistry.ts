/**
 * CLI access to the core-owned cross-campaign character registry (ADR 0012).
 *
 * Opens the data-root registry database (`<dataRoot>/characters.db`), ensures
 * its schema, and one-time migrates the legacy finalized-character JSON library
 * (`<dataRoot>/characters/*.json`) into it. The registry is the authority for a
 * character between campaigns; play attaches a registry character into the
 * campaign's per-campaign sheet.
 */

import { mkdirSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  type CharacterRegistryStore,
  type CharacterSheet,
  createCharacterRegistryStore,
  ensureCharacterRegistrySchema,
  openDatabase,
} from '@eshyra/core';
import { characterRegistryDbPath, charactersDir } from './dataRoot.js';

/**
 * A minimal structural guard for a legacy JSON file: it must carry the binding
 * identity the registry schema requires as non-null columns. A stale/empty/
 * malformed shape (e.g. `{}`) is rejected so migration skips it rather than the
 * registry `save` throwing on a NOT NULL constraint and aborting startup.
 */
function looksLikeCharacterSheet(value: unknown): value is CharacterSheet {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const record = value as Record<string, unknown>;
  return (
    typeof record.schemaVersion === 'number' &&
    typeof record.system === 'string' &&
    typeof record.rulesPackId === 'string'
  );
}

/**
 * Best-effort one-time migration of the legacy `<dataRoot>/characters/*.json`
 * library into the registry. Files whose id is already registered are skipped
 * (idempotent), and unreadable / unparsable / structurally-invalid files are
 * skipped rather than aborting the run. Returns the number of newly migrated
 * characters. The legacy files are left in place (non-destructive).
 */
export function migrateLegacyCharacterLibrary(
  legacyDir: string,
  registry: CharacterRegistryStore,
): number {
  let entries: string[];
  try {
    entries = readdirSync(legacyDir);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return 0;
    }
    throw error;
  }
  const existing = new Set(registry.list());
  let migrated = 0;
  for (const name of entries.filter((entry) => entry.endsWith('.json'))) {
    const id = name.slice(0, -'.json'.length);
    if (existing.has(id)) {
      continue;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(readFileSync(join(legacyDir, name), 'utf8'));
    } catch {
      continue;
    }
    if (!looksLikeCharacterSheet(parsed)) {
      continue;
    }
    registry.save(id, parsed);
    migrated += 1;
  }
  return migrated;
}

/**
 * Open the data-root character registry, ensuring the data root exists and the
 * schema is created, and migrating any legacy JSON library on first open. The
 * data-root directory is created here (SQLite will not create parent
 * directories), so a first-run `create-character` on a fresh machine works.
 */
export function openCharacterRegistry(
  dataRoot: string,
): CharacterRegistryStore {
  mkdirSync(dataRoot, { recursive: true });
  const db = openDatabase(characterRegistryDbPath(dataRoot));
  ensureCharacterRegistrySchema(db);
  const registry = createCharacterRegistryStore(db);
  migrateLegacyCharacterLibrary(charactersDir(dataRoot), registry);
  return registry;
}
