/**
 * Test-local contract for the bounded diagnostic corpus in ADR 0020.
 *
 * These identities describe probe evidence. They do not define a universal
 * clause ontology, obligation identity, relationship vocabulary, or corpus
 * membership scheme.
 */

/**
 * The commit every fixture's declared identities were verified against.
 *
 * Re-verified at `dd96529` after B3 (PR #508) and B5 (PR #514) landed. Neither
 * merge touched `packages/core/data`, so every record, selector, and module
 * identity carried over unchanged; what changed is that P8's and P11's gating
 * blockers are now discharged.
 */
export const VERIFIED_AT_COMMIT = 'dd9652904e2fda281a8317d29f43d4bca46df6f5';
export const SRD_SOURCE_REF =
  'https://dnd.wizards.com/resources/systems-reference-document';

export type RouteClass =
  | 'direct-state-ref'
  | 'direct-adventure-ref'
  | 'explicit-name-or-alias'
  | 'typed-relationship'
  | 'situation-cue'
  | 'auditor-missing-target'
  | 'campaign-rule'
  | 'campaign-ruling'
  | 'capability-preflight';

export type DiagnosticSelector =
  | {
      readonly kind: 'json-pointer';
      readonly pointer: string;
    }
  | {
      readonly kind: 'ambiguity-id';
      readonly id: string;
    }
  | {
      readonly kind: 'stable-id';
      readonly idKind: 'operation' | 'clause';
      readonly id: string;
    }
  | {
      readonly kind: 'source-text-predicate';
      readonly description: string;
      readonly exactSubstring: string;
    };

export interface RulesRecordTarget {
  readonly targetKind: 'rules-record';
  readonly recordKey: string;
  readonly sourceRef: string;
  readonly locator: string;
  readonly selector?: DiagnosticSelector;
}

export interface AdventureEntityTarget {
  readonly targetKind: 'adventure-entity';
  readonly moduleId: string;
  readonly entityKind: 'location' | 'encounter';
  readonly entityId: string;
}

export interface AbsentRulesRecordTarget {
  readonly targetKind: 'absent-rules-record';
  readonly recordKey: string;
  readonly reason: string;
}

export type DiagnosticTarget =
  | RulesRecordTarget
  | AdventureEntityTarget
  | AbsentRulesRecordTarget;

export interface ExplicitNone {
  readonly kind: 'none';
  readonly statement: string;
}

export interface RetainedFact {
  readonly statement: string;
  readonly targetRef?: string;
  readonly exactSubstring?: string;
  readonly typedPath?: string;
  readonly expectedValue?: unknown;
}

export interface TypedRelationshipExpectation {
  readonly sourceRecordKey: string;
  readonly linkField: string;
  readonly relation: string;
  readonly targetRecordKey: string;
  readonly statement: string;
}

export interface RouteExpectation {
  readonly targetRef: string;
  readonly routes: readonly RouteClass[];
  readonly why: string;
}

export interface AmbiguityExpectation {
  readonly ambiguityId: string;
  readonly expectedResolution: 'resolved' | 'unresolved';
  readonly interpretationIds: readonly string[];
  readonly statement: string;
}

export interface AmbiguityState {
  readonly kind: 'ambiguities';
  readonly expectations: readonly AmbiguityExpectation[];
}

export interface CampaignRuleCase {
  readonly caseId: string;
  readonly statement: string;
  readonly ruleIdentity?: string;
  readonly ruleKind?: 'house-rule' | 'ruling';
  readonly scope?: string;
  readonly provenance?: string;
}

export interface CampaignRuleCases {
  readonly kind: 'campaign-rule-cases';
  readonly cases: readonly CampaignRuleCase[];
}

export interface CapabilityExpectation {
  readonly status: 'none-selected' | 'implemented' | 'available' | 'blocked';
  readonly statement: string;
  readonly capabilityId?: string;
  readonly revision?: string;
  readonly inputs?: readonly string[];
  readonly exclusions?: readonly string[];
  readonly residualInterpretation?: string;
  readonly evidence?: readonly string[];
}

