/** olc5.12.3 + eshyra-xt6m: a grant naming a NON-anchored cooldownEconomy binds
 * only against a bind credit that a completed use_item issued by charging that
 * economy. Every carrier is enumerated from the bundled pack and driven through
 * its real spending operation. Readiness is waived for the carriers (the
 * F-hooks stay unlanded; eshyra-c58j owns that gate), following the precedent
 * in itemGrantConsumptionReceipt.test.ts. Anchored grants (Ring of Djinni,
 * Efreeti Bottle) keep their coupling and are covered by itemGrantSummons. */
import { describe, expect, it } from 'vitest';
import type { ToolContext } from '../src/internal.js';
import {
  createDefaultToolRegistry,
  createSeededRng,
  effectiveMagicItemMechanics,
  getBundledDnd5eSrdPack,
  listActiveEffects,
} from '../src/internal.js';
import { magicItemVariantDefinitions } from '../src/rules/magicItemVariants.js';
import { grantCooldownAnchoredTo } from '../src/state/itemState.js';
import {
  DEFAULT_TEST_CAMPAIGN_ID,
  DEFAULT_TEST_SESSION_ID,
  freshDbWithSession,
} from './support/db.js';

const NOW = '2026-10-17T10:00:00.000Z';
const realPack = getBundledDnd5eSrdPack();

type Obj = Record<string, unknown>;
interface Carrier {
  readonly key: string;
  readonly name: string;
  readonly variantId: string | undefined;
  readonly grantId: string;
  readonly grantKind: string;
  readonly economyId: string;
  readonly operationId: string;
  readonly costAmount: number | 'variable';
  readonly stackKind: boolean;
  readonly requiresAttunement: boolean;
  readonly creature: string;
  readonly typedDuration: boolean;
  readonly concentration: boolean;
}

/** Every non-anchored cooldownEconomy grant of every variant, from the pack. */
function enumerateCarriers(): Carrier[] {
  const carriers: Carrier[] = [];
  for (const record of realPack.records) {
    if (!record.key.startsWith('magic-item:')) continue;
    const data = record.data as Obj;
    const variants = magicItemVariantDefinitions(record).map(
      (variant) => variant.id,
    );
    for (const variantId of variants.length === 0 ? [undefined] : variants) {
      const mechanics = effectiveMagicItemMechanics(record, variantId) as
        | Obj
        | undefined;
      const grants =
        ((mechanics?.entityGrant as Obj | undefined)?.grants as Obj[]) ?? [];
      for (const grant of grants) {
        if (typeof grant.cooldownEconomy !== 'string') continue;
        if (
          variantId !== undefined &&
          !((grant.variants as string[] | undefined) ?? []).includes(variantId)
        )
          continue;
        if (grantCooldownAnchoredTo(mechanics, grant)) continue;
        const economyId = grant.cooldownEconomy;
        const operation = ((mechanics?.operations as Obj[]) ?? []).find((op) =>
          ((op.cost as Obj[]) ?? []).some((cost) => cost.economy === economyId),
        );
        if (operation === undefined)
          throw new Error(
            `${record.key} has no operation spending ${economyId}`,
          );
        const cost = ((operation.cost as Obj[]) ?? []).find(
          (entry) => entry.economy === economyId,
        ) as Obj;
        const creatureRefs = (grant.creatureRefs as string[] | undefined) ?? [];
        carriers.push({
          key: record.key,
          name: record.name,
          variantId,
          grantId: grant.id as string,
          grantKind: grant.kind as string,
          economyId,
          operationId: operation.id as string,
          costAmount: cost.amount as number | 'variable',
          stackKind:
            ((mechanics?.economies ?? {}) as Record<string, Obj>)[economyId]
              ?.kind === 'single-use',
          requiresAttunement: data.requiresAttunement === true,
          creature: creatureRefs[0] ?? 'creature:weasel',
          typedDuration: grant.duration !== undefined,
          concentration:
            typeof grant.control === 'string' &&
            grant.control.startsWith('as spell:'),
        });
      }
    }
  }
  return carriers;
}
const CARRIERS = enumerateCarriers();

/** The bundled pack with every carrier's readiness waived (clauses green plus a
 *  green clause for each operation effect the real pack prints none for). */
