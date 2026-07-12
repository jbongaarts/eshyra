// F3 active-effect lifecycle & concentration (eshyra-2n1t.5). Evidence for
// the ENGINE_PROCEDURE_COVERAGE row: concentration (durable marker, auto
// save DC max(10, floor(dmg/2)) per damage event, single-instance invariant
// with deterministic replacement, break on incapacitation/death, voluntary
// drop) plus the shared lifecycle: typed kinds as semantic licenses,
// quantity+unit+anchor timers, reason-typed ends with exact owned-projection
// cleanup, partial multi-target removal, suppression, refresh, round-deadline
// expiry, idempotent duplicate delivery, replay determinism, and load-time
// validation of malformed durable state.

import { describe, expect, it } from 'vitest';
import type { AdventureModule, Db } from '../src/internal.js';
import {
  ActiveEffectError,
  adjustHp,
  auditActiveEffectIntegrity,
  beginTurn,
  breakCombatantConcentration,
  closeCombatInstance,
  concentrationSaveDc,
  createActiveEffect,
  createDefaultToolRegistry,
  createSeededRng,
  endActiveEffect,
  expireElapsedRoundEffects,
  getActiveCharacterId,
  getConcentrationEffect,
  grantTemporaryHp,
  listActiveEffects,
  listEffectEvents,
  mutateState,
  parseSpellDurationText,
  refreshEffect,
  removeEffectTarget,
  resolveConcentrationCheck,
  startAdventureRun,
  startEncounter,
  suppressEffect,
  unsuppressEffect,
} from '../src/internal.js';
import { makeTestAdventureModule } from './support/adventureModuleFixture.js';
import {
  DEFAULT_TEST_CAMPAIGN_ID,
  DEFAULT_TEST_SESSION_ID,
  freshDbWithSession,
} from './support/db.js';

const NOW = '2026-07-11T10:00:00.000Z';
const CAMPAIGN = DEFAULT_TEST_CAMPAIGN_ID;
const CTX = {
  provenance: 'test:active-effects',
  sessionId: DEFAULT_TEST_SESSION_ID,
  at: NOW,
};

const GOBLIN_1 = 'ci-enc-goblins-1-goblin-1';
const GOBLIN_2 = 'ci-enc-goblins-1-goblin-2';

function setup() {
  const db = freshDbWithSession();
  const pcId = getActiveCharacterId(db);
  for (const [field, value] of [
    ['hp_max', 20],
    ['hp_current', 20],
  ] as const) {
    mutateState(db, {
      target: 'character',
      field,
      op: 'set',
      value,
      ...CTX,
    });
  }
  return { db, pcId };
}

function goblinModule(): AdventureModule {
  const module = makeTestAdventureModule();
  return {
    ...module,
    encounters: [
      {
        id: 'enc-goblins',
        name: 'Goblin Ambush',
        description: 'Two goblins spring from the brush.',
        creatures: [
          { rulesRef: 'creature:goblin', count: 2, role: 'ambusher' },
        ],
        locationId: 'loc-cellar',
        reward: 'A few bent copper coins.',
      },
    ],
    scenes: module.scenes.map((scene) =>
      scene.id === 'scene-cellar'
        ? { ...scene, encounterIds: ['enc-goblins'] }
        : scene,
    ),
  };
}

function setupCombat() {
  const { db, pcId } = setup();
  const module = goblinModule();
  startAdventureRun(db, {
    campaignId: CAMPAIGN,
    runId: 'run-goblins',
    moduleId: module.id,
    provenance: 'test',
    sessionId: DEFAULT_TEST_SESSION_ID,
    updatedAt: NOW,
  });
  const encounter = startEncounter(db, {
    campaignId: CAMPAIGN,
    encounterId: 'enc-goblins',
    resolveAdventureModule: (moduleId) =>
      moduleId === module.id ? module : undefined,
    ...CTX,
  });
  return {
    db,
    pcId,
    combatInstanceId: encounter.combatInstance.combatInstanceId,
  };
}

function pc(pcId: string) {
  return { kind: 'character' as const, ref: pcId };
}

/** A Bless-shaped concentration effect on the caster. */
function castBless(db: Db, pcId: string, effectId = 'fx-bless') {
  return createActiveEffect(db, {
    campaignId: CAMPAIGN,
    effectId,
    kind: 'spell-effect',
    displayName: 'Bless',
    source: { kind: 'spell', ref: 'spell:bless', actor: pc(pcId) },
    concentration: { owner: pc(pcId) },
    duration: {
      kind: 'timed',
      amount: 1,
      unit: 'minute',
      anchor: 'spell-cast',
    },
    targets: [{ kind: 'character', ref: pcId }],
    conditions: [
      {
        target: pc(pcId),
        condition: { id: `blessed:${effectId}`, bonus: '+1d4 attacks/saves' },
      },
    ],
    ...CTX,
  });
}

function characterConditionIds(db: Db, pcId: string): string[] {
  const row = db
    .prepare('SELECT conditions_json FROM character WHERE id = ?')
    .get(pcId) as { conditions_json: string };
  return (JSON.parse(row.conditions_json) as { id: string }[]).map(
    (entry) => entry.id,
  );
}

function combatantState(db: Db, combatantId: string) {
  return db
    .prepare(
      `SELECT status, conditions_json FROM encounter_combatant
       WHERE campaign_id = ? AND combatant_id = ?`,
    )
    .get(CAMPAIGN, combatantId) as {
    status: string;
    conditions_json: string;
  };
}

// ---------------------------------------------------------------------------
// Spell duration grounding
// ---------------------------------------------------------------------------

describe('parseSpellDurationText', () => {
  it('parses the groundable SRD duration forms', () => {
    expect(parseSpellDurationText('Instantaneous')).toEqual({
      concentration: false,
      form: { kind: 'instantaneous' },
    });
    expect(parseSpellDurationText('Concentration, up to 1 minute')).toEqual({
      concentration: true,
      form: { kind: 'timed', amount: 1, unit: 'minute' },
    });
    expect(parseSpellDurationText('8 hours')).toEqual({
      concentration: false,
      form: { kind: 'timed', amount: 8, unit: 'hour' },
    });
    expect(parseSpellDurationText('Until dispelled')).toEqual({
      concentration: false,
      form: { kind: 'until-dispelled' },
    });
    expect(parseSpellDurationText('Until dispelled or triggered')).toEqual({
      concentration: false,
      form: { kind: 'until-dispelled-or-triggered' },
    });
    expect(parseSpellDurationText('1 round')).toEqual({
      concentration: false,
      form: { kind: 'timed', amount: 1, unit: 'round' },
    });
    expect(parseSpellDurationText('Up to 8 hours').form).toEqual({
      kind: 'timed',
      amount: 8,
      unit: 'hour',
    });
    expect(parseSpellDurationText('Special')).toEqual({
      concentration: false,
      form: { kind: 'unparsed' },
    });
  });
});

// ---------------------------------------------------------------------------
// createActiveEffect: grounding, licensing, validation-before-mutation
// ---------------------------------------------------------------------------

