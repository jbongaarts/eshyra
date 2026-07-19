import { describe, expect, it } from 'vitest';
import type { Rng } from '../src/orchestrator/rng.js';
import { getBundledDnd5eSrdPack } from '../src/rules/bundledSrdPack.js';
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
  it('pins every bundled depletion declaration and all eleven source shapes', () => {
    const declarations = getBundledDnd5eSrdPack().records.flatMap((record) => {
      if (record.kind !== 'magic-item') return [];
      const mechanics = (record.data as Record<string, unknown>).mechanics as
        | {
            economies?: Record<string, { kind?: string; onDepleted?: unknown }>;
          }
        | undefined;
      return Object.entries(mechanics?.economies ?? {}).flatMap(
        ([economyId, economy]) =>
          economy.onDepleted === undefined
            ? []
            : [
                {
                  itemKey: record.key,
                  economyId,
                  kind: economy.kind,
                  declaration: economy.onDepleted,
                },
              ],
      );
    });
    expect(declarations).toHaveLength(74);
    const shapes = Object.fromEntries(
      Object.entries(
        Object.groupBy(declarations, ({ declaration }) =>
          JSON.stringify(declaration),
        ),
      ).map(([shape, entries]) => [shape, entries.length]),
    );
    expect(shapes).toEqual({
      '{"becomes":"destroyed"}': 33,
      '{"becomes":"inert"}': 6,
      '{"becomes":"nonmagical"}': 1,
      '{"loseProperty":false,"becomes":"destroyed"}': 1,
      '{"loseProperty":true,"becomes":"inert"}': 8,
      '{"loseProperty":true,"becomes":"nonmagical"}': 4,
      '{"loseProperty":true}': 2,
      '{"roll":"d20","destroyedOn":1,"becomes":"destroyed"}': 14,
      '{"roll":"d20","destroyedOn":1,"becomes":"nonmagical"}': 3,
      '{"roll":"d20","losePropertyOn":1,"regainOn":20,"regainAmount":"1d8+2"}': 1,
      '{"roll":"d20","regainOn":20,"regainAmount":"1d12+1"}': 1,
    });

    const singleUse = declarations.filter(({ kind }) => kind === 'single-use');
    expect(singleUse).toHaveLength(31);
    expect(
      singleUse
        .filter(
          ({ declaration }) =>
            (declaration as { becomes?: string }).becomes === 'nonmagical',
        )
        .map(({ itemKey }) => itemKey)
        .sort(),
    ).toEqual([
      'magic-item:ammunition-1-2-or-3',
      'magic-item:arrow-of-slaying',
    ]);
    expect(
      singleUse.filter(
        ({ declaration }) =>
          (declaration as { becomes?: string }).becomes === 'destroyed',
      ),
    ).toHaveLength(29);
    expect(
      declarations
        .filter(({ declaration }) => {
          const value = declaration as {
            loseProperty?: boolean;
            becomes?: unknown;
          };
          return value.loseProperty === true && value.becomes === undefined;
        })
        .map(({ itemKey, economyId }) => `${itemKey}/${economyId}`)
        .sort(),
    ).toEqual([
      'magic-item:luck-blade/charges',
      'magic-item:nine-lives-stealer/charges',
    ]);
  });

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

  it('applies risk-based nonmagical transformation only on its declared roll', () => {
    const declaration = {
      kind: 'charges',
      onDepleted: { roll: 'd20', destroyedOn: 1, becomes: 'nonmagical' },
    };
    expect(
      resolveItemDepletion('charges', declaration, sequenceRng(0)),
    ).toMatchObject({ becomes: 'nonmagical', rolls: [{ total: 1 }] });
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
