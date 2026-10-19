/** eshyra-olc5.15: the Ring of Djinni Summoning's printed death consequence
 * ("the ring becomes nonmagical if the djinni dies"), on the UNMODIFIED bundled
 * pack with NO readiness waiver.
 *
 * The DM adjudicates that the particular djinni DIED (as opposed to dropping to
 * 0 hit points and returning home, an ordinary ending) and reports the declared
 * condition through item_state_event. The consequence is durable, attributable,
 * idempotent and atomic, applies whether or not a summon is active, and ends
 * any live summon in the same transaction without scheduling the 24-hour
 * cooldown. Ordinary endings never make the ring nonmagical. */
import { describe, expect, it } from 'vitest';
import type { ToolContext } from '../src/internal.js';
import {
  advanceWorldTime,
  createDefaultToolRegistry,
  createSeededRng,
  getBundledDnd5eSrdPack,
  listActiveEffects,
  readItemState,
} from '../src/internal.js';
import {
  DEFAULT_TEST_CAMPAIGN_ID,
  DEFAULT_TEST_SESSION_ID,
  freshDbWithSession,
} from './support/db.js';

const NOW = '2026-10-18T10:00:00.000Z';
const pack = getBundledDnd5eSrdPack();
const RING = 'magic-item:ring-of-djinni-summoning';
const DIES = 'the djinni dies';

function setup() {
  const db = freshDbWithSession();
  const registry = createDefaultToolRegistry();
  const ctx: ToolContext = {
    db,
    rng: createSeededRng(7),
    campaignId: DEFAULT_TEST_CAMPAIGN_ID,
    sessionId: DEFAULT_TEST_SESSION_ID,
    turnId: 'olc5-15',
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
      {
        actorId: 'djinni',
        rulesRef: 'creature:djinni',
        hpMax: 161,
        hpCurrent: 161,
        side: 'ally',
      },
    ],
  });
  const given = must('give_item', {
    id: 'ring',
    name: 'Ring of Djinni Summoning',
    packRef: RING,
  });
  const ringId = (given.data as { id: string }).id;
  must('don_item', { id: ringId });
  must('attune_item', { itemId: ringId, itemRef: RING });
  let round = 0;
  const nextTurn = () => {
    round += 1;
    must('begin_turn', { character: 'pc-1', round });
  };
  const summon = () => {
    nextTurn();
    const used = call('use_item', {
      instanceId: ringId,
      operationId: 'summon-djinni',
    });
    expect(used, used.message).toMatchObject({ ok: true });
    const bound = call('start_effect', {
      effectId: 'fx-djinni',
      kind: 'summoning',
      displayName: 'The djinni',
      source: {
        kind: 'magic-item',
        ref: RING,
        grantRef: 'particular-djinni',
        itemInstanceId: ringId,
      },
      actors: [{ combatantId: 'c-djinni' }],
      concentrationOwner: { kind: 'combatant', ref: 'c-wiz' },
    });
    expect(bound, bound.message).toMatchObject({ ok: true });
  };
  const event = (condition: string) =>
    call('item_state_event', { instanceId: ringId, condition });
  const effect = () =>
    listActiveEffects(db, DEFAULT_TEST_CAMPAIGN_ID, {
      includeEnded: true,
    }).find((row) => row.effectId === 'fx-djinni');
  const state = () => readItemState(db, ringId);
  return { db, call, must, summon, event, effect, state, ringId, nextTurn };
}

