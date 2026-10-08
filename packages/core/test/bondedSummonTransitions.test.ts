/** eshyra-82uk: transition_bonded_summon executes the action-triggered presence
 * transitions of Find Familiar (temporary dismissal to the pocket dimension,
 * recall, permanent dismissal) and Find Steed (dismissal, release), driven
 * through the real tool registry. */
import { describe, expect, it } from 'vitest';
import type { ToolContext } from '../src/internal.js';
import {
  auditActiveEffectIntegrity,
  createDefaultToolRegistry,
  createSeededRng,
  getCampaignActor,
  listActiveEffects,
  listCombatants,
  listEffectEvents,
  updateCampaignActor,
} from '../src/internal.js';
import {
  DEFAULT_TEST_CAMPAIGN_ID,
  DEFAULT_TEST_SESSION_ID,
  freshDbWithSession,
} from './support/db.js';

const at = '2026-05-20T10:00:00.000Z';
const campaign = DEFAULT_TEST_CAMPAIGN_ID;

function setup() {
  const db = freshDbWithSession();
  const registry = createDefaultToolRegistry();
  const ctx: ToolContext = {
    db,
    rng: createSeededRng(5),
    campaignId: campaign,
    sessionId: DEFAULT_TEST_SESSION_ID,
    turnId: '82uk',
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
      {
        actorId: 'steed',
        rulesRef: 'creature:warhorse',
        hpMax: 19,
        hpCurrent: 19,
        side: 'ally',
      },
      {
        actorId: 'fam',
        rulesRef: 'creature:bat',
        hpMax: 5,
        hpCurrent: 5,
        side: 'ally',
        faction: 'party',
      },
    ],
  });
  const bond = (effectId: string, actorId: string) =>
    must('start_effect', {
      effectId,
      kind: 'summoning',
      displayName: effectId,
      source: {
        kind: 'spell',
        ref: actorId === 'steed' ? 'spell:find-steed' : 'spell:find-familiar',
        actor: { kind: 'campaign_actor', ref: 'wiz' },
      },
      duration: { kind: 'until-removed' },
      actors: [{ combatantId: `c-${actorId}`, campaignActorId: actorId }],
    });
  const actor = (id: string) => {
    const a = getCampaignActor(db, campaign, id);
    if (!a) throw new Error(`missing actor ${id}`);
    return a;
  };
  const effect = (id: string) => {
    const e = listActiveEffects(db, campaign, { includeEnded: true }).find(
      (x) => x.effectId === id,
    );
    if (!e) throw new Error(`missing effect ${id}`);
    return e;
  };
  const combatant = (id: string) => {
    const c = listCombatants(db, campaign).find((x) => x.combatantId === id);
    if (!c) throw new Error(`missing combatant ${id}`);
    return c;
  };
  const transition = (args: Record<string, unknown>) =>
    call('transition_bonded_summon', args);
  const fam = (trigger: string, extra: Record<string, unknown> = {}) =>
    transition({
      effectId: 'fam-fx',
      spellRef: 'spell:find-familiar',
      trigger,
      ...extra,
    });
  const steed = (trigger: string) =>
    transition({
      effectId: 'steed-fx',
      spellRef: 'spell:find-steed',
      trigger,
    });
  const message = (r: ReturnType<typeof call>) =>
    r.ok ? '' : JSON.stringify(r);
  /** Everything a refused call must leave untouched. */
  const snapshot = () => ({
    actors: ['wiz', 'steed', 'fam'].map(actor),
    combatants: listCombatants(db, campaign),
    effects: listActiveEffects(db, campaign, { includeEnded: true }),
    events: ['fam-fx', 'steed-fx'].map((id) =>
      listEffectEvents(db, campaign, id),
    ),
  });
  return {
    db,
    call,
    must,
    bond,
    actor,
    effect,
    combatant,
    transition,
    fam,
    steed,
    message,
    snapshot,
  };
}

