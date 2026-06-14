/**
 * Programmatic API for the D&D 5e SRD 5.1 importer.
 *
 * `runImporter` is the single entry point: reads the vendored PDF, extracts
 * text, slices the SRD's spell-descriptions and spell-lists sections using
 * deterministic anchor headings (see `sections.ts`), parses spells (and
 * spell-class lists) against those narrowed slices, builds a validated
 * `RulesPack`, and writes `manifest.json` + `records.json` to the requested
 * output directory.
 *
 * Failing-closed design: if the section anchors don't match the input PDF,
 * the importer throws `SectionNotFoundError`. It never silently runs the
 * spell parser over the whole PDF (which would let class-list text and
 * unrelated chapters bleed into the last spell's body). The creature set is
 * additionally guarded by `validateCreatureCoverage`: an empty Monsters parse
 * always throws `CreatureCoverageError`, and the real import is validated
 * against the exact SRD 5.1 creature name set (`EXPECTED_SRD_5_1_CREATURE_NAMES`)
 * so a dropped, renamed, or spuriously-extracted creature trips immediately by
 * name rather than only on gross truncation. The ancestry set is guarded the
 * same way (exact expected-name coverage) so a valid Races slice cannot
 * silently under-extract race/subrace records.
 *
 * Appendix MM-B: Nonplayer Characters (the 21 generic NPC stat blocks — Acolyte,
 * Bandit Captain, Berserker, …) is imported too (loreweaver-bn0): NPC stat blocks
 * are encounter-usable combatants in the same shape as monsters, so they emit
 * under the `creature` kind with a `data.category: 'npc'` discriminator. They are
 * parsed from their own slice and guarded by their own exact name-set gate
 * (`EXPECTED_SRD_5_1_NPC_NAMES`), kept separate from the 296-creature monster
 * baseline so the two coverage sets cannot contaminate each other.
 *
 * Scope today: spells, creatures, base classes, subclasses, features,
 * conditions, feats, hazards, traps (emitted under the `hazard` kind), actions,
 * rules, tables, equipment, magic items, ancestries (races + subraces), and
 * backgrounds (the Acolyte entry plus its suggested-characteristics roll
 * tables; eshyra-0m9.17). Subclasses (Champion, Life domain, …) and class /
 * subclass features parse from the same Classes-chapter slice as base classes.
 * Other SRD record kinds are tracked under `loreweaver-0m9.5` child issues;
 * until those parsers ship the importer deliberately omits them so the
 * generated pack does not claim coverage it does not have. See `README.md`
 * next to this file for the breakdown.
 */

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import {
  buildPack,
  writePackToDirectory,
  writeSourceCoverageArtifacts,
} from './emit.js';
import { extractPdfText } from './extract.js';
import { parseActions } from './parseActions.js';
import { parseAncestries } from './parseAncestries.js';
import { parseBackgrounds } from './parseBackgrounds.js';
import { parseClassCallouts } from './parseClassCallouts.js';
import { parseClasses } from './parseClasses.js';
import { parseConditions } from './parseConditions.js';
import { parseCreatures } from './parseCreatures.js';
import { parseDiseases } from './parseDiseases.js';
import { parseDocumentTables } from './parseDocumentTables.js';
import { parseEquipment, parseMountsAndVehicles } from './parseEquipment.js';
import { parseFeats } from './parseFeats.js';
import { parseFeatures } from './parseFeatures.js';
import { parseGamemasteringRules } from './parseGamemasteringRules.js';
import { parseHazards } from './parseHazards.js';
import { parseMagicItems } from './parseMagicItems.js';
import { parseMulticlassing } from './parseMulticlassing.js';
import { parsePoisons } from './parsePoisons.js';
import { parseRules, removeTableCellLines } from './parseRules.js';
import { parseSelfSufficiency } from './parseSelfSufficiency.js';
import { parseSpellcastingServices } from './parseSpellcastingServices.js';
import { parseSpellClassLists, parseSpells } from './parseSpells.js';
import { parseStatBlocks } from './parseStatBlocks.js';
import { parseSubclasses } from './parseSubclasses.js';
import { parseTables } from './parseTables.js';
import { parseTraps } from './parseTraps.js';
import {
  type SectionAnchorOptions,
  SectionNotFoundError,
  SRD_5_1_DEFAULT_SECTION_ANCHORS,
  type Srd51SectionAnchors,
  sliceSection,
} from './sections.js';
import { buildSourceInventory } from './sourceInventory.js';
import {
  assertSourceCoverage,
  buildSourceCoverageReport,
  type CoverageRule,
  evaluateSourceCoverage,
} from './sourceInventoryCoverage.js';
import type {
  AncestryExtraction,
  BackgroundExtraction,
  ClassPrimaryAbilityIndex,
  CreatureExtraction,
  DiseaseExtraction,
  ImporterRunResult,
  MagicItemExtraction,
  PoisonExtraction,
  RuleExtraction,
  StatBlockExtraction,
  TableExtraction,
  TrapExtraction,
} from './types.js';

/**
 * Reviewed MONSTER count for the vendored SRD 5.1 CC PDF: 201 stat blocks
 * in the alphabetic "Monsters" chapter plus 95 in "Appendix MM-A:
 * Miscellaneous Creatures" (animals/beasts/swarms). This is the monster
 * baseline only — "Appendix MM-B: Nonplayer Characters" emits 21 additional
 * `creature` records guarded by their own `EXPECTED_SRD_5_1_NPC_NAMES` set
 * (loreweaver-bn0), so the pack's total `creature` per-kind count is
 * 296 + 21 = 317. Because the source PDF is vendored and hash-pinned (see
 * `sources/dnd5e-srd-5.1/`), this is a fixed property of the input artifact:
 * any change must be an intentional baseline update with re-review, not
 * slack-headroom.
 *
 * This is the documented count baseline for the vendored artifact. The real
 * import is gated on the stronger exact name set below
 * (`EXPECTED_SRD_5_1_CREATURE_NAMES`), whose length a test cross-checks against
 * this constant so the two cannot drift. It remains a coarse opt-in floor
 * (`minCreatureCount`) for fixture pipelines that exercise a reduced Monsters
 * section without the full name set.
 */
export const MIN_EXPECTED_SRD_5_1_CREATURES = 296;

/**
 * Reviewed, checked-in SRD 5.1 creature name-set baseline (loreweaver-0m9.5.14).
 * The real import validates parsed creature names against this exact set, so
 * `validateCreatureCoverage` fails closed naming any specific missing, renamed,
 * or spuriously-extracted creature, not just gross truncation. Replaces the
 * bare `MIN_EXPECTED_SRD_5_1_CREATURES` count floor for the real import.
 *
 * Provenance — this is a reviewed regression baseline, NOT runtime-derived
 * expected data:
 *   1. A candidate list was *generated* from the vendored SRD 5.1 PDF by
 *      running the importer over it
 *      (`npm run generate:dnd5e-srd-creature-names`). Hand-enumerating 296
 *      Monsters-chapter names is the error-prone task the bead explicitly
 *      warned against, so the candidate is machine-produced, not hand-typed.
 *   2. That candidate was *reviewed against the SRD source* — the alphabetic
 *      "Monsters" chapter (201 stat blocks) plus "Appendix MM-A: Miscellaneous
 *      Creatures" (95 entries). "Appendix MM-B: Nonplayer Characters" is NOT in
 *      this set — it has its own `EXPECTED_SRD_5_1_NPC_NAMES` baseline
 *      (loreweaver-bn0) so the monster and NPC coverage sets stay independent.
 *   3. The reviewed list is committed here as a fixed baseline.
 *
 * Its value is forward regression protection: it does not by itself prove the
 * importer captured the SRD completely (the one-time review step did that).
 * Once committed, a parser change that drops, adds, or renames a creature
 * record fails closed against it. A test in `srdGeneratedPack.test.ts` compares
 * the committed pack's creature record names against this baseline so the two
 * cannot drift apart silently; an intentional coverage change re-runs the
 * generator, re-reviews, and updates this constant in the same change.
 */
export const EXPECTED_SRD_5_1_CREATURE_NAMES: readonly string[] = [
  'Aboleth',
  'Adult Black Dragon',
  'Adult Blue Dragon',
  'Adult Brass Dragon',
  'Adult Bronze Dragon',
  'Adult Copper Dragon',
  'Adult Gold Dragon',
  'Adult Green Dragon',
  'Adult Red Dragon',
  'Adult Silver Dragon',
  'Adult White Dragon',
  'Air Elemental',
  'Ancient Black Dragon',
  'Ancient Blue Dragon',
  'Ancient Brass Dragon',
  'Ancient Bronze Dragon',
  'Ancient Copper Dragon',
  'Ancient Gold Dragon',
  'Ancient Green Dragon',
  'Ancient Red Dragon',
  'Ancient Silver Dragon',
  'Ancient White Dragon',
  'Androsphinx',
  'Animated Armor',
  'Ankheg',
  'Ape',
  'Awakened Shrub',
  'Awakened Tree',
  'Axe Beak',
  'Azer',
  'Baboon',
  'Badger',
  'Balor',
  'Barbed Devil',
  'Basilisk',
  'Bat',
  'Bearded Devil',
  'Behir',
  'Black Bear',
  'Black Dragon Wyrmling',
  'Black Pudding',
  'Blink Dog',
  'Blood Hawk',
  'Blue Dragon Wyrmling',
  'Boar',
  'Bone Devil',
  'Brass Dragon Wyrmling',
  'Bronze Dragon Wyrmling',
  'Brown Bear',
  'Bugbear',
  'Bulette',
  'Camel',
  'Cat',
  'Centaur',
  'Chain Devil',
  'Chimera',
  'Chuul',
  'Clay Golem',
  'Cloaker',
  'Cloud Giant',
  'Cockatrice',
  'Constrictor Snake',
  'Copper Dragon Wyrmling',
  'Couatl',
  'Crab',
  'Crocodile',
  'Darkmantle',
  'Death Dog',
  'Deer',
  'Deva',
  'Dire Wolf',
  'Djinni',
  'Doppelganger',
  'Draft Horse',
  'Dragon Turtle',
  'Dretch',
  'Drider',
  'Dryad',
  'Duergar',
  'Dust Mephit',
  'Eagle',
  'Earth Elemental',
  'Efreeti',
  'Elephant',
  'Elf, Drow',
  'Elk',
  'Erinyes',
  'Ettercap',
  'Ettin',
  'Fire Elemental',
  'Fire Giant',
  'Flesh Golem',
  'Flying Snake',
  'Flying Sword',
  'Frog',
  'Frost Giant',
  'Gargoyle',
  'Gelatinous Cube',
  'Ghast',
  'Ghost',
  'Ghoul',
  'Giant Ape',
  'Giant Badger',
  'Giant Bat',
  'Giant Boar',
  'Giant Centipede',
  'Giant Constrictor Snake',
  'Giant Crab',
  'Giant Crocodile',
  'Giant Eagle',
  'Giant Elk',
  'Giant Fire Beetle',
  'Giant Frog',
  'Giant Goat',
  'Giant Hyena',
  'Giant Lizard',
  'Giant Octopus',
  'Giant Owl',
  'Giant Poisonous Snake',
  'Giant Rat',
  'Giant Scorpion',
  'Giant Sea Horse',
  'Giant Shark',
  'Giant Spider',
  'Giant Toad',
  'Giant Vulture',
  'Giant Wasp',
  'Giant Weasel',
  'Giant Wolf Spider',
  'Gibbering Mouther',
  'Glabrezu',
  'Gnoll',
  'Gnome, Deep (Svirfneblin)',
  'Goat',
  'Goblin',
  'Gold Dragon Wyrmling',
  'Gorgon',
  'Gray Ooze',
  'Green Dragon Wyrmling',
  'Green Hag',
  'Grick',
  'Griffon',
  'Grimlock',
  'Guardian Naga',
  'Gynosphinx',
  'Half-Red Dragon Veteran',
  'Harpy',
  'Hawk',
  'Hell Hound',
  'Hezrou',
  'Hill Giant',
  'Hippogriff',
  'Hobgoblin',
  'Homunculus',
  'Horned Devil',
  'Hunter Shark',
  'Hydra',
  'Hyena',
  'Ice Devil',
  'Ice Mephit',
  'Imp',
  'Invisible Stalker',
  'Iron Golem',
  'Jackal',
  'Killer Whale',
  'Kobold',
  'Kraken',
  'Lamia',
  'Lemure',
  'Lich',
  'Lion',
  'Lizard',
  'Lizardfolk',
  'Magma Mephit',
  'Magmin',
  'Mammoth',
  'Manticore',
  'Marilith',
  'Mastiff',
  'Medusa',
  'Merfolk',
  'Merrow',
  'Mimic',
  'Minotaur',
  'Minotaur Skeleton',
  'Mule',
  'Mummy',
  'Mummy Lord',
  'Nalfeshnee',
  'Night Hag',
  'Nightmare',
  'Ochre Jelly',
  'Octopus',
  'Ogre',
  'Ogre Zombie',
  'Oni',
  'Orc',
  'Otyugh',
  'Owl',
  'Owlbear',
  'Panther',
  'Pegasus',
  'Phase Spider',
  'Pit Fiend',
  'Planetar',
  'Plesiosaurus',
  'Poisonous Snake',
  'Polar Bear',
  'Pony',
  'Pseudodragon',
  'Purple Worm',
  'Quasit',
  'Quipper',
  'Rakshasa',
  'Rat',
  'Raven',
  'Red Dragon Wyrmling',
  'Reef Shark',
  'Remorhaz',
  'Rhinoceros',
  'Riding Horse',
  'Roc',
  'Roper',
  'Rug of Smothering',
  'Rust Monster',
  'Saber-Toothed Tiger',
  'Sahuagin',
  'Salamander',
  'Satyr',
  'Scorpion',
  'Sea Hag',
  'Sea Horse',
  'Shadow',
  'Shambling Mound',
  'Shield Guardian',
  'Shrieker',
  'Silver Dragon Wyrmling',
  'Skeleton',
  'Solar',
  'Specter',
  'Spider',
  'Spirit Naga',
  'Sprite',
  'Steam Mephit',
  'Stirge',
  'Stone Giant',
  'Stone Golem',
  'Storm Giant',
  'Succubus/Incubus',
  'Swarm of Bats',
  'Swarm of Insects',
  'Swarm of Poisonous Snakes',
  'Swarm of Quippers',
  'Swarm of Rats',
  'Swarm of Ravens',
  'Tarrasque',
  'Tiger',
  'Treant',
  'Triceratops',
  'Troll',
  'Tyrannosaurus Rex',
  'Unicorn',
  'Vampire',
  'Vampire Spawn',
  'Violet Fungus',
  'Vrock',
  'Vulture',
  'Warhorse',
  'Warhorse Skeleton',
  'Water Elemental',
  'Weasel',
  'Werebear',
  'Wereboar',
  'Wererat',
  'Weretiger',
  'Werewolf',
  'White Dragon Wyrmling',
  'Wight',
  'Will-o’-Wisp',
  'Winter Wolf',
  'Wolf',
  'Worg',
  'Wraith',
  'Wyvern',
  'Xorn',
  'Young Black Dragon',
  'Young Blue Dragon',
  'Young Brass Dragon',
  'Young Bronze Dragon',
  'Young Copper Dragon',
  'Young Gold Dragon',
  'Young Green Dragon',
  'Young Red Dragon',
  'Young Silver Dragon',
  'Young White Dragon',
  'Zombie',
];

/**
 * Reviewed, checked-in SRD 5.1 Appendix MM-B Nonplayer-Character name-set
 * baseline (loreweaver-bn0). The real import validates the parsed NPC names
 * against this exact set, so a dropped, renamed, or spuriously-extracted NPC
 * fails closed by name. These 21 generic NPC stat blocks (Acolyte … Veteran)
 * are the complete contents of Appendix MM-B in the vendored SRD 5.1 PDF; they
 * emit under the `creature` kind with `data.category: 'npc'` and are kept
 * separate from `EXPECTED_SRD_5_1_CREATURE_NAMES` (the 296-monster baseline) so
 * neither coverage set can mask drift in the other. None of these names collide
 * with a monster creature name, so the `creature:<slug>` keyspace stays unique.
 */
