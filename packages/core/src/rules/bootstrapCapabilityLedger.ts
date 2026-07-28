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
export const CANONICAL_SEMANTIC_FACETS = [
  'save',
  'save-with-damage',
  'save-without-damage',
  'save-with-alternate-outcomes',
  'attack',
  'attack-with-one-damage-mode',
  'attack-with-conditional-alternatives',
  'check',
  'branch',
  'action-economy',
  'resource-use',
  'resource-with-reset',
  'resource-without-reset',
  'duration',
  'duration-with-concentration',
  'duration-without-concentration',
  'effect',
  'effect-with-lifecycle',
  'effect-without-lifecycle',
  'geometry',
  'choice',
  'variant',
  'entity-lifecycle',
  'ledger',
  'model-adjudication',
  'recurrence',
  'immunity-window',
  'repeat-check',
  'termination',
] as const;

export type SemanticFacet = (typeof CANONICAL_SEMANTIC_FACETS)[number];
export type EvidenceExpected =
  | 'non-empty'
  | 'absent-from-pack'
  | 'exists'
  | 'known';

export interface ObligationIdentity {
  readonly evidenceId: string;
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
  readonly obligationId: string;
  readonly sourceRef: string;
  readonly locator: string;
  readonly sourceRecordKey: string;
  readonly sourcePath: string;
  readonly sourceTerms: readonly string[];
  readonly projectionQueryId: string;
  readonly projectionShape: ProjectionShape;
  readonly expected: 'absent-from-pack';
}

export const PROJECTION_SHAPES = [
  'legendary-action-budget',
  'owned-entity-repeat-lifecycle',
  'spell-slot-upcast-procedure',
  'spellbook-copy-procedure',
  'containment-portal-card-pool',
  'suffocation-ongoing-damage',
  'planar-return-window-clock',
  'multi-save-ability-choice',
  'point-origin-area-geometry',
  'damage-rider-half-damage-branch',
  'downtime-study-training-ledger',
  'retained-asset-creation',
] as const;

export type ProjectionShape = (typeof PROJECTION_SHAPES)[number];

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
  readonly status: 'satisfied' | 'evidence-underived' | 'skipped';
  readonly matches?: readonly ReadinessArtifactMatch[];
  readonly scannedRecords?: number;
  readonly scannedClauses?: number;
  readonly projectionMatches?: readonly ProjectionMatch[];
  readonly reason?: string;
}

