import type { ObligationRegistry } from './obligations.js';
import type {
  BranchName,
  Clause,
  ClauseDimensions,
  ClauseField,
  ObligationEvidence,
  SemanticFacet,
} from './types.js';

export type DimensionName = keyof ClauseDimensions;
export type { BranchName, ClauseField, SemanticFacet } from './types.js';

export type RequirementPredicate =
  | {
      readonly kind: 'field';
      readonly field: ClauseField;
      readonly cardinality: 'present' | 'non-empty' | 'empty';
    }
  | {
      readonly kind: 'field-count';
      readonly field: ClauseField;
      readonly minCount: number;
      readonly maxCount?: number;
    }
  | {
      readonly kind: 'branch-count';
      readonly minCount: number;
      readonly maxCount?: number;
    }
  | {
      readonly kind: 'field-group';
      readonly fields: readonly ClauseField[];
      readonly minCount: number;
      readonly maxCount?: number;
    }
  | { readonly kind: 'duration-concentration'; readonly expected: boolean }
  | {
      readonly kind: 'mutually-exclusive-alternatives';
      readonly minCount: number;
    };

export interface CanonicalRequirement {
  readonly id: string;
  readonly facet: SemanticFacet;
  readonly sourceText: string;
  readonly predicate: RequirementPredicate;
}

export interface AdditionalRequirement {
  readonly id: string;
  readonly obligationId?: string;
  readonly sourceText: string;
  readonly predicate: RequirementPredicate;
}

const field = (
  facet: SemanticFacet,
  fieldName: ClauseField,
  cardinality: 'present' | 'non-empty' | 'empty',
): CanonicalRequirement => ({
  id: `${facet}:field:${fieldName}:${cardinality}`,
  facet,
  sourceText: `the ${fieldName} is ${cardinality}`,
  predicate: { kind: 'field', field: fieldName, cardinality },
});

const count = (
  facet: SemanticFacet,
  fieldName: ClauseField,
  minCount: number,
  maxCount?: number,
): CanonicalRequirement => ({
  id: `${facet}:count:${fieldName}`,
  facet,
  sourceText: `the ${fieldName} has the required source multiplicity`,
  predicate: { kind: 'field-count', field: fieldName, minCount, maxCount },
});

const group = (
  facet: SemanticFacet,
  fields: readonly ClauseField[],
  minCount: number,
  maxCount?: number,
): CanonicalRequirement => ({
  id: `${facet}:group:${fields.join('|')}`,
  facet,
  sourceText: 'the source-backed field group is represented',
  predicate: { kind: 'field-group', fields, minCount, maxCount },
});

const branchRequirement = (
  facet: SemanticFacet,
  minCount: number,
  maxCount?: number,
): CanonicalRequirement => ({
  id: `${facet}:branch-count`,
  facet,
  sourceText: 'the source-backed outcome branches are represented',
  predicate: { kind: 'branch-count', minCount, maxCount },
});

const requirements = (
  facet: SemanticFacet,
  ...items: CanonicalRequirement[]
): readonly CanonicalRequirement[] =>
  Object.freeze(items.length === 0 ? [field(facet, 'kind', 'present')] : items);

export const FACET_REQUIREMENTS: Readonly<
  Record<SemanticFacet, readonly CanonicalRequirement[]>
