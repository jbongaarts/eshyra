/** eshyra-c58j: a grant-bearing item operation that is READY on the UNMODIFIED
 * bundled pack claims that the runtime owns its creature-grant lifecycle. Such
 * a claim must be backed by real-pack conformance with NO readiness waiver
 * (use_item, then the start_effect bind, identity and printed ending). This
 * gate fails the moment a grant operation becomes ready without being listed
 * here with that conformance.
 *
 * Horn of Valhalla blow-horn (eshyra-olc5.14): its berserker count is rolled
 * per use by the engine and enforced by the binder; the use -> roll -> bind
 * contract is driven on the unmodified pack in itemGrantRolledCount.test.ts.
 * Ring of Djinni Summoning summon-djinni (eshyra-olc5.15): its printed death
 * consequence is typed (the djinni-dies transition) and executed by
 * item_state_event, so the operation is ready; use -> bind -> death is driven on
 * the unmodified pack in itemStateEventNonmagical.test.ts.
 * The four elemental vessels and the Bag of Tricks (eshyra-7gkh.1) became ready
 * when the dawn per-day economy ('F5: per-period usage reset'; conformance in
 * itemPerDayDawnEconomy.test.ts) was landed; the vessels' typed count 1 was
 * certified by olc5.14 and the Bag's next-dawn ending is now engine-computed.
 * The Bag was held in the PR #690 review until its creature selection was bound
 * (eshyra-olc5.16.1: the color is the variant, the d8 is rolled by the engine
 * per use; the selection contract is in itemGrantBagOfTricks.test.ts). Their
 * use -> bind contract is driven below on the unmodified pack. */
import { describe, expect, it } from 'vitest';
import type { ToolContext } from '../src/internal.js';
import {
  createDefaultToolRegistry,
  createSeededRng,
  deriveItemOperationReadinessInput,
  getBundledDnd5eSrdPack,
  listActiveEffects,
  magicItemVariantDefinitions,
} from '../src/internal.js';
import { assertMagicItemOperationReady } from '../src/state/itemExecutionReadiness.js';
import {
  DEFAULT_TEST_CAMPAIGN_ID,
  DEFAULT_TEST_SESSION_ID,
  freshDbWithSession,
} from './support/db.js';

const pack = getBundledDnd5eSrdPack();
const BAG = 'magic-item:bag-of-tricks';
/** The gray Bag of Tricks table's 8 creatures, d8 row order. */
const GRAY = [
  'creature:weasel',
  'creature:giant-rat',
  'creature:badger',
  'creature:boar',
  'creature:panther',
  'creature:giant-badger',
  'creature:dire-wolf',
  'creature:giant-elk',
];
type Obj = Record<string, unknown>;

/** Operations of grant-bearing items that pass the readiness preflight on the
 * unmodified pack, enumerated from the pack (not hard-coded). */
function readyGrantOperations(): string[] {
  const ready: string[] = [];
  for (const record of pack.records) {
    if (record.kind !== 'magic-item') continue;
    const mechanics = (record.data as Obj).mechanics as Obj | undefined;
    if (mechanics?.entityGrant === undefined) continue;
    const ids = new Set<string>(['activate', 'deactivate']);
    for (const operation of (mechanics.operations ?? []) as Obj[])
      ids.add(String(operation.id));
    const variants = magicItemVariantDefinitions(record);
    const variantIds: (string | undefined)[] =
      variants.length === 0 ? [undefined] : variants.map(({ id }) => id);
    for (const variantId of variantIds)
      for (const operationId of ids) {
        try {
          assertMagicItemOperationReady(
            record,
            variantId,
            deriveItemOperationReadinessInput(record, variantId, operationId),
          );
          ready.push(`${record.key}|${operationId}`);
        } catch {
          // not ready
        }
      }
  }
  return [...new Set(ready)].sort();
}

