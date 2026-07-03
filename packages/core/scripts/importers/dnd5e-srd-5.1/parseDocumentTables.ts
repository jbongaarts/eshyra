/**
 * Document-wide table parser for the D&D 5e SRD 5.1 importer (eshyra-4a7.3).
 *
 * Where `parseTables.ts` reconstructs reference tables from specific section
 * slices using text-only anchors, this parser consumes the FULL extracted
 * document and locates each table by typography: a reviewed anchor heading at
 * the record-leaf font tier (h≈12.0, `PageText.lineHeights`) followed by the
 * table's exact column-header line(s) at the table-cell tier (h≈8.9). Row
 * collection consumes ONLY cell-tier lines, so a table can never swallow the
 * body prose that resumes below it, and a prose sidebar (whose box body also
 * renders at cell height) can never satisfy a spec because the exact header
 * line will not match.
 *
 * Every emitted table is a reviewed spec in `SRD_5_1_DOCUMENT_TABLE_SPECS`:
 * name (verbatim caption, or a documented synthesized name when the SRD
 * prints the table caption-less), columns, header lines, a row-collection
 * rule, and an EXACT expected row count. A spec whose anchor matches but
 * whose rows drift in count or shape yields no table (fail closed): the
 * record then goes missing from `EXPECTED_SRD_5_1_TABLE_NAMES` and the
 * import throws `TableCoverageError` before writing output.
 *
 * Anchor kinds:
 *   - `caption`: the anchor heading IS the printed table caption and the
 *     header line follows immediately (e.g. "Draconic Ancestry" p5,
 *     "Oath of Devotion Spells" p33, "The Barbarian" p8).
 *   - `item`: the SRD prints the table caption-less inside a record entry;
 *     the anchor is the OWNING entry's heading (e.g. the "Wand of Wonder"
 *     magic-item heading) and the table is the first cell-tier run after it.
 *     Scanning aborts at the next leaf-or-higher heading so a spec can never
 *     claim a different entry's table.
 *
 * Two same-caption tables ("Draconic Ancestry" p5 vs the Sorcerer p44 copy)
 * disambiguate by their different exact header lines; the parser tries every
 * anchor occurrence until the headers verify.
 *
 * Fixture safety: reduced/uniform-font fixture PDFs render every line in one
 * band, so the leaf-anchor + cell-header requirement never matches and the
 * parser emits nothing — document-table coverage is asserted only for the
 * real import via the table-name baseline.
 */

import { CLASS_PROGRESSION_TABLE_SPECS } from './classProgressionTables.js';
import { classifyTier, isTableCell } from './sourceInventory.js';
import type { PageText, TableExtraction } from './types.js';

interface Row {
  readonly page: number;
  readonly text: string;
  readonly height: number | undefined;
}

/** How rows are reconstructed from the table's cell-tier run. */
type RowRule =
  | {
      /** Every row is one cell line matching `pattern`; group i+1 is column i. */
      readonly kind: 'line-per-row';
      readonly pattern: RegExp;
      /** Column indexes (0-based) whose cells emit as integers. */
      readonly integerColumns?: readonly number[];
    }
  | {
      /**
       * A row starts at a line matching `start`; subsequent non-matching cell
       * lines re-join (hyphen-aware) into the LAST captured column's cell —
       * the SRD wraps only the final text column in these tables.
       */
      readonly kind: 'wrapped-last-column';
      readonly start: RegExp;
    }
  | {
      /**
       * The Barbarian progression shape: a row line carries all five cells
       * ("1st +2 Rage, 2 +2") but the Features cell (group 3) wraps onto
       * following cell lines ("Unarmored" / "Defense") that re-join into it.
       */
      readonly kind: 'wrapped-features-column';
      readonly start: RegExp;
    }
  | {
      /**
       * One physical line carries two logical rows side by side. The pattern
       * captures `columnCount` cells for the left row followed by the same
       * number for the right row; the right captures may be optional for a
       * final unpaired row.
       */
      readonly kind: 'paired-line-per-row';
      readonly pattern: RegExp;
      readonly columnCount: number;
      readonly integerColumns?: readonly number[];
    }
  | {
      /**
       * The PDF has discarded the internal column boundary. Verify the exact
       * extracted cell run, then return the reviewed source reconstruction.
       */
      readonly kind: 'reviewed-reconstruction';
      readonly sourceLines: readonly string[];
      readonly rows: readonly (readonly unknown[])[];
    }
  | {
      /**
       * Class progression tables (eshyra-4a7.6). The SRD's two-column page
       * layout shears each non-Barbarian class table into 2–4 separate
       * cell-tier runs — a Level/Bonus/Features run and one or more
       * spell-slot/resource runs — interleaved with the proficiency and
       * Equipment prose that flows around the table, so neither the
       * caption-immediate header (`findHeaderAt`) nor a single contiguous cell
       * run (`cellRunAfter`) can reach the data. Each spec instead pins the
       * exact contiguous source block(s) in document order and carries the
       * reviewed row reconstruction (verified against the SRD print). Every
       * block line must match exactly and render at table-cell tier or the
       * table fails closed (`locateClassProgression`), so a re-extraction
       * drift trips the table-name coverage gate rather than emitting a
       * silently wrong table.
       */
      readonly kind: 'class-progression-reconstruction';
      readonly sourceBlocks: readonly (readonly string[])[];
      readonly rows: readonly (readonly string[])[];
    };

export interface DocumentTableSpec {
  /** Emitted table name (verbatim caption, or synthesized — see specs). */
  readonly name: string;
  readonly columns: readonly string[];
  /** Exact trimmed text of the anchor heading line. */
  readonly anchorHeading: string;
  /** Whether the anchor is the printed caption or the owning entry heading. */
  readonly anchor: 'caption' | 'item';
  /** Typography tier of the anchor; table captions default to leaf. */
  readonly anchorTier?: 'leaf' | 'subsection';
  /**
   * Exact trimmed text of the table's column-header line(s) at cell tier,
   * in order. The first header line is also the spec's disambiguator when
   * the anchor heading text repeats in the document.
   */
  readonly headerLines: readonly string[];
  /** Search later cell runs within the same anchored entry for this header. */
  readonly searchPastCellRuns?: boolean;
  readonly rows: RowRule;
  /** Exact source row count; any drift fails the table closed. */
  readonly expectedRows: number;
  /** Owning record for a table embedded inside another source entry. */
  readonly ownerRecordKey?: string;
  /** Optional legend/footnote line(s) immediately after the table row run. */
  readonly legend?: {
    readonly pattern: RegExp;
  };
}

const ORDINAL_LEVEL = String.raw`\d{1,2}(?:st|nd|rd|th)`;

/** "<ordinal> <spells…>" rows (subclass spell tables). */
const LEVEL_SPELLS_ROW = new RegExp(`^(${ORDINAL_LEVEL})\\s+(.+)$`);

/**
 * Wrapped-d100 row start: a d100 range ("02–10", "98–00") or a zero-padded
 * single value ("01", "00"). The zero-pad requirement keeps a wrapped effect
 * cell that happens to begin with a bare number ("10 gems worth…") from
 * opening a phantom row.
 */
const D100_WRAPPED_ROW_START = /^(\d{2,3}\s*[–—-]\s*\d{1,3}|0\d)\s+(.+)$/;

