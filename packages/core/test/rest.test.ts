import { describe, expect, it } from 'vitest';
import type { CharacterSheet } from '../src/internal.js';
import {
  addCondition,
  advanceWorldTime,
  completeLongRest,
  completeShortRest,
  createDefaultToolRegistry,
  createSeededRng,
  createSqliteCharacterSheetStore,
  finishShortRestRecovery,
  grantTemporaryHp,
  mutateState,
  RestError,
  readHitDice,
  readSpellSlots,
  spendRestHitDie,
  spendSpellSlot,
  spendUsage,
  syncSpellSlots,
} from '../src/internal.js';
import {
  DEFAULT_TEST_CAMPAIGN_ID,
  DEFAULT_TEST_SESSION_ID,
  freshDbWithSession,
} from './support/db.js';

const CTX = {
  campaignId: DEFAULT_TEST_CAMPAIGN_ID,
  provenance: 'test:rest',
  sessionId: DEFAULT_TEST_SESSION_ID,
  at: '2026-07-14T00:00:00.000Z',
};

function sheet(
  classKey: 'class:wizard' | 'class:warlock',
  level = 2,
): CharacterSheet {
  const abilityScores = {
    strength: { base: 10, final: 10, modifier: 0 },
    dexterity: { base: 10, final: 10, modifier: 0 },
    constitution: { base: 14, final: 14, modifier: 2 },
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
    identity: { name: classKey },
    class: {
      key: classKey,
      name: classKey === 'class:wizard' ? 'Wizard' : 'Warlock',
    },
    ancestry: { key: 'ancestry:human', name: 'Human' },
    abilityScores,
    proficiencyBonus: 2,
    maxHitPoints: 20,
    savingThrows: Object.fromEntries(
      Object.keys(abilityScores).map((key) => [
        key,
        { modifier: 0, proficient: false },
      ]),
    ),
    skillProficiencies: [],
    toolProficiencies: [],
    armorProficiencies: [],
    weaponProficiencies: [],
    equipment: [],
    languages: [],
    spells: [],
    metadata: { createdAt: CTX.at },
  } as CharacterSheet;
}

function setupCharacters(): ReturnType<typeof freshDbWithSession> {
  const db = freshDbWithSession();
  const store = createSqliteCharacterSheetStore(db);
  store.save('pc-1', sheet('class:warlock'));
  db.prepare(
    `INSERT INTO character(id, name, class_name, level, hp_current, hp_max, ability_scores_json, role, provenance, session_id, updated_at)
     VALUES ('pc-2', 'Wizard', 'Wizard', 2, 10, 20, ?, 'pc', ?, ?, ?)`,
  ).run(
    JSON.stringify(sheet('class:wizard').abilityScores),
    CTX.provenance,
    CTX.sessionId,
    CTX.at,
  );
  store.save('pc-2', sheet('class:wizard'));
  for (const id of ['pc-1', 'pc-2']) {
    mutateState(db, {
      target: 'character',
      id,
      field: 'hp_max',
      op: 'set',
      value: 20,
      ...CTX,
    });
    mutateState(db, {
      target: 'character',
      id,
      field: 'hp_current',
      op: 'set',
      value: 10,
      ...CTX,
    });
    mutateState(db, {
      target: 'character',
      id,
      field: 'level',
      op: 'set',
      value: 2,
      ...CTX,
    });
  }
  return db;
}