export interface DeterministicStateEffect {
  readonly kind: 'effect';
  readonly statement: string;
  readonly evidence: string;
}

/**
 * The scenario carries the shared section-11 context. Execution-specific
 * adjudication and outcome expectations live in `executions`, so a consumer
 * can enumerate independently falsifiable executions without probe-specific
 * knowledge.
 */
export interface FixtureExecution {
  readonly executionId: string;
  readonly campaignRuleState: ExplicitNone | Record<string, unknown>;
  readonly expectedRouteClasses: readonly RouteExpectation[];
  readonly expectedAmbiguityState: ExplicitNone | AmbiguityState;
  readonly expectedCampaignRuleOrRulingState: ExplicitNone | CampaignRuleCases;
  readonly expectedCapabilityStatus: CapabilityExpectation;
  readonly expectedDeterministicStateEffect:
    | ExplicitNone
    | DeterministicStateEffect;
  readonly oracleSignals: readonly OracleSignal[];
}

export interface DiagnosticFixture {
  readonly playerInput: string;
  readonly campaignState: Record<string, unknown>;
  readonly adventureState: ExplicitNone | Record<string, unknown>;
  readonly mustIncludeTargets: readonly DiagnosticTarget[];
  readonly mayIncludeTargets: readonly DiagnosticTarget[];
  readonly mustNotIncludeTargets: readonly DiagnosticTarget[];
  readonly requiredRetainedFacts: ExplicitNone | readonly RetainedFact[];
  readonly requiredRelationshipExpansion:
    | ExplicitNone
    | readonly TypedRelationshipExpectation[];
  readonly executions: readonly FixtureExecution[];

  readonly probeId: `P${1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12}`;
  readonly title: string;
  readonly verifiedAtCommit: string;
  readonly gatingBlocker: GatingBlocker;
  readonly boundedEvidenceStatement: string;
  // Oracle signals belong to FixtureExecution, not here: a supplied answer is
  // consumed by one execution, and labelling it at scenario level would attach
  // it to executions that never used it. `FIXTURE_KEYS` rejects it here.
}

export interface GatingBlocker {
  readonly id: 'B1' | 'B2' | 'B3' | 'B4' | 'B5' | 'none';
  readonly owningBead: string;
  readonly gates: string;
}

export interface OracleSignal {
  readonly label: string;
  readonly supplies: string;
  readonly why: string;
}

export const CORPUS_NON_CLAIMS = [
  'The corpus does not define a universal clause ontology.',
  'The corpus does not define a universal obligation identity; that remains eshyra-o9bd.19.1.14’s question.',
  'The route labels are not a closed relationship vocabulary.',
  'The twelve scenarios do not partition the corpus.',
  'The corpus does not produce a coverage, readiness, or completeness figure.',
  'A selector’s absence does not prove that the underlying material is absent.',
] as const;

