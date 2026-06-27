import { describe, expect, it } from 'vitest';
import {
  buildAdvancementPolicy,
  DEFAULT_ADVANCEMENT_MODE,
  getBundledDnd5eSrdPack,
  getEffectiveAdvancementMode,
  ProgressionError,
  resolveCampaignAdvancementPolicy,
  resolveRulesStack,
  writeCampaignProgressionPolicy,
} from '../src/internal.js';
import { bareDb, DEFAULT_TEST_SESSION_ID } from './support/db.js';

const AT = '2026-06-01T10:00:00.000Z';

function selectMode(db: ReturnType<typeof bareDb>, mode: 'xp' | 'milestone') {
  writeCampaignProgressionPolicy(db, {
    advancementMode: mode,
    provenance: 'campaign:setup',
    sessionId: DEFAULT_TEST_SESSION_ID,
    at: AT,
  });
}

describe('getEffectiveAdvancementMode', () => {
  it('defaults to xp when no policy is persisted', () => {
    const db = bareDb();
    expect(DEFAULT_ADVANCEMENT_MODE).toBe('xp');
    expect(getEffectiveAdvancementMode(db)).toBe('xp');
    db.close();
  });

  it('reflects a persisted selection', () => {
    const db = bareDb();
    selectMode(db, 'milestone');
    expect(getEffectiveAdvancementMode(db)).toBe('milestone');
    db.close();
  });
});

describe('resolveCampaignAdvancementPolicy', () => {
  it('returns an xp policy carrying the resolved threshold table (default)', () => {
    const db = bareDb();
    const policy = resolveCampaignAdvancementPolicy(db);
    expect(policy.mode).toBe('xp');
    if (policy.mode === 'xp') {
      expect(policy.table.thresholds).toHaveLength(20);
      expect(policy.table.thresholds[1]).toMatchObject({
        level: 2,
        xpThreshold: 300,
      });
    }
    db.close();
  });

  it('returns a milestone policy with no table when selected', () => {
    const db = bareDb();
    selectMode(db, 'milestone');
    const policy = resolveCampaignAdvancementPolicy(db);
    expect(policy).toEqual({ mode: 'milestone' });
    db.close();
  });

  it('returns an xp policy when xp is explicitly selected', () => {
    const db = bareDb();
    selectMode(db, 'xp');
    const policy = resolveCampaignAdvancementPolicy(db);
    expect(policy.mode).toBe('xp');
    db.close();
  });
});

describe('buildAdvancementPolicy (pure, over an explicit stack)', () => {
  const stack = resolveRulesStack({ base: getBundledDnd5eSrdPack() });

  it('builds an xp policy with the table from the given stack', () => {
    const policy = buildAdvancementPolicy('xp', stack);
    expect(policy.mode).toBe('xp');
    if (policy.mode === 'xp') {
      expect(policy.table.thresholds).toHaveLength(20);
    }
  });

  it('builds a milestone policy without touching the stack', () => {
    expect(buildAdvancementPolicy('milestone', stack)).toEqual({
      mode: 'milestone',
    });
  });

  it('fails closed in xp mode when the stack has no advancement table', () => {
    const emptyStack = resolveRulesStack({
      base: {
        meta: {
          packId: 'rules:empty',
          title: 'Empty',
          description: 'fixture',
          role: 'base',
          systemId: 'dnd5e-srd',
          version: '5.1',
          license: getBundledDnd5eSrdPack().records[0].license,
        },
        records: [],
      },
    });
    expect(() => buildAdvancementPolicy('xp', emptyStack)).toThrow(
      ProgressionError,
    );
  });
});