const WAIVED = new Set(CARRIERS.map((carrier) => carrier.key));
const pack = {
  ...realPack,
  records: realPack.records.map((record) => {
    if (!WAIVED.has(record.key)) return record;
    const data = record.data as Obj;
    const readiness = data.executionReadiness as { clauses: Obj[] };
    const operations = (
      data.mechanics as { operations: { effects?: string[] }[] }
    ).operations;
    const effectIds = operations.flatMap(
      (operation) => operation.effects ?? [],
    );
    return {
      ...record,
      data: {
        ...data,
        executionReadiness: {
          ...readiness,
          clauses: [
            ...readiness.clauses.map((clause) => ({
              ...clause,
              readiness: 'green',
              missingHooks: undefined,
              missingEngines: undefined,
            })),
            ...effectIds.map((effectId) => ({
              clauseId: `waiver-${effectId}`,
              scope: { kind: 'parent' },
              readiness: 'green',
              representation: { block: 'effects', effectId },
            })),
          ],
        },
      },
    };
  }),
};

const WEEK = 10_080;

function setup(creatures: readonly string[] = []) {
  const db = freshDbWithSession();
  const registry = createDefaultToolRegistry();
  const ctx: ToolContext = {
    db,
    rng: createSeededRng(7),
    campaignId: DEFAULT_TEST_CAMPAIGN_ID,
    sessionId: DEFAULT_TEST_SESSION_ID,
    turnId: 'olc5-12-3',
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
        actorId: 'wiz',
        rulesRef: 'creature:goblin',
        hpMax: 20,
        hpCurrent: 20,
        side: 'ally',
      },
      ...creatures.map((rulesRef, index) => ({
        actorId: `m${index}`,
        rulesRef,
        hpMax: 300,
        hpCurrent: 300,
        side: 'ally',
      })),
    ],
  });
  let round = 0;
  const nextTurn = () => {
    round += 1;
    must('begin_turn', { character: 'pc-1', round });
  };
  const credits = () =>
    db
      .prepare(
        `SELECT credit_id, campaign_id, item_instance_id, economy_id,
                redeemed_effect_id FROM item_grant_bind_credit ORDER BY rowid`,
      )
      .all() as {
      credit_id: string;
      campaign_id: string;
      item_instance_id: string;
      economy_id: string;
      redeemed_effect_id: string | null;
    }[];
  const open = () => credits().filter((c) => c.redeemed_effect_id === null);
  const effects = () =>
    listActiveEffects(db, DEFAULT_TEST_CAMPAIGN_ID, { includeEnded: true });
  /** Returns the instance id the engine issued (stateful items get '<base>#n'). */
  const give = (id: string, carrier: Carrier, quantity?: number): string => {
    const given = must('give_item', {
      id,
      name: carrier.name,
      packRef: carrier.key,
      ...(carrier.variantId === undefined
        ? {}
        : { variantId: carrier.variantId }),
      ...(quantity === undefined ? {} : { quantity }),
    });
    const issued = (given.data as { id: string }).id;
    if (carrier.requiresAttunement)
      must('attune_item', { character: 'pc-1', itemId: issued });
    return issued;
  };
  const use = (id: string, carrier: Carrier) =>
    call('use_item', {
      instanceId: id,
      operationId: carrier.operationId,
      ...(carrier.costAmount === 'variable'
        ? { args: { costs: { [carrier.economyId]: 1 } } }
        : {}),
    });
  const bind = (
    effectId: string,
    id: string,
    carrier: Carrier,
    combatant = 'c-m0',
  ) =>
    call('start_effect', {
      effectId,
      kind: 'summoning',
      displayName: effectId,
      source: {
        kind: 'magic-item',
        ref: carrier.key,
        grantRef: carrier.grantId,
        itemInstanceId: id,
      },
      actors: [{ combatantId: combatant }],
      ...(carrier.typedDuration ? {} : { duration: { kind: 'until-removed' } }),
      ...(carrier.concentration
        ? { concentrationOwner: { kind: 'combatant', ref: 'c-wiz' } }
        : {}),
    });
  return { db, call, must, nextTurn, credits, open, effects, give, use, bind };
}

const hintOf = (result: { ok: boolean; data?: unknown }) =>
  (
    result.data as {
      hint?: {
        bindCredits?: {
          creditId: string;
          economyId: string;
          grantIds: string[];
        }[];
      };
    }
  ).hint;

