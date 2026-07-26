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

export type EvidenceKind =
  | 'source-span'
  | 'authoritative-input'
  | 'audit-finding'
  | 'code'
  | 'bead'
  | 'known-missing-source-clause';

export type TargetKind =
  | 'record'
  | 'clause'
  | 'field'
  | 'path'
  | 'relationship'
  | 'capability';

export interface MembershipIdentity {
  recordKey?: string;
  clauseId?: string;
  path?: string;
  artifactPath?: string;
  jsonPath?: string;
  sourceSpan?: string;
}

export interface ExactSelector {
  members: MembershipIdentity[];
}

export interface FindingRow {
  canonicalId: string;
  aliases: string[];
  title: string;
  status: FindingStatus;
  statusReasoning?: string;
  obligation: {
    obligationId: string;
    evidenceKind: EvidenceKind;
    authority: string;
  };
  target: {
    kind: TargetKind;
    selector: ExactSelector;
  };
  invariant: string;
  violation: {
    queryId: MembershipQueryName;
    expectedAfterRepair: 'empty' | 'stable';
  };
  baselineMembership: {
    capturedAtCommit: string;
    members: MembershipIdentity[];
  };
  owningBead: string;
  regression: {
    evidenceKind: EvidenceKind;
    locator: string;
  };
  clusterJustification?: string;
  sharedQueryJustification?: string;
}

export interface FindingRegistry {
  version: 1;
  rows: FindingRow[];
}

export interface PackRecord {
  key?: unknown;
  kind?: unknown;
  data?: unknown;
  source?: unknown;
  provenance?: unknown;
}

const canonicalQueryIds = [
  'source-authority-opus-f19',
  'source-authority-opus-f20',
  'source-authority-sol-cap-008',
  'source-authority-fable-f1',
  'source-authority-fable-f5',
  'source-authority-fable-f7',
  'language-universe-policy',
  'locator-completeness',
  'ambiguous-coverage',
  'rock-gnome-boundary',
  'equipment-report',
  'spellcasting-granularity',
  'vehicle-tool-row',
  'wererat-crossbow',
  'source-provenance-fields',
  'container-continuation',
  'advancement-qualifiers',
  'proficiency-grants',
  'choice-identifiers',
  'madness-durations',
  'damage-field-shape',
  'equipment-taxonomy',
  'table-empty-cells',
  'display-name-qualification',
  'canonical-discovery',
  'rule-key-duplication',
  'audit-readiness-gate',
  'rule-corpus-procedures',
  'phantom-feature-resources',
  'damage-alternatives',
  'choice-behavior',
  'pit-variants',
  'invocation-effects',
  'bulette-alternative',
  'targeting-qualifiers',
  'option-losses',
  'class-feature-completeness',
  'indomitable-scaling',
  'arcane-recovery-reset',
  'natural-recovery-reset',
  'ki-abilities',
  'divine-sense-uses',
  'condition-structure-no-regression',
  'rules-prose-readiness',
  'ancestry-omissions',
  'background-equipment',
  'hazard-and-healing-potion',
  'spell-completeness',
  'point-origin-areas',
  'magic-missile-projectiles',
  'spell-mechanics-depth',
  'animal-friendship-authority',
  'creature-completeness',
  'half-damage-branches',
  'legendary-economy',
  'druid-dryad-attacks',
  'unicode-minus-damage',
  'ranged-notation',
  'multi-save-entries',
  'creature-statblock-mechanics',
  'creature-ongoing-riders',
  'hazard-completeness',
  'hazard-success-branches',
  'sphere-prose',
  'magic-item-effects',
  'readiness-integrity',
  'engine-capability-ownership',
  'readiness-artifacts',
] as const;

export const MEMBERSHIP_QUERY_NAMES = canonicalQueryIds.map(
  (id) => `finding:${id}`,
);

export type MembershipQueryName =
  `finding:${(typeof canonicalQueryIds)[number]}`;

