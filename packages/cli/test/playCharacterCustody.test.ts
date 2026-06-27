import type { CharacterSheet, Db } from '@eshyra/core';
import {
  checkoutCharacterIntoCampaign,
  createCharacterRegistryStore,
  ensureCharacterRegistrySchema,
  initSchema,
  openDatabase,
  registerNewCharacter,
  releaseCharacterFromCampaign,
} from '@eshyra/core';
import { describe, expect, it } from 'vitest';
import { activateCampaignCustody } from '../src/playCharacter.js';
import type { CliIO } from '../src/playTypes.js';

const AT = '2026-06-27T00:00:00.000Z';

function captureIO(): { io: CliIO; lines: string[] } {
  const lines: string[] = [];
  return {
    lines,
    io: {
      write: (line) => lines.push(line),
      prompt: async () => undefined,
    },
  };
}

function sheet(name: string): CharacterSheet {
  return {
    schemaVersion: 1,
    system: 'dnd5e-srd',
    rulesPackId: 'rules:dnd5e-srd-5.1',
    recipeId: 'dnd5e-srd-level-1',
    creationMode: 'concept-first',
    level: 1,
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

function freshCampaign(): Db {
  const db = openDatabase(':memory:');
  initSchema(db);
  return db;
}

describe('activateCampaignCustody', () => {
  it('is all-or-nothing: a later conflict leaves no partial locks', () => {
    const registryDb = openDatabase(':memory:');
    ensureCharacterRegistrySchema(registryDb);
    const registry = createCharacterRegistryStore(registryDb, () => AT);
    registerNewCharacter(registry, {
      globalCharacterId: 'hero-1',
      sheet: sheet('Aria'),
    });
    registerNewCharacter(registry, {
      globalCharacterId: 'hero-2',
      sheet: sheet('Bryn'),
    });

    // Campaign A holds both PCs' sheets, but is currently idle (released on its
    // previous /quit): pc-1 -> hero-1, pc-2 -> hero-2.
    const campA = freshCampaign();
    for (const [characterId, globalCharacterId] of [
      ['pc-1', 'hero-1'],
      ['pc-2', 'hero-2'],
    ] as const) {
      checkoutCharacterIntoCampaign(registry, campA, {
        globalCharacterId,
        campaignId: 'camp-a',
        characterId,
        sessionId: 'session-1',
        at: AT,
      });
      releaseCharacterFromCampaign(registry, campA, {
        campaignId: 'camp-a',
        characterId,
      });
    }

    // Another campaign now actively holds hero-2.
    const campOther = freshCampaign();
    checkoutCharacterIntoCampaign(registry, campOther, {
      globalCharacterId: 'hero-2',
      campaignId: 'camp-other',
      characterId: 'pc-1',
      sessionId: 'session-2',
      at: AT,
    });

    const { io, lines } = captureIO();
    const ok = activateCampaignCustody(
      { characterRegistry: registry, io, now: () => AT },
      campA,
      'camp-a',
    );

    expect(ok).toBe(false);
    // hero-1 was idle and in sync, but must NOT have been locked because the
    // activation aborted on hero-2's conflict.
    expect(registry.custody('hero-1')).toBeUndefined();
    // hero-2's lock still belongs to the campaign that actually holds it.
    expect(registry.custody('hero-2')?.campaignId).toBe('camp-other');
    expect(lines.join('\n')).toContain('hero-2');
  });

  it('acquires every lock when no character conflicts', () => {
    const registryDb = openDatabase(':memory:');
    ensureCharacterRegistrySchema(registryDb);
    const registry = createCharacterRegistryStore(registryDb, () => AT);
    registerNewCharacter(registry, {
      globalCharacterId: 'hero-1',
      sheet: sheet('Aria'),
    });
    registerNewCharacter(registry, {
      globalCharacterId: 'hero-2',
      sheet: sheet('Bryn'),
    });

    const campA = freshCampaign();
    for (const [characterId, globalCharacterId] of [
      ['pc-1', 'hero-1'],
      ['pc-2', 'hero-2'],
    ] as const) {
      checkoutCharacterIntoCampaign(registry, campA, {
        globalCharacterId,
        campaignId: 'camp-a',
        characterId,
        sessionId: 'session-1',
        at: AT,
      });
      releaseCharacterFromCampaign(registry, campA, {
        campaignId: 'camp-a',
        characterId,
      });
    }

    const { io } = captureIO();
    const ok = activateCampaignCustody(
      { characterRegistry: registry, io, now: () => AT },
      campA,
      'camp-a',
    );

    expect(ok).toBe(true);
    expect(registry.custody('hero-1')?.campaignId).toBe('camp-a');
    expect(registry.custody('hero-2')?.campaignId).toBe('camp-a');
  });
});
