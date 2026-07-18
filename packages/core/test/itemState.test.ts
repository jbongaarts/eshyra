import { describe, expect, it } from 'vitest';
import type { RulesPack, RulesRecord } from '../src/internal.js';
import {
  createInitialItemState,
  getBundledDnd5eSrdPack,
  giveItem,
  isStatefulMagicItem,
  readItemState,
  readStateSnapshot,
  useItem,
  validateItemStateForRecord,
  writeItemState,
} from '../src/internal.js';
import { freshDbWithSession } from './support/db.js';

const MUTATION = {
  provenance: 'test:item-state',
  sessionId: 'session-1',
  at: '2026-07-18T12:00:00.000Z',
  characterId: 'pc-1',
};

function item(
  key: string,
  mechanics: Record<string, unknown>,
  requiresAttunement = false,
): RulesRecord {
  const bundled = getBundledDnd5eSrdPack();
  const exemplar = bundled.records.find(
    (record) => record.kind === 'magic-item',
  );
  if (exemplar === undefined) throw new Error('bundled pack has no magic item');
  return {
    ...exemplar,
    key: `magic-item:${key}`,
    name: key.replaceAll('-', ' '),
    data: {
      itemType: 'wondrous item',
      rarity: 'rare',
      requiresAttunement,
      description: 'Test fixture.',
      mechanics,
    },
  };
}

function pack(...records: RulesRecord[]): RulesPack {
  return { ...getBundledDnd5eSrdPack(), records };
}

function resolver(rulesPack: RulesPack) {
  return () => rulesPack;
}

function useInput(
  rulesPack: RulesPack,
  instanceId: string,
  operationId: string,
  args?: Readonly<Record<string, unknown>>,
) {
  return {
    campaignId: 'campaign-1',
    instanceId,
    operationId,
    ...(args === undefined ? {} : { args }),
    characterId: 'pc-1',
    resolveRulesPack: resolver(rulesPack),
    ...MUTATION,
  };
}

