import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export const BOOTSTRAP_LEDGER_STATUS = 'NON-AUTHORITATIVE' as const;
export const BOOTSTRAP_LEDGER_PATH = fileURLToPath(
  new URL(
    '../../../../docs/audits/dnd5e-srd-5.1-final/bootstrap-capability-ledger.json',
    import.meta.url,
  ),
);

export type OwnershipStatus = 'owned' | 'proposed-new-bead' | 'disputed';
export type ObligationKind =
  | 'source-span'
  | 'authoritative-input'
  | 'audit-finding'
  | 'code'
  | 'bead'
  | 'known-missing-source-clause';
export type EvidenceExpected =
  | 'non-empty'
  | 'absent-from-pack'
  | 'exists'
  | 'known';

export interface ObligationIdentity {
  readonly obligationId: string;
  readonly obligationKind: ObligationKind;
}

export interface HookSelector {
  readonly engine: string;
  readonly name: string;
}

export interface ReadinessArtifactEvidence extends ObligationIdentity {
  readonly kind: 'readiness-artifact';
  readonly queryId: string;
  readonly engine: string;
  readonly hookSelector: HookSelector;
  readonly expected: 'non-empty' | 'absent-from-pack';
}

export interface CodeEvidence extends ObligationIdentity {
  readonly kind: 'code';
  readonly module: string;
  readonly symbol: string;
  readonly expected: 'exists';
}

export interface BeadEvidence extends ObligationIdentity {
  readonly kind: 'bead';
  readonly beadId: string;
  readonly expected: 'exists';
}

export interface AuditFindingEvidence extends ObligationIdentity {
  readonly kind: 'audit-finding';
  readonly findingAlias: string;
  readonly expected: 'known';
}

export interface KnownMissingSourceClauseEvidence extends ObligationIdentity {
  readonly kind: 'known-missing-source-clause';
  readonly sourceRef: string;
  readonly locator: string;
  readonly expected: 'absent-from-pack';
}

export type BootstrapEvidence =
  | ReadinessArtifactEvidence
  | CodeEvidence
  | BeadEvidence
  | AuditFindingEvidence
  | KnownMissingSourceClauseEvidence;

export interface ReadinessArtifactMatch {
  readonly recordKey: string;
  readonly clauseId: string;
  readonly path: string;
  readonly sourceSpan: {
    readonly source: string;
    readonly locator: string;
  };
  readonly hook: HookSelector;
}

export interface EvidenceResolution {
  readonly evidence: BootstrapEvidence;
  readonly status: 'satisfied' | 'skipped';
  readonly matches?: readonly ReadinessArtifactMatch[];
  readonly scannedRecords?: number;
  readonly scannedClauses?: number;
  readonly reason?: string;
}

export interface BootstrapCapabilityRow {
  readonly capabilityId: string;
  readonly primitive: string;
  readonly requirement: string;
  readonly discoveredBy: readonly string[];
  readonly evidence: readonly BootstrapEvidence[];
  readonly ownershipStatus: OwnershipStatus;
  readonly owningBead?: string | null;
  readonly proposedTitle?: string;
  readonly proposedParent?: string;
  readonly notes: string;
}

export interface BootstrapCapabilityLedger {
  readonly status: typeof BOOTSTRAP_LEDGER_STATUS;
  readonly authoritativeLedger: string;
  readonly snapshotCommit: string;
  readonly sources: readonly string[];
  readonly rows: readonly BootstrapCapabilityRow[];
}

const ENGINE_EPIC = 'eshyra-olc5';
const ENGINE_CAPABILITY_ID = /^engine:F(?:[1-9]|10)$/;
const BEAD_ID = /^eshyra-[a-z0-9]+(?:\.[a-z0-9]+)*$/;
const OBLIGATION_ID = /^obl:::[a-z0-9][a-z0-9:._/-]*$/;
const FINDING_ALIAS =
  /^(?:engine:F(?:[1-9]|10)|fable:F[1-8]|opus:F-(?:0[1-9]|[12][0-9]|3[0-5])|sol:CAP-(?:00[1-9]|0[1-9][0-9]|1[0-4])|indep:(?:00[1-9]|01[0-2]))$/;
const STORED_COUNT_FIELD =
  /^(?:count|counts|total|recordCount|clauseCount|storedCount|hookTotal|.*Count|.*Total)$/;
