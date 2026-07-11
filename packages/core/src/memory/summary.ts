import type { SceneLogRecord } from '../orchestrator/scene.js';
import { listSceneLog, listSceneLogWindow } from '../orchestrator/scene.js';
import type { Db } from '../persistence/db.js';
import { withTransaction } from '../persistence/db.js';
import { jsonColumn } from '../persistence/jsonColumn.js';
import {
  CharacterResolutionError,
  resolveCharacterRef,
} from '../state/activeCharacter.js';
import type { MutateStateTarget } from '../state/mutateState.js';
import { requireNonEmpty } from '../validation.js';
import type { TraceJsonValue } from './turnTrace.js';
import { listTurnTraces } from './turnTrace.js';

export interface MemoryRef {
  target: MutateStateTarget;
  id?: string;
  field: string;
}

export interface SceneSummaryRecord {
  campaignId: string;
  sessionId: string;
  sceneId: string;
  summary: string;
  salientRefs: MemoryRef[];
  sourceTurnIds: string[];
  createdAt: string;
  updatedAt: string;
}

export interface SceneSummarySelector {
  campaignId: string;
  sessionId: string;
}

export interface SessionRecapInput {
  campaignId: string;
  sessionId: string;
  recap: string;
  stateDelta: TraceJsonValue[];
  createdAt: string;
}

export interface SessionRecapRecord {
  campaignId: string;
  sessionId: string;
  recap: string;
  sourceSceneIds: string[];
  stateDelta: TraceJsonValue[];
  createdAt: string;
  updatedAt: string;
}

export interface CampaignBibleInput {
  worldFacts: string[];
  majorNpcs: string[];
  factions: string[];
  openThreads: string[];
}

export interface CampaignBibleEntry {
  text: string;
  sourceArcIds: string[];
  sourceSessionIds: string[];
}

export interface CampaignBibleRecord {
  campaignId: string;
  worldFacts: CampaignBibleEntry[];
  majorNpcs: CampaignBibleEntry[];
  factions: CampaignBibleEntry[];
  openThreads: CampaignBibleEntry[];
  updatedAt: string;
}

export interface ArcSummaryInput {
  campaignId: string;
  arcId: string;
  summary: string;
  sourceSessionIds: string[];
  campaignBible: CampaignBibleInput;
  createdAt: string;
}

export interface ArcSummaryKey {
  campaignId: string;
  arcId: string;
}

export interface ArcSummaryRecord {
  campaignId: string;
  arcId: string;
  summary: string;
  sourceSessionIds: string[];
  createdAt: string;
  updatedAt: string;
}

export interface CampaignBibleKey {
  campaignId: string;
}

export type MemoryDrilldownSelector =
  | {
      target: 'scene';
      campaignId: string;
      sessionId: string;
      sceneId: string;
    }
  | {
      target: 'scene_log';
      campaignId: string;
      sessionId: string;
      sceneId: string;
      beforeSeq?: number;
      limit?: number;
    }
  | {
      target: 'session';
      campaignId: string;
      sessionId: string;
    }
  | {
      target: 'arc';
      campaignId: string;
      arcId: string;
    };

export type MemoryDrilldownResult =
  | { target: 'scene'; record: SceneSummaryRecord }
  | { target: 'scene_log'; records: SceneLogRecord[] }
  | { target: 'session'; record: SessionRecapRecord }
  | { target: 'arc'; record: ArcSummaryRecord };

export interface AlwaysOnMemorySelector {
  campaignId: string;
  recentSessionLimit: number;
}

export interface AlwaysOnMemoryContext {
  campaignId: string;
  campaignBible: CampaignBibleRecord | undefined;
  recentSessionRecaps: Array<SessionRecapRecord | undefined>;
  omittedSessionCount: number;
  drilldownAvailable: boolean;
}

export class MemorySummaryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MemorySummaryError';
  }
}

/** JSON codecs for the memory-summary tables' JSON-backed columns. */
const summaryColumns = {
  sceneSalientRefs: jsonColumn<MemoryRef[]>('scene_summary.salient_refs'),
  sceneSourceTurnIds: jsonColumn<string[]>('scene_summary.source_turn_ids'),
  recapSourceSceneIds: jsonColumn<string[]>('session_recap.source_scene_ids'),
  recapStateDelta: jsonColumn<TraceJsonValue[]>('session_recap.state_delta'),
  arcSourceSessionIds: jsonColumn<string[]>('arc_summary.source_session_ids'),
  bibleWorldFacts: jsonColumn<CampaignBibleEntry[]>(
    'campaign_bible.world_facts',
  ),
  bibleMajorNpcs: jsonColumn<CampaignBibleEntry[]>('campaign_bible.major_npcs'),
  bibleFactions: jsonColumn<CampaignBibleEntry[]>('campaign_bible.factions'),
  bibleOpenThreads: jsonColumn<CampaignBibleEntry[]>(
    'campaign_bible.open_threads',
  ),
};

