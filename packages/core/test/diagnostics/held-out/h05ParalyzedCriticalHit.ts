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
 * Held-out P5 variant: one situation reaching several governing records. A
 * condition row gives a direct-state-ref, the condition record types an
 * implied-condition edge to a second condition, and the governing rule for the
 * consequence (critical hits) has no typed edge from either condition.
 */
export const heldOutP05: DiagnosticFixture = {
  probeId: 'P5',
  title: 'Held-out: paralyzed character struck from within 5 feet',
  verifiedAtCommit: AUTHORED_AT_COMMIT,
  gatingBlocker: HELD_OUT_GATING_BLOCKER,
  boundedEvidenceStatement: boundedEvidence('the paralyzed-melee scenario'),
  playerInput:
    'I am locked rigid from the ghoul’s claws and I strain to move. The cultist beside me steps in and raises his axe. What happens when it comes down?',
  campaignState: {
    actor: {
      characterId: 'pc-maren',
      className: 'cleric',
      level: 4,
      conditions: [
        {
          conditionRef: 'condition:paralyzed',
          source: 'ghoul claws',
          expires: 'end of a successful Constitution save',
        },
      ],
      hitPoints: { current: 19, max: 31 },
    },
    combat: {
      active: true,
      combatants: [
        { id: 'pc-maren', side: 'party' },
        {
          id: 'mon-cultist-2',
          side: 'foes',
          distanceFeetFromMaren: 5,
          weapon: 'battleaxe',
        },
      ],
    },
  },
  adventureState: none('No authored adventure module is active.'),
  mustIncludeTargets: [
    rulesTarget('condition:paralyzed', 'pp. 358, 359'),
    rulesTarget('condition:incapacitated', 'p. 358'),
    rulesTarget('rule:critical-hits', 'pp. 96, 97'),
  ],
  mayIncludeTargets: [
    rulesTarget('rule:advantage-and-disadvantage', 'pp. 76, 77'),
    rulesTarget('rule:death-saving-throws', 'p. 98'),
    rulesTarget('rule:reactions', 'p. 91'),
  ],
  mustNotIncludeTargets: [],
  requiredRetainedFacts: [
    {
      statement:
        'The paralyzed critical-hit clause with its 5-foot attacker distance.',
      targetRef: 'condition:paralyzed',
      exactSubstring:
        'Any attack that hits the creature is a critical hit if the attacker is within 5 feet of the creature.',
    },
    {
      statement: 'The paralyzed advantage-against clause.',
      targetRef: 'condition:paralyzed',
      exactSubstring: 'Attack rolls against the creature have advantage.',
    },
    {
      statement:
        'The typed critical-hit-on-hit effect with its attacker distance.',
      targetRef: 'condition:paralyzed',
      typedPath: '/data/mechanics/effects/5',
      expectedValue: {
        kind: 'criticalHitOnHit',
        subject: 'against-conditioned',
        attackerWithinFeet: 5,
      },
    },
    {
      statement:
        'Incapacitated: no actions and no reactions, which removes the paralyzed character’s ability to respond.',
      targetRef: 'condition:incapacitated',
      exactSubstring:
        'An incapacitated creature can’t take actions or reactions.',
    },
    {
      statement: 'What a critical hit does to damage dice.',
      targetRef: 'rule:critical-hits',
      exactSubstring:
        'Roll all of the attack’s damage dice twice and add them together.',
    },
  ],
  evidenceNotes: [
    {
      kind: 'substrate-fact',
      statement:
        'condition:paralyzed.data.mechanics.effects[0] is an impliesCondition effect naming incapacitated, a typed edge declared in record-relationships.json; rule:critical-hits.data is text only and no typed edge reaches it from either condition.',
      why: 'The probe separates what a typed traversal can reach (the second condition) from what only a cue can reach (the governing rule for the consequence).',
      assertionId: 'heldout-p05-implied-condition-edge-and-no-rule-edge',
    },
    {
      kind: 'non-claim',
      statement:
        'The fixture does not claim a critical hit is rolled deterministically.',
      why: 'rule:critical-hits is recorded as an implemented row with no selected capability; doubling dice is DM-adjudicated.',
    },
  ],
  requiredRelationshipExpansion: [
    {
      sourceRecordKey: 'condition:paralyzed',
      linkField: 'data.mechanics.effects[].condition',
      relation: 'implied-condition',
      targetRecordKey: 'condition:incapacitated',
      statement:
        'The paralyzed record types an impliesCondition effect naming incapacitated.',
    },
  ],
  executions: [
    {
      executionId: 'paralyzed-struck-by-adjacent-cultist',
      campaignRuleState: none('No campaign rule or ruling is active.'),
      expectedRouteClasses: [
        {
          targetRef: 'condition:paralyzed',
          routes: ['direct-state-ref'],
          why: 'The acting character carries a paralyzed condition row.',
        },
        {
          targetRef: 'condition:incapacitated',
          routes: ['typed-relationship'],
          why: 'The paralyzed record names incapacitated through an impliesCondition effect; the character row does not list it.',
        },
        {
          targetRef: 'rule:critical-hits',
          routes: ['situation-cue'],
          why: 'An adjacent attacker against a paralyzed target triggers the critical-hit consequence; no typed edge reaches the rule.',
        },
      ],
      expectedAmbiguityState: none(
        'None of the three records carries a source ambiguity.',
      ),
      expectedCampaignRuleOrRulingState: none('No campaign rule is active.'),
      expectedCapabilityStatus: {
        status: 'none-selected',
        statement:
          'No deterministic capability is selected for conditions or critical hits. The attack roll rides resolve_check with a caller-declared advantage; the critical-hit consequence is applied by the DM.',
        exclusions: [
          'resolve_check never derives attack-roll modifiers or advantage; the caller declares them.',
        ],
        evidence: [
          'packages/core/src/rules/deterministicCapabilityLedger.ts#RULE_DETERMINISTIC_CAPABILITY_CONTRACTS',
        ],
      },
      expectedDeterministicStateEffect: none(
        'Discovery alone mutates no state.',
      ),
      oracleSignals: [],
    },
  ],
};