describe('Ring of Djinni Summoning: the djinni dies (real pack, no waiver)', () => {
  it('the unmodified pack declares the typed transition and the summon operation is ready', () => {
    const ring = pack.records.find((record) => record.key === RING);
    const mechanics = (
      (ring as { data: unknown }).data as {
        mechanics: Record<string, unknown>;
      }
    ).mechanics;
    expect(mechanics.stateMachine).toMatchObject({
      initial: 'magical',
      transitions: [
        {
          from: 'magical',
          to: 'nonmagical',
          condition: DIES,
          becomes: 'nonmagical',
        },
      ],
    });
  });

  it('(a) summon -> bind -> the djinni dies: the grant ends with the death recorded, the ring is nonmagical, no cooldown starts, and a later summon is refused', () => {
    const s = setup();
    s.summon();
    expect(s.effect()).toMatchObject({ status: 'active' });
    expect(s.state()?.lifecycle).toBeUndefined();

    const died = s.event(DIES);
    expect(died, died.message).toMatchObject({
      ok: true,
      data: {
        instanceId: s.ringId,
        from: 'magical',
        to: 'nonmagical',
        becameNonmagical: true,
        grantsEnded: ['fx-djinni'],
      },
    });
    // The grant ended in the same transaction, and the ending records the death.
    expect(s.effect()).toMatchObject({
      status: 'ended',
      endReason: 'source-removed',
      endDetail: 'creature-died',
    });
    // Durable and attributable.
    const stored = s.state();
    expect(stored).toMatchObject({
      machineState: 'nonmagical',
      lifecycle: { status: 'nonmagical' },
    });
    expect(
      s.db
        .prepare(
          'SELECT provenance, session_id FROM item_state WHERE inventory_id = ?',
        )
        .get(s.ringId),
    ).toEqual({
      provenance: 'model:olc5-15',
      session_id: DEFAULT_TEST_SESSION_ID,
    });
    // A death is not an ordinary departure: no 24-hour cooldown is scheduled.
    expect(stored?.economies?.cooldown?.remaining).toBe(0);
    expect(stored?.economies?.cooldown?.availableAt).toBeUndefined();

    // A later summon is refused.
    s.nextTurn();
    const again = s.call('use_item', {
      instanceId: s.ringId,
      operationId: 'summon-djinni',
    });
    expect(again).toMatchObject({ ok: false });
    expect(again.message).toMatch(/nonmagical/);

    // Idempotent: a second event is refused and changes nothing.
    const before = JSON.stringify(s.state());
    const second = s.event(DIES);
    expect(second).toMatchObject({ ok: false });
    expect(JSON.stringify(s.state())).toBe(before);
  });

  it('(b) with no summon active, the same event makes the ring nonmagical', () => {
    const s = setup();
    const died = s.event(DIES);
    expect(died, died.message).toMatchObject({
      ok: true,
      data: { becameNonmagical: true, grantsEnded: [] },
    });
    expect(s.state()).toMatchObject({
      machineState: 'nonmagical',
      lifecycle: { status: 'nonmagical' },
    });
    s.nextTurn();
    const refused = s.call('use_item', {
      instanceId: s.ringId,
      operationId: 'summon-djinni',
    });
    expect(refused).toMatchObject({ ok: false });
    expect(refused.message).toMatch(/nonmagical/);
  });

  it('(c) an ordinary end leaves the ring magical and only starts the cooldown: 0 hit points, then the one-hour expiry', () => {
    const zero = setup();
    zero.summon();
    zero.must('update_combatant', { combatantId: 'c-djinni', hpDelta: -161 });
    expect(zero.effect()).toMatchObject({ status: 'ended' });
    expect(zero.state()?.lifecycle).toBeUndefined();
    expect(zero.state()?.machineState).toBe('magical');
    expect(zero.state()?.economies?.cooldown?.availableAt).toBe('1440');
    // Still magical: the cooldown elapses and the ring can summon again.
    advanceWorldTime(zero.db, {
      campaignId: DEFAULT_TEST_CAMPAIGN_ID,
      minutes: 1440,
      provenance: 'test:ring-zero-hp-wait',
      sessionId: DEFAULT_TEST_SESSION_ID,
      at: NOW,
      resolveRulesPack: () => pack,
      rng: createSeededRng(5),
    });
    expect(zero.state()?.economies?.cooldown?.remaining).toBe(1);
    zero.nextTurn();
    expect(
      zero.call('use_item', {
        instanceId: zero.ringId,
        operationId: 'summon-djinni',
      }),
    ).toMatchObject({ ok: true });

    const hour = setup();
    hour.summon();
    advanceWorldTime(hour.db, {
      campaignId: DEFAULT_TEST_CAMPAIGN_ID,
      minutes: 60,
      provenance: 'test:ring-one-hour',
      sessionId: DEFAULT_TEST_SESSION_ID,
      at: NOW,
      resolveRulesPack: () => pack,
      rng: createSeededRng(5),
    });
    expect(hour.effect()).toMatchObject({ status: 'ended' });
    expect(hour.effect()?.endDetail).not.toBe('creature-died');
    expect(hour.state()?.lifecycle).toBeUndefined();
    expect(hour.state()?.machineState).toBe('magical');
    expect(hour.state()?.economies?.cooldown?.availableAt).toBeDefined();
  });

  it('the declared condition must match exactly: 0 hit points is not the djinni dying, and an undeclared condition changes nothing', () => {
    const s = setup();
    s.summon();
    const before = JSON.stringify(s.state());
    for (const condition of [
      'the djinni drops to 0 hit points',
      'The djinni dies',
      'the ring becomes nonmagical',
    ]) {
      const refused = s.event(condition);
      expect(refused, condition).toMatchObject({ ok: false });
    }
    expect(JSON.stringify(s.state())).toBe(before);
    expect(s.effect()).toMatchObject({ status: 'active' });
  });

  it('an ordinary 0-hit-point end followed by the DM ruling the djinni died still makes the ring nonmagical, with no new cooldown', () => {
    const s = setup();
    s.summon();
    s.must('update_combatant', { combatantId: 'c-djinni', hpDelta: -161 });
    expect(s.state()?.economies?.cooldown?.availableAt).toBe('1440');
    const died = s.event(DIES);
    expect(died, died.message).toMatchObject({
      ok: true,
      data: { becameNonmagical: true, grantsEnded: [] },
    });
    expect(s.state()?.lifecycle).toEqual({ status: 'nonmagical' });
  });
});
