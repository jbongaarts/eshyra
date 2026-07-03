/**
 * Unit tests for the document-wide table parser (eshyra-4a7.3).
 *
 * `parseDocumentTables` locates each reviewed table spec by typography — a
 * leaf-tier (h≈12) anchor heading plus the table's exact cell-tier (h≈8.9)
 * column-header line(s) — and reconstructs rows from the contiguous cell-tier
 * run. These tests build synthetic tiered fixtures shaped like the real
 * SRD 5.1 extraction (see the eshyra-4a7.1 tier map) and pin:
 *
 *   - one representative table per row rule (line-per-row, wrapped last
 *     column, the Barbarian wrapped-Features shape, wrapped d100 rows);
 *   - the disambiguation of the two same-caption "Draconic Ancestry" tables;
 *   - cross-page cell runs (Bag of Beans);
 *   - fail-closed behavior: row-count drift, header drift, prose sidebars at
 *     cell height, and uniform-font fixtures all yield NO table rather than a
 *     partial or wrong one.
 */

import { describe, expect, it } from 'vitest';
import {
  parseDocumentTables,
  SRD_5_1_DOCUMENT_TABLE_SPECS,
} from '../../../scripts/importers/dnd5e-srd-5.1/parseDocumentTables.js';
import type { PageText } from '../../../scripts/importers/dnd5e-srd-5.1/types.js';

const CHAPTER = 25.9;
const SUBSECTION = 13.9;
const LEAF = 12.0;
const CELL = 8.9;
const BODY = 9.8;
const SIDEBAR = 10.8;

function tieredPage(
  pageNumber: number,
  entries: readonly (readonly [line: string, height: number])[],
): PageText {
  return {
    pageNumber,
    lines: entries.map(([line]) => line),
    lineHeights: entries.map(([, height]) => height),
  };
}

function byName(pages: readonly PageText[]) {
  return new Map(parseDocumentTables(pages).map((t) => [t.name, t]));
}

// ---------------------------------------------------------------------------
// line-per-row + same-caption disambiguation: the two Draconic Ancestry tables
// ---------------------------------------------------------------------------

const DRACONIC_ROWS: readonly (readonly [string, string, string])[] = [
  ['Black', 'Acid', '5 by 30 ft. line (Dex. save)'],
  ['Blue', 'Lightning', '5 by 30 ft. line (Dex. save)'],
  ['Brass', 'Fire', '5 by 30 ft. line (Dex. save)'],
  ['Bronze', 'Lightning', '5 by 30 ft. line (Dex. save)'],
  ['Copper', 'Acid', '5 by 30 ft. line (Dex. save)'],
  ['Gold', 'Fire', '15 ft. cone (Dex. save)'],
  ['Green', 'Poison', '15 ft. cone (Con. save)'],
  ['Red', 'Fire', '15 ft. cone (Dex. save)'],
  ['Silver', 'Cold', '15 ft. cone (Con. save)'],
  ['White', 'Cold', '15 ft. cone (Con. save)'],
];

function draconicRacesPage(): PageText {
  return tieredPage(5, [
    ['Speed. Your base walking speed is 30 feet.', BODY],
    ['Draconic Ancestry', LEAF],
    ['Dragon Damage Type Breath Weapon', CELL],
    ...DRACONIC_ROWS.map((row): readonly [string, number] => [
      row.join(' '),
      CELL,
    ]),
    ['Draconic Ancestry. You have draconic ancestry.', BODY],
  ]);
}

function draconicSorcererPage(): PageText {
  return tieredPage(44, [
    ['dragon is used by features you gain later.', BODY],
    ['Draconic Ancestry', LEAF],
    ['Dragon Damage Type', CELL],
    ...DRACONIC_ROWS.map((row): readonly [string, number] => [
      `${row[0]} ${row[1]}`,
      CELL,
    ]),
    ['Dragon Wings', LEAF],
  ]);
}

