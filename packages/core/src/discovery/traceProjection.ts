import type {
  DiscoveryCandidate,
  DiscoveryRoute,
  DiscoveryTrace,
  PacketCandidate,
  ReturnedRuleProjection,
  SeamQuery,
  StageLoss,
  StageOutcome,
  TypedTraversal,
} from './types.js';

/**
 * The durable, JSON-safe record of one discovery run.
 *
 * Phase 2 (design section 12.2) requires every section-13 measurement to be
 * derivable from a RECORDED trace without re-running discovery. A recorded
 * `DiscoveryTrace` cannot serve: it holds the whole resolved rules stack and,
 * on every candidate of every stage, the full `RulesStackRecordEntry` — the
 * same records repeated nine times over.
 *
 * This shape records CANONICAL FACTS ONCE and nothing else. Every summary a
 * measurement reports — stage accounting, traversal lists, the rule/ruling
 * query and placement history, retained/dropped/overflow, packet bytes and
 * drops, auditor presence and retry counts — is DERIVED from these facts at
 * measurement time by `traceDerivation.ts`, not stored beside them.
 *
 * That is the point, and it is the repair for a defect class that survived
 * several rounds of validator hardening: two independently persisted claims
 * about one fact can be changed TOGETHER, leaving every local check satisfied
 * while a measurement reports something the run never did. A summary that is
 * derived cannot disagree with the fact it is derived from, so the durable
 * reader is responsible only for the admissibility of the canonical
 * representation — schema, identity, coverage and lifecycle — rather than for
 * an ever-growing network of consistency theorems over redundant copies.
 *
 * What is dropped is record BODIES, never identities, decisions or reasons:
 * the packet still carries each included candidate's own projected source
 * prose, which is the material design section 7.1 requires and M9 measures.
 */

