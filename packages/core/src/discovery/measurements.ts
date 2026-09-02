import type { DiscoveryTrace, TypedTraversal } from './types.js';

/**
 * How a fixture field-9 requirement is proven.
 *
 * A requirement carrying `exactSubstring` or `typedPath` is a source-fact
 * check M9 measures directly. Everything else states a requirement about
 * something other than a retained source string, and must name the evidence
 * surface that actually proves it. An unclassified statement-only requirement
 * makes M9 INDETERMINATE — it never silently disappears from `missing`, which
 * is how a declared requirement could previously stay unproven while M9 read
 * green.
 */
export type FactEvidenceKind =
  /** A claim about packet content, proven by a typed packet assertion. */
  | 'packet-semantic'
  /** A claim about the loaded pack or module, proven against that substrate. */
  | 'substrate-fact'
  /** Proven by a named test or module elsewhere in the tree. */
  | 'external-guard'
  /** A statement about superseded state, making no claim on current output. */
  | 'historical-annotation'
  /** An explicit disclaimer; it asserts that something is NOT claimed. */
  | 'non-claim';

export interface FactClassification {
  readonly kind: FactEvidenceKind;
  /** Required for packet-semantic and substrate-fact: the assertion proving it. */
  readonly assertionId?: string;
  /** Repo-relative path of the guard, required for external-guard. */
  readonly guardPath?: string;
  readonly why: string;
}

export interface RequiredPacketFact {
  readonly targetRef?: string;
  readonly exactSubstring?: string;
  readonly typedPath?: string;
  readonly expectedValue?: unknown;
  readonly classification?: FactClassification;
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
    readonly returned: readonly string[];
    readonly matched: readonly string[];
    readonly unplaced: readonly string[];
    readonly surfacedCandidateKeys: readonly string[];
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
    /** Statement-only requirements with a declared evidence surface. */
    readonly classified: readonly {
      readonly fact: RequiredPacketFact;
      readonly classification: FactClassification;
    }[];
    /** Statement-only requirements with NO declared evidence surface. Any
     * entry here makes M9 indeterminate for the probe and must fail it. */
    readonly indeterminate: readonly RequiredPacketFact[];
  };
  readonly perStage: Readonly<
    Record<
      string,
      {
        readonly produced: number;
        readonly losses: number;
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
  trace: DiscoveryTrace,
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
  const classified: {
    fact: RequiredPacketFact;
    classification: FactClassification;
  }[] = [];
  const indeterminate: RequiredPacketFact[] = [];
  for (const fact of input.requiredFacts ?? []) {
    if (fact.exactSubstring === undefined && fact.typedPath === undefined) {
      if (fact.classification === undefined) indeterminate.push(fact);
      else classified.push({ fact, classification: fact.classification });
      continue;
    }
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
      requestedRuleRecordKeys: trace.ruleJoin.requestedRuleRecordKeys,
      requestedAmbiguityIds: trace.ruleJoin.requestedAmbiguityIds,
      returned: trace.ruleJoin.returnedRuleIdentities,
      matched: trace.ruleJoin.placedRuleIdentities,
      unplaced: trace.ruleJoin.unplacedRuleIdentities,
      surfacedCandidateKeys: trace.ruleJoin.surfacedCandidateKeys,
      unresolvedAmbiguityIds: trace.ruleJoin.unresolvedAmbiguities
        .map((item) => item.id)
        .filter((id): id is string => typeof id === 'string'),
      placed: trace.ruleJoin.placedRules,
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
    m9: { missing, classified, indeterminate },
    perStage: Object.fromEntries(
      stages.map(([name, stage]) => [
        name,
        {
          produced: stage.outputsProduced.length,
          losses: stage.losses.length,
          failedToRun: stage.failedToRun,
        },
      ]),
    ),
  };
}
