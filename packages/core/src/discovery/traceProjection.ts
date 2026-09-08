import type { RulesAmbiguity } from '../rules/types.js';
import type {
  CandidateBand,
  ContextPacket,
  DiscoveryCandidate,
  DiscoveryRoute,
  DiscoveryTrace,
  PacketCandidate,
  RetentionOverflow,
  StageLoss,
  StageOutcome,
  TypedTraversal,
} from './types.js';

/**
 * The measurement-ready, JSON-safe projection of one discovery run.
 *
 * Phase 2 (design section 12.2) requires that every section-13 measurement be
 * derivable from a RECORDED trace without re-running discovery. A recorded
 * `DiscoveryTrace` cannot serve: it holds the whole resolved rules stack and,
 * on every candidate of every stage, the full `RulesStackRecordEntry` — the
 * same records repeated nine times over. So the durable shape is this
 * projection, and `measureDiscovery` reads THIS rather than the live trace, so
 * the offline probe suite (the M1-M9 gate) exercises the exact shape the
 * runtime persists. A field the projection drops is a field no measurement may
 * silently depend on.
 *
 * What is dropped is record BODIES, never identities, routes, decisions or
 * reasons: the packet still carries each retained candidate's own projected
 * source prose, which is the material design section 7.1 requires and which M9
 * measures.
 */

export interface ProjectedStageTrace<T> {
  readonly stage: string;
  readonly outputsProduced: readonly T[];
  readonly produced: readonly string[];
  readonly modified: readonly string[];
  readonly carriedForward: readonly string[];
  readonly losses: readonly StageLoss[];
  readonly outcome: StageOutcome;
  readonly failedToRun: boolean;
}

export interface ProjectedSignal {
  readonly signalId: string;
  readonly kind: string;
  /** The candidate key or adventure-entity ref this signal proposes. */
  readonly proposes: string;
  readonly evidence: Record<string, unknown>;
  readonly operationId?: string;
  readonly oracleLabel?: string;
  readonly oracleSupplied?: boolean;
}

/**
 * A candidate as the stage accounting sees it. `entry` and `adventureEntity`
 * are deliberately absent — a candidate's identity, routes, traversals and the
 * jhpt identities placed on it are what the measurements read, and the record
 * body reaches the durable evidence exactly once, through the packet.
 */
export interface ProjectedCandidate {
  readonly candidateKey: string;
  readonly targetKind: DiscoveryCandidate['targetKind'];
  readonly routes: readonly DiscoveryRoute[];
  readonly traversals: readonly TypedTraversal[];
  readonly campaignRuleIdentities: readonly string[];
  readonly campaignRulingIdentities: readonly string[];
  /** Present only where the stage assigns a band (retention onward). */
  readonly band?: CandidateBand;
}

export interface ProjectedSignalsTrace
  extends ProjectedStageTrace<ProjectedSignal> {
  readonly unconsumedStateFields: readonly {
    readonly path: string;
    readonly valueShape: string;
  }[];
  readonly stateBindings: readonly {
    readonly path: string;
    readonly instanceId: string;
    readonly recordKey: string;
    readonly variantId?: string;
  }[];
  readonly ambiguousNames: readonly {
    readonly name: string;
    readonly keys: readonly string[];
    readonly evidence: Record<string, unknown>;
  }[];
  readonly oracleSuppliedSignalLabels: readonly string[];
}

export interface ProjectedCandidatesTrace
  extends ProjectedStageTrace<ProjectedCandidate> {
  readonly unresolvedTargets: readonly string[];
}

export interface ProjectedExpansionTrace
  extends ProjectedStageTrace<ProjectedCandidate> {
  readonly traversals: readonly TypedTraversal[];
}

