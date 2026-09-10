import { candidateBand as band } from './bands.js';
import type {
  CandidateDisposition,
  DiscoveryCandidate,
  RetainedCandidate,
  RetentionBudget,
  RetentionOverflow,
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

/**
 * The one canonical reason an exclusion carries, authored where the budget
 * comparison happens.
 *
 * There used to be two descriptions of the same count-budget rejection — an
 * `overflow` entry saying "must-consider set exceeds maxCandidates" and a
 * `dropped` entry saying "explicit must-consider overflow" — which is exactly
 * the duplicate semantic surface this design removes: two authored strings for
 * one decision are two things that can drift. Both views now read this.
 */
function exclusionReason(
  candidate: RetainedCandidate,
  rankIndex: number,
  maxCandidates: number,
): string {
  return candidate.band === 'must-consider'
    ? `must-consider set exceeds maxCandidates ${maxCandidates}`
    : `candidate budget: rank ${rankIndex + 1} exceeds maxCandidates ${maxCandidates}`;
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

  // ONE pass over the ranked list, deciding each candidate at the budget
  // boundary and recording that decision as it is made. Everything below is a
  // view of this list; nothing recomputes the partition from the survivors.
  const dispositions: CandidateDisposition[] = [];
  const selected: RetainedCandidate[] = [];
  const dropped: RetentionTrace['dropped'][number][] = [];
  const overflow: RetentionOverflow[] = [];
  ranked.forEach((candidate, index) => {
    if (index < effective.maxCandidates) {
      dispositions.push({
        candidateKey: candidate.candidateKey,
        retained: true,
      });
      selected.push(candidate);
      return;
    }
    const reason = exclusionReason(candidate, index, effective.maxCandidates);
    dispositions.push({
      candidateKey: candidate.candidateKey,
      retained: false,
      reason,
    });
    const record = {
      candidateKey: candidate.candidateKey,
      band: candidate.band,
      routes: candidate.routes,
      reason,
    };
    dropped.push(record);
    // Design section 6.3: a must-consider candidate lost to the budget is an
    // explicit overflow that fails the probe. Same decision, same reason.
    if (candidate.band === 'must-consider') overflow.push(record);
  });

  return {
    stage: 'retention',
    inputsConsumed: candidates.map((candidate) => ({
      candidateKey: candidate.candidateKey,
      band: band(candidate),
    })),
    dispositions,
    outputsProduced: selected,
    losses: dropped.map((item) => ({ reason: item.reason, detail: item })),
    produced: [],
    modified: selected.map((candidate) => candidate.candidateKey),
    carriedForward: [],
    outcome: dispositions.length === 0 ? 'failed-to-run' : 'ran',
    failedToRun: dispositions.length === 0,
    dropped,
    overflowed: overflow.length > 0,
    overflow,
  };
}

export { DEFAULT_BUDGET };
