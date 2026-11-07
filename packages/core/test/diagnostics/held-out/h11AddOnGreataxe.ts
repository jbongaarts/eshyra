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
 * Held-out P11 variant (baseline integrity): a synthetic add-on that overrides
 * a weapon record. Strict discovery and deterministic execution must resolve
 * the same active record, system and version, and override chain, with no
 * silent bundled-D&D fallback. The add-on is synthetic: no real add-on corpus
 * exists, and the fixture declares no add-on record format beyond the stack's
 * explicit override reference.
 */
export const heldOutP11: DiagnosticFixture = {
  probeId: 'P11',
  title: 'Held-out: add-on overrides Greataxe, discovery and execution agree',
  verifiedAtCommit: AUTHORED_AT_COMMIT,
  gatingBlocker: HELD_OUT_GATING_BLOCKER,
  boundedEvidenceStatement: boundedEvidence(
    'the add-on weapon-override scenario',
  ),
  playerInput:
    'The orc chieftain charges me. I set my feet and chop at him with my greataxe.',
  campaignState: {
    actor: {
      characterId: 'pc-bruna',
      className: 'barbarian',
      level: 5,
      inventory: [
        { instanceId: 'inv-greataxe-1', rulesRef: 'equipment:greataxe' },
      ],
    },
    rulesStack: {
      base: {
        packId: 'rules:dnd5e-srd-5.1',
        systemId: 'dnd5e-srd',
        version: '5.1',
      },
      addons: [
        {
          packId: 'rules:synthetic-heldout-weapon-addon',
          role: 'addon',
          systemId: 'dnd5e-srd',
          overridesDeclared: ['rules:dnd5e-srd-5.1/equipment:greataxe'],
          note: 'Synthetic add-on that supplies its own equipment:greataxe record with a different damage die. Not a real pack.',
        },
      ],
    },
    combat: { active: true, turnOwner: 'pc-bruna' },
  },
  adventureState: none('No authored adventure module is active.'),
  mustIncludeTargets: [rulesTarget('equipment:greataxe', 'p. 66')],
  mayIncludeTargets: [
    rulesTarget('rule:weapons', 'p. 64'),
    rulesTarget('rule:attack-rolls', 'p. 94'),
  ],
  mustNotIncludeTargets: [],
  requiredRetainedFacts: [
    {
      statement:
        'The base record’s damage die, which the add-on is declared to replace; in the stacked execution the active value is the add-on’s and the packet must name the override chain.',
      targetRef: 'equipment:greataxe',
      typedPath: '/data/damageDie',
      expectedValue: '1d12',
    },
  ],
  evidenceNotes: [
    {
      kind: 'substrate-fact',
      statement:
        'The base pack record equipment:greataxe has damageDie 1d12 and damageType slashing (SRD 5.1 p. 66); the stack requires an explicit overrides declaration for a record collision and preserves the full overrideChain.',
      why: 'The base value is the only one derivable from the committed pack; the add-on value is synthetic and defined by the fixture’s stack builder, not by the pack.',
      assertionId: 'heldout-p11-greataxe-base-record',
    },
    {
      kind: 'external-guard',
      statement:
        'A colliding add-on record without an explicit overrides declaration is rejected by the stack resolver.',
      why: 'The explicit-override requirement is what makes the override chain meaningful.',
      guardPath: 'packages/core/src/rules/stack.ts',
      guardSymbol: 'overrideRefMatches',
    },
    {
      kind: 'non-claim',
      statement:
        'The fixture defines no add-on pack format and no real add-on corpus.',
      why: 'The add-on is synthetic by design; its damage value is chosen by whoever builds the stack for the run.',
    },
  ],
  requiredRelationshipExpansion: none(
    'The overridden record declares no typed relationship field.',
  ),
  executions: [
    {
      executionId: 'strict-stack-with-addon-override',
      campaignRuleState: none('No campaign rule or ruling is active.'),
      expectedRouteClasses: [
        {
          targetRef: 'equipment:greataxe',
          routes: ['direct-state-ref', 'explicit-name-or-alias'],
          why: 'The inventory row references the record and the player names the greataxe.',
        },
      ],
      expectedAmbiguityState: none('The weapon record carries no ambiguity.'),
      expectedCampaignRuleOrRulingState: none('No campaign rule is active.'),
      expectedCapabilityStatus: {
        status: 'none-selected',
        statement:
          'No capability is selected for weapon damage selection. The integrity claim is that discovery and execution resolve the same active record, system, version and override chain.',
        exclusions: [
          'No silent fallback to a bundled D&D pack is permitted when the campaign stack is strict.',
        ],
        evidence: ['packages/core/src/rules/stack.ts'],
      },
      expectedDeterministicStateEffect: none(
        'The integrity check mutates no state.',
      ),
      oracleSignals: [],
    },
  ],
};
