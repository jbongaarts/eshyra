import type { CharacterSheet, Db } from '@eshyra/core';
import {
  checkoutCharacterIntoCampaign,
  createCharacterRegistryStore,
  createSqliteCharacterSheetStore,
  ensureCharacterRegistrySchema,
  initSchema,
  openDatabase,
  registerNewCharacter,
  releaseCharacterFromCampaign,
  writeCampaignRulesBinding,
} from '@eshyra/core';
import { describe, expect, it } from 'vitest';
import { forkConflictedCharacterIntoCampaign } from '../src/playFork.js';

/** Failure-result invariant for the resume-fork caller (eshyra-o9bd.19.5.15.5):
 *  success is reported only after the slot adopted the fork and custody is held. */
const AT = '2026-06-27T00:00:00.000Z';

function sheet(name: string, level = 1): CharacterSheet {
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

function freshCampaign(): Db {
  const db = openDatabase(':memory:');
  initSchema(db);
  return db;
}

function deps(
  registry: ReturnType<typeof createCharacterRegistryStore>,
  forkId = 'fork-1',
) {
  const lines: string[] = [];
  return {
    lines,
    deps: {
      characterRegistry: registry,
      io: {
        write: (line: string) => void lines.push(line),
        prompt: async () => undefined,
        close: () => {},
      },
      now: () => AT,
      nextId: () => forkId,
    },
  };
}

describe('forkConflictedCharacterIntoCampaign failure results', () => {
  it('success: slot adopts the fork, custody held, success narrated', () => {
    const registry = freshRegistry();
    registerNewCharacter(registry, {
      globalCharacterId: 'hero',
      sheet: sheet('Aria'),
    });
    const campaign = freshCampaign();
    checkoutCharacterIntoCampaign(registry, campaign, {
      globalCharacterId: 'hero',
      campaignId: 'c',
      characterId: 'pc-1',
      sessionId: 's',
      at: AT,
    });
    releaseCharacterFromCampaign(registry, campaign, {
      campaignId: 'c',
      characterId: 'pc-1',
    });
    const { deps: d, lines } = deps(registry);
    expect(
      forkConflictedCharacterIntoCampaign(d, campaign, 'c', 'pc-1', {
        globalCharacterId: 'hero',
        fromRevision: 1,
      }),
    ).toBe(true);
    expect(
      createSqliteCharacterSheetStore(campaign).load('pc-1')?.metadata
        .globalCharacterId,
    ).toBe('fork-1');
    expect(registry.custody('fork-1')?.campaignId).toBe('c');
    expect(lines.join('\n')).toContain('now plays the fork');
  });

  it('correction result: reports failure, keeps campaign copy, takes no custody', () => {
    const registry = freshRegistry();
    const pf = (level: number): CharacterSheet =>
      ({
        ...sheet('Pf', level),
        system: 'pathfinder2e',
        rulesPackId: 'pf-pack',
      }) as CharacterSheet;
    registry.appendRevision('pf', pf(1), 'register');
    registry.appendRevision('pf', pf(2), 'sync-back');
    const campaign = freshCampaign();
    writeCampaignRulesBinding(campaign, {
      base: { systemId: 'pathfinder2e', packId: 'pf-pack', version: '1' },
      addons: [],
      resolvedAt: AT,
    });
    const store = createSqliteCharacterSheetStore(campaign);
    store.save('pc-1', {
      ...pf(1),
      metadata: {
        ...pf(1).metadata,
        globalCharacterId: 'pf',
        sourceRevision: 1,
      },
    });
    const { deps: d, lines } = deps(registry);
    expect(
      forkConflictedCharacterIntoCampaign(d, campaign, 'c', 'pc-1', {
        globalCharacterId: 'pf',
        fromRevision: 1,
      }),
    ).toBe(false);
    expect(store.load('pc-1')?.metadata.globalCharacterId).toBe('pf');
    expect(registry.custody('fork-1')).toBeUndefined();
    expect(lines.join('\n')).not.toContain('now plays the fork');
  });

  it('thrown refusal: reports failure and changes nothing in the campaign', () => {
    const registry = freshRegistry();
    registerNewCharacter(registry, {
      globalCharacterId: 'hero',
      sheet: sheet('Aria'),
    });
    const campaign = freshCampaign();
    checkoutCharacterIntoCampaign(registry, campaign, {
      globalCharacterId: 'hero',
      campaignId: 'c',
      characterId: 'pc-1',
      sessionId: 's',
      at: AT,
    });
    releaseCharacterFromCampaign(registry, campaign, {
      campaignId: 'c',
      characterId: 'pc-1',
    });
    const { deps: d, lines } = deps(registry, 'hero'); // fork id collides with an existing timeline
    expect(
      forkConflictedCharacterIntoCampaign(d, campaign, 'c', 'pc-1', {
        globalCharacterId: 'hero',
        fromRevision: 1,
      }),
    ).toBe(false);
    expect(
      createSqliteCharacterSheetStore(campaign).load('pc-1')?.metadata
        .globalCharacterId,
    ).toBe('hero');
    expect(lines.join('\n')).not.toContain('now plays the fork');
  });
});
