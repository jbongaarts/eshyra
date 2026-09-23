import { describe, expect, it } from 'vitest';
import {
  type CampaignArcRecord,
  type CloseOpenArcAndOpenNextInput,
  type CloseOpenArcAndOpenNextResult,
  closeOpenArcAndOpenNext,
  getClosedArcCount,
  getClosedSessionsInOpenArc,
  getOpenArc,
  initSchema,
  listClosedArcSummaries,
  openArcIfMissing,
  openDatabase,
  rollupArcSummary,
  stampSessionWithOpenArc,
  startSession,
} from '../src/internal.js';
import type { Db } from '../src/persistence/db.js';

function makeDb(): Db {
  const db = openDatabase(':memory:');
  initSchema(db);
  return db;
}

describe('openArcIfMissing', () => {
  it('creates arc-1 with sequence_no=1 on first call', () => {
    const db = makeDb();
    const arc = openArcIfMissing(db, {
      campaignId: 'c1',
      now: '2026-01-01T00:00:00Z',
    });
    expect(arc).toEqual<CampaignArcRecord>({
      campaignId: 'c1',
      arcId: 'arc-1',
      sequenceNo: 1,
      status: 'open',
      openedAt: '2026-01-01T00:00:00Z',
      closedAt: undefined,
    });
    db.close();
  });

  it('is idempotent: returns the existing open arc on subsequent calls', () => {
    const db = makeDb();
    const first = openArcIfMissing(db, {
      campaignId: 'c1',
      now: '2026-01-01T00:00:00Z',
    });
    const second = openArcIfMissing(db, {
      campaignId: 'c1',
      now: '2026-02-01T00:00:00Z',
    });
    expect(second).toEqual(first);
    expect(second.openedAt).toBe('2026-01-01T00:00:00Z');
    db.close();
  });

  it('creates arc-2 after arc-1 is manually closed', () => {
    const db = makeDb();
    openArcIfMissing(db, { campaignId: 'c1', now: '2026-01-01T00:00:00Z' });
    // Manually flip arc-1 to closed so the partial unique index allows a new open arc
    db.prepare(
      `UPDATE campaign_arc SET status = 'closed', closed_at = ? WHERE campaign_id = ? AND arc_id = ?`,
    ).run('2026-02-01T00:00:00Z', 'c1', 'arc-1');
    const arc2 = openArcIfMissing(db, {
      campaignId: 'c1',
      now: '2026-02-02T00:00:00Z',
    });
    expect(arc2.arcId).toBe('arc-2');
    expect(arc2.sequenceNo).toBe(2);
    expect(arc2.status).toBe('open');
    db.close();
  });
});

describe('getOpenArc', () => {
  it('returns undefined when no arc exists', () => {
    const db = makeDb();
    expect(getOpenArc(db, { campaignId: 'c1' })).toBeUndefined();
    db.close();
  });

  it('returns undefined after the arc is manually closed', () => {
    const db = makeDb();
    openArcIfMissing(db, { campaignId: 'c1', now: '2026-01-01T00:00:00Z' });
    db.prepare(
      `UPDATE campaign_arc SET status = 'closed', closed_at = ? WHERE campaign_id = ?`,
    ).run('2026-02-01T00:00:00Z', 'c1');
    expect(getOpenArc(db, { campaignId: 'c1' })).toBeUndefined();
    db.close();
  });
});

describe('getClosedArcCount', () => {
  it('returns 0 when no arcs exist', () => {
    const db = makeDb();
    expect(getClosedArcCount(db, { campaignId: 'c1' })).toBe(0);
    db.close();
  });

  it('counts only closed arcs', () => {
    const db = makeDb();
    // Open arc-1
    openArcIfMissing(db, { campaignId: 'c1', now: '2026-01-01T00:00:00Z' });
    // Manually close arc-1
    db.prepare(
      `UPDATE campaign_arc SET status = 'closed', closed_at = ? WHERE campaign_id = ? AND arc_id = ?`,
    ).run('2026-02-01T00:00:00Z', 'c1', 'arc-1');
    // Open arc-2
    openArcIfMissing(db, { campaignId: 'c1', now: '2026-02-02T00:00:00Z' });
    // Only arc-1 is closed; arc-2 is still open
    expect(getClosedArcCount(db, { campaignId: 'c1' })).toBe(1);
    db.close();
  });
});