const FIXTURE_KEYS = new Set([
  'playerInput',
  'campaignState',
  'adventureState',
  'mustIncludeTargets',
  'mayIncludeTargets',
  'mustNotIncludeTargets',
  'requiredRetainedFacts',
  'requiredRelationshipExpansion',
  'executions',
  'probeId',
  'title',
  'verifiedAtCommit',
  'gatingBlocker',
  'boundedEvidenceStatement',
]);
const EXECUTION_KEYS = new Set([
  'executionId',
  'playerInput',
  'campaignState',
  'adventureState',
  'campaignRuleState',
  'mustIncludeTargets',
  'mayIncludeTargets',
  'mustNotIncludeTargets',
  'expectedRouteClasses',
  'requiredRetainedFacts',
  'requiredRelationshipExpansion',
  'expectedAmbiguityState',
  'expectedCampaignRuleOrRulingState',
  'expectedCapabilityStatus',
  'expectedDeterministicStateEffect',
  'oracleSignals',
  'probeId',
  'title',
  'verifiedAtCommit',
  'gatingBlocker',
  'boundedEvidenceStatement',
]);
const ROUTE_CLASSES = new Set<RouteClass>([
  'direct-state-ref',
  'direct-adventure-ref',
  'explicit-name-or-alias',
  'typed-relationship',
  'situation-cue',
  'auditor-missing-target',
  'campaign-rule',
  'campaign-ruling',
  'capability-preflight',
]);
const SELECTOR_KEYS = {
  'ambiguity-id': new Set(['kind', 'id']),
  'json-pointer': new Set(['kind', 'pointer']),
  'source-text-predicate': new Set(['kind', 'description', 'exactSubstring']),
  'stable-id': new Set(['kind', 'idKind', 'id']),
} as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function nonEmptyString(
  value: unknown,
  label: string,
): asserts value is string {
  if (typeof value !== 'string' || value.trim().length === 0)
    throw new Error(`${label} must be a non-empty string`);
}

function checkExactKeys(
  value: Record<string, unknown>,
  expected: ReadonlySet<string>,
  label: string,
): void {
  for (const key of Object.keys(value)) {
    if (!expected.has(key)) throw new Error(`unknown ${label} field "${key}"`);
  }
  for (const key of expected) {
    if (!Object.hasOwn(value, key))
      throw new Error(`missing ${label} field "${key}"`);
  }
}

function checkKeysAndRequired(
  value: Record<string, unknown>,
  allowed: ReadonlySet<string>,
  required: ReadonlySet<string>,
  label: string,
): void {
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) throw new Error(`unknown ${label} field "${key}"`);
  }
  for (const key of required) {
    if (!Object.hasOwn(value, key))
      throw new Error(`missing ${label} field "${key}"`);
  }
}

function checkExplicitNone(value: unknown, label: string): void {
  if (!isRecord(value))
    throw new Error(`${label} must be an explicit none value`);
  checkExactKeys(value, new Set(['kind', 'statement']), label);
  if (value.kind !== 'none') throw new Error(`${label} must declare kind none`);
  nonEmptyString(value.statement, `${label}.statement`);
}

function checkSelector(value: unknown, label: string): void {
  if (!isRecord(value)) throw new Error(`${label} must be a selector object`);
  const kind = value.kind;
  if (
    kind !== 'json-pointer' &&
    kind !== 'ambiguity-id' &&
    kind !== 'stable-id' &&
    kind !== 'source-text-predicate'
  )
    throw new Error(`${label} has an unknown selector kind`);
  checkExactKeys(value, SELECTOR_KEYS[kind], label);
  if (kind === 'json-pointer') {
    nonEmptyString(value.pointer, `${label}.pointer`);
    if (!value.pointer.startsWith('/'))
      throw new Error(`${label}.pointer must be a JSON pointer`);
  } else if (kind === 'ambiguity-id') {
    nonEmptyString(value.id, `${label}.id`);
    if (!value.id.startsWith('ambiguity:'))
      throw new Error(`${label}.id must be an existing ambiguity id`);
  } else if (kind === 'stable-id') {
    if (value.idKind !== 'operation' && value.idKind !== 'clause')
      throw new Error(`${label}.idKind must be operation or clause`);
    nonEmptyString(value.id, `${label}.id`);
  } else {
    nonEmptyString(value.description, `${label}.description`);
    nonEmptyString(value.exactSubstring, `${label}.exactSubstring`);
  }
}

function targetReference(target: DiagnosticTarget): string {
  if (target.targetKind === 'rules-record') return target.recordKey;
  if (target.targetKind === 'absent-rules-record') return target.recordKey;
  return `${target.moduleId}#${target.entityKind}:${target.entityId}`;
}

