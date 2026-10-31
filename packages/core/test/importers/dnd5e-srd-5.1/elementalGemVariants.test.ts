/** eshyra-xt6m.1.1: per-instance gem variants pin their elemental mapping to the source table. */
import { describe, expect, it } from 'vitest';
import {
  assertElementalGemTypesMatchTable,
  ELEMENTAL_GEM_TYPES,
} from '../../../scripts/importers/dnd5e-srd-5.1/parseMagicItems.js';
import { getBundledDnd5eSrdPack } from '../../../src/internal.js';

type Obj = Record<string, unknown>;
const pack = getBundledDnd5eSrdPack();
const gem = pack.records.find(
  (record) => record.key === 'magic-item:elemental-gem',
);
const table = pack.records.find(
  (record) => record.key === 'table:elemental-gem',
);

describe('Elemental Gem variants trace to the printed table', () => {
  it('pins every variant, rarity, description, and single-creature grant', () => {
    expect(gem).toBeDefined();
    expect(table).toBeDefined();
    const data = gem?.data as Obj;
    const tableData = table?.data as { columns: string[]; rows: string[][] };
    expect(tableData.columns).toEqual(['Gem', 'Summoned Elemental']);
    assertElementalGemTypesMatchTable(tableData.rows, tableData.columns);
    const variants = data.variants as Obj[];
    expect(
      variants.map(({ id, name, rarity, text }) => ({
        id,
        name,
        rarity,
        text,
      })),
    ).toEqual(
      ELEMENTAL_GEM_TYPES.map(({ id, name, elemental }) => ({
        id,
        name,
        rarity: 'Uncommon',
        text: `Summoned elemental: ${elemental}.`,
      })),
    );
    const grants = ((data.mechanics as Obj).entityGrant as { grants: Obj[] })
      .grants;
    expect(
      grants.map(
        ({
          id,
          variants: ids,
          creatureRefs,
          tableRefs,
          count,
          duration,
          revertOn,
          cooldownEconomy,
          control,
        }) => ({
          id,
          variants: ids,
          creatureRefs,
          tableRefs,
          count,
          duration,
          revertOn,
          cooldownEconomy,
          control,
        }),
      ),
    ).toEqual(
      ELEMENTAL_GEM_TYPES.map(({ id, creature }) => ({
        id: `${id}-elemental`,
        variants: [id],
        creatureRefs: [`creature:${creature}`],
        tableRefs: ['table:elemental-gem'],
        count: 1,
        duration: { amount: 1, unit: 'hour' },
        revertOn: ['reduced-to-0-hit-points', 'one-hour-ended'],
        cooldownEconomy: 'quantity',
        control: 'as spell:conjure-elemental',
      })),
    );
  });

  it('fails closed if the mapping table drifts', () => {
    const rows = [
      ['Blue sapphire', 'Air elemental'],
      ['Yellow diamond', 'Earth elemental'],
      ['Red corundum', 'Fire elemental'],
      ['Emerald', 'Water elemental'],
    ];
    expect(() =>
      assertElementalGemTypesMatchTable(rows, ['Gem', 'Summoned Elemental']),
    ).not.toThrow();
    const emeraldRow = rows.at(-1);
    if (emeraldRow === undefined) throw new Error('missing Emerald row');
    emeraldRow[1] = 'Fire elemental';
    expect(() =>
      assertElementalGemTypesMatchTable(rows, ['Gem', 'Summoned Elemental']),
    ).toThrow(/no longer match table:elemental-gem/);
  });
});