const DRAGON_COLOR =
  'Black|Blue|Brass|Bronze|Copper|Gold|Green|Red|Silver|White';
const DRAGON_DAMAGE = 'Acid|Cold|Fire|Lightning|Poison';

/** The ten SRD circle-of-the-land terrains, each printed as a bare caption. */
const CIRCLE_OF_THE_LAND_TERRAINS: readonly string[] = [
  'Arctic',
  'Coast',
  'Desert',
  'Forest',
  'Grassland',
  'Mountain',
  'Swamp',
];

function levelSpellsSpec(input: {
  readonly name: string;
  readonly anchorHeading: string;
  readonly levelColumn: string;
  readonly spellsColumn: string;
  readonly headerLines: readonly string[];
  readonly expectedRows: number;
}): DocumentTableSpec {
  return {
    name: input.name,
    columns: [input.levelColumn, input.spellsColumn],
    anchorHeading: input.anchorHeading,
    anchor: 'caption',
    headerLines: input.headerLines,
    rows: { kind: 'wrapped-last-column', start: LEVEL_SPELLS_ROW },
    expectedRows: input.expectedRows,
  };
}

function bagOfTricksSpec(color: string): DocumentTableSpec {
  return {
    name: `${color} Bag of Tricks`,
    columns: ['d8', 'Creature'],
    anchorHeading: `${color} Bag of Tricks`,
    anchor: 'caption',
    headerLines: ['d8 Creature'],
    rows: {
      kind: 'line-per-row',
      pattern: /^([1-8])\s+(.+)$/,
      integerColumns: [0],
    },
    expectedRows: 8,
  };
}

function stageConditionSpec(
  name: string,
  expectedRows: number,
): DocumentTableSpec {
  return {
    name,
    columns: ['Stage', 'Condition'],
    anchorHeading: name,
    anchor: 'caption',
    headerLines: ['Stage Condition'],
    rows: {
      kind: 'line-per-row',
      pattern: /^(\d) (.+)$/,
      integerColumns: [0],
    },
    expectedRows,
  };
}

/**
 * The reviewed document-wide table specs for the vendored SRD 5.1 PDF.
 * Grouped by source region; every entry names its source page and, when the
 * SRD prints the table caption-less, documents the synthesized name.
 */
/**
 * Reviewed owners for tables the SRD prints *inside* another record's body, so
 * the prose joiner absorbs the table's linearization (caption/header/cell run)
 * into that record's description/text. The importer strips that linearization
 * from the owner's prose (eshyra-3anh) so the structured `table:*` record is the
 * sole representation of the tabular data; the table record itself is unchanged.
 *
 * Keyed by the emitted table name. Spell-owned embedded tables declare their
 * owner inline on the spec (cross-checked by `SRD_5_1_SPELL_TABLE_OWNERS`); this
 * allowlist covers the magic-item and class/subclass-feature embedded tables.
 * Each entry was confirmed by an exact source-span match against the generated
 * owner prose, and the post-strip assertion fails closed if any table's span
 * still appears in prose (so a missed owner cannot ship silently).
 */
const EMBEDDED_TABLE_PROSE_OWNERS: Readonly<Record<string, string>> = {
  'Apparatus of the Crab Levers': 'magic-item:apparatus-of-the-crab',
  'Armor of Resistance': 'magic-item:armor-of-resistance',
  'Bag of Beans': 'magic-item:bag-of-beans',
  'Belt of Giant Strength': 'magic-item:belt-of-giant-strength',
  'Candle of Invocation': 'magic-item:candle-of-invocation',
  'Carpet of Flying': 'magic-item:carpet-of-flying',
  'Circle of the Land (Arctic)': 'feature:circle-of-the-land:circle-spells',
  'Circle of the Land (Coast)': 'feature:circle-of-the-land:circle-spells',
  'Circle of the Land (Desert)': 'feature:circle-of-the-land:circle-spells',
  'Circle of the Land (Forest)': 'feature:circle-of-the-land:circle-spells',
  'Circle of the Land (Grassland)': 'feature:circle-of-the-land:circle-spells',
  'Circle of the Land (Mountain)': 'feature:circle-of-the-land:circle-spells',
  'Circle of the Land (Swamp)': 'feature:circle-of-the-land:circle-spells',
  'Creating Spell Slots': 'feature:sorcerer:font-of-magic',
  'Cube of Force Charges Lost': 'magic-item:cube-of-force',
  'Cube of Force Faces': 'magic-item:cube-of-force',
  'Deck of Illusions': 'magic-item:deck-of-illusions',
  'Deck of Many Things': 'magic-item:deck-of-many-things',
  'Draconic Bloodline Draconic Ancestry':
    'feature:draconic-bloodline:dragon-ancestor',
  'Dragon Scale Mail': 'magic-item:dragon-scale-mail',
  'Efreeti Bottle': 'magic-item:efreeti-bottle',
  'Elemental Gem': 'magic-item:elemental-gem',
  'Feather Token': 'magic-item:feather-token',
  'Gray Bag of Tricks': 'magic-item:bag-of-tricks',
  'Horn of Valhalla': 'magic-item:horn-of-valhalla',
  'Iron Flask': 'magic-item:iron-flask',
  'Manual of Golems': 'magic-item:manual-of-golems',
  'Necklace of Prayer Beads': 'magic-item:necklace-of-prayer-beads',
  'Potion of Giant Strength': 'magic-item:potion-of-giant-strength',
  'Potion of Resistance': 'magic-item:potion-of-resistance',
  'Potions of Healing': 'magic-item:potion-of-healing',
  'Ring of Resistance': 'magic-item:ring-of-resistance',
  'Ring of Shooting Stars': 'magic-item:ring-of-shooting-stars',
  'Robe of Useful Items': 'magic-item:robe-of-useful-items',
  'Rust Bag of Tricks': 'magic-item:bag-of-tricks',
  'Spell Scroll': 'magic-item:spell-scroll',
  'Sphere of Annihilation': 'magic-item:sphere-of-annihilation',
  'Staff of Power': 'magic-item:staff-of-power',
  'Staff of the Magi': 'magic-item:staff-of-the-magi',
  'Tan Bag of Tricks': 'magic-item:bag-of-tricks',
  'Wand of Wonder': 'magic-item:wand-of-wonder',
};