function checkTarget(value: unknown, label: string): void {
  if (!isRecord(value)) throw new Error(`${label} must be a target object`);
  const kind = value.targetKind;
  if (kind === 'rules-record') {
    checkKeysAndRequired(
      value,
      new Set(['targetKind', 'recordKey', 'sourceRef', 'locator', 'selector']),
      new Set(['targetKind', 'recordKey', 'sourceRef', 'locator']),
      label,
    );
    nonEmptyString(value.recordKey, `${label}.recordKey`);
    nonEmptyString(value.sourceRef, `${label}.sourceRef`);
    nonEmptyString(value.locator, `${label}.locator`);
    if (value.selector !== undefined)
      checkSelector(value.selector, `${label}.selector`);
  } else if (kind === 'adventure-entity') {
    checkExactKeys(
      value,
      new Set(['targetKind', 'moduleId', 'entityKind', 'entityId']),
      label,
    );
    nonEmptyString(value.moduleId, `${label}.moduleId`);
    if (value.entityKind !== 'location' && value.entityKind !== 'encounter')
      throw new Error(`${label}.entityKind is invalid`);
    nonEmptyString(value.entityId, `${label}.entityId`);
  } else if (kind === 'absent-rules-record') {
    checkExactKeys(
      value,
      new Set(['targetKind', 'recordKey', 'reason']),
      label,
    );
    nonEmptyString(value.recordKey, `${label}.recordKey`);
    nonEmptyString(value.reason, `${label}.reason`);
  } else {
    throw new Error(`${label}.targetKind is invalid`);
  }
}

function checkFacts(value: unknown, label: string): void {
  if (isRecord(value) && value.kind === 'none') {
    checkExplicitNone(value, label);
    return;
  }
  if (!Array.isArray(value) || value.length === 0)
    throw new Error(`${label} must be a non-empty list or explicit none`);
  for (const [index, fact] of value.entries()) {
    if (!isRecord(fact))
      throw new Error(`${label}[${index}] must be an object`);
    nonEmptyString(fact.statement, `${label}[${index}].statement`);
    if (fact.targetRef !== undefined)
      nonEmptyString(fact.targetRef, `${label}[${index}].targetRef`);
    if (fact.exactSubstring !== undefined) {
      nonEmptyString(fact.exactSubstring, `${label}[${index}].exactSubstring`);
      // An unanchored substring expectation would fall back to searching pack
      // metadata, which silently turns a claim about one record into a claim
      // about the pack's own license text. Historical or narrative evidence
      // belongs in `statement` as prose, unbound to the live pack.
      if (fact.targetRef === undefined)
        throw new Error(
          `${label}[${index}].exactSubstring requires targetRef; unanchored substrings must stay prose in statement`,
        );
    }
    if (fact.typedPath !== undefined) {
      nonEmptyString(fact.typedPath, `${label}[${index}].typedPath`);
      if (!fact.typedPath.startsWith('/'))
        throw new Error(`${label}[${index}].typedPath must be a JSON pointer`);
    }
  }
}

function checkCampaignRuleCases(value: unknown, label: string): void {
  if (isRecord(value) && value.kind === 'none') {
    checkExplicitNone(value, label);
    return;
  }
  if (
    !isRecord(value) ||
    value.kind !== 'campaign-rule-cases' ||
    !Array.isArray(value.cases) ||
    value.cases.length === 0
  )
    throw new Error(
      `${label} must be a non-empty campaign-rule case list or explicit none`,
    );
  for (const [index, item] of value.cases.entries()) {
    if (!isRecord(item))
      throw new Error(`${label}.cases[${index}] must be an object`);
    nonEmptyString(item.caseId, `${label}.cases[${index}].caseId`);
    nonEmptyString(item.statement, `${label}.cases[${index}].statement`);
    for (const key of ['ruleIdentity', 'scope', 'provenance'])
      if (item[key] !== undefined)
        nonEmptyString(item[key], `${label}.cases[${index}].${key}`);
    if (
      item.ruleKind !== undefined &&
      item.ruleKind !== 'house-rule' &&
      item.ruleKind !== 'ruling'
    )
      throw new Error(`${label}.cases[${index}].ruleKind is invalid`);
  }
}