const SOURCE_NAMES = new Set([
  'readiness-artifacts',
  'current-code',
  'current-beads',
  'audit-2026-07-24',
  'missing-source-clause',
]);
const beadExistence = new Map<string, boolean>();

export const NON_PACK_DISCOVERY_PRIMITIVES = [
  'legendary-action-allowance-and-option-cost',
  'owned-entity-and-repeat-trigger-lifecycle',
  'containment-portal-and-card-pool-instance-state',
  'suffocation-and-ongoing-damage-state',
  'planar-return-and-declared-window-clocks',
  'point-origin-area-geometry-and-targeting',
  'damage-rider-and-half-damage-branch-resolution',
] as const;

interface ReadinessQuerySpec {
  readonly queryId: string;
  readonly engine: string;
  readonly primitive: string;
  readonly hookSelector: HookSelector;
}

function query(
  engine: string,
  primitive: string,
  name: string,
): ReadinessQuerySpec {
  return {
    queryId: `bootstrap:${engine}:${primitive}`,
    engine,
    primitive,
    hookSelector: { engine: engine.slice('engine:'.length), name },
  };
}

const READINESS_QUERY_SPECS = [
  query(
    'engine:F1',
    'condition-and-eligibility-relations',
    'condition and eligibility relations',
  ),
  query(
    'engine:F1',
    'seeded-selection-and-roll-replacement',
    'seeded dice, percentage, table, and pool selection',
  ),
  query(
    'engine:F2',
    'turn-action-and-free-interaction-budget',
    'activation action economy',
  ),
  query(
    'engine:F2',
    'reaction-and-item-activation-ownership',
    'reaction and action economy',
  ),
  query(
    'engine:F2',
    'legendary-action-allowance-and-option-cost',
    'legendary action allowance and option cost',
  ),
  query(
    'engine:F3',
    'concentration-owner-and-damage-save',
    'concentration lifecycle',
  ),
  query(
    'engine:F3',
    'active-effect-duration-and-termination',
    'active effect duration and termination',
  ),
  query(
    'engine:F3',
    'owned-entity-and-repeat-trigger-lifecycle',
    'encounter combatant, persistent actor, and owned-entity lifecycle',
  ),
  query(
    'engine:F4',
    'caster-of-record-and-canonical-spell-execution',
    'canonical spell execution',
  ),
  query(
    'engine:F4',
    'spell-slot-gate-and-upcast-transform',
    'shared spell-slot, spell-casting, and caster-of-record execution',
  ),
  query(
    'engine:F4',
    'spellbook-copy-cost-and-asset-ledger',
    'wizard spellbook copying procedure',
  ),
  query(
    'engine:F5',
    'per-instance-usage-and-charge-spend',
    'per-item storage, charge, and reset state',
  ),
  query(
    'engine:F5',
    'recharge-and-reset-scheduling',
    'magic-item-usage-recharge',
  ),
  query(
    'engine:F5',
    'attunement-curse-and-identity-constraints',
    'attunement, curse, and item-instance state constraints',
  ),
  query(
    'engine:F5',
    'containment-portal-and-card-pool-instance-state',
    'per-instance containment occupancy and portal-state ownership',
  ),
  query(
    'engine:F6',
    'hp-healing-and-temporary-buffer',
    'hit points and condition lifecycle',
  ),
  query(
    'engine:F6',
    'death-save-dying-and-stable-transitions',
    'hit-point and condition mutation',
  ),
  query(
    'engine:F6',
    'suffocation-and-ongoing-damage-state',
    'suffocation and condition lifecycle',
  ),
  query(
    'engine:F7',
    'short-rest-hit-dice-recovery',
    'short-rest hit-dice recovery',
  ),
  query('engine:F7', 'long-rest-reset-orchestration', 'long-rest reset'),
  query(
    'engine:F7',
    'planar-return-and-declared-window-clocks',
    'planar-return and declared-window clocks',
  ),
  query(
    'engine:F8',
    'save-dc-and-spell-attack-modifier-resolution',
    'save DC and spell attack resolution',
  ),
  query(
    'engine:F8',
    'multi-save-and-ability-choice-outcomes',
    'multi-save and ability-choice outcomes',
  ),
  query(
    'engine:F8',
    'derived-attack-ac-and-proficiency-modifiers',
    'attack and damage modifier application',
  ),
  query(
    'engine:F9',
    'point-origin-area-geometry-and-targeting',
    'geometry, targeting, movement, and contest resolution',
  ),
  query(
    'engine:F9',
    'damage-rider-and-half-damage-branch-resolution',
    'damage resistance, vulnerability, and rider math',
  ),
  query(
    'engine:F9',
    'forced-movement-contest-and-object-interaction',
    'deterministic checks, forced movement, and interaction resolution',
  ),
  query(
    'engine:F9',
    'capacity-and-variant-arithmetic',
    'variant targeting, movement, and capacity arithmetic',
  ),
  query(
    'engine:F10',
    'canonical-currency-mutation',
    'currency, property, inventory, and XP ledger outcomes',
  ),
  query(
    'engine:F10',
    'downtime-study-expense-and-training-ledger',
    'downtime study window',
  ),
  query(
    'engine:F10',
    'retained-inventory-property-xp-asset-creation',
    'canonical asset creation when retained',
  ),
] as const;
const querySpecsById = new Map(
  READINESS_QUERY_SPECS.map((spec) => [spec.queryId, spec]),
);