/** Grant operations with real-pack, no-waiver conformance coverage. */
const CONFORMANCE_BACKED: readonly string[] = [
  // itemGrantRolledCount.test.ts (no readiness waiver)
  'magic-item:horn-of-valhalla|blow-horn',
  // itemStateEventNonmagical.test.ts (no readiness waiver): use -> bind -> the
  // djinni dies -> nonmagical; contrasted with ordinary endings
  'magic-item:ring-of-djinni-summoning|summon-djinni',
  // itemGrantBagOfTricks.test.ts (no readiness waiver): the bag's color is the
  // variant, the d8 creature is rolled by the engine per use and bound by the
  // binder (eshyra-olc5.16.1).
  'magic-item:bag-of-tricks|pull-fuzzy-object',
  // itemGrantElementalGem.test.ts (no readiness waiver): per-instance gem
  // variant selects exactly one owned, as-spell creature grant.
  'magic-item:elemental-gem|break-gem',
  // eshyra-7gkh.1 (below, no readiness waiver): use -> bind on the real pack.
  'magic-item:bowl-of-commanding-water-elementals|summon-water-elemental',
  'magic-item:brazier-of-commanding-fire-elementals|summon-fire-elemental',
  'magic-item:censer-of-controlling-air-elementals|summon-air-elemental',
  'magic-item:stone-of-controlling-earth-elementals|summon-earth-elemental',
];

describe('eshyra-c58j real-pack readiness gate for creature-grant operations', () => {
  it('no grant-bearing operation is ready without unwaived conformance coverage', () => {
    expect(readyGrantOperations()).toEqual([...CONFORMANCE_BACKED].sort());
  });
});

const NOW = '2026-10-26T10:00:00.000Z';

