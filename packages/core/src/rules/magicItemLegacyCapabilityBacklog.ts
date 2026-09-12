import { MAGIC_ITEM_OPERATION_READINESS_CAPABILITY } from '../state/itemExecutionReadiness.js';
import type { RulesPack, RulesRecord } from './types.js';

type ObjectValue = Record<string, unknown>;

function object(value: unknown): ObjectValue | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as ObjectValue)
    : undefined;
}

/** The bounded legacy source of this migration bridge, not a rules universe. */
export const MAGIC_ITEM_LEGACY_CAPABILITY_BACKLOG_SOURCE =
  'derived-magic-item-clauses-v1' as const;

export class MagicItemLegacyCapabilityBacklogError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MagicItemLegacyCapabilityBacklogError';
  }
}

/**
 * A source-linked candidate extracted from one legacy `missingHooks` clause.
 *
 * This is deliberately a candidate/backlog row rather than a capability
 * declaration. A generated engine:F label says only that the legacy compiler
 * recorded a missing hook for this bounded clause; it cannot demonstrate an
 * invocation, behavior, source completeness, or a selected operation.
 */
export interface MagicItemLegacyCapabilityCandidate {
  /** Stable across report ordering: the compiler's clause identity. */
  readonly candidateId: string;
  readonly recordKey: string;
  readonly clauseId: string;
  readonly source: {
    readonly readinessRevision: typeof MAGIC_ITEM_LEGACY_CAPABILITY_BACKLOG_SOURCE;
    readonly sourceRef: string;
    readonly locator?: string;
  };
  /** The legacy family/hook labels, retained as backlog detail only. */
  readonly missingHooks: readonly {
    readonly engine: string;
    readonly hook: string;
  }[];
  readonly legacyReadiness: 'engine-pending' | 'design-blocked';
  /** No legacy row becomes selected merely by appearing in this inventory. */
  readonly disposition: 'unselected-backlog';
  readonly evidence: {
    /** Foundation 4: this is explicitly not capability-execution evidence. */
    readonly claimStrength: 'candidate-only-not-capability-execution-evidence';
    readonly exactClaim: string;
    readonly nonClaims: readonly string[];
  };
}

/**
 * The one existing positive operation is reported separately from candidates.
 * It is not a claim that any legacy candidate's source semantics are complete,
 * executable, or selected.
 */
export interface SelectedMagicItemCapability {
  readonly revision: string;
  readonly operationId: string;
  readonly operation: string;
  readonly requiredInputs: readonly string[];
  readonly exclusions: readonly string[];
  readonly residualDmInterpretation: readonly string[];
  readonly evidence: {
    readonly claimStrength: 'declared-contract-not-capability-execution-evidence';
    readonly exactClaim: string;
    readonly nonClaims: readonly string[];
  };
}

export interface MagicItemLegacyCapabilityBacklog {
  /** Explicitly bounds the denominator to legacy clauses with `missingHooks`. */
  readonly scope: 'legacy-magic-item-missing-hooks-only';
  readonly source: typeof MAGIC_ITEM_LEGACY_CAPABILITY_BACKLOG_SOURCE;
  readonly candidates: readonly MagicItemLegacyCapabilityCandidate[];
  readonly selectedCapabilities: readonly SelectedMagicItemCapability[];
}