describe('parseDocumentTables — Draconic Ancestry (line-per-row, shared caption)', () => {
  it('reconstructs the 3-column Races table with row order and verbatim cells', () => {
    const tables = byName([draconicRacesPage()]);
    const table = tables.get('Draconic Ancestry');
    expect(table).toBeDefined();
    expect(table?.columns).toEqual(['Dragon', 'Damage Type', 'Breath Weapon']);
    expect(table?.rows).toEqual(DRACONIC_ROWS.map((row) => [...row]));
    expect(table?.sourcePage).toBe(5);
  });

  it('disambiguates the Sorcerer copy by its 2-column header line', () => {
    const tables = byName([draconicRacesPage(), draconicSorcererPage()]);
    expect(tables.get('Draconic Ancestry')?.sourcePage).toBe(5);
    const bloodline = tables.get('Draconic Bloodline Draconic Ancestry');
    expect(bloodline).toBeDefined();
    expect(bloodline?.columns).toEqual(['Dragon', 'Damage Type']);
    expect(bloodline?.rows).toEqual(
      DRACONIC_ROWS.map((row) => [row[0], row[1]]),
    );
    expect(bloodline?.sourcePage).toBe(44);
  });

  it('emits neither table when a fixture renders uniform font heights', () => {
    const uniform = tieredPage(5, [
      ['Draconic Ancestry', BODY],
      ['Dragon Damage Type Breath Weapon', BODY],
      ...DRACONIC_ROWS.map((row): readonly [string, number] => [
        row.join(' '),
        BODY,
      ]),
    ]);
    expect(parseDocumentTables([uniform])).toEqual([]);
  });

  it('fails the table closed when a row goes missing (count drift)', () => {
    const short = tieredPage(5, [
      ['Draconic Ancestry', LEAF],
      ['Dragon Damage Type Breath Weapon', CELL],
      ...DRACONIC_ROWS.slice(0, 9).map((row): readonly [string, number] => [
        row.join(' '),
        CELL,
      ]),
      ['Draconic Ancestry. You have draconic ancestry.', BODY],
    ]);
    expect(byName([short]).get('Draconic Ancestry')).toBeUndefined();
  });

  it('fails the table closed when the header line drifts', () => {
    const drifted = tieredPage(5, [
      ['Draconic Ancestry', LEAF],
      ['Dragon Damage Kind Breath Weapon', CELL],
      ...DRACONIC_ROWS.map((row): readonly [string, number] => [
        row.join(' '),
        CELL,
      ]),
    ]);
    expect(byName([drifted]).get('Draconic Ancestry')).toBeUndefined();
  });
});

describe('parseDocumentTables — Half-Dragon Template tables', () => {
  const pages = [
    tieredPage(320, [
      ['Half-Dragon Template', SUBSECTION],
      ['A beast, humanoid, giant, or monstrosity can become', BODY],
      ['a half-dragon. It keeps its statistics, except as follows.', BODY],
      ['Color Damage Resistance', CELL],
      ['Black or copper Acid', CELL],
      ['Blue or bronze Lightning', CELL],
    ]),
    tieredPage(321, [
      ['Brass, gold, or red Fire', CELL],
      ['Green Poison', CELL],
      ['Silver or white Cold', CELL],
      ['Languages. The half-dragon speaks Draconic in', BODY],
      ['addition to any other languages it knows.', BODY],
      ['Optional', CELL],
      ['Size Breath Weapon Prerequisite', CELL],
      ['Large or As a wyrmling Challenge 2 or higher', CELL],
      ['smaller', CELL],
      ['Huge As a young dragon Challenge 7 or higher', CELL],
      ['Gargantuan As an adult dragon Challenge 8 or higher', CELL],
      ['Half-Red Dragon Veteran', LEAF],
    ]),
  ];

  it('reconstructs the cross-page color and damage-resistance rows', () => {
    expect(byName(pages).get('Half-Dragon Damage Resistance')).toMatchObject({
      columns: ['Color', 'Damage Resistance'],
      rows: [
        ['Black or copper', 'Acid'],
        ['Blue or bronze', 'Lightning'],
        ['Brass, gold, or red', 'Fire'],
        ['Green', 'Poison'],
        ['Silver or white', 'Cold'],
      ],
      sourcePage: 320,
      ownerRecordKey: 'rule:half-dragon-template',
    });
  });

  it('reconstructs the wrapped Large-or-smaller breath-weapon row', () => {
    expect(byName(pages).get('Half-Dragon Breath Weapon')).toMatchObject({
      columns: ['Size', 'Breath Weapon', 'Prerequisite'],
      rows: [
        ['Large or smaller', 'As a wyrmling', 'Challenge 2 or higher'],
        ['Huge', 'As a young dragon', 'Challenge 7 or higher'],
        ['Gargantuan', 'As an adult dragon', 'Challenge 8 or higher'],
      ],
      sourcePage: 321,
      ownerRecordKey: 'rule:half-dragon-template',
    });
  });
});

// ---------------------------------------------------------------------------
// wrapped last column: subclass spell tables (Oath of Devotion + a circle)
// ---------------------------------------------------------------------------

describe('parseDocumentTables — level/spells tables (wrapped last column)', () => {
  it('reconstructs Oath of Devotion Spells behind its two header lines', () => {
    const page = tieredPage(33, [
      ['You gain oath spells at the paladin levels listed.', BODY],
      ['Oath of Devotion Spells', LEAF],
      ['Paladin', CELL],
      ['Level Spells', CELL],
      ['3rd protection from evil and good, sanctuary', CELL],
      ['5th lesser restoration, zone of truth', CELL],
      ['9th beacon of hope, dispel magic', CELL],
      ['13th freedom of movement, guardian of faith', CELL],
      ['17th commune, flame strike', CELL],
      ['Channel Divinity', LEAF],
    ]);
    const table = byName([page]).get('Oath of Devotion Spells');
    expect(table).toBeDefined();
    expect(table?.columns).toEqual(['Paladin Level', 'Spells']);
    expect(table?.rows).toEqual([
      ['3rd', 'protection from evil and good, sanctuary'],
      ['5th', 'lesser restoration, zone of truth'],
      ['9th', 'beacon of hope, dispel magic'],
      ['13th', 'freedom of movement, guardian of faith'],
      ['17th', 'commune, flame strike'],
    ]);
  });

  it('re-joins a wrapped spells cell (the Desert circle "protection from / energy" wrap)', () => {
    const page = tieredPage(22, [
      ['Desert', LEAF],
      ['Druid Level Circle Spells', CELL],
      ['3rd blur, silence', CELL],
      ['5th create food and water, protection from', CELL],
      ['energy', CELL],
      ['7th blight, hallucinatory terrain', CELL],
      ['9th insect plague, wall of stone', CELL],
      ['Forest', LEAF],
    ]);
    const table = byName([page]).get('Circle of the Land (Desert)');
    expect(table).toBeDefined();
    expect(table?.rows).toEqual([
      ['3rd', 'blur, silence'],
      ['5th', 'create food and water, protection from energy'],
      ['7th', 'blight, hallucinatory terrain'],
      ['9th', 'insect plague, wall of stone'],
    ]);
  });
});