describe('transition_bonded_summon: Find Familiar out of combat', () => {
  it('dismisses to the pocket dimension unchanged, recalls unchanged, and start_encounter refuses it while pocketed', () => {
    const s = setup();
    s.bond('fam-fx', 'fam');
    s.must('update_combatant', { combatantId: 'c-fam', hpDelta: -2 });
    s.must('adjust_exhaustion', { combatantId: 'c-fam', delta: 1 });
    s.must('close_combat_instance', { status: 'completed' });
    const before = s.actor('fam');
    expect(before).toMatchObject({ status: 'alive', hpCurrent: 3, hpMax: 5 });
    expect(before.conditions.map((c) => c.id)).toContain('exhaustion');

    const dismissed = s.must('transition_bonded_summon', {
      effectId: 'fam-fx',
      spellRef: 'spell:find-familiar',
      trigger: 'action-temporary-dismissal',
    });
    expect(dismissed.data).toMatchObject({
      transitionId: 'temporary-pocket-dismissal',
      actorId: 'fam',
      from: { presence: 'present', link: 'active' },
      to: { presence: 'pocket-dimension', link: 'active' },
      effectEnded: false,
    });
    expect(s.actor('fam')).toEqual({ ...before, status: 'pocketed' });
    expect(s.effect('fam-fx').status).toBe('active');
    expect(
      s.effect('fam-fx').links.find((l) => l.linkKind === 'actor')?.status,
    ).toBe('active');

    const refused = s.call('start_encounter', {
      combatInstanceId: 'c2',
      actors: [{ actorId: 'fam' }],
    });
    expect(refused.ok).toBe(false);
    expect(s.message(refused)).toMatch(
      /pocket dimension; recall it with transition_bonded_summon trigger action-recall/,
    );
    expect(s.actor('fam').status).toBe('pocketed');

    const recalled = s.must('transition_bonded_summon', {
      effectId: 'fam-fx',
      spellRef: 'spell:find-familiar',
      trigger: 'action-recall',
    });
    expect(recalled.data).toMatchObject({
      transitionId: 'pocket-recall',
      from: { presence: 'pocket-dimension' },
      to: { presence: 'present' },
      narratedPlacement: { kind: 'place-in-unoccupied-space', withinFeet: 30 },
    });
    expect(s.actor('fam')).toEqual(before);
    expect(auditActiveEffectIntegrity(s.db, campaign)).toEqual([]);
  });

  it('recasting while pocketed reforms the familiar and it stays pocketed', () => {
    const s = setup();
    s.bond('fam-fx', 'fam');
    s.must('adjust_exhaustion', { combatantId: 'c-fam', delta: 1 });
    s.must('close_combat_instance', { status: 'completed' });
    s.must('transition_bonded_summon', {
      effectId: 'fam-fx',
      spellRef: 'spell:find-familiar',
      trigger: 'action-temporary-dismissal',
    });
    const r = s.must('recast_bonded_summon', {
      effectId: 'fam-fx',
      spellRef: 'spell:find-familiar',
      form: 'creature:cat',
    });
    expect(r.data).toMatchObject({
      transitionId: 'reform-pocketed-familiar',
      actorId: 'fam',
      rulesRef: 'creature:cat',
      hpCurrent: 2,
      hpMax: 2,
    });
    expect(s.actor('fam')).toMatchObject({
      status: 'pocketed',
      rulesRef: 'creature:cat',
      hpCurrent: 2,
      hpMax: 2,
    });
  });

  it('end_effect on the Find Familiar effect while pocketed leaves the actor absent, not pocketed', () => {
    const s = setup();
    s.bond('fam-fx', 'fam');
    s.must('close_combat_instance', { status: 'completed' });
    s.must('transition_bonded_summon', {
      effectId: 'fam-fx',
      spellRef: 'spell:find-familiar',
      trigger: 'action-temporary-dismissal',
    });
    s.must('end_effect', { effectId: 'fam-fx', reason: 'ruled', note: 't' });
    expect(s.actor('fam').status).toBe('absent');
    expect(s.effect('fam-fx').status).toBe('ended');
    expect(auditActiveEffectIntegrity(s.db, campaign)).toEqual([]);
  });

  it('refuses to hand-edit a pocketed actor or to set the pocketed status', () => {
    const s = setup();
    s.bond('fam-fx', 'fam');
    s.must('close_combat_instance', { status: 'completed' });
    s.must('transition_bonded_summon', {
      effectId: 'fam-fx',
      spellRef: 'spell:find-familiar',
      trigger: 'action-temporary-dismissal',
    });
    const before = s.actor('fam');
    const edit = (input: Record<string, unknown>) => {
      try {
        updateCampaignActor(s.db, {
          campaignId: campaign,
          provenance: 'test',
          sessionId: DEFAULT_TEST_SESSION_ID,
          at,
          ...input,
        } as Parameters<typeof updateCampaignActor>[1]);
        return 'accepted';
      } catch (e) {
        return e instanceof Error ? e.message : String(e);
      }
    };
    expect(edit({ actorId: 'fam', hpCurrent: 4 })).toMatch(/pocket dimension/);
    expect(edit({ actorId: 'fam', addCondition: { id: 'poisoned' } })).toMatch(
      /pocket dimension/,
    );
    expect(edit({ actorId: 'wiz', status: 'pocketed' })).toMatch(
      /engine-owned/,
    );
    expect(s.actor('fam')).toEqual(before);
  });
});

