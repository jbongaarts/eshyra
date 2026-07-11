// F2 action-economy turn budget (eshyra-2n1t.4). Evidence for the
// ENGINE_PROCEDURE_COVERAGE rows: your-turn, bonus-actions, bonus-action,
// reactions, and other-activity-on-your-turn, plus the code-owned clauses of
// surprise (turn-1 restriction) and two-weapon-fighting (bonus-attack spend
// as an ordinary bonus-action spend).

import { describe, expect, it } from 'vitest';
import type { AdventureModule, ToolContext } from '../src/internal.js';
import {
  ActionEconomyError,
  assembleContext,
  beginTurn,
  createDefaultToolRegistry,
  createSeededRng,
  getActiveCharacterId,
  mutateState,
  readCombatTurnState,
  renderContextMessage,
  setSurprised,
  spendTurnResource,
  startAdventureRun,
  startEncounter,
  updateCombatant,
} from '../src/internal.js';
import { makeTestAdventureModule } from './support/adventureModuleFixture.js';
import {
  DEFAULT_TEST_CAMPAIGN_ID,
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
      reactionUsed: false,
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

  it('rejects dead, escaped, and unknown combatants with valid ids listed', () => {
    const { db } = setupCombat();
    updateCombatant(db, {
      campaignId: CAMPAIGN,
      combatantId: GOBLIN_2,
      status: 'dead',
      ...CTX,
    });

    expect(() =>
      beginTurn(db, {
        campaignId: CAMPAIGN,
        participant: participant(GOBLIN_2),
        ...CTX,
      }),
    ).toThrow(/dead/);
    expect(() =>
      beginTurn(db, {
        campaignId: CAMPAIGN,
        participant: participant('nope'),
        ...CTX,
      }),
    ).toThrow(/Valid combatant ids: .*goblin-1/);
  });

  it('rejects a dead character: the dead have no turn', () => {
    const { db } = setupCombat();
    mutateState(db, {
      target: 'character',
      field: 'life_state',
      op: 'set',
      value: 'dead',
      ...CTX,
    });

    expect(() =>
      beginTurn(db, { campaignId: CAMPAIGN, participant: PC, ...CTX }),
    ).toThrow(/dead and has no turn/);
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
    expect(reaction.budget.reactionUsed).toBe(true);
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
    expect(g2State?.reactionUsed).toBe(true);

    // …but goblin 2's own turn start does.
    const ownTurn = beginTurn(db, {
      campaignId: CAMPAIGN,
      participant: participant(GOBLIN_2),
      ...CTX,
    });
    expect(ownTurn.budget.reactionUsed).toBe(false);
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
      spell: { cantrip: false },
      ...CTX,
    });

    expect(() =>
      spendTurnResource(db, {
        campaignId: CAMPAIGN,
        participant: PC,
        resource: 'action',
        activity: 'cast Cure Wounds',
        spell: { cantrip: false },
        ...CTX,
      }),
    ).toThrow(/only other spell allowed is a cantrip/);

    const cantrip = spendTurnResource(db, {
      campaignId: CAMPAIGN,
      participant: PC,
      resource: 'action',
      activity: 'cast Fire Bolt',
      spell: { cantrip: true },
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
      spell: { cantrip: false },
      ...CTX,
    });
    expect(() =>
      spendTurnResource(db, {
        campaignId: CAMPAIGN,
        participant: PC,
        resource: 'bonus_action',
        activity: 'cast Healing Word',
        spell: { cantrip: false },
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
      spell: { cantrip: true },
      ...CTX,
    });
    const bonus = spendTurnResource(db2, {
      campaignId: CAMPAIGN,
      participant: PC,
      resource: 'bonus_action',
      activity: 'cast Healing Word',
      spell: { cantrip: false },
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
      spell: { cantrip: false },
      ...CTX,
    });
    expect(() =>
      spendTurnResource(db, {
        campaignId: CAMPAIGN,
        participant: PC,
        resource: 'reaction',
        activity: 'cast Shield',
        spell: { cantrip: false },
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
      spell: { cantrip: false },
      ...CTX,
    });
    expect(offTurn.budget.reactionUsed).toBe(true);
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
        spell: { cantrip: true },
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
    expect(reaction.budget.reactionUsed).toBe(true);
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
        spell: {},
      },
      ctx,
    );
    expect(badSpell.ok).toBe(false);
    if (!badSpell.ok) {
      expect(badSpell.message).toMatch(/cantrip/);
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