function candidateFromClause(
  record: RulesRecord,
  clause: unknown,
  index: number,
): MagicItemLegacyCapabilityCandidate | undefined {
  const value = object(clause);
  const context = `${record.key}.executionReadiness.clauses[${index}]`;
  if (value === undefined)
    throw new MagicItemLegacyCapabilityBacklogError(
      `${context} must be an object`,
    );
  const missingHooks = value.missingHooks;
  if (missingHooks === undefined) return undefined;
  if (!Array.isArray(missingHooks) || missingHooks.length === 0)
    throw new MagicItemLegacyCapabilityBacklogError(
      `${context}.missingHooks must be a non-empty array when present`,
    );
  const clauseId = value.clauseId;
  const readiness = value.readiness;
  if (typeof clauseId !== 'string' || clauseId.length === 0)
    throw new MagicItemLegacyCapabilityBacklogError(
      `${context}.clauseId is required`,
    );
  if (readiness !== 'engine-pending' && readiness !== 'design-blocked')
    throw new MagicItemLegacyCapabilityBacklogError(
      `${context} has missing hooks but is not an explicit unresolved backlog row`,
    );
  const hooks = missingHooks.map((rawHook, hookIndex) => {
    const hook = object(rawHook);
    if (typeof hook?.engine !== 'string' || typeof hook.hook !== 'string')
      throw new MagicItemLegacyCapabilityBacklogError(
        `${context}.missingHooks[${hookIndex}] must name engine and hook`,
      );
    return { engine: hook.engine, hook: hook.hook };
  });
  return {
    candidateId: clauseId,
    recordKey: record.key,
    clauseId,
    source: {
      readinessRevision: MAGIC_ITEM_LEGACY_CAPABILITY_BACKLOG_SOURCE,
      sourceRef: record.provenance.sourceRef,
      ...(record.provenance.locator === undefined
        ? {}
        : { locator: record.provenance.locator }),
    },
    missingHooks: hooks,
    legacyReadiness: readiness,
    disposition: 'unselected-backlog',
    evidence: {
      claimStrength: 'candidate-only-not-capability-execution-evidence',
      exactClaim:
        'The generated legacy readiness clause records these missing engine hooks for this identified magic-item source location.',
      nonClaims: [
        'Does not demonstrate deterministic capability invocation or behavior.',
        'Does not establish source fidelity, source-negative absence, or corpus completeness.',
        'Does not select this clause as a capability or infer an operation from its engine:F label.',
        'Does not derive capability membership from an audit-finding registry.',
      ],
    },
  };
}

function selectedCapability(): SelectedMagicItemCapability {
  const contract = MAGIC_ITEM_OPERATION_READINESS_CAPABILITY;
  return {
    revision: contract.revision,
    operationId: contract.operationId,
    operation: contract.operation,
    requiredInputs: contract.requiredInputs,
    exclusions: contract.exclusions,
    residualDmInterpretation: contract.residualDmInterpretation,
    evidence: {
      claimStrength: 'declared-contract-not-capability-execution-evidence',
      exactClaim:
        'This is the positively selected bounded magic-item operation contract; execution requires separate admitted invocation and behavior evidence.',
      nonClaims: [
        'Does not select every legacy candidate or claim their source semantics are complete.',
        'Does not make a preflight result proof that the operation executed or persisted a state change.',
      ],
    },
  };
}

/**
 * Reconcile the bounded legacy `missingHooks` backlog with the positive
 * capability contract without turning either clause status or finding
 * membership into a capability-universe claim.
 */
export function buildMagicItemLegacyCapabilityBacklog(
  pack: RulesPack,
): MagicItemLegacyCapabilityBacklog {
  const candidates: MagicItemLegacyCapabilityCandidate[] = [];
  const candidateIds = new Set<string>();
  for (const record of pack.records) {
    if (record.kind !== 'magic-item') continue;
    const data = object(record.data);
    const readiness = object(data?.executionReadiness);
    if (readiness?.source !== MAGIC_ITEM_LEGACY_CAPABILITY_BACKLOG_SOURCE)
      throw new MagicItemLegacyCapabilityBacklogError(
        `${record.key} has no trusted legacy magic-item readiness source`,
      );
    if (!Array.isArray(readiness.clauses) || readiness.clauses.length === 0)
      throw new MagicItemLegacyCapabilityBacklogError(
        `${record.key}.executionReadiness.clauses must be a non-empty array`,
      );
    for (const [index, clause] of readiness.clauses.entries()) {
      const candidate = candidateFromClause(record, clause, index);
      if (candidate === undefined) continue;
      if (candidateIds.has(candidate.candidateId))
        throw new MagicItemLegacyCapabilityBacklogError(
          `duplicate legacy capability candidate ${candidate.candidateId}`,
        );
      candidateIds.add(candidate.candidateId);
      candidates.push(candidate);
    }
  }
  return {
    scope: 'legacy-magic-item-missing-hooks-only',
    source: MAGIC_ITEM_LEGACY_CAPABILITY_BACKLOG_SOURCE,
    candidates: candidates.sort((a, b) =>
      a.candidateId.localeCompare(b.candidateId),
    ),
    selectedCapabilities: [selectedCapability()],
  };
}
