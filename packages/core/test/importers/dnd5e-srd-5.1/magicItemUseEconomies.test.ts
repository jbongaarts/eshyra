import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  deriveMagicItemChargeMechanics,
  EXPECTED_MAGIC_ITEM_CHARGE_ECONOMY_NAMES,
} from '../../../scripts/importers/dnd5e-srd-5.1/magicItemChargeEconomies.js';
import {
  deriveMagicItemUseMechanics,
  EXPECTED_MAGIC_ITEM_USE_ECONOMY_NAMES,
  projectMagicItemUseEconomies,
  projectMagicItemUseVariantEconomies,
} from '../../../scripts/importers/dnd5e-srd-5.1/magicItemUseEconomies.js';
import type {
  MagicItemExtraction,
  MagicItemVariant,
} from '../../../scripts/importers/dnd5e-srd-5.1/types.js';
import { validateMagicItemMechanics } from '../../../src/rules/magicItemMechanics.js';
import type { RulesRecord } from '../../../src/rules/types.js';

const records = JSON.parse(
  readFileSync(
    join(
      process.cwd(),
      'packages/core/data/rules-packs/rules__dnd5e-srd-5.1/records.json',
    ),
    'utf8',
  ),
) as RulesRecord[];

const magicItems = records.filter((record) => record.kind === 'magic-item');

function extraction(record: RulesRecord): MagicItemExtraction {
  return {
    name: record.name,
    itemType: '',
    rarity: '',
    requiresAttunement: false,
    description: (record.data as { description: string }).description,
    sourcePage: 1,
  };
}

function named(name: string): MagicItemExtraction {
  const record = magicItems.find((candidate) => candidate.name === name);
  if (record === undefined) throw new Error(`missing fixture ${name}`);
  return extraction(record);
}

