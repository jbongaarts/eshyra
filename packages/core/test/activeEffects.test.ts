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
  addCondition,
  adjustHp,
  auditActiveEffectIntegrity,
  beginTurn,
  breakCombatantConcentration,
  closeCombatInstance,
  concentrationSaveDc,
  conditionImpliesIncapacitated,
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
  stabilizeCharacter,
  startAdventureRun,
  startEncounter,
  suppressEffect,
  unsuppressEffect,
  updateCombatant,
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

/** Well-formed 1d20 save evidence for a given kept die and modifier. */
function saveEvidence(vs: number, natural: number, modifierTotal: number) {
  return {
    vs,
    dice: '1d20',
    rolls: [natural],
    natural,
    modifierTotal,
    total: natural + modifierTotal,
  };
}

describe('resolveConcentrationCheck', () => {
  it('computes the SRD DC', () => {
    expect(concentrationSaveDc(1)).toBe(10);
    expect(concentrationSaveDc(20)).toBe(10);
    expect(concentrationSaveDc(22)).toBe(11);
    expect(concentrationSaveDc(57)).toBe(28);
  });

  it('derives success from the validated evidence and maintains the effect', () => {
    const { db, pcId } = setup();
    castBless(db, pcId);
    const result = resolveConcentrationCheck(db, {
      campaignId: CAMPAIGN,
      owner: pc(pcId),
      damage: 22,
      save: saveEvidence(11, 15, 3),
      ...CTX,
    });
    expect(result).toMatchObject({
      effectId: 'fx-bless',
      dc: 11,
      outcome: 'success',
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
      dice: '1d20',
      rolls: [15],
      natural: 15,
      modifierTotal: 3,
      total: 18,
      outcome: 'success',
    });
  });

  it('derives failure from the total and ends the effect with break cleanup', () => {
    const { db, pcId } = setup();
    castBless(db, pcId);
    const result = resolveConcentrationCheck(db, {
      campaignId: CAMPAIGN,
      owner: pc(pcId),
      damage: 7,
      save: saveEvidence(10, 4, 2),
      ...CTX,
    });
    expect(result.outcome).toBe('failure');
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

  it('honors advantage/disadvantage kept-die selection rules', () => {
    const { db, pcId } = setup();
    castBless(db, pcId);
    const result = resolveConcentrationCheck(db, {
      campaignId: CAMPAIGN,
      owner: pc(pcId),
      damage: 22,
      save: {
        vs: 11,
        dice: '2d20kh1',
        rolls: [6, 14],
        natural: 14,
        modifierTotal: 0,
        total: 14,
      },
      ...CTX,
    });
    expect(result.outcome).toBe('success');
  });

  it('rejects malformed or inconsistent evidence before any mutation', () => {
    const { db, pcId } = setup();
    castBless(db, pcId);
    // Wrong DC for 22 damage.
    expect(() =>
      resolveConcentrationCheck(db, {
        campaignId: CAMPAIGN,
        owner: pc(pcId),
        damage: 22,
        save: saveEvidence(10, 4, 0),
        ...CTX,
      }),
    ).toThrow(/requires DC 11/);
    // Non-positive damage.
    expect(() =>
      resolveConcentrationCheck(db, {
        campaignId: CAMPAIGN,
        owner: pc(pcId),
        damage: 0,
        save: saveEvidence(10, 4, 0),
        ...CTX,
      }),
    ).toThrow(/positive integer/);
    // Arithmetic that does not add up.
    expect(() =>
      resolveConcentrationCheck(db, {
        campaignId: CAMPAIGN,
        owner: pc(pcId),
        damage: 22,
        save: { ...saveEvidence(11, 4, 0), total: 19 },
        ...CTX,
      }),
    ).toThrow(/does not equal natural/);
    // A kept die that is not the advantage maximum.
    expect(() =>
      resolveConcentrationCheck(db, {
        campaignId: CAMPAIGN,
        owner: pc(pcId),
        damage: 22,
        save: {
          vs: 11,
          dice: '2d20kh1',
          rolls: [6, 14],
          natural: 6,
          modifierTotal: 0,
          total: 6,
        },
        ...CTX,
      }),
    ).toThrow(/does not match the 2d20kh1 kept die/);
    // An unrecognized dice form.
    expect(() =>
      resolveConcentrationCheck(db, {
        campaignId: CAMPAIGN,
        owner: pc(pcId),
        damage: 22,
        save: { ...saveEvidence(11, 4, 0), dice: '3d20' },
        ...CTX,
      }),
    ).toThrow(/save dice must be one of/);
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
        save: saveEvidence(10, 4, 0),
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

  it('combat closure detaches combatant refs while character effects survive', () => {
    const { db, pcId, combatInstanceId } = setupCombat();
    // Character-owned concentration with a combatant target + projection.
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
      targets: [{ kind: 'combatant', ref: GOBLIN_1 }],
      conditions: [
        {
          target: { kind: 'combatant', ref: GOBLIN_1 },
          condition: { id: 'paralyzed:fx-hold' },
        },
      ],
      ...CTX,
    });
    // Combatant-owned concentration.
    createActiveEffect(db, {
      campaignId: CAMPAIGN,
      effectId: 'fx-goblin-conc',
      kind: 'spell-effect',
      displayName: 'Goblin Focus',
      source: { kind: 'ruling' },
      concentration: { owner: { kind: 'combatant', ref: GOBLIN_2 } },
      duration: { kind: 'until-removed' },
      ...CTX,
    });
    // Character-owned summon whose actor is an instance combatant.
    createActiveEffect(db, {
      campaignId: CAMPAIGN,
      effectId: 'fx-summon',
      kind: 'summoning',
      displayName: 'Summon',
      source: { kind: 'ruling', actor: pc(pcId) },
      duration: { kind: 'until-removed' },
      actors: [{ combatantId: GOBLIN_2 }],
      ...CTX,
    });

    closeCombatInstance(db, {
      campaignId: CAMPAIGN,
      combatInstanceId,
      status: 'completed',
      ...CTX,
    });

    // Combatant-owned concentration broke with 'owner-removed'.
    const goblinConc = listActiveEffects(db, CAMPAIGN, {
      includeEnded: true,
    }).find((effect) => effect.effectId === 'fx-goblin-conc');
    expect(goblinConc).toMatchObject({
      status: 'ended',
      endReason: 'concentration-broken',
      endDetail: 'owner-removed',
    });
    // Hold Person survives (character-owned), but its combatant target was
    // removed with reason 'combat-ended' and the paralysis cleaned while the
    // combatant was still mutable.
    const hold = listActiveEffects(db, CAMPAIGN).find(
      (effect) => effect.effectId === 'fx-hold',
    );
    expect(hold?.status).toBe('active');
    expect(hold?.targets[0]).toMatchObject({
      status: 'removed',
      removedReason: 'combat-ended',
    });
    expect(hold?.links[0]?.status).toBe('removed');
    expect(
      (
        JSON.parse(combatantState(db, GOBLIN_1).conditions_json) as {
          id: string;
        }[]
      ).map((c) => c.id),
    ).toEqual([]);
    // The summon survives with its actor link RELEASED (ownership can no
    // longer be exercised), recorded in a combat-closed audit event.
    const summon = listActiveEffects(db, CAMPAIGN).find(
      (effect) => effect.effectId === 'fx-summon',
    );
    expect(summon?.links[0]).toMatchObject({
      status: 'released',
      removedReason: 'combat-ended',
    });
    expect(listEffectEvents(db, CAMPAIGN, 'fx-summon').at(-1)).toMatchObject({
      eventKind: 'combat-closed',
    });
    // No live effect state points at the closed instance: audit is clean.
    expect(auditActiveEffectIntegrity(db, CAMPAIGN)).toEqual([]);
    // And a closed-instance combatant cannot be referenced by new effects.
    expect(() =>
      createActiveEffect(db, {
        campaignId: CAMPAIGN,
        effectId: 'fx-late-target',
        kind: 'condition-package',
        displayName: 'Too Late',
        source: { kind: 'ruling' },
        duration: { kind: 'until-removed' },
        targets: [{ kind: 'combatant', ref: GOBLIN_1 }],
        ...CTX,
      }),
    ).toThrow(/combat instance is completed/);
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
      save: saveEvidence(11, 15, 3),
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
    expect(issues).toHaveLength(2);
    expect(issues.map((entry) => entry.issue).join('\n')).toMatch(
      /cleanup did not complete/,
    );
    // The corrupt row also lacks the terminal 'ended' ledger event.
    expect(issues.map((entry) => entry.issue).join('\n')).toMatch(
      /expected 1 terminal 'ended' event/,
    );
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
          broken: { effectId: 'fx-goblin-conc', cause: 'dead' },
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

// ---------------------------------------------------------------------------
// Combatant incapacitation atomicity (review blocker: PR #437)
// ---------------------------------------------------------------------------

describe('updateCombatant concentration atomicity', () => {
  it('rolls back the HP/status write when the concentration cleanup fails', () => {
    const { db } = setupCombat();
    createActiveEffect(db, {
      campaignId: CAMPAIGN,
      effectId: 'fx-goblin-conc',
      kind: 'spell-effect',
      displayName: 'Goblin Focus',
      source: { kind: 'ruling' },
      concentration: { owner: { kind: 'combatant', ref: GOBLIN_1 } },
      duration: { kind: 'until-removed' },
      conditions: [
        {
          target: { kind: 'combatant', ref: GOBLIN_2 },
          condition: { id: 'focused:fx-goblin-conc' },
        },
      ],
      ...CTX,
    });
    const before = {
      goblin1: combatantState(db, GOBLIN_1),
      goblin2: combatantState(db, GOBLIN_2),
      hp: db
        .prepare(
          `SELECT hp_current FROM encounter_combatant
           WHERE campaign_id = ? AND combatant_id = ?`,
        )
        .get(CAMPAIGN, GOBLIN_1) as { hp_current: number },
      events: listEffectEvents(db, CAMPAIGN, 'fx-goblin-conc').length,
    };
    // Inject a failure into the terminal effect transition so the break
    // cleanup fails after the combatant write and condition removal.
    db.exec(
      `CREATE TRIGGER inject_cleanup_failure BEFORE UPDATE ON active_effect
       WHEN NEW.status = 'ended'
       BEGIN SELECT RAISE(ABORT, 'injected cleanup failure'); END;`,
    );

    expect(() =>
      updateCombatant(db, {
        campaignId: CAMPAIGN,
        combatantId: GOBLIN_1,
        hpDelta: -100,
        ...CTX,
      }),
    ).toThrow(/injected cleanup failure/);

    // Everything rolled back together: HP, status, the projected condition
    // on the other goblin, the effect row, and the audit ledger.
    db.exec('DROP TRIGGER inject_cleanup_failure;');
    const after = {
      goblin1: combatantState(db, GOBLIN_1),
      goblin2: combatantState(db, GOBLIN_2),
      hp: db
        .prepare(
          `SELECT hp_current FROM encounter_combatant
           WHERE campaign_id = ? AND combatant_id = ?`,
        )
        .get(CAMPAIGN, GOBLIN_1) as { hp_current: number },
      events: listEffectEvents(db, CAMPAIGN, 'fx-goblin-conc').length,
    };
    expect(after).toEqual(before);
    expect(after.hp.hp_current).toBeGreaterThan(0);
    expect(after.goblin1.status).toBe('alive');
    expect(
      getConcentrationEffect(db, CAMPAIGN, { kind: 'combatant', ref: GOBLIN_1 })
        ?.effectId,
    ).toBe('fx-goblin-conc');
  });

  it('reports the atomic break on the domain result itself', () => {
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
    const result = updateCombatant(db, {
      campaignId: CAMPAIGN,
      combatantId: GOBLIN_1,
      hpDelta: -100,
      ...CTX,
    });
    expect(result.concentrationBroken).toEqual({
      effectId: 'fx-goblin-conc',
      displayName: 'Goblin Focus',
      cause: 'dead',
    });
    // An explicit unconscious status also downs (and would break) — but an
    // already-down combatant triggers nothing further.
    const again = updateCombatant(db, {
      campaignId: CAMPAIGN,
      combatantId: GOBLIN_1,
      status: 'unconscious',
      ...CTX,
    });
    expect(again.concentrationBroken).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Anchor semantic validation (review blocker: PR #437)
// ---------------------------------------------------------------------------

describe('anchor semantics', () => {
  it("refuses 'spell-cast' anchors on non-spell sources", () => {
    const { db } = setup();
    expect(() =>
      createActiveEffect(db, {
        campaignId: CAMPAIGN,
        effectId: 'fx-anchor-1',
        kind: 'condition-package',
        displayName: 'Mislabeled',
        source: { kind: 'ruling' },
        duration: {
          kind: 'timed',
          amount: 1,
          unit: 'hour',
          anchor: 'spell-cast',
        },
        ...CTX,
      }),
    ).toThrow(/requires a spell source/);
  });

  it('refuses the schema-reserved anchors until eshyra-2n1t.5.1 lands', () => {
    const { db } = setup();
    for (const anchor of [
      'trigger-occurred',
      'source-turn-start',
      'target-turn-start',
    ] as const) {
      expect(() =>
        createActiveEffect(db, {
          campaignId: CAMPAIGN,
          effectId: `fx-anchor-${anchor}`,
          kind: 'condition-package',
          displayName: 'Reserved Anchor',
          source: { kind: 'ruling' },
          duration: { kind: 'timed', amount: 1, unit: 'hour', anchor },
          ...CTX,
        }),
      ).toThrow(/schema-reserved|eshyra-2n1t\.5\.1/);
    }
    expect(listActiveEffects(db, CAMPAIGN)).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Concentration owner capability (re-review blocker: PR #437)
// ---------------------------------------------------------------------------

describe('concentration owner capability', () => {
  function tryConcentrate(db: Db, pcId: string, effectId = 'fx-late') {
    return () =>
      createActiveEffect(db, {
        campaignId: CAMPAIGN,
        effectId,
        kind: 'spell-effect',
        displayName: 'Late Bless',
        source: { kind: 'ruling' },
        concentration: { owner: pc(pcId) },
        duration: { kind: 'until-removed' },
        conditions: [
          { target: pc(pcId), condition: { id: `late:${effectId}` } },
        ],
        ...CTX,
      });
  }

  it('refuses a dying, stable, or dead character owner', () => {
    for (const [lifeState, prepare] of [
      ['dying', (db: Db) => adjustHp(db, -20, CTX)],
      [
        'stable',
        (db: Db) => {
          adjustHp(db, -20, CTX);
          stabilizeCharacter(db, CTX);
        },
      ],
      ['dead', (db: Db) => adjustHp(db, -40, CTX)],
    ] as const) {
      const { db, pcId } = setup();
      prepare(db);
      expect(tryConcentrate(db, pcId)).toThrow(
        new RegExp(`is ${lifeState} and cannot concentrate`),
      );
      // Nothing was written: no effect row, no ledger, no projection.
      expect(listActiveEffects(db, CAMPAIGN)).toHaveLength(0);
      expect(listEffectEvents(db, CAMPAIGN, 'fx-late')).toHaveLength(0);
      expect(characterConditionIds(db, pcId)).toEqual([]);
    }
  });

  it('refuses a 0-HP, unconscious, or dead combatant owner', () => {
    for (const down of [
      { hpDelta: -100 }, // hp 0 -> status dead
      { status: 'unconscious' as const },
      { status: 'dead' as const },
    ]) {
      const { db } = setupCombat();
      updateCombatant(db, {
        campaignId: CAMPAIGN,
        combatantId: GOBLIN_1,
        ...down,
        ...CTX,
      });
      expect(() =>
        createActiveEffect(db, {
          campaignId: CAMPAIGN,
          effectId: 'fx-goblin-late',
          kind: 'spell-effect',
          displayName: 'Late Focus',
          source: { kind: 'ruling' },
          concentration: { owner: { kind: 'combatant', ref: GOBLIN_1 } },
          duration: { kind: 'until-removed' },
          ...CTX,
        }),
      ).toThrow(/is (0 HP|dead|unconscious|inactive) and cannot concentrate/);
      expect(listActiveEffects(db, CAMPAIGN)).toHaveLength(0);
    }
  });

  it('a refusal never replaces prior concentration or touches its state', () => {
    const { db, pcId } = setup();
    castBless(db, pcId);
    // Going down breaks Bless via the F6 hook; capture its ended state.
    adjustHp(db, -20, CTX);
    const endedBless = listActiveEffects(db, CAMPAIGN, {
      includeEnded: true,
    }).find((effect) => effect.effectId === 'fx-bless');
    const blessEvents = listEffectEvents(db, CAMPAIGN, 'fx-bless').length;

    expect(tryConcentrate(db, pcId)).toThrow(/cannot concentrate/);

    expect(
      listActiveEffects(db, CAMPAIGN, { includeEnded: true }).find(
        (effect) => effect.effectId === 'fx-bless',
      ),
    ).toEqual(endedBless);
    expect(listEffectEvents(db, CAMPAIGN, 'fx-bless')).toHaveLength(
      blessEvents,
    );
  });

  it('a living character and an active combatant still succeed', () => {
    const { db, pcId } = setupCombat();
    expect(tryConcentrate(db, pcId, 'fx-ok-pc')).not.toThrow();
    createActiveEffect(db, {
      campaignId: CAMPAIGN,
      effectId: 'fx-ok-goblin',
      kind: 'spell-effect',
      displayName: 'Goblin Focus',
      source: { kind: 'ruling' },
      concentration: { owner: { kind: 'combatant', ref: GOBLIN_1 } },
      duration: { kind: 'until-removed' },
      ...CTX,
    });
    expect(
      listActiveEffects(db, CAMPAIGN)
        .map((effect) => effect.effectId)
        .sort(),
    ).toEqual(['fx-ok-goblin', 'fx-ok-pc']);
  });
});

// ---------------------------------------------------------------------------
// Condition-based incapacitation (re-review blocker: PR #437)
// ---------------------------------------------------------------------------

describe('condition-implied incapacitation', () => {
  it('grounds the implication in structured condition records', () => {
    const { db } = setup();
    expect(conditionImpliesIncapacitated(db, 'incapacitated')).toBe(true);
    for (const id of ['paralyzed', 'stunned', 'petrified', 'unconscious']) {
      expect(conditionImpliesIncapacitated(db, id), id).toBe(true);
    }
    // Namespaced effect-projected ids resolve by their base condition name.
    expect(conditionImpliesIncapacitated(db, 'paralyzed:fx-hold')).toBe(true);
    for (const id of ['poisoned', 'prone', 'frightened', 'made-up-tag']) {
      expect(conditionImpliesIncapacitated(db, id), id).toBe(false);
    }
  });

  it('addCondition breaks a concentrating character atomically, per condition semantics', () => {
    for (const conditionId of ['incapacitated', 'paralyzed', 'stunned']) {
      const { db, pcId } = setup();
      castBless(db, pcId);
      const result = addCondition(
        db,
        { id: conditionId },
        {
          ...CTX,
          characterId: pcId,
        },
      );
      expect(result.added).toBe(true);
      expect(result.concentrationBroken).toEqual({
        effectId: 'fx-bless',
        displayName: 'Bless',
        cause: 'incapacitated',
      });
      // The break's cleanup removed Bless's owned projection; the new
      // condition itself is preserved (returned snapshot is post-cleanup).
      expect(result.conditions.map((c) => c.id)).toEqual([conditionId]);
      expect(characterConditionIds(db, pcId)).toEqual([conditionId]);
      const ended = listEffectEvents(db, CAMPAIGN, 'fx-bless').at(-1);
      expect(ended?.detail).toMatchObject({
        reason: 'concentration-broken',
        detail: 'incapacitated',
      });
    }
  });

  it('a non-incapacitating condition never breaks concentration', () => {
    const { db, pcId } = setup();
    castBless(db, pcId);
    const result = addCondition(
      db,
      { id: 'poisoned' },
      {
        ...CTX,
        characterId: pcId,
      },
    );
    expect(result.concentrationBroken).toBeUndefined();
    expect(getConcentrationEffect(db, CAMPAIGN, pc(pcId))?.effectId).toBe(
      'fx-bless',
    );
  });

  it('is transition-gated: duplicates and already-incapacitated adds are inert', () => {
    const { db, pcId } = setup();
    castBless(db, pcId);
    addCondition(db, { id: 'paralyzed' }, { ...CTX, characterId: pcId });
    // Duplicate application no-ops entirely.
    const duplicate = addCondition(
      db,
      { id: 'paralyzed' },
      {
        ...CTX,
        characterId: pcId,
      },
    );
    expect(duplicate.added).toBe(false);
    expect(duplicate.concentrationBroken).toBeUndefined();
    // A second incapacitating condition on an already-incapacitated
    // character triggers nothing further (and there is nothing to break).
    const second = addCondition(
      db,
      { id: 'stunned' },
      {
        ...CTX,
        characterId: pcId,
      },
    );
    expect(second.added).toBe(true);
    expect(second.concentrationBroken).toBeUndefined();
    expect(
      listEffectEvents(db, CAMPAIGN, 'fx-bless').filter(
        (event) => event.eventKind === 'ended',
      ),
    ).toHaveLength(1);
  });

  it('updateCombatant addCondition breaks a concentrating combatant', () => {
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
    // Poisoned does not break; stunned does — structured semantics, not ids.
    const poisoned = updateCombatant(db, {
      campaignId: CAMPAIGN,
      combatantId: GOBLIN_1,
      addCondition: { id: 'poisoned' },
      ...CTX,
    });
    expect(poisoned.concentrationBroken).toBeUndefined();
    const stunned = updateCombatant(db, {
      campaignId: CAMPAIGN,
      combatantId: GOBLIN_1,
      addCondition: { id: 'stunned' },
      ...CTX,
    });
    expect(stunned.concentrationBroken).toEqual({
      effectId: 'fx-goblin-conc',
      displayName: 'Goblin Focus',
      cause: 'incapacitated',
    });
    // Unrelated conditions survive the break's cleanup.
    expect(
      (
        JSON.parse(combatantState(db, GOBLIN_1).conditions_json) as {
          id: string;
        }[]
      ).map((c) => c.id),
    ).toEqual(['poisoned', 'stunned']);
  });

  it('an effect-projected incapacitating condition breaks the target’s own concentration', () => {
    const { db, pcId } = setup();
    castBless(db, pcId); // pc concentrates on fx-bless
    // A hazard projects paralysis onto the concentrating character.
    createActiveEffect(db, {
      campaignId: CAMPAIGN,
      effectId: 'fx-trap',
      kind: 'condition-package',
      displayName: 'Paralytic Trap',
      source: { kind: 'hazard' },
      duration: {
        kind: 'timed',
        amount: 1,
        unit: 'minute',
        anchor: 'effect-created',
      },
      targets: [{ kind: 'character', ref: pcId }],
      conditions: [
        { target: pc(pcId), condition: { id: 'paralyzed:fx-trap' } },
      ],
      ...CTX,
    });
    // Bless ended via the projection's incapacitation, with its own
    // projection cleaned up; the trap effect still owns its projection.
    const bless = listActiveEffects(db, CAMPAIGN, { includeEnded: true }).find(
      (effect) => effect.effectId === 'fx-bless',
    );
    expect(bless).toMatchObject({
      status: 'ended',
      endReason: 'concentration-broken',
      endDetail: 'incapacitated',
    });
    expect(characterConditionIds(db, pcId)).toEqual(['paralyzed:fx-trap']);
    const trap = listActiveEffects(db, CAMPAIGN).find(
      (effect) => effect.effectId === 'fx-trap',
    );
    expect(trap?.status).toBe('active');
    expect(trap?.links[0]?.status).toBe('active');
  });

  it('rolls back the condition write when the concentration cleanup fails', () => {
    const { db, pcId } = setup();
    castBless(db, pcId);
    db.exec(
      `CREATE TRIGGER inject_cleanup_failure BEFORE UPDATE ON active_effect
       WHEN NEW.status = 'ended'
       BEGIN SELECT RAISE(ABORT, 'injected cleanup failure'); END;`,
    );
    expect(() =>
      addCondition(db, { id: 'paralyzed' }, { ...CTX, characterId: pcId }),
    ).toThrow(/injected cleanup failure/);
    db.exec('DROP TRIGGER inject_cleanup_failure;');
    // The condition write rolled back with the failed break: no paralyzed
    // entry, Bless still live with its projection, ledger unchanged.
    expect(characterConditionIds(db, pcId)).toEqual(['blessed:fx-bless']);
    expect(getConcentrationEffect(db, CAMPAIGN, pc(pcId))?.effectId).toBe(
      'fx-bless',
    );
    expect(listEffectEvents(db, CAMPAIGN, 'fx-bless')).toHaveLength(1);
  });

  it('the creation gate refuses owners already carrying an incapacitating condition', () => {
    const { db, pcId } = setup();
    addCondition(db, { id: 'paralyzed' }, { ...CTX, characterId: pcId });
    expect(() => castBless(db, pcId)).toThrow(
      /incapacitating condition 'paralyzed'/,
    );
    expect(listActiveEffects(db, CAMPAIGN)).toHaveLength(0);

    const combat = setupCombat();
    updateCombatant(combat.db, {
      campaignId: CAMPAIGN,
      combatantId: GOBLIN_1,
      addCondition: { id: 'stunned' },
      ...CTX,
    });
    expect(() =>
      createActiveEffect(combat.db, {
        campaignId: CAMPAIGN,
        effectId: 'fx-goblin-late',
        kind: 'spell-effect',
        displayName: 'Late Focus',
        source: { kind: 'ruling' },
        concentration: { owner: { kind: 'combatant', ref: GOBLIN_1 } },
        duration: { kind: 'until-removed' },
        ...CTX,
      }),
    ).toThrow(/incapacitating condition 'stunned'/);
  });
});

// ---------------------------------------------------------------------------
// Owner-state × concentration matrix (F3 mutation audit §9)
// ---------------------------------------------------------------------------

/** Post-operation invariant helper: the full integrity audit must be empty. */
function expectCleanAudit(db: Db) {
  expect(auditActiveEffectIntegrity(db, CAMPAIGN)).toEqual([]);
}

describe('owner-state matrix', () => {
  const characterCases: readonly {
    state: string;
    prepare: (db: Db, pcId: string) => void;
    ok: boolean;
    error?: RegExp;
  }[] = [
    { state: 'alive', prepare: () => {}, ok: true },
    {
      state: 'dying',
      prepare: (db) => adjustHp(db, -20, CTX),
      ok: false,
      error: /is dying and cannot concentrate/,
    },
    {
      state: 'stable',
      prepare: (db) => {
        adjustHp(db, -20, CTX);
        stabilizeCharacter(db, CTX);
      },
      ok: false,
      error: /is stable and cannot concentrate/,
    },
    {
      state: 'dead',
      prepare: (db) => adjustHp(db, -40, CTX),
      ok: false,
      error: /is dead and cannot concentrate/,
    },
    {
      state: 'directly incapacitated',
      prepare: (db, pcId) =>
        void addCondition(
          db,
          { id: 'incapacitated' },
          {
            ...CTX,
            characterId: pcId,
          },
        ),
      ok: false,
      error: /incapacitating condition 'incapacitated'/,
    },
    {
      state: 'incapacitated via implied condition',
      prepare: (db, pcId) =>
        void addCondition(
          db,
          { id: 'petrified' },
          {
            ...CTX,
            characterId: pcId,
          },
        ),
      ok: false,
      error: /incapacitating condition 'petrified'/,
    },
  ];

  for (const c of characterCases) {
    it(`character owner: ${c.state} -> ${c.ok ? 'succeeds' : 'refused'}`, () => {
      const { db, pcId } = setup();
      c.prepare(db, pcId);
      const attempt = () =>
        createActiveEffect(db, {
          campaignId: CAMPAIGN,
          effectId: 'fx-matrix',
          kind: 'spell-effect',
          displayName: 'Matrix',
          source: { kind: 'ruling' },
          concentration: { owner: pc(pcId) },
          duration: { kind: 'until-removed' },
          ...CTX,
        });
      if (c.ok) {
        attempt();
        expect(getConcentrationEffect(db, CAMPAIGN, pc(pcId))?.effectId).toBe(
          'fx-matrix',
        );
      } else {
        expect(attempt).toThrow(c.error);
        expect(listActiveEffects(db, CAMPAIGN)).toHaveLength(0);
      }
      expectCleanAudit(db);
    });
  }

  const combatantCases: readonly {
    state: string;
    prepare: (db: Db, instanceId: string) => void;
    ok: boolean;
    error?: RegExp;
  }[] = [
    { state: 'alive/active', prepare: () => {}, ok: true },
    {
      // Documented policy (audit §7): escaped = alive and capable elsewhere.
      state: 'escaped',
      prepare: (db) =>
        void updateCombatant(db, {
          campaignId: CAMPAIGN,
          combatantId: GOBLIN_1,
          status: 'escaped',
          ...CTX,
        }),
      ok: true,
    },
    {
      state: 'zero HP',
      prepare: (db) =>
        void updateCombatant(db, {
          campaignId: CAMPAIGN,
          combatantId: GOBLIN_1,
          hpDelta: -100,
          ...CTX,
        }),
      ok: false,
      error: /is dead and cannot concentrate/,
    },
    {
      state: 'unconscious',
      prepare: (db) =>
        void updateCombatant(db, {
          campaignId: CAMPAIGN,
          combatantId: GOBLIN_1,
          status: 'unconscious',
          ...CTX,
        }),
      ok: false,
      error: /is unconscious and cannot concentrate/,
    },
    {
      state: 'inactive',
      prepare: (db) =>
        void updateCombatant(db, {
          campaignId: CAMPAIGN,
          combatantId: GOBLIN_1,
          status: 'inactive',
          ...CTX,
        }),
      ok: false,
      error: /is inactive and cannot concentrate/,
    },
    {
      state: 'incapacitating condition',
      prepare: (db) =>
        void updateCombatant(db, {
          campaignId: CAMPAIGN,
          combatantId: GOBLIN_1,
          addCondition: { id: 'stunned' },
          ...CTX,
        }),
      ok: false,
      error: /incapacitating condition 'stunned'/,
    },
    {
      state: 'closed combat instance',
      prepare: (db, instanceId) =>
        void closeCombatInstance(db, {
          campaignId: CAMPAIGN,
          combatInstanceId: instanceId,
          status: 'completed',
          ...CTX,
        }),
      ok: false,
      error: /combat instance is completed/,
    },
  ];

  for (const c of combatantCases) {
    it(`combatant owner: ${c.state} -> ${c.ok ? 'succeeds' : 'refused'}`, () => {
      const { db, combatInstanceId } = setupCombat();
      c.prepare(db, combatInstanceId);
      const attempt = () =>
        createActiveEffect(db, {
          campaignId: CAMPAIGN,
          effectId: 'fx-matrix',
          kind: 'spell-effect',
          displayName: 'Matrix',
          source: { kind: 'ruling' },
          concentration: { owner: { kind: 'combatant', ref: GOBLIN_1 } },
          duration: { kind: 'until-removed' },
          ...CTX,
        });
      if (c.ok) {
        attempt();
      } else {
        expect(attempt).toThrow(c.error);
        expect(listActiveEffects(db, CAMPAIGN)).toHaveLength(0);
      }
      expectCleanAudit(db);
    });
  }

  it('missing participants are refused for every role', () => {
    const { db } = setupCombat();
    for (const [role, args] of [
      [
        'concentration.owner',
        {
          concentration: { owner: { kind: 'combatant' as const, ref: 'nope' } },
        },
      ],
      ['target', { targets: [{ kind: 'combatant' as const, ref: 'nope' }] }],
      [
        'source.actor',
        {
          source: {
            kind: 'ruling' as const,
            actor: { kind: 'combatant' as const, ref: 'nope' },
          },
        },
      ],
    ] as const) {
      expect(() =>
        createActiveEffect(db, {
          campaignId: CAMPAIGN,
          effectId: `fx-missing-${role}`,
          kind: 'spell-effect',
          displayName: 'Missing',
          source: { kind: 'ruling' },
          duration: { kind: 'until-removed' },
          ...args,
          ...CTX,
        }),
      ).toThrow(/unknown combatant 'nope'/);
    }
    expectCleanAudit(db);
  });
});

// ---------------------------------------------------------------------------
// Cascade topology (F3 mutation audit §4/§9, invariant 12)
// ---------------------------------------------------------------------------

describe('cascading cleanup topology', () => {
  it('rejects a concentration effect projecting incapacitation onto its own owner at preflight', () => {
    const { db, pcId } = setup();
    expect(() =>
      createActiveEffect(db, {
        campaignId: CAMPAIGN,
        effectId: 'fx-self-stun',
        kind: 'spell-effect',
        displayName: 'Self Stun',
        source: { kind: 'ruling' },
        concentration: { owner: pc(pcId) },
        duration: { kind: 'until-removed' },
        conditions: [
          { target: pc(pcId), condition: { id: 'stunned:fx-self-stun' } },
        ],
        ...CTX,
      }),
    ).toThrow(/would break itself/);
    expect(listActiveEffects(db, CAMPAIGN)).toHaveLength(0);
    expect(characterConditionIds(db, pcId)).toEqual([]);
    expectCleanAudit(db);
  });

  it('a creation whose projection breaks a DIFFERENT concentration is supported', () => {
    const { db, pcId } = setupCombat();
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
    // The PC casts a concentration effect that stuns the concentrating goblin.
    createActiveEffect(db, {
      campaignId: CAMPAIGN,
      effectId: 'fx-stun-goblin',
      kind: 'spell-effect',
      displayName: 'Stunning Gaze',
      source: { kind: 'ruling' },
      concentration: { owner: pc(pcId) },
      duration: { kind: 'until-removed' },
      targets: [{ kind: 'combatant', ref: GOBLIN_1 }],
      conditions: [
        {
          target: { kind: 'combatant', ref: GOBLIN_1 },
          condition: { id: 'stunned:fx-stun-goblin' },
        },
      ],
      ...CTX,
    });
    // The goblin's own concentration broke mid-create; the new effect lives.
    expect(
      listActiveEffects(db, CAMPAIGN, { includeEnded: true }).find(
        (effect) => effect.effectId === 'fx-goblin-conc',
      ),
    ).toMatchObject({
      status: 'ended',
      endReason: 'concentration-broken',
      endDetail: 'incapacitated',
    });
    expect(getConcentrationEffect(db, CAMPAIGN, pc(pcId))?.effectId).toBe(
      'fx-stun-goblin',
    );
    expectCleanAudit(db);
  });

  it('ending an effect that inactivates an actor breaks that actor’s own concentration (chain)', () => {
    const { db, pcId } = setupCombat();
    // PC owns a summon over goblin 1 (remove-on-end -> inactive).
    createActiveEffect(db, {
      campaignId: CAMPAIGN,
      effectId: 'fx-summon',
      kind: 'summoning',
      displayName: 'Summon',
      source: { kind: 'ruling', actor: pc(pcId) },
      duration: { kind: 'until-removed' },
      actors: [{ combatantId: GOBLIN_1, cleanupOnEnd: 'remove' }],
      ...CTX,
    });
    // Goblin 1 itself concentrates on something.
    createActiveEffect(db, {
      campaignId: CAMPAIGN,
      effectId: 'fx-goblin-conc',
      kind: 'spell-effect',
      displayName: 'Goblin Focus',
      source: { kind: 'ruling' },
      concentration: { owner: { kind: 'combatant', ref: GOBLIN_1 } },
      duration: { kind: 'until-removed' },
      conditions: [
        {
          target: { kind: 'combatant', ref: GOBLIN_2 },
          condition: { id: 'focused:fx-goblin-conc' },
        },
      ],
      ...CTX,
    });
    // Dispel the summon: goblin 1 goes inactive, which breaks its own
    // concentration, whose projection on goblin 2 is cleaned — one chain,
    // one transaction.
    endActiveEffect(db, {
      campaignId: CAMPAIGN,
      effectId: 'fx-summon',
      reason: 'dispelled',
      ...CTX,
    });
    expect(combatantState(db, GOBLIN_1).status).toBe('inactive');
    const goblinConc = listActiveEffects(db, CAMPAIGN, {
      includeEnded: true,
    }).find((effect) => effect.effectId === 'fx-goblin-conc');
    expect(goblinConc).toMatchObject({
      status: 'ended',
      endReason: 'concentration-broken',
      endDetail: 'owner-removed',
    });
    expect(
      (
        JSON.parse(combatantState(db, GOBLIN_2).conditions_json) as {
          id: string;
        }[]
      ).map((c) => c.id),
    ).toEqual([]);
    expectCleanAudit(db);
  });

  it('a deliberate ownership cycle terminates with exactly one terminal event per effect', () => {
    const { db } = setupCombat();
    // Effect A: owned (concentration) by goblin 1, owns goblin 2 as actor.
    createActiveEffect(db, {
      campaignId: CAMPAIGN,
      effectId: 'fx-a',
      kind: 'summoning',
      displayName: 'A',
      source: { kind: 'ruling' },
      concentration: { owner: { kind: 'combatant', ref: GOBLIN_1 } },
      duration: { kind: 'until-removed' },
      actors: [
        {
          combatantId: GOBLIN_2,
          cleanupOnEnd: 'remove',
          cleanupOnBreak: 'remove',
        },
      ],
      ...CTX,
    });
    // Effect B: owned by goblin 2, owns goblin 1 as actor — the cycle.
    createActiveEffect(db, {
      campaignId: CAMPAIGN,
      effectId: 'fx-b',
      kind: 'summoning',
      displayName: 'B',
      source: { kind: 'ruling' },
      concentration: { owner: { kind: 'combatant', ref: GOBLIN_2 } },
      duration: { kind: 'until-removed' },
      actors: [
        {
          combatantId: GOBLIN_1,
          cleanupOnEnd: 'remove',
          cleanupOnBreak: 'remove',
        },
      ],
      ...CTX,
    });
    // Break A voluntarily: A ends -> goblin 2 inactive -> B breaks
    // (owner-removed) -> goblin 1 inactive -> goblin 1's concentration is A,
    // already ended -> the cycle terminates.
    endActiveEffect(db, {
      campaignId: CAMPAIGN,
      effectId: 'fx-a',
      reason: 'concentration-broken',
      detail: 'voluntary',
      ...CTX,
    });
    for (const effectId of ['fx-a', 'fx-b']) {
      const events = listEffectEvents(db, CAMPAIGN, effectId);
      expect(
        events.filter((event) => event.eventKind === 'ended'),
        effectId,
      ).toHaveLength(1);
    }
    expect(combatantState(db, GOBLIN_1).status).toBe('inactive');
    expect(combatantState(db, GOBLIN_2).status).toBe('inactive');
    expectCleanAudit(db);
  });

  it('mixed cleanup policies on one target apply per link', () => {
    const { db, pcId } = setup();
    createActiveEffect(db, {
      campaignId: CAMPAIGN,
      effectId: 'fx-mixed',
      kind: 'condition-package',
      displayName: 'Mixed',
      source: { kind: 'ruling' },
      duration: { kind: 'until-removed' },
      conditions: [
        { target: pc(pcId), condition: { id: 'cond-removed' } },
        {
          target: pc(pcId),
          condition: { id: 'cond-released' },
          cleanupOnEnd: 'release',
        },
      ],
      ...CTX,
    });
    endActiveEffect(db, {
      campaignId: CAMPAIGN,
      effectId: 'fx-mixed',
      reason: 'dispelled',
      ...CTX,
    });
    // The removed projection is gone; the released one persists, unowned.
    expect(characterConditionIds(db, pcId)).toEqual(['cond-released']);
    expectCleanAudit(db);
  });
});

// ---------------------------------------------------------------------------
// Corruption cases per audited invariant (F3 mutation audit §8)
// ---------------------------------------------------------------------------

describe('integrity audit corruption coverage', () => {
  it('reports orphan child rows', () => {
    const { db, pcId } = setup();
    castBless(db, pcId);
    db.prepare(
      `INSERT INTO active_effect_event(
         campaign_id, effect_id, seq, event_kind, detail_json, occurred_at,
         provenance, session_id)
       VALUES (?, 'fx-ghost', 1, 'created', '{}', ?, 'test', ?)`,
    ).run(CAMPAIGN, NOW, DEFAULT_TEST_SESSION_ID);
    const issues = auditActiveEffectIntegrity(db, CAMPAIGN);
    expect(issues).toContainEqual({
      effectId: 'fx-ghost',
      issue: expect.stringMatching(/orphan active_effect_event/) as never,
    });
  });

  it('reports a condition link whose claimed entry is absent', () => {
    const { db, pcId } = setup();
    castBless(db, pcId);
    // Remove the projected condition behind the lifecycle's back.
    mutateState(db, {
      target: 'character',
      field: 'conditions_json',
      op: 'set',
      value: [],
      ...CTX,
    });
    const issues = auditActiveEffectIntegrity(db, CAMPAIGN);
    expect(issues).toContainEqual({
      effectId: 'fx-bless',
      issue: expect.stringMatching(
        /claims 'blessed:fx-bless'.*no such condition entry/,
      ) as never,
    });
  });

  it('reports event-sequence gaps and spurious terminal events', () => {
    const { db, pcId } = setup();
    castBless(db, pcId);
    db.prepare(
      `INSERT INTO active_effect_event(
         campaign_id, effect_id, seq, event_kind, detail_json, occurred_at,
         provenance, session_id)
       VALUES (?, 'fx-bless', 5, 'ended', '{}', ?, 'test', ?)`,
    ).run(CAMPAIGN, NOW, DEFAULT_TEST_SESSION_ID);
    const issues = auditActiveEffectIntegrity(db, CAMPAIGN);
    expect(issues.map((entry) => entry.issue).join('\n')).toMatch(
      /seq is not contiguous/,
    );
    expect(issues.map((entry) => entry.issue).join('\n')).toMatch(
      /expected 0 terminal 'ended' event\(s\) for status 'active', found 1/,
    );
  });

  it('reports live effect state left pointing at an instance closed behind the lifecycle’s back', () => {
    const { db, combatInstanceId } = setupCombat();
    createActiveEffect(db, {
      campaignId: CAMPAIGN,
      effectId: 'fx-goblin-conc',
      kind: 'summoning',
      displayName: 'Goblin Focus',
      source: {
        kind: 'ruling',
        actor: { kind: 'combatant', ref: GOBLIN_2 },
      },
      concentration: { owner: { kind: 'combatant', ref: GOBLIN_1 } },
      duration: { kind: 'until-removed' },
      targets: [{ kind: 'combatant', ref: GOBLIN_1 }],
      actors: [{ combatantId: GOBLIN_2 }],
      ...CTX,
    });
    // Bypass closeCombatInstance (and its F3 boundary) via direct SQL.
    db.prepare(
      `UPDATE combat_instance SET status = 'completed'
       WHERE campaign_id = ? AND combat_instance_id = ?`,
    ).run(CAMPAIGN, combatInstanceId);
    const issues = auditActiveEffectIntegrity(db, CAMPAIGN)
      .map((entry) => entry.issue)
      .join('\n');
    expect(issues).toMatch(/concentration owner .* unreachable/);
    expect(issues).toMatch(/target .* unreachable/);
    expect(issues).toMatch(/actor link holder .* unreachable/);
    expect(issues).toMatch(/source actor .* unreachable/);
  });

  it('reports an unlicensed link kind', () => {
    const { db, pcId } = setup();
    castBless(db, pcId);
    // spell-effect does not license 'actor' links; forge one directly.
    db.prepare(
      `INSERT INTO active_effect_link(
         campaign_id, effect_id, link_kind, target_kind, target_ref,
         projection_ref, cleanup_on_end, cleanup_on_break, status,
         provenance, session_id, updated_at)
       VALUES (?, 'fx-bless', 'actor', 'character', ?, ?, 'remove',
               'remove', 'active', 'test', ?, ?)`,
    ).run(CAMPAIGN, pcId, pcId, DEFAULT_TEST_SESSION_ID, NOW);
    expect(
      auditActiveEffectIntegrity(db, CAMPAIGN)
        .map((entry) => entry.issue)
        .join('\n'),
    ).toMatch(/'actor' link is not licensed for kind 'spell-effect'/);
  });
});
