import { describe, expect, it } from 'vitest';
import type { ModulePack } from '../src/internal.js';
import {
  appendSceneLog,
  assertDemoContentAllowed,
  assertDemoTurnAllowed,
  createDemoCampaign,
  DEFAULT_DEMO_PACK,
  DEMO_TURN_CAP,
  DemoModeError,
  demoTurnBudget,
  evaluateDemoContent,
  getDemoTurnBudget,
  openScene,
  resolveDemoModel,
  resolveProfileRegistry,
} from '../src/internal.js';
import { bareDb } from './support/db.js';

const CAMPAIGN = 'demo-campaign';
const SESSION = 'demo-session-1';

/** A copy of the bundled demo pack with a license class that is not shippable. */
function userPrivatePack(): ModulePack {
  const pack = structuredClone(DEFAULT_DEMO_PACK) as ModulePack;
  return {
    ...pack,
    meta: {
      ...pack.meta,
      packId: 'user:home-brew',
      license: {
        ...pack.meta.license,
        licenseClass: 'user-private',
        hostedUseAllowed: false,
        publicSharingAllowed: false,
        redistributionAllowed: false,
      },
    },
  };
}

describe('demo campaign mode', () => {
  it('creates a premium-by-default bounded demo from an allowed pack', () => {
    const db = bareDb();

    const demo = createDemoCampaign(db, {
      campaignId: CAMPAIGN,
      sessionId: SESSION,
      startedAt: '2026-05-21T00:00:00.000Z',
    });

    expect(demo.model.profile).toBe('premium_dm');
    expect(demo.model.quality).toBe('intended');
    expect(demo.model.experimental).toBe(false);
    expect(demo.model.disclaimer).toBeUndefined();
    expect(demo.turnCap).toBe(DEMO_TURN_CAP);
    expect(demo.session.status).toBe('open');
    expect(demo.packId).toBe(DEFAULT_DEMO_PACK.meta.packId);

    // The module template was forked in, so world continuity is available.
    const row = db
      .prepare('SELECT pack_id FROM module_meta WHERE id = 1')
      .get() as { pack_id: string } | undefined;
    expect(row?.pack_id).toBe(DEFAULT_DEMO_PACK.meta.packId);
    db.close();
  });

  it('rejects content that is not legal to host in a public demo', () => {
    const db = bareDb();
    const pack = userPrivatePack();

    const policy = evaluateDemoContent(pack);
    expect(policy.allowed).toBe(false);
    expect(policy.reasons.length).toBeGreaterThan(0);

    expect(() => assertDemoContentAllowed(pack)).toThrow(DemoModeError);
    expect(() =>
      createDemoCampaign(db, {
        campaignId: CAMPAIGN,
        sessionId: SESSION,
        startedAt: '2026-05-21T00:00:00.000Z',
        pack,
      }),
    ).toThrow(DemoModeError);
    db.close();
  });

  it('labels an economy-model demo run as experimental, not intended quality', () => {
    const intended = resolveDemoModel();
    expect(intended.profile).toBe('premium_dm');
    expect(intended.quality).toBe('intended');

    // economy_or_experimental has no default provider/model — explicit config
    // is required. This mirrors real usage: ops must opt in deliberately.
    const economyRegistry = resolveProfileRegistry({
      ESHYRA_PROFILE_ECONOMY_OR_EXPERIMENTAL_PROVIDER: 'anthropic',
      ESHYRA_PROFILE_ECONOMY_OR_EXPERIMENTAL_MODEL: 'claude-haiku-4-5-20251001',
    });
    const economy = resolveDemoModel(
      economyRegistry,
      'economy_or_experimental',
    );
    expect(economy.quality).toBe('experimental');
    expect(economy.experimental).toBe(true);
    expect(economy.disclaimer).toMatch(/experimental/i);
    expect(economy.disclaimer).not.toBeUndefined();

    const db = bareDb();
    const demo = createDemoCampaign(db, {
      campaignId: CAMPAIGN,
      sessionId: SESSION,
      startedAt: '2026-05-21T00:00:00.000Z',
      dmProfile: 'economy_or_experimental',
      profileRegistry: economyRegistry,
    });
    expect(demo.model.quality).toBe('experimental');
    expect(demo.model.disclaimer).toMatch(/experimental/i);
    db.close();
  });

  it('enforces the bounded turn cap', () => {
    const under = demoTurnBudget(3, 1);
    expect(under).toEqual({
      turnCap: 3,
      turnsUsed: 1,
      turnsRemaining: 2,
      capReached: false,
    });
    expect(() => assertDemoTurnAllowed(under)).not.toThrow();

    const reached = demoTurnBudget(3, 3);
    expect(reached.capReached).toBe(true);
    expect(reached.turnsRemaining).toBe(0);
    expect(() => assertDemoTurnAllowed(reached)).toThrow(DemoModeError);

    // An over-run never reports negative remaining turns.
    expect(demoTurnBudget(3, 5).turnsRemaining).toBe(0);
    expect(() => demoTurnBudget(0, 0)).toThrow(DemoModeError);
  });

  it('counts real player turns against the cap from live scene state', () => {
    const db = bareDb();
    const demo = createDemoCampaign(db, {
      campaignId: CAMPAIGN,
      sessionId: SESSION,
      startedAt: '2026-05-21T00:00:00.000Z',
      turnCap: 2,
    });
    openScene(db, {
      campaignId: CAMPAIGN,
      sessionId: SESSION,
      sceneId: 'scene-1',
      title: 'Emberfall Square',
      at: '2026-05-21T00:01:00.000Z',
    });

    expect(getDemoTurnBudget(db, demo).turnsUsed).toBe(0);

    for (const turnId of ['turn-1', 'turn-2']) {
      appendSceneLog(db, {
        campaignId: CAMPAIGN,
        sessionId: SESSION,
        sceneId: 'scene-1',
        turnId,
        role: 'player',
        content: `player input ${turnId}`,
        at: '2026-05-21T00:02:00.000Z',
      });
      appendSceneLog(db, {
        campaignId: CAMPAIGN,
        sessionId: SESSION,
        sceneId: 'scene-1',
        turnId,
        role: 'dm',
        content: `dm narration ${turnId}`,
        at: '2026-05-21T00:02:30.000Z',
      });
    }

    const budget = getDemoTurnBudget(db, demo);
    expect(budget.turnsUsed).toBe(2);
    expect(budget.capReached).toBe(true);
    db.close();
  });
});
