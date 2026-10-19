/** eshyra-olc5.14: source-backed creature multiplicity at the use_item ->
 * start_effect grant-binding boundary, on the UNMODIFIED bundled pack with NO
 * readiness waiver.
 *
 *  - Horn of Valhalla: the horn's type is the instance's variant (silver,
 *    brass, bronze, iron). Each use makes the ENGINE roll that variant's
 *    printed count dice, persists the roll on the use's bind credit and shows
 *    it in the hint; start_effect binds exactly that many actors.
 *  - The four elemental vessels print ONE elemental (typed count 1). Their
 *    operations stay not-ready (c1-uses F5 reset, eshyra-7gkh), so the binder
 *    is reached with a credit issued directly, never through a waived pack. */
import { describe, expect, it } from 'vitest';
import type { ToolContext } from '../src/internal.js';
import {
  createDefaultToolRegistry,
  createSeededRng,
  getBundledDnd5eSrdPack,
} from '../src/internal.js';
import {
  issueItemGrantBindCredit,
  readItemGrantRolledCount,
} from '../src/state/itemGrantBinding.js';
import {
  DEFAULT_TEST_CAMPAIGN_ID,
  DEFAULT_TEST_SESSION_ID,
  freshDbWithSession,
} from './support/db.js';

const NOW = '2026-10-18T10:00:00.000Z';
const pack = getBundledDnd5eSrdPack();
const HORN = 'magic-item:horn-of-valhalla';
const WEEK = 10_080;

function setup(seed: number, creatures: number | readonly string[]) {
  const db = freshDbWithSession();
  const registry = createDefaultToolRegistry();
  const ctx: ToolContext = {
    db,
    rng: createSeededRng(seed),
    campaignId: DEFAULT_TEST_CAMPAIGN_ID,
    sessionId: DEFAULT_TEST_SESSION_ID,
    turnId: 'olc5-14',
    at: NOW,
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
      ...(typeof creatures === 'number'
        ? Array.from({ length: creatures }, () => 'creature:berserker')
        : creatures
      ).map((rulesRef, index) => ({
        actorId: `b${index}`,
        rulesRef,
        hpMax: 67,
        hpCurrent: 67,
        side: 'ally',
      })),
    ],
  });
  let round = 0;
  const nextTurn = () => {
    round += 1;
    must('begin_turn', { character: 'pc-1', round });
  };
  return { db, call, must, nextTurn };
}

type S = ReturnType<typeof setup>;

const blow = (s: S, instanceId: string) =>
  s.call('use_item', { instanceId, operationId: 'blow-horn' });
const rolledOf = (result: { data?: unknown }) =>
  (
    result.data as {
      hint?: {
        bindCredits?: {
          creditId: string;
          grantIds: string[];
          rolledCounts?: {
            grantId: string;
            notation: string;
            rolls: number[];
            modifier: number;
            total: number;
          }[];
        }[];
      };
    }
  ).hint?.bindCredits?.[0];
const bindHorn = (
  s: S,
  effectId: string,
  instanceId: string,
  grantRef: string,
  count: number,
  extra: Record<string, unknown> = {},
) =>
  s.call('start_effect', {
    effectId,
    kind: 'summoning',
    displayName: effectId,
    source: {
      kind: 'magic-item',
      ref: HORN,
      grantRef,
      itemInstanceId: instanceId,
    },
    actors: Array.from({ length: count }, (_, index) => ({
      combatantId: `c-b${index}`,
    })),
    ...extra,
  });