describe('getClosedSessionsInOpenArc', () => {
  it('returns empty when no open arc exists', () => {
    const db = makeDb();
    expect(getClosedSessionsInOpenArc(db, { campaignId: 'c1' })).toEqual([]);
    db.close();
  });

  it('returns closed sessions stamped with the open arc, sorted by closed_at', () => {
    const db = makeDb();
    openArcIfMissing(db, { campaignId: 'c1', now: '2026-01-01T00:00:00Z' });

    // Insert two closed sessions with arc_id stamped
    db.prepare(
      `INSERT INTO campaign_session(campaign_id, session_id, status, started_at, closed_at, arc_id)
       VALUES (?, ?, 'closed', ?, ?, ?)`,
    ).run('c1', 's2', '2026-01-02T00:00:00Z', '2026-01-02T12:00:00Z', 'arc-1');
    db.prepare(
      `INSERT INTO campaign_session(campaign_id, session_id, status, started_at, closed_at, arc_id)
       VALUES (?, ?, 'closed', ?, ?, ?)`,
    ).run('c1', 's1', '2026-01-01T00:00:00Z', '2026-01-01T12:00:00Z', 'arc-1');

    const sessions = getClosedSessionsInOpenArc(db, { campaignId: 'c1' });
    expect(sessions).toHaveLength(2);
    // Should be sorted by closed_at ASC
    expect(sessions[0]).toEqual({
      sessionId: 's1',
      closedAt: '2026-01-01T12:00:00Z',
    });
    expect(sessions[1]).toEqual({
      sessionId: 's2',
      closedAt: '2026-01-02T12:00:00Z',
    });
    db.close();
  });

  it('does not include sessions from other arcs', () => {
    const db = makeDb();
    openArcIfMissing(db, { campaignId: 'c1', now: '2026-01-01T00:00:00Z' });

    // Session stamped with a different arc_id
    db.prepare(
      `INSERT INTO campaign_session(campaign_id, session_id, status, started_at, closed_at, arc_id)
       VALUES (?, ?, 'closed', ?, ?, ?)`,
    ).run(
      'c1',
      's-other',
      '2026-01-01T00:00:00Z',
      '2026-01-01T12:00:00Z',
      'arc-0',
    );
    // Session stamped with open arc
    db.prepare(
      `INSERT INTO campaign_session(campaign_id, session_id, status, started_at, closed_at, arc_id)
       VALUES (?, ?, 'closed', ?, ?, ?)`,
    ).run(
      'c1',
      's-current',
      '2026-01-02T00:00:00Z',
      '2026-01-02T12:00:00Z',
      'arc-1',
    );

    const sessions = getClosedSessionsInOpenArc(db, { campaignId: 'c1' });
    expect(sessions).toHaveLength(1);
    expect(sessions[0]?.sessionId).toBe('s-current');
    db.close();
  });
});

describe('stampSessionWithOpenArc', () => {
  it('sets campaign_session.arc_id to the open arc', () => {
    const db = makeDb();
    openArcIfMissing(db, { campaignId: 'c1', now: '2026-01-01T00:00:00Z' });
    startSession(db, {
      campaignId: 'c1',
      sessionId: 's1',
      startedAt: '2026-01-01T01:00:00Z',
    });
    stampSessionWithOpenArc(db, { campaignId: 'c1', sessionId: 's1' });

    const row = db
      .prepare(
        'SELECT arc_id FROM campaign_session WHERE campaign_id = ? AND session_id = ?',
      )
      .get('c1', 's1') as { arc_id: string | null };
    expect(row.arc_id).toBe('arc-1');
    db.close();
  });

  it('throws if no open arc exists', () => {
    const db = makeDb();
    startSession(db, {
      campaignId: 'c1',
      sessionId: 's1',
      startedAt: '2026-01-01T01:00:00Z',
    });
    expect(() =>
      stampSessionWithOpenArc(db, { campaignId: 'c1', sessionId: 's1' }),
    ).toThrow();
    db.close();
  });
});

