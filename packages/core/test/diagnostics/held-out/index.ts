import type { DiagnosticFixture } from '../fixtureContract.js';
import { heldOutP01 } from './h01UnderwaterCombat.js';
import { heldOutP02 } from './h02MountingMovement.js';
import { heldOutP03 } from './h03WyvernStinger.js';
import { heldOutP04 } from './h04ConeOfCold.js';
import { heldOutP05 } from './h05ParalyzedCriticalHit.js';
import { heldOutP06 } from './h06BarbarianRage.js';
import { heldOutP07 } from './h07FindFamiliar.js';
import { heldOutP08 } from './h08RingOfEvasion.js';
import { heldOutP09 } from './h09WarrenStandoff.js';
import { heldOutP10 } from './h10CriticalHitHouseRule.js';
import { heldOutP11 } from './h11AddOnGreataxe.js';
import { heldOutP12 } from './h12SentinelFeat.js';

/**
 * The held-out diagnostic fixtures for eshyra-o9bd.19.15, one per probe class
 * P1-P12. See `manifest.ts` for authorship, the freeze rule, and the statement
 * that none of these was run against the discovery pipeline.
 */
export const HELD_OUT_FIXTURES: readonly DiagnosticFixture[] = [
  heldOutP01,
  heldOutP02,
  heldOutP03,
  heldOutP04,
  heldOutP05,
  heldOutP06,
  heldOutP07,
  heldOutP08,
  heldOutP09,
  heldOutP10,
  heldOutP11,
  heldOutP12,
];