export const EXPECTED_SRD_5_1_NPC_NAMES: readonly string[] = [
  'Acolyte',
  'Archmage',
  'Assassin',
  'Bandit',
  'Bandit Captain',
  'Berserker',
  'Commoner',
  'Cult Fanatic',
  'Cultist',
  'Druid',
  'Gladiator',
  'Guard',
  'Knight',
  'Mage',
  'Noble',
  'Priest',
  'Scout',
  'Spy',
  'Thug',
  'Tribal Warrior',
  'Veteran',
];

/**
 * Minimum number of base classes a full SRD 5.1 import must yield. The SRD 5.1
 * "Classes" chapter contains the 12 base classes (Barbarian … Wizard). This
 * floor catches a gross extraction regression — an empty or badly-truncated
 * class parse — when the importer runs against the real PDF. The CLI passes this
 * value; fixture-based tests rely on the always-on empty-result guard (or pass a
 * smaller floor). Subclasses and features are separate kinds (ADR 0009) and are
 * not counted here.
 */
export const MIN_EXPECTED_SRD_5_1_CLASSES = 12;

/**
 * Minimum number of subclasses a full SRD 5.1 import must yield. The SRD 5.1
 * publishes exactly one subclass per base class — 12 in total (Path of the
 * Berserker … School of Evocation). This floor catches a gross extraction
 * regression — an empty or badly-truncated subclass parse — when the importer
 * runs against the real PDF (e.g. if the subclass headings drift and the
 * known-name matcher misses them). The CLI passes this value; fixture-based
 * tests rely on the always-on empty-result guard (or pass a smaller floor).
 * Subclasses parse from the same Classes-chapter slice as base classes; see
 * ADR 0009 and loreweaver-0m9.5.17.
 */
export const MIN_EXPECTED_SRD_5_1_SUBCLASSES = 12;

/**
 * Minimum number of class/subclass-granted features a full SRD 5.1 import must
 * yield. The real Classes chapter contains substantially more than one feature
 * per class; this conservative floor catches empty or badly truncated feature
 * parses without trying to be an exact coverage audit.
 */
export const MIN_EXPECTED_SRD_5_1_FEATURES = 12;

/**
 * Race + subrace records the SRD 5.1 PDF publishes. The SRD 5.1 includes the 9
 * base PHB races but only ONE subrace per race-with-subraces (4 subraces total:
 * Hill Dwarf, High Elf, Lightfoot Halfling, Rock Gnome) — the other PHB
 * subraces (Mountain Dwarf, Wood Elf, Dark Elf/Drow, Stout Halfling, Forest
 * Gnome) are not part of the CC-BY-4.0 SRD 5.1. The `parseAncestries`
 * `KNOWN_SUBRACES` list is intentionally broader so the parser still detects
 * those headings in synthetic fixtures or future SRD revisions; this constant
 * is the coverage gate for the real vendored SRD 5.1 PDF specifically.
 */
export const EXPECTED_SRD_5_1_ANCESTRY_NAMES: readonly string[] = [
  'Dragonborn',
  'Dwarf',
  'Elf',
  'Gnome',
  'Half-Elf',
  'Half-Orc',
  'Halfling',
  'Human',
  'Tiefling',
  'Hill Dwarf',
  'High Elf',
  'Lightfoot Halfling',
  'Rock Gnome',
];

/**
 * Backgrounds the SRD 5.1 "Backgrounds" chapter publishes (eshyra-0m9.17):
 * Acolyte is the chapter's only entry. The real import validates the parsed
 * background names against this exact set (like ancestries/traps), so a
 * dropped or renamed background — or chapter-intro prose spuriously promoted
 * to an entry — fails closed by name. Each background's four
 * suggested-characteristics roll tables emit under the `table` kind and are
 * gated by `EXPECTED_SRD_5_1_TABLE_NAMES`.
 */
export const EXPECTED_SRD_5_1_BACKGROUND_NAMES: readonly string[] = ['Acolyte'];

/**
 * Sample traps the SRD 5.1 "Traps" section publishes (loreweaver-hvp). The SRD
 * presents eight alphabetic sample traps; "Pits" is a single entry describing
 * four variants (Simple/Hidden/Locking/Spiked) under one "Mechanical trap"
 * subtitle, so it is one record. The real import validates the parsed trap
 * names against this exact set (like ancestries), so a dropped, renamed, or
 * spuriously-extracted trap fails closed by name rather than only on gross
 * truncation. Traps are emitted under the `hazard` record kind (see
 * `trapExtractionsToRecords`).
 */
export const EXPECTED_SRD_5_1_TRAP_NAMES: readonly string[] = [
  'Collapsing Roof',
  'Falling Net',
  'Fire-Breathing Statue',
  'Pits',
  'Poison Darts',
  'Poison Needle',
  'Rolling Sphere',
  'Sphere of Annihilation',
];

/**
 * Sample diseases the SRD 5.1 "Diseases" section publishes (loreweaver-6ra):
 * Cackle Fever, Sewer Plague, Sight Rot. The real import validates the parsed
 * disease names against this exact set (like traps/ancestries), so a dropped,
 * renamed, or spuriously-extracted disease fails closed by name. Diseases emit
 * under the `hazard` record kind with `data.category: 'disease'`.
 */
export const EXPECTED_SRD_5_1_DISEASE_NAMES: readonly string[] = [
  'Cackle Fever',
  'Sewer Plague',
  'Sight Rot',
];

/**
 * Sample poisons the SRD 5.1 "Poisons" section publishes (loreweaver-6ra): the
 * 14 named poisons (Assassin's Blood … Wyvern Poison), each with a delivery
 * type, a price per dose, and a save-DC/effect description. The real import
 * validates the parsed poison names against this exact set, so a dropped,
 * renamed, or spuriously-extracted poison fails closed by name. Poisons emit
 * under the `hazard` record kind with `data.category: 'poison'`.
 */
export const EXPECTED_SRD_5_1_POISON_NAMES: readonly string[] = [
  'Assassin’s Blood',
  'Burnt Othur Fumes',
  'Crawler Mucus',
  'Drow Poison',
  'Essence of Ether',
  'Malice',
  'Midnight Tears',
  'Oil of Taggit',
  'Pale Tincture',
  'Purple Worm Poison',
  'Serpent Venom',
  'Torpor',
  'Truth Serum',
  'Wyvern Poison',
];

/**
 * Reviewed count for the vendored SRD 5.1 magic items: the 239 entries in the
 * "Magic Items A-Z" section plus the lone "Artifacts"-subsection entry, Orb of
 * Dragonkind (eshyra-0m9.16), for 240 total. The real import is gated on the
 * stronger exact name set below (`EXPECTED_SRD_5_1_MAGIC_ITEM_NAMES`), whose
 * length a test cross-checks against this constant so the two cannot drift. It
 * remains a coarse opt-in floor (`minMagicItemCount`) for fixture pipelines that
 * exercise a reduced Magic Items section without the full name set.
 */
export const MIN_EXPECTED_SRD_5_1_MAGIC_ITEMS = 240;

/**
 * Reviewed, checked-in SRD 5.1 Magic Items A-Z name-set baseline
 * (loreweaver-ecr). The real import validates parsed magic-item names against
 * this exact set, so a dropped, renamed, or spuriously-extracted item fails
 * closed by name rather than only on gross truncation. This baseline was
 * generated from the vendored, hash-pinned SRD 5.1 PDF, reviewed for parser
 * artifacts from two-column interleaving/table rows, and committed as fixed
 * regression data. Embedded item-specific tables stay in the parent item's
 * `description`; they do not emit as standalone `table` records.
 */
export const EXPECTED_SRD_5_1_MAGIC_ITEM_NAMES: readonly string[] = [
  'Adamantine Armor',
  'Ammunition, +1, +2, or +3',
  'Amulet of Health',
  'Amulet of Proof against Detection and Location',
  'Amulet of the Planes',
  'Animated Shield',
  'Apparatus of the Crab',
  'Armor of Invulnerability',
  'Armor of Resistance',
  'Armor of Vulnerability',
  'Armor, +1, +2, or +3',
  'Arrow of Slaying',
  'Arrow-Catching Shield',
  'Bag of Beans',
  'Bag of Devouring',
  'Bag of Holding',
  'Bag of Tricks',
  'Bead of Force',
  'Belt of Dwarvenkind',
  'Belt of Giant Strength',
  'Berserker Axe',
  'Boots of Elvenkind',
  'Boots of Levitation',
  'Boots of Speed',
  'Boots of Striding and Springing',
  'Boots of the Winterlands',
  'Bowl of Commanding Water Elementals',
  'Bracers of Archery',
  'Bracers of Defense',
  'Brazier of Commanding Fire Elementals',
  'Brooch of Shielding',
  'Broom of Flying',
  'Candle of Invocation',
  'Cape of the Mountebank',
  'Carpet of Flying',
  'Censer of Controlling Air Elementals',
  'Chime of Opening',
  'Circlet of Blasting',
  'Cloak of Arachnida',
  'Cloak of Displacement',
  'Cloak of Elvenkind',
  'Cloak of Protection',
  'Cloak of the Bat',
  'Cloak of the Manta Ray',
  'Crystal Ball',
  'Cube of Force',
  'Cubic Gate',
  'Dagger of Venom',
  'Dancing Sword',
  'Decanter of Endless Water',
  'Deck of Illusions',
  'Deck of Many Things',
  'Defender',
  'Demon Armor',
  'Dimensional Shackles',
  'Dragon Scale Mail',
  'Dragon Slayer',
  'Dust of Disappearance',
  'Dust of Dryness',
  'Dust of Sneezing and Choking',
  'Dwarven Plate',
  'Dwarven Thrower',
  'Efficient Quiver',
  'Efreeti Bottle',
  'Elemental Gem',
  'Elven Chain',
  'Eversmoking Bottle',
  'Eyes of Charming',
  'Eyes of Minute Seeing',
  'Eyes of the Eagle',
  'Feather Token',
  'Figurine of Wondrous Power',
  'Flame Tongue',
  'Folding Boat',
  'Frost Brand',
  'Gauntlets of Ogre Power',
  'Gem of Brightness',
  'Gem of Seeing',
  'Giant Slayer',
  'Glamoured Studded Leather',
  'Gloves of Missile Snaring',
  'Gloves of Swimming and Climbing',
  'Goggles of Night',
  'Hammer of Thunderbolts',
  'Handy Haversack',
  'Hat of Disguise',
  'Headband of Intellect',
  'Helm of Brilliance',
  'Helm of Comprehending Languages',
  'Helm of Telepathy',
  'Helm of Teleportation',
  'Holy Avenger',
  'Horn of Blasting',
  'Horn of Valhalla',
  'Horseshoes of Speed',
  'Horseshoes of a Zephyr',
  'Immovable Rod',
  'Instant Fortress',
  'Ioun Stone',
  'Iron Bands of Binding',
  'Iron Flask',
  'Javelin of Lightning',
  'Lantern of Revealing',
  'Luck Blade',
  'Mace of Disruption',
  'Mace of Smiting',
  'Mace of Terror',
  'Mantle of Spell Resistance',
  'Manual of Bodily Health',
  'Manual of Gainful Exercise',
  'Manual of Golems',
  'Manual of Quickness of Action',
  'Marvelous Pigments',
  'Medallion of Thoughts',
  'Mirror of Life Trapping',
  'Mithral Armor',
  'Necklace of Adaptation',
  'Necklace of Fireballs',
  'Necklace of Prayer Beads',
  'Nine Lives Stealer',
  'Oathbow',
  'Oil of Etherealness',
  'Oil of Sharpness',
  'Oil of Slipperiness',
  'Orb of Dragonkind',
  'Pearl of Power',
  'Periapt of Health',
  'Periapt of Proof against Poison',
  'Periapt of Wound Closure',
  'Philter of Love',
  'Pipes of Haunting',
  'Pipes of the Sewers',
  'Plate Armor of Etherealness',
  'Portable Hole',
  'Potion of Animal Friendship',
  'Potion of Clairvoyance',
  'Potion of Climbing',
  'Potion of Diminution',
  'Potion of Flying',
  'Potion of Gaseous Form',
  'Potion of Giant Strength',
  'Potion of Growth',
  'Potion of Healing',
  'Potion of Heroism',
  'Potion of Invisibility',
  'Potion of Mind Reading',
  'Potion of Poison',
  'Potion of Resistance',
  'Potion of Speed',
  'Potion of Water Breathing',
  'Restorative Ointment',
  'Ring of Animal Influence',
  'Ring of Djinni Summoning',
  'Ring of Elemental Command',
  'Ring of Evasion',
  'Ring of Feather Falling',
  'Ring of Free Action',
  'Ring of Invisibility',
  'Ring of Jumping',
  'Ring of Mind Shielding',
  'Ring of Protection',
  'Ring of Regeneration',
  'Ring of Resistance',
  'Ring of Shooting Stars',
  'Ring of Spell Storing',
  'Ring of Spell Turning',
  'Ring of Swimming',
  'Ring of Telekinesis',
  'Ring of Three Wishes',
  'Ring of Warmth',
  'Ring of Water Walking',
  'Ring of X-ray Vision',
  'Ring of the Ram',
  'Robe of Eyes',
  'Robe of Scintillating Colors',
  'Robe of Stars',
  'Robe of Useful Items',
  'Robe of the Archmagi',
  'Rod of Absorption',
  'Rod of Alertness',
  'Rod of Lordly Might',
  'Rod of Rulership',
  'Rod of Security',
  'Rope of Climbing',
  'Rope of Entanglement',
  'Scarab of Protection',
  'Scimitar of Speed',
  'Shield of Missile Attraction',
  'Shield, +1, +2, or +3',
  'Slippers of Spider Climbing',
  'Sovereign Glue',
  'Spell Scroll',
  'Spellguard Shield',
  'Sphere of Annihilation',
  'Staff of Charming',
  'Staff of Fire',
  'Staff of Frost',
  'Staff of Healing',
  'Staff of Power',
  'Staff of Striking',
  'Staff of Swarming Insects',
  'Staff of Thunder and Lightning',
  'Staff of Withering',
  'Staff of the Magi',
  'Staff of the Python',
  'Staff of the Woodlands',
  'Stone of Controlling Earth Elementals',
  'Stone of Good Luck (Luckstone)',
  'Sun Blade',
  'Sword of Life Stealing',
  'Sword of Sharpness',
  'Sword of Wounding',
  'Talisman of Pure Good',
  'Talisman of Ultimate Evil',
  'Talisman of the Sphere',
  'Tome of Clear Thought',
  'Tome of Leadership and Influence',
  'Tome of Understanding',
  'Trident of Fish Command',
  'Universal Solvent',
  'Vicious Weapon',
  'Vorpal Sword',
  'Wand of Binding',
  'Wand of Enemy Detection',
  'Wand of Fear',
  'Wand of Fireballs',
  'Wand of Lightning Bolts',
  'Wand of Magic Detection',
  'Wand of Magic Missiles',
  'Wand of Paralysis',
  'Wand of Polymorph',
  'Wand of Secrets',
  'Wand of Web',
  'Wand of Wonder',
  'Wand of the War Mage, +1, +2, or +3',
  'Weapon, +1, +2, or +3',
  'Well of Many Worlds',
  'Wind Fan',
  'Winged Boots',
  'Wings of Flying',
];

