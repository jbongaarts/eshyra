import type { DiagnosticFixture } from '../fixtureContract.js';
import {
  none,
  rulesTarget,
  SRD_SOURCE_REF,
  VERIFIED_AT_COMMIT,
} from '../fixtureContract.js';

const bounded =
  'This fixture is bounded evidence for implicit cover in this named scenario; it is not a completeness unit, not a partition of the corpus, and supplies no coverage, readiness, or completeness figure.';

export const P01_COVER: DiagnosticFixture = {
  playerInput:
    'I duck behind this low wall and fire across the courtyard at the sentry.',
  campaignState: {
    actingCharacter: 'pc-1',
    combat: {
      attacker: 'pc-1',
      target: 'sentry',
      geometry: 'low wall between them',
    },
  },
  adventureState: none(
    'No adventure module state is required for this geometry probe.',
  ),
  mustIncludeTargets: [rulesTarget('rule:cover', 'p. 96')],
  mayIncludeTargets: [],
  mustNotIncludeTargets: [],
  requiredRetainedFacts: [
    {
      targetRef: 'rule:cover',
      exactSubstring:
        'A target has half cover if an obstacle blocks at least half of its body.',
      statement:
        'The packet retains the source prose defining the low-wall half-cover cue.',
    },
    {
      targetRef: 'rule:cover',
      exactSubstring:
        'A target with half cover has a +2 bonus to AC and Dexterity saving throws.',
      statement:
        'The packet retains the AC and Dexterity-save consequence as prose; no deterministic degree-of-cover selection is inferred.',
    },
    {
      statement:
        'The player input intentionally contains no occurrence of the word cover; the cue is geometry plus combat context.',
    },
  ],
  requiredRelationshipExpansion: none(
    'rule:cover carries only data.text and has no typed relationship expansion.',
  ),
  executions: [
    {
      executionId: 'default',
      campaignRuleState: none('No active campaign rule or ruling.'),
      expectedRouteClasses: [
        {
          targetRef: 'rule:cover',
          routes: ['situation-cue'],
          why: 'The low-wall geometry and combat context propose the rule without a rule-name mention.',
        },
      ],
      expectedAmbiguityState: none(
        'No source ambiguity is declared for this probe.',
      ),
      expectedCampaignRuleOrRulingState: none(
        'No campaign rule or ruling is active.',
      ),
      expectedCapabilityStatus: {
        status: 'none-selected',
        statement:
          'No capability is positively selected. Degree-of-cover selection remains model adjudication; any +2/+5 AC and Dexterity-save modifier rides declared modifiers on resolve_check.',
        inputs: [
          'geometry and combat context',
          'resolve_check declared modifiers',
        ],
        exclusions: [
          'No deterministic capability applies a cover bonus or selects a cover degree.',
        ],
        residualInterpretation:
          'The DM decides applicability and degree of cover.',
      },
      expectedDeterministicStateEffect: none(
        'Discovery supplies context only; it does not apply a cover bonus or mutate state.',
      ),
      oracleSignals: [],
    },
  ],
  probeId: 'P1',
  title: 'Implicit cover from geometry',
  verifiedAtCommit: VERIFIED_AT_COMMIT,
  gatingBlocker: {
    id: 'none',
    owningBead: 'none',
    gates: 'No blocker gates this fixture identity.',
  },
  boundedEvidenceStatement: bounded,
};

export { SRD_SOURCE_REF };
