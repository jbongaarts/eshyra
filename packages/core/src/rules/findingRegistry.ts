import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export type FindingStatus =
  | 'accepted'
  | 'rejected'
  | 'narrowed'
  | 'ambiguous'
  | 'disclosed-dependency';

export interface FindingRow {
  canonicalId: string;
  aliases: string[];
  title: string;
  status: FindingStatus;
  statusReasoning?: string;
  membershipQuery: MembershipQueryName;
  owningBead: string;
  packBoundary: string;
  engineBoundary: string;
  regressionForm: string;
}

export interface FindingRegistry {
  version: 1;
  rows: FindingRow[];
}

export const MEMBERSHIP_QUERY_NAMES = [
  'recordsWithSourceAuthorityRisk',
  'recordsWithLocatorOrOwnershipEvidence',
  'recordsByKind',
  'recordsWithExecutionReadiness',
  'engineHookReferences',
  'pendingExecutionClauses',
  'magicItemClauses',
] as const;

export type MembershipQueryName = (typeof MEMBERSHIP_QUERY_NAMES)[number];

type Obj = Record<string, unknown>;
type PackRecord = Obj & { key?: unknown; kind?: unknown; data?: unknown };

const here = dirname(fileURLToPath(import.meta.url));
const registryPath = join(
  here,
  '../../../../docs/audits/dnd5e-srd-5.1-final/finding-registry.json',
);
const recordsPath = join(
  here,
  '../../data/rules-packs/rules__dnd5e-srd-5.1/records.json',
);

function isObject(value: unknown): value is Obj {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function requiredString(value: unknown, path: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`${path} must be a non-empty string`);
  }
  return value;
}

function stringArray(value: unknown, path: string): string[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error(`${path} must be a non-empty array`);
  }
  return value.map((item, index) => requiredString(item, `${path}[${index}]`));
}

function hasForbiddenTotal(value: unknown, path = 'row'): boolean {
  if (!isObject(value)) {
    return false;
  }
  return Object.entries(value).some(([key, child]) => {
    if (/^(?:count|total|totalCount|storedCount|storedTotal)$/i.test(key)) {
      throw new Error(`${path}.${key} is a hand-copied total`);
    }
    return hasForbiddenTotal(child, `${path}.${key}`);
  });
}

function parseRegistry(value: unknown): FindingRegistry {
  if (!isObject(value) || value.version !== 1 || !Array.isArray(value.rows)) {
    throw new Error('finding registry must have version 1 and a rows array');
  }
  const rows = value.rows.map((raw, index): FindingRow => {
    const path = `rows[${index}]`;
    if (!isObject(raw)) {
      throw new Error(`${path} must be an object`);
    }
    hasForbiddenTotal(raw, path);
    const status = requiredString(
      raw.status,
      `${path}.status`,
    ) as FindingStatus;
    if (
      ![
        'accepted',
        'rejected',
        'narrowed',
        'ambiguous',
        'disclosed-dependency',
      ].includes(status)
    ) {
      throw new Error(`${path}.status is invalid`);
    }
    const membershipQuery = requiredString(
      raw.membershipQuery,
      `${path}.membershipQuery`,
    ) as MembershipQueryName;
    if (
      !(MEMBERSHIP_QUERY_NAMES as readonly string[]).includes(membershipQuery)
    ) {
      throw new Error(
        `${path}.membershipQuery is not implemented: ${membershipQuery}`,
      );
    }
    const aliases = stringArray(raw.aliases, `${path}.aliases`);
    for (const alias of aliases) {
      if (
        !/^(?:engine:F(?:[1-9]|10)|fable:F[1-8]|opus:(?:F-(?:0[1-9]|[12][0-9]|3[0-5])|residual-unverified-effects-semantics)|sol:CAP-(?:00[1-9]|0[1-9][0-9]|1[0-4])|indep:(?:00[1-9]|0[1-9][0-9]|01[0-2]))$/.test(
          alias,
        )
      ) {
        throw new Error(`${path}.aliases contains unqualified alias: ${alias}`);
      }
    }
    if (status !== 'accepted' && typeof raw.statusReasoning !== 'string') {
      throw new Error(`${path}.statusReasoning is required for ${status}`);
    }
    return {
      canonicalId: requiredString(raw.canonicalId, `${path}.canonicalId`),
      aliases,
      title: requiredString(raw.title, `${path}.title`),
      status,
      ...(raw.statusReasoning === undefined
        ? {}
        : {
            statusReasoning: requiredString(
              raw.statusReasoning,
              `${path}.statusReasoning`,
            ),
          }),
      membershipQuery,
      owningBead: requiredString(raw.owningBead, `${path}.owningBead`),
      packBoundary: requiredString(raw.packBoundary, `${path}.packBoundary`),
      engineBoundary: requiredString(
        raw.engineBoundary,
        `${path}.engineBoundary`,
      ),
      regressionForm: requiredString(
        raw.regressionForm,
        `${path}.regressionForm`,
      ),
    };
  });
  const aliases = new Map<string, string>();
  for (const row of rows) {
    if (aliases.has(row.canonicalId)) {
      throw new Error(`duplicate canonicalId: ${row.canonicalId}`);
    }
    for (const alias of row.aliases) {
      const previous = aliases.get(alias);
      if (previous !== undefined) {
        throw new Error(
          `alias ${alias} resolves to ${previous} and ${row.canonicalId}`,
        );
      }
      aliases.set(alias, row.canonicalId);
    }
  }
  return { version: 1, rows };
}

