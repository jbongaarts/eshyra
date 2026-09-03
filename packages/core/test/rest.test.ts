import { describe, expect, it } from 'vitest';
import type {
  CharacterSheet,
  RulesPack,
  RulesRecord,
} from '../src/internal.js';
import {
  addCondition,
  advanceWorldTime,
  completeLongRest,
  completeShortRest,
  createActiveEffect,
  createDefaultToolRegistry,
  createInitialItemState,
  createSeededRng,
  createSqliteCharacterSheetStore,
  finishShortRestRecovery,
  getBundledDnd5eSrdPack,
  giveItem,
  grantTemporaryHp,
  mutateState,
  RestError,
  readHitDice,
  readItemState,
  readSpellSlots,
  spendRestHitDie,
  spendSpellSlot,
  spendUsage,
  stabilizeCharacter,
  startEncounter,
  syncSpellSlots,
  updateClock,
  useItem,
  writeItemState,
} from '../src/internal.js';
import {
  assembleContext,
  readStateSnapshot,
  renderContextMessage,
} from '../src/orchestrator/contextAssembler.js';
import { playerVisibleRollEntries } from '../src/orchestrator/playerVisibleRollLedger.js';
import type { ExecutedToolCall } from '../src/orchestrator/turnLoop.js';
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

function itemFixture(
  key: string,
  mechanics: Record<string, unknown>,
): RulesRecord {
  const exemplar = getBundledDnd5eSrdPack().records.find(
    (record) => record.kind === 'magic-item',
  );
  if (exemplar === undefined) throw new Error('bundled pack has no magic item');
  const operations =
    (mechanics.operations as { id: string }[] | undefined) ?? [];
  const economies = Object.keys(
    (mechanics.economies as Record<string, unknown> | undefined) ?? {},
  );
  return {
    ...exemplar,
    key: `magic-item:${key}`,
    name: key,
    data: {
      itemType: 'wondrous item',
      rarity: 'rare',
      requiresAttunement: false,
      description: 'rest fixture',
      mechanics,
      executionReadiness: {
        source: 'derived-magic-item-clauses-v1',
        clauses: [
          ...operations.map(({ id }) => ({
            clauseId: `fixture/operation:${id}`,
            scope: { kind: 'parent' },
            tag: 'M1',
            readiness: 'green',
            representation: { block: 'operations', operationId: id },
          })),
          ...economies.map((economyId) => ({
            clauseId: `fixture/economy:${economyId}`,
            scope: { kind: 'parent' },
            tag: 'M1',
            readiness: 'green',
            representation: { block: 'economies', economyId },
          })),
        ],
      },
    },
  };
}

function itemPack(records: readonly RulesRecord[]): RulesPack {
  return { ...getBundledDnd5eSrdPack(), records };
}

function installEmptyItem(
  db: ReturnType<typeof freshDbWithSession>,
  record: RulesRecord,
  characterId: string,
): string {
  const item = giveItem(
    db,
    {
      id: `instance-${record.key}`,
      name: record.name,
      packRef: record.key,
      stateful: true,
    },
    { ...CTX, characterId },
  );
  const state = createInitialItemState(record.key, record);
  writeItemState(
    db,
    item.id,
    {
      ...state,
      economies: Object.fromEntries(
        Object.entries(state.economies ?? {}).map(([economyId, economy]) => [
          economyId,
          { ...economy, remaining: 0 },
        ]),
      ),
    },
    CTX,
  );
  return item.id;
}

