import { evaluateClauseCompleteness } from './contracts.js';
import type {
  Clause,
  MechanicsRecordFamily,
  ObligationEvidence,
  ObligationId,
  ObligationOrigin,
  SemanticFacet,
  SourceObligationRecord,
} from './types.js';

export interface ObligationRegistry {
  readonly records: readonly SourceObligationRecord[];
  get(obligationId: ObligationId): SourceObligationRecord | undefined;
}

const FACETS = new Set<SemanticFacet>([
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
  'repeat-check',
  'termination',
]);

function nonEmpty(value: string, label: string): void {
  if (value.trim().length === 0) throw new Error(`${label} must be non-empty`);
}

function evidenceIsResolvable(evidence: ObligationEvidence): boolean {
  switch (evidence.kind) {
    case 'source-span':
      return (
        evidence.sourceRef.trim().length > 0 &&
        evidence.locator.trim().length > 0 &&
        evidence.start >= 0 &&
        evidence.end > evidence.start &&
        evidence.text.trim().length > 0
      );
    case 'authoritative-input':
      return (
        evidence.sourceRef.trim().length > 0 &&
        evidence.locator.trim().length > 0 &&
        evidence.inputId.trim().length > 0 &&
        evidence.digest.trim().length > 0
      );
    case 'audit-finding':
      return evidence.findingId.trim().length > 0;
    case 'code':
      return (
        evidence.path.trim().length > 0 && evidence.symbol.trim().length > 0
      );
    case 'bead':
      return evidence.beadId.trim().length > 0;
    case 'known-missing-source-clause':
      return (
        evidence.sourceRef.trim().length > 0 &&
        evidence.locator.trim().length > 0 &&
        evidence.findingId.trim().length > 0
      );
  }
}

function validateOriginEvidence(
  origin: ObligationOrigin,
  evidence: readonly ObligationEvidence[],
): void {
  const valid = evidence.some((item) =>
    origin === 'source-extraction'
      ? item.kind === 'source-span'
      : origin === 'curated-specification'
        ? item.kind === 'authoritative-input'
        : item.kind === 'audit-finding',
  );
  if (!valid)
    throw new Error(
      `obligation origin ${origin} has no authoritative evidence`,
    );
}

function validateRecord(record: SourceObligationRecord): void {
  nonEmpty(record.obligationId, 'obligationId');
  if (!record.obligationId.startsWith('obl:::'))
    throw new Error(`invalid obligation identity ${record.obligationId}`);
  const identityParts = record.obligationId.split(':::');
  if (
    identityParts.length !== 4 ||
    !record.requiredFacets.includes(identityParts[3] as SemanticFacet)
  ) {
    throw new Error(
      `obligation ${record.obligationId} does not match its canonical facet identity`,
    );
  }
  if (record.evidence.length === 0 || record.requiredFacets.length === 0) {
    throw new Error(
      `obligation ${record.obligationId} must have evidence and facets`,
    );
  }
  if (new Set(record.requiredFacets).size !== record.requiredFacets.length) {
    throw new Error(`obligation ${record.obligationId} repeats a facet`);
  }
  for (const facet of record.requiredFacets) {
    if (!FACETS.has(facet))
      throw new Error(
        `obligation ${record.obligationId} has unknown facet ${facet}`,
      );
  }
  const contradictoryGroups = [
    ['save-with-damage', 'save-without-damage'],
    ['resource-with-reset', 'resource-without-reset'],
    ['duration-with-concentration', 'duration-without-concentration'],
    ['effect-with-lifecycle', 'effect-without-lifecycle'],
  ];
  for (const group of contradictoryGroups) {
    if (
      group.every((facet) =>
        record.requiredFacets.includes(facet as SemanticFacet),
      )
    ) {
      throw new Error(
        `obligation ${record.obligationId} has contradictory facets`,
      );
    }
  }
  for (const item of record.evidence) {
    if (!evidenceIsResolvable(item))
      throw new Error(`obligation ${record.obligationId} has stale evidence`);
  }
  validateOriginEvidence(record.origin, record.evidence);
}

export function createObligationId(
  sourceRef: string,
  locator: string,
  facet: SemanticFacet,
): ObligationId {
  nonEmpty(sourceRef, 'sourceRef');
  nonEmpty(locator, 'locator');
  if (!FACETS.has(facet)) throw new Error(`unknown semantic facet ${facet}`);
  return `obl:::${sourceRef}:::${locator}:::${facet}`;
}

