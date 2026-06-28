import type { Db } from '../persistence/db.js';
import { jsonColumn } from '../persistence/jsonColumn.js';

export type CharacterChronicleCategory =
  | 'relationship'
  | 'scar'
  | 'debt'
  | 'vow'
  | 'title'
  | 'reputation'
  | 'subjective-knowledge'
  | 'campaign-participation'
  | 'other';

export type CharacterChroniclePortability =
  | 'portable'
  | 'campaign-local'
  | 'archived';

export type CharacterChronicleVisibility =
  | 'player-visible'
  | 'dm-only'
  | 'private';

export type CharacterChronicleTruthStatus =
  | 'remembered'
  | 'believed'
  | 'rumored'
  | 'confirmed-by-character'
  | 'disputed'
  | 'unknown';

export type CharacterChronicleEventKind = 'create' | 'update';

export interface CharacterChronicleSource {
  readonly campaignId: string;
  readonly sessionId: string;
  readonly turnId?: string;
  readonly sceneId?: string;
  readonly at: string;
}

export interface CharacterChronicleRelatedRef {
  readonly ref: string;
  readonly scope?: 'character' | 'campaign' | 'rules';
  readonly campaignId?: string;
}

export interface CharacterChronicleRecord {
  readonly id: string;
  readonly globalCharacterId: string;
  readonly category: CharacterChronicleCategory;
  readonly text: string;
  readonly source: CharacterChronicleSource;
  readonly portability: CharacterChroniclePortability;
  readonly visibility: CharacterChronicleVisibility;
  readonly truthStatus: CharacterChronicleTruthStatus;
  readonly relatedRefs: readonly CharacterChronicleRelatedRef[];
  readonly createdAt: string;
  readonly updatedAt: string;
}

export type CreateCharacterChronicleRecordInput = Omit<
  CharacterChronicleRecord,
  'id' | 'createdAt' | 'updatedAt'
> & {
  readonly id?: string;
};

export interface UpdateCharacterChronicleRecordInput {
  readonly text?: string;
  readonly category?: CharacterChronicleCategory;
  readonly portability?: CharacterChroniclePortability;
  readonly visibility?: CharacterChronicleVisibility;
  readonly truthStatus?: CharacterChronicleTruthStatus;
  readonly relatedRefs?: readonly CharacterChronicleRelatedRef[];
  readonly at?: string;
}

export interface CharacterChronicleEventRecord {
  readonly id: string;
  readonly globalCharacterId: string;
  readonly recordId: string;
  readonly kind: CharacterChronicleEventKind;
  readonly changes: Record<string, unknown>;
  readonly occurredAt: string;
}

export interface CharacterChronicleStore {
  appendRecord(
    input: CreateCharacterChronicleRecordInput,
  ): CharacterChronicleRecord;
  getRecord(
    globalCharacterId: string,
    recordId: string,
  ): CharacterChronicleRecord | undefined;
  listRecords(globalCharacterId: string): readonly CharacterChronicleRecord[];
  updateRecord(
    globalCharacterId: string,
    recordId: string,
    patch: UpdateCharacterChronicleRecordInput,
  ): CharacterChronicleRecord;
  listEvents(
    globalCharacterId: string,
    recordId?: string,
  ): readonly CharacterChronicleEventRecord[];
}

export class CharacterChronicleStoreError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CharacterChronicleStoreError';
  }
}

interface ChronicleRow {
  readonly record_id: string;
  readonly global_character_id: string;
  readonly category: CharacterChronicleCategory;
  readonly text: string;
  readonly source_json: string;
  readonly portability: CharacterChroniclePortability;
  readonly visibility: CharacterChronicleVisibility;
  readonly truth_status: CharacterChronicleTruthStatus;
  readonly related_refs_json: string;
  readonly created_at: string;
  readonly updated_at: string;
}

interface ChronicleEventRow {
  readonly event_id: string;
  readonly global_character_id: string;
  readonly record_id: string;
  readonly kind: CharacterChronicleEventKind;
  readonly changes_json: string;
  readonly occurred_at: string;
}

const sourceColumn = jsonColumn<CharacterChronicleSource>(
  'character_chronicle_record.source_json',
);
const relatedRefsColumn = jsonColumn<readonly CharacterChronicleRelatedRef[]>(
  'character_chronicle_record.related_refs_json',
);
const changesColumn = jsonColumn<Record<string, unknown>>(
  'character_chronicle_event.changes_json',
);

