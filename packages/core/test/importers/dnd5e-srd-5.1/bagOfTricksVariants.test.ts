/**
 * eshyra-olc5.16.1: the three Bag of Tricks cloth colors are source-backed
 * variants. Each variant's table of d8 creatures, and the one engine-rolled
 * grant per color (`creatureRoll` over that color's creature refs in table row
 * order), must trace to the printed tables `table:{gray,rust,tan}-bag-of-tricks`.
 * A change to a table row must fail here (and in the importer, which aborts the
 * emit).
 */
import { describe, expect, it } from 'vitest';
import {
  assertBagOfTricksTablesMatch,
  BAG_OF_TRICKS_TABLES,
} from '../../../scripts/importers/dnd5e-srd-5.1/parseMagicItems.js';
import { getBundledDnd5eSrdPack } from '../../../src/internal.js';

type Obj = Record<string, unknown>;
const pack = getBundledDnd5eSrdPack();
const find = (key: string) => {
  const record = pack.records.find((r) => r.key === key);
  if (record === undefined) throw new Error(`missing ${key}`);
  return record;
};
const bag = find('magic-item:bag-of-tricks').data as Obj;
const tableOf = (color: string) =>
  find(`table:${color}-bag-of-tricks`).data as {
    columns: string[];
    rows: (string | number)[][];
  };
const slug = (name: unknown) =>
  `creature:${String(name).toLowerCase().replace(/ /g, '-')}`;

describe('Bag of Tricks color variants trace to the printed tables', () => {
  it('has one variant per color table, in order, carrying every row verbatim', () => {
    const variants = bag.variants as Obj[];
    expect(variants.map((variant) => variant.id)).toEqual([
      'gray',
      'rust',
      'tan',
    ]);
    variants.forEach((variant, index) => {
      const color = String(variant.id);
      const table = tableOf(color);
      expect(table.columns).toEqual(['d8', 'Creature']);
      expect(table.rows.map(([roll]) => roll)).toEqual([
        1, 2, 3, 4, 5, 6, 7, 8,
      ]);
      expect(variant.name).toBe(BAG_OF_TRICKS_TABLES[index]?.name);
      expect(variant.rarity).toBe('Uncommon');
      expect(variant.text).toBe(
        `d8 creatures: ${table.rows.map(([roll, name]) => `${roll} ${name}`).join('; ')}.`,
      );
    });
  });

  it('each color has exactly one grant: variant-restricted, its own table only, creatures in d8 row order, rolled by the engine', () => {
    const grants = ((bag.mechanics as Obj).entityGrant as { grants: Obj[] })
      .grants;
    expect(grants).toHaveLength(3);
    for (const color of ['gray', 'rust', 'tan']) {
      const grant = grants.find((g) => g.id === `${color}-bag-creature`) as Obj;
      expect(grant.variants).toEqual([color]);
      expect(grant.tableRefs).toEqual([`table:${color}-bag-of-tricks`]);
      expect(grant.creatureRoll).toBe('1d8');
      expect(grant.count).toBe(1);
      expect(grant.countRoll).toBeUndefined();
      expect(grant.creatureRefs).toEqual(
        tableOf(color).rows.map(([, name]) => slug(name)),
      );
      // Every named creature exists as a creature record.
      for (const ref of grant.creatureRefs as string[])
        expect(
          pack.records.some((r) => r.key === ref),
          ref,
        ).toBe(true);
    }
  });

  it('the importer aborts if any color table drifts, or one is missing', () => {
    const tables = BAG_OF_TRICKS_TABLES.map(({ name, table }) => {
      const data = find(`table:${table}`).data as {
        columns: string[];
        rows: unknown[][];
      };
      return { name: `${name} Bag of Tricks`, ...data };
    });
    expect(() => assertBagOfTricksTablesMatch(tables)).not.toThrow();

    // A reworded row in any one of the three tables.
    for (let i = 0; i < tables.length; i++) {
      const drifted = tables.map((table, index) =>
        index === i
          ? {
              ...table,
              rows: table.rows.map((row, r) =>
                r === 4 ? [row[0], 'Dragon'] : row,
              ),
            }
          : table,
      );
      expect(() => assertBagOfTricksTablesMatch(drifted)).toThrow(
        /no longer match table:/,
      );
    }
    // Reordered rows (the d8 row selects the creature) and changed columns.
    const swapped = tables.map((table, index) =>
      index === 0
        ? {
            ...table,
            rows: [table.rows[1], table.rows[0], ...table.rows.slice(2)].map(
              (row, r) => [r + 1, row?.[1]],
            ),
          }
        : table,
    );
    expect(() => assertBagOfTricksTablesMatch(swapped)).toThrow(
      /no longer match/,
    );
    expect(() =>
      assertBagOfTricksTablesMatch(
        tables.map((table, index) =>
          index === 2 ? { ...table, columns: ['d6', 'Creature'] } : table,
        ),
      ),
    ).toThrow(/no longer match/);
    expect(() => assertBagOfTricksTablesMatch(tables.slice(0, 2))).toThrow(
      /table "tan-bag-of-tricks" is missing/,
    );
  });
});