describe('magic-item live instance state', () => {
  it('initializes and plays Flame Tongue toggle state', () => {
    const db = freshDbWithSession();
    const flameTongue = item('flame-tongue-test', {
      operations: [{ id: 'toggle-flames' }, { id: 'extinguish-flames' }],
      stateMachine: {
        initial: 'inactive',
        states: [{ id: 'inactive' }, { id: 'active' }],
        transitions: [
          { from: 'inactive', to: 'active', via: 'toggle-flames' },
          { from: 'active', to: 'inactive', via: 'extinguish-flames' },
        ],
      },
    });
    const granted = giveItem(
      db,
      {
        id: 'ignored',
        name: 'Flame Tongue',
        packRef: flameTongue.key,
        stateful: true,
      },
      MUTATION,
    );
    const initial = createInitialItemState(flameTongue.key, flameTongue);
    expect(initial.machineState).toBe('inactive');
    writeItemState(db, granted.id, initial, MUTATION);

    expect(
      useItem(db, useInput(pack(flameTongue), granted.id, 'toggle-flames')),
    ).toMatchObject({
      transition: { from: 'inactive', to: 'active', outcome: 'success' },
      state: { machineState: 'active' },
    });
    expect(
      useItem(db, useInput(pack(flameTongue), granted.id, 'extinguish-flames')),
    ).toMatchObject({
      transition: { from: 'active', to: 'inactive', outcome: 'success' },
      state: { machineState: 'inactive' },
    });
    db.close();
  });

  it('advances Dancing Sword through its declared attack progression', () => {
    const db = freshDbWithSession();
    const dancingSword = item('dancing-sword-test', {
      operations: [{ id: 'launch-sword' }, { id: 'command-attack' }],
      stateMachine: {
        initial: 'held',
        states: [
          { id: 'held' },
          { id: 'attack-zero' },
          { id: 'attack-one' },
          { id: 'attack-two' },
          { id: 'attack-three' },
          { id: 'returning' },
        ],
        transitions: [
          { from: 'held', to: 'attack-zero', via: 'launch-sword' },
          { from: 'attack-zero', to: 'attack-one', via: 'command-attack' },
          { from: 'attack-one', to: 'attack-two', via: 'command-attack' },
          { from: 'attack-two', to: 'attack-three', via: 'command-attack' },
          { from: 'attack-three', to: 'returning', via: 'command-attack' },
        ],
      },
    });
    const granted = giveItem(
      db,
      {
        id: 'ignored',
        name: 'Dancing Sword',
        packRef: dancingSword.key,
        stateful: true,
      },
      MUTATION,
    );
    writeItemState(
      db,
      granted.id,
      createInitialItemState(dancingSword.key, dancingSword),
      MUTATION,
    );
    const rulesPack = pack(dancingSword);
    useItem(db, useInput(rulesPack, granted.id, 'launch-sword'));
    for (const expected of [
      'attack-one',
      'attack-two',
      'attack-three',
      'returning',
    ]) {
      expect(
        useItem(db, useInput(rulesPack, granted.id, 'command-attack')).state
          ?.machineState,
      ).toBe(expected);
    }
    db.close();
  });

  it('switches Cube faces and permits generic deactivation only when declared', () => {
    const db = freshDbWithSession();
    const cube = item('cube-force-test', {
      operations: [{ id: 'press-face-1' }, { id: 'press-face-2' }],
      stateMachine: {
        initial: 'inactive',
        states: [{ id: 'inactive' }, { id: 'face-1' }, { id: 'face-2' }],
        transitions: [
          { from: 'inactive', to: 'face-1', via: 'press-face-1' },
          { from: 'face-1', to: 'face-2', via: 'press-face-2' },
          { from: 'face-2', to: 'inactive', via: 'deactivate' },
        ],
        duration: { amount: 1, unit: 'minute' },
      },
    });
    const granted = giveItem(
      db,
      {
        id: 'ignored',
        name: 'Cube of Force',
        packRef: cube.key,
        stateful: true,
      },
      MUTATION,
    );
    writeItemState(
      db,
      granted.id,
      createInitialItemState(cube.key, cube),
      MUTATION,
    );
    const rulesPack = pack(cube);
    useItem(db, useInput(rulesPack, granted.id, 'press-face-1'));
    expect(
      useItem(db, useInput(rulesPack, granted.id, 'press-face-2')),
    ).toMatchObject({
      transition: {
        from: 'face-1',
        to: 'face-2',
        duration: { amount: 1, unit: 'minute' },
      },
    });
    expect(
      useItem(db, useInput(rulesPack, granted.id, 'deactivate')).state
        ?.machineState,
    ).toBe('inactive');
    expect(() =>
      useItem(db, useInput(rulesPack, granted.id, 'activate')),
    ).toThrow(/declares no operation 'activate'/);
    db.close();
  });

  it('requires explicit destinations for ambiguous transitions and rolls invalid uses back', () => {
    const db = freshDbWithSession();
    const modal = item('modal-test', {
      economies: { charges: { kind: 'charges', charges: { max: 2 } } },
      operations: [
        { id: 'choose-mode', cost: [{ economy: 'charges', amount: 1 }] },
      ],
      stateMachine: {
        initial: 'inactive',
        states: [{ id: 'inactive' }, { id: 'mode-a' }, { id: 'mode-b' }],
        transitions: [
          { from: 'inactive', to: 'mode-a', via: 'choose-mode' },
          { from: 'inactive', to: 'mode-b', via: 'choose-mode' },
        ],
      },
    });
    const granted = giveItem(
      db,
      {
        id: 'ignored',
        name: 'Modal Item',
        packRef: modal.key,
        stateful: true,
      },
      MUTATION,
    );
    writeItemState(
      db,
      granted.id,
      createInitialItemState(modal.key, modal),
      MUTATION,
    );
    const rulesPack = pack(modal);
    expect(() =>
      useItem(db, useInput(rulesPack, granted.id, 'choose-mode')),
    ).toThrow(/transitionTo is required/);
    expect(readItemState(db, granted.id)).toMatchObject({
      machineState: 'inactive',
      economies: { charges: { remaining: 2 } },
    });
    expect(
      useItem(
        db,
        useInput(rulesPack, granted.id, 'choose-mode', {
          transitionTo: 'mode-b',
        }),
      ).state,
    ).toMatchObject({
      machineState: 'mode-b',
      economies: { charges: { remaining: 1 } },
    });
    expect(() =>
      useItem(
        db,
        useInput(rulesPack, granted.id, 'choose-mode', {
          transitionTo: 'mode-a',
        }),
      ),
    ).toThrow(/invalid from machineState 'mode-b'/);
    expect(readItemState(db, granted.id)?.economies?.charges.remaining).toBe(1);
    db.close();
  });

  it('selects only declared failure destinations and returns retry/timer metadata', () => {
    const db = freshDbWithSession();
    const shackles = item('shackles-test', {
      operations: [{ id: 'escape-shackles' }, { id: 'bind' }],
      stateMachine: {
        initial: 'open',
        states: [{ id: 'open' }, { id: 'bound' }, { id: 'broken' }],
        transitions: [
          { from: 'open', to: 'bound', via: 'bind' },
          {
            from: 'bound',
            to: 'broken',
            via: 'escape-shackles',
            onFailure: {
              retryAfter: { amount: 30, unit: 'day' },
              scope: 'actor',
              to: 'bound',
            },
          },
          {
            from: 'broken',
            to: 'open',
            timer: { amount: 1, unit: 'hour' },
          },
        ],
      },
    });
    const granted = giveItem(
      db,
      {
        id: 'ignored',
        name: 'Shackles',
        packRef: shackles.key,
        stateful: true,
      },
      MUTATION,
    );
    writeItemState(
      db,
      granted.id,
      createInitialItemState(shackles.key, shackles),
      MUTATION,
    );
    const rulesPack = pack(shackles);
    useItem(db, useInput(rulesPack, granted.id, 'bind'));
    expect(
      useItem(
        db,
        useInput(rulesPack, granted.id, 'escape-shackles', {
          transitionOutcome: 'failure',
        }),
      ),
    ).toMatchObject({
      state: { machineState: 'bound' },
      transition: {
        from: 'bound',
        to: 'bound',
        outcome: 'failure',
        onFailure: {
          retryAfter: { amount: 30, unit: 'day' },
          scope: 'actor',
        },
      },
    });
    expect(
      useItem(db, useInput(rulesPack, granted.id, 'escape-shackles')),
    ).toMatchObject({
      state: { machineState: 'broken' },
      transition: {
        pendingTimers: [{ to: 'open', timer: { amount: 1, unit: 'hour' } }],
      },
    });
    db.close();
  });

  it('licenses stored spell identities only for a spell-storage contract', () => {
    const storedSpells = [
      {
        spellRef: 'spell:magic-missile',
        level: 1,
        saveDc: 13,
        attackMod: 5,
      },
    ];
    const ring = item('storage-contract', {
      spellStore: {
        contracts: [
          {
            id: 'stored-spells',
            kind: 'spell-storage',
            capacityLevels: 5,
            maximumSpellLevel: 5,
            casterOfRecord: 'original caster',
            storeOn: { cost: 'free' },
            castOut: { cost: 'spell-normal-casting-time' },
            operationIds: ['store-spell', 'cast-spell'],
          },
        ],
      },
    });
    expect(() =>
      validateItemStateForRecord(
        { packRef: ring.key, storedSpells },
        ring.key,
        ring,
      ),
    ).not.toThrow();

    const rod = item('energy-contract', {
      spellStore: {
        contracts: [
          {
            id: 'spell-energy',
            kind: 'spell-energy',
            capacityLevels: 50,
            lifetimeCapacityLevels: 50,
            maximumSpellLevel: 5,
            absorbOn: { cost: 'reaction' },
            castOut: { cost: 'spell-normal-casting-time' },
            operationIds: ['absorb', 'cast'],
            onExhausted: 'becomes nonmagical',
          },
        ],
      },
    });
    expect(() =>
      validateItemStateForRecord(
        { packRef: rod.key, storedSpells },
        rod.key,
        rod,
      ),
    ).toThrow(/spell-storage contract/);
  });

  it('accepts only a pack-declared card-pool custom state shape', () => {
    const record = item('declared-deck', {
      randomProcedure: {
        procedures: [
          {
            id: 'draw',
            kind: 'declared-draw',
            trigger: 'draw a card',
            selectionField: 'remainingCardIds',
            outcome: 'resolve it',
          },
        ],
        customState: {
          kind: 'card-pool',
          allowedCardIds: ['sun', 'fool', 'jester'],
          variants: [
            {
              id: 'three-card',
              initialCardIds: ['sun', 'fool', 'jester'],
            },
          ],
          remainingField: 'remainingCardIds',
          returnedField: 'returnedCardIds',
          nonReturningCardIds: ['fool', 'jester'],
        },
      },
    });
    const valid = {
      packRef: record.key,
      custom: {
        variantId: 'three-card',
        remainingCardIds: ['sun', 'fool'],
        returnedCardIds: ['sun'],
      },
    };
    expect(validateItemStateForRecord(valid, record.key, record)).toEqual(
      valid,
    );
    expect(() =>
      validateItemStateForRecord(
        {
          ...valid,
          custom: { ...valid.custom, arbitrary: true },
        },
        record.key,
        record,
      ),
    ).toThrow(/unsupported key/);
    expect(() =>
      validateItemStateForRecord(
        {
          ...valid,
          custom: {
            ...valid.custom,
            returnedCardIds: ['fool'],
          },
        },
        record.key,
        record,
      ),
    ).toThrow(/non-returning card/);
    expect(() =>
      validateItemStateForRecord(
        {
          ...valid,
          custom: {
            ...valid.custom,
            remainingCardIds: ['moon'],
            returnedCardIds: [],
          },
        },
        record.key,
        record,
      ),
    ).toThrow(/not declared/);
  });

  it('enforces singleton stateful grants and gives identical items independent state', () => {
    const db = freshDbWithSession();
    const record = item('wand-test', {
      economies: { charges: { kind: 'charges', charges: { max: 5 } } },
      operations: [{ id: 'blast', cost: [{ economy: 'charges', amount: 2 }] }],
    });
    expect(isStatefulMagicItem(record)).toBe(true);
    expect(() =>
      giveItem(
        db,
        {
          id: 'ignored',
          name: 'Wand',
          quantity: 2,
          packRef: record.key,
          stateful: true,
        },
        MUTATION,
      ),
    ).toThrow(/quantity 1/);

    const first = giveItem(
      db,
      { id: 'ignored', name: 'Wand', packRef: record.key, stateful: true },
      MUTATION,
    );
    const second = giveItem(
      db,
      { id: 'ignored', name: 'Wand', packRef: record.key, stateful: true },
      MUTATION,
    );
    expect(first.id).not.toBe(second.id);
    writeItemState(
      db,
      first.id,
      createInitialItemState(record.key, record),
      MUTATION,
    );
    writeItemState(
      db,
      second.id,
      createInitialItemState(record.key, record),
      MUTATION,
    );

    const rulesPack = pack(record);
    useItem(db, useInput(rulesPack, first.id, 'blast'));
    expect(readItemState(db, first.id)?.economies?.charges.remaining).toBe(3);
    expect(readItemState(db, second.id)?.economies?.charges.remaining).toBe(5);
    db.close();
  });

  it('rejects insufficient charges without changing state', () => {
    const db = freshDbWithSession();
    const record = item('charged-test', {
      economies: { charges: { kind: 'charges', charges: { max: 1 } } },
      operations: [{ id: 'burst', cost: [{ economy: 'charges', amount: 2 }] }],
    });
    const granted = giveItem(
      db,
      {
        id: 'ignored',
        name: 'Charged Test',
        packRef: record.key,
        stateful: true,
      },
      MUTATION,
    );
    writeItemState(
      db,
      granted.id,
      createInitialItemState(record.key, record),
      MUTATION,
    );

    expect(() =>
      useItem(db, useInput(pack(record), granted.id, 'burst')),
    ).toThrow(/insufficient charges/);
    expect(readItemState(db, granted.id)?.economies?.charges.remaining).toBe(1);
    db.close();
  });

  it('does not invent initial numeric state for a rolled duration budget', () => {
    const record = item('rolled-duration-test', {
      economies: {
        duration: {
          kind: 'budget',
          budget: {
            total: { amount: '1d8', unit: 'hour' },
            increment: { amount: 1, unit: 'minute' },
          },
        },
      },
    });
    expect(createInitialItemState(record.key, record)).toEqual({
      packRef: record.key,
    });
  });

  it('never transfers a pack-bound row to another character on an id collision', () => {
    const db = freshDbWithSession();
    const record = item('passive-test', { effects: [{ kind: 'test' }] });
    db.prepare(
      `INSERT INTO character(
         id, name, ability_scores_json, provenance, session_id, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?)`,
    ).run(
      'pc-2',
      'Second Hero',
      JSON.stringify({
        strength: 10,
        dexterity: 10,
        constitution: 10,
        intelligence: 10,
        wisdom: 10,
        charisma: 10,
      }),
      MUTATION.provenance,
      MUTATION.sessionId,
      MUTATION.at,
    );
    giveItem(
      db,
      { id: 'shared-id', name: 'Passive Test', packRef: record.key },
      MUTATION,
    );

    expect(() =>
      giveItem(
        db,
        { id: 'shared-id', name: 'Passive Test', packRef: record.key },
        { ...MUTATION, characterId: 'pc-2' },
      ),
    ).toThrow(/already belongs to another instance/);
    expect(
      db
        .prepare("SELECT character_id FROM inventory WHERE id='shared-id'")
        .get(),
    ).toEqual({ character_id: 'pc-1' });
    db.close();
  });

  it('consumes stateless single-use stacks and cascades state on deletion', () => {
    const db = freshDbWithSession();
    const potion = item('potion-test', {
      economies: { dose: { kind: 'single-use' } },
      operations: [{ id: 'drink', cost: [{ economy: 'dose', amount: 1 }] }],
    });
    giveItem(
      db,
      { id: 'potions', name: 'Potion', quantity: 2, packRef: potion.key },
      MUTATION,
    );
    const rulesPack = pack(potion);
    expect(useItem(db, useInput(rulesPack, 'potions', 'drink')).quantity).toBe(
      1,
    );
    expect(useItem(db, useInput(rulesPack, 'potions', 'drink')).consumed).toBe(
      true,
    );
    expect(
      db.prepare("SELECT 1 FROM inventory WHERE id='potions'").get(),
    ).toBeUndefined();

    const stateful = item('cascade-test', {}, true);
    const granted = giveItem(
      db,
      { id: 'ignored', name: 'Cascade', packRef: stateful.key, stateful: true },
      MUTATION,
    );
    writeItemState(
      db,
      granted.id,
      createInitialItemState(stateful.key, stateful),
      MUTATION,
    );
    db.prepare('DELETE FROM inventory WHERE id = ?').run(granted.id);
    expect(
      db
        .prepare('SELECT 1 FROM item_state WHERE inventory_id = ?')
        .get(granted.id),
    ).toBeUndefined();
    db.close();
  });

  it('exposes pack identity, instance id, and validated state in turn context', () => {
    const db = freshDbWithSession();
    const record = item('context-wand', {
      economies: { charges: { kind: 'charges', charges: { max: 7 } } },
      operations: [{ id: 'spark', cost: [{ economy: 'charges', amount: 1 }] }],
    });
    const granted = giveItem(
      db,
      {
        id: 'ignored',
        name: 'Context Wand',
        packRef: record.key,
        stateful: true,
      },
      MUTATION,
    );
    writeItemState(
      db,
      granted.id,
      createInitialItemState(record.key, record),
      MUTATION,
    );

    const snapshot = readStateSnapshot(db, 'pc-1', 'campaign-1');
    expect(snapshot.inventory[0]).toMatchObject({
      id: granted.id,
      packRef: record.key,
      state: { packRef: record.key, economies: { charges: { remaining: 7 } } },
    });
    db.close();
  });
});
