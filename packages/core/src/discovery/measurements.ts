import type { ProjectedDiscoveryTrace } from './traceProjection.js';
import type {
  CapabilityPreflight,
  RuntimeAuditAttempt,
  RuntimeCapabilityInvocation,
  RuntimeCapabilityOutcome,
  TypedTraversal,
} from './types.js';

/**
 * A field-9 packet-retention fact. Design amendment 11.1 narrows field 9 to
 * exactly this: every entry carries an `exactSubstring` or a `typedPath` and
 * contributes directly to M9. Material that cannot survive into a packet is
 * fixture `evidenceNotes` (field 14) and is not an M9 input, so M9 carries no
 * classification logic — a classification registry inside the measurement
 * would redefine M9 by implementation.
 */
export interface RequiredPacketFact {
  readonly targetRef?: string;
  readonly exactSubstring?: string;
  readonly typedPath?: string;
  readonly expectedValue?: unknown;
}
export interface DiscoveryMeasurementInput {
  readonly mustIncludeTargetRefs?: readonly string[];
  readonly requiredRelationshipExpansion?: readonly TypedTraversal[];
  readonly requiredFacts?: readonly RequiredPacketFact[];
  readonly mustNotIncludeTargetRefs?: readonly string[];
}
export interface DiscoveryMeasurements {
  readonly m1: Readonly<Record<string, boolean>>;
  readonly m2: Readonly<Record<string, string | null>>;
  /**
   * Route preservation, measured across every candidate-bearing stage rather
   * than from the dedup stage alone. Candidates, expansion, and the rule join
   * each merge into a map keyed by candidate key, so the dedup stage's own
   * before/after counts are equal by construction and would report route
   * preservation that was never tested. `producedAcrossStages` is the union of
   * every route ever attached to the key at any stage.
   */
  readonly m3: Readonly<
    Record<
      string,
      {
        producedAcrossStages: number;
        inPacket: number;
        lost: readonly string[];
        droppedBeforePacket: boolean;
      }
    >
  >;
  readonly m4: readonly {
    readonly traversal: TypedTraversal;
    readonly result: 'fired' | 'not-fired' | 'fired-and-dropped';
  }[];
  /**
   * M5's definition is which rules/rulings were REQUESTED from jhpt, which
   * MATCHED, and which were PLACED beside their governing material. Reporting
   * only the placed pairs hid a returned rule that no candidate could receive.
   */
  readonly m5: {
    readonly requestedRuleRecordKeys: readonly string[];
    readonly requestedAmbiguityIds: readonly string[];
    readonly allActiveRulingsRequested: boolean;
    /** The scope that makes the ambiguity-coverage measurement meaningful. */
    readonly ambiguityCoverage: 'all-active' | 'requested-ambiguities';
    /** How many times each seam query actually executed. */
    readonly ruleQueryCount: number;
    readonly rulingQueryCount: number;
    readonly returned: readonly string[];
    readonly matched: readonly string[];
    readonly unplaced: readonly string[];
    readonly surfacedCandidateKeys: readonly string[];
    /** Bounded residual declared by design section 12.1. */
    readonly unexpandedPromotions: readonly string[];
    /** Ambiguities in the finished packet that were never offered to the
     * seam. Design section 12.1 makes the pipeline closed, so this is
     * checkable and must be empty. */
    readonly unqueriedAmbiguityIds: readonly string[];
    /**
     * Ambiguities an active jhpt ruling resolved. A ruling match is otherwise
     * only inferable from `returned`, which cannot distinguish a ruling from a
     * house rule, so the positive ruling case would not be measurable.
     */
    readonly resolvedAmbiguityIds: readonly string[];
    readonly unresolvedAmbiguityIds: readonly string[];
    readonly placed: readonly {
      readonly ruleIdentity: string;
      readonly governingRecordKey: string;
    }[];
  };
  readonly m6: {
    readonly allMustConsiderRetained: boolean;
    readonly overflowed: boolean;
    /** Every must-consider candidate a budget could not hold, with its routes. */
    readonly overflow: readonly {
      readonly candidateKey: string;
      readonly routes: readonly { readonly routeClass: string }[];
      readonly reason: string;
    }[];
  };
  readonly m7: {
    readonly packetBytes: number;
    readonly candidateCount: number;
    readonly drops: readonly {
      readonly candidateKey: string;
      readonly reason: string;
    }[];
  };
  /**
   * The substantive false-authority check for this pilot is
   * `forbiddenPresent`: P12 declares the removed
   * `table:starting-wealth-by-class` record as a must-not-include target, and
   * its appearance in a packet is the laundering the probe exists to catch.
   * `unattributedPresent` is the standing structural check — a rules-record
   * candidate that reached the packet carrying no source attribution.
   */
  readonly m8: {
    readonly forbiddenPresent: readonly string[];
    readonly unattributedPresent: readonly string[];
  };
  readonly m9: {
    readonly missing: readonly RequiredPacketFact[];
    /** Every field-9 fact measured, so an empty corpus cannot read as green. */
    readonly measured: number;
  };
  readonly perStage: Readonly<
    Record<
      string,
      {
        readonly produced: readonly string[];
        readonly modified: readonly string[];
        readonly carriedForward: readonly string[];
        readonly emitted: number;
        readonly losses: number;
        readonly outcome: string;
        readonly failedToRun: boolean;
      }
    >
  >;
}
function equal(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}
/**
 * Stage outputs carry a target identity under three different shapes: signals
 * name it in `proposes`, candidate-bearing stages in `candidateKey`, and the
 * packet in `identity.key`. Missing the packet shape would report every
 * retained target as lost at the packet boundary.
 */
