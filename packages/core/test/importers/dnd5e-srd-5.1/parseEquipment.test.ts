/**
 * Equipment-parser unit tests for the D&D 5e SRD 5.1 importer.
 *
 * Equipment table excerpts in this file are reproduced from the System
 * Reference Document 5.1 by Wizards of the Coast LLC, available under the
 * Creative Commons Attribution 4.0 International License (CC-BY-4.0). Excerpts
 * are used as parser test input; no modification has been made beyond
 * reformatting to match the importer's extracted-line input shape.
 *
 * Fixture shape (loreweaver-3n6): these fixtures mirror how the vendored
 * SRD 5.1 PDF actually extracts — the Armor and Weapons tables arrive split
 * into a LEFT column-block (Name/Cost/AC or Name/Cost/Damage) and a RIGHT
 * column-block (Strength/Stealth/Weight or Weight/Properties), with descriptive
 * prose interleaved between them; the Tools table extracts row-major. See the
 * header comment in `parseEquipment.ts`.
 *
 * Adventuring Gear / Container Capacity / Equipment Packs / Mounts and Vehicles
 * (loreweaver-4zu): the Adventuring Gear table interleaves the LEFT column's
 * cost/weight values with the RIGHT column's complete rows after a bare name
 * run; the gear fixtures below reproduce that shape. Packs are prose bundles,
 * and Mounts and Vehicles is parsed from its own slice by
 * `parseMountsAndVehicles`.
 */

import { describe, expect, it } from 'vitest';
import {
  ContainerCapacityError,
  EquipmentColumnMismatchError,
  parseEquipment,
  parseMountsAndVehicles,
} from '../../../scripts/importers/dnd5e-srd-5.1/parseEquipment.js';
import type {
  EquipmentExtraction,
  PageText,
} from '../../../scripts/importers/dnd5e-srd-5.1/types.js';

function page(pageNumber: number, lines: string[]): PageText {
  return { pageNumber, lines };
}

function pageWithHeights(
  pageNumber: number,
  rows: readonly (readonly [string, number])[],
): PageText {
  return {
    pageNumber,
    lines: rows.map(([line]) => line),
    lineHeights: rows.map(([, height]) => height),
  };
}

function byName(
  items: readonly EquipmentExtraction[],
  name: string,
): EquipmentExtraction | undefined {
  return items.find((i) => i.name === name);
}

// ---------------------------------------------------------------------------
// A trimmed Equipment chapter holding all four tables in the real extracted
// layout: each of Armor and Weapons is a left column-block followed (after
// interleaved prose) by a right column-block; Tools is row-major. Descriptive
// section headings that duplicate the table sub-headers ("Heavy Armor") are
// included to prove they do not corrupt the parse.
// ---------------------------------------------------------------------------

const EQUIPMENT_PAGE = page(63, [
  // --- Armor: descriptive prose headings (duplicate the table sub-headers) ---
  'Light Armor',
  'Made from supple and thin materials, light armor favors agile adventurers.',
  'Heavy Armor',
  'Of all the armor categories, heavy armor offers the best protection.',
  // --- Armor: left column-block (Name Cost ArmorClass) ---
  'Armor',
  'Armor Cost Armor Class (AC)',
  'Light Armor',
  'Padded 5 gp 11 + Dex modifier',
  'Leather 10 gp 11 + Dex modifier',
  'Medium Armor',
  'Scale mail 50 gp 14 + Dex modifier (max 2)',
  'Heavy Armor',
  'Plate 1,500 gp 18',
  'Shield',
  'Shield 10 gp +2',
  // --- Armor: right column-block (Strength Stealth Weight), one row per left
  //     row, in the same order: Padded, Leather, Scale mail, Plate, Shield. ---
  'Strength Stealth Weight',
  '— Disadvantage 8 lb.',
  '— — 10 lb.',
  '— Disadvantage 45 lb.',
  'Str 15 Disadvantage 65 lb.',
  '— — 6 lb.',
  // --- Weapons: left column-block (Name Cost Damage) ---
  'Weapons',
  'Name Cost Damage Weight Properties',
  'Simple Melee Weapons',
  'Dagger 2 gp 1d4 piercing',
  'Mace 5 gp 1d6 bludgeoning',
  'Martial Melee Weapons',
  'Longsword 15 gp 1d8 slashing',
  'Martial Ranged Weapons',
  'Net 1 gp —',
  // --- Adventuring Gear heading + prose, then the weapons right column-block ---
  'Adventuring Gear',
  'This section describes items that have special rules.',
  'Acid. As an action, you can splash the contents of this vial.',
  '1 lb. Finesse, light, thrown (range 20/60)',
  '4 lb. —',
  '3 lb. Versatile (1d10)',
  '3 lb. Special, thrown (range 5/15)',
  'ranged attack against a creature or object, treating',
  // --- Tools: row-major ---
  'Tools',
  'Item Cost Weight',
  'Artisan’s tools',
  'Smith’s tools 20 gp 8 lb.',
  'Gaming set',
  'Dice set 1 sp —',
  'Thieves’ tools 25 gp 1 lb.',
  'Vehicles (land or water) * *',
  'Artisan’s Tools. These special tools include the items needed to pursue a craft.',
]);

