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

const RULE_IDENTITY = 'house-rule:synthetic-heldout-crit-maximize-first-dice';
const RULE_PROVENANCE =
  'Synthetic fixture rule; stands in for a jhpt-supplied record. Table agreement at session zero.';

/**
 * Held-out P10 variant: a campaign house rule that deliberately overrides a
 * clear, unambiguous canonical rule (critical-hit damage). The rule is not a
 * choice among pack ambiguity interpretations. A second execution repeats the
 * same turn with no active rule, so the rule's route cannot be inferred from
 * the player text alone.
 */
export const heldOutP10: DiagnosticFixture = {
  probeId: 'P10',
  title:
    'Held-out: critical-hit house rule beside the printed critical-hit rule',
  verifiedAtCommit: AUTHORED_AT_COMMIT,
  gatingBlocker: HELD_OUT_GATING_BLOCKER,
  boundedEvidenceStatement: boundedEvidence(
    'the critical-hit house-rule scenario',
  ),
  playerInput:
    'I swing my greatsword at the hobgoblin captain and the die comes up a natural 20. That is a crit, so how much damage do I do?',
  campaignState: {
    actor: {
      characterId: 'pc-corwin',
      className: 'fighter',
      level: 7,
      weapon: 'greatsword',
    },
    combat: {
      active: true,
      lastRoll: { kind: 'attack', d20: 20, target: 'mon-hobgoblin-captain-1' },
    },
  },
  adventureState: none('No authored adventure module is active.'),
  mustIncludeTargets: [
    rulesTarget('rule:critical-hits', 'pp. 96, 97'),
    rulesTarget('rule:rolling-1-or-20', 'p. 94'),
  ],
  mayIncludeTargets: [rulesTarget('rule:damage-rolls', 'p. 96')],
  mustNotIncludeTargets: [],
  requiredRetainedFacts: [
    {
      statement:
        'The printed critical-hit damage clause remains present beside any house rule.',
      targetRef: 'rule:critical-hits',
      exactSubstring:
        'Roll all of the attack’s damage dice twice and add them together.',
    },
    {
      statement: 'The printed natural 20 clause that defines the trigger.',
      targetRef: 'rule:rolling-1-or-20',
      exactSubstring:
        'If the d20 roll for an attack is a 20, the attack hits regardless of any modifiers or the target’s AC.',
    },
  ],
  evidenceNotes: [
    {
      kind: 'substrate-fact',
      statement:
        'rule:critical-hits (SRD 5.1 pp. 96, 97) states the dice-doubling procedure without internal ambiguity; the house rule overrides it and is not an interpretation choice.',
      why: 'This is the house-rule class (an intentional override of clear canonical behavior), not a ruling on a source ambiguity.',
      assertionId: 'heldout-p10-critical-hits-unambiguous',
    },
    {
      kind: 'non-claim',
      statement:
        'The rule identity, scope and provenance strings are synthetic labels, not a rule-record format.',
      why: 'Rule storage, identity and lifecycle belong to eshyra-jhpt.',
    },
    {
      kind: 'non-claim',
      statement:
        'The fixture does not assert that a house rule appears for ordinary contextual adjudication such as cover or visibility.',
      why: 'That boundary is already carried by eshyra-jhpt.9 scenario 9; this fixture does not weaken it.',
    },
  ],
  requiredRelationshipExpansion: none(
    'Neither record declares a typed relationship field; no traversal is expected.',
  ),
  executions: [
    {
      executionId: 'house-rule-active',
      campaignRuleState: {
        kind: 'house-rule',
        identity: RULE_IDENTITY,
        statement:
          'On a critical hit, the first set of damage dice is maximized and the doubled dice are then rolled normally.',
        scope: 'campaign-wide',
        provenance: RULE_PROVENANCE,
      },
      expectedRouteClasses: [
        {
          targetRef: 'rule:critical-hits',
          routes: ['situation-cue', 'campaign-rule'],
          why: 'A natural 20 attack cues the printed rule; the active house rule applies to the same turn and adds the campaign-rule route.',
        },
        {
          targetRef: 'rule:rolling-1-or-20',
          routes: ['situation-cue'],
          why: 'The stated natural 20 cues the rule defining the critical hit.',
        },
      ],
      expectedAmbiguityState: none(
        'The critical-hit rule carries no source ambiguity.',
      ),
      expectedCampaignRuleOrRulingState: {
        kind: 'campaign-rule-cases',
        cases: [
          {
            caseId: 'crit-maximize-first-dice',
            statement:
              'The house rule is presented as governing, and the printed rule it overrides stays present and attributed.',
            ruleIdentity: RULE_IDENTITY,
            ruleKind: 'house-rule',
            scope: 'campaign-wide',
            provenance: RULE_PROVENANCE,
          },
        ],
      },
      expectedCapabilityStatus: {
        status: 'none-selected',
        statement:
          'No deterministic capability is selected for critical hits; the DM applies the active house rule and rolls the dice.',
        evidence: [
          'packages/core/src/rules/deterministicCapabilityLedger.ts#RULE_DETERMINISTIC_CAPABILITY_DISPOSITIONS',
        ],
      },
      expectedDeterministicStateEffect: none(
        'Discovery alone mutates no state; damage is a separate tool call.',
      ),
      oracleSignals: [],
    },
    {
      executionId: 'no-house-rule',
      campaignRuleState: none('No campaign rule or ruling is active.'),
      expectedRouteClasses: [
        {
          targetRef: 'rule:critical-hits',
          routes: ['situation-cue'],
          why: 'Without an active rule only the situation cue applies.',
        },
        {
          targetRef: 'rule:rolling-1-or-20',
          routes: ['situation-cue'],
          why: 'The stated natural 20 cues the defining rule.',
        },
      ],
      expectedAmbiguityState: none(
        'The critical-hit rule carries no source ambiguity.',
      ),
      expectedCampaignRuleOrRulingState: none('No campaign rule is active.'),
      expectedCapabilityStatus: {
        status: 'none-selected',
        statement:
          'No deterministic capability is selected for critical hits; the DM applies the printed rule.',
        evidence: [
          'packages/core/src/rules/deterministicCapabilityLedger.ts#RULE_DETERMINISTIC_CAPABILITY_DISPOSITIONS',
        ],
      },
      expectedDeterministicStateEffect: none(
        'Discovery alone mutates no state.',
      ),
      oracleSignals: [],
    },
  ],
};
