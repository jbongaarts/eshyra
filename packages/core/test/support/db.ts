import type { Db } from '../../src/index.js';
import { initSchema, openDatabase, startSession } from '../../src/index.js';
import { mutateState } from '../../src/internal.js';

export const DEFAULT_TEST_CAMPAIGN_ID = 'campaign-1';
export const DEFAULT_TEST_SESSION_ID = 'session-1';
export const DEFAULT_TEST_SESSION_STARTED_AT = '2026-05-20T09:00:00.000Z';

/**
 * Default valid ability scores used to satisfy the live-state shape validator
 * when tests create a session but do not set up a full character. Every key is
 * present and every value is an integer in [1, 30].
 */
export const DEFAULT_TEST_ABILITY_SCORES = {
  strength: 10,
  dexterity: 10,
  constitution: 10,
  intelligence: 10,
  wisdom: 10,
  charisma: 10,
};

export interface FreshDbSessionOptions {
  campaignId?: string;
  sessionId?: string;
  startedAt?: string;
}

export function bareDb(): Db {
  const db = openDatabase(':memory:');
  initSchema(db);
  return db;
}

export function freshDbWithSession(options: FreshDbSessionOptions = {}): Db {
  const db = bareDb();
  const sessionId = options.sessionId ?? DEFAULT_TEST_SESSION_ID;
  const startedAt = options.startedAt ?? DEFAULT_TEST_SESSION_STARTED_AT;
  startSession(db, {
    campaignId: options.campaignId ?? DEFAULT_TEST_CAMPAIGN_ID,
    sessionId,
    startedAt,
  });
  // Seed valid ability scores so readStateSnapshot passes shape validation even
  // when the test does not explicitly create a character.
  mutateState(db, {
    target: 'character',
    field: 'ability_scores_json',
    op: 'set',
    value: DEFAULT_TEST_ABILITY_SCORES,
    provenance: 'test:init',
    sessionId,
    at: startedAt,
  });
  return db;
}
