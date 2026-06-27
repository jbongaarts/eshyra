import { describe, expect, it } from 'vitest';
import {
  getProgressionEvent,
  getProgressionState,
  listProgressionEvents,
  MutateStateError,
  mutateState,
  ProgressionError,
  readCampaignProgressionPolicy,
  recordProgressionEvent,
  writeCampaignProgressionPolicy,
} from '../src/internal.js';
import { bareDb, DEFAULT_TEST_SESSION_ID } from './support/db.js';

const AT = '2026-05-20T10:00:00.000Z';

function xpAwardInput(overrides: Record<string, unknown> = {}) {
  return {
    kind: 'xp-award' as const,
    amount: 100,
    source: 'encounter',
    resultingXp: 100,
    resultingLevel: 1,
    occurredAt: AT,
    provenance: 'tool:award_xp',
    sessionId: DEFAULT_TEST_SESSION_ID,
    ...overrides,
  };
}

describe('getProgressionState', () => {
  it('reads the bootstrap character at level 1 with zero XP', () => {
    const db = bareDb();
    expect(getProgressionState(db)).toEqual({
      characterId: 'pc-1',
      level: 1,
      currentXp: 0,
    });
    db.close();
  });

  it('reflects XP written through the validated mutateState seam', () => {
    const db = bareDb();
    mutateState(db, {
      target: 'character',
      field: 'current_xp',
      op: 'set',
      value: 350,
      provenance: 'tool:award_xp',
      sessionId: DEFAULT_TEST_SESSION_ID,
      at: AT,
    });
    expect(getProgressionState(db).currentXp).toBe(350);
    db.close();
  });

  it('throws for an unknown character', () => {
    const db = bareDb();
    expect(() => getProgressionState(db, 'nope')).toThrow(ProgressionError);
    db.close();
  });
});

describe('current_xp mutateState validation', () => {
  it('rejects a negative XP total', () => {
    const db = bareDb();
    expect(() =>
      mutateState(db, {
        target: 'character',
        field: 'current_xp',
        op: 'set',
        value: -1,
        provenance: 'tool:award_xp',
        sessionId: DEFAULT_TEST_SESSION_ID,
        at: AT,
      }),
    ).toThrow(MutateStateError);
    db.close();
  });

  it('rejects a non-integer XP total', () => {
    const db = bareDb();
    expect(() =>
      mutateState(db, {
        target: 'character',
        field: 'current_xp',
        op: 'set',
        value: 12.5,
        provenance: 'tool:award_xp',
        sessionId: DEFAULT_TEST_SESSION_ID,
        at: AT,
      }),
    ).toThrow(MutateStateError);
    db.close();
  });
});

describe('campaign progression policy', () => {
  it('is unset until written', () => {
    const db = bareDb();
    expect(readCampaignProgressionPolicy(db)).toBeUndefined();
    db.close();
  });

  it('round-trips a written policy', () => {
    const db = bareDb();
    const written = writeCampaignProgressionPolicy(db, {
      advancementMode: 'milestone',
      provenance: 'campaign:setup',
      sessionId: DEFAULT_TEST_SESSION_ID,
      at: AT,
    });
    expect(written.advancementMode).toBe('milestone');
    expect(readCampaignProgressionPolicy(db)).toEqual({
      advancementMode: 'milestone',
      provenance: 'campaign:setup',
      sessionId: DEFAULT_TEST_SESSION_ID,
      updatedAt: AT,
    });
    db.close();
  });

  it('replaces the singleton on a second write', () => {
    const db = bareDb();
    writeCampaignProgressionPolicy(db, {
      advancementMode: 'xp',
      provenance: 'campaign:setup',
      sessionId: DEFAULT_TEST_SESSION_ID,
      at: AT,
    });
    writeCampaignProgressionPolicy(db, {
      advancementMode: 'milestone',
      provenance: 'campaign:retune',
      sessionId: DEFAULT_TEST_SESSION_ID,
      at: '2026-05-21T10:00:00.000Z',
    });
    expect(readCampaignProgressionPolicy(db)?.advancementMode).toBe(
      'milestone',
    );
    db.close();
  });

  it('rejects an unknown advancement mode', () => {
    const db = bareDb();
    expect(() =>
      writeCampaignProgressionPolicy(db, {
        // biome-ignore lint/suspicious/noExplicitAny: testing invalid input
        advancementMode: 'bogus' as any,
        provenance: 'campaign:setup',
        sessionId: DEFAULT_TEST_SESSION_ID,
        at: AT,
      }),
    ).toThrow(ProgressionError);
    db.close();
  });

  it('rejects empty audit fields', () => {
    const db = bareDb();
    expect(() =>
      writeCampaignProgressionPolicy(db, {
        advancementMode: 'xp',
        provenance: '',
        sessionId: DEFAULT_TEST_SESSION_ID,
        at: AT,
      }),
    ).toThrow(ProgressionError);
    db.close();
  });
});

