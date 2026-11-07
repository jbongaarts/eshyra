import { AUTHOR, AUTHORED_AT, AUTHORED_AT_COMMIT } from './heldOutCommon.js';

/**
 * HELD-OUT MANIFEST for eshyra-o9bd.19.15 (W15), authored by
 * eshyra-o9bd.19.15.1.
 *
 * FREEZE RULE. After eshyra-o9bd.19.15.2's first run, a held-out fixture may
 * not be edited. An edited fixture is relabelled `consulted` and is excluded
 * from held-out evidence. Fixing a typo is an edit. Add a new fixture under a
 * new entry rather than amending one.
 *
 * INDEPENDENCE. Every fixture was authored from the SRD source text, the
 * committed pack records, the fixture contract and the design document only.
 * The author did not read packages/core/src/discovery/**,
 * packages/core/test/discovery/** or the existing probe fixtures, and did not
 * run the discovery harness on any variant. Expectations were never derived
 * from pipeline output.
 *
 * A held-out miss bounds an awareness-failure rate on this corpus only. It
 * says nothing about the corpus's complement, and no entry here is a coverage,
 * readiness or completeness unit.
 */
export interface HeldOutManifestEntry {
  readonly probeId: `P${1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12}`;
  readonly file: string;
  readonly scenario: string;
  readonly authoredAtCommit: string;
  readonly authoredAt: string;
  readonly author: string;
  /** Always false at authoring time; .2 records its own first run. */
  readonly runAgainstPipelineAtAuthoring: false;
  readonly status: 'held-out';
}

function entry(
  probeId: HeldOutManifestEntry['probeId'],
  file: string,
  scenario: string,
): HeldOutManifestEntry {
  return {
    probeId,
    file,
    scenario,
    authoredAtCommit: AUTHORED_AT_COMMIT,
    authoredAt: AUTHORED_AT,
    author: AUTHOR,
    runAgainstPipelineAtAuthoring: false,
    status: 'held-out',
  };
}

export const HELD_OUT_MANIFEST: readonly HeldOutManifestEntry[] = [
  entry('P1', 'h01UnderwaterCombat.ts', 'Unnamed flooded-room melee'),
  entry(
    'P2',
    'h02MountingMovement.ts',
    'Mounting a horse with little movement left',
  ),
  entry(
    'P3',
    'h03WyvernStinger.ts',
    'Wyvern Stinger hit damage plus save damage',
  ),
  entry('P4', 'h04ConeOfCold.ts', 'Cone of Cold from a 6th-level slot'),
  entry(
    'P5',
    'h05ParalyzedCriticalHit.ts',
    'Paralyzed character struck within 5 feet',
  ),
  entry(
    'P6',
    'h06BarbarianRage.ts',
    'Barbarian rage uses and bonus in the class table',
  ),
  entry(
    'P7',
    'h07FindFamiliar.ts',
    'Dismissing a familiar that vanished at 0 hit points',
  ),
  entry('P8', 'h08RingOfEvasion.ts', 'Ring of Evasion charge spend'),
  entry(
    'P9',
    'h09WarrenStandoff.ts',
    'Failed parley opens the warren standoff',
  ),
  entry(
    'P10',
    'h10CriticalHitHouseRule.ts',
    'Critical-hit house rule beside the printed rule',
  ),
  entry('P11', 'h11AddOnGreataxe.ts', 'Add-on overrides the Greataxe record'),
  entry('P12', 'h12SentinelFeat.ts', 'A feat absent from the SRD pack'),
];
