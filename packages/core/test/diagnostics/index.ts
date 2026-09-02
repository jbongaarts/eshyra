export type {
  AdventureEntityTarget,
  AmbiguityState,
  CampaignRuleCases,
  CapabilityExpectation,
  DiagnosticFixture,
  DiagnosticSelector,
  DiagnosticTarget,
  ExplicitNone,
  GatingBlocker,
  OracleSignal,
  RetainedFact,
  RouteClass,
  RulesRecordTarget,
  TypedRelationshipExpectation,
} from './fixtureContract.js';
export {
  CORPUS_NON_CLAIMS,
  SRD_SOURCE_REF,
  VERIFIED_AT_COMMIT,
  validateDiagnosticCorpus,
} from './fixtureContract.js';
export { P01_COVER } from './probes/p01Cover.js';
export { P02_OPPORTUNITY_ATTACKS } from './probes/p02OpportunityAttacks.js';
export { P03_ADULT_BLACK_DRAGON } from './probes/p03AdultBlackDragon.js';
export { P04_FIREBALL } from './probes/p04Fireball.js';
export { P05_INCAPACITATION_CONCENTRATION } from './probes/p05IncapacitationConcentration.js';
export { P06_ACTION_SURGE } from './probes/p06ActionSurge.js';
export { P07_CUBE_OF_FORCE } from './probes/p07CubeOfForce.js';
export { P08_AMMUNITION } from './probes/p08Ammunition.js';
export { P09_ADVENTURE_ENCOUNTER } from './probes/p09AdventureEncounter.js';
export { P10_MATERIAL_COMPONENTS_HOUSE_RULE } from './probes/p10MaterialComponentsHouseRule.js';
export { P11_ADDON_OVERRIDE } from './probes/p11AddOnOverride.js';
export { P12_STARTING_WEALTH } from './probes/p12StartingWealth.js';

import type { DiagnosticFixture } from './fixtureContract.js';
import { P01_COVER } from './probes/p01Cover.js';
import { P02_OPPORTUNITY_ATTACKS } from './probes/p02OpportunityAttacks.js';
import { P03_ADULT_BLACK_DRAGON } from './probes/p03AdultBlackDragon.js';
import { P04_FIREBALL } from './probes/p04Fireball.js';
import { P05_INCAPACITATION_CONCENTRATION } from './probes/p05IncapacitationConcentration.js';
import { P06_ACTION_SURGE } from './probes/p06ActionSurge.js';
import { P07_CUBE_OF_FORCE } from './probes/p07CubeOfForce.js';
import { P08_AMMUNITION } from './probes/p08Ammunition.js';
import { P09_ADVENTURE_ENCOUNTER } from './probes/p09AdventureEncounter.js';
import { P10_MATERIAL_COMPONENTS_HOUSE_RULE } from './probes/p10MaterialComponentsHouseRule.js';
import { P11_ADDON_OVERRIDE } from './probes/p11AddOnOverride.js';
import { P12_STARTING_WEALTH } from './probes/p12StartingWealth.js';

export const DIAGNOSTIC_FIXTURES: readonly DiagnosticFixture[] = [
  P01_COVER,
  P02_OPPORTUNITY_ATTACKS,
  P03_ADULT_BLACK_DRAGON,
  P04_FIREBALL,
  P05_INCAPACITATION_CONCENTRATION,
  P06_ACTION_SURGE,
  P07_CUBE_OF_FORCE,
  P08_AMMUNITION,
  P09_ADVENTURE_ENCOUNTER,
  P10_MATERIAL_COMPONENTS_HOUSE_RULE,
  P11_ADDON_OVERRIDE,
  P12_STARTING_WEALTH,
];