export const SRD_5_1_DOCUMENT_TABLE_SPECS: readonly DocumentTableSpec[] = [
  // --- Races (p5) + the Sorcerer Draconic Bloodline copy (p44) --------------
  // Same printed caption twice; the exact header line disambiguates. The p44
  // table drops the Breath Weapon column, so it is a distinct table; its name
  // is synthesized ("Draconic Bloodline Draconic Ancestry") because a second
  // record cannot reuse the verbatim caption name/key.
  {
    name: 'Draconic Ancestry',
    columns: ['Dragon', 'Damage Type', 'Breath Weapon'],
    anchorHeading: 'Draconic Ancestry',
    anchor: 'caption',
    headerLines: ['Dragon Damage Type Breath Weapon'],
    rows: {
      kind: 'line-per-row',
      pattern: new RegExp(`^(${DRAGON_COLOR})\\s+(${DRAGON_DAMAGE})\\s+(.+)$`),
    },
    expectedRows: 10,
  },
  {
    name: 'Draconic Bloodline Draconic Ancestry',
    columns: ['Dragon', 'Damage Type'],
    anchorHeading: 'Draconic Ancestry',
    anchor: 'caption',
    headerLines: ['Dragon Damage Type'],
    rows: {
      kind: 'line-per-row',
      pattern: new RegExp(`^(${DRAGON_COLOR})\\s+(${DRAGON_DAMAGE})$`),
    },
    expectedRows: 10,
  },
  // --- Monsters: Half-Dragon Template (pp320-321) --------------------------
  // Both tables are caption-less and owned by the template subsection. The
  // damage-resistance run crosses the page boundary; the breath-weapon run's
  // first Size cell wraps onto its own physical line, so it uses an exact
  // reviewed reconstruction.
  {
    name: 'Half-Dragon Damage Resistance',
    columns: ['Color', 'Damage Resistance'],
    anchorHeading: 'Half-Dragon Template',
    anchor: 'item',
    anchorTier: 'subsection',
    headerLines: ['Color Damage Resistance'],
    rows: {
      kind: 'line-per-row',
      pattern:
        /^(Black or copper|Blue or bronze|Brass, gold, or red|Green|Silver or white) (Acid|Lightning|Fire|Poison|Cold)$/,
    },
    expectedRows: 5,
    ownerRecordKey: 'rule:half-dragon-template',
  },
  {
    name: 'Half-Dragon Breath Weapon',
    columns: ['Size', 'Breath Weapon', 'Prerequisite'],
    anchorHeading: 'Half-Dragon Template',
    anchor: 'item',
    anchorTier: 'subsection',
    headerLines: ['Optional', 'Size Breath Weapon Prerequisite'],
    searchPastCellRuns: true,
    rows: {
      kind: 'reviewed-reconstruction',
      sourceLines: [
        'Large or As a wyrmling Challenge 2 or higher',
        'smaller',
        'Huge As a young dragon Challenge 7 or higher',
        'Gargantuan As an adult dragon Challenge 8 or higher',
      ],
      rows: [
        ['Large or smaller', 'As a wyrmling', 'Challenge 2 or higher'],
        ['Huge', 'As a young dragon', 'Challenge 7 or higher'],
        ['Gargantuan', 'As an adult dragon', 'Challenge 8 or higher'],
      ],
    },
    expectedRows: 3,
    ownerRecordKey: 'rule:half-dragon-template',
  },
  // --- Class chapters: progression + option tables --------------------------
  // The Barbarian (p8) is the one SRD class progression table whose columns
  // all live on one physical line per row (the spellcaster tables split their
  // slot columns into a separate block — left to eshyra-4a7.6's progression
  // modeling). The Features cell wraps onto continuation cell lines.
  {
    name: 'The Barbarian',
    columns: ['Level', 'Proficiency Bonus', 'Features', 'Rages', 'Rage Damage'],
    anchorHeading: 'The Barbarian',
    anchor: 'caption',
    headerLines: ['Proficiency Rage', 'Level Bonus Features Rages Damage'],
    rows: {
      kind: 'wrapped-features-column',
      start: new RegExp(
        `^(${ORDINAL_LEVEL})\\s+(\\+\\d)\\s+(.+?)\\s+(\\d+|Unlimited)\\s+(\\+\\d)$`,
      ),
    },
    expectedRows: 20,
  },
  // The remaining 11 class progression tables plus the two feature-owned class
  // tables (Beast Shapes, Destroy Undead). Fighter/Rogue extract like the
  // Barbarian (one line per row); the nine spellcaster/monk tables are sheared
  // by the two-column layout and use pinned-source reconstruction
  // (eshyra-4a7.6; see classProgressionTables.ts).
  ...CLASS_PROGRESSION_TABLE_SPECS,
  // Sorcerer Font of Magic option table (p43).
  {
    name: 'Creating Spell Slots',
    columns: ['Spell Slot Level', 'Sorcery Point Cost'],
    anchorHeading: 'Creating Spell Slots',
    anchor: 'caption',
    headerLines: ['Spell Slot Sorcery', 'Level Point Cost'],
    rows: {
      kind: 'line-per-row',
      pattern: /^([1-5](?:st|nd|rd|th))\s+(\d+)$/,
      integerColumns: [1],
    },
    expectedRows: 5,
  },
  // Subclass spell tables: Life Domain (p17), Circle of the Land's seven
  // terrain tables (p22 — bare "Arctic"…"Swamp" captions, so the names are
  // qualified "Circle of the Land (<Terrain>)"), Oath of Devotion (p33), and
  // the Fiend patron's expanded list (p50).
  levelSpellsSpec({
    name: 'Life Domain Spells',
    anchorHeading: 'Life Domain Spells',
    levelColumn: 'Cleric Level',
    spellsColumn: 'Spells',
    headerLines: ['Cleric Level Spells'],
    expectedRows: 5,
  }),
  ...CIRCLE_OF_THE_LAND_TERRAINS.map((terrain) =>
    levelSpellsSpec({
      name: `Circle of the Land (${terrain})`,
      anchorHeading: terrain,
      levelColumn: 'Druid Level',
      spellsColumn: 'Circle Spells',
      headerLines: ['Druid Level Circle Spells'],
      expectedRows: 4,
    }),
  ),
  levelSpellsSpec({
    name: 'Oath of Devotion Spells',
    anchorHeading: 'Oath of Devotion Spells',
    levelColumn: 'Paladin Level',
    spellsColumn: 'Spells',
    headerLines: ['Paladin', 'Level Spells'],
    expectedRows: 5,
  }),
  levelSpellsSpec({
    name: 'Fiend Expanded Spells',
    anchorHeading: 'Fiend Expanded Spells',
    levelColumn: 'Spell Level',
    spellsColumn: 'Spells',
    headerLines: ['Spell Level Spells'],
    expectedRows: 5,
  }),
  // --- Spell descriptions (pp116-186, eshyra-o4j7) -------------------------
  // Printed captions are kept verbatim. Caption-less tables are qualified by
  // their owning spell so generic headers such as "d10 Behavior" cannot
  // collide with tables from another source region.
  {
    name: 'Animated Object Statistics',
    ownerRecordKey: 'spell:animate-objects',
    columns: ['Size', 'HP', 'AC', 'Attack', 'Strength', 'Dexterity'],
    anchorHeading: 'Animated Object Statistics',
    anchor: 'caption',
    headerLines: ['Size HP AC Attack Str Dex'],
    rows: {
      kind: 'reviewed-reconstruction',
      sourceLines: [
        'Tiny 20 18 +8 to hit, 1d4 + 4 damage 4 18',
        'Small 25 16 +6 to hit, 1d8 + 2 damage 6 14',
        'Medium 40 13 +5 to hit, 2d6 + 1 damage 10 12',
        'Large 50 10 +6 to hit, 2d10 + 2 14 10',
        'damage',
        'Huge 80 10 +8 to hit, 2d12 + 4 18 6',
        'damage',
      ],
      rows: [
        ['Tiny', 20, 18, '+8 to hit, 1d4 + 4 damage', 4, 18],
        ['Small', 25, 16, '+6 to hit, 1d8 + 2 damage', 6, 14],
        ['Medium', 40, 13, '+5 to hit, 2d6 + 1 damage', 10, 12],
        ['Large', 50, 10, '+6 to hit, 2d10 + 2 damage', 14, 10],
        ['Huge', 80, 10, '+8 to hit, 2d12 + 4 damage', 18, 6],
      ],
    },
    expectedRows: 5,
  },
  {
    name: 'Confusion Behavior',
    ownerRecordKey: 'spell:confusion',
    columns: ['d10', 'Behavior'],
    anchorHeading: 'Confusion',
    anchor: 'item',
    headerLines: ['d10 Behavior'],
    rows: {
      kind: 'wrapped-last-column',
      start: /^(\d+(?:–\d+)?) (.+)$/,
    },
    expectedRows: 4,
  },
  {
    ...stageConditionSpec('Precipitation', 5),
    ownerRecordKey: 'spell:control-weather',
  },
  {
    ...stageConditionSpec('Temperature', 6),
    ownerRecordKey: 'spell:control-weather',
  },
  {
    ...stageConditionSpec('Wind', 5),
    ownerRecordKey: 'spell:control-weather',
  },
  {
    name: 'Creation Material Duration',
    ownerRecordKey: 'spell:creation',
    columns: ['Material', 'Duration'],
    anchorHeading: 'Creation',
    anchor: 'item',
    headerLines: ['Material Duration'],
    rows: {
      kind: 'line-per-row',
      pattern: /^(.+?) (1 day|12 hours|1 hour|10 minutes|1 minute)$/,
    },
    expectedRows: 5,
  },
  {
    name: 'Reincarnate Race',
    ownerRecordKey: 'spell:reincarnate',
    columns: ['d100', 'Race'],
    anchorHeading: 'Reincarnate',
    anchor: 'item',
    headerLines: ['d100 Race'],
    rows: {
      kind: 'line-per-row',
      pattern: /^(\d{2}–\d{2}) (.+)$/,
    },
    expectedRows: 14,
  },
  {
    name: 'Scrying Save Modifiers',
    ownerRecordKey: 'spell:scrying',
    columns: ['Basis', 'Circumstance', 'Save Modifier'],
    anchorHeading: 'Scrying',
    anchor: 'item',
    headerLines: ['Knowledge Save Modifier'],
    rows: {
      kind: 'reviewed-reconstruction',
      sourceLines: [
        'Secondhand (you have heard of the target) +5',
        'Firsthand (you have met the target) +0',
        'Familiar (you know the target well) −5',
        'Connection Save Modifier',
        'Likeness or picture −2',
        'Possession or garment −4',
        'Body part, lock of hair, bit of nail, or the like −10',
      ],
      rows: [
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
      ],
    },
    expectedRows: 6,
  },
  {
    name: 'Teleport Familiarity',
    ownerRecordKey: 'spell:teleport',
    columns: [
      'Familiarity',
      'Mishap',
      'Similar Area',
      'Off Target',
      'On Target',
    ],
    anchorHeading: 'Teleport',
    anchor: 'item',
    headerLines: ['Similar Off On', 'Familiarity Mishap Area Target Target'],
    rows: {
      kind: 'reviewed-reconstruction',
      sourceLines: [
        'Permanent — — — 01–100',
        'circle',
        'Associated — — — 01–100',
        'object',
        'Very familiar 01–05 06–13 14–24 25–100',
        'Seen casually 01–33 34–43 44–53 54–100',
        'Viewed once 01–43 44–53 54–73 74–100',
        'Description 01–43 44–53 54–73 74–100',
        'False 01–50 51–100 — —',
        'destination',
      ],
      rows: [
        ['Permanent circle', '—', '—', '—', '01–100'],
        ['Associated object', '—', '—', '—', '01–100'],
        ['Very familiar', '01–05', '06–13', '14–24', '25–100'],
        ['Seen casually', '01–33', '34–43', '44–53', '54–100'],
        ['Viewed once', '01–43', '44–53', '54–73', '74–100'],
        ['Description', '01–43', '44–53', '54–73', '74–100'],
        ['False destination', '01–50', '51–100', '—', '—'],
      ],
    },
    expectedRows: 7,
  },
  // --- Equipment chapter (p64) ----------------------------------------------
  {
    name: 'Donning and Doffing Armor',
    columns: ['Category', 'Don', 'Doff'],
    anchorHeading: 'Donning and Doffing Armor',
    anchor: 'caption',
    headerLines: ['Category Don Doff'],
    rows: {
      kind: 'line-per-row',
      pattern:
        /^(Light Armor|Medium Armor|Heavy Armor|Shield)\s+(\d+ minutes?|\d+ action)\s+(\d+ minutes?|\d+ action)$/,
    },
    expectedRows: 4,
  },
  // --- Magic Items A-Z: representative embedded tables ----------------------
  // The three Bag of Tricks color tables print real captions (p210-211).
  ...['Gray', 'Rust', 'Tan'].map(bagOfTricksSpec),
  // Belt of Giant Strength (p211) and Potion of Giant Strength (p234) print
  // caption-less variety tables inside their entries; the names are
  // synthesized from the owning item. Their distinct header lines keep the
  // two near-identical tables apart.
  {
    name: 'Belt of Giant Strength',
    columns: ['Type', 'Strength', 'Rarity'],
    anchorHeading: 'Belt of Giant Strength',
    anchor: 'item',
    headerLines: ['Type Strength Rarity'],
    rows: {
      kind: 'line-per-row',
      pattern: /^(.+?)\s+(\d+)\s+(Uncommon|Rare|Very rare|Legendary)$/,
      integerColumns: [1],
    },
    expectedRows: 5,
  },
  {
    name: 'Potion of Giant Strength',
    columns: ['Type of Giant', 'Strength', 'Rarity'],
    anchorHeading: 'Potion of Giant Strength',
    anchor: 'item',
    headerLines: ['Type of Giant Strength Rarity'],
    rows: {
      kind: 'line-per-row',
      pattern: /^(.+?)\s+(\d+)\s+(Uncommon|Rare|Very rare|Legendary)$/,
      integerColumns: [1],
    },
    expectedRows: 5,
  },
  // Potions of Healing (p234) prints a real caption; the "Potion of …" column
  // header keeps its verbatim ellipsis.
  {
    name: 'Potions of Healing',
    columns: ['Potion of …', 'Rarity', 'HP Regained'],
    anchorHeading: 'Potions of Healing',
    anchor: 'caption',
    headerLines: ['Potion of … Rarity HP Regained'],
    rows: {
      kind: 'line-per-row',
      pattern: /^(.+?)\s+(Common|Uncommon|Rare|Very rare)\s+(.+)$/,
    },
    expectedRows: 4,
  },
  // Wrapped-d100 dice-result tables, printed caption-less inside their items;
  // names synthesized from the owning item. Rows are Madness-table-shaped:
  // a d100 range (or zero-padded single value) opens a row and following
  // cell lines re-join into the effect cell. Bag of Beans (p209-210) and
  // Gray Bag of Tricks-style page breaks are handled by the flattened
  // cross-page line walk.
  {
    name: 'Bag of Beans',
    columns: ['d100', 'Effect'],
    anchorHeading: 'Bag of Beans',
    anchor: 'item',
    headerLines: ['d100 Effect'],
    rows: { kind: 'wrapped-last-column', start: D100_WRAPPED_ROW_START },
    expectedRows: 12,
  },
  {
    name: 'Robe of Useful Items',
    columns: ['d100', 'Patch'],
    anchorHeading: 'Robe of Useful Items',
    anchor: 'item',
    headerLines: ['d100 Patch'],
    rows: { kind: 'wrapped-last-column', start: D100_WRAPPED_ROW_START },
    expectedRows: 13,
  },
  {
    name: 'Wand of Wonder',
    columns: ['d100', 'Effect'],
    anchorHeading: 'Wand of Wonder',
    anchor: 'item',
    headerLines: ['d100 Effect'],
    rows: { kind: 'wrapped-last-column', start: D100_WRAPPED_ROW_START },
    expectedRows: 22,
  },
  {
    name: 'Apparatus of the Crab Levers',
    columns: ['Lever', 'Up', 'Down'],
    anchorHeading: 'Apparatus of the Crab Levers',
    anchor: 'caption',
    headerLines: ['Lever Up Down'],
    rows: {
      kind: 'reviewed-reconstruction',
      sourceLines: [
        '1 Legs and tail extend, Legs and tail retract,',
        'allowing the apparatus reducing the apparatus’s',
        'to walk and swim. speed to 0 and making it',
        'unable to benefit from',
        'bonuses to speed.',
        '2 Forward window shutter Forward window shutter',
        'opens. closes.',
        '3 Side window shutters Side window shutters',
        'open (two per side). close (two per side).',
        '4 Two claws extend from The claws retract.',
        'the front sides of the',
        'apparatus.',
        '5 Each extended claw Each extended claw',
        'makes the following makes the following',
        'melee weapon attack: melee weapon attack: +8',
        '+8 to hit, reach 5 ft., one to hit, reach 5 ft., one',
        'target. Hit: 7 (2d6) target. Hit: The target is',
        'bludgeoning damage. grappled (escape DC 15).',
        '6 The apparatus walks or The apparatus walks or',
        'swims forward. swims backward.',
        '7 The apparatus turns 90 The apparatus turns 90',
        'degrees left. degrees right.',
        '8 Eyelike fixtures emit The light turns off.',
        'bright light in a 30-foot',
        'radius and dim light for',
        'an additional 30 feet.',
        '9 The apparatus sinks as The apparatus rises up',
        'much as 20 feet in to 20 feet in liquid.',
        'liquid.',
        '10 The rear hatch unseals The rear hatch closes',
        'and opens. and seals.',
      ],
      rows: [
        [
          1,
          'Legs and tail extend, allowing the apparatus to walk and swim.',
          'Legs and tail retract, reducing the apparatus’s speed to 0 and making it unable to benefit from bonuses to speed.',
        ],
        [2, 'Forward window shutter opens.', 'Forward window shutter closes.'],
        [
          3,
          'Side window shutters open (two per side).',
          'Side window shutters close (two per side).',
        ],
        [
          4,
          'Two claws extend from the front sides of the apparatus.',
          'The claws retract.',
        ],
        [
          5,
          'Each extended claw makes the following melee weapon attack: +8 to hit, reach 5 ft., one target. Hit: 7 (2d6) bludgeoning damage.',
          'Each extended claw makes the following melee weapon attack: +8 to hit, reach 5 ft., one target. Hit: The target is grappled (escape DC 15).',
        ],
        [
          6,
          'The apparatus walks or swims forward.',
          'The apparatus walks or swims backward.',
        ],
        [
          7,
          'The apparatus turns 90 degrees left.',
          'The apparatus turns 90 degrees right.',
        ],
        [
          8,
          'Eyelike fixtures emit bright light in a 30-foot radius and dim light for an additional 30 feet.',
          'The light turns off.',
        ],
        [
          9,
          'The apparatus sinks as much as 20 feet in liquid.',
          'The apparatus rises up to 20 feet in liquid.',
        ],
        [
          10,
          'The rear hatch unseals and opens.',
          'The rear hatch closes and seals.',
        ],
      ],
    },
    expectedRows: 10,
  },
  {
    name: 'Armor of Resistance',
    columns: ['d10', 'Damage Type'],
    anchorHeading: 'Armor of Resistance',
    anchor: 'item',
    headerLines: ['d10 Damage Type d10 Damage Type'],
    rows: {
      kind: 'paired-line-per-row',
      pattern:
        /^(\d+) (Acid|Cold|Fire|Force|Lightning) (\d+) (Necrotic|Poison|Psychic|Radiant|Thunder)$/,
      columnCount: 2,
      integerColumns: [0],
    },
    expectedRows: 10,
  },
  {
    name: 'Candle of Invocation',
    columns: ['d20', 'Alignment'],
    anchorHeading: 'Candle of Invocation',
    anchor: 'item',
    headerLines: ['d20 Alignment'],
    rows: {
      kind: 'line-per-row',
      pattern: /^(\d+(?:–\d+)?) (.+)$/,
    },
    expectedRows: 9,
  },
  {
    name: 'Carpet of Flying',
    columns: ['d100', 'Size', 'Capacity', 'Flying Speed'],
    anchorHeading: 'Carpet of Flying',
    anchor: 'item',
    headerLines: ['d100 Size Capacity Flying Speed'],
    rows: {
      kind: 'line-per-row',
      pattern: /^(\d+–\d+) (.+?) (\d+ lb\.) (\d+ feet)$/,
    },
    expectedRows: 4,
  },
  {
    name: 'Cube of Force Faces',
    columns: ['Face', 'Charges', 'Effect'],
    anchorHeading: 'Cube of Force Faces',
    anchor: 'caption',
    headerLines: ['Face Charges Effect'],
    rows: {
      kind: 'wrapped-last-column',
      start: /^([1-6]) (\d) (.+)$/,
    },
    expectedRows: 6,
  },
  {
    name: 'Cube of Force Charges Lost',
    columns: ['Spell or Item', 'Charges Lost'],
    anchorHeading: 'Cube of Force Faces',
    anchor: 'item',
    headerLines: ['Spell or Item Charges Lost'],
    searchPastCellRuns: true,
    rows: {
      kind: 'line-per-row',
      pattern: /^(.+?) (1d(?:4|6|10|12|20))$/,
    },
    expectedRows: 5,
  },
  {
    name: 'Deck of Illusions',
    columns: ['Playing Card', 'Illusion'],
    anchorHeading: 'Deck of Illusions',
    anchor: 'item',
    headerLines: ['Playing Card Illusion'],
    rows: {
      kind: 'line-per-row',
      pattern:
        /^((?:(?:Ace|King|Queen|Jack|Ten|Nine|Eight|Two) of (?:hearts|diamonds|spades|clubs))|Jokers \(2\)) (.+)$/,
    },
    expectedRows: 33,
  },
  {
    name: 'Deck of Many Things',
    columns: ['Playing Card', 'Card'],
    anchorHeading: 'Deck of Many Things',
    anchor: 'item',
    headerLines: ['Playing Card Card'],
    rows: {
      kind: 'line-per-row',
      pattern:
        /^((?:(?:Ace|King|Queen|Jack|Two) of (?:diamonds|hearts|clubs|spades))|Joker \((?:with|without) TM\)) (.+)$/,
    },
    expectedRows: 22,
    legend: {
      pattern: /^\*Found only in a deck with twenty-two cards\.?$/,
    },
  },
  {
    name: 'Dragon Scale Mail',
    columns: ['Dragon', 'Resistance'],
    anchorHeading: 'Dragon Scale Mail',
    anchor: 'item',
    headerLines: ['Dragon Resistance Dragon Resistance'],
    rows: {
      kind: 'paired-line-per-row',
      pattern: new RegExp(
        `^(${DRAGON_COLOR}) (${DRAGON_DAMAGE}) (${DRAGON_COLOR}) (${DRAGON_DAMAGE})$`,
      ),
      columnCount: 2,
    },
    expectedRows: 10,
  },
  {
    name: 'Efreeti Bottle',
    columns: ['d100', 'Effect'],
    anchorHeading: 'Efreeti Bottle',
    anchor: 'item',
    headerLines: ['d100 Effect'],
    rows: { kind: 'wrapped-last-column', start: D100_WRAPPED_ROW_START },
    expectedRows: 3,
  },
  {
    name: 'Elemental Gem',
    columns: ['Gem', 'Summoned Elemental'],
    anchorHeading: 'Elemental Gem',
    anchor: 'item',
    headerLines: ['Gem Summoned Elemental'],
    rows: {
      kind: 'line-per-row',
      pattern:
        /^(Blue sapphire|Yellow diamond|Red corundum|Emerald) (.+ elemental)$/,
    },
    expectedRows: 4,
  },
  {
    name: 'Feather Token',
    columns: ['d100', 'Feather Token'],
    anchorHeading: 'Feather Token',
    anchor: 'item',
    headerLines: ['d100 Feather Token d100 Feather Token'],
    rows: {
      kind: 'paired-line-per-row',
      pattern: /^(\d+–\d+) (.+?) (\d+–\d+) (.+)$/,
      columnCount: 2,
    },
    expectedRows: 6,
  },
  {
    name: 'Horn of Valhalla',
    columns: ['d100', 'Horn Type', 'Berserkers Summoned', 'Requirement'],
    anchorHeading: 'Horn of Valhalla',
    anchor: 'item',
    headerLines: ['d100 Horn Berserkers Requirement', 'Type Summoned'],
    rows: {
      kind: 'wrapped-last-column',
      start: /^(\d+–\d+) (Silver|Brass|Bronze|Iron) (\dd4 \+ \d) (.+)$/,
    },
    expectedRows: 4,
  },
  {
    name: 'Iron Flask',
    columns: ['d100', 'Contents'],
    anchorHeading: 'Iron Flask',
    anchor: 'item',
    headerLines: ['d100 Contents'],
    rows: {
      kind: 'reviewed-reconstruction',
      sourceLines: [
        'Empty',
        '1 50',
        'Demon (type 1)',
        '51 54',
        'Demon (type 2)',
        '55 58',
        'Demon (type 3)',
        '59 62',
        'Demon (type 4)',
        '63 64',
        '65 Demon (type 5)',
        '66 Demon (type 6)',
        '67 Deva',
        'Devil (greater)',
        '68 69',
        'Devil (lesser)',
        '70 73',
        'Djinni',
        '74 75',
        'Efreeti',
        '76 77',
        'Elemental (any)',
        '78 83',
        'Invisible stalker',
        '84 86',
        'Night hag',
        '87 90',
        '91 Planetar',
        'Salamander',
        '92 95',
        '96 Solar',
        'Succubus/incubus',
        '97 99',
        '100 Xorn',
      ],
      rows: [
        ['01–50', 'Empty'],
        ['51–54', 'Demon (type 1)'],
        ['55–58', 'Demon (type 2)'],
        ['59–62', 'Demon (type 3)'],
        ['63–64', 'Demon (type 4)'],
        ['65', 'Demon (type 5)'],
        ['66', 'Demon (type 6)'],
        ['67', 'Deva'],
        ['68–69', 'Devil (greater)'],
        ['70–73', 'Devil (lesser)'],
        ['74–75', 'Djinni'],
        ['76–77', 'Efreeti'],
        ['78–83', 'Elemental (any)'],
        ['84–86', 'Invisible stalker'],
        ['87–90', 'Night hag'],
        ['91', 'Planetar'],
        ['92–95', 'Salamander'],
        ['96', 'Solar'],
        ['97–99', 'Succubus/incubus'],
        ['100', 'Xorn'],
      ],
    },
    expectedRows: 20,
  },
  {
    name: 'Manual of Golems',
    columns: ['d20', 'Golem', 'Time', 'Cost'],
    anchorHeading: 'Manual of Golems',
    anchor: 'item',
    headerLines: ['d20 Golem Time Cost'],
    rows: {
      kind: 'line-per-row',
      pattern:
        /^(\d+(?:–\d+)?) (Clay|Flesh|Iron|Stone) (\d+ days) ([\d,]+ gp)$/,
    },
    expectedRows: 4,
  },
  {
    name: 'Necklace of Prayer Beads',
    columns: ['d20', 'Bead of …', 'Spell'],
    anchorHeading: 'Necklace of Prayer Beads',
    anchor: 'item',
    headerLines: ['d20 Bead of … Spell'],
    rows: {
      kind: 'reviewed-reconstruction',
      sourceLines: [
        '1–6 Blessing Bless',
        '7–12 Curing Cure wounds (2nd level) or lesser',
        'restoration',
        '13–16 Favor Greater restoration',
        '17–18 Smiting Branding smite',
        '19 Summons Planar ally',
        '20 Wind Wind walk',
        'walking',
      ],
      rows: [
        ['1–6', 'Blessing', 'Bless'],
        ['7–12', 'Curing', 'Cure wounds (2nd level) or lesser restoration'],
        ['13–16', 'Favor', 'Greater restoration'],
        ['17–18', 'Smiting', 'Branding smite'],
        ['19', 'Summons', 'Planar ally'],
        ['20', 'Wind walking', 'Wind walk'],
      ],
    },
    expectedRows: 6,
  },
  {
    name: 'Potion of Resistance',
    columns: ['d10', 'Damage Type'],
    anchorHeading: 'Potion of Resistance',
    anchor: 'item',
    headerLines: ['d10 Damage Type d10 Damage Type'],
    rows: {
      kind: 'paired-line-per-row',
      pattern:
        /^(\d+) (Acid|Cold|Fire|Force|Lightning) (\d+) (Necrotic|Poison|Psychic|Radiant|Thunder)$/,
      columnCount: 2,
      integerColumns: [0],
    },
    expectedRows: 10,
  },
  {
    name: 'Ring of Resistance',
    columns: ['d10', 'Damage Type', 'Gem'],
    anchorHeading: 'Ring of Resistance',
    anchor: 'item',
    headerLines: ['d10 Damage Type Gem'],
    rows: {
      kind: 'line-per-row',
      pattern: /^(\d+) (\S+) (.+)$/,
      integerColumns: [0],
    },
    expectedRows: 10,
  },
  {
    name: 'Ring of Shooting Stars',
    columns: ['Spheres', 'Lightning Damage'],
    anchorHeading: 'Ring of Shooting Stars',
    anchor: 'item',
    headerLines: ['Spheres Lightning Damage'],
    rows: {
      kind: 'line-per-row',
      pattern: /^(\d+) (\dd\d+)$/,
      integerColumns: [0],
    },
    expectedRows: 4,
  },
  {
    name: 'Spell Scroll',
    columns: ['Spell Level', 'Rarity', 'Save DC', 'Attack Bonus'],
    anchorHeading: 'Spell Scroll',
    anchor: 'caption',
    headerLines: ['Spell Level Rarity Save DC Attack Bonus'],
    rows: {
      kind: 'line-per-row',
      pattern:
        /^(Cantrip|[1-9](?:st|nd|rd|th)) (Common|Uncommon|Rare|Very rare|Legendary) (\d+) (\+\d+)$/,
      integerColumns: [2],
    },
    expectedRows: 10,
  },
  {
    name: 'Sphere of Annihilation',
    columns: ['d100', 'Result'],
    anchorHeading: 'Sphere of Annihilation',
    anchor: 'item',
    headerLines: ['d100 Result'],
    rows: { kind: 'wrapped-last-column', start: D100_WRAPPED_ROW_START },
    expectedRows: 3,
  },
  ...['Staff of Power', 'Staff of the Magi'].map(
    (name): DocumentTableSpec => ({
      name,
      columns: ['Distance from Origin', 'Damage'],
      anchorHeading: name,
      anchor: 'item',
      headerLines: ['Distance from Origin Damage'],
      rows: {
        kind: 'line-per-row',
        pattern:
          /^(.+? away(?: or closer)?) ([468] × the number of charges in the staff)$/,
      },
      expectedRows: 3,
    }),
  ),
  {
    name: 'Sentient Magic Item Communication',
    columns: ['d100', 'Communication'],
    anchorHeading: 'Communication',
    anchor: 'item',
    headerLines: ['d100 Communication'],
    rows: { kind: 'wrapped-last-column', start: D100_WRAPPED_ROW_START },
    expectedRows: 3,
  },
  {
    name: 'Sentient Magic Item Senses',
    columns: ['d4', 'Senses'],
    anchorHeading: 'Senses',
    anchor: 'item',
    headerLines: ['d4 Senses'],
    rows: {
      kind: 'line-per-row',
      pattern: /^([1-4]) (.+)$/,
      integerColumns: [0],
    },
    expectedRows: 4,
  },
  {
    name: 'Sentient Magic Item Alignment',
    columns: ['d100', 'Alignment'],
    anchorHeading: 'Alignment',
    anchor: 'item',
    headerLines: ['d100 Alignment d100 Alignment'],
    rows: {
      kind: 'paired-line-per-row',
      pattern:
        /^(\d+–\d+) (Lawful good|Neutral good|Chaotic good|Lawful neutral|Neutral)(?: (\d+–\d+) (Chaotic neutral|Lawful evil|Neutral evil|Chaotic evil))?$/,
      columnCount: 2,
    },
    expectedRows: 9,
  },
  {
    name: 'Sentient Magic Item Special Purpose',
    columns: ['d10', 'Purpose'],
    anchorHeading: 'Special Purpose',
    anchor: 'item',
    headerLines: ['d10 Purpose'],
    rows: {
      kind: 'wrapped-last-column',
      start: /^(\d+) (.+)$/,
    },
    expectedRows: 10,
  },
];