// ---------------------------------------------------------------------------
// The Barbarian progression: wrapped Features column
// ---------------------------------------------------------------------------

describe('parseDocumentTables — The Barbarian (wrapped Features column)', () => {
  it('re-joins wrapped Features cells and keeps the Unlimited rages cell verbatim', () => {
    const rows: (readonly [string, number])[] = [
      ['1st +2 Rage, 2 +2', CELL],
      ['Unarmored', CELL],
      ['Defense', CELL],
      ['2nd +2 Reckless 2 +2', CELL],
      ['Attack,', CELL],
      ['Danger Sense', CELL],
      ['3rd +2 Primal Path 3 +2', CELL],
      ['4th +2 Ability Score 3 +2', CELL],
      ['Improvement', CELL],
      ['5th +3 Extra Attack, 3 +2', CELL],
      ['Fast', CELL],
      ['Movement', CELL],
      ['6th +3 Path feature 4 +2', CELL],
      ['7th +3 Feral Instinct 4 +2', CELL],
      ['8th +3 Ability Score 4 +2', CELL],
      ['Improvement', CELL],
      ['9th +4 Brutal Critical 4 +3', CELL],
      ['(1 die)', CELL],
      ['10th +4 Path feature 4 +3', CELL],
      ['11th +4 Relentless 4 +3', CELL],
      ['Rage', CELL],
      ['12th +4 Ability Score 5 +3', CELL],
      ['Improvement', CELL],
      ['13th +5 Brutal Critical 5 +3', CELL],
      ['(2 dice)', CELL],
      ['14th +5 Path feature 5 +3', CELL],
      ['15th +5 Persistent 5 +3', CELL],
      ['Rage', CELL],
      ['16th +5 Ability Score 5 +4', CELL],
      ['Improvement', CELL],
      ['17th +6 Brutal Critical 6 +4', CELL],
      ['(3 dice)', CELL],
      ['18th +6 Indomitable 6 +4', CELL],
      ['Might', CELL],
      ['19th +6 Ability Score 6 +4', CELL],
      ['Improvement', CELL],
      ['20th +6 Primal Unlimited +4', CELL],
      ['Champion', CELL],
    ];
    const page = tieredPage(8, [
      ['The Barbarian', LEAF],
      ['Proficiency Rage', CELL],
      ['Level Bonus Features Rages Damage', CELL],
      ...rows,
      ['Rage', 13.9],
      ['In battle, you fight with primal ferocity.', BODY],
    ]);
    const table = byName([page]).get('The Barbarian');
    expect(table).toBeDefined();
    expect(table?.columns).toEqual([
      'Level',
      'Proficiency Bonus',
      'Features',
      'Rages',
      'Rage Damage',
    ]);
    expect(table?.rows).toHaveLength(20);
    expect(table?.rows[0]).toEqual([
      '1st',
      '+2',
      'Rage, Unarmored Defense',
      '2',
      '+2',
    ]);
    expect(table?.rows[4]).toEqual([
      '5th',
      '+3',
      'Extra Attack, Fast Movement',
      '3',
      '+2',
    ]);
    expect(table?.rows[19]).toEqual([
      '20th',
      '+6',
      'Primal Champion',
      'Unlimited',
      '+4',
    ]);
  });
});

// ---------------------------------------------------------------------------
// class-progression-reconstruction: pinned source blocks past interleaved prose
// ---------------------------------------------------------------------------