const KNOWN_AUDIT_FINDINGS = new Set<string>([
  ...Array.from({ length: 8 }, (_, i) => `fable:F${i + 1}`),
  ...Array.from(
    { length: 35 },
    (_, i) => `opus:F-${String(i + 1).padStart(2, '0')}`,
  ),
  ...Array.from(
    { length: 14 },
    (_, i) => `sol:CAP-${String(i + 1).padStart(3, '0')}`,
  ),
  ...Array.from(
    { length: 12 },
    (_, i) => `indep:${String(i + 1).padStart(3, '0')}`,
  ),
]);

function fail(message: string): never {
  throw new Error(`invalid bootstrap capability ledger: ${message}`);
}

function requiredString(
  value: unknown,
  field: string,
): asserts value is string {
  if (typeof value !== 'string' || value.trim() === '')
    fail(`${field} must be a non-empty string`);
}

function requiredStringArray(
  value: unknown,
  field: string,
): asserts value is readonly string[] {
  if (
    !Array.isArray(value) ||
    value.length === 0 ||
    value.some((item) => typeof item !== 'string')
  )
    fail(`${field} must be a non-empty string array`);
}

function objectRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function rejectStoredCountFields(value: unknown, path: string): void {
  if (Array.isArray(value)) {
    value.forEach((item, index) => {
      rejectStoredCountFields(item, `${path}[${index}]`);
    });
    return;
  }
  if (typeof value !== 'object' || value === null) return;
  for (const [key, child] of Object.entries(value)) {
    if (STORED_COUNT_FIELD.test(key))
      fail(`${path}.${key} stores a copied count; use a query instead`);
    rejectStoredCountFields(child, `${path}.${key}`);
  }
}

function validateIdentity(
  value: Record<string, unknown>,
  field: string,
  kind: ObligationKind,
): void {
  requiredString(value.obligationId, `${field}.obligationId`);
  if (!OBLIGATION_ID.test(value.obligationId))
    fail(`${field}.obligationId is malformed`);
  if (value.obligationKind !== kind)
    fail(`${field}.obligationKind must be ${kind}`);
}

function validateReadinessEvidence(
  value: Record<string, unknown>,
  field: string,
): ReadinessArtifactEvidence {
  validateIdentity(value, field, 'source-span');
  requiredString(value.queryId, `${field}.queryId`);
  requiredString(value.engine, `${field}.engine`);
  if (!['non-empty', 'absent-from-pack'].includes(value.expected as string))
    fail(`${field}.expected is invalid`);
  const selector = objectRecord(value.hookSelector);
  if (!selector) fail(`${field}.hookSelector must be an object`);
  requiredString(selector.engine, `${field}.hookSelector.engine`);
  requiredString(selector.name, `${field}.hookSelector.name`);
  const spec = querySpecsById.get(value.queryId);
  if (!spec) fail(`${field}.queryId is not registered`);
  if (
    value.engine !== spec.engine ||
    selector.engine !== spec.hookSelector.engine ||
    selector.name !== spec.hookSelector.name
  )
    fail(`${field}.queryId has a mismatched exact hook identity`);
  return value as unknown as ReadinessArtifactEvidence;
}

