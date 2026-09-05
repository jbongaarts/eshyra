// F2 action-economy turn budget (eshyra-2n1t.4). Evidence for the
// ENGINE_PROCEDURE_COVERAGE rows: your-turn, bonus-actions, bonus-action,
// reactions, and other-activity-on-your-turn, plus the code-owned clauses of
// surprise (turn-1 restriction) and two-weapon-fighting (bonus-attack spend
// as an ordinary bonus-action spend). The F5 legendary-action per-round
// economy (eshyra-2n1t.7) lives on the same budget row; its evidence is the
// "legendary actions" describe block below.

import { describe, expect, it } from 'vitest';
import type {
  AdventureModule,
  ToolContext,
  TurnBudget,
} from '../src/internal.js';
import {
  ActionEconomyError,
  assembleContext,
  beginTurn,
  createActiveEffect,
  createDefaultToolRegistry,
  createSeededRng,
  formatTurnBudget,
  getActiveCharacterId,
  mutateState,
  readCombatTurnState,
  renderContextMessage,
  setReactionAllowance,
  setSurprised,
  spendTurnResource,
  startAdventureRun,
  startEncounter,
  updateCombatant,
} from '../src/internal.js';
import { makeTestAdventureModule } from './support/adventureModuleFixture.js';
import {
  DEFAULT_TEST_CAMPAIGN_ID,
  DEFAULT_TEST_CAMPAIGN_POSITION,
  DEFAULT_TEST_SESSION_ID,
  freshDbWithSession,
} from './support/db.js';

const NOW = '2026-07-10T10:00:00.000Z';
const CAMPAIGN = DEFAULT_TEST_CAMPAIGN_ID;
const CTX = {
  provenance: 'test:action-economy',
  sessionId: DEFAULT_TEST_SESSION_ID,
  at: NOW,
};

const GOBLIN_1 = 'ci-enc-goblins-1-goblin-1';
const GOBLIN_2 = 'ci-enc-goblins-1-goblin-2';

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
  const db = freshDbWithSession();
  const module = goblinModule();
  startAdventureRun(db, {
    campaignId: CAMPAIGN,
    runId: 'run-goblins',
    moduleId: module.id,
    provenance: 'test',
    sessionId: DEFAULT_TEST_SESSION_ID,
    updatedAt: NOW,
  });
  startEncounter(db, {
    campaignId: CAMPAIGN,
    encounterId: 'enc-goblins',
    resolveAdventureModule: (moduleId) =>
      moduleId === module.id ? module : undefined,
    ...CTX,
  });
  const pcId = getActiveCharacterId(db);
  return { db, module, pcId };
}

function participant(ref: string) {
  return { kind: 'combatant' as const, ref };
}

const PC = { kind: 'character' as const };

describe('beginTurn', () => {
  it('opens round 1 with a fresh budget and marks the active turn', () => {
    const { db } = setupCombat();

    const result = beginTurn(db, {
      campaignId: CAMPAIGN,
      participant: participant(GOBLIN_1),
      ...CTX,
    });

    expect(result.roundNumber).toBe(1);
    expect(result.surprisedRestricted).toBe(false);
    expect(result.budget).toMatchObject({
      participant: { kind: 'combatant', ref: GOBLIN_1 },
      displayLabel: 'Goblin 1',
      actionUsed: false,
      bonusActionUsed: false,
      reactionsUsed: 0,
      freeInteractionUsed: false,
      turnsTaken: 0,
    });

    const state = readCombatTurnState(db, CAMPAIGN);
    expect(state?.roundNumber).toBe(1);
    expect(state?.activeParticipant).toEqual({
      kind: 'combatant',
      ref: GOBLIN_1,
    });
  });

  it('defaults a character participant to the acting/active PC', () => {
    const { db, pcId } = setupCombat();

    const result = beginTurn(db, {
      campaignId: CAMPAIGN,
      participant: PC,
      ...CTX,
    });

    expect(result.budget.participant).toEqual({
      kind: 'character',
      ref: pcId,
    });
  });

  it('advances the round monotonically and rejects a decrease', () => {
    const { db } = setupCombat();
    beginTurn(db, {
      campaignId: CAMPAIGN,
      participant: participant(GOBLIN_1),
      ...CTX,
    });

    const next = beginTurn(db, {
      campaignId: CAMPAIGN,
      participant: participant(GOBLIN_2),
      round: 3,
      ...CTX,
    });
    expect(next.roundNumber).toBe(3);

    expect(() =>
      beginTurn(db, {
        campaignId: CAMPAIGN,
        participant: participant(GOBLIN_1),
        round: 2,
        ...CTX,
      }),
    ).toThrow(/round must not decrease/);
  });

  it('ends the previous turn implicitly: turns_taken increments and a new turn resets the budget', () => {
    const { db } = setupCombat();
    beginTurn(db, {
      campaignId: CAMPAIGN,
      participant: participant(GOBLIN_1),
      ...CTX,
    });
    spendTurnResource(db, {
      campaignId: CAMPAIGN,
      participant: participant(GOBLIN_1),
      resource: 'action',
      activity: 'Attack (scimitar)',
      ...CTX,
    });

    beginTurn(db, {
      campaignId: CAMPAIGN,
      participant: participant(GOBLIN_2),
      ...CTX,
    });
    const again = beginTurn(db, {
      campaignId: CAMPAIGN,
      participant: participant(GOBLIN_1),
      round: 2,
      ...CTX,
    });

    expect(again.budget.turnsTaken).toBe(1);
    expect(again.budget.actionUsed).toBe(false);
    expect(again.budget.actionActivity).toBeUndefined();
  });

  it('requires an active combat instance', () => {
    const db = freshDbWithSession();
    expect(() =>
      beginTurn(db, { campaignId: CAMPAIGN, participant: PC, ...CTX }),
    ).toThrow(/no combat instance is active/);
  });

  it('processes dead boundaries as unavailable but rejects unknown combatants', () => {
    const { db } = setupCombat();
    updateCombatant(db, {
      campaignId: CAMPAIGN,
      combatantId: GOBLIN_2,
      status: 'dead',
      ...CTX,
    });

    const result = beginTurn(db, {
      campaignId: CAMPAIGN,
      participant: participant(GOBLIN_2),
      ...CTX,
    });
    expect(result.turnAvailable).toBe(false);
    expect(result.participantUnavailableReason).toMatch(/dead/);
    expect(() =>
      beginTurn(db, {
        campaignId: CAMPAIGN,
        participant: participant('nope'),
        ...CTX,
      }),
    ).toThrow(/Valid combatant ids: .*goblin-1/);
  });

  it('processes a dead character boundary as unavailable', () => {
    const { db } = setupCombat();
    mutateState(db, {
      target: 'character',
      field: 'life_state',
      op: 'set',
      value: 'dead',
      ...CTX,
    });

    const result = beginTurn(db, {
      campaignId: CAMPAIGN,
      participant: PC,
      ...CTX,
    });
    expect(result.turnAvailable).toBe(false);
    expect(result.participantUnavailableReason).toMatch(/dead/);
  });
});