/**
 * Reviewed, checked-in SRD 5.1 inline stat-block name-set baseline
 * (eshyra-4a7.4). These are abbreviated combat stat blocks the SRD prints INLINE
 * under another entry, NOT full creatures: Avatar of Death (p218, inside the
 * Deck of Many Things) and Giant Fly (p222, inside the Figurine of Wondrous
 * Power). They were previously swallowed into magic-item prose; the source
 * inventory flags them (`structure: 'stat-block'`) and `parseStatBlocks` now
 * emits them under the `stat-block` kind. The real import validates the parsed
 * inline-block names against this exact set, so a dropped, renamed, or newly
 * appearing inline block fails closed by name. They ride the permissive
 * `stat-block` kindSchema because their hit points are derived/textual (Avatar
 * of Death) and their challenge rating is absent or "—"; the strict `creature`
 * schema is intentionally left untouched.
 */
export const EXPECTED_SRD_5_1_STAT_BLOCK_NAMES: readonly string[] = [
  'Avatar of Death',
  'Giant Fly',
];

/**
 * Reviewed map from each inline stat block to the SRD entry it is printed under
 * (eshyra-4a7.4). `parseStatBlocks` requires every emitted block to appear here,
 * so a novel inline block fails closed for review. The containing item also
 * gains a `data.statBlockRefs` pointer. Both Deck of Many Things and Figurine
 * of Wondrous Power are emitted magic items, so their inline stat blocks are
 * linked from the containing records.
 */
export const SRD_5_1_STAT_BLOCK_CONTAINING_ITEMS: ReadonlyMap<string, string> =
  new Map([
    ['Avatar of Death', 'Deck of Many Things'],
    ['Giant Fly', 'Figurine of Wondrous Power'],
  ]);

/**
 * Reviewed, checked-in SRD 5.1 combined implemented `rule`-key baseline.
 * The nesting-aware `parseRules` emits one `rule` record per heading across the
 * Using Ability Scores, Adventuring, and Combat chapters — subsection (font
 * h≈18), sub-subsection (h≈13.9), leaf (h≈12), and gray callout-box (h≈10.8,
 * e.g. Hiding, Combat Step by Step) tiers — bounding each body at the next
 * heading so parents keep only their intro and every leaf is its own record.
 * Capturing the h≈10.8 box tier is what keeps a box rule (e.g. the Hiding /
 * Stealth rules, with their inline Passive Perception / What Can You See?
 * lead-ins) from being swallowed into the preceding record's body — the
 * corruption that previously buried Hiding under the Dexterity "Initiative"
 * sidebar. The real import validates the parsed record keys against this exact
 * set (`validateRuleCoverage`), so a dropped leaf, a renamed heading, or a
 * newly-promoted caption/sidebar fails closed by key rather than only on gross
 * truncation.
 *
 * Keys (not names) are the baseline because the SRD repeats rule titles across
 * chapters — "Hit Points" appears under both Constitution and Damage and
 * Healing, "Initiative" under both Dexterity and The Order of Combat,
 * "Difficult Terrain" under both Adventuring movement and Combat movement — and
 * prints three per-ability "Spellcasting Ability" cross-reference sidebars. The
 * parser disambiguates each with a parent-qualified key (e.g.
 * `rule:constitution-hit-points` vs `rule:damage-and-healing-hit-points`) while
 * the record `name` stays the bare SRD title.
 *
 * Intentionally excluded (recorded so a reviewer can see the boundary):
 * `Variant:` optional rules, the per-ability skill-list captions under Ability
 * Checks (their bodies lead with bullet items), and the leaf table captions the
 * `table` kind owns (Ability Scores and Modifiers score table, Typical
 * Difficulty Classes, Travel Pace, Size Categories).
 *
 * The full baseline is 127 core-rules keys, 34 general Spellcasting keys, five
 * gamemastering Madness/Objects keys, five Classes-chapter callout keys, and six
 * gamemastering Traps keys (eshyra-0m9.20). Spellcasting is a separate slice
 * (`spellcastingRules`, "Spellcasting" → "Spell Lists") parsed by the same
 * nesting-aware `parseRules`; the four titles it shares with the core-rules
 * chapters ("Attack Rolls", "Range", "Reactions", "Saving Throws")
 * parent-qualify to `rule:casting-a-spell-*` / `rule:casting-time-reactions`
 * so the core keys stay untouched and no `rule:` key is duplicated across
 * slices.
 */
export const EXPECTED_SRD_5_1_RULE_KEYS: readonly string[] = [
  'rule:ability-checks',
  'rule:ability-scores-and-modifiers',
  'rule:actions-in-combat',
  'rule:advantage-and-disadvantage',
  'rule:armor-class',
  'rule:attack',
  'rule:attack-rolls',
  'rule:being-prone',
  'rule:between-adventures',
  'rule:blindsight',
  'rule:bonus-actions',
  'rule:breaking-up-your-move',
  'rule:cast-a-spell',
  'rule:charisma',
  'rule:charisma-checks',
  'rule:charisma-spellcasting-ability',
  'rule:climbing-swimming-and-crawling',
  'rule:combat-step-by-step',
  'rule:constitution',
  'rule:constitution-checks',
  'rule:constitution-hit-points',
  'rule:contests',
  'rule:contests-in-combat',
  'rule:controlling-a-mount',
  'rule:cover',
  'rule:crafting',
  'rule:creature-size',
  'rule:critical-hits',
  'rule:damage-and-healing',
  'rule:damage-and-healing-hit-points',
  'rule:damage-resistance-and-vulnerability',
  'rule:damage-rolls',
  'rule:damage-types',
  'rule:darkvision',
  'rule:dash',
  'rule:death-saving-throws',
  'rule:dexterity',
  'rule:dexterity-attack-rolls-and-damage',
  'rule:dexterity-checks',
  'rule:dexterity-initiative',
  'rule:disengage',
  'rule:dodge',
  'rule:downtime-activities',
  'rule:dropping-to-0-hit-points',
  'rule:falling',
  'rule:falling-unconscious',
  'rule:flying-movement',
  'rule:food',
  'rule:food-and-water',
  'rule:grappling',
  'rule:group-checks',
  'rule:healing',
  'rule:help',
  'rule:hide',
  'rule:hiding',
  'rule:instant-death',
  'rule:intelligence',
  'rule:intelligence-checks',
  'rule:intelligence-spellcasting-ability',
  'rule:interacting-with-objects',
  'rule:interacting-with-objects-around-you',
  'rule:jumping',
  'rule:knocking-a-creature-out',
  'rule:lifestyle-expenses',
  'rule:lifting-and-carrying',
  'rule:long-rest',
  'rule:making-an-attack',
  'rule:melee-attacks',
  'rule:modifiers-to-the-roll',
  'rule:monsters-and-death',
  'rule:mounted-combat',
  'rule:mounting-and-dismounting',
  'rule:movement',
  'rule:movement-and-position',
  'rule:movement-and-position-difficult-terrain',
  'rule:moving-around-other-creatures',
  'rule:moving-between-attacks',
  'rule:opportunity-attacks',
  'rule:other-activity-on-your-turn',
  'rule:passive-checks',
  'rule:practicing-a-profession',
  'rule:proficiency-bonus',
  'rule:range',
  'rule:ranged-attacks',
  'rule:ranged-attacks-in-close-combat',
  'rule:reactions',
  'rule:ready',
  'rule:recuperating',
  'rule:researching',
  'rule:resting',
  'rule:rolling-1-or-20',
  'rule:saving-throws',
  'rule:search',
  'rule:short-rest',
  'rule:shoving-a-creature',
  'rule:skills',
  'rule:space',
  'rule:special-types-of-movement',
  'rule:speed',
  'rule:speed-difficult-terrain',
  'rule:squeezing-into-a-smaller-space',
  'rule:stabilizing-a-creature',
  'rule:strength',
  'rule:strength-attack-rolls-and-damage',
  'rule:strength-checks',
  'rule:suffocating',
  'rule:surprise',
  'rule:temporary-hit-points',
  'rule:the-environment',
  'rule:the-order-of-combat',
  'rule:the-order-of-combat-initiative',
  'rule:time',
  'rule:training',
  'rule:truesight',
  'rule:two-weapon-fighting',
  'rule:underwater-combat',
  'rule:unseen-attackers-and-targets',
  'rule:use-an-object',
  'rule:using-different-speeds',
  'rule:using-each-ability',
  'rule:vision-and-light',
  'rule:water',
  'rule:wisdom',
  'rule:wisdom-checks',
  'rule:wisdom-spellcasting-ability',
  'rule:working-together',
  'rule:your-turn',
  // Spellcasting-rules chapter (loreweaver-3hp). Separate `spellcastingRules`
  // slice; the four cross-slice title repeats are parent-qualified.
  'rule:a-clear-path-to-the-target',
  'rule:areas-of-effect',
  'rule:bonus-action',
  'rule:cantrips',
  'rule:casting-a-spell',
  'rule:casting-a-spell-at-a-higher-level',
  'rule:casting-a-spell-attack-rolls',
  'rule:casting-a-spell-range',
  'rule:casting-a-spell-saving-throws',
  'rule:casting-in-armor',
  'rule:casting-time',
  'rule:casting-time-reactions',
  'rule:combining-magical-effects',
  'rule:components',
  'rule:concentration',
  'rule:cone',
  'rule:cube',
  'rule:cylinder',
  'rule:duration',
  'rule:instantaneous',
  'rule:known-and-prepared-spells',
  'rule:line',
  'rule:longer-casting-times',
  'rule:material-m',
  'rule:rituals',
  'rule:somatic-s',
  'rule:spell-level',
  'rule:spell-slots',
  // Equipment-chapter Expenses region: the Spellcasting Services prose has no
  // rate table, so it is emitted as a rule (eshyra-0m9.19).
  'rule:spellcasting-services',
  // Races p3 trait-category guidance (eshyra-4a7.10.1).
  'rule:ability-score-increase',
  'rule:age',
  'rule:racial-traits',
  'rule:racial-traits-alignment',
  'rule:racial-traits-languages',
  'rule:racial-traits-size',
  'rule:racial-traits-speed',
  'rule:subraces',
  // Equipment pp64-65 guidance and p73 Self-Sufficiency sidebar
  // (eshyra-4a7.10.1).
  'rule:getting-into-and-out-of-armor',
  'rule:improvised-weapons',
  'rule:self-sufficiency',
  'rule:silvered-weapons',
  'rule:special-weapons',
  'rule:weapon-proficiency',
  'rule:weapon-properties',
  'rule:weapons',
  'rule:sphere',
  'rule:targeting-yourself',
  'rule:targets',
  'rule:the-schools-of-magic',
  'rule:verbal-v',
  'rule:what-is-a-spell',
  // Gamemastering Madness and Objects sections (loreweaver-uuk).
  'rule:curing-madness',
  'rule:going-mad',
  'rule:madness',
  'rule:madness-effects',
  'rule:objects',
  // Classes-chapter callout boxes (loreweaver-0m9.5.23).
  'rule:druid-druids-and-the-gods',
  'rule:druid-sacred-plants-and-wood',
  'rule:paladin-breaking-your-oath',
  'rule:warlock-your-pact-boon',
  'rule:wizard-your-spellbook',
  // "Beyond 1st Level" chapter (eshyra-0m9.18): the chapter intro (the SRD's
  // character-advancement prose — gaining levels, hit-point increases, the
  // ability-score cap — emitted via parseRules's chapterIntro option because
  // it precedes any heading), the Multiclassing subsection tree, and the
  // Alignment / Languages / Inspiration sections. The chapter's "Proficiency
  // Bonus" leaf parent-qualifies to `rule:multiclassing-proficiency-bonus`
  // because the core-rules chapter already owns `rule:proficiency-bonus`. The
  // `rule:spellcasting` key is the Multiclassing "Class Features" leaf of that
  // title (multiclass spellcasting); the GENERAL spellcasting rules live under
  // the Spellcasting-chapter keys above (`rule:what-is-a-spell`,
  // `rule:casting-a-spell`, …) — the chapter title itself is a structural
  // wrapper that never emits, so the bare slug is unique. The chapter's six
  // table captions (Character Advancement, Multiclassing Prerequisites /
  // Proficiencies, Multiclass Spellcaster, Standard / Exotic Languages) are
  // excluded — the `table` kind owns those records.
  'rule:alignment',
  'rule:alignment-in-the-multiverse',
  'rule:beyond-1st-level',
  'rule:channel-divinity',
  'rule:class-features',
  'rule:experience-points',
  'rule:extra-attack',
  'rule:gaining-inspiration',
  'rule:hit-points-and-hit-dice',
  'rule:inspiration',
  'rule:languages',
  'rule:multiclassing',
  'rule:multiclassing-proficiency-bonus',
  'rule:prerequisites',
  'rule:proficiencies',
  'rule:spellcasting',
  'rule:unarmored-defense',
  'rule:using-inspiration',
  // "Magic Items" chapter intro (pp206-207, eshyra-0m9.21): the general
  // magic-item usage rules that precede the A-Z item entries — kept separate
  // from the per-item `magic-item` records. `rule:magic-items` is the chapter
  // intro paragraph (emitted via parseRules's chapterIntro option because it
  // precedes any heading); the rest are the chapter's h≈18 sections
  // (Attunement; Wearing and Wielding Items; Activating an Item) and their
  // h≈13.9 leaves. `rule:spells` is the "Activating an Item > Spells" leaf
  // (casting a spell FROM an item); the bare slug is unique in the rule
  // keyspace — spell data lives under the `spell` kind, and the general
  // casting rules keep their Spellcasting-chapter keys above.
  'rule:activating-an-item',
  'rule:attunement',
  'rule:charges',
  'rule:command-word',
  'rule:consumables',
  'rule:magic-items',
  'rule:multiple-items-of-the-same-kind',
  'rule:paired-items',
  'rule:spells',
  'rule:wearing-and-wielding-items',
  // Gamemastering "Traps" section general rules (eshyra-0m9.20): the
  // chapter-intro paragraph (emitted via parseRules's chapterIntro option
  // because it precedes any heading) plus the five h≈13.9/h≈12 subsections
  // that precede "Sample Traps". The two trap reference table captions
  // ("Trap Save DCs and Attack Bonuses", "Damage Severity by Level") are
  // excluded by TABLE_CAPTION_LEAF_TITLES — the `table` kind owns those.
  // Sample traps stay hazard records only.
  'rule:traps',
  'rule:traps-in-play',
  'rule:triggering-a-trap',
  'rule:detecting-and-disabling-a-trap',
  'rule:trap-effects',
  'rule:complex-traps',
  // Monsters-chapter stat-block interpretation rules (eshyra-0m9.22,
  // pp254-260): the chapter-intro paragraph (`rule:monsters`, emitted via
  // parseRules's chapterIntro option because it precedes any heading), the
  // chapter's h≈13.9 sections and their h≈12 leaves, the h≈18 "Legendary
  // Creatures" tree, and the three h≈10.8 gray callout boxes (Modifying
  // Creatures; Armor, Weapon, and Tool Proficiencies; Grapple Rules for
  // Monsters). Seven section titles are already owned by other slices —
  // Alignment / Languages (Beyond 1st Level) and Armor Class / Speed /
  // Saving Throws / Skills / Reactions (core rules) — and parent-qualify
  // with the chapter title restored by the chapterIntro ancestor seed
  // (`rule:monsters-alignment`, …). Four leaf titles are likewise owned —
  // Blindsight / Darkvision / Truesight (core Vision and Light) and
  // Experience Points / Spellcasting (Beyond 1st Level) — and qualify with
  // their nearest section parent (`rule:senses-blindsight`,
  // `rule:challenge-experience-points`, `rule:special-traits-spellcasting`).
  // The chapter's four reference-table captions (Size Categories, Hit Dice
  // by Size, Proficiency Bonus by Challenge Rating, Experience Points by
  // Challenge Rating) are excluded — the `table` kind owns those records.
  'rule:monsters',
  'rule:size',
  'rule:modifying-creatures',
  'rule:type',
  'rule:tags',
  'rule:monsters-alignment',
  'rule:monsters-armor-class',
  'rule:hit-points',
  'rule:monsters-speed',
  'rule:burrow',
  'rule:climb',
  'rule:fly',
  'rule:swim',
  'rule:ability-scores',
  'rule:monsters-saving-throws',
  'rule:monsters-skills',
  'rule:vulnerabilities-resistances-and-immunities',
  'rule:senses',
  'rule:senses-blindsight',
  'rule:senses-darkvision',
  'rule:armor-weapon-and-tool-proficiencies',
  'rule:tremorsense',
  'rule:senses-truesight',
  'rule:monsters-languages',
  'rule:telepathy',
  'rule:challenge',
  'rule:challenge-experience-points',
  'rule:special-traits',
  'rule:innate-spellcasting',
  'rule:special-traits-spellcasting',
  'rule:psionics',
  'rule:actions',
  'rule:melee-and-ranged-attacks',
  'rule:multiattack',
  'rule:ammunition',
  'rule:monsters-reactions',
  'rule:limited-usage',
  'rule:grapple-rules-for-monsters',
  'rule:equipment',
  'rule:legendary-creatures',
  'rule:legendary-actions',
  'rule:a-legendary-creatures-lair',
  'rule:lair-actions',
  'rule:regional-effects',
  // "Backgrounds" chapter intro rules (p60, eshyra-0m9.17): the chapter-intro
  // paragraph (`rule:backgrounds`, emitted via parseRules's chapterIntro
  // option because it precedes any heading) plus the chapter's five h≈12 intro
  // leaves. Three of those leaf titles are already owned by other slices —
  // Proficiencies / Languages (Beyond 1st Level) and Equipment (the Monsters
  // chapter's stat-block Equipment leaf) — and parent-qualify with the chapter
  // title restored by the chapterIntro ancestor seed
  // (`rule:backgrounds-proficiencies`, …). The Acolyte background entry itself
  // is carved off before rule parsing (it is the `background` kind's record);
  // its entry-level "Suggested Characteristics" heading therefore cannot
  // collide with the chapter-intro `rule:suggested-characteristics` leaf.
  'rule:backgrounds',
  'rule:backgrounds-proficiencies',
  'rule:backgrounds-languages',
  'rule:backgrounds-equipment',
  'rule:suggested-characteristics',
  'rule:customizing-a-background',
];

