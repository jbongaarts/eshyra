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
 * Held-out P3 variant: direct entity discovery where a single action prints
 * two damage events with one save that applies to only one of them.
 */
export const heldOutP03: DiagnosticFixture = {
  probeId: 'P3',
  title: 'Held-out: Wyvern Stinger with a hit-damage and a save-damage event',
  verifiedAtCommit: AUTHORED_AT_COMMIT,
  gatingBlocker: HELD_OUT_GATING_BLOCKER,
  boundedEvidenceStatement: boundedEvidence('the Wyvern Stinger scenario'),
  playerInput:
    'The wyvern wheels over the ridge and its tail comes down at me. I raise my shield and brace. What does that stinger do to me?',
  campaignState: {
    actor: { characterId: 'pc-torvald', className: 'paladin', level: 6 },
    combat: {
      active: true,
      combatants: [
        { id: 'pc-torvald', side: 'party' },
        {
          id: 'mon-wyvern-1',
          side: 'foes',
          rulesRef: 'creature:wyvern',
          lastAction: 'Stinger',
        },
      ],
    },
  },
  adventureState: none('No authored adventure module is active.'),
  mustIncludeTargets: [
    rulesTarget('creature:wyvern', 'p. 356', {
      kind: 'json-pointer',
      pointer: '/data/actions/3',
    }),
  ],
  mayIncludeTargets: [
    rulesTarget('rule:saving-throws', 'p. 83'),
    rulesTarget('rule:damage-rolls', 'p. 96'),
  ],
  mustNotIncludeTargets: [],
  requiredRetainedFacts: [
    {
      statement:
        'The printed hit damage and the separate printed save clause, together.',
      targetRef: 'creature:wyvern',
      exactSubstring:
        'Hit: 11 (2d6 + 4) piercing damage. The target must make a DC 15 Constitution saving throw, taking 24 (7d6) poison damage on a failed save, or half as much damage on a successful one.',
    },
    {
      statement:
        'The typed save record: Constitution DC 15 with half damage on success.',
      targetRef: 'creature:wyvern',
      typedPath: '/data/actions/3/mechanics/saves/0',
      expectedValue: {
        ability: 'constitution',
        dc: 15,
        damageOnSuccess: 'half',
      },
    },
  ],
  evidenceNotes: [
    {
      kind: 'substrate-fact',
      statement:
        'mechanics.damage on the Stinger lists both the 2d6 + 4 piercing hit damage and the 7d6 poison save damage as peers, and the save record carries no damageOnFailure naming which of them it governs; only the printed prose says the half-on-success clause attaches to the poison.',
      why: 'A packet that reads 7d6 poison as unconditional, or applies the save to the piercing hit damage, misreads the source; the prose is the faithful statement.',
      assertionId: 'heldout-p03-stinger-damage-array-unlinked',
    },
    {
      kind: 'non-claim',
      statement:
        'The fixture does not claim the typed projection is defective for any other action or creature.',
      why: 'Purple Worm Tail Stinger carries a damageOnFailure link; the observation is bounded to this action.',
    },
  ],
  requiredRelationshipExpansion: none(
    'The Stinger action declares no typed relationship field.',
  ),
  executions: [
    {
      executionId: 'wyvern-stinger-vs-paladin',
      campaignRuleState: none('No campaign rule or ruling is active.'),
      expectedRouteClasses: [
        {
          targetRef: 'creature:wyvern',
          routes: ['direct-state-ref', 'explicit-name-or-alias'],
          why: 'The combatant row carries rulesRef creature:wyvern and the player text names the wyvern and its stinger.',
        },
      ],
      expectedAmbiguityState: none(
        'The Stinger action carries no source ambiguity.',
      ),
      expectedCampaignRuleOrRulingState: none('No campaign rule is active.'),
      expectedCapabilityStatus: {
        status: 'none-selected',
        statement:
          'No capability is selected for the Stinger. Damage arithmetic rides resolve_damage; the attack roll and the Constitution save are declared by the DM, who also decides which damage the save halves.',
        exclusions: [
          'No capability decides which printed damage event a save governs.',
        ],
        evidence: [
          'packages/core/src/orchestrator/toolResolveDamage.ts',
          'packages/core/src/rules/deterministicCapabilityLedger.ts#RULE_DETERMINISTIC_CAPABILITY_BINDINGS',
        ],
      },
      expectedDeterministicStateEffect: none(
        'Discovery alone mutates no state; hit-point changes are separate tool calls.',
      ),
      oracleSignals: [],
    },
  ],
};
