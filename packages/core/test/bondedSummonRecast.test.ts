/** eshyra-s02z / eshyra-71u1: recast_bonded_summon restores an absent bonded
 * creature and reforms a present familiar (Find Familiar / Find Steed), driven
 * through the real tool registry. */
import { describe, expect, it } from 'vitest';
import type { ToolContext } from '../src/internal.js';
import {
  createDefaultToolRegistry,
  createSeededRng,
  getCampaignActor,
  listActiveEffects,
  listCombatants,
  listEffectEvents,
} from '../src/internal.js';
import { lookupCampaignRecord } from '../src/state/campaignRecordLookup.js';
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
    turnId: 's02z',
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
        hpMax: 1,
        hpCurrent: 1,
        side: 'ally',
      },
    ],
  });
  const bondArgs = (
    effectId: string,
    actorId: string,
    over: Record<string, unknown> = {},
  ) => ({
    effectId,
    kind: 'summoning',
    displayName: effectId,
    source: {
      kind: 'spell',
      ref: actorId === 'steed' ? 'spell:find-steed' : 'spell:find-familiar',
      actor: { kind: 'combatant', ref: 'c-wiz' },
    },
    duration: { kind: 'until-removed' },
    actors: [{ combatantId: `c-${actorId}`, campaignActorId: actorId }],
    ...over,
  });
  const bond = (
    effectId: string,
    actorId: string,
    over: Record<string, unknown> = {},
  ) => must('start_effect', bondArgs(effectId, actorId, over));
  const tryBond = (
    effectId: string,
    actorId: string,
    over: Record<string, unknown> = {},
  ) => call('start_effect', bondArgs(effectId, actorId, over));
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
  const vanish = (combatantId: string, hp: number) =>
    must('update_combatant', { combatantId, hpDelta: -hp });
  const recast = (args: Record<string, unknown>) =>
    call('recast_bonded_summon', args);
  const message = (r: ReturnType<typeof call>) =>
    r.ok ? '' : JSON.stringify(r);
  return {
    db,
    call,
    must,
    bond,
    tryBond,
    actor,
    effect,
    vanish,
    recast,
    message,
  };
}

const steedRecast = {
  effectId: 'steed-fx',
  spellRef: 'spell:find-steed',
};

