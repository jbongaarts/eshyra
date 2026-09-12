import { describe, expect, it } from 'vitest';
import {
  canonicalKey,
  deepEqual,
  measureDiscovery,
  projectDiscoveryTrace,
  runDiscoveryStages,
} from '../../src/internal.js';
import type { DiagnosticFixture } from '../diagnostics/index.js';
import { DIAGNOSTIC_FIXTURES } from '../diagnostics/index.js';
import { freshDbWithSession } from '../support/db.js';
import { installJhptCampaignRules } from './support/jhptCampaignRules.js';
import {
  installScenarioBinding,
  moduleForFixture,
  scenarioForFixture,
} from './support/scenario.js';

/**
 * PR #543 re-review finding 2: M4 and M9 measure semantic evidence, so
 * JavaScript object INSERTION ORDER must not decide whether they agree.
 *
 * The earlier F5 repair corrected M12 but left a general
 * `JSON.stringify(a) === JSON.stringify(b)` helper behind, which M4's
 * traversal comparison and M9's `typedPath` expected-value comparison both
 * used. These cases drive the REAL measurement path over a REAL offline trace
 * — reordering only the key insertion order of the expectation — so a
 * regression to encoding comparison fails here rather than passing quietly.
 */

function fixtureFor(probeId: string): DiagnosticFixture {
  const fixture = DIAGNOSTIC_FIXTURES.find((item) => item.probeId === probeId);
  if (fixture === undefined) throw new Error(`missing fixture ${probeId}`);
  return fixture;
}

function traceFor(probeId: string) {
  const fixture = fixtureFor(probeId);
  const execution = fixture.executions[0];
  const db = freshDbWithSession();
  try {
    const rulesPackResolver = installScenarioBinding(fixture, db);
    const campaignRules = installJhptCampaignRules(
      db,
      fixture,
      execution,
      rulesPackResolver,
    );
    return projectDiscoveryTrace(
      runDiscoveryStages({
        db,
        scenario: scenarioForFixture(
          fixture,
          execution,
          moduleForFixture(fixture),
        ),
        campaignRuleSeam: campaignRules.seam,
        campaignPosition: campaignRules.campaignPosition,
        ...(rulesPackResolver === undefined ? {} : { rulesPackResolver }),
      }),
    );
  } finally {
    db.close();
  }
}

/** Rebuild an object with its keys inserted in reverse order, recursively.
 * Structurally identical, textually different under `JSON.stringify`. */
function reorderKeys<T>(value: T): T {
  if (Array.isArray(value)) return value.map(reorderKeys) as unknown as T;
  if (value === null || typeof value !== 'object') return value;
  const record = value as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(record).reverse())
    out[key] = reorderKeys(record[key]);
  return out as unknown as T;
}

describe('structural equality primitives', () => {
  it('is key-order-independent for objects, at every depth', () => {
    const a = { x: 1, nested: { p: 'a', q: [1, { m: true, n: null }] } };
    const b = reorderKeys(a);
    expect(JSON.stringify(a)).not.toBe(JSON.stringify(b));
    expect(deepEqual(a, b)).toBe(true);
    expect(canonicalKey(a)).toBe(canonicalKey(b));
  });

  it('keeps array order significant', () => {
    expect(deepEqual([1, 2], [2, 1])).toBe(false);
    expect(deepEqual({ a: [1, 2] }, { a: [2, 1] })).toBe(false);
    expect(canonicalKey([1, 2])).not.toBe(canonicalKey([2, 1]));
  });

  it('disagrees on a changed value, a missing key and an extra key', () => {
    expect(deepEqual({ a: 1 }, { a: 2 })).toBe(false);
    expect(deepEqual({ a: 1, b: 2 }, { a: 1 })).toBe(false);
    expect(deepEqual({ a: 1 }, { a: 1, b: 2 })).toBe(false);
    expect(deepEqual({ a: { b: 1 } }, { a: { b: 2 } })).toBe(false);
  });

  it('keeps null and undefined distinct', () => {
    expect(deepEqual({ a: null }, { a: undefined })).toBe(false);
  });
});

describe('M9 compares typed values semantically', () => {
  // P8 declares a typedPath fact with an object expectedValue, which is the
  // only shape whose key order can differ at all.
  const TARGET = 'magic-item:ammunition-1-2-or-3';
  const TYPED_PATH = '/data/mechanics/economies/use';
  const EXPECTED = {
    kind: 'single-use',
    onDepleted: { loseProperty: true, becomes: 'nonmagical' },
  };

  it('reports the fact present when the expectation key order differs', () => {
    const trace = traceFor('P8');
    const reordered = reorderKeys(EXPECTED);
    // Non-vacuous: the two encodings really do differ.
    expect(JSON.stringify(reordered)).not.toBe(JSON.stringify(EXPECTED));
    const measured = measureDiscovery(trace, {
      requiredFacts: [
        { targetRef: TARGET, typedPath: TYPED_PATH, expectedValue: reordered },
      ],
    });
    expect(measured.m9.measured).toBe(1);
    expect(measured.m9.missing).toEqual([]);
  });

  it('still reports a changed value as missing', () => {
    const trace = traceFor('P8');
    const measured = measureDiscovery(trace, {
      requiredFacts: [
        {
          targetRef: TARGET,
          typedPath: TYPED_PATH,
          expectedValue: {
            onDepleted: { becomes: 'MISMATCH', loseProperty: true },
            kind: 'single-use',
          },
        },
      ],
    });
    expect(measured.m9.missing).toHaveLength(1);
  });
});

describe('M4 compares traversals semantically', () => {
  it('matches a required traversal whose keys were inserted in another order', () => {
    const trace = traceFor('P5');
    const fired = trace.expansion.traversalEvents[0];
    if (fired === undefined) throw new Error('P5 fired no traversal');
    const reordered = reorderKeys(fired);
    expect(JSON.stringify(reordered)).not.toBe(JSON.stringify(fired));
    const measured = measureDiscovery(trace, {
      requiredRelationshipExpansion: [reordered],
    });
    expect(measured.m4).toHaveLength(1);
    expect(measured.m4[0].result).not.toBe('not-fired');
  });

  it('does not match a genuinely different traversal', () => {
    const trace = traceFor('P5');
    const fired = trace.expansion.traversalEvents[0];
    if (fired === undefined) throw new Error('P5 fired no traversal');
    const measured = measureDiscovery(trace, {
      requiredRelationshipExpansion: [
        { ...fired, targetRecordKey: 'rule:does-not-exist' },
      ],
    });
    expect(measured.m4).toHaveLength(1);
    expect(measured.m4[0].result).toBe('not-fired');
  });
});
