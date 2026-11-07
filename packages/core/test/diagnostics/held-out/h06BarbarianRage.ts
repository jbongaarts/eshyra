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
 * Held-out P6 variant: a character-granted feature whose limits live in a
 * class table reached through a typed class edge, with a resource projection
 * that names neither a maximum nor a damage bonus.
 */
export const heldOutP06: DiagnosticFixture = {
  probeId: 'P6',
  title: 'Held-out: barbarian rage with uses and bonus held in the class table',
  verifiedAtCommit: AUTHORED_AT_COMMIT,
  gatingBlocker: HELD_OUT_GATING_BLOCKER,
  boundedEvidenceStatement: boundedEvidence('the barbarian rage scenario'),
  playerInput:
    'The ogre is almost on us. I roar, let the fury take me, and then slam my greataxe into it. How many more times can I do this before I need to rest?',
  campaignState: {
    actor: {
      characterId: 'pc-grunna',
      className: 'barbarian',
      level: 3,
      grantedFeatures: [
        'feature:barbarian:rage',
        'feature:barbarian:unarmored-defense',
        'feature:barbarian:reckless-attack',
        'feature:barbarian:danger-sense',
      ],
      usage: { 'feature:barbarian:rage': { spentSinceLongRest: 1 } },
    },
    combat: { active: true, turnOwner: 'pc-grunna' },
  },
  adventureState: none('No authored adventure module is active.'),
  mustIncludeTargets: [
    rulesTarget('feature:barbarian:rage', 'p. 8'),
    rulesTarget('class:barbarian', 'p. 8'),
    rulesTarget('table:the-barbarian', 'p. 8'),
  ],
  mayIncludeTargets: [
    rulesTarget('rule:long-rest', 'p. 87'),
    rulesTarget('rule:limited-usage', 'p. 259'),
  ],
  mustNotIncludeTargets: [],
  requiredRetainedFacts: [
    {
      statement: 'The recovery limit printed on the feature.',
      targetRef: 'feature:barbarian:rage',
      exactSubstring: 'you must finish a long rest before you can rage again',
    },
    {
      statement: 'The spellcasting and concentration prohibition while raging.',
      targetRef: 'feature:barbarian:rage',
      exactSubstring:
        'If you are able to cast spells, you can’t cast them or concentrate on them while raging.',
    },
    {
      statement:
        'The class-table row for 3rd level: 3 rages and a +2 rage damage bonus.',
      targetRef: 'table:the-barbarian',
      typedPath: '/data/rows/2',
      expectedValue: ['3rd', '+2', 'Primal Path', '3', '+2'],
    },
  ],
  evidenceNotes: [
    {
      kind: 'substrate-fact',
      statement:
        'feature:barbarian:rage.mechanics.resources is [{ reset: "long-rest" }] with no resource name or maximum, and no field carries the rage damage bonus; both live only in the Rages and Rage Damage columns of table:the-barbarian (SRD 5.1 p. 8), reached by feature -> class -> progression table.',
      why: 'A packet showing the feature without the table cannot answer how many rages remain, and the feature record alone omits the damage bonus.',
      assertionId: 'heldout-p06-rage-limits-in-class-table',
    },
    {
      kind: 'non-claim',
      statement:
        'The fixture does not claim use accounting is owned by a capability for this feature.',
      why: 'The projection names no resource, so no uses-per-rest owner can be asserted from the record.',
    },
  ],
  requiredRelationshipExpansion: [
    {
      sourceRecordKey: 'feature:barbarian:rage',
      linkField: 'data.source',
      relation: 'granted-by',
      targetRecordKey: 'class:barbarian',
      statement: 'The feature record names its granting class.',
    },
    {
      sourceRecordKey: 'class:barbarian',
      linkField: 'data.progressionTableRef',
      relation: 'progression-table',
      targetRecordKey: 'table:the-barbarian',
      statement:
        'The class record names the progression table holding the Rages and Rage Damage columns.',
    },
  ],
  executions: [
    {
      executionId: 'barbarian-rage-third-level',
      campaignRuleState: none('No campaign rule or ruling is active.'),
      expectedRouteClasses: [
        {
          targetRef: 'feature:barbarian:rage',
          routes: ['direct-state-ref', 'situation-cue'],
          why: 'The sheet lists the feature as granted and the player describes entering a rage.',
        },
        {
          targetRef: 'class:barbarian',
          routes: ['typed-relationship'],
          why: 'The feature record types its granting class in data.source.',
        },
        {
          targetRef: 'table:the-barbarian',
          routes: ['typed-relationship'],
          why: 'The class record types its progression table; the player asks how many rages remain.',
        },
      ],
      expectedAmbiguityState: none('Rage carries no source ambiguity.'),
      expectedCampaignRuleOrRulingState: none('No campaign rule is active.'),
      expectedCapabilityStatus: {
        status: 'none-selected',
        statement:
          'No capability is positively selected for rage uses or the rage damage bonus; the DM reads the class table and adjudicates the remaining uses.',
        exclusions: [
          'The feature projection names no resource, so no uses-per-rest accounting is asserted.',
        ],
        evidence: [
          'packages/core/src/rules/deterministicCapabilityLedger.ts#RULE_DETERMINISTIC_CAPABILITY_BINDINGS',
        ],
      },
      expectedDeterministicStateEffect: none(
        'Discovery alone mutates no state; usage and turn-resource spends are separate tool calls.',
      ),
      oracleSignals: [],
    },
  ],
};
