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
 * Their use -> bind contract is driven below on the unmodified pack. */
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
  // eshyra-7gkh.1 (below, no readiness waiver): use -> bind on the real pack.
  'magic-item:bag-of-tricks|pull-fuzzy-object',
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
  const useItem = (key: string, operationId: string, id = 'it-1') => {
    const given = must('give_item', {
      id,
      name: key,
      packRef: key,
    });
    const instanceId = (given.data as { id: string }).id;
    round += 1;
    must('begin_turn', { character: 'pc-1', round });
    must('use_item', { instanceId, operationId });
    return instanceId;
  };
  const effect = (effectId: string) =>
    listActiveEffects(db, DEFAULT_TEST_CAMPAIGN_ID, {
      includeEnded: true,
    }).find((row) => row.effectId === effectId);
  return { db, call, must, useItem, effect };
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

  it('Bag of Tricks: the grant ends at the first dawn after the bind, is still active on an advance that stops before dawn, and the engine fills the duration', () => {
    const key = 'magic-item:bag-of-tricks';
    const s = setup(['creature:weasel']);
    const instanceId = s.useItem(key, 'pull-fuzzy-object');
    const bind = (effectId: string, extra: Record<string, unknown> = {}) =>
      s.call('start_effect', {
        effectId,
        kind: 'summoning',
        displayName: effectId,
        source: {
          kind: 'magic-item',
          ref: key,
          grantRef: 'bag-creature',
          itemInstanceId: instanceId,
        },
        actors: [{ combatantId: 'c-m0' }],
        ...extra,
      });
    // The clock is at minute 0 (midnight): the next dawn is minute 360. A
    // DM-supplied until-removed lifetime or override is refused: the engine
    // computes this ending.
    const unremoved = bind('fx-refused', {
      duration: { kind: 'until-removed' },
    });
    expect(unremoved).toMatchObject({ ok: false });
    expect(unremoved.message).toMatch(/exactly 360 minute/);
    const overridden = bind('fx-override', {
      duration: {
        kind: 'timed',
        amount: 5,
        unit: 'minute',
        anchor: 'effect-created',
      },
      durationOverride: { basis: 'dm-adjudicated', reason: 'longer night' },
    });
    expect(overridden).toMatchObject({ ok: false });
    const bound = bind('fx-bag');
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
    const key = 'magic-item:bag-of-tricks';
    const s = setup(['creature:weasel']);
    s.must('advance_time', { minutes: 360 });
    const instanceId = s.useItem(key, 'pull-fuzzy-object');
    const bound = s.call('start_effect', {
      effectId: 'fx-bag-dawn',
      kind: 'summoning',
      displayName: 'fx-bag-dawn',
      source: {
        kind: 'magic-item',
        ref: key,
        grantRef: 'bag-creature',
        itemInstanceId: instanceId,
      },
      actors: [{ combatantId: 'c-m0' }],
    });
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
    const key = 'magic-item:bag-of-tricks';
    const s = setup(['creature:weasel']);
    const instanceId = s.useItem(key, 'pull-fuzzy-object');
    s.must('start_effect', {
      effectId: 'fx-bag-hp',
      kind: 'summoning',
      displayName: 'fx-bag-hp',
      source: {
        kind: 'magic-item',
        ref: key,
        grantRef: 'bag-creature',
        itemInstanceId: instanceId,
      },
      actors: [{ combatantId: 'c-m0' }],
    });
    s.must('update_combatant', { combatantId: 'c-m0', hpDelta: -1000 });
    expect(s.effect('fx-bag-hp')).toMatchObject({ status: 'ended' });
    s.db.close();
  });
});
