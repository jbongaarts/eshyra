import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export type FindingStatus =
  | 'accepted'
  | 'rejected'
  | 'narrowed'
  | 'ambiguous'
  | 'disclosed-dependency';

/**
 * Local descriptive vocabulary for how an audit fact was evidenced. This is
 * deliberately not an identity shared with Foundation 1's clause-IR
 * EvidenceKind union; it makes no cross-PR identity claim.
 */
export type EvidenceBasis =
  | 'audit-finding'
  | 'source-span'
  | 'code'
  | 'bead'
  | 'authoritative-input'
  | 'known-missing-source-clause';

export type FindingScopeKind =
  | 'record'
  | 'clause'
  | 'field'
  | 'path'
  | 'relationship'
  | 'capability';

export interface FindingProvenance {
  auditFinding: string;
  evidenceBasis: EvidenceBasis;
}

export interface FindingRow {
  canonicalId: string;
  aliases: string[];
  invariant: string;
  status: FindingStatus;
  statusReasoning?: string;
  provenance: FindingProvenance;
  /** Describes the audited thing; it is not a selector and confers no membership. */
  scopeKind: FindingScopeKind;
  owningBead: string;
}

export interface FindingRegistry {
  version: 2;
  explicitNonClaims: string[];
  rows: FindingRow[];
}