describe('createActiveEffect', () => {
  it('creates a concentration spell effect with target and projected condition', () => {
    const { db, pcId } = setup();
    const result = castBless(db, pcId);

    expect(result.replaced).toBeUndefined();
    expect(result.effect).toMatchObject({
      effectId: 'fx-bless',
      kind: 'spell-effect',
      status: 'active',
      requiresConcentration: true,
      concentrationOwner: { kind: 'character', ref: pcId },
      duration: {
        kind: 'timed',
        amount: 1,
        unit: 'minute',
        anchorKind: 'spell-cast',
        anchorAt: NOW,
      },
    });
    expect(result.effect.targets).toEqual([
      { kind: 'character', ref: pcId, status: 'active' },
    ]);
    expect(result.effect.links).toHaveLength(1);
    expect(characterConditionIds(db, pcId)).toContain('blessed:fx-bless');

    const events = listEffectEvents(db, CAMPAIGN, 'fx-bless');
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ seq: 1, eventKind: 'created' });
    expect(events[0]?.detail).toMatchObject({
      source: { kind: 'spell', ref: 'spell:bless' },
      concentrationOwner: { kind: 'character', ref: pcId },
    });
  });

  it('refuses an instantaneous spell', () => {
    const { db, pcId } = setup();
    expect(() =>
      createActiveEffect(db, {
        campaignId: CAMPAIGN,
        effectId: 'fx-firebolt',
        kind: 'spell-effect',
        displayName: 'Fire Bolt',
        source: { kind: 'spell', ref: 'spell:fire-bolt' },
        duration: { kind: 'until-removed' },
        targets: [{ kind: 'character', ref: pcId }],
        ...CTX,
      }),
    ).toThrow(/instantaneous/);
  });

  it('refuses an unresolvable spell ref (homebrew goes through ruling)', () => {
    const { db } = setup();
    expect(() =>
      createActiveEffect(db, {
        campaignId: CAMPAIGN,
        effectId: 'fx-homebrew',
        kind: 'spell-effect',
        displayName: 'Homebrew Haze',
        source: { kind: 'spell', ref: 'spell:homebrew-haze' },
        duration: { kind: 'until-removed' },
        ...CTX,
      }),
    ).toThrow(/does not resolve to a spell record/);
  });

  it('derives concentration from the record and fails closed both ways', () => {
    const { db, pcId } = setup();
    // Bless requires concentration: omitting the owner is refused.
    expect(() =>
      createActiveEffect(db, {
        campaignId: CAMPAIGN,
        effectId: 'fx-bless-flat',
        kind: 'spell-effect',
        displayName: 'Bless',
        source: { kind: 'spell', ref: 'spell:bless' },
        duration: {
          kind: 'timed',
          amount: 1,
          unit: 'minute',
          anchor: 'spell-cast',
        },
        ...CTX,
      }),
    ).toThrow(/record requires concentration/);
    // Mage Armor does not: declaring an owner is refused.
    expect(() =>
      createActiveEffect(db, {
        campaignId: CAMPAIGN,
        effectId: 'fx-mage-armor',
        kind: 'spell-effect',
        displayName: 'Mage Armor',
        source: { kind: 'spell', ref: 'spell:mage-armor' },
        concentration: { owner: pc(pcId) },
        duration: {
          kind: 'timed',
          amount: 8,
          unit: 'hour',
          anchor: 'spell-cast',
        },
        ...CTX,
      }),
    ).toThrow(/does not require concentration/);
  });

  it('binds the declared duration to the record duration', () => {
    const { db, pcId } = setup();
    expect(() =>
      createActiveEffect(db, {
        campaignId: CAMPAIGN,
        effectId: 'fx-bless-long',
        kind: 'spell-effect',
        displayName: 'Bless',
        source: { kind: 'spell', ref: 'spell:bless' },
        concentration: { owner: pc(pcId) },
        duration: {
          kind: 'timed',
          amount: 10,
          unit: 'minute',
          anchor: 'spell-cast',
        },
        ...CTX,
      }),
    ).toThrow(/duration is 1 minute/);
    // Until-dispelled records require an until-removed duration.
    expect(() =>
      createActiveEffect(db, {
        campaignId: CAMPAIGN,
        effectId: 'fx-flame',
        kind: 'spell-effect',
        displayName: 'Continual Flame',
        source: { kind: 'spell', ref: 'spell:continual-flame' },
        duration: {
          kind: 'timed',
          amount: 1,
          unit: 'day',
          anchor: 'spell-cast',
        },
        ...CTX,
      }),
    ).toThrow(/until dispelled/);
    // Until-dispelled-or-triggered records require a named trigger.
    expect(() =>
      createActiveEffect(db, {
        campaignId: CAMPAIGN,
        effectId: 'fx-glyph',
        kind: 'ward',
        displayName: 'Glyph of Warding',
        source: { kind: 'spell', ref: 'spell:glyph-of-warding' },
        duration: { kind: 'until-removed' },
        ...CTX,
      }),
    ).toThrow(/until-trigger/);
  });

  it('enforces kind licenses for source, concentration, and link kinds', () => {
    const { db, pcId } = setup();
    // condition-package cannot carry concentration (a concentration spell is
    // a spell-effect, not a standalone condition package).
    expect(() =>
      createActiveEffect(db, {
        campaignId: CAMPAIGN,
        effectId: 'fx-charm',
        kind: 'condition-package',
        displayName: 'Sentient Item Charm',
        source: { kind: 'spell', ref: 'spell:bless' },
        duration: { kind: 'until-removed' },
        ...CTX,
      }),
    ).toThrow(/cannot carry|requires concentration, which/);
    // item-power effects only come from magic items.
    expect(() =>
      createActiveEffect(db, {
        campaignId: CAMPAIGN,
        effectId: 'fx-item',
        kind: 'item-power',
        displayName: 'Cloak Shimmer',
        source: { kind: 'ruling' },
        duration: { kind: 'until-removed' },
        ...CTX,
      }),
    ).toThrow(/cannot come from source kind 'ruling'/);
    // spell-effect cannot own linked actors (that is 'summoning').
    expect(() =>
      createActiveEffect(db, {
        campaignId: CAMPAIGN,
        effectId: 'fx-not-summon',
        kind: 'spell-effect',
        displayName: 'Not A Summon',
        source: { kind: 'ruling' },
        duration: { kind: 'until-removed' },
        actors: [{ combatantId: 'whatever' }],
        ...CTX,
      }),
    ).toThrow(/cannot own linked actors/);
    // unknown participants fail closed.
    expect(() =>
      createActiveEffect(db, {
        campaignId: CAMPAIGN,
        effectId: 'fx-ghost-target',
        kind: 'spell-effect',
        displayName: 'Ghost Target',
        source: { kind: 'ruling' },
        duration: { kind: 'until-removed' },
        targets: [{ kind: 'character', ref: 'pc-ghost' }],
        ...CTX,
      }),
    ).toThrow(/unknown character 'pc-ghost'/);
    expect(listActiveEffects(db, CAMPAIGN)).toHaveLength(0);
    expect(characterConditionIds(db, pcId)).toEqual([]);
  });

  it('refuses reusing an effect id, even after the effect ended', () => {
    const { db, pcId } = setup();
    castBless(db, pcId);
    endActiveEffect(db, {
      campaignId: CAMPAIGN,
      effectId: 'fx-bless',
      reason: 'concentration-broken',
      detail: 'voluntary',
      ...CTX,
    });
    expect(() => castBless(db, pcId)).toThrow(/already exists/);
  });

  it('refuses to project a condition id the target already carries', () => {
    const { db, pcId } = setup();
    mutateState(db, {
      target: 'character',
      field: 'conditions_json',
      op: 'set',
      value: [{ id: 'poisoned' }],
      ...CTX,
    });
    expect(() =>
      createActiveEffect(db, {
        campaignId: CAMPAIGN,
        effectId: 'fx-poison',
        kind: 'condition-package',
        displayName: 'Poison Cloud',
        source: { kind: 'hazard' },
        duration: {
          kind: 'timed',
          amount: 1,
          unit: 'hour',
          anchor: 'effect-created',
        },
        conditions: [{ target: pc(pcId), condition: { id: 'poisoned' } }],
        ...CTX,
      }),
    ).toThrow(/already has a condition 'poisoned'/);
    expect(characterConditionIds(db, pcId)).toEqual(['poisoned']);
  });

  it('rolls the whole creation back when a later projection collides', () => {
    const { db, pcId } = setup();
    mutateState(db, {
      target: 'character',
      field: 'conditions_json',
      op: 'set',
      value: [{ id: 'second' }],
      ...CTX,
    });
    expect(() =>
      createActiveEffect(db, {
        campaignId: CAMPAIGN,
        effectId: 'fx-double',
        kind: 'condition-package',
        displayName: 'Double Trouble',
        source: { kind: 'ruling' },
        duration: { kind: 'until-removed' },
        conditions: [
          { target: pc(pcId), condition: { id: 'first' } },
          { target: pc(pcId), condition: { id: 'second' } },
        ],
        ...CTX,
      }),
    ).toThrow(/already has a condition 'second'/);
    // Nothing mutated: no effect row, no events, no 'first' condition.
    expect(listActiveEffects(db, CAMPAIGN)).toHaveLength(0);
    expect(listEffectEvents(db, CAMPAIGN, 'fx-double')).toHaveLength(0);
    expect(characterConditionIds(db, pcId)).toEqual(['second']);
  });
});

