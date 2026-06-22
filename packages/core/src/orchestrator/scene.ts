import type { Db } from '../persistence/db.js';
import { withTransaction } from '../persistence/db.js';
import { getSession } from '../session/session.js';
import { requireNonEmpty } from '../validation.js';

/**
 * Live per-scene transcript and scene-boundary records (E5).
 *
 * A scene is the orchestrator's unit of bounded live context: the Context
 * Assembler feeds the current scene's `scene_log` tail and rolls closed scenes
 * up into `scene_summary`. Exactly one scene is open per session at a time;
 * the `mark_scene` tool closes one before opening the next. This is a
 * live SQLite-only store — never written to Dolt off the per-turn path.
 */

export type SceneStatus = 'open' | 'closed';
export type SceneLogRole = 'player' | 'dm';

export interface SceneKey {
  campaignId: string;
  sessionId: string;
  sceneId: string;
}

export interface OpenSceneInput {
  campaignId: string;
  sessionId: string;
  sceneId: string;
  title: string;
  at: string;
}

export interface CloseSceneInput {
  campaignId: string;
  sessionId: string;
  sceneId: string;
  at: string;
}

export interface SceneRecord {
  campaignId: string;
  sessionId: string;
  sceneId: string;
  title: string;
  status: SceneStatus;
  openedAt: string;
  closedAt: string | undefined;
}

export interface SceneLogInput {
  campaignId: string;
  sessionId: string;
  sceneId: string;
  turnId: string;
  role: SceneLogRole;
  content: string;
  at: string;
}

export interface SceneLogRecord {
  campaignId: string;
  sessionId: string;
  sceneId: string;
  turnId: string;
  role: SceneLogRole;
  content: string;
  seq: number;
  createdAt: string;
}

export interface SessionSelector {
  campaignId: string;
  sessionId: string;
}

export interface SceneLogWindowInput extends SceneKey {
  /** Return entries before this sequence number; omitted means the scene tail. */
  beforeSeq?: number;
  /** Maximum number of entries to return. */
  limit: number;
}

export class SceneError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SceneError';
  }
}

/**
 * Scenes and scene logs are live state owned by an open `campaign_session`.
 * Writing them for a missing or closed session strands records that session
 * close and resume never see, so reject the write at the API boundary.
 */
function requireOpenSession(
  db: Db,
  context: string,
  selector: SessionSelector,
): void {
  const session = getSession(db, selector);
  if (session === undefined) {
    throw new SceneError(
      `${context} requires an open session, but no session '${selector.sessionId}' exists in campaign '${selector.campaignId}'`,
    );
  }
  if (session.status === 'closed') {
    throw new SceneError(
      `${context} requires an open session, but session '${selector.sessionId}' in campaign '${selector.campaignId}' is closed`,
    );
  }
}

export function openScene(db: Db, input: OpenSceneInput): SceneRecord {
  requireNonEmpty(
    SceneError,
    [
      ['campaignId', input.campaignId],
      ['sessionId', input.sessionId],
      ['sceneId', input.sceneId],
      ['title', input.title],
      ['at', input.at],
    ],
    (name) => `openScene ${name} is required`,
  );

  return withTransaction(db, (txnDb) => {
    requireOpenSession(txnDb, 'openScene', input);
    const existingOpen = getOpenScene(txnDb, input);
    if (existingOpen !== undefined) {
      throw new SceneError(
        `scene '${existingOpen.sceneId}' is still open in session '${input.sessionId}'; close it first`,
      );
    }
    if (getScene(txnDb, input) !== undefined) {
      throw new SceneError(
        `scene '${input.sceneId}' already exists in session '${input.sessionId}'`,
      );
    }
    txnDb
      .prepare(
        `INSERT INTO scene(
           campaign_id, session_id, scene_id, title, status, opened_at, closed_at
         )
         VALUES (?, ?, ?, ?, 'open', ?, NULL)`,
      )
      .run(
        input.campaignId,
        input.sessionId,
        input.sceneId,
        input.title,
        input.at,
      );
    return {
      campaignId: input.campaignId,
      sessionId: input.sessionId,
      sceneId: input.sceneId,
      title: input.title,
      status: 'open',
      openedAt: input.at,
      closedAt: undefined,
    };
  });
}