function checkExecution(value: Record<string, unknown>, index: number): void {
  checkExactKeys(value, EXECUTION_KEYS, `fixture ${index} execution`);
  nonEmptyString(value.playerInput, `fixture ${index}.playerInput`);
  if (
    !isRecord(value.campaignState) ||
    Object.keys(value.campaignState).length === 0
  )
    throw new Error(
      `fixture ${index}.campaignState must be a non-empty object`,
    );
  for (const [label, field] of [
    ['adventureState', value.adventureState],
    ['campaignRuleState', value.campaignRuleState] as const,
  ]) {
    if (isRecord(field) && field.kind === 'none')
      checkExplicitNone(field, `fixture ${index}.${label}`);
    else if (!isRecord(field) || Object.keys(field).length === 0)
      throw new Error(
        `fixture ${index}.${label} must be a non-empty object or explicit none`,
      );
  }
  for (const field of [
    'mustIncludeTargets',
    'mayIncludeTargets',
    'mustNotIncludeTargets',
  ] as const) {
    if (!Array.isArray(value[field]))
      throw new Error(`fixture ${index}.${field} must be an array`);
    if (field === 'mustIncludeTargets' && value[field].length === 0)
      throw new Error(`fixture ${index}.mustIncludeTargets must not be empty`);
    value[field].forEach((target, targetIndex) => {
      checkTarget(target, `fixture ${index}.${field}[${targetIndex}]`);
    });
  }
  if (
    !Array.isArray(value.expectedRouteClasses) ||
    value.expectedRouteClasses.length === 0
  )
    throw new Error(
      `fixture ${index}.expectedRouteClasses must be a non-empty array`,
    );
  const targetRefs = new Set(value.mustIncludeTargets.map(targetReference));
  const coveredTargetRefs = new Set<string>();
  for (const [routeIndex, route] of value.expectedRouteClasses.entries()) {
    if (!isRecord(route))
      throw new Error(
        `fixture ${index}.expectedRouteClasses[${routeIndex}] must be an object`,
      );
    nonEmptyString(
      route.targetRef,
      `fixture ${index}.expectedRouteClasses[${routeIndex}].targetRef`,
    );
    if (!targetRefs.has(route.targetRef))
      throw new Error(
        `fixture ${index}.expectedRouteClasses[${routeIndex}] names a non-must-include target`,
      );
    coveredTargetRefs.add(route.targetRef);
    if (!Array.isArray(route.routes) || route.routes.length === 0)
      throw new Error(
        `fixture ${index}.expectedRouteClasses[${routeIndex}].routes must not be empty`,
      );
    for (const routeClass of route.routes) {
      if (
        typeof routeClass !== 'string' ||
        !ROUTE_CLASSES.has(routeClass as RouteClass)
      )
        throw new Error(
          `fixture ${index}.expectedRouteClasses[${routeIndex}] has unknown route class`,
        );
    }
    nonEmptyString(
      route.why,
      `fixture ${index}.expectedRouteClasses[${routeIndex}].why`,
    );
  }
  const missingRouteTargets = [...targetRefs].filter(
    (targetRef) => !coveredTargetRefs.has(targetRef),
  );
  if (missingRouteTargets.length > 0)
    throw new Error(
      `fixture ${index}.expectedRouteClasses is missing must-include target coverage: ${missingRouteTargets.join(', ')}`,
    );
  const routeClasses = new Set(
    value.expectedRouteClasses.flatMap((route) => route.routes),
  );
  const noActiveRuling =
    isRecord(value.campaignRuleState) &&
    value.campaignRuleState.kind === 'none';
  if (noActiveRuling && routeClasses.has('campaign-ruling'))
    throw new Error(
      `fixture ${index}.expectedRouteClasses cannot include campaign-ruling without an active ruling`,
    );
  if (
    !noActiveRuling &&
    isRecord(value.expectedCampaignRuleOrRulingState) &&
    value.expectedCampaignRuleOrRulingState.kind === 'campaign-rule-cases' &&
    value.expectedCampaignRuleOrRulingState.cases.some(
      (item) => item.ruleKind === 'ruling',
    ) &&
    !routeClasses.has('campaign-ruling')
  )
    throw new Error(
      `fixture ${index}.expectedRouteClasses must include campaign-ruling for an active ruling`,
    );
  checkFacts(
    value.requiredRetainedFacts,
    `fixture ${index}.requiredRetainedFacts`,
  );
  if (
    isRecord(value.requiredRelationshipExpansion) &&
    value.requiredRelationshipExpansion.kind === 'none'
  ) {
    checkExplicitNone(
      value.requiredRelationshipExpansion,
      `fixture ${index}.requiredRelationshipExpansion`,
    );
  } else {
    if (
      !Array.isArray(value.requiredRelationshipExpansion) ||
      value.requiredRelationshipExpansion.length === 0
    )
      throw new Error(
        `fixture ${index}.requiredRelationshipExpansion must be a non-empty list or explicit none`,
      );
    for (const [
      relationIndex,
      relation,
    ] of value.requiredRelationshipExpansion.entries()) {
      if (!isRecord(relation))
        throw new Error(
          `fixture ${index}.requiredRelationshipExpansion[${relationIndex}] must be an object`,
        );
      for (const key of [
        'sourceRecordKey',
        'linkField',
        'relation',
        'targetRecordKey',
        'statement',
      ])
        nonEmptyString(
          relation[key],
          `fixture ${index}.requiredRelationshipExpansion[${relationIndex}].${key}`,
        );
    }
  }
  if (
    isRecord(value.expectedAmbiguityState) &&
    value.expectedAmbiguityState.kind === 'none'
  )
    checkExplicitNone(
      value.expectedAmbiguityState,
      `fixture ${index}.expectedAmbiguityState`,
    );
  else {
    const ambiguityState = value.expectedAmbiguityState;
    if (
      !isRecord(ambiguityState) ||
      ambiguityState.kind !== 'ambiguities' ||
      !Array.isArray(ambiguityState.expectations) ||
      ambiguityState.expectations.length === 0
    )
      throw new Error(`fixture ${index}.expectedAmbiguityState is invalid`);
    for (const [
      ambiguityIndex,
      item,
    ] of ambiguityState.expectations.entries()) {
      if (!isRecord(item))
        throw new Error(
          `fixture ${index}.expectedAmbiguityState.expectations[${ambiguityIndex}] must be an object`,
        );
      nonEmptyString(
        item.ambiguityId,
        `fixture ${index}.expectedAmbiguityState.expectations[${ambiguityIndex}].ambiguityId`,
      );
      if (
        item.expectedResolution !== 'resolved' &&
        item.expectedResolution !== 'unresolved'
      )
        throw new Error(
          `fixture ${index}.expectedAmbiguityState has invalid resolution`,
        );
      if (
        !Array.isArray(item.interpretationIds) ||
        item.interpretationIds.length === 0
      )
        throw new Error(
          `fixture ${index}.expectedAmbiguityState has no interpretations`,
        );
      item.interpretationIds.forEach((id, idIndex) => {
        nonEmptyString(
          id,
          `fixture ${index}.expectedAmbiguityState.expectations[${ambiguityIndex}].interpretationIds[${idIndex}]`,
        );
      });
      nonEmptyString(
        item.statement,
        `fixture ${index}.expectedAmbiguityState.expectations[${ambiguityIndex}].statement`,
      );
    }
  }
  checkCampaignRuleCases(
    value.expectedCampaignRuleOrRulingState,
    `fixture ${index}.expectedCampaignRuleOrRulingState`,
  );
  if (!isRecord(value.expectedCapabilityStatus))
    throw new Error(
      `fixture ${index}.expectedCapabilityStatus must be an object`,
    );
  if (
    !['none-selected', 'implemented', 'available', 'blocked'].includes(
      String(value.expectedCapabilityStatus.status),
    )
  )
    throw new Error(
      `fixture ${index}.expectedCapabilityStatus.status is invalid`,
    );
  nonEmptyString(
    value.expectedCapabilityStatus.statement,
    `fixture ${index}.expectedCapabilityStatus.statement`,
  );
  for (const key of ['capabilityId', 'revision', 'residualInterpretation'])
    if (value.expectedCapabilityStatus[key] !== undefined)
      nonEmptyString(
        value.expectedCapabilityStatus[key],
        `fixture ${index}.expectedCapabilityStatus.${key}`,
      );
  for (const key of ['inputs', 'exclusions', 'evidence']) {
    if (value.expectedCapabilityStatus[key] !== undefined) {
      if (
        !Array.isArray(value.expectedCapabilityStatus[key]) ||
        value.expectedCapabilityStatus[key].length === 0
      )
        throw new Error(
          `fixture ${index}.expectedCapabilityStatus.${key} must be non-empty when present`,
        );
      value.expectedCapabilityStatus[key].forEach((item, itemIndex) => {
        nonEmptyString(
          item,
          `fixture ${index}.expectedCapabilityStatus.${key}[${itemIndex}]`,
        );
      });
    }
  }
  if (
    isRecord(value.expectedDeterministicStateEffect) &&
    value.expectedDeterministicStateEffect.kind === 'none'
  )
    checkExplicitNone(
      value.expectedDeterministicStateEffect,
      `fixture ${index}.expectedDeterministicStateEffect`,
    );
  else {
    if (
      !isRecord(value.expectedDeterministicStateEffect) ||
      value.expectedDeterministicStateEffect.kind !== 'effect'
    )
      throw new Error(
        `fixture ${index}.expectedDeterministicStateEffect is invalid`,
      );
    nonEmptyString(
      value.expectedDeterministicStateEffect.statement,
      `fixture ${index}.expectedDeterministicStateEffect.statement`,
    );
    nonEmptyString(
      value.expectedDeterministicStateEffect.evidence,
      `fixture ${index}.expectedDeterministicStateEffect.evidence`,
    );
  }
  if (!/^P(?:[1-9]|1[0-2])$/.test(String(value.probeId)))
    throw new Error(`fixture ${index}.probeId is invalid`);
  nonEmptyString(value.title, `fixture ${index}.title`);
  if (!/^[0-9a-f]{40}$/.test(String(value.verifiedAtCommit)))
    throw new Error(
      `fixture ${index}.verifiedAtCommit must be a full commit SHA`,
    );
  if (!isRecord(value.gatingBlocker))
    throw new Error(`fixture ${index}.gatingBlocker must be an object`);
  if (
    !['B1', 'B2', 'B3', 'B4', 'B5', 'none'].includes(
      String(value.gatingBlocker.id),
    )
  )
    throw new Error(`fixture ${index}.gatingBlocker.id is invalid`);
  nonEmptyString(
    value.gatingBlocker.owningBead,
    `fixture ${index}.gatingBlocker.owningBead`,
  );
  nonEmptyString(
    value.gatingBlocker.gates,
    `fixture ${index}.gatingBlocker.gates`,
  );
  nonEmptyString(
    value.boundedEvidenceStatement,
    `fixture ${index}.boundedEvidenceStatement`,
  );
  const bounded = value.boundedEvidenceStatement.toLowerCase();
  for (const phrase of [
    'bounded evidence',
    'not a completeness unit',
    'not a partition',
    'coverage',
    'readiness',
    'completeness',
  ])
    if (!bounded.includes(phrase))
      throw new Error(
        `fixture ${index}.boundedEvidenceStatement must state the corpus non-claims`,
      );
  if (!Array.isArray(value.oracleSignals))
    throw new Error(`fixture ${index}.oracleSignals must be an array`);
  for (const [signalIndex, signal] of value.oracleSignals.entries()) {
    if (!isRecord(signal))
      throw new Error(
        `fixture ${index}.oracleSignals[${signalIndex}] must be an object`,
      );
    nonEmptyString(
      signal.label,
      `fixture ${index}.oracleSignals[${signalIndex}].label`,
    );
    nonEmptyString(
      signal.supplies,
      `fixture ${index}.oracleSignals[${signalIndex}].supplies`,
    );
    nonEmptyString(
      signal.why,
      `fixture ${index}.oracleSignals[${signalIndex}].why`,
    );
  }
}

