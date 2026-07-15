// F4 spell-slot economy: progression-derived single-class counters, legal
// upcasting expenditure, Pact Magic's separate recharge, and ADR 0018 guard.

import { describe, expect, it } from 'vitest';
import type { CharacterSheet } from '../src/internal.js';
import {
  createDefaultToolRegistry,
  createSeededRng,
  createSqliteCharacterSheetStore,
  mutateState,
  readSpellSlots,
  restoreSpellSlots,
  SpellSlotError,
  spendSpellSlot,
  syncSpellSlots,
  UnsupportedCharacterBuildError,
} from '../src/internal.js';
import { bareDb, DEFAULT_TEST_SESSION_ID } from './support/db.js';

const AT = '2026-07-11T12:00:00.000Z';
const CTX = {
  provenance: 'test:spell-slots',
  sessionId: DEFAULT_TEST_SESSION_ID,
  at: AT,
};

function sheet(
  classKey: 'class:wizard' | 'class:warlock',
  level: number,
): CharacterSheet {
  const abilityScores = {
    strength: { base: 10, final: 10, modifier: 0 },
    dexterity: { base: 10, final: 10, modifier: 0 },
    constitution: { base: 10, final: 10, modifier: 0 },
    intelligence: { base: 10, final: 10, modifier: 0 },
    wisdom: { base: 10, final: 10, modifier: 0 },
    charisma: { base: 10, final: 10, modifier: 0 },
  } as const;
  return {
    schemaVersion: 1,
    system: 'dnd5e-srd',
    rulesPackId: 'rules:dnd5e-srd-5.1',
    recipeId: 'dnd5e-srd-character',
    creationMode: 'test',
    level,
    identity: { name: 'Slot Tester' },
    class: {
      key: classKey,
      name: classKey === 'class:wizard' ? 'Wizard' : 'Warlock',
    },
    ancestry: { key: 'ancestry:human', name: 'Human' },
    abilityScores,
    proficiencyBonus: level >= 5 ? 3 : 2,
    maxHitPoints: 8,
    savingThrows: {
      strength: { modifier: 0, proficient: false },
      dexterity: { modifier: 0, proficient: false },
      constitution: { modifier: 0, proficient: false },
      intelligence: { modifier: 0, proficient: false },
      wisdom: { modifier: 0, proficient: false },
      charisma: { modifier: 0, proficient: false },
    },
    skillProficiencies: [],
    toolProficiencies: [],
    armorProficiencies: [],
    weaponProficiencies: [],
    equipment: [],
    languages: [],
    spells: [],
    metadata: { createdAt: AT },
  };
}

function setup(classKey: 'class:wizard' | 'class:warlock', level: number) {
  const db = bareDb();
  createSqliteCharacterSheetStore(db).save('pc-1', sheet(classKey, level));
  mutateState(db, {
    target: 'character',
    field: 'level',
    op: 'set',
    value: level,
    ...CTX,
  });
  return db;
}

describe('spell-slot economy — ordinary Spellcasting', () => {
  it('seeds per-level counters only from the sole class progression and spends the lowest legal slot', () => {
    const db = setup('class:wizard', 5);

    expect(syncSpellSlots(db, CTX)).toEqual([
      expect.objectContaining({
        pool: 'spellcasting',
        spellLevel: 1,
        slotsMax: 4,
        slotsRemaining: 4,
      }),
      expect.objectContaining({
        pool: 'spellcasting',
        spellLevel: 2,
        slotsMax: 3,
        slotsRemaining: 3,
      }),
      expect.objectContaining({
        pool: 'spellcasting',
        spellLevel: 3,
        slotsMax: 2,
        slotsRemaining: 2,
      }),
    ]);

    const cast = spendSpellSlot(db, { spellLevel: 2, ...CTX });
    expect(cast).toMatchObject({
      spent: true,
      counter: { pool: 'spellcasting', spellLevel: 2, slotsUsed: 1 },
    });
    expect(
      readSpellSlots(db).find((slot) => slot.spellLevel === 2),
    ).toMatchObject({
      slotsRemaining: 2,
    });
    db.close();
  });

  it('allows an intentional higher-level slot but rejects a lower one and exhausted capacity', () => {
    const db = setup('class:wizard', 5);

    expect(
      spendSpellSlot(db, { spellLevel: 1, slotLevel: 3, ...CTX }),
    ).toMatchObject({
      counter: { spellLevel: 3, slotsUsed: 1 },
    });
    expect(() =>
      spendSpellSlot(db, { spellLevel: 2, slotLevel: 1, ...CTX }),
    ).toThrow(/requires a slot of level 2 or higher/);
    spendSpellSlot(db, { spellLevel: 3, ...CTX });
    expect(() => spendSpellSlot(db, { spellLevel: 3, ...CTX })).toThrow(
      /no available level 3 or higher spell slot/,
    );
    db.close();
  });

  it('does not commit a slot when pre-increment upcast validation fails', () => {
    const db = setup('class:wizard', 5);
    expect(() =>
      spendSpellSlot(db, {
        spellLevel: 3,
        ...CTX,
        beforeSpend: () => {
          throw new SpellSlotError('upcast validation failed');
        },
      }),
    ).toThrow('upcast validation failed');
    expect(readSpellSlots(db)).toEqual([]);
    db.close();
  });

  it('treats cantrips as at will and does not create a counter for them', () => {
    const db = setup('class:wizard', 1);

    expect(spendSpellSlot(db, { spellLevel: 0, ...CTX }).spent).toBe(false);
    expect(readSpellSlots(db)).toEqual([]);
    db.close();
  });

  it('restores ordinary slots only at a long rest', () => {
    const db = setup('class:wizard', 1);
    spendSpellSlot(db, { spellLevel: 1, ...CTX });

    expect(
      restoreSpellSlots(db, { event: 'short_rest', ...CTX }).restored,
    ).toEqual([]);
    expect(restoreSpellSlots(db, { event: 'long_rest', ...CTX })).toMatchObject(
      {
        restored: [{ pool: 'spellcasting', spellLevel: 1, slotsUsed: 0 }],
      },
    );
    db.close();
  });
});