function holdsTarget(item: unknown, key: string): boolean {
  if (typeof item !== 'object' || item === null) return false;
  const value = item as Record<string, unknown>;
  if (value.candidateKey === key || value.proposes === key) return true;
  const identity = value.identity;
  return (
    typeof identity === 'object' &&
    identity !== null &&
    (identity as Record<string, unknown>).key === key
  );
}
function routeIdentity(route: {
  routeClass: string;
  trigger: string;
  signalId: string;
}): string {
  return JSON.stringify([route.routeClass, route.trigger, route.signalId]);
}
/** Every string reachable in a value, so a substring check runs against real
 * prose instead of a JSON encoding whose escapes break the match. */
function proseStrings(value: unknown): readonly string[] {
  if (typeof value === 'string') return [value];
  if (Array.isArray(value)) return value.flatMap(proseStrings);
  if (typeof value === 'object' && value !== null)
    return Object.values(value).flatMap(proseStrings);
  return [];
}
function valueAt(root: unknown, pointer: string): unknown {
  return pointer.startsWith('/')
    ? pointer
        .slice(1)
        .split('/')
        .map((part) => part.replaceAll('~1', '/').replaceAll('~0', '~'))
        .reduce<unknown>(
          (value, key) =>
            value !== null && typeof value === 'object'
              ? (value as Record<string, unknown>)[key]
              : undefined,
          root,
        )
    : undefined;
}
export function measureDiscovery(
  trace: ProjectedDiscoveryTrace,
  input: DiscoveryMeasurementInput = {},
): DiscoveryMeasurements {
  const keys = new Set(
    trace.packet.packet.candidates.map((candidate) => candidate.identity.key),
  );
  const m1: Record<string, boolean> = {};
  const m2: Record<string, string | null> = {};
  const stages = [
    ['signals', trace.signals],
    ['candidates', trace.candidates],
    ['expansion', trace.expansion],
    ['rule-join', trace.ruleJoin],
    ['campaign-rule-expansion', trace.ruleExpansion],
    ['late-ruling-join', trace.lateRuleJoin],
    ['dedup', trace.dedup],
    ['retention', trace.retention],
    ['packet', trace.packet],
  ] as const;
  for (const key of input.mustIncludeTargetRefs ?? []) {
    m1[key] = keys.has(key);
    if (m1[key]) {
      m2[key] = null;
      continue;
    }
    // The losing stage is the one AFTER the last stage that still held the
    // target, not the first stage that produced it. Reporting the first
    // producer would blame `signals` for every downstream drop.
    let lastHeld = -1;
    stages.forEach(([, stage], index) => {
      if (stage.outputsProduced.some((item) => holdsTarget(item, key)))
        lastHeld = index;
    });
    m2[key] =
      lastHeld < 0 ? 'signals' : (stages[lastHeld + 1]?.[0] ?? 'packet');
  }
  const producedRoutes = new Map<string, Set<string>>();
  for (const stage of [
    trace.candidates,
    trace.expansion,
    trace.ruleJoin,
    trace.ruleExpansion,
    trace.lateRuleJoin,
    trace.dedup,
    trace.retention,
  ])
    for (const candidate of stage.outputsProduced) {
      const seen =
        producedRoutes.get(candidate.candidateKey) ?? new Set<string>();
      for (const route of candidate.routes) seen.add(routeIdentity(route));
      producedRoutes.set(candidate.candidateKey, seen);
    }
  const packetRoutes = new Map<string, Set<string>>(
    trace.packet.packet.candidates.map((candidate) => [
      candidate.identity.key,
      new Set(candidate.routes.map(routeIdentity)),
    ]),
  );
  const m3: Record<
    string,
    {
      producedAcrossStages: number;
      inPacket: number;
      lost: readonly string[];
      droppedBeforePacket: boolean;
    }
  > = {};
  for (const [key, produced] of producedRoutes) {
    const retained = packetRoutes.get(key);
    m3[key] = {
      producedAcrossStages: produced.size,
      inPacket: retained?.size ?? 0,
      lost:
        retained === undefined
          ? []
          : [...produced].filter((route) => !retained.has(route)),
      droppedBeforePacket: retained === undefined,
    };
  }
  const m4 = (input.requiredRelationshipExpansion ?? []).map((traversal) => {
    const fired = [
      ...trace.expansion.traversals,
      ...trace.ruleExpansion.traversals,
    ].some((item) => equal(item, traversal));
    const retained = trace.packet.packet.candidates.some((candidate) =>
      candidate.traversals.some((item) => equal(item, traversal)),
    );
    return {
      traversal,
      result: fired
        ? retained
          ? ('fired' as const)
          : ('fired-and-dropped' as const)
        : ('not-fired' as const),
    };
  });
  const missing: RequiredPacketFact[] = [];
  let measured = 0;
  for (const fact of input.requiredFacts ?? []) {
    if (fact.exactSubstring === undefined && fact.typedPath === undefined)
      throw new Error(
        'a field-9 fact must declare exactSubstring or typedPath; non-retention material belongs in fixture evidenceNotes (design amendment 11.1)',
      );
    measured += 1;
    const candidate =
      fact.targetRef === undefined
        ? undefined
        : trace.packet.packet.candidates.find(
            (item) => item.identity.key === fact.targetRef,
          );
    const present =
      fact.exactSubstring === undefined
        ? fact.typedPath !== undefined &&
          (fact.expectedValue === undefined
            ? valueAt(candidate?.sourceProse, fact.typedPath) !== undefined
            : equal(
                valueAt(candidate?.sourceProse, fact.typedPath),
                fact.expectedValue,
              ))
        : proseStrings(candidate?.sourceProse).some((text) =>
            text.includes(fact.exactSubstring as string),
          );
    if (!present) missing.push(fact);
  }
  const forbiddenPresent = (input.mustNotIncludeTargetRefs ?? []).filter(
    (key) => keys.has(key),
  );
  // Every candidate must carry real attribution, adventure entities included.
  // Exempting the kind meant P9 stayed green while the module's actual
  // provenance and licence were being discarded.
  const unattributedPresent = trace.packet.packet.candidates
    .filter(
      (candidate) =>
        (candidate.provenance.sourceRef ?? '').trim().length === 0 ||
        candidate.provenance.license === null ||
        candidate.provenance.license === undefined,
    )
    .map((candidate) => candidate.identity.key);
  return {
    m1,
    m2,
    m3,
    m4,
    m5: {
      requestedRuleRecordKeys: [
        ...trace.ruleJoin.requestedRuleRecordKeys,
        ...trace.lateRuleJoin.requestedRuleRecordKeys,
      ],
      requestedAmbiguityIds: [
        ...trace.ruleJoin.requestedAmbiguityIds,
        ...trace.lateRuleJoin.requestedAmbiguityIds,
      ],
      allActiveRulingsRequested:
        trace.ruleJoin.rulingQueryScope === 'all-active' ||
        trace.lateRuleJoin.rulingQueryScope === 'all-active',
      ambiguityCoverage:
        trace.ruleJoin.rulingQueryScope === 'all-active' ||
        trace.lateRuleJoin.rulingQueryScope === 'all-active'
          ? 'all-active'
          : 'requested-ambiguities',
      ruleQueryCount:
        (trace.ruleJoin.ruleQueryExecuted ? 1 : 0) +
        (trace.lateRuleJoin.ruleQueryExecuted ? 1 : 0),
      rulingQueryCount:
        (trace.ruleJoin.rulingQueryExecuted ? 1 : 0) +
        (trace.lateRuleJoin.rulingQueryExecuted ? 1 : 0),
      returned: [
        ...trace.ruleJoin.returnedRuleIdentities,
        ...trace.lateRuleJoin.returnedRuleIdentities,
      ],
      matched: [
        ...trace.ruleJoin.placedRuleIdentities,
        ...trace.lateRuleJoin.placedRuleIdentities,
      ],
      unplaced: [
        ...trace.ruleJoin.unplacedRuleIdentities,
        ...trace.lateRuleJoin.unplacedRuleIdentities,
      ],
      surfacedCandidateKeys: [
        ...trace.ruleJoin.surfacedCandidateKeys,
        ...trace.lateRuleJoin.surfacedCandidateKeys,
      ],
      unexpandedPromotions: trace.unexpandedPromotions,
      unqueriedAmbiguityIds: (() => {
        // The all-active scope is only an argument to the seam. Closure is
        // measured from the actual query evidence: ids offered as arguments
        // plus ambiguity ids present in rulings the seam returned. This keeps
        // a scope flag from turning the assertion into an unconditional pass.
        const offered = new Set([
          ...trace.ruleJoin.requestedAmbiguityIds,
          ...trace.lateRuleJoin.requestedAmbiguityIds,
          ...trace.ruleJoin.returnedAmbiguityIds,
          ...trace.lateRuleJoin.returnedAmbiguityIds,
        ]);
        return [
          ...new Set(
            trace.packet.packet.candidates
              .flatMap((candidate) => candidate.ambiguities)
              .map((ambiguity) => ambiguity.id)
              .filter((id): id is string => typeof id === 'string')
              .filter((id) => !offered.has(id)),
          ),
        ];
      })(),
      resolvedAmbiguityIds: [
        ...new Set([
          ...trace.ruleJoin.resolvedAmbiguityIds,
          ...trace.lateRuleJoin.resolvedAmbiguityIds,
        ]),
      ],
      unresolvedAmbiguityIds: trace.lateRuleJoin.unresolvedAmbiguities
        .map((item) => item.id)
        .filter((id): id is string => typeof id === 'string'),
      placed: [
        ...trace.ruleJoin.placedRules,
        ...trace.lateRuleJoin.placedRules,
      ],
    },
    // Both budgets feed one mandatory-retention measurement: a must-consider
    // candidate lost to the byte budget is as much an overflow as one lost to
    // the candidate count.
    m6: {
      allMustConsiderRetained:
        !trace.retention.overflowed && trace.packet.byteOverflow.length === 0,
      overflowed:
        trace.retention.overflowed || trace.packet.byteOverflow.length > 0,
      overflow: [...trace.retention.overflow, ...trace.packet.byteOverflow],
    },
    m7: {
      packetBytes: trace.packet.packet.bytes,
      candidateCount: trace.packet.packet.candidates.length,
      drops: trace.packet.dropped.map((item) => ({
        candidateKey: item.candidateKey,
        reason: item.reason,
      })),
    },
    m8: { forbiddenPresent, unattributedPresent },
    m9: { missing, measured },
    perStage: Object.fromEntries(
      stages.map(([name, stage]) => [
        name,
        {
          produced: stage.produced,
          modified: stage.modified,
          carriedForward: stage.carriedForward,
          // What the stage emitted downstream, pass-through included. Named
          // `emitted` because it is not a measure of work.
          emitted: stage.outputsProduced.length,
          losses: stage.losses.length,
          outcome: stage.outcome,
          failedToRun: stage.failedToRun,
        },
      ]),
    ),
  };
}

