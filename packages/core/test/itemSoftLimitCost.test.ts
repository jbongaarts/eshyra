/**
 * Soft-limit safe-use operation costs (eshyra-o9bd.19.4.6.8; review
 * 19.4.6.7 S3; bd memory magic-item-faithful-or-absent, refinement
 * 2026-10-13; consumer capability eshyra-olc5.8).
 *
 * Invariant: a printed count of risk-free uses followed by permitted risky
 * reuse (Ring of X-ray Vision, Wind Fan) spends a safe use while one remains
 * and is NEVER refused when none does -- the printed risk is DM-adjudicated.
 * An ordinary hard limit (no marker) still refuses. Authority for the
 * expected behavior is the printed text of the two items; the fixtures here
 * reuse the BUNDLED PACK's economy and operation cost shapes, with the
 * execution-readiness clauses made green so the cost resolution (not the
 * readiness preflight) is what is exercised.
 */
import { describe, expect, it } from 'vitest';
import type { RulesPack, RulesRecord } from '../src/internal.js';
import {
  advanceWorldTime,
  createInitialItemState,
  getBundledDnd5eSrdPack,
  giveItem,
  readItemState,
  resolveRestEventItemResets,
  useItem,
  writeItemState,
} from '../src/internal.js';
import { freshDbWithSession } from './support/db.js';

type Obj = Record<string, unknown>;
const CTX = {
  campaignId: 'campaign-1',
  provenance: 'test:soft-limit',
  sessionId: 'session-1',
  at: '2026-07-20T00:00:00.000Z',
};

const bundled = getBundledDnd5eSrdPack();
const printed = (name: string): Obj => {
  const record = bundled.records.find(
    (entry) => entry.kind === 'magic-item' && entry.name === name,
  );
  if (record === undefined) throw new Error(`no item ${name}`);
  return record.data as Obj;
};
const packOperation = (name: string, id: string): Obj =>
  (((printed(name).mechanics as Obj).operations as Obj[]) ?? []).find(
    (entry) => entry.id === id,
  ) as Obj;

