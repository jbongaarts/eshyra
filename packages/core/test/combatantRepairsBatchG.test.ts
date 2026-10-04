/** Batch G repairs (eshyra-o9bd.19.3.4.8.15): S34 adapter, S36, S37, S38, S39.
 * Everything is driven through the real tool registry. */
import { describe, expect, it } from 'vitest';
import type { ToolContext } from '../src/internal.js';
import {
  createDefaultToolRegistry,
  createSeededRng,
  getCampaignActor,
  listCombatants,
} from '../src/internal.js';
import {
  DEFAULT_TEST_CAMPAIGN_ID,
  DEFAULT_TEST_SESSION_ID,
  freshDbWithSession,
} from './support/db.js';

const at = '2026-05-20T10:00:00.000Z';

function setup() {
  const db = freshDbWithSession();
  const registry = createDefaultToolRegistry();
  const ctx: ToolContext = {
    db,
    rng: createSeededRng(21),
    campaignId: DEFAULT_TEST_CAMPAIGN_ID,
    sessionId: DEFAULT_TEST_SESSION_ID,
    turnId: 'batch-g',
    at,
  };
  const call = (name: string, args: unknown) =>
    registry.invoke(name, args, ctx);
  const must = (name: string, args: unknown) => {
    const r = call(name, args);
    if (!r.ok) throw new Error(`${name} failed: ${r.message}`);
    return r;
  };
  const row = (id: string) => {
    const c = listCombatants(db, DEFAULT_TEST_CAMPAIGN_ID).find(
      (x) => x.combatantId === id,
    );
    if (!c) throw new Error(`missing combatant ${id}`);
    return c;
  };
  return { db, registry, ctx, call, must, row };
}

describe('S34: death-save adapter arms the schedule whenever the save may stabilize', () => {
  const rolls = [10, 12, 19, 20];
  for (const max of ['positive', 'zero'] as const) {
    for (const blocked of [false, true]) {
      for (const third of rolls) {
        it(`third save ${third}, effective max ${max}, ${blocked ? 'suffocation-blocked' : 'unblocked'}`, () => {
          const { db, must, call, row } = setup();
          must('start_encounter', {
            combatInstanceId: 'c',
            actors: [
              {
                actorId: 'g',
                rulesRef: 'creature:goblin',
                hpMax: max === 'zero' ? 1 : 7,
                hpCurrent: max === 'zero' ? 1 : 7,
              },
            ],
          });
          const id = 'c-g';
          must('update_combatant', {
            combatantId: id,
            deathRules: 'player-character',
          });
          if (max === 'zero')
            must('adjust_exhaustion', { combatantId: id, delta: 4 });
          else must('update_combatant', { combatantId: id, hpDelta: -7 });
          expect(row(id)).toMatchObject({ status: 'dying', hpCurrent: 0 });
          if (blocked)
            must('set_suffocation', { combatantId: id, event: 'drop' });
          must('record_death_save', { combatantId: id, roll: 12 });
          must('record_death_save', { combatantId: id, roll: 12 });
          const result = call('record_death_save', {
            combatantId: id,
            roll: third,
          });
          expect(result.ok, JSON.stringify(result)).toBe(true);
          const after = row(id);
          const revives = third === 20 && !blocked && max === 'positive';
          if (revives) {
            expect(after).toMatchObject({ status: 'alive', hpCurrent: 1 });
          } else if (blocked) {
            expect(after).toMatchObject({
              status: 'dying',
              deathSaveSuccesses: 3,
              stableRecoveryDeadlineElapsedMinutes: null,
            });
            must('set_suffocation', { combatantId: id, event: 'breathe' });
            expect(row(id).status).toBe('stable');
          } else {
            expect(result).toMatchObject({
              data: { outcome: 'stabilized', lifeState: 'stable' },
            });
            expect(after).toMatchObject({
              status: 'stable',
              deathSaveSuccesses: 0,
              deathSaveFailures: 0,
            });
            expect(after.stableRecoveryDeadlineElapsedMinutes).not.toBeNull();
            // D5: advance_time settles the schedule (zero max) or recovers.
            must('advance_time', { minutes: 241 });
            expect(row(id).status).toBe(max === 'zero' ? 'stable' : 'alive');
          }
          db.close();
        });
      }
    }
  }
});

