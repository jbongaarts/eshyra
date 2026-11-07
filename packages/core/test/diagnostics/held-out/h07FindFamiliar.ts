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

const AMBIGUITY_ID =
  'ambiguity:find-familiar-permanent-dismissal-after-zero-hp';
const INTERPRETATIONS = ['presence-required', 'active-link-sufficient'];

const SHARED_CAMPAIGN_STATE = {
  actor: {
    characterId: 'pc-yvette',
    className: 'wizard',
    level: 5,
    bondedFamiliar: {
      effectRef: 'effect-familiar-owl-1',
      spellRef: 'spell:find-familiar',
      form: 'owl',
      presence: 'absent',
      link: 'active',
      note: 'The owl dropped to 0 hit points last session and has not been recast.',
    },
  },
};

const BASE_BLOCKED_STATUS = {
  status: 'blocked' as const,
  statement:
    'The permanent-dismissal transition from the zero-hit-point absence is gated by the printed source ambiguity; the pack marks its runtime disposition engine-pending with owner campaign-ruling, so the engine does not execute it. A campaign ruling is context for the DM and does not discharge the engine-pending disposition.',
  exclusions: [
    'The engine does not execute permanent dismissal of a familiar that already vanished at 0 hit points.',
  ],
  evidence: [
    'spell:find-familiar /data/mechanics/ambiguities/0/runtimeDisposition',
    'spell:find-familiar transition permanent-dismissal-from-zero-hp-absence availability',
  ],
};

/**
 * Held-out P7 variant: source-ambiguity discovery on a different record than
 * the original, with the unresolved and the ruled executions.
 */
