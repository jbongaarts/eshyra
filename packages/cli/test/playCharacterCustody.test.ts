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
} from '@eshyra/core';
import { describe, expect, it } from 'vitest';
import { activateCampaignCustody } from '../src/playCharacter.js';
import type { CliIO, PlayDeps } from '../src/playTypes.js';

const AT = '2026-06-27T00:00:00.000Z';

/** A capture-only IO whose prompts always end input (EOF). */
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

/** An IO that replays `answers` to successive prompts, then ends input. */
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

/** Resume deps over a registry + IO with stub model / id / clock. */
function resumeDeps(
  registry: ReturnType<typeof createCharacterRegistryStore>,
  io: CliIO,
): Pick<PlayDeps, 'characterRegistry' | 'io' | 'now' | 'model' | 'nextId'> {
  return {
    characterRegistry: registry,
    io,
    now: () => AT,
    nextId: (prefix) => `${prefix}-test`,
    model: { complete: async () => ({ text: 'A continuity bridge.' }) },
  };
}

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

/**
 * Set up a stale copy of `hero-1` in `campA`: checked out and released (idle at
 * revision 1), while the registry head has advanced to revision 2 elsewhere.
 */
function staleHeroInCampaign(
  registry: ReturnType<typeof createCharacterRegistryStore>,
): Db {
  registerNewCharacter(registry, {
    globalCharacterId: 'hero-1',
    sheet: sheet('Aria', 1),
  });
  const campA = freshCampaign();
  checkoutCharacterIntoCampaign(registry, campA, {
    globalCharacterId: 'hero-1',
    campaignId: 'camp-a',
    characterId: 'pc-1',
    sessionId: 'session-1',
    at: AT,
  });
  releaseCharacterFromCampaign(registry, campA, {
    campaignId: 'camp-a',
    characterId: 'pc-1',
  });
  // The character advances in another campaign: head moves to revision 2.
  registry.appendRevision('hero-1', sheet('Aria', 9), 'sync-back');
  return campA;
}

/** Insert an active combat instance so the resume looks mid-combat. */
function startActiveCombat(db: Db, campaignId: string): void {
  db.prepare(
    `INSERT INTO combat_instance(
       campaign_id, combat_instance_id, status, provenance, session_id, opened_at, updated_at
     ) VALUES (?, ?, 'active', ?, ?, ?, ?)`,
  ).run(campaignId, 'ci-test-1', 'test', 'session-1', AT, AT);
}

describe('activateCampaignCustody — all-or-nothing locking', () => {
  it('is all-or-nothing: a held-elsewhere conflict leaves no partial locks', async () => {
    const registry = freshRegistry();
    registerNewCharacter(registry, {
      globalCharacterId: 'hero-1',
      sheet: sheet('Aria'),
    });
    registerNewCharacter(registry, {
      globalCharacterId: 'hero-2',
      sheet: sheet('Bryn'),
    });

    // Campaign A holds both PCs' sheets but is idle (released previously).
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
    const ok = await activateCampaignCustody(
      resumeDeps(registry, io),
      campA,
      'camp-a',
    );

    expect(ok).toBe(false);
    // hero-1 was idle and in sync, but must NOT have been locked.
    expect(registry.custody('hero-1')).toBeUndefined();
    // hero-2's lock still belongs to the campaign that actually holds it.
    expect(registry.custody('hero-2')?.campaignId).toBe('camp-other');
    expect(lines.join('\n')).toContain('hero-2');
  });

  it('acquires every lock when no character conflicts', async () => {
    const registry = freshRegistry();
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
    const ok = await activateCampaignCustody(
      resumeDeps(registry, io),
      campA,
      'camp-a',
    );

    expect(ok).toBe(true);
    expect(registry.custody('hero-1')?.campaignId).toBe('camp-a');
    expect(registry.custody('hero-2')?.campaignId).toBe('camp-a');
  });
});

