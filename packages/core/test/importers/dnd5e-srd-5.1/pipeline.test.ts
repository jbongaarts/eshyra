/**
 * End-to-end pipeline test for the D&D 5e SRD 5.1 importer.
 *
 * Generates a small fixture PDF at test time using pdfkit (so no binary
 * fixture has to live in the repo), runs the full importer (extract → parse
 * → emit), and round-trips through `loadRulesPackFromDirectory` to confirm
 * the produced files load and validate.
 *
 * The fixture PDF mimics the SRD layout closely enough to exercise the
 * spell-stat-block parser and the class-spell-list parser, but is much
 * smaller than the real SRD. The full SRD PDF is the responsibility of
 * `loreweaver-0m9.6`'s coverage tests once vendored.
 */

import {
  createWriteStream,
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import PDFDocument from 'pdfkit';
import { afterEach, describe, expect, it } from 'vitest';
import {
  BackgroundCoverageError,
  ClassCoverageError,
  CreatureCoverageError,
  FeatureCoverageError,
  NpcCoverageError,
  RuleCoverageError,
  runImporter as runCanonicalImporter,
  SubclassCoverageError,
  TableCoverageError,
  TrapCoverageError,
} from '../../../scripts/importers/dnd5e-srd-5.1/index.js';
import { SectionNotFoundError } from '../../../scripts/importers/dnd5e-srd-5.1/sections.js';
import {
  ignoreRule,
  SourceInventoryCoverageError,
} from '../../../scripts/importers/dnd5e-srd-5.1/sourceInventoryCoverage.js';
import { loadRulesPackFromDirectory } from '../../../src/internal.js';

const tmpDirs: string[] = [];

const runImporter = (input: Parameters<typeof runCanonicalImporter>[0]) =>
  runCanonicalImporter({
    ...input,
    allowSyntheticSpellSourceBindings: true,
  });

afterEach(() => {
  for (const dir of tmpDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function makeTmpDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'srd-importer-pipeline-'));
  tmpDirs.push(dir);
  return dir;
}

interface FixtureLine {
  readonly text: string;
  /** Optional explicit gap before this line. */
  readonly leadingGap?: number;
}

interface FixturePage {
  readonly lines: ReadonlyArray<string | FixtureLine>;
}

async function writeFixturePdf(
  filePath: string,
  pages: readonly FixturePage[],
): Promise<void> {
  // size: LETTER (612 x 792 pt), small margins so we fit ~50 lines per page.
  const doc = new PDFDocument({
    size: 'LETTER',
    margin: 40,
    autoFirstPage: false,
  });
  const stream = createWriteStream(filePath);
  doc.pipe(stream);
  doc.font('Helvetica').fontSize(11);

  pages.forEach((page, i) => {
    doc.addPage();
    for (const entry of page.lines) {
      if (typeof entry === 'string') {
        doc.text(entry);
      } else {
        if (entry.leadingGap !== undefined && entry.leadingGap > 0) {
          doc.moveDown(entry.leadingGap);
        }
        doc.text(entry.text);
      }
    }
    // Mark page i+1 explicitly (we don't read this; the parser uses
    // PageText.pageNumber from extract.ts, which counts pages in order).
    void i;
  });

  doc.end();
  await new Promise<void>((resolve, reject) => {
    stream.on('finish', () => resolve());
    stream.on('error', reject);
  });
}

// The fixture deliberately mirrors the SRD 5.1 chapter ordering: spell-lists
// chapter precedes spell-descriptions chapter. Default section anchors
// (`SRD_5_1_DEFAULT_SECTION_ANCHORS`) discriminate the two by exact heading
// match.
const SPELL_LISTS_PAGE: FixturePage = {
  lines: [
    'Spell Lists',
    'Wizard Spells',
    'Cantrips (0 Level)',
    'Acid Splash',
    '',
    '1st Level',
    'Magic Missile',
    '',
    'Sorcerer Spells',
    'Cantrips (0 Level)',
    'Acid Splash',
    '',
    '1st Level',
    'Magic Missile',
  ],
};

const SPELLS_PAGE: FixturePage = {
  lines: [
    'Spells',
    'Acid Splash',
    'Conjuration cantrip',
    'Casting Time: 1 action',
    'Range: 60 feet',
    'Components: V, S',
    'Duration: Instantaneous',
    'You hurl a bubble of acid. Choose one creature you can see within range.',
    '',
    'Magic Missile',
    '1st-level evocation',
    'Casting Time: 1 action',
    'Range: 120 feet',
    'Components: V, S',
    'Duration: Instantaneous',
    'You create three glowing darts of magical force.',
    'At Higher Levels. When you cast this spell using a spell slot of 2nd level or higher, the spell creates one more dart for each slot level above 1st.',
    'MAGIC_MISSILE_FINAL_LINE_THAT_MUST_NOT_BE_DROPPED.',
  ],
};

// Closing chapter so the spell-descriptions anchor has an end heading to find,
// and the source slice for the creature parser. Carries one full Goblin stat
// block so runImporter emits a creature record, then the "Nonplayer Characters"
// heading that bounds the Monsters section (monsters anchor requireEndHeading
// is true), so the chapters that follow in the fixture are excluded from the
// monsters slice.
const MONSTERS_PAGE: FixturePage = {
  lines: [
    'Monsters',
    'Goblin',
    'Small humanoid (goblinoid), neutral evil',
    'Armor Class 15 (leather armor, shield)',
    'Hit Points 7 (2d6)',
    'Speed 30 ft.',
    'STR DEX CON INT WIS CHA',
    '8 (−1) 14 (+2) 10 (+0) 10 (+0) 8 (−1) 8 (−1)',
    'Senses darkvision 60 ft., passive Perception 9',
    'Languages Common, Goblin',
    'Challenge 1/4 (50 XP)',
    'Nonplayer Characters',
  ],
};

// Monsters fixture without the end heading that bounds the section. With
// requireEndHeading: true on the monsters anchor, the importer must fail closed
// rather than slice to EOF and feed trailing content to the creature parser.
const MONSTERS_PAGE_MISSING_END: FixturePage = {
  lines: [
    'Monsters',
    'Goblin',
    'Small humanoid (goblinoid), neutral evil',
    'Armor Class 15 (leather armor, shield)',
    'Hit Points 7 (2d6)',
    'Speed 30 ft.',
    'STR DEX CON INT WIS CHA',
    '8 (−1) 14 (+2) 10 (+0) 10 (+0) 8 (−1) 8 (−1)',
    'Challenge 1/4 (50 XP)',
  ],
};

// Monsters fixture whose section is found and properly bounded, but contains
// no parseable stat block. Exercises the empty-result coverage guard.
const MONSTERS_PAGE_NO_CREATURES: FixturePage = {
  lines: [
    'Monsters',
    'This chapter describes monsters, but the stat blocks did not extract.',
    'Nonplayer Characters',
  ],
};

// Appendix MM-B: Nonplayer Characters fixture (loreweaver-bn0). The
// nonplayerCharacters anchor starts at this heading and runs to EOF, so this
// page is placed LAST in fixtures that use it. Carries one full NPC stat block
// (Bandit Captain) so runImporter emits a `creature` record tagged
// data.category='npc'.
const NONPLAYER_CHARACTERS_PAGE: FixturePage = {
  lines: [
    'Appendix MM-B: Nonplayer Characters',
    'Bandit Captain',
    'Medium humanoid (any race), any non-lawful',
    'Armor Class 15 (studded leather)',
    'Hit Points 65 (10d8 + 20)',
    'Speed 30 ft.',
    'STR DEX CON INT WIS CHA',
    '15 (+2) 16 (+3) 14 (+2) 14 (+2) 11 (+0) 14 (+2)',
    'Challenge 2 (450 XP)',
  ],
};

const TREASURE_TABLES_PAGE: FixturePage = {
  lines: [
    'Treasure',
    'Individual Treasure: Challenge 0-4',
    'd100',
    'CP',
    'SP',
    'EP',
    'GP',
    'PP',
    '01-30',
    '31-60',
    '61-70',
    '5d6 (17)',
    '-',
    '-',
    '-',
    '4d6 (14)',
    '-',
    '-',
    '-',
    '3d6 (10)',
    '-',
    '-',
    '-',
    '-',
    '-',
    '-',
    '',
    'Treasure Hoard: Challenge 0-4',
    'd100',
    'CP',
    'SP',
    'GP',
    'Gems or Art Objects',
    'Magic Items',
    '01-06',
    '07-16',
    '17-26',
    '6d6 x 100 (2,100)',
    '6d6 x 100 (2,100)',
    '6d6 x 100 (2,100)',
    '3d6 x 100 (1,050)',
    '3d6 x 100 (1,050)',
    '3d6 x 100 (1,050)',
    '2d6 x 10 (70)',
    '2d6 x 10 (70)',
    '2d6 x 10 (70)',
    '-',
    '2d6 (7) 10 gp gems',
    '2d4 (5) 25 gp art objects',
    '-',
    '-',
    'Table A',
  ],
};

const TREASURE_TABLES_PAGE_MISSING_END: FixturePage = {
  lines: [
    'Treasure',
    'Individual Treasure: Challenge 0-4',
    'd100',
    'CP',
    '01-30',
    '5d6 (17)',
  ],
};

const MAGIC_ITEMS_PAGE: FixturePage = {
  lines: [
    'Magic Items',
    'Using Magic Items',
    'Magic items are gleaned from the hoards of conquered monsters.',
    'Magic Items A-Z',
    'Magic items are presented in alphabetical order.',
    'Adamantine Armor',
    'Armor (medium or heavy, but not hide), uncommon',
    'This suit of armor is reinforced with adamantine.',
    'Apparatus of the Crab',
    'Wondrous item, legendary',
    'The apparatus of the Crab is a Large object with the following statistics:',
    'Armor Class: 20',
    'Apparatus of the Crab Levers',
    'Lever Up Down',
    '1 Legs and tail extend. Legs and tail retract.',
    'Sentient Magic Items',
  ],
};

const COMBAT_ACTIONS_PAGE: FixturePage = {
  lines: [
    'Actions in Combat',
    'Attack',
    'The most common action to take in combat is the Attack action.',
    '',
    'Cast a Spell',
    'Spellcasters can use their action to cast a spell with a casting time of 1 action.',
    '',
    'Dash',
    'When you take the Dash action, you gain extra movement for the current turn.',
    '',
    'Disengage',
    "If you take the Disengage action, your movement doesn't provoke opportunity attacks.",
    '',
    'Dodge',
    'When you take the Dodge action, you focus entirely on avoiding attacks.',
    '',
    'Help',
    'You can lend your aid to another creature in the completion of a task.',
    '',
    'Hide',
    'You make a Dexterity (Stealth) check in an attempt to hide.',
    '',
    'Ready',
    'First, you decide what perceivable circumstance will trigger your reaction.',
    '',
    'Search',
    'You devote your attention to finding something.',
    '',
    'Use an Object',
    'You normally interact with an object while doing something else.',
  ],
};

const MAKING_AN_ATTACK_PAGE: FixturePage = {
  lines: [
    'Making an Attack',
    'Whether you are striking with a melee weapon, firing a weapon at range,',
    'or making an attack roll as part of a spell, an attack has a simple structure.',
  ],
};

const COMBAT_ACTIONS_PAGE_MISSING_END: FixturePage = {
  lines: [
    'Actions in Combat',
    'Attack',
    'The most common action to take in combat is the Attack action.',
    '',
    'Cast a Spell',
    'Spellcasters can use their action to cast a spell with a casting time of 1 action.',
    '',
    'Use an Object',
    'You normally interact with an object while doing something else.',
    '',
    'Later combat prose without an ending chapter heading',
    'This line should not be consumed by the action parser to EOF.',
  ],
};

// Hazards + Traps fixture. The "Dungeon Hazards" heading matches the hazards
// startHeading anchor (Brown Mold only here; 4 in the real SRD), and the "Traps"
// heading below is BOTH the hazards end heading AND the traps startHeading
// anchor (loreweaver-hvp) — mirroring the real SRD, where the gamemastering
// "Traps" section immediately follows. The traps slice runs "Traps" → "Diseases"
// and carries the two trap reference tables and the alphabetic sample traps
// (one mechanical, one magic here; eight in the real SRD). Sample traps emit
// under the `hazard` kind. En-dash ranges mirror the SRD typography.
const HAZARDS_PAGE: FixturePage = {
  lines: [
    'Dungeon Hazards',
    'Brown Mold',
    'Brown mold feeds on warmth, draining heat from everything nearby.',
    '',
    'Traps',
    'A trap can be either mechanical or magical in nature.',
    'Trap Save DCs and Attack Bonuses',
    'Trap Danger Save DC Attack Bonus',
    'Setback 10–11 +3 to +5',
    'Dangerous 12–15 +6 to +8',
    'Deadly 16–20 +9 to +12',
    'Damage Severity by Level',
    'Character Level Setback Dangerous Deadly',
    '1st–4th 1d10 2d10 4d10',
    '5th–10th 2d10 4d10 10d10',
    '11th–16th 4d10 10d10 18d10',
    '17th–20th 10d10 18d10 24d10',
    'Sample Traps',
    'Collapsing Roof',
    'Mechanical trap',
    'This trap uses a trip wire to collapse an unstable section of ceiling.',
    'Fire-Breathing Statue',
    'Magic trap',
    'This trap releases a magical gout of flame from a nearby statue.',
    'Diseases',
  ],
};

// Hazards fixture without the end heading. This reproduces the bug where the
// importer would otherwise run hazards to EOF and absorb later text.
const HAZARDS_PAGE_MISSING_END: FixturePage = {
  lines: [
    'Dungeon Hazards',
    'Brown Mold',
    'Brown mold feeds on warmth, draining heat from everything nearby.',
    '',
    'Later DM tools prose',
    'This text should not be included in the hazards section.',
  ],
};

const MADNESS_PAGE_ONE: FixturePage = {
  lines: [
    'Madness',
    'A horror-themed campaign can use madness to reinforce that theme.',
    'Going Mad',
    'Magical effects, diseases, poisons, and planar effects can inflict madness.',
    'Madness Effects',
    'Madness can be short-term, long-term, or indefinite.',
    'Short-Term Madness',
    'd100 Effect (lasts 1d10 minutes)',
    '01–20 Short effect one.',
    '21–30 Short effect two.',
    '31–40 Short effect three.',
    '41–50 Short effect four.',
    '51–60 Short effect five.',
    '61–70 Short effect six.',
    '71–75 Short effect seven.',
    '76–80 Short effect eight.',
    '81–90 Short effect nine.',
    '91–100 Short effect ten.',
    'Long-Term Madness',
    'd100 Effect (lasts 1d10 × 10 hours)',
    '01–10 Long effect one.',
    '11–20 Long effect two.',
    '21–30 Long effect three.',
    '31–40 Long effect four.',
    '41–45 Long effect five.',
    '46–55 Long effect six.',
    '56–65 Long effect seven.',
    '66–75 Long effect eight.',
    '76–85 Long effect nine.',
    '86–90 Long effect ten.',
    '91–95 Long effect eleven.',
    '96–100 Long effect twelve.',
  ],
};

const MADNESS_PAGE_TWO: FixturePage = {
  lines: [
    'Indefinite Madness',
    'd100 Flaw (lasts until cured)',
    '01–15 Indefinite flaw one.',
    '16–25 Indefinite flaw two.',
    '26–30 Indefinite flaw three.',
    '31–35 Indefinite flaw four.',
    '36–45 Indefinite flaw five.',
    '46–50 Indefinite flaw six.',
    '51–55 Indefinite flaw seven.',
    '56–70 Indefinite flaw eight.',
    '71–80 Indefinite flaw nine.',
    '81–85 Indefinite flaw ten.',
    '86–95 Indefinite flaw eleven.',
    '96–100 Indefinite flaw twelve.',
    'Curing Madness',
    'Greater restoration can end indefinite madness.',
  ],
};

const OBJECTS_PAGE: FixturePage = {
  lines: [
    'Objects',
    'Characters can destroy any destructible object with enough time and the right tools.',
    'Statistics for Objects',
    'When time is a factor, assign Armor Class and hit points.',
    'Armor Class. The table suggests AC values for common substances.',
    'Object Armor Class',
    'Substance AC',
    'Cloth, paper, rope 11',
    'Crystal, glass, ice 13',
    'Wood, bone 15',
    'Stone 17',
    'Iron, steel 19',
    'Mithral 21',
    'Adamantine 23',
    'Hit Points. Resilient objects have more hit points than fragile ones.',
    'Object Hit Points',
    'Size',
    'Tiny (bottle, lock)',
    'Small (chest, lute)',
    'Medium (barrel, chandelier)',
    'Large (cart, 10-ft.-by-10-ft. window)',
    'Huge and Gargantuan Objects. Track smaller sections separately.',
    'Objects and Damage Types. Objects are immune to poison and psychic damage.',
    'Damage Threshold. Superficial damage does not reduce hit points.',
    'Fragile Resilient',
    '2 (1d4) 5 (2d4)',
    '3 (1d6) 10 (3d6)',
    '4 (1d8) 18 (4d8)',
    '5 (1d10) 27 (5d10)',
    'Poisons',
  ],
};

const MADNESS_PAGE_MISSING_END: FixturePage = {
  lines: [
    'Madness',
    'A horror-themed campaign can use madness to reinforce that theme.',
    'Going Mad',
    'Magical effects can inflict madness.',
  ],
};

const OBJECTS_PAGE_MISSING_END: FixturePage = {
  lines: [
    'Madness',
    'A horror-themed campaign can use madness to reinforce that theme.',
    'Objects',
    'Characters can destroy any destructible object.',
  ],
};

// Feats fixture: mirrors the SRD "Feats" section (only Grappler in SRD 5.1).
const FEATS_PAGE: FixturePage = {
  lines: [
    'Feats',
    'Grappler',
    'Prerequisite: Strength 13 or higher',
    "You've developed the skills necessary to hold your own in close-quarters grappling.",
    '• You have advantage on attack rolls against a creature you are grappling.',
  ],
};

// Equipment fixture: mirrors how the real SRD "Equipment" chapter extracts —
// the Armor and Weapons tables arrive as a left column-block (Name/Cost/AC or
// Name/Cost/Damage) and a separate right column-block (Strength/Stealth/Weight
// or Weight/Properties), with the weapons' right block landing after the
// "Adventuring Gear" heading (the right physical column of the weapons page);
// the Tools table extracts row-major (loreweaver-3n6). The Sling row is the
// canonical em-dash-weight case (its Weight cell is a dash, not "N lb.") — kept
// so the property-preservation fix is protected end-to-end through the full
// extract → parse → emit pipeline. This fixture deliberately omits the
// Adventuring Gear / Container Capacity / Equipment Packs tables and the Mounts
// and Vehicles section; those parsers are now implemented (loreweaver-4zu) but
// exercised by their own fixtures in `parseEquipment.test.ts`. Here the
// "Adventuring Gear" line is only the weapons-column anchor, and the trailing
// "Mounts and Vehicles" line just closes the chapter (it matches the equipment
// endHeading anchor; with no Mounts content and no "Trade Goods" after it, the
// best-effort mountsAndVehicles slice yields no records).
const EQUIPMENT_PAGE: FixturePage = {
  lines: [
    'Equipment',
    'Armor',
    'Armor Cost Armor Class (AC)',
    'Light Armor',
    'Leather 10 gp 11 + Dex modifier',
    'Strength Stealth Weight',
    '— — 10 lb.',
    'Weapons',
    'Name Cost Damage Weight Properties',
    'Simple Melee Weapons',
    'Dagger 2 gp 1d4 piercing',
    'Simple Ranged Weapons',
    'Sling 1 sp 1d4 bludgeoning',
    'Adventuring Gear',
    '1 lb. Finesse, light, thrown (range 20/60)',
    '— Ammunition (range 30/120)',
    'Tools',
    'Item Cost Weight',
    'Smith’s tools 20 gp 8 lb.',
    'Vehicles (land or water) * *',
    'Mounts and Vehicles',
  ],
};

// Multiclassing fixture: mirrors the SRD "Multiclassing" section's
// Prerequisites table for one class (Fighter). The "Multiclassing" heading
// matches the multiclassing startHeading anchor; "Proficiencies" is the
// end-boundary subsection that immediately follows the table. This lets the
// pipeline test exercise the full enrichment path:
//   sliceSection(multiclassing) → parseMulticlassing → buildPack(primaryAbilityIndex)
// → class record with primaryAbilities populated.
const MULTICLASSING_PAGE: FixturePage = {
  lines: [
    'Multiclassing',
    'Class Ability Score Minimum',
    'Fighter Strength 13 or Dexterity 13',
    'Proficiencies',
  ],
};

// Backgrounds fixture (eshyra-0m9.17): mirrors the SRD "Backgrounds" chapter —
// chapter-intro prose, one intro section ("Customizing a Background", which
// must emit as a rule and never as a background entry), and the Acolyte entry
// with its labeled grant lines, nested feature, Suggested Characteristics
// prose, and the four caption-less roll tables. Placed after MULTICLASSING_PAGE
// and before CONDITIONS_PAGE in the implemented-kinds fixture, so the
// backgrounds anchor's end boundary is the "Appendix A: Conditions" heading.
// The intro deliberately carries NO bare "Equipment" line: fixture PDFs have no
// heading flags, so the anchors fall back to line matching and an exact
// "Equipment" line here would close the backgrounds slice early (the real SRD's
// h≈12 intro "Equipment" leaf is excluded by matchHeadings instead). The
// "Customizing a Background" heading sits at the slice start (immediately after
// the chapter title): PDF extraction drops blank lines, so the legacy rule
// heuristic only recognizes a heading at a slice/page boundary.
const BACKGROUNDS_PAGE: FixturePage = {
  lines: [
    'Backgrounds',
    'Customizing a Background',
    'You might want to tweak some of the features of a background so it better fits your character.',
    'Acolyte',
    'You have spent your life in the service of a temple to a specific god or pantheon of gods.',
    'Skill Proficiencies: Insight, Religion',
    'Languages: Two of your choice',
    'Equipment: A holy symbol (a gift to you when you',
    'entered the priesthood), a prayer book or prayer',
    'wheel, 5 sticks of incense, vestments, a set of',
    'common clothes, and a pouch containing 15 gp',
    'Feature: Shelter of the Faithful',
    'As an acolyte, you command the respect of those who share your faith.',
    'Suggested Characteristics',
    'Acolytes are shaped by their experience in temples or other religious communities.',
    'd8 Personality Trait',
    '1 I idolize a particular hero of my faith, and constantly',
    'refer to that person’s deeds and example.',
    '2 Nothing can shake my optimistic attitude.',
    'd6 Ideal',
    '1 Tradition. The ancient traditions of worship and',
    'sacrifice must be preserved and upheld. (Lawful)',
    '2 Charity. I always try to help those in need. (Good)',
    'd6 Bond',
    '1 I would die to recover an ancient relic of my faith.',
    '2 Everything I do is for the common people.',
    'd6 Flaw',
    '1 I judge others harshly, and myself even more severely.',
    '2 I am inflexible in my thinking.',
  ],
};

// Equipment fixture without the chapter subsection that ends the section. With
// requireEndHeading: true on the equipment anchor, the importer must fail
// closed rather than slice to EOF.
const EQUIPMENT_PAGE_MISSING_END: FixturePage = {
  lines: [
    'Equipment',
    'Weapons',
    'Name Cost Damage Weight Properties',
    'Simple Melee Weapons',
    'Dagger 2 gp 1d4 piercing 1 lb. Finesse, light, thrown (range 20/60)',
  ],
};

// Core-rules fixture: mirrors "Using Ability Scores" through combat/adventuring
// subsections where rule-text entries like "Cover" and "Resting" appear.
// The core-rules section ends at "Spell Lists" (handled by section anchors).
const CORE_RULES_PAGE_ONE: FixturePage = {
  lines: [
    'Using Ability Scores',
    'Cover',
    'Walls, trees, creatures, and other obstacles can provide cover during combat.',
    'A target with half cover has a +2 bonus to AC and Dexterity saving throws.',
  ],
};

const CORE_RULES_PAGE_TWO: FixturePage = {
  lines: [
    'Resting',
    'Adventurers can take short rests and long rests to recover from wounds.',
    'A short rest is at least 1 hour long, and a long rest is at least 8 hours.',
  ],
};

const CORE_RULES_TABLES_PAGE: FixturePage = {
  lines: [
    'Difficulty Classes',
    'Task Difficulty',
    'DC',
    'Very easy 5',
    'Easy 10',
    'Medium 15',
    'Hard 20',
    'Very hard 25',
    'Nearly impossible 30',
    '',
    'XP Thresholds by Character Level',
    'Character Level',
    'Easy',
    'Medium',
    'Hard',
    'Deadly',
    '1st 25 50 75 100',
    '2nd 50 100 150 200',
    '3rd 75 150 225 400',
    '4th 125 250 375 500',
  ],
};

// Conditions fixture: mirrors "Appendix A: Conditions" with two representative
// conditions (Blinded for a flat-effect case, Prone for a single-effect case).
const CONDITIONS_PAGE: FixturePage = {
  lines: [
    'Appendix A: Conditions',
    'Blinded',
    "• A blinded creature can't see and automatically fails any ability check that requires sight.",
    "• Attack rolls against the creature have advantage, and the creature's attack rolls have disadvantage.",
    '',
    'Prone',
    '• A prone creature has disadvantage on attack rolls.',
    '• An attack roll against the creature has advantage if the attacker is within 5 feet.',
  ],
};

// Races fixture: mirrors the SRD "Races" chapter's full expected ancestry
// coverage with compact parser-focused bodies. Dwarf and Halfling exercise
// parent+subrace flattening; Human exercises a race with no subraces. "Classes"
// below acts as the races section's end heading.
const RACES_PAGE: FixturePage = {
  lines: [
    'Races',
    'Dwarf',
    'Bold and hardy, dwarves are known as skilled warriors, miners, and workers of stone.',
    'Dwarf Traits',
    'Your dwarf character has an assortment of inborn abilities.',
    'Ability Score Increase. Your Constitution score increases by 2.',
    'Age. Dwarves mature at the same rate as humans but live about 350 years.',
    'Alignment. Most dwarves are lawful.',
    'Size. Dwarves stand between 4 and 5 feet tall. Your size is Medium.',
    'Speed. Your base walking speed is 25 feet.',
    'Darkvision. You have superior vision in dark and dim conditions.',
    'Languages. You can speak, read, and write Common and Dwarvish.',
    'Subrace. Two main subraces of dwarves populate the worlds of D&D.',
    'Hill Dwarf',
    'As a hill dwarf, you have keen senses and remarkable resilience.',
    'Ability Score Increase. Your Wisdom score increases by 1.',
    'Dwarven Toughness. Your hit point maximum increases by 1.',
    'Mountain Dwarf',
    "As a mountain dwarf, you're strong and hardy.",
    'Ability Score Increase. Your Strength score increases by 2.',
    'Dwarven Armor Training. You have proficiency with light and medium armor.',
    'Elf',
    'Elves are a magical people of otherworldly grace.',
    'Elf Traits',
    'Ability Score Increase. Your Dexterity score increases by 2.',
    'Size. Elves range from under 5 to over 6 feet tall. Your size is Medium.',
    'Speed. Your base walking speed is 30 feet.',
    'Keen Senses. You have proficiency in the Perception skill.',
    'Subrace. Ancient divides among the elven people resulted in three main subraces.',
    'High Elf',
    'As a high elf, you have a keen mind and a mastery of magic.',
    'Ability Score Increase. Your Intelligence score increases by 1.',
    'Wood Elf',
    'As a wood elf, you have keen senses and intuition.',
    'Ability Score Increase. Your Wisdom score increases by 1.',
    'Dark Elf (Drow)',
    'Descended from an earlier subrace of dark-skinned elves, the drow were banished.',
    'Ability Score Increase. Your Charisma score increases by 1.',
    'Halfling',
    'The comforts of home are the goals of most halflings.',
    'Halfling Traits',
    'Ability Score Increase. Your Dexterity score increases by 2.',
    'Size. Halflings average about 3 feet tall. Your size is Small.',
    'Speed. Your base walking speed is 25 feet.',
    'Lucky. When you roll a 1, you can reroll the die.',
    'Subrace. The two main kinds of halfling are lightfoot and stout.',
    'Lightfoot',
    'As a lightfoot halfling, you can easily hide from notice.',
    'Ability Score Increase. Your Charisma score increases by 1.',
    'Naturally Stealthy. You can attempt to hide even when you are obscured only by a creature.',
    'Stout',
    "As a stout halfling, you're hardier than average.",
    'Ability Score Increase. Your Constitution score increases by 1.',
    'Stout Resilience. You have advantage on saving throws against poison.',
    'Human',
    'Humans are the youngest of the common races.',
    'Human Traits',
    'Your human character has these traits.',
    'Ability Score Increase. Your ability scores each increase by 1.',
    'Age. Humans reach adulthood in their late teens.',
    'Size. Humans vary widely in height and build. Your size is Medium.',
    'Speed. Your base walking speed is 30 feet.',
    'Languages. You can speak, read, and write Common and one extra language.',
    'Dragonborn',
    'Dragonborn look very much like dragons standing erect in humanoid form.',
    'Dragonborn Traits',
    'Ability Score Increase. Your Strength score increases by 2, and your Charisma score increases by 1.',
    'Size. Dragonborn are taller and heavier than humans. Your size is Medium.',
    'Speed. Your base walking speed is 30 feet.',
    'Draconic Ancestry. You have draconic ancestry.',
    'Gnome',
    'A constant hum of busy activity pervades the warrens and neighborhoods where gnomes form communities.',
    'Gnome Traits',
    'Ability Score Increase. Your Intelligence score increases by 2.',
    'Size. Gnomes are between 3 and 4 feet tall. Your size is Small.',
    'Speed. Your base walking speed is 25 feet.',
    'Subrace. Two subraces of gnomes are found among the worlds of D&D.',
    'Forest Gnome',
    'As a forest gnome, you have a natural knack for illusion.',
    'Ability Score Increase. Your Dexterity score increases by 1.',
    'Rock Gnome',
    'As a rock gnome, you have a natural inventiveness and hardiness.',
    'Ability Score Increase. Your Constitution score increases by 1.',
    'Half-Elf',
    'Walking in two worlds but truly belonging to neither, half-elves combine qualities.',
    'Half-Elf Traits',
    'Ability Score Increase. Your Charisma score increases by 2.',
    'Size. Half-elves are about the same size as humans. Your size is Medium.',
    'Speed. Your base walking speed is 30 feet.',
    'Half-Orc',
    'Half-orcs inherit a tendency toward chaos from their orc parents.',
    'Half-Orc Traits',
    'Ability Score Increase. Your Strength score increases by 2.',
    'Size. Half-orcs are somewhat larger and bulkier than humans. Your size is Medium.',
    'Speed. Your base walking speed is 30 feet.',
    'Tiefling',
    'Tieflings are derived from human bloodlines.',
    'Tiefling Traits',
    'Ability Score Increase. Your Intelligence score increases by 1.',
    'Size. Tieflings are about the same size and build as humans. Your size is Medium.',
    'Speed. Your base walking speed is 30 feet.',
  ],
};

const RACES_PAGE_NO_ANCESTRIES: FixturePage = {
  lines: [
    'Races',
    'This chapter heading extracted, but the race and subrace headings did not.',
  ],
};

// Fixture variant that drops the bare "Lightfoot" heading so the comprehensive
// RACES_PAGE no longer parses to a Lightfoot Halfling record. Used by the
// coverage-failure test; "Lightfoot Halfling" is one of the actual SRD 5.1
// subraces in `EXPECTED_SRD_5_1_ANCESTRY_NAMES`, so its absence trips the
// ancestry coverage gate. (Stout was the original guard target; loreweaver-3m1
// removed it from the SRD 5.1 expected set because it isn't in the real PDF.)
const RACES_PAGE_MISSING_LIGHTFOOT: FixturePage = {
  lines: RACES_PAGE.lines.filter(
    (line) => typeof line !== 'string' || line !== 'Lightfoot',
  ),
};

// End heading for the races section AND the start of the Classes chapter. Now
// carries one full base-class block (Fighter) plus its subclass (Champion) so
// runImporter emits both a class and a subclass record; the chapter is bounded
// below by "Using Ability Scores" (the classes-anchor end heading, supplied by
// CORE_RULES_PAGE_ONE). Class-feature and subclass text is reproduced from the
// SRD 5.1 (CC-BY-4.0) as parser input.
const CLASSES_PAGE: FixturePage = {
  lines: [
    'Classes',
    'Fighter',
    'A master of martial combat, skilled with a variety of weapons and armor.',
    'The Fighter',
    'Level Proficiency Bonus Features',
    '1st +2 Fighting Style, Second Wind',
    '2nd +2 Action Surge',
    'Class Features',
    'As a fighter, you gain the following class features.',
    'Hit Points',
    'Hit Dice: 1d10 per fighter level',
    'Hit Points at 1st Level: 10 + your Constitution modifier',
    'Proficiencies',
    'Armor: All armor, shields',
    'Weapons: Simple weapons, martial weapons',
    'Tools: None',
    'Saving Throws: Strength, Constitution',
    'Skills: Choose two skills from Acrobatics, Athletics, History, Insight',
    'Martial Archetypes',
    'Different fighters choose different approaches to perfecting their martial prowess.',
    'Champion',
    'The archetypal Champion focuses on the development of raw physical power honed to deadly perfection.',
    'Improved Critical',
    'Beginning when you choose this archetype at 3rd level, your weapon attacks score a critical hit on a roll of 19 or 20.',
  ],
};

// Classes fixture whose section is found and properly bounded, but contains no
// parseable class block (no "Hit Dice: 1dN per <class> level" signature).
// Exercises the empty-result class-coverage guard.
const CLASSES_PAGE_NO_CLASSES: FixturePage = {
  lines: [
    'Classes',
    'This chapter introduces the classes, but no class block extracted.',
  ],
};

// Classes fixture that yields a base class (Fighter) but NO subclass heading.
// Exercises the empty-result subclass-coverage guard: the class parse succeeds
// (so validateClassCoverage passes), but the subclass parse is empty and must
// fail closed rather than emit a pack that silently omits `subclass`.
const CLASSES_PAGE_NO_SUBCLASS: FixturePage = {
  lines: [
    'Classes',
    'Fighter',
    'A master of martial combat, skilled with a variety of weapons and armor.',
    'Class Features',
    'Hit Dice: 1d10 per fighter level',
    'Armor: All armor, shields',
    'Weapons: Simple weapons, martial weapons',
    'Saving Throws: Strength, Constitution',
  ],
};

// Classes fixture that yields both a base class and subclass, but no feature
// heading or progression-table feature anchor. Feature is an implemented kind,
// so this must fail closed before writing output.
const CLASSES_PAGE_NO_FEATURES: FixturePage = {
  lines: [
    'Classes',
    'Fighter',
    'A master of martial combat, skilled with a variety of weapons and armor.',
    'Class Features',
    'Hit Dice: 1d10 per fighter level',
    'Armor: All armor, shields',
    'Weapons: Simple weapons, martial weapons',
    'Saving Throws: Strength, Constitution',
    'Martial Archetypes',
    'Different fighters choose different approaches.',
    'Champion',
    'The archetypal Champion focuses on raw physical power.',
  ],
};

const IMPLEMENTED_KINDS_FIXTURE_PAGES = [
  RACES_PAGE,
  CLASSES_PAGE,
  CORE_RULES_PAGE_ONE,
  CORE_RULES_PAGE_TWO,
  CORE_RULES_TABLES_PAGE,
  SPELL_LISTS_PAGE,
  SPELLS_PAGE,
  MONSTERS_PAGE,
  TREASURE_TABLES_PAGE,
  MAGIC_ITEMS_PAGE,
  COMBAT_ACTIONS_PAGE,
  MAKING_AN_ATTACK_PAGE,
  HAZARDS_PAGE,
  MADNESS_PAGE_ONE,
  MADNESS_PAGE_TWO,
  OBJECTS_PAGE,
  FEATS_PAGE,
  EQUIPMENT_PAGE,
  MULTICLASSING_PAGE,
  BACKGROUNDS_PAGE,
  CONDITIONS_PAGE,
] as const;

const IMPLEMENTED_KINDS_FIXTURE_RULE_KEYS = [
  'rule:armor-guidance',
  'rule:coinage',
  'rule:cover',
  'rule:curing-madness',
  // The Backgrounds chapter-intro section (eshyra-0m9.17). Uniform-font
  // fixtures take parseRules' legacy text-heuristic path, which emits the
  // intro heading by bare slug (no chapterIntro rule, no parent-qualified
  // keys — those are heading-hierarchy-path behaviors the real-PDF baseline
  // covers).
  'rule:customizing-a-background',
  'rule:going-mad',
  'rule:madness',
  'rule:madness-effects',
  'rule:mounts-and-vehicles',
  'rule:objects',
  'rule:resting',
] as const;

describe('runImporter — end-to-end against a fixture PDF', () => {
  it('extracts implemented SRD kinds and writes a pack that loads through loadRulesPackFromDirectory', async () => {
    const workDir = makeTmpDir();
    const pdfPath = join(workDir, 'fixture.pdf');
    const outDir = join(workDir, 'pack');
    await writeFixturePdf(pdfPath, IMPLEMENTED_KINDS_FIXTURE_PAGES);

    const result = await runImporter({
      pdfPath,
      outDir,
      expectedRuleKeys: IMPLEMENTED_KINDS_FIXTURE_RULE_KEYS,
      expectedTableNames: [
        // The four Acolyte suggested-characteristics roll tables come from
        // parseBackgrounds with synthesized names (eshyra-0m9.17).
        'Acolyte Bonds',
        'Acolyte Flaws',
        'Acolyte Ideals',
        'Acolyte Personality Traits',
        'Damage Severity by Level',
        'Difficulty Classes',
        'Indefinite Madness',
        'Individual Treasure: Challenge 0-4',
        'Long-Term Madness',
        'Object Armor Class',
        'Object Hit Points',
        'Short-Term Madness',
        'Trap Save DCs and Attack Bonuses',
        'Treasure Hoard: Challenge 0-4',
        'XP Thresholds by Character Level',
      ],
      expectedBackgroundNames: ['Acolyte'],
    });
    expect(result.counts.spells).toBe(2);
    expect(result.counts.creatures).toBe(1);
    // No Appendix MM-B page in this fixture, so the best-effort NPC slice
    // degrades to zero (loreweaver-bn0).
    expect(result.counts.npcs).toBe(0);
    expect(result.counts.classes).toBe(1);
    expect(result.counts.subclasses).toBe(1);
    expect(result.counts.features).toBe(1);
    expect(result.counts.conditions).toBe(2);
    expect(result.counts.feats).toBe(1);
    expect(result.counts.hazards).toBe(1);
    expect(result.counts.traps).toBe(2);
    expect(result.counts.actions).toBe(10);
    // 7 prior rules + the Backgrounds intro + fixture Equipment
    // coinage/armor/mount guidance.
    expect(result.counts.rules).toBe(11);
    // 4 prior tables + 2 trap tables + 3 madness tables + 2 object tables
    // + 4 Acolyte suggested-characteristics roll tables (eshyra-0m9.17).
    expect(result.counts.tables).toBe(15);
    expect(result.counts.equipment).toBe(4);
    expect(result.counts.magicItems).toBe(2);
    expect(result.counts.ancestries).toBe(18);
    expect(result.counts.backgrounds).toBe(1);
    expect(result.sourceHash).toMatch(/^[0-9a-f]{64}$/);

    const pack = loadRulesPackFromDirectory(outDir);
    // 64 prior records + 1 background + 4 roll tables + 1 backgrounds-intro
    // rule + 3 fixture Equipment guidance rules.
    expect(pack.records).toHaveLength(73);
    const keys = pack.records.map((r) => r.key).sort();
    expect(keys).toContain('class:fighter');
    expect(keys).toContain('subclass:champion');
    expect(keys).toContain('feature:champion:improved-critical');
    expect(keys).toContain('action:attack');
    expect(keys).toContain('action:cast-a-spell');
    expect(keys).toContain('action:dash');
    expect(keys).toContain('action:disengage');
    expect(keys).toContain('action:dodge');
    expect(keys).toContain('action:help');
    expect(keys).toContain('action:hide');
    expect(keys).toContain('action:ready');
    expect(keys).toContain('action:search');
    expect(keys).toContain('action:use-an-object');
    expect(keys).toContain('spell:acid-splash');
    expect(keys).toContain('spell:magic-missile');
    expect(keys).toContain('creature:goblin');
    expect(keys).toContain('condition:blinded');
    expect(keys).toContain('condition:prone');
    expect(keys).toContain('feat:grappler');
    expect(keys).toContain('rule:cover');
    expect(keys).toContain('rule:resting');
    expect(keys).toContain('table:difficulty-classes');
    expect(keys).toContain('table:xp-thresholds-by-character-level');
    expect(keys).toContain('magic-item:adamantine-armor');
    expect(keys).toContain('magic-item:apparatus-of-the-crab');
    expect(keys).toContain('ancestry:dwarf');
    expect(keys).toContain('ancestry:hill-dwarf');
    expect(keys).toContain('ancestry:lightfoot-halfling');
    expect(keys).toContain('ancestry:stout-halfling');
    expect(keys).toContain('ancestry:human');
    expect(keys).toContain('background:acolyte');
    // Assert the feat set is exactly Grappler — no bogus chapter headings
    // promoted as feat names by the heuristic.
    const featKeys = keys.filter((k) => k.startsWith('feat:'));
    expect(featKeys).toEqual(['feat:grappler']);
    // The `hazard` kind now holds the environmental hazard (Brown Mold) plus the
    // sample traps, which emit under `hazard` with category/trapType
    // (loreweaver-hvp).
    const hazardKeys = keys.filter((k) => k.startsWith('hazard:'));
    expect(hazardKeys).toEqual([
      'hazard:brown-mold',
      'hazard:collapsing-roof',
      'hazard:fire-breathing-statue',
    ]);
    const actionKeys = keys.filter((k) => k.startsWith('action:'));
    expect(actionKeys).toEqual([
      'action:attack',
      'action:cast-a-spell',
      'action:dash',
      'action:disengage',
      'action:dodge',
      'action:help',
      'action:hide',
      'action:ready',
      'action:search',
      'action:use-an-object',
    ]);
    const ruleKeys = keys.filter((k) => k.startsWith('rule:'));
    expect(ruleKeys).toEqual([
      'rule:armor-guidance',
      'rule:coinage',
      'rule:cover',
      'rule:curing-madness',
      'rule:customizing-a-background',
      'rule:going-mad',
      'rule:madness',
      'rule:madness-effects',
      'rule:mounts-and-vehicles',
      'rule:objects',
      'rule:resting',
    ]);
    const tableKeys = keys.filter((k) => k.startsWith('table:'));
    expect(tableKeys).toEqual([
      'table:acolyte-bonds',
      'table:acolyte-flaws',
      'table:acolyte-ideals',
      'table:acolyte-personality-traits',
      'table:damage-severity-by-level',
      'table:difficulty-classes',
      'table:indefinite-madness',
      'table:individual-treasure-challenge-0-4',
      'table:long-term-madness',
      'table:object-armor-class',
      'table:object-hit-points',
      'table:short-term-madness',
      'table:trap-save-dcs-and-attack-bonuses',
      'table:treasure-hoard-challenge-0-4',
      'table:xp-thresholds-by-character-level',
    ]);
    const equipmentKeys = keys.filter((k) => k.startsWith('equipment:'));
    expect(equipmentKeys).toEqual([
      'equipment:dagger',
      'equipment:leather',
      'equipment:sling',
      'equipment:smiths-tools',
    ]);
    const magicItemKeys = keys.filter((k) => k.startsWith('magic-item:'));
    expect(magicItemKeys).toEqual([
      'magic-item:adamantine-armor',
      'magic-item:apparatus-of-the-crab',
    ]);

    // The generated manifest must advertise equipment and magic items as
    // included kinds.
    expect(pack.meta.description).toMatch(
      /Included record kinds:[^.]*equipment/,
    );
    expect(pack.meta.description).toMatch(
      /Included record kinds:[^.]*magic-item/,
    );
    const ancestryKeys = keys.filter((k) => k.startsWith('ancestry:'));
    expect(ancestryKeys).toEqual([
      'ancestry:dark-elf-drow',
      'ancestry:dragonborn',
      'ancestry:dwarf',
      'ancestry:elf',
      'ancestry:forest-gnome',
      'ancestry:gnome',
      'ancestry:half-elf',
      'ancestry:half-orc',
      'ancestry:halfling',
      'ancestry:high-elf',
      'ancestry:hill-dwarf',
      'ancestry:human',
      'ancestry:lightfoot-halfling',
      'ancestry:mountain-dwarf',
      'ancestry:rock-gnome',
      'ancestry:stout-halfling',
      'ancestry:tiefling',
      'ancestry:wood-elf',
    ]);

    // Parent race: preserves the source 'race' term and references its subrace.
    const dwarf = pack.records.find((r) => r.key === 'ancestry:dwarf');
    expect(dwarf?.kind).toBe('ancestry');
    const dwarfData = dwarf?.data as Record<string, unknown>;
    expect(dwarfData.source).toBe('race');
    expect(dwarfData.size).toBe('Medium');
    expect(dwarfData.speed).toBe(25);
    expect(dwarfData.subraces).toEqual([
      'ancestry:hill-dwarf',
      'ancestry:mountain-dwarf',
    ]);
    expect(dwarfData.subraceOf).toBeUndefined();

    // Subrace: flattened/self-contained, points back at the parent, inherits the
    // parent's racial traits, and carries its own.
    const hillDwarf = pack.records.find((r) => r.key === 'ancestry:hill-dwarf');
    const hillData = hillDwarf?.data as Record<string, unknown>;
    expect(hillData.source).toBe('race');
    expect(hillData.subraceOf).toBe('ancestry:dwarf');
    expect(hillData.subraces).toBeUndefined();
    const hillTraitNames = (
      hillData.traits as ReadonlyArray<{ name: string }>
    ).map((t) => t.name);
    expect(hillTraitNames).toContain('Darkvision');
    expect(hillTraitNames).toContain('Dwarven Toughness');

    // Bare SRD halfling subrace headings are parent-qualified in record names
    // and keys so lookup by "Lightfoot Halfling" / "Stout Halfling" works.
    const halfling = pack.records.find((r) => r.key === 'ancestry:halfling');
    const halflingData = halfling?.data as Record<string, unknown>;
    expect(halflingData.subraces).toEqual([
      'ancestry:lightfoot-halfling',
      'ancestry:stout-halfling',
    ]);
    const lightfoot = pack.records.find(
      (r) => r.key === 'ancestry:lightfoot-halfling',
    );
    expect(lightfoot?.name).toBe('Lightfoot Halfling');
    expect((lightfoot?.data as Record<string, unknown>)?.subraceOf).toBe(
      'ancestry:halfling',
    );
    const stout = pack.records.find((r) => r.key === 'ancestry:stout-halfling');
    expect(stout?.name).toBe('Stout Halfling');

    // Race without subraces.
    const human = pack.records.find((r) => r.key === 'ancestry:human');
    const humanData = human?.data as Record<string, unknown>;
    expect(humanData.subraces).toBeUndefined();
    expect(humanData.subraceOf).toBeUndefined();
    expect(humanData.speed).toBe(30);

    // Background (eshyra-0m9.17): structured grant fields, the NESTED feature
    // (no top-level `feature` record for Shelter of the Faithful), and the
    // chapter-intro section staying a rule rather than a background entry.
    expect(pack.meta.description).toMatch(
      /Included record kinds:[^.]*background/,
    );
    const acolyte = pack.records.find((r) => r.key === 'background:acolyte');
    expect(acolyte?.kind).toBe('background');
    expect(acolyte?.name).toBe('Acolyte');
    const acolyteData = acolyte?.data as Record<string, unknown>;
    expect(acolyteData.skillProficiencies).toEqual(['Insight', 'Religion']);
    expect(acolyteData.languages).toEqual([
      {
        fixed: [],
        choose: 2,
        from: [
          'Common',
          'Dwarvish',
          'Elvish',
          'Giant',
          'Gnomish',
          'Goblin',
          'Halfling',
          'Orc',
        ],
        sourceText: 'Two of your choice',
      },
    ]);
    expect(acolyteData.equipment).toBe(
      'A holy symbol (a gift to you when you entered the priesthood), a prayer book or prayer wheel, 5 sticks of incense, vestments, a set of common clothes, and a pouch containing 15 gp',
    );
    expect(acolyteData.feature).toEqual({
      name: 'Shelter of the Faithful',
      text: 'As an acolyte, you command the respect of those who share your faith.',
    });
    expect(
      keys.filter((k) => k.startsWith('feature:') && k.includes('shelter')),
    ).toEqual([]);
    expect(keys.filter((k) => k.startsWith('background:'))).toEqual([
      'background:acolyte',
    ]);
    const acolyteIdeals = pack.records.find(
      (r) => r.key === 'table:acolyte-ideals',
    );
    expect((acolyteIdeals?.data as Record<string, unknown>)?.columns).toEqual([
      'd6',
      'Ideal',
    ]);
    expect((acolyteIdeals?.data as Record<string, unknown>)?.rows).toEqual([
      [
        1,
        'Tradition. The ancient traditions of worship and sacrifice must be preserved and upheld. (Lawful)',
      ],
      [2, 'Charity. I always try to help those in need. (Good)'],
    ]);

    const acid = pack.records.find((r) => r.key === 'spell:acid-splash');
    expect(acid?.name).toBe('Acid Splash');
    const acidData = acid?.data as Record<string, unknown>;
    expect(acidData.level).toBe(0);
    expect(acidData.school).toBe('conjuration');
    expect(acidData.classes).toEqual(['Sorcerer', 'Wizard']);

    const hazardRecords = pack.records.filter((r) => r.kind === 'hazard');
    expect(hazardRecords.map((r) => r.key)).toEqual([
      'hazard:brown-mold',
      'hazard:collapsing-roof',
      'hazard:fire-breathing-statue',
    ]);
    // The environmental hazard (Brown Mold): no trapType, and the hazards slice
    // ends at "Traps" so no trap prose bleeds into its body.
    const brown = pack.records.find((r) => r.key === 'hazard:brown-mold');
    const brownData = brown?.data as Record<string, unknown>;
    expect(brownData.trapType).toBeUndefined();
    expect(brownData.category).toBeUndefined();
    expect(brownData.description).not.toMatch(
      /A trap can be either mechanical or magical in nature\./,
    );

    // Sample traps emit under `hazard` with category/trapType; the
    // traps slice ends at "Diseases", so the magic trap's body stops there.
    const collapsing = pack.records.find(
      (r) => r.key === 'hazard:collapsing-roof',
    );
    expect(collapsing?.name).toBe('Collapsing Roof');
    const collapsingData = collapsing?.data as Record<string, unknown>;
    expect(collapsingData.category).toBe('trap');
    expect(collapsingData.trapType).toBe('mechanical');
    expect(collapsingData.description).toMatch(/trip wire/);
    const statue = pack.records.find(
      (r) => r.key === 'hazard:fire-breathing-statue',
    );
    const statueData = statue?.data as Record<string, unknown>;
    expect(statueData.category).toBe('trap');
    expect(statueData.trapType).toBe('magic');
    expect(statueData.description).not.toMatch(/Diseases/);

    // The two trap reference tables reconstruct from the same slice.
    const trapSaveDcs = pack.records.find(
      (r) => r.key === 'table:trap-save-dcs-and-attack-bonuses',
    );
    expect(trapSaveDcs?.kind).toBe('table');
    const trapSaveData = trapSaveDcs?.data as Record<string, unknown>;
    expect(trapSaveData.columns).toEqual([
      'Trap Danger',
      'Save DC',
      'Attack Bonus',
    ]);
    expect(trapSaveData.rows).toEqual([
      ['Setback', '10–11', '+3 to +5'],
      ['Dangerous', '12–15', '+6 to +8'],
      ['Deadly', '16–20', '+9 to +12'],
    ]);
    const damageSeverity = pack.records.find(
      (r) => r.key === 'table:damage-severity-by-level',
    );
    const damageData = damageSeverity?.data as Record<string, unknown>;
    expect(damageData.columns).toEqual([
      'Character Level',
      'Setback',
      'Dangerous',
      'Deadly',
    ]);
    expect((damageData.rows as unknown[]).length).toBe(4);

    const objectsRule = pack.records.find((r) => r.key === 'rule:objects');
    const objectsData = objectsRule?.data as Record<string, unknown>;
    expect(objectsData.text).toMatch(/Damage Threshold/);
    expect(objectsData.text).not.toMatch(/Cloth, paper, rope 11/);
    const objectHitPoints = pack.records.find(
      (r) => r.key === 'table:object-hit-points',
    );
    expect(
      (objectHitPoints?.data as Record<string, unknown>)?.rows,
    ).toHaveLength(4);

    const mm = pack.records.find((r) => r.key === 'spell:magic-missile');
    const mmData = mm?.data as Record<string, unknown>;
    expect(mmData.level).toBe(1);
    expect(mmData.higherLevels).toMatch(/^When you cast this spell/);

    const blinded = pack.records.find((r) => r.key === 'condition:blinded');
    expect(blinded?.name).toBe('Blinded');
    const blindedData = blinded?.data as Record<string, unknown>;
    expect(typeof blindedData.description).toBe('string');
    expect((blindedData.description as string).length).toBeGreaterThan(0);

    const grappler = pack.records.find((r) => r.key === 'feat:grappler');
    expect(grappler?.name).toBe('Grappler');
    const grapplerData = grappler?.data as Record<string, unknown>;
    expect(grapplerData.prerequisites).toBe('Strength 13 or higher');
    expect(typeof grapplerData.description).toBe('string');
    expect((grapplerData.description as string).length).toBeGreaterThan(0);

    // The generated manifest must advertise creature as an included kind.
    expect(pack.meta.description).toMatch(
      /Included record kinds:[^.]*creature/,
    );

    const goblin = pack.records.find((r) => r.key === 'creature:goblin');
    expect(goblin?.kind).toBe('creature');
    expect(goblin?.name).toBe('Goblin');
    const goblinData = goblin?.data as Record<string, unknown>;
    expect(goblinData.size).toBe('Small');
    expect(goblinData.type).toBe('humanoid (goblinoid)');
    expect(goblinData.alignment).toBe('neutral evil');
    expect(goblinData.armorClass).toEqual({
      value: 15,
      source: 'leather armor, shield',
      sourceText: '15 (leather armor, shield)',
    });
    expect(goblinData.hitPoints).toEqual({ value: 7, formula: '2d6' });
    expect(goblinData.speed).toEqual({ walk: 30 });
    expect(goblinData.speedSourceText).toBe('30 ft.');
    expect(goblinData.challengeRating).toBe('1/4');
    expect(goblinData.abilityScores).toEqual({
      strength: 8,
      dexterity: 14,
      constitution: 10,
      intelligence: 10,
      wisdom: 8,
      charisma: 8,
    });

    // The generated manifest must advertise class as an included kind.
    expect(pack.meta.description).toMatch(/Included record kinds:[^.]*class/);

    const fighter = pack.records.find((r) => r.key === 'class:fighter');
    expect(fighter?.kind).toBe('class');
    expect(fighter?.name).toBe('Fighter');
    const fighterData = fighter?.data as Record<string, unknown>;
    expect(fighterData.hitDie).toBe(10);
    expect(fighterData.armorProficiencies).toEqual(['All armor', 'shields']);
    expect(fighterData.weaponProficiencies).toEqual([
      'Simple weapons',
      'martial weapons',
    ]);
    expect(fighterData.savingThrowProficiencies).toEqual([
      'Strength',
      'Constitution',
    ]);
    // Primary abilities come from the Multiclassing prerequisites fixture (0m9.5.19).
    expect(fighterData.primaryAbilities).toEqual(['Strength', 'Dexterity']);

    // The generated manifest must advertise subclass as an included kind.
    expect(pack.meta.description).toMatch(
      /Included record kinds:[^.]*subclass/,
    );

    const champion = pack.records.find((r) => r.key === 'subclass:champion');
    expect(champion?.kind).toBe('subclass');
    expect(champion?.name).toBe('Champion');
    const championData = champion?.data as Record<string, unknown>;
    // Parent linkage is data-side and keyed to the class record (ADR 0009).
    expect(championData.parentClass).toBe('class:fighter');
    expect(champion?.overrides).toBeUndefined();
    expect(typeof championData.description).toBe('string');
    expect(championData.description).toMatch(/archetypal Champion/);
    // Base-class proficiency text must not bleed into the subclass body.
    expect(championData.description).not.toMatch(/Hit Dice/);

    // The generated manifest must advertise feature as an included kind.
    expect(pack.meta.description).toMatch(/Included record kinds:[^.]*feature/);

    const improvedCritical = pack.records.find(
      (r) => r.key === 'feature:champion:improved-critical',
    );
    expect(improvedCritical?.kind).toBe('feature');
    expect(improvedCritical?.name).toBe('Improved Critical');
    const improvedCriticalData = improvedCritical?.data as Record<
      string,
      unknown
    >;
    expect(improvedCriticalData.source).toBe('subclass:champion');
    expect(improvedCriticalData.level).toBe(3);
    expect(improvedCriticalData.description).toMatch(/critical hit/);

    const dagger = pack.records.find((r) => r.key === 'equipment:dagger');
    expect(dagger?.name).toBe('Dagger');
    const daggerData = dagger?.data as Record<string, unknown>;
    expect(daggerData.category).toBe('weapon');
    expect(daggerData.damageDie).toBe('1d4');
    expect(daggerData.damageType).toBe('piercing');
    expect(daggerData.properties).toEqual([
      'Finesse',
      'light',
      'thrown (range 20/60)',
    ]);

    const leather = pack.records.find((r) => r.key === 'equipment:leather');
    const leatherData = leather?.data as Record<string, unknown>;
    expect(leatherData.category).toBe('armor');
    expect(leatherData.ac).toBe('11 + Dex modifier');
    expect(leatherData.armorType).toBe('light');
    expect(leatherData.stealthDisadvantage).toBe(false);

    // Canonical em-dash-weight weapon: its properties must survive the full
    // pipeline (regression guard for the dropped-properties bug).
    const sling = pack.records.find((r) => r.key === 'equipment:sling');
    const slingData = sling?.data as Record<string, unknown>;
    expect(slingData.category).toBe('weapon');
    expect(slingData.damageDie).toBe('1d4');
    expect(slingData.damageType).toBe('bludgeoning');

    const adamantine = pack.records.find(
      (r) => r.key === 'magic-item:adamantine-armor',
    );
    expect(adamantine?.name).toBe('Adamantine Armor');
    const adamantineData = adamantine?.data as Record<string, unknown>;
    expect(adamantineData.itemType).toBe(
      'Armor (medium or heavy, but not hide)',
    );
    expect(adamantineData.rarity).toBe('uncommon');
    expect(adamantineData.requiresAttunement).toBe(false);

    const apparatus = pack.records.find(
      (r) => r.key === 'magic-item:apparatus-of-the-crab',
    );
    const apparatusData = apparatus?.data as Record<string, unknown>;
    expect(apparatusData.description).toContain('Apparatus of the Crab Levers');
    expect(slingData.properties).toEqual(['Ammunition (range 30/120)']);
    expect(slingData.weight).toBeUndefined();

    const cover = pack.records.find((r) => r.key === 'rule:cover');
    expect(cover?.name).toBe('Cover');
    const coverData = cover?.data as Record<string, unknown>;
    expect(typeof coverData.text).toBe('string');
    expect((coverData.text as string).length).toBeGreaterThan(0);
    expect(coverData.text).toMatch(/provide cover during combat/i);

    const difficultyTable = pack.records.find(
      (r) => r.key === 'table:difficulty-classes',
    );
    expect((difficultyTable?.data as Record<string, unknown>)?.columns).toEqual(
      ['Task Difficulty', 'DC'],
    );
    expect((difficultyTable?.data as Record<string, unknown>)?.rows).toEqual([
      ['Very easy', 5],
      ['Easy', 10],
      ['Medium', 15],
      ['Hard', 20],
      ['Very hard', 25],
      ['Nearly impossible', 30],
    ]);

    const xpThresholdTable = pack.records.find(
      (r) => r.key === 'table:xp-thresholds-by-character-level',
    );
    expect(
      (xpThresholdTable?.data as Record<string, unknown>)?.columns,
    ).toEqual(['Character Level', 'Easy', 'Medium', 'Hard', 'Deadly']);
    expect((xpThresholdTable?.data as Record<string, unknown>)?.rows).toEqual([
      ['1st', 25, 50, 75, 100],
      ['2nd', 50, 100, 150, 200],
      ['3rd', 75, 150, 225, 400],
      ['4th', 125, 250, 375, 500],
    ]);

    const individualTreasureTable = pack.records.find(
      (r) => r.key === 'table:individual-treasure-challenge-0-4',
    );
    expect(
      (individualTreasureTable?.data as Record<string, unknown>)?.columns,
    ).toEqual(['d100', 'CP', 'SP', 'EP', 'GP', 'PP']);
    expect(
      (individualTreasureTable?.data as Record<string, unknown>)?.rows,
    ).toEqual([
      ['01-30', '5d6 (17)', null, null, null, null],
      ['31-60', null, '4d6 (14)', null, null, null],
      ['61-70', null, null, '3d6 (10)', null, null],
    ]);

    const treasureHoardTable = pack.records.find(
      (r) => r.key === 'table:treasure-hoard-challenge-0-4',
    );
    expect(
      (treasureHoardTable?.data as Record<string, unknown>)?.columns,
    ).toEqual(['d100', 'CP', 'SP', 'GP', 'Gems or Art Objects', 'Magic Items']);
    expect((treasureHoardTable?.data as Record<string, unknown>)?.rows).toEqual(
      [
        [
          '01-06',
          '6d6 x 100 (2,100)',
          '3d6 x 100 (1,050)',
          '2d6 x 10 (70)',
          null,
          null,
        ],
        [
          '07-16',
          '6d6 x 100 (2,100)',
          '3d6 x 100 (1,050)',
          '2d6 x 10 (70)',
          '2d6 (7) 10 gp gems',
          null,
        ],
        [
          '17-26',
          '6d6 x 100 (2,100)',
          '3d6 x 100 (1,050)',
          '2d6 x 10 (70)',
          '2d4 (5) 25 gp art objects',
          'Table A',
        ],
      ],
    );
  });

  it('fails closed when the expected rule-key set omits a parsed key', async () => {
    const workDir = makeTmpDir();
    const pdfPath = join(workDir, 'fixture.pdf');
    const outDir = join(workDir, 'pack');
    await writeFixturePdf(pdfPath, IMPLEMENTED_KINDS_FIXTURE_PAGES);

    const importPromise = runImporter({
      pdfPath,
      outDir,
      expectedRuleKeys: IMPLEMENTED_KINDS_FIXTURE_RULE_KEYS.filter(
        (key) => key !== 'rule:resting',
      ),
    });

    await expect(importPromise).rejects.toThrow(RuleCoverageError);
    await expect(importPromise).rejects.toThrow(
      /unexpected rule\(s\): rule:resting/,
    );
    expect(() => readFileSync(join(outDir, 'records.json'), 'utf8')).toThrow();
  });

  it('fails closed when the expected rule-key set includes a nonexistent key', async () => {
    const workDir = makeTmpDir();
    const pdfPath = join(workDir, 'fixture.pdf');
    const outDir = join(workDir, 'pack');
    await writeFixturePdf(pdfPath, IMPLEMENTED_KINDS_FIXTURE_PAGES);

    const importPromise = runImporter({
      pdfPath,
      outDir,
      expectedRuleKeys: [
        ...IMPLEMENTED_KINDS_FIXTURE_RULE_KEYS,
        'rule:nonexistent',
      ],
    });

    await expect(importPromise).rejects.toThrow(RuleCoverageError);
    await expect(importPromise).rejects.toThrow(
      /missing expected rule\(s\): rule:nonexistent/,
    );
    expect(() => readFileSync(join(outDir, 'records.json'), 'utf8')).toThrow();
  });

  it('fails closed when the expected table-name set drifts', async () => {
    const workDir = makeTmpDir();
    const pdfPath = join(workDir, 'fixture.pdf');
    const outDir = join(workDir, 'pack');
    await writeFixturePdf(pdfPath, [
      RACES_PAGE,
      CLASSES_PAGE,
      CORE_RULES_PAGE_ONE,
      CORE_RULES_PAGE_TWO,
      CORE_RULES_TABLES_PAGE,
      SPELL_LISTS_PAGE,
      SPELLS_PAGE,
      MONSTERS_PAGE,
      TREASURE_TABLES_PAGE,
      MAGIC_ITEMS_PAGE,
      COMBAT_ACTIONS_PAGE,
      MAKING_AN_ATTACK_PAGE,
      HAZARDS_PAGE,
      MADNESS_PAGE_ONE,
      MADNESS_PAGE_TWO,
      OBJECTS_PAGE,
      FEATS_PAGE,
      EQUIPMENT_PAGE,
      MULTICLASSING_PAGE,
      CONDITIONS_PAGE,
    ]);

    await expect(
      runImporter({
        pdfPath,
        outDir,
        expectedTableNames: ['Difficulty Classes'],
      }),
    ).rejects.toThrow(TableCoverageError);
  });

  it('fails closed when the expected background-name set drifts', async () => {
    const workDir = makeTmpDir();
    const pdfPath = join(workDir, 'fixture.pdf');
    const outDir = join(workDir, 'pack');
    await writeFixturePdf(pdfPath, IMPLEMENTED_KINDS_FIXTURE_PAGES);

    const importPromise = runImporter({
      pdfPath,
      outDir,
      expectedBackgroundNames: ['Acolyte', 'Soldier'],
    });

    await expect(importPromise).rejects.toThrow(BackgroundCoverageError);
    await expect(importPromise).rejects.toThrow(
      /missing expected background\(s\): Soldier/,
    );
    expect(() => readFileSync(join(outDir, 'records.json'), 'utf8')).toThrow();
  });

  it('produces a byte-identical pack across two runs over the same PDF', async () => {
    const workDir = makeTmpDir();
    const pdfPath = join(workDir, 'fixture.pdf');
    const outA = join(workDir, 'a');
    const outB = join(workDir, 'b');
    await writeFixturePdf(pdfPath, [
      RACES_PAGE,
      CLASSES_PAGE,
      CORE_RULES_PAGE_ONE,
      CORE_RULES_PAGE_TWO,
      SPELL_LISTS_PAGE,
      SPELLS_PAGE,
      MONSTERS_PAGE,
      TREASURE_TABLES_PAGE,
      MAGIC_ITEMS_PAGE,
      COMBAT_ACTIONS_PAGE,
      MAKING_AN_ATTACK_PAGE,
      HAZARDS_PAGE,
      FEATS_PAGE,
      EQUIPMENT_PAGE,
      CONDITIONS_PAGE,
    ]);

    await runImporter({ pdfPath, outDir: outA });
    await runImporter({ pdfPath, outDir: outB });

    expect(readFileSync(join(outA, 'manifest.json'), 'utf8')).toBe(
      readFileSync(join(outB, 'manifest.json'), 'utf8'),
    );
    expect(readFileSync(join(outA, 'records.json'), 'utf8')).toBe(
      readFileSync(join(outB, 'records.json'), 'utf8'),
    );
  });

  it('preserves the final line of the final spell (body-slicing regression)', async () => {
    const workDir = makeTmpDir();
    const pdfPath = join(workDir, 'fixture.pdf');
    const outDir = join(workDir, 'pack');
    await writeFixturePdf(pdfPath, [
      RACES_PAGE,
      CLASSES_PAGE,
      CORE_RULES_PAGE_ONE,
      CORE_RULES_PAGE_TWO,
      SPELL_LISTS_PAGE,
      SPELLS_PAGE,
      MONSTERS_PAGE,
      TREASURE_TABLES_PAGE,
      MAGIC_ITEMS_PAGE,
      COMBAT_ACTIONS_PAGE,
      MAKING_AN_ATTACK_PAGE,
      HAZARDS_PAGE,
      FEATS_PAGE,
      EQUIPMENT_PAGE,
      CONDITIONS_PAGE,
    ]);

    await runImporter({ pdfPath, outDir });
    const pack = loadRulesPackFromDirectory(outDir);
    const mm = pack.records.find((r) => r.key === 'spell:magic-missile');
    const mmData = mm?.data as Record<string, unknown>;
    const haystack = `${mmData.description ?? ''}\n${mmData.higherLevels ?? ''}`;
    expect(haystack).toMatch(
      /MAGIC_MISSILE_FINAL_LINE_THAT_MUST_NOT_BE_DROPPED/,
    );
  });

  it("does not bleed class-list or monster text into the final spell's body", async () => {
    const workDir = makeTmpDir();
    const pdfPath = join(workDir, 'fixture.pdf');
    const outDir = join(workDir, 'pack');
    await writeFixturePdf(pdfPath, [
      RACES_PAGE,
      CLASSES_PAGE,
      CORE_RULES_PAGE_ONE,
      CORE_RULES_PAGE_TWO,
      SPELL_LISTS_PAGE,
      SPELLS_PAGE,
      MONSTERS_PAGE,
      TREASURE_TABLES_PAGE,
      MAGIC_ITEMS_PAGE,
      COMBAT_ACTIONS_PAGE,
      MAKING_AN_ATTACK_PAGE,
      HAZARDS_PAGE,
      FEATS_PAGE,
      EQUIPMENT_PAGE,
      CONDITIONS_PAGE,
    ]);

    await runImporter({ pdfPath, outDir });
    const pack = loadRulesPackFromDirectory(outDir);

    for (const record of pack.records) {
      const data = record.data as Record<string, unknown>;
      const haystack = [
        data.description,
        data.higherLevels,
        data.componentMaterials,
      ]
        .filter((v): v is string => typeof v === 'string')
        .join('\n');
      // Class-list section headers / content must not appear inside any
      // spell's textual fields.
      expect(haystack).not.toMatch(/Wizard Spells/);
      expect(haystack).not.toMatch(/Sorcerer Spells/);
      expect(haystack).not.toMatch(/Cantrips \(0 Level\)/);
      expect(haystack).not.toMatch(/^Acid Splash$/m);
      // Following-chapter (monsters) content must not appear either.
      expect(haystack).not.toMatch(/Monsters/);
      expect(haystack).not.toMatch(/Goblin/);
      expect(haystack).not.toMatch(/Small humanoid/);
    }
  });

  it('fails closed when the spell-descriptions anchor cannot be found', async () => {
    const workDir = makeTmpDir();
    const pdfPath = join(workDir, 'fixture.pdf');
    const outDir = join(workDir, 'pack');
    // Fixture with neither a "Spells" nor a "Spell Lists" heading — the
    // importer must refuse to run rather than silently feed the whole PDF
    // to the parser.
    const orphan: FixturePage = {
      lines: ['Acid Splash', 'Conjuration cantrip'],
    };
    await writeFixturePdf(pdfPath, [orphan]);
    await expect(runImporter({ pdfPath, outDir })).rejects.toThrow(
      /heading not found/,
    );
  });

  it('fails closed when the conditions heading is missing', async () => {
    const workDir = makeTmpDir();
    const pdfPath = join(workDir, 'fixture.pdf');
    const outDir = join(workDir, 'pack');
    // Spell Lists, Spells, Monsters, and Feats are present so those pipelines
    // succeed, but there is no conditions chapter. The importer must refuse
    // to run rather than silently emit a pack without conditions.
    await writeFixturePdf(pdfPath, [
      CORE_RULES_PAGE_ONE,
      CORE_RULES_PAGE_TWO,
      FEATS_PAGE,
      SPELL_LISTS_PAGE,
      SPELLS_PAGE,
      MONSTERS_PAGE,
      COMBAT_ACTIONS_PAGE,
      MAKING_AN_ATTACK_PAGE,
    ]);
    await expect(runImporter({ pdfPath, outDir })).rejects.toThrow(
      /heading not found/,
    );
  });

  it('fails closed when the spell-descriptions end heading (e.g. "Monsters") is missing', async () => {
    const workDir = makeTmpDir();
    const pdfPath = join(workDir, 'fixture.pdf');
    const outDir = join(workDir, 'pack');
    // Spell Lists and Spells start headings are present (so spellLists slice
    // succeeds and spellDescriptions start is found), but the chapter after
    // Spells is missing — pre-fix this would have silently sliced the spell
    // descriptions to EOF and let any later content bleed in. With
    // requireEndHeading: true, the importer must refuse to run.
    await writeFixturePdf(pdfPath, [
      CORE_RULES_PAGE_ONE,
      CORE_RULES_PAGE_TWO,
      SPELL_LISTS_PAGE,
      SPELLS_PAGE,
    ]);
    await expect(runImporter({ pdfPath, outDir })).rejects.toThrow(
      /end heading not found/,
    );
  });

  it('fails closed when the feats end heading is missing', async () => {
    const workDir = makeTmpDir();
    const pdfPath = join(workDir, 'fixture.pdf');
    const outDir = join(workDir, 'pack');
    // All sections except the feats end heading are present. FEATS_PAGE is
    // placed last so no subsequent heading matches the feats endHeading pattern.
    // With requireEndHeading: true on the feats anchor, the importer must
    // throw SectionNotFoundError rather than silently slice to EOF (which would
    // let later chapter headings be promoted as bogus feat records).
    await writeFixturePdf(pdfPath, [
      CORE_RULES_PAGE_ONE,
      CORE_RULES_PAGE_TWO,
      SPELL_LISTS_PAGE,
      SPELLS_PAGE,
      MONSTERS_PAGE,
      COMBAT_ACTIONS_PAGE,
      MAKING_AN_ATTACK_PAGE,
      CONDITIONS_PAGE,
      FEATS_PAGE,
    ]);
    await expect(runImporter({ pdfPath, outDir })).rejects.toThrow(
      /end heading not found/,
    );
  });

  it('fails closed when the hazards end heading is missing', async () => {
    const workDir = makeTmpDir();
    const pdfPath = join(workDir, 'fixture.pdf');
    const outDir = join(workDir, 'pack');
    await writeFixturePdf(pdfPath, [
      CORE_RULES_PAGE_ONE,
      CORE_RULES_PAGE_TWO,
      SPELL_LISTS_PAGE,
      SPELLS_PAGE,
      MONSTERS_PAGE,
      COMBAT_ACTIONS_PAGE,
      MAKING_AN_ATTACK_PAGE,
      HAZARDS_PAGE_MISSING_END,
      FEATS_PAGE,
      CONDITIONS_PAGE,
    ]);

    await expect(runImporter({ pdfPath, outDir })).rejects.toThrow(
      SectionNotFoundError,
    );
  });

  it('fails closed when the Madness end heading is missing', async () => {
    const workDir = makeTmpDir();
    const pdfPath = join(workDir, 'fixture.pdf');
    const outDir = join(workDir, 'pack');
    await writeFixturePdf(pdfPath, [
      RACES_PAGE,
      CLASSES_PAGE,
      CORE_RULES_PAGE_ONE,
      CORE_RULES_PAGE_TWO,
      SPELL_LISTS_PAGE,
      SPELLS_PAGE,
      MONSTERS_PAGE,
      MAGIC_ITEMS_PAGE,
      COMBAT_ACTIONS_PAGE,
      MAKING_AN_ATTACK_PAGE,
      HAZARDS_PAGE,
      FEATS_PAGE,
      EQUIPMENT_PAGE,
      CONDITIONS_PAGE,
      MADNESS_PAGE_MISSING_END,
    ]);

    await expect(runImporter({ pdfPath, outDir })).rejects.toThrow(
      SectionNotFoundError,
    );
  });

  it('fails closed when the Objects end heading is missing', async () => {
    const workDir = makeTmpDir();
    const pdfPath = join(workDir, 'fixture.pdf');
    const outDir = join(workDir, 'pack');
    await writeFixturePdf(pdfPath, [
      RACES_PAGE,
      CLASSES_PAGE,
      CORE_RULES_PAGE_ONE,
      CORE_RULES_PAGE_TWO,
      SPELL_LISTS_PAGE,
      SPELLS_PAGE,
      MONSTERS_PAGE,
      MAGIC_ITEMS_PAGE,
      COMBAT_ACTIONS_PAGE,
      MAKING_AN_ATTACK_PAGE,
      HAZARDS_PAGE,
      FEATS_PAGE,
      EQUIPMENT_PAGE,
      CONDITIONS_PAGE,
      OBJECTS_PAGE_MISSING_END,
    ]);

    await expect(runImporter({ pdfPath, outDir })).rejects.toThrow(
      SectionNotFoundError,
    );
  });

  it('fails closed when the treasure-table end heading is missing', async () => {
    const workDir = makeTmpDir();
    const pdfPath = join(workDir, 'fixture.pdf');
    const outDir = join(workDir, 'pack');
    await writeFixturePdf(pdfPath, [
      CORE_RULES_PAGE_ONE,
      CORE_RULES_PAGE_TWO,
      SPELL_LISTS_PAGE,
      SPELLS_PAGE,
      MONSTERS_PAGE,
      TREASURE_TABLES_PAGE_MISSING_END,
      COMBAT_ACTIONS_PAGE,
      MAKING_AN_ATTACK_PAGE,
      HAZARDS_PAGE,
      FEATS_PAGE,
      EQUIPMENT_PAGE,
      CONDITIONS_PAGE,
    ]);

    await expect(runImporter({ pdfPath, outDir })).rejects.toThrow(
      SectionNotFoundError,
    );
  });

  it('fails closed when the equipment end heading is missing', async () => {
    const workDir = makeTmpDir();
    const pdfPath = join(workDir, 'fixture.pdf');
    const outDir = join(workDir, 'pack');
    await writeFixturePdf(pdfPath, [
      CORE_RULES_PAGE_ONE,
      CORE_RULES_PAGE_TWO,
      SPELL_LISTS_PAGE,
      SPELLS_PAGE,
      MONSTERS_PAGE,
      TREASURE_TABLES_PAGE,
      MAGIC_ITEMS_PAGE,
      COMBAT_ACTIONS_PAGE,
      MAKING_AN_ATTACK_PAGE,
      HAZARDS_PAGE,
      FEATS_PAGE,
      EQUIPMENT_PAGE_MISSING_END,
      CONDITIONS_PAGE,
    ]);

    await expect(runImporter({ pdfPath, outDir })).rejects.toThrow(
      SectionNotFoundError,
    );
  });

  it('succeeds with hazards=0 when the hazards section is absent entirely (best-effort)', async () => {
    // SRD 5.1 has no hazards chapter at all — the orchestrator must
    // degrade to empty results when the START anchor doesn't match
    // anywhere, rather than fail the run. (End-missing is still
    // fail-closed; see the "hazards end heading is missing" test above.)
    const workDir = makeTmpDir();
    const pdfPath = join(workDir, 'fixture.pdf');
    const outDir = join(workDir, 'pack');
    await writeFixturePdf(pdfPath, [
      RACES_PAGE,
      CLASSES_PAGE,
      CORE_RULES_PAGE_ONE,
      CORE_RULES_PAGE_TWO,
      CORE_RULES_TABLES_PAGE,
      SPELL_LISTS_PAGE,
      SPELLS_PAGE,
      MONSTERS_PAGE,
      TREASURE_TABLES_PAGE,
      MAGIC_ITEMS_PAGE,
      COMBAT_ACTIONS_PAGE,
      MAKING_AN_ATTACK_PAGE,
      // No HAZARDS_PAGE — the hazards start anchor must not match.
      FEATS_PAGE,
      EQUIPMENT_PAGE,
      MULTICLASSING_PAGE,
      CONDITIONS_PAGE,
    ]);

    const result = await runImporter({ pdfPath, outDir });
    expect(result.counts.hazards).toBe(0);
  });

  it('succeeds with traps=0 when the Traps section is absent entirely (best-effort)', async () => {
    // Like hazards, a Traps section absent from the source degrades to no traps
    // rather than failing — the fixture omits HAZARDS_PAGE (which carries the
    // "Traps" heading), so the traps start anchor must not match anywhere
    // (loreweaver-hvp).
    const workDir = makeTmpDir();
    const pdfPath = join(workDir, 'fixture.pdf');
    const outDir = join(workDir, 'pack');
    await writeFixturePdf(pdfPath, [
      RACES_PAGE,
      CLASSES_PAGE,
      CORE_RULES_PAGE_ONE,
      CORE_RULES_PAGE_TWO,
      CORE_RULES_TABLES_PAGE,
      SPELL_LISTS_PAGE,
      SPELLS_PAGE,
      MONSTERS_PAGE,
      TREASURE_TABLES_PAGE,
      MAGIC_ITEMS_PAGE,
      COMBAT_ACTIONS_PAGE,
      MAKING_AN_ATTACK_PAGE,
      // No HAZARDS_PAGE — neither the hazards nor the traps start anchor matches.
      FEATS_PAGE,
      EQUIPMENT_PAGE,
      MULTICLASSING_PAGE,
      CONDITIONS_PAGE,
    ]);

    const result = await runImporter({ pdfPath, outDir });
    expect(result.counts.traps).toBe(0);
  });

  it('fails closed when the expected trap-name set is supplied but the parse drifts', async () => {
    // The real import (CLI / verify) passes the exact EXPECTED_SRD_5_1_TRAP_NAMES
    // set. The fixture's Traps section yields only two sample traps, so a run
    // demanding the full eight-name set must throw and write nothing
    // (loreweaver-hvp).
    const workDir = makeTmpDir();
    const pdfPath = join(workDir, 'fixture.pdf');
    const outDir = join(workDir, 'pack');
    await writeFixturePdf(pdfPath, [
      RACES_PAGE,
      CLASSES_PAGE,
      CORE_RULES_PAGE_ONE,
      CORE_RULES_PAGE_TWO,
      CORE_RULES_TABLES_PAGE,
      SPELL_LISTS_PAGE,
      SPELLS_PAGE,
      MONSTERS_PAGE,
      TREASURE_TABLES_PAGE,
      MAGIC_ITEMS_PAGE,
      COMBAT_ACTIONS_PAGE,
      MAKING_AN_ATTACK_PAGE,
      HAZARDS_PAGE,
      FEATS_PAGE,
      EQUIPMENT_PAGE,
      MULTICLASSING_PAGE,
      CONDITIONS_PAGE,
    ]);

    await expect(
      runImporter({
        pdfPath,
        outDir,
        expectedTrapNames: [
          'Collapsing Roof',
          'Fire-Breathing Statue',
          'Poison Needle',
          'Sphere of Annihilation',
        ],
      }),
    ).rejects.toThrow(TrapCoverageError);
  });

  it('succeeds with no treasure tables emitted when the treasure section is absent entirely (best-effort)', async () => {
    // Same shape as the hazards-absent case for treasure tables. The
    // tables that would otherwise come from the treasure slice are
    // simply not emitted; rules and DC tables from coreRules still are.
    const workDir = makeTmpDir();
    const pdfPath = join(workDir, 'fixture.pdf');
    const outDir = join(workDir, 'pack');
    await writeFixturePdf(pdfPath, [
      RACES_PAGE,
      CLASSES_PAGE,
      CORE_RULES_PAGE_ONE,
      CORE_RULES_PAGE_TWO,
      CORE_RULES_TABLES_PAGE,
      SPELL_LISTS_PAGE,
      SPELLS_PAGE,
      MONSTERS_PAGE,
      // No TREASURE_TABLES_PAGE — the treasureTables start anchor must
      // not match.
      MAGIC_ITEMS_PAGE,
      COMBAT_ACTIONS_PAGE,
      MAKING_AN_ATTACK_PAGE,
      HAZARDS_PAGE,
      FEATS_PAGE,
      EQUIPMENT_PAGE,
      MULTICLASSING_PAGE,
      CONDITIONS_PAGE,
    ]);

    await runImporter({ pdfPath, outDir });
    // coreRules supplies the two DC / XP tables; treasureTables would
    // have added two more rows. None of those treasure rows show up.
    const pack = loadRulesPackFromDirectory(outDir);
    const tableKeys = pack.records
      .filter((r) => r.kind === 'table')
      .map((r) => r.key)
      .sort();
    expect(tableKeys).not.toContain('table:individual-treasure-challenge-0-4');
    expect(tableKeys).not.toContain('table:treasure-hoard-challenge-0-4');
  });

  it('fails closed when the combat-actions end heading is missing', async () => {
    const workDir = makeTmpDir();
    const pdfPath = join(workDir, 'fixture.pdf');
    const outDir = join(workDir, 'pack');
    await writeFixturePdf(pdfPath, [
      CORE_RULES_PAGE_ONE,
      CORE_RULES_PAGE_TWO,
      SPELL_LISTS_PAGE,
      SPELLS_PAGE,
      MONSTERS_PAGE,
      COMBAT_ACTIONS_PAGE_MISSING_END,
      HAZARDS_PAGE,
      FEATS_PAGE,
      EQUIPMENT_PAGE,
      CONDITIONS_PAGE,
    ]);

    await expect(runImporter({ pdfPath, outDir })).rejects.toThrow(
      SectionNotFoundError,
    );
  });

  it('fails closed when the races section is missing', async () => {
    const workDir = makeTmpDir();
    const pdfPath = join(workDir, 'fixture.pdf');
    const outDir = join(workDir, 'pack');
    // Every other section is present so all earlier slices succeed; only the
    // races chapter is absent. With requireEndHeading on the races anchor the
    // importer must refuse to run rather than emit a pack without ancestries.
    await writeFixturePdf(pdfPath, [
      CORE_RULES_PAGE_ONE,
      CORE_RULES_PAGE_TWO,
      CORE_RULES_TABLES_PAGE,
      SPELL_LISTS_PAGE,
      SPELLS_PAGE,
      MONSTERS_PAGE,
      TREASURE_TABLES_PAGE,
      MAGIC_ITEMS_PAGE,
      COMBAT_ACTIONS_PAGE,
      MAKING_AN_ATTACK_PAGE,
      HAZARDS_PAGE,
      FEATS_PAGE,
      EQUIPMENT_PAGE,
      CONDITIONS_PAGE,
    ]);

    await expect(runImporter({ pdfPath, outDir })).rejects.toThrow(
      SectionNotFoundError,
    );
  });

  it('fails closed when the Races section yields no ancestry records', async () => {
    const workDir = makeTmpDir();
    const pdfPath = join(workDir, 'fixture.pdf');
    const outDir = join(workDir, 'pack');
    await writeFixturePdf(pdfPath, [
      RACES_PAGE_NO_ANCESTRIES,
      CLASSES_PAGE,
      CORE_RULES_PAGE_ONE,
      CORE_RULES_PAGE_TWO,
      CORE_RULES_TABLES_PAGE,
      SPELL_LISTS_PAGE,
      SPELLS_PAGE,
      MONSTERS_PAGE,
      TREASURE_TABLES_PAGE,
      MAGIC_ITEMS_PAGE,
      COMBAT_ACTIONS_PAGE,
      MAKING_AN_ATTACK_PAGE,
      HAZARDS_PAGE,
      FEATS_PAGE,
      EQUIPMENT_PAGE,
      CONDITIONS_PAGE,
    ]);

    await expect(runImporter({ pdfPath, outDir })).rejects.toThrow(
      /SRD 5\.1 ancestry coverage check failed/,
    );
    expect(() => readFileSync(join(outDir, 'records.json'), 'utf8')).toThrow();
  });

  it('fails closed when an expected ancestry record is missing and names it', async () => {
    const workDir = makeTmpDir();
    const pdfPath = join(workDir, 'fixture.pdf');
    const outDir = join(workDir, 'pack');
    await writeFixturePdf(pdfPath, [
      RACES_PAGE_MISSING_LIGHTFOOT,
      CLASSES_PAGE,
      CORE_RULES_PAGE_ONE,
      CORE_RULES_PAGE_TWO,
      CORE_RULES_TABLES_PAGE,
      SPELL_LISTS_PAGE,
      SPELLS_PAGE,
      MONSTERS_PAGE,
      TREASURE_TABLES_PAGE,
      MAGIC_ITEMS_PAGE,
      COMBAT_ACTIONS_PAGE,
      MAKING_AN_ATTACK_PAGE,
      HAZARDS_PAGE,
      FEATS_PAGE,
      EQUIPMENT_PAGE,
      CONDITIONS_PAGE,
    ]);

    await expect(runImporter({ pdfPath, outDir })).rejects.toThrow(
      /Missing expected ancestry record\(s\): Lightfoot Halfling/,
    );
    expect(() => readFileSync(join(outDir, 'records.json'), 'utf8')).toThrow();
  });

  it('fails closed when the monsters end heading is missing', async () => {
    const workDir = makeTmpDir();
    const pdfPath = join(workDir, 'fixture.pdf');
    const outDir = join(workDir, 'pack');
    // Conditions is placed before the (end-less) Monsters section so its
    // "Appendix A: Conditions" heading can't double as the monsters end
    // boundary; nothing after the Monsters heading matches the monsters end
    // anchor, so with requireEndHeading: true the slice must fail rather than
    // run to EOF and feed trailing content to the creature parser.
    await writeFixturePdf(pdfPath, [
      CORE_RULES_PAGE_ONE,
      CORE_RULES_PAGE_TWO,
      SPELL_LISTS_PAGE,
      SPELLS_PAGE,
      COMBAT_ACTIONS_PAGE,
      MAKING_AN_ATTACK_PAGE,
      CONDITIONS_PAGE,
      MONSTERS_PAGE_MISSING_END,
    ]);

    await expect(runImporter({ pdfPath, outDir })).rejects.toThrow(
      SectionNotFoundError,
    );
  });

  it('fails closed when the Monsters section yields no creatures', async () => {
    const workDir = makeTmpDir();
    const pdfPath = join(workDir, 'fixture.pdf');
    const outDir = join(workDir, 'pack');
    // The Monsters section is found and properly bounded, but no stat block
    // parses out of it. The coverage guard must reject the empty result and
    // write nothing rather than emit a creature-less pack.
    await writeFixturePdf(pdfPath, [
      CORE_RULES_PAGE_ONE,
      CORE_RULES_PAGE_TWO,
      SPELL_LISTS_PAGE,
      SPELLS_PAGE,
      MONSTERS_PAGE_NO_CREATURES,
      COMBAT_ACTIONS_PAGE,
      MAKING_AN_ATTACK_PAGE,
      CONDITIONS_PAGE,
    ]);

    await expect(runImporter({ pdfPath, outDir })).rejects.toThrow(
      CreatureCoverageError,
    );
    // Nothing should have been written.
    expect(() => readFileSync(join(outDir, 'records.json'), 'utf8')).toThrow();
  });

  it('fails closed when fewer creatures than minCreatureCount are parsed', async () => {
    const workDir = makeTmpDir();
    const pdfPath = join(workDir, 'fixture.pdf');
    const outDir = join(workDir, 'pack');
    // The fixture's Monsters section yields a single creature (Goblin); a
    // minCreatureCount of 2 must trip the coverage floor with a deterministic
    // message naming the observed and expected counts.
    await writeFixturePdf(pdfPath, [
      RACES_PAGE,
      CLASSES_PAGE,
      CORE_RULES_PAGE_ONE,
      CORE_RULES_PAGE_TWO,
      CORE_RULES_TABLES_PAGE,
      SPELL_LISTS_PAGE,
      SPELLS_PAGE,
      MONSTERS_PAGE,
      TREASURE_TABLES_PAGE,
      MAGIC_ITEMS_PAGE,
      COMBAT_ACTIONS_PAGE,
      MAKING_AN_ATTACK_PAGE,
      HAZARDS_PAGE,
      FEATS_PAGE,
      EQUIPMENT_PAGE,
      CONDITIONS_PAGE,
    ]);

    await expect(
      runImporter({ pdfPath, outDir, minCreatureCount: 2 }),
    ).rejects.toThrow(/parsed 1 creature stat block\(s\), expected at least 2/);
  });

  // Exact creature name-set coverage (loreweaver-0m9.5.14). The real import CLI
  // passes EXPECTED_SRD_5_1_CREATURE_NAMES; these fixture tests drive the same
  // opt-in gate with a small expected set so a dropped/renamed creature or a
  // bled-in unrelated stat block fails closed by name, not just on count.
  const FULL_FIXTURE_PAGES = [
    RACES_PAGE,
    CLASSES_PAGE,
    CORE_RULES_PAGE_ONE,
    CORE_RULES_PAGE_TWO,
    CORE_RULES_TABLES_PAGE,
    SPELL_LISTS_PAGE,
    SPELLS_PAGE,
    MONSTERS_PAGE,
    TREASURE_TABLES_PAGE,
    MAGIC_ITEMS_PAGE,
    COMBAT_ACTIONS_PAGE,
    MAKING_AN_ATTACK_PAGE,
    HAZARDS_PAGE,
    FEATS_PAGE,
    EQUIPMENT_PAGE,
    CONDITIONS_PAGE,
  ];

  it('fails closed when an expected generated-record source phrase is missing', async () => {
    const workDir = makeTmpDir();
    const pdfPath = join(workDir, 'fixture.pdf');
    const outDir = join(workDir, 'pack');
    await writeFixturePdf(pdfPath, FULL_FIXTURE_PAGES);

    await expect(
      runImporter({
        pdfPath,
        outDir,
        expectedRecordTextSentinels: [
          { recordKey: 'equipment:padded', phrase: 'Armor Proficiency.' },
        ],
      }),
    ).rejects.toThrow(
      /Armor Proficiency.*equipment:padded.*missing source prose/,
    );
    expect(existsSync(join(outDir, 'records.json'))).toBe(false);
  });

  it('fails closed when an expected creature name is missing from the parse', async () => {
    const workDir = makeTmpDir();
    const pdfPath = join(workDir, 'fixture.pdf');
    const outDir = join(workDir, 'pack');
    // The fixture's Monsters section yields only Goblin; an expected set that
    // also demands Aboleth must trip the exact-coverage gate naming the
    // missing creature, and write nothing.
    await writeFixturePdf(pdfPath, FULL_FIXTURE_PAGES);

    await expect(
      runImporter({
        pdfPath,
        outDir,
        expectedCreatureNames: ['Aboleth', 'Goblin'],
      }),
    ).rejects.toThrow(/missing expected creature\(s\): Aboleth/);
    expect(() => readFileSync(join(outDir, 'records.json'), 'utf8')).toThrow();
  });

  it('fails closed when the parse yields a creature not in the expected set', async () => {
    const workDir = makeTmpDir();
    const pdfPath = join(workDir, 'fixture.pdf');
    const outDir = join(workDir, 'pack');
    // Goblin is parsed but not in the expected set — exactly the column-wrap /
    // NPC-bleed failure mode the exact gate is meant to catch.
    await writeFixturePdf(pdfPath, FULL_FIXTURE_PAGES);

    await expect(
      runImporter({ pdfPath, outDir, expectedCreatureNames: ['Aboleth'] }),
    ).rejects.toThrow(/unexpected creature\(s\): Goblin/);
  });

  it('accepts a parse whose creature names match the expected set exactly', async () => {
    const workDir = makeTmpDir();
    const pdfPath = join(workDir, 'fixture.pdf');
    const outDir = join(workDir, 'pack');
    // Goblin is the only creature the fixture yields; an expected set of exactly
    // ['Goblin'] satisfies the gate and the import writes a pack.
    await writeFixturePdf(pdfPath, FULL_FIXTURE_PAGES);

    await expect(
      runImporter({ pdfPath, outDir, expectedCreatureNames: ['Goblin'] }),
    ).resolves.toBeDefined();
    expect(readFileSync(join(outDir, 'records.json'), 'utf8')).toContain(
      'creature:goblin',
    );
  });

  // Appendix MM-B: Nonplayer Characters (loreweaver-bn0). The NPC page is
  // appended after the standard fixture so the slice-to-EOF nonplayerCharacters
  // anchor captures exactly it; the NPC stat block emits under the `creature`
  // kind with data.category='npc' and is counted separately from the monster
  // creature(s).
  it('imports Appendix MM-B NPC stat blocks as creature records tagged category=npc', async () => {
    const workDir = makeTmpDir();
    const pdfPath = join(workDir, 'fixture.pdf');
    const outDir = join(workDir, 'pack');
    await writeFixturePdf(pdfPath, [
      ...FULL_FIXTURE_PAGES,
      NONPLAYER_CHARACTERS_PAGE,
    ]);

    const result = await runImporter({ pdfPath, outDir });
    // The monster creature count (Goblin) stays separate from the NPC count.
    expect(result.counts.creatures).toBe(1);
    expect(result.counts.npcs).toBe(1);

    const pack = loadRulesPackFromDirectory(outDir);
    const captain = pack.records.find(
      (r) => r.key === 'creature:bandit-captain',
    );
    expect(captain?.kind).toBe('creature');
    expect(captain?.name).toBe('Bandit Captain');
    const captainData = captain?.data as Record<string, unknown>;
    expect(captainData.category).toBe('npc');
    expect(captainData.armorClass).toEqual({
      value: 15,
      source: 'studded leather',
      sourceText: '15 (studded leather)',
    });
    expect(captainData.hitPoints).toEqual({ value: 65, formula: '10d8 + 20' });
    expect(captainData.challengeRating).toBe('2');

    // The monster creature carries NO category field (its absence means
    // "monster"), so it stays byte-identical to the pre-NPC pack.
    const goblin = pack.records.find((r) => r.key === 'creature:goblin');
    expect((goblin?.data as Record<string, unknown>)?.category).toBeUndefined();
  });

  it('fails closed when expectedNpcNames is supplied but the NPC parse drifts', async () => {
    const workDir = makeTmpDir();
    const pdfPath = join(workDir, 'fixture.pdf');
    const outDir = join(workDir, 'pack');
    // The fixture's MM-B section yields only Bandit Captain; an expected set that
    // also demands Berserker must trip the exact NPC-coverage gate naming the
    // missing NPC, and write nothing (loreweaver-bn0).
    await writeFixturePdf(pdfPath, [
      ...FULL_FIXTURE_PAGES,
      NONPLAYER_CHARACTERS_PAGE,
    ]);

    const promise = runImporter({
      pdfPath,
      outDir,
      expectedNpcNames: ['Bandit Captain', 'Berserker'],
    });
    await expect(promise).rejects.toThrow(NpcCoverageError);
    await expect(promise).rejects.toThrow(
      /missing expected NPC\(s\): Berserker/,
    );
    expect(() => readFileSync(join(outDir, 'records.json'), 'utf8')).toThrow();
  });

  it('succeeds with npcs=0 when the Appendix MM-B section is absent (best-effort)', async () => {
    const workDir = makeTmpDir();
    const pdfPath = join(workDir, 'fixture.pdf');
    const outDir = join(workDir, 'pack');
    // No NONPLAYER_CHARACTERS_PAGE: the nonplayerCharacters start anchor must
    // not match, and the best-effort slice degrades to no NPCs rather than
    // failing the run.
    await writeFixturePdf(pdfPath, FULL_FIXTURE_PAGES);

    const result = await runImporter({ pdfPath, outDir });
    expect(result.counts.npcs).toBe(0);
  });

  it('fails closed when the Classes section yields no classes', async () => {
    const workDir = makeTmpDir();
    const pdfPath = join(workDir, 'fixture.pdf');
    const outDir = join(workDir, 'pack');
    // Every section is present and valid except the Classes chapter, which is
    // found and bounded (Races → Classes → Using Ability Scores) but carries no
    // class block. The class-coverage guard must reject the empty result and
    // write nothing rather than emit a class-less pack.
    await writeFixturePdf(pdfPath, [
      RACES_PAGE,
      CLASSES_PAGE_NO_CLASSES,
      CORE_RULES_PAGE_ONE,
      CORE_RULES_PAGE_TWO,
      CORE_RULES_TABLES_PAGE,
      SPELL_LISTS_PAGE,
      SPELLS_PAGE,
      MONSTERS_PAGE,
      TREASURE_TABLES_PAGE,
      MAGIC_ITEMS_PAGE,
      COMBAT_ACTIONS_PAGE,
      MAKING_AN_ATTACK_PAGE,
      HAZARDS_PAGE,
      FEATS_PAGE,
      EQUIPMENT_PAGE,
      CONDITIONS_PAGE,
    ]);

    await expect(runImporter({ pdfPath, outDir })).rejects.toThrow(
      ClassCoverageError,
    );
    // Nothing should have been written.
    expect(() => readFileSync(join(outDir, 'records.json'), 'utf8')).toThrow();
  });

  it('fails closed when the Classes section yields classes but no subclasses', async () => {
    const workDir = makeTmpDir();
    const pdfPath = join(workDir, 'fixture.pdf');
    const outDir = join(workDir, 'pack');
    // The Classes chapter parses a base class (Fighter) but carries no subclass
    // heading. Subclass is an implemented kind, so the subclass-coverage guard
    // must reject the empty result and write nothing rather than emit a pack
    // that silently omits `subclass`.
    await writeFixturePdf(pdfPath, [
      RACES_PAGE,
      CLASSES_PAGE_NO_SUBCLASS,
      CORE_RULES_PAGE_ONE,
      CORE_RULES_PAGE_TWO,
      CORE_RULES_TABLES_PAGE,
      SPELL_LISTS_PAGE,
      SPELLS_PAGE,
      MONSTERS_PAGE,
      TREASURE_TABLES_PAGE,
      MAGIC_ITEMS_PAGE,
      COMBAT_ACTIONS_PAGE,
      MAKING_AN_ATTACK_PAGE,
      HAZARDS_PAGE,
      FEATS_PAGE,
      EQUIPMENT_PAGE,
      CONDITIONS_PAGE,
    ]);

    await expect(runImporter({ pdfPath, outDir })).rejects.toThrow(
      SubclassCoverageError,
    );
    // Nothing should have been written.
    expect(() => readFileSync(join(outDir, 'records.json'), 'utf8')).toThrow();
  });

  it('fails closed when fewer subclasses than minSubclassCount are parsed', async () => {
    const workDir = makeTmpDir();
    const pdfPath = join(workDir, 'fixture.pdf');
    const outDir = join(workDir, 'pack');
    // The fixture's Classes section yields a single subclass (Champion); a
    // minSubclassCount of 2 must trip the coverage floor with a deterministic
    // message naming the observed and expected counts.
    await writeFixturePdf(pdfPath, [
      RACES_PAGE,
      CLASSES_PAGE,
      CORE_RULES_PAGE_ONE,
      CORE_RULES_PAGE_TWO,
      CORE_RULES_TABLES_PAGE,
      SPELL_LISTS_PAGE,
      SPELLS_PAGE,
      MONSTERS_PAGE,
      TREASURE_TABLES_PAGE,
      MAGIC_ITEMS_PAGE,
      COMBAT_ACTIONS_PAGE,
      MAKING_AN_ATTACK_PAGE,
      HAZARDS_PAGE,
      FEATS_PAGE,
      EQUIPMENT_PAGE,
      CONDITIONS_PAGE,
    ]);

    await expect(
      runImporter({ pdfPath, outDir, minSubclassCount: 2 }),
    ).rejects.toThrow(/parsed 1 subclass\(es\), expected at least 2/);
  });

  it('fails closed when the Classes section yields no features', async () => {
    const workDir = makeTmpDir();
    const pdfPath = join(workDir, 'fixture.pdf');
    const outDir = join(workDir, 'pack');
    await writeFixturePdf(pdfPath, [
      RACES_PAGE,
      CLASSES_PAGE_NO_FEATURES,
      CORE_RULES_PAGE_ONE,
      CORE_RULES_PAGE_TWO,
      CORE_RULES_TABLES_PAGE,
      SPELL_LISTS_PAGE,
      SPELLS_PAGE,
      MONSTERS_PAGE,
      TREASURE_TABLES_PAGE,
      MAGIC_ITEMS_PAGE,
      COMBAT_ACTIONS_PAGE,
      MAKING_AN_ATTACK_PAGE,
      HAZARDS_PAGE,
      FEATS_PAGE,
      EQUIPMENT_PAGE,
      CONDITIONS_PAGE,
    ]);

    await expect(runImporter({ pdfPath, outDir })).rejects.toThrow(
      FeatureCoverageError,
    );
    expect(() => readFileSync(join(outDir, 'records.json'), 'utf8')).toThrow();
  });

  it('fails closed when fewer features than minFeatureCount are parsed', async () => {
    const workDir = makeTmpDir();
    const pdfPath = join(workDir, 'fixture.pdf');
    const outDir = join(workDir, 'pack');
    await writeFixturePdf(pdfPath, [
      RACES_PAGE,
      CLASSES_PAGE,
      CORE_RULES_PAGE_ONE,
      CORE_RULES_PAGE_TWO,
      CORE_RULES_TABLES_PAGE,
      SPELL_LISTS_PAGE,
      SPELLS_PAGE,
      MONSTERS_PAGE,
      TREASURE_TABLES_PAGE,
      MAGIC_ITEMS_PAGE,
      COMBAT_ACTIONS_PAGE,
      MAKING_AN_ATTACK_PAGE,
      HAZARDS_PAGE,
      FEATS_PAGE,
      EQUIPMENT_PAGE,
      CONDITIONS_PAGE,
    ]);

    await expect(
      runImporter({ pdfPath, outDir, minFeatureCount: 2 }),
    ).rejects.toThrow(/parsed 1 feature\(s\), expected at least 2/);
  });

  it('succeeds when the Multiclassing section is absent and leaves primaryAbilities empty', async () => {
    const workDir = makeTmpDir();
    const pdfPath = join(workDir, 'fixture.pdf');
    const outDir = join(workDir, 'pack');
    // No MULTICLASSING_PAGE: the orchestrator's best-effort enrichment catches
    // SectionNotFoundError and leaves primaryAbilities as [] (ADR 0007).
    await writeFixturePdf(pdfPath, [
      RACES_PAGE,
      CLASSES_PAGE,
      CORE_RULES_PAGE_ONE,
      CORE_RULES_PAGE_TWO,
      SPELL_LISTS_PAGE,
      SPELLS_PAGE,
      MONSTERS_PAGE,
      TREASURE_TABLES_PAGE,
      MAGIC_ITEMS_PAGE,
      COMBAT_ACTIONS_PAGE,
      MAKING_AN_ATTACK_PAGE,
      HAZARDS_PAGE,
      FEATS_PAGE,
      EQUIPMENT_PAGE,
      CONDITIONS_PAGE,
    ]);

    await runImporter({ pdfPath, outDir });
    const pack = loadRulesPackFromDirectory(outDir);
    const fighter = pack.records.find((r) => r.key === 'class:fighter');
    const fighterData = fighter?.data as Record<string, unknown>;
    expect(fighterData.primaryAbilities).toEqual([]);
  });
});

describe('runImporter — source-structure coverage gate (eshyra-4a7.1)', () => {
  // Fixture PDFs render at a uniform body font size, so every line lands in
  // the inventory's leaf band: the tiers carry no signal, but the gate's
  // mechanics (auto-match, rules, fail-closed, artifact writing) are fully
  // exercised. The real-PDF rule curation is regression-tested against the
  // committed artifacts in srdSourceInventoryArtifact.test.ts.
  it('writes source-inventory.json, source-coverage.json, and source-region-ledger.json when rules are supplied', async () => {
    const workDir = makeTmpDir();
    const pdfPath = join(workDir, 'fixture.pdf');
    const outDir = join(workDir, 'pack');
    await writeFixturePdf(pdfPath, IMPLEMENTED_KINDS_FIXTURE_PAGES);

    await runImporter({
      pdfPath,
      outDir,
      sourceCoverageRules: [
        // Account for every fixture line except the one heading this test
        // wants to fall through to the name auto-match. Curated rules now
        // outrank the auto-match (eshyra-erf5.1), so an unconditional
        // catch-all would swallow real headings too; excluding "Acid Splash"
        // lets it demonstrate the auto-match still covers an emitted
        // record's own heading.
        ignoreRule('fixture-body', (i) => i.text !== 'Acid Splash'),
      ],
      statBlockCoverageExceptionReasons: ['fixture-body'],
    });

    const inventory = JSON.parse(
      readFileSync(join(outDir, 'source-inventory.json'), 'utf8'),
    ) as ReadonlyArray<Record<string, unknown>>;
    expect(inventory.length).toBeGreaterThan(0);
    expect(inventory[0]).toMatchObject({
      page: expect.any(Number),
      lineIndex: expect.any(Number),
      text: expect.any(String),
    });

    const coverage = JSON.parse(
      readFileSync(join(outDir, 'source-coverage.json'), 'utf8'),
    ) as {
      summary: Record<string, unknown>;
      entries: ReadonlyArray<{ text: string; status: string }>;
    };
    expect(coverage.summary.unaccounted).toBe(0);
    // The catch-all ignore excludes "Acid Splash" so the name auto-match
    // still claims that emitted record's own source heading.
    expect(
      coverage.entries.some((e) => e.status === 'record:spell:acid-splash'),
    ).toBe(true);
    expect(
      coverage.entries.some((e) => e.status === 'ignored:fixture-body'),
    ).toBe(true);

    const ledger = JSON.parse(
      readFileSync(join(outDir, 'source-region-ledger.json'), 'utf8'),
    ) as {
      summary: {
        unrepresented: number;
        broadStructuralIgnores: number;
      };
      entries: ReadonlyArray<{ classification: string }>;
    };
    expect(ledger.summary.unrepresented).toBe(0);
    expect(ledger.summary.broadStructuralIgnores).toBe(0);
    // The pack files still load (the loader tolerates the extra artifacts).
    expect(loadRulesPackFromDirectory(outDir).records.length).toBeGreaterThan(
      0,
    );
  });

  it('fails closed and writes nothing when a source structure is unaccounted', async () => {
    const workDir = makeTmpDir();
    const pdfPath = join(workDir, 'fixture.pdf');
    const outDir = join(workDir, 'pack');
    await writeFixturePdf(pdfPath, IMPLEMENTED_KINDS_FIXTURE_PAGES);

    // Empty rule list: every fixture line that isn't an emitted record's own
    // heading is unaccounted, so the gate must throw before writing.
    await expect(
      runImporter({ pdfPath, outDir, sourceCoverageRules: [] }),
    ).rejects.toThrow(SourceInventoryCoverageError);
    expect(existsSync(join(outDir, 'records.json'))).toBe(false);
    expect(existsSync(join(outDir, 'source-inventory.json'))).toBe(false);
    expect(existsSync(join(outDir, 'source-region-ledger.json'))).toBe(false);
  });

  it('skips the gate and writes no artifacts when rules are omitted', async () => {
    const workDir = makeTmpDir();
    const pdfPath = join(workDir, 'fixture.pdf');
    const outDir = join(workDir, 'pack');
    await writeFixturePdf(pdfPath, IMPLEMENTED_KINDS_FIXTURE_PAGES);

    await runImporter({ pdfPath, outDir });
    expect(existsSync(join(outDir, 'records.json'))).toBe(true);
    expect(existsSync(join(outDir, 'source-inventory.json'))).toBe(false);
    expect(existsSync(join(outDir, 'source-coverage.json'))).toBe(false);
    expect(existsSync(join(outDir, 'source-region-ledger.json'))).toBe(false);
  });
});