describe('progression-event ledger', () => {
  it('records an xp-award and round-trips it', () => {
    const db = bareDb();
    const record = recordProgressionEvent(db, xpAwardInput());
    expect(record).toEqual({
      id: 'prog-pc-1-1',
      characterId: 'pc-1',
      kind: 'xp-award',
      amount: 100,
      source: 'encounter',
      resultingXp: 100,
      resultingLevel: 1,
      occurredAt: AT,
      provenance: 'tool:award_xp',
      sessionId: DEFAULT_TEST_SESSION_ID,
    });
    expect(getProgressionEvent(db, 'prog-pc-1-1')).toEqual(record);
    db.close();
  });

  it('records a milestone-award without an XP total', () => {
    const db = bareDb();
    const record = recordProgressionEvent(db, {
      kind: 'milestone-award',
      milestoneLabel: 'Cleared the Sunless Citadel',
      source: 'dm',
      resultingLevel: 2,
      occurredAt: AT,
      provenance: 'dm:ruling',
      sessionId: DEFAULT_TEST_SESSION_ID,
    });
    expect(record.milestoneLabel).toBe('Cleared the Sunless Citadel');
    expect(record.amount).toBeUndefined();
    expect(record.resultingXp).toBeUndefined();
    db.close();
  });

  it('records a level-up with an opaque applied-changes set that round-trips', () => {
    const db = bareDb();
    const appliedChanges = {
      level: 2,
      hpGained: 7,
      proficiencyBonus: 2,
      features: ['feature:rogue:cunning-action'],
    };
    const record = recordProgressionEvent(db, {
      kind: 'level-up',
      source: 'level-up-engine',
      resultingXp: 300,
      resultingLevel: 2,
      appliedChanges,
      occurredAt: AT,
      provenance: 'tool:apply_level_up',
      sessionId: DEFAULT_TEST_SESSION_ID,
    });
    expect(record.appliedChanges).toEqual(appliedChanges);
    expect(getProgressionEvent(db, record.id)?.appliedChanges).toEqual(
      appliedChanges,
    );
    db.close();
  });

  it('generates per-character ids and lists events chronologically', () => {
    const db = bareDb();
    recordProgressionEvent(
      db,
      xpAwardInput({ occurredAt: AT, amount: 50, resultingXp: 50 }),
    );
    recordProgressionEvent(
      db,
      xpAwardInput({
        occurredAt: '2026-05-20T11:00:00.000Z',
        amount: 75,
        resultingXp: 125,
      }),
    );
    const events = listProgressionEvents(db);
    expect(events.map((e) => e.id)).toEqual(['prog-pc-1-1', 'prog-pc-1-2']);
    expect(events.map((e) => e.resultingXp)).toEqual([50, 125]);
    db.close();
  });

  it('honors an explicitly supplied id', () => {
    const db = bareDb();
    const record = recordProgressionEvent(db, xpAwardInput({ id: 'custom-1' }));
    expect(record.id).toBe('custom-1');
    db.close();
  });

  describe('validation', () => {
    it('rejects an unknown kind', () => {
      const db = bareDb();
      expect(() =>
        // biome-ignore lint/suspicious/noExplicitAny: testing invalid input
        recordProgressionEvent(db, xpAwardInput({ kind: 'bogus' as any })),
      ).toThrow(ProgressionError);
      db.close();
    });

    it('rejects an xp-award without an amount', () => {
      const db = bareDb();
      expect(() =>
        recordProgressionEvent(db, xpAwardInput({ amount: undefined })),
      ).toThrow(/xp-award requires an amount/);
      db.close();
    });

    it('rejects an xp-award carrying a milestoneLabel', () => {
      const db = bareDb();
      expect(() =>
        recordProgressionEvent(db, xpAwardInput({ milestoneLabel: 'oops' })),
      ).toThrow(/must not carry a milestoneLabel/);
      db.close();
    });

    it('rejects a milestone-award without a label', () => {
      const db = bareDb();
      expect(() =>
        recordProgressionEvent(db, {
          kind: 'milestone-award',
          source: 'dm',
          resultingLevel: 2,
          occurredAt: AT,
          provenance: 'dm:ruling',
          sessionId: DEFAULT_TEST_SESSION_ID,
        }),
      ).toThrow(/milestone-award requires a milestoneLabel/);
      db.close();
    });

    it('rejects a milestone-award carrying an amount', () => {
      const db = bareDb();
      expect(() =>
        recordProgressionEvent(db, {
          kind: 'milestone-award',
          milestoneLabel: 'done',
          amount: 5,
          source: 'dm',
          resultingLevel: 2,
          occurredAt: AT,
          provenance: 'dm:ruling',
          sessionId: DEFAULT_TEST_SESSION_ID,
        }),
      ).toThrow(/must not carry an amount/);
      db.close();
    });

    it('rejects a resulting level below 1', () => {
      const db = bareDb();
      expect(() =>
        recordProgressionEvent(db, xpAwardInput({ resultingLevel: 0 })),
      ).toThrow(ProgressionError);
      db.close();
    });

    it('rejects a non-integer amount', () => {
      const db = bareDb();
      expect(() =>
        recordProgressionEvent(db, xpAwardInput({ amount: 1.5 })),
      ).toThrow(ProgressionError);
      db.close();
    });

    it('rejects an xp-award carrying appliedChanges', () => {
      const db = bareDb();
      expect(() =>
        recordProgressionEvent(db, xpAwardInput({ appliedChanges: { x: 1 } })),
      ).toThrow(/xp-award must not carry appliedChanges/);
      db.close();
    });

    it('rejects a milestone-award carrying resultingXp', () => {
      const db = bareDb();
      expect(() =>
        recordProgressionEvent(db, {
          kind: 'milestone-award',
          milestoneLabel: 'done',
          resultingXp: 300,
          source: 'dm',
          resultingLevel: 2,
          occurredAt: AT,
          provenance: 'dm:ruling',
          sessionId: DEFAULT_TEST_SESSION_ID,
        }),
      ).toThrow(/milestone-award must not carry resultingXp/);
      db.close();
    });

    it('rejects a milestone-award carrying appliedChanges', () => {
      const db = bareDb();
      expect(() =>
        recordProgressionEvent(db, {
          kind: 'milestone-award',
          milestoneLabel: 'done',
          appliedChanges: { level: 2 },
          source: 'dm',
          resultingLevel: 2,
          occurredAt: AT,
          provenance: 'dm:ruling',
          sessionId: DEFAULT_TEST_SESSION_ID,
        }),
      ).toThrow(/milestone-award must not carry appliedChanges/);
      db.close();
    });

    it('rejects a level-up without appliedChanges', () => {
      const db = bareDb();
      expect(() =>
        recordProgressionEvent(db, {
          kind: 'level-up',
          source: 'level-up-engine',
          resultingXp: 300,
          resultingLevel: 2,
          occurredAt: AT,
          provenance: 'tool:apply_level_up',
          sessionId: DEFAULT_TEST_SESSION_ID,
        }),
      ).toThrow(/level-up requires appliedChanges/);
      db.close();
    });

    it('rejects a level-up carrying an amount', () => {
      const db = bareDb();
      expect(() =>
        recordProgressionEvent(db, {
          kind: 'level-up',
          amount: 50,
          appliedChanges: { level: 2 },
          source: 'level-up-engine',
          resultingLevel: 2,
          occurredAt: AT,
          provenance: 'tool:apply_level_up',
          sessionId: DEFAULT_TEST_SESSION_ID,
        }),
      ).toThrow(/level-up must not carry an amount/);
      db.close();
    });
  });
});