export function closeScene(db: Db, input: CloseSceneInput): SceneRecord {
  requireNonEmpty(
    SceneError,
    [
      ['campaignId', input.campaignId],
      ['sessionId', input.sessionId],
      ['sceneId', input.sceneId],
      ['at', input.at],
    ],
    (name) => `closeScene ${name} is required`,
  );

  return withTransaction(db, (txnDb) => {
    const scene = getScene(txnDb, input);
    if (scene === undefined) {
      throw new SceneError(
        `cannot close unknown scene '${input.sceneId}' in session '${input.sessionId}'`,
      );
    }
    if (scene.status === 'closed') {
      throw new SceneError(`scene '${input.sceneId}' is already closed`);
    }
    txnDb
      .prepare(
        `UPDATE scene
         SET status = 'closed', closed_at = ?
         WHERE campaign_id = ? AND session_id = ? AND scene_id = ?`,
      )
      .run(input.at, input.campaignId, input.sessionId, input.sceneId);
    return { ...scene, status: 'closed', closedAt: input.at };
  });
}

export function getScene(db: Db, key: SceneKey): SceneRecord | undefined {
  const row = db
    .prepare(
      `SELECT campaign_id, session_id, scene_id, title, status, opened_at, closed_at
       FROM scene
       WHERE campaign_id = ? AND session_id = ? AND scene_id = ?`,
    )
    .get(key.campaignId, key.sessionId, key.sceneId) as SceneRow | undefined;
  return row === undefined ? undefined : sceneFromRow(row);
}

export function getOpenScene(
  db: Db,
  selector: SessionSelector,
): SceneRecord | undefined {
  const row = db
    .prepare(
      `SELECT campaign_id, session_id, scene_id, title, status, opened_at, closed_at
       FROM scene
       WHERE campaign_id = ? AND session_id = ? AND status = 'open'
       ORDER BY opened_at DESC, scene_id DESC
       LIMIT 1`,
    )
    .get(selector.campaignId, selector.sessionId) as SceneRow | undefined;
  return row === undefined ? undefined : sceneFromRow(row);
}

export function appendSceneLog(db: Db, input: SceneLogInput): SceneLogRecord {
  requireNonEmpty(
    SceneError,
    [
      ['campaignId', input.campaignId],
      ['sessionId', input.sessionId],
      ['sceneId', input.sceneId],
      ['turnId', input.turnId],
      ['content', input.content],
      ['at', input.at],
    ],
    (name) => `appendSceneLog ${name} is required`,
  );
  if (input.role !== 'player' && input.role !== 'dm') {
    throw new SceneError(`unsupported scene-log role: ${String(input.role)}`);
  }

  return withTransaction(db, (txnDb) => {
    requireOpenSession(txnDb, 'appendSceneLog', input);
    if (getScene(txnDb, input) === undefined) {
      throw new SceneError(
        `cannot append to unknown scene '${input.sceneId}' in session '${input.sessionId}'`,
      );
    }
    // Compute seq inside the INSERT so the MAX read happens under the same
    // write lock as the row write. Two statements (SELECT then INSERT) can
    // race across connections: both readers see the same MAX before either
    // takes the write lock, and the second INSERT then collides on the PK.
    const inserted = txnDb
      .prepare(
        `INSERT INTO scene_log(
           campaign_id, session_id, scene_id, seq, turn_id, role, content, created_at
         )
         VALUES (
           ?, ?, ?,
           (SELECT COALESCE(MAX(seq), 0) + 1
              FROM scene_log
              WHERE campaign_id = ? AND session_id = ? AND scene_id = ?),
           ?, ?, ?, ?
         )
         RETURNING seq`,
      )
      .get(
        input.campaignId,
        input.sessionId,
        input.sceneId,
        input.campaignId,
        input.sessionId,
        input.sceneId,
        input.turnId,
        input.role,
        input.content,
        input.at,
      ) as { seq: number };
    return {
      campaignId: input.campaignId,
      sessionId: input.sessionId,
      sceneId: input.sceneId,
      turnId: input.turnId,
      role: input.role,
      content: input.content,
      seq: inserted.seq,
      createdAt: input.at,
    };
  });
}