describe('Horn of Valhalla: the engine-rolled count is bound to the use', () => {
  it('rolls the variant row at use_item, persists it, and binds exactly that count', () => {
    const s = setup(11, 30);
    const given = s.must('give_item', {
      id: 'horn',
      name: 'Horn of Valhalla',
      packRef: HORN,
      variantId: 'silver',
    });
    const id = (given.data as { id: string }).id;
    s.nextTurn();

    const used = blow(s, id);
    expect(used, used.message).toMatchObject({ ok: true });
    const credit = rolledOf(used);
    const roll = credit?.rolledCounts?.[0];
    expect(credit?.grantIds).toEqual(['silver-berserkers']);
    expect(roll).toMatchObject({
      grantId: 'silver-berserkers',
      notation: '2d4+2',
      modifier: 2,
    });
    expect(roll?.rolls).toHaveLength(2);
    for (const die of roll?.rolls ?? []) {
      expect(die).toBeGreaterThanOrEqual(1);
      expect(die).toBeLessThanOrEqual(4);
    }
    const total = roll?.total as number;
    expect(total).toBe((roll?.rolls ?? []).reduce((a, b) => a + b, 0) + 2);

    // Persisted on the credit, reloaded identically (nothing re-rolls).
    expect(
      readItemGrantRolledCount(
        s.db,
        credit?.creditId as string,
        'silver-berserkers',
      ),
    ).toEqual(roll);

    // A mismatched count is refused and leaves the credit open.
    for (const wrong of [total - 1, total + 1]) {
      const refused = bindHorn(s, 'fx-wrong', id, 'silver-berserkers', wrong);
      expect(refused).toMatchObject({ ok: false });
      expect(refused.message).toMatch(
        new RegExp(`summons ${total} .*${wrong} linked actor`),
      );
    }
    // The grant of another horn type is not this instance's.
    const other = bindHorn(s, 'fx-other', id, 'iron-berserkers', total);
    expect(other).toMatchObject({ ok: false });
    expect(other.message).toMatch(/belongs to variant\(s\) iron/);

    // A caller-supplied count or roll is not accepted: the tool schema has no
    // such field and refuses it.
    const supplied = bindHorn(s, 'fx-supplied', id, 'silver-berserkers', 3, {
      count: 3,
      rolledCount: 3,
    });
    expect(supplied).toMatchObject({ ok: false });

    // The exact engine count binds.
    const bound = bindHorn(s, 'fx-ok', id, 'silver-berserkers', total);
    expect(bound, bound.message).toMatchObject({ ok: true });

    // One use pays for one bind.
    const again = bindHorn(s, 'fx-again', id, 'silver-berserkers', total);
    expect(again).toMatchObject({ ok: false });
    expect(again.message).toMatch(/holds no unredeemed use/);
  });

  it('refuses a bind against a credit with no recorded engine roll, or one that records another grant or notation', () => {
    const s = setup(5, 30);
    const id = (
      s.must('give_item', {
        id: 'horn',
        name: 'Horn of Valhalla',
        packRef: HORN,
        variantId: 'iron',
      }).data as { id: string }
    ).id;
    s.nextTurn();
    const roll = rolledOf(blow(s, id))?.rolledCounts?.[0];
    expect(roll).toMatchObject({ notation: '5d4+5' });
    const total = roll?.total as number;
    expect(total).toBeGreaterThanOrEqual(10);
    expect(total).toBeLessThanOrEqual(25);
    const stored = (
      s.db
        .prepare('SELECT rolled_counts_json FROM item_grant_bind_credit')
        .get() as { rolled_counts_json: string }
    ).rolled_counts_json;
    const setStored = (value: string | null) =>
      s.db
        .prepare('UPDATE item_grant_bind_credit SET rolled_counts_json = ?')
        .run(value);

    // No roll recorded (a credit predating the roll, or tampered).
    setStored(null);
    const none = bindHorn(s, 'fx-none', id, 'iron-berserkers', total);
    expect(none).toMatchObject({ ok: false });
    expect(none.message).toMatch(/records no engine roll/);
    // A roll attributed to another grant, or another notation, is unrelated.
    setStored(stored.replace('iron-berserkers', 'silver-berserkers'));
    expect(bindHorn(s, 'fx-g', id, 'iron-berserkers', total)).toMatchObject({
      ok: false,
    });
    setStored(stored.replace('5d4+5', '1d4'));
    expect(bindHorn(s, 'fx-n', id, 'iron-berserkers', total)).toMatchObject({
      ok: false,
    });
    expect(s.db.prepare('SELECT 1 FROM active_effect').get()).toBeUndefined();

    // Restored, the same bind succeeds.
    setStored(stored);
    expect(bindHorn(s, 'fx-ok', id, 'iron-berserkers', total)).toMatchObject({
      ok: true,
    });
  });

  it('rolls each use anew, deterministically for a seed, and a different variant uses its own dice', () => {
    const totals = (seed: number) => {
      const s = setup(seed, 30);
      const id = (
        s.must('give_item', {
          id: 'horn',
          name: 'Horn of Valhalla',
          packRef: HORN,
          variantId: 'bronze',
        }).data as { id: string }
      ).id;
      s.nextTurn();
      const first = rolledOf(blow(s, id))?.rolledCounts?.[0];
      expect(first?.notation).toBe('4d4+4');
      s.must('advance_time', { minutes: WEEK });
      s.nextTurn();
      const second = rolledOf(blow(s, id))?.rolledCounts?.[0];
      return [first?.rolls, second?.rolls];
    };
    expect(totals(21)).toEqual(totals(21));
  });

  it('fails closed for a horn with no established type', () => {
    const s = setup(3, 2);
    const refused = s.call('give_item', {
      id: 'horn',
      name: 'Horn of Valhalla',
      packRef: HORN,
    });
    expect(refused).toMatchObject({ ok: false });
    expect(refused.message).toMatch(/requires variantId/);

    // An already-held horn from before the variants existed (variant_id NULL)
    // cannot be used or bound.
    const s2 = setup(3, 2);
    const id = (
      s2.must('give_item', {
        id: 'horn',
        name: 'Horn of Valhalla',
        packRef: HORN,
        variantId: 'silver',
      }).data as { id: string }
    ).id;
    s2.db
      .prepare('UPDATE inventory SET variant_id = NULL WHERE id = ?')
      .run(id);
    s2.nextTurn();
    const used = blow(s2, id);
    expect(used.message).toMatch(/requires variantId/);
    expect(used).toMatchObject({ ok: false });
    expect(
      s2.db.prepare('SELECT 1 FROM item_grant_bind_credit').get(),
    ).toBeUndefined();
    const bound = bindHorn(s2, 'fx', id, 'silver-berserkers', 4);
    expect(bound).toMatchObject({ ok: false });
  });
});