function checkFixture(value: unknown, index: number): DiagnosticFixture {
  if (!isRecord(value)) throw new Error(`fixture ${index} must be an object`);
  checkExactKeys(value, FIXTURE_KEYS, `fixture ${index}`);
  if (!Array.isArray(value.executions) || value.executions.length === 0)
    throw new Error(`fixture ${index}.executions must be a non-empty array`);
  const executionIds = new Set<string>();
  const { executions, ...scenario } = value;
  for (const [executionIndex, execution] of executions.entries()) {
    if (!isRecord(execution))
      throw new Error(
        `fixture ${index}.executions[${executionIndex}] must be an object`,
      );
    checkExactKeys(
      execution,
      new Set([
        'executionId',
        'campaignRuleState',
        'expectedRouteClasses',
        'expectedAmbiguityState',
        'expectedCampaignRuleOrRulingState',
        'expectedCapabilityStatus',
        'expectedDeterministicStateEffect',
        'oracleSignals',
      ]),
      `fixture ${index}.executions[${executionIndex}]`,
    );
    nonEmptyString(
      execution.executionId,
      `fixture ${index}.executions[${executionIndex}].executionId`,
    );
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(execution.executionId))
      throw new Error(
        `fixture ${index}.executions[${executionIndex}].executionId must be kebab-case`,
      );
    if (executionIds.has(execution.executionId))
      throw new Error(
        `duplicate execution id ${execution.executionId} in fixture ${index}`,
      );
    executionIds.add(execution.executionId);
    checkExecution(
      {
        ...scenario,
        ...execution,
      },
      index,
    );
  }
  return value as unknown as DiagnosticFixture;
}

