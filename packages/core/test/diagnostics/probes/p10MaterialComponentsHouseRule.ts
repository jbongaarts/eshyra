import type { DiagnosticFixture } from '../fixtureContract.js';
import { none, rulesTarget, VERIFIED_AT_COMMIT } from '../fixtureContract.js';

export const P10_MATERIAL_COMPONENTS_HOUSE_RULE: DiagnosticFixture = {
  playerInput:
    'I cast fireball; our campaign does not use material spell components.',
  campaignState: {
    actingCharacter: 'pc-1',
    selectedSpell: 'spell:fireball',
    campaignPosition: 'turn-12',
  },
  adventureState: none(
    'No authored adventure state is needed for this campaign-rule probe.',
  ),
  campaignRuleState: {
    source: 'eshyra-jhpt',
    scenario: 'explicit no material components house rule',
    effectiveAt: 'turn-12',
  },
  mustIncludeTargets: [rulesTarget('spell:fireball', 'p. 144')],
  mayIncludeTargets: [],
  mustNotIncludeTargets: [],
  expectedRouteClasses: [
    {
      targetRef: 'spell:fireball',
      routes: ['explicit-name-or-alias', 'campaign-rule'],
      why: 'The named spell is retained and the applicable jhpt house rule is joined beside the governing source.',
    },
  ],
  requiredRetainedFacts: [
    {
      targetRef: 'spell:fireball',
      typedPath: '/data/components',
      expectedValue: ['V', 'S', 'M'],
      statement:
        'The governing source material remains present with its material-component field.',
    },
    {
      targetRef: 'spell:fireball',
      exactSubstring: 'A target takes 8d6 fire damage on a failed save',
      statement:
        'The source material overridden by the house rule remains attributed and visible.',
    },
    {
      targetRef: 'spell:fireball',
      statement:
        'Precedence is presented: the active campaign rule governs this campaign position, but does not replace or hide the SRD source.',
    },
    {
      statement:
        'This is a house-rule case, not an ambiguity choice and not ordinary contextual adjudication about cover, visibility, or terrain.',
    },
  ],
  requiredRelationshipExpansion: none(
    'The house rule is supplied by jhpt; no typed pack relationship expansion is required.',
  ),
  expectedAmbiguityState: none(
    'This house rule intentionally has no underlying source ambiguity.',
  ),
  expectedCampaignRuleOrRulingState: {
    kind: 'campaign-rule-cases',
    cases: [
      {
        caseId: 'active-jhpt-house-rule',
        ruleIdentity: 'supplied by eshyra-jhpt at runtime',
        ruleKind: 'house-rule',
        scope:
          'campaign position turn-12; material components for spell casting',
        provenance:
          'player-provided or player-approved durable prose from eshyra-jhpt',
        statement:
          'The packet carries stable identity, kind house-rule, status/origin/provenance, effective position, applicability route campaign-rule, and precedence beside the unchanged Fireball source.',
      },
    ],
  },
  expectedCapabilityStatus: {
    status: 'none-selected',
    statement:
      'No capability is positively selected for interpreting or compiling the house-rule prose.',
    inputs: ['active jhpt rule projection', 'spell:fireball source'],
    exclusions: [
      'No material-component rule is persisted, compiled, or resolved inside this fixture; ordinary cover, visibility, and terrain judgments are not campaign rules.',
    ],
    residualInterpretation:
      'The DM applies the presented campaign precedence and still adjudicates the spell.',
  },
  expectedDeterministicStateEffect: none(
    'The fixture supplies context only and does not cast the spell or write campaign rule state.',
  ),
  probeId: 'P10',
  title: 'Material-components house rule',
  verifiedAtCommit: VERIFIED_AT_COMMIT,
  gatingBlocker: {
    id: 'none',
    owningBead: 'eshyra-jhpt.1',
    gates:
      'The fixture records the acceptance shape for the jhpt authoring/storage/read path; no local ruling model is created.',
  },
  boundedEvidenceStatement:
    'This fixture is bounded evidence for a non-ambiguity campaign house rule; it is not a completeness unit, not a partition of the corpus, and supplies no coverage, readiness, or completeness figure.',
  oracleSignals: [
    {
      label: 'jhpt-house-rule-state',
      supplies:
        'The active durable house-rule prose, identity, scope, status, origin, provenance, effective position, and applicability signal.',
      why: 'Those facts belong to eshyra-jhpt; fixture-provided rule state cannot be reported as end-to-end discovery success.',
    },
  ],
};