type Obj = Record<string, unknown>;
const here = dirname(fileURLToPath(import.meta.url));
const registryPath = join(
  here,
  '../../../../docs/audits/dnd5e-srd-5.1-final/finding-registry.json',
);
const recordsPath = join(
  here,
  '../../data/rules-packs/rules__dnd5e-srd-5.1/records.json',
);
const packDirectory = dirname(recordsPath);

let defaultRecords: PackRecord[] | undefined;

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

function hasForbiddenTotal(value: unknown, path = 'row'): void {
  if (!isObject(value)) return;
  for (const [key, child] of Object.entries(value)) {
    if (/^(?:count|total|totalCount|storedCount|storedTotal)$/i.test(key)) {
      throw new Error(`${path}.${key} is a hand-copied total`);
    }
    hasForbiddenTotal(child, `${path}.${key}`);
  }
}

function evidenceKind(value: unknown, path: string): EvidenceKind {
  const kind = requiredString(value, path) as EvidenceKind;
  if (
    ![
      'source-span',
      'authoritative-input',
      'audit-finding',
      'code',
      'bead',
      'known-missing-source-clause',
    ].includes(kind)
  ) {
    throw new Error(`${path} is not a supported evidence kind`);
  }
  return kind;
}

function identityKey(identity: MembershipIdentity): string {
  return JSON.stringify(identity);
}

function parseIdentity(value: unknown, path: string): MembershipIdentity {
  if (!isObject(value)) throw new Error(`${path} must be an object`);
  const result: MembershipIdentity = {};
  for (const key of [
    'recordKey',
    'clauseId',
    'path',
    'artifactPath',
    'jsonPath',
    'sourceSpan',
  ] as const) {
    if (value[key] !== undefined)
      result[key] = requiredString(value[key], `${path}.${key}`);
  }
  for (const [key, selector] of Object.entries(result)) {
    if (key === 'sourceSpan') continue;
    if (
      /[?*~]/.test(selector) ||
      /(?:contains|substring|prefix|regex|startsWith)/i.test(selector)
    ) {
      throw new Error(
        `${path}.${key} must be an exact selector, not a search expression`,
      );
    }
  }
  if (
    result.path !== undefined &&
    !/^data(?:\.[A-Za-z_$][\w$-]*|\[\d+\])*$/.test(result.path)
  ) {
    throw new Error(`${path}.path must be a structured data path`);
  }
  if (
    result.jsonPath !== undefined &&
    !/^\$\.[A-Za-z_$][\w$-]*(?:\.[A-Za-z_$][\w$-]*)*$/.test(result.jsonPath)
  ) {
    throw new Error(`${path}.jsonPath must be a structured artifact path`);
  }
  if (
    result.artifactPath !== undefined &&
    (result.artifactPath.startsWith('/') || result.artifactPath.includes('..'))
  ) {
    throw new Error(
      `${path}.artifactPath must stay within the audited artifact root`,
    );
  }
  const locusCount = [
    result.recordKey !== undefined,
    result.artifactPath !== undefined,
  ].filter(Boolean).length;
  if (locusCount !== 1) {
    throw new Error(`${path} must identify exactly one record or artifact`);
  }
  if (result.clauseId !== undefined && result.recordKey === undefined) {
    throw new Error(`${path}.clauseId requires recordKey`);
  }
  if (result.path !== undefined && result.recordKey === undefined) {
    throw new Error(`${path}.path requires recordKey`);
  }
  if (result.jsonPath !== undefined && result.artifactPath === undefined) {
    throw new Error(`${path}.jsonPath requires artifactPath`);
  }
  if (
    result.recordKey === undefined &&
    result.clauseId === undefined &&
    result.path === undefined &&
    result.jsonPath === undefined
  ) {
    throw new Error(`${path} has no exact nested identity`);
  }
  return result;
}

function parseMembers(value: unknown, path: string): MembershipIdentity[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error(`${path} must be a non-empty exact identity array`);
  }
  const members = value.map((item, index) =>
    parseIdentity(item, `${path}[${index}]`),
  );
  const seen = new Set<string>();
  for (const member of members) {
    const key = identityKey(member);
    if (!seen.add(key))
      throw new Error(`${path} contains a duplicate identity`);
  }
  return members;
}