/**
 * The one tool that fetches rules material, and therefore the only evidence
 * that distinguishes an M11 "missing rule evidence" retry from every other
 * rejection cause. `world_query` and `memory_drilldown` share its coarse
 * `missing_world_evidence` cause but fetch campaign canon and memory, not
 * rules.
 */
const RULE_EVIDENCE_TOOLS: readonly string[] = ['lookup_rules'];

/**
 * Why an M10 comparison could not be made. Each of these is a refusal to
 * compare, never a disagreement: reporting one as `disagreed` would attribute
 * a mismatch to the capability that belongs to the measurement's own limits.
 */
export type IncomparableReason =
  | 'not-invoked'
  | 'packet-status-not-evaluated-offline'
  | 'runtime-subject-identity-not-reported'
  | 'capability-identity-not-reported'
  | 'capability-identity-mismatch'
  | 'ambiguous-runtime-invocation';

function incomparableReason(
  preflight: CapabilityPreflight,
  matches: readonly RuntimeCapabilityInvocation[],
): IncomparableReason | undefined {
  if (preflight.status === 'not-evaluated-offline')
    return 'packet-status-not-evaluated-offline';
  if (matches.length === 0) return 'not-invoked';
  // Two invocations of the same subject in one turn can have different
  // outcomes; picking the first would be a coin flip presented as a result.
  if (matches.length > 1) return 'ambiguous-runtime-invocation';
  const invocation = matches[0];
  if (invocation.subjectSource !== 'runtime-result')
    return 'runtime-subject-identity-not-reported';
  // A capability is a bounded positive commitment made under a named identity
  // and revision. Two preflights over the same subject can be two different
  // commitments, so agreement across them would be agreement about nothing.
  if (
    invocation.capabilityId === undefined ||
    invocation.capabilityRevision === undefined ||
    preflight.revision === undefined
  )
    return 'capability-identity-not-reported';
  if (
    invocation.capabilityId !== preflight.capabilityId ||
    invocation.capabilityRevision !== preflight.revision
  )
    return 'capability-identity-mismatch';
  return undefined;
}

