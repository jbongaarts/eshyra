/** olc5.12.13: a consumed-source grant binds once through a consumption receipt
 * (user review R1), and a bound grant's identity is visible in the active-effect
 * view and the assembled DM context (R2). Real bundled pack throughout. */
import { describe, expect, it } from 'vitest';
import type { ToolContext } from '../src/internal.js';
import {
  assembleContext,
  createDefaultToolRegistry,
  createSeededRng,
  getBundledDnd5eSrdPack,
  giveItem,
  listActiveEffects,
  renderContextMessage,
} from '../src/internal.js';
import { writeItemConsumptionReceipt } from '../src/state/itemGrantBinding.js';
import {
  DEFAULT_TEST_CAMPAIGN_ID,
  DEFAULT_TEST_CAMPAIGN_POSITION,
  DEFAULT_TEST_SESSION_ID,
  freshDbWithSession,
} from './support/db.js';

const NOW = '2026-10-17T10:00:00.000Z';
const realPack = getBundledDnd5eSrdPack();

/** The bundled pack with the consumable carriers' readiness waived (every
 * clause green), the precedent itemGrantSummons.test.ts sets: the F-hooks stay
 * unlanded, so the readiness preflight would refuse the use step, while this
 * file exercises the receipt boundary itself. Grants and mechanics are real. */
