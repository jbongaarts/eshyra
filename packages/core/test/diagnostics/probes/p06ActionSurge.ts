import type { DiagnosticFixture } from '../fixtureContract.js';
import { none, rulesTarget, VERIFIED_AT_COMMIT } from '../fixtureContract.js';

export const P06_ACTION_SURGE: DiagnosticFixture = {
  playerInput: 'I use Action Surge to take one additional action this turn.',
  campaignState: {
    actingCharacter: 'fighter-1',
    grantedFeatures: ['feature:fighter:action-surge'],
    actionEconomy: { turn: 'current', regularActionAvailable: true },
  },
  adventureState: none(
    'No authored adventure state is needed for a character-state feature probe.',
  ),
  mustIncludeTargets: [rulesTarget('feature:fighter:action-surge', 'p. 25')],
  mayIncludeTargets: [],
  mustNotIncludeTargets: [],
  requiredRetainedFacts: [
    {
      targetRef: 'feature:fighter:action-surge',
      typedPath: '/data/source',
      expectedValue: 'class:fighter',
      statement: 'The class source is retained.',
    },
    {
      targetRef: 'feature:fighter:action-surge',
      typedPath: '/data/level',
      expectedValue: 2,
      statement: 'The feature level is retained.',
    },
    {
      targetRef: 'feature:fighter:action-surge',
      typedPath: '/data/mechanics/resources/0',
      expectedValue: { reset: 'short-or-long-rest' },
      statement: 'The typed reset projection is retained.',
    },
    {
      targetRef: 'feature:fighter:action-surge',
      exactSubstring:
        'Starting at 17th level, you can use it twice before a rest, but only once on the same turn.',
      statement: 'The prose-only 17th-level usage limit is retained.',
    },
    {
      statement:
        'Correction: the framing named feature:action-surge, but the verified canonical pack key is feature:fighter:action-surge.',
    },
  ],
  requiredRelationshipExpansion: none(
    'No typed relationship traversal is required beyond the feature source metadata.',
  ),
  executions: [
    {
      executionId: 'default',
      campaignRuleState: none('No active campaign rule or ruling.'),
      expectedRouteClasses: [
        {
          targetRef: 'feature:fighter:action-surge',
          routes: ['direct-state-ref', 'typed-relationship'],
          why: 'The sheet grants the class-qualified feature, whose source and level fields provide typed feature context.',
        },
      ],
      expectedAmbiguityState: none(
        'No source ambiguity is declared for Action Surge.',
      ),
      expectedCampaignRuleOrRulingState: none(
        'No campaign rule or ruling is active.',
      ),
      expectedCapabilityStatus: {
        status: 'none-selected',
        statement:
          'No uses-per-rest capability is positively selected because the projection has no named resource or maximum; the extra action interacts with the F2 action economy.',
        inputs: [
          'feature:fighter:action-surge prose',
          'current turn action economy',
        ],
        exclusions: [
          'The record does not provide a named resource, maximum, or an owner for uses-per-rest accounting; no fixture inference supplies one.',
        ],
        residualInterpretation:
          'The DM adjudicates feature use while F2 owns action-economy mutation.',
        evidence: [
          'packages/core/src/state/actionEconomy.ts',
          'packages/core/src/orchestrator/toolBeginTurn.ts',
          'packages/core/src/orchestrator/toolSpendTurnResource.ts',
        ],
      },
      expectedDeterministicStateEffect: none(
        'This fixture does not spend Action Surge or mutate the turn economy.',
      ),
      oracleSignals: [],
    },
  ],
  probeId: 'P6',
  title: 'Fighter Action Surge',
  verifiedAtCommit: VERIFIED_AT_COMMIT,
  gatingBlocker: {
    id: 'none',
    owningBead: 'none',
    gates: 'No blocker gates this fixture identity.',
  },
  boundedEvidenceStatement:
    'This fixture is bounded evidence for a class-qualified feature and action-economy boundary; it is not a completeness unit, not a partition of the corpus, and supplies no coverage, readiness, or completeness figure.',
};
