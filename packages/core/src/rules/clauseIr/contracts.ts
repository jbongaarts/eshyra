import type {
  BranchName,
  Clause,
  ClauseDimensions,
  ClauseField,
  ClauseKind,
  ClauseRequirement,
  ClauseRequirementPredicate,
  MechanicsRecordFamily,
  SourceObligation,
} from './types.js';

export type {
  BranchName,
  ClauseField,
  ClauseRequirement,
  ClauseRequirementPredicate,
} from './types.js';
export type DimensionName = keyof ClauseDimensions;

export interface ClauseCompletenessContract {
  readonly id: string;
  readonly kind: ClauseKind;
  readonly requirements: readonly ClauseRequirement[];
}

export interface RecordFamilyCompletenessContract {
  readonly family: MechanicsRecordFamily;
  /** The clause kinds that the family-specific schema must account for. */
  readonly requiredClauseKinds: readonly ClauseKind[];
  /** The data contracts applied to clauses materialized into this family. */
  readonly clauseContracts: readonly string[];
}

const field = (
  id: string,
  fieldName: ClauseField,
  cardinality: 'present' | 'non-empty',
  sourceText = `the ${fieldName} is represented`,
): ClauseRequirement => ({
  id,
  sourceText,
  predicate: { kind: 'field', field: fieldName, cardinality },
});

const present = (fieldName: ClauseField): ClauseRequirement =>
  field(`field:${fieldName}`, fieldName, 'present');

const nonEmpty = (fieldName: ClauseField): ClauseRequirement =>
  field(`field:${fieldName}:non-empty`, fieldName, 'non-empty');

const branch = (branchName: BranchName): ClauseRequirement => ({
  id: `branch:${branchName}`,
  sourceText: `the ${branchName} outcome is represented`,
  predicate: { kind: 'branch', branch: branchName },
});

const fieldGroup = (
  id: string,
  fields: readonly ClauseField[],
  minCount: number,
  maxCount?: number,
): ClauseRequirement => ({
  id,
  sourceText: `one of ${fields.join(', ')} is represented`,
  predicate: { kind: 'field-group', fields, minCount, maxCount },
});

const BASE_REQUIREMENTS: readonly ClauseRequirement[] = [
  present('identity'),
  nonEmpty('sourceSpans'),
  present('provenance'),
  present('semanticOwner'),
  present('recordOwner'),
  present('kind'),
  nonEmpty('sourceObligations'),
  present('executionOwner'),
  present('requiredEngineCapabilities'),
  present('readiness'),
  nonEmpty('regressionEvidence'),
];

