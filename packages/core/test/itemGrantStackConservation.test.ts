/** eshyra-o9bd.16.10.1 (audit L4-F1): conservation over multi-unit
 * consumption. Every successfully consumed unit of a stacked, grant-bearing
 * consumable keeps exactly one redeemable entitlement (SRD p.220: each broken
 * Elemental Gem summons its own elemental), whether the DM binds as it goes or
 * only after several paid uses, and across destruction of the final row. The
 * (quantity + 1)th bind is always refused, and no consumed id is reissued.
 * Real Elemental Gem on the unmodified bundled pack. */
import { describe, expect, it } from 'vitest';
import {
  createDefaultToolRegistry,
  createSeededRng,
  getBundledDnd5eSrdPack,
} from '../src/internal.js';
import { freshDbWithSession } from './support/db.js';

const pack = getBundledDnd5eSrdPack();
const ELEMENTALS: readonly (readonly [string, string])[] = [
  ['blue-sapphire', 'air'],
  ['yellow-diamond', 'earth'],
  ['red-corundum', 'fire'],
  ['emerald', 'water'],
];

type Order = 'bind-as-you-go' | 'use-all-then-bind';

function run(variant: string, element: string, quantity: number, order: Order) {
  const db = freshDbWithSession();
  const registry = createDefaultToolRegistry();
  const ctx = {
    db,
    rng: createSeededRng(8),
    campaignId: 'campaign-1',
    sessionId: 'session-1',
    turnId: 'l4-gems',
    at: '2026-11-01T01:00:00.000Z',
    resolveRulesPack: () => pack,
  } as never;
  const call = (name: string, args: Record<string, unknown>) =>
    registry.invoke(name, args, ctx) as {
      ok: boolean;
      message?: string;
      data?: Record<string, unknown>;
    };
  const must = (name: string, args: Record<string, unknown>) => {
    const r = call(name, args);
    if (!r.ok) throw new Error(`${name}: ${r.message}`);
    return r.data as Record<string, unknown>;
  };
  const id = String(
    must('give_item', {
      id: 'gems',
      name: 'gems',
      packRef: 'magic-item:elemental-gem',
      variantId: variant,
      quantity,
    }).id,
  );
  // Combat suspends off-turn action spends, so each bind runs in its own
  // short encounter that is closed right after.
  const encounter = <T>(n: number, fn: () => T): T => {
    must('start_encounter', {
      combatInstanceId: `c${n}`,
      actors: [
        {
          actorId: `caster${n}`,
          rulesRef: 'creature:goblin',
          hpMax: 20,
          hpCurrent: 20,
          side: 'ally',
        },
        {
          actorId: `summon${n}`,
          rulesRef: `creature:${element}-elemental`,
          hpMax: 90,
          hpCurrent: 90,
          side: 'ally',
        },
      ],
    });
    const out = fn();
    must('close_combat_instance', {
      combatInstanceId: `c${n}`,
      status: 'completed',
    });
    return out;
  };
  let bound = 0;
  const bindIn = (n: number, itemId: string) => {
    const r = call('start_effect', {
      effectId: `gem${n}`,
      kind: 'summoning',
      displayName: 'elemental',
      source: {
        kind: 'magic-item',
        ref: 'magic-item:elemental-gem',
        grantRef: `${variant}-elemental`,
        itemInstanceId: itemId,
      },
      concentrationOwner: { kind: 'combatant', ref: `c${n}-caster${n}` },
      actors: [{ combatantId: `c${n}-summon${n}` }],
    });
    return r;
  };
  const bind = (n: number) =>
    encounter(n, () => {
      const r = bindIn(n, id);
      if (r.ok) bound += 1;
      return r;
    });
  for (let i = 0; i < quantity; i++) {
    must('use_item', { instanceId: id, operationId: 'break-gem' });
    if (order === 'bind-as-you-go') expect(bind(i).ok).toBe(true);
  }
  if (order === 'use-all-then-bind')
    for (let i = 0; i < quantity; i++)
      expect(bind(i).ok, `bind ${i}`).toBe(true);
  const extra = bind(quantity);
  const openCredits = (
    db
      .prepare(
        'SELECT COUNT(*) AS n FROM item_grant_bind_credit WHERE redeemed_effect_id IS NULL',
      )
      .get() as { n: number }
  ).n;
  const openReceipts = (
    db
      .prepare(
        'SELECT COUNT(*) AS n FROM item_consumption_receipt WHERE redeemed_effect_id IS NULL',
      )
      .get() as { n: number }
  ).n;
  const reissued = String(
    must('give_item', {
      id: 'gems',
      name: 'gems2',
      packRef: 'magic-item:elemental-gem',
      variantId: variant,
      quantity: 1,
    }).id,
  );
  const reuseBind = encounter(quantity + 1, () =>
    bindIn(quantity + 1, reissued),
  );
  db.close();
  return { id, bound, extra, openCredits, openReceipts, reissued, reuseBind };
}

describe('stacked consumable grant conservation (L4-F1)', () => {
  for (const [variant, element] of ELEMENTALS)
    for (const quantity of [2, 3])
      for (const order of ['bind-as-you-go', 'use-all-then-bind'] as const)
        it(`${variant} x${quantity} (${order}): every consumed unit binds exactly once`, () => {
          const r = run(variant, element, quantity, order);
          expect(r.bound).toBe(quantity);
          expect(r.extra.ok).toBe(false);
          expect(r.openCredits).toBe(0);
          expect(r.openReceipts).toBe(0);
          // The consumed id is retired, never reissued, and an unused new
          // stack cannot redeem the consumed stack's entitlements.
          expect(r.reissued).not.toBe(r.id);
          expect(r.reuseBind.ok).toBe(false);
        });
});
