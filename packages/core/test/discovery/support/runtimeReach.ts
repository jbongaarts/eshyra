/**
 * Shared runtime evidence tables for W9's shadow-mode suite
 * (`shadowRuntime.test.ts`) and W10's packet-intervention suite
 * (`packetIntervention.test.ts`).
 *
 * Both suites run the SAME diagnostic corpus over a REAL turn and assert M1/M2
 * against the exact set of which offline must-include targets actually reach
 * a live turn. Two independently authored copies of this table could silently
 * diverge — one suite tightening as a runtime repair lands, the other left
 * stale — and each would still look internally consistent. Importing one
 * table from here is what makes that impossible: a change has to move both
 * suites at once (`eshyra-o9bd.19.12.4`, design section 13.1).
 */

/**
 * Which offline must-include targets each probe's REAL turn actually reaches,
 * and, for a miss, the stage that lost it.
 *
 * This is the substantive Phase 2/3 result and is asserted exactly, in both
 * directions: a probe that starts reaching a target it did not reach, or stops
 * reaching one it did, fails here. Every miss is a named finding about runtime
 * discovery, never a tolerance:
 *
 * - P1 and P2 lose their targets at `signals`. Both cues read fixture state
 *   fields (`combat.geometry`, `movementIntent`) that the live `StateSnapshot`
 *   does not carry, so shadow mode extracts nothing for them.
 * - P5 reaches the condition from the player's words but not
 *   `rule:concentration`, which the offline fixture supplied as scenario state.
 * - P9's authored entities are reached because the campaign has a real
 *   adventure run and the turn is given a module resolver (B2's repair); the
 *   probe would report them lost at `signals` without it.
 */
export const RUNTIME_REACH: Readonly<
  Record<string, Readonly<Record<string, string | null>>>
> = {
  'P1/default': { 'rule:cover': 'signals' },
  'P2/default': {
    'rule:opportunity-attacks': 'signals',
    'creature:goblin': null,
  },
  'P3/default': { 'creature:adult-black-dragon': null },
  'P4/default': { 'spell:fireball': null },
  'P5/default': {
    'condition:incapacitated': null,
    'rule:concentration': 'signals',
  },
  'P6/default': { 'feature:fighter:action-surge': null },
  'P7/without-active-ruling': { 'magic-item:cube-of-force': null },
  'P7/with-active-ruling': { 'magic-item:cube-of-force': null },
  'P8/default': { 'magic-item:ammunition-1-2-or-3': null },
  'P9/default': {
    'creature:goblin': null,
    'eshyra:hollow-beneath-emberfall#encounter:enc-mouth-ambush': null,
    'eshyra:hollow-beneath-emberfall#location:loc-watchtower-mouth': null,
  },
  'P10/default': { 'spell:fireball': null },
  'P11/default': { 'magic-item:ring-of-protection': null },
  'P12/default': { 'class:fighter': null },
};

/** Design section 12.1 declares exactly these two stages conditional. */
export const CONDITIONAL_STAGES: ReadonlySet<string> = new Set([
  'campaign-rule-expansion',
  'late-ruling-join',
]);