export const CANONICAL_FINDING_IDS = [
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

export const FINDING_ALIASES = [
  'fable:F1',
  'fable:F2',
  'fable:F3',
  'fable:F4',
  'fable:F5',
  'fable:F6',
  'fable:F7',
  'fable:F8',
  'indep:001',
  'indep:002',
  'indep:003',
  'indep:004',
  'indep:005',
  'indep:006',
  'indep:007',
  'indep:008',
  'indep:009',
  'indep:010',
  'indep:011',
  'indep:012',
  'opus:F-01',
  'opus:F-02',
  'opus:F-03',
  'opus:F-04',
  'opus:F-05',
  'opus:F-06',
  'opus:F-07',
  'opus:F-08',
  'opus:F-09',
  'opus:F-10',
  'opus:F-11',
  'opus:F-12',
  'opus:F-13',
  'opus:F-14',
  'opus:F-15',
  'opus:F-16',
  'opus:F-17',
  'opus:F-18',
  'opus:F-19',
  'opus:F-20',
  'opus:F-21',
  'opus:F-22',
  'opus:F-23',
  'opus:F-24',
  'opus:F-25',
  'opus:F-26',
  'opus:F-27',
  'opus:F-28',
  'opus:F-29',
  'opus:F-30',
  'opus:F-31',
  'opus:F-32',
  'opus:F-33',
  'opus:F-34',
  'opus:F-35',
  'opus:residual-unverified-effects-semantics',
  'sol:CAP-001',
  'sol:CAP-002',
  'sol:CAP-003',
  'sol:CAP-004',
  'sol:CAP-005',
  'sol:CAP-006',
  'sol:CAP-007',
  'sol:CAP-008',
  'sol:CAP-009',
  'sol:CAP-010',
  'sol:CAP-011',
  'sol:CAP-012',
  'sol:CAP-013',
  'sol:CAP-014',
] as const;

const ROW_KEYS = new Set([
  'canonicalId',
  'aliases',
  'invariant',
  'status',
  'statusReasoning',
  'provenance',
  'scopeKind',
  'owningBead',
]);
const PROVENANCE_KEYS = new Set(['auditFinding', 'evidenceBasis']);
const TOP_KEYS = new Set(['version', 'explicitNonClaims', 'rows']);
const FORBIDDEN_KEYS = new Set([
  'obligation',
  'target',
  'selector',
  'members',
  'baselineMembership',
  'membershipStatus',
  'membershipDerivation',
  'underivedReason',
  'owningDerivationBead',
  'violation',
  'regression',
  'capability',
  'capabilityId',
  'hookSelector',
  'queryId',
  'expectedAfterRepair',
  'dimensions',
  'closure',
]);
const STATUSES = new Set<FindingStatus>([
  'accepted',
  'rejected',
  'narrowed',
  'ambiguous',
  'disclosed-dependency',
]);
const EVIDENCE_BASES = new Set<EvidenceBasis>([
  'audit-finding',
  'source-span',
  'code',
  'bead',
  'authoritative-input',
  'known-missing-source-clause',
]);
const SCOPE_KINDS = new Set<FindingScopeKind>([
  'record',
  'clause',
  'field',
  'path',
  'relationship',
  'capability',
]);
const CANONICAL_SET = new Set<string>(CANONICAL_FINDING_IDS);
const ALIAS_SET = new Set<string>(FINDING_ALIASES);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function checkKeys(
  value: Record<string, unknown>,
  allowed: Set<string>,
  location: string,
): void {
  for (const key of Object.keys(value)) {
    if (FORBIDDEN_KEYS.has(key)) {
      throw new Error(
        `forbidden ${location} field "${key}"; executable membership belongs to Foundation 3 / Foundation 4`,
      );
    }
    if (!allowed.has(key))
      throw new Error(`unknown ${location} field "${key}"`);
  }
}

function exactSet(
  actual: Set<string>,
  expected: Set<string>,
  label: string,
): void {
  const missing = [...expected].filter((value) => !actual.has(value));
  const unexpected = [...actual].filter((value) => !expected.has(value));
  if (missing.length || unexpected.length) {
    throw new Error(
      `${label} set mismatch; missing: ${missing.join(', ') || 'none'}; unexpected: ${unexpected.join(', ') || 'none'}`,
    );
  }
}

export function validateFindingRegistry(value: unknown): FindingRegistry {
  if (!isRecord(value)) throw new Error('finding registry must be an object');
  checkKeys(value, TOP_KEYS, 'top-level');
  if (value.version !== 2)
    throw new Error('finding registry version must be exactly 2');
  if (
    !Array.isArray(value.explicitNonClaims) ||
    value.explicitNonClaims.length === 0 ||
    value.explicitNonClaims.some(
      (item) => typeof item !== 'string' || item.length === 0,
    )
  ) {
    throw new Error(
      'finding registry explicitNonClaims must be a non-empty array of non-empty strings',
    );
  }
  if (
    !Array.isArray(value.rows) ||
    value.rows.length === 0 ||
    value.rows.some((row) => !isRecord(row))
  ) {
    throw new Error(
      'finding registry rows must be a non-empty array of objects',
    );
  }
  const canonicalIds = new Set<string>();
  const aliases = new Set<string>();
  const rows: FindingRow[] = [];
  for (const [index, rawRow] of value.rows.entries()) {
    if (!isRecord(rawRow))
      throw new Error(`finding registry row ${index} must be an object`);
    checkKeys(rawRow, ROW_KEYS, `row ${index}`);
    const canonicalId = rawRow.canonicalId;
    if (
      typeof canonicalId !== 'string' ||
      canonicalId.length === 0 ||
      !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(canonicalId)
    )
      throw new Error(`row ${index} canonicalId is invalid`);
    if (canonicalIds.has(canonicalId))
      throw new Error(`duplicate canonicalId "${canonicalId}"`);
    canonicalIds.add(canonicalId);
    if (
      !Array.isArray(rawRow.aliases) ||
      rawRow.aliases.length === 0 ||
      rawRow.aliases.some(
        (alias) =>
          typeof alias !== 'string' ||
          !/^(opus|sol|fable|indep):[A-Za-z0-9-]+$/.test(alias),
      )
    )
      throw new Error(`row ${index} aliases are invalid`);
    const rowAliases = rawRow.aliases.map((alias) => alias as string);
    for (const alias of rowAliases) {
      if (aliases.has(alias))
        throw new Error(`duplicate alias "${alias}" across rows`);
      aliases.add(alias);
    }
    if (typeof rawRow.invariant !== 'string' || rawRow.invariant.length === 0)
      throw new Error(`row ${index} invariant must be a non-empty string`);
    if (
      typeof rawRow.status !== 'string' ||
      !STATUSES.has(rawRow.status as FindingStatus)
    )
      throw new Error(`row ${index} status is invalid`);
    const status = rawRow.status as FindingStatus;
    if (
      rawRow.statusReasoning !== undefined &&
      (typeof rawRow.statusReasoning !== 'string' ||
        rawRow.statusReasoning.length === 0)
    )
      throw new Error(
        `row ${index} statusReasoning must be non-empty when present`,
      );
    if (status !== 'accepted' && typeof rawRow.statusReasoning !== 'string')
      throw new Error(
        `row ${index} non-accepted status requires statusReasoning`,
      );
    if (!isRecord(rawRow.provenance))
      throw new Error(`row ${index} provenance must be an object`);
    checkKeys(rawRow.provenance, PROVENANCE_KEYS, `row ${index} provenance`);
    if (
      typeof rawRow.provenance.auditFinding !== 'string' ||
      !rowAliases.includes(rawRow.provenance.auditFinding)
    )
      throw new Error(
        `row ${index} provenance.auditFinding must be one of its aliases`,
      );
    if (
      typeof rawRow.provenance.evidenceBasis !== 'string' ||
      !EVIDENCE_BASES.has(rawRow.provenance.evidenceBasis as EvidenceBasis)
    )
      throw new Error(`row ${index} provenance.evidenceBasis is invalid`);
    if (
      typeof rawRow.scopeKind !== 'string' ||
      !SCOPE_KINDS.has(rawRow.scopeKind as FindingScopeKind)
    )
      throw new Error(`row ${index} scopeKind is invalid`);
    if (
      typeof rawRow.owningBead !== 'string' ||
      !/^eshyra-[A-Za-z0-9.]+$/.test(rawRow.owningBead)
    )
      throw new Error(`row ${index} owningBead is invalid`);
    rows.push({
      canonicalId,
      aliases: rowAliases,
      invariant: rawRow.invariant,
      status,
      ...(rawRow.statusReasoning === undefined
        ? {}
        : { statusReasoning: rawRow.statusReasoning }),
      provenance: {
        auditFinding: rawRow.provenance.auditFinding,
        evidenceBasis: rawRow.provenance.evidenceBasis as EvidenceBasis,
      },
      scopeKind: rawRow.scopeKind as FindingScopeKind,
      owningBead: rawRow.owningBead,
    });
  }
  exactSet(canonicalIds, CANONICAL_SET, 'canonicalId');
  exactSet(aliases, ALIAS_SET, 'alias');
  return {
    version: 2,
    explicitNonClaims: value.explicitNonClaims.map((item) => item as string),
    rows,
  };
}

const DEFAULT_REGISTRY_PATH = fileURLToPath(
  new URL(
    '../../../../docs/audits/dnd5e-srd-5.1-final/finding-registry.json',
    import.meta.url,
  ),
);

export function loadFindingRegistry(
  path = DEFAULT_REGISTRY_PATH,
): FindingRegistry {
  return validateFindingRegistry(
    JSON.parse(readFileSync(path, 'utf8')) as unknown,
  );
}

export function aliasIndex(
  registry = loadFindingRegistry(),
): Map<string, FindingRow> {
  return new Map(
    registry.rows.flatMap((row) =>
      row.aliases.map((alias) => [alias, row] as const),
    ),
  );
}

export function findingByAlias(
  alias: string,
  registry = loadFindingRegistry(),
): FindingRow | undefined {
  return aliasIndex(registry).get(alias);
}

export function findingByCanonicalId(
  id: string,
  registry = loadFindingRegistry(),
): FindingRow | undefined {
  return registry.rows.find((row) => row.canonicalId === id);
}
