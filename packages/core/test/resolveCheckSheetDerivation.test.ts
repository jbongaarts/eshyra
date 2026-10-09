import { describe, expect, it } from 'vitest';
import type {
  AbilityScoreName,
  CharacterSheet,
  FinalizedAbilityScore,
  ToolContext,
} from '../src/internal.js';
import {
  createDefaultToolRegistry,
  createSeededRng,
  createSqliteCharacterSheetStore,
  ensureCharacterRow,
  initSchema,
  openDatabase,
  startSession,
} from '../src/internal.js';

/**
 * resolve_check derives the governing modifier + proficiency term from the
 * stored character sheet when given skill/ability (eshyra-r8en.1).
 */

const MODS: Record<AbilityScoreName, number> = {
  strength: 1,
  dexterity: 3,
  constitution: 2,
  intelligence: 4,
  wisdom: 2,
  charisma: -1,
};

function sheet(overrides: Partial<CharacterSheet> = {}): CharacterSheet {
  const abilityScores = {} as Record<AbilityScoreName, FinalizedAbilityScore>;
  const savingThrows = {} as CharacterSheet['savingThrows'];
  for (const a of Object.keys(MODS) as AbilityScoreName[]) {
    abilityScores[a] = { base: 10, final: 10, modifier: MODS[a] };
    savingThrows[a] = { modifier: MODS[a], proficient: false };
  }
  return {
    schemaVersion: 1,
    system: 'dnd5e-srd',
    rulesPackId: 'rules:dnd5e-srd-5.1',
    recipeId: 'dnd5e-srd-character',
    creationMode: 'test',
    level: 1,
    identity: { name: 'T' },
    class: { key: 'class:rogue', name: 'Rogue' },
    ancestry: { key: 'ancestry:human', name: 'Human' },
    abilityScores,
    proficiencyBonus: 2,
    maxHitPoints: 8,
    savingThrows,
    skillProficiencies: [],
    toolProficiencies: [],
    armorProficiencies: [],
    weaponProficiencies: [],
    equipment: [],
    languages: [],
    spells: [],
    metadata: { createdAt: '2026-01-01T00:00:00.000Z' },
    ...overrides,
  };
}

const rogue = sheet({
  skillProficiencies: ['Stealth'],
  featureChoices: [
    {
      featureRef: 'feature:rogue:expertise',
      choiceId: 'expertise',
      optionIds: ['skill:Stealth'],
      level: 1,
    },
  ],
});
const bard = sheet({
  level: 2,
  class: { key: 'class:bard', name: 'Bard' },
  proficiencyBonus: 3,
});
const wizard = sheet({
  class: { key: 'class:wizard', name: 'Wizard' },
  savingThrows: {
    ...sheet().savingThrows,
    intelligence: { modifier: 6, proficient: true },
  },
});

function setup() {
  const db = openDatabase(':memory:');
  initSchema(db);
  startSession(db, {
    campaignId: 'campaign-1',
    sessionId: 'session-1',
    startedAt: '2026-07-11T09:00:00.000Z',
  });
  const store = createSqliteCharacterSheetStore(db);
  for (const [id, name, s] of [
    ['pc-rogue', 'Kira', rogue],
    ['pc-bard', 'Lyra', bard],
    ['pc-wizard', 'Mordo', wizard],
  ] as const) {
    ensureCharacterRow(db, id, 'test', 'session-1', '2026-07-11T09:00:00.000Z');
    db.prepare('UPDATE character SET name = ? WHERE id = ?').run(name, id);
    store.save(id, s);
  }
  ensureCharacterRow(db, 'pc-nosheet', 'test', 'session-1', 'x');
  db.prepare('UPDATE character SET name = ? WHERE id = ?').run(
    'Nobody',
    'pc-nosheet',
  );
  return db;
}

const registry = createDefaultToolRegistry();
const db = setup();

function invoke(args: Record<string, unknown>) {
  const ctx: ToolContext = {
    db,
    rng: createSeededRng(5),
    campaignId: 'campaign-1',
    sessionId: 'session-1',
    turnId: 'turn-1',
    at: '2026-07-11T10:00:00.000Z',
  };
  return registry.invoke('resolve_check', { reason: 'r', ...args }, ctx);
}