describe('olc5.12.3 the pack carriers, enumerated from the pack', () => {
  it('finds the documented non-anchored grants', () => {
    expect([...new Set(CARRIERS.map((c) => c.key))].sort()).toEqual([
      'magic-item:bag-of-tricks',
      'magic-item:bowl-of-commanding-water-elementals',
      'magic-item:brazier-of-commanding-fire-elementals',
      'magic-item:censer-of-controlling-air-elementals',
      'magic-item:deck-of-illusions',
      'magic-item:elemental-gem',
      'magic-item:feather-token',
      'magic-item:figurine-of-wondrous-power',
      'magic-item:horn-of-valhalla',
      'magic-item:manual-of-golems',
      'magic-item:pipes-of-the-sewers',
      'magic-item:stone-of-controlling-earth-elementals',
    ]);
  });

  for (const carrier of CARRIERS) {
    const label = `${carrier.key}${carrier.variantId === undefined ? '' : `/${carrier.variantId}`} ${carrier.grantId}`;
    it(`${label}: no bind without a use; use_item then bind redeems exactly one credit; a second bind needs another use`, () => {
      const s = setup([carrier.creature, carrier.creature]);
      // Stack carriers (single-use economies) are held as a stack of three so each
      // of two uses leaves the surviving row; the rest are single stateful rows.
      const id = s.give('it-1', carrier, carrier.stackKind ? 3 : undefined);
      s.nextTurn();

      const early = s.bind('fx-early', id, carrier);
      expect(early).toMatchObject({ ok: false });
      if (carrier.grantKind === 'creature') {
        expect(early.message).toMatch(
          /holds no unredeemed use[\s\S]*ruling-sourced summoning/,
        );
        expect(early.message).toContain(
          `use_item '${carrier.operationId}' first`,
        );
      } else expect(early.message).toMatch(/DM-adjudicated/);
      expect(s.credits()).toEqual([]);

      const used = s.use(id, carrier);
      expect(used, used.message).toMatchObject({ ok: true });
      const hint = hintOf(used);

      if (carrier.grantKind !== 'creature') {
        // Illusion and object grants are DM-adjudicated: start_effect binds
        // creature grants only, so no credit is owed or advertised for them.
        for (const credit of hint?.bindCredits ?? [])
          expect(credit.grantIds).not.toContain(carrier.grantId);
        const refused = s.bind('fx-adjudicated', id, carrier);
        expect(refused).toMatchObject({ ok: false });
        expect(refused.message).toMatch(/DM-adjudicated/);
        return;
      }

      expect(hint?.bindCredits).toEqual([
        {
          creditId: `${id}:${carrier.operationId}:1`,
          economyId: carrier.economyId,
          grantIds: expect.arrayContaining([carrier.grantId]),
        },
      ]);
      expect(s.open()).toHaveLength(1);

      const bound = s.bind('fx-1', id, carrier);
      expect(bound, bound.message).toMatchObject({ ok: true });
      expect(s.open()).toEqual([]);
      expect(s.credits()).toMatchObject([
        {
          credit_id: `${id}:${carrier.operationId}:1`,
          redeemed_effect_id: 'fx-1',
        },
      ]);

      const again = s.bind('fx-2', id, carrier, 'c-m1');
      expect(again).toMatchObject({ ok: false });
      expect(again.message).toMatch(/holds no unredeemed use/);

      // Another use (a week later covers every per-day and cooldown reset)
      // pays for exactly one more bind.
      s.must('advance_time', { minutes: WEEK });
      s.nextTurn();
      expect(s.use(id, carrier)).toMatchObject({ ok: true });
      expect(s.open()).toHaveLength(1);
      expect(s.bind('fx-2', id, carrier, 'c-m1')).toMatchObject({
        ok: true,
      });
      expect(s.open()).toEqual([]);
    });
  }
});

