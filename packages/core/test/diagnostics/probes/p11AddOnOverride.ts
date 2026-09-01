import type { DiagnosticFixture } from '../fixtureContract.js';
import { none, rulesTarget, VERIFIED_AT_COMMIT } from '../fixtureContract.js';

const itemKey = 'magic-item:ring-of-protection';

export const P11_ADDON_OVERRIDE: DiagnosticFixture = {
  playerInput: 'Use the campaign version of the Ring of Protection.',
  campaignState: {
    campaignRulesBinding: {
      base: {
        systemId: 'dnd5e-srd',
        packId: 'rules:dnd5e-srd-5.1',
        version: '5.1',
      },
      addons: [
        {
          systemId: 'dnd5e-srd',
          packId: 'rules:test-cursed-attunement-addon',
          version: '1.0.0',
        },
      ],
    },
    selectedRecord: itemKey,
  },
  adventureState: none(
    'No authored adventure state is needed for stack-integrity evidence.',
  ),
  campaignRuleState: none(
    'No jhpt campaign rule or ruling is active; the add-on is a rules-pack stack input, not campaign prose.',
  ),
  mustIncludeTargets: [rulesTarget(itemKey, 'p. 237')],
  mayIncludeTargets: [],
  mustNotIncludeTargets: [],
  expectedRouteClasses: [
    {
      targetRef: itemKey,
      routes: ['direct-state-ref'],
      why: 'The selected item reference reaches the active record in the campaign stack.',
    },
  ],
  requiredRetainedFacts: [
    {
      targetRef: itemKey,
      statement:
        'The synthetic add-on overrides the base record with an explicit override declaration; resolveRulesStack preserves the full overrideChain.',
    },
    {
      targetRef: itemKey,
      statement:
        'Strict discovery and deterministic execution must agree on the same active record, system dnd5e-srd, version 5.1, and full override chain.',
    },
    {
      statement:
        'Before B3, lookup_rules used resolveStrictCampaignRulesStack while lookupCampaignRecord and campaignBasePack resolved base-only and could fall back to bundled D&D; the after half is gated on eshyra-6vpw-deterministic-pack-stack landing, even though bead eshyra-6vpw is marked closed.',
    },
    {
      statement:
        'The after state must not silently fall back to bundled D&D when the selected add-on stack is unavailable.',
    },
  ],
  requiredRelationshipExpansion: none(
    'Stack override resolution is not a typed mechanics relationship traversal.',
  ),
  expectedAmbiguityState: none(
    'No source ambiguity is declared for the synthetic override stack.',
  ),
  expectedCampaignRuleOrRulingState: none(
    'No campaign rule or ruling is active.',
  ),
  expectedCapabilityStatus: {
    status: 'none-selected',
    statement:
      'No deterministic item capability is selected; this probe checks identity parity between discovery and execution resolution.',
    inputs: [
      'exact campaign binding',
      'base and synthetic add-on pack identities',
    ],
    exclusions: [
      'The fixture does not define a new pack schema, resolver, persistence model, or capability.',
    ],
    residualInterpretation:
      'The runtime consumers own the mechanics after they receive the same active record.',
  },
  expectedDeterministicStateEffect: none(
    'The fixture does not attune, use, or mutate the overridden item.',
  ),
  probeId: 'P11',
  title: 'Synthetic add-on override stack',
  verifiedAtCommit: VERIFIED_AT_COMMIT,
  gatingBlocker: {
    id: 'B3',
    owningBead: 'eshyra-6vpw',
    gates:
      'The before divergence is regression evidence; the strict after-parity half waits for the repair branch eshyra-6vpw-deterministic-pack-stack to land.',
  },
  boundedEvidenceStatement:
    'This fixture is bounded evidence for one synthetic base-plus-add-on override stack; it is not a completeness unit, not a partition of the corpus, and supplies no coverage, readiness, or completeness figure.',
  oracleSignals: [],
};
