import { describe, expect, it } from 'vitest';
import {
  completeLongRest,
  completeShortRest,
  createDefaultToolRegistry,
  RestError,
} from '../src/internal.js';
import {
  DEFAULT_TEST_CAMPAIGN_ID,
  DEFAULT_TEST_SESSION_ID,
  freshDbWithSession,
} from './support/db.js';

const CTX = {
  campaignId: DEFAULT_TEST_CAMPAIGN_ID,
  provenance: 'test:rest',
  sessionId: DEFAULT_TEST_SESSION_ID,
  at: '2026-07-14T00:00:00.000Z',
};

describe('F7 rest qualification boundary', () => {
  it('rejects coercible, malformed, and unknown qualification fields', () => {
    const db = freshDbWithSession();
    for (const qualification of [
      { durationMinutes: '60' },
      { durationMinutes: -1 },
      { durationMinutes: 60, strenuousActivity: 0 },
      { durationMinutes: 60, unknownEvidence: true },
    ]) {
      expect(() =>
        completeShortRest(db, {
          ...CTX,
          restId: `bad-${JSON.stringify(qualification)}`,
          participants: ['pc-1'],
          qualification: qualification as never,
        }),
      ).toThrow(RestError);
    }
    expect(db.prepare('SELECT count(*) count FROM rest_event').get()).toEqual({
      count: 0,
    });
    db.close();
  });

  it('rejects completion from durable active combat state', () => {
    const db = freshDbWithSession();
    db.prepare(
      `INSERT INTO combat_instance(campaign_id, combat_instance_id, status, provenance, session_id, opened_at, updated_at)
       VALUES (?, ?, 'active', ?, ?, ?, ?)`,
    ).run(
      DEFAULT_TEST_CAMPAIGN_ID,
      'combat-1',
      CTX.provenance,
      CTX.sessionId,
      CTX.at,
      CTX.at,
    );
    expect(() =>
      completeLongRest(db, {
        ...CTX,
        restId: 'blocked-by-combat',
        participants: ['pc-1'],
        qualification: {
          durationMinutes: 480,
          sleepMinutes: 360,
          lightActivityMinutes: 0,
          strenuousInterruptionMinutes: 0,
          strenuousActivity: false,
          foodAndDrink: true,
        },
      }),
    ).toThrow(/combat is active/);
    expect(db.prepare('SELECT count(*) count FROM rest_event').get()).toEqual({
      count: 0,
    });
    db.close();
  });

  it('publishes an explicit qualification schema', () => {
    const definition = createDefaultToolRegistry()
      .definitions()
      .find((tool) => tool.name === 'complete_long_rest');
    const qualification = definition?.inputSchema.properties.qualification as {
      properties: Record<string, unknown>;
      additionalProperties: boolean;
    };
    expect(Object.keys(qualification.properties).sort()).toEqual(
      [
        'durationMinutes',
        'foodAndDrink',
        'lightActivityMinutes',
        'sleepMinutes',
        'strenuousActivity',
        'strenuousInterruptionMinutes',
      ].sort(),
    );
    expect(qualification.additionalProperties).toBe(false);
  });
});