const CATEGORIES: ReadonlySet<CharacterChronicleCategory> = new Set([
  'relationship',
  'scar',
  'debt',
  'vow',
  'title',
  'reputation',
  'subjective-knowledge',
  'campaign-participation',
  'other',
]);

const PORTABILITY: ReadonlySet<CharacterChroniclePortability> = new Set([
  'portable',
  'campaign-local',
  'archived',
]);

const VISIBILITY: ReadonlySet<CharacterChronicleVisibility> = new Set([
  'player-visible',
  'dm-only',
  'private',
]);

const TRUTH_STATUS: ReadonlySet<CharacterChronicleTruthStatus> = new Set([
  'remembered',
  'believed',
  'rumored',
  'confirmed-by-character',
  'disputed',
  'unknown',
]);

export const CHARACTER_CHRONICLE_RECORD_SCHEMA = `CREATE TABLE IF NOT EXISTS character_chronicle_record (
  global_character_id TEXT NOT NULL,
  record_id TEXT NOT NULL,
  category TEXT NOT NULL CHECK (category IN (
    'relationship',
    'scar',
    'debt',
    'vow',
    'title',
    'reputation',
    'subjective-knowledge',
    'campaign-participation',
    'other'
  )),
  text TEXT NOT NULL,
  source_json TEXT NOT NULL,
  portability TEXT NOT NULL CHECK (portability IN (
    'portable',
    'campaign-local',
    'archived'
  )),
  visibility TEXT NOT NULL CHECK (visibility IN (
    'player-visible',
    'dm-only',
    'private'
  )),
  truth_status TEXT NOT NULL CHECK (truth_status IN (
    'remembered',
    'believed',
    'rumored',
    'confirmed-by-character',
    'disputed',
    'unknown'
  )),
  related_refs_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (global_character_id, record_id)
)`;

export const CHARACTER_CHRONICLE_EVENT_SCHEMA = `CREATE TABLE IF NOT EXISTS character_chronicle_event (
  global_character_id TEXT NOT NULL,
  event_id TEXT NOT NULL,
  record_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('create', 'update')),
  changes_json TEXT NOT NULL,
  occurred_at TEXT NOT NULL,
  PRIMARY KEY (global_character_id, event_id)
)`;

export const CHARACTER_CHRONICLE_INDEX_SCHEMA = `CREATE INDEX IF NOT EXISTS idx_character_chronicle_record_order
  ON character_chronicle_record(global_character_id, portability, visibility, updated_at, record_id)`;

export const CHARACTER_CHRONICLE_EVENT_INDEX_SCHEMA = `CREATE INDEX IF NOT EXISTS idx_character_chronicle_event_record
  ON character_chronicle_event(global_character_id, record_id, occurred_at, event_id)`;

