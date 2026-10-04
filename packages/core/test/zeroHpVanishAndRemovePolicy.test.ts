/** S44 repair (eshyra-o9bd.19.3.4.8.17): SRD 0-HP summon lifecycle and F3
 * remove-policy integrity. Driven through the real tool registry except where
 * no tool exists (campaign-actor mutation). */
import { describe, expect, it } from 'vitest';
import type { ToolContext } from '../src/internal.js';
import {
  createDefaultToolRegistry,
  createSeededRng,
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

function setup(actors: string[] = ['b1', 'b2'], beastHp = 7) {
  const db = freshDbWithSession();
  const registry = createDefaultToolRegistry();
  const ctx: ToolContext = {
    db,
    rng: createSeededRng(5),
    campaignId: DEFAULT_TEST_CAMPAIGN_ID,
    sessionId: DEFAULT_TEST_SESSION_ID,
    turnId: 's44',
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
        rulesRef: 'creature:goblin',
        hpMax: beastHp,
        hpCurrent: beastHp,
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
  const spell = (
    effectId: string,
    ref: string,
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
        amount: 1,
        unit: 'hour',
        anchor: 'spell-cast',
      },
      actors: actorsInput,
      ...extra,
    });
  const ruling = (effectId: string, actorsInput: unknown[]) =>
    call('start_effect', {
      effectId,
      kind: 'summoning',
      displayName: effectId,
      source: { kind: 'ruling' },
      duration: { kind: 'until-removed' },
      actors: actorsInput,
    });
  const end = (effectId: string) =>
    must('end_effect', { effectId, reason: 'ruled', note: 'test' });
  const actions = (r: { data?: unknown }) =>
    JSON.stringify(r.data).match(/"action":"[a-z]+"/g) ?? [];
  return { db, call, must, row, effect, spell, ruling, end, actions };
}

