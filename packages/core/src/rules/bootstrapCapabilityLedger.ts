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

export interface PackEvidenceSourceComparison {
  readonly status: 'second-input-unavailable';
  readonly gap: string;
  readonly followUp: string;
}

export interface PackEvidenceQuery {
  readonly queryId: string;
  readonly engine: string;
  readonly hookTerms: readonly string[];
  readonly matchAll?: boolean;
  readonly sourceComparison?: PackEvidenceSourceComparison;
}

export interface PackEvidenceMatch {
  readonly recordKey: string;
  readonly clauseId: string;
  readonly path: string;
  readonly sourceSpan: string;
}

export interface BootstrapCapabilityRow {
  readonly capabilityId: string;
  readonly primitive: string;
  readonly requirement: string;
  readonly discoveredBy: readonly string[];
  readonly packEvidence: PackEvidenceQuery;
  readonly codeEvidence: string;
  readonly owningBead?: string | null;
  readonly ownershipStatus: OwnershipStatus;
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

interface PackEvidenceQueryDefinition {
  readonly queryId: string;
  readonly engine: string;
  readonly hookTerms: readonly string[];
  readonly matchAll: boolean;
  readonly requiresSourceComparison: boolean;
}

function queryDefinition(
  engine: string,
  primitive: string,
  hookTerms: readonly string[],
  options: {
    readonly matchAll?: boolean;
    readonly requiresSourceComparison?: boolean;
  } = {},
): PackEvidenceQueryDefinition {
  return {
    queryId: `bootstrap:${engine}:${primitive}`,
    engine,
    hookTerms,
    matchAll: options.matchAll ?? false,
    requiresSourceComparison: options.requiresSourceComparison ?? false,
  };
}

const PACK_EVIDENCE_QUERY_DEFINITIONS = [
  queryDefinition('engine:F1', 'condition-and-eligibility-relations', [
    'condition',
    'eligibility',
  ]),
  queryDefinition('engine:F1', 'seeded-selection-and-roll-replacement', [
    'seeded',
    'percentage',
    'table',
    'pool',
    'replacement',
  ]),
  queryDefinition('engine:F2', 'turn-action-and-free-interaction-budget', [
    'action-economy',
    'activation',
  ]),
  queryDefinition('engine:F2', 'reaction-and-item-activation-ownership', [
    'reaction',
    'controlled-entity',
    'item activation',
    'action-budget',
  ]),
  queryDefinition(
    'engine:F2',
    'legendary-action-allowance-and-option-cost',
    [],
    { matchAll: true, requiresSourceComparison: true },
  ),
  queryDefinition('engine:F3', 'concentration-owner-and-damage-save', [
    'concentration',
  ]),
  queryDefinition('engine:F3', 'active-effect-duration-and-termination', [
    'duration',
    'active-effect',
    'lifecycle',
  ]),
  queryDefinition(
    'engine:F3',
    'owned-entity-and-repeat-trigger-lifecycle',
    [],
    { matchAll: true, requiresSourceComparison: true },
  ),
  queryDefinition(
    'engine:F4',
    'caster-of-record-and-canonical-spell-execution',
    ['canonical spell', 'caster', 'spell-effect'],
  ),
  queryDefinition('engine:F4', 'spell-slot-gate-and-upcast-transform', [
    'slot',
    'casting',
    'stored-spell',
  ]),
  queryDefinition(
    'engine:F4',
    'spellbook-copy-cost-and-asset-ledger',
    ['spellbook', 'copy'],
    { requiresSourceComparison: true },
  ),
  queryDefinition('engine:F5', 'per-instance-usage-and-charge-spend', [
    'per-item',
    'charge',
    'usage',
  ]),
  queryDefinition('engine:F5', 'recharge-and-reset-scheduling', [
    'recharge',
    'dawn',
    'reset',
    'cooldown',
  ]),
  queryDefinition('engine:F5', 'attunement-curse-and-identity-constraints', [
    'attunement',
    'curse',
    'item-instance',
  ]),
  queryDefinition(
    'engine:F5',
    'containment-portal-and-card-pool-instance-state',
    ['containment', 'portal', 'card-pool'],
    { requiresSourceComparison: true },
  ),
  queryDefinition('engine:F6', 'hp-healing-and-temporary-buffer', [
    'hit-point',
    'healing',
    'temporary-hit-point',
  ]),
  queryDefinition('engine:F6', 'death-save-dying-and-stable-transitions', [
    'death',
    'dying',
    'death-save',
    'stabilization',
  ]),
  queryDefinition('engine:F6', 'suffocation-and-ongoing-damage-state', [], {
    matchAll: true,
    requiresSourceComparison: true,
  }),
  queryDefinition('engine:F7', 'short-rest-hit-dice-recovery', [
    'short-rest',
    'hit-dice',
    'recovery',
  ]),
  queryDefinition('engine:F7', 'long-rest-reset-orchestration', [
    'long-rest',
    'reset',
    'early-reuse',
  ]),
  queryDefinition(
    'engine:F7',
    'planar-return-and-declared-window-clocks',
    ['planar-return', 'declared-window', 'duration', 'deadline'],
    { requiresSourceComparison: true },
  ),
  queryDefinition('engine:F8', 'save-dc-and-spell-attack-modifier-resolution', [
    'save-dc',
    'spell attack',
    'derived combat modifier',
  ]),
  queryDefinition(
    'engine:F8',
    'multi-save-and-ability-choice-outcomes',
    ['save', 'ability-choice', 'targeting'],
    { requiresSourceComparison: true },
  ),
  queryDefinition('engine:F8', 'derived-attack-ac-and-proficiency-modifiers', [
    'attack',
    'damage',
    'roll mode',
    'derived combat modifier',
  ]),
  queryDefinition(
    'engine:F9',
    'point-origin-area-geometry-and-targeting',
    ['geometry', 'targeting'],
    { requiresSourceComparison: true },
  ),
  queryDefinition(
    'engine:F9',
    'damage-rider-and-half-damage-branch-resolution',
    ['damage', 'rider'],
    { requiresSourceComparison: true },
  ),
  queryDefinition(
    'engine:F9',
    'forced-movement-contest-and-object-interaction',
    ['movement', 'contest', 'escape', 'destruction', 'interaction'],
  ),
  queryDefinition('engine:F9', 'capacity-and-variant-arithmetic', [
    'capacity',
    'coverage',
    'time',
    'volume',
    'size-scaled',
  ]),
  queryDefinition('engine:F10', 'canonical-currency-mutation', [
    'currency',
    'property',
    'inventory',
    'xp',
  ]),
  queryDefinition('engine:F10', 'downtime-study-expense-and-training-ledger', [
    'downtime',
    'study',
    'expense',
    'profession',
    'research',
    'training',
  ]),
  queryDefinition(
    'engine:F10',
    'retained-inventory-property-xp-asset-creation',
    ['asset', 'inventory', 'property', 'xp'],
    { requiresSourceComparison: true },
  ),
] as const;

const queryDefinitionsById = new Map(
  PACK_EVIDENCE_QUERY_DEFINITIONS.map((definition) => [
    definition.queryId,
    definition,
  ]),
);

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
  ) {
    fail(`${field} must be a non-empty string array`);
  }
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

