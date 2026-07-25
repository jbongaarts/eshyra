import type {
  Clause,
  ClauseDimensions,
  ClauseKind,
  MechanicsRecordFamily,
} from './types.js';

export type ClauseField =
  | 'identity'
  | 'sourceSpans'
  | 'provenance'
  | 'semanticOwner'
  | 'recordOwner'
  | 'kind'
  | 'trigger'
  | 'eligibility'
  | 'activationCost'
  | 'targets'
  | 'geometry'
  | 'checks'
  | 'attacks'
  | 'saves'
  | 'alternatives'
  | 'branches'
  | 'damage'
  | 'healing'
  | 'grants'
  | 'ledgerChanges'
  | 'stateTransitions'
  | 'duration'
  | 'recurrence'
  | 'repeatChecks'
  | 'immunityWindows'
  | 'termination'
  | 'executionOwner'
  | 'requiredEngineCapabilities'
  | 'readiness'
  | 'regressionEvidence';

export type BranchName = 'success' | 'failure' | 'partialSuccess';
export type DimensionName = keyof ClauseDimensions;

export interface ClauseCompletenessContract {
  readonly id: string;
  readonly kind: ClauseKind;
  readonly requiredFields: readonly ClauseField[];
  readonly requiredBranches: readonly BranchName[];
  readonly requiredDimensions: readonly DimensionName[];
}

export interface RecordFamilyCompletenessContract {
  readonly family: MechanicsRecordFamily;
  /** The clause kinds that the family-specific schema must account for. */
  readonly requiredClauseKinds: readonly ClauseKind[];
  /** The data contracts applied to clauses materialized into this family. */
  readonly clauseContracts: readonly string[];
}

const BASE_FIELDS: readonly ClauseField[] = [
  'identity',
  'sourceSpans',
  'provenance',
  'semanticOwner',
  'recordOwner',
  'kind',
  'executionOwner',
  'requiredEngineCapabilities',
  'readiness',
  'regressionEvidence',
];

const ALL_DIMENSIONS: readonly DimensionName[] = [
  'captured',
  'projected',
  'supported',
  'discoverable',
];

function contract(
  kind: ClauseKind,
  fields: readonly ClauseField[],
  requiredBranches: readonly BranchName[] = [],
): ClauseCompletenessContract {
  return {
    id: `clause:${kind}`,
    kind,
    requiredFields: [...BASE_FIELDS, ...fields],
    requiredBranches,
    requiredDimensions: ALL_DIMENSIONS,
  };
}

/**
 * Completeness contracts are executable data. A clause kind gets its own
 * required semantic slots; atom presence is never substituted for this
 * contract lookup.
 */
export const CLAUSE_COMPLETENESS_CONTRACTS: Readonly<
  Record<ClauseKind, ClauseCompletenessContract>
> = {
  attack: contract(
    'attack',
    [
      'trigger',
      'eligibility',
      'activationCost',
      'targets',
      'attacks',
      'damage',
      'branches',
    ],
    ['success', 'failure'],
  ),
  save: contract(
    'save',
    [
      'trigger',
      'eligibility',
      'activationCost',
      'targets',
      'saves',
      'damage',
      'branches',
    ],
    ['success', 'failure'],
  ),
  check: contract(
    'check',
    ['trigger', 'eligibility', 'checks', 'branches'],
    ['success', 'failure'],
  ),
  branch: contract('branch', ['branches'], ['success', 'failure']),
  'action-economy': contract('action-economy', [
    'activationCost',
    'trigger',
    'branches',
  ]),
  resource: contract('resource', [
    'activationCost',
    'ledgerChanges',
    'recurrence',
    'branches',
  ]),
  duration: contract(
    'duration',
    ['duration', 'termination', 'branches'],
    ['success', 'failure'],
  ),
  'state-transition': contract(
    'state-transition',
    ['trigger', 'stateTransitions', 'termination', 'branches'],
    ['success', 'failure'],
  ),
  geometry: contract('geometry', ['targets', 'geometry', 'branches']),
  choice: contract(
    'choice',
    ['eligibility', 'alternatives', 'branches'],
    ['success'],
  ),
  variant: contract(
    'variant',
    ['alternatives', 'stateTransitions', 'branches'],
    ['success'],
  ),
  'entity-lifecycle': contract(
    'entity-lifecycle',
    [
      'trigger',
      'grants',
      'duration',
      'termination',
      'stateTransitions',
      'branches',
    ],
    ['success', 'failure'],
  ),
  ledger: contract('ledger', ['ledgerChanges', 'branches']),
  'model-adjudication': contract(
    'model-adjudication',
    ['trigger', 'eligibility', 'targets', 'branches'],
    ['success', 'failure'],
  ),
};

const FAMILY_CONTRACT = (
  family: MechanicsRecordFamily,
  requiredClauseKinds: readonly ClauseKind[],
): RecordFamilyCompletenessContract => ({
  family,
  requiredClauseKinds,
  clauseContracts: requiredClauseKinds.map((kind) => `clause:${kind}`),
});