function flatten(pages: readonly PageText[]): readonly Row[] {
  return pages.flatMap((page) =>
    page.lines.map((text, lineIndex) => ({
      page: page.pageNumber,
      text: text.trim(),
      height: page.lineHeights?.[lineIndex],
    })),
  );
}

function normalizeWhitespace(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

/** Hyphen-aware wrapped-cell join (same convention as parseTables.ts). */
function joinWrappedCell(parts: readonly string[]): string {
  let out = '';
  for (const raw of parts) {
    const part = normalizeWhitespace(raw);
    if (part.length === 0) continue;
    if (out.endsWith('-') && /^[a-z]/.test(part)) {
      out += part;
    } else {
      out += `${out.length === 0 ? '' : ' '}${part}`;
    }
  }
  return out;
}

/** True when the line renders at the record-leaf-or-higher heading tiers. */
function isHeadingTier(height: number | undefined): boolean {
  const tier = classifyTier(height);
  return (
    tier === 'chapter' ||
    tier === 'section' ||
    tier === 'subsection' ||
    tier === 'leaf'
  );
}

/** How many lines an `item`-anchored spec may scan for its header line. */
const MAX_ITEM_BODY_SCAN_LINES = 120;

/**
 * Locate the spec's header-line position: the index of the FIRST header line.
 * For `caption` anchors the header must follow the anchor immediately; for
 * `item` anchors the header must be the first cell-tier line of the entry
 * body, before any other heading. Returns undefined when the headers do not
 * verify at this anchor occurrence.
 */
function findHeaderAt(
  rows: readonly Row[],
  anchorIdx: number,
  spec: DocumentTableSpec,
): number | undefined {
  let headerIdx: number | undefined;
  if (spec.anchor === 'caption') {
    headerIdx = anchorIdx + 1;
  } else {
    const end = Math.min(rows.length, anchorIdx + 1 + MAX_ITEM_BODY_SCAN_LINES);
    for (let i = anchorIdx + 1; i < end; i++) {
      if (isHeadingTier(rows[i].height)) return undefined; // next entry began
      if (isTableCell(rows[i].height)) {
        const firstHeaderMatches =
          normalizeWhitespace(rows[i].text) === spec.headerLines[0];
        if (firstHeaderMatches) {
          headerIdx = i;
          break;
        }
        if (!spec.searchPastCellRuns) return undefined;
      }
    }
  }
  if (headerIdx === undefined) return undefined;
  for (let h = 0; h < spec.headerLines.length; h++) {
    const row = rows[headerIdx + h];
    if (row === undefined) return undefined;
    if (!isTableCell(row.height)) return undefined;
    if (normalizeWhitespace(row.text) !== spec.headerLines[h]) {
      return undefined;
    }
  }
  return headerIdx;
}

/**
 * Locate a class-progression table's pinned source block(s) after its caption
 * anchor and verify them exactly (eshyra-4a7.6). Each block is found in order
 * by its first line at table-cell tier, then every line of the block must
 * match verbatim and render at cell tier; a mismatch fails the table closed
 * (returns undefined). The search is bounded to the anchor's own chapter — it
 * stops at the next chapter-tier heading (the next class) so a block-start
 * string that recurs in a later class chapter can never be claimed here. When
 * a block's first-line text recurs WITHIN the chapter, every occurrence is
 * tried until one verifies in full. Returns the page of the first block.
 */
function locateClassProgression(
  rows: readonly Row[],
  anchorIdx: number,
  sourceBlocks: readonly (readonly string[])[],
): { readonly page: number } | undefined {
  let limit = rows.length;
  for (let j = anchorIdx + 1; j < rows.length; j++) {
    if (classifyTier(rows[j].height) === 'chapter') {
      limit = j;
      break;
    }
  }
  let searchFrom = anchorIdx + 1;
  let firstPage: number | undefined;
  for (const block of sourceBlocks) {
    if (block.length === 0) return undefined;
    let matchedAt: number | undefined;
    for (let j = searchFrom; j < limit; j++) {
      if (!isTableCell(rows[j].height)) continue;
      if (normalizeWhitespace(rows[j].text) !== block[0]) continue;
      // Candidate start: verify the whole block contiguously at cell tier.
      let ok = true;
      for (let k = 0; k < block.length; k++) {
        const row = rows[j + k];
        if (
          row === undefined ||
          !isTableCell(row.height) ||
          normalizeWhitespace(row.text) !== block[k]
        ) {
          ok = false;
          break;
        }
      }
      if (ok) {
        matchedAt = j;
        break;
      }
    }
    if (matchedAt === undefined) return undefined;
    if (firstPage === undefined) firstPage = rows[matchedAt].page;
    searchFrom = matchedAt + block.length;
  }
  return firstPage === undefined ? undefined : { page: firstPage };
}

/** The contiguous cell-tier run starting right after the header lines. */
function cellRunAfter(
  rows: readonly Row[],
  headerIdx: number,
  headerLineCount: number,
): readonly Row[] {
  const start = headerIdx + headerLineCount;
  let end = start;
  while (end < rows.length && isTableCell(rows[end].height)) end += 1;
  return rows.slice(start, end);
}

function collectRows(
  run: readonly Row[],
  rule: RowRule,
): readonly (readonly unknown[])[] {
  switch (rule.kind) {
    case 'line-per-row': {
      const out: (readonly unknown[])[] = [];
      for (const row of run) {
        const match = rule.pattern.exec(normalizeWhitespace(row.text));
        if (match === null) break;
        out.push(
          match
            .slice(1)
            .map((cell, columnIdx) =>
              (rule.integerColumns ?? []).includes(columnIdx)
                ? Number.parseInt(cell, 10)
                : cell,
            ),
        );
      }
      return out;
    }
    case 'wrapped-last-column': {
      const out: string[][] = [];
      for (const row of run) {
        const text = normalizeWhitespace(row.text);
        const match = rule.start.exec(text);
        if (match !== null) {
          out.push([
            ...match.slice(1, -1).map(normalizeWhitespace),
            match[match.length - 1],
          ]);
          continue;
        }
        if (out.length === 0) break;
        const last = out[out.length - 1];
        last[last.length - 1] = joinWrappedCell([last[last.length - 1], text]);
      }
      return out;
    }
    case 'wrapped-features-column': {
      const out: string[][] = [];
      for (const row of run) {
        const text = normalizeWhitespace(row.text);
        const match = rule.start.exec(text);
        if (match !== null) {
          out.push([match[1], match[2], match[3], match[4], match[5]]);
          continue;
        }
        if (out.length === 0) break;
        const last = out[out.length - 1];
        last[2] = joinWrappedCell([last[2], text]);
      }
      return out;
    }
    case 'paired-line-per-row': {
      const left: (readonly unknown[])[] = [];
      const right: (readonly unknown[])[] = [];
      for (const row of run) {
        const match = rule.pattern.exec(normalizeWhitespace(row.text));
        if (match === null) break;
        const captures = match.slice(1);
        for (
          let offset = 0;
          offset < captures.length;
          offset += rule.columnCount
        ) {
          const cells = captures.slice(offset, offset + rule.columnCount);
          if (cells[0] === undefined) continue;
          const parsed = cells.map((cell, columnIdx) =>
            (rule.integerColumns ?? []).includes(columnIdx)
              ? Number.parseInt(cell, 10)
              : cell,
          );
          (offset === 0 ? left : right).push(parsed);
        }
      }
      return [...left, ...right];
    }
    case 'reviewed-reconstruction': {
      const actual = run
        .slice(0, rule.sourceLines.length)
        .map((row) => normalizeWhitespace(row.text));
      if (
        actual.length !== rule.sourceLines.length ||
        actual.some((line, index) => line !== rule.sourceLines[index])
      ) {
        return [];
      }
      return rule.rows.map((row) => [...row]);
    }
    case 'class-progression-reconstruction':
      // Located and reconstructed directly in parseSpec via
      // locateClassProgression; never routed through cellRunAfter/collectRows.
      throw new Error(
        'class-progression-reconstruction must be handled in parseSpec',
      );
  }
}

function parseSpec(
  rows: readonly Row[],
  spec: DocumentTableSpec,
): TableExtraction | undefined {
  for (let i = 0; i < rows.length; i++) {
    // Collapse inner whitespace: column-spaced headings ("School   of
    // Evocation") arrive with multi-space gaps.
    if (normalizeWhitespace(rows[i].text) !== spec.anchorHeading) continue;
    if (classifyTier(rows[i].height) !== (spec.anchorTier ?? 'leaf')) continue;
    // Class progression tables locate their pinned source block(s) past the
    // interleaved proficiency/Equipment prose, then return reviewed rows; they
    // never use the caption-immediate header + contiguous-run path below.
    if (spec.rows.kind === 'class-progression-reconstruction') {
      const located = locateClassProgression(rows, i, spec.rows.sourceBlocks);
      if (located === undefined) continue; // try the next anchor occurrence
      const tableRows = spec.rows.rows.map((row) => [...row]);
      if (tableRows.length !== spec.expectedRows) return undefined;
      return {
        name: spec.name,
        columns: [...spec.columns],
        rows: tableRows,
        sourcePage: located.page,
        ownerRecordKey:
          spec.ownerRecordKey ?? EMBEDDED_TABLE_PROSE_OWNERS[spec.name],
      };
    }
    const headerIdx = findHeaderAt(rows, i, spec);
    if (headerIdx === undefined) continue; // try the next anchor occurrence
    const run = cellRunAfter(rows, headerIdx, spec.headerLines.length);
    const tableRows = collectRows(run, spec.rows);
    // Fail closed: a located table whose rows drift in count or shape emits
    // nothing, so the table-name baseline catches it before output is written.
    if (tableRows.length !== spec.expectedRows) return undefined;
    // Verbatim linearization of the table's source region as a prose joiner
    // renders it (eshyra-3anh): for a printed-caption anchor the caption line
    // is part of the absorbed span; an item-anchored table's anchor is the
    // owning entry heading, so the span starts at the header line. The cell-tier
    // run is, by definition, table content rather than prose, so this span never
    // includes surrounding prose. Stripping it from the owner's description/text
    // leaves the structured table:* record as the sole representation.
    const spanStart = spec.anchor === 'caption' ? i : headerIdx;
    const spanEnd = headerIdx + spec.headerLines.length + run.length;
    const proseSourceText = rows
      .slice(spanStart, spanEnd)
      .map((row) => row.text)
      .join(' ');
    const legend =
      spec.legend === undefined
        ? undefined
        : run
            .map((row) => normalizeWhitespace(row.text))
            .filter((text) => spec.legend?.pattern.test(text));
    return {
      name: spec.name,
      columns: [...spec.columns],
      rows: tableRows,
      ...(legend === undefined || legend.length === 0 ? {} : { legend }),
      sourcePage: rows[headerIdx].page,
      ownerRecordKey:
        spec.ownerRecordKey ?? EMBEDDED_TABLE_PROSE_OWNERS[spec.name],
      proseSourceText,
    };
  }
  return undefined;
}

/**
 * Parse every reviewed document-wide table spec against the full extracted
 * document. Specs whose anchors do not verify (reduced or uniform-font
 * fixtures) are skipped; the real import's table-name baseline enforces that
 * all of them parse. Results are name-sorted like `parseTables`.
 */
export function parseDocumentTables(
  pages: readonly PageText[],
  specs: readonly DocumentTableSpec[] = SRD_5_1_DOCUMENT_TABLE_SPECS,
): TableExtraction[] {
  const rows = flatten(pages);
  const tables = specs
    .map((spec) => parseSpec(rows, spec))
    .filter((table): table is TableExtraction => table !== undefined);
  tables.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  return tables;
}