describe('parseEquipment — full multi-table excerpt', () => {
  const items = parseEquipment([EQUIPMENT_PAGE]);

  it('extracts every armor, weapon, and tool entry and nothing more', () => {
    expect(items.map((i) => i.name)).toEqual([
      'Dagger',
      'Dice set',
      'Leather',
      'Longsword',
      'Mace',
      'Net',
      'Padded',
      'Plate',
      'Scale mail',
      'Shield',
      'Smith’s tools',
      'Thieves’ tools',
    ]);
  });

  it('does not promote table titles, sub-headers, column rows, or prose as entries', () => {
    const names = new Set(items.map((i) => i.name));
    for (const notAnItem of [
      'Armor',
      'Light Armor',
      'Heavy Armor',
      'Simple Melee Weapons',
      'Adventuring Gear',
      'Tools',
      'Artisan’s tools',
      'Gaming set',
      'Vehicles (land or water)',
    ]) {
      expect(names.has(notAnItem)).toBe(false);
    }
  });

  it('emits no gear from a fixture that has no Adventuring Gear table', () => {
    // This excerpt carries only the armor/weapons/tools tables (no gear name
    // run, packs, or container table), so the gear/pack collectors find nothing
    // even though the Adventuring Gear *heading* appears as a weapons-column
    // anchor. Gear reconstruction itself is covered by its own fixtures below.
    const categories = new Set(items.map((i) => i.category));
    expect(categories.has('gear')).toBe(false);
    expect(categories.has('pack')).toBe(false);
  });

  it('records the source page for every entry', () => {
    for (const item of items) {
      expect(item.sourcePage).toBe(63);
    }
  });
});

// ---------------------------------------------------------------------------
// Armor: weight class is derived from the AC cell, and the right column-block
// is zipped positionally onto the left rows for strength/stealth/weight.
// ---------------------------------------------------------------------------

