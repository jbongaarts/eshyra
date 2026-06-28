// Award API (eshyra-lupf.6): awardXp / grantMilestone record an advancement as
// one atomic, policy-aware, auditable mutation. These tests cover both modes,
// fail-closed mode gating, input validation, and ledger/state integrity.

import { describe, expect, it } from 'vitest';
import {
  awardXp,
  getProgressionState,
  grantMilestone,
  listProgressionEvents,
  MutateStateError,
  ProgressionError,
  writeCampaignProgressionPolicy,
} from '../src/internal.js';
import { bareDb, DEFAULT_TEST_SESSION_ID } from './support/db.js';

const AT = '2026-05-26T12:00:00.000Z';
const CTX = {
  provenance: 'tool:award_xp',
  sessionId: DEFAULT_TEST_SESSION_ID,
  at: AT,
};

function selectMilestoneMode(db: ReturnType<typeof bareDb>): void {
  writeCampaignProgressionPolicy(db, {
    advancementMode: 'milestone',
    provenance: 'test:policy',
    sessionId: DEFAULT_TEST_SESSION_ID,
    at: AT,
  });
}

describe('awardXp', () => {
  it('adds XP, writes the total, and appends a matching ledger row', () => {
    const db = bareDb();
    const result = awardXp(db, 100, 'encounter: goblins', CTX);

    expect(result).toMatchObject({
      previousXp: 0,
      newXp: 100,
      level: 1,
    });
    expect(getProgressionState(db).currentXp).toBe(100);

    const events = listProgressionEvents(db);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      kind: 'xp-award',
      amount: 100,
      source: 'encounter: goblins',
      resultingXp: 100,
      resultingLevel: 1,
      provenance: 'tool:award_xp',
    });
    expect(result.event.id).toBe(events[0].id);
    db.close();
  });

  it('accumulates across multiple awards', () => {
    const db = bareDb();
    awardXp(db, 100, 'encounter', CTX);
    const second = awardXp(db, 250, 'quest', CTX);

    expect(second).toMatchObject({ previousXp: 100, newXp: 350 });
    expect(getProgressionState(db).currentXp).toBe(350);
    expect(listProgressionEvents(db)).toHaveLength(2);
    db.close();
  });

  it('never changes the character level (eligibility/apply are separate)', () => {
    const db = bareDb();
    // 100k XP is well past every SRD threshold, but an award never levels up.
    const result = awardXp(db, 100_000, 'big haul', CTX);
    expect(result.level).toBe(1);
    expect(getProgressionState(db).level).toBe(1);
    db.close();
  });

  it('rejects a non-positive or non-integer amount', () => {
    const db = bareDb();
    expect(() => awardXp(db, 0, 'noop', CTX)).toThrow(MutateStateError);
    expect(() => awardXp(db, -5, 'debt', CTX)).toThrow(MutateStateError);
    expect(() => awardXp(db, 12.5, 'fractional', CTX)).toThrow(
      MutateStateError,
    );
    // Nothing recorded for any rejected award.
    expect(listProgressionEvents(db)).toHaveLength(0);
    expect(getProgressionState(db).currentXp).toBe(0);
    db.close();
  });

  it('fails closed under milestone mode without mutating state', () => {
    const db = bareDb();
    selectMilestoneMode(db);
    expect(() => awardXp(db, 100, 'encounter', CTX)).toThrow(ProgressionError);
    expect(getProgressionState(db).currentXp).toBe(0);
    expect(listProgressionEvents(db)).toHaveLength(0);
    db.close();
  });
});

describe('grantMilestone', () => {
  it('appends a milestone ledger row and leaves XP/level untouched', () => {
    const db = bareDb();
    selectMilestoneMode(db);

    const result = grantMilestone(db, 'Cleared the Sunless Citadel', 'DM', CTX);
    expect(result.level).toBe(1);

    const events = listProgressionEvents(db);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      kind: 'milestone-award',
      milestoneLabel: 'Cleared the Sunless Citadel',
      source: 'DM',
      resultingLevel: 1,
    });
    expect(events[0].resultingXp).toBeUndefined();
    expect(events[0].amount).toBeUndefined();
    expect(result.event.id).toBe(events[0].id);
    expect(getProgressionState(db).currentXp).toBe(0);
    db.close();
  });

  it('rejects an empty milestone label', () => {
    const db = bareDb();
    selectMilestoneMode(db);
    expect(() => grantMilestone(db, '   ', 'DM', CTX)).toThrow(
      MutateStateError,
    );
    expect(listProgressionEvents(db)).toHaveLength(0);
    db.close();
  });

  it('fails closed under XP mode (the default) without recording', () => {
    const db = bareDb();
    expect(() => grantMilestone(db, 'milestone', 'DM', CTX)).toThrow(
      ProgressionError,
    );
    expect(listProgressionEvents(db)).toHaveLength(0);
    db.close();
  });
});