describe('recast_bonded_summon: Find Steed (restore-same-actor)', () => {
  it('restores the same actor to maximum HP after combat closed; the link stays and start_encounter admits it', () => {
    const s = setup();
    s.bond('steed-fx', 'steed');
    s.vanish('c-steed', 19);
    expect(s.actor('steed')).toMatchObject({ status: 'absent', hpCurrent: 0 });
    s.must('close_combat_instance', { status: 'completed' });
    const r = s.must('recast_bonded_summon', steedRecast);
    expect(r.data).toMatchObject({
      actorId: 'steed',
      transitionId: 'restore-same-steed',
      rulesRef: 'creature:warhorse',
      hpCurrent: 19,
      hpMax: 19,
    });
    expect(s.actor('steed')).toMatchObject({
      actorId: 'steed',
      status: 'alive',
      hpCurrent: 19,
      hpMax: 19,
      rulesRef: 'creature:warhorse',
    });
    const fx = s.effect('steed-fx');
    expect(fx.status).toBe('active');
    expect(fx.links.find((l) => l.linkKind === 'actor')?.status).toBe('active');
    s.must('start_encounter', {
      combatInstanceId: 'c2',
      actors: [{ actorId: 'steed' }],
    });
    expect(
      listCombatants(s.db, campaign).find((c) => c.combatantId === 'c2-steed'),
    ).toMatchObject({
      status: 'alive',
      hpCurrent: 19,
      hpMax: 19,
      zeroHpRule: 'vanish-bonded',
    });
    // The closed combat's absent row did not sync back over the restored actor.
    expect(s.actor('steed').status).toBe('alive');
  });

  it('restores to the halved effective maximum under exhaustion level 4', () => {
    const s = setup();
    s.bond('steed-fx', 'steed');
    s.must('adjust_exhaustion', { combatantId: 'c-steed', delta: 4 });
    s.vanish('c-steed', 9);
    expect(s.actor('steed').status).toBe('absent');
    s.must('close_combat_instance', { status: 'completed' });
    const r = s.must('recast_bonded_summon', steedRecast);
    expect(r.data).toMatchObject({ hpCurrent: 9, hpMax: 19 });
    expect(s.actor('steed')).toMatchObject({
      status: 'alive',
      hpCurrent: 9,
      hpMax: 19,
    });
    expect(s.actor('steed').conditions.map((c) => c.id)).toContain(
      'exhaustion',
    );
  });

  it('refuses a form for the steed, leaving it absent', () => {
    const s = setup();
    s.bond('steed-fx', 'steed');
    s.vanish('c-steed', 19);
    s.must('close_combat_instance', { status: 'completed' });
    const r = s.recast({ ...steedRecast, form: 'creature:warhorse' });
    expect(r.ok).toBe(false);
    expect(s.message(r)).toMatch(/takes no form/);
    expect(s.actor('steed').status).toBe('absent');
  });

  it('refuses while the actor still has a combatant in an active combat instance', () => {
    const s = setup();
    s.bond('steed-fx', 'steed');
    s.vanish('c-steed', 19);
    const r = s.recast(steedRecast);
    expect(r.ok).toBe(false);
    expect(s.message(r)).toMatch(/active combat instance/);
    expect(s.actor('steed').status).toBe('absent');
  });

  it('refuses a present steed: no cast-again transition for a present creature', () => {
    const s = setup();
    s.bond('steed-fx', 'steed');
    s.must('close_combat_instance', { status: 'completed' });
    const before = s.actor('steed');
    const r = s.recast(steedRecast);
    expect(r.ok).toBe(false);
    expect(s.message(r)).toMatch(
      /no cast-again transition for a present creature whose link is active/,
    );
    expect(s.actor('steed')).toEqual(before);
    expect(
      listEffectEvents(s.db, campaign, 'steed-fx').filter(
        (e) => e.eventKind === 'recast',
      ),
    ).toEqual([]);
  });

  it('refuses after the effect ended (the bond is gone)', () => {
    const s = setup();
    s.bond('steed-fx', 'steed');
    s.vanish('c-steed', 19);
    s.must('close_combat_instance', { status: 'completed' });
    s.must('end_effect', { effectId: 'steed-fx', reason: 'ruled', note: 't' });
    const r = s.recast(steedRecast);
    expect(r.ok).toBe(false);
    expect(s.message(r)).toMatch(/has ended/);
    expect(s.actor('steed').status).toBe('absent');
  });

  it('refuses a suppressed effect', () => {
    const s = setup();
    s.bond('steed-fx', 'steed');
    s.vanish('c-steed', 19);
    s.must('close_combat_instance', { status: 'completed' });
    s.must('suppress_effect', { effectId: 'steed-fx' });
    const r = s.recast(steedRecast);
    expect(r.ok).toBe(false);
    expect(s.message(r)).toMatch(/suppressed/);
    expect(s.actor('steed').status).toBe('absent');
  });

  it('refuses a different spell than the one that created the bond', () => {
    const s = setup();
    s.bond('steed-fx', 'steed');
    s.vanish('c-steed', 19);
    s.must('close_combat_instance', { status: 'completed' });
    const r = s.recast({
      effectId: 'steed-fx',
      spellRef: 'spell:conjure-animals',
    });
    expect(r.ok).toBe(false);
    expect(s.message(r)).toMatch(/was cast from 'spell:find-steed'/);
    expect(s.actor('steed').status).toBe('absent');
  });

  it('refuses a spell the bond was not cast from and an unknown effect', () => {
    const s = setup();
    s.bond('steed-fx', 'steed');
    expect(
      s.message(s.recast({ effectId: 'steed-fx', spellRef: 'spell:nope' })),
    ).toMatch(/was cast from 'spell:find-steed', not 'spell:nope'/);
    expect(
      s.message(s.recast({ effectId: 'nope', spellRef: 'spell:find-steed' })),
    ).toMatch(/no active effect 'nope'/);
  });

  it('lets the restored steed vanish again at 0 HP, and the ledger records the recast', () => {
    const s = setup();
    s.bond('steed-fx', 'steed');
    s.vanish('c-steed', 19);
    s.must('close_combat_instance', { status: 'completed' });
    s.must('recast_bonded_summon', steedRecast);
    s.must('start_encounter', {
      combatInstanceId: 'c2',
      actors: [{ actorId: 'steed' }, { actorId: 'wiz' }],
    });
    const hit = s.must('update_combatant', {
      combatantId: 'c2-steed',
      hpDelta: -19,
    });
    expect(hit.data).toMatchObject({
      vanished: { rule: 'vanish-bonded', linkKept: true, effectEnded: false },
    });
    expect(s.actor('steed').status).toBe('absent');
    const recasts = listEffectEvents(s.db, campaign, 'steed-fx').filter(
      (e) => e.eventKind === 'recast',
    );
    expect(recasts).toHaveLength(1);
    expect(recasts[0]?.detail).toEqual({
      spellRef: 'spell:find-steed',
      transitionId: 'restore-same-steed',
      actor: 'steed',
      hpCurrent: 19,
      hpMax: 19,
    });
  });
});