describe('listClosedArcSummaries', () => {
  it('returns empty when no arcs exist', () => {
    const db = makeDb();
    expect(listClosedArcSummaries(db, { campaignId: 'c1' })).toEqual([]);
    db.close();
  });

  it('returns closed arcs in sequence_no order', () => {
    const db = makeDb();
    // Manually insert two closed arcs in reverse order so ordering matters
    db.prepare(
      `INSERT INTO campaign_arc(campaign_id, arc_id, sequence_no, status, opened_at, closed_at)
       VALUES (?, ?, ?, 'closed', ?, ?)`,
    ).run('c1', 'arc-2', 2, '2026-02-01T00:00:00Z', '2026-03-01T00:00:00Z');
    db.prepare(
      `INSERT INTO campaign_arc(campaign_id, arc_id, sequence_no, status, opened_at, closed_at)
       VALUES (?, ?, ?, 'closed', ?, ?)`,
    ).run('c1', 'arc-1', 1, '2026-01-01T00:00:00Z', '2026-02-01T00:00:00Z');

    // Insert arc_summary rows for both
    rollupArcSummary(db, {
      campaignId: 'c1',
      arcId: 'arc-2',
      summary: 'Summary for arc 2',
      sourceSessionIds: ['s2'],
      campaignBible: {
        worldFacts: [],
        majorNpcs: [],
        factions: [],
        openThreads: [],
      },
      createdAt: '2026-03-01T00:00:00Z',
    });
    rollupArcSummary(db, {
      campaignId: 'c1',
      arcId: 'arc-1',
      summary: 'Summary for arc 1',
      sourceSessionIds: ['s1'],
      campaignBible: {
        worldFacts: [],
        majorNpcs: [],
        factions: [],
        openThreads: [],
      },
      createdAt: '2026-02-01T00:00:00Z',
    });

    const summaries = listClosedArcSummaries(db, { campaignId: 'c1' });
    expect(summaries).toHaveLength(2);
    expect(summaries[0]?.arcId).toBe('arc-1');
    expect(summaries[1]?.arcId).toBe('arc-2');
    db.close();
  });

  it('does not include open arc even with a hypothetical arc_summary row', () => {
    const db = makeDb();
    openArcIfMissing(db, { campaignId: 'c1', now: '2026-01-01T00:00:00Z' });
    // Manually insert an arc_summary for the open arc (defensive check)
    rollupArcSummary(db, {
      campaignId: 'c1',
      arcId: 'arc-1',
      summary: 'Premature summary',
      sourceSessionIds: [],
      campaignBible: {
        worldFacts: [],
        majorNpcs: [],
        factions: [],
        openThreads: [],
      },
      createdAt: '2026-01-15T00:00:00Z',
    });
    // The join filter on status='closed' should exclude it
    const summaries = listClosedArcSummaries(db, { campaignId: 'c1' });
    expect(summaries).toEqual([]);
    db.close();
  });
});