function data(result: ReturnType<typeof invoke>) {
  expect(result.ok, JSON.stringify(result)).toBe(true);
  if (!result.ok) throw new Error('unreachable');
  return result.data as Record<string, unknown> & {
    natural: number;
    modifierTotal: number;
    total: number;
    modifiers: { label: string; value: number; source?: string }[];
    proficiency?: { multiplier: string; applied: number };
  };
}

describe('resolve_check sheet derivation', () => {
  it('derives rogue Stealth expertise as DEX + 2xPB', () => {
    const d = data(
      invoke({ kind: 'ability_check', actor: 'Kira', skill: 'Stealth' }),
    );
    expect(d.modifiers).toEqual([
      { label: 'Dexterity modifier', value: 3, source: 'sheet:pc-rogue' },
    ]);
    expect(d.proficiency).toMatchObject({ multiplier: 'double', applied: 4 });
    expect(d.modifierTotal).toBe(7);
    expect(d.total).toBe(d.natural + 7);
  });

  it('gives a bard Jack of All Trades on a raw Strength check', () => {
    const d = data(
      invoke({ kind: 'ability_check', actor: 'Lyra', ability: 'strength' }),
    );
    expect(d.modifiers.map((m) => [m.label, m.value])).toEqual([
      ['Strength modifier', 1],
      ['Jack of All Trades', 1],
    ]);
    expect(d.modifierTotal).toBe(2);
  });

  it('adds proficiency bonus to a proficient saving throw only', () => {
    const prof = data(
      invoke({ kind: 'saving_throw', actor: 'Mordo', ability: 'intelligence' }),
    );
    expect(prof.proficiency).toMatchObject({
      multiplier: 'normal',
      applied: 2,
    });
    expect(prof.modifierTotal).toBe(6);
    const plain = data(
      invoke({ kind: 'saving_throw', actor: 'Mordo', ability: 'wisdom' }),
    );
    expect(plain.proficiency).toBeUndefined();
    expect(plain.modifierTotal).toBe(2);
  });

  it('still adds situational extra modifiers such as Guidance', () => {
    const d = data(
      invoke({
        kind: 'ability_check',
        actor: 'Kira',
        skill: 'Stealth',
        modifiers: [{ label: 'Guidance', value: 3, source: 'spell:guidance' }],
      }),
    );
    expect(d.modifierTotal).toBe(10);
  });

  it('refuses proficiency together with skill/ability', () => {
    const r = invoke({
      kind: 'ability_check',
      actor: 'Kira',
      skill: 'Stealth',
      proficiency: { bonus: 2, multiplier: 'normal' },
    });
    expect(r).toMatchObject({ ok: false, code: 'invalid_args' });
  });

  it('refuses a caller modifier naming the governing ability', () => {
    for (const source of ['DEX', 'Dexterity score']) {
      const r = invoke({
        kind: 'ability_check',
        actor: 'Kira',
        skill: 'Stealth',
        modifiers: [{ label: 'x', value: 3, source }],
      });
      expect(r).toMatchObject({ ok: false, code: 'invalid_args' });
    }
  });

  it('refuses skill for a combatant, a sheetless character, and attacks', () => {
    for (const args of [
      { kind: 'ability_check', actor: 'goblin 2', skill: 'Stealth' },
      { kind: 'ability_check', actor: 'Nobody', skill: 'Stealth' },
      { kind: 'attack', actor: 'Kira', ability: 'dexterity' },
      { kind: 'saving_throw', actor: 'Kira', skill: 'Stealth' },
    ]) {
      expect(invoke(args)).toMatchObject({ ok: false, code: 'invalid_args' });
    }
  });

  it('leaves declared-modifier calls unchanged', () => {
    const d = data(
      invoke({
        kind: 'ability_check',
        actor: 'Kira',
        modifiers: [{ label: 'DEX modifier', value: 3 }],
        proficiency: { bonus: 2, multiplier: 'double' },
      }),
    );
    expect(d.modifierTotal).toBe(7);
    expect(d.derivedFromSheet).toBeUndefined();
  });
});