function validatePackEvidenceQuery(
  value: unknown,
  field: string,
): PackEvidenceQuery {
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    fail(`${field} must be a structured query object`);
  const query = value as Record<string, unknown>;
  requiredString(query.queryId, `${field}.queryId`);
  requiredString(query.engine, `${field}.engine`);
  if (query.hookTerms === undefined) query.hookTerms = [];
  if (
    !Array.isArray(query.hookTerms) ||
    query.hookTerms.some((term) => typeof term !== 'string')
  )
    fail(`${field}.hookTerms must be a string array`);
  const definition = queryDefinitionsById.get(query.queryId);
  if (!definition) fail(`${field}.queryId is not registered`);
  if (query.engine !== definition.engine)
    fail(`${field}.queryId targets ${definition.engine}, not ${query.engine}`);
  if (JSON.stringify(query.hookTerms) !== JSON.stringify(definition.hookTerms))
    fail(`${field}.hookTerms do not match its registered query`);
  if ((query.matchAll ?? false) !== definition.matchAll)
    fail(`${field}.matchAll does not match its registered query`);
  if (definition.requiresSourceComparison) {
    if (
      typeof query.sourceComparison !== 'object' ||
      query.sourceComparison === null ||
      Array.isArray(query.sourceComparison)
    ) {
      fail(`${field} must state why its second source input is unavailable`);
    }
    const comparison = query.sourceComparison as Record<string, unknown>;
    if (comparison.status !== 'second-input-unavailable')
      fail(`${field}.sourceComparison.status is invalid`);
    requiredString(comparison.gap, `${field}.sourceComparison.gap`);
    requiredString(comparison.followUp, `${field}.sourceComparison.followUp`);
  } else if (query.sourceComparison !== undefined) {
    fail(`${field} has an unnecessary source comparison gap`);
  }
  return query as unknown as PackEvidenceQuery;
}

function objectRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

export function evaluatePackEvidence(
  query: PackEvidenceQuery,
  records: readonly unknown[],
): readonly PackEvidenceMatch[] {
  const validatedQuery = validatePackEvidenceQuery(query, 'packEvidence');
  const engine = validatedQuery.engine.slice('engine:'.length);
  const definition = queryDefinitionsById.get(validatedQuery.queryId);
  if (!definition) fail('packEvidence query definition disappeared');
  const matches: PackEvidenceMatch[] = [];
  const seen = new Set<string>();
  records.forEach((recordValue) => {
    const record = objectRecord(recordValue);
    const readiness = objectRecord(
      objectRecord(record?.data)?.executionReadiness,
    );
    const clauses = readiness?.clauses;
    if (!record || !Array.isArray(clauses)) return;
    requiredString(record.key, 'pack record.key');
    requiredString(record.source, `pack record ${record.key}.source`);
    const provenance = objectRecord(record.provenance);
    requiredString(
      provenance?.locator,
      `pack record ${record.key}.provenance.locator`,
    );
    for (const [clauseIndex, clauseValue] of clauses.entries()) {
      const clause = objectRecord(clauseValue);
      const clauseId = clause?.clauseId;
      const hooks = clause?.engineHooks;
      if (typeof clauseId !== 'string' || !Array.isArray(hooks)) continue;
      const matchingHook = hooks.some((hookValue) => {
        const hook = objectRecord(hookValue);
        if (hook?.engine !== engine || typeof hook.hook !== 'string')
          return false;
        const text = hook.hook.toLowerCase();
        return (
          definition.matchAll ||
          definition.hookTerms.some((term) => text.includes(term.toLowerCase()))
        );
      });
      if (!matchingHook) continue;
      const identity = `${record.key}\0${clauseId}`;
      if (seen.has(identity)) continue;
      seen.add(identity);
      matches.push({
        recordKey: record.key,
        clauseId,
        path: `data.executionReadiness.clauses[${clauseIndex}]`,
        sourceSpan: `${record.source} ${provenance.locator}`,
      });
    }
  });
  return matches;
}