function setup(creatures: readonly string[]) {
  const db = freshDbWithSession();
  const registry = createDefaultToolRegistry();
  const ctx: ToolContext = {
    db,
    rng: createSeededRng(9),
    campaignId: DEFAULT_TEST_CAMPAIGN_ID,
    sessionId: DEFAULT_TEST_SESSION_ID,
    turnId: '7gkh-1',
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
  const useItem = (
    key: string,
    operationId: string,
    id = 'it-1',
    variantId?: string,
  ) => {
    const given = must('give_item', {
      id,
      name: key,
      packRef: key,
      ...(variantId === undefined ? {} : { variantId }),
    });
    const instanceId = (given.data as { id: string }).id;
    round += 1;
    must('begin_turn', { character: 'pc-1', round });
    must('use_item', { instanceId, operationId });
    return instanceId;
  };
  // A gray Bag of Tricks used once (its operation passes the unmodified pack):
  // the engine's d8 selects the creature the use's credit admits.
  const bagUse = (id = 'bag') => {
    const instanceId = (
      must('give_item', {
        id,
        name: 'magic-item:bag-of-tricks',
        packRef: 'magic-item:bag-of-tricks',
        variantId: 'gray',
      }).data as { id: string }
    ).id;
    round += 1;
    must('begin_turn', { character: 'pc-1', round });
    const used = must('use_item', {
      instanceId,
      operationId: 'pull-fuzzy-object',
    });
    const credit = (
      used.data as {
        hint: {
          bindCredits: {
            creditId: string;
            rolledCreatures: { creatureRef: string }[];
          }[];
        };
      }
    ).hint.bindCredits[0];
    const creatureRef = credit?.rolledCreatures[0]?.creatureRef as string;
    return {
      instanceId,
      creditId: credit?.creditId as string,
      creatureRef,
      combatantId: `c-m${creatures.indexOf(creatureRef)}`,
    };
  };
  const effect = (effectId: string) =>
    listActiveEffects(db, DEFAULT_TEST_CAMPAIGN_ID, {
      includeEnded: true,
    }).find((row) => row.effectId === effectId);
  return { db, call, must, useItem, bagUse, effect };
}

const VESSELS = [
  [
    'magic-item:bowl-of-commanding-water-elementals',
    'summon-water-elemental',
    'water-elemental',
    'creature:water-elemental',
  ],
  [
    'magic-item:brazier-of-commanding-fire-elementals',
    'summon-fire-elemental',
    'fire-elemental',
    'creature:fire-elemental',
  ],
  [
    'magic-item:censer-of-controlling-air-elementals',
    'summon-air-elemental',
    'air-elemental',
    'creature:air-elemental',
  ],
  [
    'magic-item:stone-of-controlling-earth-elementals',
    'summon-earth-elemental',
    'earth-elemental',
    'creature:earth-elemental',
  ],
] as const;

describe('eshyra-7gkh.1 real-pack, no-waiver bind of the newly ready grant operations', () => {
  it('each elemental vessel: use_item passes the unmodified pack, then start_effect binds its single elemental on the printed one-hour timer', () => {
    for (const [key, operationId, grantRef, creature] of VESSELS) {
      const s = setup([creature]);
      const instanceId = s.useItem(key, operationId);
      const bound = s.call('start_effect', {
        effectId: 'fx-vessel',
        kind: 'summoning',
        displayName: grantRef,
        source: {
          kind: 'magic-item',
          ref: key,
          grantRef,
          itemInstanceId: instanceId,
        },
        actors: [{ combatantId: 'c-m0' }],
        concentrationOwner: { kind: 'combatant', ref: 'c-wiz' },
      });
      expect(bound, `${key}: ${bound.message}`).toMatchObject({ ok: true });
      expect(s.effect('fx-vessel')).toMatchObject({ status: 'active' });
      s.db.close();
    }
  });

  it('Elemental Gem: emerald use consumes a typed receipt and binds only its water elemental with concentration', () => {
    const s = setup(['creature:water-elemental', 'creature:fire-elemental']);
    const instanceId = s.useItem(
      'magic-item:elemental-gem',
      'break-gem',
      'emerald-gem',
      'emerald',
    );
    expect(
      s.db
        .prepare(
          'SELECT variant_id, operation_id FROM item_consumption_receipt WHERE item_instance_id = ?',
        )
        .get(instanceId),
    ).toEqual({ variant_id: 'emerald', operation_id: 'break-gem' });
    const bound = s.call('start_effect', {
      effectId: 'fx-emerald',
      kind: 'summoning',
      displayName: 'emerald-elemental',
      source: {
        kind: 'magic-item',
        ref: 'magic-item:elemental-gem',
        grantRef: 'emerald-elemental',
        itemInstanceId: instanceId,
      },
      actors: [{ combatantId: 'c-m0' }],
      concentrationOwner: { kind: 'combatant', ref: 'c-wiz' },
    });
    expect(bound, bound.message).toMatchObject({ ok: true });
    expect(s.effect('fx-emerald')).toMatchObject({
      status: 'active',
      concentrationOwner: { kind: 'combatant', ref: 'c-wiz' },
      duration: {
        kind: 'timed',
        amount: 1,
        unit: 'hour',
        deadlineElapsedMinutes: 60,
      },
      itemGrant: {
        grantId: 'emerald-elemental',
        spellRef: 'spell:conjure-elemental',
      },
    });
    expect(
      s.call('start_effect', {
        effectId: 'fx-wrong-creature',
        kind: 'summoning',
        displayName: 'wrong',
        source: {
          kind: 'magic-item',
          ref: 'magic-item:elemental-gem',
          grantRef: 'emerald-elemental',
          itemInstanceId: instanceId,
        },
        actors: [{ combatantId: 'c-m1' }],
        concentrationOwner: { kind: 'combatant', ref: 'c-wiz' },
      }),
    ).toMatchObject({ ok: false });
    expect(
      s.call('start_effect', {
        effectId: 'fx-wrong-variant',
        kind: 'summoning',
        displayName: 'wrong',
        source: {
          kind: 'magic-item',
          ref: 'magic-item:elemental-gem',
          grantRef: 'red-corundum-elemental',
          itemInstanceId: instanceId,
        },
        actors: [{ combatantId: 'c-m1' }],
        concentrationOwner: { kind: 'combatant', ref: 'c-wiz' },
      }),
    ).toMatchObject({ ok: false });
    expect(
      s.call('start_effect', {
        effectId: 'fx-no-concentration',
        kind: 'summoning',
        displayName: 'no concentration',
        source: {
          kind: 'magic-item',
          ref: 'magic-item:elemental-gem',
          grantRef: 'emerald-elemental',
          itemInstanceId: instanceId,
        },
        actors: [{ combatantId: 'c-m0' }],
      }),
    ).toMatchObject({ ok: false });
    expect(
      s.call('start_effect', {
        effectId: 'fx-repeat',
        kind: 'summoning',
        displayName: 'repeat',
        source: {
          kind: 'magic-item',
          ref: 'magic-item:elemental-gem',
          grantRef: 'emerald-elemental',
          itemInstanceId: instanceId,
        },
        actors: [{ combatantId: 'c-m0' }],
        concentrationOwner: { kind: 'combatant', ref: 'c-wiz' },
      }),
    ).toMatchObject({ ok: false });
    const unspent = s.must('give_item', {
      id: 'unspent-gem',
      name: 'Elemental Gem',
      packRef: 'magic-item:elemental-gem',
      variantId: 'emerald',
    });
    const unspentId = (unspent.data as { id: string }).id;
    const noReceipt = s.call('start_effect', {
      effectId: 'fx-no-receipt',
      kind: 'summoning',
      displayName: 'unpaid',
      source: {
        kind: 'magic-item',
        ref: 'magic-item:elemental-gem',
        grantRef: 'emerald-elemental',
        itemInstanceId: unspentId,
      },
      actors: [{ combatantId: 'c-m0' }],
      concentrationOwner: { kind: 'combatant', ref: 'c-wiz' },
    });
    expect(noReceipt).toMatchObject({ ok: false });
    expect(noReceipt.message).toMatch(
      /use_item 'break-gem' first|consumption receipt/i,
    );
    s.db.close();
  });

  const bagBind = (
    s: ReturnType<typeof setup>,
    bag: ReturnType<ReturnType<typeof setup>['bagUse']>,
    effectId: string,
    extra: Record<string, unknown> = {},
  ) =>
    s.call('start_effect', {
      effectId,
      kind: 'summoning',
      displayName: effectId,
      source: {
        kind: 'magic-item',
        ref: BAG,
        grantRef: 'gray-bag-creature',
        itemInstanceId: bag.instanceId,
        bindCreditId: bag.creditId,
      },
      actors: [{ combatantId: bag.combatantId }],
      ...extra,
    });

  it('Bag of Tricks: the grant ends at the first dawn after the bind, is still active on an advance that stops before dawn, and the engine fills the duration', () => {
    const s = setup(GRAY);
    const bag = s.bagUse();
    // The clock is at minute 0 (midnight): the next dawn is minute 360. A
    // DM-supplied until-removed lifetime or override is refused: the engine
    // computes this ending.
    const unremoved = bagBind(s, bag, 'fx-refused', {
      duration: { kind: 'until-removed' },
    });
    expect(unremoved).toMatchObject({ ok: false });
    expect(unremoved.message).toMatch(/exactly 360 minute/);
    const overridden = bagBind(s, bag, 'fx-override', {
      duration: {
        kind: 'timed',
        amount: 5,
        unit: 'minute',
        anchor: 'effect-created',
      },
      durationOverride: { basis: 'dm-adjudicated', reason: 'longer night' },
    });
    expect(overridden).toMatchObject({ ok: false });
    const bound = bagBind(s, bag, 'fx-bag');
    expect(bound, bound.message).toMatchObject({ ok: true });
    expect(s.effect('fx-bag')).toMatchObject({
      status: 'active',
      duration: {
        kind: 'timed',
        amount: 360,
        unit: 'minute',
        deadlineElapsedMinutes: 360,
      },
    });

    // An advance that stops one minute before dawn leaves it active ...
    s.must('advance_time', { minutes: 359 });
    expect(s.effect('fx-bag')).toMatchObject({ status: 'active' });
    // ... and the dawn boundary ends it (the same minute the uses reset).
    s.must('advance_time', { minutes: 1 });
    expect(s.effect('fx-bag')).toMatchObject({
      status: 'ended',
      endReason: 'expired',
    });
    s.db.close();
  });

  it('Bag of Tricks: bound exactly at a dawn, the next dawn is a day later (strictly after)', () => {
    const s = setup(GRAY);
    s.must('advance_time', { minutes: 360 });
    const bag = s.bagUse();
    const bound = bagBind(s, bag, 'fx-bag-dawn');
    expect(bound, bound.message).toMatchObject({ ok: true });
    expect(s.effect('fx-bag-dawn')).toMatchObject({
      duration: { amount: 1440, unit: 'minute', deadlineElapsedMinutes: 1800 },
    });
    s.must('advance_time', { minutes: 1439 });
    expect(s.effect('fx-bag-dawn')).toMatchObject({ status: 'active' });
    s.must('advance_time', { minutes: 1 });
    expect(s.effect('fx-bag-dawn')).toMatchObject({ status: 'ended' });
    s.db.close();
  });

  it('Bag of Tricks: the 0-hit-point ending is unchanged (the creature vanishes before dawn)', () => {
    const s = setup(GRAY);
    const bag = s.bagUse();
    expect(bagBind(s, bag, 'fx-bag-hp')).toMatchObject({ ok: true });
    s.must('update_combatant', {
      combatantId: bag.combatantId,
      hpDelta: -1000,
    });
    expect(s.effect('fx-bag-hp')).toMatchObject({ status: 'ended' });
    s.db.close();
  });
});

/** PR #690 review: an encounter-combatant summon whose lifetime is longer than
 *  rounds outlives combat closure, so its creature must hold a durable campaign
 *  identity; an instance-only combatant would be released by closure and its
 *  printed ending could never remove it. The two printed endings are distinct:
 *  the Bag's engine-computed next dawn and a vessel's one hour under
 *  character-owned concentration (which survives closure). */
describe('PR #690 review: a newly ready summon keeps its creature through combat closure until its printed ending', () => {
  const actorStatus = (s: ReturnType<typeof setup>, actorId: string) =>
    (
      s.db
        .prepare(
          'SELECT status FROM campaign_actor WHERE campaign_id = ? AND actor_id = ?',
        )
        .get(DEFAULT_TEST_CAMPAIGN_ID, actorId) as { status: string }
    ).status;
  const activeActorLink = (
    s: ReturnType<typeof setup>,
    effectId: string,
    actorId: string,
  ) =>
    s
      .effect(effectId)
      ?.links.some(
        (link) =>
          link.linkKind === 'actor' &&
          link.target.kind === 'campaign_actor' &&
          link.target.ref === actorId &&
          link.status === 'active',
      ) ?? false;
  const CASES = [
    {
      name: 'Bag of Tricks (next dawn)',
      key: 'magic-item:bag-of-tricks',
      operationId: 'pull-fuzzy-object',
      grantRef: 'gray-bag-creature',
      creature: 'creature:weasel',
      extra: {},
      deadline: 360,
      paid: 'bag',
    },
    {
      name: 'Bowl of Commanding Water Elementals (one hour, character concentration)',
      key: 'magic-item:bowl-of-commanding-water-elementals',
      operationId: 'summon-water-elemental',
      grantRef: 'water-elemental',
      creature: 'creature:water-elemental',
      extra: { concentrationOwner: { kind: 'character', ref: 'pc-1' } },
      deadline: 60,
      paid: 'use',
    },
  ] as const;
  for (const c of CASES) {
    it(`${c.name}: an instance-only creature is refused; a durable one survives closure and its printed ending removes it`, () => {
      const s = setup(c.paid === 'bag' ? GRAY : [c.creature]);
      const bag = c.paid === 'bag' ? s.bagUse() : undefined;
      const instanceId = bag?.instanceId ?? s.useItem(c.key, c.operationId);
      const creature = bag?.creatureRef ?? c.creature;
      const durable = bag?.combatantId ?? 'c-m0';
      const durableActor = durable.slice('c-'.length);
      const source = {
        kind: 'magic-item',
        ref: c.key,
        grantRef: c.grantRef,
        itemInstanceId: instanceId,
        ...(bag === undefined ? {} : { bindCreditId: bag.creditId }),
      };
      const joined = s.must('join_combat', {
        creatures: [{ rulesRef: creature, side: 'ally', displayLabel: 'x' }],
      }) as unknown as { data: { joined: { combatantId: string }[] } };
      const instanceOnly = joined.data.joined[0]?.combatantId as string;
      const refused = s.call('start_effect', {
        effectId: 'fx-instance-only',
        kind: 'summoning',
        displayName: 'instance only',
        source,
        actors: [{ combatantId: instanceOnly }],
        ...c.extra,
      });
      expect(refused).toMatchObject({ ok: false });
      expect(refused.message).toMatch(/needs campaignActorId/);

      // The durable combatant is a campaign actor.
      const bound = s.call('start_effect', {
        effectId: 'fx-durable',
        kind: 'summoning',
        displayName: 'durable',
        source,
        actors: [{ combatantId: durable }],
        ...c.extra,
      });
      expect(bound, bound.message).toMatchObject({ ok: true });
      expect(
        s.call('close_combat_instance', { status: 'completed' }),
      ).toMatchObject({ ok: true });
      // Closure is not a printed ending: the effect and its creature persist.
      expect(s.effect('fx-durable')).toMatchObject({ status: 'active' });
      expect(activeActorLink(s, 'fx-durable', durableActor)).toBe(true);
      expect(actorStatus(s, durableActor)).toBe('alive');

      s.must('advance_time', { minutes: c.deadline - 1 });
      expect(s.effect('fx-durable')).toMatchObject({ status: 'active' });
      expect(actorStatus(s, durableActor)).toBe('alive');
      // The printed ending removes the creature it owns.
      s.must('advance_time', { minutes: 1 });
      expect(s.effect('fx-durable')).toMatchObject({
        status: 'ended',
        endReason: 'expired',
      });
      expect(actorStatus(s, durableActor)).toBe('absent');
      s.db.close();
    });
  }
});