/**
 * Every mechanics-bearing record family has a schema contract. Records remain
 * materialized views: these entries describe the clause kinds they must group,
 * not a second record model.
 */
export const RECORD_FAMILY_COMPLETENESS_CONTRACTS: readonly RecordFamilyCompletenessContract[] =
  [
    FAMILY_CONTRACT('rule', ['check', 'branch', 'model-adjudication']),
    FAMILY_CONTRACT('feature', ['action-economy', 'resource', 'branch']),
    FAMILY_CONTRACT('spell', [
      'action-economy',
      'attack',
      'save',
      'duration',
      'branch',
    ]),
    FAMILY_CONTRACT('creature', [
      'attack',
      'save',
      'action-economy',
      'variant',
      'entity-lifecycle',
    ]),
    FAMILY_CONTRACT('hazard', [
      'check',
      'save',
      'geometry',
      'state-transition',
    ]),
    FAMILY_CONTRACT('equipment', ['choice', 'variant', 'ledger']),
    FAMILY_CONTRACT('magic-item', [
      'action-economy',
      'resource',
      'duration',
      'state-transition',
    ]),
    FAMILY_CONTRACT('ancestry', ['choice', 'variant', 'state-transition']),
    FAMILY_CONTRACT('background', ['choice', 'variant', 'ledger']),
    FAMILY_CONTRACT('condition', [
      'state-transition',
      'duration',
      'model-adjudication',
    ]),
    FAMILY_CONTRACT('action', [
      'action-economy',
      'attack',
      'save',
      'check',
      'branch',
    ]),
    FAMILY_CONTRACT('feat', ['choice', 'variant', 'action-economy', 'branch']),
    FAMILY_CONTRACT('class', [
      'choice',
      'resource',
      'state-transition',
      'variant',
    ]),
    FAMILY_CONTRACT('subclass', [
      'choice',
      'resource',
      'state-transition',
      'variant',
    ]),
    FAMILY_CONTRACT('table', ['choice', 'variant', 'ledger']),
  ];

export interface CompletenessReason {
  readonly code:
    | 'wrong-contract-kind'
    | 'missing-field'
    | 'missing-branch'
    | 'dimension-not-captured'
    | 'dimension-not-projected'
    | 'dimension-not-supported'
    | 'dimension-not-discoverable';
  readonly message: string;
  readonly field?: ClauseField;
  readonly branch?: BranchName;
  readonly dimension?: DimensionName;
}

export type CompletenessResult =
  | {
      readonly status: 'complete';
      readonly clauseId: string;
      readonly contractId: string;
      readonly dimensions: ClauseDimensions;
      readonly reasons: readonly [];
    }
  | {
      readonly status: 'incomplete';
      readonly clauseId: string;
      readonly contractId: string;
      readonly dimensions: ClauseDimensions;
      readonly reasons: readonly [CompletenessReason, ...CompletenessReason[]];
    };

function hasField(clause: Clause, field: ClauseField): boolean {
  const value = clause[field];
  if (field === 'sourceSpans') {
    return Array.isArray(value) && value.length > 0;
  }
  return value !== null && value !== undefined;
}

function dimensionReason(dimension: DimensionName): CompletenessReason {
  return {
    code: `dimension-not-${dimension}`,
    dimension,
    message: `clause is not ${dimension}`,
  } as CompletenessReason;
}

/** Evaluate a clause against its kind contract without consulting global state. */
export function evaluateClauseCompleteness(
  clause: Clause,
  completenessContract: ClauseCompletenessContract,
): CompletenessResult {
  const reasons: CompletenessReason[] = [];

  if (clause.kind !== completenessContract.kind) {
    reasons.push({
      code: 'wrong-contract-kind',
      message: `clause kind ${clause.kind} does not match ${completenessContract.kind}`,
    });
  }

  for (const field of completenessContract.requiredFields) {
    if (!hasField(clause, field)) {
      reasons.push({
        code: 'missing-field',
        field,
        message: `required ${field} field is absent`,
      });
    }
  }

  for (const branch of completenessContract.requiredBranches) {
    if (clause.branches[branch] === null) {
      reasons.push({
        code: 'missing-branch',
        branch,
        message: `required ${branch} branch is absent from the ${clause.kind} contract`,
      });
    }
  }

  for (const dimension of completenessContract.requiredDimensions) {
    if (!clause.readiness.dimensions[dimension]) {
      reasons.push(dimensionReason(dimension));
    }
  }

  if (reasons.length > 0) {
    return {
      status: 'incomplete',
      clauseId: clause.identity.id,
      contractId: completenessContract.id,
      dimensions: clause.readiness.dimensions,
      reasons: reasons as [CompletenessReason, ...CompletenessReason[]],
    };
  }

  return {
    status: 'complete',
    clauseId: clause.identity.id,
    contractId: completenessContract.id,
    dimensions: clause.readiness.dimensions,
    reasons: [],
  };
}

export function getClauseCompletenessContract(
  kind: ClauseKind,
): ClauseCompletenessContract {
  return CLAUSE_COMPLETENESS_CONTRACTS[kind];
}
