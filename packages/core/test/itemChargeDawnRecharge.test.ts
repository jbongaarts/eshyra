import { describe, expect, it } from 'vitest';
import {
  advanceWorldTime,
  attuneItem,
  createInitialItemState,
  createSeededRng,
  getBundledDnd5eSrdPack,
  giveItem,
  holdItem,
  readItemState,
  useItem,
  writeItemState,
} from '../src/internal.js';
import {
  DEFAULT_TEST_CAMPAIGN_ID,
  DEFAULT_TEST_SESSION_ID,
  freshDbWithSession,
} from './support/db.js';

const pack = getBundledDnd5eSrdPack();
const PIPES = 'magic-item:pipes-of-the-sewers';
const WAND = 'magic-item:wand-of-secrets';
const CTX = {
  campaignId: DEFAULT_TEST_CAMPAIGN_ID,
  provenance: 'test:charge-dawn-recharge',
  sessionId: DEFAULT_TEST_SESSION_ID,
  at: '2026-10-31T00:00:00.000Z',
};

describe('charge dawn recharge on the unmodified SRD pack', () => {
  it('spends a newly ready operation and caps its seeded dawn regain', () => {
    const record = pack.records.find((entry) => entry.key === WAND);
    if (record === undefined)
      throw new Error('bundled pack has no Wand of Secrets');
    const db = freshDbWithSession();
    try {
      const item = giveItem(
        db,
        { id: 'wand', name: 'Wand of Secrets', packRef: WAND },
        CTX,
      );
      holdItem(db, { ...CTX, itemId: item.id });
      useItem(db, {
        ...CTX,
        instanceId: item.id,
        characterId: 'pc-1',
        operationId: 'detect-secret',
        resolveRulesPack: () => pack,
      });
      expect(readItemState(db, item.id)?.economies?.charges?.remaining).toBe(2);

      const reset = advanceWorldTime(db, {
        ...CTX,
        minutes: 360,
        rng: createSeededRng(23),
        resolveRulesPack: () => pack,
      });
      expect(reset.itemResets).toHaveLength(1);
      const [evidence] = reset.itemResets;
      expect(evidence).toMatchObject({
        packRef: WAND,
        economy: 'charges',
        event: 'dawn',
        maximum: 3,
        previousRemaining: 2,
      });
      expect(evidence.roll?.notation).toBe('1d3');
      expect(evidence.remaining).toBe(
        Math.min(2 + (evidence.roll?.total ?? 0), 3),
      );
      expect(evidence.remaining).toBe(3);
      expect(readItemState(db, item.id)?.economies?.charges?.remaining).toBe(
        evidence.remaining,
      );
    } finally {
      db.close();
    }
  });

  it('pins the exact Pipes blocker: its creature grant prints no engine-computed ending or count (eshyra-j9rc)', () => {
    const record = pack.records.find((entry) => entry.key === PIPES);
    if (record === undefined) throw new Error('bundled pack has no Pipes');
    const data = record.data as {
      mechanics: {
        entityGrant: { grants: Record<string, unknown>[] };
      };
      executionReadiness: {
        clauses: {
          clauseId: string;
          readiness: string;
          missingEngines?: string[];
        }[];
      };
    };
    // creatureGrantLifecycleOwned keeps a grant pending unless every grant
    // prints a count and an engine-computed ending. Pipes prints neither: the
    // swarm count equals the charges spent (variable) and a called swarm has
    // no printed ending. While this holds, call-rat-swarms cannot reach cost
    // validation, so the spend-2 / refuse-2-with-1-remaining sequence is
    // unreachable without a pack change. When this test fails, the boundary
    // has moved: add that no-waiver sequence and delete this pin.
    const [grant] = data.mechanics.entityGrant.grants;
    expect(grant).not.toHaveProperty('revertOn');
    expect(grant).not.toHaveProperty('count');
    expect(grant).not.toHaveProperty('countRoll');
    const m4 = data.executionReadiness.clauses.find(
      (clause) => clause.clauseId === `${PIPES}/m4-pipes-of-the-sewers`,
    );
    expect(m4).toMatchObject({ readiness: 'engine-pending' });
    expect(m4?.missingEngines).toEqual(['F2', 'F3', 'F5']);
  });

  it('keeps Pipes refused on its pending grant while the real record can recharge', () => {
    const record = pack.records.find((entry) => entry.key === PIPES);
    if (record === undefined) throw new Error('bundled pack has no Pipes');
    const readiness = (
      record.data as {
        executionReadiness: {
          clauses: { clauseId: string; readiness: string }[];
        };
      }
    ).executionReadiness.clauses;
    expect(readiness).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          clauseId: `${PIPES}/c1-economy-charges`,
          readiness: 'green',
        }),
        expect.objectContaining({
          clauseId: `${PIPES}/c1-operation-call-rat-swarms`,
          readiness: 'green',
        }),
      ]),
    );

    const db = freshDbWithSession();
    try {
      const item = giveItem(
        db,
        { id: 'pipes', name: 'Pipes of the Sewers', packRef: PIPES },
        CTX,
      );
      holdItem(db, { ...CTX, itemId: item.id });
      attuneItem(db, {
        ...CTX,
        characterRef: 'pc-1',
        itemId: item.id,
        itemRef: PIPES,
      });
      const use = (amount: number) =>
        useItem(db, {
          ...CTX,
          instanceId: item.id,
          characterId: 'pc-1',
          operationId: 'call-rat-swarms',
          args: { costs: { charges: amount } },
          resolveRulesPack: () => pack,
        });

      expect(() => use(2)).toThrow(/m4-pipes-of-the-sewers \(engine-pending/);
      expect(readItemState(db, item.id)).toBeUndefined();
      const initial = createInitialItemState(PIPES, record);
      writeItemState(
        db,
        item.id,
        { ...initial, economies: { charges: { remaining: 2 } } },
        CTX,
      );

      const reset = advanceWorldTime(db, {
        ...CTX,
        minutes: 360,
        rng: createSeededRng(23),
        resolveRulesPack: () => pack,
      });
      expect(reset.itemResets).toHaveLength(1);
      const [evidence] = reset.itemResets;
      expect(evidence).toMatchObject({
        packRef: PIPES,
        economy: 'charges',
        event: 'dawn',
        maximum: 3,
        previousRemaining: 2,
      });
      expect(evidence.roll?.notation).toBe('1d3');
      expect(evidence.remaining).toBe(
        Math.min(2 + (evidence.roll?.total ?? 0), 3),
      );
      expect(evidence.remaining).toBe(3);
      expect(readItemState(db, item.id)?.economies?.charges?.remaining).toBe(
        evidence.remaining,
      );
    } finally {
      db.close();
    }
  });
});
