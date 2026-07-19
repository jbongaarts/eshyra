import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { projectMagicItemActivatedEffects } from '../../../scripts/importers/dnd5e-srd-5.1/magicItemActivatedEffects.js';
import {
  deriveMagicItemChargeMechanics,
  EXPECTED_MAGIC_ITEM_CHARGE_ECONOMY_NAMES,
  MAGIC_ITEM_CHARGE_CLAUSE_EXPECTATIONS,
  projectMagicItemChargeEconomies,
} from '../../../scripts/importers/dnd5e-srd-5.1/magicItemChargeEconomies.js';
import { aggregateMagicItemFamilyProjections } from '../../../scripts/importers/dnd5e-srd-5.1/magicItemCompiler.js';
import type { MagicItemExtraction } from '../../../scripts/importers/dnd5e-srd-5.1/types.js';
import { validateMagicItemMechanics } from '../../../src/rules/magicItemMechanics.js';

interface PackRecord {
  readonly kind: string;
  readonly name: string;
  readonly data: { readonly description?: string };
}

const records = JSON.parse(
  readFileSync(
    'packages/core/data/rules-packs/rules__dnd5e-srd-5.1/records.json',
    'utf8',
  ),
) as PackRecord[];

const magicItems = records.filter(
  (record): record is PackRecord & { data: { description: string } } =>
    record.kind === 'magic-item' && typeof record.data.description === 'string',
);

function extraction(name: string, description: string): MagicItemExtraction {
  return {
    name,
    itemType: 'Wondrous item',
    rarity: 'rare',
    requiresAttunement: false,
    description,
    sourcePage: 1,
  };
}