describe('parseEquipment — armor', () => {
  const items = parseEquipment([EQUIPMENT_PAGE]);

  it('parses light armor (padded) with stealth disadvantage and weight', () => {
    expect(byName(items, 'Padded')).toMatchObject({
      name: 'Padded',
      category: 'armor',
      cost: '5 gp',
      ac: '11 + Dex modifier',
      armorType: 'light',
      stealthDisadvantage: true,
      weight: '8 lb.',
    });
    expect(byName(items, 'Padded')?.strengthRequirement).toBeUndefined();
  });

  it('parses light armor (leather) without strength or stealth penalty', () => {
    expect(byName(items, 'Leather')).toMatchObject({
      name: 'Leather',
      category: 'armor',
      cost: '10 gp',
      ac: '11 + Dex modifier',
      armorType: 'light',
      stealthDisadvantage: false,
      weight: '10 lb.',
    });
  });

  it('classifies medium armor (scale mail) from its capped Dex AC', () => {
    expect(byName(items, 'Scale mail')).toMatchObject({
      name: 'Scale mail',
      category: 'armor',
      ac: '14 + Dex modifier (max 2)',
      armorType: 'medium',
      stealthDisadvantage: true,
      weight: '45 lb.',
    });
  });

  it('parses heavy armor (plate) with a strength requirement', () => {
    expect(byName(items, 'Plate')).toMatchObject({
      name: 'Plate',
      category: 'armor',
      cost: '1,500 gp',
      ac: '18',
      armorType: 'heavy',
      stealthDisadvantage: true,
      strengthRequirement: 15,
      weight: '65 lb.',
    });
  });

  it('classifies a shield from its bonus AC', () => {
    expect(byName(items, 'Shield')).toMatchObject({
      name: 'Shield',
      category: 'armor',
      ac: '+2',
      armorType: 'shield',
      stealthDisadvantage: false,
      weight: '6 lb.',
    });
  });

  // Regression: the SRD prints "Light Armor"/"Heavy Armor" as body-prose section
  // headings interleaved with the table, so a sub-header-tracking parser would
  // misclassify rows that straddle the headings. The AC-cell classifier must be
  // immune — Leather here is preceded in document order by a "Heavy Armor"
  // descriptive heading but is still light armor.
  it('ignores duplicate prose section headings when classifying weight class', () => {
    expect(byName(items, 'Leather')?.armorType).toBe('light');
  });

  it('keeps armor description continuations on their original item across intervening table rows', () => {
    const armorPage = pageWithHeights(63, [
      ['Armor', 18],
      ['Armor Cost Armor Class (AC)', 8.88],
      ['Leather 10 gp 11 + Dex modifier', 8.88],
      ['Chain Shirt 50 gp 13 + Dex modifier (max 2)', 8.88],
      ['Strength Stealth Weight', 8.88],
      ['— — 10 lb.', 8.88],
      ['— — 20 lb.', 8.88],
      [
        'Chain Shirt. Made of interlocking metal rings, a chain shirt is worn between layers of clothing or',
        9.84,
      ],
      ['Armor Class', 8.88],
      [
        'leather. This armor offers modest protection to the wearer’s upper body and allows the sound of the',
        9.84,
      ],
      [
        'rings rubbing against one another to be muffled by outer layers.',
        9.84,
      ],
      [
        'Leather. The breastplate and shoulder protectors of this armor are made of leather that',
        9.84,
      ],
      [
        'has been stiffened by being boiled in oil. The rest of the armor is made of softer and more flexible materials.',
        9.84,
      ],
    ]);
    const parsed = parseEquipment([armorPage]);
    const chainShirt = byName(parsed, 'Chain Shirt')?.description;
    const leather = byName(parsed, 'Leather')?.description;

    expect(chainShirt).toContain('worn between layers of clothing or leather');
    expect(chainShirt).toContain('rings rubbing against one another');
    expect(chainShirt).not.toMatch(/\bor$/);
    expect(leather).toContain('The breastplate and shoulder protectors');
    expect(leather).not.toContain('worn between layers of clothing or leather');
  });
});

// ---------------------------------------------------------------------------
// Weapons: the right column-block (weight + properties) is zipped onto the left
// rows (name/cost/damage), including the dash-damage Net and dash-weight cells.
// ---------------------------------------------------------------------------