describe('olc5.12.3 credit ordering and scoping', () => {
  const bag = CARRIERS.find(
    (c) => c.key === 'magic-item:bag-of-tricks',
  ) as Carrier;

  it('two uses then two binds succeed, the oldest credit redeems first, a third bind is refused', () => {
    const s = setup([bag.creature, bag.creature, bag.creature]);
    const bag1 = s.give('bag-1', bag);
    s.nextTurn();
    expect(s.use(bag1, bag)).toMatchObject({ ok: true });
    s.nextTurn();
    const second = s.use(bag1, bag);
    expect(hintOf(second)?.bindCredits?.[0]?.creditId).toBe(
      `${bag1}:${bag.operationId}:2`,
    );
    expect(s.bind('fx-a', bag1, bag, 'c-m0')).toMatchObject({ ok: true });
    expect(s.credits().map((c) => [c.credit_id, c.redeemed_effect_id])).toEqual(
      [
        [`${bag1}:${bag.operationId}:1`, 'fx-a'],
        [`${bag1}:${bag.operationId}:2`, null],
      ],
    );
    expect(s.bind('fx-b', bag1, bag, 'c-m1')).toMatchObject({ ok: true });
    expect(s.open()).toEqual([]);
    expect(s.bind('fx-c', bag1, bag, 'c-m2')).toMatchObject({ ok: false });
    // A refused use (the third pull is the last of three, a fourth is not)
    // issues no credit.
    s.nextTurn();
    expect(s.use(bag1, bag)).toMatchObject({ ok: true });
    s.nextTurn();
    expect(s.use(bag1, bag)).toMatchObject({ ok: false });
    expect(s.credits()).toHaveLength(3);
  });

  it('refuses a credit of the wrong campaign, instance or economy, and a refused insert leaves it unredeemed', () => {
    const s = setup([bag.creature, 'creature:djinni']);
    const bag1 = s.give('bag-1', bag);
    const bag2 = s.give('bag-2', bag);
    s.nextTurn();
    expect(s.use(bag1, bag)).toMatchObject({ ok: true });
    // Wrong instance: the credit belongs to bag-1.
    expect(s.bind('fx-i', bag2, bag)).toMatchObject({ ok: false });
    // Wrong campaign, then wrong economy: scoped columns do not match.
    for (const [column, value] of [
      ['campaign_id', 'other-campaign'],
      ['economy_id', 'some-other-economy'],
    ] as const) {
      const original = s.credits()[0]?.[column];
      s.db
        .prepare(`UPDATE item_grant_bind_credit SET ${column} = ?`)
        .run(value);
      expect(s.bind('fx-x', bag1, bag), column).toMatchObject({ ok: false });
      s.db
        .prepare(`UPDATE item_grant_bind_credit SET ${column} = ?`)
        .run(original);
    }
    // A creature the grant does not print is refused after the credit is read:
    // the credit stays open and the right creature then binds.
    const wrong = s.bind('fx-wrong', bag1, bag, 'c-m1');
    expect(wrong).toMatchObject({ ok: false });
    expect(s.open()).toHaveLength(1);
    expect(s.bind('fx-right', bag1, bag, 'c-m0')).toMatchObject({ ok: true });
    expect(s.open()).toEqual([]);
  });
  it('destroying the item voids its open credit, so a reissued id cannot redeem it', () => {
    const s = setup([bag.creature]);
    const bag1 = s.give('bag-1', bag);
    s.nextTurn();
    expect(s.use(bag1, bag)).toMatchObject({ ok: true });
    expect(s.open()).toHaveLength(1);
    s.must('remove_item', { id: bag1, disposition: 'destroyed' });
    expect(s.credits()).toEqual([]);
    // A new bag reusing the freed id owes nothing until it is itself used.
    const again = s.give(bag1, bag);
    expect(again).toBe(bag1);
    expect(s.bind('fx-stale', again, bag, 'c-m0')).toMatchObject({
      ok: false,
    });
  });
});

