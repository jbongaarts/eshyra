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

  it('discovers and repurchases a sold row only with an atomic wallet debit', () => {
    const { db, ctx, registry } = setup();
    db.prepare(
      "UPDATE clock SET current_location_id='market' WHERE id=1",
    ).run();
    expect(
      registry.invoke('give_item', { id: 'sold-map', name: 'Sold Map' }, ctx),
    ).toMatchObject({ ok: true });
    expect(
      registry.invoke(
        'remove_item',
        { id: 'sold-map', disposition: 'sold' },
        ctx,
      ),
    ).toMatchObject({ ok: true });
    db.prepare("UPDATE clock SET current_location_id='docks' WHERE id=1").run();
    expect(
      registry.invoke('list_recoverable_items', { basis: 'repurchased' }, ctx),
    ).toMatchObject({ ok: true, data: { items: [] } });
    db.prepare(
      "UPDATE clock SET current_location_id='market' WHERE id=1",
    ).run();
    expect(
      registry.invoke('list_recoverable_items', { basis: 'repurchased' }, ctx),
    ).toMatchObject({
      ok: true,
      data: {
        items: [{ itemId: 'sold-map', disposition: 'sold' }],
        truncated: false,
      },
    });
    expect(
      registry.invoke('list_recoverable_items', { basis: 'found' }, ctx),
    ).toMatchObject({ ok: true, data: { items: [] } });
    expect(
      registry.invoke(
        'reacquire_item',
        {
          id: 'sold-map',
          basis: 'repurchased',
          evidence: 'The merchant agreed to sell the map back for 2 gp.',
        },
        ctx,
      ),
    ).toMatchObject({
      ok: false,
      message: expect.stringContaining('requires an atomic'),
    });
    expect(listCharacterWalletEvents(db)).toHaveLength(0);
    expect(
      db
        .prepare(
          'SELECT character_id, unheld_disposition FROM inventory WHERE id=?',
        )
        .get('sold-map'),
    ).toEqual({ character_id: null, unheld_disposition: 'sold' });
    expect(
      registry.invoke(
        'reacquire_item',
        {
          id: 'sold-map',
          basis: 'repurchased',
          evidence: 'The merchant demanded an unaffordable platinum piece.',
          payment: { pp: 1 },
        },
        ctx,
      ),
    ).toMatchObject({ ok: false, code: 'mutate_error' });
    expect(listCharacterWalletEvents(db)).toHaveLength(0);
    expect(
      db
        .prepare('SELECT 1 FROM inventory_custody_event WHERE inventory_id=?')
        .get('sold-map'),
    ).toBeUndefined();

    const result = registry.invoke(
      'reacquire_item',
      {
        id: 'sold-map',
        basis: 'repurchased',
        evidence: 'The merchant agreed to sell the map back for 2 gp.',
        payment: { gp: 2 },
      },
      ctx,
    );
    expect(result).toMatchObject({
      ok: true,
      data: {
        itemId: 'sold-map',
        previousDisposition: 'sold',
        paymentEventId: expect.any(String),
      },
    });
    const events = listCharacterWalletEvents(db);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      kind: 'spend',
      amounts: { gp: 2 },
      resultingWallet: { gp: 8 },
      source: 'inventory-repurchase:sold-map',
    });
    expect(
      db
        .prepare(
          `SELECT payment_event_id FROM inventory_custody_event
           WHERE inventory_id='sold-map'`,
        )
        .get(),
    ).toEqual({ payment_event_id: events[0]?.id });
    expect(
      registry.invoke(
        'remove_item',
        { id: 'sold-map', disposition: 'destroyed' },
        ctx,
      ),
    ).toMatchObject({ ok: true });
    expect(
      db
        .prepare(
          "SELECT payment_event_id FROM inventory_custody_event WHERE inventory_id='sold-map'",
        )
        .get(),
    ).toEqual({ payment_event_id: events[0]?.id });
  });
});