describe('closeOpenArcAndOpenNext', () => {
  it('writes arc_summary, closes the current arc, opens the next arc atomically', () => {
    const db = makeDb();
    openArcIfMissing(db, { campaignId: 'c1', now: '2026-01-01T00:00:00Z' });

    // Insert two closed sessions stamped with arc-1
    db.prepare(
      `INSERT INTO campaign_session(campaign_id, session_id, status, started_at, closed_at, arc_id)
       VALUES (?, ?, 'closed', ?, ?, ?)`,
    ).run('c1', 's1', '2026-01-01T00:00:00Z', '2026-01-05T00:00:00Z', 'arc-1');
    db.prepare(
      `INSERT INTO campaign_session(campaign_id, session_id, status, started_at, closed_at, arc_id)
       VALUES (?, ?, 'closed', ?, ?, ?)`,
    ).run('c1', 's2', '2026-01-06T00:00:00Z', '2026-01-10T00:00:00Z', 'arc-1');

    const result = closeOpenArcAndOpenNext(db, {
      campaignId: 'c1',
      arcId: 'arc-1',
      summary: 'arc summary text',
      sourceSessionIds: ['s1', 's2'],
      campaignBible: {
        worldFacts: [],
        majorNpcs: [],
        factions: [],
        openThreads: [],
      },
      now: '2026-01-10T00:00:00Z',
    } satisfies CloseOpenArcAndOpenNextInput);

    expect(result).toEqual<CloseOpenArcAndOpenNextResult>({
      closedArcId: 'arc-1',
      newArcId: 'arc-2',
    });

    // arc-1 row: status='closed', closed_at set
    const arc1Row = db
      .prepare(
        'SELECT status, closed_at FROM campaign_arc WHERE campaign_id = ? AND arc_id = ?',
      )
      .get('c1', 'arc-1') as { status: string; closed_at: string | null };
    expect(arc1Row.status).toBe('closed');
    expect(arc1Row.closed_at).toBe('2026-01-10T00:00:00Z');

    // arc-2 row: status='open', sequence_no=2, opened_at=now
    const arc2Row = db
      .prepare(
        'SELECT status, sequence_no, opened_at FROM campaign_arc WHERE campaign_id = ? AND arc_id = ?',
      )
      .get('c1', 'arc-2') as
      | { status: string; sequence_no: number; opened_at: string }
      | undefined;
    expect(arc2Row).toBeDefined();
    expect(arc2Row?.status).toBe('open');
    expect(arc2Row?.sequence_no).toBe(2);
    expect(arc2Row?.opened_at).toBe('2026-01-10T00:00:00Z');

    // arc_summary row exists for (c1, arc-1)
    const summaryRow = db
      .prepare(
        'SELECT summary FROM arc_summary WHERE campaign_id = ? AND arc_id = ?',
      )
      .get('c1', 'arc-1') as { summary: string } | undefined;
    expect(summaryRow).toBeDefined();
    expect(summaryRow?.summary).toBe('arc summary text');

    db.close();
  });

  it('throws when the supplied arcId does not match the open arc', () => {
    const db = makeDb();
    openArcIfMissing(db, { campaignId: 'c1', now: '2026-01-01T00:00:00Z' });

    expect(() =>
      closeOpenArcAndOpenNext(db, {
        campaignId: 'c1',
        arcId: 'arc-99',
        summary: 's',
        sourceSessionIds: [],
        campaignBible: {
          worldFacts: [],
          majorNpcs: [],
          factions: [],
          openThreads: [],
        },
        now: '2026-01-10T00:00:00Z',
      }),
    ).toThrow(/arc-99/);

    db.close();
  });

  it('rolls back the whole transaction when arc_summary write fails', () => {
    const db = makeDb();
    openArcIfMissing(db, { campaignId: 'c1', now: '2026-01-01T00:00:00Z' });

    // Force a failure inside rollupArcSummary: pass a campaignBible whose
    // worldFacts getter throws. rollupArcSummary accesses campaignBible.worldFacts
    // inside reconcileBibleEntries, which runs inside the transaction.
    const badBible = {
      get worldFacts(): string[] {
        throw new Error('forced failure inside transaction');
      },
      majorNpcs: [] as string[],
      factions: [] as string[],
      openThreads: [] as string[],
    };

    expect(() =>
      closeOpenArcAndOpenNext(db, {
        campaignId: 'c1',
        arcId: 'arc-1',
        summary: 'will be rolled back',
        sourceSessionIds: [],
        campaignBible: badBible,
        now: '2026-01-10T00:00:00Z',
      }),
    ).toThrow('forced failure inside transaction');

    // arc-1 must still be open (rollback succeeded)
    const arc1 = db
      .prepare(
        'SELECT status FROM campaign_arc WHERE campaign_id = ? AND arc_id = ?',
      )
      .get('c1', 'arc-1') as { status: string };
    expect(arc1.status).toBe('open');

    // No arc-2 row should exist
    const arc2 = db
      .prepare(
        'SELECT arc_id FROM campaign_arc WHERE campaign_id = ? AND arc_id = ?',
      )
      .get('c1', 'arc-2');
    expect(arc2).toBeUndefined();

    // No arc_summary row for arc-1
    const arcSummary = db
      .prepare(
        'SELECT arc_id FROM arc_summary WHERE campaign_id = ? AND arc_id = ?',
      )
      .get('c1', 'arc-1');
    expect(arcSummary).toBeUndefined();

    db.close();
  });
});