function validateEvidence(value: unknown, field: string): BootstrapEvidence {
  const evidence = objectRecord(value);
  if (!evidence) fail(`${field} must be an evidence object`);
  switch (evidence.kind) {
    case 'readiness-artifact':
      return validateReadinessEvidence(evidence, field);
    case 'code':
      validateIdentity(evidence, field, 'code');
      requiredString(evidence.module, `${field}.module`);
      requiredString(evidence.symbol, `${field}.symbol`);
      if (evidence.expected !== 'exists')
        fail(`${field}.expected must be exists`);
      if (evidence.module.includes('..') || evidence.module.startsWith('/'))
        fail(`${field}.module must be @eshyra/core-relative`);
      return evidence as unknown as CodeEvidence;
    case 'bead':
      validateIdentity(evidence, field, 'bead');
      requiredString(evidence.beadId, `${field}.beadId`);
      if (!BEAD_ID.test(evidence.beadId)) fail(`${field}.beadId is invalid`);
      if (evidence.expected !== 'exists')
        fail(`${field}.expected must be exists`);
      return evidence as unknown as BeadEvidence;
    case 'audit-finding':
      validateIdentity(evidence, field, 'audit-finding');
      requiredString(evidence.findingAlias, `${field}.findingAlias`);
      if (
        !FINDING_ALIAS.test(evidence.findingAlias) ||
        !KNOWN_AUDIT_FINDINGS.has(evidence.findingAlias)
      )
        fail(`${field}.findingAlias is not a known fully qualified finding`);
      if (evidence.expected !== 'known')
        fail(`${field}.expected must be known`);
      return evidence as unknown as AuditFindingEvidence;
    case 'known-missing-source-clause':
      validateIdentity(evidence, field, 'known-missing-source-clause');
      requiredString(evidence.sourceRef, `${field}.sourceRef`);
      requiredString(evidence.locator, `${field}.locator`);
      if (evidence.expected !== 'absent-from-pack')
        fail(`${field}.expected must be absent-from-pack`);
      return evidence as unknown as KnownMissingSourceClauseEvidence;
    default:
      fail(`${field}.kind is not a supported evidence kind`);
  }
}

