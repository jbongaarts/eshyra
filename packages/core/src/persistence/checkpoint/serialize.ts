import { type Db, withTransaction } from '../db.js';
import { quoteIdent } from '../sql.js';

export interface SnapshotRecord {
  table: string;
  kind: 'schema' | 'row';
  ordinal: number;
  payload: string;
}

export interface SnapshotSchema {
  version: 2;
  type: 'table' | 'view';
  create: string;
  /** SQLite autoindexes have null SQL and are recreated by table constraints. */
  objects: { type: 'index' | 'trigger'; name: string; sql: string }[];
}

/** Old snapshots cannot establish which enforcement objects were discarded. */
export function readSnapshotSchema(record: SnapshotRecord): SnapshotSchema {
  const schema = JSON.parse(record.payload) as SnapshotSchema;
  if (
    schema === null ||
    typeof schema !== 'object' ||
    schema.version !== 2 ||
    !['table', 'view'].includes(schema.type) ||
    typeof schema.create !== 'string' ||
    !Array.isArray(schema.objects) ||
    !schema.objects.every(
      (object) =>
        object !== null &&
        typeof object === 'object' &&
        ['index', 'trigger'].includes(object.type) &&
        typeof object.name === 'string' &&
        typeof object.sql === 'string',
    )
  )
    throw new Error(
      'Checkpoint lacks complete schema metadata; create a new checkpoint from the original campaign database before restoring.',
    );
  return schema;
}

interface MasterRow {
  type: 'table' | 'view' | 'index' | 'trigger';
  name: string;
  tbl_name: string;
  sql: string;
}

export function serializeCampaign(db: Db): SnapshotRecord[] {
  // One SQLite read transaction binds schema and rows to the same database state.
  return withTransaction(db, () => {
    const master = db
      .prepare(
        "SELECT type,name,tbl_name,sql FROM sqlite_master WHERE name NOT GLOB 'sqlite_*' AND sql IS NOT NULL ORDER BY type,name",
      )
      .all() as MasterRow[];
    const relations = master
      .filter((r) => r.type === 'table' || r.type === 'view')
      .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    const records: SnapshotRecord[] = [];
    for (const relation of relations) {
      records.push({
        table: relation.name,
        kind: 'schema',
        ordinal: 0,
        payload: JSON.stringify({
          version: 2,
          type: relation.type,
          create: relation.sql,
          objects: master
            .filter(
              (o) =>
                o.tbl_name === relation.name &&
                (o.type === 'index' || o.type === 'trigger'),
            )
            .map((o) => ({ type: o.type, name: o.name, sql: o.sql })),
        }),
      });
    }
    for (const relation of relations) {
      if (relation.type !== 'table') continue;
      const rows = db
        .prepare(`SELECT * FROM ${quoteIdent(relation.name)}`)
        .all() as Record<string, unknown>[];
      rows
        .map(canonicalRow)
        .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
        .forEach((payload, ordinal) => {
          records.push({ table: relation.name, kind: 'row', ordinal, payload });
        });
    }
    return records;
  });
}

function canonicalRow(row: Record<string, unknown>): string {
  const keys = Object.keys(row).sort();
  const obj: Record<string, unknown> = {};
  for (const k of keys) {
    const v = row[k];
    obj[k] = Buffer.isBuffer(v) ? { __blob: v.toString('base64') } : v;
  }
  return JSON.stringify(obj);
}

export function canonicalize(records: SnapshotRecord[]): string {
  return records
    .map(
      (r) =>
        `{"table":${JSON.stringify(r.table)},"kind":${JSON.stringify(
          r.kind,
        )},"ordinal":${r.ordinal},"payload":${JSON.stringify(r.payload)}}`,
    )
    .join('\n');
}
