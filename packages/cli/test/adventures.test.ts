import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  createCampaign,
  EMBERFALL_HOLLOW,
  initSchema,
  openDatabase,
} from '@eshyra/core';
import {
  recordAdventureRunProgress,
  startAdventureRun,
} from '@eshyra/core/internal';
import { afterEach, describe, expect, it } from 'vitest';
import {
  type AdventuresDeps,
  runAdventuresCommand,
} from '../src/adventures.js';
import { ensureDataRoot } from '../src/dataRoot.js';
import { addCampaign, emptyRegistry, saveRegistry } from '../src/registry.js';

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function tempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  dirs.push(dir);
  return dir;
}

interface Harness {
  deps: AdventuresDeps;
  logs: string[];
}

function harness(env: Record<string, string | undefined> = {}): Harness {
  const logs: string[] = [];
  return {
    logs,
    deps: {
      root: join(tempDir('esh-adv-root-'), 'data'),
      env,
      log: (message) => logs.push(message),
    },
  };
}

/** Create a campaign DB with a seeded active adventure run; return its path. */
function campaignWithRun(): string {
  const dbPath = join(tempDir('esh-adv-'), 'campaign.db');
  const db = openDatabase(dbPath);
  try {
    initSchema(db);
    createCampaign(db, { campaignId: 'c1', pack: EMBERFALL_HOLLOW });
    startAdventureRun(db, {
      campaignId: 'c1',
      runId: 'run-1',
      moduleId: 'hollow-beneath-emberfall',
      provenance: 'test:adventures',
      sessionId: 'sess-1',
      updatedAt: '2026-06-21T00:00:00.000Z',
    });
    recordAdventureRunProgress(db, {
      campaignId: 'c1',
      runId: 'run-1',
      delta: { visitedLocations: ['loc-square'] },
      provenance: 'test:adventures',
      sessionId: 'sess-1',
      updatedAt: '2026-06-21T00:00:00.000Z',
    });
  } finally {
    db.close();
  }
  return dbPath;
}

describe('runAdventuresCommand', () => {
  it('fails when no campaign can be resolved', () => {
    const h = harness();
    expect(runAdventuresCommand(['show'], h.deps)).toBe(1);
    expect(h.logs.join('\n')).toContain('no campaigns');
  });

  it('prints the audit for the resolved campaign via ESHYRA_DB_PATH', () => {
    const dbPath = campaignWithRun();
    const h = harness({ ESHYRA_DB_PATH: dbPath });

    expect(runAdventuresCommand([], h.deps)).toBe(0);
    const out = h.logs.join('\n');
    expect(out).toContain('Adventure audit — campaign c1');
    expect(out).toContain(
      'Adventure run: run-1 -> module hollow-beneath-emberfall',
    );
    expect(out).toContain('visited locations: loc-square');
    // No module installed on disk, so source/slice degrade clearly.
    expect(out).toContain('Source module: UNRESOLVED');
    expect(out).toContain('Runtime context slice: UNAVAILABLE');
  });

  it('resolves a registered campaign by id', () => {
    const dbPath = campaignWithRun();
    const h = harness();
    ensureDataRoot(h.deps.root);
    saveRegistry(
      h.deps.root,
      addCampaign(emptyRegistry(), {
        id: 'quest',
        name: 'Quest',
        dbPath,
        createdAt: '2026-06-21T00:00:00.000Z',
      }),
    );

    expect(runAdventuresCommand(['quest'], h.deps)).toBe(0);
    expect(h.logs.join('\n')).toContain('Adventure audit — campaign c1');
  });

  it('reports cleanly when the campaign has no adventure runs', () => {
    const dbPath = join(tempDir('esh-adv-'), 'campaign.db');
    const db = openDatabase(dbPath);
    try {
      initSchema(db);
      createCampaign(db, { campaignId: 'c1', pack: EMBERFALL_HOLLOW });
    } finally {
      db.close();
    }
    const h = harness({ ESHYRA_DB_PATH: dbPath });

    expect(runAdventuresCommand(['show'], h.deps)).toBe(0);
    expect(h.logs.join('\n')).toContain('No adventure runs');
  });
});
