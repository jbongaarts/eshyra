import {
  getLastDmOutput,
  getOpenScene,
  listSceneLog,
  type SceneLogRecord,
  type SceneRecord,
} from '../orchestrator/scene.js';
import type { Db } from '../persistence/db.js';
import {
  type CampaignSelector,
  getOpenSession,
  type SessionRecord,
} from './session.js';

export type SessionLaunchState =
  | {
      kind: 'start_new';
      campaignId: string;
      /**
       * The DM's last recorded line anywhere in the campaign, or `undefined`
       * when the campaign has no prior DM output. Present only on `start_new`:
       * a fresh session over an existing campaign replays this as a resume
       * recap so the returning player sees the DM's last words before their
       * first input. (The `resume` branch reattaches to a still-open session
       * and already carries that context in `sceneTail`.)
       */
      lastDmOutput: SceneLogRecord | undefined;
    }
  | {
      kind: 'resume';
      campaignId: string;
      session: SessionRecord;
      openScene: SceneRecord | undefined;
      sceneTail: SceneLogRecord[];
    };

export function getSessionLaunchState(
  db: Db,
  selector: CampaignSelector,
): SessionLaunchState {
  const session = getOpenSession(db, selector);
  if (session === undefined) {
    return {
      kind: 'start_new',
      campaignId: selector.campaignId,
      lastDmOutput: getLastDmOutput(db, { campaignId: selector.campaignId }),
    };
  }

  const openScene = getOpenScene(db, {
    campaignId: selector.campaignId,
    sessionId: session.sessionId,
  });
  const sceneTail =
    openScene === undefined
      ? []
      : listSceneLog(db, {
          campaignId: selector.campaignId,
          sessionId: session.sessionId,
          sceneId: openScene.sceneId,
        });

  return {
    kind: 'resume',
    campaignId: selector.campaignId,
    session,
    openScene,
    sceneTail,
  };
}