/** A fixture carrying the pack's economies and the one operation's cost. */
function fixture(
  name: string,
  operationId: string,
  mutate: (cost: Obj) => Obj = (cost) => cost,
): RulesRecord {
  const mechanics = printed(name).mechanics as Obj;
  const operation = packOperation(name, operationId);
  const economies = mechanics.economies as Obj;
  const exemplar = bundled.records.find((r) => r.kind === 'magic-item');
  if (exemplar === undefined) throw new Error('no magic item');
  return {
    ...exemplar,
    key: `magic-item:soft-${name.toLowerCase().replaceAll(' ', '-')}`,
    name,
    data: {
      itemType: 'wondrous item',
      rarity: 'rare',
      requiresAttunement: false,
      description: 'soft-limit fixture',
      mechanics: {
        economies,
        operations: [
          {
            id: operationId,
            cost: (operation.cost as Obj[]).map(mutate),
          },
        ],
      },
      executionReadiness: {
        source: 'derived-magic-item-clauses-v1',
        clauses: [
          {
            clauseId: 'fixture/operation',
            scope: { kind: 'parent' },
            tag: 'M1',
            readiness: 'green',
            representation: { block: 'operations', operationId },
          },
          ...Object.keys(economies).map((economyId) => ({
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

const rulesPack = (record: RulesRecord): RulesPack => ({
  ...bundled,
  records: [record],
});

function install(db: ReturnType<typeof freshDbWithSession>, r: RulesRecord) {
  const row = giveItem(
    db,
    { id: `i-${r.key}`, name: r.name, packRef: r.key, stateful: true },
    CTX,
  );
  writeItemState(db, row.id, createInitialItemState(r.key, r), CTX);
  return row.id;
}

const use = (
  db: ReturnType<typeof freshDbWithSession>,
  pack: RulesPack,
  id: string,
  operationId: string,
) =>
  useItem(db, {
    ...CTX,
    instanceId: id,
    operationId,
    characterId: 'pc-1',
    resolveRulesPack: () => pack,
  });

describe('soft-limit safe-use costs (pack shape)', () => {
  it('the two printed safe-use items carry the marker on the operation cost, and no other operation does', () => {
    expect(
      packOperation('Ring of X-ray Vision', 'activate-x-ray-vision').cost,
    ).toEqual([
      { economy: 'safe-use', amount: 1, onExhausted: 'risk-adjudicated' },
    ]);
    expect(packOperation('Wind Fan', 'cast-gust-of-wind').cost).toEqual([
      { economy: 'safe-use', amount: 1, onExhausted: 'risk-adjudicated' },
    ]);
    const marked: string[] = [];
    for (const record of bundled.records)
      if (record.kind === 'magic-item') {
        const data = record.data as Obj;
        const scopes = [
          data.mechanics as Obj | undefined,
          ...((data.variants as Obj[] | undefined) ?? []).map(
            (variant) => variant.mechanics as Obj | undefined,
          ),
        ];
        for (const mechanics of scopes)
          for (const operation of (mechanics?.operations as Obj[]) ?? [])
            for (const cost of (operation.cost as Obj[]) ?? [])
              if (cost.onExhausted !== undefined)
                marked.push(`${record.name} ${String(operation.id)}`);
      }
    expect(marked.sort()).toEqual([
      'Ring of X-ray Vision activate-x-ray-vision',
      'Wind Fan cast-gust-of-wind',
    ]);
  });
});

describe('soft-limit safe-use costs (first use, reuse, reset)', () => {
  it('Ring of X-ray Vision: the first use spends the safe use, reuse is permitted and spends nothing, a long rest restores it', () => {
    const db = freshDbWithSession();
    const record = fixture('Ring of X-ray Vision', 'activate-x-ray-vision');
    const pack = rulesPack(record);
    const id = install(db, record);
    const first = use(db, pack, id, 'activate-x-ray-vision');
    expect(first.costs).toEqual([{ economy: 'safe-use', amount: 1 }]);
    expect(readItemState(db, id)?.economies?.['safe-use']?.remaining).toBe(0);
    // Further use before a long rest is permitted (the printed save-or-
    // exhaustion risk is DM-adjudicated) and spends nothing.
    const risky = use(db, pack, id, 'activate-x-ray-vision');
    expect(risky.costs).toEqual([{ economy: 'safe-use', amount: 0 }]);
    expect(readItemState(db, id)?.economies?.['safe-use']?.remaining).toBe(0);
    expect(use(db, pack, id, 'activate-x-ray-vision').costs[0]?.amount).toBe(0);
    const reset = resolveRestEventItemResets(db, {
      ...CTX,
      event: 'long-rest',
      participants: ['pc-1'],
      resolveRulesPack: () => pack,
    });
    expect(reset).toMatchObject([
      { economy: 'safe-use', event: 'long-rest', remaining: 1 },
    ]);
    expect(use(db, pack, id, 'activate-x-ray-vision').costs).toEqual([
      { economy: 'safe-use', amount: 1 },
    ]);
    db.close();
  });

  it('Wind Fan: the first use spends the safe use, early reuse is permitted and spends nothing, dawn restores it', () => {
    const db = freshDbWithSession();
    const record = fixture('Wind Fan', 'cast-gust-of-wind');
    const pack = rulesPack(record);
    const id = install(db, record);
    expect(use(db, pack, id, 'cast-gust-of-wind').costs).toEqual([
      { economy: 'safe-use', amount: 1 },
    ]);
    expect(use(db, pack, id, 'cast-gust-of-wind').costs).toEqual([
      { economy: 'safe-use', amount: 0 },
    ]);
    expect(readItemState(db, id)?.economies?.['safe-use']?.remaining).toBe(0);
    const advanced = advanceWorldTime(db, {
      ...CTX,
      minutes: 24 * 60,
      resolveRulesPack: () => pack,
    });
    expect(advanced.itemResets).toMatchObject([
      { economy: 'safe-use', event: 'dawn', remaining: 1 },
    ]);
    expect(use(db, pack, id, 'cast-gust-of-wind').costs).toEqual([
      { economy: 'safe-use', amount: 1 },
    ]);
    db.close();
  });

  it('a hard limit (no marker) still refuses once the pool is empty, with state unchanged', () => {
    for (const [name, operationId] of [
      ['Ring of X-ray Vision', 'activate-x-ray-vision'],
      ['Wind Fan', 'cast-gust-of-wind'],
    ] as const) {
      const db = freshDbWithSession();
      const record = fixture(name, operationId, (cost) => {
        const { onExhausted: _marker, ...hard } = cost;
        return hard;
      });
      const pack = rulesPack(record);
      const id = install(db, record);
      use(db, pack, id, operationId);
      expect(() => use(db, pack, id, operationId), name).toThrow(
        /insufficient safe-use/,
      );
      expect(
        readItemState(db, id)?.economies?.['safe-use']?.remaining,
        name,
      ).toBe(0);
      db.close();
    }
  });
});
