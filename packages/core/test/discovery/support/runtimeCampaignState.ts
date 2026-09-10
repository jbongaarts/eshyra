import type { AdventureModule, Db } from '../../../src/internal.js';
import { startAdventureRun } from '../../../src/internal.js';
import type { DiagnosticFixture } from '../../diagnostics/fixtureContract.js';
import {
  DEFAULT_TEST_CAMPAIGN_ID,
  DEFAULT_TEST_SESSION_ID,
} from '../../support/db.js';
import { moduleForFixture } from './scenario.js';

/**
 * Materialize a probe's situation as REAL campaign state for a real turn.
 *
 * The offline harness (W8) hands discovery the fixture's `campaignState`
 * object directly. A runtime turn cannot: the signals stage walks the live
 * `StateSnapshot`, so a probe only appears in shadow evidence to the extent the
 * campaign genuinely holds it.
 *
 * What this module writes is therefore restricted to state a campaign really
 * does hold — an inventory row for magic ammunition a character carries, an
 * adventure run and clock location for an authored encounter. A fixture field
 * with no live equivalent (P1's `combat.geometry`, P2's `movementIntent`, P8's
 * `operationId`) is deliberately NOT synthesized. Writing it into `plot_flags`
 * to make a probe reach its target would hand the signals stage the record key
 * it is supposed to discover; its absence is a finding this phase exists to
 * record, not a hole to paper over.
 */

const AT = '2026-05-20T09:30:00.000Z';
const ACTING_CHARACTER = 'pc-1';

export interface ProbeRuntimeState {
  /** Supplied to `runTurn` when the probe's situation involves a module. */
  readonly resolveAdventureModule?: (
    moduleId: string,
  ) => AdventureModule | undefined;
}

export function installProbeCampaignState(
  fixture: DiagnosticFixture,
  db: Db,
): ProbeRuntimeState {
  if (fixture.probeId === 'P8') {
    // The character carries the magic ammunition the probe describes. Ordinary
    // inventory: a held row bound to its pack record. The party also stands
    // somewhere, which every campaign in play does and which spent ammunition
    // needs in order to land as an unheld physical item.
    db.prepare('UPDATE clock SET current_location_id=? WHERE id=1').run(
      'staging-ground',
    );
    db.prepare(
      `INSERT INTO inventory(
         id, character_id, name, quantity, location, properties_json,
         pack_ref, provenance, session_id, updated_at
       ) VALUES (?, ?, ?, ?, NULL, '{}', ?, 'test:w9-probe-state', ?, ?)`,
    ).run(
      'ammunition-stack-1',
      ACTING_CHARACTER,
      'Magic Ammunition',
      20,
      'magic-item:ammunition-1-2-or-3',
      DEFAULT_TEST_SESSION_ID,
      AT,
    );
    return {};
  }
  const module = moduleForFixture(fixture);
  if (module === undefined) return {};
  const adventure = fixture.adventureState as {
    readonly locationId?: string;
  };
  startAdventureRun(db, {
    campaignId: DEFAULT_TEST_CAMPAIGN_ID,
    runId: 'run-1',
    moduleId: module.id,
    startedAtSessionId: DEFAULT_TEST_SESSION_ID,
    provenance: 'test:w9-probe-state',
    sessionId: DEFAULT_TEST_SESSION_ID,
    updatedAt: AT,
  });
  if (adventure.locationId !== undefined)
    db.prepare('UPDATE clock SET current_location_id=? WHERE id=1').run(
      adventure.locationId,
    );
  return {
    resolveAdventureModule: (moduleId: string) =>
      moduleId === module.id ? module : undefined,
  };
}