export const EXPECTED_SRD_5_1_TABLE_NAMES: readonly string[] = [
  // The four Acolyte suggested-characteristics roll tables (eshyra-0m9.17).
  // The SRD prints them caption-less (the die header "d8 Personality Trait" is
  // the only title text), so the names are synthesized as "<Background>
  // <Label>s" by parseBackgrounds; the emitted column headers keep the
  // verbatim source text.
  'Acolyte Personality Traits',
  'Acolyte Ideals',
  'Acolyte Bonds',
  'Acolyte Flaws',
  // Spell-description tables (eshyra-o4j7). Printed captions stay verbatim;
  // caption-less tables are qualified by their owning spell.
  'Animated Object Statistics',
  'Confusion Behavior',
  'Creation Material Duration',
  'Precipitation',
  'Reincarnate Race',
  'Scrying Save Modifiers',
  'Teleport Familiarity',
  'Temperature',
  'Wind',
  // The two core-rules tables behind excluded captions, reconstructed by
  // their unique column-header anchors because both captions repeat in the
  // core-rules slice (eshyra-10t).
  'Ability Scores and Modifiers',
  'Character Advancement',
  'Damage Severity by Level',
  'Difficulty Classes',
  'Exotic Languages',
  'Experience Points by Challenge Rating',
  'Food, Drink, and Lodging',
  'Hit Dice by Size',
  'Indefinite Madness',
  'Lifestyle Expenses',
  'Long-Term Madness',
  'Multiclass Spellcaster: Spell Slots per Spell Level',
  'Multiclassing Prerequisites',
  'Multiclassing Proficiencies',
  'Object Armor Class',
  'Object Hit Points',
  'Proficiency Bonus by Challenge Rating',
  'Services',
  'Short-Term Madness',
  'Size Categories',
  'Standard Exchange Rates',
  'Standard Languages',
  'Trade Goods',
  'Trap Save DCs and Attack Bonuses',
  'Travel Pace',
  // Document-wide tables (eshyra-4a7.3), reconstructed by parseDocumentTables
  // from typography anchors (leaf-tier heading + exact cell-tier header) with
  // exact per-table row counts. Names are verbatim captions except where the
  // SRD prints the table caption-less: the Sorcerer-chapter Draconic Ancestry
  // copy is qualified "Draconic Bloodline Draconic Ancestry", the seven
  // Circle of the Land terrain tables are qualified
  // "Circle of the Land (<Terrain>)" (their printed captions are the bare
  // terrain words), and the caption-less magic-item variety / dice tables
  // take their owning item's name (Belt/Potion of Giant Strength, Bag of
  // Beans, Robe of Useful Items, Wand of Wonder).
  'Bag of Beans',
  'Belt of Giant Strength',
  'Circle of the Land (Arctic)',
  'Circle of the Land (Coast)',
  'Circle of the Land (Desert)',
  'Circle of the Land (Forest)',
  'Circle of the Land (Grassland)',
  'Circle of the Land (Mountain)',
  'Circle of the Land (Swamp)',
  'Creating Spell Slots',
  'Donning and Doffing Armor',
  'Draconic Ancestry',
  'Draconic Bloodline Draconic Ancestry',
  'Fiend Expanded Spells',
  'Gray Bag of Tricks',
  'Life Domain Spells',
  'Oath of Devotion Spells',
  'Potion of Giant Strength',
  'Potions of Healing',
  'Robe of Useful Items',
  'Rust Bag of Tricks',
  'Tan Bag of Tricks',
  'The Barbarian',
  'Wand of Wonder',
  // The remaining 11 class progression tables plus the two feature-owned class
  // tables, emitted by parseDocumentTables from pinned source blocks
  // (eshyra-4a7.6; see classProgressionTables.ts). Fighter/Rogue extract one
  // line per row like the Barbarian; the nine spellcaster/monk tables are
  // sheared by the two-column layout and use reviewed reconstruction.
  'Beast Shapes',
  'Destroy Undead',
  'The Bard',
  'The Cleric',
  'The Druid',
  'The Fighter',
  'The Monk',
  'The Paladin',
  'The Ranger',
  'The Rogue',
  'The Sorcerer',
  'The Warlock',
  'The Wizard',
  // Magic Items chapter embedded tables (eshyra-4a7.8). Names are
  // the printed caption when present; caption-less tables use their owning
  // item, and sentient-item construction tables are parent-qualified.
  'Apparatus of the Crab Levers',
  'Armor of Resistance',
  'Candle of Invocation',
  'Carpet of Flying',
  'Cube of Force Charges Lost',
  'Cube of Force Faces',
  'Deck of Illusions',
  'Deck of Many Things',
  'Dragon Scale Mail',
  'Efreeti Bottle',
  'Elemental Gem',
  'Feather Token',
  'Horn of Valhalla',
  'Iron Flask',
  'Manual of Golems',
  'Necklace of Prayer Beads',
  'Potion of Resistance',
  'Ring of Resistance',
  'Ring of Shooting Stars',
  'Sentient Magic Item Alignment',
  'Sentient Magic Item Communication',
  'Sentient Magic Item Senses',
  'Sentient Magic Item Special Purpose',
  'Spell Scroll',
  'Sphere of Annihilation',
  'Staff of Power',
  'Staff of the Magi',
];

/**
 * Thrown when the parsed creature set fails the coverage check: an empty
 * result, a count below `minCreatureCount`, or — when the exact
 * `expectedCreatureNames` set is supplied (the real import) — any missing or
 * unexpected creature name. Distinct from `SectionNotFoundError` so callers can
 * tell "the Monsters section was found but produced the wrong creatures" apart
 * from "the section anchor didn't match".
 */
export class CreatureCoverageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CreatureCoverageError';
  }
}

/**
 * Thrown when the parsed Appendix MM-B NPC set fails exact name-set coverage
 * (loreweaver-bn0). Like the trap and ancestry sets, the NPC name set is small
 * and stable enough to validate exactly. Distinct from `CreatureCoverageError`
 * so callers can tell an NPC-coverage failure apart from a monster-coverage
 * failure even though both kinds of record share the `creature` kind.
 */
export class NpcCoverageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NpcCoverageError';
  }
}

/**
 * Thrown when the parsed inline stat-block set fails the coverage check
 * (eshyra-4a7.4): any missing or unexpected inline stat block relative to the
 * exact `EXPECTED_SRD_5_1_STAT_BLOCK_NAMES` baseline. Distinct from
 * `CreatureCoverageError` so a drift in the abbreviated inline blocks cannot be
 * confused with a Monsters-chapter regression.
 */
export class StatBlockCoverageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'StatBlockCoverageError';
  }
}

/**
 * Thrown when the parsed class set fails the coverage check (empty result, or
 * fewer classes than `minClassCount`). Distinct from `SectionNotFoundError` so
 * callers can tell "the Classes section was found but produced too few classes"
 * apart from "the section anchor didn't match".
 */
export class ClassCoverageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ClassCoverageError';
  }
}

/**
 * Thrown when the parsed subclass set fails the coverage check (empty result,
 * or fewer subclasses than `minSubclassCount`). Distinct from
 * `SectionNotFoundError` so callers can tell "the Classes section was found but
 * produced too few subclasses" apart from "the section anchor didn't match".
 */
export class SubclassCoverageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SubclassCoverageError';
  }
}

/**
 * Thrown when the parsed feature set fails the coverage check (empty result, or
 * fewer features than `minFeatureCount`).
 */
export class FeatureCoverageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FeatureCoverageError';
  }
}

/**
 * Thrown when the parsed ancestry set fails exact SRD 5.1 name-set coverage.
 * Distinct from `SectionNotFoundError` so callers can tell "the Races section
 * was found but produced too few ancestry records" apart from "the section
 * anchor didn't match".
 */
export class AncestryCoverageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AncestryCoverageError';
  }
}

/**
 * Thrown when the parsed background set fails exact SRD 5.1 name-set coverage
 * (eshyra-0m9.17). Like the trap and NPC sets, the background name set is
 * small and stable enough to validate exactly. Distinct from
 * `SectionNotFoundError` so callers can tell "the Backgrounds chapter was
 * found but produced the wrong backgrounds" apart from "the section anchor
 * didn't match".
 */
export class BackgroundCoverageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BackgroundCoverageError';
  }
}

/**
 * Thrown when the parsed sample-trap set fails exact SRD 5.1 name-set coverage.
 * Like the ancestry set, the trap name set is small and stable enough to
 * validate exactly. Distinct from `SectionNotFoundError` so callers can tell
 * "the Traps section was found but produced the wrong traps" apart from "the
 * section anchor didn't match".
 */
export class TrapCoverageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TrapCoverageError';
  }
}

/**
 * Thrown when the parsed sample-disease set fails exact SRD 5.1 name-set
 * coverage (loreweaver-6ra). Like the trap set, the disease name set is small
 * and stable enough to validate exactly. Distinct from `SectionNotFoundError`
 * so callers can tell "the Diseases section was found but produced the wrong
 * diseases" apart from "the section anchor didn't match".
 */
export class DiseaseCoverageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DiseaseCoverageError';
  }
}

/**
 * Thrown when the parsed sample-poison set fails exact SRD 5.1 name-set coverage
 * (loreweaver-6ra). Distinct from `SectionNotFoundError` so callers can tell
 * "the Poisons section was found but produced the wrong poisons" apart from "the
 * section anchor didn't match".
 */
export class PoisonCoverageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PoisonCoverageError';
  }
}

/**
 * Thrown when the parsed magic-item set is empty or implausibly small for the
 * SRD 5.1 Magic Items A-Z section.
 */
export class MagicItemCoverageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MagicItemCoverageError';
  }
}

/**
 * Thrown when the combined implemented `rule` set drifts from the reviewed SRD
 * 5.1 baseline. The set includes core, Spellcasting, gamemastering, and
 * Classes-callout slices. It is validated on record keys rather than names
 * because the SRD repeats rule titles across chapters ("Hit Points",
 * "Initiative", "Difficult Terrain") and per-ability sidebars ("Spellcasting
 * Ability"), which the parsers disambiguate with parent-qualified keys.
 * Distinct from `SectionNotFoundError` so callers can tell "the rule slices
 * parsed but produced the wrong combined set" apart from "a required section
 * anchor didn't match".
 */
export class RuleCoverageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RuleCoverageError';
  }
}

export class TableCoverageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TableCoverageError';
  }
}

