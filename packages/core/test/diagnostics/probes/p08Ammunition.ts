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
  ],
  evidenceNotes: [
    {
      kind: 'packet-semantic',
      statement:
        'The sibling C2 effects clause is engine-pending on F8 derived combat modifier application; the +1/+2/+3 attack and damage bonus is not executed.',
      assertionId: 'ammunition-c2-engine-pending-disclosed',
      why: 'The claim is that the unexecuted sibling clause is disclosed.',
    },
    {
      kind: 'non-claim',
      statement:
        'The four other green operations that declare no cost and no effects are absence-of-blocker observations, not positive capability evidence; candle-of-invocation can be green while declaring an F5 hook.',
      why: 'Explicitly disclaims that green-with-no-cost operations are capability evidence.',
    },
  ],
  requiredRelationshipExpansion: none(
    'The ammunition capability is selected from the item record; no typed relationship expansion is required.',
  ),
  executions: [
    {
      executionId: 'default',
      campaignRuleState: none('No active campaign rule or ruling.'),
      expectedRouteClasses: [
        {
          targetRef: itemKey,
          routes: ['direct-state-ref', 'capability-preflight'],
          why: 'The inventory item reference directly identifies the record and readiness preflight selects the positively owned use clause.',
        },
      ],
      expectedAmbiguityState: none(
        'No source ambiguity is declared for this ammunition operation.',
      ),
      expectedCampaignRuleOrRulingState: none(
        'No campaign rule or ruling is active.',
      ),
      expectedCapabilityStatus: {
        status: 'available',
        // The contract the runtime ACTUALLY commits under, quoted from
        // `MAGIC_ITEM_OPERATION_READINESS_CAPABILITY` rather than restated.
        //
        // This fixture previously named `magic-item-single-use-spend` with
        // execution-shaped inputs and exclusions. No such contract exists:
        // the only capability positively selected here is the readiness
        // PREFLIGHT, which explicitly does not execute the item operation.
        // `packet.ts` already warned against relabelling the readiness
        // contract that way, and W10's E8 makes the fixture-to-packet match
        // part of this bead's acceptance evidence, so a fixture naming a
        // capability nothing implements could not be left as descriptive
        // metadata (PR #543 re-review, finding 3; eshyra-o9bd.19.12.10).
        capabilityId: 'assertMagicItemOperationReady',
        revision: 'derived-magic-item-clauses-v1',
        statement:
          'The readiness preflight positively selects hit-target because its parent C1 use economy is green and positively owned with no engine hooks. The preflight commits to readiness only; executing the spend is not part of this contract.',
        inputs: [
          'A magic-item RulesRecord carrying the trusted derived execution-readiness contract.',
          'The selected parent or canonical variant identity.',
          'A validated operation id and its bound economies, effects, state-machine, and spell-store inputs.',
        ],
        exclusions: [
          'Campaign rulings are contextual inputs and never discharge engine-pending readiness clauses.',
          'Does not execute the item operation or supply missing item semantics.',
          'Does not claim that every clause of the item record is implemented.',
          'Does not infer a capability from typed mechanics fields or an absent readiness binding.',
        ],
        residualInterpretation:
          'Whether the player may attempt the operation and how source prose applies remain DM rulings. Any item semantics outside the positively bound operation remain with the DM or another explicit capability.',
        evidence: [
          'packages/core/src/state/itemExecutionReadiness.ts:60-81',
          'packages/core/src/state/itemState.ts:1888-1911',
          'packages/core/src/state/itemState.ts:2127',
        ],
      },
      expectedDeterministicStateEffect: {
        kind: 'effect',
        statement:
          'A stateless single-use spend consumes one unit, splits the consumed unit out of the stack, and creates nonmagical inventory.',
        evidence:
          'splitNonmagicalSingleUseInventory preserves the physical row while nulling the magic binding for the transformed unit.',
        operations: [
          {
            tool: 'use_item',
            args: {
              instanceId: 'ammunition-stack-1',
              operationId: 'hit-target',
            },
          },
        ],
      },
      oracleSignals: [],
    },
  ],
  probeId: 'P8',
  title: 'Positive magic-ammunition capability',
  verifiedAtCommit: VERIFIED_AT_COMMIT,
  gatingBlocker: {
    id: 'none',
    owningBead: 'eshyra-uiax',
    gates:
      'B5 is discharged: the repair merged to main as PR #514 (dd96529). inSelectedScope in itemExecutionReadiness.ts now throws ItemExecutionReadinessError on an unrecognized scope instead of returning false, so a clause can no longer be skipped silently and passing the readiness contract is trustworthy capability evidence.',
  },
  boundedEvidenceStatement:
    'This fixture is bounded evidence for the selected ammunition operation and its partial capability; it is not a completeness unit, not a partition of the corpus, and supplies no coverage, readiness, or completeness figure.',
};