> = {
  save: requirements('save', count('save', 'saves', 1)),
  'save-with-damage': requirements(
    'save-with-damage',
    count('save-with-damage', 'damage', 1),
  ),
  'save-without-damage': requirements(
    'save-without-damage',
    field('save-without-damage', 'damage', 'empty'),
  ),
  'save-with-alternate-outcomes': requirements(
    'save-with-alternate-outcomes',
    branchRequirement('save-with-alternate-outcomes', 2),
  ),
  attack: requirements('attack', count('attack', 'attacks', 1)),
  'attack-with-one-damage-mode': requirements(
    'attack-with-one-damage-mode',
    count('attack-with-one-damage-mode', 'damage', 1, 1),
  ),
  'attack-with-conditional-alternatives': requirements(
    'attack-with-conditional-alternatives',
    {
      id: 'attack-with-conditional-alternatives:alternatives',
      facet: 'attack-with-conditional-alternatives',
      sourceText: 'conditional alternatives are mutually exclusive',
      predicate: { kind: 'mutually-exclusive-alternatives', minCount: 2 },
    },
  ),
  check: requirements('check', count('check', 'checks', 1)),
  branch: requirements('branch', branchRequirement('branch', 1)),
  'action-economy': requirements(
    'action-economy',
    field('action-economy', 'activationCost', 'present'),
  ),
  'resource-use': requirements(
    'resource-use',
    count('resource-use', 'ledgerChanges', 1),
  ),
  'resource-with-reset': requirements(
    'resource-with-reset',
    field('resource-with-reset', 'recurrence', 'present'),
  ),
  'resource-without-reset': requirements(
    'resource-without-reset',
    field('resource-without-reset', 'recurrence', 'empty'),
  ),
  duration: requirements('duration', field('duration', 'duration', 'present')),
  'duration-with-concentration': requirements('duration-with-concentration', {
    id: 'duration-with-concentration:state',
    facet: 'duration-with-concentration',
    sourceText: 'duration concentration is represented',
    predicate: { kind: 'duration-concentration', expected: true },
  }),
  'duration-without-concentration': requirements(
    'duration-without-concentration',
    {
      id: 'duration-without-concentration:state',
      facet: 'duration-without-concentration',
      sourceText: 'duration does not require concentration',
      predicate: { kind: 'duration-concentration', expected: false },
    },
  ),
  effect: requirements(
    'effect',
    group(
      'effect',
      ['damage', 'healing', 'grants', 'ledgerChanges', 'stateTransitions'],
      1,
    ),
  ),
  'effect-with-lifecycle': requirements(
    'effect-with-lifecycle',
    count('effect-with-lifecycle', 'stateTransitions', 1),
  ),
  'effect-without-lifecycle': requirements(
    'effect-without-lifecycle',
    field('effect-without-lifecycle', 'stateTransitions', 'empty'),
  ),
  geometry: requirements('geometry', field('geometry', 'geometry', 'present')),
  choice: requirements('choice', count('choice', 'alternatives', 1)),
  variant: requirements('variant', count('variant', 'alternatives', 1)),
  'entity-lifecycle': requirements(
    'entity-lifecycle',
    count('entity-lifecycle', 'stateTransitions', 1),
  ),
  ledger: requirements('ledger', count('ledger', 'ledgerChanges', 1)),
  'model-adjudication': requirements(
    'model-adjudication',
    field('model-adjudication', 'trigger', 'present'),
  ),
  'repeat-check': requirements(
    'repeat-check',
    count('repeat-check', 'repeatChecks', 1),
  ),
  termination: requirements(
    'termination',
    field('termination', 'termination', 'present'),
  ),
};

export function getFacetRequirements(
  facet: SemanticFacet,
): readonly CanonicalRequirement[] {
  return FACET_REQUIREMENTS[facet];
}

export interface SourceEvidenceResolver {
  resolve(evidence: ObligationEvidence): {
    readonly status: 'resolved' | 'unresolved';
  };
}

export interface CapabilityResolver {
  resolve(reference: {
    readonly capability: string;
    readonly owningBead: string;
  }): {
    readonly status: 'resolved' | 'unresolved';
    readonly capability: string;
    readonly owningBead: string | null;
    readonly implemented: boolean;
  };
}

export interface DiscoveryResolver {
  resolve(reference: { readonly resolverId: string; readonly path: string }): {
    readonly status: 'resolved' | 'unresolved';
    readonly clauseId: string | null;
  };
}

export interface CompletenessEvaluationOptions {
  readonly additionalRequirements?: readonly AdditionalRequirement[];
  /** Contract selection is intentionally unsupported; supplying one fails closed. */
  readonly contractId?: string;
  readonly sourceEvidenceResolver?: SourceEvidenceResolver;
  readonly capabilityResolver?: CapabilityResolver;
  readonly discoveryResolver?: DiscoveryResolver;
}

export interface CompletenessReason {
  readonly code:
    | 'unknown-obligation'
    | 'unknown-facet'
    | 'contradictory-facets'
    | 'duplicate-obligation-reference'
    | 'missing-obligation-reference'
    | 'stale-evidence'
    | 'missing-field'
    | 'empty-required-collection'
    | 'wrong-cardinality'
    | 'unsatisfied-alternative'
    | 'missing-branch'
    | 'invalid-contract-selection'
    | 'invalid-projection-identity'
    | 'dimension-not-captured';
  readonly message: string;
  readonly obligationId?: string;
  readonly requirementId?: string;
  readonly sourceText?: string;
  readonly predicate?: RequirementPredicate;
  readonly field?: ClauseField;
  readonly branch?: BranchName;
}

export interface DimensionEvaluation {
  readonly status: 'satisfied' | 'failed';
  readonly reasons: readonly string[];
}

export type ReadinessEvaluation = Readonly<
  Record<DimensionName, DimensionEvaluation>