export function createObligationRegistry(
  records: readonly SourceObligationRecord[],
): ObligationRegistry {
  const ids = new Set<ObligationId>();
  for (const record of records) {
    validateRecord(record);
    if (ids.has(record.obligationId))
      throw new Error(`duplicate obligation ${record.obligationId}`);
    ids.add(record.obligationId);
  }
  const frozenRecords = Object.freeze(
    records.map((record) => {
      const copied: SourceObligationRecord = {
        ...record,
        evidence: [record.evidence[0], ...record.evidence.slice(1)],
        requiredFacets: [
          record.requiredFacets[0],
          ...record.requiredFacets.slice(1),
        ],
      };
      return Object.freeze(copied);
    }),
  );
  const byId = new Map(
    frozenRecords.map((record) => [record.obligationId, record]),
  );
  return Object.freeze({
    records: frozenRecords,
    get: (id: ObligationId) => byId.get(id),
  });
}

export interface FamilyApplicability {
  readonly family: MechanicsRecordFamily;
  readonly recordKey: string;
  readonly status: 'applicable' | 'not-applicable';
  readonly evidence: readonly ObligationEvidence[];
}

export interface ObligationScope {
  readonly scopeId: string;
  readonly applicability: FamilyApplicability;
  /** Source-derived membership, never inferred from the clauses under test. */
  readonly obligationIds: readonly ObligationId[];
}

export interface ObligationMembership {
  readonly clauseId: string;
  readonly obligationIds: readonly ObligationId[];
}

export function createObligationScope(
  registry: ObligationRegistry,
  scope: ObligationScope,
): ObligationScope {
  nonEmpty(scope.scopeId, 'scopeId');
  nonEmpty(scope.applicability.recordKey, 'recordKey');
  if (scope.applicability.evidence.length === 0)
    throw new Error(`scope ${scope.scopeId} has no applicability evidence`);
  if (
    scope.applicability.status === 'applicable' &&
    scope.obligationIds.length === 0
  ) {
    throw new Error(
      `applicable scope ${scope.scopeId} has no source obligations`,
    );
  }
  if (new Set(scope.obligationIds).size !== scope.obligationIds.length)
    throw new Error(`scope ${scope.scopeId} repeats an obligation`);
  for (const obligationId of scope.obligationIds) {
    if (registry.get(obligationId) === undefined)
      throw new Error(
        `scope ${scope.scopeId} names unknown obligation ${obligationId}`,
      );
  }
  return Object.freeze({
    ...scope,
    obligationIds: Object.freeze([...scope.obligationIds]),
  });
}

export type ClosureStatus = 'satisfied' | 'claimed-incomplete' | 'UNCLAIMED';

export interface ObligationClosureEntry {
  readonly obligationId: ObligationId;
  readonly status: ClosureStatus;
  readonly clauseIds: readonly string[];
}

export interface ObligationClosureResult {
  readonly scopeId: string;
  readonly applicability: FamilyApplicability;
  readonly membership: readonly ObligationMembership[];
  readonly obligations: readonly ObligationClosureEntry[];
}

/** Closure is over an independently supplied source scope, not a family array. */
export function evaluateObligationClosure(
  registry: ObligationRegistry,
  clauses: readonly Clause[],
  scope: ObligationScope,
): ObligationClosureResult {
  const expected = new Set(scope.obligationIds);
  const membership = clauses.map((clause) => ({
    clauseId: clause.identity.id,
    obligationIds: Object.freeze([...clause.sourceObligationIds]),
  }));
  const claimers = new Map<ObligationId, string[]>();
  for (const clause of clauses) {
    for (const obligationId of clause.sourceObligationIds) {
      if (
        !expected.has(obligationId) ||
        registry.get(obligationId) === undefined
      )
        continue;
      const entries = claimers.get(obligationId) ?? [];
      entries.push(clause.identity.id);
      claimers.set(obligationId, entries);
    }
  }
  return {
    scopeId: scope.scopeId,
    applicability: scope.applicability,
    membership,
    obligations: scope.obligationIds.map((obligationId) => {
      const clauseIds = claimers.get(obligationId) ?? [];
      const claimedClauses = clauses.filter((clause) =>
        clause.sourceObligationIds.includes(obligationId),
      );
      const satisfied =
        claimedClauses.length > 0 &&
        claimedClauses.every(
          (clause) =>
            evaluateClauseCompleteness(clause, registry).semantic.status ===
            'complete',
        );
      return {
        obligationId,
        status:
          clauseIds.length === 0
            ? 'UNCLAIMED'
            : satisfied
              ? 'satisfied'
              : 'claimed-incomplete',
        clauseIds: Object.freeze([...clauseIds]),
      };
    }),
  };
}

export const RECORD_FAMILY_APPLICABILITY: readonly MechanicsRecordFamily[] = [
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
];
