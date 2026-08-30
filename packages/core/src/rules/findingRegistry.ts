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

export const CANONICAL_ROW_ROSTER: Readonly<Record<string, readonly string[]>> =
  {
    'source-authority-opus-f19': ['opus:F-19'],
    'source-authority-opus-f20': ['opus:F-20'],
    'source-authority-sol-cap-008': ['sol:CAP-008'],
    'source-authority-fable-f1': ['fable:F1'],
    'source-authority-fable-f5': ['fable:F5'],
    'source-authority-fable-f7': ['fable:F7'],
    'language-universe-policy': ['indep:011'],
    'locator-completeness': ['indep:008'],
    'ambiguous-coverage': ['indep:009'],
    'rock-gnome-boundary': ['indep:010', 'sol:CAP-012'],
    'equipment-report': ['indep:012'],
    'spellcasting-granularity': ['opus:F-15'],
    'vehicle-tool-row': ['opus:F-17'],
    'wererat-crossbow': ['opus:F-30'],
    'source-provenance-fields': ['sol:CAP-010'],
    'container-continuation': ['fable:F4'],
    'advancement-qualifiers': ['opus:F-10'],
    'proficiency-grants': ['opus:F-13'],
    'choice-identifiers': ['opus:F-14'],
    'madness-durations': ['opus:F-16'],
    'damage-field-shape': ['opus:F-34'],
    'equipment-taxonomy': ['sol:CAP-013'],
    'table-empty-cells': ['fable:F6'],
    'display-name-qualification': ['opus:F-22'],
    'canonical-discovery': ['sol:CAP-011'],
    'rule-key-duplication': ['fable:F8'],
    'audit-readiness-gate': ['indep:001'],
    'rule-corpus-procedures': ['sol:CAP-001'],
    'phantom-feature-resources': ['opus:F-06'],
    'damage-alternatives': ['opus:F-27'],
    'choice-behavior': ['indep:002'],
    'pit-variants': ['opus:F-02'],
    'invocation-effects': ['opus:F-07'],
    'bulette-alternative': ['opus:F-33'],
    'targeting-qualifiers': ['opus:F-35'],
    'option-losses': ['sol:CAP-005'],
    'class-feature-completeness': ['indep:003'],
    'indomitable-scaling': ['opus:F-03'],
    'arcane-recovery-reset': ['opus:F-04'],
    'natural-recovery-reset': ['opus:F-05'],
    'ki-abilities': ['opus:F-12'],
    'divine-sense-uses': ['opus:F-24'],
    'condition-structure-no-regression': ['sol:CAP-002'],
    'rules-prose-readiness': ['opus:F-09'],
    'ancestry-omissions': ['indep:004'],
    'background-equipment': ['opus:F-18'],
    'hazard-and-healing-potion': ['sol:CAP-006'],
    'spell-completeness': ['indep:005'],
    'point-origin-areas': ['opus:F-08', 'fable:F2'],
    'magic-missile-projectiles': ['opus:F-11'],
    'spell-mechanics-depth': ['sol:CAP-003'],
    'animal-friendship-authority': ['sol:CAP-009'],
    'creature-completeness': ['indep:006'],
    'half-damage-branches': ['opus:F-25'],
    'legendary-economy': ['opus:F-26'],
    'druid-dryad-attacks': ['opus:F-28'],
    'unicode-minus-damage': ['opus:F-29'],
    'ranged-notation': ['opus:F-31'],
    'multi-save-entries': ['opus:F-32'],
    'creature-statblock-mechanics': ['sol:CAP-004'],
    'creature-ongoing-riders': ['fable:F3'],
    'hazard-completeness': ['indep:007'],
    'hazard-success-branches': ['opus:F-01'],
    'sphere-prose': ['opus:F-23'],
    'magic-item-effects': ['opus:residual-unverified-effects-semantics'],
    'readiness-integrity': ['opus:F-21'],
    'engine-capability-ownership': ['sol:CAP-007'],
    'readiness-artifacts': ['sol:CAP-014'],
  };

export const CANONICAL_FINDING_IDS = Object.keys(CANONICAL_ROW_ROSTER);
export const FINDING_ALIASES = Object.values(CANONICAL_ROW_ROSTER)
  .flat()
  .sort();
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

function canonicalRosterBlockers(value: unknown): string[] {
  if (!isRecord(value) || !Array.isArray(value.rows)) return ['registry'];
  const expected = new Map(Object.entries(CANONICAL_ROW_ROSTER));
  const seen = new Map<string, number>();
  const blockers: string[] = [];
  for (const raw of value.rows) {
    if (!isRecord(raw) || typeof raw.canonicalId !== 'string') {
      blockers.push('malformed-row');
      continue;
    }
    const canonicalId = raw.canonicalId;
    const occurrence = (seen.get(canonicalId) ?? 0) + 1;
    seen.set(canonicalId, occurrence);
    if (occurrence > 1) blockers.push(`duplicate:${canonicalId}`);
    const expectedAliases = expected.get(canonicalId);
    if (expectedAliases === undefined) {
      blockers.push(`unexpected:${canonicalId}`);
      continue;
    }
    const actualAliases = Array.isArray(raw.aliases)
      ? raw.aliases.filter(
          (alias): alias is string => typeof alias === 'string',
        )
      : [];
    if (
      JSON.stringify([...actualAliases].sort()) !==
      JSON.stringify([...expectedAliases].sort())
    ) {
      blockers.push(`alias-roster:${canonicalId}`);
    }
  }
  for (const canonicalId of expected.keys()) {
    if (!seen.has(canonicalId)) blockers.push(`missing:${canonicalId}`);
  }
  return [...new Set(blockers)];
}

function assertCanonicalRowRoster(rows: FindingRow[]): void {
  const blockers = canonicalRosterBlockers({ rows });
  if (blockers.length > 0) {
    throw new Error(`canonicalId set mismatch; ${blockers.join(', ')}`);
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
  assertCanonicalRowRoster(rows);
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