describe('F3 remove policy on actor links', () => {
  it('alive x remove takes the creature out of play (absent, removed)', () => {
    const s = setup();
    s.must('start_effect', {
      effectId: 'fx',
      kind: 'summoning',
      displayName: 'x',
      source: { kind: 'ruling' },
      duration: { kind: 'until-removed' },
      actors: [{ combatantId: 'c-b1' }],
    });
    expect(s.actions(s.end('fx'))).toEqual(['"action":"removed"']);
    expect(s.row('c-b1').status).toBe('absent');
    expect(getCampaignActor(s.db, DEFAULT_TEST_CAMPAIGN_ID, 'b1')?.status).toBe(
      'absent',
    );
  });

  it('alive x release keeps a participant (released)', () => {
    const s = setup();
    s.must('start_effect', {
      effectId: 'fx',
      kind: 'summoning',
      displayName: 'x',
      source: { kind: 'ruling' },
      duration: { kind: 'until-removed' },
      actors: [
        {
          combatantId: 'c-b1',
          cleanupOnEnd: 'release',
          cleanupOnBreak: 'release',
        },
      ],
    });
    expect(s.actions(s.end('fx'))).toEqual(['"action":"released"']);
    expect(s.row('c-b1').status).toBe('alive');
  });

  it('dead x remove becomes absent (removed)', () => {
    const s = setup();
    s.must('start_effect', {
      effectId: 'fx',
      kind: 'summoning',
      displayName: 'x',
      source: { kind: 'ruling' },
      duration: { kind: 'until-removed' },
      actors: [{ combatantId: 'c-b1' }],
    });
    s.must('update_combatant', { combatantId: 'c-b1', hpDelta: -7 });
    expect(s.row('c-b1').status).toBe('dead');
    expect(s.actions(s.end('fx'))).toEqual(['"action":"removed"']);
    expect(s.row('c-b1').status).toBe('absent');
  });

  for (const variant of ['dying', 'stable'] as const) {
    it(`${variant} x release leaves the participant unchanged (released)`, () => {
      const s = setup();
      s.must('start_effect', {
        effectId: 'fx',
        kind: 'summoning',
        displayName: 'x',
        source: { kind: 'ruling' },
        duration: { kind: 'until-removed' },
        actors: [
          {
            combatantId: 'c-b1',
            cleanupOnEnd: 'release',
            cleanupOnBreak: 'release',
          },
        ],
      });
      s.must('update_combatant', {
        combatantId: 'c-b1',
        deathRules: 'player-character',
      });
      s.must('update_combatant', {
        combatantId: 'c-b1',
        hpDelta: -7,
        ...(variant === 'stable' ? { status: 'stable' } : {}),
      });
      expect(s.row('c-b1').status).toBe(variant);
      expect(s.actions(s.end('fx'))).toEqual(['"action":"released"']);
      expect(s.row('c-b1').status).toBe(variant);
    });
  }

  it('dying under remove is unreachable: both refusals', () => {
    const s = setup();
    s.must('start_effect', {
      effectId: 'fx',
      kind: 'summoning',
      displayName: 'x',
      source: { kind: 'ruling' },
      duration: { kind: 'until-removed' },
      actors: [{ combatantId: 'c-b1' }],
    });
    const optIn = s.call('update_combatant', {
      combatantId: 'c-b1',
      deathRules: 'player-character',
    });
    expect(optIn.ok).toBe(false);
    expect(JSON.stringify(optIn)).toMatch(/remove/);
    s.must('update_combatant', {
      combatantId: 'c-b2',
      deathRules: 'player-character',
    });
    const link = s.ruling('fx2', [{ combatantId: 'c-b2' }]);
    expect(link.ok).toBe(false);
    expect(JSON.stringify(link)).toMatch(/player-character death rules/);
  });

  it('remove on end + release on break: break releases, normal end removes', () => {
    const s = setup();
    const start = (id: string, who: string) =>
      s.must('start_effect', {
        effectId: id,
        kind: 'summoning',
        displayName: id,
        source: { kind: 'ruling' },
        concentrationOwner: { kind: 'combatant', ref: 'c-wiz' },
        duration: { kind: 'until-removed' },
        actors: [
          {
            combatantId: who,
            cleanupOnEnd: 'remove',
            cleanupOnBreak: 'release',
          },
        ],
      });
    start('fxa', 'c-b1');
    const broken = s.must('end_effect', {
      effectId: 'fxa',
      reason: 'concentration-broken',
      detail: 'voluntary',
    });
    expect(s.actions(broken)).toEqual(['"action":"released"']);
    expect(s.row('c-b1').status).toBe('alive');
    start('fxb', 'c-b2');
    expect(s.actions(s.end('fxb'))).toEqual(['"action":"removed"']);
    expect(s.row('c-b2').status).toBe('absent');
  });
});