describe('spendTurnResource — per-turn slots', () => {
  function onTurn(db: ReturnType<typeof setupCombat>['db']) {
    beginTurn(db, {
      campaignId: CAMPAIGN,
      participant: participant(GOBLIN_1),
      ...CTX,
    });
  }

  it('spends the action once and rejects the double-spend naming the first activity', () => {
    const { db } = setupCombat();
    onTurn(db);

    const spend = spendTurnResource(db, {
      campaignId: CAMPAIGN,
      participant: participant(GOBLIN_1),
      resource: 'action',
      activity: 'Attack (scimitar)',
      ...CTX,
    });
    expect(spend.budget.actionUsed).toBe(true);
    expect(spend.budget.actionActivity).toBe('Attack (scimitar)');

    expect(() =>
      spendTurnResource(db, {
        campaignId: CAMPAIGN,
        participant: participant(GOBLIN_1),
        resource: 'action',
        activity: 'Dash',
        ...CTX,
      }),
    ).toThrow(/already used their action this turn \(Attack \(scimitar\)\)/);
  });

  it('enforces one bonus action and one free interaction per turn', () => {
    const { db } = setupCombat();
    onTurn(db);
    spendTurnResource(db, {
      campaignId: CAMPAIGN,
      participant: participant(GOBLIN_1),
      resource: 'bonus_action',
      activity: 'off-hand attack (two-weapon fighting)',
      ...CTX,
    });
    spendTurnResource(db, {
      campaignId: CAMPAIGN,
      participant: participant(GOBLIN_1),
      resource: 'free_interaction',
      activity: 'draw dagger',
      ...CTX,
    });

    expect(() =>
      spendTurnResource(db, {
        campaignId: CAMPAIGN,
        participant: participant(GOBLIN_1),
        resource: 'bonus_action',
        activity: 'another bonus action',
        ...CTX,
      }),
    ).toThrow(/already used their bonus action/);
    expect(() =>
      spendTurnResource(db, {
        campaignId: CAMPAIGN,
        participant: participant(GOBLIN_1),
        resource: 'free_interaction',
        activity: 'open door',
        ...CTX,
      }),
    ).toThrow(/Use an Object/);
  });

  it('accumulates movement as a note instead of a numeric budget', () => {
    const { db } = setupCombat();
    onTurn(db);
    spendTurnResource(db, {
      campaignId: CAMPAIGN,
      participant: participant(GOBLIN_1),
      resource: 'movement',
      activity: 'moved 15 ft to the doorway',
      ...CTX,
    });
    const second = spendTurnResource(db, {
      campaignId: CAMPAIGN,
      participant: participant(GOBLIN_1),
      resource: 'movement',
      activity: 'ducked behind the crates',
      ...CTX,
    });

    expect(second.budget.movementNote).toBe(
      'moved 15 ft to the doorway; ducked behind the crates',
    );
  });

  it('rejects on-turn resources off-turn but allows the reaction', () => {
    const { db } = setupCombat();
    onTurn(db); // goblin-1's turn

    expect(() =>
      spendTurnResource(db, {
        campaignId: CAMPAIGN,
        participant: participant(GOBLIN_2),
        resource: 'action',
        activity: 'Attack',
        ...CTX,
      }),
    ).toThrow(/not Goblin 2's turn; only a reaction/);

    const reaction = spendTurnResource(db, {
      campaignId: CAMPAIGN,
      participant: participant(GOBLIN_2),
      resource: 'reaction',
      activity: 'opportunity attack vs the PC',
      ...CTX,
    });
    expect(reaction.budget.reactionsUsed).toBe(1);
  });

  it('requires an activity description and an active combat instance', () => {
    const { db } = setupCombat();
    onTurn(db);
    expect(() =>
      spendTurnResource(db, {
        campaignId: CAMPAIGN,
        participant: participant(GOBLIN_1),
        resource: 'action',
        activity: '   ',
        ...CTX,
      }),
    ).toThrow(/activity must be a non-empty description/);

    const bare = freshDbWithSession();
    expect(() =>
      spendTurnResource(bare, {
        campaignId: CAMPAIGN,
        participant: PC,
        resource: 'reaction',
        activity: 'shield',
        ...CTX,
      }),
    ).toThrow(/no combat instance is active/);
  });
});

describe('spendTurnResource — reaction per round across turn boundaries', () => {
  it("keeps the reaction spent through other participants' turns and returns it at the owner's own turn start", () => {
    const { db } = setupCombat();
    beginTurn(db, {
      campaignId: CAMPAIGN,
      participant: participant(GOBLIN_1),
      ...CTX,
    });
    // Goblin 2 reacts off-turn during goblin 1's turn.
    spendTurnResource(db, {
      campaignId: CAMPAIGN,
      participant: participant(GOBLIN_2),
      resource: 'reaction',
      activity: 'opportunity attack',
      ...CTX,
    });

    expect(() =>
      spendTurnResource(db, {
        campaignId: CAMPAIGN,
        participant: participant(GOBLIN_2),
        resource: 'reaction',
        activity: 'another reaction',
        ...CTX,
      }),
    ).toThrow(/already used their reaction this round .*next turn/);

    // Goblin 1's next turn does NOT reset goblin 2's reaction…
    const g2State = readCombatTurnState(db, CAMPAIGN)?.budgets.find(
      (b) => b.participant.ref === GOBLIN_2,
    );
    expect(g2State?.reactionsUsed).toBe(1);

    // …but goblin 2's own turn start does.
    const ownTurn = beginTurn(db, {
      campaignId: CAMPAIGN,
      participant: participant(GOBLIN_2),
      ...CTX,
    });
    expect(ownTurn.budget.reactionsUsed).toBe(0);
  });
});

describe('spendTurnResource — bonus-action-spell timing', () => {
  function pcTurn(db: ReturnType<typeof setupCombat>['db']) {
    beginTurn(db, { campaignId: CAMPAIGN, participant: PC, ...CTX });
  }

  it('after a bonus-action spell, the action may only cast a cantrip', () => {
    const { db } = setupCombat();
    pcTurn(db);
    spendTurnResource(db, {
      campaignId: CAMPAIGN,
      participant: PC,
      resource: 'bonus_action',
      activity: 'cast Healing Word',
      spellRef: 'spell:healing-word',
      ...CTX,
    });

    expect(() =>
      spendTurnResource(db, {
        campaignId: CAMPAIGN,
        participant: PC,
        resource: 'action',
        activity: 'cast Cure Wounds',
        spellRef: 'spell:cure-wounds',
        ...CTX,
      }),
    ).toThrow(/only other spell allowed is a cantrip/);

    const cantrip = spendTurnResource(db, {
      campaignId: CAMPAIGN,
      participant: PC,
      resource: 'action',
      activity: 'cast Fire Bolt',
      spellRef: 'spell:fire-bolt',
      ...CTX,
    });
    expect(cantrip.budget.otherSpellCast).toBe('action-cantrip');
  });

  it('a leveled action spell blocks a later bonus-action spell; an action cantrip does not', () => {
    const { db } = setupCombat();
    pcTurn(db);
    spendTurnResource(db, {
      campaignId: CAMPAIGN,
      participant: PC,
      resource: 'action',
      activity: 'cast Burning Hands',
      spellRef: 'spell:burning-hands',
      ...CTX,
    });
    expect(() =>
      spendTurnResource(db, {
        campaignId: CAMPAIGN,
        participant: PC,
        resource: 'bonus_action',
        activity: 'cast Healing Word',
        spellRef: 'spell:healing-word',
        ...CTX,
      }),
    ).toThrow(/no bonus-action spell is allowed/);

    const { db: db2 } = setupCombat();
    beginTurn(db2, { campaignId: CAMPAIGN, participant: PC, ...CTX });
    spendTurnResource(db2, {
      campaignId: CAMPAIGN,
      participant: PC,
      resource: 'action',
      activity: 'cast Fire Bolt',
      spellRef: 'spell:fire-bolt',
      ...CTX,
    });
    const bonus = spendTurnResource(db2, {
      campaignId: CAMPAIGN,
      participant: PC,
      resource: 'bonus_action',
      activity: 'cast Healing Word',
      spellRef: 'spell:healing-word',
      ...CTX,
    });
    expect(bonus.budget.bonusActionSpellCast).toBe(true);
  });

  it('a reaction spell on the caster’s own turn participates in the restriction; off-turn it does not', () => {
    const { db } = setupCombat();
    beginTurn(db, { campaignId: CAMPAIGN, participant: PC, ...CTX });
    spendTurnResource(db, {
      campaignId: CAMPAIGN,
      participant: PC,
      resource: 'bonus_action',
      activity: 'cast Healing Word',
      spellRef: 'spell:healing-word',
      ...CTX,
    });
    expect(() =>
      spendTurnResource(db, {
        campaignId: CAMPAIGN,
        participant: PC,
        resource: 'reaction',
        activity: 'cast Shield',
        spellRef: 'spell:shield',
        ...CTX,
      }),
    ).toThrow(/only other spell allowed is a cantrip/);

    // Off-turn (goblin 1's turn) the same participant may cast a reaction
    // spell: the restriction binds a single turn, not the round.
    beginTurn(db, {
      campaignId: CAMPAIGN,
      participant: participant(GOBLIN_1),
      ...CTX,
    });
    const offTurn = spendTurnResource(db, {
      campaignId: CAMPAIGN,
      participant: PC,
      resource: 'reaction',
      activity: 'cast Shield',
      spellRef: 'spell:shield',
      ...CTX,
    });
    expect(offTurn.budget.reactionsUsed).toBe(1);
  });

  it('rejects a spell cast on movement or the free interaction', () => {
    const { db } = setupCombat();
    pcTurn(db);
    expect(() =>
      spendTurnResource(db, {
        campaignId: CAMPAIGN,
        participant: PC,
        resource: 'free_interaction',
        activity: 'cast something',
        spellRef: 'spell:fire-bolt',
        ...CTX,
      }),
    ).toThrow(/not movement or the free interaction/);
  });
});

describe('surprise', () => {
  it('denies every spend on the surprised first turn and clears when that turn ends', () => {
    const { db } = setupCombat();
    setSurprised(db, {
      campaignId: CAMPAIGN,
      participants: [participant(GOBLIN_1)],
      ...CTX,
    });

    // Reaction denied even before its first turn begins.
    expect(() =>
      spendTurnResource(db, {
        campaignId: CAMPAIGN,
        participant: participant(GOBLIN_1),
        resource: 'reaction',
        activity: 'opportunity attack',
        ...CTX,
      }),
    ).toThrow(/surprised/);

    const turn = beginTurn(db, {
      campaignId: CAMPAIGN,
      participant: participant(GOBLIN_1),
      ...CTX,
    });
    expect(turn.surprisedRestricted).toBe(true);
    for (const resource of [
      'action',
      'bonus_action',
      'free_interaction',
      'movement',
    ] as const) {
      expect(() =>
        spendTurnResource(db, {
          campaignId: CAMPAIGN,
          participant: participant(GOBLIN_1),
          resource,
          activity: 'anything',
          ...CTX,
        }),
      ).toThrow(/surprised/);
    }

    // The surprised turn ends when the next turn begins; the flag clears and
    // the reaction is usable again (off-turn).
    beginTurn(db, {
      campaignId: CAMPAIGN,
      participant: participant(GOBLIN_2),
      ...CTX,
    });
    const reaction = spendTurnResource(db, {
      campaignId: CAMPAIGN,
      participant: participant(GOBLIN_1),
      resource: 'reaction',
      activity: 'opportunity attack',
      ...CTX,
    });
    expect(reaction.budget.surprised).toBe(false);
    expect(reaction.budget.reactionsUsed).toBe(1);
  });

  it('applies only before the first turn: a participant who has acted cannot become surprised', () => {
    const { db } = setupCombat();
    beginTurn(db, {
      campaignId: CAMPAIGN,
      participant: participant(GOBLIN_1),
      ...CTX,
    });
    beginTurn(db, {
      campaignId: CAMPAIGN,
      participant: participant(GOBLIN_2),
      ...CTX,
    });

    expect(() =>
      setSurprised(db, {
        campaignId: CAMPAIGN,
        participants: [participant(GOBLIN_1)],
        ...CTX,
      }),
    ).toThrow(/already taken a turn/);
  });

  it('validates participants and requires at least one', () => {
    const { db } = setupCombat();
    expect(() =>
      setSurprised(db, { campaignId: CAMPAIGN, participants: [], ...CTX }),
    ).toThrow(ActionEconomyError);
    expect(() =>
      setSurprised(db, {
        campaignId: CAMPAIGN,
        participants: [participant('nope')],
        ...CTX,
      }),
    ).toThrow(/unknown combatant/);
  });
});

describe('context snapshot and rendering', () => {
  it('renders the round, active budget, spent reactions, and surprised list', () => {
    const { db } = setupCombat();
    setSurprised(db, {
      campaignId: CAMPAIGN,
      participants: [participant(GOBLIN_2)],
      ...CTX,
    });
    beginTurn(db, { campaignId: CAMPAIGN, participant: PC, ...CTX });
    spendTurnResource(db, {
      campaignId: CAMPAIGN,
      participant: PC,
      resource: 'action',
      activity: 'Attack (shortsword)',
      ...CTX,
    });
    spendTurnResource(db, {
      campaignId: CAMPAIGN,
      participant: participant(GOBLIN_1),
      resource: 'reaction',
      activity: 'opportunity attack',
      ...CTX,
    });

    const rendered = renderContextMessage(
      assembleContext({
        db,
        campaignId: CAMPAIGN,
        campaignPosition: DEFAULT_TEST_CAMPAIGN_POSITION,
        sessionId: DEFAULT_TEST_SESSION_ID,
        playerInput: 'I attack the goblin.',
      }),
    );

    expect(rendered).toContain('Combat turn: round 1');
    expect(rendered).toContain('action used (Attack (shortsword))');
    expect(rendered).toContain('bonus action available');
    expect(rendered).toContain('Reactions spent this round: Goblin 1');
    expect(rendered).toMatch(/Surprised .*: Goblin 2/);
  });

  it('prompts for begin_turn while combat has no structured turn yet', () => {
    const { db } = setupCombat();

    const rendered = renderContextMessage(
      assembleContext({
        db,
        campaignId: CAMPAIGN,
        campaignPosition: DEFAULT_TEST_CAMPAIGN_POSITION,
        sessionId: DEFAULT_TEST_SESSION_ID,
        playerInput: 'What now?',
      }),
    );

    expect(rendered).toContain(
      'Combat turn: no structured turn opened yet (call begin_turn when the first turn starts).',
    );
  });
});

describe('turn-budget tools', () => {
  function toolSetup() {
    const { db, pcId } = setupCombat();
    const registry = createDefaultToolRegistry();
    const ctx: ToolContext = {
      db,
      rng: createSeededRng(7),
      campaignId: CAMPAIGN,
      sessionId: DEFAULT_TEST_SESSION_ID,
      turnId: 'turn-1',
      at: NOW,
    };
    return { db, pcId, registry, ctx };
  }

  it('begin_turn / spend_turn_resource / set_surprised run end to end', () => {
    const { registry, ctx } = toolSetup();

    const surprised = registry.invoke(
      'set_surprised',
      { combatantIds: [GOBLIN_2] },
      ctx,
    );
    expect(surprised.ok).toBe(true);

    const begin = registry.invoke('begin_turn', { combatantId: GOBLIN_1 }, ctx);
    expect(begin.ok).toBe(true);
    if (begin.ok) {
      expect(begin.data).toMatchObject({
        roundNumber: 1,
        surprisedRestricted: false,
      });
    }

    const spend = registry.invoke(
      'spend_turn_resource',
      {
        resource: 'action',
        activity: 'Attack (scimitar)',
        combatantId: GOBLIN_1,
      },
      ctx,
    );
    expect(spend.ok).toBe(true);

    const doubleSpend = registry.invoke(
      'spend_turn_resource',
      { resource: 'action', activity: 'Dash', combatantId: GOBLIN_1 },
      ctx,
    );
    expect(doubleSpend.ok).toBe(false);
    if (!doubleSpend.ok) {
      expect(doubleSpend.code).toBe('turn_budget_error');
    }
  });

  it('begin_turn defaults to the acting character and validates args', () => {
    const { pcId, registry, ctx } = toolSetup();

    const begin = registry.invoke('begin_turn', {}, ctx);
    expect(begin.ok).toBe(true);
    if (begin.ok) {
      expect(begin.data).toMatchObject({
        budget: { participant: { kind: 'character', ref: pcId } },
      });
    }

    const both = registry.invoke(
      'begin_turn',
      { combatantId: GOBLIN_1, character: pcId },
      ctx,
    );
    expect(both.ok).toBe(false);
    if (!both.ok) {
      expect(both.message).toMatch(/combatantId OR character/);
    }
  });

  it('spend_turn_resource validates resource and spell args', () => {
    const { registry, ctx } = toolSetup();
    registry.invoke('begin_turn', { combatantId: GOBLIN_1 }, ctx);

    const badResource = registry.invoke(
      'spend_turn_resource',
      { resource: 'legendary', activity: 'x', combatantId: GOBLIN_1 },
      ctx,
    );
    expect(badResource.ok).toBe(false);

    const badSpell = registry.invoke(
      'spend_turn_resource',
      {
        resource: 'action',
        activity: 'cast',
        combatantId: GOBLIN_1,
        spellRef: '',
      },
      ctx,
    );
    expect(badSpell.ok).toBe(false);
    if (!badSpell.ok) {
      expect(badSpell.message).toMatch(/spellRef/);
    }
  });

  it('set_surprised resolves party members by name/id and requires a participant', () => {
    const { pcId, registry, ctx } = toolSetup();

    const none = registry.invoke('set_surprised', {}, ctx);
    expect(none.ok).toBe(false);

    const byId = registry.invoke('set_surprised', { characters: [pcId] }, ctx);
    expect(byId.ok).toBe(true);
    if (byId.ok) {
      expect(byId.data).toMatchObject({
        surprised: [{ kind: 'character', ref: pcId }],
      });
    }
  });
});

describe('spendTurnResource — spell casts are pack-derived, never model-declared', () => {
  it('fails closed when an activity reads like a spell cast without a spellRef', () => {
    const { db } = setupCombat();
    beginTurn(db, { campaignId: CAMPAIGN, participant: PC, ...CTX });

    // The reviewer-cited bypass: recording a bonus-action spell cast without
    // spell metadata must not silently skip the timing invariant.
    expect(() =>
      spendTurnResource(db, {
        campaignId: CAMPAIGN,
        participant: PC,
        resource: 'bonus_action',
        activity: 'cast Healing Word',
        ...CTX,
      }),
    ).toThrow(/reads like a spell cast: pass spellRef/);
    expect(() =>
      spendTurnResource(db, {
        campaignId: CAMPAIGN,
        participant: PC,
        resource: 'action',
        activity: 'uses its Spellcasting to hurl fire',
        ...CTX,
      }),
    ).toThrow(/reads like a spell cast: pass spellRef/);
  });

  it('fails closed on a spellRef that does not resolve in the rules stack', () => {
    const { db } = setupCombat();
    beginTurn(db, { campaignId: CAMPAIGN, participant: PC, ...CTX });

    expect(() =>
      spendTurnResource(db, {
        campaignId: CAMPAIGN,
        participant: PC,
        resource: 'action',
        activity: 'cast Nonexistent Zap',
        spellRef: 'spell:nonexistent-zap',
        ...CTX,
      }),
    ).toThrow(/does not resolve to a spell record/);
  });

  it('derives the action-cantrip exception from the record, not a declared flag', () => {
    const { db } = setupCombat();
    beginTurn(db, { campaignId: CAMPAIGN, participant: PC, ...CTX });
    spendTurnResource(db, {
      campaignId: CAMPAIGN,
      participant: PC,
      resource: 'bonus_action',
      activity: 'cast Healing Word',
      spellRef: 'spell:healing-word',
      ...CTX,
    });

    // Cure Wounds is level 1 in the pack: rejected no matter what the model
    // believes about it.
    expect(() =>
      spendTurnResource(db, {
        campaignId: CAMPAIGN,
        participant: PC,
        resource: 'action',
        activity: 'cast Cure Wounds',
        spellRef: 'spell:cure-wounds',
        ...CTX,
      }),
    ).toThrow(/only other spell allowed is a cantrip/);
    // Fire Bolt is a 1-action cantrip in the pack: allowed.
    const cantrip = spendTurnResource(db, {
      campaignId: CAMPAIGN,
      participant: PC,
      resource: 'action',
      activity: 'cast Fire Bolt',
      spellRef: 'spell:fire-bolt',
      ...CTX,
    });
    expect(cantrip.budget.otherSpellCast).toBe('action-cantrip');
  });
});

describe('extraReactions mechanics (hydra, marilith)', () => {
  const HYDRA = 'ci-enc-lair-1-hydra-1';
  const MARILITH = 'ci-enc-lair-1-marilith-2';

  function setupLairCombat() {
    const db = freshDbWithSession();
    const base = makeTestAdventureModule();
    const module: AdventureModule = {
      ...base,
      encounters: [
        {
          id: 'enc-lair',
          name: 'Lair Guardians',
          description: 'A hydra and a marilith guard the sanctum.',
          creatures: [
            { rulesRef: 'creature:hydra', count: 1, role: 'guardian' },
            { rulesRef: 'creature:marilith', count: 1, role: 'guardian' },
          ],
          locationId: 'loc-cellar',
          reward: 'The sanctum vault.',
        },
      ],
      scenes: base.scenes.map((scene) =>
        scene.id === 'scene-cellar'
          ? { ...scene, encounterIds: ['enc-lair'] }
          : scene,
      ),
    };
    startAdventureRun(db, {
      campaignId: CAMPAIGN,
      runId: 'run-lair',
      moduleId: module.id,
      provenance: 'test',
      sessionId: DEFAULT_TEST_SESSION_ID,
      updatedAt: NOW,
    });
    startEncounter(db, {
      campaignId: CAMPAIGN,
      encounterId: 'enc-lair',
      resolveAdventureModule: (moduleId) =>
        moduleId === module.id ? module : undefined,
      ...CTX,
    });
    return { db };
  }

  function spendReaction(
    db: ReturnType<typeof setupLairCombat>['db'],
    ref: string,
    activity: string,
  ) {
    return spendTurnResource(db, {
      campaignId: CAMPAIGN,
      participant: participant(ref),
      resource: 'reaction',
      activity,
      ...CTX,
    });
  }

  it('marilith Reactive (perTurn): the reaction returns at the start of every turn, not only its own', () => {
    const { db } = setupLairCombat();
    beginTurn(db, { campaignId: CAMPAIGN, participant: PC, ...CTX });

    const first = spendReaction(db, MARILITH, 'parry');
    expect(first.budget.reactionRefresh).toBe('every_turn');
    // Still one per turn: a second reaction on the same turn is refused.
    expect(() => spendReaction(db, MARILITH, 'parry again')).toThrow(
      /return when the next turn begins/,
    );

    // Another participant's turn begins — NOT the marilith's — and its
    // reaction is back (Reactive: one reaction on every turn).
    beginTurn(db, {
      campaignId: CAMPAIGN,
      participant: participant(HYDRA),
      ...CTX,
    });
    expect(spendReaction(db, MARILITH, 'parry').budget.reactionsUsed).toBe(1);
  });

  it('does not let a pre-first-turn effect anchor create a partial marilith budget row', () => {
    const { db } = setupLairCombat();
    createActiveEffect(db, {
      campaignId: CAMPAIGN,
      effectId: 'fx-marilith-clock',
      kind: 'condition-package',
      displayName: 'Marilith clock',
      source: { kind: 'ruling' },
      targets: [{ kind: 'combatant', ref: MARILITH }],
      duration: {
        kind: 'timed',
        amount: 2,
        unit: 'round',
        anchor: 'target-turn-start',
      },
      ...CTX,
    });
    expect(
      db
        .prepare(
          `SELECT 1 FROM combat_turn_budget
           WHERE campaign_id = ? AND participant_ref = ?`,
        )
        .get(CAMPAIGN, MARILITH),
    ).toBeUndefined();

    const first = beginTurn(db, {
      campaignId: CAMPAIGN,
      participant: participant(MARILITH),
      ...CTX,
    });
    expect(first.budget.reactionAllowance).toBe(1);
    expect(first.budget.reactionRefresh).toBe('every_turn');
    spendReaction(db, MARILITH, 'parry');
    beginTurn(db, {
      campaignId: CAMPAIGN,
      participant: participant(HYDRA),
      ...CTX,
    });
    expect(
      spendReaction(db, MARILITH, 'parry again').budget.reactionsUsed,
    ).toBe(1);
  });

  it('hydra Reactive Heads (formula): the validated allowance grant unlocks extra reactions', () => {
    const { db } = setupLairCombat();
    beginTurn(db, { campaignId: CAMPAIGN, participant: PC, ...CTX });

    expect(
      spendReaction(db, HYDRA, 'opportunity attack').budget.reactionsUsed,
    ).toBe(1);
    // Until the DM records the head count, the default allowance holds —
    // and the rejection points at the grant mechanism.
    expect(() => spendReaction(db, HYDRA, 'opportunity attack')).toThrow(
      /state-dependent extra-reaction mechanic.*reactionAllowance/,
    );

    // Five heads: 1 + 4 extra reactions.
    const grant = setReactionAllowance(db, {
      campaignId: CAMPAIGN,
      combatantId: HYDRA,
      allowance: 5,
      ...CTX,
    });
    expect(grant.reactionAllowance).toBe(5);
    expect(grant.restrictedTo).toBe('opportunity-attacks');

    // Extra spends succeed and surface the mechanic's restriction clause.
    const second = spendReaction(db, HYDRA, 'opportunity attack (second head)');
    expect(second.budget.reactionsUsed).toBe(2);
    expect(second.extraReactionRestriction).toBe('opportunity-attacks');

    for (const n of [3, 4, 5]) {
      expect(
        spendReaction(db, HYDRA, `opportunity attack (head ${n})`).budget
          .reactionsUsed,
      ).toBe(n);
    }
    expect(() => spendReaction(db, HYDRA, 'one bite too many')).toThrow(
      /all 5 of their reactions \(5\/5\)/,
    );
  });

  it('the allowance grant is refused for creatures without a formula-based mechanic', () => {
    const { db } = setupCombat();
    expect(() =>
      setReactionAllowance(db, {
        campaignId: CAMPAIGN,
        combatantId: GOBLIN_1,
        allowance: 2,
        ...CTX,
      }),
    ).toThrow(/no state-dependent extra-reaction mechanic/);
    // The marilith's perTurn mechanic is typed but not state-dependent:
    // also refused.
    const { db: lairDb } = setupLairCombat();
    expect(() =>
      setReactionAllowance(lairDb, {
        campaignId: CAMPAIGN,
        combatantId: MARILITH,
        allowance: 4,
        ...CTX,
      }),
    ).toThrow(/no state-dependent extra-reaction mechanic/);
  });

  it('the every_turn refresh does not erase the evidence the surprise guard needs', () => {
    const { db } = setupLairCombat();
    beginTurn(db, { campaignId: CAMPAIGN, participant: PC, ...CTX });
    spendReaction(db, MARILITH, 'parry');

    // Another turn begins and Reactive refreshes the marilith's counter…
    beginTurn(db, {
      campaignId: CAMPAIGN,
      participant: participant(HYDRA),
      ...CTX,
    });
    const marilith = readCombatTurnState(db, CAMPAIGN)?.budgets.find(
      (b) => b.participant.ref === MARILITH,
    );
    expect(marilith?.reactionsUsed).toBe(0);

    // …but the retained reaction activity still proves it reacted before
    // its first turn, so retroactive surprise stays refused.
    expect(() =>
      setSurprised(db, {
        campaignId: CAMPAIGN,
        participants: [participant(MARILITH)],
        ...CTX,
      }),
    ).toThrow(/already acted this combat/);
  });

  it('update_combatant carries the grant as a validated tool arg', () => {
    const { db } = setupLairCombat();
    const registry = createDefaultToolRegistry();
    const ctx: ToolContext = {
      db,
      rng: createSeededRng(7),
      campaignId: CAMPAIGN,
      sessionId: DEFAULT_TEST_SESSION_ID,
      turnId: 'turn-1',
      at: NOW,
    };

    const granted = registry.invoke(
      'update_combatant',
      { combatantId: HYDRA, reactionAllowance: 3 },
      ctx,
    );
    expect(granted.ok).toBe(true);
    if (granted.ok) {
      expect(granted.data).toMatchObject({
        reactionAllowance: {
          reactionAllowance: 3,
          restrictedTo: 'opportunity-attacks',
        },
      });
    }

    const refused = registry.invoke(
      'update_combatant',
      { combatantId: MARILITH, reactionAllowance: 3 },
      ctx,
    );
    expect(refused.ok).toBe(false);
    if (!refused.ok) {
      expect(refused.code).toBe('turn_budget_error');
    }
  });
});

describe('setSurprised — timing guards', () => {
  it('rejects the participant whose first turn is already underway', () => {
    const { db } = setupCombat();
    beginTurn(db, {
      campaignId: CAMPAIGN,
      participant: participant(GOBLIN_1),
      ...CTX,
    });
    spendTurnResource(db, {
      campaignId: CAMPAIGN,
      participant: participant(GOBLIN_1),
      resource: 'action',
      activity: 'Attack (scimitar)',
      ...CTX,
    });

    // The reviewer-cited sequence: retroactive surprise after acting on the
    // currently active first turn must be refused.
    expect(() =>
      setSurprised(db, {
        campaignId: CAMPAIGN,
        participants: [participant(GOBLIN_1)],
        ...CTX,
      }),
    ).toThrow(/first turn is already underway/);
  });

  it('rejects a participant who already spent a reaction before their first turn', () => {
    const { db } = setupCombat();
    beginTurn(db, {
      campaignId: CAMPAIGN,
      participant: participant(GOBLIN_1),
      ...CTX,
    });
    spendTurnResource(db, {
      campaignId: CAMPAIGN,
      participant: participant(GOBLIN_2),
      resource: 'reaction',
      activity: 'opportunity attack',
      ...CTX,
    });

    expect(() =>
      setSurprised(db, {
        campaignId: CAMPAIGN,
        participants: [participant(GOBLIN_2)],
        ...CTX,
      }),
    ).toThrow(/already acted this combat/);
  });
});

describe('legendary actions (F5, eshyra-2n1t.7)', () => {
  const DRAGON = 'ci-enc-dragon-1-adult-red-dragon-1';

  function dragonModule(): AdventureModule {
    const module = makeTestAdventureModule();
    return {
      ...module,
      encounters: [
        {
          id: 'enc-dragon',
          name: 'The Dragon',
          description: 'An adult red dragon descends.',
          creatures: [
            { rulesRef: 'creature:adult-red-dragon', count: 1, role: 'boss' },
            { rulesRef: 'creature:goblin', count: 1, role: 'minion' },
          ],
          locationId: 'loc-cellar',
          reward: 'The hoard.',
        },
      ],
      scenes: module.scenes.map((scene) =>
        scene.id === 'scene-cellar'
          ? { ...scene, encounterIds: ['enc-dragon'] }
          : scene,
      ),
    };
  }

  const GOBLIN = 'ci-enc-dragon-1-goblin-2';

  function setupDragonCombat() {
    const db = freshDbWithSession();
    const module = dragonModule();
    startAdventureRun(db, {
      campaignId: CAMPAIGN,
      runId: 'run-dragon',
      moduleId: module.id,
      provenance: 'test',
      sessionId: DEFAULT_TEST_SESSION_ID,
      updatedAt: NOW,
    });
    startEncounter(db, {
      campaignId: CAMPAIGN,
      encounterId: 'enc-dragon',
      resolveAdventureModule: (moduleId) =>
        moduleId === module.id ? module : undefined,
      ...CTX,
    });
    return { db };
  }

  function spendLegendary(
    db: ReturnType<typeof setupDragonCombat>['db'],
    legendaryActionName: string,
    activity = legendaryActionName,
  ) {
    return spendTurnResource(db, {
      campaignId: CAMPAIGN,
      participant: participant(DRAGON),
      resource: 'legendary_action',
      activity,
      legendaryActionName,
      ...CTX,
    });
  }

  it("seeds the allowance from the record and spends one option per other creature's turn, costing per option", () => {
    const { db } = setupDragonCombat();
    beginTurn(db, {
      campaignId: CAMPAIGN,
      participant: participant(GOBLIN),
      ...CTX,
    });

    const tail = spendLegendary(db, 'Tail Attack', 'tail swipe at the goblin');
    expect(tail.budget.legendaryActionAllowance).toBe(3);
    expect(tail.budget.legendaryActionsUsed).toBe(1);
    expect(tail.budget.legendaryActionActivity).toBe(
      'tail swipe at the goblin',
    );

    // "Wing Attack (Costs 2 Actions)" matches without the cost suffix and,
    // at the end of the NEXT turn (the PC's), drains the remaining two.
    beginTurn(db, { campaignId: CAMPAIGN, participant: PC, ...CTX });
    const wing = spendLegendary(db, 'Wing Attack');
    expect(wing.budget.legendaryActionsUsed).toBe(3);

    beginTurn(db, {
      campaignId: CAMPAIGN,
      participant: participant(GOBLIN),
      round: 2,
      ...CTX,
    });
    expect(() => spendLegendary(db, 'Detect')).toThrow(
      /0 of 3 legendary actions left.*'Detect' costs 1/s,
    );
  });

  it('allows only one legendary option per turn window', () => {
    const { db } = setupDragonCombat();
    beginTurn(db, {
      campaignId: CAMPAIGN,
      participant: participant(GOBLIN),
      ...CTX,
    });
    spendLegendary(db, 'Tail Attack');

    // Budget remains (1/3 used), but the window is spent: only one option
    // can be used at the end of any single creature's turn.
    expect(() => spendLegendary(db, 'Detect')).toThrow(
      /already used a legendary action option at the end of this turn/,
    );

    // The next creature's turn opens a new window.
    beginTurn(db, { campaignId: CAMPAIGN, participant: PC, ...CTX });
    expect(spendLegendary(db, 'Detect').budget.legendaryActionsUsed).toBe(2);
  });

  it('refuses a legendary spend before any structured turn is open', () => {
    const { db } = setupDragonCombat();

    expect(() => spendLegendary(db, 'Detect')).toThrow(
      /no structured turn is open/,
    );
  });

  it('refuses an over-cost option, naming the remaining budget', () => {
    const { db } = setupDragonCombat();
    beginTurn(db, {
      campaignId: CAMPAIGN,
      participant: participant(GOBLIN),
      ...CTX,
    });
    spendLegendary(db, 'Tail Attack');
    beginTurn(db, { campaignId: CAMPAIGN, participant: PC, ...CTX });
    spendLegendary(db, 'Detect');
    beginTurn(db, {
      campaignId: CAMPAIGN,
      participant: participant(GOBLIN),
      round: 2,
      ...CTX,
    });

    expect(() => spendLegendary(db, 'Wing Attack')).toThrow(
      /1 of 3 legendary actions left.*costs 2/s,
    );
  });

  it('lazily reconciles a zero allowance on a pre-0007 budget row', () => {
    const { db } = setupDragonCombat();
    beginTurn(db, {
      campaignId: CAMPAIGN,
      participant: participant(GOBLIN),
      ...CTX,
    });
    spendLegendary(db, 'Tail Attack');

    // Simulate a budget row created before migration 0007 added the
    // legendary columns: an active mid-combat row holding the column
    // defaults (allowance 0, nothing spent) — exactly what a migrated
    // database contains, since 0007 performs no data backfill.
    db.prepare(
      `UPDATE combat_turn_budget
       SET legendary_action_allowance = 0, legendary_actions_used = 0,
           legendary_action_activity = NULL, legendary_last_spend_token = NULL
       WHERE participant_ref = ?`,
    ).run(DRAGON);

    // The next budget touch re-derives the allowance from the record.
    beginTurn(db, { campaignId: CAMPAIGN, participant: PC, ...CTX });
    const spend = spendLegendary(db, 'Detect');
    expect(spend.budget.legendaryActionAllowance).toBe(3);
    expect(spend.budget.legendaryActionsUsed).toBe(1);
  });

  it("regains spent legendary actions at the start of the creature's own turn", () => {
    const { db } = setupDragonCombat();
    beginTurn(db, {
      campaignId: CAMPAIGN,
      participant: participant(GOBLIN),
      ...CTX,
    });
    spendLegendary(db, 'Wing Attack');

    const ownTurn = beginTurn(db, {
      campaignId: CAMPAIGN,
      participant: participant(DRAGON),
      ...CTX,
    });
    expect(ownTurn.budget.legendaryActionsUsed).toBe(0);
    expect(ownTurn.budget.legendaryActionAllowance).toBe(3);
  });

  it("rejects a spend on the creature's own turn", () => {
    const { db } = setupDragonCombat();
    beginTurn(db, {
      campaignId: CAMPAIGN,
      participant: participant(DRAGON),
      ...CTX,
    });

    expect(() => spendLegendary(db, 'Detect')).toThrow(
      /only at the end of ANOTHER creature's turn/,
    );
  });

  it('fails closed on a missing or unknown option name, listing the options', () => {
    const { db } = setupDragonCombat();
    beginTurn(db, {
      campaignId: CAMPAIGN,
      participant: participant(GOBLIN),
      ...CTX,
    });

    expect(() =>
      spendTurnResource(db, {
        campaignId: CAMPAIGN,
        participant: participant(DRAGON),
        resource: 'legendary_action',
        activity: 'tail swipe',
        ...CTX,
      }),
    ).toThrow(/pass legendaryActionName.*Detect, Tail Attack, Wing Attack/s);
    expect(() => spendLegendary(db, 'Breath Sweep')).toThrow(
      /not a legendary option.*Detect, Tail Attack, Wing Attack/s,
    );
  });

  it('fails closed promptly for an adversarial unclosed option name', () => {
    const { db } = setupDragonCombat();
    beginTurn(db, {
      campaignId: CAMPAIGN,
      participant: participant(GOBLIN),
      ...CTX,
    });
    const legendaryActionName = '('.repeat(200_000);
    const started = Date.now();
    expect(() => spendLegendary(db, legendaryActionName)).toThrow(
      /not a legendary option/,
    );
    expect(Date.now() - started).toBeLessThan(1_000);
  });

  it('rejects legendary spends by creatures without legendary actions', () => {
    const { db } = setupDragonCombat();
    beginTurn(db, {
      campaignId: CAMPAIGN,
      participant: participant(DRAGON),
      ...CTX,
    });

    expect(() =>
      spendTurnResource(db, {
        campaignId: CAMPAIGN,
        participant: participant(GOBLIN),
        resource: 'legendary_action',
        activity: 'scurry',
        legendaryActionName: 'Scurry',
        ...CTX,
      }),
    ).toThrow(/no legendary actions in its rules record/);
  });

  it('denies legendary actions while surprised (until the first turn ends)', () => {
    const { db } = setupDragonCombat();
    setSurprised(db, {
      campaignId: CAMPAIGN,
      participants: [participant(DRAGON)],
      ...CTX,
    });
    beginTurn(db, {
      campaignId: CAMPAIGN,
      participant: participant(GOBLIN),
      ...CTX,
    });

    expect(() => spendLegendary(db, 'Detect')).toThrow(/surprised/);

    // The dragon's first turn beginning and ending lifts the restriction.
    beginTurn(db, {
      campaignId: CAMPAIGN,
      participant: participant(DRAGON),
      ...CTX,
    });
    beginTurn(db, {
      campaignId: CAMPAIGN,
      participant: participant(GOBLIN),
      ...CTX,
    });
    expect(spendLegendary(db, 'Detect').budget.legendaryActionsUsed).toBe(1);
  });

  it('renders the legendary tracker in the turn budget and context snapshot', () => {
    const { db } = setupDragonCombat();
    beginTurn(db, {
      campaignId: CAMPAIGN,
      participant: participant(GOBLIN),
      ...CTX,
    });
    spendLegendary(db, 'Tail Attack');

    const state = readCombatTurnState(db, CAMPAIGN);
    const dragonBudget = state?.budgets.find(
      (budget) => budget.participant.ref === DRAGON,
    );
    expect(dragonBudget).toBeDefined();
    expect(formatTurnBudget(dragonBudget as TurnBudget)).toContain(
      'legendary actions 1/3 used (last: Tail Attack)',
    );

    const rendered = renderContextMessage(
      assembleContext({
        db,
        campaignId: CAMPAIGN,
        campaignPosition: DEFAULT_TEST_CAMPAIGN_POSITION,
        sessionId: DEFAULT_TEST_SESSION_ID,
        playerInput: 'I brace myself.',
      }),
    );
    expect(rendered).toMatch(
      /Legendary actions .*: Adult Red Dragon 1\/3 used/,
    );
  });
});
