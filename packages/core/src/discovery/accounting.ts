/**
 * Membership accounting for a stage (design section 12.1).
 *
 * Each stage reports which candidates it produced, which existing candidates
 * it modified, and which it carried forward untouched — by key, not by count.
 * Identity is the candidate's full route, traversal and rule/ruling evidence:
 * a candidate can gain a traversal without gaining a route, and a
 * count-based comparison reports that mutation as untouched pass-through.
 */
import type { DiscoveryCandidate } from './types.js';

export function candidateFingerprint(candidate: DiscoveryCandidate): string {
  return JSON.stringify([
    candidate.routes.map((route) => [
      route.routeClass,
      route.trigger,
      route.signalId,
    ]),
    candidate.traversals,
    candidate.campaignRules.map((rule) => rule.ruleIdentity),
    candidate.campaignRulings.map((ruling) => ruling.ruleIdentity),
  ]);
}

export interface CandidateAccounting {
  readonly produced: readonly string[];
  readonly modified: readonly string[];
  readonly carriedForward: readonly string[];
}

export function accountCandidates(
  before: readonly DiscoveryCandidate[],
  after: readonly DiscoveryCandidate[],
): CandidateAccounting {
  const priorByKey = new Map(
    before.map((candidate) => [
      candidate.candidateKey,
      candidateFingerprint(candidate),
    ]),
  );
  const produced: string[] = [];
  const modified: string[] = [];
  const carriedForward: string[] = [];
  for (const candidate of after) {
    const prior = priorByKey.get(candidate.candidateKey);
    if (prior === undefined) produced.push(candidate.candidateKey);
    else if (prior !== candidateFingerprint(candidate))
      modified.push(candidate.candidateKey);
    else carriedForward.push(candidate.candidateKey);
  }
  return { produced, modified, carriedForward };
}
