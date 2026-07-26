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
  zeroMemberPolicy?: string;
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
      ...(raw.zeroMemberPolicy === undefined
        ? {}
        : {
            zeroMemberPolicy: requiredString(
              raw.zeroMemberPolicy,
              `${path}.zeroMemberPolicy`,
            ),
          }),
    };
  });
  const aliases = new Map<string, string>();
  const canonicalIds = new Set<string>();
  for (const row of rows) {
    if (canonicalIds.has(row.canonicalId)) {
      throw new Error(`duplicate canonicalId: ${row.canonicalId}`);
    }
    canonicalIds.add(row.canonicalId);
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

export interface MembershipIdentity {
  recordKey: string;
  clauseId?: string;
  path?: string;
  sourceSpan?: string;
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

function sourceSpan(record: PackRecord): string | undefined {
  const provenance = record.provenance;
  if (isObject(provenance) && typeof provenance.locator === 'string') {
    return provenance.locator;
  }
  return typeof record.source === 'string' ? record.source : undefined;
}

function recordIdentity(record: PackRecord, path?: string): MembershipIdentity {
  if (typeof record.key !== 'string') throw new Error('pack record has no key');
  return {
    recordKey: record.key,
    ...(path === undefined ? {} : { path }),
    ...(sourceSpan(record) === undefined
      ? {}
      : { sourceSpan: sourceSpan(record) }),
  };
}

function exactRecords(
  records: PackRecord[],
  keys: readonly string[],
): PackRecord[] {
  const wanted = new Set(keys);
  return records.filter(
    (record) => typeof record.key === 'string' && wanted.has(record.key),
  );
}

function recordsWithPrefix(
  records: PackRecord[],
  prefixes: readonly string[],
): MembershipIdentity[] {
  return records
    .filter(
      (record) =>
        typeof record.key === 'string' &&
        prefixes.some((prefix) => (record.key as string).startsWith(prefix)),
    )
    .map((record) => recordIdentity(record));
}

function exactRecordIdentities(
  records: PackRecord[],
  keys: readonly string[],
): MembershipIdentity[] {
  return exactRecords(records, keys).map((record) => recordIdentity(record));
}

function clauseIdentities(
  records: PackRecord[],
  predicate: (record: PackRecord, clause: Obj) => boolean,
): MembershipIdentity[] {
  const result: MembershipIdentity[] = [];
  for (const record of records) {
    for (const clause of clauses(record)) {
      if (predicate(record, clause) && typeof clause.clauseId === 'string') {
        result.push({
          ...recordIdentity(record),
          clauseId: clause.clauseId,
        });
      }
    }
  }
  return result;
}

function walkPaths(
  value: unknown,
  path: string,
  visit: (value: unknown, path: string) => boolean,
  result: string[],
): void {
  if (visit(value, path)) result.push(path);
  if (Array.isArray(value)) {
    value.forEach((child, index) => {
      walkPaths(child, `${path}[${index}]`, visit, result);
    });
  } else if (isObject(value)) {
    for (const [key, child] of Object.entries(value)) {
      walkPaths(child, `${path}.${key}`, visit, result);
    }
  }
}

function pathIdentities(
  records: PackRecord[],
  keys: readonly string[],
  visit: (value: unknown, path: string) => boolean,
): MembershipIdentity[] {
  const result: MembershipIdentity[] = [];
  for (const record of exactRecords(records, keys)) {
    const paths: string[] = [];
    walkPaths(recordData(record), 'data', visit, paths);
    for (const path of paths) result.push(recordIdentity(record, path));
  }
  return result;
}

const spellcastingKeys = [
  'feature:bard:spellcasting',
  'feature:cleric:spellcasting',
  'feature:druid:spellcasting',
  'feature:paladin:spellcasting',
  'feature:ranger:spellcasting',
  'feature:sorcerer:spellcasting',
  'feature:wizard:spellcasting',
] as const;

const creatureKeys = [
  'creature:druid',
  'creature:dryad',
  'creature:bulette',
  'creature:wererat',
] as const;

function textPathIdentities(
  records: PackRecord[],
  keys: readonly string[],
  pattern: RegExp,
): MembershipIdentity[] {
  return pathIdentities(
    records,
    keys,
    (value) => typeof value === 'string' && pattern.test(value),
  );
}

function findingMembership(
  query: MembershipQueryName,
  records: PackRecord[],
): MembershipIdentity[] {
  switch (query) {
    case 'finding:source-authority-opus-f19':
      return textPathIdentities(
        records,
        spellcastingKeys,
        /spell|prepared|cantrip/i,
      );
    case 'finding:source-authority-opus-f20':
      return [];
    case 'finding:source-authority-sol-cap-008':
      return clauseIdentities(
        records,
        (record) => record.key === 'magic-item:bag-of-beans',
      );
    case 'finding:source-authority-fable-f1':
      return exactRecordIdentities(records, ['table:starting-wealth-by-class']);
    case 'finding:source-authority-fable-f5':
      return recordsWithPrefix(records, ['table:']);
    case 'finding:source-authority-fable-f7':
      return pathIdentities(
        records,
        ['feature:warlock:eldritch-invocations'],
        (_value, path) =>
          path.endsWith('.choices') || path.includes('.choices['),
      );
    case 'finding:language-universe-policy':
      return exactRecordIdentities(records, [
        'rule:languages',
        'table:standard-languages',
        'table:exotic-languages',
      ]);
    case 'finding:locator-completeness':
      return records
        .filter((record) => sourceSpan(record) !== undefined)
        .map((record) => recordIdentity(record));
    case 'finding:ambiguous-coverage':
      return clauseIdentities(
        records,
        (_record, clause) => clause.readiness !== 'green',
      );
    case 'finding:rock-gnome-boundary':
      return pathIdentities(
        records,
        ['ancestry:rock-gnome'],
        (_value, path) =>
          path.includes('.traits') || path.includes('.languages'),
      );
    case 'finding:equipment-report':
      return recordsWithPrefix(records, ['equipment:']);
    case 'finding:spellcasting-granularity':
      return exactRecordIdentities(records, spellcastingKeys);
    case 'finding:vehicle-tool-row':
      return exactRecordIdentities(records, [
        'rule:mounts-and-vehicles',
        'equipment:block-and-tackle',
      ]);
    case 'finding:wererat-crossbow':
      return [
        ...textPathIdentities(records, ['creature:wererat'], /hand crossbow/i),
        ...exactRecordIdentities(records, ['equipment:crossbow-hand']),
      ];
    case 'finding:source-provenance-fields':
      return records
        .filter((record) => sourceSpan(record) !== undefined)
        .map((record) => recordIdentity(record));
    case 'finding:container-continuation':
      return recordsWithPrefix(records, ['table:']);
    case 'finding:advancement-qualifiers':
      return pathIdentities(
        records,
        ['feature:barbarian:brutal-critical', 'feature:fighter:indomitable'],
        (_value, path) => path.includes('mechanics'),
      );
    case 'finding:proficiency-grants':
      return exactRecordIdentities(records, [
        'ancestry:rock-gnome',
        'background:acolyte',
      ]);
    case 'finding:choice-identifiers':
      return pathIdentities(
        records,
        ['feature:warlock:eldritch-invocations'],
        (_value, path) => path.includes('choices'),
      );
    case 'finding:madness-durations':
      return exactRecordIdentities(records, [
        'table:short-term-madness',
        'table:long-term-madness',
        'table:indefinite-madness',
      ]);
    case 'finding:damage-field-shape':
      return pathIdentities(records, creatureKeys, (_value, path) =>
        path.includes('damage'),
      );
    case 'finding:equipment-taxonomy':
      return exactRecordIdentities(records, [
        'equipment:block-and-tackle',
        'rule:mounts-and-vehicles',
      ]);
    case 'finding:table-empty-cells':
      return recordsWithPrefix(records, ['table:']);
    case 'finding:display-name-qualification':
      return exactRecordIdentities(records, [
        'rule:languages',
        'spell:magic-missile',
        'creature:wererat',
      ]);
    case 'finding:canonical-discovery':
      return records
        .filter((record) => typeof record.key === 'string')
        .map((record) => recordIdentity(record));
    case 'finding:rule-key-duplication':
      return recordsWithPrefix(records, ['rule:']);
    case 'finding:audit-readiness-gate':
      return clauseIdentities(
        records,
        (_record, clause) => clause.readiness !== 'green',
      );
    case 'finding:rule-corpus-procedures':
      return recordsWithPrefix(records, ['rule:']);
    case 'finding:phantom-feature-resources':
      return pathIdentities(
        records,
        ['feature:fighter:indomitable', 'feature:wizard:arcane-recovery'],
        (_value, path) => path.includes('mechanics'),
      );
    case 'finding:damage-alternatives':
      return textPathIdentities(
        records,
        creatureKeys,
        /or|alternative|choice/i,
      );
    case 'finding:choice-behavior':
      return pathIdentities(
        records,
        ['feature:warlock:eldritch-invocations', 'ancestry:rock-gnome'],
        (_value, path) => path.includes('choices') || path.includes('traits'),
      );
    case 'finding:pit-variants':
      return pathIdentities(
        records,
        ['hazard:pits'],
        (_value, path) =>
          path.includes('mechanics') || path.includes('description'),
      );
    case 'finding:invocation-effects':
      return pathIdentities(
        records,
        ['feature:warlock:eldritch-invocations'],
        (_value, path) =>
          path.includes('choices') || path.includes('mechanics'),
      );
    case 'finding:bulette-alternative':
      return textPathIdentities(
        records,
        ['creature:bulette'],
        /choice|half|DC 16|Deadly Leap/i,
      );
    case 'finding:targeting-qualifiers':
      return textPathIdentities(
        records,
        creatureKeys,
        /target|range|reach|save/i,
      );
    case 'finding:option-losses':
      return pathIdentities(
        records,
        ['feature:warlock:eldritch-invocations', 'ancestry:rock-gnome'],
        (_value, path) => path.includes('choices') || path.includes('traits'),
      );
    case 'finding:class-feature-completeness':
      return recordsWithPrefix(records, ['feature:']);
    case 'finding:indomitable-scaling':
      return exactRecordIdentities(records, ['feature:fighter:indomitable']);
    case 'finding:arcane-recovery-reset':
      return exactRecordIdentities(records, ['feature:wizard:arcane-recovery']);
    case 'finding:natural-recovery-reset':
      return exactRecordIdentities(records, [
        'feature:circle-of-the-land:natural-recovery',
      ]);
    case 'finding:ki-abilities':
      return exactRecordIdentities(records, [
        'feature:monk:ki',
        'feature:monk:ki-empowered-strikes',
      ]);
    case 'finding:divine-sense-uses':
      return exactRecordIdentities(records, ['feature:paladin:divine-sense']);
    case 'finding:condition-structure-no-regression':
      return clauseIdentities(
        records,
        (_record, clause) =>
          clause.readiness === 'green' || clause.readiness === 'partial',
      );
    case 'finding:rules-prose-readiness':
      return clauseIdentities(
        records,
        (_record, clause) => clause.readiness !== 'green',
      );
    case 'finding:ancestry-omissions':
      return recordsWithPrefix(records, ['ancestry:']);
    case 'finding:background-equipment':
      return exactRecordIdentities(records, [
        'background:acolyte',
        'equipment:backpack',
      ]);
    case 'finding:hazard-and-healing-potion':
      return [
        ...recordsWithPrefix(records, ['hazard:']),
        ...exactRecordIdentities(records, ['equipment:potion-of-healing']),
      ];
    case 'finding:spell-completeness':
      return recordsWithPrefix(records, ['spell:']);
    case 'finding:point-origin-areas':
      return exactRecordIdentities(records, [
        'spell:flaming-sphere',
        'spell:freezing-sphere',
        'spell:resilient-sphere',
      ]);
    case 'finding:magic-missile-projectiles':
      return exactRecordIdentities(records, [
        'spell:magic-missile',
        'magic-item:wand-of-magic-missiles',
      ]);
    case 'finding:spell-mechanics-depth':
      return recordsWithPrefix(records, ['spell:']);
    case 'finding:animal-friendship-authority':
      return exactRecordIdentities(records, [
        'spell:animal-friendship',
        'magic-item:potion-of-animal-friendship',
      ]);
    case 'finding:creature-completeness':
      return recordsWithPrefix(records, ['creature:']);
    case 'finding:half-damage-branches':
      return textPathIdentities(
        records,
        [...creatureKeys, 'hazard:pits'],
        /half damage|half the damage|successful save/i,
      );
    case 'finding:legendary-economy':
      return textPathIdentities(
        records,
        ['creature:adult-black-dragon', 'creature:lich'],
        /legendary action|legendary resistance/i,
      );
    case 'finding:druid-dryad-attacks':
      return textPathIdentities(
        records,
        ['creature:druid', 'creature:dryad'],
        /Attack|damage|spell/i,
      );
    case 'finding:unicode-minus-damage':
      return textPathIdentities(records, [...creatureKeys], /damage|−|-/);
    case 'finding:ranged-notation':
      return textPathIdentities(
        records,
        ['creature:wererat', 'creature:druid'],
        /range [0-9]|Ranged Weapon Attack/i,
      );
    case 'finding:multi-save-entries':
      return textPathIdentities(
        records,
        [...creatureKeys],
        /saving throw|save/i,
      );
    case 'finding:creature-statblock-mechanics':
      return pathIdentities(
        records,
        ['creature:bulette', 'creature:wererat', 'creature:druid'],
        (_value, path) => path.includes('mechanics'),
      );
    case 'finding:creature-ongoing-riders':
      return textPathIdentities(
        records,
        ['creature:wererat', 'creature:bulette'],
        /cursed|condition|reverts|until/i,
      );
    case 'finding:hazard-completeness':
      return recordsWithPrefix(records, ['hazard:']);
    case 'finding:hazard-success-branches':
      return textPathIdentities(
        records,
        ['hazard:pits', 'hazard:sphere-of-annihilation'],
        /save|success|half|damage/i,
      );
    case 'finding:sphere-prose':
      return exactRecordIdentities(records, [
        'hazard:sphere-of-annihilation',
        'magic-item:sphere-of-annihilation',
      ]);
    case 'finding:magic-item-effects':
      return clauseIdentities(
        records,
        (record, clause) =>
          record.kind === 'magic-item' && clause.readiness !== 'green',
      );
    case 'finding:readiness-integrity':
      return clauseIdentities(
        records,
        (_record, clause) =>
          clause.readiness === 'partial' ||
          clause.readiness === 'engine-pending',
      );
    case 'finding:engine-capability-ownership':
      return clauseIdentities(
        records,
        (_record, clause) =>
          Array.isArray(clause.engineHooks) && clause.engineHooks.length > 0,
      );
    case 'finding:readiness-artifacts':
      return clauseIdentities(
        records,
        (_record, clause) =>
          clause.readiness === 'engine-pending' ||
          clause.readiness === 'unimplemented',
      );
  }
}

export function executeMembershipQuery(
  query: MembershipQueryName,
  records = getDefaultRecords(),
): MembershipIdentity[] {
  if (!Array.isArray(records))
    throw new Error('rules pack records must be an array');
  return findingMembership(query, records);
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
      timeout: 15000,
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
  for (const row of parsed.rows) {
    const members = executeMembershipQuery(row.membershipQuery);
    if (members.length === 0 && row.zeroMemberPolicy === undefined) {
      throw new Error(
        `${row.canonicalId} has no membership identities; add a source-grounded member or an explicit zeroMemberPolicy`,
      );
    }
    for (const member of members) {
      if (
        member.recordKey.length === 0 ||
        (member.clauseId === undefined &&
          member.path === undefined &&
          member.sourceSpan === undefined)
      ) {
        throw new Error(
          `${row.canonicalId} returned an identity without a stable record or nested path`,
        );
      }
    }
  }
}