describe('parseDocumentTables — class-progression-reconstruction (eshyra-4a7.6)', () => {
  // A miniature stand-in for a sheared class table: a leaf caption, then the
  // proficiency/Equipment prose (with an Equipment LEAF heading) the SRD flows
  // around the table, then the pinned cell-tier data block further down.
  function shearedClassPage(): PageText {
    return tieredPage(15, [
      ['Class Features', SIDEBAR],
      ['The Tester', LEAF],
      ['Proficiency Cantrips', CELL], // a stray header fragment near the caption
      ['Weapons: Simple weapons', BODY],
      ['Equipment', LEAF], // a leaf heading between caption and data block
      ['• A spellbook', BODY],
      ['Spell Slots per Spell Level', CELL], // data block starts here
      ['1st 2nd 3rd', CELL],
      ['1st +2 Spellcasting', CELL],
      ['2nd +2 Subclass', CELL],
      ['3 2', CELL],
      ['3 3', CELL],
      ['Spellcasting', SUBSECTION], // h≈13.9 ends the data block
      ['You can cast spells.', BODY],
    ]);
  }

  const TESTER_SPEC = {
    name: 'The Tester',
    columns: [
      'Level',
      'Proficiency Bonus',
      'Features',
      'Cantrips Known',
      '1st',
    ],
    anchorHeading: 'The Tester',
    anchor: 'caption',
    headerLines: [],
    rows: {
      kind: 'class-progression-reconstruction',
      sourceBlocks: [
        [
          'Spell Slots per Spell Level',
          '1st 2nd 3rd',
          '1st +2 Spellcasting',
          '2nd +2 Subclass',
          '3 2',
          '3 3',
        ],
      ],
      rows: [
        ['1st', '+2', 'Spellcasting', '3', '2'],
        ['2nd', '+2', 'Subclass', '3', '3'],
      ],
    },
    expectedRows: 2,
  } as const;

  it('locates the pinned data block past the Equipment heading and prose', () => {
    const tables = parseDocumentTables([shearedClassPage()], [TESTER_SPEC]);
    expect(tables).toHaveLength(1);
    expect(tables[0]).toMatchObject({
      name: 'The Tester',
      columns: [
        'Level',
        'Proficiency Bonus',
        'Features',
        'Cantrips Known',
        '1st',
      ],
      rows: [
        ['1st', '+2', 'Spellcasting', '3', '2'],
        ['2nd', '+2', 'Subclass', '3', '3'],
      ],
      sourcePage: 15,
    });
  });

  it('fails closed when a pinned source line drifts', () => {
    const drifted = tieredPage(15, [
      ['The Tester', LEAF],
      ['Spell Slots per Spell Level', CELL],
      ['1st 2nd 3rd', CELL],
      ['1st +2 Spellcasting', CELL],
      ['2nd +2 Subclass feature', CELL], // drifted (extra word)
      ['3 2', CELL],
      ['3 3', CELL],
    ]);
    expect(parseDocumentTables([drifted], [TESTER_SPEC])).toEqual([]);
  });

  it('does not cross a chapter heading to claim a later class block', () => {
    // The data block lives AFTER the next chapter heading, so the bounded
    // search must not reach it.
    const crossed = tieredPage(15, [
      ['The Tester', LEAF],
      ['Wizard', CHAPTER], // next class chapter
      ['Spell Slots per Spell Level', CELL],
      ['1st 2nd 3rd', CELL],
      ['1st +2 Spellcasting', CELL],
      ['2nd +2 Subclass', CELL],
      ['3 2', CELL],
      ['3 3', CELL],
    ]);
    expect(parseDocumentTables([crossed], [TESTER_SPEC])).toEqual([]);
  });

  it('locates two ordered blocks (Sorcerer-style split)', () => {
    const twoBlock = {
      ...TESTER_SPEC,
      rows: {
        kind: 'class-progression-reconstruction',
        sourceBlocks: [
          ['Proficiency Sorcery', '1st +2 Spellcasting'],
          ['Spells', '4 2'],
        ],
        rows: [['1st', '+2', 'Spellcasting', '4', '2']],
      },
      expectedRows: 1,
    } as const;
    const page = tieredPage(42, [
      ['The Tester', LEAF],
      ['Proficiency Sorcery', CELL],
      ['1st +2 Spellcasting', CELL],
      ['Weapons: Daggers', BODY], // prose between the two blocks
      ['Spells', CELL],
      ['4 2', CELL],
    ]);
    const tables = parseDocumentTables([page], [twoBlock]);
    expect(tables).toHaveLength(1);
    expect(tables[0].rows).toEqual([['1st', '+2', 'Spellcasting', '4', '2']]);
    expect(tables[0].sourcePage).toBe(42);
  });
});

// ---------------------------------------------------------------------------
// spell-embedded tables: exact source rows and synthesized owner-qualified names
// ---------------------------------------------------------------------------

