import type {
  CandidateDisposition,
  DiscoveryCandidate,
  DiscoveryRoute,
  DiscoverySignalKind,
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
 * A canonical fact is of exactly one of two kinds, and the distinction is the
 * whole architecture here:
 *
 * - STATE — what exists after a stage (the candidate stream, the packet's
 *   content, a candidate's cumulative traversal list);
 * - EVENT/DECISION — what happened while the stage ran (a relationship it
 *   traversed, a candidate it excluded and why).
 *
 * A final state cannot always reproduce the events that produced it. A typed
 * relationship can fire in expansion pass 1 and fire AGAIN in campaign-rule
 * expansion pass 2, and cumulative state is identical either way; an exclusion
 * reason exists nowhere in the surviving output. Reconstructing either from
 * resultant state loses the fact — or, worse, invents one. So both kinds are
 * recorded once, by their producer, and copied here.
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
  readonly kind: DiscoverySignalKind;
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
 * An expansion stage records its candidate STATE and its traversal EVENTS.
 *
 * The two names are deliberately unlike each other. A candidate's own
 * `.traversals` is the cumulative set of relationships it carries; this
 * stage's `.traversalEvents` is what THIS pass actually traversed. A previous
 * revision derived the second from the first by set-difference over the
 * candidate stream, which is false under the bounded two-pass architecture:
 * `expandTypedRelationships()` records each relationship it processes in that
 * pass, while `withLink()` deliberately does not re-add a traversal a
 * candidate already carries. A relationship promoted into the second pass by
 * the campaign-rule join therefore fires again while cumulative state does not
 * move, and the set-difference erases the event. M4 asks which traversals
 * FIRED, so the event is the fact it needs.
 */
export interface ProjectedExpansionStage
  extends ProjectedStage<ProjectedCandidate> {
  /** Relationships this stage traversed, exactly as the producer recorded
   * them. Not deduplicated against earlier stages: a repeat is a real event. */
  readonly traversalEvents: readonly TypedTraversal[];
}

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
 * Retention's decision history, copied from the producer.
 *
 * `retainCandidates()` records ONE disposition per candidate it decided over,
 * at the ranking/budget boundary where the decision is made, in the order it
 * made them. Retained candidates, dropped candidates, the overflow set, the
 * overflow flag and the stage's own losses are all derived from this single
 * list, so a drop cannot be recorded while the overflow or the loss that must
 * accompany it is not — and an exclusion cannot exist without the reason the
 * producer gave it, because the union has no shape for one that does.
 */
export type ProjectedDisposition = CandidateDisposition;

export interface ProjectedRetentionStage {
  readonly stage: string;
  readonly outcome: StageOutcome;
  readonly dispositions: readonly ProjectedDisposition[];
}

/**
 * The packet's decision history and the content it included — two facts.
 *
 * `buildContextPacket()` records one inclusion decision per retained candidate
 * at the byte comparison that makes it, carrying the real budget arithmetic for
 * an exclusion. `candidates` is what the packet holds. Byte count, byte-overflow
 * set, the overflow flag, the drop list and the stage's losses are derived from
 * those. Nothing here infers an exclusion from absence of content: an earlier
 * revision did, and had to invent the string `'excluded from the packet'` for a
 * producer drop that was missing — laundering a producer failure into evidence
 * that reads as valid.
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

function projectExpansion(
  stage: DiscoveryTrace['expansion'],
): ProjectedExpansionStage {
  return {
    ...base(stage, stage.outputsProduced.map(candidate)),
    // Copied, not recomputed. `expandTypedRelationships()` recorded these as it
    // executed; that IS the event history for this pass.
    traversalEvents: stage.traversals,
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
  // Every field below is a COPY of a fact its producer recorded. Nothing here
  // reconstructs a decision from what survived it or an event from resultant
  // state; if the live trace is inconsistent, that is malformed evidence for
  // the durable reader to reject, not something this function repairs.
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
    expansion: projectExpansion(trace.expansion),
    ruleJoin: projectRuleJoin(trace.ruleJoin),
    ruleExpansion: projectExpansion(trace.ruleExpansion),
    lateRuleJoin: projectRuleJoin(trace.lateRuleJoin),
    dedup: base(trace.dedup, trace.dedup.outputsProduced.map(candidate)),
    retention: {
      stage: trace.retention.stage,
      outcome: trace.retention.outcome,
      dispositions: trace.retention.dispositions,
    },
    packet: {
      stage: trace.packet.stage,
      outcome: trace.packet.outcome,
      decisions: trace.packet.decisions,
      candidates: trace.packet.packet.candidates,
    },
    stack: {
      base: packIdentity(trace.stack.base),
      addons: trace.stack.addons.map(packIdentity),
    },
  };
}