describe('S36: a dying player-character combatant keeps an available turn for its death save', () => {
  function hydraSetup() {
    const s = setup();
    s.must('start_encounter', {
      combatInstanceId: 'h',
      actors: [
        { actorId: 'hydra', rulesRef: 'creature:hydra' },
        { actorId: 'gob', rulesRef: 'creature:goblin' },
      ],
    });
    s.must('update_combatant', {
      combatantId: 'h-hydra',
      deathRules: 'player-character',
    });
    s.must('begin_turn', { combatantId: 'h-hydra', round: 1 });
    s.must('begin_turn', { combatantId: 'h-gob', round: 1 });
    // Damage on the goblin's turn: dying hydra with a head owed.
    s.must('update_combatant', { combatantId: 'h-hydra', hpDelta: -172 });
    expect(s.row('h-hydra')).toMatchObject({ status: 'dying', headCount: 4 });
    return s;
  }

  it('records the save before regrowth; a passing save then regrows at turn end', () => {
    const s = hydraSetup();
    const begin = s.must('begin_turn', { combatantId: 'h-hydra', round: 2 });
    expect(begin).toMatchObject({ data: { turnAvailable: true } });
    expect(s.row('h-hydra')).toMatchObject({ status: 'dying', headCount: 4 });
    s.must('record_death_save', { combatantId: 'h-hydra', roll: 15 });
    expect(s.row('h-hydra')).toMatchObject({ status: 'dying', headCount: 4 });
    const end = s.must('begin_turn', { combatantId: 'h-gob', round: 2 });
    expect(end).toMatchObject({
      data: { headRegrowths: [expect.objectContaining({ headsRegrown: 2 })] },
    });
    expect(s.row('h-hydra')).toMatchObject({ status: 'alive', headCount: 6 });
    s.db.close();
  });

  it('with two failures banked, a failed start-of-turn save kills it before any regrowth', () => {
    const s = hydraSetup();
    s.must('update_combatant', { combatantId: 'h-hydra', hpDelta: -1 });
    s.must('update_combatant', { combatantId: 'h-hydra', hpDelta: -1 });
    expect(s.row('h-hydra')).toMatchObject({ deathSaveFailures: 2 });
    s.must('begin_turn', { combatantId: 'h-hydra', round: 2 });
    s.must('record_death_save', { combatantId: 'h-hydra', roll: 5 });
    expect(s.row('h-hydra')).toMatchObject({ status: 'dead' });
    const end = s.must('begin_turn', { combatantId: 'h-gob', round: 2 });
    expect(
      (end.data as { headRegrowths?: unknown[] }).headRegrowths ?? [],
    ).toHaveLength(0);
    expect(s.row('h-hydra')).toMatchObject({ status: 'dead', headCount: 4 });
    s.db.close();
  });

  it('stable and dead combatants stay unavailable; the description discloses the dying turn', () => {
    const s = setup();
    s.must('start_encounter', {
      combatInstanceId: 'u',
      actors: [{ actorId: 'gob', rulesRef: 'creature:goblin' }],
    });
    s.must('update_combatant', { combatantId: 'u-gob', hpDelta: -100 });
    expect(
      s.must('begin_turn', { combatantId: 'u-gob', round: 1 }),
    ).toMatchObject({ data: { turnAvailable: false } });
    const tool = s.registry.get('begin_turn');
    expect(tool?.description).toMatch(
      /dying player-character combatant keeps an available turn/,
    );
    s.db.close();
  });
});

describe('S38: projecting a monster-rules knockout keeps it unconscious', () => {
  const cases: Array<{
    name: string;
    prepare: (s: ReturnType<typeof setup>) => void;
    expected: string;
  }> = [
    {
      name: 'monster knocked out',
      prepare: (s) =>
        s.must('update_combatant', {
          combatantId: 'c1-gob',
          hpDelta: -10,
          status: 'unconscious',
        }),
      expected: 'unconscious',
    },
    {
      name: 'monster killed',
      prepare: (s) =>
        s.must('update_combatant', { combatantId: 'c1-gob', hpDelta: -10 }),
      expected: 'dead',
    },
    {
      name: 'player-character rules dying',
      prepare: (s) => {
        s.must('update_combatant', {
          combatantId: 'c1-gob',
          deathRules: 'player-character',
        });
        s.must('update_combatant', { combatantId: 'c1-gob', hpDelta: -7 });
      },
      expected: 'dying',
    },
    {
      name: 'player-character rules stable',
      prepare: (s) => {
        s.must('update_combatant', {
          combatantId: 'c1-gob',
          deathRules: 'player-character',
        });
        s.must('update_combatant', { combatantId: 'c1-gob', hpDelta: -7 });
        s.must('stabilize_character', { combatantId: 'c1-gob' });
      },
      expected: 'stable',
    },
  ];
  for (const c of cases) {
    it(`${c.name}: projection and actor keep ${c.expected} across close and start_encounter`, () => {
      const s = setup();
      s.must('start_encounter', {
        combatInstanceId: 'c1',
        actors: [
          {
            actorId: 'gob',
            rulesRef: 'creature:goblin',
            hpMax: 7,
            hpCurrent: 7,
          },
        ],
      });
      c.prepare(s);
      expect(s.row('c1-gob').status).toBe(c.expected);
      expect(
        getCampaignActor(s.db, DEFAULT_TEST_CAMPAIGN_ID, 'gob')?.status,
      ).toBe(c.expected);
      s.must('close_combat_instance', { status: 'completed' });
      s.must('start_encounter', {
        combatInstanceId: 'c2',
        actors: [{ actorId: 'gob' }],
      });
      expect(s.row('c2-gob')).toMatchObject({
        status: c.expected,
        hpCurrent: 0,
      });
      expect(
        getCampaignActor(s.db, DEFAULT_TEST_CAMPAIGN_ID, 'gob'),
      ).toMatchObject({ status: c.expected, hpCurrent: 0 });
      s.db.close();
    });
  }
});

