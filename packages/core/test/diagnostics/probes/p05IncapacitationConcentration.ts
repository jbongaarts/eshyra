import type { DiagnosticFixture } from '../fixtureContract.js';
import { none, rulesTarget, VERIFIED_AT_COMMIT } from '../fixtureContract.js';

export const P05_INCAPACITATION_CONCENTRATION: DiagnosticFixture = {
  playerInput: 'The caster is incapacitated while concentrating on a spell.',
  campaignState: {
    actingCharacter: 'pc-1',
    conditions: ['condition:incapacitated'],
    activeEffects: [{ kind: 'concentration', source: 'spell:hold-person' }],
  },
  adventureState: none(
    'No authored adventure state is needed for state-derived discovery.',
  ),
  mustIncludeTargets: [
    rulesTarget('condition:incapacitated', 'p. 358'),
    rulesTarget('rule:concentration', 'p. 102'),
  ],
  mayIncludeTargets: [rulesTarget('action:dodge', 'p. 93')],
  mustNotIncludeTargets: [],
  requiredRetainedFacts: [
    {
      targetRef: 'condition:incapacitated',
      typedPath: '/data/mechanics/effects/0',
      expectedValue: { kind: 'cannotTakeActions', subject: 'conditioned' },
      statement: 'The action prohibition is retained.',
    },
    {
      targetRef: 'condition:incapacitated',
      typedPath: '/data/mechanics/effects/1',
      expectedValue: { kind: 'cannotTakeReactions', subject: 'conditioned' },
      statement: 'The reaction prohibition is retained.',
    },
    {
      targetRef: 'rule:concentration',
      exactSubstring:
        'Being incapacitated or killed. You lose concentration on a spell if you are incapacitated or if you die',
      statement:
        'The concentration prose retains the incapacitation break clause.',
    },
    {
      targetRef: 'rule:concentration',
      statement:
        'There is no typed edge from condition:incapacitated to rule:concentration; reaching the rule requires a cue route, not a traversal.',
    },
  ],
  requiredRelationshipExpansion: [
    {
      sourceRecordKey: 'action:dodge',
      linkField: 'data.mechanics.conditions',
      relation: 'exclusion',
      targetRecordKey: 'condition:incapacitated',
      statement:
        'This exact typed relationship is a real one-hop expansion in the pack; no aggregate relationship count is asserted.',
    },
  ],
  executions: [
    {
      executionId: 'default',
      campaignRuleState: none('No active campaign rule or ruling.'),
      expectedRouteClasses: [
        {
          targetRef: 'condition:incapacitated',
          routes: ['direct-state-ref', 'typed-relationship'],
          why: 'The condition row directly names the condition, and a typed pack link can also reach it.',
        },
        {
          targetRef: 'rule:concentration',
          routes: ['situation-cue'],
          why: 'The active concentration effect plus incapacitation cue reaches the text-only governing rule; the pack has no condition-to-rule edge.',
        },
      ],
      expectedAmbiguityState: none(
        'No source ambiguity is declared for incapacitation or concentration.',
      ),
      expectedCampaignRuleOrRulingState: none(
        'No campaign rule or ruling is active.',
      ),
      expectedCapabilityStatus: {
        status: 'implemented',
        capabilityId: 'concentration-lifecycle',
        statement:
          'The concentration lifecycle capability is positively selected for the active effect and condition boundary.',
        inputs: [
          'active concentration effect',
          'condition state',
          'damage or lifecycle cause',
        ],
        exclusions: [
          'DIRECT_CONCENTRATION_BREAK_CAUSES is the closed set voluntary and forced; this capability does not decide arbitrary environmental adjudication or source meaning.',
        ],
        residualInterpretation:
          'The DM interprets applicability and any Constitution-save branch outside the bounded lifecycle state owner.',
        evidence: [
          'packages/core/src/state/activeEffects.ts',
          'packages/core/src/state/hpLifecycle.ts',
          'packages/core/src/orchestrator/toolResolveConcentration.ts',
          'packages/core/src/orchestrator/toolStartEffect.ts',
          'packages/core/src/orchestrator/toolEndEffect.ts',
          'packages/core/test/activeEffects.test.ts',
        ],
      },
      expectedDeterministicStateEffect: none(
        'The fixture inspects state-derived context but does not end or mutate a concentration effect.',
      ),
      oracleSignals: [],
    },
  ],
  probeId: 'P5',
  title: 'Incapacitation and concentration',
  verifiedAtCommit: VERIFIED_AT_COMMIT,
  gatingBlocker: {
    id: 'none',
    owningBead: 'none',
    gates: 'No blocker gates this fixture identity.',
  },
  boundedEvidenceStatement:
    'This fixture is bounded evidence for composing a condition cue with concentration state; it is not a completeness unit, not a partition of the corpus, and supplies no coverage, readiness, or completeness figure.',
};
