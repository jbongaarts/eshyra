import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import {
  createCampaign,
  EMBERFALL_HOLLOW,
  getCampaign,
  initSchema,
  openDatabase,
  startSession,
} from '../src/index.js';
import {
  adventureModuleDirName,
  buildCampaignAdventureAudit,
  getAdventureRun,
  loadAdventureModuleFromDir,
  mutateState,
  recordAdventureRunProgress,
  startAdventureRun,
} from '../src/internal.js';

/**
 * Adventure-module hello-world smoke path (eshyra-eh54.7.3).
 *
 * Proves the four layers connect end to end without a live model: create a
 * campaign from the Emberfall template, attach The Hollow Beneath Emberfall via
 * a campaign-owned adventure run / module binding, record play progress, build
 * the bounded runtime context (the eh54.5 slice, captured via the eh54.6 audit)
 * from immutable source + campaign progress, persist to SQLite, reload, and
 * confirm the binding/progress survive and the runtime context still composes —
 * all while the authored source module is never mutated.
 */

const MODULE_ID = 'eshyra:hollow-beneath-emberfall';
const HERE = dirname(fileURLToPath(import.meta.url));
// Resolve the shipped fixture through the shared path-safe convention, exactly
// as a runtime resolver keyed on the run's moduleId would (eshyra-eh54.7.2).
const MODULE_DIR = join(
  HERE,
  '..',
  'data',
  'adventure-modules',
  adventureModuleDirName(MODULE_ID),
);

const CAMPAIGN_ID = 'emberfall-smoke';
const SESSION_ID = 'session-1';
const RUN_ID = 'run-hollow';
const AT = '2026-06-21T00:00:00.000Z';

const writeMeta = {
  provenance: 'smoke:eh54.7.3',
  sessionId: SESSION_ID,
  updatedAt: AT,
};

/** Resolver keyed on the run's moduleId, loading the shipped fixture from disk. */
function resolveAdventureModule(moduleId: string) {
  return moduleId === MODULE_ID
    ? loadAdventureModuleFromDir(MODULE_DIR)
    : undefined;
}

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function freshCampaignDbPath(): string {
  const dir = mkdtempSync(join(tmpdir(), 'esh-hollow-smoke-'));
  dirs.push(dir);
  return join(dir, 'campaign.db');
}