>;

export type SemanticEvaluation =
  | { readonly status: 'complete'; readonly reasons: readonly [] }
  | {
      readonly status: 'incomplete';
      readonly reasons: readonly [CompletenessReason, ...CompletenessReason[]];
    };

export interface CompletenessResult {
  readonly clauseId: string;
  readonly semantic: SemanticEvaluation;
  readonly dimensions: Readonly<Record<DimensionName, 'satisfied' | 'failed'>>;
  readonly readiness: ReadinessEvaluation;
}

function populated(value: unknown): boolean {
  return (
    value !== null &&
    value !== undefined &&
    (!Array.isArray(value) || value.length > 0)
  );
}

function countFor(clause: Clause, fieldName: ClauseField): number {
  const value = clause[fieldName];
  return Array.isArray(value) ? value.length : populated(value) ? 1 : 0;
}

function reasonFor(
  obligationId: string,
  requirement: {
    readonly id: string;
    readonly sourceText: string;
    readonly predicate: RequirementPredicate;
  },
  code: CompletenessReason['code'],
  message: string,
  field?: ClauseField,
): CompletenessReason {
  return {
    code,
    message,
    obligationId,
    requirementId: requirement.id,
    sourceText: requirement.sourceText,
    predicate: requirement.predicate,
    ...(field === undefined ? {} : { field }),
  };
}

function countBranches(clause: Clause): number {
  return Object.values(clause.branches).filter((branch) => branch !== null)
    .length;
}

function evaluateOne(
  clause: Clause,
  obligationId: string,
  requirement: {
    readonly id: string;
    readonly sourceText: string;
    readonly predicate: RequirementPredicate;
  },
): CompletenessReason | null {
  const predicate = requirement.predicate;
  if (predicate.kind === 'field') {
    const value = clause[predicate.field];
    const actual = countFor(clause, predicate.field);
    const okay =
      predicate.cardinality === 'present'
        ? value !== null && value !== undefined
        : predicate.cardinality === 'non-empty'
          ? actual > 0
          : actual === 0;
    if (okay) return null;
    return reasonFor(
      obligationId,
      requirement,
      predicate.cardinality === 'non-empty'
        ? 'empty-required-collection'
        : 'missing-field',
      `required ${predicate.field} is not ${predicate.cardinality}`,
      predicate.field,
    );
  }
  if (predicate.kind === 'field-count') {
    const actual = countFor(clause, predicate.field);
    if (
      actual >= predicate.minCount &&
      (predicate.maxCount === undefined || actual <= predicate.maxCount)
    )
      return null;
    return reasonFor(
      obligationId,
      requirement,
      'wrong-cardinality',
      `required ${predicate.field} count is ${predicate.minCount}${predicate.maxCount === undefined ? '+' : `..${predicate.maxCount}`}, found ${actual}`,
      predicate.field,
    );
  }
  if (predicate.kind === 'branch-count') {
    const actual = countBranches(clause);
    if (
      actual >= predicate.minCount &&
      (predicate.maxCount === undefined || actual <= predicate.maxCount)
    )
      return null;
    return reasonFor(
      obligationId,
      requirement,
      'missing-branch',
      `required at least ${predicate.minCount} represented branches, found ${actual}`,
    );
  }
  if (predicate.kind === 'field-group') {
    const actual = predicate.fields.filter((fieldName) =>
      populated(clause[fieldName]),
    ).length;
    if (
      actual >= predicate.minCount &&
      (predicate.maxCount === undefined || actual <= predicate.maxCount)
    )
      return null;
    return reasonFor(
      obligationId,
      requirement,
      'unsatisfied-alternative',
      `required field-group cardinality is ${predicate.minCount}${predicate.maxCount === undefined ? '+' : `..${predicate.maxCount}`}, found ${actual}`,
    );
  }
  if (predicate.kind === 'duration-concentration') {
    if (
      clause.duration !== null &&
      clause.duration.concentration === predicate.expected
    )
      return null;
    return reasonFor(
      obligationId,
      requirement,
      'missing-field',
      `duration concentration must be ${predicate.expected}`,
    );
  }
  const ids = clause.alternatives.map(({ id }) => id);
  const unique = new Set(ids);
  const mutuallyExclusive = clause.alternatives.every((alternative) =>
    alternative.mutuallyExclusiveWith.some((other) => unique.has(other)),
  );
  if (
    clause.alternatives.length >= predicate.minCount &&
    unique.size === ids.length &&
    mutuallyExclusive
  )
    return null;
  return reasonFor(
    obligationId,
    requirement,
    'unsatisfied-alternative',
    'alternatives are not distinct and mutually exclusive',
  );
}

