import type { DiagnosticFixture } from '../fixtureContract.js';
import { none, rulesTarget, VERIFIED_AT_COMMIT } from '../fixtureContract.js';

const ambiguityId = 'ambiguity:cube-of-force-same-face-duration-reset';

export const P07_CUBE_OF_FORCE: DiagnosticFixture = {
  playerInput:
    'I press face 1 of the Cube of Force again while face 1 is active.',
  campaignState: {
    actingCharacter: 'pc-1',
    itemInstance: 'cube-1',
    itemRecord: 'magic-item:cube-of-force',
    machineState: 'face-1',
    operationId: 'press-face-1',
  },
  adventureState: none(
    'No authored adventure state is needed for this item ambiguity probe.',
  ),
  campaignRuleState: {
    cases: [
      'without-active-ruling',
      'with-active-ruling-supplied-by-eshyra-jhpt',
    ],
    owner: 'eshyra-jhpt',
  },
  mustIncludeTargets: [
    rulesTarget('magic-item:cube-of-force', 'p. 215', {
      kind: 'ambiguity-id',
      id: ambiguityId,
    }),
  ],
  mayIncludeTargets: [],
  mustNotIncludeTargets: [],
  expectedRouteClasses: [
    {
      targetRef: 'magic-item:cube-of-force',
      routes: ['direct-state-ref', 'campaign-ruling', 'capability-preflight'],
      why: 'The active item operation identifies the record, jhpt may supply a ruling, and readiness preflight requires the item clause.',
    },
  ],
  requiredRetainedFacts: [
    {
      targetRef: 'magic-item:cube-of-force',
      exactSubstring:
        'You can change the barrier’s effect by pressing a different face of the cube and expending the requisite number of charges, resetting the duration.',
      statement:
        'The source’s different-face duration language remains visible beside the ambiguity.',
    },
    {
      targetRef: 'magic-item:cube-of-force',
      exactSubstring: 'lasts for 1 minute',
      statement: 'The source’s one-minute duration remains visible.',
    },
    {
      targetRef: 'magic-item:cube-of-force',
      typedPath: '/data/mechanics/stateMachine/transitions/5/resetsDuration',
      expectedValue: { kind: 'source-ambiguity', ambiguityId },
      statement:
        'The face-1 to face-1 transition carries the source ambiguity.',
    },
    {
      targetRef: 'magic-item:cube-of-force',
      statement:
        'Every press-face operation clause is engine-pending; assertMagicItemOperationReady runs before matchStateTransition, so use_item is blocked by readiness first.',
    },
    {
      targetRef: 'magic-item:cube-of-force',
      statement:
        'The fixture defines no ruling persistence model, schema, store, resolver, or lifecycle.',
    },
  ],
  requiredRelationshipExpansion: none(
    'The ambiguity is declared on the item record; no typed relationship expansion is required.',
  ),
  expectedAmbiguityState: {
    kind: 'ambiguities',
    expectations: [
      {
        ambiguityId,
        expectedResolution: 'unresolved',
        interpretationIds: ['same-face-resets', 'different-face-only-resets'],
        statement:
          'The pack has no canonical resolution; both published interpretations remain visible.',
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
        scope:
          'magic-item:cube-of-force / ambiguity:cube-of-force-same-face-duration-reset',
        provenance: 'No campaign ruling supplied.',
      },
      {
        caseId: 'with-active-ruling',
        statement:
          'An active ruling supplied by eshyra-jhpt appears beside the ambiguity with its identity, scope, and provenance; the exact durable identity is owned by jhpt and is not invented here.',
        ruleIdentity: 'supplied by eshyra-jhpt at runtime',
        ruleKind: 'ruling',
        scope: 'ambiguity:cube-of-force-same-face-duration-reset',
        provenance: 'eshyra-jhpt campaign-rule read interface',
      },
    ],
  },
  expectedCapabilityStatus: {
    status: 'blocked',
    capabilityId: 'magic-item-operation-readiness',
    revision: 'derived-magic-item-clauses-v1',
    statement:
      'Preflight is blocked in both no-ruling and active-ruling cases because readiness remains engine-pending independently of ruling resolution.',
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
  },
  expectedDeterministicStateEffect: none(
    'No item operation executes while readiness is blocked.',
  ),
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
  oracleSignals: [
    {
      label: 'jhpt-active-ruling',
      supplies:
        'The active ruling identity, scope, and provenance for the resolved-ruling case.',
      why: 'The campaign-rule domain and durable identity belong to eshyra-jhpt; a fixture-supplied ruling cannot be mistaken for end-to-end discovery.',
    },
  ],
};
