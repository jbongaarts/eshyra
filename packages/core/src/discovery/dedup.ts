import type { DedupTrace, DiscoveryCandidate } from './types.js';

function routeKey(route: DiscoveryCandidate['routes'][number]): string {
  return JSON.stringify([route.routeClass, route.trigger, route.signalId]);
}

export function deduplicateCandidates(
  candidates: readonly DiscoveryCandidate[],
): DedupTrace {
  const merged = new Map<string, DiscoveryCandidate>();
  const before: Record<string, number> = {};
  for (const candidate of candidates) {
    before[candidate.candidateKey] =
      (before[candidate.candidateKey] ?? 0) + candidate.routes.length;
    const current = merged.get(candidate.candidateKey);
    if (current === undefined) {
      merged.set(candidate.candidateKey, candidate);
      continue;
    }
    const routes = [...current.routes];
    const keys = new Set(routes.map(routeKey));
    for (const route of candidate.routes)
      if (!keys.has(routeKey(route))) routes.push(route);
    const traversals = [...current.traversals];
    for (const traversal of candidate.traversals)
      if (
        !traversals.some(
          (item) => JSON.stringify(item) === JSON.stringify(traversal),
        )
      )
        traversals.push(traversal);
    merged.set(candidate.candidateKey, {
      ...current,
      routes,
      traversals,
      campaignRules: [...current.campaignRules, ...candidate.campaignRules],
      campaignRulings: [
        ...current.campaignRulings,
        ...candidate.campaignRulings,
      ],
    });
  }
  const after: Record<string, number> = {};
  for (const candidate of merged.values())
    after[candidate.candidateKey] = candidate.routes.length;
  const losses: DedupTrace['losses'][number][] = [];
  for (const [key, count] of Object.entries(before)) {
    if ((after[key] ?? 0) < count) {
      losses.push({
        reason: 'route-lost',
        detail: { candidateKey: key, before: count, after: after[key] ?? 0 },
      });
      throw new Error(`discovery deduplication lost a route for '${key}'`);
    }
  }
  return {
    stage: 'dedup',
    inputsConsumed: candidates.map((candidate) => ({
      candidateKey: candidate.candidateKey,
      routeCount: candidate.routes.length,
    })),
    outputsProduced: [...merged.values()],
    losses,
    failedToRun: merged.size === 0 && losses.length === 0,
    routeCountBeforeDedup: before,
    routeCountAfterDedup: after,
  };
}
