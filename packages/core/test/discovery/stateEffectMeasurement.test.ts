import { describe, expect, it } from 'vitest';
import type {
  ExpectedStateEffect,
  RuntimeDiscoveryObservations,
  RuntimeStateEffect,
} from '../../src/internal.js';
import { measureAcceptedStateEffect } from '../../src/internal.js';

/**
 * W10 (`eshyra-o9bd.19.12`) evidence for **M12 — accepted state-effect
 * agreement** (design section 13.1): whether the accepted deterministic state
 * effect matches the fixture's expectation, INCLUDING the expectation that
 * there is none.
 *
 * M12 has no "not comparable" state, unlike M10. Both sides of this comparison
 * are always present: a fixture always declares an expectation, and an accepted
 * attempt always produced a recorded — possibly empty — set of effects. A soft
 * third state would be a refusal to compare where nothing prevents comparison,
 * so every case below lands on `agreed` or `disagreed`.
 *
 * Design section 13.2: M12 is reported per probe and is never collapsed into a
 * rate, a score, or an adjudication-correctness claim.
 */

function effect(
  tool: string,
  ordinal: number,
  args: Record<string, unknown> = {},
  attempt = 1,
): RuntimeStateEffect {
  return { attempt, ordinal, tool, args };
}

function observations(
  stateEffects: readonly RuntimeStateEffect[],
): RuntimeDiscoveryObservations {
  return {
    capabilityInvocations: [],
    stateEffects,
    audit: { auditor: 'absent' },
  };
}

const NONE: ExpectedStateEffect = { expectation: 'none' };