export function recordSceneSummary(db: Db, summary: SceneSummaryRecord): void {
  validateSceneSummary(summary);
  withTransaction(db, (txnDb) => {
    txnDb
      .prepare(
        `INSERT INTO scene_summary(
           campaign_id,
           session_id,
           scene_id,
           summary,
           salient_refs_json,
           source_turn_ids_json,
           created_at,
           updated_at
         )
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(campaign_id, session_id, scene_id) DO UPDATE SET
           summary = excluded.summary,
           salient_refs_json = excluded.salient_refs_json,
           source_turn_ids_json = excluded.source_turn_ids_json,
           updated_at = excluded.updated_at`,
      )
      .run(
        summary.campaignId,
        summary.sessionId,
        summary.sceneId,
        summary.summary,
        summaryColumns.sceneSalientRefs.encode(summary.salientRefs),
        summaryColumns.sceneSourceTurnIds.encode(summary.sourceTurnIds),
        summary.createdAt,
        summary.updatedAt,
      );
  });
}

/**
 * Roll a scene's live transcript up into a `scene_summary`, idempotently. The
 * summary is the scene's DM narration joined into one string (or a fallback
 * when the scene closed unnarrated); `sourceTurnIds` are the distinct turns the
 * scene spanned. If the scene already has a summary it is left untouched, so
 * the orchestrator turn loop and the session-close pipeline can both call this
 * for the same scene without disagreeing or double-writing.
 */
export function summarizeSceneFromLog(
  db: Db,
  key: { campaignId: string; sessionId: string; sceneId: string },
  at: string,
): void {
  if (
    memoryDrilldown(db, {
      target: 'scene',
      campaignId: key.campaignId,
      sessionId: key.sessionId,
      sceneId: key.sceneId,
    }) !== undefined
  ) {
    return;
  }
  const log = listSceneLog(db, key);
  const dmLines = log
    .filter((entry) => entry.role === 'dm')
    .map((entry) => entry.content);
  const summary =
    dmLines.length > 0 ? dmLines.join(' ') : '(scene closed with no narration)';
  const sourceTurnIds = [...new Set(log.map((entry) => entry.turnId))];
  recordSceneSummary(db, {
    campaignId: key.campaignId,
    sessionId: key.sessionId,
    sceneId: key.sceneId,
    summary,
    salientRefs: deriveCharacterSalientRefs(db, key, sourceTurnIds),
    sourceTurnIds,
    createdAt: at,
    updatedAt: at,
  });
}

/**
 * Per-PC salient references for a scene (loreweaver-d4d.6). Walks the recorded
 * turn traces for the scene's turns and emits one `{ target: 'character', id,
 * field }` ref per party member whose state a character-scoped tool changed,
 * so an individual PC's important facts (HP swings, conditions, items) survive
 * the party-level prose roll-up. The acting PC of the turn is the target when a
 * tool call did not name an explicit `character`.
 */
const CHARACTER_TOOL_FIELDS: Readonly<Record<string, string>> = {
  adjust_hp: 'hp_current',
  record_death_save: 'life_state',
  stabilize_character: 'life_state',
  grant_temporary_hp: 'hp_temp',
  add_condition: 'conditions_json',
  remove_condition: 'conditions_json',
  give_item: 'inventory',
  remove_item: 'inventory',
};

function deriveCharacterSalientRefs(
  db: Db,
  key: { campaignId: string; sessionId: string },
  sourceTurnIds: readonly string[],
): MemoryRef[] {
  const turnIds = new Set(sourceTurnIds);
  const traces = listTurnTraces(db, {
    campaignId: key.campaignId,
    sessionId: key.sessionId,
  }).filter((trace) => turnIds.has(trace.turnId));

  const seen = new Set<string>();
  const refs: MemoryRef[] = [];
  for (const trace of traces) {
    for (const call of trace.toolCalls) {
      if (typeof call !== 'object' || call === null || Array.isArray(call)) {
        continue;
      }
      const record = call as Record<string, TraceJsonValue>;
      const tool = typeof record.tool === 'string' ? record.tool : undefined;
      const field =
        tool === undefined ? undefined : CHARACTER_TOOL_FIELDS[tool];
      if (field === undefined) {
        continue;
      }
      const pcId = resolveSalientCharacterId(db, record.args, trace);
      if (pcId === undefined) {
        continue;
      }
      const dedupeKey = `${pcId}:${field}`;
      if (seen.has(dedupeKey)) {
        continue;
      }
      seen.add(dedupeKey);
      refs.push({ target: 'character', id: pcId, field });
    }
  }
  return refs;
}

