/** eshyra-0xul.1: join_combat admits instance-only creatures and campaign
 * actors into the campaign's ACTIVE combat instance, through the real tool
 * registry. */
import { describe, expect, it } from 'vitest';
import type { ToolContext } from '../src/internal.js';
import {
  createDefaultToolRegistry,
  createSeededRng,
  getCampaignActor,
  listCombatants,
  updateCampaignActor,
} from '../src/internal.js';
import {
  DEFAULT_TEST_CAMPAIGN_ID,
  DEFAULT_TEST_SESSION_ID,
  freshDbWithSession,
} from './support/db.js';

const at = '2026-05-20T10:00:00.000Z';
const campaign = DEFAULT_TEST_CAMPAIGN_ID;

function setup(opts: { open?: boolean } = {}) {
  const db = freshDbWithSession();
  const registry = createDefaultToolRegistry();
  const ctx: ToolContext = {
    db,
    rng: createSeededRng(5),
    campaignId: campaign,
    sessionId: DEFAULT_TEST_SESSION_ID,
    turnId: '0xul',
    at,
  };
  const call = (name: string, args: unknown) =>
    registry.invoke(name, args, ctx);
  const must = (name: string, args: unknown) => {
    const r = call(name, args);
    if (!r.ok) throw new Error(`${name} failed: ${r.message}`);
    return r;
  };
  const message = (r: ReturnType<typeof call>) => (r.ok ? '' : r.message);
  if (opts.open !== false) {
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
          actorId: 'fam',
          rulesRef: 'creature:bat',
          hpMax: 5,
          hpCurrent: 5,
          side: 'ally',
        },
      ],
    });
  }
  const rows = () => listCombatants(db, campaign);
  const row = (id: string) => {
    const c = rows().find((x) => x.combatantId === id);
    if (!c) throw new Error(`missing combatant ${id}`);
    return c;
  };
  return { db, call, must, message, rows, row };
}

describe('join_combat: instance-only creatures', () => {
  it('adds creatures with record HP/AC, continuing past existing ordinals', () => {
    const s = setup();
    const first = s.must('join_combat', {
      creatures: [
        { rulesRef: 'creature:wolf', side: 'ally', faction: 'party' },
      ],
    });
    expect(first.data).toMatchObject({
      combatInstance: { combatInstanceId: 'c' },
      joined: [
        {
          combatantId: 'c-wolf-1',
          identityKind: 'encounter_instance',
          rulesRef: 'creature:wolf',
          side: 'ally',
          faction: 'party',
          hpCurrent: 11,
          hpMax: 11,
          status: 'alive',
        },
      ],
    });
    expect(s.row('c-wolf-1').ac).toBe(13);
    const second = s.must('join_combat', {
      creatures: [
        {
          rulesRef: 'creature:wolf',
          side: 'ally',
          count: 2,
          displayLabel: 'Pack',
        },
      ],
    });
    const joined = (
      second.data as {
        joined: Array<{ combatantId: string; displayLabel: string }>;
      }
    ).joined;
    expect(joined.map((j) => j.combatantId)).toEqual(['c-wolf-2', 'c-wolf-3']);
    expect(joined.map((j) => j.displayLabel)).toEqual(['Pack 1', 'Pack 2']);
  });

  it('is refused with no active instance, without a side, or with an unknown rulesRef', () => {
    const none = setup({ open: false });
    const r = none.call('join_combat', {
      creatures: [{ rulesRef: 'creature:wolf', side: 'ally' }],
    });
    expect(none.message(r)).toMatch(/no combat instance is active/);

    const s = setup();
    expect(
      s.call('join_combat', { creatures: [{ rulesRef: 'creature:wolf' }] }).ok,
    ).toBe(false);
    expect(s.call('join_combat', {}).ok).toBe(false);
    const unknown = s.call('join_combat', {
      creatures: [{ rulesRef: 'creature:no-such-beast', side: 'enemy' }],
    });
    expect(s.message(unknown)).toMatch(
      /cannot resolve 'creature:no-such-beast'/,
    );
  });

  it('a mixed batch with one invalid entry writes nothing', () => {
    const s = setup();
    const before = s.rows();
    const r = s.call('join_combat', {
      creatures: [{ rulesRef: 'creature:wolf', side: 'ally' }],
      actors: [{ actorId: 'fam', side: 'ally' }],
    });
    expect(r.ok).toBe(false);
    expect(s.rows()).toEqual(before);
  });

  it('a joined summon is linked by start_effect, vanishes at 0 HP, and acts via begin_turn', () => {
    const s = setup();
    s.must('join_combat', {
      creatures: [{ rulesRef: 'creature:wolf', side: 'ally', count: 2 }],
    });
    s.must('start_effect', {
      effectId: 'fx',
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
      actors: [{ combatantId: 'c-wolf-1' }, { combatantId: 'c-wolf-2' }],
    });
    expect(s.row('c-wolf-1').zeroHpRule).toBe('vanish');
    s.must('begin_turn', { combatantId: 'c-wolf-1' });
    s.must('spend_turn_resource', {
      resource: 'action',
      activity: 'Bite',
      combatantId: 'c-wolf-1',
    });
    const down = s.must('update_combatant', {
      combatantId: 'c-wolf-1',
      hpDelta: -11,
    });
    expect(down.data).toMatchObject({ vanished: { rule: 'vanish' } });
    expect(s.row('c-wolf-1').status).toBe('absent');
  });
});

