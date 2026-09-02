import type { DiagnosticFixture } from '../fixtureContract.js';
import { none, rulesTarget, VERIFIED_AT_COMMIT } from '../fixtureContract.js';

const historicalAttribution =
  'This work includes material taken from the System Reference Document 5.1 ("SRD 5.1") by Wizards of the Coast LLC and available at https://dnd.wizards.com/resources/systems-reference-document. The SRD 5.1 is licensed under the Creative Commons Attribution 4.0 International License available at https://creativecommons.org/licenses/by/4.0/legalcode.';

export const P12_STARTING_WEALTH: DiagnosticFixture = {
  playerInput:
    'Create a fighter and determine starting wealth from the active rules.',
  campaignState: {
    actingCharacter: 'fighter-1',
    classKey: 'class:fighter',
    characterCreationStep: 'starting-wealth',
  },
  adventureState: none(
    'No authored adventure state is relevant to character creation.',
  ),
  campaignRuleState: none(
    'No active campaign rule or ruling supplies starting wealth.',
  ),
  mustIncludeTargets: [rulesTarget('class:fighter', 'p. 24')],
  mayIncludeTargets: [],
  mustNotIncludeTargets: [
    {
      targetKind: 'absent-rules-record',
      recordKey: 'table:starting-wealth-by-class',
      reason:
        'The B4 repair removed the false SRD-authority record; discovery must not surface it.',
    },
  ],
  expectedRouteClasses: [
    {
      targetRef: 'class:fighter',
      routes: ['direct-state-ref'],
      why: 'Character creation directly identifies the selected fighter class while checking for starting-wealth support.',
    },
  ],
  requiredRetainedFacts: [
    {
      targetRef: 'class:fighter',
      statement:
        'The reconciled character-creation path reports STARTING_WEALTH_UNAVAILABLE_MESSAGE with code not_found when no active pack provides the table, never malformed.',
    },
    {
      statement:
        'Historical false-authority evidence only: source "SRD 5.1 p. 38" and provenance locator "p. 38" were attached to the removed compiler-authored record; this is not a current pack assertion and must never be treated as SRD authority.',
    },
    {
      statement: `Historical false-authority evidence only, asserted as prose and deliberately NOT bound to the live pack: the removed compiler-authored record carried the pack's SRD attribution block (${historicalAttribution}). That block is the pack's own legitimate CC-BY-4.0 license text and is still present in pack meta for the genuine SRD material; its presence there is evidence about the pack license, never about the removed record. Binding this fact to pack meta would assert live SRD authority under a historical label, which is the exact laundering this probe forbids.`,
    },
    {
      statement:
        'The licensed supplement re-enable path is packages/core/test/support/startingWealthSupplement.ts; the standing guard is packages/core/test/srdGeneratedPack.test.ts and is referenced rather than duplicated here.',
    },
    {
      statement:
        'Discovery success must never launder known false provenance through the DM context packet.',
    },
  ],
  requiredRelationshipExpansion: none(
    'Starting-wealth absence and licensed-supplement selection require no typed relationship expansion.',
  ),
  expectedAmbiguityState: none(
    'No source ambiguity is declared for starting wealth.',
  ),
  expectedCampaignRuleOrRulingState: none(
    'No campaign rule or ruling is active.',
  ),
  expectedCapabilityStatus: {
    status: 'none-selected',
    statement:
      'No starting-wealth capability is positively selected from the absent SRD target; a separately identified licensed supplement may re-enable the path.',
    inputs: ['class:fighter', 'active rules stack'],
    exclusions: [
      'Absence is not malformed, and no source authority is inferred from a removed record or its historical attribution block.',
    ],
    residualInterpretation:
      'Character creation reports availability or not_found from the active stack.',
  },
  expectedDeterministicStateEffect: none(
    'The fixture does not create a character or roll starting wealth.',
  ),
  probeId: 'P12',
  title: 'False SRD authority for starting wealth',
  verifiedAtCommit: VERIFIED_AT_COMMIT,
  gatingBlocker: {
    id: 'none',
    owningBead: 'eshyra-o9bd.19.2.1.1',
    gates:
      'B4 is closed and the post-repair absence is the current verified state.',
  },
  boundedEvidenceStatement:
    'This fixture is bounded evidence for the absence of one known false-authority target and the reconciled character-creation path; it is not a completeness unit, not a partition of the corpus, and supplies no coverage, readiness, or completeness figure.',
  oracleSignals: [],
};
