import { describe, expect, it } from 'vitest';
import {
  appendSceneLog,
  closeScene,
  closeSession,
  getLastDmOutput,
  getSessionLaunchState,
  openScene,
  startSession,
} from '../src/internal.js';
import { bareDb } from './support/db.js';

const CAMPAIGN = 'campaign-1';

describe('session launch state', () => {
  it('reports start-new with no prior DM output when no session is open', () => {
    const db = bareDb();

    expect(getSessionLaunchState(db, { campaignId: CAMPAIGN })).toEqual({
      kind: 'start_new',
      campaignId: CAMPAIGN,
      lastDmOutput: undefined,
    });

    db.close();
  });

  it('reports resume with the current scene tail when a session was left open', () => {
    const db = bareDb();
    startSession(db, {
      campaignId: CAMPAIGN,
      sessionId: 'session-1',
      startedAt: '2026-05-21T00:00:00.000Z',
    });
    openScene(db, {
      campaignId: CAMPAIGN,
      sessionId: 'session-1',
      sceneId: 'scene-1',
      title: 'The Road',
      at: '2026-05-21T00:01:00.000Z',
    });
    appendSceneLog(db, {
      campaignId: CAMPAIGN,
      sessionId: 'session-1',
      sceneId: 'scene-1',
      turnId: 'turn-1',
      role: 'player',
      content: 'I check the mile marker.',
      at: '2026-05-21T00:02:00.000Z',
    });
    appendSceneLog(db, {
      campaignId: CAMPAIGN,
      sessionId: 'session-1',
      sceneId: 'scene-1',
      turnId: 'turn-1',
      role: 'dm',
      content: 'The chalk sigil still points north.',
      at: '2026-05-21T00:02:00.000Z',
    });

    const state = getSessionLaunchState(db, { campaignId: CAMPAIGN });

    expect(state.kind).toBe('resume');
    if (state.kind === 'resume') {
      expect(state.session.sessionId).toBe('session-1');
      expect(state.openScene?.sceneId).toBe('scene-1');
      expect(state.sceneTail.map((entry) => entry.content)).toEqual([
        'I check the mile marker.',
        'The chalk sigil still points north.',
      ]);
    }
    db.close();
  });

  it('returns start-new after the previously open session is closed', () => {
    const db = bareDb();
    startSession(db, {
      campaignId: CAMPAIGN,
      sessionId: 'session-1',
      startedAt: '2026-05-21T00:00:00.000Z',
    });
    closeSession(db, {
      campaignId: CAMPAIGN,
      sessionId: 'session-1',
      closedAt: '2026-05-21T01:00:00.000Z',
    });

    expect(getSessionLaunchState(db, { campaignId: CAMPAIGN })).toEqual({
      kind: 'start_new',
      campaignId: CAMPAIGN,
      lastDmOutput: undefined,
    });
    db.close();
  });

  it("carries the DM's last output on start-new after a prior session closed", () => {
    const db = bareDb();
    // A first session played a turn (player + DM line) and then closed cleanly:
    // both the scene and the session are closed, but the scene-log rows persist.
    startSession(db, {
      campaignId: CAMPAIGN,
      sessionId: 'session-1',
      startedAt: '2026-05-21T00:00:00.000Z',
    });
    openScene(db, {
      campaignId: CAMPAIGN,
      sessionId: 'session-1',
      sceneId: 'scene-1',
      title: 'The Road',
      at: '2026-05-21T00:01:00.000Z',
    });
    appendSceneLog(db, {
      campaignId: CAMPAIGN,
      sessionId: 'session-1',
      sceneId: 'scene-1',
      turnId: 'turn-1',
      role: 'player',
      content: 'I check the mile marker.',
      at: '2026-05-21T00:02:00.000Z',
    });
    appendSceneLog(db, {
      campaignId: CAMPAIGN,
      sessionId: 'session-1',
      sceneId: 'scene-1',
      turnId: 'turn-1',
      role: 'dm',
      content: 'The chalk sigil still points north.',
      at: '2026-05-21T00:02:01.000Z',
    });
    closeScene(db, {
      campaignId: CAMPAIGN,
      sessionId: 'session-1',
      sceneId: 'scene-1',
      at: '2026-05-21T00:03:00.000Z',
    });
    closeSession(db, {
      campaignId: CAMPAIGN,
      sessionId: 'session-1',
      closedAt: '2026-05-21T00:03:00.000Z',
    });

    const state = getSessionLaunchState(db, { campaignId: CAMPAIGN });

    expect(state.kind).toBe('start_new');
    if (state.kind === 'start_new') {
      expect(state.lastDmOutput?.content).toBe(
        'The chalk sigil still points north.',
      );
    }
    db.close();
  });
});

describe('getLastDmOutput', () => {
  it('returns undefined when the campaign has no DM output', () => {
    const db = bareDb();
    expect(getLastDmOutput(db, { campaignId: CAMPAIGN })).toBeUndefined();
    db.close();
  });

  it('returns the most recent DM line across sessions and scenes', () => {
    const db = bareDb();
    startSession(db, {
      campaignId: CAMPAIGN,
      sessionId: 'session-1',
      startedAt: '2026-05-21T00:00:00.000Z',
    });
    openScene(db, {
      campaignId: CAMPAIGN,
      sessionId: 'session-1',
      sceneId: 'scene-1',
      title: 'The Road',
      at: '2026-05-21T00:01:00.000Z',
    });
    appendSceneLog(db, {
      campaignId: CAMPAIGN,
      sessionId: 'session-1',
      sceneId: 'scene-1',
      turnId: 'turn-1',
      role: 'dm',
      content: 'An older line.',
      at: '2026-05-21T00:02:00.000Z',
    });
    appendSceneLog(db, {
      campaignId: CAMPAIGN,
      sessionId: 'session-1',
      sceneId: 'scene-1',
      turnId: 'turn-2',
      role: 'dm',
      content: 'The newest DM line.',
      at: '2026-05-21T00:05:00.000Z',
    });
    // A later player line must not shadow the DM line.
    appendSceneLog(db, {
      campaignId: CAMPAIGN,
      sessionId: 'session-1',
      sceneId: 'scene-1',
      turnId: 'turn-3',
      role: 'player',
      content: 'I respond.',
      at: '2026-05-21T00:06:00.000Z',
    });

    expect(getLastDmOutput(db, { campaignId: CAMPAIGN })?.content).toBe(
      'The newest DM line.',
    );
    db.close();
  });

  it('scopes the lookup to the requested campaign', () => {
    const db = bareDb();
    startSession(db, {
      campaignId: 'other-campaign',
      sessionId: 'session-x',
      startedAt: '2026-05-21T00:00:00.000Z',
    });
    openScene(db, {
      campaignId: 'other-campaign',
      sessionId: 'session-x',
      sceneId: 'scene-x',
      title: 'Elsewhere',
      at: '2026-05-21T00:01:00.000Z',
    });
    appendSceneLog(db, {
      campaignId: 'other-campaign',
      sessionId: 'session-x',
      sceneId: 'scene-x',
      turnId: 'turn-x',
      role: 'dm',
      content: 'A line in another campaign.',
      at: '2026-05-21T00:02:00.000Z',
    });

    expect(getLastDmOutput(db, { campaignId: CAMPAIGN })).toBeUndefined();
    db.close();
  });
});
