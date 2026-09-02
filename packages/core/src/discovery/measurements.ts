import type { DiscoveryTrace, TypedTraversal } from './types.js';

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
  readonly m3: Readonly<Record<string, { before: number; after: number }>>;
  readonly m4: readonly {
    readonly traversal: TypedTraversal;
    readonly result: 'fired' | 'not-fired' | 'fired-and-dropped';
  }[];
  readonly m5: {
    readonly requestedRuleRecordKeys: readonly string[];
    readonly requestedAmbiguityIds: readonly string[];
    readonly placed: readonly {
      readonly ruleIdentity: string;
      readonly governingRecordKey: string;
    }[];
  };
  readonly m6: {
    readonly allMustConsiderRetained: boolean;
    readonly overflowed: boolean;
  };
  readonly m7: {
    readonly packetBytes: number;
    readonly candidateCount: number;
    readonly drops: readonly {
      readonly candidateKey: string;
      readonly reason: string;
    }[];
  };
  readonly m8: {
    readonly forbiddenPresent: readonly string[];
    readonly knownFalseProvenancePresent: readonly string[];
  };
  readonly m9: {
    readonly missing: readonly RequiredPacketFact[];
    readonly proseOnlyNotCheckable: readonly RequiredPacketFact[];
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
    const found = stages.findIndex(([, stage]) =>
      stage.outputsProduced.some((item) =>
        'candidateKey' in item
          ? item.candidateKey === key
          : 'proposes' in item && item.proposes === key,
      ),
    );
    m2[key] = found < 0 ? 'packet' : stages[found][0];
  }
  const m3: Record<string, { before: number; after: number }> = {};
  for (const key of new Set([
    ...Object.keys(trace.dedup.routeCountBeforeDedup),
    ...Object.keys(trace.dedup.routeCountAfterDedup),
  ]))
    m3[key] = {
      before: trace.dedup.routeCountBeforeDedup[key] ?? 0,
      after: trace.dedup.routeCountAfterDedup[key] ?? 0,
    };
  const m4 = (input.requiredRelationshipExpansion ?? []).map((traversal) => {
    const fired = trace.expansion.traversals.some((item) =>
      equal(item, traversal),
    );
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
  const proseOnlyNotCheckable: RequiredPacketFact[] = [];
  for (const fact of input.requiredFacts ?? []) {
    if (fact.exactSubstring === undefined && fact.typedPath === undefined) {
      proseOnlyNotCheckable.push(fact);
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
        : (JSON.stringify(candidate?.sourceProse) ?? '').includes(
            fact.exactSubstring,
          );
    if (!present) missing.push(fact);
  }
  const forbiddenPresent = (input.mustNotIncludeTargetRefs ?? []).filter(
    (key) => keys.has(key),
  );
  const knownFalseProvenancePresent = trace.packet.packet.candidates
    .filter((candidate) => candidate.provenance.sourceRef === 'known-false')
    .map((candidate) => candidate.identity.key);
  return {
    m1,
    m2,
    m3,
    m4,
    m5: {
      requestedRuleRecordKeys: trace.ruleJoin.requestedRuleRecordKeys,
      requestedAmbiguityIds: trace.ruleJoin.requestedAmbiguityIds,
      placed: trace.ruleJoin.placedRules,
    },
    m6: {
      allMustConsiderRetained: !trace.retention.overflowed,
      overflowed: trace.retention.overflowed,
    },
    m7: {
      packetBytes: trace.packet.packet.bytes,
      candidateCount: trace.packet.packet.candidates.length,
      drops: trace.packet.dropped.map((item) => ({
        candidateKey: item.candidateKey,
        reason: item.reason,
      })),
    },
    m8: { forbiddenPresent, knownFalseProvenancePresent },
    m9: { missing, proseOnlyNotCheckable },
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
