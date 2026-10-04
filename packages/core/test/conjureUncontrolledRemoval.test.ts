/** eshyra-7vh3: Conjure Elemental / Conjure Fey. A broken concentration leaves
 * the creature present, uncontrolled and hostile; the SRD says it "disappears
 * 1 hour after you summoned it". The break ends the controlled effect (release)
 * and, in the same transaction, starts a non-concentration, non-dismissible
 * successor `<id>:uncontrolled` that inherits the cast anchor and deadline. */
import { describe, expect, it } from 'vitest';
import type { ToolContext } from '../src/internal.js';
import {
  advanceWorldTime,
  createDefaultToolRegistry,
  createSeededRng,
  getCampaignActor,
  listActiveEffects,
  listCombatants,
  listEffectEvents,
  resolveConcentrationCheck,
} from '../src/internal.js';
import {
  DEFAULT_TEST_CAMPAIGN_ID,
  DEFAULT_TEST_SESSION_ID,
  freshDbWithSession,
} from './support/db.js';

const at = '2026-05-20T10:00:00.000Z';
const CTX = {
  provenance: 'test:conjure-uncontrolled',
  sessionId: DEFAULT_TEST_SESSION_ID,
  at,
};

function setup() {
  const db = freshDbWithSession();
  const registry = createDefaultToolRegistry();
  const ctx: ToolContext = {
    db,
    rng: createSeededRng(5),
    campaignId: DEFAULT_TEST_CAMPAIGN_ID,
    sessionId: DEFAULT_TEST_SESSION_ID,
    turnId: '7vh3',
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
      ...['e1', 'b1'].map((actorId) => ({
        actorId,
        rulesRef: 'creature:goblin',
        hpMax: 7,
        hpCurrent: 7,
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
  const raw = (id: string) =>
    db
      .prepare(
        'SELECT * FROM active_effect WHERE campaign_id = ? AND effect_id = ?',
      )
      .get(DEFAULT_TEST_CAMPAIGN_ID, id) as Record<string, unknown>;
  const cast = (
    effectId: string,
    ref: string,
    creature: string,
    extra: Record<string, unknown> = {},
  ) =>
    must('start_effect', {
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
        amount: 1,
        unit: 'hour',
        anchor: 'spell-cast',
      },
      targets: [{ kind: 'combatant', ref: creature }],
      actors: [{ combatantId: creature }],
      ...extra,
    });
  const advance = (minutes: number) =>
    advanceWorldTime(db, {
      campaignId: DEFAULT_TEST_CAMPAIGN_ID,
      minutes,
      ...CTX,
    });
  const voluntaryBreak = (effectId: string) =>
    must('end_effect', {
      effectId,
      reason: 'concentration-broken',
      detail: 'voluntary',
    });
  return { db, call, must, row, effect, raw, cast, advance, voluntaryBreak };
}

describe('uncontrolled successor of a broken Conjure Elemental / Conjure Fey', () => {
  for (const [spell, label] of [
    ['spell:conjure-elemental', 'Conjure Elemental'],
    ['spell:conjure-fey', 'Conjure Fey'],
  ] as const) {
    it(`${label}: the break starts a cast-anchored, non-concentration, non-dismissible successor`, () => {
      const s = setup();
      s.cast('fx', spell, 'c-e1');
      const original = s.raw('fx');
      s.advance(20);
      const broken = s.voluntaryBreak('fx');
      expect(JSON.stringify(broken.data)).toContain('fx:uncontrolled');

      const ended = s.effect('fx');
      expect(ended.status).toBe('ended');
      expect(ended.endReason).toBe('concentration-broken');
      expect(s.row('c-e1').status).toBe('alive');

      const successor = s.raw('fx:uncontrolled');
      expect(successor).toMatchObject({
        kind: 'summoning',
        display_name: `${spell} (uncontrolled)`,
        source_kind: 'spell',
        source_ref: spell,
        source_actor_kind: 'combatant',
        source_actor_ref: 'c-wiz',
        requires_concentration: 0,
        concentration_owner_kind: null,
        concentration_owner_ref: null,
        dismissible: 0,
        status: 'active',
        duration_kind: 'timed',
        duration_amount: 1,
        duration_unit: 'hour',
        anchor_kind: 'spell-cast',
        anchor_at: original.anchor_at,
        anchor_game_time: original.anchor_game_time,
        anchor_elapsed_minutes: original.anchor_elapsed_minutes,
        // cast + 60, not break + 60
        deadline_elapsed_minutes:
          (original.anchor_elapsed_minutes as number) + 60,
      });
      const view = s.effect('fx:uncontrolled');
      expect(view.links).toHaveLength(1);
      expect(view.links[0]).toMatchObject({
        linkKind: 'actor',
        projectionRef: 'c-e1',
        status: 'active',
        cleanupOnEnd: 'remove',
        cleanupOnBreak: 'remove',
      });
      expect(view.targets.map((t) => t.ref)).toEqual(['c-e1']);

      const endedEvent = listEffectEvents(
        s.db,
        DEFAULT_TEST_CAMPAIGN_ID,
        'fx',
      ).at(-1);
      expect(endedEvent?.eventKind).toBe('ended');
      expect(endedEvent?.detail).toMatchObject({
        successorEffectId: 'fx:uncontrolled',
      });
      const createdEvent = listEffectEvents(
        s.db,
        DEFAULT_TEST_CAMPAIGN_ID,
        'fx:uncontrolled',
      )[0];
      expect(createdEvent?.eventKind).toBe('created');
      expect(createdEvent?.detail).toMatchObject({
        predecessorEffectId: 'fx',
        recordTransitionId: 'cast-anchored-removal',
      });
    });
  }

  it('removes the creature exactly at cast + 1 hour, not 1 hour after the break', () => {
    const s = setup();
    s.cast('fx', 'spell:conjure-elemental', 'c-e1');
    s.advance(20);
    s.voluntaryBreak('fx');
    s.advance(39); // 59 minutes after the summoning
    expect(s.row('c-e1').status).toBe('alive');
    expect(s.effect('fx:uncontrolled').status).toBe('active');
    s.advance(1); // exactly cast + 60
    expect(s.row('c-e1').status).toBe('absent');
    const e = s.effect('fx:uncontrolled');
    expect(e.status).toBe('ended');
    expect(e.endReason).toBe('expired');
    expect(e.links[0]).toMatchObject({ status: 'removed' });
  });

  it('refuses an explicit early expiry of the successor', () => {
    const s = setup();
    s.cast('fx', 'spell:conjure-elemental', 'c-e1');
    s.voluntaryBreak('fx');
    s.advance(10);
    const r = s.call('end_effect', {
      effectId: 'fx:uncontrolled',
      reason: 'expired',
    });
    expect(r.ok).toBe(false);
    expect(s.row('c-e1').status).toBe('alive');
  });

  it('0 HP while uncontrolled still vanishes and ends the successor source-removed', () => {
    const s = setup();
    s.cast('fx', 'spell:conjure-elemental', 'c-e1');
    s.voluntaryBreak('fx');
    const hit = s.must('update_combatant', {
      combatantId: 'c-e1',
      hpDelta: -7,
    });
    expect(hit.data).toMatchObject({
      vanished: { effectId: 'fx:uncontrolled', effectEnded: true },
    });
    expect(s.row('c-e1').status).toBe('absent');
    const e = s.effect('fx:uncontrolled');
    expect(e.status).toBe('ended');
    expect(e.endReason).toBe('source-removed');
  });

  it('the caster cannot dismiss the successor; dispelled and ruled still work', () => {
    const s = setup();
    s.cast('fx', 'spell:conjure-elemental', 'c-e1');
    s.voluntaryBreak('fx');
    const dismissed = s.call('end_effect', {
      effectId: 'fx:uncontrolled',
      reason: 'dismissed',
    });
    expect(dismissed.ok).toBe(false);
    expect(s.effect('fx:uncontrolled').status).toBe('active');
    s.must('end_effect', { effectId: 'fx:uncontrolled', reason: 'dispelled' });
    expect(s.effect('fx:uncontrolled').endReason).toBe('dispelled');
    expect(s.row('c-e1').status).toBe('absent');

    const t = setup();
    t.cast('fx', 'spell:conjure-fey', 'c-e1');
    t.voluntaryBreak('fx');
    t.must('end_effect', {
      effectId: 'fx:uncontrolled',
      reason: 'ruled',
      note: 'ruling',
    });
    expect(t.effect('fx:uncontrolled').endReason).toBe('ruled');
  });

  it('the caster can start a new concentration effect while the creature is uncontrolled', () => {
    const s = setup();
    s.cast('fx', 'spell:conjure-elemental', 'c-e1');
    s.voluntaryBreak('fx');
    s.cast('fx2', 'spell:conjure-animals', 'c-b1');
    expect(s.effect('fx2').status).toBe('active');
    expect(s.effect('fx:uncontrolled').status).toBe('active');
  });

  it('an ordinary end (dismissed, or expiry while controlled) removes the creature with no successor', () => {
    const s = setup();
    s.cast('fx', 'spell:conjure-elemental', 'c-e1', {
      dismissible: true,
    });
    s.must('end_effect', { effectId: 'fx', reason: 'dismissed' });
    expect(s.row('c-e1').status).toBe('absent');
    expect(
      listActiveEffects(s.db, DEFAULT_TEST_CAMPAIGN_ID, {
        includeEnded: true,
      }).map((e) => e.effectId),
    ).not.toContain('fx:uncontrolled');

    const t = setup();
    t.cast('fx', 'spell:conjure-elemental', 'c-e1');
    t.advance(60);
    expect(t.row('c-e1').status).toBe('absent');
    expect(t.effect('fx').endReason).toBe('expired');
    expect(
      listActiveEffects(t.db, DEFAULT_TEST_CAMPAIGN_ID, {
        includeEnded: true,
      }).map((e) => e.effectId),
    ).not.toContain('fx:uncontrolled');
  });

  it('Conjure Animals (break removes presence) gets no successor', () => {
    const s = setup();
    s.cast('fx', 'spell:conjure-animals', 'c-b1');
    s.voluntaryBreak('fx');
    expect(s.row('c-b1').status).toBe('absent');
    expect(
      listActiveEffects(s.db, DEFAULT_TEST_CAMPAIGN_ID, {
        includeEnded: true,
      }).map((e) => e.effectId),
    ).not.toContain('fx:uncontrolled');
  });

  it('refuses to invent another id when the successor id is taken', () => {
    const s = setup();
    s.must('start_effect', {
      effectId: 'fx:uncontrolled',
      kind: 'summoning',
      displayName: 'squatter',
      source: { kind: 'ruling' },
      duration: { kind: 'until-removed' },
    });
    s.cast('fx', 'spell:conjure-elemental', 'c-e1');
    const r = s.call('end_effect', {
      effectId: 'fx',
      reason: 'concentration-broken',
      detail: 'voluntary',
    });
    expect(r.ok).toBe(false);
    expect(s.effect('fx').status).toBe('active');
  });

  describe('every concentration-break route produces the successor', () => {
    it('failed damage concentration save', () => {
      const s = setup();
      s.cast('fx', 'spell:conjure-elemental', 'c-e1');
      const result = resolveConcentrationCheck(s.db, {
        campaignId: DEFAULT_TEST_CAMPAIGN_ID,
        owner: { kind: 'combatant', ref: 'c-wiz' },
        damage: 7,
        save: {
          vs: 10,
          dice: '1d20',
          rolls: [2],
          natural: 2,
          modifierTotal: 0,
          total: 2,
        },
        ...CTX,
      });
      expect(result.broken).toBe(true);
      expect(result.cleanup?.successorEffectId).toBe('fx:uncontrolled');
      expect(s.effect('fx:uncontrolled').status).toBe('active');
      expect(s.row('c-e1').status).toBe('alive');
    });

    it('caster death (life-state hook)', () => {
      const s = setup();
      s.cast('fx', 'spell:conjure-elemental', 'c-e1');
      s.must('update_combatant', { combatantId: 'c-wiz', hpDelta: -20 });
      expect(s.effect('fx').endReason).toBe('concentration-broken');
      expect(s.effect('fx:uncontrolled').status).toBe('active');
      expect(s.row('c-e1').status).toBe('alive');
    });

    it('new concentration replacement', () => {
      const s = setup();
      s.cast('fx', 'spell:conjure-fey', 'c-e1');
      s.cast('fx2', 'spell:conjure-animals', 'c-b1');
      expect(s.effect('fx').endReason).toBe('concentration-broken');
      expect(s.effect('fx:uncontrolled').status).toBe('active');
      expect(s.row('c-e1').status).toBe('alive');
    });

    it('owner removed at combat closure', () => {
      const s = setup();
      s.cast('fx', 'spell:conjure-elemental', 'c-e1');
      s.must('close_combat_instance', { status: 'completed' });
      expect(s.effect('fx').endReason).toBe('concentration-broken');
      // The creature has a durable campaign-actor identity, so closure
      // rebinds the successor's link to it rather than releasing it; the
      // deadline stays the cast-anchored one and still removes the creature.
      const successor = s.effect('fx:uncontrolled');
      expect(successor.status).toBe('active');
      expect(successor.links[0]).toMatchObject({
        linkKind: 'actor',
        status: 'active',
        cleanupOnEnd: 'remove',
      });
      expect(s.raw('fx:uncontrolled').deadline_elapsed_minutes).toBe(
        (s.raw('fx').anchor_elapsed_minutes as number) + 60,
      );
      s.advance(60);
      expect(
        getCampaignActor(s.db, DEFAULT_TEST_CAMPAIGN_ID, 'e1')?.status,
      ).toBe('absent');
      expect(s.effect('fx:uncontrolled').endReason).toBe('expired');
    });
  });
});
