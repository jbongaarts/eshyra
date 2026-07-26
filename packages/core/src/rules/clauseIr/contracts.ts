import type { ObligationRegistry } from './obligations.js';
import type {
  BranchName,
  Clause,
  ClauseDimensions,
  ClauseField,
  MechanicsRecordFamily,
  ObligationEvidence,
  SemanticFacet,
  SourceSpan,
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
    }
  | { readonly kind: 'canonical-base'; readonly field: ClauseField };

export interface CanonicalRequirement {
  readonly id: string;
  readonly facet: SemanticFacet | 'canonical-base';
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
  _facet: SemanticFacet,
  ...items: CanonicalRequirement[]
): readonly CanonicalRequirement[] => Object.freeze(items);

/** Requirements that are never removable by a facet or a caller extension. */
export const BASE_REQUIREMENTS: readonly CanonicalRequirement[] = Object.freeze(
  (
    [
      ['identity', 'identity is stable and complete'],
      ['sourceSpans', 'source spans are exact and non-empty'],
      ['provenance', 'provenance identifies the extraction authority'],
      ['semanticOwner', 'semantic ownership is complete'],
      ['recordOwner', 'record ownership is complete'],
    ] as const
  ).map(([fieldName, sourceText]) => ({
    id: `canonical-base:${fieldName}`,
    facet: 'canonical-base' as const,
    sourceText,
    predicate: {
      kind: 'canonical-base' as const,
      field: fieldName as ClauseField,
    },
  })),
);

export const FACET_IMPLICATIONS: Readonly<
  Partial<Record<SemanticFacet, readonly SemanticFacet[]>>
