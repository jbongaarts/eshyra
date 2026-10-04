/** eshyra-s02z: recast_bonded_summon restores an absent bonded creature
 * (Find Familiar / Find Steed), driven through the real tool registry. */
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
  const bond = (effectId: string, actorId: string, source?: unknown) =>
    must('start_effect', {
      effectId,
      kind: 'summoning',
      displayName: effectId,
      source: source ?? { kind: 'ruling' },
      duration: { kind: 'until-removed' },
      actors: [
        {
          combatantId: `c-${actorId}`,
          campaignActorId: actorId,
          atZeroHitPoints: 'vanish-bonded',
        },
      ],
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

  it('refuses a present steed and says reforming is unsupported', () => {
    const s = setup();
    s.bond('steed-fx', 'steed');
    const r = s.recast(steedRecast);
    expect(r.ok).toBe(false);
    expect(s.message(r)).toMatch(/not absent/);
    expect(s.message(r)).toMatch(/Reforming a present or pocketed familiar/);
    expect(s.actor('steed')).toMatchObject({ status: 'alive', hpCurrent: 19 });
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

  it('refuses a spell with no restoring cast-again transition', () => {
    const s = setup();
    s.bond('steed-fx', 'steed');
    s.vanish('c-steed', 19);
    s.must('close_combat_instance', { status: 'completed' });
    const r = s.recast({
      effectId: 'steed-fx',
      spellRef: 'spell:conjure-animals',
    });
    expect(r.ok).toBe(false);
    expect(s.message(r)).toMatch(
      /no cast-again transition that restores an absent creature/,
    );
    expect(s.actor('steed').status).toBe('absent');
  });

  it('refuses an unknown spell and an unknown effect', () => {
    const s = setup();
    s.bond('steed-fx', 'steed');
    expect(
      s.message(s.recast({ effectId: 'steed-fx', spellRef: 'spell:nope' })),
    ).toMatch(/no spell record/);
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

  it('refuses a present familiar (reform of a present or pocketed familiar is out of scope)', () => {
    const s = setup();
    s.bond('fam-fx', 'fam');
    const r = s.recast({ ...famRecast, form: 'creature:owl' });
    expect(r.ok).toBe(false);
    expect(s.message(r)).toMatch(/Reforming a present or pocketed familiar/);
    expect(s.actor('fam')).toMatchObject({
      status: 'alive',
      rulesRef: 'creature:bat',
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
