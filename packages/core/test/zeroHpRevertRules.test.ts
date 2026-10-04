/** eshyra-ysr3: Animate Objects and Giant Insect 0-HP reversion (SRD).
 * Driven through the real tool registry except where no tool exists
 * (campaign-actor mutation, legacy-row seeding). Each test names the source
 * sentence it protects (records spell:animate-objects, spell:giant-insect). */
import { describe, expect, it } from 'vitest';
import type { ToolContext } from '../src/internal.js';
import {
  auditActiveEffectIntegrity,
  createDefaultToolRegistry,
  createSeededRng,
  getActiveCharacterId,
  getCampaignActor,
  listActiveEffects,
  listCombatants,
  updateCampaignActor,
} from '../src/internal.js';
import {
  DEFAULT_TEST_CAMPAIGN_ID,
  DEFAULT_TEST_SESSION_ID,
  freshDbWithSession,
} from './support/db.js';

const at = '2026-05-20T10:00:00.000Z';

const NATURAL = {
  hpCurrent: 4,
  hpMax: 6,
  rulesRef: 'creature:spider',
} as const;

function setup(
  actors: string[] = ['b1', 'b2'],
  hp = 7,
  rulesRef = 'creature:goblin',
) {
  const db = freshDbWithSession();
  const registry = createDefaultToolRegistry();
  const ctx: ToolContext = {
    db,
    rng: createSeededRng(5),
    campaignId: DEFAULT_TEST_CAMPAIGN_ID,
    sessionId: DEFAULT_TEST_SESSION_ID,
    turnId: 'ysr3',
    at,
  };
  const call = (name: string, args: unknown) =>
    registry.invoke(name, args, ctx);
  const must = (name: string, args: unknown) => {
    const r = call(name, args);
    if (!r.ok) throw new Error(`${name} failed: ${r.message}`);
    return r;
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
      ...actors.map((actorId) => ({
        actorId,
        rulesRef,
        hpMax: hp,
        hpCurrent: hp,
        side: 'ally',
      })),
    ],
  });
  const row = (id: string) => {
    const c = listCombatants(db, DEFAULT_TEST_CAMPAIGN_ID).find(
      (x) => x.combatantId === id,
    );
    if (!c) throw new Error(`missing combatant ${id}`);
    return c;
  };
  const effect = (id: string) => {
    const e = listActiveEffects(db, DEFAULT_TEST_CAMPAIGN_ID, {
      includeEnded: true,
    }).find((x) => x.effectId === id);
    if (!e) throw new Error(`missing effect ${id}`);
    return e;
  };
  const cast = (
    effectId: string,
    ref: 'spell:animate-objects' | 'spell:giant-insect',
    actorsInput: unknown[],
    extra: Record<string, unknown> = {},
  ) =>
    call('start_effect', {
      effectId,
      kind: 'summoning',
      displayName: ref,
      source: {
        kind: 'spell',
        ref,
        actor: { kind: 'combatant', ref: 'c-wiz' },
      },
      concentrationOwner: { kind: 'combatant', ref: 'c-wiz' },
      duration: {
        kind: 'timed',
        amount: ref === 'spell:animate-objects' ? 1 : 10,
        unit: 'minute',
        anchor: 'spell-cast',
      },
      actors: actorsInput,
      ...extra,
    });
  const mustCast = (
    effectId: string,
    ref: 'spell:animate-objects' | 'spell:giant-insect',
    actorsInput: unknown[],
    extra: Record<string, unknown> = {},
  ) => {
    const r = cast(effectId, ref, actorsInput, extra);
    if (!r.ok) throw new Error(`start_effect failed: ${r.message}`);
    return r;
  };
  const insects = (ids: string[], extra: Record<string, unknown> = {}) =>
    mustCast(
      'fx',
      'spell:giant-insect',
      ids.map((id) => ({ combatantId: id, naturalForm: NATURAL })),
      {
        targets: ids.map((id) => ({ kind: 'combatant', ref: id })),
        ...extra,
      },
    );
  const link = (effectId: string, projectionRef: string) => {
    const l = effect(effectId).links.find(
      (x) => x.projectionRef === projectionRef,
    );
    if (!l) throw new Error(`missing link ${projectionRef}`);
    return l;
  };
  return { db, call, must, row, effect, cast, mustCast, insects, link };
}