describe('recast_bonded_summon: Find Familiar (select-new-form)', () => {
  const famRecast = { effectId: 'fam-fx', spellRef: 'spell:find-familiar' };
  const downFamiliar = (s: ReturnType<typeof setup>) => {
    s.bond('fam-fx', 'fam');
    s.vanish('c-fam', 1);
    s.must('close_combat_instance', { status: 'completed' });
  };

  it('restores the same actor in a new form with that creature record HP', () => {
    const s = setup();
    downFamiliar(s);
    const r = s.must('recast_bonded_summon', {
      ...famRecast,
      form: 'creature:octopus',
    });
    expect(r.data).toMatchObject({
      actorId: 'fam',
      transitionId: 'restore-and-reform-absent-familiar',
      rulesRef: 'creature:octopus',
      hpCurrent: 3,
      hpMax: 3,
      form: 'creature:octopus',
    });
    expect(s.actor('fam')).toMatchObject({
      actorId: 'fam',
      status: 'alive',
      rulesRef: 'creature:octopus',
      hpCurrent: 3,
      hpMax: 3,
    });
    expect(s.effect('fam-fx').status).toBe('active');
    const events = listEffectEvents(s.db, campaign, 'fam-fx');
    expect(events.at(-1)).toMatchObject({
      eventKind: 'recast',
      detail: {
        spellRef: 'spell:find-familiar',
        transitionId: 'restore-and-reform-absent-familiar',
        actor: 'fam',
        hpCurrent: 3,
        hpMax: 3,
        form: 'creature:octopus',
      },
    });
  });

  it('allows the same form as before', () => {
    const s = setup();
    downFamiliar(s);
    s.must('recast_bonded_summon', { ...famRecast, form: 'creature:bat' });
    expect(s.actor('fam')).toMatchObject({
      status: 'alive',
      rulesRef: 'creature:bat',
      hpCurrent: 1,
      hpMax: 1,
    });
  });

  it('requires a form and refuses one outside the creation forms', () => {
    const s = setup();
    downFamiliar(s);
    const missing = s.recast(famRecast);
    expect(missing.ok).toBe(false);
    expect(s.message(missing)).toMatch(/pass form as one of/);
    const wrong = s.recast({ ...famRecast, form: 'creature:warhorse' });
    expect(wrong.ok).toBe(false);
    expect(s.message(wrong)).toMatch(/not one of the forms/);
    expect(s.actor('fam')).toMatchObject({
      status: 'absent',
      rulesRef: 'creature:bat',
    });
  });

  const recordHp = (s: ReturnType<typeof setup>, ref: string): number => {
    const data = lookupCampaignRecord(s.db, 'creature', ref, undefined)
      ?.data as { hitPoints?: number | { value?: number } };
    const hp = data.hitPoints;
    const value = typeof hp === 'object' ? hp?.value : hp;
    if (typeof value !== 'number') throw new Error(`no hp for ${ref}`);
    return value;
  };
  const presentFamiliar = (s: ReturnType<typeof setup>) => {
    s.bond('fam-fx', 'fam');
    s.must('close_combat_instance', { status: 'completed' });
  };

  it('reforms a present familiar in place: same actor, new form and its record HP', () => {
    const s = setup();
    presentFamiliar(s);
    const owlHp = recordHp(s, 'creature:owl');
    const before = s.actor('fam');
    const r = s.must('recast_bonded_summon', {
      ...famRecast,
      form: 'creature:owl',
    });
    expect(r.data).toMatchObject({
      actorId: 'fam',
      transitionId: 'reform-present-familiar',
      rulesRef: 'creature:owl',
      hpCurrent: owlHp,
      hpMax: owlHp,
      form: 'creature:owl',
    });
    expect(s.actor('fam')).toMatchObject({
      actorId: 'fam',
      status: 'alive',
      rulesRef: 'creature:owl',
      hpCurrent: owlHp,
      hpMax: owlHp,
      displayName: before.displayName,
      conditions: before.conditions,
    });
    const fx = s.effect('fam-fx');
    expect(fx.status).toBe('active');
    expect(fx.links.find((l) => l.linkKind === 'actor')?.status).toBe('active');
    expect(listEffectEvents(s.db, campaign, 'fam-fx').at(-1)).toMatchObject({
      eventKind: 'recast',
      detail: {
        spellRef: 'spell:find-familiar',
        transitionId: 'reform-present-familiar',
        actor: 'fam',
        hpCurrent: owlHp,
        hpMax: owlHp,
        form: 'creature:owl',
      },
    });
  });

  it('returns a damaged familiar reformed into the same form at that form’s full HP', () => {
    const s = setup();
    s.bond('fam-fx', 'fam');
    s.vanish('c-fam', 1);
    s.must('close_combat_instance', { status: 'completed' });
    s.must('recast_bonded_summon', { ...famRecast, form: 'creature:octopus' });
    const octopusHp = recordHp(s, 'creature:octopus');
    s.must('start_encounter', {
      combatInstanceId: 'c2',
      actors: [{ actorId: 'fam' }],
    });
    s.must('update_combatant', { combatantId: 'c2-fam', hpDelta: -1 });
    expect(s.actor('fam')).toMatchObject({ status: 'alive' });
    expect(s.actor('fam').hpCurrent).toBeLessThan(octopusHp);
    expect(s.actor('fam').hpCurrent).toBeGreaterThan(0);
    s.must('close_combat_instance', { status: 'completed' });
    s.must('recast_bonded_summon', { ...famRecast, form: 'creature:octopus' });
    expect(s.actor('fam')).toMatchObject({
      status: 'alive',
      rulesRef: 'creature:octopus',
      hpCurrent: octopusHp,
      hpMax: octopusHp,
    });
  });

  it('reforms a present familiar at exhaustion level 4 to the halved effective maximum', () => {
    const s = setup();
    s.bond('fam-fx', 'fam');
    s.must('adjust_exhaustion', { combatantId: 'c-fam', delta: 4 });
    s.must('close_combat_instance', { status: 'completed' });
    const octopusHp = recordHp(s, 'creature:octopus');
    const r = s.must('recast_bonded_summon', {
      ...famRecast,
      form: 'creature:octopus',
    });
    expect(r.data).toMatchObject({
      hpCurrent: Math.floor(octopusHp / 2),
      hpMax: octopusHp,
    });
    expect(s.actor('fam')).toMatchObject({
      status: 'alive',
      rulesRef: 'creature:octopus',
      hpCurrent: Math.floor(octopusHp / 2),
      hpMax: octopusHp,
    });
  });

  it('refuses a present familiar reform with no form or a form outside the list, unchanged', () => {
    const s = setup();
    presentFamiliar(s);
    const before = s.actor('fam');
    const missing = s.recast(famRecast);
    expect(missing.ok).toBe(false);
    expect(s.message(missing)).toMatch(/pass form as one of/);
    expect(s.actor('fam')).toEqual(before);
    const wrong = s.recast({ ...famRecast, form: 'creature:warhorse' });
    expect(wrong.ok).toBe(false);
    expect(s.message(wrong)).toMatch(/not one of the forms/);
    expect(s.actor('fam')).toEqual(before);
  });

  it('refuses a present familiar reform while it has a combatant in an active combat instance', () => {
    const s = setup();
    s.bond('fam-fx', 'fam');
    const before = s.actor('fam');
    const r = s.recast({ ...famRecast, form: 'creature:owl' });
    expect(r.ok).toBe(false);
    expect(s.message(r)).toMatch(/active combat instance/);
    expect(s.actor('fam')).toEqual(before);
  });

  it('refuses an actor that is neither absent nor alive, naming the status', () => {
    const s = setup();
    presentFamiliar(s);
    s.db
      .prepare(
        `UPDATE campaign_actor SET status = 'inactive' WHERE campaign_id = ? AND actor_id = 'fam'`,
      )
      .run(campaign);
    const r = s.recast({ ...famRecast, form: 'creature:owl' });
    expect(r.ok).toBe(false);
    expect(s.message(r)).toMatch(/is inactive/);
    expect(s.actor('fam').rulesRef).toBe('creature:bat');
  });

  it('keeps vanish-bonded after a reform: it can vanish at 0 HP and be restored by an absent recast', () => {
    const s = setup();
    presentFamiliar(s);
    s.must('recast_bonded_summon', { ...famRecast, form: 'creature:cat' });
    s.must('start_encounter', {
      combatInstanceId: 'c2',
      actors: [{ actorId: 'fam' }],
    });
    const hit = s.must('update_combatant', {
      combatantId: 'c2-fam',
      hpDelta: -recordHp(s, 'creature:cat'),
    });
    expect(hit.data).toMatchObject({
      vanished: { rule: 'vanish-bonded', linkKept: true, effectEnded: false },
    });
    expect(s.actor('fam').status).toBe('absent');
    s.must('close_combat_instance', { status: 'completed' });
    const r = s.must('recast_bonded_summon', {
      ...famRecast,
      form: 'creature:owl',
    });
    expect(r.data).toMatchObject({
      transitionId: 'restore-and-reform-absent-familiar',
      rulesRef: 'creature:owl',
    });
    expect(s.actor('fam')).toMatchObject({
      status: 'alive',
      rulesRef: 'creature:owl',
    });
  });

  it('refuses after the bond is gone, and a restored familiar can vanish again', () => {
    const s = setup();
    downFamiliar(s);
    s.must('recast_bonded_summon', { ...famRecast, form: 'creature:cat' });
    expect(s.actor('fam')).toMatchObject({
      rulesRef: 'creature:cat',
      hpMax: 2,
      hpCurrent: 2,
    });
    s.must('start_encounter', {
      combatInstanceId: 'c2',
      actors: [{ actorId: 'fam' }],
    });
    s.must('update_combatant', { combatantId: 'c2-fam', hpDelta: -2 });
    expect(s.actor('fam').status).toBe('absent');
    s.must('close_combat_instance', { status: 'completed' });
    s.must('end_effect', { effectId: 'fam-fx', reason: 'ruled', note: 't' });
    const r = s.recast({ ...famRecast, form: 'creature:owl' });
    expect(r.ok).toBe(false);
    expect(s.message(r)).toMatch(/has ended/);
    expect(s.actor('fam').status).toBe('absent');
  });
});