> = Object.freeze({
  'save-with-damage': ['save'],
  'save-without-damage': ['save'],
  'save-with-alternate-outcomes': ['save'],
  'attack-with-one-damage-mode': ['attack'],
  'attack-with-conditional-alternatives': ['attack'],
  'resource-with-reset': ['resource-use'],
  'resource-without-reset': ['resource-use'],
  'duration-with-concentration': ['duration'],
  'duration-without-concentration': ['duration'],
  'effect-with-lifecycle': ['effect'],
  'effect-without-lifecycle': ['effect'],
});

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
      sourceText:
        'conditional alternatives form a complete exclusion partition',
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
  recurrence: requirements(
    'recurrence',
    field('recurrence', 'recurrence', 'present'),
  ),
  'immunity-window': requirements(
    'immunity-window',
    count('immunity-window', 'immunityWindows', 1),
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
    | 'multiple-obligation-references'
    | 'missing-obligation-reference'
    | 'stale-evidence'
    | 'non-capturable-evidence'
    | 'missing-field'
    | 'empty-required-collection'
    | 'wrong-cardinality'
    | 'unsatisfied-alternative'
    | 'invalid-alternative-graph'
    | 'unbound-alternative'
    | 'missing-branch'
    | 'invalid-branch'
    | 'invalid-contract-selection'
    | 'invalid-projection-identity'
    | 'invalid-base-field'
    | 'invalid-capability-reference'
    | 'mismatched-capability-evidence'
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

const RECORD_FAMILIES = new Set<MechanicsRecordFamily>([
  'rule',
  'feature',
  'spell',
  'creature',
  'hazard',
  'equipment',
  'magic-item',
  'ancestry',
  'background',
  'condition',
  'action',
  'feat',
  'class',
  'subclass',
  'table',
]);

function populated(value: unknown): boolean {
  return (
    value !== null &&
    value !== undefined &&
    (!Array.isArray(value) || value.length > 0)
  );
}

function nonEmpty(value: unknown): boolean {
  return typeof value === 'string' && value.trim().length > 0;
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

function exactSpan(a: SourceSpan, b: SourceSpan): boolean {
  return (
    a.sourceRef === b.sourceRef &&
    a.locator === b.locator &&
    a.start === b.start &&
    a.end === b.end &&
    a.text === b.text
  );
}

function countBranches(clause: Clause): number {
  return Object.values(clause.branches).filter((branch) => branch !== null)
    .length;
}

function atomIds(clause: Clause): Set<string> {
  const ids = new Set<string>();
  const collections = [
    clause.checks ?? [],
    clause.attacks ?? [],
    clause.saves ?? [],
    clause.alternatives ?? [],
    clause.damage ?? [],
    clause.healing ?? [],
    clause.grants ?? [],
    clause.ledgerChanges ?? [],
    clause.stateTransitions ?? [],
    (clause.repeatChecks ?? []).map(({ check }) => check),
    clause.immunityWindows ?? [],
  ];
  for (const collection of collections) {
    for (const atom of collection) {
      if ('id' in atom && typeof atom.id === 'string') ids.add(atom.id);
    }
  }
  for (const branch of Object.values(clause.branches)) {
    if (branch !== null) ids.add(branch.id);
  }
  return ids;
}

function canonicalBaseReasons(clause: Clause): CompletenessReason[] {
  const reasons: CompletenessReason[] = [];
  const fail = (field: ClauseField, message: string) =>
    reasons.push({ code: 'invalid-base-field', field, message });
  if (
    !nonEmpty(clause.identity?.id) ||
    !nonEmpty(clause.identity?.canonicalKey) ||
    !nonEmpty(clause.identity?.revision)
  )
    fail('identity', 'identity id, canonicalKey, and revision are required');
  if (
    !Array.isArray(clause.sourceSpans) ||
    clause.sourceSpans.length === 0 ||
    clause.sourceSpans.some(
      (span) =>
        !nonEmpty(span.sourceRef) ||
        !nonEmpty(span.locator) ||
        span.start < 0 ||
        span.end <= span.start ||
        !nonEmpty(span.text),
    )
  )
    fail('sourceSpans', 'sourceSpans must contain exact non-empty spans');
  if (
    !nonEmpty(clause.provenance?.sourceRef) ||
    !nonEmpty(clause.provenance?.extraction) ||
    !Array.isArray(clause.provenance?.evidence) ||
    clause.provenance.evidence.length === 0 ||
    clause.provenance.evidence.some((item) => !nonEmpty(item))
  )
    fail('provenance', 'provenance source and evidence are required');
  if (!nonEmpty(clause.semanticOwner?.id))
    fail('semanticOwner', 'semanticOwner id is required');
  if (
    !nonEmpty(clause.recordOwner?.key) ||
    !RECORD_FAMILIES.has(clause.recordOwner?.family)
  )
    fail('recordOwner', 'recordOwner family and key are required');
  return reasons;
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
  if (predicate.kind === 'canonical-base') return null;
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
  const ids = (clause.alternatives ?? []).map(({ id }) => id);
  const unique = new Set(ids);
  const alternatives = clause.alternatives ?? [];
  const completePartition = alternatives.every((alternative) =>
    alternatives.every(
      (other) =>
        other.id === alternative.id ||
        alternative.mutuallyExclusiveWith.includes(other.id),
    ),
  );
  if (
    alternatives.length >= predicate.minCount &&
    unique.size === ids.length &&
    completePartition
  )
    return null;
  return reasonFor(
    obligationId,
    requirement,
    'unsatisfied-alternative',
    'alternatives are not a complete mutually-exclusive partition',
  );
}

function effectiveFacets(facets: readonly SemanticFacet[]): SemanticFacet[] {
  const result = new Set<SemanticFacet>();
  const visit = (facet: SemanticFacet) => {
    if (result.has(facet)) return;
    result.add(facet);
    for (const implied of FACET_IMPLICATIONS[facet] ?? []) visit(implied);
  };
  facets.forEach(visit);
  return [...result];
}

function projectionIdentityReasons(clause: Clause): CompletenessReason[] {
  const reasons: CompletenessReason[] = [];
  const ids = new Set<string>();
  const collections = [
    clause.checks ?? [],
    clause.attacks ?? [],
    clause.saves ?? [],
    clause.alternatives ?? [],
    clause.damage ?? [],
    clause.healing ?? [],
    clause.grants ?? [],
    clause.ledgerChanges ?? [],
    clause.stateTransitions ?? [],
    (clause.repeatChecks ?? []).map(({ check }) => check),
  ];
  for (const collection of collections) {
    for (const atom of collection) {
      if (!nonEmpty(atom.id))
        reasons.push({
          code: 'invalid-projection-identity',
          message: 'every projected atom needs a non-empty identity',
        });
      else if (ids.has(atom.id))
        reasons.push({
          code: 'invalid-projection-identity',
          message: `projected atom id ${atom.id} is reused`,
        });
      ids.add(atom.id);
    }
  }
  if (
    new Set(clause.sourceObligationIds ?? []).size !==
    (clause.sourceObligationIds ?? []).length
  )
    reasons.push({
      code: 'duplicate-obligation-reference',
      message: 'clause repeats a source obligation id',
    });
  return reasons;
}

function alternativeAndBranchReasons(clause: Clause): CompletenessReason[] {
  const reasons: CompletenessReason[] = [];
  const ids = atomIds(clause);
  const alternatives = clause.alternatives ?? [];
  const alternativeIds = new Set(alternatives.map(({ id }) => id));
  for (const alternative of alternatives) {
    if (
      !nonEmpty(alternative.id) ||
      alternativeIds.size !== alternatives.length
    )
      reasons.push({
        code: 'invalid-alternative-graph',
        message: 'alternative IDs must be unique and non-empty',
      });
    if (alternative.clauseIds.length === 0)
      reasons.push({
        code: 'unbound-alternative',
        message: `alternative ${alternative.id} has no projected atom binding`,
      });
    for (const projectedId of alternative.clauseIds) {
      if (!ids.has(projectedId))
        reasons.push({
          code: 'unbound-alternative',
          message: `alternative ${alternative.id} binds unknown atom ${projectedId}`,
        });
    }
    if (alternative.mutuallyExclusiveWith.includes(alternative.id))
      reasons.push({
        code: 'invalid-alternative-graph',
        message: `alternative ${alternative.id} excludes itself`,
      });
    for (const other of alternative.mutuallyExclusiveWith) {
      const counterpart = alternatives.find(({ id }) => id === other);
      if (
        counterpart === undefined ||
        !counterpart.mutuallyExclusiveWith.includes(alternative.id)
      )
        reasons.push({
          code: 'invalid-alternative-graph',
          message: `alternative exclusion edge ${alternative.id}<->${other} is not symmetric`,
        });
    }
  }
  for (const [branchName, branch] of Object.entries(clause.branches ?? {}) as [
    BranchName,
    Clause['branches'][BranchName],
  ][]) {
    if (branch === null) continue;
    if (!nonEmpty(branch.id) || !nonEmpty(branch.outcome))
      reasons.push({
        code: 'invalid-branch',
        branch: branchName,
        message: `branch ${branchName} needs an identity and source-backed outcome`,
      });
    if (
      !(clause.sourceSpans ?? []).some((span) =>
        exactSpan(span, branch.sourceSpan),
      )
    )
      reasons.push({
        code: 'invalid-branch',
        branch: branchName,
        message: `branch ${branchName} is not bound to a clause source span`,
      });
    if (branch.projectedAtomIds.length === 0)
      reasons.push({
        code: 'invalid-branch',
        branch: branchName,
        message: `branch ${branchName} has no projected atom binding`,
      });
    for (const projectedId of branch.projectedAtomIds) {
      if (!ids.has(projectedId))
        reasons.push({
          code: 'invalid-branch',
          branch: branchName,
          message: `branch ${branchName} binds unknown atom ${projectedId}`,
        });
    }
  }
  return reasons;
}

function evidenceKey(evidence: ObligationEvidence): string {
  return JSON.stringify(evidence);
}

function evaluateCaptured(
  clause: Clause,
  obligationId: string,
  registry: ObligationRegistry,
  options: CompletenessEvaluationOptions,
): CompletenessReason[] {
  if (clause.readiness.captured.length === 0)
    return [
      { code: 'dimension-not-captured', message: 'captured has no evidence' },
    ];
  const record = registry.get(obligationId);
  if (record === undefined) return [];
  const captured = new Set(clause.readiness.captured.map(evidenceKey));
  const reasons: CompletenessReason[] = [];
  const resolved = record.evidence.some((evidence) => {
    if (
      evidence.kind !== 'source-span' &&
      evidence.kind !== 'authoritative-input'
    )
      return false;
    if (!captured.has(evidenceKey(evidence))) return false;
    if (evidence.kind === 'source-span')
      return (clause.sourceSpans ?? []).some((span) =>
        exactSpan(span, evidence),
      );
    return (
      options.sourceEvidenceResolver?.resolve(evidence).status === 'resolved'
    );
  });
  if (!resolved) {
    const hasGapEvidence = record.evidence.some(
      (evidence) =>
        evidence.kind === 'audit-finding' ||
        evidence.kind === 'known-missing-source-clause',
    );
    reasons.push({
      code: hasGapEvidence ? 'non-capturable-evidence' : 'stale-evidence',
      obligationId,
      message: hasGapEvidence
        ? 'audit or known-missing evidence identifies a gap and cannot satisfy CAPTURED'
        : 'obligation evidence is not resolvable from readiness evidence',
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

function capabilityKey(reference: {
  capability: string;
  owningBead: string;
}): string {
  return `${reference.capability}::${reference.owningBead}`;
}

function validCapability(reference: {
  capability: string;
  owningBead: string;
}): boolean {
  return (
    /^engine:F(?:[1-9]|10)$/.test(reference.capability) &&
    reference.owningBead.startsWith('eshyra-olc5')
  );
}

/**
 * Evaluate a clause against immutable registry authority. Semantic
 * completeness is CAPTURED + PROJECTED; supported and discoverable remain
 * independent readiness dimensions.
 */
export function evaluateClauseCompleteness(
  clause: Clause,
  registry: ObligationRegistry,
  options: CompletenessEvaluationOptions = {},
): CompletenessResult {
  const reasons: CompletenessReason[] = [...canonicalBaseReasons(clause)];
  const sourceObligationIds = Array.isArray(clause.sourceObligationIds)
    ? clause.sourceObligationIds
    : [];
  if (options.contractId !== undefined)
    reasons.push({
      code: 'invalid-contract-selection',
      message: `contract selection is not part of the evaluator: ${options.contractId}`,
    });
  if (sourceObligationIds.length === 0)
    reasons.push({
      code: 'missing-obligation-reference',
      message: 'each clause must name exactly one source obligation',
    });
  if (sourceObligationIds.length > 1)
    reasons.push({
      code: 'multiple-obligation-references',
      message: 'one clause may discharge exactly one source obligation',
    });
  const obligationId = sourceObligationIds[0];
  const record =
    obligationId === undefined ? undefined : registry.get(obligationId);
  if (obligationId !== undefined && record === undefined)
    reasons.push({
      code: 'unknown-obligation',
      obligationId,
      message: `unknown source obligation ${obligationId}`,
    });
  reasons.push(...projectionIdentityReasons(clause));
  reasons.push(...alternativeAndBranchReasons(clause));
  if (record !== undefined) {
    const facets = effectiveFacets(record.requiredFacets);
    for (const facet of facets) {
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
        const failure = evaluateOne(clause, record.obligationId, requirement);
        if (failure !== null) reasons.push(failure);
      }
    }
    if (obligationId !== undefined)
      reasons.push(
        ...evaluateCaptured(clause, obligationId, registry, options),
      );
  }
  for (const requirement of options.additionalRequirements ?? []) {
    const target = requirement.obligationId ?? obligationId;
    if (target !== undefined) {
      const failure = evaluateOne(clause, target, requirement);
      if (failure !== null) reasons.push(failure);
    }
  }

  const supportedFailures: string[] = [];
  const requiredCapabilities = clause.requiredEngineCapabilities;
  const supportedCapabilities = clause.readiness.supported;
  const requiredKeys = new Set(requiredCapabilities.map(capabilityKey));
  const supportedKeys = new Set(supportedCapabilities.map(capabilityKey));
  if (requiredCapabilities.length === 0)
    supportedFailures.push('no capability evidence');
  if (
    requiredKeys.size !== requiredCapabilities.length ||
    supportedKeys.size !== supportedCapabilities.length
  )
    supportedFailures.push('capability evidence contains duplicate references');
  if (
    requiredKeys.size !== supportedKeys.size ||
    [...requiredKeys].some((key) => !supportedKeys.has(key))
  )
    reasons.push({
      code: 'mismatched-capability-evidence',
      message:
        'requiredEngineCapabilities and readiness.supported must match exactly',
    });
  for (const reference of requiredCapabilities) {
    if (!validCapability(reference)) {
      supportedFailures.push(
        `capability ${reference.capability} is not a qualified owned capability`,
      );
      reasons.push({
        code: 'invalid-capability-reference',
        message: `invalid capability reference ${reference.capability}/${reference.owningBead}`,
      });
      continue;
    }
    const resolution = options.capabilityResolver?.resolve(reference);
    if (
      resolution?.status !== 'resolved' ||
      !resolution.implemented ||
      resolution.owningBead !== reference.owningBead ||
      resolution.capability !== reference.capability
    )
      supportedFailures.push(
        `capability ${reference.capability} is unresolved, unowned, or unimplemented`,
      );
  }
  const discoverableFailures: string[] = [];
  if (clause.readiness.discoverable.length === 0)
    discoverableFailures.push('no discovery evidence');
  for (const reference of clause.readiness.discoverable) {
    const resolution = options.discoveryResolver?.resolve(reference);
    if (
      resolution?.status !== 'resolved' ||
      resolution.clauseId !== clause.identity?.id
    )
      discoverableFailures.push(
        `discovery reference ${reference.path} is unresolved`,
      );
  }
  const capturedReasons = reasons.filter(
    ({ code }) =>
      code === 'dimension-not-captured' ||
      code === 'stale-evidence' ||
      code === 'non-capturable-evidence',
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
  const capturedFailures = capturedReasons.map(({ message }) => message);
  const projectedFailures = projectedReasons.map(({ message }) => message);
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
    clauseId: clause.identity?.id ?? '',
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
