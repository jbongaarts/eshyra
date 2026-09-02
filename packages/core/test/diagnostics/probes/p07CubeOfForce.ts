import type { DiagnosticFixture } from '../fixtureContract.js';
import { none, rulesTarget, VERIFIED_AT_COMMIT } from '../fixtureContract.js';

const ambiguityId = 'ambiguity:cube-of-force-same-face-duration-reset';
const itemKey = 'magic-item:cube-of-force';
const selectedInterpretationId = 'same-face-resets';

const expectedCapabilityStatus = {
  status: 'blocked' as const,
  capabilityId: 'magic-item-operation-readiness',
  revision: 'derived-magic-item-clauses-v1',
  statement:
    'Preflight is blocked in both no-ruling and active-ruling executions because readiness remains engine-pending independently of ruling resolution.',
  inputs: [
    'use_item instanceId',
    'operationId press-face-1',
    'item state face-1',
    ambiguityId,
  ],
  exclusions: [
    'A jhpt ruling does not make an engine-pending readiness clause green.',
    'The ambiguity error is currently behind readiness in use_item.',
  ],
  residualInterpretation:
    'The campaign ruling resolves interpretation only; an engine owner must separately make the operation executable.',
  evidence: [
    'packages/core/src/state/itemState.ts:1888',
    'packages/core/src/state/itemState.ts:1934',
  ],
};

export const P07_CUBE_OF_FORCE: DiagnosticFixture = {
  playerInput:
    'I press face 1 of the Cube of Force again while face 1 is active.',
  campaignState: {
    actingCharacter: 'pc-1',
    itemInstance: 'cube-1',
    itemRecord: itemKey,
    machineState: 'face-1',
    operationId: 'press-face-1',
  },
  adventureState: none(
    'No authored adventure state is needed for this item ambiguity probe.',
  ),
  mustIncludeTargets: [
    rulesTarget(itemKey, 'p. 215', {
      kind: 'ambiguity-id',
      id: ambiguityId,
    }),
  ],
  mayIncludeTargets: [],
  mustNotIncludeTargets: [],
  requiredRetainedFacts: [
    {
      targetRef: itemKey,
      exactSubstring:
        'You can change the barrier’s effect by pressing a different face of the cube and expending the requisite number of charges, resetting the duration.',
      statement:
        'The source’s different-face duration language remains visible beside the ambiguity.',
    },
    {
      targetRef: itemKey,
      exactSubstring: 'lasts for 1 minute',
      statement: 'The source’s one-minute duration remains visible.',
    },
    {
      targetRef: itemKey,
      typedPath: '/data/mechanics/stateMachine/transitions/5/resetsDuration',
      expectedValue: { kind: 'source-ambiguity', ambiguityId },
      statement:
        'The face-1 to face-1 transition carries the source ambiguity.',
    },
    {
      targetRef: itemKey,
      statement:
        'Every press-face operation clause is engine-pending; assertMagicItemOperationReady runs before matchStateTransition, so use_item is blocked by readiness first.',
    },
    {
      targetRef: itemKey,
      statement:
        'The fixture defines no ruling persistence model, schema, store, resolver, or lifecycle.',
    },
  ],
  requiredRelationshipExpansion: none(
    'The ambiguity is declared on the item record; no typed relationship expansion is required.',
  ),
  executions: [
    {
      executionId: 'without-active-ruling',
      campaignRuleState: none(
        'No active ruling is supplied; the ambiguity remains unresolved and its owner is campaign-ruling.',
      ),
      expectedRouteClasses: [
        {
          targetRef: itemKey,
          routes: ['direct-state-ref', 'capability-preflight'],
          why: 'The active item operation identifies the record and readiness preflight requires the item clause; no campaign-ruling route exists without an active ruling.',
        },
      ],
      expectedAmbiguityState: {
        kind: 'ambiguities',
        expectations: [
          {
            ambiguityId,
            expectedResolution: 'unresolved',
            interpretationIds: [
              'same-face-resets',
              'different-face-only-resets',
            ],
            statement:
              'Without an active ruling, the pack has no canonical resolution and both published interpretations remain visible.',
          },
        ],
      },
      expectedCampaignRuleOrRulingState: {
        kind: 'campaign-rule-cases',
        cases: [
          {
            caseId: 'without-active-ruling',
            statement:
              'No active ruling is present; the packet states unresolved and owner campaign-ruling beside the ambiguity.',
            ruleKind: 'ruling',
            scope: `${itemKey} / ${ambiguityId}`,
            provenance: 'No campaign ruling supplied.',
          },
        ],
      },
      expectedCapabilityStatus,
      expectedDeterministicStateEffect: none(
        'No item operation executes while readiness is blocked.',
      ),
      oracleSignals: [],
    },
    {
      executionId: 'with-active-ruling',
      campaignRuleState: {
        source: 'eshyra-jhpt',
        ruling: 'active ruling supplied by eshyra-jhpt',
        scope: ambiguityId,
        selectedInterpretationId,
      },
      expectedRouteClasses: [
        {
          targetRef: itemKey,
          routes: [
            'direct-state-ref',
            'campaign-ruling',
            'capability-preflight',
          ],
          why: 'The active item operation identifies the record, jhpt supplies the campaign-ruling route, and readiness preflight still requires the item clause.',
        },
      ],
      expectedAmbiguityState: {
        kind: 'ambiguities',
        expectations: [
          {
            ambiguityId,
            expectedResolution: 'resolved',
            interpretationIds: [
              'same-face-resets',
              'different-face-only-resets',
            ],
            selectedInterpretationId,
            statement:
              'The supplied jhpt ruling selects same-face-resets for the already-active face while retaining both published interpretation identities beside it; this selection is oracle-supplied, not the pack canonical resolution.',
          },
        ],
      },
      expectedCampaignRuleOrRulingState: {
        kind: 'campaign-rule-cases',
        cases: [
          {
            caseId: 'with-active-ruling',
            statement:
              'An active ruling supplied by eshyra-jhpt appears beside the ambiguity with its identity, scope, and provenance; the exact durable identity is owned by jhpt and is not invented here.',
            ruleIdentity: 'supplied by eshyra-jhpt at runtime',
            ruleKind: 'ruling',
            ambiguityId,
            selectedInterpretationId,
            scope: ambiguityId,
            provenance: 'eshyra-jhpt campaign-rule read interface',
          },
        ],
      },
      expectedCapabilityStatus,
      expectedDeterministicStateEffect: none(
        'The ruling resolves interpretation only; readiness remains blocked, so no item operation executes.',
      ),
      oracleSignals: [
        {
          label: 'jhpt-active-ruling',
          supplies:
            'The active ruling identity, scope, provenance, and selected interpretation same-face-resets for the resolved-ruling execution.',
          why: 'The campaign-rule domain and durable identity belong to eshyra-jhpt; a fixture-supplied ruling cannot be mistaken for end-to-end discovery.',
        },
      ],
    },
  ],
  probeId: 'P7',
  title: 'Cube of Force same-face duration ambiguity',
  verifiedAtCommit: VERIFIED_AT_COMMIT,
  gatingBlocker: {
    id: 'none',
    owningBead: 'none',
    gates:
      'The fixture identity is verified; jhpt and capability behavior gate downstream evidence, not authoring.',
  },
  boundedEvidenceStatement:
    'This fixture is bounded evidence for the named Cube of Force ambiguity and preflight distinction; it is not a completeness unit, not a partition of the corpus, and supplies no coverage, readiness, or completeness figure.',
};
