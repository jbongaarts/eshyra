import { describe, expect, it } from 'vitest';
import type { ToolContext } from '../src/internal.js';
import {
  advanceWorldTime,
  createDefaultToolRegistry,
  createInitialItemState,
  createSeededRng,
  getBundledDnd5eSrdPack,
  giveItem,
  holdItem,
  listActiveEffects,
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

  it('owns the Pipes grant as an upper-bound, no-printed-ending lifecycle, so call-rat-swarms reaches cost validation (eshyra-ffoo)', () => {
    const record = pack.records.find((entry) => entry.key === PIPES);
    if (record === undefined) throw new Error('bundled pack has no Pipes');
    const data = record.data as {
      description: string;
      mechanics: {
        entityGrant: { grants: Record<string, unknown>[] };
        effects?: unknown;
      };
      executionReadiness: {
        clauses: {
          clauseId: string;
          readiness: string;
          missingEngines?: string[];
          representation: { sourceText?: string };
        }[];
      };
    };
    // Only what is printed is typed: a CEILING of one swarm per charge spent
    // and an explicit statement that no ending is printed. No count, no
    // duration and no reversion is invented.
    const [grant] = data.mechanics.entityGrant.grants;
    expect(grant).toMatchObject({
      id: 'called-rat-swarms',
      cooldownEconomy: 'charges',
      maxCountPerCost: { economy: 'charges', perUnit: 1 },
      noPrintedEnding: true,
    });
    for (const absent of ['count', 'countRoll', 'revertOn', 'duration'])
      expect(grant).not.toHaveProperty(absent);

    const clause = (id: string) =>
      data.executionReadiness.clauses.find(
        (entry) => entry.clauseId === `${PIPES}/${id}`,
      );
    expect(clause('m4-pipes-of-the-sewers')).toMatchObject({
      readiness: 'green',
    });
    // Arrival, availability, control and the rat attitude are adjudicated by
    // design, each carrying a VERBATIM span of the printed description.
    for (const id of [
      'm4-availability-pipes-of-the-sewers',
      'm4-control-pipes-of-the-sewers',
      'c2-residual-rat-indifference',
    ]) {
      const adjudicated = clause(id);
      expect(adjudicated, id).toMatchObject({
        readiness: 'adjudicated-by-design',
      });
      expect(adjudicated?.representation.sourceText).toBeTruthy();
      expect(data.description).toContain(
        adjudicated?.representation.sourceText as string,
      );
    }
    expect(data.mechanics.effects).toBeUndefined();
    expect(
      data.executionReadiness.clauses.filter(
        (entry) => entry.readiness === 'engine-pending',
      ),
    ).toEqual([]);
  });

  it('drives the Pipes sequence on the unmodified pack with no waiver: spend 2, bind at most 2, refuse 2 with 1 left, dawn regains 1d3 capped at 3, end_effect closes the link', () => {
    const db = freshDbWithSession();
    try {
      const registry = createDefaultToolRegistry();
      const ctx: ToolContext = {
        db,
        rng: createSeededRng(23),
        campaignId: DEFAULT_TEST_CAMPAIGN_ID,
        sessionId: DEFAULT_TEST_SESSION_ID,
        turnId: 'ffoo',
        at: CTX.at,
        resolveRulesPack: () => pack,
      };
      const call = (name: string, args: unknown) =>
        registry.invoke(name, args, ctx);
      const must = (name: string, args: unknown) => {
        const result = call(name, args);
        if (!result.ok) throw new Error(`${name} failed: ${result.message}`);
        return result;
      };
      must('start_encounter', {
        combatInstanceId: 'c',
        actors: [
          {
            actorId: 'pc',
            rulesRef: 'creature:goblin',
            hpMax: 20,
            hpCurrent: 20,
            side: 'ally',
          },
          ...[0, 1, 2].map((n) => ({
            actorId: `s${n}`,
            rulesRef: 'creature:swarm-of-rats',
            hpMax: 24,
            hpCurrent: 24,
            side: 'ally',
          })),
        ],
      });
      let round = 0;
      const nextTurn = () => {
        round += 1;
        must('begin_turn', { character: 'pc-1', round });
      };
      const id = (
        must('give_item', {
          id: 'pipes',
          name: 'Pipes of the Sewers',
          packRef: PIPES,
        }).data as { id: string }
      ).id;
      must('attune_item', { character: 'pc-1', itemId: id });
      const remaining = () =>
        readItemState(db, id)?.economies?.charges?.remaining;
      const use = (amount: number) =>
        call('use_item', {
          instanceId: id,
          operationId: 'call-rat-swarms',
          args: { costs: { charges: amount } },
        });
      const credits = () =>
        db
          .prepare(
            'SELECT credit_id, spent_amount, redeemed_effect_id FROM item_grant_bind_credit ORDER BY insertion_order',
          )
          .all() as {
          credit_id: string;
          spent_amount: number | null;
          redeemed_effect_id: string | null;
        }[];
      const bind = (
        effectId: string,
        swarms: readonly number[],
        creditId: string | undefined,
      ) =>
        call('start_effect', {
          effectId,
          kind: 'summoning',
          displayName: effectId,
          source: {
            kind: 'magic-item',
            ref: PIPES,
            grantRef: 'called-rat-swarms',
            itemInstanceId: id,
            ...(creditId === undefined ? {} : { bindCreditId: creditId }),
          },
          actors: swarms.map((n) => ({ combatantId: `c-s${n}` })),
          duration: { kind: 'until-removed' },
        });

      // Spend 2 of 3 charges: the unmodified-pack preflight passes.
      nextTurn();
      const first = must('use_item', {
        instanceId: id,
        operationId: 'call-rat-swarms',
        args: { costs: { charges: 2 } },
      });
      expect(remaining()).toBe(1);
      const credit = (
        first.data as {
          hint?: {
            bindCredits?: {
              creditId: string;
              grantIds: string[];
              boundedCounts?: { grantId: string; max: number }[];
            }[];
          };
        }
      ).hint?.bindCredits?.[0];
      expect(credit).toMatchObject({
        grantIds: ['called-rat-swarms'],
        boundedCounts: [{ grantId: 'called-rat-swarms', max: 2 }],
      });
      const creditId = credit?.creditId as string;
      expect(credits()).toMatchObject([
        { credit_id: creditId, spent_amount: 2, redeemed_effect_id: null },
      ]);

      // The upper bound is the ENGINE's recorded spend: no credit named, a
      // third swarm, and a credit with no recorded spend are all refused and
      // leave the credit open.
      const unnamed = bind('fx-unnamed', [0, 1], undefined);
      expect(unnamed).toMatchObject({ ok: false });
      expect(unnamed.message).toMatch(/upper bound[\s\S]*source\.bindCreditId/);
      const third = bind('fx-third', [0, 1, 2], creditId);
      expect(third).toMatchObject({ ok: false });
      expect(third.message).toMatch(/at most 2[\s\S]*3 linked actor/);
      db.prepare('UPDATE item_grant_bind_credit SET spent_amount = NULL').run();
      const unrecorded = bind('fx-unrecorded', [0, 1], creditId);
      expect(unrecorded).toMatchObject({ ok: false });
      expect(unrecorded.message).toMatch(/records no spend/);
      db.prepare('UPDATE item_grant_bind_credit SET spent_amount = 2').run();
      expect(credits()[0]?.redeemed_effect_id).toBeNull();

      // Two swarms bind; the use is redeemed and cannot pay again.
      const bound = bind('fx-swarms', [0, 1], creditId);
      expect(bound, bound.message).toMatchObject({ ok: true });
      expect(credits()[0]?.redeemed_effect_id).toBe('fx-swarms');
      expect(bind('fx-again', [2], creditId)).toMatchObject({ ok: false });

      // A 2-charge spend with 1 remaining is refused and changes nothing.
      nextTurn();
      const refused = use(2);
      expect(refused).toMatchObject({ ok: false });
      expect(remaining()).toBe(1);
      expect(credits()).toHaveLength(1);

      // Crossing dawn regains 1d3, capped at 3.
      const dawn = must('advance_time', { minutes: 1440 });
      const resets = (
        dawn.data as {
          itemResets?: {
            packRef: string;
            economy: string;
            event: string;
            maximum: number;
            previousRemaining: number;
            remaining: number;
            roll?: { notation: string; total: number };
          }[];
        }
      ).itemResets;
      expect(resets).toHaveLength(1);
      const [evidence] = resets ?? [];
      expect(evidence).toMatchObject({
        packRef: PIPES,
        economy: 'charges',
        event: 'dawn',
        maximum: 3,
        previousRemaining: 1,
      });
      expect(evidence?.roll?.notation).toBe('1d3');
      expect(evidence?.remaining).toBe(
        Math.min(1 + (evidence?.roll?.total ?? 0), 3),
      );
      expect(remaining()).toBe(evidence?.remaining);

      // Binding NONE is legitimate: the GM ruled too few rats answered, so the
      // charge is wasted and the use is still redeemed.
      nextTurn();
      must('use_item', {
        instanceId: id,
        operationId: 'call-rat-swarms',
        args: { costs: { charges: 1 } },
      });
      const secondCredit = credits()[1]?.credit_id as string;
      const none = bind('fx-none', [], secondCredit);
      expect(none, none.message).toMatchObject({ ok: true });
      expect(credits()[1]?.redeemed_effect_id).toBe('fx-none');

      // The printed text gives no ending: the DM ends a swarm with end_effect,
      // which closes the link to its creatures.
      const linksOf = (effectId: string) =>
        db
          .prepare(
            "SELECT status FROM active_effect_link WHERE effect_id = ? AND link_kind = 'actor'",
          )
          .all(effectId) as { status: string }[];
      expect(linksOf('fx-swarms').map((link) => link.status)).toEqual([
        'active',
        'active',
      ]);
      must('end_effect', {
        effectId: 'fx-swarms',
        reason: 'ruled',
        note: 'the swarms scattered',
      });
      expect(
        linksOf('fx-swarms').every((link) => link.status !== 'active'),
      ).toBe(true);
      const ended = listActiveEffects(db, DEFAULT_TEST_CAMPAIGN_ID, {
        includeEnded: true,
      }).find((effect) => effect.effectId === 'fx-swarms');
      expect(ended?.status).toBe('ended');
    } finally {
      db.close();
    }
  });

  it('caps the Pipes dawn regain at 3 whatever the 1d3 rolls (real record)', () => {
    const record = pack.records.find((entry) => entry.key === PIPES);
    if (record === undefined) throw new Error('bundled pack has no Pipes');
    const rolls = new Set<number>();
    for (let seed = 1; seed <= 12; seed += 1) {
      const db = freshDbWithSession();
      try {
        const item = giveItem(
          db,
          { id: 'pipes', name: 'Pipes of the Sewers', packRef: PIPES },
          CTX,
        );
        holdItem(db, { ...CTX, itemId: item.id });
        writeItemState(
          db,
          item.id,
          {
            ...createInitialItemState(PIPES, record),
            economies: { charges: { remaining: 1 } },
          },
          CTX,
        );
        const reset = advanceWorldTime(db, {
          ...CTX,
          minutes: 360,
          rng: createSeededRng(seed),
          resolveRulesPack: () => pack,
        });
        const [evidence] = reset.itemResets;
        const total = evidence?.roll?.total ?? 0;
        rolls.add(total);
        expect(evidence?.remaining).toBe(Math.min(1 + total, 3));
        expect(readItemState(db, item.id)?.economies?.charges?.remaining).toBe(
          evidence?.remaining,
        );
      } finally {
        db.close();
      }
    }
    // The seeds exercise an uncapped regain and the cap itself (1 + 3 > 3).
    expect(rolls.has(1)).toBe(true);
    expect(rolls.has(3)).toBe(true);
  });
});
