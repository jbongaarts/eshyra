import type { CharacterSheet } from '@eshyra/core';
import {
  createCharacterRegistryStore,
  ensureCharacterRegistrySchema,
  openDatabase,
  registerNewCharacter,
} from '@eshyra/core';
import { describe, expect, it } from 'vitest';
import { forkCharacterInteractive } from '../src/playFork.js';
import type { CliIO } from '../src/playTypes.js';

const AT = '2026-06-27T00:00:00.000Z';

function scriptedIO(answers: string[]): { io: CliIO; lines: string[] } {
  const lines: string[] = [];
  let i = 0;
  return {
    lines,
    io: {
      write: (line) => lines.push(line),
      prompt: async () => answers[i++],
    },
  };
}

function sheet(name: string, level: number): CharacterSheet {
  return {
    schemaVersion: 1,
    system: 'dnd5e-srd',
    rulesPackId: 'rules:dnd5e-srd-5.1',
    recipeId: 'dnd5e-srd-level-1',
    creationMode: 'concept-first',
    level,
    identity: { name },
    class: { key: 'class:fighter', name: 'Fighter' },
    ancestry: { key: 'ancestry:human', name: 'Human' },
    abilityScores: {
      strength: { base: 15, final: 16, modifier: 3 },
      dexterity: { base: 14, final: 15, modifier: 2 },
      constitution: { base: 14, final: 15, modifier: 2 },
      intelligence: { base: 10, final: 11, modifier: 0 },
      wisdom: { base: 10, final: 11, modifier: 0 },
      charisma: { base: 8, final: 9, modifier: -1 },
    },
    proficiencyBonus: 2,
    maxHitPoints: 12,
    savingThrows: {
      strength: { modifier: 5, proficient: true },
      dexterity: { modifier: 2, proficient: false },
      constitution: { modifier: 4, proficient: true },
      intelligence: { modifier: 0, proficient: false },
      wisdom: { modifier: 0, proficient: false },
      charisma: { modifier: -1, proficient: false },
    },
    skillProficiencies: [],
    toolProficiencies: [],
    armorProficiencies: [],
    weaponProficiencies: [],
    equipment: [],
    languages: ['Common'],
    spells: [],
    metadata: { createdAt: AT, source: 'test' },
  };
}

function freshRegistry(): ReturnType<typeof createCharacterRegistryStore> {
  const db = openDatabase(':memory:');
  ensureCharacterRegistrySchema(db);
  return createCharacterRegistryStore(db, () => AT);
}

describe('forkCharacterInteractive', () => {
  it('forks from a selected non-head revision with parent provenance', async () => {
    const registry = freshRegistry();
    registerNewCharacter(registry, {
      globalCharacterId: 'hero',
      sheet: sheet('Aria', 1),
    });
    registry.appendRevision('hero', sheet('Aria', 5), 'sync-back');
    expect(registry.headRevision('hero')).toBe(2);

    // source id 'hero', revision '1' (NOT the head 2), new id 'hero-alt'.
    const { io, lines } = scriptedIO(['hero', '1', 'hero-alt']);
    const ok = await forkCharacterInteractive({
      characterRegistry: registry,
      io,
    });

    expect(ok).toBe(true);
    // The fork carries revision 1's level (1), not the head's (5).
    expect(registry.load('hero-alt')?.level).toBe(1);
    expect(registry.loadRevision('hero-alt', 1)?.parent).toEqual({
      globalCharacterId: 'hero',
      revision: 1,
    });
    // The original timeline is unchanged.
    expect(registry.headRevision('hero')).toBe(2);
    // The user was warned about breaking continuity.
    expect(lines.join('\n')).toContain('continuity');
  });

  it('refuses to fork onto an id that already has a timeline (no overwrite)', async () => {
    const registry = freshRegistry();
    registerNewCharacter(registry, {
      globalCharacterId: 'hero',
      sheet: sheet('Aria', 3),
    });
    registerNewCharacter(registry, {
      globalCharacterId: 'taken',
      sheet: sheet('Bryn', 7),
    });

    // source 'hero', default head revision (''), target 'taken' (already exists).
    const { io } = scriptedIO(['hero', '', 'taken']);
    const ok = await forkCharacterInteractive({
      characterRegistry: registry,
      io,
    });

    expect(ok).toBe(false);
    // The existing 'taken' identity was not overwritten.
    expect(registry.headRevision('taken')).toBe(1);
    expect(registry.load('taken')?.identity.name).toBe('Bryn');
  });
});
