import type { Db } from '../persistence/db.js';
import { withTransaction } from '../persistence/db.js';
import { jsonColumn } from '../persistence/jsonColumn.js';

const tagsColumn = jsonColumn<string[]>('campaign_overlay_lore.tags_json');

export type CanonTier =
  | 'module_canon'
  | 'campaign_state'
  | 'campaign_overlay_lore'
  | 'scene_fact'
  | 'decorative_color'
  | 'rumor_belief'
  | 'tool_result';

export type OverlayLoreKind =
  | 'rumor'
  | 'clue'
  | 'npc_detail'
  | 'location_detail'
  | 'quest_hook'
  | 'threat_report'
  | 'scene_consequence'
  | 'player_created_detail'
  | 'other';

export type OverlayLoreTruthStatus =
  | 'confirmed'
  | 'true'
  | 'false'
  | 'disproven'
  | 'unknown'
  | 'rumored'
  | 'reported'
  | 'observed'
  | 'believed'
  | 'lie'
  | 'exaggeration';

export type OverlayLoreSource =
  | 'dm_improvised'
  | 'player_declared'
  | 'module_derived'
  | 'tool_result'
  | 'consequence';

export type OverlayLoreScope = 'scene' | 'session' | 'campaign';
export type OverlayLoreVisibility = 'player_visible' | 'dm_only' | 'mixed';

export interface CampaignOverlayLoreRecord {
  readonly id: string;
  readonly kind: OverlayLoreKind;
  readonly subjectId?: string;
  readonly subjectText: string;
  readonly locationId?: string;
  readonly npcId?: string;
  readonly factionId?: string;
  readonly fact: string;
  readonly truthStatus: OverlayLoreTruthStatus;
  readonly source: OverlayLoreSource;
  readonly scope: OverlayLoreScope;
  readonly visibility: OverlayLoreVisibility;
  readonly introducedAtTurnId: string;
  readonly introducedAtSessionId: string;
  readonly supersedes?: string;
  readonly invalidates?: string;
  readonly tags: readonly string[];
  readonly provenance: string;
  readonly updatedAt: string;
}

export interface RecordCampaignOverlayLoreInput {
  readonly id?: string;
  readonly kind: OverlayLoreKind;
  readonly subjectId?: string;
  readonly subjectText: string;
  readonly locationId?: string;
  readonly npcId?: string;
  readonly factionId?: string;
  readonly fact: string;
  readonly truthStatus: OverlayLoreTruthStatus;
  readonly source: OverlayLoreSource;
  readonly scope: OverlayLoreScope;
  readonly visibility: OverlayLoreVisibility;
  readonly introducedAtTurnId: string;
  readonly introducedAtSessionId: string;
  readonly supersedes?: string;
  readonly invalidates?: string;
  readonly tags?: readonly string[];
  readonly provenance: string;
  readonly at: string;
}

export interface CampaignOverlayLoreQuery {
  readonly id?: string;
  readonly query?: string;
  readonly locationId?: string;
  readonly npcId?: string;
  readonly subject?: string;
  readonly kind?: OverlayLoreKind;
  readonly tags?: readonly string[];
  readonly includeInvalidated?: boolean;
  readonly limit?: number;
}

export class CampaignOverlayLoreError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CampaignOverlayLoreError';
  }
}

const LORE_KINDS = new Set<OverlayLoreKind>([
  'rumor',
  'clue',
  'npc_detail',
  'location_detail',
  'quest_hook',
  'threat_report',
  'scene_consequence',
  'player_created_detail',
  'other',
]);

const TRUTH_STATUSES = new Set<OverlayLoreTruthStatus>([
  'confirmed',
  'true',
  'false',
  'disproven',
  'unknown',
  'rumored',
  'reported',
  'observed',
  'believed',
  'lie',
  'exaggeration',
]);

const SOURCES = new Set<OverlayLoreSource>([
  'dm_improvised',
  'player_declared',
  'module_derived',
  'tool_result',
  'consequence',
]);

const SCOPES = new Set<OverlayLoreScope>(['scene', 'session', 'campaign']);
const VISIBILITIES = new Set<OverlayLoreVisibility>([
  'player_visible',
  'dm_only',
  'mixed',
]);

interface OverlayLoreRow {
  id: string;
  kind: OverlayLoreKind;
  subject_id: string | null;
  subject_text: string;
  location_id: string | null;
  npc_id: string | null;
  faction_id: string | null;
  fact: string;
  truth_status: OverlayLoreTruthStatus;
  source: OverlayLoreSource;
  scope: OverlayLoreScope;
  visibility: OverlayLoreVisibility;
  introduced_at_turn_id: string;
  introduced_at_session_id: string;
  supersedes: string | null;
  invalidates: string | null;
  tags_json: string;
  provenance: string;
  updated_at: string;
}