export interface ProjectedStage<T> {
  readonly stage: string;
  readonly outcome: StageOutcome;
  readonly losses: readonly StageLoss[];
  readonly outputsProduced: readonly T[];
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
 * A candidate as the durable record holds it.
 *
 * `entry` and `adventureEntity` are deliberately absent — the record body
 * reaches the evidence exactly once, through the packet. `band` is absent for
 * the same reason as the rule and ruling identities a join placed on this
 * candidate: both are functions of facts already recorded here or on the join
 * that placed them, and a second copy is a second thing to go wrong.
 */
export interface ProjectedCandidate {
  readonly candidateKey: string;
  readonly targetKind: DiscoveryCandidate['targetKind'];
  readonly routes: readonly DiscoveryRoute[];
  readonly traversals: readonly TypedTraversal[];
}

export interface ProjectedSignalsStage extends ProjectedStage<ProjectedSignal> {
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
}

export interface ProjectedCandidatesStage
  extends ProjectedStage<ProjectedCandidate> {
  readonly unresolvedTargets: readonly string[];
}

/**
 * An expansion stage records only its candidates. M4's traversal list is
 * derived as the traversals that newly appear on the candidate stream here,
 * so a traversal cannot be claimed without a candidate carrying it, and a
 * carried traversal cannot be omitted from the list.
 */
export type ProjectedExpansionStage = ProjectedStage<ProjectedCandidate>;

export interface ProjectedRuleJoinStage
  extends ProjectedStage<ProjectedCandidate> {
  readonly seamQueries: readonly SeamQuery[];
  readonly returnedProjections: readonly ReturnedRuleProjection[];
  readonly placements: readonly {
    readonly ruleIdentity: string;
    readonly governingRecordKey: string;
  }[];
  readonly consideredAmbiguityIds: readonly string[];
}

/** Dedup's route bookkeeping is derived from the candidate streams it joins. */
export type ProjectedDedupStage = ProjectedStage<ProjectedCandidate>;

/**
 * Retention records ONE disposition per candidate it decided over, in the rank
 * order it decided them. Retained candidates, dropped candidates, the overflow
 * set, the overflow flag and the stage's own losses are all derived from this
 * single list, so a drop cannot be recorded while the overflow or the loss that
 * must accompany it is not.
 */
export interface ProjectedDisposition {
  readonly candidateKey: string;
  readonly retained: boolean;
  /** Why it was excluded. Present exactly when `retained` is false. */
  readonly reason?: string;
}

export interface ProjectedRetentionStage {
  readonly stage: string;
  readonly outcome: StageOutcome;
  readonly dispositions: readonly ProjectedDisposition[];
}

/**
 * The packet records one inclusion decision per retained candidate plus the
 * content it included. Byte count, byte-overflow set, the overflow flag, the
 * drop list and the stage's losses are all derived from those.
 */
export interface ProjectedPacketStage {
  readonly stage: string;
  readonly outcome: StageOutcome;
  readonly decisions: readonly ProjectedDisposition[];
  readonly candidates: readonly PacketCandidate[];
}

/** Identity of one pack in the stack the run resolved against. */
export interface ProjectedPackIdentity {
  readonly systemId: string;
  readonly packId: string;
  readonly version: string;
  readonly role: string;
}

export interface ProjectedDiscoveryTrace {
  readonly signals: ProjectedSignalsStage;
  readonly candidates: ProjectedCandidatesStage;
  readonly expansion: ProjectedExpansionStage;
  readonly ruleJoin: ProjectedRuleJoinStage;
  readonly ruleExpansion: ProjectedExpansionStage;
  readonly lateRuleJoin: ProjectedRuleJoinStage;
  readonly dedup: ProjectedDedupStage;
  readonly retention: ProjectedRetentionStage;
  readonly packet: ProjectedPacketStage;
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

function candidate(item: DiscoveryCandidate): ProjectedCandidate {
  return {
    candidateKey: item.candidateKey,
    targetKind: item.targetKind,
    routes: item.routes,
    traversals: item.traversals,
  };
}

function base<T>(
  source: {
    readonly stage: string;
    readonly outcome: StageOutcome;
    readonly losses: readonly StageLoss[];
  },
  outputsProduced: readonly T[],
): ProjectedStage<T> {
  return {
    stage: source.stage,
    outcome: source.outcome,
    losses: source.losses,
    outputsProduced,
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

function projectRuleJoin(
  join: DiscoveryTrace['ruleJoin'],
): ProjectedRuleJoinStage {
  return {
    ...base(join, join.outputsProduced.map(candidate)),
    seamQueries: join.seamQueries,
    returnedProjections: join.returnedProjections,
    placements: join.placedRules,
    consideredAmbiguityIds: join.consideredAmbiguityIds,
  };
}

export function projectDiscoveryTrace(
  trace: DiscoveryTrace,
): ProjectedDiscoveryTrace {
  // Retention decided over everything dedup emitted; the packet decided over
  // everything retention kept. Recording one disposition per decision, in the
  // order it was made, is the whole of that stage's evidence.
  const retainedKeys = new Set(
    trace.retention.outputsProduced.map((item) => item.candidateKey),
  );
  const retentionDrops = new Map(
    trace.retention.dropped.map((item) => [item.candidateKey, item.reason]),
  );
  const packetDrops = new Map(
    trace.packet.dropped
      .filter((item) => !retentionDrops.has(item.candidateKey))
      .map((item) => [item.candidateKey, item.reason]),
  );
  const includedKeys = new Set(
    trace.packet.packet.candidates.map((item) => item.identity.key),
  );
  return {
    signals: {
      ...base(
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
    },
    candidates: {
      ...base(
        trace.candidates,
        trace.candidates.outputsProduced.map(candidate),
      ),
      unresolvedTargets: trace.candidates.unresolvedTargets,
    },
    expansion: base(
      trace.expansion,
      trace.expansion.outputsProduced.map(candidate),
    ),
    ruleJoin: projectRuleJoin(trace.ruleJoin),
    ruleExpansion: base(
      trace.ruleExpansion,
      trace.ruleExpansion.outputsProduced.map(candidate),
    ),
    lateRuleJoin: projectRuleJoin(trace.lateRuleJoin),
    dedup: base(trace.dedup, trace.dedup.outputsProduced.map(candidate)),
    retention: {
      stage: trace.retention.stage,
      outcome: trace.retention.outcome,
      // The retained set in rank order, then the drops in rank order. The
      // interleaving of the two is not recorded because nothing reads it; what
      // is recorded is one decision per candidate the stage decided over.
      dispositions: [
        ...trace.retention.outputsProduced.map((item) => ({
          candidateKey: item.candidateKey,
          retained: true,
        })),
        ...trace.retention.dropped.map((item) => ({
          candidateKey: item.candidateKey,
          retained: false,
          reason: item.reason,
        })),
      ],
    },
    packet: {
      stage: trace.packet.stage,
      outcome: trace.packet.outcome,
      decisions: [...retainedKeys].map((key) => ({
        candidateKey: key,
        retained: includedKeys.has(key),
        ...(includedKeys.has(key)
          ? {}
          : { reason: packetDrops.get(key) ?? 'excluded from the packet' }),
      })),
      candidates: trace.packet.packet.candidates,
    },
    stack: {
      base: packIdentity(trace.stack.base),
      addons: trace.stack.addons.map(packIdentity),
    },
  };
}