describe('parseEquipment — weapons', () => {
  const items = parseEquipment([EQUIPMENT_PAGE]);

  it('parses a simple weapon (dagger) with structured fields', () => {
    expect(byName(items, 'Dagger')).toMatchObject({
      name: 'Dagger',
      category: 'weapon',
      cost: '2 gp',
      damageDie: '1d4',
      damageType: 'piercing',
      weight: '1 lb.',
      properties: ['Finesse', 'light', 'thrown (range 20/60)'],
      weaponCategory: 'simple',
      weaponRange: 'melee',
    });
  });

  it('parses a martial weapon (longsword) with structured fields', () => {
    expect(byName(items, 'Longsword')).toMatchObject({
      name: 'Longsword',
      category: 'weapon',
      cost: '15 gp',
      damageDie: '1d8',
      damageType: 'slashing',
      weight: '3 lb.',
      properties: ['Versatile (1d10)'],
      weaponCategory: 'martial',
      weaponRange: 'melee',
    });
  });

  it('emits an empty property list when the right cell is a dash', () => {
    expect(byName(items, 'Mace')).toMatchObject({
      name: 'Mace',
      category: 'weapon',
      damageDie: '1d6',
      damageType: 'bludgeoning',
      weight: '4 lb.',
      properties: [],
      weaponCategory: 'simple',
      weaponRange: 'melee',
    });
  });

  // The Net is the only SRD weapon with a "—" damage cell; it must still parse
  // (no damage fields) and pick up its zipped weight/properties.
  it('parses a weapon whose damage cell is a dash (Net)', () => {
    const net = byName(items, 'Net');
    expect(net).toMatchObject({
      name: 'Net',
      category: 'weapon',
      cost: '1 gp',
      weight: '3 lb.',
      properties: ['Special', 'thrown (range 5/15)'],
      weaponCategory: 'martial',
      weaponRange: 'ranged',
    });
    expect(net?.damageDie).toBeUndefined();
    expect(net?.damageType).toBeUndefined();
  });

  it('does not attach armor fields to a weapon', () => {
    const dagger = byName(items, 'Dagger');
    expect(dagger?.ac).toBeUndefined();
    expect(dagger?.armorType).toBeUndefined();
  });

  // eshyra-erf5.3.1: every weapon row is tagged with its proficiency category
  // (simple/martial) and engagement range (melee/ranged) from the nearest
  // preceding Weapons-table sub-header, across all four groups.
  it('classifies every weapon by its nearest preceding simple/martial melee/ranged sub-header', () => {
    const page = pageWithHeights(63, [
      ['Weapons', 18],
      ['Simple Melee Weapons', 8.88],
      ['Club 1 sp 1d4 bludgeoning', 8.88],
      ['Simple Ranged Weapons', 8.88],
      ['Sling 1 sp 1d4 bludgeoning', 8.88],
      ['Martial Melee Weapons', 8.88],
      ['Battleaxe 10 gp 1d8 slashing', 8.88],
      ['Martial Ranged Weapons', 8.88],
      ['Longbow 50 gp 1d8 piercing', 8.88],
      ['Adventuring Gear', 18],
      ['1 lb. —', 8.88],
      ['— —', 8.88],
      ['4 lb. Heavy, two-handed', 8.88],
      ['2 lb. Ammunition (range 150/600), heavy, two-handed', 8.88],
    ]);
    const parsed = parseEquipment([page]);
    expect(byName(parsed, 'Club')).toMatchObject({
      weaponCategory: 'simple',
      weaponRange: 'melee',
    });
    expect(byName(parsed, 'Sling')).toMatchObject({
      weaponCategory: 'simple',
      weaponRange: 'ranged',
    });
    expect(byName(parsed, 'Battleaxe')).toMatchObject({
      weaponCategory: 'martial',
      weaponRange: 'melee',
    });
    expect(byName(parsed, 'Longbow')).toMatchObject({
      weaponCategory: 'martial',
      weaponRange: 'ranged',
    });
  });
});

// ---------------------------------------------------------------------------
// Tools: row-major; category sub-headers (no cost cell) are skipped.
// ---------------------------------------------------------------------------