describe('S41/S42: knockout and summon state survive participation changes', () => {
  for (const status of ['inactive', 'escaped'] as const) {
    it(`a knocked-out monster later marked ${status} projects as unconscious, not dead`, () => {
      const s = setup();
      s.must('start_encounter', {
        combatInstanceId: 'c1',
        actors: [
          {
            actorId: 'gob',
            rulesRef: 'creature:goblin',
            hpMax: 7,
            hpCurrent: 7,
          },
        ],
      });
      s.must('update_combatant', {
        combatantId: 'c1-gob',
        hpDelta: -10,
        status: 'unconscious',
      });
      s.must('update_combatant', { combatantId: 'c1-gob', status });
      s.must('close_combat_instance', { status: 'completed' });
      s.must('start_encounter', {
        combatInstanceId: 'c2',
        actors: [{ actorId: 'gob' }],
      });
      expect(s.row('c2-gob')).toMatchObject({
        status: 'unconscious',
        hpCurrent: 0,
      });
      expect(
        getCampaignActor(s.db, DEFAULT_TEST_CAMPAIGN_ID, 'gob')?.status,
      ).not.toBe('dead');
      s.db.close();
    });
  }
});

describe('S37: both sides hiding is handled with one set_surprised call per side', () => {
  it('derives surprise for each side separately and refuses one mixed call', () => {
    const s = setup();
    s.must('start_encounter', {
      combatInstanceId: 'sv',
      actors: [
        { actorId: 'g1', rulesRef: 'creature:goblin' },
        { actorId: 'g2', rulesRef: 'creature:goblin' },
      ],
    });
    const hide = (
      hider: Record<string, string>,
      observers: Array<Record<string, string>>,
    ) => {
      const retained = s.must('roll_retained_check', {
        kind: 'ability_check',
        reason: 'hiding',
        label: 'stealth',
        participant: hider,
      });
      const compared = s.must('resolve_retained_check', {
        retainedCheckId: (retained.data as { retainedCheckId: string })
          .retainedCheckId,
        reason: 'passive comparison',
        passive: observers.map((participant, i) => ({
          label: `observer ${i}`,
          participant,
          modifier: -100,
        })),
      });
      return (
        compared.data as { comparisons: Array<{ comparisonId: string }> }
      ).comparisons.map((c) => c.comparisonId);
    };
    const pcSide = hide({ character: 'pc-1' }, [
      { combatantId: 'sv-g1' },
      { combatantId: 'sv-g2' },
    ]);
    const goblinSide = hide({ combatantId: 'sv-g1' }, [{ character: 'pc-1' }]);
    expect(
      s.call('set_surprised', { comparisonIds: [...pcSide, ...goblinSide] }).ok,
    ).toBe(false);
    expect(s.must('set_surprised', { comparisonIds: pcSide })).toMatchObject({
      data: {
        surprised: expect.arrayContaining([
          { kind: 'combatant', ref: 'sv-g1' },
          { kind: 'combatant', ref: 'sv-g2' },
        ]),
      },
    });
    expect(
      s.must('set_surprised', { comparisonIds: goblinSide }),
    ).toMatchObject({
      data: {
        surprised: expect.arrayContaining([{ kind: 'character', ref: 'pc-1' }]),
      },
    });
    s.db.close();
  });
});

describe('S37/S39: truthful model-facing descriptions', () => {
  const description = (name: string) => {
    return createDefaultToolRegistry().get(name)?.description ?? '';
  };
  it('set_surprised says to call once per hiding side', () => {
    expect(description('set_surprised')).toMatch(
      /creatures on both sides are hiding, call set_surprised once per side/,
    );
  });
  it('record_death_save and stabilize_character disclose the active-instance limit', () => {
    for (const name of ['record_death_save', 'stabilize_character'])
      expect(description(name)).toMatch(
        /only during that combatant.s active combat instance/,
      );
  });
});
