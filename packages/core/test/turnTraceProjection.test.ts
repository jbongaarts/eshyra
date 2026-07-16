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

  it('projects successful slot spends and rest mutations but excludes no-ops and failures', () => {
    const fields = deriveTraceFields(
      [
        {
          ...call('spend_spell_slot', {
            ok: true,
            data: {
              spent: true,
              spellRef: 'spell:fireball',
              selectedSlotLevel: 4,
              pool: 'spellcasting',
              upcast: {
                sourceBindings: [
                  {
                    clauseId: 'fireball:higher-slot',
                    sourcePage: 144,
                    sourcePhrase: 'source phrase',
                    operationIds: ['fireball:damage:dice-per-slot'],
                  },
                ],
                adjustments: [
                  {
                    kind: 'dice',
                    addedDice: '1d6',
                    sourceOperationId: 'fireball:damage:dice-per-slot',
                  },
                ],
              },
            },
          }),
          args: { spellRef: 'spell:fireball', slotLevel: 4 },
        },
        call('spend_spell_slot', {
          ok: true,
          data: { spent: false, spellRef: 'spell:fire-bolt', upcast: null },
        }),
        call('spend_spell_slot', {
          ok: false,
          code: 'spell_slot_error',
          message: 'no slot',
        }),
        call('complete_long_rest', {
          ok: true,
          data: { completed: true },
        }),
      ],
      [],
    );
    expect(fields.acceptedStateDelta).toEqual([
      expect.objectContaining({
        tool: 'spend_spell_slot',
        result: expect.objectContaining({
          spellRef: 'spell:fireball',
          selectedSlotLevel: 4,
        }),
      }),
      { amounts: { gp: 1 } },
    ]);
    expect(fields.rejectedCandidates).toHaveLength(1);
    expect(fields.rulesResolution).toMatchObject({
      spellScaling: [
        {
          sourceBindings: [
            {
              clauseId: 'fireball:higher-slot',
              sourcePage: 144,
              sourcePhrase: 'source phrase',
              operationIds: ['fireball:damage:dice-per-slot'],
            },
          ],
          adjustments: [
            {
              kind: 'dice',
              addedDice: '1d6',
              sourceOperationId: 'fireball:damage:dice-per-slot',
            },
          ],
        },
      ],
    });
  });
});