describe('spell-sourced bonded summons (eshyra-qxnc)', () => {
  it('derives vanish-bonded from the record and keeps the bond spell-sourced', () => {
    const s = setup();
    s.bond('steed-fx', 'steed');
    expect(s.effect('steed-fx').source).toMatchObject({
      kind: 'spell',
      ref: 'spell:find-steed',
      actor: { kind: 'combatant', ref: 'c-wiz' },
    });
    expect(
      listCombatants(s.db, campaign).find((c) => c.combatantId === 'c-steed')
        ?.zeroHpRule,
    ).toBe('vanish-bonded');
  });

  it.each(['absent', 'present'])(
    'refuses recasting a steed bond as Find Familiar (%s), leaving the actor unchanged',
    (presence) => {
      const s = setup();
      s.bond('steed-fx', 'steed');
      if (presence === 'absent') s.vanish('c-steed', 19);
      const before = s.actor('steed');
      const r = s.recast({
        effectId: 'steed-fx',
        spellRef: 'spell:find-familiar',
        form: 'creature:owl',
      });
      expect(r.ok).toBe(false);
      expect(s.message(r)).toMatch(/was cast from/);
      expect(s.actor('steed')).toEqual(before);
    },
  );

  it('allows a ruling-sourced vanish-bonded bond but refuses to recast it', () => {
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
    const r = s.recast({ effectId: 'ruling-fx', spellRef: 'spell:find-steed' });
    expect(r.ok).toBe(false);
    expect(s.message(r)).toMatch(/not recorded from its spell/);
    expect(s.actor('steed').status).toBe('alive');
  });

  it('allows one bond per caster per spell, across active, absent and suppressed, until it ends', () => {
    const s = setup();
    s.bond('fam-fx', 'fam');
    const second = () =>
      s.tryBond('fam-fx-2', 'steed', {
        source: {
          kind: 'spell',
          ref: 'spell:find-familiar',
          actor: { kind: 'combatant', ref: 'c-wiz' },
        },
      });
    let r = second();
    expect(r.ok).toBe(false);
    expect(s.message(r)).toMatch(/fam-fx/);
    expect(s.message(r)).toMatch(/recast_bonded_summon/);
    s.vanish('c-fam', 1);
    expect(s.actor('fam').status).toBe('absent');
    r = second();
    expect(r.ok).toBe(false);
    s.must('suppress_effect', { effectId: 'fam-fx' });
    r = second();
    expect(r.ok).toBe(false);
    s.must('end_effect', {
      effectId: 'fam-fx',
      reason: 'ruled',
      note: 'familiar permanently dismissed',
    });
    expect(second().ok).toBe(true);
  });

  it('lets one caster hold a Find Familiar and a Find Steed bond together', () => {
    const s = setup();
    s.bond('fam-fx', 'fam');
    s.bond('steed-fx', 'steed');
    expect(s.effect('fam-fx').status).toBe('active');
    expect(s.effect('steed-fx').status).toBe('active');
  });

  it('lets a different caster hold its own Find Familiar bond', () => {
    const s = setup();
    s.bond('fam-fx', 'fam');
    const other = s.tryBond('fam-fx-2', 'steed', {
      source: {
        kind: 'spell',
        ref: 'spell:find-familiar',
        actor: { kind: 'combatant', ref: 'c-steed' },
      },
    });
    expect(other.ok).toBe(true);
    expect(s.effect('fam-fx-2').status).toBe('active');
  });

  it('refuses two actors entries on one Find Familiar bond', () => {
    const s = setup();
    const r = s.tryBond('fam-fx', 'fam', {
      actors: [
        { combatantId: 'c-fam', campaignActorId: 'fam' },
        { combatantId: 'c-steed', campaignActorId: 'steed' },
      ],
    });
    expect(r.ok).toBe(false);
    expect(s.message(r)).toMatch(/at most 1 creature/);
  });

  it('refuses a missing source.actor and a non-until-removed duration', () => {
    const s = setup();
    let r = s.tryBond('fam-fx', 'fam', {
      source: { kind: 'spell', ref: 'spell:find-familiar' },
    });
    expect(r.ok).toBe(false);
    expect(s.message(r)).toMatch(/source\.actor/);
    r = s.tryBond('fam-fx', 'fam', {
      duration: { kind: 'until-dismissed' },
    });
    expect(r.ok).toBe(false);
    expect(s.message(r)).toMatch(/until removed/);
  });

  it('still refuses an instantaneous record without a persistent-linked summoning effect', () => {
    const s = setup();
    const r = s.tryBond('mm-fx', 'fam', {
      source: {
        kind: 'spell',
        ref: 'spell:magic-missile',
        actor: { kind: 'combatant', ref: 'c-wiz' },
      },
    });
    expect(r.ok).toBe(false);
    expect(s.message(r)).toMatch(/is instantaneous per its record/);
  });

  it('refuses atZeroHitPoints vanish on a Find Familiar spell bond', () => {
    const s = setup();
    const r = s.tryBond('fam-fx', 'fam', {
      actors: [
        {
          combatantId: 'c-fam',
          campaignActorId: 'fam',
          atZeroHitPoints: 'vanish',
        },
      ],
    });
    expect(r.ok).toBe(false);
  });
});