function validateRow(value: unknown, index: number): BootstrapCapabilityRow {
  const row = objectRecord(value);
  if (!row) fail(`rows[${index}] must be an object`);
  for (const field of [
    'capabilityId',
    'primitive',
    'requirement',
    'ownershipStatus',
    'notes',
  ])
    requiredString(row[field], `rows[${index}].${field}`);
  if (!ENGINE_CAPABILITY_ID.test(row.capabilityId as string))
    fail(`rows[${index}].capabilityId must use engine:F1..engine:F10`);
  if (row.primitive === row.capabilityId)
    fail(`rows[${index}].primitive must identify a specific primitive`);
  if (row.packEvidence !== undefined)
    fail(`rows[${index}] uses the retired overloaded packEvidence field`);
  requiredStringArray(row.discoveredBy, `rows[${index}].discoveredBy`);
  if (
    !(row.discoveredBy as readonly string[]).every((source) =>
      SOURCE_NAMES.has(source),
    )
  )
    fail(`rows[${index}].discoveredBy contains an unknown source`);
  if (
    !['owned', 'proposed-new-bead', 'disputed'].includes(
      row.ownershipStatus as string,
    )
  )
    fail(`rows[${index}].ownershipStatus is invalid`);
  if (!Array.isArray(row.evidence) || row.evidence.length === 0)
    fail(`rows[${index}].evidence must be non-empty`);
  const evidence = row.evidence.map((item, itemIndex) =>
    validateEvidence(item, `rows[${index}].evidence[${itemIndex}]`),
  );
  const evidenceKinds = new Set(evidence.map((item) => item.kind));
  const sourceEvidence: Readonly<Record<string, string>> = {
    'readiness-artifacts': 'readiness-artifact',
    'current-code': 'code',
    'current-beads': 'bead',
    'audit-2026-07-24': 'audit-finding',
    'missing-source-clause': 'known-missing-source-clause',
  };
  for (const source of row.discoveredBy as readonly string[]) {
    const kind = sourceEvidence[source];
    if (!evidenceKinds.has(kind as BootstrapEvidence['kind']))
      fail(`rows[${index}] is missing executable evidence for ${source}`);
  }
  const obligationIds = new Set<string>();
  for (const item of evidence) {
    if (!item.obligationId.startsWith(`obl:::${row.primitive}:`))
      fail(`rows[${index}] evidence cannot be traced to its primitive`);
    if (obligationIds.has(item.obligationId))
      fail(
        `rows[${index}] duplicates obligation identity ${item.obligationId}`,
      );
    obligationIds.add(item.obligationId);
  }
  const readiness = evidence.filter(
    (item): item is ReadinessArtifactEvidence =>
      item.kind === 'readiness-artifact',
  );
  for (const item of readiness) {
    if (item.engine !== row.capabilityId)
      fail(
        `rows[${index}] readiness evidence targets ${item.engine}, not ${row.capabilityId}`,
      );
    const spec = querySpecsById.get(item.queryId);
    if (!spec || spec.primitive !== row.primitive)
      fail(`rows[${index}] queryId is not owned by this primitive`);
  }
  if (row.ownershipStatus === 'proposed-new-bead') {
    if (
      row.owningBead !== undefined &&
      row.owningBead !== null &&
      !BEAD_ID.test(row.owningBead as string)
    )
      fail(`rows[${index}].owningBead is not a bead ID or null`);
    if (
      typeof row.proposedTitle !== 'string' ||
      row.proposedTitle.trim() === '' ||
      typeof row.proposedParent !== 'string' ||
      !BEAD_ID.test(row.proposedParent) ||
      !/proposed title|parent/i.test(row.notes as string)
    )
      fail(`rows[${index}] proposed ownership must name its title and parent`);
  } else if (
    typeof row.owningBead !== 'string' ||
    !BEAD_ID.test(row.owningBead)
  ) {
    fail(`rows[${index}].owningBead must be a bead ID`);
  }
  return { ...row, evidence } as unknown as BootstrapCapabilityRow;
}

export function evaluateReadinessArtifact(
  evidence: ReadinessArtifactEvidence,
  records: readonly unknown[],
): readonly ReadinessArtifactMatch[] {
  const matches: ReadinessArtifactMatch[] = [];
  for (const recordValue of records) {
    const record = objectRecord(recordValue);
    const readiness = objectRecord(
      objectRecord(record?.data)?.executionReadiness,
    );
    const clauses = readiness?.clauses;
    if (!record || !Array.isArray(clauses)) continue;
    requiredString(record.key, 'pack record.key');
    requiredString(record.source, `pack record ${record.key}.source`);
    const provenance = objectRecord(record.provenance);
    requiredString(
      provenance?.locator,
      `pack record ${record.key}.provenance.locator`,
    );
    for (const [clauseIndex, clauseValue] of clauses.entries()) {
      const clause = objectRecord(clauseValue);
      if (
        typeof clause?.clauseId !== 'string' ||
        !Array.isArray(clause.engineHooks)
      )
        continue;
      const matchingHook = clause.engineHooks.some((hookValue) => {
        const hook = objectRecord(hookValue);
        const name =
          typeof hook?.name === 'string'
            ? hook.name
            : typeof hook?.id === 'string'
              ? hook.id
              : hook?.hook;
        return (
          hook?.engine === evidence.hookSelector.engine &&
          name === evidence.hookSelector.name
        );
      });
      if (!matchingHook) continue;
      matches.push({
        recordKey: record.key,
        clauseId: clause.clauseId,
        path: `data.executionReadiness.clauses[${clauseIndex}]`,
        sourceSpan: { source: record.source, locator: provenance.locator },
        hook: evidence.hookSelector,
      });
    }
  }
  if (evidence.expected === 'non-empty' && matches.length === 0)
    fail(`${evidence.queryId} expected a non-empty readiness baseline`);
  if (evidence.expected === 'absent-from-pack' && matches.length > 0)
    fail(
      `${evidence.queryId} expected the exact hook to be absent from the pack`,
    );
  return matches;
}

const CORE_SRC_PATH = fileURLToPath(new URL('../', import.meta.url));

