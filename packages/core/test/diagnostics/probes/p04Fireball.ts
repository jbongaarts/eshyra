import type { DiagnosticFixture } from '../fixtureContract.js';
import { none, rulesTarget, VERIFIED_AT_COMMIT } from '../fixtureContract.js';

export const P04_FIREBALL: DiagnosticFixture = {
  playerInput:
    'I cast fireball at the clustered enemies using a 5th-level slot.',
  campaignState: {
    actingCharacter: 'pc-1',
    selectedSpell: 'spell:fireball',
    slotLevel: 5,
    targetPoint: 'enemy cluster',
  },
  adventureState: none(
    'No authored adventure state is needed for explicit spell discovery.',
  ),
  campaignRuleState: none('No active campaign rule or ruling.'),
  mustIncludeTargets: [
    rulesTarget('spell:fireball', 'p. 144', {
      kind: 'stable-id',
      idKind: 'clause',
      id: 'fireball:higher-slot',
    }),
  ],
  mayIncludeTargets: [],
  mustNotIncludeTargets: [],
  expectedRouteClasses: [
    {
      targetRef: 'spell:fireball',
      routes: ['explicit-name-or-alias'],
      why: 'The player explicitly names the spell, selecting its canonical record.',
    },
  ],
  requiredRetainedFacts: [
    {
      targetRef: 'spell:fireball',
      exactSubstring: '20-foot-radius sphere',
      statement: 'The area remains faithful prose; no typed area is invented.',
    },
    {
      targetRef: 'spell:fireball',
      exactSubstring: 'half as much damage on a successful one',
      statement: 'The successful-save result is retained.',
    },
    {
      targetRef: 'spell:fireball',
      typedPath: '/data/mechanics/saves/0',
      expectedValue: { ability: 'dexterity', damageOnSuccess: 'half' },
      statement: 'The Dexterity save projection is retained.',
    },
    {
      targetRef: 'spell:fireball',
      typedPath: '/data/mechanics/damage/0',
      expectedValue: { dice: '8d6', type: 'fire' },
      statement: 'The 8d6 fire projection is retained.',
    },
    {
      targetRef: 'spell:fireball',
      typedPath: '/data/mechanics/scaling/perSlot',
      expectedValue: { stat: 'damage', increase: '1d6', baseSlotLevel: 3 },
      statement: 'Per-slot scaling is retained.',
    },
    {
      targetRef: 'spell:fireball',
      typedPath: '/data/upcast',
      statement: 'The compiler-emitted higher-slot clause is retained.',
    },
    {
      targetRef: 'spell:fireball',
      statement:
        'The typed projection has no mechanics.area; area geometry and target selection remain outside the upcast capability.',
    },
  ],
  requiredRelationshipExpansion: none(
    'Explicit spell discovery requires no typed relationship expansion.',
  ),
  expectedAmbiguityState: none('No source ambiguity is declared for Fireball.'),
  expectedCampaignRuleOrRulingState: none(
    'No campaign rule or ruling is active.',
  ),
  expectedCapabilityStatus: {
    status: 'implemented',
    capabilityId: 'spell-upcast',
    revision: 'fireball:higher-slot',
    statement:
      'The bounded upcast capability is positively selected for slot spending and damage scaling.',
    inputs: [
      'spell:fireball',
      'selected spell-slot level',
      'fireball:higher-slot',
    ],
    exclusions: [
      'packages/core/src/orchestrator/spellUpcast.ts and toolSpendSpellSlot.ts do not own area geometry or target selection.',
      'No typed mechanics.area is present.',
    ],
    residualInterpretation:
      'The DM adjudicates the area, targets, and successful-save application around the deterministic upcast arithmetic.',
    evidence: [
      'packages/core/src/orchestrator/spellUpcast.ts',
      'packages/core/src/orchestrator/toolSpendSpellSlot.ts',
    ],
  },
  expectedDeterministicStateEffect: none(
    'This fixture does not spend a spell slot or apply Fireball damage.',
  ),
  probeId: 'P4',
  title: 'Fireball area, save, damage, and upcast',
  verifiedAtCommit: VERIFIED_AT_COMMIT,
  gatingBlocker: {
    id: 'none',
    owningBead: 'none',
    gates: 'No blocker gates this fixture identity.',
  },
  boundedEvidenceStatement:
    'This fixture is bounded evidence for explicit Fireball discovery and its partial upcast capability; it is not a completeness unit, not a partition of the corpus, and supplies no coverage, readiness, or completeness figure.',
  oracleSignals: [],
};