const WAIVED = new Set([
  'magic-item:elemental-gem',
  'magic-item:feather-token',
]);
const pack = {
  ...realPack,
  records: realPack.records.map((record) => {
    if (!WAIVED.has(record.key)) return record;
    const data = record.data as Record<string, unknown>;
    const readiness = data.executionReadiness as {
      clauses: Record<string, unknown>[];
    };
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
            // The real pack prints no readiness clause for these operation
            // effects either; waive that gate too so the use step can run.
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
const GEM = 'magic-item:elemental-gem';
const TOKEN = 'magic-item:feather-token';
const FIGURINE = 'magic-item:figurine-of-wondrous-power';

function setup() {
  const db = freshDbWithSession();
  const registry = createDefaultToolRegistry();
  const ctx: ToolContext = {
    db,
    rng: createSeededRng(7),
    campaignId: DEFAULT_TEST_CAMPAIGN_ID,
    sessionId: DEFAULT_TEST_SESSION_ID,
    turnId: 'olc5-12-13',
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
  const actor = (actorId: string, rulesRef: string, hp: number) => ({
    actorId,
    rulesRef,
    hpMax: hp,
    hpCurrent: hp,
    side: 'ally',
  });
  must('start_encounter', {
    combatInstanceId: 'c',
    actors: [
      actor('wiz', 'creature:goblin', 20),
      actor('water', 'creature:water-elemental', 90),
      actor('fire', 'creature:fire-elemental', 102),
      actor('air', 'creature:air-elemental', 90),
      actor('earth', 'creature:earth-elemental', 126),
      actor('roc', 'creature:roc', 248),
      actor('dog-a', 'creature:mastiff', 5),
      actor('dog-b', 'creature:mastiff', 5),
    ],
  });
  must('begin_turn', { character: 'pc-1', round: 1 });
  const give = (
    id: string,
    packRef: string,
    options: { quantity?: number; variantId?: string; stateful?: boolean } = {},
  ) => {
    const record = pack.records.find((entry) => entry.key === packRef);
    if (record === undefined) throw new Error(`no ${packRef}`);
    return giveItem(
      db,
      {
        id,
        name: record.name,
        packRef,
        ...(options.quantity === undefined
          ? {}
          : { quantity: options.quantity }),
        ...(options.variantId === undefined
          ? {}
          : { variantId: options.variantId }),
        ...(options.stateful === undefined
          ? {}
          : { stateful: options.stateful }),
      },
      {
        characterId: 'pc-1',
        provenance: 'test:receipt',
        sessionId: DEFAULT_TEST_SESSION_ID,
        at: NOW,
      },
    ).id;
  };
  const effects = () =>
    listActiveEffects(db, DEFAULT_TEST_CAMPAIGN_ID, { includeEnded: true });
  const receipts = () =>
    db
      .prepare(
        'SELECT item_instance_id, campaign_id, redeemed_effect_id FROM item_consumption_receipt ORDER BY item_instance_id',
      )
      .all() as {
      item_instance_id: string;
      campaign_id: string;
      redeemed_effect_id: string | null;
    }[];
  return { db, call, must, give, effects, receipts };
}

const gemSource = (instanceId: string) => ({
  kind: 'magic-item',
  ref: GEM,
  grantRef: 'gem-elemental',
  itemInstanceId: instanceId,
});
const gemStart = (
  s: ReturnType<typeof setup>,
  effectId: string,
  instanceId: string,
  combatant = 'c-water',
  source: Record<string, unknown> = gemSource(instanceId),
) =>
  s.call('start_effect', {
    effectId,
    kind: 'summoning',
    displayName: effectId,
    source,
    actors: [{ combatantId: combatant }],
    concentrationOwner: { kind: 'combatant', ref: 'c-wiz' },
  });

const birdSource = (instanceId: string) => ({
  kind: 'magic-item',
  ref: TOKEN,
  grantRef: 'bird-token',
  itemInstanceId: instanceId,
});
const birdStart = (
  s: ReturnType<typeof setup>,
  effectId: string,
  instanceId: string,
) =>
  s.call('start_effect', {
    effectId,
    kind: 'summoning',
    displayName: effectId,
    source: birdSource(instanceId),
    actors: [{ combatantId: 'c-roc' }],
    duration: { kind: 'until-removed' },
  });

describe('olc5.12.13 consumed-source grant receipt (R1)', () => {
  it('Elemental Gem: use_item then start_effect binds once, born tombstoned; a repeat is refused', () => {
    const s = setup();
    s.give('gem-1', GEM, { quantity: 1 });
    s.must('use_item', { instanceId: 'gem-1', operationId: 'break-gem' });
    expect(
      s.db.prepare('SELECT 1 FROM inventory WHERE id=?').get('gem-1'),
    ).toBe(undefined);
    expect(s.receipts()).toEqual([
      {
        item_instance_id: 'gem-1',
        campaign_id: DEFAULT_TEST_CAMPAIGN_ID,
        redeemed_effect_id: null,
      },
    ]);
    const bound = gemStart(s, 'fx-gem', 'gem-1');
    expect(bound).toMatchObject({
      ok: true,
      data: {
        effect: {
          itemGrant: {
            grantId: 'gem-elemental',
            itemInstanceId: 'gem-1',
            packRef: GEM,
            spellRef: 'spell:conjure-elemental',
            sourceDestroyedAt: NOW,
          },
        },
      },
    });
    expect(s.receipts()[0]?.redeemed_effect_id).toBe('fx-gem');
    const again = gemStart(s, 'fx-gem-2', 'gem-1', 'c-fire');
    expect(again).toMatchObject({ ok: false });
    expect(again.message).toMatch(/already redeemed/);
    // The tombstoned grant ends normally on the printed hour with no item to cool.
    s.must('advance_time', { minutes: 61 });
    expect(s.effects().find((e) => e.effectId === 'fx-gem')).toMatchObject({
      status: 'ended',
    });
  });

  it('last-unit feather token: use-token then the bird-token grant binds once', () => {
    const s = setup();
    s.give('tok-1', TOKEN, { quantity: 1 });
    s.must('use_item', {
      instanceId: 'tok-1',
      operationId: 'use-token',
    });
    expect(s.receipts()).toHaveLength(1);
    const bound = birdStart(s, 'fx-bird', 'tok-1');
    expect(bound, bound.message).toMatchObject({
      ok: true,
      data: { effect: { itemGrant: { grantId: 'bird-token' } } },
    });
    expect(birdStart(s, 'fx-bird-2', 'tok-1')).toMatchObject({ ok: false });
  });

  it('refuses a never-existing instance, a wrong pack ref, and a wrong campaign', () => {
    const s = setup();
    const never = gemStart(s, 'fx-never', 'no-such-gem');
    expect(never).toMatchObject({ ok: false });
    expect(never.message).toMatch(/no consumption receipt/);
    s.give('gem-2', GEM, { quantity: 1 });
    s.must('use_item', { instanceId: 'gem-2', operationId: 'break-gem' });
    const wrongPack = s.call('start_effect', {
      effectId: 'fx-wrong-pack',
      kind: 'summoning',
      displayName: 'x',
      source: {
        kind: 'magic-item',
        ref: TOKEN,
        grantRef: 'bird-token',
        itemInstanceId: 'gem-2',
      },
      actors: [{ combatantId: 'c-roc' }],
      duration: { kind: 'until-removed' },
    });
    expect(wrongPack).toMatchObject({ ok: false });
    expect(wrongPack.message).toMatch(/consumed as/);
    s.db
      .prepare("UPDATE item_consumption_receipt SET campaign_id='other'")
      .run();
    const wrongCampaign = gemStart(s, 'fx-wrong-campaign', 'gem-2');
    expect(wrongCampaign).toMatchObject({ ok: false });
    expect(wrongCampaign.message).toMatch(/different campaign/);
    expect(s.effects()).toEqual([]);
  });

  it('writes no receipt for a destroyed item, a surviving stack, or a grantless item', () => {
    const s = setup();
    s.give('gem-3', GEM, { quantity: 1 });
    s.must('remove_item', { id: 'gem-3', disposition: 'destroyed' });
    expect(s.receipts()).toEqual([]);
    const refused = gemStart(s, 'fx-destroyed', 'gem-3');
    expect(refused).toMatchObject({ ok: false });
    expect(refused.message).toMatch(/no consumption receipt/);
    // The real gem and token are stateful (their grants name a cooldownEconomy),
    // so a two-unit stack cannot be used at all today and no surviving-stack
    // consumption exists for them. The contrast is therefore: a refused use
    // writes no receipt, and an unconsumed gem binds through its live row.
    s.give('gem-4', GEM, { quantity: 2 });
    const stack = s.call('use_item', {
      instanceId: 'gem-4',
      operationId: 'break-gem',
    });
    expect(stack).toMatchObject({ ok: false });
    expect(stack.message).toMatch(/must have quantity 1/);
    expect(s.receipts()).toEqual([]);
    s.give('gem-6', GEM, { quantity: 1 });
    const live = gemStart(s, 'fx-live', 'gem-6');
    expect(live).toMatchObject({ ok: true });
    expect(s.receipts()).toEqual([]);
    expect(
      live.ok &&
        (live.data as { effect: { itemGrant: object } }).effect.itemGrant,
    ).not.toHaveProperty('sourceDestroyedAt');
  });

  it('a refused effect insert leaves the receipt unredeemed', () => {
    const s = setup();
    s.give('gem-5', GEM, { quantity: 1 });
    s.must('use_item', { instanceId: 'gem-5', operationId: 'break-gem' });
    // The wrong creature is refused after the receipt is read, so it stays open.
    const refused = gemStart(s, 'fx-bad-actor', 'gem-5', 'c-dog-a');
    expect(refused).toMatchObject({ ok: false });
    expect(s.receipts()[0]?.redeemed_effect_id).toBeNull();
    expect(gemStart(s, 'fx-good', 'gem-5')).toMatchObject({ ok: true });
  });
});

describe('olc5.12.13 retired instance ids (user review r2)', () => {
  const giveTool = (
    s: ReturnType<typeof setup>,
    packRef: string,
    extra = {},
  ) => {
    const record = pack.records.find((entry) => entry.key === packRef);
    const result = s.must('give_item', {
      id: packRef.slice('magic-item:'.length),
      name: record?.name,
      packRef,
      ...extra,
    });
    return (result.data as { id: string }).id;
  };
  const receiptRow = (s: ReturnType<typeof setup>, id: string) =>
    s.db
      .prepare(
        'SELECT campaign_id, pack_ref, operation_id, consumed_at, redeemed_effect_id FROM item_consumption_receipt WHERE item_instance_id = ?',
      )
      .get(id);

  for (const firstRedeemed of [false, true]) {
    it(`two real give_item -> use_item cycles of identical gems keep distinct ids and independent receipts (first receipt ${firstRedeemed ? 'redeemed' : 'unredeemed'})`, () => {
      const s = setup();
      const first = giveTool(s, GEM);
      s.must('use_item', { instanceId: first, operationId: 'break-gem' });
      if (firstRedeemed)
        expect(gemStart(s, 'fx-first', first)).toMatchObject({ ok: true });
      const firstReceipt = receiptRow(s, first);
      const second = giveTool(s, GEM);
      expect(second).not.toBe(first);
      s.must('begin_turn', { character: 'pc-1', round: 2 });
      s.must('use_item', { instanceId: second, operationId: 'break-gem' });
      // The first receipt is untouched by the second consumption.
      expect(receiptRow(s, first)).toEqual(firstReceipt);
      expect(gemStart(s, 'fx-second', second, 'c-fire')).toMatchObject({
        ok: true,
      });
      if (!firstRedeemed)
        expect(gemStart(s, 'fx-first', first)).toMatchObject({ ok: true });
      // Each receipt redeems once, for its own effect.
      expect(receiptRow(s, first)).toMatchObject({
        redeemed_effect_id: 'fx-first',
      });
      expect(receiptRow(s, second)).toMatchObject({
        redeemed_effect_id: 'fx-second',
      });
      expect(gemStart(s, 'fx-again', first, 'c-air')).toMatchObject({
        ok: false,
      });
      const byEffect = new Map(
        s.effects().map((e) => [e.effectId, e.itemGrant?.itemInstanceId]),
      );
      expect(byEffect.get('fx-first')).toBe(first);
      expect(byEffect.get('fx-second')).toBe(second);
    });
  }

  it('a receipt is never replaced, and no insert path can reissue a retired id', () => {
    const s = setup();
    const gem = giveTool(s, GEM);
    s.must('use_item', { instanceId: gem, operationId: 'break-gem' });
    const before = receiptRow(s, gem);
    expect(() =>
      writeItemConsumptionReceipt(s.db, {
        campaignId: DEFAULT_TEST_CAMPAIGN_ID,
        itemInstanceId: gem,
        packRef: GEM,
        variantId: undefined,
        operationId: 'break-gem',
        consumedAt: '2026-10-18T00:00:00.000Z',
        consumedElapsedMinutes: 0,
        provenance: 'test:dup',
        sessionId: DEFAULT_TEST_SESSION_ID,
      }),
    ).toThrow(/never replaced/);
    expect(receiptRow(s, gem)).toEqual(before);
    // An explicit retired id is refused by give_item, and the schema refuses
    // any other insert path.
    const explicit = s.call('give_item', { id: gem, name: 'Elemental Gem' });
    expect(explicit).toMatchObject({ ok: false });
    expect(explicit.message).toMatch(/retired/);
    expect(() =>
      s.db
        .prepare(
          "INSERT INTO inventory(id, name, provenance, session_id, updated_at) VALUES (?, 'x', 'p', 's', 't')",
        )
        .run(gem),
    ).toThrow(/retired/);
  });

  it('a destroyed source named by a live grant keeps its id: the next figurine gets a fresh one', () => {
    const s = setup();
    const first = giveTool(s, FIGURINE, { variantId: 'onyx-dog' });
    expect(
      s.call('start_effect', {
        effectId: 'fx-dog',
        kind: 'summoning',
        displayName: 'dog',
        source: {
          kind: 'magic-item',
          ref: FIGURINE,
          grantRef: 'onyx-dog',
          itemInstanceId: first,
        },
        actors: [{ combatantId: 'c-dog-a' }],
      }),
    ).toMatchObject({ ok: true });
    s.must('remove_item', { id: first, disposition: 'destroyed' });
    const second = giveTool(s, FIGURINE, { variantId: 'onyx-dog' });
    expect(second).not.toBe(first);
    expect(
      s.effects().find((e) => e.effectId === 'fx-dog')?.itemGrant,
    ).toMatchObject({ itemInstanceId: first, sourceDestroyedAt: NOW });
  });
});

describe('olc5.12.13 DM-visible grant provenance (R2)', () => {
  it('two identical figurines stay distinguishable in listActiveEffects and the assembled context, and the tombstone shows', () => {
    const s = setup();
    s.give('fig-a', FIGURINE, { variantId: 'onyx-dog' });
    s.give('fig-b', FIGURINE, { variantId: 'onyx-dog' });
    const start = (effectId: string, instanceId: string, combatant: string) =>
      s.call('start_effect', {
        effectId,
        kind: 'summoning',
        displayName: effectId,
        source: {
          kind: 'magic-item',
          ref: FIGURINE,
          grantRef: 'onyx-dog',
          itemInstanceId: instanceId,
        },
        actors: [{ combatantId: combatant }],
      });
    const a = start('fx-dog-a', 'fig-a', 'c-dog-a');
    expect(a, a.message).toMatchObject({
      ok: true,
      data: { effect: { itemGrant: { itemInstanceId: 'fig-a' } } },
    });
    expect(start('fx-dog-b', 'fig-b', 'c-dog-b')).toMatchObject({ ok: true });

    const grantOf = () =>
      Object.fromEntries(
        listActiveEffects(s.db, DEFAULT_TEST_CAMPAIGN_ID).map((e) => [
          e.effectId,
          e.itemGrant,
        ]),
      );
    expect(grantOf()['fx-dog-a']).toMatchObject({
      grantId: 'onyx-dog',
      itemInstanceId: 'fig-a',
      packRef: FIGURINE,
    });
    expect(grantOf()['fx-dog-b']).toMatchObject({ itemInstanceId: 'fig-b' });

    const context = () =>
      renderContextMessage(
        assembleContext({
          db: s.db,
          campaignId: DEFAULT_TEST_CAMPAIGN_ID,
          campaignPosition: DEFAULT_TEST_CAMPAIGN_POSITION,
          sessionId: DEFAULT_TEST_SESSION_ID,
          playerInput: 'continue',
          resolveRulesPack: () => pack,
        }),
      );
    const line = (text: string, effectId: string) =>
      text.split('\n').find((l) => l.startsWith(`- ${effectId}:`)) ?? '';
    const before = context();
    expect(line(before, 'fx-dog-a')).toContain('item grant onyx-dog of fig-a');
    expect(line(before, 'fx-dog-b')).toContain('item grant onyx-dog of fig-b');
    expect(line(before, 'fx-dog-a')).not.toContain('source destroyed');

    s.must('remove_item', { id: 'fig-a', disposition: 'destroyed' });
    const after = context();
    expect(line(after, 'fx-dog-a')).toContain('(source destroyed)');
    expect(line(after, 'fx-dog-b')).not.toContain('source destroyed');
    expect(grantOf()['fx-dog-a']?.sourceDestroyedAt).toBe(NOW);
    expect(grantOf()['fx-dog-b']?.sourceDestroyedAt).toBeUndefined();
  });
});
