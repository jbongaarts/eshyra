import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  ADVENTURE_MODULE_FILE,
  type AdventureModule,
  AdventureRunError,
  getAdventureRun,
  initSchema,
  listAdventureRuns,
  loadAdventureModuleFromDir,
  openDatabase,
  type PackLicense,
  recordAdventureRunProgress,
  startAdventureRun,
} from '../src/internal.js';

const tmpDirs: string[] = [];

afterEach(() => {
  for (const dir of tmpDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

const CAMPAIGN_ID = 'camp-1';

function freshDb() {
  const db = openDatabase(':memory:');
  initSchema(db);
  return db;
}

const writeMeta = {
  provenance: 'test:adventure-run',
  sessionId: 'sess-1',
  updatedAt: '2026-06-20T00:00:00.000Z',
};

describe('adventure run state', () => {
  it('starts a campaign-owned run bound to an immutable module id', () => {
    const db = freshDb();
    const run = startAdventureRun(db, {
      campaignId: CAMPAIGN_ID,
      runId: 'run-1',
      moduleId: 'eshyra:hollow-beneath-emberfall',
      startedAtSessionId: 'sess-1',
      ...writeMeta,
    });
    expect(run.moduleId).toBe('eshyra:hollow-beneath-emberfall');
    expect(run.status).toBe('active');
    expect(run.progress.visitedLocations).toEqual([]);
    expect(
      getAdventureRun(db, { campaignId: CAMPAIGN_ID, runId: 'run-1' }),
    ).toEqual(run);
    db.close();
  });

  it('records progress across the full set of progress facets', () => {
    const db = freshDb();
    startAdventureRun(db, {
      campaignId: CAMPAIGN_ID,
      runId: 'run-1',
      moduleId: 'mod',
      ...writeMeta,
    });
    const updated = recordAdventureRunProgress(db, {
      campaignId: CAMPAIGN_ID,
      runId: 'run-1',
      delta: {
        visitedLocations: ['loc-cellar'],
        completedOrBypassedScenes: ['scene-cellar'],
        revealedSecrets: ['secret-shrine'],
        completedObjectives: ['obj-clear'],
        failedObjectives: ['obj-rescue'],
        encounterOutcomes: [{ encounterId: 'enc-rats', outcome: 'defeated' }],
        claimedTreasure: ['treasure-amulet'],
        activeClocks: [{ clockId: 'clock-corruption', filled: 2 }],
        deviations: [
          { id: 'dev-1', description: 'Players collapsed the mill.' },
        ],
      },
      ...writeMeta,
    });
    expect(updated.progress.visitedLocations).toEqual(['loc-cellar']);
    expect(updated.progress.revealedSecrets).toEqual(['secret-shrine']);
    expect(updated.progress.completedObjectives).toEqual(['obj-clear']);
    expect(updated.progress.failedObjectives).toEqual(['obj-rescue']);
    expect(updated.progress.encounterOutcomes).toEqual([
      { encounterId: 'enc-rats', outcome: 'defeated' },
    ]);
    expect(updated.progress.claimedTreasure).toEqual(['treasure-amulet']);
    expect(updated.progress.activeClocks).toEqual([
      { clockId: 'clock-corruption', filled: 2 },
    ]);
    expect(updated.progress.deviations).toEqual([
      { id: 'dev-1', description: 'Players collapsed the mill.' },
    ]);
    db.close();
  });

  it('merges progress idempotently and upserts keyed entries (nonlinear play)', () => {
    const db = freshDb();
    startAdventureRun(db, {
      campaignId: CAMPAIGN_ID,
      runId: 'run-1',
      moduleId: 'mod',
      ...writeMeta,
    });
    recordAdventureRunProgress(db, {
      campaignId: CAMPAIGN_ID,
      runId: 'run-1',
      delta: {
        visitedLocations: ['loc-a', 'loc-b'],
        encounterOutcomes: [{ encounterId: 'enc-1', outcome: 'fled' }],
        activeClocks: [{ clockId: 'clk', filled: 1 }],
      },
      ...writeMeta,
    });
    const after = recordAdventureRunProgress(db, {
      campaignId: CAMPAIGN_ID,
      runId: 'run-1',
      delta: {
        visitedLocations: ['loc-b', 'loc-c'], // loc-b is a revisit
        encounterOutcomes: [{ encounterId: 'enc-1', outcome: 'defeated' }], // upsert
        activeClocks: [{ clockId: 'clk', filled: 3 }], // advance same clock
      },
      ...writeMeta,
    });
    expect(after.progress.visitedLocations).toEqual([
      'loc-a',
      'loc-b',
      'loc-c',
    ]);
    expect(after.progress.encounterOutcomes).toEqual([
      { encounterId: 'enc-1', outcome: 'defeated' },
    ]);
    expect(after.progress.activeClocks).toEqual([
      { clockId: 'clk', filled: 3 },
    ]);
    db.close();
  });

  it('updates status and completion session, supporting completion', () => {
    const db = freshDb();
    startAdventureRun(db, {
      campaignId: CAMPAIGN_ID,
      runId: 'run-1',
      moduleId: 'mod',
      startedAtSessionId: 'sess-1',
      ...writeMeta,
    });
    const done = recordAdventureRunProgress(db, {
      campaignId: CAMPAIGN_ID,
      runId: 'run-1',
      status: 'completed',
      completedAtSessionId: 'sess-3',
      ...writeMeta,
    });
    expect(done.status).toBe('completed');
    expect(done.startedAtSessionId).toBe('sess-1');
    expect(done.completedAtSessionId).toBe('sess-3');
    db.close();
  });

  it('supports more than one adventure run per campaign', () => {
    const db = freshDb();
    startAdventureRun(db, {
      campaignId: CAMPAIGN_ID,
      runId: 'run-a',
      moduleId: 'mod-a',
      ...writeMeta,
    });
    startAdventureRun(db, {
      campaignId: CAMPAIGN_ID,
      runId: 'run-b',
      moduleId: 'mod-b',
      ...writeMeta,
    });
    const runs = listAdventureRuns(db, { campaignId: CAMPAIGN_ID });
    expect(runs.map((r) => r.runId)).toEqual(['run-a', 'run-b']);
    expect(runs.map((r) => r.moduleId)).toEqual(['mod-a', 'mod-b']);
    db.close();
  });

  it('rejects starting a duplicate run id', () => {
    const db = freshDb();
    startAdventureRun(db, {
      campaignId: CAMPAIGN_ID,
      runId: 'run-1',
      moduleId: 'mod',
      ...writeMeta,
    });
    expect(() =>
      startAdventureRun(db, {
        campaignId: CAMPAIGN_ID,
        runId: 'run-1',
        moduleId: 'mod',
        ...writeMeta,
      }),
    ).toThrow(/already exists/);
    db.close();
  });

  it('rejects recording progress for a missing run', () => {
    const db = freshDb();
    expect(() =>
      recordAdventureRunProgress(db, {
        campaignId: CAMPAIGN_ID,
        runId: 'ghost',
        delta: { visitedLocations: ['x'] },
        ...writeMeta,
      }),
    ).toThrow(AdventureRunError);
    db.close();
  });

  it('rejects an invalid status', () => {
    const db = freshDb();
    expect(() =>
      startAdventureRun(db, {
        campaignId: CAMPAIGN_ID,
        runId: 'run-1',
        moduleId: 'mod',
        status: 'paused' as never,
        ...writeMeta,
      }),
    ).toThrow(/invalid adventure run status/);
    db.close();
  });

  it('preserves runs and progress across a save/resume (reopen) cycle', () => {
    const dir = mkdtempSync(join(tmpdir(), 'eshyra-run-'));
    tmpDirs.push(dir);
    const path = join(dir, 'campaign.sqlite');

    const db1 = openDatabase(path);
    initSchema(db1);
    startAdventureRun(db1, {
      campaignId: CAMPAIGN_ID,
      runId: 'run-1',
      moduleId: 'eshyra:hollow-beneath-emberfall',
      startedAtSessionId: 'sess-1',
      ...writeMeta,
    });
    recordAdventureRunProgress(db1, {
      campaignId: CAMPAIGN_ID,
      runId: 'run-1',
      delta: {
        visitedLocations: ['loc-cellar'],
        revealedSecrets: ['secret-shrine'],
      },
      ...writeMeta,
    });
    db1.close();

    // Resume: reopen the persisted campaign database.
    const db2 = openDatabase(path);
    initSchema(db2);
    const resumed = getAdventureRun(db2, {
      campaignId: CAMPAIGN_ID,
      runId: 'run-1',
    });
    expect(resumed?.moduleId).toBe('eshyra:hollow-beneath-emberfall');
    expect(resumed?.startedAtSessionId).toBe('sess-1');
    expect(resumed?.progress.visitedLocations).toEqual(['loc-cellar']);
    expect(resumed?.progress.revealedSecrets).toEqual(['secret-shrine']);
    db2.close();
  });

  it('never mutates the authored module source while recording progress', () => {
    const dir = mkdtempSync(join(tmpdir(), 'eshyra-mod-'));
    tmpDirs.push(dir);
    const modulePath = join(dir, ADVENTURE_MODULE_FILE);
    writeFileSync(modulePath, JSON.stringify(minimalModule()), 'utf8');
    const before = readFileSync(modulePath, 'utf8');
    const loadedBefore = loadAdventureModuleFromDir(dir);

    const db = freshDb();
    startAdventureRun(db, {
      campaignId: CAMPAIGN_ID,
      runId: 'run-1',
      moduleId: loadedBefore.id,
      ...writeMeta,
    });
    recordAdventureRunProgress(db, {
      campaignId: CAMPAIGN_ID,
      runId: 'run-1',
      delta: {
        visitedLocations: ['loc-cellar'],
        revealedSecrets: ['secret-shrine'],
        completedObjectives: ['obj-clear'],
      },
      ...writeMeta,
    });
    db.close();

    // The authored module file and its parsed form are byte-for-byte unchanged.
    expect(readFileSync(modulePath, 'utf8')).toBe(before);
    expect(loadAdventureModuleFromDir(dir)).toEqual(loadedBefore);
  });
});

const moduleLicense: PackLicense = {
  licenseClass: 'original',
  licenseName: 'Creative Commons Attribution 4.0 International',
  attributionText: 'Test adventure, original work for Eshyra, CC-BY-4.0.',
  requiresAttribution: true,
  commercialUseAllowed: true,
  hostedUseAllowed: true,
  redistributionAllowed: true,
  publicSharingAllowed: true,
  derivativeAllowed: true,
  containsUserSuppliedText: false,
  containsTrademarkedSettingMaterial: false,
  sourceMaterialDescription: 'Wholly original test fixture.',
  provenancePolicy: 'Authored in-repo for tests.',
  outputRestrictions: 'None beyond CC-BY-4.0 attribution.',
};

/** Smallest valid adventure module the progress ids in the test reference. */
function minimalModule(): AdventureModule {
  return {
    id: 'eshyra:hollow-beneath-emberfall',
    title: 'The Hollow Beneath Emberfall',
    summary: 'A tiny scenario for the run-state test.',
    intendedLevels: { min: 1, max: 3 },
    intendedPartySize: { min: 1, max: 4 },
    rulesRequirements: { baseSystemId: 'dnd5e-srd' },
    settingCompatibility: [],
    startingSituation: 'Lights flicker in the cellar.',
    startingSceneId: 'scene-cellar',
    hooks: [],
    locations: [
      {
        id: 'loc-cellar',
        name: 'The Flickering Cellar',
        summary: 'A glowing cellar.',
        description: 'Stone steps descend into a cold cellar.',
        exits: [],
        tags: [],
      },
    ],
    scenes: [
      {
        id: 'scene-cellar',
        title: 'Into the Cellar',
        summary: 'The party descends.',
        kind: 'combat',
        locationIds: ['loc-cellar'],
        npcIds: [],
        objectiveIds: ['obj-clear'],
        encounterIds: [],
        secretIds: ['secret-shrine'],
      },
    ],
    npcs: [],
    encounters: [],
    treasure: [],
    secrets: [
      {
        id: 'secret-shrine',
        title: 'The Sealed Shrine',
        dmText: 'A shrine lies behind the false wall.',
        revealableLocationIds: ['loc-cellar'],
        revealableSceneIds: ['scene-cellar'],
      },
    ],
    objectives: [
      {
        id: 'obj-clear',
        title: 'Clear the cellar',
        description: 'Deal with the lights.',
        optional: false,
        successCondition: 'The cellar is cleared.',
        relatedSceneIds: ['scene-cellar'],
        relatedLocationIds: ['loc-cellar'],
      },
    ],
    clocksOrThreats: [],
    randomTables: [],
    milestones: [],
    endingStates: [
      {
        id: 'end-clear',
        title: 'Cleared',
        summary: 'Safe again.',
        kind: 'success',
        condition: 'The party clears the cellar.',
      },
    ],
    provenance: { sourceRef: 'test-fixture' },
    license: moduleLicense,
  };
}