export interface RuntimeDiscoveryObservations {
  readonly capabilityInvocations: readonly RuntimeCapabilityInvocation[];
  readonly auditAttempts: readonly RuntimeAuditAttempt[];
}

export interface RuntimeDiscoveryMeasurements {
  /**
   * M10 — capability preflight agreement with runtime.
   *
   * Shadow discovery runs BEFORE the model chooses a tool, so it cannot know
   * which operation the turn will invoke. `not-invoked` and
   * `absentFromPacket` are therefore ordinary, informative outcomes rather
   * than failures, and `not-comparable` is never counted as agreement.
   */
  readonly m10: {
    readonly comparisons: readonly {
      readonly candidateKey: string;
      readonly capabilityId: string;
      readonly packetStatus: CapabilityPreflight['status'];
      readonly runtimeOutcome: RuntimeCapabilityOutcome | 'not-invoked';
      readonly agreement: 'agreed' | 'disagreed' | 'not-comparable';
      /** Present whenever `agreement` is `not-comparable`. */
      readonly incomparableBecause?: IncomparableReason;
    }[];
    /**
     * Capability outcomes the runtime produced that the shadow packet never
     * preflighted. This is the substantive Phase 2 signal: discovery did not
     * anticipate a capability the turn actually exercised.
     */
    readonly runtimeInvocationsAbsentFromPacket: readonly RuntimeCapabilityInvocation[];
  };
  /**
   * M11 — auditor retry count, with the missing-rule-evidence share
   * distinguished from every other rejection cause (design section 13.1).
   */
  readonly m11: {
    readonly primaryDmCandidates: number;
    readonly retries: number;
    readonly presentationRepairs: number;
    readonly failures: number;
    readonly byCause: Readonly<Record<string, number>>;
    readonly missingRuleEvidenceRetries: number;
    /** Retries whose verdict named no missing tool at all. */
    readonly retriesWithNoNamedMissingTool: number;
    /** True when no auditor ran, so every count above is structurally zero. */
    readonly auditorAbsent: boolean;
  };
}