function resolveSalientCharacterId(
  db: Db,
  args: TraceJsonValue | undefined,
  trace: { actingCharacterId?: string },
): string | undefined {
  const charRef =
    typeof args === 'object' && args !== null && !Array.isArray(args)
      ? (args as Record<string, TraceJsonValue>).character
      : undefined;
  if (typeof charRef === 'string' && charRef.length > 0) {
    try {
      return resolveCharacterRef(db, charRef);
    } catch (e) {
      if (e instanceof CharacterResolutionError) {
        return undefined;
      }
      throw e;
    }
  }
  return trace.actingCharacterId;
}

export function listSceneSummaries(
  db: Db,
  selector: SceneSummarySelector,
): SceneSummaryRecord[] {
  const rows = db
    .prepare(
      `SELECT
         campaign_id,
         session_id,
         scene_id,
         summary,
         salient_refs_json,
         source_turn_ids_json,
         created_at,
         updated_at
       FROM scene_summary
       WHERE campaign_id = ? AND session_id = ?
       ORDER BY created_at, scene_id`,
    )
    .all(selector.campaignId, selector.sessionId) as SceneSummaryRow[];

  return rows.map(sceneSummaryFromRow);
}

function getSceneSummary(
  db: Db,
  selector: { campaignId: string; sessionId: string; sceneId: string },
): SceneSummaryRecord | undefined {
  const row = db
    .prepare(
      `SELECT
         campaign_id,
         session_id,
         scene_id,
         summary,
         salient_refs_json,
         source_turn_ids_json,
         created_at,
         updated_at
       FROM scene_summary
       WHERE campaign_id = ? AND session_id = ? AND scene_id = ?`,
    )
    .get(selector.campaignId, selector.sessionId, selector.sceneId) as
    | SceneSummaryRow
    | undefined;
  return row === undefined ? undefined : sceneSummaryFromRow(row);
}

