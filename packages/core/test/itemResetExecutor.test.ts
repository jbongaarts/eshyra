import { describe, expect, it } from 'vitest';
import type { RulesPack, RulesRecord } from '../src/internal.js';
import {
  advanceWorldTime,
  attuneItem,
  createInitialItemState,
  createSeededRng,
  getBundledDnd5eSrdPack,
  giveItem,
  readItemState,
  resolveRestEventItemResets,
  useItem,
  writeItemState,
} from '../src/internal.js';
import { freshDbWithSession } from './support/db.js';

const CTX = {
  campaignId: 'campaign-1',
  provenance: 'test:item-reset',
  sessionId: 'session-1',
  at: '2026-07-20T00:00:00.000Z',
};

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

function useInput(pack: RulesPack, instanceId: string, operationId: string) {
  return {
    ...CTX,
    instanceId,
    operationId,
    characterId: 'pc-1',
    resolveRulesPack: resolver(pack),
  };
}

describe('item reset/timer executor', () => {
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
});