describe('spell-slot economy — single-class Pact Magic', () => {
  it('uses a distinct Pact Magic pool at its own slot level and recharges on a short rest', () => {
    const db = setup('class:warlock', 3);

    expect(syncSpellSlots(db, CTX)).toEqual([
      expect.objectContaining({
        pool: 'pact_magic',
        spellLevel: 2,
        slotsMax: 2,
      }),
    ]);
    expect(spendSpellSlot(db, { spellLevel: 1, ...CTX })).toMatchObject({
      counter: { pool: 'pact_magic', spellLevel: 2, slotsUsed: 1 },
    });
    expect(
      restoreSpellSlots(db, { event: 'short_rest', ...CTX }),
    ).toMatchObject({
      restored: [{ pool: 'pact_magic', spellLevel: 2, slotsUsed: 0 }],
    });
    db.close();
  });

  it('carries spent Pact Magic slots across a Warlock slot-level increase', () => {
    const db = setup('class:warlock', 2);
    syncSpellSlots(db, CTX);
    spendSpellSlot(db, { spellLevel: 1, ...CTX });
    spendSpellSlot(db, { spellLevel: 1, ...CTX });

    createSqliteCharacterSheetStore(db).save('pc-1', sheet('class:warlock', 3));
    mutateState(db, {
      target: 'character',
      field: 'level',
      op: 'set',
      value: 3,
      ...CTX,
    });

    expect(syncSpellSlots(db, CTX)).toEqual([
      expect.objectContaining({
        pool: 'pact_magic',
        spellLevel: 2,
        slotsMax: 2,
        slotsUsed: 2,
        slotsRemaining: 0,
      }),
    ]);
    db.close();
  });
});

describe('spend_spell_slot tool', () => {
  it('resolves the spell’s actual pack level instead of trusting model input', () => {
    const db = setup('class:wizard', 5);
    const registry = createDefaultToolRegistry();
    const context = {
      db,
      rng: createSeededRng(1),
      campaignId: 'campaign-1',
      sessionId: DEFAULT_TEST_SESSION_ID,
      turnId: 'turn-1',
      at: AT,
    };

    const tooLow = registry.invoke(
      'spend_spell_slot',
      { spellRef: 'spell:fireball', slotLevel: 1 },
      context,
    );
    expect(tooLow).toMatchObject({
      ok: false,
      code: 'spell_slot_error',
      message: expect.stringMatching(/level 3 spell requires a slot/),
    });
    const legal = registry.invoke(
      'spend_spell_slot',
      { spellRef: 'spell:fireball', slotLevel: 3 },
      context,
    );
    expect(legal).toMatchObject({
      ok: true,
      data: {
        spent: true,
        spellRef: 'spell:fireball',
        baseSpellLevel: 3,
        selectedSlotLevel: 3,
        counter: { spellLevel: 3, slotsUsed: 1 },
      },
    });
    const resolved = registry.invoke(
      'resolve_spell_upcast',
      { spellRef: 'spell:fireball', slotLevel: 3 },
      context,
    );
    expect(legal.ok && resolved.ok ? legal.data.upcast : undefined).toEqual(
      resolved.ok ? resolved.data : undefined,
    );
    db.close();
  });
});

describe('spell-slot economy — ADR 0018 boundary', () => {
  it('fails before seeding any slots when persisted input has multiclass-shaped state', () => {
    const db = setup('class:wizard', 1);
    const raw = JSON.parse(
      (
        db
          .prepare(
            'SELECT sheet_json FROM character_sheet WHERE character_id = ?',
          )
          .get('pc-1') as { sheet_json: string }
      ).sheet_json,
    ) as Record<string, unknown>;
    raw.classes = [{ key: 'class:wizard', level: 1 }];
    db.prepare(
      'UPDATE character_sheet SET sheet_json = ? WHERE character_id = ?',
    ).run(JSON.stringify(raw), 'pc-1');

    expect(() => syncSpellSlots(db, CTX)).toThrow(
      UnsupportedCharacterBuildError,
    );
    expect(() => spendSpellSlot(db, { spellLevel: 1, ...CTX })).toThrow(
      UnsupportedCharacterBuildError,
    );
    expect(() => spendSpellSlot(db, { spellLevel: 0, ...CTX })).toThrow(
      UnsupportedCharacterBuildError,
    );
    expect(() => restoreSpellSlots(db, { event: 'long_rest', ...CTX })).toThrow(
      UnsupportedCharacterBuildError,
    );
    expect(readSpellSlots(db)).toEqual([]);
    db.close();
  });

  it('fails closed if a live level disagrees with the sole class level', () => {
    const db = setup('class:wizard', 1);
    mutateState(db, {
      target: 'character',
      field: 'level',
      op: 'set',
      value: 2,
      ...CTX,
    });

    expect(() => syncSpellSlots(db, CTX)).toThrow(SpellSlotError);
    db.close();
  });
});