describe('F7 rest qualification boundary', () => {
  it('short rest scopes time, Pact Magic, usages, and recovery to participants', () => {
    const db = setupCharacters();
    syncSpellSlots(db, { ...CTX, characterId: 'pc-1' });
    syncSpellSlots(db, { ...CTX, characterId: 'pc-2' });
    spendSpellSlot(db, { ...CTX, characterId: 'pc-1', spellLevel: 1 });
    spendSpellSlot(db, { ...CTX, characterId: 'pc-2', spellLevel: 1 });
    spendUsage(db, {
      ...CTX,
      campaignId: CTX.campaignId,
      owner: { kind: 'character', ref: 'pc-1' },
      ability: 'Second Wind',
      declared: { maxUses: 1, reset: 'short_rest' },
    });
    spendUsage(db, {
      ...CTX,
      campaignId: CTX.campaignId,
      owner: { kind: 'character', ref: 'pc-2' },
      ability: 'Arcane Recovery',
      declared: { maxUses: 1, reset: 'long_rest' },
    });
    completeShortRest(db, {
      ...CTX,
      restId: 'short-group',
      participants: ['pc-1'],
      qualification: {
        durationMinutes: 60,
        sleepMinutes: 0,
        lightActivityMinutes: 0,
        strenuousInterruptionMinutes: 0,
        strenuousActivity: false,
        foodAndDrink: false,
      },
    });
    expect(
      db.prepare('SELECT elapsed_minutes FROM clock WHERE id=1').get(),
    ).toEqual({ elapsed_minutes: 60 });
    expect(
      readSpellSlots(db, 'pc-1').find((slot) => slot.pool === 'pact_magic')
        ?.slotsUsed,
    ).toBe(0);
    expect(
      readSpellSlots(db, 'pc-1').find((slot) => slot.pool === 'spellcasting'),
    ).toBeUndefined();
    expect(
      readSpellSlots(db, 'pc-2').find((slot) => slot.pool === 'spellcasting')
        ?.slotsUsed,
    ).toBe(1);
    expect(
      db
        .prepare(
          "SELECT uses_used FROM entity_usage_counter WHERE owner_ref='pc-1'",
        )
        .get(),
    ).toEqual({ uses_used: 0 });
    expect(
      db
        .prepare(
          "SELECT uses_used FROM entity_usage_counter WHERE owner_ref='pc-2'",
        )
        .get(),
    ).toEqual({ uses_used: 1 });
    expect(readHitDice(db, 'pc-1', CTX).diceRemaining).toBe(2);
    expect(() =>
      spendRestHitDie(db, {
        ...CTX,
        campaignId: CTX.campaignId,
        restId: 'short-group',
        characterId: 'pc-2',
        rng: createSeededRng(1),
      }),
    ).toThrow(/not a participant/);
    const spent = spendRestHitDie(db, {
      ...CTX,
      campaignId: CTX.campaignId,
      restId: 'short-group',
      characterId: 'pc-1',
      rng: createSeededRng(1),
    });
    expect(spent).toMatchObject({
      characterId: 'pc-1',
      hitDiceRemaining: 1,
      constitutionModifier: 2,
    });
    finishShortRestRecovery(db, CTX.campaignId, 'short-group', CTX);
    expect(() =>
      spendRestHitDie(db, {
        ...CTX,
        campaignId: CTX.campaignId,
        restId: 'short-group',
        characterId: 'pc-1',
        rng: createSeededRng(1),
      }),
    ).toThrow(/closed/);
    db.close();
  });

  it('long rest restores HP, temporary HP, resources, half Hit Dice, and one exhaustion level with food', () => {
    const db = setupCharacters();
    addCondition(
      db,
      { id: 'exhaustion', level: 2 },
      { ...CTX, characterId: 'pc-1' },
    );
    grantTemporaryHp(db, 5, { ...CTX, characterId: 'pc-1' });
    syncSpellSlots(db, { ...CTX, characterId: 'pc-1' });
    syncSpellSlots(db, { ...CTX, characterId: 'pc-2' });
    spendSpellSlot(db, { ...CTX, characterId: 'pc-1', spellLevel: 1 });
    spendSpellSlot(db, { ...CTX, characterId: 'pc-2', spellLevel: 1 });
    const short = completeShortRest(db, {
      ...CTX,
      restId: 'short-before-long',
      participants: ['pc-1'],
      qualification: {
        durationMinutes: 60,
        sleepMinutes: 0,
        lightActivityMinutes: 0,
        strenuousInterruptionMinutes: 0,
        strenuousActivity: false,
        foodAndDrink: false,
      },
    });
    spendRestHitDie(db, {
      ...CTX,
      campaignId: CTX.campaignId,
      restId: 'short-before-long',
      characterId: 'pc-1',
      rng: createSeededRng(2),
    });
    finishShortRestRecovery(db, CTX.campaignId, 'short-before-long', CTX);
    completeLongRest(db, {
      ...CTX,
      restId: 'long-1',
      participants: ['pc-1'],
      qualification: {
        durationMinutes: 480,
        sleepMinutes: 360,
        lightActivityMinutes: 120,
        strenuousInterruptionMinutes: 0,
        strenuousActivity: false,
        foodAndDrink: true,
      },
    });
    expect(
      db
        .prepare("SELECT hp_current, hp_temp FROM character WHERE id='pc-1'")
        .get(),
    ).toEqual({ hp_current: 20, hp_temp: 0 });
    expect(
      db.prepare("SELECT conditions_json FROM character WHERE id='pc-1'").get(),
    ).toEqual({ conditions_json: '[{"id":"exhaustion","level":1}]' });
    expect(readHitDice(db, 'pc-1', CTX).diceRemaining).toBe(2);
    expect(
      db.prepare('SELECT elapsed_minutes FROM clock WHERE id=1').get(),
    ).toEqual({ elapsed_minutes: 540 });
    expect(short).toMatchObject({ kind: 'short' });
    db.close();
  });

  it('accepts semantic rest-id retries and enforces the exact 24-hour boundary', () => {
    const db = setupCharacters();
    const qualification = {
      durationMinutes: 60,
      sleepMinutes: 0,
      lightActivityMinutes: 0,
      strenuousInterruptionMinutes: 0,
      strenuousActivity: false,
      foodAndDrink: false,
    };
    completeShortRest(db, {
      ...CTX,
      restId: 'retry-short',
      participants: ['pc-1'],
      qualification,
    });
    const retry = completeShortRest(db, {
      ...CTX,
      restId: 'retry-short',
      participants: ['pc-1'],
      qualification: {
        foodAndDrink: false,
        strenuousActivity: false,
        strenuousInterruptionMinutes: 0,
        lightActivityMinutes: 0,
        sleepMinutes: 0,
        durationMinutes: 60,
      },
    });
    expect(retry).toMatchObject({ restId: 'retry-short' });
    expect(() =>
      completeShortRest(db, {
        ...CTX,
        restId: 'retry-short',
        participants: ['pc-2'],
        qualification,
      }),
    ).toThrow(/participant declaration/);

    completeLongRest(db, {
      ...CTX,
      restId: 'long-boundary-1',
      participants: ['pc-1'],
      qualification: {
        durationMinutes: 480,
        sleepMinutes: 360,
        lightActivityMinutes: 0,
        strenuousInterruptionMinutes: 0,
        strenuousActivity: false,
        foodAndDrink: false,
      },
    });
    advanceWorldTime(db, { campaignId: CTX.campaignId, minutes: 1440, ...CTX });
    expect(() =>
      completeLongRest(db, {
        ...CTX,
        restId: 'long-boundary-2',
        participants: ['pc-1'],
        qualification: {
          durationMinutes: 480,
          sleepMinutes: 360,
          lightActivityMinutes: 0,
          strenuousInterruptionMinutes: 0,
          strenuousActivity: false,
          foodAndDrink: false,
        },
      }),
    ).not.toThrow();
    db.close();
  });

  it('rejects coercible, malformed, and unknown qualification fields', () => {
    const db = freshDbWithSession();
    for (const qualification of [
      { durationMinutes: '60' },
      { durationMinutes: -1 },
      { durationMinutes: 60, strenuousActivity: 0 },
      { durationMinutes: 60, unknownEvidence: true },
    ]) {
      expect(() =>
        completeShortRest(db, {
          ...CTX,
          restId: `bad-${JSON.stringify(qualification)}`,
          participants: ['pc-1'],
          qualification: qualification as never,
        }),
      ).toThrow(RestError);
    }
    expect(db.prepare('SELECT count(*) count FROM rest_event').get()).toEqual({
      count: 0,
    });
    db.close();
  });

  it('rejects completion from durable active combat state', () => {
    const db = freshDbWithSession();
    db.prepare(
      `INSERT INTO combat_instance(campaign_id, combat_instance_id, status, provenance, session_id, opened_at, updated_at)
       VALUES (?, ?, 'active', ?, ?, ?, ?)`,
    ).run(
      DEFAULT_TEST_CAMPAIGN_ID,
      'combat-1',
      CTX.provenance,
      CTX.sessionId,
      CTX.at,
      CTX.at,
    );
    expect(() =>
      completeLongRest(db, {
        ...CTX,
        restId: 'blocked-by-combat',
        participants: ['pc-1'],
        qualification: {
          durationMinutes: 480,
          sleepMinutes: 360,
          lightActivityMinutes: 0,
          strenuousInterruptionMinutes: 0,
          strenuousActivity: false,
          foodAndDrink: true,
        },
      }),
    ).toThrow(/combat is active/);
    expect(db.prepare('SELECT count(*) count FROM rest_event').get()).toEqual({
      count: 0,
    });
    db.close();
  });

  it('publishes an explicit qualification schema', () => {
    const definition = createDefaultToolRegistry()
      .definitions()
      .find((tool) => tool.name === 'complete_long_rest');
    const qualification = definition?.inputSchema.properties.qualification as {
      properties: Record<string, unknown>;
      additionalProperties: boolean;
    };
    expect(Object.keys(qualification.properties).sort()).toEqual(
      [
        'durationMinutes',
        'foodAndDrink',
        'lightActivityMinutes',
        'sleepMinutes',
        'strenuousActivity',
        'strenuousInterruptionMinutes',
      ].sort(),
    );
    expect(qualification.additionalProperties).toBe(false);
  });
});