export function rulesTarget(
  recordKey: string,
  locator: string,
  selector?: DiagnosticSelector,
): RulesRecordTarget {
  return {
    targetKind: 'rules-record',
    recordKey,
    sourceRef: SRD_SOURCE_REF,
    locator,
    ...(selector === undefined ? {} : { selector }),
  };
}

export function none(statement: string): ExplicitNone {
  return { kind: 'none', statement };
}

export function validateDiagnosticCorpus(
  fixtures: readonly DiagnosticFixture[],
): readonly DiagnosticFixture[] {
  if (!Array.isArray(fixtures) || fixtures.length === 0)
    throw new Error('diagnostic corpus must be a non-empty array');
  const seen = new Set<string>();
  const validated = fixtures.map((fixture, index) =>
    checkFixture(fixture, index),
  );
  for (const fixture of validated) {
    if (seen.has(fixture.probeId))
      throw new Error(`duplicate probe id ${fixture.probeId}`);
    seen.add(fixture.probeId);
  }
  const expected = new Set(
    Array.from({ length: 12 }, (_, index) => `P${index + 1}`),
  );
  const missing = [...expected].filter((probeId) => !seen.has(probeId));
  if (missing.length > 0)
    throw new Error(`missing probe ids: ${missing.join(', ')}`);
  return validated;
}