export interface RunImporterInput {
  /** Absolute path to the vendored SRD 5.1 PDF. */
  readonly pdfPath: string;
  /** Output directory; receives manifest.json + records.json. */
  readonly outDir: string;
  /**
   * Override the default section anchors. Useful when the vendored PDF uses
   * variant chapter headings, or for tests that supply a fixture PDF whose
   * heading text differs.
   */
  readonly sectionAnchors?: Srd51SectionAnchors;
  /**
   * Minimum number of creature stat blocks the Monsters section must yield for
   * the run to be accepted. When set and the parsed count is below it, the
   * importer throws `CreatureCoverageError` and writes nothing. The real-import
   * CLI uses the stronger `expectedCreatureNames` gate instead; fixture
   * pipelines that exercise a reduced Monsters section either omit this
   * (relying on the always-on empty-result guard) or pass a small value. An
   * empty creature result is always rejected regardless of this option.
   */
  readonly minCreatureCount?: number;
  /**
   * Exact set of creature names the Monsters section must yield for the run to
   * be accepted. When provided and the parsed names don't match it exactly, the
   * importer throws `CreatureCoverageError` naming the missing and/or
   * unexpected creatures, and writes nothing. The real-import CLI passes
   * `EXPECTED_SRD_5_1_CREATURE_NAMES`; fixture pipelines that exercise a reduced
   * Monsters section omit this and rely on the empty-result guard (or the
   * coarse `minCreatureCount` floor). An empty creature result is always
   * rejected regardless of this option.
   */
  readonly expectedCreatureNames?: readonly string[];
  /**
   * Exact set of Appendix MM-B NPC names the import must yield for the run to be
   * accepted (loreweaver-bn0). When provided and the parsed NPC names don't match
   * it exactly, the importer throws `NpcCoverageError` naming the missing and/or
   * unexpected NPCs, and writes nothing. The real-import CLI passes
   * `EXPECTED_SRD_5_1_NPC_NAMES`; fixture pipelines that lack an Appendix MM-B
   * section omit this (the best-effort slice degrades to no NPCs and no check
   * runs). Unlike the monster guard, an empty NPC result is NOT rejected on its
   * own — it is only rejected when it fails to match a supplied expected set —
   * because most fixtures legitimately carry no MM-B appendix.
   */
  readonly expectedNpcNames?: readonly string[];
  /**
   * Minimum number of base classes the Classes section must yield for the run
   * to be accepted. When set and the parsed count is below it, the importer
   * throws `ClassCoverageError` and writes nothing. The real-import CLI passes
   * `MIN_EXPECTED_SRD_5_1_CLASSES`; fixture pipelines either omit this (relying
   * on the always-on empty-result guard) or pass a small value. An empty class
   * result is always rejected regardless of this option.
   */
  readonly minClassCount?: number;
  /**
   * Minimum number of subclasses the Classes section must yield for the run to
   * be accepted. When set and the parsed count is below it, the importer throws
   * `SubclassCoverageError` and writes nothing. The real-import CLI passes
   * `MIN_EXPECTED_SRD_5_1_SUBCLASSES`; fixture pipelines either omit this
   * (relying on the always-on empty-result guard) or pass a small value. An
   * empty subclass result is always rejected regardless of this option.
   */
  readonly minSubclassCount?: number;
  /**
   * Minimum number of class/subclass-granted features the Classes section must
   * yield for the run to be accepted. When set and the parsed count is below
   * it, the importer throws `FeatureCoverageError` and writes nothing. An empty
   * feature result is always rejected regardless of this option.
   */
  readonly minFeatureCount?: number;
  /**
   * Exact set of sample-trap names the Traps section must yield for the run to
   * be accepted. When provided and the parsed names don't match it exactly, the
   * importer throws `TrapCoverageError` naming the missing and/or unexpected
   * traps, and writes nothing. The real-import CLI passes
   * `EXPECTED_SRD_5_1_TRAP_NAMES`; fixture pipelines that exercise a reduced
   * Traps section omit this (the best-effort slice already degrades to empty
   * when the section is absent). Sample traps emit under the `hazard` kind.
   */
  readonly expectedTrapNames?: readonly string[];
  /**
   * Exact set of sample-disease names the Diseases section must yield for the
   * run to be accepted (loreweaver-6ra). When provided and the parsed names
   * don't match it exactly, the importer throws `DiseaseCoverageError` and writes
   * nothing. The real-import CLI passes `EXPECTED_SRD_5_1_DISEASE_NAMES`; fixture
   * pipelines omit it (the best-effort slice degrades to empty when absent).
   * Diseases emit under the `hazard` kind with `data.category: 'disease'`.
   */
  readonly expectedDiseaseNames?: readonly string[];
  /**
   * Exact set of sample-poison names the Poisons section must yield for the run
   * to be accepted (loreweaver-6ra). When provided and the parsed names don't
   * match it exactly, the importer throws `PoisonCoverageError` and writes
   * nothing. The real-import CLI passes `EXPECTED_SRD_5_1_POISON_NAMES`; fixture
   * pipelines omit it. Poisons emit under the `hazard` kind with
   * `data.category: 'poison'`.
   */
  readonly expectedPoisonNames?: readonly string[];
  /**
   * Minimum number of Magic Items A-Z entries the section must yield for the
   * run to be accepted. An empty magic-item result is always rejected regardless
   * of this option. The real-import CLI uses the stronger
   * `expectedMagicItemNames` gate instead; fixture pipelines that exercise a
   * reduced Magic Items A-Z section either omit this or pass a small value.
   */
  readonly minMagicItemCount?: number;
  /**
   * Exact set of Magic Items A-Z names the import must yield for the run to be
   * accepted. When provided and the parsed names don't match it exactly, the
   * importer throws `MagicItemCoverageError` naming the missing and/or
   * unexpected items, and writes nothing. The real-import CLI passes
   * `EXPECTED_SRD_5_1_MAGIC_ITEM_NAMES`; fixture pipelines that exercise a
   * reduced Magic Items A-Z section omit this and rely on the empty-result guard
   * or the coarse `minMagicItemCount` floor.
   */
  readonly expectedMagicItemNames?: readonly string[];
  /**
   * Exact set of inline stat-block names the import must yield for the run to be
   * accepted (eshyra-4a7.4). When provided and the parsed names don't match it
   * exactly, the importer throws `StatBlockCoverageError` naming the missing
   * and/or unexpected blocks, and writes nothing. The real-import CLI passes
   * `EXPECTED_SRD_5_1_STAT_BLOCK_NAMES`; fixture pipelines omit this (the
   * document-wide scan degrades to empty when no inline blocks are present).
   * Inline blocks emit under the `stat-block` kind.
   */
  readonly expectedStatBlockNames?: readonly string[];
  /**
   * Reviewed map from an inline stat-block name to the entry it is printed under
   * (eshyra-4a7.4). Required for any inline block the document-wide scan emits;
   * an unmapped block fails closed. The real-import CLI passes
   * `SRD_5_1_STAT_BLOCK_CONTAINING_ITEMS`.
   */
  readonly statBlockContainingItems?: ReadonlyMap<string, string>;
  /**
   * Exact combined set of implemented `rule` record keys the import must yield
   * for the run to be accepted. When provided and the parsed rule keys don't
   * match it exactly, the importer throws `RuleCoverageError` naming the missing
   * and/or unexpected keys, and writes nothing. The real-import CLI passes
   * `EXPECTED_SRD_5_1_RULE_KEYS`; fixture pipelines that exercise reduced rule
   * slices omit this. Keys (not names) are gated because the SRD repeats rule
   * titles across chapters, which the parsers disambiguate with
   * parent-qualified keys.
   */
  readonly expectedRuleKeys?: readonly string[];
  /**
   * Exact set of reference-table names the import must yield. The real importer
   * passes `EXPECTED_SRD_5_1_TABLE_NAMES`; reduced fixtures may omit the check.
   */
  readonly expectedTableNames?: readonly string[];
  /**
   * Exact set of background names the Backgrounds chapter must yield for the
   * run to be accepted (eshyra-0m9.17). When provided and the parsed names
   * don't match it exactly, the importer throws `BackgroundCoverageError`
   * naming the missing and/or unexpected backgrounds, and writes nothing. The
   * real-import CLI passes `EXPECTED_SRD_5_1_BACKGROUND_NAMES`; fixture
   * pipelines that lack a Backgrounds chapter omit this (the best-effort slice
   * degrades to no backgrounds and no check runs). Like the NPC guard, an
   * empty background result is NOT rejected on its own — most fixtures
   * legitimately carry no Backgrounds chapter.
   */
  readonly expectedBackgroundNames?: readonly string[];
  /**
   * Source-structure coverage gate (eshyra-4a7.1). When provided, the
   * importer builds the typography-derived source inventory
   * (`buildSourceInventory`) from the extracted pages, evaluates it against
   * the emitted records with these rules, throws
   * `SourceInventoryCoverageError` on any unaccounted source structure
   * (before any output is written), and writes `source-inventory.json` +
   * `source-coverage.json` review artifacts next to the pack files. The
   * real-import CLI passes `SRD_5_1_COVERAGE_RULES`. Fixture pipelines omit
   * this: fixture PDFs render at a uniform body font size that lands every
   * line in the inventory's leaf band, so the typography tiers carry no
   * signal there and the gate would reject fixture body text.
   */
  readonly sourceCoverageRules?: readonly CoverageRule[];
}

/**
 * Fail closed on a creature result that can't be a faithful SRD 5.1 import.
 * An empty set is always rejected. When the exact `expectedCreatureNames` set
 * is supplied (the real import), the parsed names must match it exactly —
 * any missing or unexpected creature is rejected, naming the specific
 * offenders so a dropped/renamed creature or a bled-in unrelated stat block
 * trips by name, not just on gross truncation. The coarse `minCreatureCount`
 * floor (when provided) is also enforced for fixture pipelines. Runs after
 * parsing and before any output is written; messages are deterministic so a CI
 * failure is self-explanatory.
 */
function validateCreatureCoverage(
  creatures: readonly CreatureExtraction[],
  minCreatureCount: number | undefined,
  expectedCreatureNames: readonly string[] | undefined,
): void {
  if (creatures.length === 0) {
    throw new CreatureCoverageError(
      'SRD 5.1 creature coverage check failed: the Monsters section was found but yielded 0 creature stat blocks. The Monsters layout likely changed. Refusing to write a pack with no creatures.',
    );
  }
  if (expectedCreatureNames !== undefined) {
    const parsedNames = new Set(creatures.map((creature) => creature.name));
    const expectedSet = new Set(expectedCreatureNames);
    const missing = expectedCreatureNames.filter(
      (name) => !parsedNames.has(name),
    );
    const unexpected = [...parsedNames].filter(
      (name) => !expectedSet.has(name),
    );
    if (missing.length > 0 || unexpected.length > 0) {
      const parts: string[] = [];
      if (missing.length > 0) {
        parts.push(`missing expected creature(s): ${missing.join(', ')}`);
      }
      if (unexpected.length > 0) {
        parts.push(`unexpected creature(s): ${unexpected.join(', ')}`);
      }
      throw new CreatureCoverageError(
        `SRD 5.1 creature coverage check failed: parsed ${creatures.length} creature stat block(s), expected exactly ${expectedCreatureNames.length}. ${parts.join('; ')}. The Monsters section may have been truncated, a creature renamed, or unrelated stat blocks bled in. Refusing to write a pack with a drifted creature set.`,
      );
    }
  }
  if (minCreatureCount !== undefined && creatures.length < minCreatureCount) {
    throw new CreatureCoverageError(
      `SRD 5.1 creature coverage check failed: parsed ${creatures.length} creature stat block(s), expected at least ${minCreatureCount}. The Monsters section may have been truncated or its layout changed.`,
    );
  }
}

/**
 * Fail closed on an Appendix MM-B NPC result that can't be a faithful SRD 5.1
 * import (loreweaver-bn0). When the exact `expectedNpcNames` set is supplied (the
 * real import via the CLI), the parsed NPC names must match it exactly — any
 * missing or unexpected NPC is rejected, naming the specific offenders so a
 * dropped/renamed NPC or a bled-in unrelated stat block trips by name. Fixture
 * pipelines that lack an MM-B appendix omit the set, in which case no check runs
 * (the best-effort slice already degrades to empty). Runs after parsing and
 * before any output is written.
 */
function validateNpcCoverage(
  npcs: readonly CreatureExtraction[],
  expectedNpcNames: readonly string[] | undefined,
): void {
  if (expectedNpcNames === undefined) return;
  const parsedNames = new Set(npcs.map((npc) => npc.name));
  const expectedSet = new Set(expectedNpcNames);
  const missing = expectedNpcNames.filter((name) => !parsedNames.has(name));
  const unexpected = [...parsedNames].filter((name) => !expectedSet.has(name));
  if (missing.length === 0 && unexpected.length === 0) return;

  const parts: string[] = [];
  if (missing.length > 0) {
    parts.push(`missing expected NPC(s): ${missing.join(', ')}`);
  }
  if (unexpected.length > 0) {
    parts.push(`unexpected NPC(s): ${unexpected.join(', ')}`);
  }
  throw new NpcCoverageError(
    `SRD 5.1 NPC coverage check failed: parsed ${npcs.length} Appendix MM-B NPC stat block(s), expected exactly ${expectedNpcNames.length}. ${parts.join('; ')}. The Nonplayer Characters appendix may have been truncated, an NPC renamed, or unrelated stat blocks bled in. Refusing to write a pack with a drifted NPC set.`,
  );
}

/**
 * Fail closed on an inline stat-block result that can't be a faithful SRD 5.1
 * import (eshyra-4a7.4). When the exact `expectedStatBlockNames` set is supplied
 * (the real import via the CLI), the parsed inline-block names must match it
 * exactly — any missing or unexpected block is rejected, naming the specific
 * offenders so a dropped block or a newly-detected inline block trips by name.
 * Fixture pipelines that omit the set run no check (the document-wide scan
 * already degrades to empty when no inline blocks are present).
 */
function validateStatBlockCoverage(
  statBlocks: readonly StatBlockExtraction[],
  expectedStatBlockNames: readonly string[] | undefined,
): void {
  if (expectedStatBlockNames === undefined) return;
  const parsedNames = new Set(statBlocks.map((sb) => sb.name));
  const expectedSet = new Set(expectedStatBlockNames);
  const missing = expectedStatBlockNames.filter(
    (name) => !parsedNames.has(name),
  );
  const unexpected = [...parsedNames].filter((name) => !expectedSet.has(name));
  if (missing.length === 0 && unexpected.length === 0) return;

  const parts: string[] = [];
  if (missing.length > 0) {
    parts.push(`missing expected stat block(s): ${missing.join(', ')}`);
  }
  if (unexpected.length > 0) {
    parts.push(`unexpected stat block(s): ${unexpected.join(', ')}`);
  }
  throw new StatBlockCoverageError(
    `SRD 5.1 inline stat-block coverage check failed: parsed ${statBlocks.length} inline stat block(s), expected exactly ${expectedStatBlockNames.length}. ${parts.join('; ')}. An inline stat block may have been dropped, renamed, or newly detected. Refusing to write a pack with a drifted stat-block set.`,
  );
}

/**
 * Fail closed on a class result that can't be a faithful SRD 5.1 import: an
 * empty set is always rejected; a non-empty set below `minClassCount` (when
 * provided) is rejected too. Runs after parsing and before any output is
 * written. Error messages name the observed/expected counts so a CI failure is
 * self-explanatory.
 */
function validateClassCoverage(
  count: number,
  minClassCount: number | undefined,
): void {
  if (count === 0) {
    throw new ClassCoverageError(
      'SRD 5.1 class coverage check failed: the Classes section was found but yielded 0 base classes. The Classes layout likely changed. Refusing to write a pack with no classes.',
    );
  }
  if (minClassCount !== undefined && count < minClassCount) {
    throw new ClassCoverageError(
      `SRD 5.1 class coverage check failed: parsed ${count} base class(es), expected at least ${minClassCount}. The Classes section may have been truncated or its layout changed.`,
    );
  }
}

/**
 * Fail closed on a subclass result that can't be a faithful SRD 5.1 import: an
 * empty set is always rejected; a non-empty set below `minSubclassCount` (when
 * provided) is rejected too. Runs after parsing and before any output is
 * written. Error messages name the observed/expected counts so a CI failure is
 * self-explanatory.
 */
function validateSubclassCoverage(
  count: number,
  minSubclassCount: number | undefined,
): void {
  if (count === 0) {
    throw new SubclassCoverageError(
      'SRD 5.1 subclass coverage check failed: the Classes section was found but yielded 0 subclasses. The subclass headings likely changed. Refusing to write a pack with no subclasses.',
    );
  }
  if (minSubclassCount !== undefined && count < minSubclassCount) {
    throw new SubclassCoverageError(
      `SRD 5.1 subclass coverage check failed: parsed ${count} subclass(es), expected at least ${minSubclassCount}. The Classes section may have been truncated or the subclass headings changed.`,
    );
  }
}

/**
 * Fail closed on a feature result that can't be a faithful SRD 5.1 import: an
 * empty set is always rejected; a non-empty set below `minFeatureCount` (when
 * provided) is rejected too.
 */
function validateFeatureCoverage(
  count: number,
  minFeatureCount: number | undefined,
): void {
  if (count === 0) {
    throw new FeatureCoverageError(
      'SRD 5.1 feature coverage check failed: the Classes section was found but yielded 0 class/subclass features. The class progression tables or feature headings likely changed. Refusing to write a pack with no features.',
    );
  }
  if (minFeatureCount !== undefined && count < minFeatureCount) {
    throw new FeatureCoverageError(
      `SRD 5.1 feature coverage check failed: parsed ${count} feature(s), expected at least ${minFeatureCount}. The Classes section may have been truncated or its progression tables changed.`,
    );
  }
}

/**
 * Fail closed on ancestry under-extraction. Unlike the creature/class count
 * floors, the SRD 5.1 race/subrace name set is small and stable enough to
 * validate exactly. Runs after parsing and before any output is written.
 */
function validateAncestryCoverage(
  ancestries: readonly AncestryExtraction[],
): void {
  const parsedNames = new Set(ancestries.map((ancestry) => ancestry.name));
  const missing = EXPECTED_SRD_5_1_ANCESTRY_NAMES.filter(
    (name) => !parsedNames.has(name),
  );
  if (missing.length === 0) return;

  throw new AncestryCoverageError(
    `SRD 5.1 ancestry coverage check failed: parsed ${ancestries.length} ancestry record(s), expected ${EXPECTED_SRD_5_1_ANCESTRY_NAMES.length}. Missing expected ancestry record(s): ${missing.join(', ')}. The Races section may have been truncated or its headings changed. Refusing to write a pack with incomplete ancestries.`,
  );
}