describe('M12 accepted state-effect agreement', () => {
  it('agrees when none is expected and the turn accepted none', () => {
    const measured = measureAcceptedStateEffect(observations([]), NONE);
    expect(measured).toEqual({
      expectation: 'none',
      expectedOperations: [],
      acceptedEffects: [],
      agreement: 'agreed',
      disagreements: [],
    });
  });

  it('names every unexpected effect when none was expected', () => {
    const measured = measureAcceptedStateEffect(
      observations([
        effect('adjust_hp', 0, { delta: -3 }),
        effect('add_condition', 1, { condition: 'prone' }, 2),
      ]),
      NONE,
    );
    expect(measured.agreement).toBe('disagreed');
    expect(measured.disagreements).toEqual([
      { kind: 'unexpected-effect', tool: 'adjust_hp', attempt: 1, ordinal: 0 },
      {
        kind: 'unexpected-effect',
        tool: 'add_condition',
        attempt: 2,
        ordinal: 1,
      },
    ]);
  });

  it('agrees on an exact tool and argument match', () => {
    const measured = measureAcceptedStateEffect(
      observations([
        effect('use_item', 0, {
          instanceId: 'ammunition-stack-1',
          operationId: 'hit-target',
        }),
      ]),
      {
        expectation: 'effect',
        operations: [
          {
            tool: 'use_item',
            args: {
              instanceId: 'ammunition-stack-1',
              operationId: 'hit-target',
            },
          },
        ],
      },
    );
    expect(measured.agreement).toBe('agreed');
    expect(measured.disagreements).toEqual([]);
  });

  it('pairs expected operations in declared order across the accepted stream', () => {
    const measured = measureAcceptedStateEffect(
      observations([
        effect('spend_usage', 0, { usageId: 'a' }),
        effect('adjust_hp', 1, { delta: -3 }),
        effect('spend_usage', 2, { usageId: 'b' }),
      ]),
      {
        expectation: 'effect',
        operations: [
          { tool: 'spend_usage', args: { usageId: 'a' } },
          { tool: 'adjust_hp' },
          { tool: 'spend_usage', args: { usageId: 'b' } },
        ],
      },
    );
    expect(measured.agreement).toBe('agreed');
  });

  it('reports an expected operation the turn never performed', () => {
    const measured = measureAcceptedStateEffect(observations([]), {
      expectation: 'effect',
      operations: [{ tool: 'use_item' }],
    });
    expect(measured.agreement).toBe('disagreed');
    expect(measured.disagreements).toEqual([
      { kind: 'missing-expected-operation', tool: 'use_item' },
    ]);
  });

  it('reports an argument mismatch with the field, expectation and observation', () => {
    const measured = measureAcceptedStateEffect(
      observations([
        effect('use_item', 0, {
          instanceId: 'ammunition-stack-1',
          operationId: 'wrong-operation',
        }),
      ]),
      {
        expectation: 'effect',
        operations: [{ tool: 'use_item', args: { operationId: 'hit-target' } }],
      },
    );
    expect(measured.agreement).toBe('disagreed');
    expect(measured.disagreements).toEqual([
      {
        kind: 'argument-mismatch',
        tool: 'use_item',
        attempt: 1,
        ordinal: 0,
        field: 'operationId',
        expected: 'hit-target',
        observed: 'wrong-operation',
      },
    ]);
  });

  /**
   * The expectation declares a SUBSET. A fixture pins the arguments that make
   * the effect the effect it claims to be; requiring it to restate every
   * argument the tool happens to take would make the corpus a transcript of
   * the implementation rather than a statement about the scenario.
   */
  it('ignores accepted argument fields the expectation does not declare', () => {
    const measured = measureAcceptedStateEffect(
      observations([
        effect('use_item', 0, {
          instanceId: 'ammunition-stack-1',
          operationId: 'hit-target',
          character: 'pc-1',
          note: 'narrated aside',
        }),
      ]),
      {
        expectation: 'effect',
        operations: [{ tool: 'use_item', args: { operationId: 'hit-target' } }],
      },
    );
    expect(measured.agreement).toBe('agreed');
  });

  it('reports an accepted effect no expected operation consumed', () => {
    const measured = measureAcceptedStateEffect(
      observations([
        effect('use_item', 0, { operationId: 'hit-target' }),
        effect('remove_item', 1, { instanceId: 'other' }),
      ]),
      { expectation: 'effect', operations: [{ tool: 'use_item' }] },
    );
    expect(measured.agreement).toBe('disagreed');
    expect(measured.disagreements).toEqual([
      {
        kind: 'unexpected-effect',
        tool: 'remove_item',
        attempt: 1,
        ordinal: 1,
      },
    ]);
  });

  /**
   * A repeated tool consumes distinct accepted effects. Pairing by tool name
   * alone without consuming would let one accepted call satisfy two expected
   * operations, reporting agreement for an effect that happened once.
   */
  it('never lets one accepted effect satisfy two expected operations', () => {
    const measured = measureAcceptedStateEffect(
      observations([effect('spend_usage', 0, { usageId: 'a' })]),
      {
        expectation: 'effect',
        operations: [{ tool: 'spend_usage' }, { tool: 'spend_usage' }],
      },
    );
    expect(measured.agreement).toBe('disagreed');
    expect(measured.disagreements).toEqual([
      { kind: 'missing-expected-operation', tool: 'spend_usage' },
    ]);
  });

  it('compares in ordinal order regardless of recorded order', () => {
    const measured = measureAcceptedStateEffect(
      observations([
        effect('adjust_hp', 1, { delta: -3 }),
        effect('use_item', 0, { operationId: 'hit-target' }),
      ]),
      {
        expectation: 'effect',
        operations: [
          { tool: 'use_item', args: { operationId: 'hit-target' } },
          { tool: 'adjust_hp', args: { delta: -3 } },
        ],
      },
    );
    expect(measured.agreement).toBe('agreed');
    expect(measured.acceptedEffects.map((item) => item.ordinal)).toEqual([
      0, 1,
    ]);
  });

  /**
   * F5 (eshyra-o9bd.19.12.7): argument comparison is real structural deep
   * equality, not `JSON.stringify` equality. These cases exercise the shapes
   * that distinguish the two: object key order, array order/length, and the
   * deliberate decision that the top-level subset rule (tested above) does
   * NOT recurse into a declared nested object.
   */
  describe('structural deep equality of declared arguments', () => {
    it('agrees when a nested argument object has reordered keys', () => {
      const measured = measureAcceptedStateEffect(
        observations([effect('use_item', 0, { payload: { b: 2, a: 1 } })]),
        {
          expectation: 'effect',
          operations: [{ tool: 'use_item', args: { payload: { a: 1, b: 2 } } }],
        },
      );
      expect(measured.agreement).toBe('agreed');
      expect(measured.disagreements).toEqual([]);
    });

    it('disagrees when a declared array argument is reordered', () => {
      const measured = measureAcceptedStateEffect(
        observations([effect('use_item', 0, { targets: ['b', 'a'] })]),
        {
          expectation: 'effect',
          operations: [{ tool: 'use_item', args: { targets: ['a', 'b'] } }],
        },
      );
      expect(measured.agreement).toBe('disagreed');
      expect(measured.disagreements).toEqual([
        {
          kind: 'argument-mismatch',
          tool: 'use_item',
          attempt: 1,
          ordinal: 0,
          field: 'targets',
          expected: ['a', 'b'],
          observed: ['b', 'a'],
        },
      ]);
    });

    it('disagrees when a declared array argument has a different length', () => {
      const measured = measureAcceptedStateEffect(
        observations([effect('use_item', 0, { targets: ['a', 'b', 'c'] })]),
        {
          expectation: 'effect',
          operations: [{ tool: 'use_item', args: { targets: ['a', 'b'] } }],
        },
      );
      expect(measured.agreement).toBe('disagreed');
      expect(measured.disagreements).toEqual([
        {
          kind: 'argument-mismatch',
          tool: 'use_item',
          attempt: 1,
          ordinal: 0,
          field: 'targets',
          expected: ['a', 'b'],
          observed: ['a', 'b', 'c'],
        },
      ]);
    });

    it('disagrees on a different value nested inside a declared argument, naming the top-level declared field', () => {
      const measured = measureAcceptedStateEffect(
        observations([effect('use_item', 0, { payload: { a: 1, b: 3 } })]),
        {
          expectation: 'effect',
          operations: [{ tool: 'use_item', args: { payload: { a: 1, b: 2 } } }],
        },
      );
      expect(measured.agreement).toBe('disagreed');
      expect(measured.disagreements).toEqual([
        {
          kind: 'argument-mismatch',
          tool: 'use_item',
          attempt: 1,
          ordinal: 0,
          field: 'payload',
          expected: { a: 1, b: 2 },
          observed: { a: 1, b: 3 },
        },
      ]);
    });

    it('disagrees when a declared nested field is absent from the executed argument object', () => {
      const measured = measureAcceptedStateEffect(
        observations([effect('use_item', 0, { payload: { a: 1 } })]),
        {
          expectation: 'effect',
          operations: [{ tool: 'use_item', args: { payload: { a: 1, b: 2 } } }],
        },
      );
      expect(measured.agreement).toBe('disagreed');
      expect(measured.disagreements).toEqual([
        {
          kind: 'argument-mismatch',
          tool: 'use_item',
          attempt: 1,
          ordinal: 0,
          field: 'payload',
          expected: { a: 1, b: 2 },
          observed: { a: 1 },
        },
      ]);
    });

    /**
     * Deliberate decision (documented beside `deepEqual` in
     * measurements.ts): the top-level subset rule exercised above — a
     * fixture need not restate every argument the tool takes — does NOT
     * recurse into a declared nested object. Once a declared field is
     * selected for comparison, its value must fully agree with the executed
     * value at every depth, so an executed nested object carrying a key the
     * fixture never declared disagrees rather than passing silently. The
     * alternative (letting the subset rule recurse) would let a fixture
     * assert `{a: 1}` and admit any executed nested shape that merely
     * contains it, which is exactly the unverified-mechanical-claim gap M12
     * exists to close.
     */
    it('disagrees when the executed argument object nested inside a declared field carries an extra key', () => {
      const measured = measureAcceptedStateEffect(
        observations([
          effect('use_item', 0, { payload: { a: 1, b: 2, c: 3 } }),
        ]),
        {
          expectation: 'effect',
          operations: [{ tool: 'use_item', args: { payload: { a: 1, b: 2 } } }],
        },
      );
      expect(measured.agreement).toBe('disagreed');
      expect(measured.disagreements).toEqual([
        {
          kind: 'argument-mismatch',
          tool: 'use_item',
          attempt: 1,
          ordinal: 0,
          field: 'payload',
          expected: { a: 1, b: 2 },
          observed: { a: 1, b: 2, c: 3 },
        },
      ]);
    });
  });
});
