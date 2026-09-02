import type {
  CandidateTrace,
  DiscoveryCandidate,
  DiscoveryScenario,
  DiscoverySignal,
  SignalsTrace,
} from './types.js';

function emptyCandidate(
  candidateKey: string,
  route: DiscoveryCandidate['routes'][number],
  entry?: DiscoveryCandidate['entry'],
  adventureEntity?: Record<string, unknown>,
): DiscoveryCandidate {
  return {
    candidateKey,
    targetKind: entry === undefined ? 'adventure-entity' : 'rules-record',
    entry,
    adventureEntity,
    routes: [route],
    traversals: [],
    campaignRules: [],
    campaignRulings: [],
  };
}

/**
 * An authored module entity plus the module's own authority metadata.
 *
 * `AdventureModule` carries real `provenance` and `license` (Hollow Beneath
 * Emberfall declares `first-party:hollow-beneath-emberfall` and an original
 * CC-BY-4.0 licence). Returning the bare entity discarded both, and the packet
 * then hardcoded `sourceRef: 'adventure-module'` with a null licence — losing
 * known authority metadata for material the packet presents as authoritative.
 * Source fidelity does not depend on the material being a rules record.
 */
function adventureEntity(
  signal: DiscoverySignal,
  scenario: DiscoveryScenario,
): Record<string, unknown> | undefined {
  const adventure = scenario.adventure;
  if (adventure === undefined) return undefined;
  const evidence = signal.evidence;
  if (evidence.moduleId !== adventure.moduleId) return undefined;
  const kind = evidence.entityKind;
  const id = evidence.entityId;
  const entity =
    kind === 'location'
      ? adventure.module.locations.find((item) => item.id === id)
      : kind === 'encounter'
        ? adventure.module.encounters.find((item) => item.id === id)
        : undefined;
  if (entity === undefined) return undefined;
  return {
    entity: entity as unknown as Record<string, unknown>,
    moduleId: adventure.module.id,
    entityKind: kind,
    provenance: adventure.module.provenance as unknown as Record<
      string,
      unknown
    >,
    license: adventure.module.license as unknown as Record<string, unknown>,
  };
}

export function resolveDiscoveryCandidates(
  signals: SignalsTrace | readonly DiscoverySignal[],
  stack: {
    recordsByKey: ReadonlyMap<string, DiscoveryCandidate['entry']>;
  },
  scenario: DiscoveryScenario,
): CandidateTrace {
  const inputSignals: readonly DiscoverySignal[] = Array.isArray(signals)
    ? signals
    : (signals as SignalsTrace).outputsProduced;
  const candidates = new Map<string, DiscoveryCandidate>();
  const losses: CandidateTrace['losses'][number][] = [];
  const unresolvedTargets: string[] = [];
  for (const signal of inputSignals) {
    const entry = stack.recordsByKey.get(signal.proposes);
    const entity = adventureEntity(signal, scenario);
    if (entry === undefined && entity === undefined) {
      unresolvedTargets.push(signal.proposes);
      losses.push({
        reason: 'unresolved-target',
        detail: { target: signal.proposes, signalId: signal.signalId },
      });
      continue;
    }
    const route = {
      routeClass:
        signal.kind === 'state-ref'
          ? ('direct-state-ref' as const)
          : signal.kind === 'adventure-ref'
            ? ('direct-adventure-ref' as const)
            : signal.kind === 'name-mention'
              ? ('explicit-name-or-alias' as const)
              : signal.kind,
      trigger: signal.kind,
      evidence: signal.evidence,
      signalId: signal.signalId,
    };
    const current = candidates.get(signal.proposes);
    candidates.set(
      signal.proposes,
      current === undefined
        ? emptyCandidate(signal.proposes, route, entry, entity)
        : { ...current, routes: [...current.routes, route] },
    );
  }
  return {
    stage: 'candidates',
    inputsConsumed: inputSignals.map((signal) => ({
      signalId: signal.signalId,
      target: signal.proposes,
    })),
    outputsProduced: [...candidates.values()],
    losses,
    carriedForward: 0,
    outcome:
      candidates.size === 0 && losses.length === 0 ? 'failed-to-run' : 'ran',
    failedToRun: candidates.size === 0 && losses.length === 0,
    unresolvedTargets,
  };
}