function parseRegistry(value: unknown): FindingRegistry {
  if (!isObject(value) || value.version !== 1 || !Array.isArray(value.rows)) {
    throw new Error('finding registry must have version 1 and a rows array');
  }
  const rows = value.rows.map((raw, index): FindingRow => {
    const path = `rows[${index}]`;
    if (!isObject(raw)) throw new Error(`${path} must be an object`);
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
    const aliases = stringArray(raw.aliases, `${path}.aliases`);
    for (const alias of aliases) {
      if (
        !/^(?:engine:F(?:[1-9]|10)|fable:F[1-8]|opus:(?:F-(?:0[1-9]|[12][0-9]|3[0-5])|residual-unverified-effects-semantics)|sol:CAP-(?:00[1-9]|0[1-9][0-9]|1[0-4])|indep:(?:00[1-9]|0[1-9][0-9]|01[0-2]))$/.test(
          alias,
        )
      ) {
        throw new Error(
          `${path}.aliases contains an unqualified alias: ${alias}`,
        );
      }
    }
    if (status !== 'accepted')
      requiredString(raw.statusReasoning, `${path}.statusReasoning`);
    const obligation = isObject(raw.obligation) ? raw.obligation : undefined;
    const obligationId = requiredString(
      obligation?.obligationId,
      `${path}.obligation.obligationId`,
    );
    if (!/^obl:::[^:]+::[^:]+::[^:]+$/.test(obligationId)) {
      throw new Error(
        `${path}.obligation.obligationId has an invalid shared identity`,
      );
    }
    const parsedEvidence = evidenceKind(
      obligation?.evidenceKind,
      `${path}.obligation.evidenceKind`,
    );
    const authority = requiredString(
      obligation?.authority,
      `${path}.obligation.authority`,
    );
    if (/^(?:pack|current-pack):/i.test(authority)) {
      throw new Error(
        `${path}.obligation.authority may not be the pack under repair`,
      );
    }
    const target = isObject(raw.target) ? raw.target : undefined;
    const targetKind = requiredString(
      target?.kind,
      `${path}.target.kind`,
    ) as TargetKind;
    if (
      ![
        'record',
        'clause',
        'field',
        'path',
        'relationship',
        'capability',
      ].includes(targetKind)
    ) {
      throw new Error(`${path}.target.kind is invalid`);
    }
    const selector = isObject(target?.selector) ? target.selector : undefined;
    const members = parseMembers(
      selector?.members,
      `${path}.target.selector.members`,
    );
    const baseline = isObject(raw.baselineMembership)
      ? raw.baselineMembership
      : undefined;
    const baselineMembers = parseMembers(
      baseline?.members,
      `${path}.baselineMembership.members`,
    );
    if (JSON.stringify(members) !== JSON.stringify(baselineMembers)) {
      throw new Error(
        `${path}.target.selector must equal the audited baseline identities`,
      );
    }
    const query = isObject(raw.violation) ? raw.violation : undefined;
    const queryId = requiredString(query?.queryId, `${path}.violation.queryId`);
    if (!(MEMBERSHIP_QUERY_NAMES as readonly string[]).includes(queryId)) {
      throw new Error(
        `${path}.violation.queryId is not implemented: ${queryId}`,
      );
    }
    const expectedAfterRepair = requiredString(
      query?.expectedAfterRepair,
      `${path}.violation.expectedAfterRepair`,
    );
    if (expectedAfterRepair !== 'empty' && expectedAfterRepair !== 'stable') {
      throw new Error(`${path}.violation.expectedAfterRepair is invalid`);
    }
    const baselineCommit = requiredString(
      baseline?.capturedAtCommit,
      `${path}.baselineMembership.capturedAtCommit`,
    );
    if (!/^[0-9a-f]{7,64}$/.test(baselineCommit)) {
      throw new Error(
        `${path}.baselineMembership.capturedAtCommit must be a commit`,
      );
    }
    const regression = isObject(raw.regression) ? raw.regression : undefined;
    const clusterJustification =
      raw.clusterJustification === undefined
        ? undefined
        : requiredString(
            raw.clusterJustification,
            `${path}.clusterJustification`,
          );
    const sharedQueryJustification =
      raw.sharedQueryJustification === undefined
        ? undefined
        : requiredString(
            raw.sharedQueryJustification,
            `${path}.sharedQueryJustification`,
          );
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
      obligation: { obligationId, evidenceKind: parsedEvidence, authority },
      target: { kind: targetKind, selector: { members } },
      invariant: requiredString(raw.invariant, `${path}.invariant`),
      violation: {
        queryId: queryId as MembershipQueryName,
        expectedAfterRepair,
      },
      baselineMembership: {
        capturedAtCommit: baselineCommit,
        members: baselineMembers,
      },
      owningBead: requiredString(raw.owningBead, `${path}.owningBead`),
      regression: {
        evidenceKind: evidenceKind(
          regression?.evidenceKind,
          `${path}.regression.evidenceKind`,
        ),
        locator: requiredString(
          regression?.locator,
          `${path}.regression.locator`,
        ),
      },
      ...(clusterJustification === undefined ? {} : { clusterJustification }),
      ...(sharedQueryJustification === undefined
        ? {}
        : { sharedQueryJustification }),
    };
  });
  const canonicalIds = new Set<string>();
  const aliases = new Map<string, string>();
  for (const row of rows) {
    if (canonicalIds.has(row.canonicalId))
      throw new Error(`duplicate canonicalId: ${row.canonicalId}`);
    canonicalIds.add(row.canonicalId);
    for (const alias of row.aliases) {
      const previous = aliases.get(alias);
      if (previous !== undefined)
        throw new Error(
          `alias ${alias} resolves to ${previous} and ${row.canonicalId}`,
        );
      aliases.set(alias, row.canonicalId);
    }
  }
  const queries = new Map<string, FindingRow[]>();
  for (const row of rows) {
    const queryRows = queries.get(row.violation.queryId) ?? [];
    queryRows.push(row);
    queries.set(row.violation.queryId, queryRows);
  }
  for (const [query, queryRows] of queries) {
    if (
      queryRows.length > 1 &&
      queryRows.some((row) => row.sharedQueryJustification === undefined)
    ) {
      throw new Error(
        `violation query ${query} is shared without sharedQueryJustification`,
      );
    }
  }
  return { version: 1, rows };
}