// ---------------------------------------------------------------------------
// Concentration: single-instance invariant & replacement
// ---------------------------------------------------------------------------

describe('concentration invariant', () => {
  it('replaces the prior concentration effect deterministically, with audit order', () => {
    const { db, pcId } = setupCombat();
    castBless(db, pcId);

    const holdPerson = createActiveEffect(db, {
      campaignId: CAMPAIGN,
      effectId: 'fx-hold',
      kind: 'spell-effect',
      displayName: 'Hold Person',
      source: { kind: 'spell', ref: 'spell:hold-person', actor: pc(pcId) },
      concentration: { owner: pc(pcId) },
      duration: {
        kind: 'timed',
        amount: 1,
        unit: 'minute',
        anchor: 'spell-cast',
      },
      targets: [{ kind: 'combatant', ref: GOBLIN_1 }],
      conditions: [
        {
          target: { kind: 'combatant', ref: GOBLIN_1 },
          condition: { id: 'paralyzed:fx-hold' },
        },
      ],
      ...CTX,
    });

    expect(holdPerson.replaced).toMatchObject({
      effectId: 'fx-bless',
      displayName: 'Bless',
    });
    // Bless ended with exact cleanup of its own projection.
    const bless = listActiveEffects(db, CAMPAIGN, { includeEnded: true }).find(
      (effect) => effect.effectId === 'fx-bless',
    );
    expect(bless).toMatchObject({
      status: 'ended',
      endReason: 'concentration-broken',
      endDetail: 'new-concentration',
    });
    expect(characterConditionIds(db, pcId)).toEqual([]);
    // Hold Person is live and projected.
    expect(getConcentrationEffect(db, CAMPAIGN, pc(pcId))?.effectId).toBe(
      'fx-hold',
    );
    expect(
      (
        JSON.parse(combatantState(db, GOBLIN_1).conditions_json) as {
          id: string;
        }[]
      ).map((c) => c.id),
    ).toContain('paralyzed:fx-hold');
    // Audit ordering: the old effect's ledger closes before the new one opens.
    const blessEvents = listEffectEvents(db, CAMPAIGN, 'fx-bless');
    expect(blessEvents.at(-1)).toMatchObject({ eventKind: 'ended' });
    expect(blessEvents.at(-1)?.detail).toMatchObject({
      reason: 'concentration-broken',
      detail: 'new-concentration',
      note: "replaced by effect 'fx-hold'",
    });
    const holdEvents = listEffectEvents(db, CAMPAIGN, 'fx-hold');
    expect(holdEvents[0]?.detail).toMatchObject({
      replacedEffectId: 'fx-bless',
    });
  });

  it('supports recasting the same spell with the same condition ids', () => {
    const { db, pcId } = setup();
    createActiveEffect(db, {
      campaignId: CAMPAIGN,
      effectId: 'fx-bless-1',
      kind: 'spell-effect',
      displayName: 'Bless',
      source: { kind: 'spell', ref: 'spell:bless' },
      concentration: { owner: pc(pcId) },
      duration: {
        kind: 'timed',
        amount: 1,
        unit: 'minute',
        anchor: 'spell-cast',
      },
      conditions: [{ target: pc(pcId), condition: { id: 'blessed' } }],
      ...CTX,
    });
    const recast = createActiveEffect(db, {
      campaignId: CAMPAIGN,
      effectId: 'fx-bless-2',
      kind: 'spell-effect',
      displayName: 'Bless',
      source: { kind: 'spell', ref: 'spell:bless' },
      concentration: { owner: pc(pcId) },
      duration: {
        kind: 'timed',
        amount: 1,
        unit: 'minute',
        anchor: 'spell-cast',
      },
      conditions: [{ target: pc(pcId), condition: { id: 'blessed' } }],
      ...CTX,
    });
    expect(recast.replaced?.effectId).toBe('fx-bless-1');
    expect(characterConditionIds(db, pcId)).toEqual(['blessed']);
    expect(
      listActiveEffects(db, CAMPAIGN).map((effect) => effect.effectId),
    ).toEqual(['fx-bless-2']);
  });

  it('lets different owners concentrate simultaneously', () => {
    const { db, pcId } = setupCombat();
    castBless(db, pcId);
    createActiveEffect(db, {
      campaignId: CAMPAIGN,
      effectId: 'fx-goblin-conc',
      kind: 'spell-effect',
      displayName: 'Goblin Focus',
      source: { kind: 'ruling' },
      concentration: { owner: { kind: 'combatant', ref: GOBLIN_1 } },
      duration: {
        kind: 'timed',
        amount: 1,
        unit: 'minute',
        anchor: 'effect-created',
      },
      ...CTX,
    });
    expect(getConcentrationEffect(db, CAMPAIGN, pc(pcId))?.effectId).toBe(
      'fx-bless',
    );
    expect(
      getConcentrationEffect(db, CAMPAIGN, {
        kind: 'combatant',
        ref: GOBLIN_1,
      })?.effectId,
    ).toBe('fx-goblin-conc');
  });
});

// ---------------------------------------------------------------------------
// Concentration checks (F9 evidence seam)
// ---------------------------------------------------------------------------

