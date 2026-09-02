/**
 * Candidate priority bands (design section 6.3).
 *
 * Shared by retention and by typed expansion so the two cannot disagree about
 * what "must-consider" means. Expansion needs it because the design defines
 * Related as one-hop typed relationships **from must-consider material**: an
 * exploratory-only seed must not promote its typed neighbourhood into the
 * Related band and change retention pressure.
 */
import type { CandidateBand, DiscoveryCandidate, RouteClass } from './types.js';

const MUST_CONSIDER_ROUTES: readonly RouteClass[] = [
  'direct-state-ref',
  'direct-adventure-ref',
  'explicit-name-or-alias',
  'campaign-rule',
  'campaign-ruling',
  'capability-preflight',
];

/** The strongest band any of the candidate's routes earns. */
export function candidateBand(candidate: DiscoveryCandidate): CandidateBand {
  if (
    candidate.routes.some((route) =>
      MUST_CONSIDER_ROUTES.includes(route.routeClass),
    )
  )
    return 'must-consider';
  if (
    candidate.routes.some((route) => route.routeClass === 'typed-relationship')
  )
    return 'related';
  return 'exploratory';
}

export { MUST_CONSIDER_ROUTES };