function resolveCodeEvidence(evidence: CodeEvidence): EvidenceResolution {
  const modulePath = fileURLToPath(
    new URL(evidence.module, `file://${CORE_SRC_PATH}/`),
  );
  if (!existsSync(modulePath))
    fail(`${evidence.module} does not exist in @eshyra/core`);
  const text = readFileSync(modulePath, 'utf8');
  const symbol = evidence.symbol.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  if (
    !new RegExp(
      `\\bexport\\s+(?:(?:async)\\s+)?(?:function|const|class|interface|type)\\s+${symbol}\\b`,
    ).test(text)
  )
    fail(`${evidence.module} does not export ${evidence.symbol}`);
  return { evidence, status: 'satisfied' };
}

function resolveBeadEvidence(evidence: BeadEvidence): EvidenceResolution {
  if (!commandExists('bd'))
    return { evidence, status: 'skipped', reason: 'bd binary is absent' };
  if (beadExistence.get(evidence.beadId) === false)
    fail(`owning bead does not exist: ${evidence.beadId}`);
  if (beadExistence.get(evidence.beadId) === true)
    return { evidence, status: 'satisfied' };
  try {
    execFileSync('bd', ['show', evidence.beadId], { stdio: 'ignore' });
    beadExistence.set(evidence.beadId, true);
    return { evidence, status: 'satisfied' };
  } catch {
    beadExistence.set(evidence.beadId, false);
    fail(`owning bead does not exist: ${evidence.beadId}`);
  }
}

function verifyBeadIds(beadIds: readonly string[]): void {
  if (!commandExists('bd')) return;
  const unresolved = beadIds.filter(
    (beadId) => beadExistence.get(beadId) !== true,
  );
  if (unresolved.length === 0) return;
  try {
    const output = execFileSync(
      'bd',
      ['list', '--all', '--json', '--id', unresolved.join(',')],
      { encoding: 'utf8' },
    );
    const listed = JSON.parse(output) as readonly { readonly id?: unknown }[];
    const found = new Set(
      listed
        .map((item) => item.id)
        .filter((id): id is string => typeof id === 'string'),
    );
    for (const beadId of unresolved) {
      if (!found.has(beadId)) fail(`owning bead does not exist: ${beadId}`);
      beadExistence.set(beadId, true);
    }
  } catch (cause) {
    if (
      cause instanceof Error &&
      cause.message.startsWith('owning bead does not exist:')
    )
      throw cause;
    for (const beadId of unresolved)
      resolveBeadEvidence({
        kind: 'bead',
        obligationId: 'obl:::validation:bead',
        obligationKind: 'bead',
        beadId,
        expected: 'exists',
      });
  }
}

function resolveKnownMissingSourceClause(
  evidence: KnownMissingSourceClauseEvidence,
  records: readonly unknown[],
): EvidenceResolution {
  let scannedClauses = 0;
  for (const recordValue of records) {
    const record = objectRecord(recordValue);
    const clauses = objectRecord(
      objectRecord(record?.data)?.executionReadiness,
    )?.clauses;
    const serializedRecord = JSON.stringify(recordValue);
    if (
      serializedRecord.includes(evidence.sourceRef) ||
      serializedRecord.includes(evidence.locator)
    )
      fail(
        `${evidence.sourceRef} ${evidence.locator} is unexpectedly present in the pack`,
      );
    if (!Array.isArray(clauses)) continue;
    scannedClauses += clauses.length;
  }
  return {
    evidence,
    status: 'satisfied',
    scannedRecords: records.length,
    scannedClauses,
  };
}

export function resolveEvidence(
  evidence: BootstrapEvidence,
  records: readonly unknown[],
): EvidenceResolution {
  switch (evidence.kind) {
    case 'readiness-artifact':
      return {
        evidence,
        status: 'satisfied',
        matches: evaluateReadinessArtifact(evidence, records),
      };
    case 'code':
      return resolveCodeEvidence(evidence);
    case 'bead':
      return resolveBeadEvidence(evidence);
    case 'audit-finding':
      if (!KNOWN_AUDIT_FINDINGS.has(evidence.findingAlias))
        fail(`unknown audit finding ${evidence.findingAlias}`);
      return { evidence, status: 'satisfied' };
    case 'known-missing-source-clause':
      return resolveKnownMissingSourceClause(evidence, records);
  }
}