describe('zero-hit-point vanish', () => {
  it('Conjure Animals: each beast vanishes at 0 HP; the last ends the effect', () => {
    const s = setup();
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
      actors: [{ combatantId: 'c-b1' }, { combatantId: 'c-b2' }],
    });
    expect(s.row('c-b1').zeroHpRule).toBe('vanish');
    const first = s.must('update_combatant', {
      combatantId: 'c-b1',
      hpDelta: -7,
    });
    expect(first.data).toMatchObject({
      vanished: { rule: 'vanish', effectId: 'fx', effectEnded: false },
    });
    expect(s.row('c-b1').status).toBe('absent');
    let e = s.effect('fx');
    expect(e.status).toBe('active');
    expect(e.links.find((l) => l.projectionRef === 'c-b1')).toMatchObject({
      status: 'removed',
      removedReason: 'zero-hit-points',
    });
    const second = s.must('update_combatant', {
      combatantId: 'c-b2',
      hpDelta: -9,
    });
    expect(second.data).toMatchObject({ vanished: { effectEnded: true } });
    e = s.effect('fx');
    expect(e.status).toBe('ended');
    expect(e.endReason).toBe('source-removed');
    expect(s.row('c-b2').status).not.toBe('dead');
  });

  it('Conjure Elemental released by a concentration break still vanishes at 0 HP', () => {
    const s = setup(['e1']);
    s.must('start_effect', {
      effectId: 'fx',
      kind: 'summoning',
      displayName: 'Conjure Elemental',
      source: {
        kind: 'spell',
        ref: 'spell:conjure-elemental',
        actor: { kind: 'combatant', ref: 'c-wiz' },
      },
      concentrationOwner: { kind: 'combatant', ref: 'c-wiz' },
      duration: {
        kind: 'timed',
        amount: 1,
        unit: 'hour',
        anchor: 'spell-cast',
      },
      actors: [{ combatantId: 'c-e1' }],
    });
    const links = s.effect('fx').links.filter((l) => l.linkKind === 'actor');
    expect(links[0]).toMatchObject({
      cleanupOnEnd: 'remove',
      cleanupOnBreak: 'release',
    });
    s.must('end_effect', {
      effectId: 'fx',
      reason: 'concentration-broken',
      detail: 'voluntary',
    });
    expect(s.row('c-e1').status).toBe('alive');
    const hit = s.must('update_combatant', {
      combatantId: 'c-e1',
      hpDelta: -7,
    });
    expect(s.row('c-e1').status).toBe('absent');
    expect(hit.data).toMatchObject({ vanished: { effectId: null } });
  });

  it('suffocation drop and exhaustion clamping to 0 vanish too', () => {
    for (const path of ['suffocation', 'exhaustion'] as const) {
      const s = setup(['b1'], 1);
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
        actors: [{ combatantId: 'c-b1' }],
      });
      if (path === 'suffocation')
        s.must('set_suffocation', { combatantId: 'c-b1', event: 'drop' });
      else {
        // effective max 0 needs hpMax 1: shrink through exhaustion level 4
        // on a one-hit-point creature.
        s.must('adjust_exhaustion', { combatantId: 'c-b1', delta: 4 });
      }
      expect(s.row('c-b1')).toMatchObject({ status: 'absent', hpCurrent: 0 });
      expect(s.effect('fx').status).toBe('ended');
      s.db.close();
    }
  });

  it('out-of-combat actor HP to 0 vanishes and ends its effect', () => {
    const s = setup(['b1']);
    s.must('start_effect', {
      effectId: 'fx',
      kind: 'summoning',
      displayName: 'Familiar',
      source: { kind: 'ruling' },
      duration: { kind: 'until-removed' },
      actors: [{ combatantId: 'c-b1', atZeroHitPoints: 'vanish' }],
    });
    s.must('close_combat_instance', { status: 'completed' });
    updateCampaignActor(s.db, {
      campaignId: DEFAULT_TEST_CAMPAIGN_ID,
      actorId: 'b1',
      hpCurrent: 0,
      provenance: 't',
      sessionId: DEFAULT_TEST_SESSION_ID,
      at,
    });
    expect(getCampaignActor(s.db, DEFAULT_TEST_CAMPAIGN_ID, 'b1')?.status).toBe(
      'absent',
    );
    expect(s.effect('fx')).toMatchObject({
      status: 'ended',
      endReason: 'source-removed',
    });
  });
});