describe('transition_bonded_summon: Find Familiar in combat', () => {
  it('dismiss takes the combatant out of play and pockets the actor at its damaged HP; recall re-enters as a new row', () => {
    const s = setup();
    s.bond('fam-fx', 'fam');
    s.must('update_combatant', { combatantId: 'c-fam', hpDelta: -2 });

    const d = s.must('transition_bonded_summon', {
      effectId: 'fam-fx',
      spellRef: 'spell:find-familiar',
      trigger: 'action-temporary-dismissal',
    });
    expect(d.data).toMatchObject({ combatantLeft: 'c-fam' });
    expect(s.combatant('c-fam').status).toBe('absent');
    expect(s.actor('fam')).toMatchObject({
      status: 'pocketed',
      hpCurrent: 3,
      hpMax: 5,
      rulesRef: 'creature:bat',
    });
    const link = s.effect('fam-fx').links.find((l) => l.linkKind === 'actor');
    expect(link).toMatchObject({
      status: 'active',
      target: { kind: 'campaign_actor', ref: 'fam' },
    });
    // A pocketed creature cannot be acted on in combat.
    const hit = s.call('update_combatant', {
      combatantId: 'c-fam',
      hpDelta: -1,
    });
    expect(hit.ok).toBe(false);
    expect(s.actor('fam').hpCurrent).toBe(3);

    const r = s.must('transition_bonded_summon', {
      effectId: 'fam-fx',
      spellRef: 'spell:find-familiar',
      trigger: 'action-recall',
      placement: 'adjacent to the wizard',
    });
    expect(r.data).toMatchObject({ combatantEntered: 'c-fam-2' });
    expect(s.combatant('c-fam').status).toBe('absent');
    expect(s.combatant('c-fam-2')).toMatchObject({
      status: 'alive',
      hpCurrent: 3,
      hpMax: 5,
      side: 'ally',
      faction: 'party',
      identityKind: 'campaign_actor',
      identityRef: 'fam',
      rulesRef: 'creature:bat',
      zeroHpRule: 'vanish-bonded',
      placement: 'adjacent to the wizard',
    });
    expect(s.actor('fam')).toMatchObject({ status: 'alive', hpCurrent: 3 });

    // The new row is the actor's current projection: its damage syncs back.
    s.must('update_combatant', { combatantId: 'c-fam-2', hpDelta: -1 });
    expect(s.actor('fam')).toMatchObject({ status: 'alive', hpCurrent: 2 });
    // Closing the instance leaves the actor with the new row's state; the
    // stale absent row never overwrites it.
    s.must('close_combat_instance', { status: 'completed' });
    expect(s.actor('fam')).toMatchObject({ status: 'alive', hpCurrent: 2 });
    expect(auditActiveEffectIntegrity(s.db, campaign)).toEqual([]);
    const events = listEffectEvents(s.db, campaign, 'fam-fx').filter(
      (e) => e.eventKind === 'presence-transition',
    );
    expect(events.map((e) => e.detail)).toMatchObject([
      {
        spellRef: 'spell:find-familiar',
        transitionId: 'temporary-pocket-dismissal',
        trigger: 'action-temporary-dismissal',
        actor: 'fam',
        from: { presence: 'present' },
        to: { presence: 'pocket-dimension' },
        combatantLeft: 'c-fam',
      },
      {
        transitionId: 'pocket-recall',
        trigger: 'action-recall',
        from: { presence: 'pocket-dimension' },
        to: { presence: 'present' },
        combatantEntered: 'c-fam-2',
      },
    ]);
  });

  it('dismissed and then the combat closed without a recall: the actor stays pocketed', () => {
    const s = setup();
    s.bond('fam-fx', 'fam');
    s.must('update_combatant', { combatantId: 'c-fam', hpDelta: -2 });
    s.must('transition_bonded_summon', {
      effectId: 'fam-fx',
      spellRef: 'spell:find-familiar',
      trigger: 'action-temporary-dismissal',
    });
    s.must('close_combat_instance', { status: 'completed' });
    expect(s.actor('fam')).toMatchObject({
      status: 'pocketed',
      hpCurrent: 3,
      hpMax: 5,
    });
    expect(
      s.effect('fam-fx').links.find((l) => l.linkKind === 'actor'),
    ).toMatchObject({ status: 'active', target: { kind: 'campaign_actor' } });
    expect(auditActiveEffectIntegrity(s.db, campaign)).toEqual([]);
  });

  it('recall into an active instance with no earlier row needs a side', () => {
    const s = setup();
    s.bond('fam-fx', 'fam');
    s.must('close_combat_instance', { status: 'completed' });
    s.must('transition_bonded_summon', {
      effectId: 'fam-fx',
      spellRef: 'spell:find-familiar',
      trigger: 'action-temporary-dismissal',
    });
    s.must('start_encounter', {
      combatInstanceId: 'c2',
      actors: [
        {
          actorId: 'wiz',
          rulesRef: 'creature:goblin',
          hpMax: 20,
          hpCurrent: 20,
          side: 'ally',
        },
      ],
    });
    const before = s.snapshot();
    const refused = s.fam('action-recall');
    expect(refused.ok).toBe(false);
    expect(s.message(refused)).toMatch(/pass side/);
    expect(s.snapshot()).toEqual(before);

    const r = s.must('transition_bonded_summon', {
      effectId: 'fam-fx',
      spellRef: 'spell:find-familiar',
      trigger: 'action-recall',
      side: 'ally',
    });
    expect(r.data).toMatchObject({ combatantEntered: 'c2-fam' });
    expect(s.combatant('c2-fam')).toMatchObject({
      status: 'alive',
      side: 'ally',
      identityRef: 'fam',
      hpCurrent: 5,
    });
    expect(s.actor('fam').status).toBe('alive');
  });
});