describe('Animate Objects: reverts to an object at 0 hit points', () => {
  const objects = () => {
    const s = setup();
    s.mustCast(
      'fx',
      'spell:animate-objects',
      [{ combatantId: 'c-b1' }, { combatantId: 'c-b2' }],
      { dismissible: true },
    );
    return s;
  };

  it('derives revert-object and remove cleanups from the record', () => {
    const s = objects();
    expect(s.row('c-b1').zeroHpRule).toBe('revert-object');
    expect(s.link('fx', 'c-b1')).toMatchObject({
      cleanupOnEnd: 'remove',
      cleanupOnBreak: 'remove',
    });
    expect(s.link('fx', 'c-b1').naturalForm).toBeUndefined();
  });

  it('"When the animated object drops to 0 hit points, it reverts ... any remaining damage carries over": absent, not dead, carried-over damage exact, link closed', () => {
    const s = objects();
    const first = s.must('update_combatant', {
      combatantId: 'c-b1',
      hpDelta: -10,
    });
    expect(first.data).toMatchObject({
      reverted: {
        rule: 'revert-object',
        effectId: 'fx',
        effectEnded: false,
        carriedOverDamage: 3,
      },
    });
    expect(first.data).not.toHaveProperty('vanished');
    expect(JSON.stringify(first.data)).not.toMatch(/vanished/);
    expect(s.row('c-b1').status).toBe('absent');
    expect(s.link('fx', 'c-b1')).toMatchObject({
      status: 'removed',
      removedReason: 'zero-hit-points',
    });
    // With another animated object left, the effect continues.
    expect(s.effect('fx').status).toBe('active');

    // The last animated object ending the effect (exact damage: nothing left).
    const second = s.must('update_combatant', {
      combatantId: 'c-b2',
      hpDelta: -7,
    });
    expect(second.data).toMatchObject({
      reverted: { effectEnded: true, carriedOverDamage: 0 },
    });
    expect(s.effect('fx')).toMatchObject({
      status: 'ended',
      endReason: 'source-removed',
    });
    expect(s.row('c-b2').status).toBe('absent');
  });

  it('"until the spell ends": end_effect and a concentration break take every object out of play', () => {
    for (const end of [
      { reason: 'dismissed' },
      { reason: 'concentration-broken', detail: 'voluntary' },
    ]) {
      const s = objects();
      const r = s.must('end_effect', { effectId: 'fx', ...end });
      expect(JSON.stringify(r.data).match(/"action":"[a-z]+"/g)).toEqual([
        '"action":"removed"',
        '"action":"removed"',
      ]);
      expect(s.row('c-b1').status).toBe('absent');
      expect(s.row('c-b2').status).toBe('absent');
      s.db.close();
    }
  });

  it('refuses a cleanup that contradicts the record, naming its transition', () => {
    const s = setup();
    const bad = s.cast('fx', 'spell:animate-objects', [
      { combatantId: 'c-b1', cleanupOnEnd: 'release' },
    ]);
    expect(bad.ok).toBe(false);
    expect(JSON.stringify(bad)).toMatch(/spell-end-reversion/);
    const bad2 = s.cast('fx', 'spell:animate-objects', [
      { combatantId: 'c-b1', cleanupOnBreak: 'release' },
    ]);
    expect(bad2.ok).toBe(false);
    expect(JSON.stringify(bad2)).toMatch(/spell-end-reversion/);
  });

  it('refuses a natural form for an object', () => {
    const s = setup();
    const bad = s.cast('fx', 'spell:animate-objects', [
      { combatantId: 'c-b1', naturalForm: NATURAL },
    ]);
    expect(bad.ok).toBe(false);
    expect(JSON.stringify(bad)).toMatch(/naturalForm/);
  });

  it('a suffocation drop reverts it with no carried-over damage', () => {
    const s = objects();
    const r = s.must('set_suffocation', { combatantId: 'c-b1', event: 'drop' });
    expect(r.data).toMatchObject({
      lifeState: 'absent',
      reverted: { rule: 'revert-object', carriedOverDamage: 0 },
    });
    expect(s.row('c-b1').status).toBe('absent');
    expect(s.link('fx', 'c-b1').removedReason).toBe('zero-hit-points');
  });

  it('refuses knockouts, statuses with the damage, and player-character death rules', () => {
    const s = objects();
    expect(
      s.call('update_combatant', {
        combatantId: 'c-b1',
        deathRules: 'player-character',
      }).ok,
    ).toBe(false);
    const knockout = s.call('update_combatant', {
      combatantId: 'c-b1',
      hpDelta: -7,
      status: 'unconscious',
    });
    expect(knockout.ok).toBe(false);
    expect(JSON.stringify(knockout)).toMatch(/original object form/);
    expect(s.row('c-b1').hpCurrent).toBe(7);
  });

  it('it cannot be admitted at 0 hit points', () => {
    const s = objects();
    s.must('update_combatant', { combatantId: 'c-b1', hpDelta: -7 });
    s.must('close_combat_instance', { status: 'completed' });
    const readmit = s.call('start_encounter', {
      combatInstanceId: 'c2',
      actors: [{ actorId: 'b2', rulesRef: 'creature:goblin', hpCurrent: 0 }],
    });
    expect(readmit.ok).toBe(false);
  });
});