export interface ProjectionMatch {
  readonly recordKey: string;
  readonly clauseId?: string;
  readonly path: string;
  readonly signals: readonly string[];
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
  readonly auditFindingPrimitiveRelations: Readonly<
    Record<string, readonly string[]>
  >;
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
const EVIDENCE_ID = /^ev:::.+:::.+:::.+$/;
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

export const AUDIT_FINDING_PRIMITIVE_RELATIONS: Readonly<
  Record<string, readonly string[]>
> = {
  'indep:002': ['seeded-selection-and-roll-replacement'],
  'indep:005': [
    'caster-of-record-and-canonical-spell-execution',
    'spell-slot-gate-and-upcast-transform',
  ],
  'fable:F2': ['point-origin-area-geometry-and-targeting'],
  'fable:F3': [
    'suffocation-and-ongoing-damage-state',
    'damage-rider-and-half-damage-branch-resolution',
  ],
  'opus:F-02': ['capacity-and-variant-arithmetic'],
  'opus:F-04': [
    'recharge-and-reset-scheduling',
    'long-rest-reset-orchestration',
  ],
  'opus:F-12': ['save-dc-and-spell-attack-modifier-resolution'],
  'opus:F-26': ['legendary-action-allowance-and-option-cost'],
  'opus:F-32': ['multi-save-and-ability-choice-outcomes'],
  'opus:F-35': ['forced-movement-contest-and-object-interaction'],
  'sol:CAP-001': ['active-effect-duration-and-termination'],
  'sol:CAP-002': [
    'condition-and-eligibility-relations',
    'turn-action-and-free-interaction-budget',
    'reaction-and-item-activation-ownership',
  ],
  'sol:CAP-004': [
    'concentration-owner-and-damage-save',
    'owned-entity-and-repeat-trigger-lifecycle',
    'hp-healing-and-temporary-buffer',
    'death-save-dying-and-stable-transitions',
  ],
  'sol:CAP-007': [
    'per-instance-usage-and-charge-spend',
    'attunement-curse-and-identity-constraints',
    'containment-portal-and-card-pool-instance-state',
    'planar-return-and-declared-window-clocks',
    'retained-inventory-property-xp-asset-creation',
  ],
};

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

const PROJECTION_SHAPE_BY_PRIMITIVE: Readonly<Record<string, ProjectionShape>> =
  {
    'legendary-action-allowance-and-option-cost': 'legendary-action-budget',
    'owned-entity-and-repeat-trigger-lifecycle':
      'owned-entity-repeat-lifecycle',
    'spell-slot-gate-and-upcast-transform': 'spell-slot-upcast-procedure',
    'spellbook-copy-cost-and-asset-ledger': 'spellbook-copy-procedure',
    'containment-portal-and-card-pool-instance-state':
      'containment-portal-card-pool',
    'suffocation-and-ongoing-damage-state': 'suffocation-ongoing-damage',
    'planar-return-and-declared-window-clocks': 'planar-return-window-clock',
    'multi-save-and-ability-choice-outcomes': 'multi-save-ability-choice',
    'point-origin-area-geometry-and-targeting': 'point-origin-area-geometry',
    'damage-rider-and-half-damage-branch-resolution':
      'damage-rider-half-damage-branch',
    'downtime-study-expense-and-training-ledger':
      'downtime-study-training-ledger',
    'retained-inventory-property-xp-asset-creation': 'retained-asset-creation',
  };

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

function validateEvidenceIdentity(
  value: Record<string, unknown>,
  field: string,
): void {
  requiredString(value.evidenceId, `${field}.evidenceId`);
  if (!EVIDENCE_ID.test(value.evidenceId))
    fail(`${field}.evidenceId must use the ev::: evidence namespace`);
  const segments = value.evidenceId.split(':::');
  if (
    segments.length !== 4 ||
    segments.some((segment) => segment.trim() === '')
  )
    fail(`${field}.evidenceId must have four non-empty segments`);
}

function validateSourceObligation(
  value: Record<string, unknown>,
  field: string,
  evidence: KnownMissingSourceClauseEvidence,
): void {
  requiredString(value.obligationId, `${field}.obligationId`);
  if (!OBLIGATION_ID.test(value.obligationId))
    fail(
      `${field}.obligationId must use the obl::: source-obligation namespace`,
    );
  const segments = value.obligationId.split(':::');
  if (
    segments.length !== 4 ||
    segments.some((segment) => segment.trim() === '') ||
    !CANONICAL_SEMANTIC_FACETS.includes(segments[3] as SemanticFacet)
  )
    fail(`${field}.obligationId must have a canonical semantic facet`);
  if (segments[1] !== evidence.sourceRef || segments[2] !== evidence.locator)
    fail(
      `${field}.obligationId diverges from its authoritative source evidence`,
    );
}

function validateReadinessEvidence(
  value: Record<string, unknown>,
  field: string,
): ReadinessArtifactEvidence {
  validateEvidenceIdentity(value, field);
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
  if ('obligationKind' in evidence)
    fail(`${field} uses the retired obligationKind evidence field`);
  if (
    evidence.kind !== 'known-missing-source-clause' &&
    'obligationId' in evidence
  )
    fail(`${field} invents a source obligation for an evidence item`);
  switch (evidence.kind) {
    case 'readiness-artifact':
      return validateReadinessEvidence(evidence, field);
    case 'code':
      validateEvidenceIdentity(evidence, field);
      requiredString(evidence.module, `${field}.module`);
      requiredString(evidence.symbol, `${field}.symbol`);
      if (evidence.expected !== 'exists')
        fail(`${field}.expected must be exists`);
      if (evidence.module.includes('..') || evidence.module.startsWith('/'))
        fail(`${field}.module must be @eshyra/core-relative`);
      return evidence as unknown as CodeEvidence;
    case 'bead':
      validateEvidenceIdentity(evidence, field);
      requiredString(evidence.beadId, `${field}.beadId`);
      if (!BEAD_ID.test(evidence.beadId)) fail(`${field}.beadId is invalid`);
      if (evidence.expected !== 'exists')
        fail(`${field}.expected must be exists`);
      return evidence as unknown as BeadEvidence;
    case 'audit-finding':
      validateEvidenceIdentity(evidence, field);
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
      validateEvidenceIdentity(evidence, field);
      requiredString(evidence.sourceRef, `${field}.sourceRef`);
      requiredString(evidence.locator, `${field}.locator`);
      requiredString(evidence.sourceRecordKey, `${field}.sourceRecordKey`);
      requiredString(evidence.sourcePath, `${field}.sourcePath`);
      requiredStringArray(evidence.sourceTerms, `${field}.sourceTerms`);
      requiredString(evidence.projectionQueryId, `${field}.projectionQueryId`);
      requiredString(evidence.projectionShape, `${field}.projectionShape`);
      validateSourceObligation(
        evidence,
        field,
        evidence as unknown as KnownMissingSourceClauseEvidence,
      );
      if (!projectionSpecsById.has(evidence.projectionQueryId))
        fail(`${field}.projectionQueryId is not registered`);
      if (
        !Object.values(PROJECTION_SHAPE_BY_PRIMITIVE).includes(
          evidence.projectionShape as ProjectionShape,
        )
      )
        fail(`${field}.projectionShape is not registered`);
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
  const readiness = evidence.filter(
    (item): item is ReadinessArtifactEvidence =>
      item.kind === 'readiness-artifact',
  );
  const queryIds = new Set<string>();
  for (const item of evidence) {
    if (
      item.kind !== 'readiness-artifact' &&
      item.kind !== 'known-missing-source-clause'
    )
      continue;
    const queryId =
      item.kind === 'readiness-artifact'
        ? item.queryId
        : item.projectionQueryId;
    if (queryIds.has(queryId))
      fail(`${fieldForRow(index)} repeats queryId ${queryId}`);
    queryIds.add(queryId);
  }
  for (const item of readiness) {
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
    const expectedShape = PROJECTION_SHAPE_BY_PRIMITIVE[row.primitive];
    if (!expectedShape || item.projectionShape !== expectedShape)
      fail(
        `rows[${index}] known-missing projection shape is not the registered semantic query`,
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
    if (
      !AUDIT_FINDING_PRIMITIVE_RELATIONS[item.findingAlias]?.includes(
        row.primitive as string,
      )
    )
      fail(
        `rows[${index}] audit finding ${item.findingAlias} is not reviewed as relevant to ${row.primitive}`,
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

interface ProjectionNode {
  readonly recordKey: string;
  readonly path: string;
  readonly pathSegments: readonly string[];
  readonly value: unknown;
  readonly clauseId?: string;
}

interface ProjectionShapeDefinition {
  readonly description: string;
  readonly applicable: (
    node: ProjectionNode,
    nodes: readonly ProjectionNode[],
  ) => boolean;
  readonly recognized: (
    node: ProjectionNode,
    nodes: readonly ProjectionNode[],
  ) => boolean;
}

// These are provenance, prose, and evaluator bookkeeping fields. They cannot
// carry any of the twelve source-negative semantic shapes. Everything else is
// deliberately left unclassified unless a shape predicate claims it; an
// unregistered field is therefore evidence-underived rather than silently
// treated as absent.
const REGISTERED_IRRELEVANT_PATH_SEGMENTS = new Set([
  'data',
  'description',
  'text',
  'sourceText',
  'prompt',
  'note',
  'clauseId',
  'engineHooks',
  'engine',
  'hook',
  'name',
  'source',
  'sourceSpan',
  'locator',
  'executionReadiness',
  'clauses',
]);

function pathSegments(path: string): readonly string[] {
  return path
    .split(/[.[\]]/u)
    .filter((segment) => segment.length > 0 && !/^\d+$/u.test(segment));
}

function pathHasSuffix(
  node: ProjectionNode,
  suffix: readonly string[],
): boolean {
  return (
    node.pathSegments.length >= suffix.length &&
    suffix.every(
      (segment, index) =>
        node.pathSegments[node.pathSegments.length - suffix.length + index] ===
        segment,
    )
  );
}

function pathKey(node: ProjectionNode): string {
  return node.pathSegments[node.pathSegments.length - 1] ?? '';
}

function nodeValueObject(
  node: ProjectionNode,
): Record<string, unknown> | undefined {
  return objectRecord(node.value);
}

function nodeField(node: ProjectionNode, key: string): unknown {
  return nodeValueObject(node)?.[key];
}

function hasAnyOwnKey(value: unknown, keys: readonly string[]): boolean {
  const object = objectRecord(value);
  return object ? keys.some((key) => Object.hasOwn(object, key)) : false;
}

function stringField(value: unknown, key: string): string | undefined {
  const object = objectRecord(value);
  return typeof object?.[key] === 'string' ? object[key] : undefined;
}

function numericField(value: unknown, key: string): boolean {
  const object = objectRecord(value);
  return typeof object?.[key] === 'number' && Number.isFinite(object[key]);
}

function nodeHasExactPathKey(
  node: ProjectionNode,
  keys: readonly string[],
): boolean {
  return keys.includes(pathKey(node));
}

function nodeHasBlock(
  node: ProjectionNode,
  blocks: readonly string[],
): boolean {
  const value = nodeValueObject(node);
  return (
    pathKey(node) === 'representation' &&
    blocks.includes(stringField(value, 'block') ?? '')
  );
}

function nodeHasExactValue(
  node: ProjectionNode,
  key: string,
  values: readonly string[],
): boolean {
  return values.includes(stringField(nodeValueObject(node), key) ?? '');
}

function projectionShapeDefinition(
  shape: ProjectionShape,
): ProjectionShapeDefinition {
  switch (shape) {
    case 'legendary-action-budget':
      return {
        description: 'legendary action budget or option cost',
        applicable: (node) =>
          nodeHasExactPathKey(node, [
            'legendaryActions',
            'legendaryBudget',
            'legendaryActionBudget',
            'legendaryOptions',
            'legendaryActionOptions',
          ]) ||
          nodeHasBlock(node, [
            'legendaryActions',
            'legendaryActionBudget',
            'legendaryActionOptions',
          ]),
        recognized: (node, nodes) =>
          (nodeHasExactPathKey(node, ['legendaryActions']) &&
            Array.isArray(nodeField(node, 'entries'))) ||
          (nodeHasExactPathKey(node, [
            'legendaryBudget',
            'legendaryActionBudget',
          ]) &&
            (numericField(node.value, 'points') ||
              numericField(node.value, 'total') ||
              numericField(node.value, 'perRound')) &&
            nodes.some(
              (candidate) =>
                nodeHasExactPathKey(candidate, [
                  'legendaryOptions',
                  'legendaryActionOptions',
                ]) && numericField(candidate.value, 'points'),
            )) ||
          (nodeHasExactPathKey(node, ['usage']) &&
            numericField(node.value, 'legendaryActionCost')),
      };
    case 'owned-entity-repeat-lifecycle':
      return {
        description: 'owned entity or repeat-trigger lifecycle',
        applicable: (node) =>
          nodeHasExactPathKey(node, [
            'ownedEntity',
            'ownedEntities',
            'entityLifecycle',
            'repeatTrigger',
            'repeatTriggers',
            'deathTrigger',
            'controller',
            'createdBy',
          ]) ||
          hasAnyOwnKey(node.value, [
            'owner',
            'controller',
            'createdBy',
            'repeatTrigger',
            'deathTrigger',
            'lifecycle',
            'recurrence',
            'transitions',
          ]),
        recognized: (node) =>
          hasAnyOwnKey(node.value, [
            'owner',
            'controller',
            'createdBy',
            'repeatTrigger',
            'deathTrigger',
            'lifecycle',
            'recurrence',
            'transitions',
          ]),
      };
    case 'spell-slot-upcast-procedure':
      return {
        description: 'spell-slot gate or upcast transform',
        applicable: (node) =>
          nodeHasExactPathKey(node, [
            'spellStore',
            'spellSlots',
            'spellSlot',
            'spellcastingProgression',
            'slotLevel',
            'upcast',
            'castLevel',
            'higherLevels',
          ]) ||
          nodeHasBlock(node, ['spellStore', 'spellSlots', 'spellcasting']),
        recognized: (node) =>
          nodeHasExactPathKey(node, ['spellStore']) ||
          hasAnyOwnKey(node.value, [
            'spellSlots',
            'slotLevel',
            'upcast',
            'castLevel',
            'higherLevels',
          ]),
      };
    case 'spellbook-copy-procedure':
      return {
        description: 'spellbook copy, time, cost, or asset ledger',
        applicable: (node) =>
          nodeHasExactPathKey(node, [
            'spellbook',
            'spellBook',
            'spellbookCopy',
            'copyingProcedure',
            'scrollCopyingProcedure',
          ]) ||
          nodeHasExactValue(node, 'id', [
            'scroll-copying-procedure',
            'spellbook-copy-procedure',
          ]) ||
          nodeHasBlock(node, ['spellbook', 'spellbookCopy']) ||
          (pathKey(node) === 'effects' &&
            nodeField(node, 'kind') === 'makeAbilityCheck' &&
            nodeField(node, 'skill') === 'arcana'),
        recognized: (node) =>
          nodeHasExactValue(node, 'id', [
            'scroll-copying-procedure',
            'spellbook-copy-procedure',
          ]) ||
          (nodeField(node, 'kind') === 'makeAbilityCheck' &&
            nodeField(node, 'skill') === 'arcana'),
      };
    case 'containment-portal-card-pool':
      return {
        description: 'containment, portal, or card-pool state',
        applicable: (node) =>
          nodeHasExactPathKey(node, [
            'containment',
            'interItem',
            'nestingHazard',
            'portal',
            'cardPool',
            'drawPool',
            'remainingCardIds',
            'occupancy',
          ]) || nodeHasBlock(node, ['containment', 'cardPool']),
        recognized: (node) =>
          nodeHasExactPathKey(node, ['containment', 'interItem']) ||
          hasAnyOwnKey(node.value, [
            'tracksOccupancy',
            'nestingHazard',
            'portal',
            'remainingCardIds',
          ]),
      };
    case 'suffocation-ongoing-damage':
      return {
        description: 'suffocation or ongoing-damage state',
        applicable: (node) =>
          nodeHasExactPathKey(node, [
            'suffocation',
            'suffocating',
            'airMinutes',
            'oxygen',
            'breath',
            'ongoingDamage',
          ]),
        recognized: (node) =>
          nodeHasExactPathKey(node, ['suffocation', 'ongoingDamage']) ||
          hasAnyOwnKey(node.value, [
            'airMinutes',
            'dividedByOccupants',
            'minimumMinutes',
            'hitPoints',
            'damagePerRound',
            'dropsToZeroHitPoints',
          ]),
      };
    case 'planar-return-window-clock':
      return {
        description: 'planar return or declared-window clock',
        applicable: (node) =>
          nodeHasExactPathKey(node, [
            'planarTravel',
            'planarReturn',
            'returnWindow',
            'declaredWindow',
            'deadline',
            'clock',
          ]) ||
          (nodeHasExactPathKey(node, ['containment']) &&
            stringField(node.value, 'mode') === 'planar-travel') ||
          nodeHasBlock(node, ['planarTravel', 'containment']),
        recognized: (node) =>
          stringField(node.value, 'mode') === 'planar-travel' ||
          hasAnyOwnKey(node.value, [
            'deadline',
            'returnWindow',
            'declaredWindow',
            'destination',
            'clock',
          ]),
      };
    case 'multi-save-ability-choice':
      return {
        description: 'multi-save or ability-choice outcome',
        applicable: (node) =>
          nodeHasExactPathKey(node, [
            'multiSave',
            'multipleSaves',
            'abilityChoice',
            'alternateOutcomes',
            'saveAbilities',
          ]) ||
          (nodeHasExactPathKey(node, ['saves']) &&
            (pathHasSuffix(node, ['actions', 'mechanics', 'saves']) ||
              pathHasSuffix(node, ['traits', 'mechanics', 'saves']))),
        recognized: (node) =>
          Array.isArray(node.value) ||
          hasAnyOwnKey(node.value, [
            'abilities',
            'choice',
            'alternateOutcomes',
            'onSuccess',
            'onFailure',
          ]),
      };
    case 'point-origin-area-geometry':
      return {
        description: 'point-origin area geometry or targeting',
        applicable: (node) =>
          nodeHasExactPathKey(node, [
            'geometry',
            'area',
            'areaShape',
            'origin',
            'pointOfOrigin',
            'targeting',
            'lineOfEffect',
          ]) || nodeHasBlock(node, ['geometry', 'targeting', 'area']),
        recognized: (node) =>
          hasAnyOwnKey(node.value, [
            'origin',
            'pointOfOrigin',
            'shape',
            'lineOfEffect',
            'targets',
            'range',
          ]),
      };
    case 'damage-rider-half-damage-branch':
      return {
        description: 'damage rider or half-damage branch',
        applicable: (node) =>
          nodeHasExactPathKey(node, [
            'damageRider',
            'halfDamage',
            'successBranch',
            'damageBranch',
            'rider',
          ]) ||
          (nodeHasExactPathKey(node, ['mechanics']) &&
            Array.isArray(nodeField(node, 'damage')) &&
            (Array.isArray(nodeField(node, 'saves')) ||
              Array.isArray(nodeField(node, 'effects')) ||
              Array.isArray(nodeField(node, 'conditions')))),
        recognized: (node) =>
          hasAnyOwnKey(node.value, [
            'halfDamage',
            'successBranch',
            'failureBranch',
            'damageRider',
            'rider',
          ]) ||
          (Array.isArray(nodeField(node, 'damage')) &&
            (Array.isArray(nodeField(node, 'saves')) ||
              Array.isArray(nodeField(node, 'effects')))),
      };
    case 'downtime-study-training-ledger':
      return {
        description: 'downtime study, expense, or training ledger',
        applicable: (node) =>
          nodeHasExactPathKey(node, [
            'downtime',
            'study',
            'training',
            'research',
            'workWindow',
            'downtimeActivity',
          ]) ||
          nodeHasBlock(node, ['downtime', 'study', 'training']) ||
          (nodeHasExactPathKey(node, ['representation']) &&
            stringField(node.value, 'economyId') === 'study'),
        recognized: (node) =>
          nodeHasExactPathKey(node, ['study', 'training', 'workWindow']) ||
          hasAnyOwnKey(node.value, [
            'days',
            'dayCount',
            'expense',
            'benefit',
            'budget',
            'reset',
          ]),
      };
    case 'retained-asset-creation':
      return {
        description: 'retained asset or property creation',
        applicable: (node) =>
          nodeHasExactPathKey(node, [
            'stateMachine',
            'realizedObject',
            'assetCreation',
            'retainedAsset',
            'assetLedger',
          ]) ||
          (nodeHasExactPathKey(node, ['effects']) &&
            stringField(node.value, 'kind') === 'objectInteraction') ||
          nodeHasBlock(node, ['stateMachine', 'assetCreation']),
        recognized: (node) =>
          nodeHasExactPathKey(node, ['stateMachine', 'assetCreation']) ||
          (stringField(node.value, 'kind') === 'objectInteraction' &&
            hasAnyOwnKey(node.value, [
              'result',
              'maximumValueGp',
              'energyResult',
            ])),
      };
  }
}

function projectionNodes(
  value: unknown,
  path: string,
  recordKey: string,
): readonly ProjectionNode[] {
  const nodes: ProjectionNode[] = [];
  const visit = (current: unknown, currentPath: string): void => {
    const currentObject = objectRecord(current);
    nodes.push({
      recordKey,
      path: currentPath,
      pathSegments: pathSegments(currentPath),
      value: current,
      clauseId:
        typeof currentObject?.clauseId === 'string'
          ? currentObject.clauseId
          : undefined,
    });
    if (Array.isArray(current)) {
      current.forEach((item, index) => {
        visit(item, `${currentPath}[${index}]`);
      });
      return;
    }
    const object = objectRecord(current);
    if (!object) return;
    for (const [key, child] of Object.entries(object)) {
      visit(child, `${currentPath}.${key}`);
    }
  };
  visit(value, path);
  return nodes;
}

function isRegisteredIrrelevantProjection(node: ProjectionNode): boolean {
  return (
    node.path === 'data' ||
    REGISTERED_IRRELEVANT_PATH_SEGMENTS.has(pathKey(node))
  );
}

function projectionShapeSignals(
  shape: ProjectionShape,
  nodes: readonly ProjectionNode[],
): readonly ProjectionMatch[] {
  const definition = projectionShapeDefinition(shape);
  const applicable = nodes.filter((node) => definition.applicable(node, nodes));
  const recognized = applicable.some((node) =>
    definition.recognized(node, nodes),
  );
  const applicableMatches = applicable.map((node) => ({
    recordKey: node.recordKey,
    clauseId: node.clauseId,
    path: node.path,
    signals: [
      recognized
        ? definition.description
        : `unrecognized applicable ${shape} projection`,
    ],
  }));
  const unclassifiedMatches = nodes
    .filter(
      (node) =>
        !definition.applicable(node, nodes) &&
        !isRegisteredIrrelevantProjection(node),
    )
    .map((node) => ({
      recordKey: node.recordKey,
      clauseId: node.clauseId,
      path: node.path,
      signals: [`unclassified ${shape} projection`],
    }));
  return [...applicableMatches, ...unclassifiedMatches];
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
        evidenceId: 'ev:::validation:::bead:::exists',
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
  if (!sourceRecordObject) fail('source anchor is not an object');
  const sourceData = objectRecord(sourceRecordObject?.data);
  if (!sourceData || Object.keys(sourceData).length === 0)
    fail(
      `${evidence.sourceRef} ${evidence.locator} does not contain source material`,
    );
  const sourceValue = readPath(sourceRecordObject, evidence.sourcePath);
  if (sourceValue === undefined || sourceValue === null)
    fail(
      `${evidence.sourceRef} ${evidence.locator} has no source material at ${evidence.sourcePath}`,
    );
  const sourceText = JSON.stringify(sourceValue);
  if (!evidence.sourceTerms.every((term) => sourceText.includes(term)))
    fail(
      `${evidence.sourceRef} ${evidence.locator} source anchor does not contain its recorded source terms`,
    );
  let scannedClauses = 0;
  for (const recordValue of records) {
    const record = objectRecord(recordValue);
    const clauses = objectRecord(
      objectRecord(record?.data)?.executionReadiness,
    )?.clauses;
    if (Array.isArray(clauses)) scannedClauses += clauses.length;
  }
  const projectionMatches: ProjectionMatch[] = [];
  for (const recordValue of records) {
    const record = objectRecord(recordValue);
    if (!record) continue;
    requiredString(record.key, 'pack record.key');
    const data = objectRecord(record.data);
    if (!data) continue;
    projectionMatches.push(
      ...projectionShapeSignals(
        evidence.projectionShape,
        projectionNodes(data, 'data', record.key),
      ),
    );
  }
  if (scannedClauses === 0)
    fail(
      `${evidence.projectionQueryId} could not inspect any projected clauses`,
    );
  return {
    evidence,
    status: projectionMatches.length === 0 ? 'satisfied' : 'evidence-underived',
    scannedRecords: records.length,
    scannedClauses,
    projectionMatches,
    reason:
      projectionMatches.length === 0
        ? undefined
        : 'an applicable or unclassified structured projection is present; absence is not provable',
  };
}

function readPath(value: Record<string, unknown>, path: string): unknown {
  let current: unknown = value;
  for (const segment of path.split('.')) {
    if (current === null || typeof current !== 'object') return undefined;
    if (/^\d+$/.test(segment)) {
      if (!Array.isArray(current)) return undefined;
      current = current[Number(segment)];
    } else {
      current = (current as Record<string, unknown>)[segment];
    }
  }
  return current;
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

export interface BootstrapLedgerClosureBlocker {
  readonly rowIdentity: string;
  readonly evidenceId: string;
  readonly projectionQueryId?: string;
  readonly reason: string;
}

export interface BootstrapLedgerClosure {
  readonly ready: boolean;
  readonly blockers: readonly BootstrapLedgerClosureBlocker[];
}

export function assessBootstrapLedgerClosure(
  resolutions: readonly EvidenceResolution[],
  rowByEvidenceId?: ReadonlyMap<string, BootstrapCapabilityRow>,
): BootstrapLedgerClosure {
  const blockers = resolutions.flatMap((resolution) => {
    if (resolution.status !== 'evidence-underived') return [];
    const evidence = resolution.evidence;
    const row = rowByEvidenceId?.get(evidence.evidenceId);
    return [
      {
        rowIdentity: row
          ? `${row.capabilityId}/${row.primitive}`
          : evidence.evidenceId,
        evidenceId: evidence.evidenceId,
        projectionQueryId:
          evidence.kind === 'known-missing-source-clause'
            ? evidence.projectionQueryId
            : undefined,
        reason:
          resolution.reason ??
          'evidence-underived source-negative proof blocks closure',
      },
    ];
  });
  return { ready: blockers.length === 0, blockers };
}

export function evaluateBootstrapLedgerClosure(
  ledger: BootstrapCapabilityLedger,
  records: readonly unknown[],
): BootstrapLedgerClosure {
  const rowByEvidenceId = new Map(
    ledger.rows.flatMap((row) =>
      row.evidence.map((evidence) => [evidence.evidenceId, row] as const),
    ),
  );
  return assessBootstrapLedgerClosure(
    ledger.rows.flatMap((row) => evaluateRowEvidence(row, records)),
    rowByEvidenceId,
  );
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
  const findingRelations = objectRecord(root.auditFindingPrimitiveRelations);
  if (!findingRelations)
    fail('auditFindingPrimitiveRelations must be an object');
  const relationKeys = Object.keys(AUDIT_FINDING_PRIMITIVE_RELATIONS);
  if (
    Object.keys(findingRelations).length !== relationKeys.length ||
    relationKeys.some((alias) => {
      const actual = findingRelations[alias];
      const expected = AUDIT_FINDING_PRIMITIVE_RELATIONS[alias];
      return (
        !Array.isArray(actual) ||
        actual.length !== expected.length ||
        actual.some((primitive, index) => primitive !== expected[index])
      );
    })
  )
    fail(
      'auditFindingPrimitiveRelations does not match the reviewed finding registry',
    );
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
  const evidenceIds = new Set<string>();
  const sourceObligationIds = new Set<string>();
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
      if (evidenceIds.has(item.evidenceId))
        fail(`duplicate evidence identity registry-wide: ${item.evidenceId}`);
      evidenceIds.add(item.evidenceId);
      if (item.kind === 'known-missing-source-clause') {
        if (sourceObligationIds.has(item.obligationId))
          fail(
            `duplicate source obligation identity registry-wide: ${item.obligationId}`,
          );
        sourceObligationIds.add(item.obligationId);
      }
      if (item.kind === 'audit-finding') {
        if (auditRelevances.has(item.relevance))
          fail('audit relevance statements must be unique per row');
        auditRelevances.add(item.relevance);
      }
      if (
        item.kind !== 'readiness-artifact' &&
        item.kind !== 'known-missing-source-clause'
      )
        continue;
      const queryId =
        item.kind === 'readiness-artifact'
          ? item.queryId
          : item.projectionQueryId;
      const owner = queryOwners.get(queryId);
      if (owner && owner !== row.primitive)
        fail(
          `queryId ${queryId} is ambiguously owned by ${owner} and ${row.primitive}`,
        );
      queryOwners.set(queryId, row.primitive);
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