export function createCharacterChronicleStore(
  db: Db,
  now: () => string = () => new Date().toISOString(),
): CharacterChronicleStore {
  function nextRecordId(globalCharacterId: string): string {
    const row = db
      .prepare(
        `SELECT COUNT(*) AS count
           FROM character_chronicle_record
          WHERE global_character_id = ?`,
      )
      .get(globalCharacterId) as { count: number };
    return `chronicle-${row.count + 1}`;
  }

  function nextEventId(globalCharacterId: string): string {
    const row = db
      .prepare(
        `SELECT COUNT(*) AS count
           FROM character_chronicle_event
          WHERE global_character_id = ?`,
      )
      .get(globalCharacterId) as { count: number };
    return `chronicle-event-${row.count + 1}`;
  }

  function insertEvent(
    globalCharacterId: string,
    recordId: string,
    kind: CharacterChronicleEventKind,
    changes: Record<string, unknown>,
    occurredAt: string,
  ): CharacterChronicleEventRecord {
    const id = nextEventId(globalCharacterId);
    db.prepare(
      `INSERT INTO character_chronicle_event(
         global_character_id, event_id, record_id, kind, changes_json, occurred_at
       ) VALUES (?, ?, ?, ?, ?, ?)`,
    ).run(
      globalCharacterId,
      id,
      recordId,
      kind,
      changesColumn.encode(changes),
      occurredAt,
    );
    return {
      id,
      globalCharacterId,
      recordId,
      kind,
      changes,
      occurredAt,
    };
  }

  function getRecord(
    globalCharacterId: string,
    recordId: string,
  ): CharacterChronicleRecord | undefined {
    const row = db
      .prepare(
        `SELECT global_character_id, record_id, category, text, source_json,
                portability, visibility, truth_status, related_refs_json,
                created_at, updated_at
           FROM character_chronicle_record
          WHERE global_character_id = ? AND record_id = ?`,
      )
      .get(globalCharacterId.trim(), recordId.trim()) as
      | ChronicleRow
      | undefined;
    return row === undefined ? undefined : rowToRecord(row);
  }

  function listRecords(
    globalCharacterId: string,
  ): readonly CharacterChronicleRecord[] {
    const rows = db
      .prepare(
        `SELECT global_character_id, record_id, category, text, source_json,
                portability, visibility, truth_status, related_refs_json,
                created_at, updated_at
           FROM character_chronicle_record
          WHERE global_character_id = ?
          ORDER BY updated_at, record_id`,
      )
      .all(globalCharacterId.trim()) as ChronicleRow[];
    return rows.map(rowToRecord);
  }

  function listEvents(
    globalCharacterId: string,
    recordId?: string,
  ): readonly CharacterChronicleEventRecord[] {
    const rows =
      recordId === undefined
        ? (db
            .prepare(
              `SELECT global_character_id, event_id, record_id, kind,
                      changes_json, occurred_at
                 FROM character_chronicle_event
                WHERE global_character_id = ?
                ORDER BY occurred_at, event_id`,
            )
            .all(globalCharacterId.trim()) as ChronicleEventRow[])
        : (db
            .prepare(
              `SELECT global_character_id, event_id, record_id, kind,
                      changes_json, occurred_at
                 FROM character_chronicle_event
                WHERE global_character_id = ? AND record_id = ?
                ORDER BY occurred_at, event_id`,
            )
            .all(
              globalCharacterId.trim(),
              recordId.trim(),
            ) as ChronicleEventRow[]);
    return rows.map(rowToEvent);
  }

  return {
    appendRecord(input): CharacterChronicleRecord {
      const globalCharacterId = requireNonEmpty(
        'globalCharacterId',
        input.globalCharacterId,
      );
      const text = requireNonEmpty('text', input.text);
      const source = validateSource(input.source);
      validateEnum('category', input.category, CATEGORIES);
      validateEnum('portability', input.portability, PORTABILITY);
      validateEnum('visibility', input.visibility, VISIBILITY);
      validateEnum('truthStatus', input.truthStatus, TRUTH_STATUS);
      const relatedRefs = validateRelatedRefs(input.relatedRefs);
      const id = input.id ?? nextRecordId(globalCharacterId);
      const at = now();

      const append = db.transaction((): CharacterChronicleRecord => {
        db.prepare(
          `INSERT INTO character_chronicle_record(
             global_character_id, record_id, category, text, source_json,
             portability, visibility, truth_status, related_refs_json,
             created_at, updated_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        ).run(
          globalCharacterId,
          id,
          input.category,
          text,
          sourceColumn.encode(source),
          input.portability,
          input.visibility,
          input.truthStatus,
          relatedRefsColumn.encode(relatedRefs),
          at,
          at,
        );
        insertEvent(
          globalCharacterId,
          id,
          'create',
          {
            category: input.category,
            text,
            source,
            portability: input.portability,
            visibility: input.visibility,
            truthStatus: input.truthStatus,
            relatedRefs,
          },
          at,
        );
        return rowToRecord(
          db
            .prepare(
              `SELECT global_character_id, record_id, category, text, source_json,
                      portability, visibility, truth_status, related_refs_json,
                      created_at, updated_at
                 FROM character_chronicle_record
                WHERE global_character_id = ? AND record_id = ?`,
            )
            .get(globalCharacterId, id) as ChronicleRow,
        );
      });
      return append();
    },

    getRecord,

    listRecords,

    updateRecord(globalCharacterId, recordId, patch) {
      const id = requireNonEmpty('globalCharacterId', globalCharacterId);
      const recId = requireNonEmpty('recordId', recordId);
      const current = getRecord(id, recId);
      if (current === undefined) {
        throw new CharacterChronicleStoreError(
          `character chronicle record '${recId}' was not found for '${id}'`,
        );
      }
      const text =
        patch.text === undefined
          ? current.text
          : requireNonEmpty('text', patch.text);
      const category = patch.category ?? current.category;
      const portability = patch.portability ?? current.portability;
      const visibility = patch.visibility ?? current.visibility;
      const truthStatus = patch.truthStatus ?? current.truthStatus;
      const relatedRefs =
        patch.relatedRefs === undefined
          ? current.relatedRefs
          : validateRelatedRefs(patch.relatedRefs);
      validateEnum('category', category, CATEGORIES);
      validateEnum('portability', portability, PORTABILITY);
      validateEnum('visibility', visibility, VISIBILITY);
      validateEnum('truthStatus', truthStatus, TRUTH_STATUS);
      const at = patch.at ?? now();
      const changes = changedFields(current, {
        text,
        category,
        portability,
        visibility,
        truthStatus,
        relatedRefs,
      });

      const update = db.transaction((): CharacterChronicleRecord => {
        db.prepare(
          `UPDATE character_chronicle_record
              SET category = ?,
                  text = ?,
                  portability = ?,
                  visibility = ?,
                  truth_status = ?,
                  related_refs_json = ?,
                  updated_at = ?
            WHERE global_character_id = ? AND record_id = ?`,
        ).run(
          category,
          text,
          portability,
          visibility,
          truthStatus,
          relatedRefsColumn.encode(relatedRefs),
          at,
          id,
          recId,
        );
        insertEvent(id, recId, 'update', changes, at);
        return getRecord(id, recId) as CharacterChronicleRecord;
      });
      return update();
    },

    listEvents,
  };
}

function rowToRecord(row: ChronicleRow): CharacterChronicleRecord {
  return {
    id: row.record_id,
    globalCharacterId: row.global_character_id,
    category: row.category,
    text: row.text,
    source: sourceColumn.decode(row.source_json),
    portability: row.portability,
    visibility: row.visibility,
    truthStatus: row.truth_status,
    relatedRefs: relatedRefsColumn.decode(row.related_refs_json),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function rowToEvent(row: ChronicleEventRow): CharacterChronicleEventRecord {
  return {
    id: row.event_id,
    globalCharacterId: row.global_character_id,
    recordId: row.record_id,
    kind: row.kind,
    changes: changesColumn.decode(row.changes_json),
    occurredAt: row.occurred_at,
  };
}

function validateSource(
  source: CharacterChronicleSource,
): CharacterChronicleSource {
  return {
    campaignId: requireNonEmpty('source.campaignId', source.campaignId),
    sessionId: requireNonEmpty('source.sessionId', source.sessionId),
    ...(source.turnId !== undefined
      ? { turnId: requireNonEmpty('source.turnId', source.turnId) }
      : {}),
    ...(source.sceneId !== undefined
      ? { sceneId: requireNonEmpty('source.sceneId', source.sceneId) }
      : {}),
    at: requireNonEmpty('source.at', source.at),
  };
}

function validateRelatedRefs(
  refs: readonly CharacterChronicleRelatedRef[],
): readonly CharacterChronicleRelatedRef[] {
  return refs.map((entry, index) => ({
    ref: requireNonEmpty(`relatedRefs[${index}].ref`, entry.ref),
    ...(entry.scope !== undefined ? { scope: entry.scope } : {}),
    ...(entry.campaignId !== undefined
      ? {
          campaignId: requireNonEmpty(
            `relatedRefs[${index}].campaignId`,
            entry.campaignId,
          ),
        }
      : {}),
  }));
}

function requireNonEmpty(field: string, value: string): string {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    throw new CharacterChronicleStoreError(`${field} must be non-empty`);
  }
  return trimmed;
}

function validateEnum<T extends string>(
  field: string,
  value: string,
  allowed: ReadonlySet<T>,
): asserts value is T {
  if (!allowed.has(value as T)) {
    throw new CharacterChronicleStoreError(
      `${field} has unsupported value '${value}'`,
    );
  }
}

function changedFields(
  current: CharacterChronicleRecord,
  next: Pick<
    CharacterChronicleRecord,
    | 'text'
    | 'category'
    | 'portability'
    | 'visibility'
    | 'truthStatus'
    | 'relatedRefs'
  >,
): Record<string, unknown> {
  const changes: Record<string, unknown> = {};
  for (const key of [
    'text',
    'category',
    'portability',
    'visibility',
    'truthStatus',
    'relatedRefs',
  ] as const) {
    if (JSON.stringify(current[key]) !== JSON.stringify(next[key])) {
      changes[key] = next[key];
    }
  }
  return changes;
}