function sceneSummaryFromRow(row: SceneSummaryRow): SceneSummaryRecord {
  return {
    campaignId: row.campaign_id,
    sessionId: row.session_id,
    sceneId: row.scene_id,
    summary: row.summary,
    salientRefs: summaryColumns.sceneSalientRefs.decode(row.salient_refs_json),
    sourceTurnIds: summaryColumns.sceneSourceTurnIds.decode(
      row.source_turn_ids_json,
    ),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function rollupSessionRecap(db: Db, input: SessionRecapInput): void {
  validateSessionRecap(input);
  const sourceSceneIds = listSceneSummaries(db, input).map(
    (summary) => summary.sceneId,
  );

  withTransaction(db, (txnDb) => {
    txnDb
      .prepare(
        `INSERT INTO session_recap(
           campaign_id,
           session_id,
           recap,
           source_scene_ids_json,
           state_delta_json,
           created_at,
           updated_at
         )
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(campaign_id, session_id) DO UPDATE SET
           recap = excluded.recap,
           source_scene_ids_json = excluded.source_scene_ids_json,
           state_delta_json = excluded.state_delta_json,
           updated_at = excluded.updated_at`,
      )
      .run(
        input.campaignId,
        input.sessionId,
        input.recap,
        summaryColumns.recapSourceSceneIds.encode(sourceSceneIds),
        summaryColumns.recapStateDelta.encode(input.stateDelta),
        input.createdAt,
        input.createdAt,
      );
  });
}

export function getSessionRecap(
  db: Db,
  selector: SceneSummarySelector,
): SessionRecapRecord | undefined {
  const row = db
    .prepare(
      `SELECT
         campaign_id,
         session_id,
         recap,
         source_scene_ids_json,
         state_delta_json,
         created_at,
         updated_at
       FROM session_recap
       WHERE campaign_id = ? AND session_id = ?`,
    )
    .get(selector.campaignId, selector.sessionId) as
    | SessionRecapRow
    | undefined;

  if (row === undefined) {
    return undefined;
  }
  return sessionRecapFromRow(row);
}

function sessionRecapFromRow(row: SessionRecapRow): SessionRecapRecord {
  return {
    campaignId: row.campaign_id,
    sessionId: row.session_id,
    recap: row.recap,
    sourceSceneIds: summaryColumns.recapSourceSceneIds.decode(
      row.source_scene_ids_json,
    ),
    stateDelta: summaryColumns.recapStateDelta.decode(row.state_delta_json),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function rollupArcSummary(db: Db, input: ArcSummaryInput): void {
  validateArcSummary(input);
  withTransaction(db, (txnDb) => {
    txnDb
      .prepare(
        `INSERT INTO arc_summary(
           campaign_id,
           arc_id,
           summary,
           source_session_ids_json,
           created_at,
           updated_at
         )
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(campaign_id, arc_id) DO UPDATE SET
           summary = excluded.summary,
           source_session_ids_json = excluded.source_session_ids_json,
           updated_at = excluded.updated_at`,
      )
      .run(
        input.campaignId,
        input.arcId,
        input.summary,
        summaryColumns.arcSourceSessionIds.encode(input.sourceSessionIds),
        input.createdAt,
        input.createdAt,
      );

    const current = getCampaignBible(txnDb, input) ?? emptyCampaignBible(input);
    const reconciled: CampaignBibleRecord = {
      campaignId: input.campaignId,
      worldFacts: reconcileBibleEntries(
        current.worldFacts,
        input.campaignBible.worldFacts,
        input,
      ),
      majorNpcs: reconcileBibleEntries(
        current.majorNpcs,
        input.campaignBible.majorNpcs,
        input,
      ),
      factions: reconcileBibleEntries(
        current.factions,
        input.campaignBible.factions,
        input,
      ),
      openThreads: reconcileBibleEntries(
        current.openThreads,
        input.campaignBible.openThreads,
        input,
      ),
      updatedAt: input.createdAt,
    };
    txnDb
      .prepare(
        `INSERT INTO campaign_bible(
           campaign_id,
           world_facts_json,
           major_npcs_json,
           factions_json,
           open_threads_json,
           updated_at
         )
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(campaign_id) DO UPDATE SET
           world_facts_json = excluded.world_facts_json,
           major_npcs_json = excluded.major_npcs_json,
           factions_json = excluded.factions_json,
           open_threads_json = excluded.open_threads_json,
           updated_at = excluded.updated_at`,
      )
      .run(
        reconciled.campaignId,
        summaryColumns.bibleWorldFacts.encode(reconciled.worldFacts),
        summaryColumns.bibleMajorNpcs.encode(reconciled.majorNpcs),
        summaryColumns.bibleFactions.encode(reconciled.factions),
        summaryColumns.bibleOpenThreads.encode(reconciled.openThreads),
        reconciled.updatedAt,
      );
  });
}

export function getArcSummary(
  db: Db,
  key: ArcSummaryKey,
): ArcSummaryRecord | undefined {
  const row = db
    .prepare(
      `SELECT
         campaign_id,
         arc_id,
         summary,
         source_session_ids_json,
         created_at,
         updated_at
       FROM arc_summary
       WHERE campaign_id = ? AND arc_id = ?`,
    )
    .get(key.campaignId, key.arcId) as ArcSummaryRow | undefined;

  if (row === undefined) {
    return undefined;
  }
  return {
    campaignId: row.campaign_id,
    arcId: row.arc_id,
    summary: row.summary,
    sourceSessionIds: summaryColumns.arcSourceSessionIds.decode(
      row.source_session_ids_json,
    ),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function getCampaignBible(
  db: Db,
  key: CampaignBibleKey,
): CampaignBibleRecord | undefined {
  const row = db
    .prepare(
      `SELECT
         campaign_id,
         world_facts_json,
         major_npcs_json,
         factions_json,
         open_threads_json,
         updated_at
       FROM campaign_bible
       WHERE campaign_id = ?`,
    )
    .get(key.campaignId) as CampaignBibleRow | undefined;

  if (row === undefined) {
    return undefined;
  }
  return {
    campaignId: row.campaign_id,
    worldFacts: summaryColumns.bibleWorldFacts.decode(row.world_facts_json),
    majorNpcs: summaryColumns.bibleMajorNpcs.decode(row.major_npcs_json),
    factions: summaryColumns.bibleFactions.decode(row.factions_json),
    openThreads: summaryColumns.bibleOpenThreads.decode(row.open_threads_json),
    updatedAt: row.updated_at,
  };
}

export function memoryDrilldown(
  db: Db,
  selector: MemoryDrilldownSelector,
): MemoryDrilldownResult | undefined {
  switch (selector.target) {
    case 'scene': {
      const record = getSceneSummary(db, selector);
      return record === undefined ? undefined : { target: 'scene', record };
    }
    case 'scene_log': {
      return {
        target: 'scene_log',
        records: listSceneLogWindow(db, {
          campaignId: selector.campaignId,
          sessionId: selector.sessionId,
          sceneId: selector.sceneId,
          beforeSeq: selector.beforeSeq,
          limit: selector.limit ?? 12,
        }),
      };
    }
    case 'session': {
      const record = getSessionRecap(db, selector);
      return record === undefined ? undefined : { target: 'session', record };
    }
    case 'arc': {
      const record = getArcSummary(db, selector);
      return record === undefined ? undefined : { target: 'arc', record };
    }
  }
}

export function selectAlwaysOnMemory(
  db: Db,
  selector: AlwaysOnMemorySelector,
): AlwaysOnMemoryContext {
  if (selector.recentSessionLimit < 0) {
    throw new MemorySummaryError('recentSessionLimit must be non-negative');
  }
  const rows = db
    .prepare(
      `SELECT
         campaign_id,
         session_id,
         recap,
         source_scene_ids_json,
         state_delta_json,
         created_at,
         updated_at
       FROM session_recap
       WHERE campaign_id = ?
       ORDER BY created_at DESC, session_id DESC`,
    )
    .all(selector.campaignId) as SessionRecapRow[];
  const selectedRows = rows.slice(0, selector.recentSessionLimit).reverse();

  return {
    campaignId: selector.campaignId,
    campaignBible: getCampaignBible(db, selector),
    recentSessionRecaps: selectedRows.map(sessionRecapFromRow),
    omittedSessionCount: Math.max(0, rows.length - selectedRows.length),
    drilldownAvailable: rows.length > selectedRows.length,
  };
}

function validateSceneSummary(summary: SceneSummaryRecord): void {
  requireNonEmpty(
    MemorySummaryError,
    [
      ['campaignId', summary.campaignId],
      ['sessionId', summary.sessionId],
      ['sceneId', summary.sceneId],
      ['summary', summary.summary],
      ['createdAt', summary.createdAt],
      ['updatedAt', summary.updatedAt],
    ],
    (field) => `scene summary ${field} is required`,
  );
}

function validateSessionRecap(input: SessionRecapInput): void {
  requireNonEmpty(
    MemorySummaryError,
    [
      ['campaignId', input.campaignId],
      ['sessionId', input.sessionId],
      ['recap', input.recap],
      ['createdAt', input.createdAt],
    ],
    (field) => `session recap ${field} is required`,
  );
}

function validateArcSummary(input: ArcSummaryInput): void {
  requireNonEmpty(
    MemorySummaryError,
    [
      ['campaignId', input.campaignId],
      ['arcId', input.arcId],
      ['summary', input.summary],
      ['createdAt', input.createdAt],
    ],
    (field) => `arc summary ${field} is required`,
  );
}

function emptyCampaignBible(input: ArcSummaryInput): CampaignBibleRecord {
  return {
    campaignId: input.campaignId,
    worldFacts: [],
    majorNpcs: [],
    factions: [],
    openThreads: [],
    updatedAt: input.createdAt,
  };
}

function reconcileBibleEntries(
  current: CampaignBibleEntry[],
  additions: string[],
  input: ArcSummaryInput,
): CampaignBibleEntry[] {
  const byText = new Map(current.map((entry) => [entry.text, entry]));
  for (const text of additions) {
    const existing = byText.get(text);
    if (existing === undefined) {
      byText.set(text, {
        text,
        sourceArcIds: [input.arcId],
        sourceSessionIds: [...input.sourceSessionIds],
      });
      continue;
    }
    byText.set(text, {
      text,
      sourceArcIds: sortedUnique([...existing.sourceArcIds, input.arcId]),
      sourceSessionIds: sortedUnique([
        ...existing.sourceSessionIds,
        ...input.sourceSessionIds,
      ]),
    });
  }
  return [...byText.values()];
}

function sortedUnique(values: string[]): string[] {
  return [...new Set(values)].sort();
}

interface SceneSummaryRow {
  campaign_id: string;
  session_id: string;
  scene_id: string;
  summary: string;
  salient_refs_json: string;
  source_turn_ids_json: string;
  created_at: string;
  updated_at: string;
}

interface SessionRecapRow {
  campaign_id: string;
  session_id: string;
  recap: string;
  source_scene_ids_json: string;
  state_delta_json: string;
  created_at: string;
  updated_at: string;
}

interface ArcSummaryRow {
  campaign_id: string;
  arc_id: string;
  summary: string;
  source_session_ids_json: string;
  created_at: string;
  updated_at: string;
}

interface CampaignBibleRow {
  campaign_id: string;
  world_facts_json: string;
  major_npcs_json: string;
  factions_json: string;
  open_threads_json: string;
  updated_at: string;
}
