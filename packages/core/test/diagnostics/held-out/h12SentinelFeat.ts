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
 * Held-out P12 variant (baseline integrity): false SRD authority by absence.
 * The original false-authority record no longer exists in the pack, so this
 * variant tests the standing rule on a different, plausible request: a named
 * feat that SRD 5.1 does not contain. Discovery must surface the optional-feats
 * rule and the one SRD feat, and must never present an invented record for the
 * requested feat as SRD authority.
 */
export const heldOutP12: DiagnosticFixture = {
  probeId: 'P12',
  title: 'Held-out: a feat the SRD does not contain is not given SRD authority',
  verifiedAtCommit: AUTHORED_AT_COMMIT,
  gatingBlocker: HELD_OUT_GATING_BLOCKER,
  boundedEvidenceStatement: boundedEvidence('the absent-feat scenario'),
  playerInput:
    'I just hit 4th level. Instead of the ability score increase I want to take the Sentinel feat. What exactly does it say, and can I take it?',
  campaignState: {
    actor: {
      characterId: 'pc-odalys',
      className: 'fighter',
      level: 4,
      strength: 16,
      pendingLevelUp: {
        toLevel: 4,
        grants: ['feature:fighter:ability-score-improvement'],
      },
    },
  },
  adventureState: none('No authored adventure module is active.'),
  mustIncludeTargets: [
    rulesTarget('rule:feats', 'p. 75'),
    rulesTarget('feat:grappler', 'p. 75'),
  ],
  mayIncludeTargets: [
    rulesTarget('feature:fighter:ability-score-improvement', 'p. 25'),
    rulesTarget('rule:ability-score-increase', 'p. 3'),
  ],
  mustNotIncludeTargets: [
    {
      targetKind: 'absent-rules-record',
      recordKey: 'feat:sentinel',
      reason:
        'SRD 5.1 contains only the Grappler feat; a record for Sentinel would be invented content carrying SRD authority.',
    },
  ],
  requiredRetainedFacts: [
    {
      statement:
        'The optional-feats clause that lets a character take a feat instead of the ability score improvement.',
      targetRef: 'rule:feats',
      exactSubstring:
        'Using the optional feats rule, you can forgo taking that feature to take a feat of your choice instead.',
    },
    {
      statement: 'The prerequisite requirement for any feat.',
      targetRef: 'rule:feats',
      exactSubstring:
        'You must meet any prerequisite specified in a feat to take that feat.',
    },
    {
      statement: 'The only SRD feat’s printed prerequisite.',
      targetRef: 'feat:grappler',
      typedPath: '/data/prerequisites',
      expectedValue: 'Strength 13 or higher',
    },
  ],
  evidenceNotes: [
    {
      kind: 'substrate-fact',
      statement:
        'The committed pack holds exactly one feat record, feat:grappler (SRD 5.1 p. 75), and no record keyed feat:sentinel.',
      why: 'The fixture asserts the absence of one named record, not a count of feats.',
      assertionId: 'heldout-p12-no-sentinel-feat-record',
    },
    {
      kind: 'non-claim',
      statement:
        'The fixture does not claim the Sentinel feat does not exist in any D&D publication.',
      why: 'It claims only that the committed SRD 5.1 pack does not contain it and no discovery output may present it as SRD content.',
    },
    {
      kind: 'non-claim',
      statement:
        'The original false-authority record (starting wealth) is no longer in the pack, so this variant exercises absence rather than quarantine of a known-false record.',
      why: 'Recorded so the probe is not read as re-testing the original defect class.',
    },
  ],
  requiredRelationshipExpansion: none(
    'No typed traversal is required; both targets are reached directly.',
  ),
  executions: [
    {
      executionId: 'sentinel-feat-request',
      campaignRuleState: none('No campaign rule or ruling is active.'),
      expectedRouteClasses: [
        {
          targetRef: 'rule:feats',
          routes: ['explicit-name-or-alias', 'situation-cue'],
          why: 'The player asks to take a feat in place of the ability score increase at a level-up.',
        },
        {
          targetRef: 'feat:grappler',
          routes: ['situation-cue'],
          why: 'The feat request reaches the pack’s only feat record, which shows what SRD feats look like and that no Sentinel record is present.',
        },
      ],
      expectedAmbiguityState: none('No ambiguity applies to this request.'),
      expectedCampaignRuleOrRulingState: none('No campaign rule is active.'),
      expectedCapabilityStatus: {
        status: 'none-selected',
        statement:
          'No deterministic capability is positively selected for feat selection through rule discovery; the ledger records rule:feats as an implemented row with no selected capability.',
        evidence: [
          'packages/core/src/rules/deterministicCapabilityLedger.ts#RULE_DETERMINISTIC_CAPABILITY_DISPOSITIONS',
        ],
      },
      expectedDeterministicStateEffect: none(
        'No state change is warranted until the DM resolves what the table will allow; none may be derived from an invented SRD record.',
      ),
      oracleSignals: [],
    },
  ],
};
