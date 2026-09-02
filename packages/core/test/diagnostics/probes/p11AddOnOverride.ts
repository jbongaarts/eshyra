import {
  CURSED_ATTUNEMENT_ADDON_PACK_ID,
  CURSED_ATTUNEMENT_ADDON_VERSION,
  CURSED_ATTUNEMENT_OVERRIDDEN_ITEM_REF,
} from '../../support/cursedAttunementAddon.js';
import type { DiagnosticFixture } from '../fixtureContract.js';
import { none, rulesTarget, VERIFIED_AT_COMMIT } from '../fixtureContract.js';

const itemKey = CURSED_ATTUNEMENT_OVERRIDDEN_ITEM_REF;

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
          packId: CURSED_ATTUNEMENT_ADDON_PACK_ID,
          version: CURSED_ATTUNEMENT_ADDON_VERSION,
        },
      ],
    },
    selectedRecord: itemKey,
  },
  adventureState: none(
    'No authored adventure state is needed for stack-integrity evidence.',
  ),
  mustIncludeTargets: [rulesTarget(itemKey, 'p. 237')],
  mayIncludeTargets: [],
  mustNotIncludeTargets: [],
  requiredRetainedFacts: none(
    'Every requirement for this probe is an evidence note rather than a packet-retention fact.',
  ),
  evidenceNotes: [
    {
      kind: 'substrate-fact',
      statement:
        'The synthetic add-on overrides the base record with an explicit override declaration; resolveRulesStack preserves the full overrideChain.',
      assertionId: 'override-chain-preserved',
      why: 'A checkable claim about the resolved stack entry.',
    },
    {
      kind: 'substrate-fact',
      statement:
        'Strict discovery and deterministic execution must agree on the same active record, system dnd5e-srd, version 5.1, and full override chain.',
      assertionId: 'strict-stack-identity-agrees',
      why: 'A checkable claim about the resolved stack identity.',
    },
    {
      kind: 'historical-annotation',
      statement:
        'Historical, pre-B3 divergence: lookup_rules used resolveStrictCampaignRulesStack while lookupCampaignRecord resolved base-only by packId and campaignBasePack in encounterCombatants.ts repeated the pattern, either one able to fall back to bundled D&D. That is the regression evidence that B3 was real; it is not a current claim about main.',
      why: 'Records the pre-B3 divergence explicitly as history, not current state.',
    },
    {
      kind: 'external-guard',
      statement:
        'Current verified state after B3 (PR #508, eshyra-6vpw): lookupCampaignRecord resolves through resolveStrictCampaignRulesStack and takes a resolver argument, campaignBasePack is gone from encounterCombatants.ts, and creature projection goes through lookupCampaignRecord. Strict discovery and deterministic execution therefore resolve the same active record, system, version, and override chain, with no silent bundled-D&D fallback.',
      guardPath: 'packages/core/test/campaignRulesStackParity.test.ts',
      guardSymbol: 'resolveStrictCampaignRulesStack',
      why: 'The deterministic half of the parity claim is proven by that test.',
    },
    {
      kind: 'external-guard',
      statement:
        'The deterministic half of this parity is already covered by packages/core/test/campaignRulesStackParity.test.ts, which landed with B3 and exercises the exact ordered add-on chain plus fail-closed behavior on unavailable or mismatched pack identities. This fixture states the discovery-side expectation and references that test rather than duplicating it.',
      guardPath: 'packages/core/test/campaignRulesStackParity.test.ts',
      guardSymbol: 'campaign rules stack parity',
      why: 'The fixture names that test as the owning guard rather than duplicating it.',
    },
  ],
  requiredRelationshipExpansion: none(
    'Stack override resolution is not a typed mechanics relationship traversal.',
  ),
  executions: [
    {
      executionId: 'default',
      campaignRuleState: none(
        'No jhpt campaign rule or ruling is active; the add-on is a rules-pack stack input, not campaign prose.',
      ),
      expectedRouteClasses: [
        {
          targetRef: itemKey,
          routes: ['direct-state-ref'],
          why: 'The selected item reference reaches the active record in the campaign stack.',
        },
      ],
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
      oracleSignals: [],
    },
  ],
  probeId: 'P11',
  title: 'Synthetic add-on override stack',
  verifiedAtCommit: VERIFIED_AT_COMMIT,
  gatingBlocker: {
    id: 'none',
    owningBead: 'eshyra-6vpw',
    gates:
      'B3 is discharged: the repair merged to main as PR #508 (32f8600). Both halves of this probe are now valid against main, so no blocker gates its evidence.',
  },
  boundedEvidenceStatement:
    'This fixture is bounded evidence for one synthetic base-plus-add-on override stack; it is not a completeness unit, not a partition of the corpus, and supplies no coverage, readiness, or completeness figure.',
};
