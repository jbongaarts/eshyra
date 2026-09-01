import type { DiagnosticFixture } from '../fixtureContract.js';
import { none, rulesTarget, VERIFIED_AT_COMMIT } from '../fixtureContract.js';

const itemKey = 'magic-item:ammunition-1-2-or-3';

export const P08_AMMUNITION: DiagnosticFixture = {
  playerInput: 'I fire this piece of magic ammunition and hit the target.',
  campaignState: {
    actingCharacter: 'pc-1',
    inventoryInstance: 'ammunition-stack-1',
    operationId: 'hit-target',
  },
  adventureState: none(
    'No authored adventure state is needed for this capability preflight probe.',
  ),
  campaignRuleState: none('No active campaign rule or ruling.'),
  mustIncludeTargets: [
    rulesTarget(itemKey, 'p. 207', {
      kind: 'stable-id',
      idKind: 'operation',
      id: 'hit-target',
    }),
    rulesTarget(itemKey, 'p. 207', {
      kind: 'stable-id',
      idKind: 'clause',
      id: `${itemKey}/c1-use`,
    }),
    rulesTarget(itemKey, 'p. 207', {
      kind: 'stable-id',
      idKind: 'clause',
      id: `${itemKey}/c2-static-ammunition-rarity-attack-damage`,
    }),
  ],
  mayIncludeTargets: [],
  mustNotIncludeTargets: [],
  expectedRouteClasses: [
    {
      targetRef: itemKey,
      routes: ['direct-state-ref', 'capability-preflight'],
      why: 'The inventory item reference directly identifies the record and readiness preflight selects the positively owned use clause.',
    },
  ],
  requiredRetainedFacts: [
    {
      targetRef: itemKey,
      exactSubstring:
        'Once it hits a target, the ammunition is no longer magical.',
      statement: 'The stateless single-use depletion prose is retained.',
    },
    {
      targetRef: itemKey,
      exactSubstring: 'uncommon (+1), rare (+2), or very rare (+3)',
      statement:
        'The free-text rarity alternatives remain visible; no bonus is selected from the string.',
    },
    {
      targetRef: itemKey,
      typedPath: '/data/mechanics/economies/use',
      expectedValue: {
        kind: 'single-use',
        onDepleted: { loseProperty: true, becomes: 'nonmagical' },
      },
      statement:
        'The use economy and nonmagical depletion effect are retained.',
    },
    {
      targetRef: itemKey,
      typedPath: '/data/executionReadiness/clauses/0',
      expectedValue: {
        clauseId: `${itemKey}/c1-use`,
        scope: { kind: 'parent' },
        tag: 'C1',
        representation: { block: 'economies', economyId: 'use' },
        readiness: 'green',
      },
      statement: 'The generated readiness identity is retained.',
    },
    {
      targetRef: itemKey,
      statement:
        'The sibling C2 effects clause is engine-pending on F8 derived combat modifier application; the +1/+2/+3 attack and damage bonus is not executed.',
    },
    {
      targetRef: itemKey,
      statement:
        'The four other green operations that declare no cost and no effects are absence-of-blocker observations, not positive capability evidence; candle-of-invocation can be green while declaring an F5 hook.',
    },
  ],
  requiredRelationshipExpansion: none(
    'The ammunition capability is selected from the item record; no typed relationship expansion is required.',
  ),
  expectedAmbiguityState: none(
    'No source ambiguity is declared for this ammunition operation.',
  ),
  expectedCampaignRuleOrRulingState: none(
    'No campaign rule or ruling is active.',
  ),
  expectedCapabilityStatus: {
    status: 'available',
    capabilityId: 'magic-item-single-use-spend',
    revision: 'derived-magic-item-clauses-v1',
    statement:
      'The generated query selected hit-target because its parent C1 use economy is green and positively owned with no engine hooks.',
    inputs: [
      'use_item { instanceId, operationId: hit-target, character? }',
      'cost economy use amount 1',
    ],
    exclusions: [
      'C2 attack and damage modifiers are not executed.',
      'The free-text rarity does not determine which bonus applies.',
      'Green operations with no cost/effects are not positive capability evidence.',
    ],
    residualInterpretation:
      'The DM interprets any attack result and bonus choice; F8 remains outside this capability.',
    evidence: [
      'packages/core/src/state/itemState.ts:1888-1911',
      'packages/core/src/state/itemState.ts:1710',
      'packages/core/src/state/itemState.ts:2127',
    ],
  },
  expectedDeterministicStateEffect: {
    kind: 'effect',
    statement:
      'A stateless single-use spend consumes one unit, splits the consumed unit out of the stack, and creates nonmagical inventory.',
    evidence:
      'splitNonmagicalSingleUseInventory preserves the physical row while nulling the magic binding for the transformed unit.',
  },
  probeId: 'P8',
  title: 'Positive magic-ammunition capability',
  verifiedAtCommit: VERIFIED_AT_COMMIT,
  gatingBlocker: {
    id: 'B5',
    owningBead: 'eshyra-uiax',
    gates:
      'Until the unrecognized-scope fail-open is corrected, passing the readiness contract cannot be trusted as capability evidence.',
  },
  boundedEvidenceStatement:
    'This fixture is bounded evidence for the selected ammunition operation and its partial capability; it is not a completeness unit, not a partition of the corpus, and supplies no coverage, readiness, or completeness figure.',
  oracleSignals: [],
};
