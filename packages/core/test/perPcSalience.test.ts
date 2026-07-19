import { describe, expect, it } from 'vitest';
import type { Db, TraceJsonValue } from '../src/internal.js';
import {
  appendSceneLog,
  ensureCharacterRow,
  getTurnTrace,
  initSchema,
  listSceneSummaries,
  openDatabase,
  openScene,
  recordTurnTrace,
  startSession,
  summarizeSceneFromLog,
} from '../src/internal.js';

const CAMPAIGN = 'campaign-1';
const SESSION = 'session-1';
const AT = '2026-05-28T00:00:00.000Z';

function freshDb(): Db {
  const db = openDatabase(':memory:');
  initSchema(db);
  startSession(db, {
    campaignId: CAMPAIGN,
    sessionId: SESSION,
    startedAt: AT,
  });
  return db;
}

function recordTurn(
  db: Db,
  turnId: string,
  actingCharacterId: string,
  toolCalls: TraceJsonValue[],
): void {
  recordTurnTrace(db, {
    campaignId: CAMPAIGN,
    sessionId: SESSION,
    turnId,
    consentScope: 'private',
    playerInput: 'do something',
    actingCharacterId,
    retrievedContext: [],
    promptProfile: 'default',
    modelOutput: 'narration',
    toolCalls,
    rulesResolution: {},
    acceptedStateDelta: [],
    rejectedCandidates: [],
    finalNarration: 'narration',
    memoryUpdates: [],
    humanCorrections: [],
    qualityFlags: [],
    createdAt: AT,
  });
}

describe('turn trace acting character', () => {
  it('round-trips the acting character id', () => {
    const db = freshDb();
    recordTurn(db, 'turn-1', 'pc-1', []);
    const trace = getTurnTrace(db, {
      campaignId: CAMPAIGN,
      sessionId: SESSION,
      turnId: 'turn-1',
    });
    expect(trace?.actingCharacterId).toBe('pc-1');
  });
});

describe('per-PC scene salient refs', () => {
  it('tags each PC whose state a tool changed during the scene', () => {
    const db = freshDb();
    ensureCharacterRow(db, 'pc-2', 'test', SESSION, AT);
    ensureCharacterRow(db, 'pc-3', 'test', SESSION, AT);

    // pc-1 (acting) takes damage; pc-2 is explicitly poisoned.
    recordTurn(db, 'turn-1', 'pc-1', [
      { tool: 'adjust_hp', args: { amount: -3 }, result: { ok: true } },
      {
        tool: 'add_condition',
        args: { id: 'poisoned', character: 'pc-2' },
        result: { ok: true },
      },
      {
        tool: 'use_item',
        args: { instanceId: 'wand-1', operationId: 'cast', character: 'pc-3' },
        result: { ok: true },
      },
    ]);
    openScene(db, {
      campaignId: CAMPAIGN,
      sessionId: SESSION,
      sceneId: 'scene-1',
      title: 'Trap Room',
      at: AT,
    });
    appendSceneLog(db, {
      campaignId: CAMPAIGN,
      sessionId: SESSION,
      sceneId: 'scene-1',
      turnId: 'turn-1',
      role: 'dm',
      content: 'A trap springs.',
      at: AT,
    });

    summarizeSceneFromLog(
      db,
      { campaignId: CAMPAIGN, sessionId: SESSION, sceneId: 'scene-1' },
      AT,
    );

    const [summary] = listSceneSummaries(db, {
      campaignId: CAMPAIGN,
      sessionId: SESSION,
    });
    expect(summary?.salientRefs).toEqual(
      expect.arrayContaining([
        { target: 'character', id: 'pc-1', field: 'hp_current' },
        { target: 'character', id: 'pc-2', field: 'conditions_json' },
        { target: 'character', id: 'pc-3', field: 'inventory' },
      ]),
    );
  });

  it('produces no character refs when no character-scoped tool ran', () => {
    const db = freshDb();
    recordTurn(db, 'turn-1', 'pc-1', [
      { tool: 'set_plot_flag', args: { key: 'x' }, result: { ok: true } },
    ]);
    openScene(db, {
      campaignId: CAMPAIGN,
      sessionId: SESSION,
      sceneId: 'scene-1',
      title: 'Trap Room',
      at: AT,
    });
    appendSceneLog(db, {
      campaignId: CAMPAIGN,
      sessionId: SESSION,
      sceneId: 'scene-1',
      turnId: 'turn-1',
      role: 'dm',
      content: 'Nothing mechanical happens.',
      at: AT,
    });

    summarizeSceneFromLog(
      db,
      { campaignId: CAMPAIGN, sessionId: SESSION, sceneId: 'scene-1' },
      AT,
    );

    const [summary] = listSceneSummaries(db, {
      campaignId: CAMPAIGN,
      sessionId: SESSION,
    });
    expect(summary?.salientRefs).toEqual([]);
  });

  it('tags both transfer participants and deduplicates their inventory refs', () => {
    const db = freshDb();
    ensureCharacterRow(db, 'pc-2', 'test', SESSION, AT);
    ensureCharacterRow(db, 'pc-3', 'test', SESSION, AT);

    recordTurn(db, 'turn-1', 'pc-1', [
      {
        tool: 'transfer_item',
        args: {
          id: 'item-1',
          from_character: 'pc-2',
          to_character: 'pc-3',
          attunement: 'require-unattuned',
        },
        result: { ok: true },
      },
      {
        tool: 'transfer_item',
        args: {
          id: 'item-2',
          to_character: 'pc-2',
          attunement: 'require-unattuned',
        },
        result: { ok: true },
      },
      {
        tool: 'claim_item',
        args: { id: 'item-3', character: 'pc-3' },
        result: { ok: true },
      },
    ]);
    openScene(db, {
      campaignId: CAMPAIGN,
      sessionId: SESSION,
      sceneId: 'scene-1',
      title: 'Trading Post',
      at: AT,
    });
    appendSceneLog(db, {
      campaignId: CAMPAIGN,
      sessionId: SESSION,
      sceneId: 'scene-1',
      turnId: 'turn-1',
      role: 'dm',
      content: 'The party redistributes its gear.',
      at: AT,
    });

    summarizeSceneFromLog(
      db,
      { campaignId: CAMPAIGN, sessionId: SESSION, sceneId: 'scene-1' },
      AT,
    );

    const [summary] = listSceneSummaries(db, {
      campaignId: CAMPAIGN,
      sessionId: SESSION,
    });
    expect(summary?.salientRefs).toEqual([
      { target: 'character', id: 'pc-2', field: 'inventory' },
      { target: 'character', id: 'pc-3', field: 'inventory' },
      { target: 'character', id: 'pc-1', field: 'inventory' },
    ]);
  });
});
