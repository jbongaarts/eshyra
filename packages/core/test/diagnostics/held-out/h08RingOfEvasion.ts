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
 * Held-out P8 variant: a positive magic-item capability on a different record
 * and a different economy kind (charges) than the original. The target was
 * chosen by enumerating every magic-item operation that passes the runtime
 * readiness preflight at the authored-at commit and reading the winning
 * record's own clauses; the original probe's pair is not reused.
 */
export const heldOutP08: DiagnosticFixture = {
  probeId: 'P8',
  title: 'Held-out: Ring of Evasion charge spend on a failed Dexterity save',
  verifiedAtCommit: AUTHORED_AT_COMMIT,
  gatingBlocker: HELD_OUT_GATING_BLOCKER,
  boundedEvidenceStatement: boundedEvidence(
    'the Ring of Evasion charge-spend scenario',
  ),
  playerInput:
    'The trap’s blast catches me and I fail the Dexterity save. I use my reaction and spend one charge on my Ring of Evasion to succeed instead.',
  campaignState: {
    actor: {
      characterId: 'pc-halvard',
      className: 'monk',
      level: 8,
      attunedItems: ['inv-ring-of-evasion-1'],
    },
    inventory: [
      {
        instanceId: 'inv-ring-of-evasion-1',
        rulesRef: 'magic-item:ring-of-evasion',
        worn: true,
        attuned: true,
        economyState: { charges: { remaining: 3, max: 3 } },
      },
    ],
    combat: {
      active: true,
      reactionAvailable: true,
      pendingSave: { ability: 'dexterity', outcome: 'failed' },
    },
  },
  adventureState: none('No authored adventure module is active.'),
  mustIncludeTargets: [
    rulesTarget('magic-item:ring-of-evasion', 'p. 236', {
      kind: 'stable-id',
      idKind: 'operation',
      id: 'turn-failed-dex-save-into-success',
    }),
  ],
  mayIncludeTargets: [
    rulesTarget('rule:attunement', 'p. 206'),
    rulesTarget('rule:wearing-and-wielding-items', 'p. 206'),
    rulesTarget('rule:saving-throws', 'p. 83'),
    rulesTarget('rule:reactions', 'p. 91'),
  ],
  mustNotIncludeTargets: [],
  requiredRetainedFacts: [
    {
      statement: 'The printed trigger and charge cost.',
      targetRef: 'magic-item:ring-of-evasion',
      exactSubstring:
        'When you fail a Dexterity saving throw while wearing it, you can use your reaction to expend 1 of its charges to succeed on that saving throw instead.',
    },
    {
      statement: 'The printed charge pool and daily recovery.',
      targetRef: 'magic-item:ring-of-evasion',
      exactSubstring:
        'This ring has 3 charges, and it regains 1d3 expended charges daily at dawn.',
    },
    {
      statement: 'The operation’s declared cost: one charge.',
      targetRef: 'magic-item:ring-of-evasion',
      typedPath: '/data/mechanics/operations/0/cost',
      expectedValue: [{ economy: 'charges', amount: 1 }],
    },
  ],
  evidenceNotes: [
    {
      kind: 'substrate-fact',
      statement:
        'magic-item:ring-of-evasion carries green clauses for economy charges and operation turn-failed-dex-save-into-success, and an adjudicated-by-design clause m10-evasion for the save-conversion itself.',
      why: 'The economy and operation are positively owned; the printed outcome (the save succeeding instead) has no executed owner and stays with the DM.',
      assertionId: 'heldout-p08-ring-of-evasion-clauses',
    },
    {
      kind: 'non-claim',
      statement:
        'The fixture does not claim the Dexterity save is converted to a success by any tool, or that dawn recharge is exercised.',
      why: 'Only the charge spend through the operation is asserted as a deterministic effect.',
    },
    {
      kind: 'non-claim',
      statement:
        'A green clause is not asserted to be hook-free; the economy and operation clauses declare engine hook F5 magic-item-usage-recharge.',
      why: 'Presenting the item as fully ready would be the false-completeness failure ADR 0020 forbids.',
    },
  ],
  requiredRelationshipExpansion: none(
    'The record declares no typed table or stat-block reference; no traversal is expected.',
  ),
  executions: [
    {
      executionId: 'ring-of-evasion-charge-spend',
      campaignRuleState: none('No campaign rule or ruling is active.'),
      expectedRouteClasses: [
        {
          targetRef: 'magic-item:ring-of-evasion',
          routes: [
            'direct-state-ref',
            'explicit-name-or-alias',
            'capability-preflight',
          ],
          why: 'The inventory row references the record, the player names the ring, and the stated use is a declared operation subject to the preflight.',
        },
      ],
      expectedAmbiguityState: none(
        'The Ring of Evasion carries no source ambiguity.',
      ),
      expectedCampaignRuleOrRulingState: none('No campaign rule is active.'),
      expectedCapabilityStatus: {
        status: 'available',
        statement:
          'The charge-spending operation passes the magic-item operation readiness preflight and use_item applies the declared one-charge cost. The save-conversion outcome is not executed.',
        capabilityId: 'assertMagicItemOperationReady',
        revision: 'derived-magic-item-clauses-v1',
        inputs: [
          'A magic-item RulesRecord carrying the trusted derived execution-readiness contract.',
          'The selected parent or canonical variant identity.',
          'A validated operation id and its bound economies, effects, state-machine, and spell-store inputs.',
        ],
        exclusions: [
          'The printed save-conversion outcome is adjudicated by design and is not executed.',
          'Does not claim that every clause of the item record is implemented.',
          'Does not execute the item operation or supply missing item semantics.',
        ],
        residualInterpretation:
          'Whether the player may attempt the operation and how the printed outcome applies remain DM rulings.',
        evidence: [
          'packages/core/src/rules/deterministicCapabilityContract.ts#MAGIC_ITEM_OPERATION_READINESS_CAPABILITY',
          'packages/core/src/orchestrator/toolUseItem.ts',
        ],
      },
      expectedDeterministicStateEffect: {
        kind: 'effect',
        statement:
          'One of the ring’s three charges is spent and the reaction is consumed.',
        evidence:
          'The operation declares cost [{ economy: charges, amount: 1 }] and a reaction activation; use_item applies declared costs and spends the printed turn resource.',
        operations: [
          {
            tool: 'use_item',
            args: {
              instanceId: 'inv-ring-of-evasion-1',
              operationId: 'turn-failed-dex-save-into-success',
            },
          },
        ],
      },
      oracleSignals: [],
    },
  ],
};