describe('activateCampaignCustody — stale-copy conflict UX', () => {
  it('catch-up at a scene boundary adopts the registry head and locks it', async () => {
    const registry = freshRegistry();
    const campA = staleHeroInCampaign(registry);

    // 'catchup' resolves the conflict; 'skip' declines the continuity bridge.
    const { io } = scriptedIO(['catchup', 'skip']);
    const ok = await activateCampaignCustody(
      resumeDeps(registry, io),
      campA,
      'camp-a',
    );

    expect(ok).toBe(true);
    expect(createSqliteCharacterSheetStore(campA).load('pc-1')?.level).toBe(9);
    expect(registry.custody('hero-1')).toMatchObject({
      campaignId: 'camp-a',
      revision: 2,
    });
    // Catch-up adopts head; it must not append a new revision.
    expect(registry.headRevision('hero-1')).toBe(2);
  });

  it('cancel leaves the registry and campaign sheet untouched', async () => {
    const registry = freshRegistry();
    const campA = staleHeroInCampaign(registry);

    const { io, lines } = scriptedIO(['cancel']);
    const ok = await activateCampaignCustody(
      resumeDeps(registry, io),
      campA,
      'camp-a',
    );

    expect(ok).toBe(false);
    expect(registry.custody('hero-1')).toBeUndefined();
    // The stale local copy is unchanged.
    expect(createSqliteCharacterSheetStore(campA).load('pc-1')?.level).toBe(1);
    expect(lines.join('\n')).toContain('Resume cancelled');
  });

  it('EOF on the conflict prompt defaults to cancel', async () => {
    const registry = freshRegistry();
    const campA = staleHeroInCampaign(registry);

    const { io } = captureIO(); // prompt always returns undefined
    const ok = await activateCampaignCustody(
      resumeDeps(registry, io),
      campA,
      'camp-a',
    );

    expect(ok).toBe(false);
    expect(registry.custody('hero-1')).toBeUndefined();
  });

  it('fork keeps the campaign version as a new identity; original untouched', async () => {
    const registry = freshRegistry();
    const campA = staleHeroInCampaign(registry);

    const { io } = scriptedIO(['fork']);
    const ok = await activateCampaignCustody(
      resumeDeps(registry, io),
      campA,
      'camp-a',
    );

    expect(ok).toBe(true);
    // The campaign sheet is re-linked to the new fork identity.
    const linked =
      createSqliteCharacterSheetStore(campA).load('pc-1')?.metadata
        .globalCharacterId;
    expect(linked).toBe('fork-test');
    expect(registry.custody('fork-test')?.campaignId).toBe('camp-a');
    // The original continuing identity is unchanged and idle.
    expect(registry.headRevision('hero-1')).toBe(2);
    expect(registry.custody('hero-1')).toBeUndefined();
    // The fork branched from the campaign's revision (1), not the head (2).
    expect(registry.loadRevision('fork-test', 1)?.parent).toEqual({
      globalCharacterId: 'hero-1',
      revision: 1,
    });
  });

  it('warns and requires confirmation to catch up mid-combat; declining cancels', async () => {
    const registry = freshRegistry();
    const campA = staleHeroInCampaign(registry);
    startActiveCombat(campA, 'camp-a');

    // 'catchup' then 'n' to the mid-combat confirmation.
    const { io, lines } = scriptedIO(['catchup', 'n']);
    const ok = await activateCampaignCustody(
      resumeDeps(registry, io),
      campA,
      'camp-a',
    );

    expect(ok).toBe(false);
    expect(lines.join('\n')).toContain('Warning');
    expect(lines.join('\n')).toContain('active combat');
    // Nothing was mutated.
    expect(registry.custody('hero-1')).toBeUndefined();
    expect(createSqliteCharacterSheetStore(campA).load('pc-1')?.level).toBe(1);
  });

  it('is all-or-nothing when a later fork is unsupported: nothing is mutated', async () => {
    const registry = freshRegistry();
    // pc-1: a normal stale copy (has a stamped source revision).
    const campA = staleHeroInCampaign(registry);

    // pc-2: a legacy stale copy linked to hero-2 with NO source revision, made
    // stale by advancing the registry head. Fork is therefore unsupported.
    registerNewCharacter(registry, {
      globalCharacterId: 'hero-2',
      sheet: sheet('Bryn', 1),
    });
    createSqliteCharacterSheetStore(campA).save('pc-2', {
      ...sheet('Bryn', 1),
      metadata: { createdAt: AT, source: 'test', globalCharacterId: 'hero-2' },
    });
    registry.appendRevision('hero-2', sheet('Bryn', 9), 'sync-back');

    // pc-1 -> catchup (collected), pc-2 -> fork (unsupported -> aborts in the
    // resolution phase, before pc-1's catchup is ever applied).
    const { io, lines } = scriptedIO(['catchup', 'fork']);
    const ok = await activateCampaignCustody(
      resumeDeps(registry, io),
      campA,
      'camp-a',
    );

    expect(ok).toBe(false);
    expect(lines.join('\n')).toContain('Fork is unavailable');
    // pc-1 was NOT caught up — its earlier decision never reached the apply phase.
    expect(createSqliteCharacterSheetStore(campA).load('pc-1')?.level).toBe(1);
    // No fork identity was created.
    expect(registry.list()).not.toContain('fork-test');
    // No custody locks were acquired for either character.
    expect(registry.custody('hero-1')).toBeUndefined();
    expect(registry.custody('hero-2')).toBeUndefined();
  });

  it('catches up mid-combat after explicit confirmation', async () => {
    const registry = freshRegistry();
    const campA = staleHeroInCampaign(registry);
    startActiveCombat(campA, 'camp-a');

    // 'catchup', confirm 'y', then 'skip' the bridge.
    const { io } = scriptedIO(['catchup', 'y', 'skip']);
    const ok = await activateCampaignCustody(
      resumeDeps(registry, io),
      campA,
      'camp-a',
    );

    expect(ok).toBe(true);
    expect(createSqliteCharacterSheetStore(campA).load('pc-1')?.level).toBe(9);
    expect(registry.custody('hero-1')?.campaignId).toBe('camp-a');
  });
});
