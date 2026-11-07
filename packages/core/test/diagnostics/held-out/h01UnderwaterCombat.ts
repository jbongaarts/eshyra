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
 * Held-out P1 variant: situation-cue discovery of a text-only rule. The
 * governing rule is never named, and the player text avoids the word
 * "underwater". `rule:underwater-combat.data` is `{ text }` only.
 */
export const heldOutP01: DiagnosticFixture = {
  probeId: 'P1',
  title: 'Held-out: unnamed flooded-room melee reaches the underwater rule',
  verifiedAtCommit: AUTHORED_AT_COMMIT,
  gatingBlocker: HELD_OUT_GATING_BLOCKER,
  boundedEvidenceStatement: boundedEvidence('the flooded-vault melee scenario'),
  playerInput:
    'The cistern door gives way and the vault is chest-deep in black water with an eel-thing coiled on the far stair. I wade in, take a deep breath, duck my head under and swing my longsword at it.',
  campaignState: {
    actor: {
      characterId: 'pc-brannoch',
      className: 'fighter',
      level: 5,
      knownWeapons: ['longsword'],
      swimSpeed: null,
    },
    scene: {
      location: 'flooded cistern vault',
      terrainNote: 'the floor of the vault is fully submerged',
    },
    inCombat: true,
  },
  adventureState: none('No authored adventure module is active.'),
  mustIncludeTargets: [rulesTarget('rule:underwater-combat', 'p. 99')],
  mayIncludeTargets: [
    rulesTarget('rule:melee-attacks', 'p. 95'),
    rulesTarget('rule:advantage-and-disadvantage', 'pp. 76, 77'),
    rulesTarget('rule:attack-rolls', 'p. 94'),
  ],
  mustNotIncludeTargets: [],
  requiredRetainedFacts: [
    {
      statement:
        'The melee-attack clause: no swimming speed means disadvantage unless the weapon is on the short printed list, which does not include a longsword.',
      targetRef: 'rule:underwater-combat',
      exactSubstring:
        'has disadvantage on the attack roll unless the weapon is a dagger, javelin, shortsword, spear, or trident',
    },
    {
      statement:
        'The immersion clause: fully immersed creatures have resistance to fire damage.',
      targetRef: 'rule:underwater-combat',
      exactSubstring:
        'Creatures and objects that are fully immersed in water have resistance to fire damage.',
    },
  ],
  evidenceNotes: [
    {
      kind: 'substrate-fact',
      statement:
        'rule:underwater-combat.data carries only a text field (SRD 5.1 p. 99); no typed edge reaches it from any other record.',
      why: 'Only a situation cue or a lexical/semantic candidate can surface it; the player text deliberately omits the words "underwater" and "water combat".',
      assertionId: 'heldout-p01-underwater-text-only',
    },
    {
      kind: 'non-claim',
      statement:
        'The expectation does not say the longsword attack is rolled with disadvantage by any tool; it says the printed clause must reach the packet.',
      why: 'No deterministic capability owns the underwater modifier; the DM applies it as a declared modifier.',
    },
  ],
  requiredRelationshipExpansion: none(
    'rule:underwater-combat declares no typed relationship field; no traversal is expected.',
  ),
  executions: [
    {
      executionId: 'flooded-vault-longsword',
      campaignRuleState: none('No campaign rule or ruling is active.'),
      expectedRouteClasses: [
        {
          targetRef: 'rule:underwater-combat',
          routes: ['situation-cue'],
          why: 'The scene states a submerged floor and a melee swing without naming the rule; only the situation can trigger it.',
        },
      ],
      expectedAmbiguityState: none(
        'rule:underwater-combat carries no source ambiguity.',
      ),
      expectedCampaignRuleOrRulingState: none('No campaign rule is active.'),
      expectedCapabilityStatus: {
        status: 'none-selected',
        statement:
          'No deterministic capability selects the underwater attack modifier. The disadvantage rides a caller-declared modifier on resolve_check; the DM decides whether the weapon is on the exempt list.',
        exclusions: [
          'resolve_check never derives attack-roll modifiers; the caller declares them.',
        ],
        evidence: [
          'packages/core/src/rules/deterministicCapabilityLedger.ts#RULE_DETERMINISTIC_CAPABILITY_CONTRACTS',
        ],
      },
      expectedDeterministicStateEffect: none(
        'Discovery alone mutates no state; the attack roll and any damage are separate tool calls outside this expectation.',
      ),
      oracleSignals: [],
    },
  ],
};