/**
 * Fail closed on a background result that can't be a faithful SRD 5.1 import
 * (eshyra-0m9.17). When the exact `expectedBackgroundNames` set is supplied
 * (the real import via the CLI), the parsed background names must match it
 * exactly — any missing or unexpected background is rejected, naming the
 * specific offenders so a dropped/renamed background or spuriously promoted
 * chapter-intro prose trips by name. Fixture pipelines that lack a Backgrounds
 * chapter omit the set, in which case no check runs (the best-effort slice
 * already degrades to empty). Runs after parsing and before any output is
 * written.
 */
function validateBackgroundCoverage(
  backgrounds: readonly BackgroundExtraction[],
  expectedBackgroundNames: readonly string[] | undefined,
): void {
  if (expectedBackgroundNames === undefined) return;
  const parsedNames = new Set(backgrounds.map((background) => background.name));
  const expectedSet = new Set(expectedBackgroundNames);
  const missing = expectedBackgroundNames.filter(
    (name) => !parsedNames.has(name),
  );
  const unexpected = [...parsedNames].filter((name) => !expectedSet.has(name));
  if (missing.length === 0 && unexpected.length === 0) return;

  const parts: string[] = [];
  if (missing.length > 0) {
    parts.push(`missing expected background(s): ${missing.join(', ')}`);
  }
  if (unexpected.length > 0) {
    parts.push(`unexpected background(s): ${unexpected.join(', ')}`);
  }
  throw new BackgroundCoverageError(
    `SRD 5.1 background coverage check failed: parsed ${backgrounds.length} background(s), expected exactly ${expectedBackgroundNames.length}. ${parts.join('; ')}. The Backgrounds chapter may have been truncated, a background renamed, or chapter-intro prose promoted to an entry. Refusing to write a pack with a drifted background set.`,
  );
}

/**
 * Fail closed on a trap result that can't be a faithful SRD 5.1 import. When the
 * exact `expectedTrapNames` set is supplied (the real import via the CLI), the
 * parsed trap names must match it exactly — any missing or unexpected trap is
 * rejected, naming the specific offenders so a dropped/renamed trap (e.g. a
 * subtitle-detection regression) or a spuriously promoted prose line trips by
 * name. Fixture pipelines that exercise a reduced Traps section omit the set, in
 * which case no check runs (an absent Traps section already degrades to empty
 * via the best-effort slice). Runs after parsing and before any output is
 * written.
 */
function validateTrapCoverage(
  traps: readonly TrapExtraction[],
  expectedTrapNames: readonly string[] | undefined,
): void {
  if (expectedTrapNames === undefined) return;
  const parsedNames = new Set(traps.map((trap) => trap.name));
  const expectedSet = new Set(expectedTrapNames);
  const missing = expectedTrapNames.filter((name) => !parsedNames.has(name));
  const unexpected = [...parsedNames].filter((name) => !expectedSet.has(name));
  if (missing.length === 0 && unexpected.length === 0) return;

  const parts: string[] = [];
  if (missing.length > 0) {
    parts.push(`missing expected trap(s): ${missing.join(', ')}`);
  }
  if (unexpected.length > 0) {
    parts.push(`unexpected trap(s): ${unexpected.join(', ')}`);
  }
  throw new TrapCoverageError(
    `SRD 5.1 trap coverage check failed: parsed ${traps.length} sample trap(s), expected exactly ${expectedTrapNames.length}. ${parts.join('; ')}. The Traps section may have been truncated, a trap renamed, or unrelated prose promoted. Refusing to write a pack with a drifted trap set.`,
  );
}

/**
 * Fail closed on a disease result that can't be a faithful SRD 5.1 import
 * (loreweaver-6ra). When the exact `expectedDiseaseNames` set is supplied (the
 * real import via the CLI), the parsed disease names must match it exactly — any
 * missing or unexpected disease is rejected, naming the specific offenders.
 * Fixture pipelines that exercise a reduced Diseases section omit the set (an
 * absent section already degrades to empty via the best-effort slice). Runs
 * after parsing and before any output is written.
 */
function validateDiseaseCoverage(
  diseases: readonly DiseaseExtraction[],
  expectedDiseaseNames: readonly string[] | undefined,
): void {
  if (expectedDiseaseNames === undefined) return;
  const parsedNames = new Set(diseases.map((disease) => disease.name));
  const expectedSet = new Set(expectedDiseaseNames);
  const missing = expectedDiseaseNames.filter((name) => !parsedNames.has(name));
  const unexpected = [...parsedNames].filter((name) => !expectedSet.has(name));
  if (missing.length === 0 && unexpected.length === 0) return;

  const parts: string[] = [];
  if (missing.length > 0) {
    parts.push(`missing expected disease(s): ${missing.join(', ')}`);
  }
  if (unexpected.length > 0) {
    parts.push(`unexpected disease(s): ${unexpected.join(', ')}`);
  }
  throw new DiseaseCoverageError(
    `SRD 5.1 disease coverage check failed: parsed ${diseases.length} sample disease(s), expected exactly ${expectedDiseaseNames.length}. ${parts.join('; ')}. The Diseases section may have been truncated, a disease renamed, or unrelated prose promoted. Refusing to write a pack with a drifted disease set.`,
  );
}

/**
 * Fail closed on a poison result that can't be a faithful SRD 5.1 import
 * (loreweaver-6ra). When the exact `expectedPoisonNames` set is supplied (the
 * real import via the CLI), the parsed poison names must match it exactly — any
 * missing or unexpected poison is rejected, naming the specific offenders so a
 * dropped/renamed poison (e.g. a lead-in-detection regression) or a spuriously
 * promoted prose line trips by name. Fixture pipelines omit the set. Runs after
 * parsing and before any output is written.
 */
function validatePoisonCoverage(
  poisons: readonly PoisonExtraction[],
  expectedPoisonNames: readonly string[] | undefined,
): void {
  if (expectedPoisonNames === undefined) return;
  const parsedNames = new Set(poisons.map((poison) => poison.name));
  const expectedSet = new Set(expectedPoisonNames);
  const missing = expectedPoisonNames.filter((name) => !parsedNames.has(name));
  const unexpected = [...parsedNames].filter((name) => !expectedSet.has(name));
  if (missing.length === 0 && unexpected.length === 0) return;

  const parts: string[] = [];
  if (missing.length > 0) {
    parts.push(`missing expected poison(s): ${missing.join(', ')}`);
  }
  if (unexpected.length > 0) {
    parts.push(`unexpected poison(s): ${unexpected.join(', ')}`);
  }
  throw new PoisonCoverageError(
    `SRD 5.1 poison coverage check failed: parsed ${poisons.length} sample poison(s), expected exactly ${expectedPoisonNames.length}. ${parts.join('; ')}. The Poisons section may have been truncated, a poison renamed, or unrelated prose promoted. Refusing to write a pack with a drifted poison set.`,
  );
}

function validateMagicItemCoverage(
  magicItems: readonly MagicItemExtraction[],
  minMagicItemCount: number | undefined,
  expectedMagicItemNames: readonly string[] | undefined,
): void {
  if (magicItems.length === 0) {
    throw new MagicItemCoverageError(
      'SRD 5.1 magic-item coverage check failed: the Magic Items A-Z section was found but yielded 0 magic items. The item heading/category layout likely changed. Refusing to write a pack with no magic items.',
    );
  }
  if (expectedMagicItemNames !== undefined) {
    const parsedNames = new Set(magicItems.map((item) => item.name));
    const expectedSet = new Set(expectedMagicItemNames);
    const missing = expectedMagicItemNames.filter(
      (name) => !parsedNames.has(name),
    );
    const unexpected = [...parsedNames].filter(
      (name) => !expectedSet.has(name),
    );
    if (missing.length > 0 || unexpected.length > 0) {
      const parts: string[] = [];
      if (missing.length > 0) {
        parts.push(`missing expected magic item(s): ${missing.join(', ')}`);
      }
      if (unexpected.length > 0) {
        parts.push(`unexpected magic item(s): ${unexpected.join(', ')}`);
      }
      throw new MagicItemCoverageError(
        `SRD 5.1 magic-item coverage check failed: parsed ${magicItems.length} magic item(s), expected exactly ${expectedMagicItemNames.length}. ${parts.join('; ')}. The Magic Items A-Z section may have been truncated, an item renamed, or unrelated prose/table text promoted. Refusing to write a pack with a drifted magic-item set.`,
      );
    }
  }
  if (
    minMagicItemCount !== undefined &&
    magicItems.length < minMagicItemCount
  ) {
    throw new MagicItemCoverageError(
      `SRD 5.1 magic-item coverage check failed: parsed ${magicItems.length} magic item(s), expected at least ${minMagicItemCount}. The Magic Items A-Z section may have been truncated or its layout changed.`,
    );
  }
}

/**
 * Fail closed when the combined implemented `rule` result drifts from the
 * reviewed SRD 5.1 baseline. When the exact `expectedRuleKeys` set is supplied
 * (the real import via the CLI), the parsed keys from core, Spellcasting,
 * gamemastering, and Classes-callout slices must match it exactly. Any missing
 * or unexpected key is rejected, naming the specific offenders so a dropped
 * leaf rule (a heading-tier regression), a renamed heading, or a newly-promoted
 * caption/sidebar trips by key. Validated on keys rather than names because the
 * SRD repeats rule titles across chapters, which the parsers disambiguate with
 * parent-qualified keys. Fixture pipelines that exercise reduced rule slices
 * omit the set, in which case no check runs. Runs after all implemented rule
 * slices are parsed and before any output is written.
 */
function validateRuleCoverage(
  rules: readonly RuleExtraction[],
  expectedRuleKeys: readonly string[] | undefined,
): void {
  if (expectedRuleKeys === undefined) return;
  const parsedKeys = new Set(rules.map(ruleCoverageKey));
  const expectedSet = new Set(expectedRuleKeys);
  const missing = expectedRuleKeys.filter((key) => !parsedKeys.has(key));
  const unexpected = [...parsedKeys].filter((key) => !expectedSet.has(key));
  if (missing.length === 0 && unexpected.length === 0) return;

  const parts: string[] = [];
  if (missing.length > 0) {
    parts.push(`missing expected rule(s): ${missing.join(', ')}`);
  }
  if (unexpected.length > 0) {
    parts.push(`unexpected rule(s): ${unexpected.join(', ')}`);
  }
  throw new RuleCoverageError(
    `SRD 5.1 rule coverage check failed: parsed ${rules.length} rule record(s) across the implemented rule slices, expected exactly ${expectedRuleKeys.length}. ${parts.join('; ')}. One or more rule-bearing sections may have been truncated, a heading renamed, or a caption/sidebar promoted. Refusing to write a pack with a drifted rule set.`,
  );
}

