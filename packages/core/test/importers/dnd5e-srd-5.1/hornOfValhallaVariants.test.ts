/**
 * eshyra-olc5.14: the four Horn of Valhalla types are source-backed variants.
 * Each variant, its rarity, its printed count dice (as the grant's engine-rolled
 * `countRoll`) and its requirement text must trace to a row of
 * `table:horn-of-valhalla` and to the record's printed rarity line. A change to
 * the table text must fail here (and in the importer, which aborts the emit).
 */
import { describe, expect, it } from 'vitest';
import {
  assertHornOfValhallaTypesMatchTable,
  HORN_OF_VALHALLA_RARITY_LINE,
} from '../../../scripts/importers/dnd5e-srd-5.1/parseMagicItems.js';
import { getBundledDnd5eSrdPack } from '../../../src/internal.js';

type Obj = Record<string, unknown>;
const pack = getBundledDnd5eSrdPack();
const find = (key: string) => {
  const record = pack.records.find((r) => r.key === key);
  if (record === undefined) throw new Error(`missing ${key}`);
  return record.data as Obj;
};
const horn = find('magic-item:horn-of-valhalla');
const table = find('table:horn-of-valhalla') as {
  columns: string[];
  rows: string[][];
};

describe('Horn of Valhalla type variants trace to the printed table', () => {
  it('the printed rarity line is the pinned one', () => {
    expect(horn.rarity).toBe(HORN_OF_VALHALLA_RARITY_LINE);
  });

  it('has one variant per table row, in order, carrying the row verbatim', () => {
    const variants = horn.variants as Obj[];
    expect(table.columns).toEqual([
      'd100',
      'Horn Type',
      'Berserkers Summoned',
      'Requirement',
    ]);
    expect(variants).toHaveLength(table.rows.length);
    table.rows.forEach(([, type, count, requirement], index) => {
      const variant = variants[index] as Obj;
      expect(variant.name).toBe(type);
      expect(variant.id).toBe(String(type).toLowerCase());
      expect(variant.text).toBe(
        `Berserkers Summoned: ${count}. Requirement: ${requirement}.`,
      );
      // The rarity comes from the printed rarity line: "<rarity> (<metals>)".
      const printed = new RegExp(
        `(very rare|rare|legendary) \\([^)]*\\b${String(type).toLowerCase()}\\b`,
      ).exec(String(horn.rarity));
      expect(String(variant.rarity).toLowerCase()).toBe(printed?.[1]);
    });
  });

  it('each variant has exactly one grant whose countRoll is the row dice', () => {
    const grants = ((horn.mechanics as Obj).entityGrant as { grants: Obj[] })
      .grants;
    const variants = horn.variants as Obj[];
    expect(grants).toHaveLength(variants.length);
    table.rows.forEach(([, , count], index) => {
      const grant = grants[index] as Obj;
      expect(grant.variants).toEqual([(variants[index] as Obj).id]);
      expect(grant.countRoll).toBe(String(count).replace(/\s+/g, ''));
      expect(grant.count).toBeUndefined();
    });
  });

  it('the importer aborts if the table text drifts', () => {
    expect(() =>
      assertHornOfValhallaTypesMatchTable(table.rows, table.columns),
    ).not.toThrow();
    const drifted = table.rows.map((row) => [...row]);
    (drifted[1] as string[])[2] = '3d4 + 4';
    expect(() =>
      assertHornOfValhallaTypesMatchTable(drifted, table.columns),
    ).toThrow(/no longer match table:horn-of-valhalla/);
    const reworded = table.rows.map((row) => [...row]);
    (reworded[3] as string[])[3] = 'Proficiency with all weapons';
    expect(() =>
      assertHornOfValhallaTypesMatchTable(reworded, table.columns),
    ).toThrow(/no longer match/);
  });
});
