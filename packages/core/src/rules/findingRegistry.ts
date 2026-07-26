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
  clusterJustification?: string;
  sharedQueryJustification?: string;
  owningBead: string;
  packBoundary: string;
  engineBoundary: string;
  regressionForm: string;
}

export interface FindingRegistry {
  version: 1;
  rows: FindingRow[];
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
  'clause-completeness',
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

let defaultRecords: PackRecord[] | undefined;

function getDefaultRecords(): PackRecord[] {
  if (defaultRecords === undefined) {
    defaultRecords = readJson(recordsPath) as PackRecord[];
  }
  return defaultRecords;
}

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

function nonEmptyOptionalString(
  value: unknown,
  path: string,
): string | undefined {
  if (value === undefined) return undefined;
  return requiredString(value, path);
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
    if (status !== 'accepted') {
      requiredString(raw.statusReasoning, `${path}.statusReasoning`);
    }
    const clusterJustification = nonEmptyOptionalString(
      raw.clusterJustification,
      `${path}.clusterJustification`,
    );
    const sharedQueryJustification = nonEmptyOptionalString(
      raw.sharedQueryJustification,
      `${path}.sharedQueryJustification`,
    );
    const aliasesByReview = new Map<string, string[]>();
    for (const alias of aliases) {
      const review = alias.split(':', 1)[0];
      const reviewAliases = aliasesByReview.get(review) ?? [];
      reviewAliases.push(alias);
      aliasesByReview.set(review, reviewAliases);
    }
    if (
      [...aliasesByReview.values()].some(
        (reviewAliases) => reviewAliases.length > 1,
      ) &&
      clusterJustification === undefined
    ) {
      throw new Error(
        `${path}.clusterJustification is required when a row clusters aliases from one review`,
      );
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
      ...(clusterJustification === undefined ? {} : { clusterJustification }),
      ...(sharedQueryJustification === undefined
        ? {}
        : { sharedQueryJustification }),
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
  const queries = new Map<string, FindingRow[]>();
  for (const row of rows) {
    const queryRows = queries.get(row.membershipQuery) ?? [];
    queryRows.push(row);
    queries.set(row.membershipQuery, queryRows);
  }
  for (const [query, queryRows] of queries) {
    if (
      queryRows.length > 1 &&
      queryRows.some((row) => row.sharedQueryJustification === undefined)
    ) {
      throw new Error(
        `membership query ${query} is shared without sharedQueryJustification`,
      );
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

function keyIs(record: PackRecord, ...keys: string[]): boolean {
  return typeof record.key === 'string' && keys.includes(record.key);
}

function keyStartsWith(record: PackRecord, ...prefixes: string[]): boolean {
  const key = record.key;
  return (
    typeof key === 'string' && prefixes.some((prefix) => key.startsWith(prefix))
  );
}

function hasReadinessClause(
  record: PackRecord,
  readinessValue?: string,
): boolean {
  return clauses(record).some(
    (clause) =>
      readinessValue === undefined || clause.readiness === readinessValue,
  );
}

function findingMembership(
  query: MembershipQueryName,
  record: PackRecord,
): boolean {
  switch (query) {
    case 'finding:source-authority-opus-f19':
      return (
        keyStartsWith(record, 'feature:') &&
        String(record.key).endsWith(':spellcasting')
      );
    case 'finding:source-authority-opus-f20':
      return keyStartsWith(record, 'manifest:');
    case 'finding:source-authority-sol-cap-008':
      return keyIs(record, 'magic-item:bag-of-beans', 'table:bag-of-beans');
    case 'finding:source-authority-fable-f1':
      return keyIs(record, 'table:starting-wealth-by-class');
    case 'finding:source-authority-fable-f5':
      return keyStartsWith(record, 'table:');
    case 'finding:source-authority-fable-f7':
      return keyStartsWith(record, 'feature:', 'ancestry:');
    case 'finding:language-universe-policy':
      return keyStartsWith(
        record,
        'rule:languages',
        'table:standard-languages',
        'table:exotic-languages',
      );
    case 'finding:locator-completeness':
      return typeof record.provenance === 'object';
    case 'finding:ambiguous-coverage':
      return hasReadinessClause(record, 'ambiguous');
    case 'finding:rock-gnome-boundary':
      return keyIs(record, 'ancestry:rock-gnome');
    case 'finding:equipment-report':
      return keyStartsWith(record, 'equipment:');
    case 'finding:spellcasting-granularity':
      return (
        keyStartsWith(record, 'feature:') &&
        String(record.key).endsWith(':spellcasting')
      );
    case 'finding:vehicle-tool-row':
      return keyIs(
        record,
        'rule:mounts-and-vehicles',
        'equipment:block-and-tackle',
      );
    case 'finding:wererat-crossbow':
      return keyIs(record, 'creature:wererat', 'equipment:crossbow-hand');
    case 'finding:source-provenance-fields':
      return (
        typeof record.source === 'string' ||
        typeof record.provenance === 'object'
      );
    case 'finding:container-continuation':
      return keyStartsWith(record, 'table:', 'container:');
    case 'finding:advancement-qualifiers':
      return keyStartsWith(record, 'feature:');
    case 'finding:proficiency-grants':
      return keyStartsWith(record, 'ancestry:', 'background:', 'feature:');
    case 'finding:choice-identifiers':
      return keyStartsWith(record, 'feature:', 'ancestry:');
    case 'finding:madness-durations':
      return (
        keyStartsWith(record, 'table:') &&
        String(record.key).includes('madness')
      );
    case 'finding:damage-field-shape':
      return keyStartsWith(record, 'creature:', 'spell:', 'hazard:');
    case 'finding:equipment-taxonomy':
      return keyIs(
        record,
        'equipment:block-and-tackle',
        'rule:mounts-and-vehicles',
      );
    case 'finding:table-empty-cells':
      return keyStartsWith(record, 'table:');
    case 'finding:display-name-qualification':
      return keyStartsWith(record, 'rule:', 'feature:', 'spell:', 'creature:');
    case 'finding:canonical-discovery':
      return typeof record.key === 'string';
    case 'finding:rule-key-duplication':
      return keyStartsWith(record, 'rule:');
    case 'finding:clause-completeness':
      return hasReadinessClause(record);
    case 'finding:phantom-feature-resources':
      return keyStartsWith(record, 'feature:');
    case 'finding:damage-alternatives':
      return keyStartsWith(record, 'creature:', 'spell:');
    case 'finding:choice-behavior':
      return keyStartsWith(record, 'feature:', 'ancestry:', 'background:');
    case 'finding:pit-variants':
      return keyIs(record, 'hazard:pits');
    case 'finding:invocation-effects':
      return keyIs(record, 'feature:warlock:eldritch-invocations');
    case 'finding:bulette-alternative':
      return keyIs(record, 'creature:bulette');
    case 'finding:targeting-qualifiers':
      return keyStartsWith(record, 'creature:', 'spell:', 'hazard:');
    case 'finding:option-losses':
      return keyStartsWith(record, 'ancestry:', 'feature:');
    case 'finding:class-feature-completeness':
      return keyStartsWith(record, 'feature:');
    case 'finding:indomitable-scaling':
      return keyIs(record, 'feature:fighter:indomitable');
    case 'finding:arcane-recovery-reset':
      return keyIs(record, 'feature:wizard:arcane-recovery');
    case 'finding:natural-recovery-reset':
      return keyIs(record, 'feature:circle-of-the-land:natural-recovery');
    case 'finding:ki-abilities':
      return keyStartsWith(record, 'feature:monk:');
    case 'finding:divine-sense-uses':
      return keyIs(record, 'feature:paladin:divine-sense');
    case 'finding:condition-structure-no-regression':
      return (
        keyStartsWith(record, 'rule:', 'action:') && hasReadinessClause(record)
      );
    case 'finding:rules-prose-readiness':
      return (
        keyStartsWith(record, 'rule:') && hasReadinessClause(record, 'partial')
      );
    case 'finding:ancestry-omissions':
      return keyStartsWith(record, 'ancestry:');
    case 'finding:background-equipment':
      return keyStartsWith(record, 'background:', 'equipment:');
    case 'finding:hazard-and-healing-potion':
      return (
        keyStartsWith(record, 'hazard:') ||
        keyIs(record, 'equipment:potion-of-healing')
      );
    case 'finding:spell-completeness':
      return keyStartsWith(record, 'spell:');
    case 'finding:point-origin-areas':
      return keyIs(
        record,
        'spell:flaming-sphere',
        'spell:freezing-sphere',
        'spell:resilient-sphere',
      );
    case 'finding:magic-missile-projectiles':
      return keyIs(
        record,
        'spell:magic-missile',
        'magic-item:wand-of-magic-missiles',
      );
    case 'finding:spell-mechanics-depth':
      return keyStartsWith(record, 'spell:');
    case 'finding:animal-friendship-authority':
      return keyIs(
        record,
        'spell:animal-friendship',
        'magic-item:potion-of-animal-friendship',
      );
    case 'finding:creature-completeness':
      return keyStartsWith(record, 'creature:');
    case 'finding:half-damage-branches':
      return keyStartsWith(record, 'creature:', 'hazard:');
    case 'finding:legendary-economy':
      return keyStartsWith(record, 'creature:');
    case 'finding:druid-dryad-attacks':
      return keyIs(record, 'creature:druid', 'creature:dryad');
    case 'finding:unicode-minus-damage':
      return keyStartsWith(record, 'creature:');
    case 'finding:ranged-notation':
      return keyStartsWith(record, 'creature:');
    case 'finding:multi-save-entries':
      return keyStartsWith(record, 'creature:');
    case 'finding:creature-statblock-mechanics':
      return keyStartsWith(record, 'creature:');
    case 'finding:creature-ongoing-riders':
      return keyStartsWith(record, 'creature:');
    case 'finding:hazard-completeness':
      return keyStartsWith(record, 'hazard:');
    case 'finding:hazard-success-branches':
      return keyStartsWith(record, 'hazard:');
    case 'finding:sphere-prose':
      return keyIs(
        record,
        'hazard:sphere-of-annihilation',
        'magic-item:sphere-of-annihilation',
      );
    case 'finding:magic-item-effects':
      return record.kind === 'magic-item' && clauses(record).length > 0;
    case 'finding:readiness-integrity':
      return (
        hasReadinessClause(record, 'partial') ||
        hasReadinessClause(record, 'engine-pending')
      );
    case 'finding:engine-capability-ownership':
      return clauses(record).some(
        (clause) =>
          Array.isArray(clause.engineHooks) && clause.engineHooks.length > 0,
      );
    case 'finding:readiness-artifacts':
      return (
        hasReadinessClause(record, 'engine-pending') ||
        hasReadinessClause(record, 'unimplemented')
      );
  }
}

export function executeMembershipQuery(
  query: MembershipQueryName,
  records = getDefaultRecords(),
): unknown[] {
  if (!Array.isArray(records))
    throw new Error('rules pack records must be an array');
  return records.filter((record) => findingMembership(query, record));
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
  const parsed = parseRegistry(registry);
  for (const row of parsed.rows) executeMembershipQuery(row.membershipQuery);
}
