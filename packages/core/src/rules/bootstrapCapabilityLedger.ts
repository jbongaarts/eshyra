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
  readonly relevance: string;
  readonly expected: 'known';
}

export interface KnownMissingSourceClauseEvidence extends ObligationIdentity {
  readonly kind: 'known-missing-source-clause';
  readonly sourceRef: string;
  readonly locator: string;
  readonly sourceRecordKey: string;
  readonly projectionQueryId: string;
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

export const PRIMITIVE_ROSTER_VERSION =
  'bootstrap-capability-roster-v1' as const;

export const CANONICAL_PRIMITIVE_ROSTER = [
  ['engine:F1', 'condition-and-eligibility-relations'],
  ['engine:F1', 'seeded-selection-and-roll-replacement'],
  ['engine:F2', 'turn-action-and-free-interaction-budget'],
  ['engine:F2', 'reaction-and-item-activation-ownership'],
  ['engine:F2', 'legendary-action-allowance-and-option-cost'],
  ['engine:F3', 'concentration-owner-and-damage-save'],
  ['engine:F3', 'active-effect-duration-and-termination'],
  ['engine:F3', 'owned-entity-and-repeat-trigger-lifecycle'],
  ['engine:F4', 'caster-of-record-and-canonical-spell-execution'],
  ['engine:F4', 'spell-slot-gate-and-upcast-transform'],
  ['engine:F4', 'spellbook-copy-cost-and-asset-ledger'],
  ['engine:F5', 'per-instance-usage-and-charge-spend'],
  ['engine:F5', 'recharge-and-reset-scheduling'],
  ['engine:F5', 'attunement-curse-and-identity-constraints'],
  ['engine:F5', 'containment-portal-and-card-pool-instance-state'],
  ['engine:F6', 'hp-healing-and-temporary-buffer'],
  ['engine:F6', 'death-save-dying-and-stable-transitions'],
  ['engine:F6', 'suffocation-and-ongoing-damage-state'],
  ['engine:F7', 'short-rest-hit-dice-recovery'],
  ['engine:F7', 'long-rest-reset-orchestration'],
  ['engine:F7', 'planar-return-and-declared-window-clocks'],
  ['engine:F8', 'save-dc-and-spell-attack-modifier-resolution'],
  ['engine:F8', 'multi-save-and-ability-choice-outcomes'],
  ['engine:F8', 'derived-attack-ac-and-proficiency-modifiers'],
  ['engine:F9', 'point-origin-area-geometry-and-targeting'],
  ['engine:F9', 'damage-rider-and-half-damage-branch-resolution'],
  ['engine:F9', 'forced-movement-contest-and-object-interaction'],
  ['engine:F9', 'capacity-and-variant-arithmetic'],
  ['engine:F10', 'canonical-currency-mutation'],
  ['engine:F10', 'downtime-study-expense-and-training-ledger'],
  ['engine:F10', 'retained-inventory-property-xp-asset-creation'],
] as const;

/** Canonical subjects from the five accepted 2026-07-24 review inventories. */
export const AUDIT_FINDING_SUBJECTS: Readonly<Record<string, string>> = {
  'indep:001': 'atom presence mistaken for complete procedures',
  'indep:002': 'choice behavior absent or hoisted to parent',
  'indep:003': 'incomplete class feature and feat procedures',
  'indep:004': 'ancestry deterministic omissions',
  'indep:005': 'spell procedure incompleteness',
  'indep:006': 'creature trigger/branch/timing/lifecycle gaps',
  'indep:007': 'hazards not deterministically executable',
  'indep:008': '23 incomplete locators',
  'indep:009': 'ambiguous/unresolved counted as complete',
  'indep:010': 'Rock Gnome trait boundary',
  'indep:011': 'falsely closed language universe',
  'indep:012': 'equipment/material/potion/report issues',
  'opus:F-01': 'hazard success-damage branches omitted',
  'opus:F-02': 'four Pit variants collapsed',
  'opus:F-03': 'Indomitable use scaling wrong',
  'opus:F-04': 'Arcane Recovery reset wrong',
  'opus:F-05': 'Natural Recovery reset wrong',
  'opus:F-06': 'phantom feature resources',
  'opus:F-07': 'Eldritch Invocation effects hoisted',
  'opus:F-08': 'spell areas limited to self-origin',
  'opus:F-09': 'rules prose-only with no in-band readiness',
  'opus:F-10': 'advancement scaling qualifiers dropped',
  'opus:F-11': 'Magic Missile base projectile count missing',
  'opus:F-12': 'Ki abilities and save DC swallowed by prose',
  'opus:F-13': 'proficiency grants free-text',
  'opus:F-14': 'inconsistent choice identifiers/catalogs',
  'opus:F-15': 'inconsistent Spellcasting subfeature granularity',
  'opus:F-16': 'madness durations dropped',
  'opus:F-17': 'Vehicles tool row missing',
  'opus:F-18': 'background equipment unstructured',
  'opus:F-19': 'composed spellPreparation sourceText presented as quotation',
  'opus:F-20': 'stale loreweaver manifest reference',
  'opus:F-21': 'zero-finding metadata contradicts readiness',
  'opus:F-22': 'duplicate display names lack qualification',
  'opus:F-23': 'Sphere of Annihilation prose-only',
  'opus:F-24': 'Divine Sense use count missing',
  'opus:F-25': '79 creature + 8 hazard half-damage branches omitted',
  'opus:F-26': 'legendary budget and action costs unmodeled',
  'opus:F-27': 'mutually exclusive damage alternatives flattened',
  'opus:F-28': 'Druid/Dryad attacks lack attack objects',
  'opus:F-29': 'Unicode-minus damage silently dropped',
  'opus:F-30': 'Wererat Hand Crossbow swallowed',
  'opus:F-31': 'ranged attacks lack range under alternate notation',
  'opus:F-32': 'multi-save entries type only first save',
  'opus:F-33': 'Bulette ability alternative/DC lost',
  'opus:F-34': 'inconsistent flat/dice damage field names',
  'opus:F-35': 'targeting qualifiers truncated',
  'sol:CAP-001': 'rule corpus not executable',
  'sol:CAP-002': 'condition/action/feat structural gaps',
  'sol:CAP-003': 'spell mechanics shallower than source',
  'sol:CAP-004': 'creature/stat-block mechanics incomplete',
  'sol:CAP-005': 'ancestry/feature/progression/choice losses',
  'sol:CAP-006': 'hazards incomplete and healing potion prose-only',
  'sol:CAP-007': '221 magic items blocked by engine',
  'sol:CAP-008': 'Bag of Beans wrong successful-save outcome',
  'sol:CAP-009': 'Animal Friendship unsupported correction',
  'sol:CAP-010': 'structured fields omit actual source provenance',
  'sol:CAP-011': 'DM discovery/canonical relationships inadequate',
  'sol:CAP-012': 'Rock Gnome owner boundary',
  'sol:CAP-013': 'Tack/Harness/Drawn Vehicles taxonomy lost',
  'sol:CAP-014': 'readiness artifacts contradict corpus',
  'fable:F1': 'unsupported Starting Wealth table',
  'fable:F2': 'point-origin areas absent',
  'fable:F3': 'creature rider/ongoing damage untyped',
  'fable:F4': 'container continuation under-citation',
  'fable:F5': 'synthesized table headers not distinguished',
  'fable:F6': 'inconsistent table empty cells',
  'fable:F7': 'synthesized choice sourceText labels',
  'fable:F8': 'rule keying/duplication hygiene',
};

const ENGINE_EPIC = 'eshyra-olc5';
const ENGINE_CAPABILITY_ID = /^engine:F(?:[1-9]|10)$/;
const BEAD_ID = /^eshyra-[a-z0-9]+(?:\.[a-z0-9]+)*$/;
const OBLIGATION_ID = /^obl:::.+:::.+:::.+$/;
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

interface ProjectionQuerySpec {
  readonly projectionQueryId: string;
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

const PROJECTION_QUERY_SPECS: readonly ProjectionQuerySpec[] = [
  {
    projectionQueryId:
      'bootstrap:projection:engine:F2:legendary-action-allowance-and-option-cost',
    engine: 'engine:F2',
    primitive: 'legendary-action-allowance-and-option-cost',
    hookSelector: {
      engine: 'F2',
      name: 'legendary actions: per-round allowance and per-option cost',
    },
  },
  {
    projectionQueryId:
      'bootstrap:projection:engine:F3:owned-entity-and-repeat-trigger-lifecycle',
    engine: 'engine:F3',
    primitive: 'owned-entity-and-repeat-trigger-lifecycle',
    hookSelector: {
      engine: 'F3',
      name: 'creature entity ownership and repeat trigger lifecycle',
    },
  },
  {
    projectionQueryId:
      'bootstrap:projection:engine:F4:spell-slot-gate-and-upcast-transform',
    engine: 'engine:F4',
    primitive: 'spell-slot-gate-and-upcast-transform',
    hookSelector: {
      engine: 'F4',
      name: 'spell slot availability and upcast transformation',
    },
  },
  {
    projectionQueryId:
      'bootstrap:projection:engine:F4:spellbook-copy-cost-and-asset-ledger',
    engine: 'engine:F4',
    primitive: 'spellbook-copy-cost-and-asset-ledger',
    hookSelector: {
      engine: 'F4',
      name: 'wizard spellbook copy cost and asset ledger',
    },
  },
  {
    projectionQueryId:
      'bootstrap:projection:engine:F5:containment-portal-and-card-pool-instance-state',
    engine: 'engine:F5',
    primitive: 'containment-portal-and-card-pool-instance-state',
    hookSelector: {
      engine: 'F5',
      name: 'item containment, portal, and card-pool instance state',
    },
  },
  {
    projectionQueryId:
      'bootstrap:projection:engine:F6:suffocation-and-ongoing-damage-state',
    engine: 'engine:F6',
    primitive: 'suffocation-and-ongoing-damage-state',
    hookSelector: {
      engine: 'F6',
      name: 'suffocation threshold and ongoing damage state',
    },
  },
  {
    projectionQueryId:
      'bootstrap:projection:engine:F7:planar-return-and-declared-window-clocks',
    engine: 'engine:F7',
    primitive: 'planar-return-and-declared-window-clocks',
    hookSelector: {
      engine: 'F7',
      name: 'planar return deadline and declared window clock',
    },
  },
  {
    projectionQueryId:
      'bootstrap:projection:engine:F8:multi-save-and-ability-choice-outcomes',
    engine: 'engine:F8',
    primitive: 'multi-save-and-ability-choice-outcomes',
    hookSelector: {
      engine: 'F8',
      name: 'multiple saves and ability-choice outcome branches',
    },
  },
  {
    projectionQueryId:
      'bootstrap:projection:engine:F9:point-origin-area-geometry-and-targeting',
    engine: 'engine:F9',
    primitive: 'point-origin-area-geometry-and-targeting',
    hookSelector: {
      engine: 'F9',
      name: 'area point-origin geometry and target selection',
    },
  },
  {
    projectionQueryId:
      'bootstrap:projection:engine:F9:damage-rider-and-half-damage-branch-resolution',
    engine: 'engine:F9',
    primitive: 'damage-rider-and-half-damage-branch-resolution',
    hookSelector: {
      engine: 'F9',
      name: 'damage riders and half-damage branches',
    },
  },
  {
    projectionQueryId:
      'bootstrap:projection:engine:F10:downtime-study-expense-and-training-ledger',
    engine: 'engine:F10',
    primitive: 'downtime-study-expense-and-training-ledger',
    hookSelector: {
      engine: 'F10',
      name: 'downtime study, expense, and training ledger',
    },
  },
  {
    projectionQueryId:
      'bootstrap:projection:engine:F10:retained-inventory-property-xp-asset-creation',
    engine: 'engine:F10',
    primitive: 'retained-inventory-property-xp-asset-creation',
    hookSelector: {
      engine: 'F10',
      name: 'retained inventory property, XP, and asset creation',
    },
  },
];
const projectionSpecsById = new Map(
  PROJECTION_QUERY_SPECS.map((spec) => [spec.projectionQueryId, spec]),
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
  const segments = value.obligationId.split(':::');
  if (
    segments.length !== 4 ||
    segments.some((segment) => segment.trim() === '')
  )
    fail(`${field}.obligationId must have four non-empty segments`);
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
      requiredString(evidence.relevance, `${field}.relevance`);
      if (evidence.expected !== 'known')
        fail(`${field}.expected must be known`);
      return evidence as unknown as AuditFindingEvidence;
    case 'known-missing-source-clause':
      validateIdentity(evidence, field, 'known-missing-source-clause');
      requiredString(evidence.sourceRef, `${field}.sourceRef`);
      requiredString(evidence.locator, `${field}.locator`);
      requiredString(evidence.sourceRecordKey, `${field}.sourceRecordKey`);
      requiredString(evidence.projectionQueryId, `${field}.projectionQueryId`);
      if (!projectionSpecsById.has(evidence.projectionQueryId))
        fail(`${field}.projectionQueryId is not registered`);
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
  const queryIds = new Set<string>();
  for (const item of readiness) {
    if (queryIds.has(item.queryId))
      fail(`${fieldForRow(index)} repeats queryId ${item.queryId}`);
    queryIds.add(item.queryId);
    if (item.engine !== row.capabilityId)
      fail(
        `rows[${index}] readiness evidence targets ${item.engine}, not ${row.capabilityId}`,
      );
    const spec = querySpecsById.get(item.queryId);
    if (!spec || spec.primitive !== row.primitive)
      fail(`rows[${index}] queryId is not owned by this primitive`);
  }
  for (const item of evidence) {
    if (item.kind !== 'known-missing-source-clause') continue;
    const projection = projectionSpecsById.get(item.projectionQueryId);
    if (!projection || projection.primitive !== row.primitive)
      fail(
        `rows[${index}] known-missing projection does not target this primitive`,
      );
  }
  for (const item of evidence) {
    if (item.kind !== 'audit-finding') continue;
    const subject = AUDIT_FINDING_SUBJECTS[item.findingAlias];
    if (!subject || !item.relevance.includes(subject))
      fail(
        `rows[${index}] audit relevance must quote the canonical subject for ${item.findingAlias}`,
      );
    const context = item.relevance.replace(subject, '').trim();
    if (context.split(/\s+/).filter(Boolean).length < 8)
      fail(`rows[${index}] audit relevance lacks row-specific reasoning`);
    if (
      item.relevance.startsWith(
        `The accepted finding subject '${subject}' is relevant because this row inventories the ${row.primitive}`,
      )
    )
      fail(
        `rows[${index}] audit relevance is mechanically derived from the primitive name`,
      );
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
  if (row.ownershipStatus === 'owned') {
    const ownerEvidence = evidence.filter(
      (item): item is BeadEvidence => item.kind === 'bead',
    );
    if (!ownerEvidence.some((item) => item.beadId === row.owningBead))
      fail(`rows[${index}] owningBead must be bound to bead evidence`);
  }
  return { ...row, evidence } as unknown as BootstrapCapabilityRow;
}

function fieldForRow(index: number): string {
  return `rows[${index}]`;
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
  const sourceRecord = records.find((recordValue) => {
    const record = objectRecord(recordValue);
    return (
      record?.key === evidence.sourceRecordKey &&
      record.source === evidence.sourceRef &&
      objectRecord(record.provenance)?.locator === evidence.locator
    );
  });
  if (!sourceRecord)
    fail(
      `${evidence.sourceRef} ${evidence.locator} does not identify a real source anchor`,
    );
  const sourceRecordObject = objectRecord(sourceRecord);
  const sourceData = objectRecord(sourceRecordObject?.data);
  if (!sourceData || Object.keys(sourceData).length === 0)
    fail(
      `${evidence.sourceRef} ${evidence.locator} does not contain source material`,
    );
  const projection = projectionSpecsById.get(evidence.projectionQueryId);
  if (!projection)
    fail(`unknown projection query ${evidence.projectionQueryId}`);
  const projectionEvidence: ReadinessArtifactEvidence = {
    kind: 'readiness-artifact',
    obligationId: 'obl:::pack:::executionReadiness:::projection-absence',
    obligationKind: 'source-span',
    queryId: `projection:${evidence.projectionQueryId}`,
    engine: projection.engine,
    hookSelector: projection.hookSelector,
    expected: 'absent-from-pack',
  };
  let scannedClauses = 0;
  for (const recordValue of records) {
    const record = objectRecord(recordValue);
    const clauses = objectRecord(
      objectRecord(record?.data)?.executionReadiness,
    )?.clauses;
    if (!Array.isArray(clauses)) continue;
    scannedClauses += clauses.length;
  }
  let projectionMatches: readonly ReadinessArtifactMatch[];
  try {
    projectionMatches = evaluateReadinessArtifact(projectionEvidence, records);
  } catch (cause) {
    fail(
      `${evidence.sourceRef} ${evidence.locator} has a projected clause: ${(cause as Error).message}`,
    );
  }
  if (projectionMatches.length > 0)
    fail(
      `${evidence.sourceRef} ${evidence.locator} has a projected clause at the expected identity`,
    );
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
  const roster = objectRecord(root.primitiveRoster);
  if (!roster) fail('primitiveRoster must be an object');
  if (roster.version !== PRIMITIVE_ROSTER_VERSION)
    fail(`primitiveRoster.version must be ${PRIMITIVE_ROSTER_VERSION}`);
  if (!Array.isArray(roster.entries))
    fail('primitiveRoster.entries must be an array');
  const rosterEntries = roster.entries.map((entry, index) => {
    if (
      !Array.isArray(entry) ||
      entry.length !== 2 ||
      typeof entry[0] !== 'string' ||
      typeof entry[1] !== 'string'
    )
      fail(
        `primitiveRoster.entries[${index}] must be [capabilityId, primitive]`,
      );
    return `${entry[0]}\0${entry[1]}`;
  });
  const canonicalRosterEntries = CANONICAL_PRIMITIVE_ROSTER.map(
    ([capabilityId, primitive]) => `${capabilityId}\0${primitive}`,
  );
  if (
    rosterEntries.length !== canonicalRosterEntries.length ||
    rosterEntries.some(
      (entry, index) => entry !== canonicalRosterEntries[index],
    )
  )
    fail('primitiveRoster does not match the committed canonical roster');
  const findingSubjects = objectRecord(root.auditFindingSubjects);
  if (!findingSubjects) fail('auditFindingSubjects must be an object');
  const subjectKeys = Object.keys(AUDIT_FINDING_SUBJECTS);
  if (
    Object.keys(findingSubjects).length !== subjectKeys.length ||
    subjectKeys.some(
      (alias) => findingSubjects[alias] !== AUDIT_FINDING_SUBJECTS[alias],
    )
  )
    fail('auditFindingSubjects does not match the committed finding registry');
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
  const auditRelevances = new Set<string>();
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
      if (item.kind === 'audit-finding') {
        if (auditRelevances.has(item.relevance))
          fail('audit relevance statements must be unique per row');
        auditRelevances.add(item.relevance);
      }
      if (item.kind !== 'readiness-artifact') continue;
      const owner = queryOwners.get(item.queryId);
      if (owner && owner !== row.primitive)
        fail(
          `queryId ${item.queryId} is ambiguously owned by ${owner} and ${row.primitive}`,
        );
      queryOwners.set(item.queryId, row.primitive);
    }
  }
  const rowRosterEntries = rows.map(
    (row) => `${row.capabilityId}\0${row.primitive}`,
  );
  if (
    rowRosterEntries.length !== canonicalRosterEntries.length ||
    rowRosterEntries.some((entry) => !canonicalRosterEntries.includes(entry))
  )
    fail('ledger rows do not exactly match the committed primitive roster');
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
        rows.flatMap((row) => [
          ...(row.owningBead ? [row.owningBead] : []),
          ...row.evidence
            .filter((item): item is BeadEvidence => item.kind === 'bead')
            .map((item) => item.beadId),
        ]),
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