describe('Elemental vessels: the printed single elemental is count 1', () => {
  const VESSELS = [
    ['magic-item:bowl-of-commanding-water-elementals', 'water-elemental'],
    ['magic-item:brazier-of-commanding-fire-elementals', 'fire-elemental'],
    ['magic-item:censer-of-controlling-air-elementals', 'air-elemental'],
    ['magic-item:stone-of-controlling-earth-elementals', 'earth-elemental'],
  ] as const;

  for (const [key, grantId] of VESSELS) {
    it(`${key}: one elemental binds, two are refused`, () => {
      const s = setup(2, [`creature:${grantId}`, `creature:${grantId}`]);
      const record = pack.records.find((r) => r.key === key);
      const given = s.must('give_item', {
        id: 'vessel',
        name: record?.name,
        packRef: key,
      });
      const id = (given.data as { id: string }).id;
      // Binder-level: the vessel operation is not ready (c1-uses F5 reset,
      // eshyra-7gkh), so the credit the use would issue is issued directly.
      issueItemGrantBindCredit(s.db, {
        campaignId: DEFAULT_TEST_CAMPAIGN_ID,
        itemInstanceId: id,
        packRef: key,
        variantId: undefined,
        economyId: 'uses',
        operationId: 'direct',
        issuedAt: NOW,
        issuedElapsedMinutes: 0,
        provenance: 'test:olc5-14',
        sessionId: DEFAULT_TEST_SESSION_ID,
      });
      const start = (effectId: string, combatants: string[]) =>
        s.call('start_effect', {
          effectId,
          kind: 'summoning',
          displayName: effectId,
          source: {
            kind: 'magic-item',
            ref: key,
            grantRef: grantId,
            itemInstanceId: id,
          },
          actors: combatants.map((combatantId) => ({ combatantId })),
          concentrationOwner: { kind: 'combatant', ref: 'c-pc' },
        });
      const two = start('fx-two', ['c-b0', 'c-b1']);
      expect(two).toMatchObject({ ok: false });
      expect(two.message).toMatch(/creates 1; 2 linked actor/);
      const one = start('fx-one', ['c-b0']);
      expect(one, one.message).toMatchObject({ ok: true });
    });
  }
});
