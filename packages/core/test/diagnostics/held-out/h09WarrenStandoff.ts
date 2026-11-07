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

const MODULE_ID = 'eshyra:hollow-beneath-emberfall';

/**
 * Held-out P9 variant: a different authored encounter, location and creature
 * count from the original. Discovery must reach the authored encounter and the
 * pack record its creatures reference, and the pack stat fields must agree
 * with what encounter seeding reads.
 */
export const heldOutP09: DiagnosticFixture = {
  probeId: 'P9',
  title: 'Held-out: failed parley opens the Standoff in the Warren',
  verifiedAtCommit: AUTHORED_AT_COMMIT,
  gatingBlocker: HELD_OUT_GATING_BLOCKER,
  boundedEvidenceStatement: boundedEvidence(
    'the Standoff in the Warren scenario',
  ),
  playerInput:
    'Grik spits on the coins I offered. Talk is over. Weapons out, everyone. We take the raiders down before they reach the sealed door!',
  campaignState: {
    party: [
      { characterId: 'pc-aldous', className: 'fighter', level: 3 },
      { characterId: 'pc-nessa', className: 'cleric', level: 3 },
    ],
    combat: { active: false },
  },
  adventureState: {
    moduleId: MODULE_ID,
    runId: 'run-heldout-hollow-1',
    activeSceneId: 'scene-the-warren',
    activeLocationId: 'loc-deep-hollow',
    note: 'The party descended by the quiet route; the parley with Grik just failed.',
  },
  mustIncludeTargets: [
    {
      targetKind: 'adventure-entity',
      moduleId: MODULE_ID,
      entityKind: 'encounter',
      entityId: 'enc-warren-standoff',
    },
    {
      targetKind: 'adventure-entity',
      moduleId: MODULE_ID,
      entityKind: 'location',
      entityId: 'loc-deep-hollow',
    },
    rulesTarget('creature:goblin', 'p. 315'),
  ],
  mayIncludeTargets: [
    rulesTarget('rule:the-order-of-combat', 'p. 90'),
    rulesTarget('rule:surprise', 'p. 90'),
  ],
  mustNotIncludeTargets: [
    {
      targetKind: 'adventure-entity',
      moduleId: MODULE_ID,
      entityKind: 'encounter',
      entityId: 'enc-mouth-ambush',
    },
  ],
  requiredRetainedFacts: [
    {
      statement:
        'The armor class that encounter seeding reads for the raiders.',
      targetRef: 'creature:goblin',
      typedPath: '/data/armorClass/value',
      expectedValue: 15,
    },
    {
      statement: 'The hit points that encounter seeding reads for the raiders.',
      targetRef: 'creature:goblin',
      typedPath: '/data/hitPoints/value',
      expectedValue: 7,
    },
  ],
  evidenceNotes: [
    {
      kind: 'substrate-fact',
      statement:
        'The module encounter enc-warren-standoff lists creatures [{ rulesRef: "creature:goblin", count: 3, role: "raider" }] at loc-deep-hollow; the encounter at the watchtower mouth (enc-mouth-ambush) is a different authored encounter in the same module and is not the one in play.',
      why: 'Distinguishes the correct authored encounter from its sibling that references the same creature.',
      assertionId: 'heldout-p09-standoff-encounter-creatures',
    },
    {
      kind: 'non-claim',
      statement:
        'The fixture does not claim stat-block addressability is exercised by this module.',
      why: 'The module’s only creature reference is a creature record, not a stat-block.',
    },
  ],
  requiredRelationshipExpansion: [
    {
      sourceRecordKey: `${MODULE_ID}#encounter:enc-warren-standoff`,
      linkField: 'encounters[].creatures[].rulesRef',
      relation: 'encounter-creature',
      targetRecordKey: 'creature:goblin',
      statement:
        'The authored encounter names its creature by pack record key; this is an adventure-module reference, not a pack record-relationships edge.',
    },
  ],
  executions: [
    {
      executionId: 'failed-parley-warren-fight',
      campaignRuleState: none('No campaign rule or ruling is active.'),
      expectedRouteClasses: [
        {
          targetRef: `${MODULE_ID}#encounter:enc-warren-standoff`,
          routes: ['direct-adventure-ref', 'situation-cue'],
          why: 'The active scene lists the encounter, and the player text states the parley failed and the fight is on.',
        },
        {
          targetRef: `${MODULE_ID}#location:loc-deep-hollow`,
          routes: ['direct-adventure-ref'],
          why: 'The adventure state selects the location.',
        },
        {
          targetRef: 'creature:goblin',
          routes: ['typed-relationship'],
          why: 'The encounter template references the creature record by key.',
        },
      ],
      expectedAmbiguityState: none('No ambiguity applies to this encounter.'),
      expectedCampaignRuleOrRulingState: none('No campaign rule is active.'),
      expectedCapabilityStatus: {
        status: 'none-selected',
        statement:
          'No deterministic capability is positively selected for the encounter beyond encounter seeding itself, which reads armor class and hit points from the creature record; initiative, tactics and the surviving parley options stay with the DM.',
        exclusions: [
          'Encounter seeding does not decide whether talks can be reopened.',
        ],
        evidence: ['packages/core/src/orchestrator/toolStartEncounter.ts'],
      },
      expectedDeterministicStateEffect: {
        kind: 'effect',
        statement:
          'Combat is started from the authored encounter template, seeding three goblin raider combatants.',
        evidence:
          'start_encounter accepts an authored encounterId and instantiates its creature entries into combatant state (toolStartEncounter inputSchema).',
        operations: [
          {
            tool: 'start_encounter',
            args: { encounterId: 'enc-warren-standoff' },
          },
        ],
      },
      oracleSignals: [],
    },
  ],
};