describe('transition_bonded_summon: Find Steed', () => {
  it('action-dismissal in combat: combatant and actor absent, bond active; a recast restores it at maximum HP', () => {
    const s = setup();
    s.bond('steed-fx', 'steed');
    s.must('update_combatant', { combatantId: 'c-steed', hpDelta: -9 });
    const r = s.must('transition_bonded_summon', {
      effectId: 'steed-fx',
      spellRef: 'spell:find-steed',
      trigger: 'action-dismissal',
    });
    expect(r.data).toMatchObject({
      transitionId: 'action-dismissal',
      combatantLeft: 'c-steed',
      from: { presence: 'present' },
      to: { presence: 'absent', link: 'active' },
      effectEnded: false,
    });
    expect(s.combatant('c-steed').status).toBe('absent');
    expect(s.actor('steed').status).toBe('absent');
    expect(s.effect('steed-fx').status).toBe('active');
    expect(
      s.effect('steed-fx').links.find((l) => l.linkKind === 'actor'),
    ).toMatchObject({ status: 'active', target: { kind: 'campaign_actor' } });
    // start_encounter refuses a bonded absent steed.
    s.must('close_combat_instance', { status: 'completed' });
    const admit = s.call('start_encounter', {
      combatInstanceId: 'c2',
      actors: [{ actorId: 'steed', hpCurrent: 19 }],
    });
    expect(admit.ok).toBe(false);
    expect(s.message(admit)).toMatch(/still bonded/);
    const recast = s.must('recast_bonded_summon', {
      effectId: 'steed-fx',
      spellRef: 'spell:find-steed',
    });
    expect(recast.data).toMatchObject({
      transitionId: 'restore-same-steed',
      hpCurrent: 19,
      hpMax: 19,
    });
    expect(s.actor('steed')).toMatchObject({ status: 'alive', hpCurrent: 19 });
  });

  it('action-dismissal out of combat, then recast restores the same steed at maximum HP', () => {
    const s = setup();
    s.bond('steed-fx', 'steed');
    s.must('update_combatant', { combatantId: 'c-steed', hpDelta: -9 });
    s.must('close_combat_instance', { status: 'completed' });
    expect(s.actor('steed').hpCurrent).toBe(10);
    const r = s.must('transition_bonded_summon', {
      effectId: 'steed-fx',
      spellRef: 'spell:find-steed',
      trigger: 'action-dismissal',
    });
    expect(r.data).not.toHaveProperty('combatantLeft');
    expect(s.actor('steed').status).toBe('absent');
    s.must('recast_bonded_summon', {
      effectId: 'steed-fx',
      spellRef: 'spell:find-steed',
    });
    expect(s.actor('steed')).toMatchObject({
      status: 'alive',
      hpCurrent: 19,
      hpMax: 19,
    });
  });

  it.each([
    ['present, in combat', true, false],
    ['present, out of combat', false, false],
    ['absent after being dismissed', false, true],
  ])(
    'release from %s ends the effect (dismissed); the creature is an unbonded absent actor admitted only as a new manifestation',
    (_label, inCombat, dismissFirst) => {
      const s = setup();
      s.bond('steed-fx', 'steed');
      if (!inCombat) s.must('close_combat_instance', { status: 'completed' });
      if (dismissFirst) s.steed('action-dismissal');
      const r = s.must('transition_bonded_summon', {
        effectId: 'steed-fx',
        spellRef: 'spell:find-steed',
        trigger: 'action-release',
      });
      expect(r.data).toMatchObject({
        transitionId: 'release-bond',
        to: { presence: 'absent', link: 'none' },
        effectEnded: true,
      });
      const fx = s.effect('steed-fx');
      expect(fx).toMatchObject({ status: 'ended', endReason: 'dismissed' });
      expect(fx.links.find((l) => l.linkKind === 'actor')?.status).toBe(
        'removed',
      );
      expect(s.actor('steed').status).toBe('absent');
      expect(
        listEffectEvents(s.db, campaign, 'steed-fx')
          .map((e) => e.eventKind)
          .at(-1),
      ).toBe('ended');
      expect(auditActiveEffectIntegrity(s.db, campaign)).toEqual([]);
      if (inCombat) s.must('close_combat_instance', { status: 'completed' });
      // Now unbonded: admission is a new manifestation.
      const bare = s.call('start_encounter', {
        combatInstanceId: 'c3',
        actors: [{ actorId: 'steed' }],
      });
      expect(bare.ok).toBe(false);
      expect(s.message(bare)).toMatch(/new manifestation/);
      s.must('start_encounter', {
        combatInstanceId: 'c4',
        actors: [{ actorId: 'steed', hpCurrent: 19 }],
      });
      expect(s.combatant('c4-steed')).toMatchObject({
        status: 'alive',
        hpCurrent: 19,
      });
      // Released: it cannot be recalled by a recast either.
      const recast = s.call('recast_bonded_summon', {
        effectId: 'steed-fx',
        spellRef: 'spell:find-steed',
      });
      expect(recast.ok).toBe(false);
    },
  );
});