describe('guards', () => {
  it('refuses PC death rules and knockouts on a vanishing summon', () => {
    const s = setup(['b1']);
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
      actors: [{ combatantId: 'c-b1' }],
    });
    expect(
      s.call('update_combatant', {
        combatantId: 'c-b1',
        deathRules: 'player-character',
      }).ok,
    ).toBe(false);
    const ko = s.call('update_combatant', {
      combatantId: 'c-b1',
      hpDelta: -7,
      status: 'unconscious',
    });
    expect(ko.ok).toBe(false);
    expect(s.row('c-b1')).toMatchObject({ status: 'alive', hpCurrent: 7 });
  });

  it('refuses a policy that contradicts the record and derives omitted ones', () => {
    const s = setup(['b1']);
    const bad = s.spell('fx1', 'spell:conjure-animals', [
      { combatantId: 'c-b1', cleanupOnEnd: 'release' },
    ]);
    expect(bad.ok).toBe(false);
    expect(JSON.stringify(bad)).toMatch(/spell-ended/);
    const bad2 = s.spell('fx2', 'spell:conjure-elemental', [
      { combatantId: 'c-b1', cleanupOnBreak: 'remove' },
    ]);
    expect(bad2.ok).toBe(false);
    const contradiction = s.call('start_effect', {
      effectId: 'fx3',
      kind: 'summoning',
      displayName: 'Animate Objects',
      source: {
        kind: 'spell',
        ref: 'spell:animate-objects',
        actor: { kind: 'combatant', ref: 'c-wiz' },
      },
      concentrationOwner: { kind: 'combatant', ref: 'c-wiz' },
      duration: {
        kind: 'timed',
        amount: 1,
        unit: 'minute',
        anchor: 'spell-cast',
      },
      actors: [{ combatantId: 'c-b1', atZeroHitPoints: 'vanish' }],
    });
    expect(contradiction.ok).toBe(false);
    expect(JSON.stringify(contradiction)).toMatch(/original form/);
  });

  it('a reverting creature gets the guards but no automatic 0-HP behaviour', () => {
    const s = setup(['b1']);
    s.must('start_effect', {
      effectId: 'fx',
      kind: 'summoning',
      displayName: 'Animate Objects',
      source: {
        kind: 'spell',
        ref: 'spell:animate-objects',
        actor: { kind: 'combatant', ref: 'c-wiz' },
      },
      concentrationOwner: { kind: 'combatant', ref: 'c-wiz' },
      duration: {
        kind: 'timed',
        amount: 1,
        unit: 'minute',
        anchor: 'spell-cast',
      },
      actors: [
        {
          combatantId: 'c-b1',
          cleanupOnEnd: 'release',
          cleanupOnBreak: 'release',
        },
      ],
    });
    expect(s.row('c-b1').zeroHpRule).toBe('revert');
    expect(
      s.call('update_combatant', {
        combatantId: 'c-b1',
        deathRules: 'player-character',
      }).ok,
    ).toBe(false);
  });
});

describe('absent combatants', () => {
  function vanished() {
    const s = setup(['b1']);
    s.must('start_effect', {
      effectId: 'fx',
      kind: 'summoning',
      displayName: 'Familiar',
      source: { kind: 'ruling' },
      duration: { kind: 'until-removed' },
      actors: [{ combatantId: 'c-b1', atZeroHitPoints: 'vanish' }],
    });
    s.must('update_combatant', { combatantId: 'c-b1', hpDelta: -7 });
    expect(s.row('c-b1').status).toBe('absent');
    return s;
  }

  it('refuses damage, healing, saves, stabilizing, suffocation, conditions, and explicit absent', () => {
    const s = vanished();
    const refused = [
      s.call('update_combatant', { combatantId: 'c-b1', hpDelta: -1 }),
      s.call('update_combatant', { combatantId: 'c-b1', hpDelta: 2 }),
      s.call('update_combatant', {
        combatantId: 'c-b1',
        addCondition: { id: 'prone' },
      }),
      s.call('update_combatant', { combatantId: 'c-b1', status: 'alive' }),
      s.call('update_combatant', { combatantId: 'c-b2', status: 'absent' }),
      s.call('record_death_save', { combatantId: 'c-b1', roll: 12 }),
      s.call('stabilize_character', { combatantId: 'c-b1' }),
      s.call('set_suffocation', { combatantId: 'c-b1', event: 'drop' }),
    ];
    expect(refused.map((r) => r.ok)).toEqual(refused.map(() => false));
  });

  it('re-admission needs hp above 0, then starts alive and keeps its rule', () => {
    const s = vanished();
    s.must('close_combat_instance', { status: 'completed' });
    const without = s.call('start_encounter', {
      combatInstanceId: 'c2',
      actors: [{ actorId: 'b1' }],
    });
    expect(without.ok).toBe(false);
    expect(JSON.stringify(without)).toMatch(/absent/);
    s.must('start_encounter', {
      combatInstanceId: 'c2',
      actors: [{ actorId: 'b1', hpCurrent: 5 }],
    });
    expect(s.row('c2-b1')).toMatchObject({
      status: 'alive',
      hpCurrent: 5,
      deathSaveFailures: 0,
      zeroHpRule: 'vanish',
    });
    expect(getCampaignActor(s.db, DEFAULT_TEST_CAMPAIGN_ID, 'b1')?.status).toBe(
      'alive',
    );
  });
});