export function recordCampaignOverlayLore(
  db: Db,
  input: RecordCampaignOverlayLoreInput,
): CampaignOverlayLoreRecord {
  validateLoreInput(input);
  return withTransaction(db, (txnDb) => {
    const id = input.id ?? nextOverlayLoreId(txnDb, input.introducedAtTurnId);
    txnDb
      .prepare(
        `INSERT INTO campaign_overlay_lore(
           id, kind, subject_id, subject_text, location_id, npc_id, faction_id,
           fact, truth_status, source, scope, visibility,
           introduced_at_turn_id, introduced_at_session_id, supersedes,
           invalidates, tags_json, provenance, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        input.kind,
        input.subjectId ?? null,
        input.subjectText,
        input.locationId ?? null,
        input.npcId ?? null,
        input.factionId ?? null,
        input.fact,
        input.truthStatus,
        input.source,
        input.scope,
        input.visibility,
        input.introducedAtTurnId,
        input.introducedAtSessionId,
        input.supersedes ?? null,
        input.invalidates ?? null,
        tagsColumn.encode([...(input.tags ?? [])]),
        input.provenance,
        input.at,
      );
    const record = getCampaignOverlayLore(txnDb, id);
    if (record === undefined) {
      throw new CampaignOverlayLoreError(`failed to record lore '${id}'`);
    }
    return record;
  });
}

export function getCampaignOverlayLore(
  db: Db,
  id: string,
): CampaignOverlayLoreRecord | undefined {
  const row = db
    .prepare('SELECT * FROM campaign_overlay_lore WHERE id = ?')
    .get(id) as OverlayLoreRow | undefined;
  return row === undefined ? undefined : rowToRecord(row);
}

export function queryCampaignOverlayLore(
  db: Db,
  query: CampaignOverlayLoreQuery = {},
): CampaignOverlayLoreRecord[] {
  if (query.id !== undefined) {
    const record = getCampaignOverlayLore(db, query.id);
    return record === undefined ? [] : [record];
  }
  const rows = db
    .prepare('SELECT * FROM campaign_overlay_lore ORDER BY updated_at, id')
    .all() as OverlayLoreRow[];
  const terms = normalizeTerms(query.query ?? query.subject ?? '');
  const requiredTags = new Set(query.tags ?? []);
  const limit = query.limit ?? 20;
  return rows
    .map(rowToRecord)
    .filter(
      (record) => query.includeInvalidated || record.invalidates === undefined,
    )
    .filter((record) => query.kind === undefined || record.kind === query.kind)
    .filter(
      (record) =>
        query.locationId === undefined ||
        record.locationId === query.locationId,
    )
    .filter(
      (record) => query.npcId === undefined || record.npcId === query.npcId,
    )
    .filter((record) =>
      [...requiredTags].every((tag) => record.tags.includes(tag)),
    )
    .filter((record) => terms.length === 0 || matchesTerms(record, terms))
    .slice(0, Math.max(1, Math.min(limit, 50)));
}

function validateLoreInput(input: RecordCampaignOverlayLoreInput): void {
  requireNonEmpty('subjectText', input.subjectText);
  requireNonEmpty('fact', input.fact);
  requireNonEmpty('introducedAtTurnId', input.introducedAtTurnId);
  requireNonEmpty('introducedAtSessionId', input.introducedAtSessionId);
  requireNonEmpty('provenance', input.provenance);
  requireNonEmpty('at', input.at);
  if (input.id !== undefined) requireNonEmpty('id', input.id);
  if (!LORE_KINDS.has(input.kind)) {
    throw new CampaignOverlayLoreError(`unsupported lore kind '${input.kind}'`);
  }
  if (!TRUTH_STATUSES.has(input.truthStatus)) {
    throw new CampaignOverlayLoreError(
      `unsupported truthStatus '${input.truthStatus}'`,
    );
  }
  if (!SOURCES.has(input.source)) {
    throw new CampaignOverlayLoreError(`unsupported source '${input.source}'`);
  }
  if (!SCOPES.has(input.scope)) {
    throw new CampaignOverlayLoreError(`unsupported scope '${input.scope}'`);
  }
  if (!VISIBILITIES.has(input.visibility)) {
    throw new CampaignOverlayLoreError(
      `unsupported visibility '${input.visibility}'`,
    );
  }
}

function requireNonEmpty(field: string, value: string): void {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new CampaignOverlayLoreError(
      `campaign overlay lore ${field} is required`,
    );
  }
}

function nextOverlayLoreId(db: Db, turnId: string): string {
  const row = db
    .prepare(
      'SELECT COUNT(*) AS count FROM campaign_overlay_lore WHERE introduced_at_turn_id = ?',
    )
    .get(turnId) as { count: number };
  return `lore-${turnId}-${row.count + 1}`;
}

function rowToRecord(row: OverlayLoreRow): CampaignOverlayLoreRecord {
  return {
    id: row.id,
    kind: row.kind,
    ...(row.subject_id === null ? {} : { subjectId: row.subject_id }),
    subjectText: row.subject_text,
    ...(row.location_id === null ? {} : { locationId: row.location_id }),
    ...(row.npc_id === null ? {} : { npcId: row.npc_id }),
    ...(row.faction_id === null ? {} : { factionId: row.faction_id }),
    fact: row.fact,
    truthStatus: row.truth_status,
    source: row.source,
    scope: row.scope,
    visibility: row.visibility,
    introducedAtTurnId: row.introduced_at_turn_id,
    introducedAtSessionId: row.introduced_at_session_id,
    ...(row.supersedes === null ? {} : { supersedes: row.supersedes }),
    ...(row.invalidates === null ? {} : { invalidates: row.invalidates }),
    tags: tagsColumn.decode(row.tags_json),
    provenance: row.provenance,
    updatedAt: row.updated_at,
  };
}

function normalizeTerms(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((term) => term.length >= 2);
}

function matchesTerms(
  record: CampaignOverlayLoreRecord,
  terms: readonly string[],
): boolean {
  const haystack = [
    record.id,
    record.kind,
    record.subjectId,
    record.subjectText,
    record.locationId,
    record.npcId,
    record.factionId,
    record.fact,
    record.truthStatus,
    record.source,
    record.scope,
    record.visibility,
    ...record.tags,
  ]
    .filter((part): part is string => typeof part === 'string')
    .join(' ')
    .toLowerCase();
  return terms.every((term) => haystack.includes(term));
}