function ruleCoverageKey(rule: RuleExtraction): string {
  const keySlug =
    rule.keySlug ??
    rule.name
      .toLowerCase()
      .replace(/[’']/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
  return `rule:${keySlug}`;
}

function validateTableCoverage(
  tables: readonly TableExtraction[],
  expectedTableNames: readonly string[] | undefined,
): void {
  if (expectedTableNames === undefined) return;
  const parsedNames = new Set(tables.map((table) => table.name));
  const expectedSet = new Set(expectedTableNames);
  const missing = expectedTableNames.filter((name) => !parsedNames.has(name));
  const unexpected = [...parsedNames].filter((name) => !expectedSet.has(name));
  if (missing.length === 0 && unexpected.length === 0) return;

  const parts: string[] = [];
  if (missing.length > 0) {
    parts.push(`missing expected table(s): ${missing.join(', ')}`);
  }
  if (unexpected.length > 0) {
    parts.push(`unexpected table(s): ${unexpected.join(', ')}`);
  }
  throw new TableCoverageError(
    `SRD 5.1 table coverage check failed: parsed ${tables.length} table record(s), expected exactly ${expectedTableNames.length}. ${parts.join('; ')}. A reference table may be incomplete, renamed, or spuriously extracted. Refusing to write a pack with a drifted table set.`,
  );
}

export async function runImporter(
  input: RunImporterInput,
): Promise<ImporterRunResult> {
  const pdfBytes = readFileSync(input.pdfPath);
  const sourceHash = sha256Hex(pdfBytes);
  const pages = await extractPdfText(new Uint8Array(pdfBytes));

  const anchors = input.sectionAnchors ?? SRD_5_1_DEFAULT_SECTION_ANCHORS;
  const coreRulePages = sliceSection(pages, anchors.coreRules);
  // Throws SectionNotFoundError if either spell anchor doesn't match.
  const spellDescriptionPages = sliceSection(pages, anchors.spellDescriptions);
  const spellListPages = sliceSection(pages, anchors.spellLists);

  // Throws SectionNotFoundError if the conditions anchor doesn't match.
  // Conditions is an implemented kind; the importer must fail closed rather
  // than silently emit a pack that omits conditions because the PDF changed.
  const conditionPages = sliceSection(pages, anchors.conditions);
  const combatActionPages = sliceSection(pages, anchors.combatActions);

  const spells = parseSpells(spellDescriptionPages);
  const classIndex = parseSpellClassLists(spellListPages);
  // Throws SectionNotFoundError if the monsters start OR end anchor doesn't
  // match — creature is an implemented kind, so fail closed rather than emit a
  // pack without creatures or let trailing content bleed in (the monsters
  // anchor sets requireEndHeading: true); see the anchor comment in sections.ts.
  //
  // SRD 5.1 splits creature stat blocks across the main Monsters chapter
  // (p254-357: the alphabetic A-Z entries) AND Appendix MM-A: Miscellaneous
  // Creatures (p366-394: animals/beasts like Wolf, Cat, Bear that are not in
  // the main chapter). Parse the union via a single parseCreatures call so
  // both sets land in the same sorted output; the misc-creatures anchor is
  // best-effort so fixture PDFs without that appendix still import cleanly
  // (loreweaver-w8h).
  const monsterPages = sliceSection(pages, anchors.monsters);
  const miscCreaturePages = sliceSectionOrEmptyPages(
    pages,
    anchors.miscellaneousCreatures,
  );
  const creatures = parseCreatures([...monsterPages, ...miscCreaturePages]);
  // Fail closed before any output is written if creature extraction is empty,
  // implausibly small (coarse floor), or — for the real import — does not match
  // the exact expected SRD 5.1 creature name set.
  validateCreatureCoverage(
    creatures,
    input.minCreatureCount,
    input.expectedCreatureNames,
  );
  // Appendix MM-B: Nonplayer Characters (loreweaver-bn0). The 21 generic NPC
  // stat blocks parse with the same `parseCreatures` grammar but are tagged
  // `category: 'npc'` and kept in their own array so the monster coverage gate
  // above stays exactly 296. MM-B is the SRD's last content section (it runs to
  // EOF; the trailing license prose carries no stat-block signature), and the
  // anchor is best-effort on its start so fixture PDFs without the appendix
  // degrade to no NPCs. The exact NPC name-set gate (real import only) is what
  // fails closed on drift.
  const npcPages = sliceSectionOrEmptyPages(pages, anchors.nonplayerCharacters);
  const npcs = parseCreatures(npcPages, 'npc');
  validateNpcCoverage(npcs, input.expectedNpcNames);
  const conditions = parseConditions(conditionPages);
  const actions = parseActions(combatActionPages);
  const featPages = sliceSection(pages, anchors.feats);
  const feats = parseFeats(featPages);
  // SRD 5.1 has no hazards chapter (the Brown Mold / Green Slime / Webs /
  // Yellow Mold entries are not part of the SRD 5.1 PDF) — emit an empty
  // hazard set when the anchor fails. Same shape as the multiclassing
  // best-effort fall-through below.
  const hazards = sliceSectionOrEmpty(pages, anchors.hazards, parseHazards);
  // SRD 5.1 gamemastering "Traps" section (loreweaver-hvp). Sample traps emit
  // under the `hazard` kind; the two trap reference tables (Trap Save DCs and
  // Attack Bonuses; Damage Severity by Level) are reconstructed by parseTables
  // from the same slice. Best-effort START (a fixture without a Traps section
  // degrades to no traps), but the anchor's requireEndHeading bound still fails
  // closed if the section starts and its end boundary ("Diseases") is missing —
  // so the last trap's body cannot run on into Diseases/Madness/Poisons (the
  // contamination this bead removed from Zone of Truth, loreweaver-7ok).
  const trapPages = sliceSectionOrEmptyPages(pages, anchors.traps);
  const traps = parseTraps(trapPages);
  // Fail closed before any output is written when the real import (CLI) supplies
  // the exact expected trap-name set and the parse drifts from it.
  validateTrapCoverage(traps, input.expectedTrapNames);
  // SRD 5.1 gamemastering "Diseases" and "Poisons" sections (loreweaver-6ra).
  // Both are description-only dangers with save DCs and effects, so — like traps
  // — they emit under the `hazard` kind, discriminated by `data.category`
  // ('disease' / 'poison'). Best-effort start (a fixture without these sections
  // degrades to no records), but each anchor's requireEndHeading bound still
  // fails closed if the section starts and its end boundary is missing, so a
  // disease/poison body cannot run on into the following gamemastering section.
  const diseases = sliceSectionOrEmpty(pages, anchors.diseases, parseDiseases);
  validateDiseaseCoverage(diseases, input.expectedDiseaseNames);
  const poisons = sliceSectionOrEmpty(pages, anchors.poisons, parsePoisons);
  validatePoisonCoverage(poisons, input.expectedPoisonNames);
  // Madness and Objects are absent from many reduced fixture PDFs, so a
  // missing start degrades to no records. Once either start is present its
  // required end boundary still fails closed.
  const madnessPages = sliceSectionOrEmptyPages(pages, anchors.madness);
  const objectPages = sliceSectionOrEmptyPages(pages, anchors.objects);
  const equipmentPages = sliceSection(pages, anchors.equipment);
  // Mounts and Vehicles sits just after the Equipment chapter's tables (the
  // equipment anchor's endHeading), so it is its own slice parsed by
  // parseMountsAndVehicles and concatenated with the equipment records
  // (loreweaver-4zu). Best-effort like hazards/treasure: reduced fixture PDFs
  // that carry the Equipment chapter but no Mounts and Vehicles section degrade
  // to no mount/vehicle records (a missing START anchor returns empty). The
  // anchor leaves requireEndHeading off because parseMountsAndVehicles is
  // internally header-bounded (see sections.ts), so a missing end cannot
  // over-extract.
  const equipment = [
    ...parseEquipment(equipmentPages),
    ...sliceSectionOrEmpty(
      pages,
      anchors.mountsAndVehicles,
      parseMountsAndVehicles,
    ),
  ];
  // Magic Items A-Z (p207-p251) plus the "Artifacts" subsection (p252-p253),
  // which carries the lone artifact magic item — Orb of Dragonkind — in the
  // same name/category/rarity/body shape as the A-Z items (eshyra-0m9.16). The
  // A-Z slice deliberately ends at the preceding "Sentient Magic Items" heading
  // (DM construction guidance), so the Artifacts subsection is sliced and parsed
  // separately by the same `parseMagicItems` and concatenated — mirroring how
  // Appendix MM-A / MM-B creatures concatenate with the Monsters chapter. The
  // Artifacts slice is best-effort on its START so a reduced fixture PDF without
  // an Artifacts subsection degrades to no artifact items; the anchor's
  // requireEndHeading bound still fails closed if the subsection starts but its
  // "Monsters" boundary is missing.
  const magicItemPages = sliceSection(pages, anchors.magicItems);
  const artifactPages = sliceSectionOrEmptyPages(pages, anchors.artifacts);
  const magicItems = [
    ...parseMagicItems(magicItemPages),
    ...parseMagicItems(artifactPages),
  ];
  validateMagicItemCoverage(
    magicItems,
    input.minMagicItemCount,
    input.expectedMagicItemNames,
  );
  // Inline stat blocks (eshyra-4a7.4): scan the WHOLE document for abbreviated
  // stat-block-shaped content (Avatar of Death p218, Giant Fly p222) not already
  // emitted as a monster/NPC `creature`, and emit it under the permissive
  // `stat-block` kind. `excludeNames` keeps the monster/NPC blocks owned by
  // `parseCreatures` from being re-emitted here. The keyed trailing fields of a
  // block whose values WRAP across the two-column layout (Avatar of Death's
  // Condition Immunities / Senses) are recovered from the containing magic
  // item's already-reflowed description; `cleanTextByName` maps each block to
  // the emitted item description that embeds it (Deck of Many Things for Avatar
  // of Death; Giant Fly's container is unemitted, so it falls back to the
  // single-line raw parse, which is complete for its abbreviated block).
  const emittedCreatureNames = new Set<string>([
    ...creatures.map((c) => c.name),
    ...npcs.map((c) => c.name),
  ]);
  const cleanTextByName = new Map<string, string>();
  for (const [blockName] of input.statBlockContainingItems ??
    new Map<string, string>()) {
    const holder = magicItems.find(
      (item) =>
        item.description.includes(blockName) &&
        item.description.includes('Armor Class'),
    );
    if (holder !== undefined)
      cleanTextByName.set(blockName, holder.description);
  }
  const statBlocks = parseStatBlocks(pages, {
    excludeNames: emittedCreatureNames,
    containingItemByName:
      input.statBlockContainingItems ?? new Map<string, string>(),
    cleanTextByName,
  });
  validateStatBlockCoverage(statBlocks, input.expectedStatBlockNames);
  // SRD 5.1 has no standalone treasure-tables chapter either. Best-effort.
  const treasureTablePages = sliceSectionOrEmptyPages(
    pages,
    anchors.treasureTables,
  );
  const coreRules = parseRules(coreRulePages);
  // The general Spellcasting-rules chapter (loreweaver-3hp) is a separate slice
  // (the coreRules anchor ends at "Spellcasting"), parsed by the same
  // nesting-aware parser and concatenated. Its key slugs are reserved against
  // the core-rules slugs so cross-chapter title repeats ("Range", "Attack
  // Rolls", "Saving Throws", "Reactions") parent-qualify instead of producing
  // duplicate `rule:` keys; the already-reviewed core keys are unchanged.
  // Best-effort START: a reduced fixture PDF with no Spellcasting chapter
  // degrades to no spellcasting rules. The anchor's requireEndHeading bound
  // still fails closed if the chapter starts and its "Spell Lists" boundary is
  // missing, so spell-list/description content cannot bleed into the rules.
  const spellcastingRulePages = sliceSectionOrEmptyPages(
    pages,
    anchors.spellcastingRules,
  );
  const reservedRuleKeySlugs = new Set(
    coreRules
      .map((rule) => rule.keySlug)
      .filter((slug): slug is string => slug !== undefined),
  );
  const spellcastingRules = parseRules(
    spellcastingRulePages,
    reservedRuleKeySlugs,
  );
  const gamemasteringRules = parseGamemasteringRules(madnessPages, objectPages);
  // SRD 5.1 "Expenses" region (p72-74): the Trade Goods / Lifestyle Expenses /
  // Food/Drink/Lodging / Services cost tables plus the Spellcasting Services
  // prose (eshyra-0m9.19). Best-effort start so a reduced fixture PDF without
  // this region degrades to no expenses tables and no spellcasting-services
  // rule. The Spellcasting Services subsection has no rate table (the SRD says
  // no established rates exist), so it is emitted as a standalone `rule` record
  // rather than lost prose.
  const expensesPages = sliceSectionOrEmptyPages(pages, anchors.expenses);
  const spellcastingServicesRule = parseSpellcastingServices(expensesPages);
  const rulesBeforeBeyondFirstLevel = [
    ...coreRules,
    ...spellcastingRules,
    ...gamemasteringRules,
    ...(spellcastingServicesRule === undefined
      ? []
      : [spellcastingServicesRule]),
  ];
  // The "Beyond 1st Level" chapter (p56-60) also carries character-rules PROSE
  // (eshyra-0m9.18): the Multiclassing subsection tree (Prerequisites,
  // Experience Points, Hit Points and Hit Dice, Proficiency Bonus,
  // Proficiencies, Class Features and its four leaves) plus the Alignment,
  // Languages, and Inspiration sections. It is parsed by the same
  // nesting-aware `parseRules` with two chapter-specific behaviors: (1) the
  // chapter INTRO — the SRD's character-advancement rules (gaining levels,
  // hit-point increases, the ability-score cap) — precedes any heading, so
  // the `chapterIntro` option emits it as `rule:beyond-1st-level`; (2) the
  // chapter's table captions are excluded by the parser's table-caption list
  // because the `table` kind owns those records. Every previously emitted key
  // slug is reserved so cross-slice title repeats (the chapter's "Proficiency
  // Bonus" vs the core-rules `rule:proficiency-bonus`) parent-qualify instead
  // of colliding. Best-effort start: a reduced fixture PDF without the
  // chapter degrades to no Beyond-1st-Level rules.
  const beyondFirstLevelPages = sliceSectionOrEmptyPages(
    pages,
    anchors.beyondFirstLevel,
  );
  const beyondFirstLevelRules = parseRules(
    beyondFirstLevelPages,
    new Set(
      rulesBeforeBeyondFirstLevel
        .map((rule) => rule.keySlug)
        .filter((slug): slug is string => slug !== undefined),
    ),
    { name: 'Beyond 1st Level', keySlug: 'beyond-1st-level' },
  );
  // The "Magic Items" chapter intro (pp206-207) carries the general
  // magic-item usage rules (eshyra-0m9.21): Attunement, Wearing and Wielding
  // Items (Multiple Items of the Same Kind, Paired Items), and Activating an
  // Item (Command Word, Consumables, Spells, Charges). It is parsed by the
  // same nesting-aware `parseRules`; the chapter's opening paragraph precedes
  // any heading, so the `chapterIntro` option emits it as `rule:magic-items`.
  // These general rules stay separate from the per-item `magic-item` records
  // the A-Z slice owns. Every previously emitted key slug is reserved so a
  // cross-slice title repeat would parent-qualify instead of colliding.
  // Best-effort start: a reduced fixture PDF without the chapter intro
  // degrades to no magic-item rules.
  const magicItemRulePages = sliceSectionOrEmptyPages(
    pages,
    anchors.magicItemRules,
  );
  const magicItemRules = parseRules(
    magicItemRulePages,
    new Set(
      [...rulesBeforeBeyondFirstLevel, ...beyondFirstLevelRules]
        .map((rule) => rule.keySlug)
        .filter((slug): slug is string => slug !== undefined),
    ),
    { name: 'Magic Items', keySlug: 'magic-items' },
  );
  // SRD 5.1 gamemastering "Traps" section general-rules prose (eshyra-0m9.20):
  // the five heading-level sections that precede the alphabetic "Sample Traps"
  // run (Traps in Play; Triggering a Trap; Detecting and Disabling a Trap;
  // Trap Effects; Complex Traps) plus the chapter-intro paragraph. The heading
  // "Sample Traps" is at h≈13.9, which is below the extractor's heading-flag
  // threshold (h < 14) and therefore not in `headingLineIndexes` — so it
  // cannot serve as a `matchHeadings` end anchor against the full PDF pages.
  // Instead, `truncateBeforeFirst` carves the rules sub-slice from the
  // already-correctly-bounded `trapPages` slice; since `trapPages` excludes
  // the table-of-contents portion of the PDF, "Sample Traps" as a line pattern
  // is safe to use without the heading-flag guard. `trapPages` being empty
  // (fixture PDFs without a Traps section) degrades cleanly to no trap rules.
  // The two trap reference table captions ("Trap Save DCs and Attack Bonuses"
  // and "Damage Severity by Level", both h≈12) are excluded from rule emission
  // via `TABLE_CAPTION_LEAF_TITLES` in `parseRules.ts`; the `table` kind owns
  // those records from the same slice.
  const trapRulePages = truncateBeforeFirst(trapPages, /^Sample Traps$/);
  const trapRules = parseRules(
    trapRulePages,
    new Set(
      [
        ...rulesBeforeBeyondFirstLevel,
        ...beyondFirstLevelRules,
        ...magicItemRules,
      ]
        .map((rule) => rule.keySlug)
        .filter((slug): slug is string => slug !== undefined),
    ),
    { name: 'Traps', keySlug: 'traps' },
  );
  // Monsters-chapter stat-block interpretation rules (eshyra-0m9.22): the
  // pp254-260 prose that explains how to READ a stat block (Size, Type,
  // Alignment, Armor Class, Hit Points, Speed and its movement modes, Ability
  // Scores, Saving Throws, Skills, Vulnerabilities/Resistances/Immunities,
  // Senses and the four special senses, Languages/Telepathy, Challenge/XP,
  // Special Traits and its three leaves, Actions and its three leaves,
  // Reactions, Limited Usage, Equipment, and the Legendary Creatures tree)
  // plus the chapter's three h≈10.8 gray callout boxes (Modifying Creatures;
  // Armor, Weapon, and Tool Proficiencies; Grapple Rules for Monsters), which
  // the heading parser emits via its sidebar tier. The rules region is carved
  // from the already-bounded `monsterPages` slice by truncating before the
  // first alphabetic group heading "Monsters (A)" (h≈18 — the same
  // truncate-a-bounded-slice pattern as `trapRulePages`). `missingBoundary:
  // 'empty'` degrades reduced fixture PDFs (stat blocks only, no group
  // heading) to no monster rules; the real import stays fail-closed via
  // `expectedRuleKeys`. The chapter's "Monsters" title line is consumed by
  // the section anchor, so the `chapterIntro` option both emits the opening
  // stat-block paragraph as `rule:monsters` and seeds "Monsters" as the
  // tier-0 ancestor — the seven headings whose titles other slices already
  // own (Alignment, Armor Class, Speed, Saving Throws, Skills, Languages,
  // Reactions) parent-qualify to `rule:monsters-*` instead of degrading to
  // numeric suffixes. The chapter's four h≈12 reference-table captions (Size
  // Categories; Hit Dice by Size; Proficiency Bonus by Challenge Rating;
  // Experience Points by Challenge Rating) are excluded from rule emission
  // via `TABLE_CAPTION_LEAF_TITLES`; the `table` kind owns those records
  // from the same slice.
  const monsterRulePages = truncateBeforeFirst(
    monsterPages,
    /^Monsters \(A\)$/,
    'empty',
  );
  const monsterRules = parseRules(
    monsterRulePages,
    new Set(
      [
        ...rulesBeforeBeyondFirstLevel,
        ...beyondFirstLevelRules,
        ...magicItemRules,
        ...trapRules,
      ]
        .map((rule) => rule.keySlug)
        .filter((slug): slug is string => slug !== undefined),
    ),
    { name: 'Monsters', keySlug: 'monsters' },
  );
  // SRD 5.1 "Backgrounds" chapter (p60-61, eshyra-0m9.17): the chapter-intro
  // sections plus the lone Acolyte entry. The entry parses into a `background`
  // record (plus its four suggested-characteristics roll tables, emitted under
  // the `table` kind); the intro region is carved off with
  // `truncateBeforeFirst(/^Acolyte$/)` — the entry heading is h≈13.9, below
  // the heading-flag threshold, so it cannot serve as a matchHeadings boundary
  // (same pattern as the Traps "Sample Traps" cut) — and fed to the
  // nesting-aware `parseRules`. The chapter's opening paragraph precedes any
  // heading, so the `chapterIntro` option emits it as `rule:backgrounds` and
  // seeds "Backgrounds" as the tier-0 ancestor: the three intro leaves whose
  // titles other slices already own (Proficiencies / Languages — Beyond 1st
  // Level — and Equipment — the Monsters chapter) parent-qualify to
  // `rule:backgrounds-*`. `missingBoundary: 'empty'` degrades fixture PDFs
  // without an Acolyte entry to no background rules; the real import stays
  // fail-closed via `expectedRuleKeys` and `expectedBackgroundNames`.
  const backgroundPages = sliceSectionOrEmptyPages(pages, anchors.backgrounds);
  const { backgrounds, characteristicTables } =
    parseBackgrounds(backgroundPages);
  validateBackgroundCoverage(backgrounds, input.expectedBackgroundNames);
  const backgroundRulePages = truncateBeforeFirst(
    backgroundPages,
    /^Acolyte$/,
    'empty',
  );
  const backgroundRules = parseRules(
    backgroundRulePages,
    new Set(
      [
        ...rulesBeforeBeyondFirstLevel,
        ...beyondFirstLevelRules,
        ...magicItemRules,
        ...trapRules,
        ...monsterRules,
      ]
        .map((rule) => rule.keySlug)
        .filter((slug): slug is string => slug !== undefined),
    ),
    { name: 'Backgrounds', keySlug: 'backgrounds' },
  );
  const nonClassRules = [
    ...rulesBeforeBeyondFirstLevel,
    ...beyondFirstLevelRules,
    ...magicItemRules,
    ...trapRules,
    ...monsterRules,
    ...backgroundRules,
  ];
  // The core-rules slice carries the Difficulty Classes table plus the two
  // tables behind excluded captions — Ability Scores and Modifiers (p76) and
  // Travel Pace (p84) — each anchored on its unique column-header row because
  // both captions also occur as section headings in the same slice
  // (eshyra-10t). The two trap reference tables live in the Traps slice
  // (loreweaver-hvp); feed it alongside the core-rules and treasure slices so
  // parseTables reconstructs them with the same anchored row rules. The six "Beyond 1st Level" reference
  // tables (Character Advancement, Multiclassing Prerequisites / Proficiencies,
  // Standard / Exotic Languages — eshyra-0m9.23 — and Multiclass Spellcaster:
  // Spell Slots per Spell Level — eshyra-0m9.18) live in the chapter slice
  // already cut above for the chapter's prose rules; it is best-effort on its
  // start so reduced fixture PDFs without the chapter degrade to no
  // Beyond-1st-Level tables. The Equipment chapter slice carries
  // the Standard Exchange Rates coin matrix (p62) and the Expenses slice carries
  // the Trade Goods / Lifestyle / Food/Drink/Lodging / Services cost tables
  // (eshyra-0m9.19); both are fed alongside so parseTables reconstructs them by
  // their unique column-header anchors. The Monsters-chapter rules sub-slice
  // carries the four monster reference tables (Size Categories — disambiguated
  // from the core-rules Combat table of the same caption by its
  // "Size Space Examples" header row — Hit Dice by Size, Proficiency Bonus by
  // Challenge Rating, and Experience Points by Challenge Rating;
  // eshyra-0m9.22).
  // The background suggested-characteristics roll tables come from
  // parseBackgrounds (the SRD prints them caption-less, so parseTables'
  // caption-anchored reconstruction cannot own them); concatenate before the
  // coverage gate so the table baseline covers them too (eshyra-0m9.17).
  // Document-wide tables (eshyra-4a7.3): located by typography (leaf-tier
  // anchor heading + exact cell-tier header line) against the FULL document
  // rather than a section slice, per reviewed spec with an exact row count.
  // Uniform-font fixtures never satisfy the tier requirement and yield none.
  const tables = [
    ...parseTables([
      ...coreRulePages,
      ...treasureTablePages,
      ...trapPages,
      ...madnessPages,
      ...objectPages,
      ...beyondFirstLevelPages,
      ...equipmentPages,
      ...expensesPages,
      ...monsterRulePages,
    ]),
    ...parseDocumentTables(pages),
    ...characteristicTables,
  ];
  validateTableCoverage(tables, input.expectedTableNames);
  // Sliced after the other sections so the existing fail-closed tests trip on
  // their own anchor first. Throws SectionNotFoundError if the races anchor
  // doesn't match — ancestry is an implemented kind, so fail closed rather than
  // emit a pack without races.
  const racePages = sliceSection(pages, anchors.races);
  const ancestries = parseAncestries(racePages);
  validateAncestryCoverage(ancestries);
  // Throws SectionNotFoundError if the classes start OR end anchor doesn't
  // match — class is an implemented kind, so fail closed rather than emit a
  // pack without classes (the classes anchor sets requireEndHeading: true).
  const classPages = sliceSection(pages, anchors.classes);
  const classCalloutRules = parseClassCallouts(classPages);
  const rulesBeforeUnrepresentedProse = [
    ...nonClassRules,
    ...classCalloutRules,
  ];
  const reservedRuleSlugs = (
    priorRules: readonly import('./types.js').RuleExtraction[],
  ): ReadonlySet<string> =>
    new Set(
      priorRules
        .map((rule) => rule.keySlug)
        .filter((slug): slug is string => slug !== undefined),
    );

  // Races p3 trait-category guidance. The slice starts after "Racial Traits",
  // so chapterIntro restores that root rule and seeds it as the parent for
  // colliding child titles such as Alignment, Size, Speed, and Languages.
  const racialTraitPages = sliceSectionOrEmptyPages(
    pages,
    anchors.racialTraits,
  );
  const racialTraitRules = parseRules(
    racialTraitPages,
    reservedRuleSlugs(rulesBeforeUnrepresentedProse),
    { name: 'Racial Traits', keySlug: 'racial-traits' },
  );

  // Equipment pp64-65 guidance around the armor and weapon tables. The
  // reviewed table captions are excluded in parseRules, while prose-height
  // lines that resume after a physical table return to their owning rule.
  const armorGuidancePages = sliceSectionOrEmptyPages(
    pages,
    anchors.armorGuidance,
  );
  const armorGuidanceRules = parseRules(
    removeTableCellLines(armorGuidancePages),
    reservedRuleSlugs([...rulesBeforeUnrepresentedProse, ...racialTraitRules]),
    {
      name: 'Getting Into and Out of Armor',
      keySlug: 'getting-into-and-out-of-armor',
    },
  );
  const weaponGuidancePages = sliceSectionOrEmptyPages(
    pages,
    anchors.weaponGuidance,
  );
  const weaponGuidanceRules = parseRules(
    removeTableCellLines(weaponGuidancePages),
    reservedRuleSlugs([
      ...rulesBeforeUnrepresentedProse,
      ...racialTraitRules,
      ...armorGuidanceRules,
    ]),
    { name: 'Weapons Guidance', keySlug: 'weapons' },
  );

  // The p73 sidebar body is table-cell-sized text, so it uses its dedicated
  // bounded prose parser rather than the heading-hierarchy parser.
  const selfSufficiencyRule = parseSelfSufficiency(
    sliceSectionOrEmptyPages(pages, anchors.selfSufficiency),
  );
  const rules = [
    ...rulesBeforeUnrepresentedProse,
    ...racialTraitRules,
    ...armorGuidanceRules,
    ...weaponGuidanceRules,
    ...(selfSufficiencyRule === undefined ? [] : [selfSufficiencyRule]),
  ];
  // Fail closed before any output is written when the real import (CLI) supplies
  // the exact expected rule-key set and any implemented rule slice drifts from
  // it (loreweaver-yli, loreweaver-3hp, and loreweaver-0m9.5.23).
  validateRuleCoverage(rules, input.expectedRuleKeys);
  const classes = parseClasses(classPages);
  // Fail closed before any output is written if class extraction is empty or
  // (when a floor is supplied) implausibly small. Class is an implemented kind.
  validateClassCoverage(classes.length, input.minClassCount);
  // Subclasses (Champion, Life domain, …) live inside the Classes chapter, so
  // they parse from the same slice. See ADR 0009 and loreweaver-0m9.5.17.
  const subclasses = parseSubclasses(classPages);
  // Fail closed before any output is written if subclass extraction is empty or
  // (when a floor is supplied) implausibly small. Subclass is an implemented
  // kind, so a Classes section that yields base classes but no subclasses must
  // not silently produce a pack that omits `subclass` from the manifest.
  validateSubclassCoverage(subclasses.length, input.minSubclassCount);
  // Class- and subclass-granted features parse from the same Classes-chapter
  // slice (ADR 0009 / loreweaver-0m9.5.18).
  const features = parseFeatures(classPages);
  validateFeatureCoverage(features.length, input.minFeatureCount);
  // Best-effort enrichment: the SRD Class Features block carries no primary-
  // ability line, so per-class primary abilities come from the Multiclassing
  // prerequisites listing (loreweaver-0m9.5.19). This is NOT fail-closed — per
  // ADR 0007 a missing source value is left empty rather than authored, so a
  // PDF without a locatable Multiclassing section simply yields empty
  // primaryAbilities (the prior behavior) instead of throwing.
  let primaryAbilityIndex: ClassPrimaryAbilityIndex = new Map();
  try {
    const multiclassingPages = sliceSection(pages, anchors.multiclassing);
    primaryAbilityIndex = parseMulticlassing(multiclassingPages);
  } catch (error) {
    if (!(error instanceof SectionNotFoundError)) throw error;
    // Multiclassing section absent: leave primaryAbilities empty.
  }
  const pack = buildPack({
    spells,
    classIndex,
    primaryAbilityIndex,
    // Monsters + Appendix MM-A + Appendix MM-B NPCs all emit under the
    // `creature` kind; `emit.ts` sorts by key, so concatenation order does not
    // affect the output. NPC records carry `data.category: 'npc'`
    // (loreweaver-bn0).
    creatures: [...creatures, ...npcs],
    statBlocks,
    classes,
    subclasses,
    features,
    conditions,
    feats,
    hazards,
    traps,
    diseases,
    poisons,
    actions,
    rules,
    tables,
    equipment,
    magicItems,
    ancestries,
    backgrounds,
    sourceHash,
  });
  // Source-structure coverage gate (eshyra-4a7.1): every typography-derived
  // source structure must be an emitted record, structured child data,
  // intentionally ignored with a reason, or a tracked known gap. Evaluated
  // against the FINAL emitted records and asserted before any output is
  // written, so an unaccounted source structure fails the run closed.
  let sourceCoverageArtifacts:
    | {
        readonly inventory: ReturnType<typeof buildSourceInventory>;
        readonly report: ReturnType<typeof buildSourceCoverageReport>;
      }
    | undefined;
  if (input.sourceCoverageRules !== undefined) {
    const inventory = buildSourceInventory(pages);
    const coverageEntries = evaluateSourceCoverage(
      inventory,
      pack.records,
      input.sourceCoverageRules,
    );
    assertSourceCoverage(coverageEntries);
    sourceCoverageArtifacts = {
      inventory,
      report: buildSourceCoverageReport(coverageEntries, pack.records),
    };
  }
  writePackToDirectory(pack, { outDir: input.outDir });
  if (sourceCoverageArtifacts !== undefined) {
    writeSourceCoverageArtifacts(
      sourceCoverageArtifacts.inventory,
      sourceCoverageArtifacts.report,
      { outDir: input.outDir },
    );
  }
  return {
    outDir: input.outDir,
    sourceHash,
    counts: {
      spells: spells.length,
      creatures: creatures.length,
      npcs: npcs.length,
      statBlocks: statBlocks.length,
      classes: classes.length,
      subclasses: subclasses.length,
      features: features.length,
      conditions: conditions.length,
      feats: feats.length,
      hazards: hazards.length,
      traps: traps.length,
      diseases: diseases.length,
      poisons: poisons.length,
      actions: actions.length,
      rules: rules.length,
      tables: tables.length,
      equipment: equipment.length,
      magicItems: magicItems.length,
      ancestries: ancestries.length,
      backgrounds: backgrounds.length,
    },
  };
}

function sha256Hex(bytes: Uint8Array | Buffer): string {
  return createHash('sha256').update(bytes).digest('hex');
}

/**
 * Slice a section and run its parser, but degrade to an empty result list if
 * the section START heading is absent. Used for kinds whose section is
 * absent from the SRD 5.1 PDF entirely (hazards, treasure tables) —
 * fail-closed parsing would refuse a perfectly valid run on the canonical
 * source.
 *
 * Critically, this only catches `SectionNotFoundError('start', ...)`. If
 * the start anchor matches but the requireEndHeading guard fires (a real
 * boundary failure that would let trailing content bleed into the parser),
 * the error still propagates. Coverage / schema / other errors also
 * propagate.
 */
function sliceSectionOrEmpty<T>(
  pages: readonly import('./types.js').PageText[],
  anchor: SectionAnchorOptions,
  parse: (slice: readonly import('./types.js').PageText[]) => T[],
): T[] {
  try {
    const slice = sliceSection(pages, anchor);
    return parse(slice);
  } catch (error) {
    if (error instanceof SectionNotFoundError && error.which === 'start') {
      return [];
    }
    throw error;
  }
}

/**
 * Pages-only variant for `treasureTables` — it feeds into `parseTables`
 * alongside the core-rules slice rather than being parsed in isolation.
 * Same fail-closed boundaries as `sliceSectionOrEmpty`: only a missing
 * start heading degrades to empty; a missing required end heading still
 * throws.
 */
function sliceSectionOrEmptyPages(
  pages: readonly import('./types.js').PageText[],
  anchor: SectionAnchorOptions,
): readonly import('./types.js').PageText[] {
  try {
    return sliceSection(pages, anchor);
  } catch (error) {
    if (error instanceof SectionNotFoundError && error.which === 'start') {
      return [];
    }
    throw error;
  }
}

/**
 * Truncate `pages` just before the first line matching `pattern`. Used for
 * sections whose end heading is below the extractor's heading-flag threshold
 * (h < 14) — specifically the "Sample Traps" heading at h≈13.9, which is not
 * in `headingLineIndexes` and therefore cannot be used as a `matchHeadings`
 * end anchor on the full PDF pages (eshyra-0m9.20). The caller must already
 * have narrowed `pages` to a correctly-bounded slice (e.g. via
 * `sliceSectionOrEmptyPages`) so the pattern cannot match an unrelated
 * earlier occurrence of the same text (e.g. a table-of-contents entry).
 * Throws `SectionNotFoundError('end', pattern)` when `pages` is non-empty
 * and the pattern is not found — a non-empty slice with no recognizable
 * boundary is treated as a hard error, not a silent over-extraction.
 *
 * `missingBoundary: 'empty'` (eshyra-0m9.22) instead degrades a missing
 * boundary to an EMPTY result. The Monsters chapter needs this: fixture PDFs
 * carry a reduced Monsters section (stat blocks only, no "Monsters (A)" group
 * heading and no interpretation-rules prose), so a missing boundary there
 * means "this source has no monster-rules region", not over-extraction —
 * returning all pages would feed stat blocks to the rule parser, and throwing
 * would break every reduced-fixture pipeline. The real import stays
 * fail-closed through `expectedRuleKeys`: if the real PDF's boundary ever
 * drifts, the silently-empty monster-rules slice yields missing rule keys and
 * `RuleCoverageError` refuses to write the pack.
 */
function truncateBeforeFirst(
  pages: readonly import('./types.js').PageText[],
  pattern: RegExp,
  missingBoundary: 'throw' | 'empty' = 'throw',
): readonly import('./types.js').PageText[] {
  if (pages.length === 0) return pages;
  const out: import('./types.js').PageText[] = [];
  for (const page of pages) {
    let matchLine = -1;
    for (let l = 0; l < page.lines.length; l++) {
      if (pattern.test(page.lines[l].trim())) {
        matchLine = l;
        break;
      }
    }
    if (matchLine === -1) {
      out.push(page);
    } else {
      if (matchLine > 0) {
        const lines = page.lines.slice(0, matchLine);
        const lineHeights = page.lineHeights?.slice(0, matchLine);
        out.push({
          pageNumber: page.pageNumber,
          lines,
          ...(lineHeights !== undefined ? { lineHeights } : {}),
        });
      }
      return out;
    }
  }
  if (missingBoundary === 'empty') return [];
  throw new SectionNotFoundError('end', pattern);
}