describe('resolveConcentrationCheck', () => {
  it('computes the SRD DC', () => {
    expect(concentrationSaveDc(1)).toBe(10);
    expect(concentrationSaveDc(20)).toBe(10);
    expect(concentrationSaveDc(22)).toBe(11);
    expect(concentrationSaveDc(57)).toBe(28);
  });

  it('a successful save maintains the effect and records evidence', () => {
    const { db, pcId } = setup();
    castBless(db, pcId);
    const result = resolveConcentrationCheck(db, {
      campaignId: CAMPAIGN,
      owner: pc(pcId),
      damage: 22,
      vs: 11,
      outcome: 'success',
      rollRef: 'turn-7:resolve_check',
      ...CTX,
    });
    expect(result).toMatchObject({
      effectId: 'fx-bless',
      dc: 11,
      broken: false,
    });
    expect(getConcentrationEffect(db, CAMPAIGN, pc(pcId))?.effectId).toBe(
      'fx-bless',
    );
    const events = listEffectEvents(db, CAMPAIGN, 'fx-bless');
    expect(events.at(-1)).toMatchObject({ eventKind: 'concentration-check' });
    expect(events.at(-1)?.detail).toEqual({
      damage: 22,
      dc: 11,
      outcome: 'success',
      rollRef: 'turn-7:resolve_check',
    });
  });

  it('a failed save ends the effect with break cleanup', () => {
    const { db, pcId } = setup();
    castBless(db, pcId);
    const result = resolveConcentrationCheck(db, {
      campaignId: CAMPAIGN,
      owner: pc(pcId),
      damage: 7,
      vs: 10,
      outcome: 'failure',
      ...CTX,
    });
    expect(result.broken).toBe(true);
    expect(result.cleanup?.links).toEqual([
      {
        linkKind: 'condition',
        target: { kind: 'character', ref: pcId },
        projectionRef: 'blessed:fx-bless',
        action: 'removed',
      },
    ]);
    expect(getConcentrationEffect(db, CAMPAIGN, pc(pcId))).toBeUndefined();
    expect(characterConditionIds(db, pcId)).toEqual([]);
  });

  it('rejects malformed evidence before any mutation', () => {
    const { db, pcId } = setup();
    castBless(db, pcId);
    expect(() =>
      resolveConcentrationCheck(db, {
        campaignId: CAMPAIGN,
        owner: pc(pcId),
        damage: 22,
        vs: 10, // wrong DC for 22 damage
        outcome: 'failure',
        ...CTX,
      }),
    ).toThrow(/requires DC 11/);
    expect(() =>
      resolveConcentrationCheck(db, {
        campaignId: CAMPAIGN,
        owner: pc(pcId),
        damage: 0,
        vs: 10,
        outcome: 'failure',
        ...CTX,
      }),
    ).toThrow(/positive integer/);
    // No ledger writes, effect untouched.
    expect(listEffectEvents(db, CAMPAIGN, 'fx-bless')).toHaveLength(1);
    expect(getConcentrationEffect(db, CAMPAIGN, pc(pcId))?.effectId).toBe(
      'fx-bless',
    );
  });

  it('rejects a check for an owner who is not concentrating', () => {
    const { db, pcId } = setup();
    expect(() =>
      resolveConcentrationCheck(db, {
        campaignId: CAMPAIGN,
        owner: pc(pcId),
        damage: 10,
        vs: 10,
        outcome: 'failure',
        ...CTX,
      }),
    ).toThrow(/not concentrating/);
  });
});

// ---------------------------------------------------------------------------
// F6 life-state integration (adjustHp / incapacitation / death)
// ---------------------------------------------------------------------------

