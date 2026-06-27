import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  type CharacterRegistryStore,
  createCharacterRegistryStore,
  ensureCharacterRegistrySchema,
  openDatabase,
} from '@eshyra/core';
import { DND5E_SRD_PACK_ID, DND5E_SRD_SYSTEM_ID } from '@eshyra/core/internal';
import { afterEach, describe, expect, it } from 'vitest';
import { migrateLegacyCharacterLibrary } from '../src/characterRegistry.js';

const dirs: string[] = [];

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'lw-char-registry-'));
  dirs.push(dir);
  return dir;
}

function memoryRegistry(): CharacterRegistryStore {
  const db = openDatabase(':memory:');
  ensureCharacterRegistrySchema(db);
  return createCharacterRegistryStore(db, () => 'now');
}

function legacySheet(name: string): string {
  return JSON.stringify({
    schemaVersion: 1,
    system: DND5E_SRD_SYSTEM_ID,
    rulesPackId: DND5E_SRD_PACK_ID,
    recipeId: 'dnd5e-srd:concept-first',
    creationMode: 'concept-first',
    level: 1,
    identity: { name },
    class: { key: 'class:fighter', name: 'Fighter' },
    ancestry: { key: 'ancestry:human', name: 'Human' },
    abilityScores: {},
    proficiencyBonus: 2,
    maxHitPoints: 12,
    savingThrows: {},
    skillProficiencies: [],
    toolProficiencies: [],
    armorProficiencies: [],
    weaponProficiencies: [],
    equipment: [],
    languages: [],
    spells: [],
    metadata: { createdAt: 'now' },
  });
}

afterEach(() => {
  while (dirs.length > 0) {
    rmSync(dirs.pop() as string, { recursive: true, force: true });
  }
});

describe('migrateLegacyCharacterLibrary', () => {
  it('migrates legacy JSON files into the registry keyed by file stem', () => {
    const dir = tempDir();
    writeFileSync(join(dir, 'mira.json'), legacySheet('Mira'));
    writeFileSync(join(dir, 'brielle.json'), legacySheet('Brielle'));
    const registry = memoryRegistry();

    expect(migrateLegacyCharacterLibrary(dir, registry)).toBe(2);
    expect(registry.list()).toEqual(['brielle', 'mira']);
    expect(registry.load('mira')?.identity.name).toBe('Mira');
  });

  it('is idempotent: already-registered ids are skipped', () => {
    const dir = tempDir();
    writeFileSync(join(dir, 'mira.json'), legacySheet('Mira'));
    const registry = memoryRegistry();

    expect(migrateLegacyCharacterLibrary(dir, registry)).toBe(1);
    expect(migrateLegacyCharacterLibrary(dir, registry)).toBe(0);
    expect(registry.list()).toEqual(['mira']);
  });

  it('skips unreadable/invalid JSON files (best-effort)', () => {
    const dir = tempDir();
    writeFileSync(join(dir, 'mira.json'), legacySheet('Mira'));
    writeFileSync(join(dir, 'broken.json'), '{ not valid json');
    const registry = memoryRegistry();

    expect(migrateLegacyCharacterLibrary(dir, registry)).toBe(1);
    expect(registry.list()).toEqual(['mira']);
  });

  it('returns 0 when the legacy directory is absent', () => {
    const registry = memoryRegistry();
    expect(
      migrateLegacyCharacterLibrary(join(tempDir(), 'missing'), registry),
    ).toBe(0);
  });
});