export function evaluateRowEvidence(
  row: BootstrapCapabilityRow,
  records: readonly unknown[],
): readonly EvidenceResolution[] {
  return row.evidence.map((evidence) => resolveEvidence(evidence, records));
}

export function validateBootstrapCapabilityLedger(
  value: unknown,
  options: { readonly checkBeads?: boolean } = {},
): BootstrapCapabilityLedger {
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    fail('root must be an object');
  rejectStoredCountFields(value, 'ledger');
  const root = value as Record<string, unknown>;
  if (root.status !== BOOTSTRAP_LEDGER_STATUS)
    fail('status must be NON-AUTHORITATIVE');
  requiredString(root.authoritativeLedger, 'authoritativeLedger');
  requiredString(root.snapshotCommit, 'snapshotCommit');
  requiredStringArray(root.sources, 'sources');
  if (!(root.sources as readonly string[]).every((source) => source.length > 0))
    fail('sources must not be blank');
  if (!Array.isArray(root.rows) || root.rows.length === 0)
    fail('rows must be a non-empty array');
  const rows = root.rows.map(validateRow);
  const primitives = new Set<string>();
  const familyPrimitives = new Set<string>();
  const queryOwners = new Map<string, string>();
  const familyRows = new Map<string, number>();
  for (const row of rows) {
    if (primitives.has(row.primitive))
      fail(`duplicate primitive: ${row.primitive}`);
    primitives.add(row.primitive);
    const familyPrimitive = `${row.capabilityId}\0${row.primitive}`;
    if (familyPrimitives.has(familyPrimitive))
      fail(
        `duplicate family/primitive pair: ${row.capabilityId}/${row.primitive}`,
      );
    familyPrimitives.add(familyPrimitive);
    familyRows.set(
      row.capabilityId,
      (familyRows.get(row.capabilityId) ?? 0) + 1,
    );
    for (const item of row.evidence) {
      if (item.kind !== 'readiness-artifact') continue;
      const owner = queryOwners.get(item.queryId);
      if (owner && owner !== row.primitive)
        fail(
          `queryId ${item.queryId} is ambiguously owned by ${owner} and ${row.primitive}`,
        );
      queryOwners.set(item.queryId, row.primitive);
    }
  }
  for (let family = 1; family <= 10; family += 1) {
    const capabilityId = `engine:F${family}`;
    if (!familyRows.has(capabilityId)) fail(`missing ${capabilityId}`);
    if ((familyRows.get(capabilityId) ?? 0) < 2)
      fail(`${capabilityId} needs multiple primitive rows`);
  }
  const nonPackPrimitives = rows
    .filter((row) => !row.discoveredBy.includes('readiness-artifacts'))
    .map((row) => row.primitive);
  if (
    nonPackPrimitives.length !== NON_PACK_DISCOVERY_PRIMITIVES.length ||
    NON_PACK_DISCOVERY_PRIMITIVES.some(
      (primitive) => !nonPackPrimitives.includes(primitive),
    )
  )
    fail('non-pack discovery primitive set is not the pinned seven-row set');
  for (const row of rows) {
    if (
      row.owningBead === ENGINE_EPIC &&
      row.ownershipStatus !== 'proposed-new-bead'
    )
      fail(
        `${row.primitive} names the engine epic as its owner; use a family epic, a real bead, or ownershipStatus=proposed-new-bead`,
      );
  }
  if (options.checkBeads !== false && commandExists('bd')) {
    verifyBeadIds([
      ...new Set(
        rows
          .flatMap((row) => row.evidence)
          .filter((item): item is BeadEvidence => item.kind === 'bead')
          .map((item) => item.beadId),
      ),
    ]);
  }
  return { ...root, rows } as unknown as BootstrapCapabilityLedger;
}

function commandExists(command: string): boolean {
  try {
    execFileSync('which', [command], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

export function loadBootstrapCapabilityLedger(
  path = BOOTSTRAP_LEDGER_PATH,
): BootstrapCapabilityLedger {
  if (!existsSync(path)) fail(`ledger file not found: ${path}`);
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, 'utf8'));
  } catch (cause) {
    fail(`ledger JSON cannot be parsed: ${(cause as Error).message}`);
  }
  return validateBootstrapCapabilityLedger(parsed);
}
