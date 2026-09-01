import type { DiagnosticFixture } from '../fixtureContract.js';
import { none, rulesTarget, VERIFIED_AT_COMMIT } from '../fixtureContract.js';

const moduleId = 'eshyra:hollow-beneath-emberfall';

export const P09_ADVENTURE_ENCOUNTER: DiagnosticFixture = {
  playerInput: 'We enter the watchtower mouth; deal with the goblin sentries.',
  campaignState: {
    activeAdventureRun: 'run-1',
    selectedLocationId: 'loc-watchtower-mouth',
    encounterId: 'enc-mouth-ambush',
  },
  adventureState: {
    moduleId,
    encounterId: 'enc-mouth-ambush',
    locationId: 'loc-watchtower-mouth',
  },
  campaignRuleState: none('No active campaign rule or ruling.'),
  mustIncludeTargets: [
    {
      targetKind: 'adventure-entity',
      moduleId,
      entityKind: 'encounter',
      entityId: 'enc-mouth-ambush',
    },
    {
      targetKind: 'adventure-entity',
      moduleId,
      entityKind: 'location',
      entityId: 'loc-watchtower-mouth',
    },
    rulesTarget('creature:goblin', 'p. 315'),
  ],
  mayIncludeTargets: [
    rulesTarget('stat-block:avatar-of-death', 'p. 218'),
    rulesTarget('stat-block:giant-fly', 'p. 222'),
  ],
  mustNotIncludeTargets: [],
  expectedRouteClasses: [
    {
      targetRef: `${moduleId}#encounter:enc-mouth-ambush`,
      routes: ['direct-adventure-ref'],
      why: 'The selected authored encounter is named by the active adventure run.',
    },
    {
      targetRef: `${moduleId}#location:loc-watchtower-mouth`,
      routes: ['direct-adventure-ref'],
      why: 'The selected authored location supplies the encounter context.',
    },
    {
      targetRef: 'creature:goblin',
      routes: ['direct-adventure-ref'],
      why: 'The encounter creature entry carries the canonical rulesRef creature:goblin.',
    },
  ],
  requiredRetainedFacts: [
    {
      targetRef: 'creature:goblin',
      typedPath: '/data/armorClass/value',
      expectedValue: 15,
      statement: 'Encounter seeding reads the goblin armor class value 15.',
    },
    {
      targetRef: 'creature:goblin',
      typedPath: '/data/hitPoints/value',
      expectedValue: 7,
      statement: 'Encounter seeding reads the goblin hit-points value 7.',
    },
    {
      targetRef: `${moduleId}#encounter:enc-mouth-ambush`,
      statement:
        'The module encounter is Ambush at the Mouth at loc-watchtower-mouth with two creature:goblin sentries.',
    },
    {
      targetRef: `${moduleId}#location:loc-watchtower-mouth`,
      statement:
        'The module contains the authored watchtower-mouth location and no stat-block rulesRef.',
    },
    {
      statement:
        'The module’s only rulesRef values are creature:goblin and magic-item:potion-of-healing; it does not itself exercise stat-block addressability.',
    },
    {
      statement:
        'Correction to stale design state: stat-block:avatar-of-death and stat-block:giant-fly are present at p. 218 and p. 222 in this verified pack, so the direct stat-block lookup now succeeds; B1 eshyra-l3e5 is discharged here.',
    },
    {
      statement:
        'B2 eshyra-seoh is closed, and the authored resolver path is available; the fixture records that the former normal-CLI resolver gap is discharged rather than asserting the old failure.',
    },
  ],
  requiredRelationshipExpansion: none(
    'The encounter-to-creature containment is an authored module reference, not a typed mechanics relationship in the rules pack; no pack relationship traversal is invented.',
  ),
  expectedAmbiguityState: none(
    'No source ambiguity is declared for the authored encounter.',
  ),
  expectedCampaignRuleOrRulingState: none(
    'No campaign rule or ruling is active.',
  ),
  expectedCapabilityStatus: {
    status: 'none-selected',
    statement:
      'No deterministic capability is positively selected by this discovery fixture; encounter creation remains a separate runtime operation.',
    inputs: ['module encounter reference', 'creature:goblin statline'],
    exclusions: [
      'The fixture does not claim to execute combat or stat-block expansion.',
    ],
    residualInterpretation:
      'The runtime encounter owner seeds the authored combatants from the discovered statline.',
  },
  expectedDeterministicStateEffect: none(
    'The fixture does not start the encounter or mutate combat state.',
  ),
  probeId: 'P9',
  title: 'Authored adventure encounter',
  verifiedAtCommit: VERIFIED_AT_COMMIT,
  gatingBlocker: {
    id: 'none',
    owningBead: 'none',
    gates:
      'B1 and B2 are discharged in this worktree; no current identity blocker gates the fixture.',
  },
  boundedEvidenceStatement:
    'This fixture is bounded evidence for one authored adventure encounter and direct module-reference discovery; it is not a completeness unit, not a partition of the corpus, and supplies no coverage, readiness, or completeness figure.',
  oracleSignals: [],
};
