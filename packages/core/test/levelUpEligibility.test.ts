// Level-up eligibility detection (eshyra-lupf.7): a pure, read-only verdict over
// progression state + advancement policy. Tests cover XP-threshold crossing
// (incl. boundaries and multi-level catch-up), milestone outstanding/consumed
// counting, and the not-eligible defaults.

import { describe, expect, it } from 'vitest';
import {
  awardXp,
  getBundledAdvancementTable,
  getLevelUpEligibility,
  grantMilestone,
  mutateState,
  recordProgressionEvent,
  writeCampaignProgressionPolicy,
} from '../src/internal.js';
import { bareDb, DEFAULT_TEST_SESSION_ID } from './support/db.js';

const AT = '2026-05-26T12:00:00.000Z';
const CTX = {
  provenance: 'tool:award_xp',
  sessionId: DEFAULT_TEST_SESSION_ID,
  at: AT,
};

// Frozen SRD 5.1 Character Advancement thresholds: L2=300, L3=900, L4=2700.
const xpTable = getBundledAdvancementTable();
const L2 = xpTable.thresholds[1].xpThreshold;
const L3 = xpTable.thresholds[2].xpThreshold;

function selectMilestoneMode(db: ReturnType<typeof bareDb>): void {
  writeCampaignProgressionPolicy(db, {
    advancementMode: 'milestone',
    provenance: 'test:policy',
    sessionId: DEFAULT_TEST_SESSION_ID,
    at: AT,
  });
}

/** Set current level directly (no apply engine yet) to drive eligibility math. */
function setLevel(db: ReturnType<typeof bareDb>, level: number): void {
  mutateState(db, {
    target: 'character',
    field: 'level',
    op: 'set',
    value: level,
    provenance: 'test:level',
    sessionId: DEFAULT_TEST_SESSION_ID,
    at: AT,
  });
}

describe('getLevelUpEligibility — XP mode', () => {
  it('is not eligible at level 1 with zero XP', () => {
    const db = bareDb();
    expect(getLevelUpEligibility(db)).toEqual({
      mode: 'xp',
      currentLevel: 1,
      targetLevel: 1,
      pendingLevels: 0,
      eligible: false,
    });
    db.close();
  });

  it('is not eligible one XP below the level-2 threshold', () => {
    const db = bareDb();
    awardXp(db, L2 - 1, 'grind', CTX);
    expect(getLevelUpEligibility(db)).toMatchObject({
      eligible: false,
      targetLevel: 1,
      pendingLevels: 0,
    });
    db.close();
  });

  it('becomes eligible exactly at the level-2 threshold', () => {
    const db = bareDb();
    awardXp(db, L2, 'encounter', CTX);
    expect(getLevelUpEligibility(db)).toMatchObject({
      eligible: true,
      currentLevel: 1,
      targetLevel: 2,
      pendingLevels: 1,
    });
    db.close();
  });

  it('reports multi-level catch-up when XP jumps several thresholds', () => {
    const db = bareDb();
    awardXp(db, L3, 'big haul', CTX); // 900 XP, still level 1
    expect(getLevelUpEligibility(db)).toMatchObject({
      eligible: true,
      currentLevel: 1,
      targetLevel: 3,
      pendingLevels: 2,
    });
    db.close();
  });

  it('is not eligible again once the level has caught up to the XP', () => {
    const db = bareDb();
    awardXp(db, L2, 'encounter', CTX);
    setLevel(db, 2); // simulate the level-up having been applied
    expect(getLevelUpEligibility(db)).toMatchObject({
      eligible: false,
      currentLevel: 2,
      targetLevel: 2,
    });
    db.close();
  });
});

describe('getLevelUpEligibility — milestone mode', () => {
  it('is not eligible with no outstanding milestone', () => {
    const db = bareDb();
    selectMilestoneMode(db);
    expect(getLevelUpEligibility(db)).toMatchObject({
      mode: 'milestone',
      eligible: false,
      currentLevel: 1,
      targetLevel: 1,
    });
    db.close();
  });

  it('becomes eligible after one milestone grant', () => {
    const db = bareDb();
    selectMilestoneMode(db);
    grantMilestone(db, 'Defeated the dragon', 'DM', CTX);
    expect(getLevelUpEligibility(db)).toMatchObject({
      eligible: true,
      currentLevel: 1,
      targetLevel: 2,
      pendingLevels: 1,
    });
    db.close();
  });

  it('stacks multiple outstanding milestones into catch-up', () => {
    const db = bareDb();
    selectMilestoneMode(db);
    grantMilestone(db, 'Act 1', 'DM', CTX);
    grantMilestone(db, 'Act 2', 'DM', CTX);
    expect(getLevelUpEligibility(db)).toMatchObject({
      eligible: true,
      pendingLevels: 2,
      targetLevel: 3,
    });
    db.close();
  });

  it('clears eligibility once a level-up consumes the milestone', () => {
    const db = bareDb();
    selectMilestoneMode(db);
    grantMilestone(db, 'Act 1', 'DM', CTX);
    // Simulate the apply engine recording a level-up that consumes it.
    setLevel(db, 2);
    recordProgressionEvent(db, {
      kind: 'level-up',
      source: 'apply',
      resultingLevel: 2,
      appliedChanges: { level: 2 },
      occurredAt: AT,
      provenance: 'engine:level-up',
      sessionId: DEFAULT_TEST_SESSION_ID,
    });
    expect(getLevelUpEligibility(db)).toMatchObject({
      eligible: false,
      currentLevel: 2,
      targetLevel: 2,
    });
    db.close();
  });
});