describe('The Hollow Beneath Emberfall smoke path', () => {
  it('creates a campaign, attaches the module, plays, persists, and resumes', () => {
    const dbPath = freshCampaignDbPath();
    // Capture the immutable source before any play, to prove it never changes.
    const sourceBefore = loadAdventureModuleFromDir(MODULE_DIR);

    // 1. Create a campaign from the Emberfall template and open a session.
    let db = openDatabase(dbPath);
    initSchema(db);
    createCampaign(db, { campaignId: CAMPAIGN_ID, pack: EMBERFALL_HOLLOW });
    startSession(db, {
      campaignId: CAMPAIGN_ID,
      sessionId: SESSION_ID,
      startedAt: AT,
    });
    expect(getCampaign(db)?.campaignId).toBe(CAMPAIGN_ID);

    // 2. Attach the starter module via a campaign-owned adventure run binding.
    const started = startAdventureRun(db, {
      campaignId: CAMPAIGN_ID,
      runId: RUN_ID,
      moduleId: MODULE_ID,
      startedAtSessionId: SESSION_ID,
      ...writeMeta,
    });
    expect(started.status).toBe('active');

    // 3. Record initial progress: the party is in the square at the start.
    mutateState(db, {
      target: 'clock',
      field: 'current_location_id',
      op: 'set',
      value: 'loc-emberfall-square',
      provenance: writeMeta.provenance,
      sessionId: SESSION_ID,
      at: AT,
    });
    recordAdventureRunProgress(db, {
      campaignId: CAMPAIGN_ID,
      runId: RUN_ID,
      delta: { visitedLocations: ['loc-emberfall-square'] },
      ...writeMeta,
    });

    // 4. Advance into the hollow: move location/scene, reveal a secret, resolve
    //    an encounter, and complete an objective.
    mutateState(db, {
      target: 'clock',
      field: 'current_location_id',
      op: 'set',
      value: 'loc-deep-hollow',
      provenance: writeMeta.provenance,
      sessionId: SESSION_ID,
      at: AT,
    });
    recordAdventureRunProgress(db, {
      campaignId: CAMPAIGN_ID,
      runId: RUN_ID,
      delta: {
        visitedLocations: [
          'loc-watchtower-mouth',
          'loc-collapsed-stair',
          'loc-deep-hollow',
        ],
        completedOrBypassedScenes: ['scene-arrival'],
        revealedSecrets: ['secret-not-a-natural-lair'],
        completedObjectives: ['obj-clear-the-hollow'],
        encounterOutcomes: [
          { encounterId: 'enc-mouth-ambush', outcome: 'defeated' },
        ],
        deviations: [
          { id: 'dev-spared-grik', description: 'The party spared Grik.' },
        ],
      },
      ...writeMeta,
    });

    // 5. Build the bounded runtime context from immutable source + progress.
    const audit = buildCampaignAdventureAudit(db, {
      campaignId: CAMPAIGN_ID,
      resolveAdventureModule,
    });
    expect(audit.runs).toHaveLength(1);
    const slice = audit.runs[0]?.contextSlice;
    expect(slice).toBeDefined();
    // Campaign truth seats the slice in the deep hollow.
    expect(slice?.currentLocation?.id).toBe('loc-deep-hollow');
    expect(slice?.currentScene?.id).toBe('scene-the-warren');
    // Progress is applied over the authored source: revealed secret is gone from
    // the unrevealed list, the completed objective is no longer active, and the
    // resolved encounter is no longer pending.
    expect(slice?.unrevealedSecrets.map((s) => s.id)).not.toContain(
      'secret-not-a-natural-lair',
    );
    expect(slice?.activeObjectives.map((o) => o.id)).not.toContain(
      'obj-clear-the-hollow',
    );
    expect(slice?.pendingEncounters.map((e) => e.id)).not.toContain(
      'enc-mouth-ambush',
    );
    expect(slice?.deviations.map((d) => d.id)).toContain('dev-spared-grik');

    // 6. Persist and reload the campaign (close + reopen the SQLite file).
    db.close();
    db = openDatabase(dbPath);

    // 7. After reload, the binding and progress are intact.
    const reloaded = getAdventureRun(db, {
      campaignId: CAMPAIGN_ID,
      runId: RUN_ID,
    });
    expect(reloaded).toBeDefined();
    expect(reloaded?.moduleId).toBe(MODULE_ID);
    expect(reloaded?.status).toBe('active');
    expect(reloaded?.progress.revealedSecrets).toContain(
      'secret-not-a-natural-lair',
    );
    expect(reloaded?.progress.completedObjectives).toContain(
      'obj-clear-the-hollow',
    );
    expect(reloaded?.progress.completedOrBypassedScenes).toContain(
      'scene-arrival',
    );
    expect(reloaded?.progress.encounterOutcomes).toContainEqual({
      encounterId: 'enc-mouth-ambush',
      outcome: 'defeated',
    });
    expect(reloaded?.progress.deviations).toContainEqual({
      id: 'dev-spared-grik',
      description: 'The party spared Grik.',
    });

    // The runtime context still composes correctly from the reloaded state.
    const auditAfter = buildCampaignAdventureAudit(db, {
      campaignId: CAMPAIGN_ID,
      resolveAdventureModule,
    });
    expect(auditAfter.runs[0]?.contextSlice?.currentScene?.id).toBe(
      'scene-the-warren',
    );
    db.close();

    // 8. The authored source module was never mutated by any of the above.
    const sourceAfter = loadAdventureModuleFromDir(MODULE_DIR);
    expect(sourceAfter).toEqual(sourceBefore);
  });
});
