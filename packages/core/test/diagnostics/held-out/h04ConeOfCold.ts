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
 * Held-out P4 variant: explicit spell discovery for a cone-area spell with a
 * trailing prose clause that has no typed representation (frozen statue).
 */
export const heldOutP04: DiagnosticFixture = {
  probeId: 'P4',
  title: 'Held-out: Cone of Cold cast from a 6th-level slot',
  verifiedAtCommit: AUTHORED_AT_COMMIT,
  gatingBlocker: HELD_OUT_GATING_BLOCKER,
  boundedEvidenceStatement: boundedEvidence('the Cone of Cold scenario'),
  playerInput:
    'The ogres are packed into the corridor. I thrust both palms out and cast Cone of Cold at them, burning a 6th-level slot to make it count.',
  campaignState: {
    actor: {
      characterId: 'pc-selvane',
      className: 'wizard',
      level: 11,
      spellSlots: { '5': { max: 2, used: 0 }, '6': { max: 1, used: 0 } },
      preparedSpells: ['spell:cone-of-cold'],
    },
    combat: { active: true, turnOwner: 'pc-selvane' },
  },
  adventureState: none('No authored adventure module is active.'),
  mustIncludeTargets: [
    rulesTarget('spell:cone-of-cold', 'p. 127'),
    rulesTarget('rule:casting-a-spell-at-a-higher-level', 'p. 100'),
  ],
  mayIncludeTargets: [
    rulesTarget('rule:cone', 'p. 103'),
    rulesTarget('rule:areas-of-effect', 'pp. 102, 103'),
    rulesTarget('rule:saving-throws', 'p. 83'),
  ],
  mustNotIncludeTargets: [],
  requiredRetainedFacts: [
    {
      statement: 'The area and the save: every creature in a 60-foot cone.',
      targetRef: 'spell:cone-of-cold',
      exactSubstring:
        'Each creature in a 60-foot cone must make a Constitution saving throw.',
    },
    {
      statement: 'The damage and successful-save result.',
      targetRef: 'spell:cone-of-cold',
      exactSubstring:
        'A creature takes 8d8 cold damage on a failed save, or half as much damage on a successful one.',
    },
    {
      statement:
        'The prose-only trailing clause: a creature killed by the spell becomes a frozen statue until it thaws.',
      targetRef: 'spell:cone-of-cold',
      exactSubstring:
        'A creature killed by this spell becomes a frozen statue until it thaws.',
    },
    {
      statement:
        'The per-slot scaling: +1d8 per slot level above 5th, from the typed scaling block.',
      targetRef: 'spell:cone-of-cold',
      typedPath: '/data/mechanics/scaling/perSlot',
      expectedValue: { stat: 'damage', increase: '1d8', baseSlotLevel: 5 },
    },
    {
      statement: 'The typed cone area.',
      targetRef: 'spell:cone-of-cold',
      typedPath: '/data/mechanics/area',
      expectedValue: { shape: 'cone', size: 60, unit: 'foot', origin: 'self' },
    },
  ],
  evidenceNotes: [
    {
      kind: 'substrate-fact',
      statement:
        'The frozen-statue consequence is printed in the description but has no field in mechanics (SRD 5.1 p. 127); only the prose carries it.',
      why: 'A packet built only from typed fields loses the one clause that changes what happens to a creature killed by the spell.',
      assertionId: 'heldout-p04-frozen-statue-prose-only',
    },
    {
      kind: 'non-claim',
      statement:
        'The fixture does not claim any capability owns cone geometry or target selection.',
      why: 'The ledger binds only the upcast transform; area and target choice stay with the DM.',
    },
  ],
  requiredRelationshipExpansion: none(
    'No typed relationship from spell:cone-of-cold to a rule is declared; the upcast rule is reached through the printed higher-slot clause.',
  ),
  executions: [
    {
      executionId: 'cone-of-cold-sixth-level-slot',
      campaignRuleState: none('No campaign rule or ruling is active.'),
      expectedRouteClasses: [
        {
          targetRef: 'spell:cone-of-cold',
          routes: ['explicit-name-or-alias', 'direct-state-ref'],
          why: 'The player names the spell and the sheet lists it as prepared.',
        },
        {
          targetRef: 'rule:casting-a-spell-at-a-higher-level',
          routes: ['situation-cue'],
          why: 'The player states a 6th-level slot for a 5th-level spell, which raises the general higher-slot rule.',
        },
      ],
      expectedAmbiguityState: none('Cone of Cold carries no source ambiguity.'),
      expectedCampaignRuleOrRulingState: none('No campaign rule is active.'),
      expectedCapabilityStatus: {
        status: 'implemented',
        statement:
          'The typed higher-slot transform is executed by resolve_spell_upcast, and spend_spell_slot spends the selected slot and returns that transform. Area geometry, target selection, the save and the statue consequence are not executed.',
        capabilityId: 'resolve-spell-upcast-v1',
        revision: 'resolve-spell-upcast-v1',
        inputs: ['spellRef', 'slotLevel'],
        exclusions: [
          'Does not decide whether the spell may be cast or spend the slot.',
          'Does not adjudicate untyped higher-level prose.',
        ],
        residualInterpretation:
          'The DM determines applicability and adjudicates source text outside the typed transform.',
        evidence: [
          'packages/core/src/rules/deterministicCapabilityLedger.ts#RULE_DETERMINISTIC_CAPABILITY_CONTRACTS',
          'packages/core/src/orchestrator/toolSpendSpellSlot.ts',
        ],
      },
      expectedDeterministicStateEffect: {
        kind: 'effect',
        statement:
          'One 6th-level spell slot of the wizard is spent for Cone of Cold.',
        evidence:
          'spend_spell_slot inputSchema (spellRef, slotLevel) in packages/core/src/orchestrator/toolSpendSpellSlot.ts; the player stated the slot level.',
        operations: [
          {
            tool: 'spend_spell_slot',
            args: { spellRef: 'spell:cone-of-cold', slotLevel: 6 },
          },
        ],
      },
      oracleSignals: [],
    },
  ],
};