describe('magic-item C1 non-charge use economies', () => {
  it('pins the exact 52-item membership and excludes every charge-family record', () => {
    expect(EXPECTED_MAGIC_ITEM_USE_ECONOMY_NAMES.size).toBe(52);
    expect(EXPECTED_MAGIC_ITEM_CHARGE_ECONOMY_NAMES.size).toBe(53);
    expect(
      [...EXPECTED_MAGIC_ITEM_USE_ECONOMY_NAMES].filter((name) =>
        EXPECTED_MAGIC_ITEM_CHARGE_ECONOMY_NAMES.has(name),
      ),
    ).toEqual([]);
    expect(
      [...EXPECTED_MAGIC_ITEM_USE_ECONOMY_NAMES].filter(
        (name) => !magicItems.some((record) => record.name === name),
      ),
    ).toEqual([]);
  });

  it('source-binds and schema-validates every reviewed member', () => {
    for (const name of EXPECTED_MAGIC_ITEM_USE_ECONOMY_NAMES) {
      const projection =
        name === 'Crystal Ball'
          ? projectMagicItemUseVariantEconomies(
              name,
              (
                magicItems.find((record) => record.name === name)?.data as {
                  variants: readonly MagicItemVariant[];
                }
              )?.variants.find(
                (variant) => variant.name === 'Crystal Ball of Telepathy',
              ) as MagicItemVariant,
            )
          : projectMagicItemUseEconomies(named(name));
      expect(projection, name).toBeDefined();
      expect(projection?.family).toBe('C1-use-economies');
      expect(projection?.clauses).toHaveLength(1);
      expect(projection?.clauses[0]).toMatchObject({ tag: 'C1' });
      validateMagicItemMechanics(
        projection?.mechanics,
        `magic-item:${name}.mechanics`,
        () => {},
      );
    }
  });

  it('fails closed when a bound source phrase drifts', () => {
    const boots = named('Boots of Speed');
    expect(() =>
      projectMagicItemUseEconomies({
        ...boots,
        description: boots.description.replace(
          'used for a total of 10 minutes',
          'used for a while',
        ),
      }),
    ).toThrow(/expected source phrase "used for a total of 10 minutes"/);
  });

  it('scopes the Crystal Ball dawn economy to Telepathy only', () => {
    const variants = (
      magicItems.find((record) => record.name === 'Crystal Ball')?.data as {
        variants: readonly MagicItemVariant[];
      }
    )?.variants;
    expect(projectMagicItemUseEconomies(named('Crystal Ball'))).toBeUndefined();
    expect(
      variants.map((variant) =>
        projectMagicItemUseVariantEconomies('Crystal Ball', variant),
      ),
    ).toEqual([
      undefined,
      expect.objectContaining({
        mechanics: expect.objectContaining({
          economies: expect.objectContaining({
            uses: expect.objectContaining({ kind: 'per-day' }),
          }),
        }),
      }),
      undefined,
    ]);
  });

  it('models cumulative and conditional duration budgets exactly', () => {
    expect(deriveMagicItemUseMechanics(named('Boots of Speed'))).toEqual({
      economies: {
        speed: {
          kind: 'budget',
          budget: {
            total: { amount: 10, unit: 'minute' },
            increment: { amount: 1, unit: 'round' },
          },
          reset: [{ at: 'long-rest', amount: 'all' }],
        },
      },
      operations: [
        { id: 'maintain-speed', cost: [{ economy: 'speed', amount: 1 }] },
      ],
    });
    expect(
      deriveMagicItemUseMechanics(named('Winged Boots'))?.economies?.flight,
    ).toEqual({
      kind: 'budget',
      budget: {
        total: { amount: 4, unit: 'hour' },
        increment: { amount: 1, unit: 'minute' },
      },
      reset: [
        {
          at: 'per-period',
          period: { amount: 12, unit: 'hour' },
          amount: { amount: 2, unit: 'hour' },
          onlyIfUnused: true,
        },
      ],
    });
  });

  it('models the candle burn budget and mutually exclusive destructive gate use', () => {
    expect(deriveMagicItemUseMechanics(named('Candle of Invocation'))).toEqual({
      economies: {
        'burn-time': {
          kind: 'budget',
          budget: {
            total: { amount: 4, unit: 'hour' },
            increment: { amount: 1, unit: 'minute' },
          },
          onDepleted: { becomes: 'destroyed' },
        },
        'gate-use': {
          kind: 'single-use',
          onDepleted: { becomes: 'destroyed' },
          note: 'first-light alternative; mutually exclusive with continued burning',
        },
      },
      operations: [
        { id: 'burn', cost: [{ economy: 'burn-time', amount: 1 }] },
        {
          id: 'cast-gate',
          cost: [{ economy: 'gate-use', amount: 1 }],
          excludes: ['burn'],
        },
      ],
    });
  });

  it('keeps the three no-recharge charge pools in their owning family', () => {
    for (const name of [
      'Luck Blade',
      'Ring of Three Wishes',
      'Nine Lives Stealer',
    ]) {
      expect(projectMagicItemUseEconomies(named(name)), name).toBeUndefined();
      expect(EXPECTED_MAGIC_ITEM_CHARGE_ECONOMY_NAMES.has(name)).toBe(true);
    }
    expect(deriveMagicItemChargeMechanics(named('Luck Blade'))).toEqual({
      economies: {
        charges: {
          kind: 'charges',
          charges: { max: '1d4-1' },
          onDepleted: { loseProperty: true },
        },
      },
      operations: [
        { id: 'cast-wish', cost: [{ economy: 'charges', amount: 1 }] },
      ],
    });
    expect(
      deriveMagicItemChargeMechanics(named('Ring of Three Wishes'))?.economies
        ?.charges,
    ).toEqual({
      kind: 'charges',
      charges: { max: 3 },
      onDepleted: { becomes: 'nonmagical' },
    });
    expect(
      deriveMagicItemChargeMechanics(named('Nine Lives Stealer'))?.economies
        ?.charges,
    ).toEqual({
      kind: 'charges',
      charges: { max: '1d8+1' },
      onDepleted: { loseProperty: true },
    });
  });

  it('preserves rolled hour cooldowns as executable dice expressions', () => {
    expect(
      deriveMagicItemUseMechanics(named('Well of Many Worlds'))?.economies
        ?.cooldown,
    ).toMatchObject({
      kind: 'cooldown',
      cooldown: { duration: { amount: '1d8', unit: 'hour' } },
    });
    expect(
      deriveMagicItemUseMechanics(named('Wings of Flying'))?.economies
        ?.cooldown,
    ).toMatchObject({
      kind: 'cooldown',
      cooldown: { duration: { amount: '1d12', unit: 'hour' } },
    });
  });

  it('preserves the manuals study window, depletion, and century recharge', () => {
    for (const name of [
      'Manual of Bodily Health',
      'Manual of Gainful Exercise',
      'Manual of Quickness of Action',
      'Tome of Clear Thought',
      'Tome of Leadership and Influence',
      'Tome of Understanding',
    ]) {
      expect(
        deriveMagicItemUseMechanics(named(name))?.economies?.study,
        name,
      ).toEqual({
        kind: 'budget',
        budget: {
          total: { amount: 48, unit: 'hour' },
          increment: { amount: 1, unit: 'hour' },
        },
        reset: [{ at: 'days', days: 36500, amount: 'all' }],
        onDepleted: { loseProperty: true, becomes: 'inert' },
        note: 'complete within 6 days; magic returns one century after completion',
      });
    }
  });

  it('distinguishes a stateless potion from C1-owned single-use property depletion', () => {
    expect(
      projectMagicItemUseEconomies(named('Potion of Climbing')),
    ).toBeUndefined();
    expect(
      deriveMagicItemUseMechanics(named('Ammunition, +1, +2, or +3')),
    ).toEqual({
      economies: {
        use: {
          kind: 'single-use',
          onDepleted: { loseProperty: true, becomes: 'nonmagical' },
        },
      },
      operations: [{ id: 'hit-target', cost: [{ economy: 'use', amount: 1 }] }],
    });
  });
});
