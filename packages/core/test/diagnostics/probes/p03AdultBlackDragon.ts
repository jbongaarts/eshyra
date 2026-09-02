import type { DiagnosticFixture } from '../fixtureContract.js';
import { none, rulesTarget, VERIFIED_AT_COMMIT } from '../fixtureContract.js';

export const P03_ADULT_BLACK_DRAGON: DiagnosticFixture = {
  playerInput: 'The adult black dragon exhales its acid breath at us.',
  campaignState: {
    encounterCreature: 'creature:adult-black-dragon',
    targets: ['pc-1', 'pc-2'],
  },
  adventureState: none(
    'No authored adventure state is needed for direct creature discovery.',
  ),
  mustIncludeTargets: [
    rulesTarget('creature:adult-black-dragon', 'p. 281', {
      kind: 'json-pointer',
      pointer: '/data/actions/5',
    }),
  ],
  mayIncludeTargets: [],
  mustNotIncludeTargets: [],
  requiredRetainedFacts: [
    {
      targetRef: 'creature:adult-black-dragon',
      exactSubstring: 'or half as much damage on a successful one',
      statement:
        'The Acid Breath success branch must survive as faithful source prose.',
    },
    {
      targetRef: 'creature:adult-black-dragon',
      typedPath: '/data/actions/5/mechanics/saves/0',
      expectedValue: { ability: 'dexterity', dc: 18 },
      statement: 'The typed Dexterity save projection is retained.',
    },
    {
      targetRef: 'creature:adult-black-dragon',
      typedPath: '/data/actions/5/mechanics/damage/0',
      expectedValue: { average: 54, dice: '12d8', type: 'acid' },
      statement:
        'The typed damage projection is retained beside, not instead of, the source branch.',
    },
    {
      statement:
        'The typed projection has no damageOnSuccess field and no success branch; 12d8 must not be presented as unconditional damage.',
    },
  ],
  requiredRelationshipExpansion: none(
    'The direct creature probe requires no typed relationship expansion.',
  ),
  executions: [
    {
      executionId: 'default',
      campaignRuleState: none('No active campaign rule or ruling.'),
      expectedRouteClasses: [
        {
          targetRef: 'creature:adult-black-dragon',
          routes: ['direct-state-ref'],
          why: 'The active encounter creature reference directly identifies the canonical record.',
        },
      ],
      expectedAmbiguityState: none(
        'No source ambiguity is declared for Acid Breath.',
      ),
      expectedCampaignRuleOrRulingState: none(
        'No campaign rule or ruling is active.',
      ),
      expectedCapabilityStatus: {
        status: 'none-selected',
        statement:
          'No capability is positively selected; damage arithmetic rides resolve_damage while save and success-branch adjudication remain with the DM.',
        inputs: ['Acid Breath action prose', 'Dexterity save result'],
        exclusions: [
          'No capability turns the typed 12d8 projection into unconditional damage or supplies the missing success branch.',
        ],
        residualInterpretation:
          'The DM interprets the save branch and invokes deterministic damage arithmetic when appropriate.',
      },
      expectedDeterministicStateEffect: none(
        'Discovery does not resolve the saving throw or apply damage.',
      ),
      oracleSignals: [],
    },
  ],
  probeId: 'P3',
  title: 'Adult Black Dragon Acid Breath',
  verifiedAtCommit: VERIFIED_AT_COMMIT,
  gatingBlocker: {
    id: 'none',
    owningBead: 'none',
    gates: 'No blocker gates this fixture identity.',
  },
  boundedEvidenceStatement:
    'This fixture is bounded evidence for direct creature discovery and a partial action projection; it is not a completeness unit, not a partition of the corpus, and supplies no coverage, readiness, or completeness figure.',
};
