import { describe, expect, it } from 'vitest';
import type { RulesPack, RulesRecord } from '../src/internal.js';
import {
  advanceWorldTime,
  attuneItem,
  createInitialItemState,
  createSeededRng,
  donItem,
  getBundledDnd5eSrdPack,
  giveItem,
  holdItem,
  readItemState,
  resolveRestEventItemResets,
  useItem,
  writeItemState,
} from '../src/internal.js';
import { applyItemStateConditionEvent } from '../src/state/itemResetExecutor.js';
import { freshDbWithSession } from './support/db.js';

const CTX = {
  campaignId: 'campaign-1',
  provenance: 'test:item-reset',
  sessionId: 'session-1',
  at: '2026-07-20T00:00:00.000Z',
};
const BUNDLED_PACK = getBundledDnd5eSrdPack();

function packedItem(name: string): RulesRecord {
  const record = BUNDLED_PACK.records.find(
    (candidate) => candidate.kind === 'magic-item' && candidate.name === name,
  );
  if (record === undefined) throw new Error(`bundled pack has no ${name}`);
  return record;
}

function fixture(
  key: string,
  mechanics: Record<string, unknown>,
  requiresAttunement = false,
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
      requiresAttunement,
      description: 'executor fixture',
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

function rulesPack(record: RulesRecord): RulesPack {
  return { ...getBundledDnd5eSrdPack(), records: [record] };
}

function resolver(pack: RulesPack) {
  return () => pack;
}

function install(
  db: ReturnType<typeof freshDbWithSession>,
  record: RulesRecord,
  state = createInitialItemState(record.key, record),
) {
  const item = giveItem(
    db,
    {
      id: `instance-${record.key}`,
      name: record.name,
      packRef: record.key,
      stateful: true,
    },
    CTX,
  );
  writeItemState(db, item.id, state, CTX);
  return item.id;
}

function useInput(
  pack: RulesPack,
  instanceId: string,
  operationId: string,
  args?: Readonly<Record<string, unknown>>,
) {
  return {
    ...CTX,
    instanceId,
    operationId,
    ...(args === undefined ? {} : { args }),
    characterId: 'pc-1',
    resolveRulesPack: resolver(pack),
  };
}

describe('item reset/timer executor', () => {
  it('executes generated item condition and timer transitions on pack records', () => {
    const resolverFor = (record: RulesRecord) => resolver(rulesPack(record));
    const transitions = (record: RulesRecord) =>
      (
        (
          (record.data as Record<string, unknown>).mechanics as Record<
            string,
            unknown
          >
        ).stateMachine as { transitions: Record<string, unknown>[] }
      ).transitions;

    const shield = packedItem('Animated Shield');
    const shieldDb = freshDbWithSession();
    const shieldId = install(shieldDb, shield);
    holdItem(shieldDb, { ...CTX, itemId: shieldId });
    attuneItem(shieldDb, {
      ...CTX,
      characterRef: 'pc-1',
      itemId: shieldId,
      itemRef: shield.key,
    });
    const shieldCondition = transitions(shield).find(
      (transition) =>
        typeof transition.condition === 'string' &&
        transition.condition.includes('incapacitated or die'),
    )?.condition;
    expect(shieldCondition).toBe('until you are incapacitated or die');
    useItem(
      shieldDb,
      useInput(rulesPack(shield), shieldId, 'speak-command-word'),
    );
    expect(
      applyItemStateConditionEvent(shieldDb, {
        ...CTX,
        instanceId: shieldId,
        condition: String(shieldCondition),
        resolveRulesPack: resolverFor(shield),
      }),
    ).toMatchObject({ from: 'active', to: 'inactive' });
    expect(readItemState(shieldDb, shieldId)?.machineState).toBe('inactive');
    shieldDb.close();

    const dagger = packedItem('Dagger of Venom');
    const daggerDb = freshDbWithSession();
    // The hit event is independent of the unrelated C1 daily-reset and C2
    // poison-application hooks, so waive those gates while preserving the
    // generated machine and its exact condition predicate.
    const daggerData = dagger.data as Record<string, unknown>;
    const readiness = daggerData.executionReadiness as {
      source: string;
      clauses: Record<string, unknown>[];
    };
    const daggerForTest = {
      ...dagger,
      data: {
        ...daggerData,
        executionReadiness: {
          ...readiness,
          clauses: readiness.clauses.map((clause) =>
            clause.tag === 'C1' || clause.tag === 'C2'
              ? {
                  ...clause,
                  readiness: 'green',
                  missingHooks: undefined,
                  missingEngines: undefined,
                }
              : clause,
          ),
        },
      },
    };
    const daggerId = install(daggerDb, daggerForTest);
    holdItem(daggerDb, { ...CTX, itemId: daggerId });
    const daggerPack = rulesPack(daggerForTest);
    useItem(daggerDb, useInput(daggerPack, daggerId, 'coat-blade'));
    const hitCondition = transitions(dagger).find(
      (transition) =>
        transition.from === 'coated' &&
        typeof transition.condition === 'string',
    )?.condition;
    expect(hitCondition).toBe('an attack using this weapon hits a creature');
    expect(
      applyItemStateConditionEvent(daggerDb, {
        ...CTX,
        instanceId: daggerId,
        condition: String(hitCondition),
        resolveRulesPack: resolverFor(daggerForTest),
      }),
    ).toMatchObject({ from: 'coated', to: 'uncoated' });
    expect(readItemState(daggerDb, daggerId)?.machineState).toBe('uncoated');
    expect(() =>
      applyItemStateConditionEvent(daggerDb, {
        ...CTX,
        instanceId: daggerId,
        condition: 'an undeclared condition',
        resolveRulesPack: resolverFor(daggerForTest),
      }),
    ).toThrow(/no declared condition transition/);
    daggerDb.close();

    const wings = packedItem('Wings of Flying');
    const wingsDb = freshDbWithSession();
    const wingsId = install(wingsDb, wings);
    donItem(wingsDb, { ...CTX, itemId: wingsId });
    attuneItem(wingsDb, {
      ...CTX,
      characterRef: 'pc-1',
      itemId: wingsId,
      itemRef: wings.key,
    });
    useItem(wingsDb, useInput(rulesPack(wings), wingsId, 'manifest-wings'));
    const expired = advanceWorldTime(wingsDb, {
      ...CTX,
      minutes: 60,
      rng: { nextInt: () => 0 },
      resolveRulesPack: resolverFor(wings),
    });
    expect(expired.itemTimerResolutions).toMatchObject([
      { from: 'active', to: 'inactive', deadlineElapsedMinutes: 60 },
    ]);
    expect(readItemState(wingsDb, wingsId)?.economies?.cooldown).toMatchObject({
      remaining: 0,
      availableAt: '120',
    });
    wingsDb.close();
  });

  it('keeps the owner save outcome paid and records target escape as an external event', () => {
    const rope = packedItem('Rope of Entanglement');
    const pack = rulesPack(rope);
    const db = freshDbWithSession();
    const id = install(db, rope);
    holdItem(db, { ...CTX, itemId: id });
    if ((rope.data as Record<string, unknown>).requiresAttunement === true)
      attuneItem(db, {
        ...CTX,
        characterRef: 'pc-1',
        itemId: id,
        itemRef: rope.key,
      });
    expect(
      useItem(
        db,
        useInput(pack, id, 'entangle-creature', {
          transitionOutcome: 'failure',
        }),
      ),
    ).toMatchObject({
      state: { machineState: 'loose' },
      transition: { outcome: 'failure' },
    });
    expect(useItem(db, useInput(pack, id, 'entangle-creature'))).toMatchObject({
      state: { machineState: 'restraining' },
      transition: { outcome: 'success' },
    });
    expect(() => useItem(db, useInput(pack, id, 'escape-rope'))).toThrow(
      /declares no operation/,
    );
    expect(
      applyItemStateConditionEvent(db, {
        ...CTX,
        instanceId: id,
        condition:
          'A target restrained by the rope can use an action to make a DC 15 Strength or Dexterity check (target’s choice). On a success, the creature is no longer restrained by the rope.',
        resolveRulesPack: resolver(pack),
      }),
    ).toMatchObject({
      instanceId: id,
      from: 'restraining',
      to: 'loose',
    });
    const destroyed = (
      (rope.data as Record<string, unknown>).mechanics as Record<
        string,
        unknown
      >
    ).stateMachine as { transitions: Record<string, unknown>[] };
    const destructionCondition = destroyed.transitions.find(
      (transition) =>
        transition.from === 'restraining' && transition.to === 'destroyed',
    )?.condition;
    expect(destructionCondition).toBe('the rope drops to 0 hit points');
    expect(
      applyItemStateConditionEvent(db, {
        ...CTX,
        instanceId: id,
        condition: String(destructionCondition),
        resolveRulesPack: resolver(pack),
      }),
    ).toMatchObject({ from: 'loose', to: 'destroyed' });
    db.close();
  });

  it('fires a declared external condition and clears its active timer without spending an operation', () => {
    const db = freshDbWithSession();
    const record = fixture('condition-event', {
      operations: [{ id: 'activate' }],
      stateMachine: {
        initial: 'inactive',
        states: [{ id: 'inactive' }, { id: 'active' }],
        transitions: [
          { from: 'inactive', to: 'active', via: 'activate' },
          {
            from: 'active',
            to: 'inactive',
            timer: { amount: 1, unit: 'hour' },
          },
          {
            from: 'active',
            to: 'inactive',
            condition: 'the wearer is incapacitated',
          },
        ],
      },
    });
    const pack = rulesPack(record);
    const id = install(db, record, {
      ...createInitialItemState(record.key, record),
      machineState: 'active',
      pendingTimers: [
        {
          from: 'active',
          to: 'inactive',
          anchorElapsedMinutes: 0,
          deadlineElapsedMinutes: 60,
          amount: 1,
          unit: 'hour',
        },
      ],
    });
    expect(() =>
      applyItemStateConditionEvent(db, {
        instanceId: id,
        condition: 'the wearer falls',
        ...CTX,
        rng: createSeededRng('condition-event'),
        resolveRulesPack: resolver(pack),
      }),
    ).toThrow(/no declared condition transition/);
    expect(readItemState(db, id)?.machineState).toBe('active');
    expect(
      applyItemStateConditionEvent(db, {
        instanceId: id,
        condition: 'the wearer is incapacitated',
        ...CTX,
        rng: createSeededRng('condition-event'),
        resolveRulesPack: resolver(pack),
      }),
    ).toEqual({ instanceId: id, from: 'active', to: 'inactive' });
    expect(readItemState(db, id)).toMatchObject({
      machineState: 'inactive',
      pendingTimers: [],
    });
    db.close();
  });

  it('crosses dawn once, clamps regain, and is idempotent', () => {
    const db = freshDbWithSession();
    const record = fixture('reset-dawn', {
      economies: {
        charges: {
          kind: 'charges',
          charges: { max: 5 },
          reset: [{ at: 'dawn', amount: '1d4' }],
        },
      },
      operations: [{ id: 'spend', cost: [{ economy: 'charges', amount: 1 }] }],
    });
    const pack = rulesPack(record);
    const id = install(db, record);
    useItem(db, useInput(pack, id, 'spend'));
    const first = advanceWorldTime(db, {
      ...CTX,
      minutes: 360,
      rng: createSeededRng(1),
      resolveRulesPack: resolver(pack),
    });
    expect(first.itemResets).toHaveLength(1);
    expect(first.itemResets[0].remaining).toBe(5);
    expect(readItemState(db, id)?.economies?.charges).toMatchObject({
      remaining: 5,
      lastReset: '360',
    });
    const second = advanceWorldTime(db, {
      ...CTX,
      minutes: 1,
      rng: createSeededRng(1),
      resolveRulesPack: resolver(pack),
    });
    expect(second.itemResets).toHaveLength(0);
    db.close();
  });

  it('crosses dusk without treating dawn as dusk', () => {
    const db = freshDbWithSession();
    const record = fixture('reset-dusk', {
      economies: {
        charges: {
          kind: 'charges',
          charges: { max: 5 },
          reset: [{ at: 'dusk', amount: '1d4' }],
        },
      },
    });
    const pack = rulesPack(record);
    const id = install(db, record);
    const before = readItemState(db, id);
    if (before === undefined) throw new Error('fixture state was not written');
    writeItemState(
      db,
      id,
      { ...before, economies: { charges: { remaining: 0 } } },
      CTX,
    );
    expect(
      advanceWorldTime(db, {
        ...CTX,
        minutes: 360,
        rng: createSeededRng(2),
        resolveRulesPack: resolver(pack),
      }).itemResets,
    ).toHaveLength(0);
    const result = advanceWorldTime(db, {
      ...CTX,
      minutes: 720,
      rng: createSeededRng(2),
      resolveRulesPack: resolver(pack),
    });
    expect(result.itemResets).toMatchObject([
      { event: 'dusk', boundaryElapsedMinutes: 1_080 },
    ]);
    db.close();
  });

  it('anchors and restarts a per-period budget on every use', () => {
    const db = freshDbWithSession();
    const record = fixture('reset-period', {
      economies: {
        flight: {
          kind: 'budget',
          budget: {
            total: { amount: 24, unit: 'hour' },
            increment: { amount: 1, unit: 'hour' },
          },
          reset: [
            {
              at: 'per-period',
              amount: { amount: 2, unit: 'hour' },
              period: { amount: 12, unit: 'hour' },
              onlyIfUnused: true,
            },
          ],
        },
      },
      operations: [{ id: 'fly', cost: [{ economy: 'flight', amount: 1 }] }],
    });
    const pack = rulesPack(record);
    const id = install(db, record);
    useItem(db, useInput(pack, id, 'fly'));
    expect(readItemState(db, id)?.economies?.flight).toMatchObject({
      remaining: 23,
      availableAt: '720',
    });
    advanceWorldTime(db, {
      ...CTX,
      minutes: 720,
      resolveRulesPack: resolver(pack),
    });
    expect(readItemState(db, id)?.economies?.flight).toMatchObject({
      remaining: 24,
    });
    useItem(db, useInput(pack, id, 'fly'));
    expect(readItemState(db, id)?.economies?.flight?.availableAt).toBe('1440');
    db.close();
  });

  it('anchors an hour cooldown at the spend clock and restores it once', () => {
    const db = freshDbWithSession();
    const record = fixture('reset-hour', {
      economies: {
        cooldown: {
          kind: 'cooldown',
          cooldown: { duration: { amount: 1, unit: 'hour' } },
          reset: [{ at: 'hour', amount: 'all' }],
        },
      },
      operations: [
        { id: 'activate', cost: [{ economy: 'cooldown', amount: 1 }] },
      ],
    });
    const pack = rulesPack(record);
    const id = install(db, record);
    useItem(db, useInput(pack, id, 'activate'));
    expect(readItemState(db, id)?.economies?.cooldown).toMatchObject({
      remaining: 0,
      availableAt: '60',
    });
    const result = advanceWorldTime(db, {
      ...CTX,
      minutes: 60,
      resolveRulesPack: resolver(pack),
    });
    expect(result.itemResets).toMatchObject([
      { economy: 'cooldown', event: 'hour', remaining: 1 },
    ]);
    db.close();
  });

  it('anchors a seven-day cooldown and waits for the full interval', () => {
    const db = freshDbWithSession();
    const record = fixture('reset-days-cooldown', {
      economies: {
        cooldown: {
          kind: 'cooldown',
          cooldown: { duration: { amount: 7, unit: 'day' } },
          reset: [{ at: 'days', days: 7, amount: 'all' }],
        },
      },
      operations: [
        { id: 'activate', cost: [{ economy: 'cooldown', amount: 1 }] },
      ],
    });
    const pack = rulesPack(record);
    const id = install(db, record);
    useItem(db, useInput(pack, id, 'activate'));
    expect(readItemState(db, id)?.economies?.cooldown).toMatchObject({
      remaining: 0,
      availableAt: '10080',
    });
    expect(
      advanceWorldTime(db, {
        ...CTX,
        minutes: 10079,
        resolveRulesPack: resolver(pack),
      }).itemResets,
    ).toHaveLength(0);
    expect(
      advanceWorldTime(db, {
        ...CTX,
        minutes: 1,
        resolveRulesPack: resolver(pack),
      }).itemResets,
    ).toMatchObject([{ economy: 'cooldown', event: 'days', remaining: 1 }]);
    db.close();
  });

  it('clears figurine inert state through depletion and its seven-day regain', () => {
    const db = freshDbWithSession();
    const record = fixture('reset-figurine', {
      economies: {
        charges: {
          kind: 'charges',
          charges: { max: 1 },
          reset: [{ at: 'days', days: 7, amount: 'all' }],
          onDepleted: { becomes: 'inert' },
        },
      },
      operations: [{ id: 'use', cost: [{ economy: 'charges', amount: 1 }] }],
    });
    const pack = rulesPack(record);
    const id = install(db, record);
    useItem(db, useInput(pack, id, 'use'));
    expect(readItemState(db, id)?.lifecycle?.status).toBe('inert');
    advanceWorldTime(db, {
      ...CTX,
      minutes: 10080,
      resolveRulesPack: resolver(pack),
    });
    expect(readItemState(db, id)).toMatchObject({
      economies: { charges: { remaining: 1 } },
    });
    expect(readItemState(db, id)?.lifecycle).toBeUndefined();
    db.close();
  });

  it('restores a century-scale budget on its days anchor', () => {
    const db = freshDbWithSession();
    const record = fixture('reset-century-budget', {
      economies: {
        budget: {
          kind: 'budget',
          budget: {
            total: { amount: 36500, unit: 'day' },
            increment: { amount: 1, unit: 'day' },
          },
          reset: [{ at: 'days', days: 36500, amount: 'all' }],
        },
      },
      operations: [{ id: 'use', cost: [{ economy: 'budget', amount: 36500 }] }],
    });
    const pack = rulesPack(record);
    const id = install(db, record);
    useItem(db, useInput(pack, id, 'use'));
    expect(readItemState(db, id)?.economies?.budget).toMatchObject({
      remaining: 0,
      availableAt: '52560000',
    });
    advanceWorldTime(db, {
      ...CTX,
      minutes: 52559999,
      resolveRulesPack: resolver(pack),
    });
    expect(readItemState(db, id)?.economies?.budget?.remaining).toBe(0);
    const result = advanceWorldTime(db, {
      ...CTX,
      minutes: 1,
      resolveRulesPack: resolver(pack),
    });
    expect(result.itemResets).toMatchObject([
      { economy: 'budget', event: 'days', remaining: 36500 },
    ]);
    db.close();
  });

  it('supports participant-scoped rest reset evidence', () => {
    const db = freshDbWithSession();
    const record = fixture('reset-short-rest', {
      economies: {
        uses: {
          kind: 'per-day',
          perDay: { uses: 2 },
          reset: [{ at: 'short-rest', amount: 'all' }],
        },
      },
    });
    const pack = rulesPack(record);
    const id = install(db, record);
    const before = readItemState(db, id);
    if (before === undefined) throw new Error('fixture state was not written');
    writeItemState(
      db,
      id,
      {
        ...before,
        economies: { uses: { remaining: 0 } },
      },
      CTX,
    );
    const evidence = resolveRestEventItemResets(db, {
      ...CTX,
      event: 'short-rest',
      participants: ['pc-1'],
      resolveRulesPack: resolver(pack),
    });
    expect(evidence).toMatchObject([
      { economy: 'uses', event: 'short-rest', remaining: 2 },
    ]);
    db.close();
  });

  it('rolls a dice regain once for each of three crossed dawns', () => {
    const db = freshDbWithSession();
    const record = fixture('reset-three-dawns', {
      economies: {
        charges: {
          kind: 'charges',
          charges: { max: 2 },
          reset: [{ at: 'dawn', amount: '1d2' }],
        },
      },
    });
    const pack = rulesPack(record);
    const id = install(db, record);
    const before = readItemState(db, id);
    if (before === undefined) throw new Error('fixture state was not written');
    writeItemState(
      db,
      id,
      { ...before, economies: { charges: { remaining: 0 } } },
      CTX,
    );
    const result = advanceWorldTime(db, {
      ...CTX,
      minutes: 4320,
      rng: createSeededRng(3),
      resolveRulesPack: resolver(pack),
    });
    expect(result.itemResets).toHaveLength(3);
    expect(
      result.itemResets.map((entry) => entry.boundaryElapsedMinutes),
    ).toEqual([360, 1800, 3240]);
    expect(readItemState(db, id)?.economies?.charges.remaining).toBe(2);
    db.close();
  });

  it('interleaves dawn and dusk boundaries chronologically for one economy', () => {
    const db = freshDbWithSession();
    const record = fixture('reset-dawn-dusk', {
      economies: {
        charges: {
          kind: 'charges',
          charges: { max: 10 },
          reset: [
            { at: 'dawn', amount: '1d2' },
            { at: 'dusk', amount: '1d2' },
          ],
        },
      },
    });
    const pack = rulesPack(record);
    const id = install(db, record);
    const before = readItemState(db, id);
    if (before === undefined) throw new Error('fixture state was not written');
    writeItemState(
      db,
      id,
      { ...before, economies: { charges: { remaining: 0 } } },
      CTX,
    );
    const result = advanceWorldTime(db, {
      ...CTX,
      minutes: 2880,
      rng: createSeededRng(4),
      resolveRulesPack: resolver(pack),
    });
    expect(
      result.itemResets.map((entry) => [
        entry.event,
        entry.boundaryElapsedMinutes,
      ]),
    ).toEqual([
      ['dawn', 360],
      ['dusk', 1080],
      ['dawn', 1800],
      ['dusk', 2520],
    ]);
    expect(readItemState(db, id)?.economies?.charges.lastReset).toBe('2520');
    db.close();
  });

  it('fails closed on a schema-legal but unsupported reset shape', () => {
    const db = freshDbWithSession();
    const record = fixture('reset-unknown', {
      economies: {
        charges: {
          kind: 'charges',
          charges: { max: 5 },
          reset: [{ at: 'dawn', amount: { amount: 1, unit: 'hour' } }],
        },
      },
    });
    const pack = rulesPack(record);
    install(db, record);
    expect(() =>
      advanceWorldTime(db, {
        ...CTX,
        minutes: 1,
        resolveRulesPack: resolver(pack),
      }),
    ).toThrow(/magic-item:reset-unknown.*unsupported reset shape/);
    db.close();
  });

  it('does not regain consumed or nonmagical items, but clears inert', () => {
    for (const status of ['consumed', 'nonmagical', 'inert'] as const) {
      const db = freshDbWithSession();
      const record = fixture(`reset-${status}`, {
        economies: {
          charges: {
            kind: 'charges',
            charges: { max: 2 },
            reset: [{ at: 'dawn', amount: 'all' }],
            onDepleted: { becomes: 'inert' },
          },
        },
      });
      const pack = rulesPack(record);
      const id = install(db, record);
      const state = readItemState(db, id);
      if (state === undefined) throw new Error('fixture state was not written');
      writeItemState(
        db,
        id,
        {
          ...state,
          economies: { charges: { remaining: 0 } },
          depletions: [
            {
              economyId: 'charges',
              rolls: [],
              loseProperty: false,
              becomes: 'inert',
            },
          ],
          lifecycle: { status },
        },
        CTX,
      );
      const result = advanceWorldTime(db, {
        ...CTX,
        minutes: 360,
        resolveRulesPack: resolver(pack),
      });
      if (status === 'inert') {
        expect(result.itemResets).toHaveLength(1);
        expect(readItemState(db, id)).toMatchObject({
          economies: { charges: { remaining: 2 } },
        });
        expect(readItemState(db, id)?.lifecycle).toBeUndefined();
      } else {
        expect(result.itemResets).toHaveLength(0);
        expect(readItemState(db, id)?.economies?.charges.remaining).toBe(0);
        expect(readItemState(db, id)?.lifecycle?.status).toBe(status);
      }
      db.close();
    }
  });

  it('destroys a timed item and returns attunement evidence', () => {
    const db = freshDbWithSession();
    const record = fixture(
      'timer-destruction',
      {
        operations: [{ id: 'activate' }],
        stateMachine: {
          initial: 'inactive',
          states: [{ id: 'inactive' }, { id: 'active' }, { id: 'destroyed' }],
          transitions: [
            { from: 'inactive', to: 'active', via: 'activate' },
            {
              from: 'active',
              to: 'destroyed',
              timer: { amount: 1, unit: 'minute' },
            },
          ],
        },
      },
      true,
    );
    const pack = rulesPack(record);
    const id = install(db, record);
    attuneItem(db, {
      ...CTX,
      itemId: id,
      itemRef: record.key,
      resolveRulesPack: resolver(pack),
    });
    useItem(db, useInput(pack, id, 'activate'));
    const result = advanceWorldTime(db, {
      ...CTX,
      minutes: 1,
      resolveRulesPack: resolver(pack),
    });
    expect(result.itemTimerResolutions[0].attunementsEnded).toHaveLength(1);
    expect(
      db.prepare('SELECT 1 FROM inventory WHERE id=?').get(id),
    ).toBeUndefined();
    db.close();
  });

  it('ends the committed Cube of Force barrier on its declared one-minute duration', () => {
    const db = freshDbWithSession();
    // The bundled cube's own clauses are still engine-pending, so its committed
    // mechanics are replayed through a readiness-green fixture: this asserts the
    // pack's encoding is executable by F5, not a hand-copied approximation.
    const bundled = getBundledDnd5eSrdPack().records.find(
      ({ key }) => key === 'magic-item:cube-of-force',
    );
    if (bundled === undefined) throw new Error('bundled pack has no cube');
    const record = fixture(
      'cube-of-force-duration',
      (bundled.data as { mechanics: Record<string, unknown> }).mechanics,
      true,
    );
    const pack = rulesPack(record);
    const id = install(db, record);
    attuneItem(db, {
      ...CTX,
      itemId: id,
      itemRef: record.key,
      resolveRulesPack: resolver(pack),
    });
    useItem(db, useInput(pack, id, 'press-face-1'));
    expect(readItemState(db, id)?.pendingTimers).toMatchObject([
      { from: 'face-1', to: 'inactive', amount: 1, unit: 'minute' },
    ]);
    // Source: pressing a different face expends charges "resetting the
    // duration", so the face-1 deadline is cancelled and face-3 re-anchors.
    useItem(db, useInput(pack, id, 'press-face-3'));
    expect(readItemState(db, id)?.pendingTimers).toMatchObject([
      { from: 'face-3', to: 'inactive', amount: 1, unit: 'minute' },
    ]);
    const result = advanceWorldTime(db, {
      ...CTX,
      minutes: 1,
      resolveRulesPack: resolver(pack),
    });
    expect(
      result.itemTimerResolutions.map(({ from, to }) => ({ from, to })),
    ).toEqual([{ from: 'face-3', to: 'inactive' }]);
    expect(readItemState(db, id)?.machineState).toBe('inactive');
    expect(readItemState(db, id)?.pendingTimers).toEqual([]);
    db.close();
  });

  it('fires a timer whose state pair is also joined by an operation transition', () => {
    const db = freshDbWithSession();
    const record = fixture('timer-shared-pair', {
      operations: [{ id: 'activate' }, { id: 'deactivate' }],
      stateMachine: {
        initial: 'off',
        states: [{ id: 'off' }, { id: 'on' }],
        transitions: [
          { from: 'off', to: 'on', via: 'activate' },
          // Declared before the timer, so a scan that inspects every same-pair
          // candidate reaches an undefined timer declaration first.
          { from: 'on', to: 'off', via: 'deactivate' },
          { from: 'on', to: 'off', timer: { amount: 1, unit: 'minute' } },
        ],
      },
    });
    const pack = rulesPack(record);
    const id = install(db, record);
    useItem(db, useInput(pack, id, 'activate'));
    const result = advanceWorldTime(db, {
      ...CTX,
      minutes: 1,
      resolveRulesPack: resolver(pack),
    });
    expect(result.itemTimerResolutions.map(({ to }) => to)).toEqual(['off']);
    expect(readItemState(db, id)?.machineState).toBe('off');
    db.close();
  });

  it('executes timer cascades from each fired deadline', () => {
    const db = freshDbWithSession();
    const record = fixture('timer-cascade', {
      operations: [{ id: 'activate' }],
      stateMachine: {
        initial: 'off',
        states: [
          { id: 'off' },
          { id: 'first' },
          { id: 'second' },
          { id: 'done' },
        ],
        transitions: [
          { from: 'off', to: 'first', via: 'activate' },
          { from: 'first', to: 'second', timer: { amount: 1, unit: 'minute' } },
          { from: 'second', to: 'done', timer: { amount: 1, unit: 'minute' } },
        ],
      },
    });
    const pack = rulesPack(record);
    const id = install(db, record);
    useItem(db, useInput(pack, id, 'activate'));
    const result = advanceWorldTime(db, {
      ...CTX,
      minutes: 2,
      resolveRulesPack: resolver(pack),
    });
    expect(result.itemTimerResolutions.map((entry) => entry.to)).toEqual([
      'second',
      'done',
    ]);
    expect(readItemState(db, id)?.machineState).toBe('done');
    expect(readItemState(db, id)?.pendingTimers).toEqual([]);
    db.close();
  });

  it('fails closed when a due dice reset has no RNG', () => {
    const db = freshDbWithSession();
    const record = fixture('reset-rng', {
      economies: {
        charges: {
          kind: 'charges',
          charges: { max: 5 },
          reset: [{ at: 'dawn', amount: '1d4' }],
        },
      },
    });
    const pack = rulesPack(record);
    const id = install(db, record);
    db.prepare('UPDATE item_state SET state_json=? WHERE inventory_id=?').run(
      JSON.stringify({
        packRef: record.key,
        economies: { charges: { remaining: 0 } },
      }),
      id,
    );
    expect(() =>
      advanceWorldTime(db, {
        ...CTX,
        minutes: 360,
        resolveRulesPack: resolver(pack),
      }),
    ).toThrow(/reset amount 1d4 needs seeded RNG/);
    expect(
      db.prepare('SELECT elapsed_minutes FROM clock WHERE id=1').get(),
    ).toMatchObject({
      elapsed_minutes: 0,
    });
    db.close();
  });

  it('fails closed on a schema-legal but unsupported reset combination', () => {
    const db = freshDbWithSession();
    const record = fixture('reset-unknown-shape', {
      economies: {
        charges: {
          kind: 'charges',
          charges: { max: 5 },
          reset: [{ at: 'dawn', amount: 2 }],
        },
      },
    });
    const pack = rulesPack(record);
    install(db, record);
    expect(() =>
      advanceWorldTime(db, {
        ...CTX,
        minutes: 360,
        resolveRulesPack: resolver(pack),
      }),
    ).toThrow(/unsupported reset shape/);
    db.close();
  });

  it('stops the per-period schedule at maximum and re-anchors on the next spend', () => {
    const db = freshDbWithSession();
    const record = fixture('reset-per-period-stop', {
      economies: {
        flight: {
          kind: 'budget',
          budget: {
            total: { amount: 4, unit: 'hour' },
            increment: { amount: 1, unit: 'minute' },
          },
          reset: [
            {
              at: 'per-period',
              period: { amount: 12, unit: 'hour' },
              amount: { amount: 2, unit: 'hour' },
              onlyIfUnused: true,
            },
          ],
        },
      },
      operations: [{ id: 'fly', cost: [{ economy: 'flight', amount: 1 }] }],
    });
    const pack = rulesPack(record);
    const id = install(db, record);
    useItem(db, useInput(pack, id, 'fly'));
    expect(readItemState(db, id)?.economies?.flight).toMatchObject({
      remaining: 239,
      availableAt: '720',
    });
    const filled = advanceWorldTime(db, {
      ...CTX,
      minutes: 720,
      resolveRulesPack: resolver(pack),
    });
    expect(filled.itemResets).toMatchObject([
      { economy: 'flight', remaining: 240 },
    ]);
    expect(
      readItemState(db, id)?.economies?.flight?.availableAt,
    ).toBeUndefined();
    const idle = advanceWorldTime(db, {
      ...CTX,
      minutes: 14_400,
      resolveRulesPack: resolver(pack),
    });
    expect(idle.itemResets).toHaveLength(0);
    useItem(db, useInput(pack, id, 'fly'));
    expect(readItemState(db, id)?.economies?.flight?.availableAt).toBe('15840');
    db.close();
  });

  it('cancels sibling timers when the machine leaves their state', () => {
    const db = freshDbWithSession();
    const record = fixture('timer-siblings', {
      operations: [{ id: 'activate' }],
      stateMachine: {
        initial: 'off',
        states: [
          { id: 'off' },
          { id: 'active' },
          { id: 'early' },
          { id: 'late' },
        ],
        transitions: [
          { from: 'off', to: 'active', via: 'activate' },
          { from: 'active', to: 'early', timer: { amount: 1, unit: 'minute' } },
          { from: 'active', to: 'late', timer: { amount: 5, unit: 'minute' } },
        ],
      },
    });
    const pack = rulesPack(record);
    const id = install(db, record);
    useItem(db, useInput(pack, id, 'activate'));
    expect(readItemState(db, id)?.pendingTimers).toHaveLength(2);
    const first = advanceWorldTime(db, {
      ...CTX,
      minutes: 1,
      resolveRulesPack: resolver(pack),
    });
    expect(first.itemTimerResolutions.map((entry) => entry.to)).toEqual([
      'early',
    ]);
    expect(readItemState(db, id)?.pendingTimers).toEqual([]);
    const later = advanceWorldTime(db, {
      ...CTX,
      minutes: 10,
      resolveRulesPack: resolver(pack),
    });
    expect(later.itemTimerResolutions).toHaveLength(0);
    expect(readItemState(db, id)?.machineState).toBe('early');
    db.close();
  });

  it('destroys an item on its timer before a later dawn can recharge it', () => {
    const db = freshDbWithSession();
    const record = fixture('timeline-destruction', {
      economies: {
        charges: {
          kind: 'charges',
          charges: { max: 3 },
          reset: [{ at: 'dawn', amount: 'all' }],
        },
      },
      operations: [
        { id: 'activate', cost: [{ economy: 'charges', amount: 1 }] },
      ],
      stateMachine: {
        initial: 'inactive',
        states: [{ id: 'inactive' }, { id: 'active' }, { id: 'destroyed' }],
        transitions: [
          { from: 'inactive', to: 'active', via: 'activate' },
          {
            from: 'active',
            to: 'destroyed',
            timer: { amount: 1, unit: 'minute' },
          },
        ],
      },
    });
    const pack = rulesPack(record);
    const id = install(db, record);
    useItem(db, useInput(pack, id, 'activate'));
    const result = advanceWorldTime(db, {
      ...CTX,
      minutes: 600,
      resolveRulesPack: resolver(pack),
    });
    expect(result.itemTimerResolutions.map((entry) => entry.to)).toEqual([
      'destroyed',
    ]);
    expect(result.itemResets).toHaveLength(0);
    expect(db.prepare('SELECT 1 FROM inventory WHERE id=?').get(id)).toBe(
      undefined,
    );
    db.close();
  });

  it('records an anchored reset at its due minute, not when it was applied', () => {
    const db = freshDbWithSession();
    const record = fixture('reset-anchor-evidence', {
      economies: {
        cooldown: {
          kind: 'cooldown',
          cooldown: { duration: { amount: 1, unit: 'hour' } },
          reset: [{ at: 'hour', amount: 'all' }],
        },
      },
      operations: [
        { id: 'activate', cost: [{ economy: 'cooldown', amount: 1 }] },
      ],
    });
    const pack = rulesPack(record);
    const id = install(db, record);
    useItem(db, useInput(pack, id, 'activate'));
    const result = advanceWorldTime(db, {
      ...CTX,
      minutes: 600,
      resolveRulesPack: resolver(pack),
    });
    expect(result.itemResets).toMatchObject([
      { economy: 'cooldown', boundaryElapsedMinutes: 60 },
    ]);
    expect(readItemState(db, id)?.economies?.cooldown).toMatchObject({
      remaining: 1,
      lastReset: '60',
    });
    db.close();
  });

  it('completes a pending terminal when only an operation-driven exit remains', () => {
    const db = freshDbWithSession();
    const record = fixture('pending-terminal-operation-exit', {
      economies: {
        use: { kind: 'single-use', onDepleted: { becomes: 'destroyed' } },
      },
      operations: [{ id: 'dismiss' }],
      stateMachine: {
        initial: 'sphere',
        states: [{ id: 'sphere' }, { id: 'settled' }, { id: 'dismissed' }],
        transitions: [
          {
            from: 'sphere',
            to: 'settled',
            timer: { amount: 1, unit: 'minute' },
          },
          { from: 'settled', to: 'dismissed', via: 'dismiss' },
        ],
      },
    });
    const pack = rulesPack(record);
    const id = install(db, record, {
      packRef: record.key,
      machineState: 'sphere',
      economies: { use: { remaining: 0 } },
      depletions: [
        {
          economyId: 'use',
          rolls: [],
          loseProperty: false,
          becomes: 'destroyed',
        },
      ],
      lifecycle: { status: 'consumed', pendingTerminal: 'destroyed' },
      pendingTimers: [
        {
          from: 'sphere',
          to: 'settled',
          anchorElapsedMinutes: 0,
          deadlineElapsedMinutes: 1,
          amount: 1,
          unit: 'minute',
        },
      ],
    });
    const result = advanceWorldTime(db, {
      ...CTX,
      minutes: 1,
      resolveRulesPack: resolver(pack),
    });
    expect(result.itemTimerResolutions.map((entry) => entry.to)).toEqual([
      'settled',
    ]);
    expect(db.prepare('SELECT 1 FROM inventory WHERE id=?').get(id)).toBe(
      undefined,
    );
    db.close();
  });

  it('completes a pending terminal only after the machine stops advancing', () => {
    const db = freshDbWithSession();
    const record = fixture('pending-terminal-cascade', {
      economies: {
        use: { kind: 'single-use', onDepleted: { becomes: 'destroyed' } },
      },
      stateMachine: {
        initial: 'sphere',
        states: [{ id: 'sphere' }, { id: 'shrinking' }, { id: 'gone' }],
        transitions: [
          {
            from: 'sphere',
            to: 'shrinking',
            timer: { amount: 1, unit: 'minute' },
          },
          {
            from: 'shrinking',
            to: 'gone',
            timer: { amount: 1, unit: 'minute' },
          },
        ],
      },
    });
    const pack = rulesPack(record);
    const id = install(db, record, {
      packRef: record.key,
      machineState: 'sphere',
      economies: { use: { remaining: 0 } },
      depletions: [
        {
          economyId: 'use',
          rolls: [],
          loseProperty: false,
          becomes: 'destroyed',
        },
      ],
      pendingTimers: [
        {
          from: 'sphere',
          to: 'shrinking',
          anchorElapsedMinutes: 0,
          deadlineElapsedMinutes: 1,
          amount: 1,
          unit: 'minute',
        },
      ],
      lifecycle: { status: 'consumed', pendingTerminal: 'destroyed' },
    });
    const intermediate = advanceWorldTime(db, {
      ...CTX,
      minutes: 1,
      resolveRulesPack: resolver(pack),
    });
    expect(intermediate.itemTimerResolutions.map((entry) => entry.to)).toEqual([
      'shrinking',
    ]);
    expect(db.prepare('SELECT 1 FROM inventory WHERE id=?').get(id)).toEqual({
      1: 1,
    });
    const terminal = advanceWorldTime(db, {
      ...CTX,
      minutes: 1,
      resolveRulesPack: resolver(pack),
    });
    expect(terminal.itemTimerResolutions.map((entry) => entry.to)).toEqual([
      'gone',
    ]);
    expect(db.prepare('SELECT 1 FROM inventory WHERE id=?').get(id)).toBe(
      undefined,
    );
    db.close();
  });
});