/**
 * M10 and M11 from the durable Phase 2 evidence. Both read recorded runtime
 * observations beside the recorded trace; neither re-runs discovery, re-invokes
 * a capability, or re-audits the turn.
 */
export function measureRuntimeDiscovery(
  trace: ProjectedDiscoveryTrace,
  runtime: RuntimeDiscoveryObservations,
): RuntimeDiscoveryMeasurements {
  const capabilityOutcomes = runtime.capabilityInvocations.filter(
    (invocation) => invocation.outcome !== 'not-a-capability-outcome',
  );
  const consumed = new Set<RuntimeCapabilityInvocation>();
  const comparisons = trace.packet.packet.candidates
    .filter((item) => item.capability !== undefined)
    .map((item) => {
      const preflight = item.capability as CapabilityPreflight;
      // Pairing is by SUBJECT — the exact `(record, variant, operation)` triple
      // the readiness contract is derived from — and the capability identity is
      // then required to match before anything is compared. Pairing on identity
      // too would hide a real finding: a runtime commitment over this subject
      // under a different capability or revision is exactly what
      // `capability-identity-mismatch` exists to report, not something to drop
      // silently into `not-invoked`.
      const matches = capabilityOutcomes.filter(
        (candidate) =>
          candidate.recordKey === item.identity.key &&
          candidate.operationId === preflight.operationId &&
          candidate.variantId === preflight.variantId,
      );
      for (const match of matches) consumed.add(match);
      const invocation = matches[0];
      const runtimeOutcome = invocation?.outcome ?? ('not-invoked' as const);
      const reason = incomparableReason(preflight, matches);
      return {
        candidateKey: item.identity.key,
        capabilityId: preflight.capabilityId,
        packetStatus: preflight.status,
        runtimeOutcome,
        ...(reason === undefined
          ? {
              agreement:
                runtimeOutcome === preflight.status
                  ? ('agreed' as const)
                  : ('disagreed' as const),
            }
          : {
              agreement: 'not-comparable' as const,
              incomparableBecause: reason,
            }),
      };
    });
  const attempts = runtime.auditAttempts;
  const retries = attempts.filter((item) => item.action === 'retry');
  const byCause: Record<string, number> = {};
  for (const attempt of attempts) {
    if (attempt.retryCause === null) continue;
    byCause[attempt.retryCause] = (byCause[attempt.retryCause] ?? 0) + 1;
  }
  return {
    m10: {
      comparisons,
      runtimeInvocationsAbsentFromPacket: capabilityOutcomes.filter(
        (invocation) => !consumed.has(invocation),
      ),
    },
    m11: {
      primaryDmCandidates: attempts.length,
      retries: retries.length,
      presentationRepairs: attempts.filter((item) => item.action === 'repair')
        .length,
      failures: attempts.filter((item) => item.action === 'fail').length,
      byCause,
      missingRuleEvidenceRetries: retries.filter((item) =>
        item.missingTools.some((tool) => RULE_EVIDENCE_TOOLS.includes(tool)),
      ).length,
      retriesWithNoNamedMissingTool: retries.filter(
        (item) => item.missingTools.length === 0,
      ).length,
      auditorAbsent: attempts.length === 0,
    },
  };
}
