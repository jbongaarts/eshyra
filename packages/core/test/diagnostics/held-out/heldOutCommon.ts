import type { DiagnosticFixture } from '../fixtureContract.js';

/** The HEAD every held-out variant was authored from. */
export const AUTHORED_AT_COMMIT = 'e47401618946dd0a8f2f2e10979497f585131fbe';
/** UTC time the variants were authored (one authoring session). */
export const AUTHORED_AT = '2026-11-07T23:45:00Z';
export const AUTHOR =
  'Claude Sonnet 5.5 subagent (eshyra-o9bd.19.15.1, attempt 1)';

export const HELD_OUT_GATING_BLOCKER: DiagnosticFixture['gatingBlocker'] = {
  id: 'none',
  owningBead: 'eshyra-o9bd.19.15.1',
  gates:
    'Design section 9 blockers B1-B5 are all closed at the authored-at commit; this variant is gated by no pre-experiment blocker.',
};

/**
 * Every held-out variant states the corpus non-claims in the words the
 * contract's boundedEvidenceStatement check requires.
 */
export function boundedEvidence(scenario: string): string {
  return `Held-out bounded evidence for ${scenario} only. It is not a completeness unit, not a partition of the corpus, and yields no coverage, readiness, or completeness figure; a miss bounds an awareness-failure rate on this corpus alone.`;
}