function contract(
  kind: ClauseKind,
  requirements: readonly ClauseRequirement[],
): ClauseCompletenessContract {
  return {
    id: `clause:${kind}`,
    kind,
    requirements: [...BASE_REQUIREMENTS, ...requirements],
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
  attack: contract('attack', [
    present('trigger'),
    present('eligibility'),
    present('activationCost'),
    present('targets'),
    fieldGroup('attack-or-save', ['attacks', 'saves'], 1, 1),
    nonEmpty('damage'),
    branch('success'),
    branch('failure'),
  ]),
  save: contract('save', [
    present('trigger'),
    present('eligibility'),
    present('activationCost'),
    present('targets'),
    nonEmpty('saves'),
    nonEmpty('damage'),
    branch('success'),
    branch('failure'),
  ]),
  check: contract('check', [
    present('trigger'),
    present('eligibility'),
    nonEmpty('checks'),
    branch('success'),
    branch('failure'),
  ]),
  branch: contract('branch', [branch('success'), branch('failure')]),
  'action-economy': contract('action-economy', [
    present('activationCost'),
    present('trigger'),
  ]),
  resource: contract('resource', [
    present('activationCost'),
    nonEmpty('ledgerChanges'),
    present('recurrence'),
  ]),
  duration: contract('duration', [
    present('duration'),
    present('termination'),
    branch('success'),
    branch('failure'),
  ]),
  'state-transition': contract('state-transition', [
    present('trigger'),
    nonEmpty('stateTransitions'),
    present('termination'),
    branch('success'),
    branch('failure'),
  ]),
  geometry: contract('geometry', [present('targets'), present('geometry')]),
  choice: contract('choice', [
    present('eligibility'),
    nonEmpty('alternatives'),
    branch('success'),
  ]),
  variant: contract('variant', [
    nonEmpty('alternatives'),
    nonEmpty('stateTransitions'),
    branch('success'),
  ]),
  'entity-lifecycle': contract('entity-lifecycle', [
    present('trigger'),
    nonEmpty('grants'),
    present('duration'),
    present('termination'),
    nonEmpty('stateTransitions'),
    branch('success'),
    branch('failure'),
  ]),
  ledger: contract('ledger', [nonEmpty('ledgerChanges')]),
  'model-adjudication': contract('model-adjudication', [
    present('trigger'),
    present('eligibility'),
    present('targets'),
    branch('success'),
    branch('failure'),
  ]),
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
    | 'missing-source-obligation'
    | 'unbound-source-obligation'
    | 'unknown-source-contract'
    | 'missing-field'
    | 'empty-required-collection'
    | 'unsatisfied-alternative'
    | 'missing-branch'
    | 'dimension-not-captured'
    | 'dimension-not-projected';
  readonly message: string;
  readonly obligationId?: string;
  readonly requirementId?: string;
  readonly sourceText?: string;
  readonly predicate?: ClauseRequirementPredicate;
  readonly field?: ClauseField;
  readonly branch?: BranchName;
}

export interface DimensionEvaluation {
  readonly status: 'satisfied' | 'failed';
}

export type ReadinessEvaluation = Readonly<
  Record<DimensionName, DimensionEvaluation>
>;

export type SemanticEvaluation =
  | {
      readonly status: 'complete';
      readonly reasons: readonly [];
    }
  | {
      readonly status: 'incomplete';
      readonly reasons: readonly [CompletenessReason, ...CompletenessReason[]];
    };

export interface CompletenessResult {
  readonly clauseId: string;
  readonly contractId: string;
  /** Semantic completeness is intentionally separate from execution readiness. */
  readonly semantic: SemanticEvaluation;
  readonly dimensions: ClauseDimensions;
  readonly readiness: ReadinessEvaluation;
}

function dimensionReason(
  dimension: 'captured' | 'projected',
): CompletenessReason {
  return {
    code: `dimension-not-${dimension}`,
    message: `clause is not ${dimension}`,
  };
}

function valueSatisfiesField(
  clause: Clause,
  fieldName: ClauseField,
  cardinality: 'present' | 'non-empty',
): boolean {
  const value = clause[fieldName];
  if (value === null || value === undefined) return false;
  if (cardinality === 'non-empty' && Array.isArray(value)) {
    return value.length > 0;
  }
  return true;
}

function requirementFailure(
  obligation: SourceObligation,
  requirement: ClauseRequirement,
  code: CompletenessReason['code'],
  message: string,
  details: Pick<CompletenessReason, 'field' | 'branch'> = {},
): CompletenessReason {
  return {
    code,
    message,
    obligationId: obligation.id,
    requirementId: requirement.id,
    sourceText: requirement.sourceText,
    predicate: requirement.predicate,
    ...details,
  };
}

function evaluateRequirement(
  clause: Clause,
  obligation: SourceObligation,
  requirement: ClauseRequirement,
): CompletenessReason | null {
  const predicate = requirement.predicate;
  if (predicate.kind === 'field') {
    if (valueSatisfiesField(clause, predicate.field, predicate.cardinality)) {
      return null;
    }
    const isEmptyCollection =
      predicate.cardinality === 'non-empty' &&
      Array.isArray(clause[predicate.field]);
    return requirementFailure(
      obligation,
      requirement,
      isEmptyCollection ? 'empty-required-collection' : 'missing-field',
      isEmptyCollection
        ? `required ${predicate.field} collection is empty`
        : `required ${predicate.field} field is absent`,
      { field: predicate.field },
    );
  }

  if (predicate.kind === 'branch') {
    if (clause.branches[predicate.branch] !== null) return null;
    return requirementFailure(
      obligation,
      requirement,
      'missing-branch',
      `required ${predicate.branch} branch is absent`,
      { branch: predicate.branch },
    );
  }

  const populatedCount = predicate.fields.filter((fieldName) => {
    const value = clause[fieldName];
    return (
      value !== null &&
      value !== undefined &&
      (!Array.isArray(value) || value.length > 0)
    );
  }).length;
  const withinMinimum = populatedCount >= predicate.minCount;
  const withinMaximum =
    predicate.maxCount === undefined || populatedCount <= predicate.maxCount;
  if (withinMinimum && withinMaximum) return null;
  const range =
    predicate.maxCount === undefined
      ? `at least ${predicate.minCount}`
      : `between ${predicate.minCount} and ${predicate.maxCount}`;
  return requirementFailure(
    obligation,
    requirement,
    'unsatisfied-alternative',
    `expected ${range} populated alternatives, found ${populatedCount}`,
  );
}

function evaluateObligation(
  clause: Clause,
  obligation: SourceObligation,
  contract: ClauseCompletenessContract,
): CompletenessReason[] {
  return [...contract.requirements, ...obligation.requirements]
    .map((requirement) => evaluateRequirement(clause, obligation, requirement))
    .filter((reason): reason is CompletenessReason => reason !== null);
}

/**
 * Evaluate semantic completeness and readiness independently. The returned
 * artifact is authoritative; ClauseReadiness intentionally stores no derived
 * disposition that could contradict these results.
 */
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

  const selectedObligation = clause.sourceObligations.find(
    ({ contractKind }) => contractKind === completenessContract.kind,
  );
  if (selectedObligation === undefined) {
    reasons.push({
      code: 'missing-source-obligation',
      message: `source clause does not declare the ${completenessContract.kind} obligation`,
    });
  }

  for (const obligation of clause.sourceObligations) {
    const obligationContract =
      obligation.contractKind === completenessContract.kind
        ? completenessContract
        : CLAUSE_COMPLETENESS_CONTRACTS[obligation.contractKind];
    if (obligationContract === undefined) {
      reasons.push({
        code: 'unknown-source-contract',
        obligationId: obligation.id,
        sourceText: obligation.sourceText,
        message: `source obligation names unknown contract ${obligation.contractKind}`,
      });
      continue;
    }
    if (obligation.sourceText.trim().length === 0) {
      reasons.push({
        code: 'missing-source-obligation',
        obligationId: obligation.id,
        message: 'source obligation has no source text',
      });
    }
    const clauseLocators = new Set(
      clause.sourceSpans.map(({ locator }) => locator),
    );
    if (
      obligation.sourceSpanLocators.some(
        (locator) => !clauseLocators.has(locator),
      )
    ) {
      reasons.push({
        code: 'unbound-source-obligation',
        obligationId: obligation.id,
        sourceText: obligation.sourceText,
        message: 'source obligation does not point to a clause source span',
      });
    }
    reasons.push(...evaluateObligation(clause, obligation, obligationContract));
  }

  if (!clause.readiness.dimensions.captured) {
    reasons.push(dimensionReason('captured'));
  }
  if (!clause.readiness.dimensions.projected) {
    reasons.push(dimensionReason('projected'));
  }

  const semantic =
    reasons.length > 0
      ? {
          status: 'incomplete' as const,
          reasons: reasons as [CompletenessReason, ...CompletenessReason[]],
        }
      : { status: 'complete' as const, reasons: [] as const };
  return {
    clauseId: clause.identity.id,
    contractId: completenessContract.id,
    semantic,
    dimensions: clause.readiness.dimensions,
    readiness: {
      captured: {
        status: clause.readiness.dimensions.captured ? 'satisfied' : 'failed',
      },
      projected: {
        status: clause.readiness.dimensions.projected ? 'satisfied' : 'failed',
      },
      supported: {
        status: clause.readiness.dimensions.supported ? 'satisfied' : 'failed',
      },
      discoverable: {
        status: clause.readiness.dimensions.discoverable
          ? 'satisfied'
          : 'failed',
      },
    },
  };
}

export function getClauseCompletenessContract(
  kind: ClauseKind,
): ClauseCompletenessContract {
  return CLAUSE_COMPLETENESS_CONTRACTS[kind];
}