describe('join_combat: campaign actors', () => {
  it('admits an actor with its stored HP, conditions and lifecycle', () => {
    const s = setup();
    s.must('update_combatant', { combatantId: 'c-fam', hpDelta: -2 });
    s.must('close_combat_instance', { status: 'completed' });
    s.must('start_encounter', {
      combatInstanceId: 'c2',
      actors: [{ actorId: 'wiz', side: 'ally' }],
    });
    s.must('adjust_exhaustion', { combatantId: 'c2-wiz', delta: 1 });
    updateCampaignActor(s.db, {
      campaignId: campaign,
      actorId: 'fam',
      hpCurrent: 3,
      provenance: 'test',
      sessionId: DEFAULT_TEST_SESSION_ID,
      at,
    });
    const r = s.must('join_combat', {
      actors: [{ actorId: 'fam', side: 'ally' }],
    });
    expect(r.data).toMatchObject({
      joined: [
        {
          combatantId: 'c2-fam',
          identityKind: 'campaign_actor',
          identityRef: 'fam',
          hpCurrent: 3,
          hpMax: 5,
          side: 'ally',
          status: 'alive',
        },
      ],
    });
  });

  it('refuses an actor already in this combat, alive or dead', () => {
    const s = setup();
    const alive = s.call('join_combat', {
      actors: [{ actorId: 'fam', side: 'ally' }],
    });
    expect(s.message(alive)).toMatch(
      /already in combat instance 'c' as 'c-fam'/,
    );
    s.must('update_combatant', { combatantId: 'c-fam', hpDelta: -5 });
    expect(s.row('c-fam').status).toBe('dead');
    const dead = s.call('join_combat', {
      actors: [{ actorId: 'fam', side: 'ally' }],
    });
    expect(s.message(dead)).toMatch(/already in combat instance/);
  });

  it('re-manifests an absent actor under a -2 id and needs hpCurrent above 0', () => {
    const s = setup();
    s.must('join_combat', {
      actors: [
        {
          actorId: 'imp',
          rulesRef: 'creature:goblin',
          hpCurrent: 7,
          hpMax: 7,
          side: 'ally',
        },
      ],
    });
    s.must('start_effect', {
      effectId: 'fx',
      kind: 'summoning',
      displayName: 'Summon',
      source: { kind: 'ruling' },
      duration: { kind: 'until-removed' },
      actors: [
        {
          combatantId: 'c-imp',
          campaignActorId: 'imp',
          atZeroHitPoints: 'vanish',
        },
      ],
    });
    s.must('update_combatant', { combatantId: 'c-imp', hpDelta: -7 });
    expect(s.row('c-imp').status).toBe('absent');
    expect(getCampaignActor(s.db, campaign, 'imp')?.status).toBe('absent');
    const noHp = s.call('join_combat', {
      actors: [{ actorId: 'imp', side: 'ally' }],
    });
    expect(s.message(noHp)).toMatch(/needs hpCurrent above 0/);
    const again = s.must('join_combat', {
      actors: [{ actorId: 'imp', hpCurrent: 7, side: 'ally' }],
    });
    expect(again.data).toMatchObject({
      joined: [{ combatantId: 'c-imp-2', status: 'alive', hpCurrent: 7 }],
    });
    expect(s.row('c-imp').status).toBe('absent');
  });

  it('refuses a bonded absent actor and a pocketed actor naming the recall', () => {
    const s = setup();
    s.must('start_effect', {
      effectId: 'fam-fx',
      kind: 'summoning',
      displayName: 'Find Familiar',
      source: {
        kind: 'spell',
        ref: 'spell:find-familiar',
        actor: { kind: 'campaign_actor', ref: 'wiz' },
      },
      duration: { kind: 'until-removed' },
      actors: [{ combatantId: 'c-fam', campaignActorId: 'fam' }],
    });
    s.must('update_combatant', { combatantId: 'c-fam', hpDelta: -5 });
    expect(getCampaignActor(s.db, campaign, 'fam')?.status).toBe('absent');
    const bonded = s.call('join_combat', {
      actors: [{ actorId: 'fam', hpCurrent: 5, side: 'ally' }],
    });
    expect(s.message(bonded)).toMatch(/still bonded to its summoner/);
  });

  it('refuses a pocketed actor naming the recall', () => {
    const s = setup();
    s.must('start_effect', {
      effectId: 'fam-fx',
      kind: 'summoning',
      displayName: 'Find Familiar',
      source: {
        kind: 'spell',
        ref: 'spell:find-familiar',
        actor: { kind: 'campaign_actor', ref: 'wiz' },
      },
      duration: { kind: 'until-removed' },
      actors: [{ combatantId: 'c-fam', campaignActorId: 'fam' }],
    });
    s.must('transition_bonded_summon', {
      effectId: 'fam-fx',
      spellRef: 'spell:find-familiar',
      trigger: 'action-temporary-dismissal',
    });
    const pocketed = s.call('join_combat', {
      actors: [{ actorId: 'fam', side: 'ally' }],
    });
    expect(s.message(pocketed)).toMatch(/action-recall/);
  });

  it('recall still projects the actor through the shared id helper', () => {
    const s = setup();
    s.must('start_effect', {
      effectId: 'fam-fx',
      kind: 'summoning',
      displayName: 'Find Familiar',
      source: {
        kind: 'spell',
        ref: 'spell:find-familiar',
        actor: { kind: 'campaign_actor', ref: 'wiz' },
      },
      duration: { kind: 'until-removed' },
      actors: [{ combatantId: 'c-fam', campaignActorId: 'fam' }],
    });
    for (const trigger of ['action-temporary-dismissal', 'action-recall'])
      s.must('transition_bonded_summon', {
        effectId: 'fam-fx',
        spellRef: 'spell:find-familiar',
        trigger,
      });
    expect(s.rows().map((c) => c.combatantId)).toContain('c-fam-2');
  });
});