function evidenceKey(evidence: ObligationEvidence): string {
  return JSON.stringify(evidence);
}

function sourceSpanKey(span: {
  readonly sourceRef: string;
  readonly locator: string;
  readonly start: number;
  readonly end: number;
  readonly text: string;
}): string {
  return JSON.stringify({ kind: 'source-span', ...span });
}

function projectionIdentityReasons(clause: Clause): CompletenessReason[] {
  const reasons: CompletenessReason[] = [];
  const ids = new Set<string>();
  const collections: readonly (readonly { readonly id: string }[])[] = [
    clause.checks,
    clause.attacks,
    clause.saves,
    clause.alternatives,
    clause.damage,
    clause.healing,
    clause.grants,
    clause.ledgerChanges,
    clause.stateTransitions,
  ];
  for (const collection of collections) {
    for (const atom of collection) {
      if (ids.has(atom.id))
        reasons.push({
          code: 'invalid-projection-identity',
          message: `projected atom id ${atom.id} is reused`,
        });
      ids.add(atom.id);
    }
  }
  if (
    new Set(clause.sourceObligationIds).size !==
    clause.sourceObligationIds.length
  ) {
    reasons.push({
      code: 'duplicate-obligation-reference',
      message: 'clause repeats a source obligation id',
    });
  }
  return reasons;
}

function evaluateCaptured(
  clause: Clause,
  obligationIds: readonly string[],
  registry: ObligationRegistry,
  options: CompletenessEvaluationOptions,
): CompletenessReason[] {
  if (clause.readiness.captured.length === 0)
    return [
      { code: 'dimension-not-captured', message: 'captured has no evidence' },
    ];
  const captured = new Set(clause.readiness.captured.map(evidenceKey));
  const spans = new Set(clause.sourceSpans.map(sourceSpanKey));
  const reasons: CompletenessReason[] = [];
  for (const obligationId of obligationIds) {
    const record = registry.get(obligationId);
    if (record === undefined) continue;
    const resolved = record.evidence.some((evidence) => {
      if (!captured.has(evidenceKey(evidence))) return false;
      if (evidence.kind === 'source-span')
        return spans.has(evidenceKey(evidence));
      return (
        options.sourceEvidenceResolver?.resolve(evidence).status === 'resolved'
      );
    });
    if (!resolved)
      reasons.push({
        code: 'stale-evidence',
        obligationId,
        message:
          'obligation evidence is not resolvable from readiness evidence',
      });
  }
  return reasons;
}

function dimension(
  status: boolean,
  reasons: readonly string[],
): DimensionEvaluation {
  return { status: status ? 'satisfied' : 'failed', reasons };
}

/**
 * Canonical requirements are resolved from the independent registry. The
 * caller may add requirements, but cannot replace, select, or weaken them.
 */