describe('adjustHp concentration integration', () => {
  it('surfaces the required check when a concentrating character takes damage', () => {
    const { db, pcId } = setup();
    castBless(db, pcId);
    const result = adjustHp(db, -9, CTX);
    expect(result.concentrationCheck).toEqual({
      effectId: 'fx-bless',
      displayName: 'Bless',
      dc: 10,
      damage: 9,
    });
    expect(result.concentrationBroken).toBeUndefined();
    // The check is a prompt, not a mutation: the effect is still live.
    expect(getConcentrationEffect(db, CAMPAIGN, pc(pcId))?.effectId).toBe(
      'fx-bless',
    );
  });

  it('uses the damage event, not the net HP loss, when temp HP absorb it', () => {
    const { db, pcId } = setup();
    castBless(db, pcId);
    grantTemporaryHp(db, 10, CTX);
    const result = adjustHp(db, -6, CTX);
    expect(result.newHp).toBe(20);
    expect(result.tempHpAbsorbed).toBe(6);
    expect(result.concentrationCheck).toMatchObject({ dc: 10, damage: 6 });
  });

  it('breaks concentration outright when damage incapacitates (0 HP)', () => {
    const { db, pcId } = setup();
    castBless(db, pcId);
    const result = adjustHp(db, -20, CTX);
    expect(result.lifeState).toBe('dying');
    expect(result.concentrationCheck).toBeUndefined();
    expect(result.concentrationBroken).toEqual({
      effectId: 'fx-bless',
      displayName: 'Bless',
      cause: 'incapacitated',
    });
    expect(getConcentrationEffect(db, CAMPAIGN, pc(pcId))).toBeUndefined();
    expect(characterConditionIds(db, pcId)).toEqual([]);
    const ended = listEffectEvents(db, CAMPAIGN, 'fx-bless').at(-1);
    expect(ended?.detail).toMatchObject({
      reason: 'concentration-broken',
      detail: 'incapacitated',
    });
  });

  it('records death as the break cause on instant death', () => {
    const { db, pcId } = setup();
    castBless(db, pcId);
    const result = adjustHp(db, -40, CTX);
    expect(result.instantDeath).toBe(true);
    expect(result.concentrationBroken?.cause).toBe('dead');
  });

  it('healing and non-concentrating damage carry no check', () => {
    const { db, pcId } = setup();
    expect(adjustHp(db, -5, CTX).concentrationCheck).toBeUndefined();
    castBless(db, pcId);
    expect(adjustHp(db, 3, CTX).concentrationCheck).toBeUndefined();
  });

  it('breaks a combatant owner via the combatant hook, idempotently', () => {
    const { db } = setupCombat();
    createActiveEffect(db, {
      campaignId: CAMPAIGN,
      effectId: 'fx-goblin-conc',
      kind: 'spell-effect',
      displayName: 'Goblin Focus',
      source: { kind: 'ruling' },
      concentration: { owner: { kind: 'combatant', ref: GOBLIN_1 } },
      duration: { kind: 'until-removed' },
      ...CTX,
    });
    const broken = breakCombatantConcentration(
      db,
      CAMPAIGN,
      GOBLIN_1,
      'incapacitated',
      CTX,
    );
    expect(broken).toMatchObject({ broken: true, effectId: 'fx-goblin-conc' });
    // Duplicate delivery of the same cleanup event is a no-op.
    expect(
      breakCombatantConcentration(db, CAMPAIGN, GOBLIN_1, 'incapacitated', CTX)
        .broken,
    ).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// endActiveEffect: reasons, gates, idempotency
// ---------------------------------------------------------------------------

describe('endActiveEffect', () => {
  it('dismisses a dismissible effect and cleans up on the end policy', () => {
    const { db, pcId } = setup();
    createActiveEffect(db, {
      campaignId: CAMPAIGN,
      effectId: 'fx-steed',
      kind: 'spell-effect',
      displayName: 'Phantom Steed',
      source: { kind: 'spell', ref: 'spell:phantom-steed' },
      duration: {
        kind: 'timed',
        amount: 1,
        unit: 'hour',
        anchor: 'spell-cast',
      },
      dismissible: true,
      conditions: [{ target: pc(pcId), condition: { id: 'mounted:fx-steed' } }],
      ...CTX,
    });
    const result = endActiveEffect(db, {
      campaignId: CAMPAIGN,
      effectId: 'fx-steed',
      reason: 'dismissed',
      ...CTX,
    });
    expect(result.changed).toBe(true);
    expect(result.effect.status).toBe('ended');
    expect(characterConditionIds(db, pcId)).toEqual([]);
  });

  it('refuses dismissing a non-dismissible effect', () => {
    const { db } = setup();
    createActiveEffect(db, {
      campaignId: CAMPAIGN,
      effectId: 'fx-armor',
      kind: 'spell-effect',
      displayName: 'Mage Armor',
      source: { kind: 'spell', ref: 'spell:mage-armor' },
      duration: {
        kind: 'timed',
        amount: 8,
        unit: 'hour',
        anchor: 'spell-cast',
      },
      ...CTX,
    });
    expect(() =>
      endActiveEffect(db, {
        campaignId: CAMPAIGN,
        effectId: 'fx-armor',
        reason: 'dismissed',
        ...CTX,
      }),
    ).toThrow(/not dismissible/);
  });

  it('gates concentration-broken causes to the direct set', () => {
    const { db, pcId } = setup();
    castBless(db, pcId);
    for (const detail of [
      'damage-save-failed',
      'new-concentration',
      'incapacitated',
      'dead',
    ]) {
      expect(() =>
        endActiveEffect(db, {
          campaignId: CAMPAIGN,
          effectId: 'fx-bless',
          reason: 'concentration-broken',
          detail,
          ...CTX,
        }),
      ).toThrow(/not directly declarable/);
    }
    expect(() =>
      endActiveEffect(db, {
        campaignId: CAMPAIGN,
        effectId: 'fx-armor-x',
        reason: 'concentration-broken',
        detail: 'voluntary',
        ...CTX,
      }),
    ).toThrow(/no active effect/);
    const result = endActiveEffect(db, {
      campaignId: CAMPAIGN,
      effectId: 'fx-bless',
      reason: 'concentration-broken',
      detail: 'voluntary',
      ...CTX,
    });
    expect(result.effect.endDetail).toBe('voluntary');
  });

  it('refuses concentration-broken on a non-concentration effect', () => {
    const { db } = setup();
    createActiveEffect(db, {
      campaignId: CAMPAIGN,
      effectId: 'fx-armor',
      kind: 'spell-effect',
      displayName: 'Mage Armor',
      source: { kind: 'spell', ref: 'spell:mage-armor' },
      duration: {
        kind: 'timed',
        amount: 8,
        unit: 'hour',
        anchor: 'spell-cast',
      },
      ...CTX,
    });
    expect(() =>
      endActiveEffect(db, {
        campaignId: CAMPAIGN,
        effectId: 'fx-armor',
        reason: 'concentration-broken',
        detail: 'voluntary',
        ...CTX,
      }),
    ).toThrow(/not a concentration effect/);
  });

  it("requires a note for 'ruled' ends and a matching trigger for trigger expiry", () => {
    const { db } = setup();
    createActiveEffect(db, {
      campaignId: CAMPAIGN,
      effectId: 'fx-glyph',
      kind: 'ward',
      displayName: 'Glyph of Warding',
      source: { kind: 'spell', ref: 'spell:glyph-of-warding' },
      duration: {
        kind: 'until-trigger',
        trigger: 'a creature crosses the glyph',
      },
      ...CTX,
    });
    expect(() =>
      endActiveEffect(db, {
        campaignId: CAMPAIGN,
        effectId: 'fx-glyph',
        reason: 'ruled',
        ...CTX,
      }),
    ).toThrow(/note/);
    expect(() =>
      endActiveEffect(db, {
        campaignId: CAMPAIGN,
        effectId: 'fx-glyph',
        reason: 'expired',
        ...CTX,
      }),
    ).toThrow(/naming the trigger/);
    expect(() =>
      endActiveEffect(db, {
        campaignId: CAMPAIGN,
        effectId: 'fx-glyph',
        reason: 'expired',
        trigger: 'someone sneezes',
        ...CTX,
      }),
    ).toThrow(/does not match/);
    const result = endActiveEffect(db, {
      campaignId: CAMPAIGN,
      effectId: 'fx-glyph',
      reason: 'expired',
      trigger: 'a creature crosses the glyph',
      ...CTX,
    });
    expect(result.effect.endReason).toBe('expired');
  });

  it('refuses expiring an effect with no natural expiry', () => {
    const { db } = setup();
    createActiveEffect(db, {
      campaignId: CAMPAIGN,
      effectId: 'fx-flame',
      kind: 'spell-effect',
      displayName: 'Continual Flame',
      source: { kind: 'spell', ref: 'spell:continual-flame' },
      duration: { kind: 'until-removed' },
      ...CTX,
    });
    expect(() =>
      endActiveEffect(db, {
        campaignId: CAMPAIGN,
        effectId: 'fx-flame',
        reason: 'expired',
        ...CTX,
      }),
    ).toThrow(/no natural expiry/);
    // But dispelling it works — that is its rule.
    expect(
      endActiveEffect(db, {
        campaignId: CAMPAIGN,
        effectId: 'fx-flame',
        reason: 'dispelled',
        ...CTX,
      }).effect.endReason,
    ).toBe('dispelled');
  });

  it('treats duplicate end delivery as idempotent and conflicting ends as errors', () => {
    const { db, pcId } = setup();
    castBless(db, pcId);
    endActiveEffect(db, {
      campaignId: CAMPAIGN,
      effectId: 'fx-bless',
      reason: 'concentration-broken',
      detail: 'voluntary',
      ...CTX,
    });
    const duplicate = endActiveEffect(db, {
      campaignId: CAMPAIGN,
      effectId: 'fx-bless',
      reason: 'concentration-broken',
      detail: 'voluntary',
      ...CTX,
    });
    expect(duplicate.changed).toBe(false);
    expect(duplicate.cleanup.links).toHaveLength(0);
    // Only one 'ended' event exists — cleanup ran exactly once.
    expect(
      listEffectEvents(db, CAMPAIGN, 'fx-bless').filter(
        (event) => event.eventKind === 'ended',
      ),
    ).toHaveLength(1);
    expect(() =>
      endActiveEffect(db, {
        campaignId: CAMPAIGN,
        effectId: 'fx-bless',
        reason: 'dispelled',
        ...CTX,
      }),
    ).toThrow(/already ended/);
  });
});

// ---------------------------------------------------------------------------
// Exact cleanup ownership & the end-vs-break distinction
// ---------------------------------------------------------------------------

describe('cleanup ownership', () => {
  it('removes exactly the ended effect’s projections, preserving unrelated ones', () => {
    const { db, pcId } = setup();
    createActiveEffect(db, {
      campaignId: CAMPAIGN,
      effectId: 'fx-a',
      kind: 'condition-package',
      displayName: 'Effect A',
      source: { kind: 'ruling' },
      duration: { kind: 'until-removed' },
      conditions: [
        { target: pc(pcId), condition: { id: 'cond-a1' } },
        { target: pc(pcId), condition: { id: 'cond-a2' } },
      ],
      ...CTX,
    });
    createActiveEffect(db, {
      campaignId: CAMPAIGN,
      effectId: 'fx-b',
      kind: 'condition-package',
      displayName: 'Effect B',
      source: { kind: 'ruling' },
      duration: { kind: 'until-removed' },
      conditions: [{ target: pc(pcId), condition: { id: 'cond-b' } }],
      ...CTX,
    });
    endActiveEffect(db, {
      campaignId: CAMPAIGN,
      effectId: 'fx-a',
      reason: 'dispelled',
      ...CTX,
    });
    expect(characterConditionIds(db, pcId)).toEqual(['cond-b']);
    const b = listActiveEffects(db, CAMPAIGN).find(
      (effect) => effect.effectId === 'fx-b',
    );
    expect(b?.status).toBe('active');
    expect(b?.links[0]?.status).toBe('active');
  });

  it('release-on-break keeps the summoned actor while ordinary end removes it (Conjure Elemental)', () => {
    const { db, pcId } = setupCombat();
    const summon = (effectId: string) =>
      createActiveEffect(db, {
        campaignId: CAMPAIGN,
        effectId,
        kind: 'summoning',
        displayName: 'Conjure Elemental',
        source: {
          kind: 'spell',
          ref: 'spell:conjure-elemental',
          actor: pc(pcId),
        },
        concentration: { owner: pc(pcId) },
        duration: {
          kind: 'timed',
          amount: 1,
          unit: 'hour',
          anchor: 'spell-cast',
        },
        actors: [
          {
            combatantId: GOBLIN_1,
            cleanupOnEnd: 'remove',
            cleanupOnBreak: 'release',
          },
        ],
        ...CTX,
      });
    summon('fx-elemental-1');

    // Concentration break: the entity stays (released), now unowned.
    const broken = endActiveEffect(db, {
      campaignId: CAMPAIGN,
      effectId: 'fx-elemental-1',
      reason: 'concentration-broken',
      detail: 'voluntary',
      ...CTX,
    });
    expect(broken.cleanup.links[0]?.action).toBe('released');
    expect(combatantState(db, GOBLIN_1).status).toBe('alive');

    // The released entity can be owned by a new effect; ordinary end removes it.
    summon('fx-elemental-2');
    const dispelled = endActiveEffect(db, {
      campaignId: CAMPAIGN,
      effectId: 'fx-elemental-2',
      reason: 'dispelled',
      ...CTX,
    });
    expect(dispelled.cleanup.links[0]?.action).toBe('removed');
    expect(combatantState(db, GOBLIN_1).status).toBe('inactive');
  });

  it('refuses linking an actor another live effect already owns', () => {
    const { db, pcId } = setupCombat();
    createActiveEffect(db, {
      campaignId: CAMPAIGN,
      effectId: 'fx-owner-1',
      kind: 'summoning',
      displayName: 'Owner One',
      source: { kind: 'ruling' },
      duration: { kind: 'until-removed' },
      actors: [{ combatantId: GOBLIN_1 }],
      ...CTX,
    });
    expect(() =>
      createActiveEffect(db, {
        campaignId: CAMPAIGN,
        effectId: 'fx-owner-2',
        kind: 'summoning',
        displayName: 'Owner Two',
        source: { kind: 'ruling' },
        duration: { kind: 'until-removed' },
        actors: [{ combatantId: GOBLIN_1 }],
        ...CTX,
      }),
    ).toThrow(/already owned by effect 'fx-owner-1'/);
    expect(pcId).toBeTruthy();
  });

  it('closes links whose holder is unreachable as missing, and still ends', () => {
    const { db, combatInstanceId } = setupCombat();
    createActiveEffect(db, {
      campaignId: CAMPAIGN,
      effectId: 'fx-orphan',
      kind: 'summoning',
      displayName: 'Orphaned Summon',
      source: { kind: 'ruling' },
      duration: { kind: 'until-removed' },
      actors: [{ combatantId: GOBLIN_1 }],
      conditions: [
        {
          target: { kind: 'combatant', ref: GOBLIN_2 },
          condition: { id: 'marked:fx-orphan' },
        },
      ],
      ...CTX,
    });
    closeCombatInstance(db, {
      campaignId: CAMPAIGN,
      combatInstanceId,
      status: 'completed',
      ...CTX,
    });
    const result = endActiveEffect(db, {
      campaignId: CAMPAIGN,
      effectId: 'fx-orphan',
      reason: 'dispelled',
      ...CTX,
    });
    expect(result.effect.status).toBe('ended');
    expect(result.cleanup.links.map((action) => action.action).sort()).toEqual([
      'missing',
      'missing',
    ]);
    // No dangling ownership: the ended effect has no active links.
    expect(result.effect.links.every((link) => link.status !== 'active')).toBe(
      true,
    );
  });
});

// ---------------------------------------------------------------------------
// Targets: partial multi-target cleanup
// ---------------------------------------------------------------------------

describe('removeEffectTarget', () => {
  function castHold(db: Db, pcId: string) {
    createActiveEffect(db, {
      campaignId: CAMPAIGN,
      effectId: 'fx-hold',
      kind: 'spell-effect',
      displayName: 'Hold Person',
      source: { kind: 'spell', ref: 'spell:hold-person', actor: pc(pcId) },
      concentration: { owner: pc(pcId) },
      duration: {
        kind: 'timed',
        amount: 1,
        unit: 'minute',
        anchor: 'spell-cast',
      },
      targets: [
        { kind: 'combatant', ref: GOBLIN_1 },
        { kind: 'combatant', ref: GOBLIN_2 },
      ],
      conditions: [
        {
          target: { kind: 'combatant', ref: GOBLIN_1 },
          condition: { id: 'paralyzed:fx-hold' },
        },
        {
          target: { kind: 'combatant', ref: GOBLIN_2 },
          condition: { id: 'paralyzed:fx-hold' },
        },
      ],
      ...CTX,
    });
  }

  it('removes exactly the leaving target’s projections; the effect persists', () => {
    const { db, pcId } = setupCombat();
    castHold(db, pcId);
    const result = removeEffectTarget(db, {
      campaignId: CAMPAIGN,
      effectId: 'fx-hold',
      target: { kind: 'combatant', ref: GOBLIN_2 },
      reason: 'saved',
      ...CTX,
    });
    expect(result.changed).toBe(true);
    expect(result.cleanup).toEqual([
      {
        linkKind: 'condition',
        target: { kind: 'combatant', ref: GOBLIN_2 },
        projectionRef: 'paralyzed:fx-hold',
        action: 'removed',
      },
    ]);
    // Goblin 1 remains paralyzed; the effect and concentration persist.
    expect(
      (
        JSON.parse(combatantState(db, GOBLIN_1).conditions_json) as {
          id: string;
        }[]
      ).map((c) => c.id),
    ).toContain('paralyzed:fx-hold');
    expect(
      (
        JSON.parse(combatantState(db, GOBLIN_2).conditions_json) as {
          id: string;
        }[]
      ).map((c) => c.id),
    ).not.toContain('paralyzed:fx-hold');
    const effect = result.effect;
    expect(effect.status).toBe('active');
    expect(
      effect.targets.find((target) => target.ref === GOBLIN_2)?.status,
    ).toBe('removed');
    expect(
      effect.targets.find((target) => target.ref === GOBLIN_1)?.status,
    ).toBe('active');
  });

  it('is idempotent for the same reason and rejects conflicting re-removal', () => {
    const { db, pcId } = setupCombat();
    castHold(db, pcId);
    removeEffectTarget(db, {
      campaignId: CAMPAIGN,
      effectId: 'fx-hold',
      target: { kind: 'combatant', ref: GOBLIN_2 },
      reason: 'saved',
      ...CTX,
    });
    expect(
      removeEffectTarget(db, {
        campaignId: CAMPAIGN,
        effectId: 'fx-hold',
        target: { kind: 'combatant', ref: GOBLIN_2 },
        reason: 'saved',
        ...CTX,
      }).changed,
    ).toBe(false);
    expect(() =>
      removeEffectTarget(db, {
        campaignId: CAMPAIGN,
        effectId: 'fx-hold',
        target: { kind: 'combatant', ref: GOBLIN_2 },
        reason: 'death',
        ...CTX,
      }),
    ).toThrow(/already removed/);
    expect(() =>
      removeEffectTarget(db, {
        campaignId: CAMPAIGN,
        effectId: 'fx-hold',
        target: { kind: 'combatant', ref: 'not-a-target' },
        reason: 'saved',
        ...CTX,
      }),
    ).toThrow(/has no target/);
  });
});

// ---------------------------------------------------------------------------
// Duration validation, round timers, refresh
// ---------------------------------------------------------------------------

describe('durations and clocks', () => {
  it('requires an active combat instance for round-unit timers', () => {
    const { db } = setup();
    expect(() =>
      createActiveEffect(db, {
        campaignId: CAMPAIGN,
        effectId: 'fx-round',
        kind: 'condition-package',
        displayName: 'Stagger',
        source: { kind: 'ruling' },
        duration: {
          kind: 'timed',
          amount: 2,
          unit: 'round',
          anchor: 'effect-created',
        },
        ...CTX,
      }),
    ).toThrow(/active combat instance/);
  });

  it('validates timer shape: amount, unit, anchor, trigger, dismissibility', () => {
    const { db } = setup();
    const base = {
      campaignId: CAMPAIGN,
      kind: 'condition-package' as const,
      displayName: 'Bad Timer',
      source: { kind: 'ruling' as const },
      ...CTX,
    };
    expect(() =>
      createActiveEffect(db, {
        ...base,
        effectId: 'fx-bad-1',
        duration: {
          kind: 'timed',
          amount: 0,
          unit: 'hour',
          anchor: 'effect-created',
        },
      }),
    ).toThrow(/positive integer/);
    expect(() =>
      createActiveEffect(db, {
        ...base,
        effectId: 'fx-bad-2',
        duration: {
          kind: 'timed',
          amount: 1,
          unit: 'fortnight' as 'hour',
          anchor: 'effect-created',
        },
      }),
    ).toThrow(/unit must be one of/);
    expect(() =>
      createActiveEffect(db, {
        ...base,
        effectId: 'fx-bad-3',
        duration: {
          kind: 'timed',
          amount: 1,
          unit: 'hour',
          anchor: 'whenever' as 'effect-created',
        },
      }),
    ).toThrow(/anchor must be one of/);
    expect(() =>
      createActiveEffect(db, {
        ...base,
        effectId: 'fx-bad-4',
        duration: { kind: 'until-trigger', trigger: '' },
      }),
    ).toThrow(/trigger/);
    expect(() =>
      createActiveEffect(db, {
        ...base,
        effectId: 'fx-bad-5',
        duration: { kind: 'until-dismissed' },
        dismissible: false,
      }),
    ).toThrow(/must be dismissible/);
    expect(listActiveEffects(db, CAMPAIGN)).toHaveLength(0);
  });

  it('expires round timers deterministically and refuses early declared expiry', () => {
    const { db } = setupCombat();
    beginTurn(db, {
      campaignId: CAMPAIGN,
      participant: { kind: 'combatant', ref: GOBLIN_1 },
      ...CTX,
    });
    createActiveEffect(db, {
      campaignId: CAMPAIGN,
      effectId: 'fx-stagger',
      kind: 'condition-package',
      displayName: 'Stagger',
      source: { kind: 'ruling' },
      duration: {
        kind: 'timed',
        amount: 2,
        unit: 'round',
        anchor: 'effect-created',
      },
      ...CTX,
    });
    const effect = listActiveEffects(db, CAMPAIGN)[0];
    expect(effect?.duration).toMatchObject({
      anchorRound: 1,
      deadlineRound: 3,
    });

    // Round 2: not expired, sweep does nothing, early expiry refused.
    beginTurn(db, {
      campaignId: CAMPAIGN,
      participant: { kind: 'combatant', ref: GOBLIN_1 },
      round: 2,
      ...CTX,
    });
    expect(
      expireElapsedRoundEffects(db, { campaignId: CAMPAIGN, ...CTX }),
    ).toHaveLength(0);
    expect(() =>
      endActiveEffect(db, {
        campaignId: CAMPAIGN,
        effectId: 'fx-stagger',
        reason: 'expired',
        ...CTX,
      }),
    ).toThrow(/has not expired yet/);

    // Round 3: the deadline round arrived — the sweep ends it.
    beginTurn(db, {
      campaignId: CAMPAIGN,
      participant: { kind: 'combatant', ref: GOBLIN_1 },
      round: 3,
      ...CTX,
    });
    const expired = expireElapsedRoundEffects(db, {
      campaignId: CAMPAIGN,
      ...CTX,
    });
    expect(expired).toHaveLength(1);
    expect(expired[0]).toMatchObject({
      effectId: 'fx-stagger',
      deadlineRound: 3,
    });
    // Idempotent: nothing left to expire.
    expect(
      expireElapsedRoundEffects(db, { campaignId: CAMPAIGN, ...CTX }),
    ).toHaveLength(0);
  });

  it('accepts declared expiry of world-time units and of round timers after combat', () => {
    const { db, combatInstanceId } = setupCombat();
    createActiveEffect(db, {
      campaignId: CAMPAIGN,
      effectId: 'fx-stagger',
      kind: 'condition-package',
      displayName: 'Stagger',
      source: { kind: 'ruling' },
      duration: {
        kind: 'timed',
        amount: 10,
        unit: 'round',
        anchor: 'effect-created',
      },
      ...CTX,
    });
    createActiveEffect(db, {
      campaignId: CAMPAIGN,
      effectId: 'fx-hourly',
      kind: 'condition-package',
      displayName: 'Hourly',
      source: { kind: 'ruling' },
      duration: {
        kind: 'timed',
        amount: 1,
        unit: 'hour',
        anchor: 'effect-created',
      },
      ...CTX,
    });
    // World-time expiry is declared (the campaign clock is narrative).
    expect(
      endActiveEffect(db, {
        campaignId: CAMPAIGN,
        effectId: 'fx-hourly',
        reason: 'expired',
        ...CTX,
      }).effect.endReason,
    ).toBe('expired');
    // A round timer whose combat closed expires by declaration too.
    closeCombatInstance(db, {
      campaignId: CAMPAIGN,
      combatInstanceId,
      status: 'completed',
      ...CTX,
    });
    expect(
      endActiveEffect(db, {
        campaignId: CAMPAIGN,
        effectId: 'fx-stagger',
        reason: 'expired',
        ...CTX,
      }).effect.endReason,
    ).toBe('expired');
  });

  it('refresh re-anchors an active effect and is refused after end or under suppression', () => {
    const { db, pcId } = setup();
    castBless(db, pcId);
    const LATER = '2026-07-11T10:05:00.000Z';
    const refreshed = refreshEffect(db, {
      campaignId: CAMPAIGN,
      effectId: 'fx-bless',
      ...CTX,
      at: LATER,
    });
    expect(refreshed.duration.anchorAt).toBe(LATER);
    const events = listEffectEvents(db, CAMPAIGN, 'fx-bless');
    expect(events.at(-1)?.eventKind).toBe('refreshed');
    expect(events.at(-1)?.detail).toMatchObject({
      previous: { anchorAt: NOW },
      next: { anchorAt: LATER },
    });

    // A spell-grounded refresh cannot declare a different duration.
    expect(() =>
      refreshEffect(db, {
        campaignId: CAMPAIGN,
        effectId: 'fx-bless',
        duration: {
          kind: 'timed',
          amount: 10,
          unit: 'minute',
          anchor: 'spell-cast',
        },
        ...CTX,
      }),
    ).toThrow(/must re-anchor that duration/);

    suppressEffect(db, {
      campaignId: CAMPAIGN,
      effectId: 'fx-bless',
      ...CTX,
    });
    expect(() =>
      refreshEffect(db, { campaignId: CAMPAIGN, effectId: 'fx-bless', ...CTX }),
    ).toThrow(/suppressed/);
    unsuppressEffect(db, {
      campaignId: CAMPAIGN,
      effectId: 'fx-bless',
      ...CTX,
    });
    endActiveEffect(db, {
      campaignId: CAMPAIGN,
      effectId: 'fx-bless',
      reason: 'concentration-broken',
      detail: 'voluntary',
      ...CTX,
    });
    expect(() =>
      refreshEffect(db, { campaignId: CAMPAIGN, effectId: 'fx-bless', ...CTX }),
    ).toThrow(/creates a new effect/);
  });
});

// ---------------------------------------------------------------------------
// Suppression transitions
// ---------------------------------------------------------------------------

describe('suppression', () => {
  it('walks active -> suppressed -> active and rejects illegal transitions', () => {
    const { db, pcId } = setup();
    castBless(db, pcId);
    const suppressed = suppressEffect(db, {
      campaignId: CAMPAIGN,
      effectId: 'fx-bless',
      note: 'antimagic field',
      ...CTX,
    });
    expect(suppressed.status).toBe('suppressed');
    expect(() =>
      suppressEffect(db, {
        campaignId: CAMPAIGN,
        effectId: 'fx-bless',
        ...CTX,
      }),
    ).toThrow(/only an active effect/);
    // A suppressed concentration effect still holds the slot: a new
    // concentration cast replaces it.
    const replacing = castBless(db, pcId, 'fx-bless-2');
    expect(replacing.replaced?.effectId).toBe('fx-bless');
    expect(() =>
      unsuppressEffect(db, {
        campaignId: CAMPAIGN,
        effectId: 'fx-bless',
        ...CTX,
      }),
    ).toThrow(/only a suppressed effect/);
    expect(() =>
      unsuppressEffect(db, {
        campaignId: CAMPAIGN,
        effectId: 'fx-bless-2',
        ...CTX,
      }),
    ).toThrow(/only a suppressed effect/);
  });
});

// ---------------------------------------------------------------------------
// Replay determinism
// ---------------------------------------------------------------------------

describe('replay determinism', () => {
  function runScript(db: Db, pcId: string) {
    castBless(db, pcId);
    resolveConcentrationCheck(db, {
      campaignId: CAMPAIGN,
      owner: pc(pcId),
      damage: 22,
      vs: 11,
      outcome: 'success',
      rollRef: 'turn-3:resolve_check',
      ...CTX,
    });
    castBless(db, pcId, 'fx-bless-2');
    endActiveEffect(db, {
      campaignId: CAMPAIGN,
      effectId: 'fx-bless-2',
      reason: 'concentration-broken',
      detail: 'voluntary',
      ...CTX,
    });
  }

  function dumpEffectTables(db: Db) {
    return {
      effects: db
        .prepare('SELECT * FROM active_effect ORDER BY effect_id')
        .all(),
      targets: db
        .prepare(
          'SELECT * FROM active_effect_target ORDER BY effect_id, target_kind, target_ref',
        )
        .all(),
      links: db
        .prepare(
          'SELECT * FROM active_effect_link ORDER BY effect_id, link_kind, projection_ref',
        )
        .all(),
      events: db
        .prepare('SELECT * FROM active_effect_event ORDER BY effect_id, seq')
        .all(),
    };
  }

  it('the same operation sequence reproduces identical durable rows', () => {
    const runA = setup();
    const runB = setup();
    runScript(runA.db, runA.pcId);
    runScript(runB.db, runB.pcId);
    expect(dumpEffectTables(runA.db)).toEqual(dumpEffectTables(runB.db));
  });
});

// ---------------------------------------------------------------------------
// Load-time validation & integrity audit
// ---------------------------------------------------------------------------

describe('durable-state validation', () => {
  it('fails closed on an ended effect that still owns active projections', () => {
    const { db, pcId } = setup();
    castBless(db, pcId);
    // Corrupt the row directly (bypassing the lifecycle): end without cleanup.
    db.prepare(
      `UPDATE active_effect
       SET status = 'ended', end_reason = 'ruled', ended_at = ?
       WHERE effect_id = 'fx-bless'`,
    ).run(NOW);
    expect(() =>
      listActiveEffects(db, CAMPAIGN, { includeEnded: true }),
    ).toThrow(/cleanup did not complete/);
    const issues = auditActiveEffectIntegrity(db, CAMPAIGN);
    expect(issues).toHaveLength(1);
    expect(issues[0]?.issue).toMatch(/cleanup did not complete/);
  });

  it('reports dangling participant references without throwing', () => {
    const { db } = setupCombat();
    createActiveEffect(db, {
      campaignId: CAMPAIGN,
      effectId: 'fx-dangling',
      kind: 'summoning',
      displayName: 'Dangling',
      source: { kind: 'ruling' },
      duration: { kind: 'until-removed' },
      actors: [{ combatantId: GOBLIN_1 }],
      ...CTX,
    });
    db.prepare('DELETE FROM encounter_combatant WHERE combatant_id = ?').run(
      GOBLIN_1,
    );
    const issues = auditActiveEffectIntegrity(db, CAMPAIGN);
    expect(issues).toContainEqual({
      effectId: 'fx-dangling',
      issue: expect.stringMatching(/missing combatant/) as unknown as string,
    });
    // The strict read boundary still works — dangling refs are auditable,
    // not structurally corrupt.
    expect(listActiveEffects(db, CAMPAIGN)).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// update_combatant tool wiring (combatant damage -> check prompt / break)
// ---------------------------------------------------------------------------

describe('update_combatant concentration wiring', () => {
  function toolCtx(db: Db) {
    return {
      db,
      rng: createSeededRng(7),
      campaignId: CAMPAIGN,
      sessionId: DEFAULT_TEST_SESSION_ID,
      turnId: 'turn-1',
      at: NOW,
    };
  }

  it('prompts the save on damage and breaks concentration when the combatant drops', () => {
    const { db } = setupCombat();
    createActiveEffect(db, {
      campaignId: CAMPAIGN,
      effectId: 'fx-goblin-conc',
      kind: 'spell-effect',
      displayName: 'Goblin Focus',
      source: { kind: 'ruling' },
      concentration: { owner: { kind: 'combatant', ref: GOBLIN_1 } },
      duration: { kind: 'until-removed' },
      ...CTX,
    });
    const registry = createDefaultToolRegistry();
    const ctx = toolCtx(db);

    const damaged = registry.invoke(
      'update_combatant',
      { combatantId: GOBLIN_1, hpDelta: -3 },
      ctx,
    );
    expect(damaged).toMatchObject({
      ok: true,
      data: {
        concentration: {
          checkRequired: { effectId: 'fx-goblin-conc', dc: 10, damage: 3 },
        },
      },
    });

    const downed = registry.invoke(
      'update_combatant',
      { combatantId: GOBLIN_1, hpDelta: -100 },
      ctx,
    );
    expect(downed).toMatchObject({
      ok: true,
      data: {
        concentration: {
          broken: { broken: true, effectId: 'fx-goblin-conc' },
        },
      },
    });
    expect(
      getConcentrationEffect(db, CAMPAIGN, {
        kind: 'combatant',
        ref: GOBLIN_1,
      }),
    ).toBeUndefined();

    // A further update of the downed combatant reports nothing to break.
    const again = registry.invoke(
      'update_combatant',
      { combatantId: GOBLIN_1, hpDelta: -1 },
      ctx,
    );
    expect(again.ok).toBe(true);
    if (again.ok) {
      expect(
        (again.data as { concentration?: unknown }).concentration,
      ).toBeUndefined();
    }
  });
});