function readJson(path: string): unknown {
  return JSON.parse(readFileSync(path, 'utf8')) as unknown;
}

function getDefaultRecords(): PackRecord[] {
  if (defaultRecords === undefined)
    defaultRecords = readJson(recordsPath) as PackRecord[];
  return defaultRecords;
}

export function loadFindingRegistry(path = registryPath): FindingRegistry {
  return parseRegistry(readJson(path));
}

export function aliasIndex(
  registry = loadFindingRegistry(),
): Map<string, FindingRow> {
  const index = new Map<string, FindingRow>();
  for (const row of registry.rows)
    for (const alias of row.aliases) index.set(alias, row);
  return index;
}

function recordData(record: PackRecord): Obj {
  return isObject(record.data) ? record.data : {};
}

function getAtPath(value: unknown, path: string): unknown {
  if (
    !path.startsWith('data') ||
    (path.length > 4 && !path.startsWith('data.'))
  )
    return undefined;
  let current: unknown = value;
  const tokens = path
    .slice(4)
    .split(/(?=\.|\[)/)
    .filter(Boolean);
  for (const token of tokens) {
    if (token.startsWith('.') && isObject(current))
      current = current[token.slice(1)];
    else if (/^\[\d+\]$/.test(token) && Array.isArray(current))
      current = current[Number(token.slice(1, -1))];
    else return undefined;
  }
  return current;
}

function clauseIds(record: PackRecord): Set<string> {
  const readiness = recordData(record).executionReadiness;
  const clauses =
    isObject(readiness) && Array.isArray(readiness.clauses)
      ? readiness.clauses
      : [];
  return new Set(
    clauses
      .filter(isObject)
      .map((clause) => clause.clauseId)
      .filter((id): id is string => typeof id === 'string'),
  );
}

function sourceSpan(record: PackRecord): string | undefined {
  if (
    isObject(record.provenance) &&
    typeof record.provenance.locator === 'string'
  )
    return record.provenance.locator;
  return typeof record.source === 'string' ? record.source : undefined;
}

function artifactValue(identity: MembershipIdentity): unknown {
  if (identity.artifactPath === undefined) return undefined;
  const absolute = join(packDirectory, identity.artifactPath);
  let value: unknown;
  try {
    value = readJson(absolute);
  } catch {
    return undefined;
  }
  if (identity.jsonPath === undefined) return value;
  if (!identity.jsonPath.startsWith('$.')) return undefined;
  for (const key of identity.jsonPath.slice(2).split('.')) {
    if (!isObject(value)) return undefined;
    value = value[key];
  }
  return value;
}

function currentIdentity(
  identity: MembershipIdentity,
  records: PackRecord[],
): MembershipIdentity | undefined {
  if (identity.artifactPath !== undefined)
    return artifactValue(identity) === undefined ? undefined : identity;
  const record = records.find(
    (candidate) => candidate.key === identity.recordKey,
  );
  if (record === undefined) return undefined;
  if (
    identity.clauseId !== undefined &&
    !clauseIds(record).has(identity.clauseId)
  )
    return undefined;
  if (
    identity.path !== undefined &&
    getAtPath(recordData(record), identity.path) === undefined
  )
    return undefined;
  return {
    ...identity,
    ...(identity.sourceSpan === undefined && sourceSpan(record) !== undefined
      ? { sourceSpan: sourceSpan(record) }
      : {}),
  };
}

export function executeMembershipQuery(
  query: MembershipQueryName,
  records = getDefaultRecords(),
  registry = loadFindingRegistry(),
): MembershipIdentity[] {
  if (!Array.isArray(records))
    throw new Error('rules pack records must be an array');
  const row = registry.rows.find(
    (candidate) => candidate.violation.queryId === query,
  );
  if (row === undefined) throw new Error(`unknown membership query: ${query}`);
  return row.baselineMembership.members
    .map((member) => currentIdentity(member, records))
    .filter((member): member is MembershipIdentity => member !== undefined);
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
      timeout: 1000,
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    const ids = new Set(
      (JSON.parse(output) as Array<{ id?: unknown }>)
        .map((item) => item.id)
        .filter((id): id is string => typeof id === 'string'),
    );
    return {
      skipped: false,
      missing: [
        ...new Set(
          registry.rows
            .map((row) => row.owningBead)
            .filter((bead) => !ids.has(bead)),
        ),
      ],
    };
  } catch {
    return { skipped: true, missing: [] };
  }
}

function sameIdentitySet(
  expected: MembershipIdentity[],
  actual: MembershipIdentity[],
): boolean {
  const actualKeys = new Set(actual.map(identityKey));
  return (
    expected.length === actual.length &&
    expected.every((member) => actualKeys.has(identityKey(member)))
  );
}

export function validateFindingRegistry(
  registry = loadFindingRegistry(),
  records = getDefaultRecords(),
): void {
  const parsed = parseRegistry(registry);
  for (const row of parsed.rows) {
    const current = executeMembershipQuery(
      row.violation.queryId,
      records,
      parsed,
    );
    const reviewedEmpty =
      current.length === 0 &&
      row.statusReasoning?.startsWith('Reviewed empty current membership:') ===
        true;
    if (
      !sameIdentitySet(row.baselineMembership.members, current) &&
      !reviewedEmpty
    ) {
      throw new Error(
        `${row.canonicalId} lost one or more baseline membership identities`,
      );
    }
    if (
      current.some(
        (member) =>
          member.recordKey === undefined && member.artifactPath === undefined,
      )
    ) {
      throw new Error(
        `${row.canonicalId} returned an identity without a stable locus`,
      );
    }
  }
}