describe('parseEquipment — tools', () => {
  const items = parseEquipment([EQUIPMENT_PAGE]);

  it('parses a tool row into name/cost/weight', () => {
    expect(byName(items, 'Smith’s tools')).toMatchObject({
      name: 'Smith’s tools',
      category: 'tool',
      cost: '20 gp',
      weight: '8 lb.',
    });
  });

  it('omits weight when the tool weight cell is a dash', () => {
    const dice = byName(items, 'Dice set');
    expect(dice).toMatchObject({
      name: 'Dice set',
      category: 'tool',
      cost: '1 sp',
    });
    expect(dice?.weight).toBeUndefined();
  });

  it('stops the tool table at the Vehicles row', () => {
    expect(byName(items, 'Vehicles (land or water)')).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Multi-page + empty input.
// ---------------------------------------------------------------------------

describe('parseEquipment — page boundaries and empty input', () => {
  it('assigns sourcePage from the page each row appears on', () => {
    const p1 = page(63, [
      'Weapons',
      'Name Cost Damage Weight Properties',
      'Simple Melee Weapons',
      'Dagger 2 gp 1d4 piercing',
      'Adventuring Gear',
      '1 lb. Finesse, light, thrown (range 20/60)',
    ]);
    const p2 = page(64, [
      'Armor',
      'Armor Cost Armor Class (AC)',
      'Leather 10 gp 11 + Dex modifier',
      'Strength Stealth Weight',
      '— — 10 lb.',
    ]);
    const items = parseEquipment([p1, p2]);
    expect(byName(items, 'Dagger')?.sourcePage).toBe(63);
    expect(byName(items, 'Leather')?.sourcePage).toBe(64);
  });

  it('returns an empty array for empty input', () => {
    expect(parseEquipment([])).toEqual([]);
  });

  it('returns an empty array when no equipment tables are present', () => {
    expect(
      parseEquipment([
        page(1, ['Currency', 'The most common coins are gold.']),
      ]),
    ).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Fail-closed: the split-column reconstruction zips left and right column-
// blocks positionally, which is only sound when both blocks pair one-to-one.
// A mismatch means the extraction drifted, so the parser throws rather than
// emit plausible-but-wrong records with guessed alignment.
// ---------------------------------------------------------------------------

describe('parseEquipment — column-block mismatch fails closed', () => {
  it('throws on an armor table missing a right-side row', () => {
    // Two left rows (Padded, Leather) but only one right row.
    const armorPage = page(63, [
      'Armor',
      'Armor Cost Armor Class (AC)',
      'Light Armor',
      'Padded 5 gp 11 + Dex modifier',
      'Leather 10 gp 11 + Dex modifier',
      'Strength Stealth Weight',
      '— Disadvantage 8 lb.',
    ]);
    expect(() => parseEquipment([armorPage])).toThrow(
      EquipmentColumnMismatchError,
    );
    expect(() => parseEquipment([armorPage])).toThrow(
      'Armor table column mismatch: left=2 right=1',
    );
  });

  it('throws on a weapon table missing a right-side row', () => {
    // Two left rows (Dagger, Mace) but only one right row.
    const weaponPage = page(66, [
      'Weapons',
      'Name Cost Damage Weight Properties',
      'Simple Melee Weapons',
      'Dagger 2 gp 1d4 piercing',
      'Mace 5 gp 1d6 bludgeoning',
      'Adventuring Gear',
      '1 lb. Finesse, light, thrown (range 20/60)',
    ]);
    expect(() => parseEquipment([weaponPage])).toThrow(
      EquipmentColumnMismatchError,
    );
    expect(() => parseEquipment([weaponPage])).toThrow(
      'Weapon table column mismatch: left=2 right=1',
    );
  });
});

// ---------------------------------------------------------------------------
// Adventuring Gear (loreweaver-4zu): a bare item-name run, then the LEFT
// column's "<cost> <weight>" values interleaved — line by line — with the RIGHT
// column's complete rows. Four reviewed category headers (here: Ammunition,
// Arcane focus) carry no value and are removed before the de-headered names are
// zipped with the values. The Container Capacity table that follows is attached
// as a verbatim `capacity` to the matching gear record.
// ---------------------------------------------------------------------------

const GEAR_PAGE = page(69, [
  'Adventuring Gear',
  'Acid. As an action, you can splash the contents of this vial onto a',
  'creature within 5 feet of you. On a hit, the target takes 2d6 acid damage.',
  'Hunting Trap. A creature that steps on the plate must succeed on a',
  'DC 13 Dexterity saving throw or take 1d4 piercing damage and stop moving.',
  'Item',
  'Abacus',
  'Acid (vial)',
  'Ammunition', // category header — no cost cell
  'Arrows (20)',
  'Arcane focus', // category header — no cost cell
  'Crystal',
  'Backpack',
  // Interleave region: the literal left column-header prefixes the first right
  // row; then each line is an optional left value + an optional right row.
  'Cost Weight Hourglass 25 gp 1 lb.',
  '2 gp 2 lb. Hunting trap 5 gp 25 lb.', // left=Abacus, right=Hunting trap
  '25 gp 1 lb. Ink (1 ounce bottle) 10 gp —', // left=Acid, right=Ink (dash wt)
  '1 gp 1 lb.', // left=Arrows (20)
  '10 gp 1 lb.', // left=Crystal
  '2 gp 5 lb.', // left=Backpack
  'Container Capacity',
  'Backpack* 1 cubic foot/30 pounds of gear',
  'Equipment Packs', // bounds the value region
]);

describe('parseEquipment — Adventuring Gear', () => {
  const items = parseEquipment([GEAR_PAGE]);
  const gear = items.filter((i) => i.category === 'gear');

  it('zips de-headered left names with their interleaved left values', () => {
    expect(byName(gear, 'Abacus')).toMatchObject({
      category: 'gear',
      cost: '2 gp',
      weight: '2 lb.',
    });
    expect(byName(gear, 'Acid (vial)')).toMatchObject({
      category: 'gear',
      cost: '25 gp',
      weight: '1 lb.',
    });
    // Sub-item under the "Arcane focus" header, value arrives several lines
    // after its name in the interleave.
    expect(byName(gear, 'Crystal')).toMatchObject({
      category: 'gear',
      cost: '10 gp',
      weight: '1 lb.',
    });
  });

  it('emits the right column-block rows as complete gear records', () => {
    expect(byName(gear, 'Hunting trap')).toMatchObject({
      category: 'gear',
      cost: '5 gp',
      weight: '25 lb.',
    });
    // Right row whose weight cell is a dash.
    const ink = byName(gear, 'Ink (1 ounce bottle)');
    expect(ink).toMatchObject({ category: 'gear', cost: '10 gp' });
    expect(ink?.weight).toBeUndefined();
  });

  it('does not promote category headers or the column header to records', () => {
    const names = new Set(gear.map((g) => g.name));
    expect(names.has('Ammunition')).toBe(false);
    expect(names.has('Arcane focus')).toBe(false);
    expect(names.has('Cost Weight')).toBe(false);
    expect(names.has('Container Capacity')).toBe(false);
  });

  it('attaches Container Capacity to the matching gear record', () => {
    expect(byName(gear, 'Backpack')).toMatchObject({
      category: 'gear',
      cost: '2 gp',
      weight: '5 lb.',
      capacity: '1 cubic foot/30 pounds of gear',
    });
  });

  it('attaches inline item mechanics to the owning equipment records', () => {
    expect(byName(gear, 'Acid (vial)')).toMatchObject({
      description:
        'Acid. As an action, you can splash the contents of this vial onto a creature within 5 feet of you. On a hit, the target takes 2d6 acid damage.',
      descriptionSourcePage: 69,
    });
    expect(byName(gear, 'Hunting trap')?.description).toContain(
      'DC 13 Dexterity saving throw',
    );
  });

  it('throws when names and values disagree in count (extraction drift)', () => {
    // Three de-headered names (Abacus, Acid, Arrows) but only two left values:
    // a dropped or merged value cell must fail closed, not silently misalign.
    const drifted = page(69, [
      'Item',
      'Abacus',
      'Acid (vial)',
      'Arrows (20)',
      'Cost Weight Hourglass 25 gp 1 lb.',
      '2 gp 2 lb.',
      '25 gp 1 lb.',
      'Equipment Packs',
    ]);
    expect(() => parseEquipment([drifted])).toThrow(
      EquipmentColumnMismatchError,
    );
    expect(() => parseEquipment([drifted])).toThrow(
      'Gear table column mismatch: left=3 right=2',
    );
  });

  it('throws when a Container Capacity row matches no gear item', () => {
    const orphanContainer = page(69, [
      'Item',
      'Abacus',
      '2 gp 2 lb.',
      'Container Capacity',
      'Portable hole 1 cubic foot/300 pounds of gear',
      'Equipment Packs',
    ]);
    expect(() => parseEquipment([orphanContainer])).toThrow(
      ContainerCapacityError,
    );
    expect(() => parseEquipment([orphanContainer])).toThrow('Portable hole');
  });
});

// ---------------------------------------------------------------------------
// Equipment Packs: prose bundles ("<Name> Pack (<cost>). Includes <contents>.")
// wrapped across lines; each becomes a category 'pack' record carrying the
// price as `cost` and the (re-flowed) contents sentence as `description`.
// ---------------------------------------------------------------------------

describe('parseEquipment — Equipment Packs', () => {
  const PACKS_PAGE = page(70, [
    'Equipment Packs',
    'The starting equipment you get from your class includes a',
    'collection of useful adventuring gear, put together in a pack.',
    'Burglar’s Pack (16 gp). Includes a backpack, a bag of 1,000',
    'ball bearings, and a waterskin. The pack also has 50 feet of',
    'hempen rope strapped to the side of it.',
    'Explorer’s Pack (10 gp). Includes a backpack, a bedroll, and',
    'a waterskin.',
    'Tools',
  ]);
  const packs = parseEquipment([PACKS_PAGE]).filter(
    (i) => i.category === 'pack',
  );

  it('emits one record per pack with the bundled price', () => {
    expect(packs.map((p) => p.name)).toEqual([
      'Burglar’s Pack',
      'Explorer’s Pack',
    ]);
    expect(byName(packs, 'Burglar’s Pack')?.cost).toBe('16 gp');
    expect(byName(packs, 'Explorer’s Pack')?.cost).toBe('10 gp');
  });

  it('joins wrapped continuation lines into the verbatim contents', () => {
    expect(byName(packs, 'Burglar’s Pack')?.description).toBe(
      'Includes a backpack, a bag of 1,000 ball bearings, and a waterskin. ' +
        'The pack also has 50 feet of hempen rope strapped to the side of it.',
    );
  });

  it('skips the introductory paragraph before the first pack', () => {
    for (const p of packs) {
      expect(p.description).not.toContain('The starting equipment');
    }
  });
});

// ---------------------------------------------------------------------------
// Mounts and Vehicles (loreweaver-4zu): parsed from its own slice. Three
// sub-tables map to per-table categories — mounts (cost/speed/capacity),
// tack/harness/drawn vehicles (cost/weight → gear), and waterborne vehicles
// (cost/speed → vehicle). The non-priced "Barding ×4 ×2" row is skipped and the
// "Saddle" sub-header's bare variants are qualified.
// ---------------------------------------------------------------------------

describe('parseMountsAndVehicles', () => {
  const MOUNTS_PAGE = page(71, [
    'Mounts and Vehicles',
    'A good mount can help you move more quickly.',
    'Mounts and Other Animals',
    'Carrying',
    'Item Cost Speed Capacity',
    'Camel 50 gp 50 ft. 480 lb.',
    'Elephant 200 gp 40 ft. 1,320 lb.',
    'Warhorse 400 gp 60 ft. 540 lb.',
    'Tack, Harness, and Drawn Vehicles',
    'Item Cost Weight',
    'Barding ×4 ×2',
    'Bit and bridle 2 gp 1 lb.',
    'Carriage 100 gp 600 lb.',
    'Saddle',
    'Military 20 gp 30 lb.',
    'Saddlebags 4 gp 8 lb.',
    'Stabling (per day) 5 sp —',
    'Waterborne Vehicles',
    'Item Cost Speed',
    'Galley 30,000 gp 4 mph',
    'Rowboat 50 gp 1½ mph',
  ]);
  const items = parseMountsAndVehicles([MOUNTS_PAGE]);

  it('parses mounts with cost, speed, and carrying capacity', () => {
    expect(byName(items, 'Camel')).toMatchObject({
      category: 'mount',
      cost: '50 gp',
      speed: '50 ft.',
      carryingCapacity: '480 lb.',
    });
    expect(byName(items, 'Elephant')?.carryingCapacity).toBe('1,320 lb.');
  });

  it('parses waterborne vehicles with cost and speed (mph)', () => {
    expect(byName(items, 'Galley')).toMatchObject({
      category: 'vehicle',
      cost: '30,000 gp',
      speed: '4 mph',
    });
    expect(byName(items, 'Rowboat')?.speed).toBe('1½ mph');
  });

  it('emits tack/harness/drawn vehicles as cost/weight gear', () => {
    expect(byName(items, 'Carriage')).toMatchObject({
      category: 'gear',
      cost: '100 gp',
      weight: '600 lb.',
    });
    expect(byName(items, 'Bit and bridle')?.category).toBe('gear');
    // Dash-weight tack row carries no weight.
    expect(byName(items, 'Stabling (per day)')?.weight).toBeUndefined();
  });

  it('qualifies Saddle sub-header variants and skips the Barding multiplier', () => {
    expect(byName(items, 'Saddle, Military')).toMatchObject({
      category: 'gear',
      cost: '20 gp',
      weight: '30 lb.',
    });
    // "Military" must not survive as a bare record name.
    expect(byName(items, 'Military')).toBeUndefined();
    // "Barding ×4 ×2" is a relative multiplier, not a priced line item.
    expect(byName(items, 'Barding')).toBeUndefined();
  });

  it('returns an empty array for empty input', () => {
    expect(parseMountsAndVehicles([])).toEqual([]);
  });
});
