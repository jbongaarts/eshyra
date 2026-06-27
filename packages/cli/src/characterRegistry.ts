/**
 * CLI access to the core-owned cross-campaign character registry (ADR 0012).
 *
 * Opens the data-root registry database (`<dataRoot>/characters.db`), ensures
 * its schema, and one-time migrates the legacy finalized-character JSON library
 * (`<dataRoot>/characters/*.json`) into it. The registry is the authority for a
 * character between campaigns; play attaches a registry character into the
 * campaign's per-campaign sheet.
 */

import { readdirSync, readFileSync } from 'node:fs';
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
 * Best-effort one-time migration of the legacy `<dataRoot>/characters/*.json`
 * library into the registry. Files whose id is already registered are skipped
 * (idempotent), and unreadable/invalid files are skipped rather than aborting
 * the run. Returns the number of newly migrated characters. The legacy files
 * are left in place (non-destructive).
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
    let sheet: CharacterSheet;
    try {
      sheet = JSON.parse(
        readFileSync(join(legacyDir, name), 'utf8'),
      ) as CharacterSheet;
    } catch {
      continue;
    }
    registry.save(id, sheet);
    migrated += 1;
  }
  return migrated;
}

/**
 * Open the data-root character registry, ensuring its schema and migrating any
 * legacy JSON library on first open.
 */
export function openCharacterRegistry(
  dataRoot: string,
): CharacterRegistryStore {
  const db = openDatabase(characterRegistryDbPath(dataRoot));
  ensureCharacterRegistrySchema(db);
  const registry = createCharacterRegistryStore(db);
  migrateLegacyCharacterLibrary(charactersDir(dataRoot), registry);
  return registry;
}
