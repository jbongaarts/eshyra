import { describe, expect, it } from 'vitest';
import type { Rng } from '../src/orchestrator/rng.js';
import {
  ItemDepletionError,
  resolveItemDepletion,
} from '../src/state/itemDepletion.js';

function sequenceRng(...zeroBasedResults: number[]): Rng {
  let index = 0;
  return {
    nextInt(maxExclusive) {
      const value = zeroBasedResults[index++];
      if (value === undefined || value < 0 || value >= maxExclusive) {
        throw new Error(`invalid scripted RNG result for d${maxExclusive}`);
      }
      return value;
    },
  };
}

describe('resolveItemDepletion', () => {
  it('distinguishes destroyed, inert, and nonmagical source outcomes', () => {
    expect(
      resolveItemDepletion('use', {
        kind: 'single-use',
        onDepleted: { becomes: 'destroyed' },
      }),
    ).toMatchObject({ becomes: 'destroyed', loseProperty: false });
    expect(
      resolveItemDepletion('beans', {
        kind: 'doses',
        onDepleted: { becomes: 'inert', loseProperty: true },
      }),
    ).toMatchObject({ becomes: 'inert', loseProperty: true });
    expect(
      resolveItemDepletion('charges', {
        kind: 'charges',
        onDepleted: { becomes: 'nonmagical' },
      }),
    ).toMatchObject({ becomes: 'nonmagical', loseProperty: false });
  });

  it('applies a destruction threshold only on the declared roll', () => {
    const declaration = {
      kind: 'charges',
      onDepleted: { roll: 'd20', destroyedOn: 1, becomes: 'destroyed' },
    };
    expect(
      resolveItemDepletion('charges', declaration, sequenceRng(0)),
    ).toMatchObject({ becomes: 'destroyed', rolls: [{ total: 1 }] });
    expect(
      resolveItemDepletion('charges', declaration, sequenceRng(1)),
    ).toMatchObject({ rolls: [{ total: 2 }] });
    expect(
      resolveItemDepletion('charges', declaration, sequenceRng(1)),
    ).not.toHaveProperty('becomes');
  });

  it('resolves regain and loss rolls from the same deterministic sequence', () => {
    expect(
      resolveItemDepletion(
        'charges',
        {
          kind: 'charges',
          onDepleted: {
            roll: 'd20',
            losePropertyOn: 1,
            regainOn: 20,
            regainAmount: '1d8+2',
          },
        },
        sequenceRng(19, 4),
      ),
    ).toEqual({
      economyId: 'charges',
      rolls: [
        { purpose: 'depletion', notation: 'd20', rolls: [20], total: 20 },
        { purpose: 'regain', notation: '1d8+2', rolls: [5], total: 7 },
      ],
      regain: 7,
      loseProperty: false,
    });
  });

  it('fails closed instead of inventing a deterministic depletion roll', () => {
    expect(() =>
      resolveItemDepletion('charges', {
        kind: 'charges',
        onDepleted: { roll: 'd20', destroyedOn: 1, becomes: 'destroyed' },
      }),
    ).toThrow(ItemDepletionError);
  });
});
