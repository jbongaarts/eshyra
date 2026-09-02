import type { DiagnosticFixture } from '../fixtureContract.js';
import { none, rulesTarget, VERIFIED_AT_COMMIT } from '../fixtureContract.js';

export const P02_OPPORTUNITY_ATTACKS: DiagnosticFixture = {
  playerInput:
    'The goblin runs out of my reach without disengaging; can I strike it?',
  campaignState: {
    actingCharacter: 'pc-1',
    movementIntent: {
      creature: 'goblin',
      from: 'melee reach',
      to: 'outside reach',
    },
    reactionAvailable: true,
  },
  adventureState: none(
    'No authored adventure state is needed for movement timing.',
  ),
  mustIncludeTargets: [rulesTarget('rule:opportunity-attacks', 'p. 95')],
  mayIncludeTargets: [],
  mustNotIncludeTargets: [],
  requiredRetainedFacts: [
    {
      targetRef: 'rule:opportunity-attacks',
      exactSubstring: 'moves out of your reach',
      statement: 'The trigger is retained.',
    },
    {
      targetRef: 'rule:opportunity-attacks',
      exactSubstring: 'taking the Disengage action',
      statement: 'The Disengage exception is retained.',
    },
    {
      targetRef: 'rule:opportunity-attacks',
      exactSubstring: 'when you teleport',
      statement: 'The teleport exception is retained.',
    },
    {
      targetRef: 'rule:opportunity-attacks',
      exactSubstring:
        'when someone or something moves you without using your movement, action, or reaction',
      statement: 'The involuntary-movement exception is retained.',
    },
  ],
  requiredRelationshipExpansion: none(
    'The text-only opportunity-attack record has no typed relationship expansion.',
  ),
  executions: [
    {
      executionId: 'default',
      campaignRuleState: none('No active campaign rule or ruling.'),
      expectedRouteClasses: [
        {
          targetRef: 'rule:opportunity-attacks',
          routes: ['situation-cue'],
          why: 'Movement intent and reach propose the trigger without an explicit rule-name mention.',
        },
      ],
      expectedAmbiguityState: none(
        'No source ambiguity is declared for this trigger.',
      ),
      expectedCampaignRuleOrRulingState: none(
        'No campaign rule or ruling is active.',
      ),
      expectedCapabilityStatus: {
        status: 'none-selected',
        statement:
          'The trigger and exclusions remain model-adjudicated; reaction spending is code-owned by the F2 turn budget.',
        inputs: [
          'movement intent',
          'reach and visibility',
          'reaction availability',
        ],
        exclusions: [
          'No capability decides whether the movement satisfies the trigger or an exception.',
        ],
        residualInterpretation:
          'The DM rules on the trigger and exceptions; a state tool spends the reaction if authorized.',
      },
      expectedDeterministicStateEffect: none(
        'This fixture does not spend a reaction or mutate combat state.',
      ),
      oracleSignals: [],
    },
  ],
  probeId: 'P2',
  title: 'Opportunity attack trigger and exceptions',
  verifiedAtCommit: VERIFIED_AT_COMMIT,
  gatingBlocker: {
    id: 'none',
    owningBead: 'none',
    gates: 'No blocker gates this fixture identity.',
  },
  boundedEvidenceStatement:
    'This fixture is bounded evidence for movement-trigger retrieval; it is not a completeness unit, not a partition of the corpus, and supplies no coverage, readiness, or completeness figure.',
};
