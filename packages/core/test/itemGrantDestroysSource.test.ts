/** eshyra-olc5.15: the Staff of the Python's printed 0-hit-point consequence
 * ("If the snake is reduced to 0 hit points, it dies and reverts to its staff
 * form. The staff then shatters and is destroyed"), at the binder / ending
 * level on the UNMODIFIED bundled pack (the Staff is not ready, so nothing is
 * waived in production code and no use_item is involved).
 *
 * The python-form grant types `destroysItemOn: reduced-to-0-hit-points`. The
 * 0-hit-point ending destroys the source instance in the same transaction as
 * the ending, after the effect has ended; the bonus-action reversion does not.
 * No ending path that reports 0 hit points bypasses the destruction. */
import { describe, expect, it } from 'vitest';
import type { ToolContext } from '../src/internal.js';
import {
  createDefaultToolRegistry,
  createSeededRng,
  getBundledDnd5eSrdPack,
  listActiveEffects,
} from '../src/internal.js';
import {
  DEFAULT_TEST_CAMPAIGN_ID,
  DEFAULT_TEST_SESSION_ID,
  freshDbWithSession,
} from './support/db.js';
import { readItemGrantBindingForTest } from './support/itemGrantBindingProbe.js';

const NOW = '2026-10-18T10:00:00.000Z';
const pack = getBundledDnd5eSrdPack();
const STAFF = 'magic-item:staff-of-the-python';

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
        actorId: 'cleric',
        rulesRef: 'creature:goblin',
        hpMax: 20,
        hpCurrent: 20,
        side: 'ally',
      },
      {
        actorId: 'snake',
        rulesRef: 'creature:giant-constrictor-snake',
        hpMax: 60,
        hpCurrent: 60,
        side: 'ally',
      },
      {
        actorId: 'snake2',
        rulesRef: 'creature:giant-constrictor-snake',
        hpMax: 60,
        hpCurrent: 60,
        side: 'ally',
      },
    ],
  });
  const given = must('give_item', {
    id: 'staff',
    name: 'Staff of the Python',
    packRef: STAFF,
  });
  const staffId = (given.data as { id: string }).id;
  const bind = (effectId = 'fx-python', combatantId = 'c-snake') => {
    const bound = call('start_effect', {
      effectId,
      kind: 'summoning',
      displayName: 'The python',
      source: {
        kind: 'magic-item',
        ref: STAFF,
        grantRef: 'python-form',
        itemInstanceId: staffId,
      },
      actors: [{ combatantId, atZeroHitPoints: 'vanish' }],
      duration: { kind: 'until-removed' },
    });
    expect(bound, bound.message).toMatchObject({ ok: true });
  };
  const effect = (effectId = 'fx-python') =>
    listActiveEffects(db, DEFAULT_TEST_CAMPAIGN_ID, {
      includeEnded: true,
    }).find((row) => row.effectId === effectId);
  const held = () =>
    db.prepare('SELECT 1 FROM inventory WHERE id = ?').get(staffId) !==
    undefined;
  return { db, call, must, bind, effect, held, staffId };
}

describe('Staff of the Python: the 0-hit-point ending destroys the staff', () => {
  it('the unmodified pack types the coupling and keeps the Staff not ready', () => {
    const staff = pack.records.find((record) => record.key === STAFF);
    const data = staff?.data as {
      mechanics: { entityGrant: { grants: Record<string, unknown>[] } };
      executionReadiness: {
        clauses: { clauseId: string; readiness: string }[];
      };
    };
    expect(data.mechanics.entityGrant.grants[0]).toMatchObject({
      id: 'python-form',
      revertOn: ['owner-bonus-action-command', 'reduced-to-0-hit-points'],
      destroysItemOn: 'reduced-to-0-hit-points',
    });
    const m4 = data.executionReadiness.clauses.find((clause) =>
      clause.clauseId.endsWith('/m4-staff-of-the-python'),
    );
    expect(m4?.readiness).toBe('engine-pending');
    // The verbatim destruction sentence stays carried by an adjudicated span.
    expect(JSON.stringify(data.executionReadiness)).toContain(
      'staff then shatters and is destroyed',
    );
  });

  it('the snake reduced to 0 hit points ends the grant and destroys the staff in the same transaction', () => {
    const s = setup();
    s.bind();
    expect(s.held()).toBe(true);
    expect(readItemGrantBindingForTest(s.db, 'fx-python')).toMatchObject({
      destroysSourceAtZeroHp: true,
    });

    s.must('update_combatant', { combatantId: 'c-snake', hpDelta: -60 });
    expect(s.effect()).toMatchObject({
      status: 'ended',
      endReason: 'source-removed',
      endDetail: 'zero-hit-points',
    });
    expect(s.held()).toBe(false);
    // The binding survives the destroyed row as an ended effect; nothing is
    // left live against the deleted instance.
    expect(
      s.db
        .prepare(
          `SELECT COUNT(*) AS n FROM active_effect
           WHERE status IN ('active','suppressed') AND item_grant_json IS NOT NULL`,
        )
        .get(),
    ).toEqual({ n: 0 });
  });

  it('the bonus-action reversion leaves the staff intact and usable', () => {
    const s = setup();
    s.bind();
    // 'owner-bonus-action-command' is DM-ended: the DM rules it.
    s.must('end_effect', {
      effectId: 'fx-python',
      reason: 'ruled',
      note: 'the owner commanded the snake back into staff form as a bonus action',
    });
    expect(s.effect()).toMatchObject({ status: 'ended', endReason: 'ruled' });
    expect(s.held()).toBe(true);
    // The staff can bind a fresh python later (usable, not shattered).
    s.bind('fx-python-2', 'c-snake2');
    expect(s.effect('fx-python-2')).toMatchObject({ status: 'active' });
  });

  it('no ending path that reports 0 hit points bypasses the destruction', () => {
    for (const end of [
      { reason: 'source-removed', detail: 'zero-hit-points' },
      { reason: 'dismissed', detail: 'zero-hit-points' },
      { reason: 'dispelled', detail: 'zero-hit-points' },
    ]) {
      const s = setup();
      s.bind();
      const result = s.call('end_effect', { effectId: 'fx-python', ...end });
      if (result.ok) {
        expect(s.held(), JSON.stringify(end)).toBe(false);
      } else {
        // A path the engine refuses outright (e.g. a non-dismissible effect)
        // ends nothing and destroys nothing.
        expect(s.effect()).toMatchObject({ status: 'active' });
        expect(s.held()).toBe(true);
      }
    }
    // The route the engine itself takes is covered above; the DM's explicit
    // source-removed report must destroy.
    const s = setup();
    s.bind();
    s.must('end_effect', {
      effectId: 'fx-python',
      reason: 'source-removed',
      detail: 'zero-hit-points',
    });
    expect(s.held()).toBe(false);
  });

  it('the Staff stays readiness-refused: become-python is not executable', () => {
    const s = setup();
    s.must('attune_item', { itemId: s.staffId, itemRef: STAFF });
    s.must('begin_turn', { character: 'pc-1', round: 1 });
    const used = s.call('use_item', {
      instanceId: s.staffId,
      operationId: 'become-python',
    });
    expect(used).toMatchObject({ ok: false });
    expect(used.message).toMatch(/not safely executable|engine-pending/);
  });
});