export interface ProjectedRuleJoinTrace
  extends ProjectedStageTrace<ProjectedCandidate> {
  readonly requestedRuleRecordKeys: readonly string[];
  readonly requestedAmbiguityIds: readonly string[];
  readonly rulingQueryScope: 'none' | 'requested-ambiguities' | 'all-active';
  readonly ruleQueryExecuted: boolean;
  readonly rulingQueryExecuted: boolean;
  readonly returnedRuleIdentities: readonly string[];
  readonly returnedAmbiguityIds: readonly string[];
  readonly placedRuleIdentities: readonly string[];
  readonly unplacedRuleIdentities: readonly string[];
  readonly surfacedCandidateKeys: readonly string[];
  readonly placedRules: readonly {
    readonly ruleIdentity: string;
    readonly governingRecordKey: string;
  }[];
  readonly resolvedAmbiguityIds: readonly string[];
  readonly unresolvedAmbiguities: readonly RulesAmbiguity[];
}

export interface ProjectedDedupTrace
  extends ProjectedStageTrace<ProjectedCandidate> {
  readonly routeCountBeforeDedup: Readonly<Record<string, number>>;
  readonly routeCountAfterDedup: Readonly<Record<string, number>>;
}

export interface ProjectedRetentionTrace
  extends ProjectedStageTrace<ProjectedCandidate> {
  readonly dropped: readonly RetentionOverflow[];
  readonly overflowed: boolean;
  readonly overflow: readonly RetentionOverflow[];
}

export interface ProjectedPacketTrace
  extends ProjectedStageTrace<PacketCandidate> {
  readonly packet: ContextPacket;
  readonly byteBudgetExceeded: boolean;
  readonly byteOverflow: readonly RetentionOverflow[];
  readonly dropped: readonly RetentionOverflow[];
}

/** Identity of one pack in the stack the run resolved against. */
export interface ProjectedPackIdentity {
  readonly systemId: string;
  readonly packId: string;
  readonly version: string;
  readonly role: string;
}

export interface ProjectedDiscoveryTrace {
  readonly signals: ProjectedSignalsTrace;
  readonly candidates: ProjectedCandidatesTrace;
  readonly expansion: ProjectedExpansionTrace;
  readonly ruleJoin: ProjectedRuleJoinTrace;
  readonly ruleExpansion: ProjectedExpansionTrace;
  readonly lateRuleJoin: ProjectedRuleJoinTrace;
  readonly unexpandedPromotions: readonly string[];
  readonly dedup: ProjectedDedupTrace;
  readonly retention: ProjectedRetentionTrace;
  readonly packet: ProjectedPacketTrace;
  readonly stageOrder: readonly string[];
  /**
   * Which packs produced this evidence, never their records. Two captures that
   * disagree are only comparable when they resolved the same stack, so the
   * identity is part of the evidence rather than something a reader infers.
   */
  readonly stack: {
    readonly base: ProjectedPackIdentity;
    readonly addons: readonly ProjectedPackIdentity[];
  };
}

function stage<T, P>(
  source: ProjectedStageTrace<T>,
  outputsProduced: readonly P[],
): ProjectedStageTrace<P> {
  return {
    stage: source.stage,
    outputsProduced,
    produced: source.produced,
    modified: source.modified,
    carriedForward: source.carriedForward,
    losses: source.losses,
    outcome: source.outcome,
    failedToRun: source.failedToRun,
  };
}

function candidate(item: {
  readonly candidateKey: string;
  readonly targetKind: DiscoveryCandidate['targetKind'];
  readonly routes: readonly DiscoveryRoute[];
  readonly traversals: readonly TypedTraversal[];
  readonly campaignRules: readonly { readonly ruleIdentity: string }[];
  readonly campaignRulings: readonly { readonly ruleIdentity: string }[];
  readonly band?: CandidateBand;
}): ProjectedCandidate {
  return {
    candidateKey: item.candidateKey,
    targetKind: item.targetKind,
    routes: item.routes,
    traversals: item.traversals,
    campaignRuleIdentities: item.campaignRules.map((rule) => rule.ruleIdentity),
    campaignRulingIdentities: item.campaignRulings.map(
      (ruling) => ruling.ruleIdentity,
    ),
    ...(item.band === undefined ? {} : { band: item.band }),
  };
}