export const heldOutP07: DiagnosticFixture = {
  probeId: 'P7',
  title:
    'Held-out: dismissing a familiar that already vanished at 0 hit points',
  verifiedAtCommit: AUTHORED_AT_COMMIT,
  gatingBlocker: HELD_OUT_GATING_BLOCKER,
  boundedEvidenceStatement: boundedEvidence(
    'the Find Familiar permanent-dismissal scenario',
  ),
  playerInput:
    'My owl never came back after it dropped last session. I do not want the link hanging over me any more, so I dismiss the owl forever.',
  campaignState: SHARED_CAMPAIGN_STATE,
  adventureState: none('No authored adventure module is active.'),
  mustIncludeTargets: [
    rulesTarget('spell:find-familiar', 'p. 143', {
      kind: 'ambiguity-id',
      id: AMBIGUITY_ID,
    }),
  ],
  mayIncludeTargets: [rulesTarget('rule:concentration', 'p. 102')],
  mustNotIncludeTargets: [],
  requiredRetainedFacts: [
    {
      statement: 'The printed zero-hit-point disappearance clause.',
      targetRef: 'spell:find-familiar',
      exactSubstring:
        'When the familiar drops to 0 hit points, it disappears, leaving behind no physical form.',
    },
    {
      statement: 'The printed permanent-dismissal clause.',
      targetRef: 'spell:find-familiar',
      exactSubstring: 'Alternatively, you can dismiss it forever.',
    },
    {
      statement: 'The pack ambiguity question, verbatim.',
      targetRef: 'spell:find-familiar',
      typedPath: '/data/mechanics/ambiguities/0/question',
      expectedValue:
        'Can permanent dismissal terminate an active familiar relationship while the familiar is physically absent after reaching 0 hit points?',
    },
    {
      statement: 'The ambiguity carries no canonical resolution.',
      targetRef: 'spell:find-familiar',
      typedPath: '/data/mechanics/ambiguities/0/canonicalResolution',
      expectedValue: null,
    },
  ],
  evidenceNotes: [
    {
      kind: 'substrate-fact',
      statement:
        'spell:find-familiar declares ambiguity:find-familiar-permanent-dismissal-after-zero-hp with interpretations presence-required and active-link-sufficient, canonicalResolution null, runtimeDisposition { status: engine-pending, owner: campaign-ruling }, sourced to clauses "zero" and "dismissal" on SRD 5.1 p. 143.',
      why: 'Both printed clauses are individually clear; the ambiguity is whether dismissal still applies when the first clause has already removed the familiar.',
      assertionId: 'heldout-p07-find-familiar-ambiguity',
    },
    {
      kind: 'non-claim',
      statement:
        'The fixture defines no ruling storage, lifecycle or identity scheme.',
      why: 'The ruling case in the second execution uses a synthetic identity label only; ruling persistence belongs to eshyra-jhpt.',
    },
  ],
  requiredRelationshipExpansion: none(
    'No typed traversal is required; the target is reached directly and the ambiguity is carried on the record.',
  ),
  executions: [
    {
      executionId: 'no-active-ruling',
      campaignRuleState: none('No campaign rule or ruling is active.'),
      expectedRouteClasses: [
        {
          targetRef: 'spell:find-familiar',
          routes: ['direct-state-ref', 'situation-cue'],
          why: 'The sheet carries a bonded familiar effect created from the spell, and the player asks to dismiss it.',
        },
      ],
      expectedAmbiguityState: {
        kind: 'ambiguities',
        expectations: [
          {
            ambiguityId: AMBIGUITY_ID,
            expectedResolution: 'unresolved',
            interpretationIds: INTERPRETATIONS,
            statement:
              'With no active ruling the packet carries the question and both interpretations as unresolved, owner campaign-ruling.',
          },
        ],
      },
      expectedCampaignRuleOrRulingState: none('No campaign ruling is active.'),
      expectedCapabilityStatus: BASE_BLOCKED_STATUS,
      expectedDeterministicStateEffect: none(
        'The gated transition is not executed, so no state change is expected.',
      ),
      oracleSignals: [],
    },
    {
      executionId: 'active-link-sufficient-ruling',
      campaignRuleState: {
        kind: 'ruling',
        identity: 'ruling:synthetic-heldout-find-familiar-active-link',
        ambiguityId: AMBIGUITY_ID,
        selectedInterpretationId: 'active-link-sufficient',
        scope: 'this campaign',
        provenance:
          'Synthetic fixture ruling; stands in for a jhpt-supplied record.',
      },
      expectedRouteClasses: [
        {
          targetRef: 'spell:find-familiar',
          routes: ['direct-state-ref', 'situation-cue', 'campaign-ruling'],
          why: 'The same state and player text reach the record; the active ruling adds the campaign-ruling route.',
        },
      ],
      expectedAmbiguityState: {
        kind: 'ambiguities',
        expectations: [
          {
            ambiguityId: AMBIGUITY_ID,
            expectedResolution: 'resolved',
            interpretationIds: INTERPRETATIONS,
            selectedInterpretationId: 'active-link-sufficient',
            statement:
              'The packet carries the ruling beside the ambiguity and its unchosen interpretation, with identity, scope and provenance.',
          },
        ],
      },
      expectedCampaignRuleOrRulingState: {
        kind: 'campaign-rule-cases',
        cases: [
          {
            caseId: 'active-link-sufficient',
            statement:
              'A ruling selecting active-link-sufficient is presented with the source ambiguity, not instead of it.',
            ruleIdentity: 'ruling:synthetic-heldout-find-familiar-active-link',
            ruleKind: 'ruling',
            ambiguityId: AMBIGUITY_ID,
            selectedInterpretationId: 'active-link-sufficient',
            scope: 'this campaign',
            provenance:
              'Synthetic fixture ruling; stands in for a jhpt-supplied record.',
          },
        ],
      },
      expectedCapabilityStatus: BASE_BLOCKED_STATUS,
      expectedDeterministicStateEffect: none(
        'The gated transition stays unexecuted regardless of the ruling, so no state change is expected.',
      ),
      oracleSignals: [],
    },
  ],
};
