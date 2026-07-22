import { describe, expect, it } from 'vitest';
import type { RulesPack, RulesRecord } from '../src/internal.js';
import {
  createInitialItemState,
  createSeededRng,
  effectiveMagicItemMechanics,
  getBundledDnd5eSrdPack,
  giveItem,
  ItemStateAmbiguityError,
  isStatefulMagicItem,
  magicItemVariantDefinitions,
  parseDice,
  readItemState,
  readStateSnapshot,
  useItem,
  validateItemStateForRecord,
  withTransaction,
  writeItemState,
} from '../src/internal.js';
import { assertMagicItemOperationReady } from '../src/state/itemExecutionReadiness.js';
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
      executionReadiness: {
        source: 'derived-magic-item-clauses-v1',
        clauses: [
          ...((mechanics.operations as { id: string }[] | undefined) ?? []).map(
            ({ id }) => ({
              clauseId: `test/operation:${id}`,
              scope: { kind: 'parent' },
              tag: 'M1',
              readiness: 'green',
              representation: { block: 'operations', operationId: id },
            }),
          ),
          ...Object.keys(
            (mechanics.economies as Record<string, unknown> | undefined) ?? {},
          ).map((economyId) => ({
            clauseId: `test/economy:${economyId}`,
            scope: { kind: 'parent' },
            tag: 'M1',
            readiness: 'green',
            representation: { block: 'economies', economyId },
          })),
          ...((mechanics.effects as { id?: string }[] | undefined) ?? [])
            .filter((effect): effect is { id: string } => Boolean(effect.id))
            .map(({ id }) => ({
              clauseId: `test/effect:${id}`,
              scope: { kind: 'parent' },
              tag: 'M1',
              readiness: 'green',
              representation: { block: 'effects', effectId: id },
            })),
          ...(mechanics.stateMachine === undefined
            ? []
            : [
                {
                  clauseId: 'test/state-machine',
                  scope: { kind: 'parent' },
                  tag: 'M1',
                  readiness: 'green',
                  representation: { block: 'stateMachine' },
                },
              ]),
        ],
      },
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
          {
            from: 'active',
            to: 'inactive',
            timer: { amount: 10, unit: 'minute' },
          },
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
      state: {
        machineState: 'active',
        pendingTimers: [
          { anchorElapsedMinutes: 0, deadlineElapsedMinutes: 10 },
        ],
      },
    });
    expect(
      useItem(db, useInput(pack(flameTongue), granted.id, 'extinguish-flames')),
    ).toMatchObject({
      transition: { from: 'active', to: 'inactive', outcome: 'success' },
      state: { machineState: 'inactive', pendingTimers: [] },
    });
    db.prepare('UPDATE clock SET elapsed_minutes=5 WHERE id=1').run();
    expect(
      useItem(db, useInput(pack(flameTongue), granted.id, 'toggle-flames')),
    ).toMatchObject({
      state: {
        machineState: 'active',
        pendingTimers: [
          { anchorElapsedMinutes: 5, deadlineElapsedMinutes: 15 },
        ],
      },
    });
    db.close();
  });

  it('preserves, resets, and re-anchors timed state through useItem', () => {
    const db = freshDbWithSession();
    const barrier = item('timed-barrier-test', {
      operations: [
        { id: 'enter-barrier' },
        { id: 'contact-barrier' },
        { id: 'reset-barrier' },
        { id: 'change-barrier' },
      ],
      stateMachine: {
        initial: 'inactive',
        states: [
          { id: 'inactive' },
          { id: 'barrier' },
          { id: 'other-barrier' },
          { id: 'expired' },
          { id: 'other-expired' },
        ],
        transitions: [
          { from: 'inactive', to: 'barrier', via: 'enter-barrier' },
          { from: 'barrier', to: 'barrier', via: 'contact-barrier' },
          {
            from: 'barrier',
            to: 'barrier',
            via: 'reset-barrier',
            resetsDuration: true,
          },
          { from: 'barrier', to: 'other-barrier', via: 'change-barrier' },
          {
            from: 'barrier',
            to: 'expired',
            timer: { amount: 10, unit: 'minute' },
          },
          {
            from: 'other-barrier',
            to: 'other-expired',
            timer: { amount: 10, unit: 'minute' },
          },
        ],
      },
    });
    const granted = giveItem(
      db,
      {
        id: 'ignored',
        name: 'Timed Barrier',
        packRef: barrier.key,
        stateful: true,
      },
      MUTATION,
    );
    writeItemState(
      db,
      granted.id,
      createInitialItemState(barrier.key, barrier),
      MUTATION,
    );
    const rulesPack = pack(barrier);

    expect(
      useItem(db, useInput(rulesPack, granted.id, 'enter-barrier')).state,
    ).toMatchObject({
      machineState: 'barrier',
      pendingTimers: [{ anchorElapsedMinutes: 0, deadlineElapsedMinutes: 10 }],
    });
    expect(readItemState(db, granted.id)).toMatchObject({
      machineState: 'barrier',
      pendingTimers: [{ anchorElapsedMinutes: 0, deadlineElapsedMinutes: 10 }],
    });

    db.prepare('UPDATE clock SET elapsed_minutes=5 WHERE id=1').run();
    expect(
      useItem(db, useInput(rulesPack, granted.id, 'contact-barrier')).state,
    ).toMatchObject({
      machineState: 'barrier',
      pendingTimers: [{ anchorElapsedMinutes: 0, deadlineElapsedMinutes: 10 }],
    });
    expect(readItemState(db, granted.id)?.pendingTimers).toMatchObject([
      { anchorElapsedMinutes: 0, deadlineElapsedMinutes: 10 },
    ]);

    db.prepare('UPDATE clock SET elapsed_minutes=7 WHERE id=1').run();
    expect(
      useItem(db, useInput(rulesPack, granted.id, 'reset-barrier')).state,
    ).toMatchObject({
      machineState: 'barrier',
      pendingTimers: [{ anchorElapsedMinutes: 7, deadlineElapsedMinutes: 17 }],
    });
    expect(readItemState(db, granted.id)).toMatchObject({
      machineState: 'barrier',
      pendingTimers: [{ anchorElapsedMinutes: 7, deadlineElapsedMinutes: 17 }],
    });

    db.prepare('UPDATE clock SET elapsed_minutes=9 WHERE id=1').run();
    expect(
      useItem(db, useInput(rulesPack, granted.id, 'change-barrier')).state,
    ).toMatchObject({
      machineState: 'other-barrier',
      pendingTimers: [{ anchorElapsedMinutes: 9, deadlineElapsedMinutes: 19 }],
    });
    expect(readItemState(db, granted.id)).toMatchObject({
      machineState: 'other-barrier',
      pendingTimers: [{ anchorElapsedMinutes: 9, deadlineElapsedMinutes: 19 }],
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

  it('fails closed before mutation on unresolved ambiguity-gated resets', () => {
    const db = freshDbWithSession();
    const gated = item('ambiguity-gated-timer', {
      economies: {
        charges: { kind: 'charges', charges: { max: 2 } },
      },
      operations: [
        { id: 'enter' },
        { id: 'restate', cost: [{ economy: 'charges', amount: 1 }] },
      ],
      ambiguities: [
        {
          id: 'ambiguity:test-reset',
          question: 'which reading applies?',
          source: [{ locator: 'p. 1, clause', clauseId: 'source-clause' }],
          affects: ['active -> active via restate'],
          interpretations: [
            { id: 'first-reading', summary: 'The first reading.' },
            { id: 'second-reading', summary: 'The second reading.' },
          ],
          canonicalResolution: null,
          runtimeDisposition: {
            status: 'engine-pending',
            owner: 'campaign-ruling',
          },
        },
      ],
      stateMachine: {
        initial: 'inactive',
        states: [{ id: 'inactive' }, { id: 'active' }, { id: 'expired' }],
        transitions: [
          { from: 'inactive', to: 'active', via: 'enter' },
          {
            from: 'active',
            to: 'active',
            via: 'restate',
            resetsDuration: {
              kind: 'source-ambiguity',
              ambiguityId: 'ambiguity:test-reset',
            },
          },
          {
            from: 'active',
            to: 'expired',
            timer: { amount: 1, unit: 'minute' },
          },
        ],
      },
    });
    const granted = giveItem(
      db,
      {
        id: 'ignored',
        name: 'Ambiguity Gated Timer',
        packRef: gated.key,
        stateful: true,
      },
      MUTATION,
    );
    writeItemState(
      db,
      granted.id,
      createInitialItemState(gated.key, gated),
      MUTATION,
    );
    const rulesPack = pack(gated);
    useItem(db, useInput(rulesPack, granted.id, 'enter'));
    const before = readItemState(db, granted.id);
    let thrown: unknown;
    try {
      useItem(db, useInput(rulesPack, granted.id, 'restate'));
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(ItemStateAmbiguityError);
    expect(thrown).toMatchObject({
      ambiguityId: 'ambiguity:test-reset',
      question: 'which reading applies?',
      interpretationIds: ['first-reading', 'second-reading'],
      owner: 'campaign-ruling',
    });
    expect(String(thrown)).toMatch(/magic-item:ambiguity-gated-timer.*restate/);
    expect(readItemState(db, granted.id)).toEqual(before);
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

  it('selects a card-pool variant from its declared percentage and audits the d100', () => {
    const record = item('random-deck', {
      randomProcedure: {
        procedures: [
          {
            id: 'initial-deck',
            kind: 'initial-state',
            trigger: 'deck is found',
            risk: { percent: 75 },
            outcome:
              '75 percent initializes the short deck variant; otherwise initialize the full deck variant',
          },
        ],
        customState: {
          kind: 'card-pool',
          allowedCardIds: ['sun', 'moon'],
          variants: [
            { id: 'short-deck', initialCardIds: ['sun'] },
            { id: 'full-deck', initialCardIds: ['sun', 'moon'] },
          ],
          remainingField: 'remainingCardIds',
          returnedField: 'returnedCardIds',
          nonReturningCardIds: [],
        },
      },
    });
    expect(() => createInitialItemState(record.key, record)).toThrow(
      /seeded RNG is required/,
    );
    const low = createInitialItemState(record.key, record, {
      rng: { nextInt: () => 0 },
    });
    expect(low.custom).toEqual({
      variantId: 'short-deck',
      remainingCardIds: ['sun'],
      returnedCardIds: [],
    });
    expect(low.initializationRolls).toEqual([
      {
        purpose: 'randomProcedure:initial-deck',
        notation: '1d100',
        rolls: [1],
        total: 1,
      },
    ]);
    expect(
      createInitialItemState(record.key, record, {
        rng: { nextInt: () => 99 },
      }).custom,
    ).toMatchObject({ variantId: 'full-deck' });
  });

  it('materializes every reviewed table-backed initial-state shape semantically', () => {
    const bundled = getBundledDnd5eSrdPack();
    const byKey = new Map(
      bundled.records.map((record) => [record.key, record]),
    );
    const named = (key: string) => {
      const record = byKey.get(`magic-item:${key}`);
      if (record === undefined) throw new Error(`missing ${key}`);
      return record;
    };
    const options = (nextInt: (maximum: number) => number) => ({
      rng: { nextInt },
      resolveTable: (ref: string) => byKey.get(ref),
    });

    const illusions = createInitialItemState(
      'magic-item:deck-of-illusions',
      named('deck-of-illusions'),
      options((maximum) => maximum - 1),
    );
    const illusionPool =
      illusions.randomInitialization?.['initial-missing-cards'];
    expect(illusionPool).toMatchObject({
      kind: 'table-pool',
      tableRef: 'table:deck-of-illusions',
    });
    if (illusionPool?.kind !== 'table-pool')
      throw new Error('missing illusion pool');
    expect(illusionPool.removedEntryIds).toHaveLength(19);
    expect(illusionPool.remainingEntryIds).toHaveLength(15);
    expect(illusions.economies?.cards.remaining).toBe(15);

    const emptyFlask = createInitialItemState(
      'magic-item:iron-flask',
      named('iron-flask'),
      options(() => 0),
    ).randomInitialization?.['initial-creature'];
    expect(emptyFlask).toEqual({
      kind: 'containment-occupant',
      tableRef: 'table:iron-flask',
      occupant: null,
    });
    const occupiedFlaskState = createInitialItemState(
      'magic-item:iron-flask',
      named('iron-flask'),
      options((maximum) => maximum - 1),
    );
    const occupiedFlask =
      occupiedFlaskState.randomInitialization?.['initial-creature'];
    expect(occupiedFlask).toMatchObject({
      kind: 'containment-occupant',
      occupant: { roll: 100, outcome: ['Xorn'] },
    });
    expect(() =>
      validateItemStateForRecord(
        {
          ...occupiedFlaskState,
          randomInitialization: {
            'initial-creature': {
              kind: 'containment-occupant',
              tableRef: 'table:iron-flask',
              occupant: { roll: 100, rowIndex: 0, outcome: ['Empty'] },
            },
          },
        },
        'magic-item:iron-flask',
        named('iron-flask'),
        undefined,
        { resolveTable: (ref) => byKey.get(ref) },
      ),
    ).toThrow(/does not match/);

    const necklace = createInitialItemState(
      'magic-item:necklace-of-prayer-beads',
      named('necklace-of-prayer-beads'),
      options(() => 0),
    );
    const beads = necklace.randomInitialization?.['initial-bead-types'];
    expect(necklace.economies?.beads.remaining).toBe(3);
    expect(beads).toMatchObject({ kind: 'table-results' });
    if (beads?.kind !== 'table-results') throw new Error('missing bead types');
    expect(beads.results).toHaveLength(3);
    expect(
      beads.results.every(({ outcome }) => outcome[0] === 'Blessing'),
    ).toBe(true);

    const robe = createInitialItemState(
      'magic-item:robe-of-useful-items',
      named('robe-of-useful-items'),
      options(() => 0),
    );
    const patches = robe.randomInitialization?.['initial-extra-patches'];
    expect(robe.economies?.patches.remaining).toBe(16);
    expect(patches).toMatchObject({ kind: 'table-results' });
    if (patches?.kind !== 'table-results')
      throw new Error('missing useful-item patches');
    expect(patches.results).toHaveLength(4);
    expect(
      patches.results.every(({ outcome }) => outcome[0] === 'Bag of 100 gp'),
    ).toBe(true);
  });

  it('fails closed when an initial-state declaration has no typed owner', () => {
    const unowned = item('unowned-initial-state', {
      randomProcedure: {
        procedures: [
          {
            id: 'mystery',
            kind: 'initial-state',
            trigger: 'instance is discovered',
            roll: '1d6',
            outcome: 'initialize an undeclared mystery',
          },
        ],
      },
    });
    expect(() =>
      createInitialItemState(unowned.key, unowned, {
        rng: createSeededRng(1),
      }),
    ).toThrow(/no deterministic initialization owner|not bound/);
    expect(isStatefulMagicItem(unowned)).toBe(true);

    const db = freshDbWithSession();
    expect(() =>
      withTransaction(db, (txnDb) => {
        const granted = giveItem(
          txnDb,
          {
            id: 'unowned',
            name: 'Unowned Initial State',
            packRef: unowned.key,
            stateful: true,
          },
          MUTATION,
        );
        const state = createInitialItemState(unowned.key, unowned, {
          rng: createSeededRng(1),
        });
        writeItemState(txnDb, granted.id, state, MUTATION);
      }),
    ).toThrow(/no deterministic initialization owner|not bound/);
    expect(
      db
        .prepare("SELECT 1 FROM inventory WHERE name='Unowned Initial State'")
        .get(),
    ).toBeUndefined();
    db.close();
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

  it('requires seeded initialization and persists exact rolled duration evidence', () => {
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
    expect(() => createInitialItemState(record.key, record)).toThrow(
      /seeded RNG is required/,
    );
    const initialized = createInitialItemState(record.key, record, {
      rng: createSeededRng(42),
    });
    expect(initialized.economies?.duration.remaining).toBeGreaterThanOrEqual(
      60,
    );
    expect(initialized.economies?.duration.remaining).toBeLessThanOrEqual(480);
    expect(initialized.initializationRolls).toEqual([
      expect.objectContaining({
        purpose: 'economy:duration:budget.total',
        notation: '1d8',
        total: (initialized.economies?.duration.remaining ?? 0) / 60,
      }),
    ]);
  });

  it('accounts for every bundled duration budget in its declared increment units', () => {
    const bundled = getBundledDnd5eSrdPack();
    const expected = new Map<string, { economyId: string; remaining: number }>([
      ['magic-item:boots-of-speed', { economyId: 'speed', remaining: 100 }],
      [
        'magic-item:candle-of-invocation',
        { economyId: 'burn-time', remaining: 240 },
      ],
      [
        'magic-item:manual-of-bodily-health',
        { economyId: 'study', remaining: 48 },
      ],
      [
        'magic-item:manual-of-gainful-exercise',
        { economyId: 'study', remaining: 48 },
      ],
      [
        'magic-item:manual-of-quickness-of-action',
        { economyId: 'study', remaining: 48 },
      ],
      [
        'magic-item:tome-of-clear-thought',
        { economyId: 'study', remaining: 48 },
      ],
      [
        'magic-item:tome-of-leadership-and-influence',
        { economyId: 'study', remaining: 48 },
      ],
      [
        'magic-item:tome-of-understanding',
        { economyId: 'study', remaining: 48 },
      ],
      ['magic-item:winged-boots', { economyId: 'flight', remaining: 240 }],
    ]);
    const budgetRecords = bundled.records.filter((record) => {
      if (record.kind !== 'magic-item') return false;
      const mechanics = (record.data as Record<string, unknown>).mechanics as
        | { economies?: Record<string, { kind?: string }> }
        | undefined;
      return Object.values(mechanics?.economies ?? {}).some(
        (economy) => economy.kind === 'budget',
      );
    });
    expect(budgetRecords.map(({ key }) => key).sort()).toEqual(
      [...expected.keys()].sort(),
    );
    for (const record of budgetRecords) {
      const assertion = expected.get(record.key);
      if (assertion === undefined) throw new Error(`unexpected ${record.key}`);
      expect(
        createInitialItemState(record.key, record).economies?.[
          assertion.economyId
        ]?.remaining,
        record.key,
      ).toBe(assertion.remaining);
    }

    const landedBindings = bundled.records.flatMap((record) => {
      if (record.kind !== 'magic-item') return [];
      const readiness = (record.data as Record<string, unknown>)
        .executionReadiness as
        | {
            clauses?: {
              representation?: { block?: string; economyId?: string };
              engineHooks?: { engine: string; hook: string }[];
            }[];
          }
        | undefined;
      return (readiness?.clauses ?? [])
        .filter((clause) =>
          clause.engineHooks?.some(
            (hook) =>
              hook.engine === 'F5' &&
              hook.hook === 'duration-budget accounting',
          ),
        )
        .map(() => record.key);
    });
    expect(landedBindings.sort()).toEqual(
      [...expected.keys()]
        .filter((key) => key !== 'magic-item:winged-boots')
        .sort(),
    );
  });

  it('fails closed on unsafe or inexact duration budget arithmetic', () => {
    const invalid = (
      total: { amount: number; unit: string },
      increment: { amount: number; unit: string },
    ) =>
      item('invalid-budget', {
        economies: { time: { kind: 'budget', budget: { total, increment } } },
      });
    expect(() =>
      createInitialItemState(
        'magic-item:invalid-budget',
        invalid({ amount: 1, unit: 'round' }, { amount: 1, unit: 'minute' }),
      ),
    ).toThrow(/exactly divisible/);
    expect(() =>
      createInitialItemState(
        'magic-item:invalid-budget',
        invalid({ amount: 0, unit: 'hour' }, { amount: 1, unit: 'minute' }),
      ),
    ).toThrow(/positive safe integer/);
    expect(() =>
      createInitialItemState(
        'magic-item:invalid-budget',
        invalid(
          { amount: Number.MAX_SAFE_INTEGER, unit: 'day' },
          { amount: 1, unit: 'round' },
        ),
      ),
    ).toThrow(/safe duration accounting/);
  });

  it('initializes single-use state for an otherwise stateful instance', () => {
    const record = item(
      'stateful-single-use',
      {
        economies: { dose: { kind: 'single-use' } },
        stateMachine: {
          initial: 'sealed',
          states: [{ id: 'sealed' }, { id: 'used' }],
          transitions: [{ from: 'sealed', to: 'used', via: 'drink' }],
        },
      },
      false,
    );
    expect(createInitialItemState(record.key, record)).toMatchObject({
      packRef: record.key,
      economies: { dose: { remaining: 1 } },
      machineState: 'sealed',
    });
  });

  it('rolls declared spell-store initial levels or fails before partial state exists', () => {
    const record = item('rolled-spell-store', {
      spellStore: {
        contracts: [
          {
            id: 'energy',
            kind: 'spell-energy',
            capacityLevels: 10,
            initialLevels: '1d10',
          },
        ],
      },
    });
    expect(() => createInitialItemState(record.key, record)).toThrow(
      /seeded RNG is required/,
    );
    const initialized = createInitialItemState(record.key, record, {
      rng: createSeededRng(9),
    });
    expect(initialized.spellStoreLevels?.energy).toBeGreaterThanOrEqual(1);
    expect(initialized.spellStoreLevels?.energy).toBeLessThanOrEqual(10);
    expect(initialized.initializationRolls?.[0]).toMatchObject({
      purpose: 'spellStore:energy:initialLevels',
      notation: '1d10',
      total: initialized.spellStoreLevels?.energy,
    });
  });

  it('gates attunement-required use against the authoritative table before state mutation', () => {
    const db = freshDbWithSession();
    const record = item(
      'attuned-use-test',
      { operations: [{ id: 'invoke' }] },
      true,
    );
    const granted = giveItem(
      db,
      {
        id: 'ignored',
        name: 'Attuned Use Test',
        packRef: record.key,
        stateful: true,
      },
      MUTATION,
    );
    expect(() =>
      useItem(db, useInput(pack(record), granted.id, 'invoke')),
    ).toThrow(/requires authoritative attunement/);
    expect(readItemState(db, granted.id)).toBeUndefined();
    db.prepare(
      `INSERT INTO attunement(
         campaign_id, character_id, item_id, item_key, display_name,
         attuned_at, provenance, session_id, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      'campaign-1',
      'pc-1',
      granted.id,
      record.key,
      record.name,
      MUTATION.at,
      MUTATION.provenance,
      MUTATION.sessionId,
      MUTATION.at,
    );
    expect(
      useItem(db, useInput(pack(record), granted.id, 'invoke')),
    ).toMatchObject({
      operationId: 'invoke',
      consumed: false,
    });
    expect(readItemState(db, granted.id)?.packRef).toBe(record.key);
    db.close();
  });

  it('requires the same canonical variant identity at the use boundary', () => {
    const db = freshDbWithSession();
    const base = item(
      'variant-attuned-use',
      { operations: [{ id: 'invoke' }] },
      true,
    );
    const record: RulesRecord = {
      ...base,
      data: {
        ...(base.data as Record<string, unknown>),
        variants: [
          {
            id: 'agility',
            name: 'Agility',
            rarity: 'very rare',
            text: 'Agility variant.',
          },
        ],
      },
    };
    const granted = giveItem(
      db,
      {
        id: 'variant-instance',
        name: 'Variant Attuned Use',
        packRef: record.key,
        variantId: 'agility',
        stateful: true,
      },
      MUTATION,
    );
    db.prepare(
      `INSERT INTO attunement(
         campaign_id, character_id, item_id, item_key, display_name,
         attuned_at, provenance, session_id, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      'campaign-1',
      'pc-1',
      granted.id,
      record.key,
      'Agility',
      MUTATION.at,
      MUTATION.provenance,
      MUTATION.sessionId,
      MUTATION.at,
    );
    expect(() =>
      useItem(db, useInput(pack(record), granted.id, 'invoke')),
    ).toThrow(/requires authoritative attunement/);

    db.prepare('UPDATE attunement SET item_key = ? WHERE item_id = ?').run(
      `${record.key}#variant:agility`,
      granted.id,
    );
    expect(
      useItem(db, useInput(pack(record), granted.id, 'invoke')),
    ).toMatchObject({ operationId: 'invoke', consumed: false });
    db.close();
  });

  it('plays a reviewed bundled duration budget while refusing a bundled pending operation before mutation', () => {
    const db = freshDbWithSession();
    const bundled = getBundledDnd5eSrdPack();
    const candle = bundled.records.find(
      (record) => record.key === 'magic-item:candle-of-invocation',
    );
    const wand = bundled.records.find(
      (record) => record.key === 'magic-item:wand-of-magic-missiles',
    );
    const flyingPotion = bundled.records.find(
      (record) => record.key === 'magic-item:potion-of-flying',
    );
    if (
      candle === undefined ||
      wand === undefined ||
      flyingPotion === undefined
    )
      throw new Error('bundled magic-item fixtures are missing');

    const grantedCandle = giveItem(
      db,
      {
        id: 'ignored-candle',
        name: candle.name,
        packRef: candle.key,
        stateful: true,
      },
      MUTATION,
    );
    db.prepare(
      `INSERT INTO attunement(
         campaign_id, character_id, item_id, item_key, display_name,
         attuned_at, provenance, session_id, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      'campaign-1',
      'pc-1',
      grantedCandle.id,
      candle.key,
      candle.name,
      MUTATION.at,
      MUTATION.provenance,
      MUTATION.sessionId,
      MUTATION.at,
    );

    expect(readItemState(db, grantedCandle.id)).toBeUndefined();
    expect(
      useItem(db, useInput(bundled, grantedCandle.id, 'burn')),
    ).toMatchObject({
      operationId: 'burn',
      costs: [{ economy: 'burn-time', amount: 1 }],
      state: { economies: { 'burn-time': { remaining: 239 } } },
    });
    expect(readItemState(db, grantedCandle.id)?.economies['burn-time']).toEqual(
      { remaining: 239 },
    );
    const candleStateBeforeUnsupportedSpend = readItemState(
      db,
      grantedCandle.id,
    );
    const candleInventoryBeforeUnsupportedSpend = db
      .prepare(
        'SELECT quantity, pack_ref, variant_id FROM inventory WHERE id = ?',
      )
      .get(grantedCandle.id);
    const candleAttunementBeforeUnsupportedSpend = db
      .prepare(
        'SELECT item_key FROM attunement WHERE campaign_id = ? AND item_id = ?',
      )
      .get('campaign-1', grantedCandle.id);
    expect(() =>
      useItem(db, useInput(bundled, grantedCandle.id, 'cast-gate')),
    ).toThrow(/economy 'gate-use' has no trusted semantic owner/);
    expect(readItemState(db, grantedCandle.id)).toEqual(
      candleStateBeforeUnsupportedSpend,
    );
    expect(
      db
        .prepare(
          'SELECT quantity, pack_ref, variant_id FROM inventory WHERE id = ?',
        )
        .get(grantedCandle.id),
    ).toEqual(candleInventoryBeforeUnsupportedSpend);
    expect(
      db
        .prepare(
          'SELECT item_key FROM attunement WHERE campaign_id = ? AND item_id = ?',
        )
        .get('campaign-1', grantedCandle.id),
    ).toEqual(candleAttunementBeforeUnsupportedSpend);

    const grantedWand = giveItem(
      db,
      {
        id: 'ignored-wand',
        name: wand.name,
        packRef: wand.key,
        stateful: true,
      },
      MUTATION,
    );
    expect(readItemState(db, grantedWand.id)).toBeUndefined();
    expect(() =>
      useItem(
        db,
        useInput(bundled, grantedWand.id, 'cast-magic-missile', {
          charges: 1,
        }),
      ),
    ).toThrow(/engine-pending/);
    expect(readItemState(db, grantedWand.id)).toBeUndefined();
    expect(
      db
        .prepare('SELECT quantity FROM inventory WHERE id = ?')
        .get(grantedWand.id),
    ).toEqual({ quantity: 1 });
    giveItem(
      db,
      {
        id: 'flying-potion',
        name: flyingPotion.name,
        packRef: flyingPotion.key,
      },
      MUTATION,
    );
    expect(() =>
      useItem(db, useInput(bundled, 'flying-potion', 'drink')),
    ).toThrow(
      /operation effect 'flight' has no exact trusted readiness clause/,
    );
    expect(
      db
        .prepare('SELECT quantity, pack_ref FROM inventory WHERE id = ?')
        .get('flying-potion'),
    ).toEqual({ quantity: 1, pack_ref: flyingPotion.key });
    db.close();
  });

  it('finds Candle gate-use as the only bundled spend newly refused for missing semantic ownership', () => {
    const newlyRefused: string[] = [];
    const newlyRefusedForMissingEffectCoverage: string[] = [];
    for (const record of getBundledDnd5eSrdPack().records) {
      if (record.kind !== 'magic-item') continue;
      const mechanics = (record.data as Record<string, unknown>).mechanics as
        | {
            operations?: {
              id: string;
              cost?: { economy: string }[];
              effects?: string[];
            }[];
            stateMachine?: {
              transitions?: { via?: string; effects?: string[] }[];
            };
            spellStore?: { contracts?: { operationIds?: string[] }[] };
          }
        | undefined;
      for (const operation of mechanics?.operations ?? []) {
        if ((operation.cost?.length ?? 0) === 0) continue;
        const transitions = (mechanics?.stateMachine?.transitions ?? []).filter(
          ({ via }) => via === operation.id,
        );
        try {
          assertMagicItemOperationReady(record, undefined, {
            operationId: operation.id,
            economyIds: new Set(
              (operation.cost ?? []).map(({ economy }) => economy),
            ),
            operationEffectIds: new Set(operation.effects ?? []),
            effectIds: new Set([
              ...(operation.effects ?? []),
              ...transitions.flatMap(({ effects }) => effects ?? []),
            ]),
            usesStateMachine: transitions.length > 0,
            usesSpellStore: (mechanics?.spellStore?.contracts ?? []).some(
              ({ operationIds }) => operationIds?.includes(operation.id),
            ),
          });
        } catch (error) {
          const message =
            error instanceof Error ? error.message : String(error);
          if (
            message.includes('has no trusted semantic owner') &&
            !/(engine-pending|design-blocked|transitional)/.test(message)
          )
            newlyRefused.push(`${record.key}/${operation.id}`);
          if (
            message.includes('has no exact trusted readiness clause') &&
            !/(engine-pending|design-blocked|transitional)/.test(message)
          )
            newlyRefusedForMissingEffectCoverage.push(
              `${record.key}/${operation.id}`,
            );
        }
      }
    }
    expect(newlyRefused).toEqual(['magic-item:candle-of-invocation/cast-gate']);
    expect(newlyRefusedForMissingEffectCoverage).toEqual([
      'magic-item:dust-of-disappearance/throw-dust',
      'magic-item:philter-of-love/drink',
      'magic-item:potion-of-climbing/drink',
      'magic-item:potion-of-flying/drink',
      'magic-item:potion-of-giant-strength/drink',
      'magic-item:potion-of-invisibility/drink',
      'magic-item:potion-of-resistance/drink',
      'magic-item:potion-of-water-breathing/drink',
    ]);
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
    ).toThrow(/transfer_item/);
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
      economies: {
        dose: { kind: 'single-use', onDepleted: { becomes: 'destroyed' } },
      },
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

  it('atomically splits bundled nonmagical ammunition from the held magic stack', () => {
    const db = freshDbWithSession();
    const bundled = getBundledDnd5eSrdPack();
    const ammunition = bundled.records.find(
      (record) => record.key === 'magic-item:ammunition-1-2-or-3',
    );
    if (ammunition === undefined)
      throw new Error('bundled magic ammunition is missing');
    giveItem(
      db,
      {
        id: 'magic-ammunition',
        name: 'Ammunition +1',
        quantity: 3,
        location: 'quiver',
        properties: { material: 'silvered' },
        packRef: ammunition.key,
      },
      MUTATION,
    );
    db.prepare(
      "UPDATE clock SET current_location_id='battlefield' WHERE id=1",
    ).run();

    for (const legacyLocation of [null, '', '   ']) {
      db.prepare('UPDATE clock SET current_location_id=? WHERE id=1').run(
        legacyLocation,
      );
      expect(() =>
        useItem(db, useInput(bundled, 'magic-ammunition', 'hit-target')),
      ).toThrow(/concrete current campaign location/);
      expect(
        db
          .prepare('SELECT quantity FROM inventory WHERE id=?')
          .get('magic-ammunition'),
      ).toEqual({ quantity: 3 });
      expect(
        db
          .prepare("SELECT 1 FROM inventory WHERE id LIKE '%:nonmagical%'")
          .get(),
      ).toBeUndefined();
    }
    db.prepare(
      "UPDATE clock SET current_location_id='battlefield' WHERE id=1",
    ).run();

    const result = useItem(
      db,
      useInput(bundled, 'magic-ammunition', 'hit-target'),
    );
    expect(result).toMatchObject({
      quantity: 2,
      consumed: false,
      transformations: [
        {
          kind: 'became-nonmagical',
          economyId: 'use',
          quantity: 1,
          sourceInstanceId: 'magic-ammunition',
          transformedInstanceId: 'magic-ammunition:nonmagical',
          sourceLocation: 'quiver',
        },
      ],
    });
    expect(
      db
        .prepare(
          `SELECT id, character_id, name, quantity, location,
                  world_location_id, properties_json, pack_ref, variant_id
           FROM inventory ORDER BY id`,
        )
        .all(),
    ).toEqual([
      {
        id: 'magic-ammunition',
        character_id: 'pc-1',
        name: 'Ammunition +1',
        quantity: 2,
        location: 'quiver',
        world_location_id: null,
        properties_json: '{"material":"silvered"}',
        pack_ref: ammunition.key,
        variant_id: null,
      },
      {
        id: 'magic-ammunition:nonmagical',
        character_id: null,
        name: 'Nonmagical ammunition (formerly Ammunition +1)',
        quantity: 1,
        location: null,
        world_location_id: 'battlefield',
        properties_json:
          '{"material":"silvered","magicItemTransformation":{"status":"nonmagical","sourcePackRef":"magic-item:ammunition-1-2-or-3","sourceLocation":"quiver","economyId":"use"}}',
        pack_ref: null,
        variant_id: null,
      },
    ]);
    const conservation = db
      .prepare(
        `SELECT SUM(quantity) AS quantity FROM inventory
         WHERE id = ? OR id LIKE ?`,
      )
      .get('magic-ammunition', 'magic-ammunition:nonmagical%') as {
      quantity: number;
    };
    expect(conservation.quantity).toBe(3);
    expect(
      useItem(db, useInput(bundled, 'magic-ammunition', 'hit-target'))
        .transformations?.[0]?.transformedInstanceId,
    ).toBe('magic-ammunition:nonmagical#2');
    expect(
      useItem(db, useInput(bundled, 'magic-ammunition', 'hit-target'))
        .transformations?.[0]?.transformedInstanceId,
    ).toBe('magic-ammunition:nonmagical#3');
    expect(
      db.prepare("SELECT 1 FROM inventory WHERE id='magic-ammunition'").get(),
    ).toBeUndefined();
    expect(
      db
        .prepare(
          `SELECT COUNT(*) AS stacks, SUM(quantity) AS quantity
           FROM inventory
           WHERE id LIKE 'magic-ammunition:nonmagical%'
             AND character_id IS NULL AND pack_ref IS NULL`,
        )
        .get(),
    ).toEqual({ stacks: 3, quantity: 3 });
    db.close();
  });

  it('preserves a consumed item while its declared activated lifecycle is live', () => {
    const db = freshDbWithSession();
    const bead = item('lifecycle-bead', {
      economies: {
        quantity: {
          kind: 'single-use',
          onDepleted: { becomes: 'destroyed' },
        },
      },
      operations: [
        {
          id: 'throw-bead',
          cost: [{ economy: 'quantity', amount: 1 }],
        },
      ],
      stateMachine: {
        initial: 'bead',
        states: [{ id: 'bead' }, { id: 'sphere' }, { id: 'destroyed' }],
        transitions: [
          { from: 'bead', to: 'sphere', via: 'throw-bead' },
          {
            from: 'sphere',
            to: 'destroyed',
            timer: { amount: 1, unit: 'minute' },
          },
        ],
      },
    });
    const granted = giveItem(
      db,
      {
        id: 'ignored',
        name: 'Lifecycle Bead',
        packRef: bead.key,
        stateful: true,
      },
      MUTATION,
    );
    writeItemState(
      db,
      granted.id,
      createInitialItemState(bead.key, bead),
      MUTATION,
    );

    expect(
      useItem(db, useInput(pack(bead), granted.id, 'throw-bead')),
    ).toMatchObject({
      consumed: true,
      quantity: 1,
      state: {
        machineState: 'sphere',
        economies: { quantity: { remaining: 0 } },
        lifecycle: { status: 'consumed', pendingTerminal: 'destroyed' },
        pendingTimers: [
          {
            from: 'sphere',
            to: 'destroyed',
            anchorElapsedMinutes: 0,
            deadlineElapsedMinutes: 1,
            amount: 1,
            unit: 'minute',
          },
        ],
      },
    });
    expect(
      db.prepare('SELECT quantity FROM inventory WHERE id = ?').get(granted.id),
    ).toEqual({ quantity: 1 });
    db.close();
  });

  it('keeps inert and nonmagical instances but deletes immediate destruction', () => {
    for (const becomes of ['inert', 'nonmagical', 'destroyed'] as const) {
      const db = freshDbWithSession();
      const record = item(`depletion-${becomes}`, {
        economies: {
          uses: {
            kind: 'charges',
            charges: { max: 1 },
            onDepleted: { becomes },
          },
        },
        operations: [{ id: 'expend', cost: [{ economy: 'uses', amount: 1 }] }],
      });
      const granted = giveItem(
        db,
        {
          id: 'ignored',
          name: `Depletion ${becomes}`,
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
      if (becomes === 'destroyed')
        db.prepare(
          `INSERT INTO attunement(
             campaign_id, character_id, item_id, item_key, display_name,
             attuned_at, provenance, session_id, updated_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        ).run(
          'campaign-1',
          'pc-1',
          granted.id,
          record.key,
          record.name,
          MUTATION.at,
          MUTATION.provenance,
          MUTATION.sessionId,
          MUTATION.at,
        );
      const result = useItem(db, useInput(pack(record), granted.id, 'expend'));
      if (becomes === 'destroyed') {
        expect(result).toMatchObject({
          consumed: true,
          attunementsEnded: [
            {
              reason: 'item_destroyed',
              ended: { itemId: granted.id, itemKey: record.key },
            },
          ],
        });
        expect(
          db.prepare('SELECT 1 FROM inventory WHERE id = ?').get(granted.id),
        ).toBeUndefined();
        expect(
          db
            .prepare('SELECT 1 FROM attunement WHERE item_id = ?')
            .get(granted.id),
        ).toBeUndefined();
      } else {
        expect(result.state?.lifecycle?.status).toBe(becomes);
        expect(() =>
          useItem(db, useInput(pack(record), granted.id, 'expend')),
        ).toThrow(new RegExp(`is ${becomes}`));
      }
      db.close();
    }
  });

  it('applies risk-based nonmagical and destroyed charge outcomes atomically', () => {
    for (const becomes of ['nonmagical', 'destroyed'] as const) {
      const db = freshDbWithSession();
      const record = item(`risk-depletion-${becomes}`, {
        economies: {
          charges: {
            kind: 'charges',
            charges: { max: 1 },
            onDepleted: { roll: 'd20', destroyedOn: 1, becomes },
          },
        },
        operations: [
          { id: 'expend', cost: [{ economy: 'charges', amount: 1 }] },
        ],
      });
      const granted = giveItem(
        db,
        {
          id: 'ignored',
          name: `Risk Depletion ${becomes}`,
          packRef: record.key,
          stateful: true,
        },
        MUTATION,
      );
      const result = useItem(db, {
        ...useInput(pack(record), granted.id, 'expend'),
        rng: { nextInt: () => 0 },
      });
      if (becomes === 'destroyed') {
        expect(result.consumed).toBe(true);
        expect(
          db.prepare('SELECT 1 FROM inventory WHERE id = ?').get(granted.id),
        ).toBeUndefined();
      } else {
        expect(result.state?.lifecycle?.status).toBe('nonmagical');
        expect(
          db
            .prepare('SELECT quantity FROM inventory WHERE id = ?')
            .get(granted.id),
        ).toEqual({ quantity: 1 });
      }
      db.close();
    }
  });

  it('blocks a lose-property-only operation after its economy reaches zero', () => {
    const db = freshDbWithSession();
    const record = item('lose-property-only', {
      economies: {
        charges: {
          kind: 'charges',
          charges: { max: 1 },
          onDepleted: { loseProperty: true },
        },
      },
      operations: [
        { id: 'special-property', cost: [{ economy: 'charges', amount: 1 }] },
      ],
    });
    const granted = giveItem(
      db,
      {
        id: 'ignored',
        name: 'Lose Property Only',
        packRef: record.key,
        stateful: true,
      },
      MUTATION,
    );
    expect(
      useItem(db, useInput(pack(record), granted.id, 'special-property')).state
        ?.economies.charges.remaining,
    ).toBe(0);
    expect(
      readItemState(db, granted.id)?.lifecycle,
      'loseProperty alone must not invent an item-wide inert lifecycle',
    ).toBeUndefined();
    expect(() =>
      useItem(db, useInput(pack(record), granted.id, 'special-property')),
    ).toThrow(/insufficient charges: 0 remaining/);
    expect(readItemState(db, granted.id)?.economies.charges.remaining).toBe(0);
    db.close();
  });

  it('refuses engine-pending operation clauses before spending state', () => {
    const db = freshDbWithSession();
    const green = item('pending-operation', {
      economies: { charges: { kind: 'charges', charges: { max: 2 } } },
      operations: [{ id: 'blast', cost: [{ economy: 'charges', amount: 1 }] }],
    });
    const record: RulesRecord = {
      ...green,
      data: {
        ...(green.data as Record<string, unknown>),
        executionReadiness: {
          source: 'derived-magic-item-clauses-v1',
          clauses: [
            {
              clauseId: `${green.key}/operation:blast`,
              scope: { kind: 'parent' },
              tag: 'M1',
              readiness: 'engine-pending',
              representation: {
                block: 'operations',
                operationId: 'blast',
              },
              engineHooks: [{ engine: 'F9', hook: 'apply blast damage' }],
              missingHooks: [{ engine: 'F9', hook: 'apply blast damage' }],
              missingEngines: ['F9'],
            },
          ],
        },
      },
    };
    const granted = giveItem(
      db,
      {
        id: 'ignored',
        name: 'Pending Operation',
        packRef: record.key,
        stateful: true,
      },
      MUTATION,
    );
    expect(() =>
      useItem(db, useInput(pack(record), granted.id, 'blast')),
    ).toThrow(/not safely executable.*F9:apply blast damage/);
    expect(readItemState(db, granted.id)).toBeUndefined();
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

  it('deterministically initializes every stateful parent and variant in the generated corpus', () => {
    const bundled = getBundledDnd5eSrdPack();
    const byKey = new Map(
      bundled.records.map((record) => [record.key, record]),
    );
    const magicItems = bundled.records.filter(
      (record) => record.kind === 'magic-item',
    );
    let initialized = 0;
    let initialProcedures = 0;
    let tableProcedures = 0;
    for (const [recordIndex, record] of magicItems.entries()) {
      const variants = magicItemVariantDefinitions(record);
      const variantIds: readonly (string | undefined)[] =
        variants.length === 0
          ? [undefined]
          : variants.map((variant) => variant.id);
      for (const [variantIndex, variantId] of variantIds.entries()) {
        if (!isStatefulMagicItem(record, variantId)) continue;
        const label = `${record.key}${variantId === undefined ? '' : `:${variantId}`}`;
        const state = createInitialItemState(record.key, record, {
          variantId,
          rng: createSeededRng(recordIndex * 101 + variantIndex + 1),
          resolveTable: (ref) => byKey.get(ref),
        });
        expect(
          validateItemStateForRecord(state, record.key, record, variantId, {
            resolveTable: (ref) => byKey.get(ref),
          }),
          label,
        ).toEqual(state);
        const mechanics = effectiveMagicItemMechanics(record, variantId);
        const procedures = mechanics?.randomProcedure?.procedures.filter(
          (procedure) => procedure.kind === 'initial-state',
        );
        for (const procedure of procedures ?? []) {
          initialProcedures += 1;
          if (procedure.tableRef !== undefined) {
            const semanticState = state.randomInitialization?.[procedure.id];
            expect(semanticState, `${label}:${procedure.id}`).toBeDefined();
            expect(semanticState?.tableRef).toBe(procedure.tableRef);
            if (semanticState?.kind === 'table-pool') {
              const total =
                semanticState.remainingEntryIds.length +
                semanticState.removedEntryIds.length;
              expect(total).toBe(34);
              expect(state.economies?.cards.remaining).toBe(
                semanticState.remainingEntryIds.length,
              );
            } else if (semanticState?.kind === 'table-results') {
              expect(semanticState.results.length).toBeGreaterThan(0);
              expect(
                semanticState.results.every(
                  (result) => result.outcome.length > 0,
                ),
              ).toBe(true);
            } else if (semanticState?.kind === 'containment-occupant') {
              expect(
                semanticState.occupant === null ||
                  semanticState.occupant.outcome.length > 0,
              ).toBe(true);
            }
            tableProcedures += 1;
          } else if (procedure.risk !== undefined) {
            expect(state.custom, `${label}:${procedure.id}`).toBeDefined();
          } else if (procedure.roll !== undefined) {
            const expected = parseDice(procedure.roll);
            expect(
              state.initializationRolls?.some((roll) => {
                const actual = parseDice(roll.notation);
                return (
                  actual.count === expected.count &&
                  actual.faces === expected.faces
                );
              }),
              `${label}:${procedure.id}`,
            ).toBe(true);
          }
        }
        initialized += 1;
      }
    }
    expect(initialized).toBeGreaterThan(100);
    expect(initialProcedures).toBe(13);
    expect(tableProcedures).toBe(4);
  });
});