function packIdentity(pack: {
  readonly meta: {
    readonly systemId: string;
    readonly packId: string;
    readonly version: string;
    readonly role: string;
  };
}): ProjectedPackIdentity {
  return {
    systemId: pack.meta.systemId,
    packId: pack.meta.packId,
    version: pack.meta.version,
    role: pack.meta.role,
  };
}

export function projectDiscoveryTrace(
  trace: DiscoveryTrace,
): ProjectedDiscoveryTrace {
  return {
    signals: {
      ...stage(
        trace.signals,
        trace.signals.outputsProduced.map(
          (signal): ProjectedSignal => ({
            signalId: signal.signalId,
            kind: signal.kind,
            proposes: signal.proposes,
            evidence: signal.evidence,
            ...(signal.operationId === undefined
              ? {}
              : { operationId: signal.operationId }),
            ...(signal.oracleLabel === undefined
              ? {}
              : { oracleLabel: signal.oracleLabel }),
            ...(signal.oracleSupplied === undefined
              ? {}
              : { oracleSupplied: signal.oracleSupplied }),
          }),
        ),
      ),
      unconsumedStateFields: trace.signals.unconsumedStateFields,
      stateBindings: trace.signals.stateBindings,
      ambiguousNames: trace.signals.ambiguousNames,
      oracleSuppliedSignalLabels: trace.signals.oracleSuppliedSignalLabels,
    },
    candidates: {
      ...stage(
        trace.candidates,
        trace.candidates.outputsProduced.map(candidate),
      ),
      unresolvedTargets: trace.candidates.unresolvedTargets,
    },
    expansion: {
      ...stage(trace.expansion, trace.expansion.outputsProduced.map(candidate)),
      traversals: trace.expansion.traversals,
    },
    ruleJoin: projectRuleJoin(trace.ruleJoin),
    ruleExpansion: {
      ...stage(
        trace.ruleExpansion,
        trace.ruleExpansion.outputsProduced.map(candidate),
      ),
      traversals: trace.ruleExpansion.traversals,
    },
    lateRuleJoin: projectRuleJoin(trace.lateRuleJoin),
    unexpandedPromotions: trace.unexpandedPromotions,
    dedup: {
      ...stage(trace.dedup, trace.dedup.outputsProduced.map(candidate)),
      routeCountBeforeDedup: trace.dedup.routeCountBeforeDedup,
      routeCountAfterDedup: trace.dedup.routeCountAfterDedup,
    },
    retention: {
      ...stage(trace.retention, trace.retention.outputsProduced.map(candidate)),
      dropped: trace.retention.dropped,
      overflowed: trace.retention.overflowed,
      overflow: trace.retention.overflow,
    },
    packet: {
      ...stage(trace.packet, trace.packet.outputsProduced),
      packet: trace.packet.packet,
      byteBudgetExceeded: trace.packet.byteBudgetExceeded,
      byteOverflow: trace.packet.byteOverflow,
      dropped: trace.packet.dropped,
    },
    stageOrder: trace.stageOrder,
    stack: {
      base: packIdentity(trace.stack.base),
      addons: trace.stack.addons.map(packIdentity),
    },
  };
}

function projectRuleJoin(
  join: DiscoveryTrace['ruleJoin'],
): ProjectedRuleJoinTrace {
  return {
    ...stage(join, join.outputsProduced.map(candidate)),
    requestedRuleRecordKeys: join.requestedRuleRecordKeys,
    requestedAmbiguityIds: join.requestedAmbiguityIds,
    rulingQueryScope: join.rulingQueryScope,
    ruleQueryExecuted: join.ruleQueryExecuted,
    rulingQueryExecuted: join.rulingQueryExecuted,
    returnedRuleIdentities: join.returnedRuleIdentities,
    returnedAmbiguityIds: join.returnedAmbiguityIds,
    placedRuleIdentities: join.placedRuleIdentities,
    unplacedRuleIdentities: join.unplacedRuleIdentities,
    surfacedCandidateKeys: join.surfacedCandidateKeys,
    placedRules: join.placedRules,
    resolvedAmbiguityIds: join.resolvedAmbiguityIds,
    unresolvedAmbiguities: join.unresolvedAmbiguities,
  };
}