export function evaluateClauseCompleteness(
  clause: Clause,
  registry: ObligationRegistry,
  options: CompletenessEvaluationOptions = {},
): CompletenessResult {
  const reasons: CompletenessReason[] = [];
  if (options.contractId !== undefined) {
    reasons.push({
      code: 'invalid-contract-selection',
      message: `contract selection is not part of the evaluator: ${options.contractId}`,
    });
  }
  if (clause.sourceObligationIds.length === 0)
    reasons.push({
      code: 'missing-obligation-reference',
      message: 'clause has no source obligation references',
    });
  const records = clause.sourceObligationIds.map((id) => registry.get(id));
  clause.sourceObligationIds.forEach((id, index) => {
    if (records[index] === undefined)
      reasons.push({
        code: 'unknown-obligation',
        obligationId: id,
        message: `unknown source obligation ${id}`,
      });
  });
  reasons.push(...projectionIdentityReasons(clause));
  reasons.push(
    ...evaluateCaptured(clause, clause.sourceObligationIds, registry, options),
  );

  const requirementsByField = new Map<
    ClauseField,
    {
      readonly id: string;
      readonly sourceText: string;
      readonly predicate: Extract<
        RequirementPredicate,
        { kind: 'field-count' }
      >;
      readonly obligationId: string;
    }[]
  >();
  for (const record of records) {
    if (record === undefined) continue;
    for (const facet of record.requiredFacets) {
      const facetRequirements = FACET_REQUIREMENTS[facet];
      if (facetRequirements === undefined) {
        reasons.push({
          code: 'unknown-facet',
          obligationId: record.obligationId,
          message: `unknown facet ${facet}`,
        });
        continue;
      }
      for (const requirement of facetRequirements) {
        if (requirement.predicate.kind !== 'field-count') continue;
        const existing =
          requirementsByField.get(requirement.predicate.field) ?? [];
        existing.push({
          ...requirement,
          predicate: requirement.predicate,
          obligationId: record.obligationId,
        });
        requirementsByField.set(requirement.predicate.field, existing);
      }
    }
  }
  for (const [fieldName, demands] of requirementsByField) {
    const minimum = demands.reduce(
      (sum, demand) => sum + demand.predicate.minCount,
      0,
    );
    if (countFor(clause, fieldName) < minimum) {
      for (const demand of demands)
        reasons.push(
          reasonFor(
            demand.obligationId,
            demand,
            'wrong-cardinality',
            `source obligations require ${minimum} ${fieldName} atoms, found ${countFor(clause, fieldName)}`,
            fieldName,
          ),
        );
    }
  }
  for (const record of records) {
    if (record === undefined) continue;
    for (const facet of record.requiredFacets) {
      for (const requirement of FACET_REQUIREMENTS[facet] ?? []) {
        if (requirement.predicate.kind === 'field-count') continue;
        const failure = evaluateOne(clause, record.obligationId, requirement);
        if (failure !== null) reasons.push(failure);
      }
    }
  }
  for (const requirement of options.additionalRequirements ?? []) {
    const targetIds =
      requirement.obligationId === undefined
        ? clause.sourceObligationIds
        : [requirement.obligationId];
    for (const obligationId of targetIds) {
      const failure = evaluateOne(clause, obligationId, requirement);
      if (failure !== null) reasons.push(failure);
    }
  }

  const capturedReasons = reasons.filter(
    (reason) =>
      reason.code === 'dimension-not-captured' ||
      reason.code === 'stale-evidence',
  );
  const projectedReasons = reasons.filter(
    (reason) => !capturedReasons.includes(reason),
  );
  const semanticReasons = [...capturedReasons, ...projectedReasons];
  const semantic: SemanticEvaluation =
    semanticReasons.length === 0
      ? { status: 'complete', reasons: [] }
      : {
          status: 'incomplete',
          reasons: semanticReasons as [
            CompletenessReason,
            ...CompletenessReason[],
          ],
        };

  const supportedFailures: string[] = [];
  if (clause.requiredEngineCapabilities.length === 0)
    supportedFailures.push('no capability evidence');
  for (const reference of clause.requiredEngineCapabilities) {
    if (
      reference.capability.trim().length === 0 ||
      reference.owningBead.trim().length === 0
    ) {
      supportedFailures.push('capability reference is unowned or empty');
      continue;
    }
    const resolution = options.capabilityResolver?.resolve(reference);
    if (
      resolution?.status !== 'resolved' ||
      !resolution.implemented ||
      resolution.owningBead !== reference.owningBead ||
      resolution.capability !== reference.capability
    ) {
      supportedFailures.push(
        `capability ${reference.capability} is unresolved, unowned, or unimplemented`,
      );
    }
  }
  const discoverableFailures: string[] = [];
  if (clause.readiness.discoverable.length === 0)
    discoverableFailures.push('no discovery evidence');
  for (const reference of clause.readiness.discoverable) {
    const resolution = options.discoveryResolver?.resolve(reference);
    if (
      resolution?.status !== 'resolved' ||
      resolution.clauseId !== clause.identity.id
    )
      discoverableFailures.push(
        `discovery reference ${reference.path} is unresolved`,
      );
  }
  const capturedFailures = semanticReasons
    .filter(
      (reason) =>
        reason.code === 'dimension-not-captured' ||
        reason.code === 'stale-evidence',
    )
    .map(({ message }) => message);
  const projectedFailures = semanticReasons
    .filter(
      (reason) =>
        reason.code !== 'dimension-not-captured' &&
        reason.code !== 'stale-evidence',
    )
    .map(({ message }) => message);
  const readiness: ReadinessEvaluation = {
    captured: dimension(capturedFailures.length === 0, capturedFailures),
    projected: dimension(projectedFailures.length === 0, projectedFailures),
    supported: dimension(supportedFailures.length === 0, supportedFailures),
    discoverable: dimension(
      discoverableFailures.length === 0,
      discoverableFailures,
    ),
  };
  return {
    clauseId: clause.identity.id,
    semantic,
    dimensions: {
      captured: readiness.captured.status,
      projected: readiness.projected.status,
      supported: readiness.supported.status,
      discoverable: readiness.discoverable.status,
    },
    readiness,
  };
}