export function listSceneLog(db: Db, key: SceneKey): SceneLogRecord[] {
  const rows = db
    .prepare(
      `SELECT campaign_id, session_id, scene_id, seq, turn_id, role, content, created_at
       FROM scene_log
       WHERE campaign_id = ? AND session_id = ? AND scene_id = ?
       ORDER BY seq ASC`,
    )
    .all(key.campaignId, key.sessionId, key.sceneId) as SceneLogRow[];
  return rows.map(sceneLogFromRow);
}

/**
 * The most recent DM (`role: 'dm'`) scene-log line recorded anywhere in the
 * campaign — across every session and scene, regardless of open/closed status,
 * or `undefined` when the campaign has no DM output yet. Scene-log rows persist
 * after their scene and session close (close only flips a status flag), so this
 * sees the DM's last words from a cleanly-ended prior session, which the play
 * UI replays as a resume recap at session start. Ordered by wall-clock then
 * insertion order (`rowid`) so the truly-last line wins even when two rows
 * share a timestamp (common in tests and within a single turn).
 */
export function getLastDmOutput(
  db: Db,
  selector: { campaignId: string },
): SceneLogRecord | undefined {
  const row = db
    .prepare(
      `SELECT campaign_id, session_id, scene_id, seq, turn_id, role, content, created_at
       FROM scene_log
       WHERE campaign_id = ? AND role = 'dm'
       ORDER BY created_at DESC, rowid DESC
       LIMIT 1`,
    )
    .get(selector.campaignId) as SceneLogRow | undefined;
  return row === undefined ? undefined : sceneLogFromRow(row);
}

export function countSceneLog(db: Db, key: SceneKey): number {
  const row = db
    .prepare(
      `SELECT COUNT(*) AS count
       FROM scene_log
       WHERE campaign_id = ? AND session_id = ? AND scene_id = ?`,
    )
    .get(key.campaignId, key.sessionId, key.sceneId) as { count: number };
  return row.count;
}

export function listSceneLogWindow(
  db: Db,
  input: SceneLogWindowInput,
): SceneLogRecord[] {
  if (!Number.isInteger(input.limit) || input.limit < 0) {
    throw new SceneError(
      'scene log window limit must be a non-negative integer',
    );
  }
  if (input.limit === 0) {
    return [];
  }
  if (
    input.beforeSeq !== undefined &&
    (!Number.isInteger(input.beforeSeq) || input.beforeSeq < 1)
  ) {
    throw new SceneError(
      'scene log window beforeSeq must be a positive integer',
    );
  }

  const seqPredicate = input.beforeSeq === undefined ? '' : 'AND seq < ?';
  const params =
    input.beforeSeq === undefined
      ? [input.campaignId, input.sessionId, input.sceneId, input.limit]
      : [
          input.campaignId,
          input.sessionId,
          input.sceneId,
          input.beforeSeq,
          input.limit,
        ];
  const rows = db
    .prepare(
      `SELECT campaign_id, session_id, scene_id, seq, turn_id, role, content, created_at
       FROM scene_log
       WHERE campaign_id = ? AND session_id = ? AND scene_id = ?
       ${seqPredicate}
       ORDER BY seq DESC
       LIMIT ?`,
    )
    .all(...params) as SceneLogRow[];
  return rows.reverse().map(sceneLogFromRow);
}

interface SceneRow {
  campaign_id: string;
  session_id: string;
  scene_id: string;
  title: string;
  status: string;
  opened_at: string;
  closed_at: string | null;
}

interface SceneLogRow {
  campaign_id: string;
  session_id: string;
  scene_id: string;
  seq: number;
  turn_id: string;
  role: string;
  content: string;
  created_at: string;
}

function sceneFromRow(row: SceneRow): SceneRecord {
  return {
    campaignId: row.campaign_id,
    sessionId: row.session_id,
    sceneId: row.scene_id,
    title: row.title,
    status: row.status as SceneStatus,
    openedAt: row.opened_at,
    closedAt: row.closed_at ?? undefined,
  };
}

function sceneLogFromRow(row: SceneLogRow): SceneLogRecord {
  return {
    campaignId: row.campaign_id,
    sessionId: row.session_id,
    sceneId: row.scene_id,
    turnId: row.turn_id,
    role: row.role as SceneLogRole,
    content: row.content,
    seq: row.seq,
    createdAt: row.created_at,
  };
}
