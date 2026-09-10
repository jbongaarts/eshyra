/**
 * Candidate priority bands (design section 6.3).
 *
 * Shared by retention and by typed expansion so the two cannot disagree about
 * what "must-consider" means. Expansion needs it because the design defines
 * Related as one-hop typed relationships **from must-consider material**: an
 * exploratory-only seed must not promote its typed neighbourhood into the
 * Related band and change retention pressure.
 */
import type { CandidateBand, DiscoveryRoute, RouteClass } from './types.js';

/**
 * Every route class's band, stated exhaustively.
 *
 * `Record<RouteClass, CandidateBand>` is load-bearing: adding a route class to
 * the union stops compilation here until someone decides which band it earns.
 * The predecessor asked two positive questions and sent everything else to
 * `exploratory`, so a route class introduced later — or a corrupted one that
 * reached this function from stored JSON — silently acquired the WEAKEST band.
 * ADR 0020 section 3 forbids exactly that: unrecognized is not a safety
 * property, and softening a mandatory candidate into an exploratory one is how
 * a must-consider overflow turns green.
 */
const ROUTE_BANDS: Readonly<Record<RouteClass, CandidateBand>> = {
  'direct-state-ref': 'must-consider',
  'direct-adventure-ref': 'must-consider',
  'explicit-name-or-alias': 'must-consider',
  'campaign-rule': 'must-consider',
  'campaign-ruling': 'must-consider',
  'capability-preflight': 'must-consider',
  'typed-relationship': 'related',
  'situation-cue': 'exploratory',
  'auditor-missing-target': 'exploratory',
};

const BAND_STRENGTH: Readonly<Record<CandidateBand, number>> = {
  'must-consider': 0,
  related: 1,
  exploratory: 2,
};

const MUST_CONSIDER_ROUTES: readonly RouteClass[] = (
  Object.keys(ROUTE_BANDS) as RouteClass[]
).filter((routeClass) => ROUTE_BANDS[routeClass] === 'must-consider');

/**
 * The band one route earns.
 *
 * A route class with no entry cannot be classified, and guessing is the defect
 * this exists to prevent, so it throws. In typed producer code the case is
 * unreachable; the throw is the runtime floor under a value that came back
 * through JSON, where the durable reader's independent route vocabulary is the
 * first line of defence.
 */
function bandOfRoute(routeClass: RouteClass): CandidateBand {
  const band = ROUTE_BANDS[routeClass];
  if (band === undefined)
    throw new Error(
      `route class '${String(routeClass)}' has no band classification; it cannot be treated as exploratory by default`,
    );
  return band;
}

/**
 * The strongest band any of the candidate's routes earns.
 *
 * Takes only the routes, so the durable projection — which carries routes but
 * not record bodies — can derive a band with this same rule instead of storing
 * a second copy of it.
 */
export function candidateBand(candidate: {
  readonly routes: readonly DiscoveryRoute[];
}): CandidateBand {
  let strongest: CandidateBand = 'exploratory';
  for (const route of candidate.routes) {
    const band = bandOfRoute(route.routeClass);
    if (BAND_STRENGTH[band] < BAND_STRENGTH[strongest]) strongest = band;
  }
  return strongest;
}

export { MUST_CONSIDER_ROUTES, ROUTE_BANDS };
