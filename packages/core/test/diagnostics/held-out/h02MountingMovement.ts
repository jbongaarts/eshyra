import {
  type DiagnosticFixture,
  none,
  rulesTarget,
} from '../fixtureContract.js';
import {
  AUTHORED_AT_COMMIT,
  boundedEvidence,
  HELD_OUT_GATING_BLOCKER,
} from './heldOutCommon.js';

/**
 * Held-out P2 variant: retrieval from movement intent, where the governing
 * clause is a movement cost with a hard exception. Both records are text-only.
 */
export const heldOutP02: DiagnosticFixture = {
  probeId: 'P2',
  title: 'Held-out: vaulting onto a horse with little movement left',
  verifiedAtCommit: AUTHORED_AT_COMMIT,
  gatingBlocker: HELD_OUT_GATING_BLOCKER,
  boundedEvidenceStatement: boundedEvidence(
    'the low-movement mounting scenario',
  ),
  playerInput:
    'The courier is getting away. I sprint at the tethered cavalry horse, vault into the saddle and spur it down the road after him.',
  campaignState: {
    actor: {
      characterId: 'pc-ilsabet',
      className: 'rogue',
      level: 4,
      speedFeet: 30,
    },
    combat: {
      active: true,
      turnOwner: 'pc-ilsabet',
      movementRemainingFeet: 10,
      note: 'Ilsabet already spent 20 feet of movement closing on the stable yard this turn.',
    },
    nearby: [
      {
        id: 'npc-horse-1',
        description: 'a tethered cavalry horse, trained to accept a rider',
        distanceFeet: 5,
      },
    ],
  },
  adventureState: none('No authored adventure module is active.'),
  mustIncludeTargets: [
    rulesTarget('rule:mounting-and-dismounting', 'p. 99'),
    rulesTarget('rule:controlling-a-mount', 'p. 99'),
  ],
  mayIncludeTargets: [
    rulesTarget('rule:speed', 'p. 84'),
    rulesTarget('rule:opportunity-attacks', 'p. 95'),
  ],
  mustNotIncludeTargets: [],
  requiredRetainedFacts: [
    {
      statement: 'The mounting movement cost is half the rider’s speed.',
      targetRef: 'rule:mounting-and-dismounting',
      exactSubstring:
        'Doing so costs an amount of movement equal to half your speed.',
    },
    {
      statement:
        'The exception that blocks the attempt: insufficient remaining movement, or speed 0.',
      targetRef: 'rule:mounting-and-dismounting',
      exactSubstring:
        'you can’t mount it if you don’t have 15 feet of movement left or if your speed is 0',
    },
    {
      statement:
        'A trained mount that is controlled can move and act on the turn it is mounted.',
      targetRef: 'rule:controlling-a-mount',
      exactSubstring:
        'A controlled mount can move and act even on the turn that you mount it.',
    },
  ],
  evidenceNotes: [
    {
      kind: 'substrate-fact',
      statement:
        'rule:mounting-and-dismounting (p. 99) and rule:controlling-a-mount (p. 99) carry only text fields; the 15-foot worked example in the first rule is the printed arithmetic the scene (30 ft speed, 10 ft left) turns on.',
      why: 'No typed route reaches either record; the trigger is movement intent in a combat state, not a rule name.',
      assertionId: 'heldout-p02-mounting-text-only',
    },
    {
      kind: 'non-claim',
      statement:
        'The fixture does not claim the engine tracks remaining movement or enforces the mount cost.',
      why: 'Movement spend ownership is not established from source text; the expectation is retention of the printed clause only.',
    },
  ],
  requiredRelationshipExpansion: none(
    'Neither governing rule declares a typed relationship field.',
  ),
  executions: [
    {
      executionId: 'mount-with-ten-feet-left',
      campaignRuleState: none('No campaign rule or ruling is active.'),
      expectedRouteClasses: [
        {
          targetRef: 'rule:mounting-and-dismounting',
          routes: ['situation-cue'],
          why: 'Movement intent toward a horse in combat with 10 feet of movement left triggers the mount-cost rule without naming it.',
        },
        {
          targetRef: 'rule:controlling-a-mount',
          routes: ['situation-cue'],
          why: 'Spurring a mount after a fleeing target raises who controls the mount and whether it can act this turn.',
        },
      ],
      expectedAmbiguityState: none(
        'Neither governing rule carries a source ambiguity.',
      ),
      expectedCampaignRuleOrRulingState: none('No campaign rule is active.'),
      expectedCapabilityStatus: {
        status: 'none-selected',
        statement:
          'No deterministic capability is selected for mounting cost or mount control; the DM adjudicates the 15-foot requirement against the 10 feet remaining.',
        evidence: [
          'packages/core/src/rules/deterministicCapabilityLedger.ts#RULE_DETERMINISTIC_CAPABILITY_BINDINGS',
        ],
      },
      expectedDeterministicStateEffect: none(
        'The attempt is blocked by source text before any state change is warranted; no mutating operation is expected.',
      ),
      oracleSignals: [],
    },
  ],
};
