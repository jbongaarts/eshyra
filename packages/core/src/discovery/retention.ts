import { candidateBand as band } from './bands.js';
import type {
  DiscoveryCandidate,
  RetainedCandidate,
  RetentionBudget,
  RetentionTrace,
} from './types.js';

const DEFAULT_BUDGET: RetentionBudget = {
  maxCandidates: 100,
  maxPacketBytes: 512_000,
};

function rank(a: RetainedCandidate, b: RetainedCandidate): number {
  return (
    b.routes.length - a.routes.length ||
    a.candidateKey.localeCompare(b.candidateKey)
  );
}

export function retainCandidates(
  candidates: readonly DiscoveryCandidate[],
  budget: Partial<RetentionBudget> = {},
): RetentionTrace {
  const effective = { ...DEFAULT_BUDGET, ...budget };
  const order = { 'must-consider': 0, related: 1, exploratory: 2 };
  const ranked = candidates
    .map((candidate) => ({ ...candidate, band: band(candidate) }))
    .sort((a, b) => order[a.band] - order[b.band] || rank(a, b));
  const overflow = ranked
    .filter((candidate) => candidate.band === 'must-consider')
    .slice(effective.maxCandidates)
    .map((candidate) => ({
      candidateKey: candidate.candidateKey,
      band: candidate.band,
      routes: candidate.routes,
      reason: 'must-consider set exceeds maxCandidates',
    }));
  const selected = ranked.slice(0, effective.maxCandidates);
  const dropped = ranked.slice(effective.maxCandidates).map((candidate) => ({
    candidateKey: candidate.candidateKey,
    band: candidate.band,
    routes: candidate.routes,
    reason:
      candidate.band === 'must-consider'
        ? 'explicit must-consider overflow'
        : 'candidate budget',
  }));
  return {
    stage: 'retention',
    inputsConsumed: candidates.map((candidate) => ({
      candidateKey: candidate.candidateKey,
      band: band(candidate),
    })),
    outputsProduced: selected,
    losses: dropped.map((item) => ({ reason: item.reason, detail: item })),
    produced: [],
    modified: selected.map((candidate) => candidate.candidateKey),
    carriedForward: [],
    outcome:
      selected.length === 0 && dropped.length === 0 ? 'failed-to-run' : 'ran',
    failedToRun: selected.length === 0 && dropped.length === 0,
    dropped,
    overflowed: overflow.length > 0,
    overflow,
  };
}

export { DEFAULT_BUDGET };
