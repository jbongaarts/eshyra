import { describe, expect, it } from 'vitest';
import type { ExecutedToolCall } from '../src/orchestrator/turnLoop.js';
import { deriveTraceFields } from '../src/orchestrator/turnTraceProjection.js';

function call(
  tool: string,
  result: ExecutedToolCall['result'],
): ExecutedToolCall {
  return {
    tool,
    args: { amounts: { gp: 1 } },
    result,
    mutates: true,
    source: 'native',
  };
}

describe('currency trace projection', () => {
  it('projects successful currency mutations and rejected calls', () => {
    const fields = deriveTraceFields(
      [
        call('gain_currency', { ok: true, data: { wallet: { gp: 1 } } }),
        call('spend_currency', {
          ok: false,
          code: 'currency_error',
          message: 'not enough gp',
        }),
        call('convert_currency', {
          ok: true,
          data: { wallet: { gp: 0, sp: 10 } },
        }),
      ],
      [],
    );
    expect(fields.acceptedStateDelta).toHaveLength(2);
    expect(fields.rejectedCandidates).toMatchObject([
      { tool: 'spend_currency', code: 'currency_error' },
    ]);
  });
});
