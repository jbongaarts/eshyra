import { describe, expect, it } from 'vitest';
import {
  buildCampaignAdventureAudit,
  formatCampaignAdventureAudit,
  recordAdventureRunProgress,
  startAdventureRun,
} from '../src/internal.js';
import { makeTestAdventureModule } from './support/adventureModuleFixture.js';
import { freshDbWithSession } from './support/db.js';

const CAMPAIGN = 'campaign-1';
const SESSION = 'session-1';

const writeMeta = {
  provenance: 'test:adventure-audit',
  sessionId: SESSION,
  updatedAt: '2026-06-21T00:00:00.000Z',
};

function seedActiveRun(db: ReturnType<typeof freshDbWithSession>): void {
  startAdventureRun(db, {
    campaignId: CAMPAIGN,
    runId: 'run-1',
    moduleId: 'test-delve',
    ...writeMeta,
  });
  recordAdventureRunProgress(db, {
    campaignId: CAMPAIGN,
    runId: 'run-1',
    delta: {
      visitedLocations: ['loc-inn'],
      completedOrBypassedScenes: ['scene-arrival'],
      completedObjectives: ['obj-investigate'],
      revealedSecrets: ['secret-shrine'],
      activeClocks: [{ clockId: 'clock-corruption', filled: 1 }],
      deviations: [{ id: 'dev-1', description: 'The innkeeper fled town.' }],
    },
    ...writeMeta,
  });
}

describe('buildCampaignAdventureAudit', () => {
  it('reports no runs cleanly', () => {
    const db = freshDbWithSession({ sessionId: SESSION });
    const audit = buildCampaignAdventureAudit(db, { campaignId: CAMPAIGN });
    expect(audit.runs).toEqual([]);
    const text = formatCampaignAdventureAudit(audit);
    expect(text).toContain('No adventure runs');
    db.close();
  });

  it('separates source, binding, mutable progress, and the runtime slice when the module resolves', () => {
    const db = freshDbWithSession({ sessionId: SESSION });
    seedActiveRun(db);
    const module = makeTestAdventureModule();

    const audit = buildCampaignAdventureAudit(db, {
      campaignId: CAMPAIGN,
      resolveAdventureModule: (id) => (id === module.id ? module : undefined),
      currentLocationId: 'loc-cellar',
    });

    expect(audit.runs).toHaveLength(1);
    const run = audit.runs[0];
    // Binding.
    expect(run?.moduleId).toBe('test-delve');
    expect(run?.status).toBe('active');
    expect(run?.moduleResolved).toBe(true);
    // Source summary.
    expect(run?.source?.counts.scenes).toBe(2);
    expect(run?.source?.counts.secrets).toBe(1);
    // Derived progress views.
    expect(run?.secrets?.revealed).toEqual(['secret-shrine']);
    expect(run?.secrets?.unrevealed).toEqual([]);
    expect(run?.objectives?.completed).toEqual(['obj-investigate']);
    expect(run?.objectives?.remaining).toEqual(['obj-recover']);
    // Runtime slice captured and seated at the live location.
    expect(run?.contextSlice?.currentLocation?.id).toBe('loc-cellar');

    const text = formatCampaignAdventureAudit(audit);
    expect(text).toContain('Source module: "A Small Test Delve"');
    expect(text).toContain('Binding: status: active');
    expect(text).toContain('Progress (campaign-owned, mutable):');
    expect(text).toContain(
      'Runtime context slice (bounded, as fed to the DM):',
    );
    expect(text).toContain('deviations: dev-1 (The innkeeper fled town.)');
    db.close();
  });

  it('flags revealed ids that are not authored module secrets (drift)', () => {
    const db = freshDbWithSession({ sessionId: SESSION });
    startAdventureRun(db, {
      campaignId: CAMPAIGN,
      runId: 'run-1',
      moduleId: 'test-delve',
      ...writeMeta,
    });
    recordAdventureRunProgress(db, {
      campaignId: CAMPAIGN,
      runId: 'run-1',
      delta: { revealedSecrets: ['secret-ghost'] },
      ...writeMeta,
    });
    const module = makeTestAdventureModule();

    const audit = buildCampaignAdventureAudit(db, {
      campaignId: CAMPAIGN,
      resolveAdventureModule: () => module,
    });
    expect(audit.runs[0]?.secrets?.unknownRevealed).toEqual(['secret-ghost']);
    db.close();
  });

  it('degrades gracefully when the module source does not resolve', () => {
    const db = freshDbWithSession({ sessionId: SESSION });
    seedActiveRun(db);

    const audit = buildCampaignAdventureAudit(db, {
      campaignId: CAMPAIGN,
      resolveAdventureModule: () => undefined,
    });

    const run = audit.runs[0];
    expect(run?.moduleResolved).toBe(false);
    expect(run?.source).toBeUndefined();
    expect(run?.secrets).toBeUndefined();
    expect(run?.objectives).toBeUndefined();
    expect(run?.contextSlice).toBeUndefined();
    // Raw mutable progress is still reported.
    expect(run?.progress.revealedSecrets).toEqual(['secret-shrine']);

    const text = formatCampaignAdventureAudit(audit);
    expect(text).toContain('Source module: UNRESOLVED');
    expect(text).toContain('Runtime context slice: UNAVAILABLE');
    // Even without source, raw progress shows.
    expect(text).toContain('revealed secrets: secret-shrine');
    db.close();
  });
});