function validateRow(value: unknown, index: number): BootstrapCapabilityRow {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    fail(`rows[${index}] must be an object`);
  }
  const row = value as Record<string, unknown>;
  for (const field of [
    'capabilityId',
    'primitive',
    'requirement',
    'codeEvidence',
    'ownershipStatus',
    'notes',
  ])
    requiredString(row[field], `rows[${index}].${field}`);
  const packEvidence = validatePackEvidenceQuery(
    row.packEvidence,
    `rows[${index}].packEvidence`,
  );
  requiredStringArray(row.discoveredBy, `rows[${index}].discoveredBy`);
  if (!ENGINE_CAPABILITY_ID.test(row.capabilityId as string)) {
    fail(`rows[${index}].capabilityId must use engine:F1..engine:F10`);
  }
  if (row.primitive === row.capabilityId) {
    fail(`rows[${index}].primitive must identify a specific primitive`);
  }
  if (
    !(row.discoveredBy as readonly string[]).every((source) =>
      SOURCE_NAMES.has(source),
    )
  ) {
    fail(`rows[${index}].discoveredBy contains an unknown source`);
  }
  if (
    !['owned', 'proposed-new-bead', 'disputed'].includes(
      row.ownershipStatus as string,
    )
  ) {
    fail(`rows[${index}].ownershipStatus is invalid`);
  }
  if (packEvidence.engine !== row.capabilityId)
    fail(`rows[${index}] query family must match capabilityId`);
  if (row.ownershipStatus === 'proposed-new-bead') {
    if (
      row.owningBead !== undefined &&
      row.owningBead !== null &&
      !BEAD_ID.test(row.owningBead as string)
    )
      fail(`rows[${index}].owningBead is not a bead ID or null`);
  } else if (
    typeof row.owningBead !== 'string' ||
    !BEAD_ID.test(row.owningBead)
  ) {
    fail(`rows[${index}].owningBead must be a bead ID`);
  }
  if (
    row.ownershipStatus === 'proposed-new-bead' &&
    (typeof row.proposedTitle !== 'string' ||
      row.proposedTitle.trim() === '' ||
      typeof row.proposedParent !== 'string' ||
      !BEAD_ID.test(row.proposedParent) ||
      !/proposed title|parent/i.test(row.notes as string))
  ) {
    fail(`rows[${index}] proposed ownership must name its title and parent`);
  }
  return { ...row, packEvidence } as unknown as BootstrapCapabilityRow;
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
  }
  const familyRows = new Map<string, number>();
  for (const row of rows) {
    familyRows.set(
      row.capabilityId,
      (familyRows.get(row.capabilityId) ?? 0) + 1,
    );
  }
  for (let family = 1; family <= 10; family += 1) {
    const capabilityId = `engine:F${family}`;
    if (!familyRows.has(capabilityId)) fail(`missing ${capabilityId}`);
    if ((familyRows.get(capabilityId) ?? 0) < 2) {
      fail(`${capabilityId} needs multiple primitive rows`);
    }
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
  // Ownership by a family epic is legitimate before decomposition runs, since
  // the implementation children deliberately do not exist yet. Falling back to
  // the engine epic root is not: it means no family owns the primitive, which
  // is the condition `proposed-new-bead` exists to record.
  for (const row of rows) {
    if (
      row.owningBead === ENGINE_EPIC &&
      row.ownershipStatus !== 'proposed-new-bead'
    ) {
      fail(
        `${row.primitive} names the engine epic as its owner; use a family epic, a real bead, or ownershipStatus=proposed-new-bead`,
      );
    }
  }
  if (options.checkBeads !== false && commandExists('bd')) {
    const beadIds = [
      ...new Set(
        rows
          .filter((row) => row.ownershipStatus === 'owned')
          .map((row) => row.owningBead)
          .filter((beadId): beadId is string => typeof beadId === 'string'),
      ),
    ].filter((beadId) => beadExistence.get(beadId) !== true);
    if (beadIds.length > 0) {
      try {
        execFileSync('bd', ['show', ...beadIds], { stdio: 'ignore' });
        for (const beadId of beadIds) beadExistence.set(beadId, true);
      } catch {
        for (const beadId of beadIds) {
          if (beadExistence.get(beadId) === false)
            fail(`owning bead does not exist: ${beadId}`);
          try {
            execFileSync('bd', ['show', beadId], { stdio: 'ignore' });
            beadExistence.set(beadId, true);
          } catch {
            beadExistence.set(beadId, false);
            fail(`owning bead does not exist: ${beadId}`);
          }
        }
      }
    }
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