describe('Giant Insect: reverts to its natural form at 0 hit points', () => {
  const GIANT = 'creature:giant-spider';

  it('derives revert-form and revert cleanups, and stores the natural form on the link', () => {
    const s = setup(['b1'], 26, GIANT);
    s.insects(['c-b1']);
    expect(s.row('c-b1').zeroHpRule).toBe('revert-form');
    expect(s.link('fx', 'c-b1')).toMatchObject({
      cleanupOnEnd: 'revert',
      cleanupOnBreak: 'revert',
      naturalForm: NATURAL,
    });
  });

  it('"until it drops to 0 hit points": alive with exactly the snapshot, rule cleared, link removed, never dead', () => {
    const s = setup(['b1', 'b2'], 26, GIANT);
    s.insects(['c-b1', 'c-b2']);
    const r = s.must('update_combatant', {
      combatantId: 'c-b1',
      hpDelta: -40,
    });
    expect(r.data).toMatchObject({
      reverted: {
        rule: 'revert-form',
        effectId: 'fx',
        effectEnded: false,
        naturalForm: NATURAL,
      },
    });
    expect(JSON.stringify(r.data)).not.toMatch(/carriedOverDamage|vanished/);
    expect(s.row('c-b1')).toMatchObject({
      status: 'alive',
      hpCurrent: 4,
      hpMax: 6,
      rulesRef: 'creature:spider',
      zeroHpRule: null,
    });
    expect(s.link('fx', 'c-b1')).toMatchObject({
      status: 'removed',
      removedReason: 'zero-hit-points',
    });
    expect(s.effect('fx').status).toBe('active');
    // The reverted creature is an ordinary creature again: it can now die.
    s.must('update_combatant', { combatantId: 'c-b1', hpDelta: -4 });
    expect(s.row('c-b1').status).toBe('dead');

    // The last transformed creature ends the effect.
    const last = s.must('update_combatant', {
      combatantId: 'c-b2',
      hpDelta: -26,
    });
    expect(last.data).toMatchObject({ reverted: { effectEnded: true } });
    expect(s.effect('fx')).toMatchObject({
      status: 'ended',
      endReason: 'source-removed',
    });
    expect(s.row('c-b2')).toMatchObject({ status: 'alive', hpCurrent: 4 });
  });

  it('reverts at 0 hit points by a suffocation drop and an exhaustion clamp', () => {
    for (const path of ['suffocation', 'exhaustion'] as const) {
      const s = setup(['b1'], 1, GIANT);
      s.mustCast(
        'fx',
        'spell:giant-insect',
        [
          {
            combatantId: 'c-b1',
            naturalForm: {
              hpCurrent: 10,
              hpMax: 10,
              rulesRef: 'creature:spider',
            },
          },
        ],
        { targets: [{ kind: 'combatant', ref: 'c-b1' }] },
      );
      if (path === 'suffocation')
        s.must('set_suffocation', { combatantId: 'c-b1', event: 'drop' });
      else s.must('adjust_exhaustion', { combatantId: 'c-b1', delta: 4 });
      expect(s.row('c-b1')).toMatchObject({
        status: 'alive',
        rulesRef: 'creature:spider',
        zeroHpRule: null,
        // Exhaustion 4 halves the maximum; it still applies to the restored form.
        hpCurrent: path === 'exhaustion' ? 5 : 10,
        hpMax: 10,
      });
      expect(s.link('fx', 'c-b1').removedReason).toBe('zero-hit-points');
      expect(s.effect('fx').status).toBe('ended');
      s.db.close();
    }
  });

  it('exhaustion level 6 is still death', () => {
    const s = setup(['b1'], 26, GIANT);
    s.insects(['c-b1']);
    s.must('adjust_exhaustion', { combatantId: 'c-b1', delta: 6 });
    expect(s.row('c-b1').status).toBe('dead');
  });

  it('"until the spell ends": end_effect and a concentration break revert it in play', () => {
    for (const end of [
      { reason: 'dismissed' },
      { reason: 'concentration-broken', detail: 'voluntary' },
    ]) {
      const s = setup(['b1'], 26, GIANT);
      s.insects(['c-b1'], { dismissible: true });
      const r = s.must('end_effect', { effectId: 'fx', ...end });
      expect(JSON.stringify(r.data).match(/"action":"[a-z]+"/g)).toEqual([
        '"action":"reverted"',
      ]);
      expect(s.row('c-b1')).toMatchObject({
        status: 'alive',
        hpCurrent: 4,
        hpMax: 6,
        rulesRef: 'creature:spider',
        zeroHpRule: null,
      });
      expect(s.link('fx', 'c-b1').status).toBe('removed');
      s.db.close();
    }
  });

  it('"or until you use an action to dismiss the effect on it": remove_effect_target reverts only that creature', () => {
    const s = setup(['b1', 'b2'], 26, GIANT);
    s.insects(['c-b1', 'c-b2']);
    const r = s.must('remove_effect_target', {
      effectId: 'fx',
      target: { kind: 'combatant', ref: 'c-b1' },
      reason: 'dismissed',
    });
    expect(JSON.stringify(r.data)).toMatch(/"action":"reverted"/);
    expect(s.row('c-b1')).toMatchObject({
      status: 'alive',
      hpCurrent: 4,
      rulesRef: 'creature:spider',
      zeroHpRule: null,
    });
    expect(s.row('c-b2')).toMatchObject({
      hpCurrent: 26,
      rulesRef: GIANT,
      zeroHpRule: 'revert-form',
    });
    expect(s.effect('fx').status).toBe('active');
  });

  it('requires the natural form for the record, and refuses it elsewhere', () => {
    const s = setup(['b1'], 26, GIANT);
    const missing = s.cast('fx', 'spell:giant-insect', [
      { combatantId: 'c-b1' },
    ]);
    expect(missing.ok).toBe(false);
    expect(JSON.stringify(missing)).toMatch(/needs naturalForm/);
    const malformed = s.cast('fx', 'spell:giant-insect', [
      {
        combatantId: 'c-b1',
        naturalForm: { hpCurrent: 0, hpMax: 6, rulesRef: 'creature:spider' },
      },
    ]);
    expect(malformed.ok).toBe(false);
    expect(
      s.cast('fx', 'spell:giant-insect', [
        {
          combatantId: 'c-b1',
          naturalForm: { hpCurrent: 7, hpMax: 6, rulesRef: 'creature:spider' },
        },
      ]).ok,
    ).toBe(false);
    expect(
      s.cast('fx', 'spell:giant-insect', [
        {
          combatantId: 'c-b1',
          naturalForm: { hpCurrent: 4, hpMax: 6, rulesRef: '' },
        },
      ]).ok,
    ).toBe(false);

    const vanish = s.call('start_effect', {
      effectId: 'fx2',
      kind: 'summoning',
      displayName: 'Conjure Animals',
      source: {
        kind: 'spell',
        ref: 'spell:conjure-animals',
        actor: { kind: 'combatant', ref: 'c-wiz' },
      },
      concentrationOwner: { kind: 'combatant', ref: 'c-wiz' },
      duration: {
        kind: 'timed',
        amount: 1,
        unit: 'hour',
        anchor: 'spell-cast',
      },
      actors: [{ combatantId: 'c-b1', naturalForm: NATURAL }],
    });
    expect(vanish.ok).toBe(false);
    expect(JSON.stringify(vanish)).toMatch(/naturalForm is refused/);

    const ruling = s.call('start_effect', {
      effectId: 'fx3',
      kind: 'summoning',
      displayName: 'x',
      source: { kind: 'ruling' },
      duration: { kind: 'until-removed' },
      actors: [
        {
          combatantId: 'c-b1',
          atZeroHitPoints: 'vanish',
          naturalForm: NATURAL,
        },
      ],
    });
    expect(ruling.ok).toBe(false);
    expect(JSON.stringify(ruling)).toMatch(/naturalForm is refused/);
    // A revert cleanup needs a natural form to restore.
    const revertless = s.call('start_effect', {
      effectId: 'fx4',
      kind: 'summoning',
      displayName: 'x',
      source: { kind: 'ruling' },
      duration: { kind: 'until-removed' },
      actors: [{ combatantId: 'c-b1', cleanupOnEnd: 'revert' }],
    });
    expect(revertless.ok).toBe(false);
    expect(JSON.stringify(revertless)).toMatch(/natural form/);
    // Nothing was written by any refusal.
    expect(s.row('c-b1').zeroHpRule).toBeNull();
  });

  it('refuses explicit remove/release cleanups against the record', () => {
    const s = setup(['b1'], 26, GIANT);
    for (const policy of [
      { cleanupOnEnd: 'remove' },
      { cleanupOnEnd: 'release' },
      { cleanupOnBreak: 'remove' },
      { cleanupOnBreak: 'release' },
    ]) {
      const bad = s.cast('fx', 'spell:giant-insect', [
        { combatantId: 'c-b1', naturalForm: NATURAL, ...policy },
      ]);
      expect(bad.ok).toBe(false);
      expect(JSON.stringify(bad)).toMatch(/spell-end-reversion/);
    }
  });

  it('refuses knockouts, statuses with the damage, and player-character death rules', () => {
    const s = setup(['b1'], 26, GIANT);
    s.insects(['c-b1']);
    expect(
      s.call('update_combatant', {
        combatantId: 'c-b1',
        deathRules: 'player-character',
      }).ok,
    ).toBe(false);
    const knockout = s.call('update_combatant', {
      combatantId: 'c-b1',
      hpDelta: -26,
      status: 'unconscious',
    });
    expect(knockout.ok).toBe(false);
    expect(JSON.stringify(knockout)).toMatch(/original form/);
    expect(s.row('c-b1').hpCurrent).toBe(26);
  });

  it('out of combat, a durable creature at 0 hit points reverts and its link closes', () => {
    const s = setup(['b1'], 26, GIANT);
    // A character concentrates, so closing combat does not end the spell.
    const pcId = getActiveCharacterId(s.db);
    s.insects(['c-b1'], {
      source: {
        kind: 'spell',
        ref: 'spell:giant-insect',
        actor: { kind: 'character', ref: pcId },
      },
      concentrationOwner: { kind: 'character', ref: pcId },
    });
    s.must('close_combat_instance', { status: 'completed' });
    expect(s.effect('fx').status).toBe('active');
    const actor = updateCampaignActor(s.db, {
      campaignId: DEFAULT_TEST_CAMPAIGN_ID,
      actorId: 'b1',
      hpCurrent: 0,
      provenance: 't',
      sessionId: DEFAULT_TEST_SESSION_ID,
      at,
    });
    expect(actor).toMatchObject({
      status: 'alive',
      hpCurrent: 4,
      hpMax: 6,
      rulesRef: 'creature:spider',
    });
    expect(
      getCampaignActor(s.db, DEFAULT_TEST_CAMPAIGN_ID, 'b1')?.state,
    ).toMatchObject({ combatLifecycle: { zeroHpRule: null } });
    expect(s.effect('fx')).toMatchObject({
      status: 'ended',
      endReason: 'source-removed',
    });
  });

  it('a legacy revert-form creature with no recorded natural form is reported and its 0-hit-point reversion refuses', () => {
    const s = setup(['b1'], 26, GIANT);
    s.db
      .prepare(
        "UPDATE encounter_combatant SET zero_hp_rule='revert-form' WHERE combatant_id='c-b1'",
      )
      .run();
    expect(
      auditActiveEffectIntegrity(s.db, DEFAULT_TEST_CAMPAIGN_ID).map(
        (i) => i.issue,
      ),
    ).toEqual([expect.stringMatching(/c-b1.*natural form/)]);
    const r = s.call('update_combatant', { combatantId: 'c-b1', hpDelta: -26 });
    expect(r.ok).toBe(false);
    expect(JSON.stringify(r)).toMatch(/natural form/);
    // Nothing was written by the refused reversion.
    expect(s.row('c-b1')).toMatchObject({ hpCurrent: 26, status: 'alive' });
  });

  it('a well-formed transformation has no integrity issue', () => {
    const s = setup(['b1'], 26, GIANT);
    s.insects(['c-b1']);
    expect(
      auditActiveEffectIntegrity(s.db, DEFAULT_TEST_CAMPAIGN_ID).filter((i) =>
        /natural form|revert/.test(i.issue),
      ),
    ).toEqual([]);
  });
});