function readJson(path: string): unknown {
  return JSON.parse(readFileSync(path, 'utf8')) as unknown;
}

export function loadFindingRegistry(path = registryPath): FindingRegistry {
  return parseRegistry(readJson(path));
}

export function aliasIndex(
  registry = loadFindingRegistry(),
): Map<string, FindingRow> {
  const index = new Map<string, FindingRow>();
  for (const row of registry.rows) {
    for (const alias of row.aliases) index.set(alias, row);
  }
  return index;
}

function recordData(record: PackRecord): Obj {
  return isObject(record.data) ? record.data : {};
}

function readiness(record: PackRecord): Obj | undefined {
  const value = recordData(record).executionReadiness;
  return isObject(value) ? value : undefined;
}

function clauses(record: PackRecord): Obj[] {
  const value = readiness(record)?.clauses;
  return Array.isArray(value) ? value.filter(isObject) : [];
}

export function executeMembershipQuery(
  query: MembershipQueryName,
  records = readJson(recordsPath) as PackRecord[],
): unknown[] {
  if (!Array.isArray(records))
    throw new Error('rules pack records must be an array');
  switch (query) {
    case 'recordsWithSourceAuthorityRisk':
      return records.filter(
        (record) =>
          typeof record.source === 'string' &&
          typeof record.license === 'object',
      );
    case 'recordsWithLocatorOrOwnershipEvidence':
      return records.filter(
        (record) =>
          typeof record.provenance === 'object' ||
          typeof record.source === 'string',
      );
    case 'recordsByKind':
      return records.filter((record) => typeof record.kind === 'string');
    case 'recordsWithExecutionReadiness':
      return records.filter((record) => readiness(record) !== undefined);
    case 'engineHookReferences':
      return records.flatMap((record) =>
        clauses(record).flatMap((clause) => {
          const hooks = Array.isArray(clause.engineHooks)
            ? clause.engineHooks
            : [];
          return hooks.filter(isObject).map((hook) => ({
            recordKey: record.key,
            clauseId: clause.clauseId,
            engine: hook.engine,
          }));
        }),
      );
    case 'pendingExecutionClauses':
      return records.flatMap((record) =>
        clauses(record).filter((clause) => clause.readiness !== 'green'),
      );
    case 'magicItemClauses':
      return records
        .filter((record) => record.kind === 'magic-item')
        .flatMap((record) => clauses(record));
  }
}

export interface BeadReferenceCheck {
  skipped: boolean;
  missing: string[];
}

export function checkBeadReferences(
  registry = loadFindingRegistry(),
): BeadReferenceCheck {
  try {
    const output = execFileSync('bd', ['list', '--all', '--json'], {
      encoding: 'utf8',
      timeout: 5000,
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    const ids = new Set(
      (JSON.parse(output) as Array<{ id?: unknown }>)
        .map((item) => item.id)
        .filter((id): id is string => typeof id === 'string'),
    );
    const missing = registry.rows
      .map((row) => row.owningBead)
      .filter(
        (bead, index, all) => !ids.has(bead) && all.indexOf(bead) === index,
      );
    return { skipped: false, missing: [...new Set(missing)] };
  } catch {
    return { skipped: true, missing: [] };
  }
}

export function validateFindingRegistry(
  registry = loadFindingRegistry(),
): void {
  for (const row of registry.rows) executeMembershipQuery(row.membershipQuery);
}