describe('parseDocumentTables — spell-embedded tables (eshyra-o4j7)', () => {
  const pages = [
    tieredPage(116, [
      ['Animate Objects', LEAF],
      ['Objects come to life at your command.', BODY],
      ['Animated Object Statistics', LEAF],
      ['Size HP AC Attack Str Dex', CELL],
      ['Tiny 20 18 +8 to hit, 1d4 + 4 damage 4 18', CELL],
      ['Small 25 16 +6 to hit, 1d8 + 2 damage 6 14', CELL],
      ['Medium 40 13 +5 to hit, 2d6 + 1 damage 10 12', CELL],
      ['Large 50 10 +6 to hit, 2d10 + 2 14 10', CELL],
      ['damage', CELL],
      ['Huge 80 10 +8 to hit, 2d12 + 4 18 6', CELL],
      ['damage', CELL],
      ['An animated object is a construct.', BODY],
    ]),
    tieredPage(127, [
      ['Confusion', LEAF],
      ['An affected target must roll a d10.', BODY],
      ['d10 Behavior', CELL],
      ['1 The creature uses all its movement to move in a', CELL],
      ['random direction. To determine the direction, roll', CELL],
      ['a d8 and assign a direction to each die face. The', CELL],
      ['creature doesn’t take an action this turn.', CELL],
      ['2–6 The creature doesn’t move or take actions this', CELL],
      ['turn.', CELL],
      ['7–8 The creature uses its action to make a melee', CELL],
      ['attack against a randomly determined creature', CELL],
      ['within its reach. If there is no creature within its', CELL],
      ['reach, the creature does nothing this turn.', CELL],
      ['9–10 The creature can act and move normally.', CELL],
      ['At the end of each of its turns, it can save.', BODY],
    ]),
    tieredPage(131, [
      ['Control Weather', LEAF],
      ['Change the current weather conditions.', BODY],
      ['Precipitation', LEAF],
      ['Stage Condition', CELL],
      ['1 Clear', CELL],
      ['2 Light clouds', CELL],
      ['3 Overcast or ground fog', CELL],
      ['4 Rain, hail, or snow', CELL],
      ['5 Torrential rain, driving hail, or blizzard', CELL],
      ['Temperature', LEAF],
      ['Stage Condition', CELL],
      ['1 Unbearable heat', CELL],
      ['2 Hot', CELL],
      ['3 Warm', CELL],
      ['4 Cool', CELL],
      ['5 Cold', CELL],
      ['6 Arctic cold', CELL],
      ['Wind', LEAF],
      ['Stage Condition', CELL],
      ['1 Calm', CELL],
      ['2 Moderate wind', CELL],
      ['3 Strong wind', CELL],
      ['4 Gale', CELL],
      ['5 Storm', CELL],
    ]),
    tieredPage(132, [
      ['Creation', LEAF],
      ['The duration depends on the object’s material.', BODY],
      ['Material Duration', CELL],
      ['Vegetable matter 1 day', CELL],
      ['Stone or crystal 12 hours', CELL],
      ['Precious metals 1 hour', CELL],
      ['Gems 10 minutes', CELL],
      ['Adamantine or mithral 1 minute', CELL],
      ['Using the material as a spell component causes failure.', BODY],
    ]),
    tieredPage(174, [
      ['Reincarnate', LEAF],
      ['The GM rolls a d100 and consults the table.', BODY],
      ['d100 Race', CELL],
      ['01–04 Dragonborn', CELL],
      ['05–13 Dwarf, hill', CELL],
      ['14–21 Dwarf, mountain', CELL],
      ['22–25 Elf, dark', CELL],
      ['26–34 Elf, high', CELL],
      ['35–42 Elf, wood', CELL],
      ['43–46 Gnome, forest', CELL],
      ['47–52 Gnome, rock', CELL],
      ['53–56 Half-elf', CELL],
      ['57–60 Half-orc', CELL],
      ['61–68 Halfling, lightfoot', CELL],
      ['69–76 Halfling, stout', CELL],
      ['77–96 Human', CELL],
      ['97–00 Tiefling', CELL],
    ]),
    tieredPage(176, [
      ['Scrying', LEAF],
      ['The saving throw is modified by your knowledge.', BODY],
      ['Knowledge Save Modifier', CELL],
      ['Secondhand (you have heard of the target) +5', CELL],
      ['Firsthand (you have met the target) +0', CELL],
      ['Familiar (you know the target well) −5', CELL],
      ['Connection Save Modifier', CELL],
      ['Likeness or picture −2', CELL],
      ['Possession or garment −4', CELL],
      ['Body part, lock of hair, bit of nail, or the like −10', CELL],
    ]),
    tieredPage(185, [
      ['Teleport', LEAF],
      ['Your familiarity determines whether you arrive.', BODY],
    ]),
    tieredPage(186, [
      ['Similar Off On', CELL],
      ['Familiarity Mishap Area Target Target', CELL],
      ['Permanent — — — 01–100', CELL],
      ['circle', CELL],
      ['Associated — — — 01–100', CELL],
      ['object', CELL],
      ['Very familiar 01–05 06–13 14–24 25–100', CELL],
      ['Seen casually 01–33 34–43 44–53 54–100', CELL],
      ['Viewed once 01–43 44–53 54–73 74–100', CELL],
      ['Description 01–43 44–53 54–73 74–100', CELL],
      ['False 01–50 51–100 — —', CELL],
      ['destination', CELL],
      ['Familiarity. “Permanent circle” means a known circle.', BODY],
    ]),
  ];

  const tables = byName(pages);

  it('reconstructs Animated Object Statistics wrapped attack cells', () => {
    expect(tables.get('Animated Object Statistics')).toMatchObject({
      sourcePage: 116,
      columns: ['Size', 'HP', 'AC', 'Attack', 'Strength', 'Dexterity'],
      rows: [
        ['Tiny', 20, 18, '+8 to hit, 1d4 + 4 damage', 4, 18],
        ['Small', 25, 16, '+6 to hit, 1d8 + 2 damage', 6, 14],
        ['Medium', 40, 13, '+5 to hit, 2d6 + 1 damage', 10, 12],
        ['Large', 50, 10, '+6 to hit, 2d10 + 2 damage', 14, 10],
        ['Huge', 80, 10, '+8 to hit, 2d12 + 4 damage', 18, 6],
      ],
    });
  });

  it('reconstructs Confusion behavior with wrapped cells', () => {
    expect(tables.get('Confusion Behavior')?.rows).toEqual([
      [
        '1',
        'The creature uses all its movement to move in a random direction. To determine the direction, roll a d8 and assign a direction to each die face. The creature doesn’t take an action this turn.',
      ],
      ['2–6', 'The creature doesn’t move or take actions this turn.'],
      [
        '7–8',
        'The creature uses its action to make a melee attack against a randomly determined creature within its reach. If there is no creature within its reach, the creature does nothing this turn.',
      ],
      ['9–10', 'The creature can act and move normally.'],
    ]);
  });

  it('preserves all three Control Weather stage tables in source row order', () => {
    expect(tables.get('Precipitation')?.rows).toEqual([
      [1, 'Clear'],
      [2, 'Light clouds'],
      [3, 'Overcast or ground fog'],
      [4, 'Rain, hail, or snow'],
      [5, 'Torrential rain, driving hail, or blizzard'],
    ]);
    expect(tables.get('Temperature')?.rows).toEqual([
      [1, 'Unbearable heat'],
      [2, 'Hot'],
      [3, 'Warm'],
      [4, 'Cool'],
      [5, 'Cold'],
      [6, 'Arctic cold'],
    ]);
    expect(tables.get('Wind')?.rows).toEqual([
      [1, 'Calm'],
      [2, 'Moderate wind'],
      [3, 'Strong wind'],
      [4, 'Gale'],
      [5, 'Storm'],
    ]);
  });

  it('reconstructs Creation, Reincarnate, Scrying, and Teleport exactly', () => {
    expect(tables.get('Creation Material Duration')?.rows).toEqual([
      ['Vegetable matter', '1 day'],
      ['Stone or crystal', '12 hours'],
      ['Precious metals', '1 hour'],
      ['Gems', '10 minutes'],
      ['Adamantine or mithral', '1 minute'],
    ]);
    expect(tables.get('Reincarnate Race')?.rows).toEqual([
      ['01–04', 'Dragonborn'],
      ['05–13', 'Dwarf, hill'],
      ['14–21', 'Dwarf, mountain'],
      ['22–25', 'Elf, dark'],
      ['26–34', 'Elf, high'],
      ['35–42', 'Elf, wood'],
      ['43–46', 'Gnome, forest'],
      ['47–52', 'Gnome, rock'],
      ['53–56', 'Half-elf'],
      ['57–60', 'Half-orc'],
      ['61–68', 'Halfling, lightfoot'],
      ['69–76', 'Halfling, stout'],
      ['77–96', 'Human'],
      ['97–00', 'Tiefling'],
    ]);
    expect(tables.get('Scrying Save Modifiers')?.rows).toEqual([
      ['Knowledge', 'Secondhand (you have heard of the target)', '+5'],
      ['Knowledge', 'Firsthand (you have met the target)', '+0'],
      ['Knowledge', 'Familiar (you know the target well)', '−5'],
      ['Connection', 'Likeness or picture', '−2'],
      ['Connection', 'Possession or garment', '−4'],
      [
        'Connection',
        'Body part, lock of hair, bit of nail, or the like',
        '−10',
      ],
    ]);
    expect(tables.get('Teleport Familiarity')).toMatchObject({
      sourcePage: 186,
      rows: [
        ['Permanent circle', '—', '—', '—', '01–100'],
        ['Associated object', '—', '—', '—', '01–100'],
        ['Very familiar', '01–05', '06–13', '14–24', '25–100'],
        ['Seen casually', '01–33', '34–43', '44–53', '54–100'],
        ['Viewed once', '01–43', '44–53', '54–73', '74–100'],
        ['Description', '01–43', '44–53', '54–73', '74–100'],
        ['False destination', '01–50', '51–100', '—', '—'],
      ],
    });
  });

  it('fails a reviewed spell table closed when its source fingerprint drifts', () => {
    const drifted = tieredPage(186, [
      ['Teleport', LEAF],
      ['Similar Off On', CELL],
      ['Familiarity Mishap Area Target Target', CELL],
      ['Permanent — — — 01–99', CELL],
      ['circle', CELL],
    ]);
    expect(byName([drifted]).get('Teleport Familiarity')).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// wrapped d100 rows + item anchor + cross-page run: Bag of Beans
// ---------------------------------------------------------------------------

describe('parseDocumentTables — wrapped d100 tables (item-anchored)', () => {
  function bagOfBeansPages(): PageText[] {
    return [
      tieredPage(209, [
        ['Bag of Beans', LEAF],
        ['Wondrous item, rare', BODY],
        ['Inside this heavy cloth bag are 3d4 dry beans.', BODY],
        ['d100 Effect', CELL],
        ['01 5d4 toadstools sprout. If a creature eats a', CELL],
        ['toadstool, roll any die.', CELL],
        ['02–10 A geyser erupts and spouts water, beer, berry', CELL],
        ['juice, tea, vinegar, wine, or oil (GM’s choice) 30', CELL],
        ['feet into the air for 1d12 rounds.', CELL],
        ['11–20 A treant sprouts.', CELL],
        ['21–30 An animate, immobile stone statue rises.', CELL],
        ['31–40 A campfire with blue flames springs forth.', CELL],
        ['41–50 1d6 + 6 shriekers sprout', CELL],
        ['51–60 1d4 + 8 bright pink toads crawl forth.', CELL],
        ['61–70 A hungry bulette burrows up and attacks.', CELL],
        ['71–80 A fruit tree grows. It has 1d10 + 20 fruit, 1d8 of', CELL],
        ['which act as randomly determined magic', CELL],
        ['potions.', CELL],
        ['81–90 A nest of 1d4 + 3 eggs springs up. Any creature', CELL],
      ]),
      tieredPage(210, [
        ['that eats an egg must make a DC 20 Constitution', CELL],
        ['saving throw.', CELL],
        ['91–99 A pyramid with a 60-foot-square base bursts', CELL],
        ['upward.', CELL],
        ['00 A giant beanstalk sprouts, growing to a height of', CELL],
        ['the GM’s choice.', CELL],
        ['Bag of Devouring', LEAF],
        ['Wondrous item, very rare', BODY],
      ]),
    ];
  }

  it('anchors on the owning item heading and walks the run across the page break', () => {
    const table = byName(bagOfBeansPages()).get('Bag of Beans');
    expect(table).toBeDefined();
    expect(table?.columns).toEqual(['d100', 'Effect']);
    expect(table?.rows).toHaveLength(12);
    expect(table?.rows[0]).toEqual([
      '01',
      '5d4 toadstools sprout. If a creature eats a toadstool, roll any die.',
    ]);
    expect(table?.rows[1]).toEqual([
      '02–10',
      'A geyser erupts and spouts water, beer, berry juice, tea, vinegar, wine, or oil (GM’s choice) 30 feet into the air for 1d12 rounds.',
    ]);
    // The page break falls inside the 81–90 effect cell.
    expect(table?.rows[9]).toEqual([
      '81–90',
      'A nest of 1d4 + 3 eggs springs up. Any creature that eats an egg must make a DC 20 Constitution saving throw.',
    ]);
    expect(table?.rows[11]).toEqual([
      '00',
      'A giant beanstalk sprouts, growing to a height of the GM’s choice.',
    ]);
    expect(table?.sourcePage).toBe(209);
  });

  it('does not let a wrapped cell that begins with a bare number open a phantom row', () => {
    // "30 feet into the air" continues the 02–10 cell above; only zero-padded
    // singles ("01", "00") or ranges may start a row, so the row count stays
    // 12 and the cell text re-joins.
    const table = byName(bagOfBeansPages()).get('Bag of Beans');
    expect(table?.rows.map((row) => row[0])).toEqual([
      '01',
      '02–10',
      '11–20',
      '21–30',
      '31–40',
      '41–50',
      '51–60',
      '61–70',
      '71–80',
      '81–90',
      '91–99',
      '00',
    ]);
  });

  it('aborts an item-anchored scan at the next heading (no table claimed across entries)', () => {
    // A Bag of Beans entry with NO embedded table, directly followed by
    // another item whose body does carry a d100 run: the spec must not claim
    // the neighbor's table.
    const pages = [
      tieredPage(209, [
        ['Bag of Beans', LEAF],
        ['Wondrous item, rare', BODY],
        ['Inside this heavy cloth bag are 3d4 dry beans.', BODY],
        ['Bead of Force', LEAF],
        ['Wondrous item, rare', BODY],
        ['d100 Effect', CELL],
        ['01 Something happens.', CELL],
        ['02–00 Nothing happens.', CELL],
      ]),
    ];
    expect(byName(pages).get('Bag of Beans')).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// prose sidebars at cell height must never satisfy a spec
// ---------------------------------------------------------------------------

describe('parseDocumentTables — sidebar boxes and integer cells', () => {
  it('a prose sidebar whose box body renders at cell height yields no table', () => {
    // "Self-Sufficiency"-shaped: sidebar-tier caption + cell-height prose.
    // No spec anchors on it, and even a same-named spec could not match
    // because the exact header line is absent.
    const page = tieredPage(73, [
      ['Self-Sufficiency', SIDEBAR],
      ['The expenses and lifestyles described here assume', CELL],
      ['that you are spending your time between adventures', CELL],
      ['in town.', CELL],
    ]);
    expect(parseDocumentTables([page])).toEqual([]);
  });

  it('emits integer cells for the reviewed numeric columns (Creating Spell Slots)', () => {
    const page = tieredPage(43, [
      ['Creating Spell Slots', LEAF],
      ['Spell Slot Sorcery', CELL],
      ['Level Point Cost', CELL],
      ['1st 2', CELL],
      ['2nd 3', CELL],
      ['3rd 5', CELL],
      ['4th 6', CELL],
      ['5th 7', CELL],
      ['Converting a Spell Slot to Sorcery Points. As a', BODY],
    ]);
    const table = byName([page]).get('Creating Spell Slots');
    expect(table).toBeDefined();
    expect(table?.columns).toEqual(['Spell Slot Level', 'Sorcery Point Cost']);
    expect(table?.rows).toEqual([
      ['1st', 2],
      ['2nd', 3],
      ['3rd', 5],
      ['4th', 6],
      ['5th', 7],
    ]);
  });
});

describe('parseDocumentTables — magic-item embedded content', () => {
  it('reconstructs both halves of a paired resistance option table', () => {
    const page = tieredPage(209, [
      ['Armor of Resistance', LEAF],
      ['Armor (light, medium, or heavy), rare', BODY],
      ['d10 Damage Type d10 Damage Type', CELL],
      ['1 Acid 6 Necrotic', CELL],
      ['2 Cold 7 Poison', CELL],
      ['3 Fire 8 Psychic', CELL],
      ['4 Force 9 Radiant', CELL],
      ['5 Lightning 10 Thunder', CELL],
      ['Armor of Vulnerability', LEAF],
    ]);

    const table = byName([page]).get('Armor of Resistance');
    expect(table?.columns).toEqual(['d10', 'Damage Type']);
    expect(table?.rows).toEqual([
      [1, 'Acid'],
      [2, 'Cold'],
      [3, 'Fire'],
      [4, 'Force'],
      [5, 'Lightning'],
      [6, 'Necrotic'],
      [7, 'Poison'],
      [8, 'Psychic'],
      [9, 'Radiant'],
      [10, 'Thunder'],
    ]);
  });

  it('emits a card option table under its owning magic item', () => {
    const page = tieredPage(216, [
      ['Deck of Illusions', LEAF],
      ['Wondrous item, uncommon', BODY],
      ['Playing Card Illusion', CELL],
      ['Ace of hearts Red dragon', CELL],
      ['King of hearts Knight and four guards', CELL],
      ['Jokers (2) You (the deck’s owner)', CELL],
      ['Deck of Many Things', LEAF],
    ]);

    const table = parseDocumentTables(
      [page],
      SRD_5_1_DOCUMENT_TABLE_SPECS.map((spec) =>
        spec.name === 'Deck of Illusions' ? { ...spec, expectedRows: 3 } : spec,
      ),
    ).find((candidate) => candidate.name === 'Deck of Illusions');
    expect(table?.columns).toEqual(['Playing Card', 'Illusion']);
    expect(table?.rows).toEqual([
      ['Ace of hearts', 'Red dragon'],
      ['King of hearts', 'Knight and four guards'],
      ['Jokers (2)', 'You (the deck’s owner)'],
    ]);
  });

  it('keeps a table legend when row cells retain its marker', () => {
    const page = tieredPage(217, [
      ['Deck of Many Things', LEAF],
      ['Wondrous item, legendary', BODY],
      ['Playing Card Card', CELL],
      ['Ace of diamonds Vizier*', CELL],
      ['King of diamonds Sun', CELL],
      ['Queen of diamonds Moon', CELL],
      ['Jack of diamonds Star', CELL],
      ['Two of diamonds Comet*', CELL],
      ['Ace of hearts The Fates*', CELL],
      ['King of hearts Throne', CELL],
      ['Queen of hearts Key', CELL],
      ['Jack of hearts Knight', CELL],
      ['Two of hearts Gem', CELL],
      ['Ace of clubs Talons', CELL],
      ['King of clubs The Void', CELL],
      ['Queen of clubs Flames', CELL],
      ['Jack of clubs Skull', CELL],
      ['Two of clubs Idiot', CELL],
      ['Ace of spades Donjon', CELL],
      ['King of spades Ruin', CELL],
      ['Queen of spades Euryale', CELL],
      ['Jack of spades Rogue', CELL],
      ['Two of spades Balance', CELL],
      ['Joker (with TM) Fool', CELL],
      ['Joker (without TM) Jester', CELL],
      ['*Found only in a deck with twenty-two cards', CELL],
    ]);

    const table = byName([page]).get('Deck of Many Things');
    expect(table?.rows).toContainEqual(['Ace of diamonds', 'Vizier*']);
    expect(table?.legend).toEqual([
      '*Found only in a deck with twenty-two cards',
    ]);
  });
});

// ---------------------------------------------------------------------------
// spec hygiene
// ---------------------------------------------------------------------------

describe('SRD_5_1_DOCUMENT_TABLE_SPECS hygiene', () => {
  it('spec names are unique (stable table identities)', () => {
    const names = SRD_5_1_DOCUMENT_TABLE_SPECS.map((spec) => spec.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it('every spec demands a locator, a positive row count, and columns', () => {
    for (const spec of SRD_5_1_DOCUMENT_TABLE_SPECS) {
      expect(spec.expectedRows).toBeGreaterThan(0);
      expect(spec.columns.length).toBeGreaterThan(0);
      // Header/caption specs verify against at least one exact cell-tier header
      // line. Class-progression-reconstruction specs locate by pinned source
      // blocks instead (eshyra-4a7.6), so they require those rather than a
      // header line.
      if (spec.rows.kind === 'class-progression-reconstruction') {
        expect(spec.rows.sourceBlocks.length).toBeGreaterThan(0);
        for (const block of spec.rows.sourceBlocks) {
          expect(block.length).toBeGreaterThan(0);
        }
        expect(spec.rows.rows.length).toBe(spec.expectedRows);
      } else {
        expect(spec.headerLines.length).toBeGreaterThan(0);
      }
    }
  });
});
