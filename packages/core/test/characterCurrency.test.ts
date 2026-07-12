import { beforeEach, describe, expect, it } from 'vitest';
import { ABILITY_SCORE_NAMES } from '../src/character/abilities.js';
import type { AbilityScoreName } from '../src/character/creation.js';
import type {
  CharacterSheet,
  FinalizedAbilityScore,
} from '../src/character/finalizeCharacter.js';
import {
  adjustCharacterCurrency,
  convertCharacterCurrency,
  createSqliteCharacterSheetStore,
  type Db,
  DND5E_SRD_PACK_ID,
  DND5E_SRD_SYSTEM_ID,
  getCharacterWallet,
  initSchema,
  listCharacterWalletEvents,
  MutateStateError,
  openDatabase,
} from '../src/internal.js';
import { DEFAULT_TEST_SESSION_ID } from './support/db.js';

const AT = '2026-06-28T03:30:00.000Z';

function makeSheet(overrides: Partial<CharacterSheet> = {}): CharacterSheet {
  const abilityScores = {} as Record<AbilityScoreName, FinalizedAbilityScore>;
  const savingThrows = {} as CharacterSheet['savingThrows'];
  for (const name of ABILITY_SCORE_NAMES) {
    abilityScores[name] = { base: 10, final: 10, modifier: 0 };
    savingThrows[name] = { modifier: 0, proficient: false };
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
    abilityScores,
    proficiencyBonus: 2,
    maxHitPoints: 12,
    savingThrows,
    skillProficiencies: [],
    toolProficiencies: [],
    armorProficiencies: [],
    weaponProficiencies: [],
    equipment: ['chain mail'],
    languages: ['Common'],
    spells: [],
    metadata: { createdAt: AT },
    ...overrides,
  };
}

function ctx() {
  return {
    source: 'test',
    provenance: 'test:wallet',
    sessionId: DEFAULT_TEST_SESSION_ID,
    at: AT,
  };
}

describe('character currency wallet', () => {
  let db: Db;

  beforeEach(() => {
    db = openDatabase(':memory:');
    initSchema(db);
  });

  it('treats legacy sheets without a wallet as an empty wallet', () => {
    createSqliteCharacterSheetStore(db).save('pc-1', makeSheet());
    expect(getCharacterWallet(db)).toEqual({
      cp: 0,
      sp: 0,
      ep: 0,
      gp: 0,
      pp: 0,
    });
  });

  it('gains and spends exact-denomination coins on the sheet and ledger', () => {
    const store = createSqliteCharacterSheetStore(db, () => AT);
    store.save(
      'pc-1',
      makeSheet({ wallet: { cp: 0, sp: 0, ep: 0, gp: 3, pp: 0 } }),
    );

    const gained = adjustCharacterCurrency(
      db,
      { kind: 'gain', amounts: { gp: 7, sp: 2 } },
      ctx(),
    );
    expect(gained.wallet).toEqual({ cp: 0, sp: 2, ep: 0, gp: 10, pp: 0 });

    const spent = adjustCharacterCurrency(
      db,
      { kind: 'spend', amounts: { gp: 4 } },
      ctx(),
    );
    expect(spent.wallet).toEqual({ cp: 0, sp: 2, ep: 0, gp: 6, pp: 0 });
    expect(store.load('pc-1')?.wallet).toEqual(spent.wallet);

    const events = listCharacterWalletEvents(db);
    expect(events.map((event) => event.kind)).toEqual(['gain', 'spend']);
    expect(events[1]).toMatchObject({
      id: 'pc-1:wallet:2',
      amounts: { cp: 0, sp: 0, ep: 0, gp: 4, pp: 0 },
      resultingWallet: spent.wallet,
      source: 'test',
    });
  });

  it('blocks exact-denomination spends that would make a coin negative', () => {
    createSqliteCharacterSheetStore(db).save(
      'pc-1',
      makeSheet({ wallet: { cp: 0, sp: 0, ep: 0, gp: 1, pp: 1 } }),
    );
    expect(() =>
      adjustCharacterCurrency(db, { kind: 'spend', amounts: { gp: 2 } }, ctx()),
    ).toThrow(MutateStateError);
    expect(listCharacterWalletEvents(db)).toHaveLength(0);
  });

  it('converts currency only when the exchange is exact', () => {
    const store = createSqliteCharacterSheetStore(db, () => AT);
    store.save(
      'pc-1',
      makeSheet({ wallet: { cp: 0, sp: 10, ep: 0, gp: 0, pp: 0 } }),
    );

    const result = convertCharacterCurrency(
      db,
      { amount: 10, from: 'sp', to: 'gp' },
      ctx(),
    );

    expect(result.wallet).toEqual({ cp: 0, sp: 0, ep: 0, gp: 1, pp: 0 });
    expect(listCharacterWalletEvents(db)[0]).toMatchObject({
      kind: 'convert',
      amounts: { sp: -10, gp: 1 },
      resultingWallet: result.wallet,
    });
    expect(store.load('pc-1')?.wallet).toEqual(result.wallet);
  });

  it('keeps same-timestamp wallet events in SQLite insertion order', () => {
    createSqliteCharacterSheetStore(db).save(
      'pc-1',
      makeSheet({ wallet: { cp: 0, sp: 0, ep: 0, gp: 0, pp: 0 } }),
    );
    for (let i = 0; i < 12; i += 1) {
      adjustCharacterCurrency(db, { kind: 'gain', amounts: { cp: 1 } }, ctx());
    }
    expect(listCharacterWalletEvents(db).map((event) => event.id)).toEqual(
      Array.from({ length: 12 }, (_, i) => `pc-1:wallet:${i + 1}`),
    );
  });

  it('fails closed for a missing or unsupported sheet', () => {
    expect(() => getCharacterWallet(db, 'pc-1')).toThrow(MutateStateError);
    createSqliteCharacterSheetStore(db).save(
      'pc-1',
      makeSheet({ system: 'other', rulesPackId: 'other-pack' }),
    );
    expect(() => getCharacterWallet(db, 'pc-1')).toThrow(MutateStateError);
  });
});
