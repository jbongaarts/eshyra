// Flexible Casting (eshyra-09co.1): sorcery points <-> spell slots against
// the real bundled pack's curated Font of Magic procedure.

import { describe, expect, it } from 'vitest';
import type { CharacterSheet } from '../src/internal.js';
import {
  createDefaultToolRegistry,
  createSeededRng,
  createSqliteCharacterSheetStore,
  FlexibleCastingError,
  flexibleCasting,
  mutateState,
  readSpellSlots,
  restoreSpellSlots,
  spendSpellSlot,
  spendUsage,
} from '../src/internal.js';
import { bareDb, DEFAULT_TEST_SESSION_ID } from './support/db.js';

const AT = '2026-07-11T12:00:00.000Z';
const CTX = {
  provenance: 'test:flexible-casting',
  sessionId: DEFAULT_TEST_SESSION_ID,
  at: AT,
};
const CAMPAIGN = 'campaign-1';

function sheet(classKey: string, name: string, level: number): CharacterSheet {
  const score = { base: 10, final: 10, modifier: 0 } as const;
  const save = { modifier: 0, proficient: false } as const;
  return {
    schemaVersion: 1,
    system: 'dnd5e-srd',
    rulesPackId: 'rules:dnd5e-srd-5.1',
    recipeId: 'dnd5e-srd-character',
    creationMode: 'test',
    level,
    identity: { name: 'Flex Tester' },
    class: { key: classKey, name },
    ancestry: { key: 'ancestry:human', name: 'Human' },
    abilityScores: {
      strength: score,
      dexterity: score,
      constitution: score,
      intelligence: score,
      wisdom: score,
      charisma: score,
    },
    proficiencyBonus: 2,
    maxHitPoints: 8,
    savingThrows: {
      strength: save,
      dexterity: save,
      constitution: save,
      intelligence: save,
      wisdom: save,
      charisma: save,
    },
    skillProficiencies: [],
    toolProficiencies: [],
    armorProficiencies: [],
    weaponProficiencies: [],
    equipment: [],
    languages: [],
    spells: [],
    metadata: { createdAt: AT },
  } as CharacterSheet;
}

function setup(classKey: string, name: string, level: number) {
  const db = bareDb();
  createSqliteCharacterSheetStore(db).save(
    'pc-1',
    sheet(classKey, name, level),
  );
  mutateState(db, {
    target: 'character',
    field: 'level',
    op: 'set',
    value: level,
    ...CTX,
  });
  db.prepare('UPDATE character SET name = ? WHERE id = ?').run(
    'Flex Tester',
    'pc-1',
  );
  return db;
}

const sorcerer3 = () => setup('class:sorcerer', 'Sorcerer', 3);
const flex = (
  db: ReturnType<typeof bareDb>,
  operation: 'create-slot' | 'convert-slot',
  slotLevel: number,
) =>
  flexibleCasting(db, { campaignId: CAMPAIGN, operation, slotLevel, ...CTX });

describe('Flexible Casting', () => {
  it('creates a slot for its pack cost, refuses an unaffordable repeat, and spends created slots first', () => {
    const db = sorcerer3();
    const created = flex(db, 'create-slot', 1);
    expect(created).toMatchObject({
      pointDelta: -2,
      sorceryPoints: { remaining: 1, max: 3 },
      slot: { spellLevel: 1, created: true, slotsMax: 1, slotsUsed: 0 },
      actionCost: 'bonus-action',
      createdSlotExpires: 'long-rest',
    });
    expect(() => flex(db, 'create-slot', 1)).toThrow(/requires 2 points/);
    expect(() => flex(db, 'create-slot', 6)).toThrow(FlexibleCastingError);

    const listed = readSpellSlots(db);
    expect(listed.filter((slot) => slot.created)).toHaveLength(1);
    expect(
      listed.filter((slot) => !slot.created && slot.spellLevel === 1),
    ).toHaveLength(1);

    const cast = spendSpellSlot(db, { spellLevel: 1, ...CTX });
    expect(cast.counter).toMatchObject({ created: true, slotsUsed: 1 });
    const next = spendSpellSlot(db, { spellLevel: 1, ...CTX });
    expect(next.counter.created).toBeUndefined();
    db.close();
  });

  it('removes created slots at a long rest but not a short rest', () => {
    const db = sorcerer3();
    flex(db, 'create-slot', 1);
    restoreSpellSlots(db, { event: 'short_rest', ...CTX });
    expect(readSpellSlots(db).some((slot) => slot.created)).toBe(true);
    const rest = restoreSpellSlots(db, { event: 'long_rest', ...CTX });
    expect(rest.expiredCreated).toHaveLength(1);
    expect(readSpellSlots(db).some((slot) => slot.created)).toBe(false);
    db.close();
  });

  it('refuses converting past the point maximum, then restores points once room exists', () => {
    const db = sorcerer3();
    expect(() => flex(db, 'convert-slot', 2)).toThrow(
      /exceeds the resource maximum/,
    );
    // Nothing was expended by the refused conversion.
    expect(
      readSpellSlots(db).find((slot) => slot.spellLevel === 2)?.slotsUsed ?? 0,
    ).toBe(0);
    spendUsage(db, {
      campaignId: CAMPAIGN,
      owner: { kind: 'character' },
      ability: 'sorcery-points',
      uses: 2,
      ...CTX,
    });
    const converted = flex(db, 'convert-slot', 2);
    expect(converted).toMatchObject({
      pointDelta: 2,
      sorceryPoints: { remaining: 3, max: 3 },
      slot: { spellLevel: 2, slotsUsed: 1 },
    });
    db.close();
  });

  it('refuses non-sorcerers and level 1 sorcerers', () => {
    const wizard = setup('class:wizard', 'Wizard', 5);
    expect(() => flex(wizard, 'create-slot', 1)).toThrow(/not a sorcerer/);
    wizard.close();
    const novice = setup('class:sorcerer', 'Sorcerer', 1);
    expect(() => flex(novice, 'create-slot', 1)).toThrow(/level 2/);
    novice.close();
  });

  it('runs through the flexible_casting tool by character name', () => {
    const db = sorcerer3();
    const context = {
      db,
      rng: createSeededRng(1),
      campaignId: CAMPAIGN,
      sessionId: DEFAULT_TEST_SESSION_ID,
      turnId: 'turn-1',
      at: AT,
    };
    const registry = createDefaultToolRegistry();
    const result = registry.invoke(
      'flexible_casting',
      { operation: 'create-slot', slotLevel: 1, character: 'Flex Tester' },
      context,
    );
    expect(result).toMatchObject({
      ok: true,
      data: { pointDelta: -2, slot: { created: true } },
    });
    expect(
      registry.invoke(
        'flexible_casting',
        { operation: 'create-slot', slotLevel: 6 },
        context,
      ),
    ).toMatchObject({ ok: false, code: 'flexible_casting_error' });
    db.close();
  });
});