describe('magic-item C1 charge economies', () => {
  it('pins the exact reviewed charge-profile membership', () => {
    const sourceProfile = new Set(
      magicItems
        .filter((item) => /\bcharges?\b/.test(item.data.description))
        .map((item) => item.name),
    );
    for (const reviewedException of [
      'Helm of Brilliance',
      'Necklace of Fireballs',
      'Robe of Stars',
      'Rod of Lordly Might',
      'Staff of Thunder and Lightning',
    ]) {
      sourceProfile.add(reviewedException);
    }

    expect(EXPECTED_MAGIC_ITEM_CHARGE_ECONOMY_NAMES.size).toBe(53);
    expect([...EXPECTED_MAGIC_ITEM_CHARGE_ECONOMY_NAMES].sort()).toEqual(
      [...sourceProfile].sort(),
    );
    expect([...MAGIC_ITEM_CHARGE_CLAUSE_EXPECTATIONS.keys()].sort()).toEqual(
      [...EXPECTED_MAGIC_ITEM_CHARGE_ECONOMY_NAMES].sort(),
    );
  });

  it('accepts every reviewed source record and produces referentially sound operations', () => {
    for (const name of EXPECTED_MAGIC_ITEM_CHARGE_ECONOMY_NAMES) {
      const record = magicItems.find((candidate) => candidate.name === name);
      expect(record, name).toBeDefined();
      const mechanics = deriveMagicItemChargeMechanics(
        extraction(name, record?.data.description ?? ''),
      );
      expect(mechanics, name).toBeDefined();
      const economyIds = new Set(Object.keys(mechanics?.economies ?? {}));
      const operationIds = new Set<string>();
      for (const operation of mechanics?.operations ?? []) {
        expect(operationIds.has(operation.id), `${name}:${operation.id}`).toBe(
          false,
        );
        operationIds.add(operation.id);
        for (const cost of operation.cost ?? []) {
          expect(economyIds.has(cost.economy), `${name}:${cost.economy}`).toBe(
            true,
          );
        }
        for (const economy of operation.doesNotExpend ?? []) {
          expect(economyIds.has(economy), `${name}:${economy}`).toBe(true);
        }
      }
    }
  });

  it('aggregates and schema-validates all 53 family projections', () => {
    for (const name of EXPECTED_MAGIC_ITEM_CHARGE_ECONOMY_NAMES) {
      const record = magicItems.find((candidate) => candidate.name === name);
      const projection = projectMagicItemChargeEconomies(
        extraction(name, record?.data.description ?? ''),
      );
      expect(projection, name).toBeDefined();
      const projections = projection === undefined ? [] : [projection];
      if (name === 'Staff of Thunder and Lightning') {
        const activated = projectMagicItemActivatedEffects(
          extraction(name, record?.data.description ?? ''),
        );
        if (activated !== undefined) projections.push(activated);
      }
      const aggregated = aggregateMagicItemFamilyProjections(projections);
      expect(aggregated.mechanics, name).toBeDefined();
      expect(() =>
        validateMagicItemMechanics(
          aggregated.mechanics,
          `magic-item:${name}.mechanics`,
          () => {},
        ),
      ).not.toThrow();
    }
  });

  it('models the shared-pool, independent-pool, and non-expenditure goldens', () => {
    const staff = magicItems.find((item) => item.name === 'Staff of Fire');
    const staffMechanics = deriveMagicItemChargeMechanics(
      extraction('Staff of Fire', staff?.data.description ?? ''),
    );
    expect(staffMechanics?.economies?.charges).toMatchObject({
      charges: { max: 10 },
      reset: [{ at: 'dawn', amount: '1d6+4' }],
    });
    expect(
      staffMechanics?.operations?.map((operation) => operation.cost),
    ).toEqual([
      [{ economy: 'charges', amount: 1 }],
      [{ economy: 'charges', amount: 3 }],
      [{ economy: 'charges', amount: 4 }],
    ]);

    const cube = magicItems.find((item) => item.name === 'Cube of Force');
    const cubeMechanics = deriveMagicItemChargeMechanics(
      extraction('Cube of Force', cube?.data.description ?? ''),
    );
    expect(
      cubeMechanics?.operations?.find(
        (operation) => operation.id === 'press-face-6',
      ),
    ).toEqual({ id: 'press-face-6', doesNotExpend: ['charges'] });

    const rod = magicItems.find((item) => item.name === 'Rod of Lordly Might');
    const rodMechanics = deriveMagicItemChargeMechanics(
      extraction('Rod of Lordly Might', rod?.data.description ?? ''),
    );
    expect(Object.keys(rodMechanics?.economies ?? {})).toEqual([
      'drain-life',
      'paralyze',
      'terrify',
    ]);

    const thunder = magicItems.find(
      (item) => item.name === 'Staff of Thunder and Lightning',
    );
    const thunderMechanics = deriveMagicItemChargeMechanics(
      extraction(
        'Staff of Thunder and Lightning',
        thunder?.data.description ?? '',
      ),
    );
    expect(
      thunderMechanics?.operations?.find(
        (operation) => operation.id === 'thunder-and-lightning',
      )?.doesNotExpend,
    ).toEqual(['lightning-strike', 'thunderclap']);
    expect(
      thunderMechanics?.operations?.find(
        (operation) => operation.id === 'thunder-and-lightning',
      ),
    ).toMatchObject({
      activation: { cost: 'action' },
      effects: ['c2-lightning-strike-payload', 'c2-thunderclap-payload'],
    });
  });

  it('models conditional last-charge outcomes with their regain formulas', () => {
    const power = magicItems.find((item) => item.name === 'Staff of Power');
    expect(
      deriveMagicItemChargeMechanics(
        extraction('Staff of Power', power?.data.description ?? ''),
      )?.economies?.charges.onDepleted,
    ).toEqual({
      roll: 'd20',
      losePropertyOn: 1,
      regainOn: 20,
      regainAmount: '1d8+2',
    });

    const magi = magicItems.find((item) => item.name === 'Staff of the Magi');
    expect(
      deriveMagicItemChargeMechanics(
        extraction('Staff of the Magi', magi?.data.description ?? ''),
      )?.economies?.charges.onDepleted,
    ).toEqual({ roll: 'd20', regainOn: 20, regainAmount: '1d12+1' });
  });

  it('returns the compiler-family projection with resolvable clause bindings', () => {
    const record = magicItems.find((item) => item.name === 'Staff of Fire');
    const projection = projectMagicItemChargeEconomies(
      extraction('Staff of Fire', record?.data.description ?? ''),
    );
    expect(projection?.family).toBe('c1-charge-economies');
    expect(projection?.clauses).toContainEqual({
      id: 'c1-economy-charges',
      tag: 'C1',
      representation: { block: 'economies', economyId: 'charges' },
      engineHooks: [{ engine: 'F5', hook: 'magic-item-usage-recharge' }],
    });
    expect(projection?.clauses).toContainEqual({
      id: 'c1-operation-cast-fireball',
      tag: 'C1',
      representation: {
        block: 'operations',
        operationId: 'cast-fireball',
      },
      engineHooks: [{ engine: 'F5', hook: 'magic-item-usage-recharge' }],
    });
  });

  it('excludes nearby C1 families owned by the parallel module', () => {
    for (const name of [
      'Necklace of Prayer Beads',
      'Wind Fan',
      'Winged Boots',
      'Wings of Flying',
    ]) {
      const record = magicItems.find((candidate) => candidate.name === name);
      expect(
        deriveMagicItemChargeMechanics(
          extraction(name, record?.data.description ?? ''),
        ),
      ).toBeUndefined();
    }
  });

  it('fails loudly when an exact source phrase drifts', () => {
    const record = magicItems.find((item) => item.name === 'Staff of Fire');
    expect(() =>
      deriveMagicItemChargeMechanics(
        extraction(
          'Staff of Fire',
          (record?.data.description ?? '').replace(
            'regains 1d6 + 4 expended charges daily at dawn',
            'regains some charges at dawn',
          ),
        ),
      ),
    ).toThrow(/expected source phrase/);
  });
});