describe('F7 rest qualification boundary', () => {
  it('persists dawn clock evidence and participant rest resets together', () => {
    const db = setupCharacters();
    const dawn = itemFixture('rest-dawn', {
      economies: {
        charges: {
          kind: 'charges',
          charges: { max: 1 },
          reset: [{ at: 'dawn', amount: 'all' }],
        },
      },
    });
    const longRest = itemFixture('rest-long-budget', {
      economies: {
        budget: {
          kind: 'budget',
          budget: {
            total: { amount: 1, unit: 'day' },
            increment: { amount: 1, unit: 'day' },
          },
          reset: [{ at: 'long-rest', amount: 'all' }],
        },
      },
    });
    const perDay = itemFixture('rest-long-per-day', {
      economies: {
        uses: {
          kind: 'per-day',
          perDay: { uses: 1 },
          reset: [{ at: 'long-rest', amount: 'all' }],
        },
      },
    });
    const pack = itemPack([dawn, longRest, perDay]);
    const dawnId = installEmptyItem(db, dawn, 'pc-1');
    const longRestId = installEmptyItem(db, longRest, 'pc-1');
    const perDayId = installEmptyItem(db, perDay, 'pc-1');
    const nonParticipantId = installEmptyItem(db, perDay, 'pc-2');
    const result = completeLongRest(db, {
      ...CTX,
      restId: 'item-benefits-long-rest',
      participants: ['pc-1'],
      qualification: {
        durationMinutes: 480,
        sleepMinutes: 360,
        lightActivityMinutes: 0,
        strenuousInterruptionMinutes: 0,
        foodAndDrink: false,
      },
      resolveRulesPack: () => pack,
    }) as {
      itemResets: readonly { event: string; economy: string }[];
    };
    expect(result.itemResets).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ event: 'dawn', economy: 'charges' }),
        expect.objectContaining({ event: 'long-rest', economy: 'budget' }),
        expect.objectContaining({ event: 'long-rest', economy: 'uses' }),
      ]),
    );
    expect(readItemState(db, dawnId)?.economies?.charges.remaining).toBe(1);
    expect(readItemState(db, longRestId)?.economies?.budget.remaining).toBe(1);
    expect(readItemState(db, perDayId)?.economies?.uses.remaining).toBe(1);
    expect(readItemState(db, nonParticipantId)?.economies?.uses.remaining).toBe(
      0,
    );
    const persisted = db
      .prepare(
        "SELECT benefits_json FROM rest_event WHERE rest_id='item-benefits-long-rest'",
      )
      .get() as { benefits_json: string };
    expect(JSON.parse(persisted.benefits_json).itemResets).toEqual(
      result.itemResets,
    );
    db.close();
  });

  it('surfaces a timer resolved by short-rest time advancement', () => {
    const db = setupCharacters();
    const timer = itemFixture('rest-timer', {
      operations: [{ id: 'activate' }],
      stateMachine: {
        initial: 'inactive',
        states: [{ id: 'inactive' }, { id: 'active' }, { id: 'done' }],
        transitions: [
          { from: 'inactive', to: 'active', via: 'activate' },
          {
            from: 'active',
            to: 'done',
            timer: { amount: 1, unit: 'hour' },
          },
        ],
      },
    });
    const pack = itemPack([timer]);
    const itemId = installEmptyItem(db, timer, 'pc-1');
    useItem(db, {
      ...CTX,
      instanceId: itemId,
      operationId: 'activate',
      characterId: 'pc-1',
      resolveRulesPack: () => pack,
    });
    const result = completeShortRest(db, {
      ...CTX,
      restId: 'timer-short-rest',
      participants: ['pc-1'],
      qualification: { durationMinutes: 60, strenuousActivity: false },
      resolveRulesPack: () => pack,
    }) as {
      itemTimerResolutions: readonly { from: string; to: string }[];
    };
    expect(result.itemTimerResolutions).toMatchObject([
      { from: 'active', to: 'done' },
    ]);
    expect(readItemState(db, itemId)?.machineState).toBe('done');
    db.close();
  });

  it('publishes and persists stable recovery evidence when a short rest crosses its deadline', () => {
    const db = setupCharacters();
    mutateState(db, {
      target: 'character',
      id: 'pc-1',
      field: 'hp_current',
      op: 'set',
      value: 0,
      ...CTX,
    });
    mutateState(db, {
      target: 'character',
      id: 'pc-1',
      field: 'life_state',
      op: 'set',
      value: 'dying',
      ...CTX,
    });
    stabilizeCharacter(
      db,
      { ...CTX, characterId: 'pc-1' },
      createSeededRng(42),
    );

    const result = completeShortRest(db, {
      ...CTX,
      restId: 'stable-recovery-rest',
      participants: ['pc-1'],
      qualification: { durationMinutes: 240, strenuousActivity: false },
    }) as {
      stableRecoveries: readonly unknown[];
    };
    const persisted = db
      .prepare(
        "SELECT benefits_json FROM rest_event WHERE rest_id='stable-recovery-rest'",
      )
      .get() as { benefits_json: string };

    expect(result.stableRecoveries).toHaveLength(1);
    expect(JSON.parse(persisted.benefits_json).stableRecoveries).toEqual(
      result.stableRecoveries,
    );
    expect(
      db
        .prepare("SELECT hp_current, life_state FROM character WHERE id='pc-1'")
        .get(),
    ).toEqual({
      hp_current: 1,
      life_state: 'alive',
    });
    db.close();
  });

  it('keeps short-rest recovery open only until time or combat transitions', () => {
    const db = setupCharacters();
    completeShortRest(db, {
      ...CTX,
      restId: 'window-short',
      participants: ['pc-1', 'pc-2'],
      qualification: { durationMinutes: 60, strenuousActivity: false },
    });
    expect(
      db
        .prepare(
          'SELECT character_id, short_recovery_open FROM rest_participant WHERE rest_id=? ORDER BY character_id',
        )
        .all('window-short'),
    ).toEqual([
      { character_id: 'pc-1', short_recovery_open: 1 },
      { character_id: 'pc-2', short_recovery_open: 1 },
    ]);
    spendRestHitDie(db, {
      ...CTX,
      restId: 'window-short',
      characterId: 'pc-1',
      rng: createSeededRng(1),
    });
    finishShortRestRecovery(db, CTX.campaignId, 'window-short', 'pc-1', CTX);
    expect(() =>
      spendRestHitDie(db, {
        ...CTX,
        restId: 'window-short',
        characterId: 'pc-1',
        rng: createSeededRng(1),
      }),
    ).toThrow(/closed/);
    expect(() =>
      spendRestHitDie(db, {
        ...CTX,
        restId: 'window-short',
        characterId: 'pc-2',
        rng: createSeededRng(1),
      }),
    ).not.toThrow();
    db.close();
  });

  it('closes all older recovery windows on world-time advancement', () => {
    const db = setupCharacters();
    completeShortRest(db, {
      ...CTX,
      restId: 'window-timeout',
      participants: ['pc-1'],
      qualification: { durationMinutes: 60, strenuousActivity: false },
    });
    const result = advanceWorldTime(db, { ...CTX, minutes: 1 });
    expect(result.closedRecoveryWindows).toEqual([
      { restId: 'window-timeout', characterId: 'pc-1' },
    ]);
    expect(() =>
      spendRestHitDie(db, {
        ...CTX,
        restId: 'window-timeout',
        characterId: 'pc-1',
        rng: createSeededRng(1),
      }),
    ).toThrow(/closed/);
    db.close();
  });

  it('closes recovery before combat becomes active', () => {
    const db = setupCharacters();
    completeShortRest(db, {
      ...CTX,
      restId: 'window-combat',
      participants: ['pc-1'],
      qualification: { durationMinutes: 60, strenuousActivity: false },
    });
    startEncounter(db, {
      campaignId: CTX.campaignId,
      combatInstanceId: 'combat-window',
      provenance: CTX.provenance,
      sessionId: CTX.sessionId,
      at: CTX.at,
    });
    expect(
      db
        .prepare(
          'SELECT short_recovery_open FROM rest_participant WHERE rest_id=? AND character_id=?',
        )
        .get('window-combat', 'pc-1'),
    ).toEqual({ short_recovery_open: 0 });
    expect(() =>
      spendRestHitDie(db, {
        ...CTX,
        restId: 'window-combat',
        characterId: 'pc-1',
        rng: createSeededRng(1),
      }),
    ).toThrow(/closed/);
    db.close();
  });

  it('derives durable label freshness for advancement and update_clock', () => {
    const db = setupCharacters();
    const stale = advanceWorldTime(db, { ...CTX, minutes: 1 });
    expect(stale.narrativeLabelStale).toBe(true);
    expect(
      renderContextMessage(
        assembleContext({
          db,
          campaignId: CTX.campaignId,
          campaignPosition: 'test-position',
          sessionId: CTX.sessionId,
          playerInput: '',
          actingCharacterId: 'pc-1',
        }),
      ),
    ).toContain('narrative label unchanged/stale');
    updateClock(db, { locationId: 'tavern' }, CTX);
    expect(
      readStateSnapshot(db, 'pc-1', CTX.campaignId).clock.narrativeLabelStale,
    ).toBe(true);
    updateClock(db, { inGameTime: 'Day 1, noon' }, CTX);
    expect(
      readStateSnapshot(db, 'pc-1', CTX.campaignId).clock.narrativeLabelStale,
    ).toBe(false);
    const relabeled = advanceWorldTime(db, {
      ...CTX,
      minutes: 1,
      inGameTimeLabel: 'Day 1, afternoon',
    });
    expect(relabeled.narrativeLabelStale).toBe(false);
    db.close();
  });

  it('renders the real one-die Hit Die tool result with canonical Constitution', () => {
    const db = setupCharacters();
    completeShortRest(db, {
      ...CTX,
      restId: 'ledger-short',
      participants: ['pc-1'],
      qualification: { durationMinutes: 60, strenuousActivity: false },
    });
    const result = createDefaultToolRegistry()
      .get('spend_rest_hit_die')
      ?.run(
        { restId: 'ledger-short' },
        {
          db,
          rng: createSeededRng(2),
          campaignId: CTX.campaignId,
          sessionId: CTX.sessionId,
          turnId: 'ledger-turn',
          at: CTX.at,
          actingCharacterId: 'pc-1',
        },
      );
    expect(result?.ok).toBe(true);
    const call = {
      tool: 'spend_rest_hit_die',
      args: { restId: 'ledger-short' },
      result,
      mutates: true,
      source: 'native',
    } as ExecutedToolCall;
    const entries = playerVisibleRollEntries([call]);
    expect(entries[0]?.detail).toContain('+ 2 CON');
    expect(entries[0]?.detail).toContain('recoverable');
    db.close();
  });

  it('renders real Hit Die clamp and maximum-HP cap evidence', () => {
    const db = setupCharacters();
    const base = sheet('class:warlock');
    const negative = {
      ...base,
      abilityScores: {
        ...base.abilityScores,
        constitution: { base: 8, final: 8, modifier: -2 },
      },
    } as CharacterSheet;
    createSqliteCharacterSheetStore(db).save('pc-1', negative);
    completeShortRest(db, {
      ...CTX,
      restId: 'ledger-clamp',
      participants: ['pc-1'],
      qualification: { durationMinutes: 60, strenuousActivity: false },
    });
    const clampResult = createDefaultToolRegistry()
      .get('spend_rest_hit_die')
      ?.run(
        { restId: 'ledger-clamp' },
        {
          db,
          rng: { nextInt: () => 0 },
          campaignId: CTX.campaignId,
          sessionId: CTX.sessionId,
          turnId: 'ledger-clamp-turn',
          at: CTX.at,
          actingCharacterId: 'pc-1',
        },
      );
    const clampEntry = playerVisibleRollEntries([
      {
        tool: 'spend_rest_hit_die',
        args: { restId: 'ledger-clamp' },
        result: clampResult,
        mutates: true,
        source: 'native',
      } as ExecutedToolCall,
    ])[0];
    expect(clampEntry?.detail).toContain('minimum 0 clamp');

    const capDb = setupCharacters();
    mutateState(capDb, {
      target: 'character',
      id: 'pc-1',
      field: 'hp_current',
      op: 'set',
      value: 19,
      ...CTX,
    });
    completeShortRest(capDb, {
      ...CTX,
      restId: 'ledger-cap',
      participants: ['pc-1'],
      qualification: { durationMinutes: 60, strenuousActivity: false },
    });
    const capResult = createDefaultToolRegistry()
      .get('spend_rest_hit_die')
      ?.run(
        { restId: 'ledger-cap' },
        {
          db: capDb,
          rng: { nextInt: () => 7 },
          campaignId: CTX.campaignId,
          sessionId: CTX.sessionId,
          turnId: 'ledger-cap-turn',
          at: CTX.at,
          actingCharacterId: 'pc-1',
        },
      );
    const capEntry = playerVisibleRollEntries([
      {
        tool: 'spend_rest_hit_die',
        args: { restId: 'ledger-cap' },
        result: capResult,
        mutates: true,
        source: 'native',
      } as ExecutedToolCall,
    ])[0];
    expect(capEntry?.detail).toContain('HP maximum cap');
    capDb.close();
    db.close();
  });

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
        strenuousActivity: false,
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
    finishShortRestRecovery(db, CTX.campaignId, 'short-group', 'pc-1', CTX);
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

  it('returns elapsed-world effects expired during a short rest', () => {
    const db = setupCharacters();
    createActiveEffect(db, {
      campaignId: CTX.campaignId,
      effectId: 'rest-expiring-effect',
      kind: 'condition-package',
      displayName: 'Rest expiring effect',
      source: { kind: 'ruling' },
      duration: {
        kind: 'timed',
        amount: 1,
        unit: 'hour',
        anchor: 'effect-created',
      },
      ...CTX,
    });
    const result = completeShortRest(db, {
      ...CTX,
      restId: 'rest-expiry-result',
      participants: ['pc-1'],
      qualification: { durationMinutes: 60, strenuousActivity: false },
    }) as {
      expiredEffects: Array<{
        effectId: string;
        deadlineElapsedMinutes: number;
      }>;
    };
    expect(result.expiredEffects).toEqual([
      expect.objectContaining({
        effectId: 'rest-expiring-effect',
        deadlineElapsedMinutes: 60,
      }),
    ]);
    db.close();
  });

  it('rolls back clock, effect cleanup, rest state, resources, and conditions on a late failure', () => {
    const db = setupCharacters();
    syncSpellSlots(db, { ...CTX, characterId: 'pc-1' });
    spendSpellSlot(db, { ...CTX, characterId: 'pc-1', spellLevel: 1 });
    spendUsage(db, {
      ...CTX,
      owner: { kind: 'character', ref: 'pc-1' },
      ability: 'Second Wind',
      declared: { maxUses: 1, reset: 'short_rest' },
    });
    addCondition(
      db,
      { id: 'exhaustion', level: 2 },
      { ...CTX, characterId: 'pc-1' },
    );
    grantTemporaryHp(db, 5, { ...CTX, characterId: 'pc-1' });
    completeShortRest(db, {
      ...CTX,
      restId: 'rollback-short',
      participants: ['pc-1'],
      qualification: { durationMinutes: 60, strenuousActivity: false },
    });
    spendRestHitDie(db, {
      ...CTX,
      restId: 'rollback-short',
      characterId: 'pc-1',
      rng: createSeededRng(1),
    });
    finishShortRestRecovery(db, CTX.campaignId, 'rollback-short', 'pc-1', CTX);
    createActiveEffect(db, {
      campaignId: CTX.campaignId,
      effectId: 'rollback-effect',
      kind: 'condition-package',
      displayName: 'Rollback effect',
      source: { kind: 'ruling' },
      duration: {
        kind: 'timed',
        amount: 8,
        unit: 'hour',
        anchor: 'effect-created',
      },
      targets: [{ kind: 'character', ref: 'pc-1' }],
      ...CTX,
    });
    db.prepare(
      'UPDATE character SET conditions_json=\'[{"id":"exhaustion","level":0}]\' WHERE id=\'pc-1\'',
    ).run();
    const snapshot = (table: string, where = '') =>
      db.prepare(`SELECT * FROM ${table} ${where}`).all();
    const before = {
      clock: snapshot('clock'),
      effects: snapshot('active_effect'),
      targets: snapshot('active_effect_target'),
      links: snapshot('active_effect_link'),
      events: snapshot('active_effect_event'),
      rests: snapshot('rest_event'),
      participants: snapshot('rest_participant'),
      character: snapshot('character', "WHERE id='pc-1'"),
      slots: snapshot('character_spell_slot'),
      usage: snapshot('entity_usage_counter'),
      hitDice: snapshot('character_hit_dice'),
    };
    expect(() =>
      completeLongRest(db, {
        ...CTX,
        restId: 'rollback-long',
        participants: ['pc-1'],
        qualification: {
          durationMinutes: 480,
          sleepMinutes: 360,
          lightActivityMinutes: 0,
          strenuousInterruptionMinutes: 0,
          foodAndDrink: true,
        },
      }),
    ).toThrow(/malformed exhaustion/);
    expect({
      clock: snapshot('clock'),
      effects: snapshot('active_effect'),
      targets: snapshot('active_effect_target'),
      links: snapshot('active_effect_link'),
      events: snapshot('active_effect_event'),
      rests: snapshot('rest_event'),
      participants: snapshot('rest_participant'),
      character: snapshot('character', "WHERE id='pc-1'"),
      slots: snapshot('character_spell_slot'),
      usage: snapshot('entity_usage_counter'),
      hitDice: snapshot('character_hit_dice'),
    }).toEqual(before);
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
        strenuousActivity: false,
      },
    });
    spendRestHitDie(db, {
      ...CTX,
      campaignId: CTX.campaignId,
      restId: 'short-before-long',
      characterId: 'pc-1',
      rng: createSeededRng(2),
    });
    finishShortRestRecovery(
      db,
      CTX.campaignId,
      'short-before-long',
      'pc-1',
      CTX,
    );
    completeLongRest(db, {
      ...CTX,
      restId: 'long-1',
      participants: ['pc-1'],
      qualification: {
        durationMinutes: 480,
        sleepMinutes: 360,
        lightActivityMinutes: 120,
        strenuousInterruptionMinutes: 0,
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
      strenuousActivity: false,
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
        strenuousActivity: false,
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
          foodAndDrink: false,
        },
      }),
    ).not.toThrow();
    db.close();
  });

  it('compares long-rest benefits at 1,439 and 1,440 elapsed minutes', () => {
    const db = setupCharacters();
    const qualification = {
      durationMinutes: 480,
      sleepMinutes: 360,
      lightActivityMinutes: 0,
      strenuousInterruptionMinutes: 0,
      foodAndDrink: false,
    };
    completeLongRest(db, {
      ...CTX,
      restId: 'benefit-a',
      participants: ['pc-1'],
      qualification,
    });
    advanceWorldTime(db, { ...CTX, minutes: 959 });
    expect(() =>
      completeLongRest(db, {
        ...CTX,
        restId: 'benefit-too-soon',
        participants: ['pc-1'],
        qualification,
      }),
    ).toThrow(/within 24/);
    advanceWorldTime(db, { ...CTX, minutes: 1 });
    expect(() =>
      completeLongRest(db, {
        ...CTX,
        restId: 'benefit-exact',
        participants: ['pc-1'],
        qualification,
      }),
    ).not.toThrow();
    db.close();

    const scoped = setupCharacters();
    completeLongRest(scoped, {
      ...CTX,
      restId: 'benefit-scoped-a',
      participants: ['pc-1'],
      qualification,
    });
    advanceWorldTime(scoped, { ...CTX, minutes: 959 });
    expect(() =>
      completeLongRest(scoped, {
        ...CTX,
        restId: 'benefit-scoped-both',
        participants: ['pc-1', 'pc-2'],
        qualification,
      }),
    ).toThrow(/within 24/);
    expect(() =>
      completeLongRest(scoped, {
        ...CTX,
        restId: 'benefit-scoped-only-b',
        participants: ['pc-2'],
        qualification,
      }),
    ).not.toThrow();
    scoped.close();
  });

  it('makes the rest narrative label part of immutable rest-id delivery', () => {
    const db = setupCharacters();
    const qualification = { durationMinutes: 60, strenuousActivity: false };
    completeShortRest(db, {
      ...CTX,
      restId: 'label-same',
      participants: ['pc-1'],
      qualification,
      inGameTimeLabel: 'Day 1, noon',
    });
    expect(() =>
      completeShortRest(db, {
        ...CTX,
        restId: 'label-same',
        participants: ['pc-1'],
        qualification,
        inGameTimeLabel: 'Day 1, noon',
      }),
    ).not.toThrow();
    expect(() =>
      completeShortRest(db, {
        ...CTX,
        restId: 'label-same',
        participants: ['pc-1'],
        qualification,
        inGameTimeLabel: 'Day 1, afternoon',
      }),
    ).toThrow(/reuse/);
    const omitted = setupCharacters();
    completeShortRest(omitted, {
      ...CTX,
      restId: 'label-omitted',
      participants: ['pc-1'],
      qualification,
    });
    expect(() =>
      completeShortRest(omitted, {
        ...CTX,
        restId: 'label-omitted',
        participants: ['pc-1'],
        qualification,
      }),
    ).not.toThrow();
    expect(() =>
      completeShortRest(omitted, {
        ...CTX,
        restId: 'label-omitted',
        participants: ['pc-1'],
        qualification,
        inGameTimeLabel: 'Day 1, noon',
      }),
    ).toThrow(/reuse/);
    omitted.close();
    db.close();
  });

  it('reports final Hit Dice after a level-four long-rest restoration', () => {
    const db = setupCharacters();
    const store = createSqliteCharacterSheetStore(db);
    store.save('pc-1', sheet('class:warlock', 4));
    mutateState(db, {
      target: 'character',
      id: 'pc-1',
      field: 'level',
      op: 'set',
      value: 4,
      ...CTX,
    });
    const pool = readHitDice(db, 'pc-1', CTX);
    db.prepare(
      'UPDATE character_hit_dice SET dice_used=4 WHERE character_id=?',
    ).run('pc-1');
    const result = completeLongRest(db, {
      ...CTX,
      restId: 'level-four-long',
      participants: ['pc-1'],
      qualification: {
        durationMinutes: 480,
        sleepMinutes: 360,
        lightActivityMinutes: 0,
        strenuousInterruptionMinutes: 0,
        foodAndDrink: false,
      },
    }) as { recovery?: unknown; hitDiceRestored: Record<string, unknown> };
    expect(pool.diceMaximum).toBe(4);
    expect(readHitDice(db, 'pc-1', CTX).diceRemaining).toBe(2);
    expect(result.hitDiceRestored['pc-1']).toMatchObject({
      restored: 2,
      remainingHitDice: 2,
    });
    expect(result.recovery).toEqual({});
    db.close();
  });

  it('does not reduce exhaustion when a long rest lacks food and drink', () => {
    const db = setupCharacters();
    addCondition(
      db,
      { id: 'exhaustion', level: 2 },
      { ...CTX, characterId: 'pc-1' },
    );
    completeLongRest(db, {
      ...CTX,
      restId: 'no-food-long',
      participants: ['pc-1'],
      qualification: {
        durationMinutes: 480,
        sleepMinutes: 360,
        lightActivityMinutes: 0,
        strenuousInterruptionMinutes: 0,
        foodAndDrink: false,
      },
    });
    expect(
      db.prepare("SELECT conditions_json FROM character WHERE id='pc-1'").get(),
    ).toEqual({
      conditions_json: '[{"id":"exhaustion","level":2}]',
    });
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
        'strenuousInterruptionMinutes',
      ].sort(),
    );
    expect(qualification.additionalProperties).toBe(false);
  });
});
