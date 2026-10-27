/** eshyra-7gkh.1: ONE real-pack, no-waiver conformance for the shared per-day
 * dawn economy shape
 *
 *   { kind: 'per-day', perDay: { uses: N }, reset: [{ at: 'dawn', amount: 'all' }] }
 *
 * that 20 magic-item carriers print and whose readiness hook ('F5: per-period
 * usage reset') is landed on the strength of this execution: use_item spends
 * to exhaustion, REFUSES at 0 (a hard limit, unlike the nonblocking early-reuse
 * dawn hook), an advance that stops before dawn restores nothing, and an
 * advance that reaches the dawn boundary (minute 360 of the day) restores the
 * uses. Iron Bands of Binding stands for the shape; no per-item matrix.
 *
 * The unmodified bundled pack is used with NO readiness waiver, so the
 * operation passing the preflight is itself part of the evidence. */
import { describe, expect, it } from 'vitest';
import type { ToolContext } from '../src/internal.js';
import {
  createDefaultToolRegistry,
  createSeededRng,
  getBundledDnd5eSrdPack,
  readItemState,
} from '../src/internal.js';
import {
  DEFAULT_TEST_CAMPAIGN_ID,
  DEFAULT_TEST_SESSION_ID,
  freshDbWithSession,
} from './support/db.js';

const pack = getBundledDnd5eSrdPack();
const BANDS = 'magic-item:iron-bands-of-binding';

describe('per-day dawn economy: spend, refuse at 0, restore at dawn (real pack, no waiver)', () => {
  it('pins the shape the 20 carriers share', () => {
    const record = pack.records.find((entry) => entry.key === BANDS);
    if (record === undefined) throw new Error('no Iron Bands of Binding');
    const economies = (record.data as { mechanics: { economies: unknown } })
      .mechanics.economies;
    expect(economies).toEqual({
      uses: {
        kind: 'per-day',
        perDay: { uses: 1 },
        reset: [{ at: 'dawn', amount: 'all' }],
      },
    });
  });

  it('spends to exhaustion, refuses at 0, is not restored before dawn, and is restored at dawn', () => {
    const db = freshDbWithSession();
    const registry = createDefaultToolRegistry();
    const ctx: ToolContext = {
      db,
      rng: createSeededRng(5),
      campaignId: DEFAULT_TEST_CAMPAIGN_ID,
      sessionId: DEFAULT_TEST_SESSION_ID,
      turnId: 'dawn-economy',
      at: '2026-10-26T10:00:00.000Z',
      resolveRulesPack: () => pack,
    };
    const call = (name: string, args: unknown) =>
      registry.invoke(name, args, ctx);
    const must = (name: string, args: unknown) => {
      const result = call(name, args);
      if (!result.ok) throw new Error(`${name} failed: ${result.message}`);
      return result;
    };
    const given = must('give_item', {
      id: 'bands',
      name: 'Iron Bands of Binding',
      packRef: BANDS,
    });
    const id = (given.data as { id: string }).id;
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
      ],
    });
    let round = 0;
    const throwBands = () => {
      round += 1;
      must('begin_turn', { character: 'pc-1', round });
      return call('use_item', { instanceId: id, operationId: 'throw-bands' });
    };
    const remaining = () => readItemState(db, id)?.economies?.uses?.remaining;
    const minutes = () =>
      (
        db.prepare('SELECT elapsed_minutes FROM clock WHERE id = 1').get() as {
          elapsed_minutes: number;
        }
      ).elapsed_minutes;

    expect(minutes()).toBe(0);
    expect(remaining()).toBe(1);
    const spent = throwBands();
    expect(spent, spent.message).toMatchObject({ ok: true });
    expect(remaining()).toBe(0);

    // A hard limit: refused at 0 with the state unchanged.
    const refused = throwBands();
    expect(refused).toMatchObject({ ok: false });
    expect(refused.message).toMatch(/insufficient uses/);
    expect(remaining()).toBe(0);

    // An advance that stops one minute before dawn (minute 359) restores nothing.
    must('advance_time', { minutes: 359 });
    expect(minutes()).toBe(359);
    expect(remaining()).toBe(0);
    expect(throwBands()).toMatchObject({ ok: false });

    // Reaching the dawn boundary (minute 360) restores the uses.
    must('advance_time', { minutes: 1 });
    expect(minutes()).toBe(360);
    expect(remaining()).toBe(1);
    const again = throwBands();
    expect(again, again.message).toMatchObject({ ok: true });
    expect(remaining()).toBe(0);
    db.close();
  });
});
