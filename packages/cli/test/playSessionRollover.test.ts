import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { CharacterSheet } from '@eshyra/core';
import {
  acquireCampaignWriterLock,
  adjustCharacterCurrency,
  checkoutCharacterIntoCampaign,
  classifyResumeConflict,
  createCampaign,
  createCharacterRegistryStore,
  DEFAULT_MEMORY_CONFIG,
  EMBERFALL_HOLLOW,
  ensureCharacterRegistrySchema,
  getCharacterWallet,
  initSchema,
  openDatabase,
  registerNewCharacter,
  startSession,
} from '@eshyra/core';
import { afterEach, describe, expect, it } from 'vitest';
import { runDemo, runPlay } from '../src/play.js';
import type { PlayDeps } from '../src/playTypes.js';

const AT = '2026-11-06T00:00:00.000Z';

function sheet(): CharacterSheet {
  const abilityScores = {} as CharacterSheet['abilityScores'];
  const savingThrows = {} as CharacterSheet['savingThrows'];
  for (const name of [
    'strength',
    'dexterity',
    'constitution',
    'intelligence',
    'wisdom',
    'charisma',
  ] as const) {
    abilityScores[name] = { base: 12, final: 12, modifier: 1 };
    savingThrows[name] = { modifier: 1, proficient: false };
  }
  return {
    schemaVersion: 1,
    system: 'dnd5e-srd',
    rulesPackId: 'rules:dnd5e-srd-5.1',
    recipeId: 'dnd5e-srd:concept-first',
    creationMode: 'concept-first',
    level: 1,
    identity: { name: 'Mira' },
    class: { key: 'class:fighter', name: 'Fighter' },
    ancestry: { key: 'ancestry:human', name: 'Human' },
    abilityScores,
    proficiencyBonus: 2,
    maxHitPoints: 12,
    savingThrows,
    skillProficiencies: [],
    toolProficiencies: [],
    armorProficiencies: [],
    weaponProficiencies: [],
    equipment: [],
    languages: ['Common'],
    spells: [],
    metadata: { createdAt: AT },
  };
}

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

/**
 * Session-rollover invariant: however a crashed session is re-entered (resume,
 * close, its `c` alias, or the demo's close), every linked party character holds
 * custody through the subsequent session, legitimate progress reaches the
 * registry on final exit, and the original resume does not become stale.
 */
describe.each([
  ['resume', 'play', 'resume'],
  ['close', 'play', 'close'],
  ['c alias', 'play', 'c'],
  ['demo close', 'demo', 'close'],
] as const)('session rollover custody: %s', (_label, entry, choice) => {
  it('holds custody through the next session and syncs on exit', async () => {
    const root = mkdtempSync(join(tmpdir(), 'eshyra-rollover-'));
    roots.push(root);
    const path = join(root, 'campaign.db');
    const registryDb = openDatabase(join(root, 'registry.db'));
    ensureCharacterRegistrySchema(registryDb);
    const registry = createCharacterRegistryStore(registryDb, () => AT);
    const db = openDatabase(path);
    initSchema(db);
    createCampaign(db, { campaignId: 'camp-a', pack: EMBERFALL_HOLLOW });
    registerNewCharacter(registry, {
      globalCharacterId: 'mira',
      sheet: sheet(),
    });
    checkoutCharacterIntoCampaign(registry, db, {
      globalCharacterId: 'mira',
      campaignId: 'camp-a',
      characterId: 'pc-1',
      sessionId: 'old',
      at: AT,
    });
    startSession(db, {
      campaignId: 'camp-a',
      sessionId: 'old',
      startedAt: AT,
    });
    adjustCharacterCurrency(
      db,
      { kind: 'gain', amounts: { gp: 10 } },
      { source: 'play-command', provenance: 'test', sessionId: 'old', at: AT },
    );
    db.close(); // crash: custody and unsynchronized progress remain

    const answers = [choice, '/money gain gp 5', '/quit'];
    let next = 0;
    let custodyAtPlay: unknown;
    const deps = {
      openDb: openDatabase,
      acquireWriterLock: acquireCampaignWriterLock,
      characterRegistry: registry,
      pack: EMBERFALL_HOLLOW,
      io: {
        write: () => undefined,
        prompt: async (question: string) => {
          if (question === '> ' && custodyAtPlay === undefined) {
            custodyAtPlay = registry.custody('mira') ?? null;
          }
          return answers[next++];
        },
      },
      now: () => AT,
      nextId: (prefix: string) => `${prefix}-new`,
      memoryConfig: { ...DEFAULT_MEMORY_CONFIG, arcRolloverThreshold: 100 },
      makeCheckpointRunner: () => undefined,
      listAdventureModules: () => [],
      model: { complete: async () => ({ text: 'unused' }) },
    } as unknown as PlayDeps;

    const run = entry === 'demo' ? runDemo : runPlay;
    expect(await run(deps, { dbPath: path })).toBe(0);

    expect(custodyAtPlay).toMatchObject({ campaignId: 'camp-a' });
    const after = openDatabase(path);
    try {
      expect(getCharacterWallet(after).gp).toBe(15);
      expect(registry.load('mira')?.wallet?.gp).toBe(15);
      expect(
        classifyResumeConflict(registry, after, {
          campaignId: 'camp-a',
          characterId: 'pc-1',
        }).kind,
      ).not.toBe('stale-copy');
    } finally {
      after.close();
      registryDb.close();
    }
  });
});
