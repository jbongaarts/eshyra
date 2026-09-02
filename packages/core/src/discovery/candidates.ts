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
  if (kind === 'location')
    return adventure.module.locations.find((item) => item.id === id) as
      | Record<string, unknown>
      | undefined;
  if (kind === 'encounter')
    return adventure.module.encounters.find((item) => item.id === id) as
      | Record<string, unknown>
      | undefined;
  return undefined;
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
    failedToRun: candidates.size === 0 && losses.length === 0,
    unresolvedTargets,
  };
}