describe('transition_bonded_summon: permanent dismissal', () => {
  it.each([
    ['present', false],
    ['pocketed', true],
  ])(
    'Find Familiar dismissed forever from %s ends the effect and leaves the actor absent',
    (_label, pocket) => {
      const s = setup();
      s.bond('fam-fx', 'fam');
      s.must('close_combat_instance', { status: 'completed' });
      if (pocket) s.fam('action-temporary-dismissal');
      const r = s.must('transition_bonded_summon', {
        effectId: 'fam-fx',
        spellRef: 'spell:find-familiar',
        trigger: 'action-permanent-dismissal',
      });
      expect(r.data).toMatchObject({
        transitionId: 'permanent-dismissal-from-present-or-pocket',
        to: { presence: 'absent', link: 'none' },
        effectEnded: true,
      });
      expect(s.effect('fam-fx')).toMatchObject({
        status: 'ended',
        endReason: 'dismissed',
      });
      expect(s.actor('fam').status).toBe('absent');
      expect(auditActiveEffectIntegrity(s.db, campaign)).toEqual([]);
    },
  );

  it('dismissed forever from the pocket while the combat still holds its absent row leaves the actor absent', () => {
    const s = setup();
    s.bond('fam-fx', 'fam');
    s.fam('action-temporary-dismissal');
    expect(s.actor('fam').status).toBe('pocketed');
    s.must('transition_bonded_summon', {
      effectId: 'fam-fx',
      spellRef: 'spell:find-familiar',
      trigger: 'action-permanent-dismissal',
    });
    expect(s.actor('fam').status).toBe('absent');
    s.must('close_combat_instance', { status: 'completed' });
    expect(s.actor('fam').status).toBe('absent');
  });

  it('is refused from a 0-HP absence, naming the unresolved source ambiguity', () => {
    const s = setup();
    s.bond('fam-fx', 'fam');
    s.must('update_combatant', { combatantId: 'c-fam', hpDelta: -5 });
    expect(s.actor('fam').status).toBe('absent');
    const before = s.snapshot();
    const r = s.fam('action-permanent-dismissal');
    expect(r.ok).toBe(false);
    expect(s.message(r)).toContain(
      'ambiguity:find-familiar-permanent-dismissal-after-zero-hp',
    );
    expect(s.snapshot()).toEqual(before);
  });
});

