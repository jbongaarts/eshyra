import { describe, expect, it } from 'vitest';
import { ABILITY_SCORE_NAMES } from '../src/character/abilities.js';
import type { AbilityScoreName } from '../src/character/creation.js';
import type {
  CharacterSheet,
  FinalizedAbilityScore,
} from '../src/character/finalizeCharacter.js';
import {
  createDefaultToolRegistry,
  createSeededRng,
  createSqliteCharacterSheetStore,
  DND5E_SRD_PACK_ID,
  DND5E_SRD_SYSTEM_ID,
  initSchema,
  listCharacterWalletEvents,
  openDatabase,
  startSession,
} from '../src/internal.js';

const AT = '2026-07-01T10:00:00.000Z';

function sheet(
  wallet = { cp: 0, sp: 0, ep: 0, gp: 10, pp: 0 },
): CharacterSheet {
  const abilities = {} as Record<AbilityScoreName, FinalizedAbilityScore>;
  const saves = {} as CharacterSheet['savingThrows'];
  for (const name of ABILITY_SCORE_NAMES) {
    abilities[name] = { base: 10, final: 10, modifier: 0 };
    saves[name] = { modifier: 0, proficient: false };
  }
  return {
    schemaVersion: 1,
    system: DND5E_SRD_SYSTEM_ID,
    rulesPackId: DND5E_SRD_PACK_ID,
    recipeId: 'dnd5e-srd-character',
    creationMode: 'test',
    level: 1,
    identity: { name: 'Mira' },
    class: { key: 'class:fighter', name: 'Fighter' },
    ancestry: { key: 'ancestry:human', name: 'Human' },
    abilityScores: abilities,
    proficiencyBonus: 2,
    maxHitPoints: 10,
    savingThrows: saves,
    skillProficiencies: [],
    toolProficiencies: [],
    armorProficiencies: [],
    weaponProficiencies: [],
    equipment: [],
    wallet,
    languages: [],
    spells: [],
    metadata: { createdAt: AT },
  };
}

function setup() {
  const db = openDatabase(':memory:');
  initSchema(db);
  startSession(db, {
    campaignId: 'campaign-1',
    sessionId: 'session-1',
    startedAt: AT,
  });
  createSqliteCharacterSheetStore(db).save('pc-1', sheet());
  const ctx = {
    db,
    rng: createSeededRng(1),
    campaignId: 'campaign-1',
    sessionId: 'session-1',
    turnId: 'turn-currency',
    at: AT,
  };
  return { db, ctx, registry: createDefaultToolRegistry() };
}

describe('currency gameplay tools', () => {
  it('registers all tools as explicit mutating actions', () => {
    const registry = createDefaultToolRegistry();
    for (const name of [
      'gain_currency',
      'spend_currency',
      'convert_currency',
    ]) {
      expect(registry.has(name)).toBe(true);
      expect(registry.isMutating(name)).toBe(true);
      expect(registry.listRequiresExplicitAction()).toContain(name);
    }
  });

  it('gains, spends, and converts with structured results and provenance', () => {
    const { db, ctx, registry } = setup();
    const gained = registry.invoke(
      'gain_currency',
      { amounts: { gp: 2, sp: 3 } },
      ctx,
    );
    expect(gained).toMatchObject({
      ok: true,
      data: {
        previousWallet: { gp: 10 },
        wallet: { gp: 12, sp: 3 },
        event: {
          source: 'model-tool',
          provenance: 'model:turn-currency',
          sessionId: 'session-1',
          occurredAt: AT,
        },
      },
    });
    expect(
      registry.invoke('spend_currency', { amounts: { gp: 2 } }, ctx),
    ).toMatchObject({
      ok: true,
      data: { wallet: { gp: 10, sp: 3 } },
    });
    expect(
      registry.invoke(
        'convert_currency',
        { amount: 3, from: 'sp', to: 'cp' },
        ctx,
      ),
    ).toMatchObject({
      ok: true,
      data: { wallet: { gp: 10, sp: 0, cp: 30 } },
    });
    expect(listCharacterWalletEvents(db)).toHaveLength(3);
  });

  it('rejects invalid, insufficient, and non-exact transactions atomically', () => {
    const { db, ctx, registry } = setup();
    for (const args of [
      { amounts: {} },
      { amounts: { gp: 0 } },
      { amounts: { gp: -1 } },
      { amounts: { gp: 1.5 } },
      { amounts: { gold: 1 } },
    ]) {
      expect(registry.invoke('gain_currency', args, ctx).ok).toBe(false);
    }
    expect(
      registry.invoke('spend_currency', { amounts: { pp: 1 } }, ctx),
    ).toMatchObject({
      ok: false,
      code: 'currency_error',
    });
    expect(
      registry.invoke(
        'convert_currency',
        { amount: 1, from: 'gp', to: 'pp' },
        ctx,
      ),
    ).toMatchObject({
      ok: false,
      code: 'currency_error',
    });
    expect(listCharacterWalletEvents(db)).toHaveLength(0);
  });
});