describe('olc5.12.3 credits respect grant-variant membership', () => {
  // The real figurine prints the goat-of-traveling hour economy and its
  // spending operation at the base, but the grant belongs to the ivory goats
  // only. A spend on any other variant must be owed no goat credit.
  const goat = CARRIERS.find(
    (c) => c.grantId === 'goat-of-traveling' && c.variantId === 'ivory-goats',
  ) as Carrier;

  it('an onyx dog spending the base goat economy gets no goat credit; an ivory goat does', () => {
    expect(goat).toBeDefined();
    const s = setup([goat.creature]);
    const dog = s.give('fig-dog', { ...goat, variantId: 'onyx-dog' });
    s.nextTurn();
    const spent = s.use(dog, { ...goat, variantId: 'onyx-dog' });
    // Whether or not the base operation is usable on this variant, it never
    // advertises or persists a goat credit.
    const hint = (
      spent.data as
        | { hint?: { bindCredits?: { grantIds: string[] }[] } }
        | undefined
    )?.hint;
    for (const credit of hint?.bindCredits ?? [])
      expect(credit.grantIds).not.toContain('goat-of-traveling');
    expect(s.credits()).toEqual([]);

    const ivory = s.give('fig-goat', goat);
    s.nextTurn();
    expect(s.use(ivory, goat)).toMatchObject({ ok: true });
    expect(s.open()).toHaveLength(1);
    expect(s.bind('fx-goat', ivory, goat)).toMatchObject({ ok: true });
    expect(s.open()).toEqual([]);
  });
});

describe('olc5.12.3 stacks of single-use carriers (eshyra-xt6m)', () => {
  const gem = CARRIERS.find(
    (c) => c.key === 'magic-item:elemental-gem',
  ) as Carrier;

  it('a 3-gem stack is used one unit at a time: credits on the surviving row, a receipt on the last unit', () => {
    const s = setup([
      'creature:water-elemental',
      'creature:fire-elemental',
      'creature:air-elemental',
    ]);
    s.give('gem-1', gem, 3);
    expect(
      s.db
        .prepare('SELECT 1 FROM item_state WHERE inventory_id=?')
        .get('gem-1'),
    ).toBeUndefined();
    const quantity = () =>
      (
        s.db
          .prepare('SELECT quantity FROM inventory WHERE id=?')
          .get('gem-1') as { quantity: number } | undefined
      )?.quantity;

    s.nextTurn();
    expect(s.use('gem-1', gem)).toMatchObject({ ok: true });
    expect(quantity()).toBe(2);
    expect(s.bind('fx-1', 'gem-1', gem, 'c-m0')).toMatchObject({ ok: true });

    s.nextTurn();
    expect(s.use('gem-1', gem)).toMatchObject({ ok: true });
    expect(quantity()).toBe(1);
    expect(s.bind('fx-2', 'gem-1', gem, 'c-m1')).toMatchObject({ ok: true });
    expect(s.open()).toEqual([]);
    expect(
      s.effects().find((e) => e.effectId === 'fx-1')?.itemGrant,
    ).not.toHaveProperty('sourceDestroyedAt');

    s.nextTurn();
    const last = s.use('gem-1', gem);
    expect(last).toMatchObject({ ok: true });
    expect(quantity()).toBeUndefined();
    // The destroying use is covered by the receipt: no credit, no bind hint.
    expect(hintOf(last)).toBeUndefined();
    expect(s.credits()).toHaveLength(2);
    expect(
      s.db
        .prepare('SELECT item_instance_id FROM item_consumption_receipt')
        .all(),
    ).toEqual([{ item_instance_id: 'gem-1' }]);
    expect(s.bind('fx-3', 'gem-1', gem, 'c-m2')).toMatchObject({ ok: true });

    // Attribution stays distinct: three effects, one per paid unit. Two
    // redeemed credits, one redeemed receipt. fx-3 is born tombstoned from its
    // receipt.
    expect(s.credits().map((c) => c.redeemed_effect_id)).toEqual([
      'fx-1',
      'fx-2',
    ]);
    expect(
      s.db
        .prepare('SELECT redeemed_effect_id FROM item_consumption_receipt')
        .get(),
    ).toEqual({ redeemed_effect_id: 'fx-3' });
    const grants = new Map(
      s.effects().map((e) => [e.effectId, e.itemGrant] as const),
    );
    expect(
      [...grants.keys()].filter((k) => !k.endsWith(':uncontrolled')).sort(),
    ).toEqual(['fx-1', 'fx-2', 'fx-3']);
    for (const effectId of ['fx-1', 'fx-2', 'fx-3'])
      expect(grants.get(effectId)).toMatchObject({
        grantId: 'gem-elemental',
        itemInstanceId: 'gem-1',
      });
    expect(grants.get('fx-3')).toMatchObject({ sourceDestroyedAt: NOW });
    // Receipt and credits are exhausted: nothing pays for a fourth bind.
    expect(s.bind('fx-4', 'gem-1', gem, 'c-m0')).toMatchObject({ ok: false });
  });
});