describe('transition_bonded_summon: refusals leave canonical state unchanged', () => {
  it('refuses a trigger the presence does not allow', () => {
    const s = setup();
    s.bond('fam-fx', 'fam');
    s.bond('steed-fx', 'steed');
    s.must('close_combat_instance', { status: 'completed' });
    const before = s.snapshot();
    const recallWhilePresent = s.fam('action-recall');
    expect(recallWhilePresent.ok).toBe(false);
    expect(s.message(recallWhilePresent)).toMatch(
      /no action-recall transition/,
    );
    const steedTemporary = s.steed('action-temporary-dismissal');
    expect(steedTemporary.ok).toBe(false);
    expect(s.message(steedTemporary)).toMatch(
      /no action-temporary-dismissal transition/,
    );
    expect(s.snapshot()).toEqual(before);

    s.fam('action-temporary-dismissal');
    const pocketed = s.snapshot();
    const dismissalWhilePocketed = s.fam('action-dismissal');
    expect(dismissalWhilePocketed.ok).toBe(false);
    expect(s.message(dismissalWhilePocketed)).toMatch(
      /no action-dismissal transition for a creature that is in its pocket dimension/,
    );
    const again = s.fam('action-temporary-dismissal');
    expect(again.ok).toBe(false);
    expect(s.snapshot()).toEqual(pocketed);
  });

  it('refuses a ruling-sourced bond, a wrong spellRef, and a suppressed or ended effect', () => {
    const s = setup();
    s.must('start_effect', {
      effectId: 'ruling-fx',
      kind: 'summoning',
      displayName: 'ruling-fx',
      source: { kind: 'ruling' },
      duration: { kind: 'until-removed' },
      actors: [
        {
          combatantId: 'c-steed',
          campaignActorId: 'steed',
          atZeroHitPoints: 'vanish-bonded',
        },
      ],
    });
    s.bond('fam-fx', 'fam');
    s.must('close_combat_instance', { status: 'completed' });
    const before = s.snapshot();
    const ruling = s.transition({
      effectId: 'ruling-fx',
      spellRef: 'spell:find-steed',
      trigger: 'action-dismissal',
    });
    expect(ruling.ok).toBe(false);
    expect(s.message(ruling)).toMatch(/not recorded from its spell/);
    const wrong = s.transition({
      effectId: 'fam-fx',
      spellRef: 'spell:find-steed',
      trigger: 'action-temporary-dismissal',
    });
    expect(wrong.ok).toBe(false);
    expect(s.message(wrong)).toMatch(/not 'spell:find-steed'/);
    expect(s.snapshot()).toEqual(before);

    s.must('suppress_effect', { effectId: 'fam-fx' });
    const suppressed = s.snapshot();
    const sup = s.fam('action-temporary-dismissal');
    expect(sup.ok).toBe(false);
    expect(s.message(sup)).toMatch(/suppressed/);
    expect(s.snapshot()).toEqual(suppressed);
    s.must('unsuppress_effect', { effectId: 'fam-fx' });

    s.must('end_effect', { effectId: 'fam-fx', reason: 'ruled', note: 't' });
    const ended = s.snapshot();
    const e = s.fam('action-temporary-dismissal');
    expect(e.ok).toBe(false);
    expect(s.message(e)).toMatch(/has ended/);
    expect(s.snapshot()).toEqual(ended);
  });
});

describe('pocketed integrity audit', () => {
  it('reports a pocketed actor that no active spell-sourced bond holds', () => {
    const s = setup();
    s.must('close_combat_instance', { status: 'completed' });
    s.db
      .prepare(
        "UPDATE campaign_actor SET status = 'pocketed' WHERE actor_id = 'fam'",
      )
      .run();
    expect(auditActiveEffectIntegrity(s.db, campaign)).toEqual([
      expect.objectContaining({
        issue: expect.stringContaining("'fam' is pocketed"),
      }),
    ]);
  });
});
