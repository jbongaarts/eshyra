/**
 * Default-on coverage and audit tests for the committed D&D 5e SRD 5.1
 * rules-pack at `packages/core/data/rules-packs/rules__dnd5e-srd-5.1/`.
 *
 * These tests operate on the COMMITTED pack on disk — not on importer output.
 * Per the 0m9.6 design, the importer is treated as a one-shot construction
 * tool. Continuously re-running it on every PR is the path-gated
 * `verify:dnd5e-srd-pack` job's responsibility, not vitest's.
 *
 * What this file guards:
 *   - The committed pack still loads and validates.
 *   - Per-kind counts match the canonical full-pack baseline literal
 *     (loreweaver-1pw replaced the two-record seed pack with the importer's
 *     full deterministic output from the vendored SRD 5.1 PDF).
 *   - Key shape is consistent and unique.
 *   - A representative stable key from every kind is present.
 *   - The generic `auditPack` heuristic surfaces no suspicious records, and the
 *     set of partially-populated optional data fields matches an explicitly
 *     reviewed baseline (these are genuinely-optional SRD fields — e.g. a spell
 *     `ritual` flag or an ancestry `subraces` list — present on some records of
 *     a kind and absent on others, not parser drift).
 *   - The pack's license/source manifest aligns with the vendored source
 *     manifest at `packages/core/sources/dnd5e-srd-5.1/manifest.json`.
 *
 * Out of scope (see bead notes):
 *   - Exact creature name-set validation → `loreweaver-0m9.5.14`.
 *   - Pathfinder coverage → `loreweaver-0m9.9`.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  EXPECTED_SRD_5_1_CREATURE_NAMES,
  EXPECTED_SRD_5_1_DISEASE_NAMES,
  EXPECTED_SRD_5_1_MAGIC_ITEM_NAMES,
  EXPECTED_SRD_5_1_NPC_NAMES,
  EXPECTED_SRD_5_1_POISON_NAMES,
  EXPECTED_SRD_5_1_RULE_KEYS,
  EXPECTED_SRD_5_1_TABLE_NAMES,
  MIN_EXPECTED_SRD_5_1_CREATURES,
  MIN_EXPECTED_SRD_5_1_MAGIC_ITEMS,
} from '../scripts/importers/dnd5e-srd-5.1/index.js';
import {
  auditPack,
  auditSrdStructure,
  loadRulesPackFromDirectory,
  validateRulesPack,
} from '../src/internal.js';

const PACK_DIR = join(
  process.cwd(),
  'packages/core/data/rules-packs/rules__dnd5e-srd-5.1',
);

const SOURCE_MANIFEST_PATH = join(
  process.cwd(),
  'packages/core/sources/dnd5e-srd-5.1/manifest.json',
);

interface SrdSourceManifest {
  readonly sourceTitle: string;
  readonly sourceVersion: string;
  readonly license: {
    readonly name: string;
    readonly url: string;
  };
  readonly artifact: {
    readonly sourceUrl: string;
    readonly sha256: string;
  };
  readonly attribution: {
    readonly text: string;
  };
}

function readSourceManifest(): SrdSourceManifest {
  return JSON.parse(
    readFileSync(SOURCE_MANIFEST_PATH, 'utf8'),
  ) as SrdSourceManifest;
}

/**
 * Per-kind record-count baseline for the committed canonical pack at
 * `packages/core/data/rules-packs/rules__dnd5e-srd-5.1/`. These are the exact
 * per-kind counts the deterministic importer produces from the vendored
 * SRD 5.1 PDF (loreweaver-1pw); `npm run verify:dnd5e-srd-pack` proves the
 * committed pack equals importer output byte-for-byte.
 *
 * The match is exact: the test fails if a kind appears or disappears, or any
 * count drifts. That's the regression-guard intent — accidental edits to the
 * committed pack, or an importer/parser change that silently alters coverage,
 * do not slip through unnoticed. An intentional coverage change updates this
 * literal (and re-runs the verify command) as part of that change.
 */
const EXPECTED_COUNTS_BY_KIND: Readonly<Record<string, number>> = {
  action: 10,
  ancestry: 13,
  // The lone SRD 5.1 Backgrounds-chapter entry, Acolyte (eshyra-0m9.17), with
  // structured grant fields and the nested Shelter of the Faithful feature.
  // Its four suggested-characteristics roll tables are `table` records and the
  // chapter-intro sections are `rule` records (counted below).
  background: 1,
  class: 12,
  condition: 15,
  // 296 Monsters/Appendix MM-A creatures + 21 Appendix MM-B NPC stat blocks,
  // all under the `creature` kind; NPCs carry data.category='npc'
  // (loreweaver-bn0). The two coverage sets are validated independently below.
  creature: 317,
  equipment: 218,
  feat: 1,
  // 148 -> 165 (eshyra-0m9.13): the feature-heading boundary fix recovered 17
  // class/subclass features previously swallowed into the preceding feature's
  // body because their heading or grant lead-in went undetected. Each is a real
  // SRD 5.1 feature heading:
  //   curly apostrophe (U+2019) headings — feature:circle-of-the-land:lands-stride
  //   (6th), :natures-ward (10th), :natures-sanctuary (14th);
  //   feature:hunter:hunters-prey (3rd), :superior-hunters-defense (15th);
  //   feature:the-fiend:dark-ones-blessing (1st), :dark-ones-own-luck (6th);
  //   feature:thief:thiefs-reflexes (17th); feature:ranger:lands-stride (8th).
  //   colon heading — feature:life-domain:channel-divinity-preserve-life (2nd).
  //   "Also starting at …" lead-in — feature:life-domain:disciple-of-life (1st);
  //   feature:college-of-lore:cutting-words (3rd, "Also at 3rd level").
  //   "By Nth level …" lead-in — feature:thief:use-magic-device (13th);
  //   feature:rogue:reliable-talent (11th), :slippery-mind (15th).
  //   second-sentence / enumerated grant clause — feature:circle-of-the-land:
  //   circle-spells (3rd, "At 3rd, 5th, 7th, and 9th level"); feature:
  //   draconic-bloodline:draconic-resilience (1st, "At 1st level" after an
  //   intro sentence).
  // 165 -> 167 (eshyra-0m9.14): the progression-table row-stitching fix merges
  // feature cells that wrap across two extracted lines back onto their row
  // before feature detection. Two SRD 5.1 base-class features whose ONLY grant
  // cell wrapped were previously truncated in the table and so swallowed into
  // the preceding feature's body; they are now emitted as their own records:
  //   feature:sorcerer:sorcerous-origin (1st; "Spellcasting, Sorcerous" + wrap
  //   "Origin") and feature:warlock:pact-magic (1st; "Otherworldly Patron, Pact"
  //   + wrap "Magic"). The same fix also corrects two existing records in place
  //   (no count change): feature:fighter:indomitable is renamed from the bogus
  //   feature:fighter:indomitable-three-uses (the wrapped 17th-level repeated-use
  //   cell was mistaken for the canonical heading), and the earliest-grant levels
  //   of feature:druid:ability-score-improvement (12 -> 4) and
  //   feature:bard:magical-secrets (14 -> 10) now come from their wrapped first
  //   grant rows rather than a later un-wrapped row.
  // 167 -> 169 (eshyra-tzl): two subclass features whose grant level is stated
  // by a subclass-entry lead-in the parser did not recognize are now emitted at
  // their 3rd-level grant. Each lead-in occurs exactly once in the SRD 5.1
  // Classes chapter:
  //   feature:college-of-lore:bonus-proficiencies (3rd, "When you join the
  //   College of Lore at 3rd level …") and feature:oath-of-devotion:channel-
  //   divinity (3rd, "When you take this oath at 3rd level …", carrying the
  //   Sacred Weapon and Turn the Unholy options). Emitting the latter is
  //   consistent with the existing Channel Divinity feature precedent
  //   (feature:cleric:channel-divinity, feature:life-domain:channel-divinity-
  //   preserve-life). The subclass blurbs are produced by parseSubclasses and
  //   are unchanged.
  // 169 -> 183 (eshyra-7tc + eshyra-ai9): the Classes slice begins AFTER the
  // "Barbarian" chapter heading (it is the `classes` section-anchor start
  // boundary, excluded from the slice), so parseFeatures opened no class context
  // for the Barbarian body and dropped every Barbarian base-class feature.
  // parseFeatures now opens implicit Barbarian class context at the start of the
  // slice (mirroring parseSubclasses' `currentParent = 'Barbarian'` default),
  // recovering all 14 SRD 5.1 Barbarian base features: feature:barbarian:rage
  // (1), :unarmored-defense (1), :reckless-attack (2), :danger-sense (2),
  // :primal-path (3), :ability-score-improvement (4), :extra-attack (5),
  // :fast-movement (5), :feral-instinct (7), :brutal-critical (9),
  // :relentless-rage (11), :persistent-rage (15), :indomitable-might (18),
  // :primal-champion (20). Unarmored Defense (1st) required a second fix
  // (eshyra-ai9): the Barbarian table is the only SRD 5.1 class table whose
  // Features column is followed by numeric columns (Rages, Rage Damage), so its
  // 1st-level row extracts with those numerics interleaved before the wrapped
  // cell remainder ("1st +2 Rage, 2 +2" | "Unarmored" | "Defense"). Row-stitching
  // now strips the trailing numeric columns before joining the continuation,
  // reuniting the cell as "Rage, Unarmored Defense"; both Rage and Unarmored
  // Defense emit at level 1 with source-bounded descriptions (Rage's body no
  // longer absorbs the Unarmored Defense heading/body).
  feature: 183,
  // 8 sample traps (loreweaver-hvp) + 3 sample diseases + 14 sample poisons
  // (loreweaver-6ra) all emit under the `hazard` kind; SRD 5.1 has no
  // environmental hazards. Traps carry a `trapType` discriminator; diseases and
  // poisons carry `data.category` ('disease' / 'poison').
  hazard: 25,
  // 239 Magic Items A-Z entries plus Orb of Dragonkind from the Artifacts
  // subsection. Figurine of Wondrous Power is no longer swallowed by Feather
  // Token (eshyra-4a7.8).
  'magic-item': 240,
  // Nesting-aware core-rules parse: one rule per heading across the Using
  // Ability Scores, Adventuring, and Combat chapters (loreweaver-yli, 127),
  // plus 34 general Spellcasting rules, five Madness/Objects rules, five
  // Classes-chapter callout rules, the Spellcasting Services prose rule
  // (eshyra-0m9.19), the 18 "Beyond 1st Level" chapter rules — the
  // chapter-intro advancement prose plus the Multiclassing / Alignment /
  // Languages / Inspiration sections (eshyra-0m9.18) — the 10 "Magic
  // Items" chapter-intro usage rules (the intro paragraph, Attunement,
  // Wearing and Wielding Items, Activating an Item, and their leaves;
  // eshyra-0m9.21), and the 6 general gamemastering "Traps" rules (the
  // chapter-intro prose, Traps in Play, Triggering a Trap, Detecting and
  // Disabling a Trap, Trap Effects, Complex Traps; eshyra-0m9.20), and the
  // 44 Monsters-chapter stat-block interpretation rules (the chapter-intro
  // paragraph, the pp254-260 sections and their leaves, the Legendary
  // Creatures tree, and the three gray callout boxes; eshyra-0m9.22), and the
  // 6 Backgrounds-chapter intro rules (the chapter-intro paragraph plus the
  // five h≈12 intro leaves, three of them parent-qualified to
  // `rule:backgrounds-*` because other slices own their bare titles;
  // eshyra-0m9.17), plus the 16 Races/Equipment prose rules from
  // eshyra-4a7.10.1: eight racial-trait category rules, Getting Into and Out
  // of Armor, six weapon-guidance rules, and Self-Sufficiency. Validated
  // exactly against EXPECTED_SRD_5_1_RULE_KEYS.
  rule: 272,
  spell: 319,
  // Avatar of Death (Deck of Many Things, p218) and Giant Fly (Figurine of
  // Wondrous Power, p222): abbreviated combat stat blocks defined inline under a
  // magic item, emitted under the dedicated `stat-block` kind so the strict
  // `creature` schema stays untouched (eshyra-4a7.4). Validated exactly against
  // EXPECTED_SRD_5_1_STAT_BLOCK_NAMES.
  'stat-block': 2,
  subclass: 12,
  // Difficulty Classes, two trap tables, three Madness tables, two Objects
  // statistics tables (loreweaver-hvp, loreweaver-uuk), the six "Beyond 1st
  // Level" reference tables (Character Advancement, Multiclassing
  // Prerequisites, Multiclassing Proficiencies, Standard Languages, Exotic
  // Languages — eshyra-0m9.23 — and Multiclass Spellcaster: Spell Slots per
  // Spell Level — eshyra-0m9.18), the five money/downtime tables —
  // Standard Exchange Rates, Trade Goods, Lifestyle Expenses,
  // Food/Drink/Lodging, Services (eshyra-0m9.19) — and the four
  // Monsters-chapter reference tables — Size Categories, Hit Dice by Size,
  // Proficiency Bonus by Challenge Rating, Experience Points by Challenge
  // Rating (eshyra-0m9.22) — the four Acolyte suggested-characteristics
  // roll tables (Personality Traits / Ideals / Bonds / Flaws), which
  // parseBackgrounds emits with synthesized "<Background> <Label>s" names
  // because the SRD prints them caption-less (eshyra-0m9.17) — and the two
  // core-rules tables behind excluded captions, Ability Scores and Modifiers
  // and Travel Pace, anchored on their unique column-header rows because
  // both captions repeat in the core-rules slice (eshyra-10t).
  // 29 -> 53 (eshyra-4a7.3): parseDocumentTables adds the 24 document-wide
  // tables located by typography anchors — Draconic Ancestry (p5) and the
  // Sorcerer-chapter copy (p44), The Barbarian progression, Creating Spell
  // Slots, the ten subclass spell tables (Life Domain, seven Circle of the
  // Land terrains, Oath of Devotion, Fiend Expanded), Donning and Doffing
  // Armor, and nine representative magic-item tables (Gray/Rust/Tan Bag of
  // Tricks, Belt/Potion of Giant Strength, Potions of Healing, Bag of Beans,
  // Robe of Useful Items, Wand of Wonder).
  // 53 -> 80 (eshyra-4a7.8): every remaining Magic Items chapter option,
  // variety, card, dice-result, and sentient-item construction table.
  // 80 -> 93 (eshyra-4a7.6): the 11 remaining class progression tables (The
  // Bard … The Wizard) plus the two feature-owned class tables Beast Shapes
  // (Druid Wild Shape) and Destroy Undead (Cleric).
  // 93 -> 102 (eshyra-o4j7): the nine spell-embedded tables from Animate
  // Objects, Confusion, Control Weather (three), Creation, Reincarnate,
  // Scrying, and Teleport.
  table: 102,
};

/**
 * One representative stable key per kind that must be present in the committed
 * pack — a coarse spot-check that the parse for each kind produced its expected
 * landmark records. Exact full-set coverage per kind lives in the importer's
 * own coverage gates and per-parser tests, not here.
 */
const EXPECTED_STABLE_KEYS: readonly string[] = [
  'action:dodge',
  'ancestry:elf',
  'ancestry:hill-dwarf',
  // The SRD 5.1 Backgrounds chapter's lone entry (eshyra-0m9.17).
  'background:acolyte',
  'class:wizard',
  'condition:blinded',
  'condition:exhaustion',
  'creature:goblin',
  'creature:aboleth',
  // Appendix MM-B NPC stat blocks (loreweaver-bn0).
  'creature:bandit-captain',
  'creature:berserker',
  'equipment:padded',
  'equipment:longsword',
  'equipment:smiths-tools',
  'feat:grappler',
  'feature:champion:improved-critical',
  'feature:oath-of-devotion:aura-of-devotion',
  'feature:path-of-the-berserker:frenzy',
  'hazard:fire-breathing-statue',
  'hazard:sphere-of-annihilation',
  // Sample diseases + poisons under the `hazard` kind (loreweaver-6ra).
  'hazard:cackle-fever',
  'hazard:assassins-blood',
  'hazard:wyvern-poison',
  'magic-item:adamantine-armor',
  'magic-item:ammunition-1-2-or-3',
  'magic-item:amulet-of-health',
  'magic-item:figurine-of-wondrous-power',
  // Lone "Artifacts"-subsection magic item, parsed from its own slice
  // (eshyra-0m9.16).
  'magic-item:orb-of-dragonkind',
  'rule:cover',
  'rule:death-saving-throws',
  // Spellcasting-rules chapter (loreweaver-3hp): a bare landmark plus one of the
  // cross-slice parent-qualified keys.
  'rule:components',
  'rule:casting-a-spell-range',
  'rule:curing-madness',
  'rule:objects',
  // Equipment-chapter Expenses region: Spellcasting Services prose rule
  // (eshyra-0m9.19).
  'rule:spellcasting-services',
  // Races and Equipment prose recovered by eshyra-4a7.10.1.
  'rule:racial-traits',
  'rule:racial-traits-alignment',
  'rule:getting-into-and-out-of-armor',
  'rule:weapon-properties',
  'rule:self-sufficiency',
  // Gamemastering Traps section general rules (eshyra-0m9.20).
  'rule:traps',
  'rule:complex-traps',
  // Monsters-chapter stat-block interpretation rules (eshyra-0m9.22): the
  // chapter intro, a bare landmark, a chapter-qualified key, and a
  // section-qualified leaf.
  'rule:monsters',
  'rule:legendary-creatures',
  'rule:monsters-alignment',
  'rule:senses-blindsight',
  // Backgrounds-chapter intro rules (eshyra-0m9.17): the chapter intro, a
  // unique-titled leaf, and one of the parent-qualified cross-slice keys.
  'rule:backgrounds',
  'rule:customizing-a-background',
  'rule:backgrounds-proficiencies',
  'spell:fire-bolt',
  'spell:wish',
  'subclass:champion',
  'table:difficulty-classes',
  'table:object-hit-points',
  'table:short-term-madness',
  'table:trap-save-dcs-and-attack-bonuses',
  // Monsters-chapter reference tables (eshyra-0m9.22).
  'table:experience-points-by-challenge-rating',
  'table:size-categories',
  // Acolyte suggested-characteristics roll tables (eshyra-0m9.17).
  'table:acolyte-personality-traits',
  'table:acolyte-flaws',
];

/**
 * Reviewed baseline of partially-populated optional `data` fields — fields
 * present on some records of a kind and absent on others. Each entry here was
 * reviewed (loreweaver-1pw) and is a genuinely-optional SRD field, NOT a
 * parser-drift signal:
 *   - ancestry.subraceOf / subraces: only subraces carry `subraceOf`; only
 *     races-with-subraces carry `subraces`.
 *   - creature.category: only the 21 Appendix MM-B NPC stat blocks carry
 *     `category: 'npc'`; the 296 Monsters/Appendix MM-A creatures omit it (its
 *     absence means "monster") so they stay byte-identical to the pre-NPC pack
 *     (loreweaver-bn0).
 *   - creature.{conditionImmunities,damageImmunities,damageResistances,
 *     damageVulnerabilities,savingThrows,skills}: optional keyed stat-block
 *     fields emitted only when the SRD prints that label for the creature
 *     (eshyra-ez6v / eshyra-4a7.5). `senses` and `languages` are fully populated
 *     (all 317 stat blocks carry them), so they are not partial and not listed.
 *   - creature.{traits,actions,reactions,legendaryActions}: optional narrative
 *     body sections emitted only when the creature prints that section
 *     (eshyra-yevt / eshyra-4a7.5).
 *   - creature.variants: only the Giant Rat and Swarm of Insects carry a
 *     "Variant: …" sidebar (eshyra-70xr / eshyra-4a7.5).
 *   - condition.effects: present on all conditions except Exhaustion, whose
 *     mechanics live in its per-level `levels` table.
 *   - condition.levels: only Exhaustion has graded levels.
 *   - equipment.{ac,armorType,stealthDisadvantage,strengthRequirement}: armor-
 *     only fields (13 armor records); strengthRequirement only the 3 heavy
 *     armors that list a Str minimum.
 *   - equipment.{damageDie,damageType,properties}: weapon-only fields (37
 *     weapons); damageDie/damageType absent on the Net, whose damage cell is a
 *     dash, while every weapon carries a (possibly empty) properties list.
 *   - equipment.capacity: Container Capacity, attached to the 13 gear
 *     containers (loreweaver-4zu).
 *   - equipment.{speed,carryingCapacity}: Mounts and Vehicles fields —
 *     `speed` on the 8 mounts + 6 waterborne vehicles (14), `carryingCapacity`
 *     on the 8 mounts only (loreweaver-4zu).
 *   - equipment.description: the 7 Equipment Pack bundles (their verbatim
 *     contents sentence); no other equipment record carries a description
 *     (loreweaver-4zu).
 *   - equipment.weight: absent on the 44 records the SRD lists with no weight
 *     cell — the items with a "—" weight (Sling, gaming sets, and many
 *     adventuring-gear/tack rows) plus the 7 packs, 8 mounts, and 6 waterborne
 *     vehicles (priced by speed/capacity, not weight).
 *   - hazard.{category,poisonType,price,trapType}: the `hazard` kind holds three
 *     gamemastering sub-families (loreweaver-6ra). The 8 traps carry `trapType`;
 *     the 3 diseases + 14 poisons carry `category` ('disease'/'poison'); the 14
 *     poisons additionally carry `poisonType` and `price`. Every hazard record
 *     still carries the required `description`.
 *   - magic-item.attunementRequirement: only the 26 items whose category line
 *     restricts attunement by class, ancestry, alignment, or spellcasting carry
 *     this text; all 240 records still carry the boolean `requiresAttunement`.
 *   - magic-item.variants: only Figurine of Wondrous Power carries the nine
 *     named figurine variants.
 *   - stat-block.{traits,actions}: Avatar of Death carries both; Giant Fly is
 *     the abbreviated no-action block.
 *   - spell.componentMaterials: only spells with a material (M) component.
 *   - spell.higherLevels: only spells with an "At Higher Levels" entry.
 *   - spell.ritual: only spells tagged as rituals.
 * The audit reports `0 < missingCount < totalInKind` per field; we pin the
 * compact {kind, field, missingCount, totalInKind} projection so a new
 * partially-populated field (a real drift signal) fails the test, while the
 * long `affectedKeys` lists stay out of the baseline to keep it maintainable.
 */
const EXPECTED_PARTIAL_FIELDS: ReadonlyArray<{
  readonly kind: string;
  readonly field: string;
  readonly missingCount: number;
  readonly totalInKind: number;
}> = [
  { kind: 'ancestry', field: 'subraceOf', missingCount: 9, totalInKind: 13 },
  { kind: 'ancestry', field: 'subraces', missingCount: 9, totalInKind: 13 },
  // Class options modeling (eshyra-4a7.6). progression / progressionTableRef /
  // features / skillChoices / startingEquipment are on all 12 classes
  // (missingCount 0, not listed). Only these vary:
  //   - proficiencyNotes: only the Druid lifts a restriction (metal armor).
  //   - toolProficiencies: present except the Bard/Monk, whose Tools line is a
  //     pure CHOICE, so they carry toolProficiencyChoices instead.
  {
    kind: 'class',
    field: 'proficiencyNotes',
    missingCount: 11,
    totalInKind: 12,
  },
  {
    kind: 'class',
    field: 'toolProficiencies',
    missingCount: 2,
    totalInKind: 12,
  },
  {
    kind: 'class',
    field: 'toolProficiencyChoices',
    missingCount: 10,
    totalInKind: 12,
  },
  { kind: 'condition', field: 'effects', missingCount: 1, totalInKind: 15 },
  { kind: 'condition', field: 'levels', missingCount: 14, totalInKind: 15 },
  // Creature fields, alphabetical within the kind (matching
  // `summarizeMissingFields`' `[...fieldUnion].sort()`), ordered after
  // `condition` because auditPack sorts the summary by kind:
  //   - category: only the 21 Appendix MM-B NPCs carry data.category='npc';
  //     monsters omit it (loreweaver-bn0).
  //   - keyed defensive/sense fields (eshyra-ez6v): emitted only when the SRD
  //     prints that label. `senses`/`languages` are NOT listed — every one of the
  //     317 stat blocks prints them (missingCount 0).
  //   - narrative sections traits/actions/reactions/legendaryActions
  //     (eshyra-yevt): emitted only when the creature prints that section
  //     (3 have no Actions; 55 no traits; 305 no reactions; 287 no legendary).
  { kind: 'creature', field: 'actions', missingCount: 3, totalInKind: 317 },
  { kind: 'creature', field: 'category', missingCount: 296, totalInKind: 317 },
  {
    kind: 'creature',
    field: 'conditionImmunities',
    missingCount: 229,
    totalInKind: 317,
  },
  {
    kind: 'creature',
    field: 'damageImmunities',
    missingCount: 191,
    totalInKind: 317,
  },
  {
    kind: 'creature',
    field: 'damageResistances',
    missingCount: 253,
    totalInKind: 317,
  },
  {
    kind: 'creature',
    field: 'damageVulnerabilities',
    missingCount: 302,
    totalInKind: 317,
  },
  {
    kind: 'creature',
    field: 'legendaryActions',
    missingCount: 287,
    totalInKind: 317,
  },
  {
    kind: 'creature',
    field: 'reactions',
    missingCount: 305,
    totalInKind: 317,
  },
  {
    kind: 'creature',
    field: 'savingThrows',
    missingCount: 225,
    totalInKind: 317,
  },
  { kind: 'creature', field: 'skills', missingCount: 129, totalInKind: 317 },
  { kind: 'creature', field: 'traits', missingCount: 55, totalInKind: 317 },
  { kind: 'creature', field: 'variants', missingCount: 315, totalInKind: 317 },
  { kind: 'equipment', field: 'ac', missingCount: 205, totalInKind: 218 },
  {
    kind: 'equipment',
    field: 'armorType',
    missingCount: 205,
    totalInKind: 218,
  },
  { kind: 'equipment', field: 'capacity', missingCount: 205, totalInKind: 218 },
  {
    kind: 'equipment',
    field: 'carryingCapacity',
    missingCount: 210,
    totalInKind: 218,
  },
  {
    kind: 'equipment',
    field: 'damageDie',
    missingCount: 182,
    totalInKind: 218,
  },
  {
    kind: 'equipment',
    field: 'damageType',
    missingCount: 182,
    totalInKind: 218,
  },
  {
    kind: 'equipment',
    field: 'description',
    missingCount: 211,
    totalInKind: 218,
  },
  {
    kind: 'equipment',
    field: 'properties',
    missingCount: 181,
    totalInKind: 218,
  },
  { kind: 'equipment', field: 'speed', missingCount: 204, totalInKind: 218 },
  {
    kind: 'equipment',
    field: 'stealthDisadvantage',
    missingCount: 205,
    totalInKind: 218,
  },
  {
    kind: 'equipment',
    field: 'strengthRequirement',
    missingCount: 215,
    totalInKind: 218,
  },
  { kind: 'equipment', field: 'weight', missingCount: 44, totalInKind: 218 },
  // Only the two feature-owned class tables carry tableRefs (eshyra-4a7.6):
  // feature:cleric:destroy-undead -> table:destroy-undead and
  // feature:druid:wild-shape -> table:beast-shapes; the other 181 features
  // have no owned table.
  { kind: 'feature', field: 'tableRefs', missingCount: 181, totalInKind: 183 },
  // hazard sub-families (loreweaver-6ra): of the 25 hazard records, the 8 traps
  // carry `trapType`; the 3 diseases + 14 poisons carry `category`; the 14
  // poisons additionally carry `poisonType` and `price`.
  { kind: 'hazard', field: 'category', missingCount: 8, totalInKind: 25 },
  { kind: 'hazard', field: 'poisonType', missingCount: 11, totalInKind: 25 },
  { kind: 'hazard', field: 'price', missingCount: 11, totalInKind: 25 },
  { kind: 'hazard', field: 'trapType', missingCount: 17, totalInKind: 25 },
  {
    kind: 'magic-item',
    field: 'attunementRequirement',
    missingCount: 214,
    totalInKind: 240,
  },
  // Deck of Many Things and Figurine of Wondrous Power reference their inline
  // stat blocks; the other 238 magic items have none.
  {
    kind: 'magic-item',
    field: 'statBlockRefs',
    missingCount: 238,
    totalInKind: 240,
  },
  {
    kind: 'magic-item',
    field: 'variants',
    missingCount: 239,
    totalInKind: 240,
  },
  {
    kind: 'spell',
    field: 'componentMaterials',
    missingCount: 135,
    totalInKind: 319,
  },
  { kind: 'spell', field: 'higherLevels', missingCount: 227, totalInKind: 319 },
  { kind: 'spell', field: 'ritual', missingCount: 290, totalInKind: 319 },
  // Seven spells own the nine embedded spell-description tables (eshyra-o4j7);
  // Control Weather owns three, while the other six own one each.
  {
    kind: 'spell',
    field: 'tableRefs',
    missingCount: 312,
    totalInKind: 319,
  },
  // The 2 inline stat blocks (eshyra-4a7.4) carry different optional keyed
  // fields: Avatar of Death has damage/condition immunities and a "—"
  // challengeRating with 0 XP; Giant Fly (abbreviated) has neither. senses and
  // languages are present on both, so they are not partial.
  {
    kind: 'stat-block',
    field: 'actions',
    missingCount: 1,
    totalInKind: 2,
  },
  {
    kind: 'stat-block',
    field: 'challengeRating',
    missingCount: 1,
    totalInKind: 2,
  },
  {
    kind: 'stat-block',
    field: 'conditionImmunities',
    missingCount: 1,
    totalInKind: 2,
  },
  {
    kind: 'stat-block',
    field: 'damageImmunities',
    missingCount: 1,
    totalInKind: 2,
  },
  {
    kind: 'stat-block',
    field: 'experiencePoints',
    missingCount: 1,
    totalInKind: 2,
  },
  {
    kind: 'stat-block',
    field: 'traits',
    missingCount: 1,
    totalInKind: 2,
  },
  // Only Oath of Devotion carries the named `sections` array (eshyra-citg):
  // its "Tenets of Devotion" sub-subsection prose. All other 11 subclasses
  // have no named prose sections beyond the intro description.
  {
    kind: 'subclass',
    field: 'sections',
    missingCount: 11,
    totalInKind: 12,
  },
  // Only the four subclasses with spell tables carry spellTableRefs
  // (eshyra-4a7.6): Life Domain, Circle of the Land, Oath of Devotion, and the
  // Fiend. The `features` reference list is on all 12 subclasses (missingCount
  // 0, not listed).
  {
    kind: 'subclass',
    field: 'spellTableRefs',
    missingCount: 8,
    totalInKind: 12,
  },
];

// `<kind>:<kebab-slug>` with one or more colon-separated slug segments. Kinds
// may be hyphenated (`magic-item:adamantine-armor`); class/subclass-scoped
// features namespace the slug (`feature:bard:ability-score-improvement`).
const KEY_PATTERN = /^[a-z][a-z0-9-]*(?::[a-z0-9][a-z0-9-]*)+$/;

/**
 * PDF hyphen-cluster artifacts that must NOT survive into the durable pack.
 * The SRD 5.1 PDF font renders every word-internal hyphen as an ASCII hyphen
 * wrapped in invisible presentation hyphens (U+00AD SOFT HYPHEN, U+2010 HYPHEN,
 * U+2011 NON-BREAKING HYPHEN). The extractor collapses those clusters to a lone
 * ASCII hyphen (`normalizePdfHyphenCluster` in the importer's `extract.ts`), so
 * a regenerated canonical pack must contain none of these code points
 * (loreweaver-6uy). The class is written with explicit `\uXXXX` escapes so this
 * test source embeds no invisible characters; en-dash (U+2013) and em-dash
 * (U+2014) are legitimate SRD punctuation and intentionally excluded.
 */
const FORBIDDEN_HYPHEN_CODE_POINTS: ReadonlyArray<{
  readonly name: string;
  readonly codePoint: number;
}> = [
  { name: 'U+00AD SOFT HYPHEN', codePoint: 0x00ad },
  { name: 'U+2010 HYPHEN', codePoint: 0x2010 },
  { name: 'U+2011 NON-BREAKING HYPHEN', codePoint: 0x2011 },
];

describe('D&D 5e SRD 5.1 committed pack', () => {
  const pack = loadRulesPackFromDirectory(PACK_DIR);

  describe('schema validity', () => {
    it('loads and re-validates without error', () => {
      // `loadRulesPackFromDirectory` already ran validateRulesPack; re-running
      // on the loaded object asserts the in-memory pack is still well-formed
      // (no shared mutation introduced by an upstream helper).
      expect(() => validateRulesPack(pack)).not.toThrow();
    });

    it('declares the canonical packId for D&D 5e SRD 5.1', () => {
      expect(pack.meta.packId).toBe('rules:dnd5e-srd-5.1');
      expect(pack.meta.systemId).toBe('dnd5e-srd');
      expect(pack.meta.version).toBe('5.1');
      expect(pack.meta.role).toBe('base');
    });
  });

  describe('category counts', () => {
    it('per-kind counts exactly match the documented baseline', () => {
      const audit = auditPack(pack);
      expect(audit.countsByKind).toEqual(EXPECTED_COUNTS_BY_KIND);
    });

    it('total record count matches the sum of per-kind counts', () => {
      const expectedTotal = Object.values(EXPECTED_COUNTS_BY_KIND).reduce(
        (sum, n) => sum + n,
        0,
      );
      expect(pack.records).toHaveLength(expectedTotal);
    });
  });

  describe('record keys', () => {
    it('every key matches the `<kind>:<kebab-slug>` shape', () => {
      for (const record of pack.records) {
        expect(record.key).toMatch(KEY_PATTERN);
      }
    });

    it('every key begins with its own record kind as the prefix', () => {
      for (const record of pack.records) {
        const [prefix] = record.key.split(':');
        expect(prefix).toBe(record.kind);
      }
    });

    it('all keys are unique within the pack', () => {
      const keys = pack.records.map((record) => record.key);
      expect(new Set(keys).size).toBe(keys.length);
    });

    it('contains the documented set of stable spot-check keys', () => {
      const keys = new Set(pack.records.map((record) => record.key));
      for (const expected of EXPECTED_STABLE_KEYS) {
        expect(keys.has(expected)).toBe(true);
      }
    });
  });

  describe('subclass-granted feature regression (loreweaver-fak)', () => {
    const features = pack.records.filter((record) => record.kind === 'feature');

    function featureProjection(source: string) {
      return features
        .filter(
          (record) => (record.data as { source?: unknown }).source === source,
        )
        .map((record) => ({
          name: record.name,
          level: (record.data as { level?: unknown }).level,
        }))
        .sort((a, b) => a.name.localeCompare(b.name));
    }

    it('keeps the exact reviewed feature count for every SRD subclass', () => {
      const counts = new Map<string, number>();
      for (const record of features) {
        const source = (record.data as { source?: unknown }).source;
        if (typeof source === 'string' && source.startsWith('subclass:')) {
          counts.set(source, (counts.get(source) ?? 0) + 1);
        }
      }

      // eshyra-0m9.13 recovered subclass features whose headings/lead-ins the
      // boundary detector previously missed (see the feature-count note above):
      //   circle-of-the-land 2 -> 6 (+Circle Spells, Land's Stride, Nature's
      //     Ward, Nature's Sanctuary) = the full SRD set (Bonus Cantrip, Natural
      //     Recovery, Circle Spells, Land's Stride, Nature's Ward, Nature's
      //     Sanctuary);
      //   college-of-lore 2 -> 4 (+Cutting Words in 0m9.13; +Bonus Proficiencies
      //     in eshyra-tzl via the now-recognized "When you join … at 3rd level"
      //     lead-in) = the full SRD set;
      //   draconic-bloodline 4 -> 5 (+Draconic Resilience);
      //   hunter 2 -> 4 (+Hunter's Prey, Superior Hunter's Defense);
      //   life-domain 4 -> 6 (+Disciple of Life, Channel Divinity: Preserve
      //     Life) = the full SRD set;
      //   the-fiend 2 -> 4 (+Dark One's Blessing, Dark One's Own Luck) = full set;
      //   thief 3 -> 5 (+Use Magic Device, Thief's Reflexes) = full set.
      // oath-of-devotion 3 -> 4 (eshyra-tzl): its 3rd-level "Channel Divinity"
      // feature (Sacred Weapon + Turn the Unholy options) now emits via the
      // now-recognized "When you take this oath at 3rd level" lead-in, consistent
      // with the Cleric/Life Domain Channel Divinity feature precedent. The
      // subclass:oath-of-devotion blurb (parseSubclasses) is unchanged.
      expect(Object.fromEntries([...counts.entries()].sort())).toEqual({
        'subclass:champion': 5,
        'subclass:circle-of-the-land': 6,
        'subclass:college-of-lore': 4,
        'subclass:draconic-bloodline': 5,
        'subclass:hunter': 4,
        'subclass:life-domain': 6,
        'subclass:oath-of-devotion': 4,
        'subclass:path-of-the-berserker': 4,
        'subclass:school-of-evocation': 5,
        'subclass:the-fiend': 4,
        'subclass:thief': 5,
        'subclass:way-of-the-open-hand': 4,
      });
    });

    it('attributes Oath of Devotion features to the subclass at correct levels', () => {
      // Channel Divinity (3rd) recovered in eshyra-tzl; projection is sorted by
      // name, so it sits first.
      expect(featureProjection('subclass:oath-of-devotion')).toEqual([
        { name: 'Aura of Devotion', level: 7 },
        { name: 'Channel Divinity', level: 3 },
        { name: 'Holy Nimbus', level: 20 },
        { name: 'Purity of Spirit', level: 15 },
      ]);

      const oathFeatureNames = new Set([
        'Aura of Devotion',
        'Channel Divinity',
        'Holy Nimbus',
        'Purity of Spirit',
      ]);
      expect(
        features.filter(
          (record) =>
            (record.data as { source?: unknown }).source === 'class:paladin' &&
            oathFeatureNames.has(record.name),
        ),
      ).toEqual([]);
    });

    it('emits every Path of the Berserker feature at its grant level', () => {
      expect(featureProjection('subclass:path-of-the-berserker')).toEqual([
        { name: 'Frenzy', level: 3 },
        { name: 'Intimidating Presence', level: 10 },
        { name: 'Mindless Rage', level: 6 },
        { name: 'Retaliation', level: 14 },
      ]);
    });

    it('emits the complete SRD Barbarian base-class feature set at their grant levels (eshyra-7tc, eshyra-ai9)', () => {
      // The Classes slice begins after the sliced-away "Barbarian" chapter
      // heading; parseFeatures' implicit Barbarian class context recovers the
      // base features (previously dropped entirely). Unarmored Defense (1st) is
      // recovered by the eshyra-ai9 row-stitching fix that strips the Barbarian
      // table's trailing Rages/Rage Damage numeric columns before reuniting the
      // wrapped feature cell, so it is its own record rather than swallowed into
      // Rage. This is the full 14-feature SRD 5.1 Barbarian base set.
      expect(featureProjection('class:barbarian')).toEqual([
        { name: 'Ability Score Improvement', level: 4 },
        { name: 'Brutal Critical', level: 9 },
        { name: 'Danger Sense', level: 2 },
        { name: 'Extra Attack', level: 5 },
        { name: 'Fast Movement', level: 5 },
        { name: 'Feral Instinct', level: 7 },
        { name: 'Indomitable Might', level: 18 },
        { name: 'Persistent Rage', level: 15 },
        { name: 'Primal Champion', level: 20 },
        { name: 'Primal Path', level: 3 },
        { name: 'Rage', level: 1 },
        { name: 'Reckless Attack', level: 2 },
        { name: 'Relentless Rage', level: 11 },
        { name: 'Unarmored Defense', level: 1 },
      ]);
    });

    it('bounds the Oath of Devotion description to its overview (eshyra-4a7.2)', () => {
      // Before eshyra-4a7.2 the subclass description ran past the Oath Spells
      // table to swallow the Aura of Devotion / Purity of Spirit / Holy Nimbus
      // feature bodies. The bounded-span parser now stops at the first non-section
      // feature heading, so the blurb is just the archetype overview and the
      // features live only in their own `feature:oath-of-devotion:*` records. The
      // body-font "Paladin" spell-table cell (h≈8.9) is still not mistaken for
      // the parent-class heading (the original loreweaver-fak concern).
      const oath = pack.records.find(
        (record) => record.key === 'subclass:oath-of-devotion',
      );
      const data = oath?.data as {
        description?: unknown;
        sections?: unknown;
        spellTableRefs?: unknown;
      };
      expect(typeof data.description).toBe('string');
      expect(data.description).toContain(
        'binds a paladin to the loftiest ideals',
      );
      expect(data.description).not.toContain('Oath of Devotion Spells');
      expect(data.description).not.toContain('Aura of Devotion');
      expect(data.description).not.toContain('Holy Nimbus');
    });

    it('represents Tenets of Devotion as a named section on subclass:oath-of-devotion (eshyra-citg)', () => {
      const oath = pack.records.find(
        (record) => record.key === 'subclass:oath-of-devotion',
      );
      const data = oath?.data as {
        sections?: Array<{ name: string; text: string }>;
        spellTableRefs?: string[];
      };
      expect(Array.isArray(data.sections)).toBe(true);
      expect(data.sections).toHaveLength(1);
      expect(data.sections?.[0].name).toBe('Tenets of Devotion');
      const tenetsText = data.sections?.[0].text ?? '';
      expect(tenetsText).toContain('Honesty');
      expect(tenetsText).toContain('Courage');
      expect(tenetsText).toContain('Compassion');
      expect(tenetsText).toContain('Honor');
      expect(tenetsText).toContain('Duty');
      // Spell table rows are not duplicated into sections
      expect(tenetsText).not.toContain('protection from evil and good');
    });

    it('subclass:oath-of-devotion spellTableRefs still includes the spell table (eshyra-4a7.6)', () => {
      const oath = pack.records.find(
        (record) => record.key === 'subclass:oath-of-devotion',
      );
      const spellTableRefs = (oath?.data as { spellTableRefs?: unknown })
        .spellTableRefs;
      expect(Array.isArray(spellTableRefs)).toBe(true);
      expect(spellTableRefs).toContain('table:oath-of-devotion-spells');
    });
  });

  // eshyra-0m9.13 feature-boundary regression on the committed pack. The
  // extraction-layer band fix removed the class proficiency setup block from
  // every class first feature, and the parser-layer heading/lead-in fix split
  // out subclass/class features that the previous detector swallowed into the
  // preceding feature's body. These assertions pin both ends against the
  // committed pack so the corruption cannot return.
  describe('feature boundary regression (eshyra-0m9.13)', () => {
    const features = pack.records.filter((record) => record.kind === 'feature');
    const byKey = new Map(features.map((record) => [record.key, record]));
    const descOf = (key: string): string => {
      const record = byKey.get(key);
      expect(record, `expected ${key} in the committed pack`).toBeDefined();
      const description = (record?.data as { description?: unknown })
        .description;
      expect(typeof description).toBe('string');
      return description as string;
    };
    const levelOf = (key: string): unknown =>
      (byKey.get(key)?.data as { level?: unknown }).level;

    const SETUP_LABEL = /\b(?:Armor|Weapons|Tools|Saving Throws|Skills):/;

    // The 8 class first features that previously absorbed the proficiency setup
    // block via the two-column-table reading-order bug.
    const FIRST_FEATURE_KEYS: readonly string[] = [
      'feature:bard:spellcasting',
      'feature:cleric:spellcasting',
      'feature:druid:druidic',
      'feature:monk:martial-arts',
      'feature:paladin:divine-sense',
      'feature:ranger:favored-enemy',
      'feature:warlock:otherworldly-patron',
      'feature:wizard:cantrips',
    ];

    it('no class first feature carries the proficiency setup block', () => {
      for (const key of FIRST_FEATURE_KEYS) {
        expect(
          SETUP_LABEL.test(descOf(key)),
          `${key} carries a setup label`,
        ).toBe(false);
      }
    });

    it('the structure audit reports zero feature setup-label bleed', () => {
      const bleed = auditSrdStructure(pack).filter(
        (finding) => finding.category === 'feature-setup-label-bleed',
      );
      expect(bleed).toEqual([]);
    });

    it('completes the Bard Spellcasting body past its displaced continuation', () => {
      const body = descOf('feature:bard:spellcasting');
      // The intro continuation ("Your spells are part …") and the subsequent
      // spellcasting subsections were displaced past the table pre-fix.
      expect(body).toContain('Your spells are part of your vast repertoire');
      expect(body).toContain('Spell Slots');
    });

    // Previously-swallowed headings now stand as their own records at their SRD
    // grant levels (curly apostrophe, colon, and "Also"/"By"/enumerated lead-ins).
    const RECOVERED: ReadonlyArray<readonly [key: string, level: number]> = [
      ['feature:life-domain:disciple-of-life', 1],
      ['feature:life-domain:channel-divinity-preserve-life', 2],
      ['feature:hunter:hunters-prey', 3],
      ['feature:hunter:superior-hunters-defense', 15],
      ['feature:circle-of-the-land:circle-spells', 3],
      ['feature:circle-of-the-land:lands-stride', 6],
      ['feature:circle-of-the-land:natures-ward', 10],
      ['feature:circle-of-the-land:natures-sanctuary', 14],
      ['feature:thief:use-magic-device', 13],
      ['feature:thief:thiefs-reflexes', 17],
      ['feature:rogue:reliable-talent', 11],
      ['feature:rogue:slippery-mind', 15],
      ['feature:ranger:lands-stride', 8],
      ['feature:college-of-lore:cutting-words', 3],
      ['feature:draconic-bloodline:draconic-resilience', 1],
      ['feature:the-fiend:dark-ones-blessing', 1],
      ['feature:the-fiend:dark-ones-own-luck', 6],
    ];

    it('emits each recovered swallowed feature at its SRD grant level', () => {
      for (const [key, level] of RECOVERED) {
        expect(byKey.has(key), `expected ${key} in the committed pack`).toBe(
          true,
        );
        expect(levelOf(key), `${key} grant level`).toBe(level);
      }
    });

    it('the previously-swallowing feature no longer absorbs the recovered headings', () => {
      expect(descOf('feature:life-domain:bonus-proficiency')).not.toMatch(
        /Disciple of Life|Preserve Life/,
      );
      expect(descOf('feature:hunter:multiattack')).not.toMatch(
        /Superior Hunter’s Defense/,
      );
      expect(descOf('feature:circle-of-the-land:natural-recovery')).not.toMatch(
        /Land’s Stride|Nature’s Ward|Nature’s Sanctuary/,
      );
      expect(descOf('feature:thief:supreme-sneak')).not.toMatch(
        /Use Magic Device|Thief’s Reflexes/,
      );
    });
  });

  // eshyra-0m9.14 progression-table row-stitching regression on the committed
  // pack. SRD class tables wrap a feature cell across two extracted lines when
  // the text exceeds its column width; stitching the continuation back onto its
  // row before feature detection fixes two failure modes: a repeated feature
  // losing its earliest grant level / canonical name to a later un-wrapped row,
  // and a wrapped first/only-grant cell being truncated so the feature gets
  // swallowed into the preceding feature's body. These assertions pin the
  // committed pack so the corruption cannot return.
  describe('progression-table row-stitching regression (eshyra-0m9.14)', () => {
    const features = pack.records.filter((record) => record.kind === 'feature');
    const byKey = new Map(features.map((record) => [record.key, record]));
    const levelOf = (key: string): unknown =>
      (byKey.get(key)?.data as { level?: unknown }).level;
    const descOf = (key: string): string =>
      (byKey.get(key)?.data as { description?: unknown }).description as string;

    it('emits Fighter Indomitable under its canonical heading at its earliest grant', () => {
      expect(byKey.has('feature:fighter:indomitable')).toBe(true);
      expect(byKey.get('feature:fighter:indomitable')?.name).toBe(
        'Indomitable',
      );
      expect(levelOf('feature:fighter:indomitable')).toBe(9);
      // The bogus key built from the wrapped 17th-level "(three uses)" cell is gone.
      expect(byKey.has('feature:fighter:indomitable-three-uses')).toBe(false);
      // No feature name carries a repeated-use progression parenthetical.
      expect(
        features.some((record) =>
          /\((?:one|two|three) uses?\)/.test(record.name),
        ),
      ).toBe(false);
      // The usage progression stays in the body.
      expect(descOf('feature:fighter:indomitable')).toMatch(
        /twice between long rests/,
      );
    });

    it('takes the earliest (wrapped) grant level for repeated class features', () => {
      // Druid/Bard ASI/Magical Secrets first grants wrap across two lines; the
      // un-wrapped later rows must no longer win the level.
      expect(levelOf('feature:druid:ability-score-improvement')).toBe(4);
      expect(levelOf('feature:bard:magical-secrets')).toBe(10);
    });

    it('emits the base-class features whose only grant cell wrapped', () => {
      // Previously truncated to "Sorcerous"/"Pact" and swallowed into the
      // preceding feature; stitching completes the cell so they stand alone.
      expect(byKey.has('feature:sorcerer:sorcerous-origin')).toBe(true);
      expect(levelOf('feature:sorcerer:sorcerous-origin')).toBe(1);
      expect(byKey.has('feature:warlock:pact-magic')).toBe(true);
      expect(levelOf('feature:warlock:pact-magic')).toBe(1);
    });

    it('the preceding feature no longer absorbs the recovered base-class headings', () => {
      expect(descOf('feature:sorcerer:cantrips')).not.toMatch(
        /Sorcerous Origin/,
      );
      expect(descOf('feature:warlock:otherworldly-patron')).not.toMatch(
        /Pact Magic/,
      );
    });
  });

  // eshyra-tzl: subclass features whose grant level is stated by a subclass-
  // entry lead-in the parser previously did not recognize ("When you join …",
  // "When you take this oath …") are now emitted at their 3rd-level grant, and
  // the structure audit no longer false-positives on the "Spells Known of 1st
  // Level and Higher" spellcasting sub-heading.
  describe('subclass-entry lead-in recovery + audit refinement (eshyra-tzl)', () => {
    const features = pack.records.filter((record) => record.kind === 'feature');
    const byKey = new Map(features.map((record) => [record.key, record]));
    const levelOf = (key: string): unknown =>
      (byKey.get(key)?.data as { level?: unknown }).level;
    const descOf = (key: string): string =>
      (byKey.get(key)?.data as { description?: unknown }).description as string;

    it('emits College of Lore Bonus Proficiencies at its 3rd-level entry grant', () => {
      expect(byKey.has('feature:college-of-lore:bonus-proficiencies')).toBe(
        true,
      );
      expect(levelOf('feature:college-of-lore:bonus-proficiencies')).toBe(3);
    });

    it('emits Oath of Devotion Channel Divinity at level 3 with both options in the body', () => {
      expect(byKey.has('feature:oath-of-devotion:channel-divinity')).toBe(true);
      expect(levelOf('feature:oath-of-devotion:channel-divinity')).toBe(3);
      const body = descOf('feature:oath-of-devotion:channel-divinity');
      expect(body).toMatch(/Sacred Weapon/);
      expect(body).toMatch(/Turn the Unholy/);
    });

    it('the structure audit no longer flags the Pact Magic spellcasting sub-heading', () => {
      const finding = auditSrdStructure(pack).find(
        (f) =>
          f.category === 'swallowed-feature-heading' &&
          f.key === 'feature:warlock:pact-magic',
      );
      expect(finding).toBeUndefined();
    });
  });

  // eshyra-0m9.15: ancestry trait line-wrapping and table bleed. The SRD PDF
  // wraps the Languages line so "Common and <Language>. <prose>" lands on its
  // own line, and interleaves the Dragonborn Draconic Ancestry breath-weapon
  // table between the Speed and Draconic Ancestry traits. Pre-fix this promoted
  // wrapped continuations to bogus traits ("Common and Dwarvish", "Ancestry
  // table") and bled the table into the Speed trait body. These assertions pin
  // the committed pack so the corruption cannot return.
  describe('ancestry trait wrapping + table bleed regression (eshyra-0m9.15)', () => {
    const ancestries = pack.records.filter(
      (record) => record.kind === 'ancestry',
    );
    const traitsOf = (
      record: (typeof ancestries)[number],
    ): ReadonlyArray<{ name: string; text: string }> =>
      ((record.data as { traits?: unknown }).traits ?? []) as ReadonlyArray<{
        name: string;
        text: string;
      }>;

    it('the structure audit reports zero ancestry-bogus-trait findings', () => {
      const bogus = auditSrdStructure(pack).filter(
        (finding) => finding.category === 'ancestry-bogus-trait',
      );
      expect(bogus).toEqual([]);
    });

    it('no ancestry trait name is a wrapped Languages/table line fragment', () => {
      for (const record of ancestries) {
        for (const trait of traitsOf(record)) {
          expect(
            /\b(?:and|or|the|of|table)\b/.test(trait.name),
            `${record.key} trait "${trait.name}" is a wrapped fragment`,
          ).toBe(false);
        }
      }
    });

    it('every Languages trait body is complete (carries its languages + prose)', () => {
      for (const record of ancestries) {
        const languages = traitsOf(record).filter(
          (t) => t.name === 'Languages',
        );
        // Each ancestry has exactly one Languages trait, not a truncated stub
        // plus a bogus "Common and …" continuation.
        expect(languages).toHaveLength(1);
        expect(languages[0].text).toMatch(/You can speak, read, and write \w/);
        // A truncated body ended exactly at "…and write"; a complete one names
        // Common and ends with sentence punctuation.
        expect(languages[0].text).toMatch(/Common/);
        expect(languages[0].text.trim()).toMatch(/[.!?]$/);
      }
    });

    it('the Dragonborn Speed trait is free of the breath-weapon table', () => {
      const dragonborn = ancestries.find((r) => r.name === 'Dragonborn');
      const speed = traitsOf(dragonborn as (typeof ancestries)[number]).find(
        (t) => t.name === 'Speed',
      );
      expect(speed?.text).toBe('Your base walking speed is 30 feet.');
      expect(speed?.text).not.toMatch(/save\)/);
      expect(speed?.text).not.toMatch(/Damage Type/);
    });
  });

  // eshyra-4a7.7: ancestry option-table linkage. The Dragonborn "Draconic
  // Ancestry" trait chooses from a printed option table; that table is emitted
  // as `table:draconic-ancestry` (eshyra-4a7.3) and the trait must carry a
  // structured `tableRefs` link to it so the dragon-type -> damage/breath
  // options are reachable from the ancestry, not only from prose.
  describe('ancestry option-table linkage (eshyra-4a7.7)', () => {
    const ancestries = pack.records.filter((r) => r.kind === 'ancestry');
    const traitsOf = (
      record: (typeof ancestries)[number],
    ): ReadonlyArray<{
      name: string;
      text: string;
      tableRefs?: readonly string[];
    }> =>
      ((record.data as { traits?: unknown }).traits ?? []) as ReadonlyArray<{
        name: string;
        text: string;
        tableRefs?: readonly string[];
      }>;
    const TABLE_REFERENCE =
      /\bthe\s+[A-Z][\w'’/()&-]*(?:\s+[A-Z][\w'’/()&-]*)*\s+table\b/;

    it('links the Dragonborn Draconic Ancestry trait to its option table', () => {
      const dragonborn = ancestries.find((r) => r.name === 'Dragonborn');
      const trait = traitsOf(dragonborn as (typeof ancestries)[number]).find(
        (t) => t.name === 'Draconic Ancestry',
      );
      expect(trait?.tableRefs).toEqual(['table:draconic-ancestry']);
      // The linked table actually exists in the pack and carries the option
      // rows (dragon type -> damage type + breath weapon), so the reference is
      // resolvable to usable structured data.
      const linked = pack.records.find(
        (r) => r.key === 'table:draconic-ancestry',
      );
      expect(linked?.kind).toBe('table');
      expect((linked?.data as { rows: unknown[] }).rows).toHaveLength(10);
    });

    it('every ancestry trait that names an option table carries a tableRefs link', () => {
      // The structural invariant for this bead: no ancestry source table is
      // referenced only by prose without a structured mapping.
      for (const record of ancestries) {
        for (const trait of traitsOf(record)) {
          if (!TABLE_REFERENCE.test(trait.text)) continue;
          expect(
            (trait.tableRefs ?? []).length,
            `${record.key} trait "${trait.name}" references an option table in prose but has no tableRefs link`,
          ).toBeGreaterThan(0);
        }
      }
    });

    it('the structure audit reports zero ancestry-unlinked-table findings', () => {
      const unlinked = auditSrdStructure(pack).filter(
        (finding) => finding.category === 'ancestry-unlinked-table',
      );
      expect(unlinked).toEqual([]);
    });
  });

  // `EXPECTED_SRD_5_1_CREATURE_NAMES` (loreweaver-0m9.5.14) is a reviewed,
  // checked-in baseline — a candidate generated from the vendored PDF, reviewed
  // against the SRD source, then committed (see its doc comment and
  // `npm run generate:dnd5e-srd-creature-names`). This test does NOT derive the
  // expected names at runtime: it compares the committed pack's creature record
  // names against that fixed baseline. Its purpose is regression protection —
  // not a standalone proof of SRD completeness. Once the reviewed baseline is
  // committed, a parser change that drops, adds, or renames a creature record
  // breaks this test until the baseline is regenerated, re-reviewed, and updated
  // in the same change.
  describe('creature name-set regression baseline (loreweaver-0m9.5.14)', () => {
    const creatureRecords = pack.records.filter(
      (record) => record.kind === 'creature',
    );
    // Monster vs NPC are distinguished by the data.category discriminator:
    // only Appendix MM-B NPC records carry category='npc' (loreweaver-bn0).
    const isNpc = (record: (typeof creatureRecords)[number]): boolean =>
      (record.data as { category?: unknown }).category === 'npc';
    const monsterNames = creatureRecords
      .filter((record) => !isNpc(record))
      .map((record) => record.name);
    const npcNames = creatureRecords
      .filter((record) => isNpc(record))
      .map((record) => record.name);

    it('committed pack monster-creature names match the checked-in baseline exactly', () => {
      expect([...monsterNames].sort()).toEqual(
        [...EXPECTED_SRD_5_1_CREATURE_NAMES].sort(),
      );
    });

    it('committed pack NPC-creature names match the checked-in baseline exactly', () => {
      expect([...npcNames].sort()).toEqual(
        [...EXPECTED_SRD_5_1_NPC_NAMES].sort(),
      );
    });

    it('EXPECTED_SRD_5_1_CREATURE_NAMES has no duplicates', () => {
      expect(new Set(EXPECTED_SRD_5_1_CREATURE_NAMES).size).toBe(
        EXPECTED_SRD_5_1_CREATURE_NAMES.length,
      );
    });

    it('EXPECTED_SRD_5_1_NPC_NAMES has no duplicates', () => {
      expect(new Set(EXPECTED_SRD_5_1_NPC_NAMES).size).toBe(
        EXPECTED_SRD_5_1_NPC_NAMES.length,
      );
    });

    it('no NPC name collides with a monster name (unique creature keyspace)', () => {
      const monsterSet = new Set(EXPECTED_SRD_5_1_CREATURE_NAMES);
      const collisions = EXPECTED_SRD_5_1_NPC_NAMES.filter((name) =>
        monsterSet.has(name),
      );
      expect(collisions).toEqual([]);
    });

    it('the monster + NPC baselines sum to the documented creature count', () => {
      // The monster name-set is the 296-creature baseline; the NPC name-set is
      // the 21 Appendix MM-B stat blocks. Together they are the `creature`
      // per-kind count (loreweaver-bn0).
      expect(EXPECTED_SRD_5_1_CREATURE_NAMES).toHaveLength(
        MIN_EXPECTED_SRD_5_1_CREATURES,
      );
      expect(
        EXPECTED_SRD_5_1_CREATURE_NAMES.length +
          EXPECTED_SRD_5_1_NPC_NAMES.length,
      ).toBe(EXPECTED_COUNTS_BY_KIND.creature);
    });
  });

  // loreweaver-ecr: Magic Items A-Z is a two-column section whose body text can
  // interleave item tables, bullets, and neighboring prose with item headings.
  // The importer pins the exact reviewed name set so table/prose text cannot be
  // silently promoted to a `magic-item` record, and recovered two-column ring /
  // staff entries cannot silently disappear.
  describe('magic-item name-set regression baseline (loreweaver-ecr)', () => {
    const magicItems = pack.records.filter(
      (record) => record.kind === 'magic-item',
    );

    function magicItemData(key: string): Record<string, unknown> {
      const record = magicItems.find((r) => r.key === key);
      expect(record, `expected ${key} in the committed pack`).toBeDefined();
      return record?.data as Record<string, unknown>;
    }

    function magicItemDescription(key: string): string {
      const data = magicItemData(key);
      expect(typeof data.description).toBe('string');
      return data.description as string;
    }

    it('committed pack magic-item names match the checked-in baseline exactly', () => {
      expect(magicItems.map((record) => record.name).sort()).toEqual(
        [...EXPECTED_SRD_5_1_MAGIC_ITEM_NAMES].sort(),
      );
    });

    it('EXPECTED_SRD_5_1_MAGIC_ITEM_NAMES has no duplicates', () => {
      expect(new Set(EXPECTED_SRD_5_1_MAGIC_ITEM_NAMES).size).toBe(
        EXPECTED_SRD_5_1_MAGIC_ITEM_NAMES.length,
      );
    });

    it('the magic-item baseline length matches the documented count', () => {
      expect(EXPECTED_SRD_5_1_MAGIC_ITEM_NAMES).toHaveLength(
        MIN_EXPECTED_SRD_5_1_MAGIC_ITEMS,
      );
      expect(EXPECTED_SRD_5_1_MAGIC_ITEM_NAMES.length).toBe(
        EXPECTED_COUNTS_BY_KIND['magic-item'],
      );
    });

    it('carries representative item type, rarity, attunement, and embedded table text', () => {
      expect(magicItemData('magic-item:adamantine-armor')).toMatchObject({
        itemType: 'Armor (medium or heavy, but not hide)',
        rarity: 'uncommon',
        requiresAttunement: false,
      });
      expect(magicItemData('magic-item:staff-of-power')).toMatchObject({
        itemType: 'Staff',
        rarity: 'very rare',
        requiresAttunement: true,
        attunementRequirement: 'by a sorcerer, warlock, or wizard',
      });
      const armorOfResistance = magicItemData('magic-item:armor-of-resistance');
      expect(armorOfResistance).toMatchObject({
        itemType: 'Armor (light, medium, or heavy)',
        rarity: 'rare',
        requiresAttunement: true,
      });
      expect(armorOfResistance.description).toContain('d10 Damage Type');
      expect(armorOfResistance.description).toContain('1 Acid 6 Necrotic');
    });

    it('emits Figurine of Wondrous Power with variants and Giant Fly linkage', () => {
      const figurine = magicItemData('magic-item:figurine-of-wondrous-power');
      expect(figurine).toMatchObject({
        itemType: 'Wondrous item',
        rarity: 'rarity by figurine',
        requiresAttunement: false,
        statBlockRefs: ['stat-block:giant-fly'],
      });
      const variants = figurine.variants as Array<Record<string, unknown>>;
      expect(variants).toHaveLength(9);
      expect(variants.map((variant) => variant.name)).toEqual([
        'Bronze Griffon',
        'Ebony Fly',
        'Golden Lions',
        'Ivory Goats',
        'Marble Elephant',
        'Obsidian Steed',
        'Onyx Dog',
        'Serpentine Owl',
        'Silver Raven',
      ]);
      expect(variants[1].text).not.toContain('Giant Fly');
      expect(magicItemDescription('magic-item:feather-token')).not.toContain(
        'Figurine of Wondrous Power',
      );
    });

    it('imports Orb of Dragonkind from the Artifacts subsection (eshyra-0m9.16)', () => {
      // The lone artifact magic item (SRD 5.1 p252-253) sits after the "Sentient
      // Magic Items" guidance that ends the A-Z slice, so it is parsed from its
      // own "Artifacts" slice and concatenated. Its category line is "Wondrous
      // item, artifact (requires attunement)".
      const orb = magicItemData('magic-item:orb-of-dragonkind');
      expect(orb).toMatchObject({
        itemType: 'Wondrous item',
        rarity: 'artifact',
        requiresAttunement: true,
      });
      const description = magicItemDescription('magic-item:orb-of-dragonkind');
      expect(description).toMatch(/^Ages past, elves and humans waged/);
      // Whole body captured, including the trailing sub-sections.
      expect(description).toContain('Call Dragons.');
      expect(description).toContain('sufficient to destroy an orb, however.');
      // The Monsters chapter that bounds the slice must not bleed in.
      expect(description).not.toContain('stat block');
      const orbRecord = magicItems.find(
        (record) => record.key === 'magic-item:orb-of-dragonkind',
      );
      expect(orbRecord?.source).toBe('SRD 5.1 p. 252');
    });

    it('keeps page 226 magic-item bodies in source column order', () => {
      expect(magicItemDescription('magic-item:holy-avenger')).toContain(
        'the radius of the aura increases to 30 feet',
      );

      const blasting = magicItemDescription('magic-item:horn-of-blasting');
      expect(blasting).toMatch(/^You can use an action to speak/);
      expect(blasting).toContain('causing the horn to explode');
      expect(blasting).not.toContain('horseshoes');

      expect(magicItemData('magic-item:horn-of-valhalla')).toMatchObject({
        rarity:
          'rare (silver or brass), very rare (bronze), or legendary (iron)',
      });
      const valhalla = magicItemDescription('magic-item:horn-of-valhalla');
      expect(valhalla).toContain('d100 Horn Berserkers Requirement');
      expect(valhalla).toContain('Proficiency with all martial weapons');
      expect(valhalla).not.toContain('Immovable Rod');

      const zephyr = magicItemDescription('magic-item:horseshoes-of-a-zephyr');
      expect(zephyr).toMatch(/^These iron horseshoes come in a set of four/);
      expect(zephyr).toContain('floating 4 inches above the ground');
      expect(zephyr).not.toContain('radius of the aura');

      const speed = magicItemDescription('magic-item:horseshoes-of-speed');
      expect(speed).toContain(
        'increase the creature’s walking speed by 30 feet',
      );
      expect(speed).not.toContain('thunder damage');

      const rod = magicItemDescription('magic-item:immovable-rod');
      expect(rod).toContain('magically fixed in place');
      expect(rod).toContain('moving the fixed rod up to 10 feet on a success');
      expect(rod).not.toContain('are known to exist');

      const fortress = magicItemDescription('magic-item:instant-fortress');
      expect(fortress).toMatch(
        /^You can use an action to place this 1-inch metal cube/,
      );
      expect(fortress).not.toContain('d100 Horn Berserkers');
      expect(fortress).not.toContain('Proficiency with all');
    });

    it('keeps interleaved Ring page bodies assigned to the matching Ring records', () => {
      const featherFalling = magicItemDescription(
        'magic-item:ring-of-feather-falling',
      );
      expect(featherFalling).toContain('When you fall while wearing this ring');
      expect(featherFalling).not.toContain('resistance to acid damage');
      expect(featherFalling).not.toContain('move through solid earth or rock');

      const evasion = magicItemDescription('magic-item:ring-of-evasion');
      expect(evasion).toContain('When you fail a Dexterity saving throw');
      expect(evasion).toContain('succeed on that saving throw instead');
      expect(evasion).not.toContain('telepathic communication');
      expect(evasion).not.toContain('jump spell');

      const freeAction = magicItemDescription('magic-item:ring-of-free-action');
      expect(freeAction).toContain('difficult terrain does');
      expect(freeAction).toContain('extra movement');
      expect(freeAction).not.toContain('stone shape');
      expect(freeAction).not.toContain('Ring of Fire Elemental Command');

      const invisibility = magicItemDescription(
        'magic-item:ring-of-invisibility',
      );
      expect(invisibility).toContain('you can turn invisible as an action');
      expect(invisibility).not.toContain('resistance to fire damage');
      expect(invisibility).not.toContain('understand Ignan');
      expect(invisibility).not.toContain('immune to fire damage');

      const jumping = magicItemDescription('magic-item:ring-of-jumping');
      expect(jumping).toContain('cast the jump spell');
      expect(jumping).not.toContain('burning hands');
      expect(jumping).not.toContain('Ring of Water Elemental Command');

      const mindShielding = magicItemDescription(
        'magic-item:ring-of-mind-shielding',
      );
      expect(mindShielding).toContain(
        'immune to magic that allows other creatures',
      );
      expect(mindShielding).not.toContain('water elemental');
      expect(mindShielding).not.toContain('breathe underwater');
      expect(mindShielding).not.toContain('create or destroy water');
    });

    it('keeps the Vicious Weapon and Vorpal Sword boundary separate', () => {
      const vicious = magicItemDescription('magic-item:vicious-weapon');
      expect(vicious).toContain('critical hit deals an extra 2d6 damage');
      expect(vicious).not.toContain('Vorpal Sword');
      expect(vicious).not.toContain('You gain a +3 bonus');

      const vorpal = magicItemDescription('magic-item:vorpal-sword');
      expect(vorpal).toContain('You gain a +3 bonus');
      expect(vorpal).toContain('cut off one of the creature');
      expect(vorpal).not.toContain('Wand of Binding');
    });

    // loreweaver-ecr: SRD 5.1 p217-p218 justify the right column and push up to
    // three line-final words ("wish", "spell", "remove curse") flush to the page
    // edge, opening an x-gap wider than the real page gutter. The column splitter
    // once isolated those stragglers as a phantom column and collapsed the two
    // real columns into one y-interleaved flow, splicing the embedded "Avatar of
    // Death" stat block (left column, part of the Deck of Many Things entry)
    // line-by-line into the Defender and Demon Armor item bodies. These
    // assertions guard the de-interleaved column extraction so neighboring
    // stat-block / card text cannot bleed back into the swords-and-armor items.
    it('does not bleed the Avatar of Death stat block into Defender or Demon Armor', () => {
      const defender = magicItemDescription('magic-item:defender');
      expect(defender).toContain(
        'You gain a +3 bonus to attack and damage rolls',
      );
      expect(defender).toContain('transfer some or all of the sword');
      expect(defender).not.toContain('Avatar of Death');
      expect(defender).not.toContain('Senses darkvision 60 ft., truesight');
      expect(defender).not.toContain(
        'Languages all languages known to its summoner',
      );
      expect(defender).not.toContain('Incorporeal Movement');
      expect(defender).not.toContain('Turning Immunity');
      expect(defender).not.toContain('Reaping Scythe');

      const demonArmor = magicItemDescription('magic-item:demon-armor');
      expect(demonArmor).toContain('While wearing this armor, you gain a +1');
      expect(demonArmor).toContain('understand and speak Abyssal');
      // The straggler "remove curse" must read in its own item's prose.
      expect(demonArmor).toContain(
        'targeted by the remove curse spell or similar magic',
      );
      expect(demonArmor).not.toContain('Avatar of Death');
      expect(demonArmor).not.toContain('Reaping Scythe');
      expect(demonArmor).not.toContain(
        'Star. Increase one of your ability scores',
      );
      expect(demonArmor).not.toContain('Throne. You gain proficiency');
      expect(demonArmor).not.toContain('Sun. You gain 50,000 XP');
    });

    // loreweaver-ecr: "Sword of Sharpness" wraps its category line mid-rarity
    // ("Weapon (any sword that deals slashing damage), very" / "rare (requires
    // attunement)"), so the line ends with the bare word "very" and the old
    // boundary detector missed the item entirely — its heading and body were
    // swallowed into the preceding "Sword of Life Stealing" record.
    it('splits Sword of Sharpness out of Sword of Life Stealing', () => {
      const lifeStealing = magicItemDescription(
        'magic-item:sword-of-life-stealing',
      );
      expect(lifeStealing).toContain('extra 3d6 necrotic damage');
      expect(lifeStealing).toContain(
        'temporary hit points equal to the extra damage',
      );
      expect(lifeStealing).not.toContain('Sword of Sharpness');
      expect(lifeStealing).not.toContain('slashing damage');
      expect(lifeStealing).not.toContain('lop off');

      expect(magicItemData('magic-item:sword-of-sharpness')).toMatchObject({
        itemType: 'Weapon (any sword that deals slashing damage)',
        rarity: 'very rare',
        requiresAttunement: true,
      });
      const sharpness = magicItemDescription('magic-item:sword-of-sharpness');
      expect(sharpness).toContain('maximize your weapon damage dice against');
      expect(sharpness).toContain('extra 4d6 slashing damage');
      expect(sharpness).toContain('lop off one of the target');
      expect(sharpness).not.toContain('Sword of Wounding');
      expect(sharpness).not.toContain('necrotic damage');
      expect(sharpness).not.toMatch(/^Weapon \(/);
    });

    // The interleaving fix must not strip the Avatar of Death stat block and
    // card descriptions from the Deck of Many Things entry, where they
    // legitimately belong in the source.
    it('keeps the Avatar of Death stat block and card text in the Deck of Many Things entry', () => {
      const deck = magicItemDescription('magic-item:deck-of-many-things');
      expect(deck).toContain('this deck contains a');
      expect(deck).toContain('Avatar of Death');
      expect(deck).toContain('Reaping Scythe');
      expect(deck).toContain('The Void');

      const avatar = pack.records.find(
        (record) => record.key === 'stat-block:avatar-of-death',
      );
      expect(avatar?.data).toMatchObject({
        traits: [
          { name: 'Incorporeal Movement' },
          { name: 'Turning Immunity' },
        ],
        actions: [{ name: 'Reaping Scythe' }],
      });
    });

    it('parses wrapped category attunement parentheticals into item metadata', () => {
      const cases = [
        {
          key: 'magic-item:ring-of-shooting-stars',
          itemType: 'Ring',
          rarity: 'very rare',
          attunementRequirement: 'outdoors at night',
          bodyStart: 'While wearing this ring in dim light or darkness',
        },
        {
          key: 'magic-item:holy-avenger',
          itemType: 'Weapon (any sword)',
          rarity: 'legendary',
          attunementRequirement: 'by a paladin',
          bodyStart: 'You gain a +3 bonus',
        },
        {
          key: 'magic-item:pearl-of-power',
          itemType: 'Wondrous item',
          rarity: 'uncommon',
          attunementRequirement: 'by a spellcaster',
          bodyStart: 'While this pearl is on your person',
        },
        {
          key: 'magic-item:talisman-of-pure-good',
          itemType: 'Wondrous item',
          rarity: 'legendary',
          attunementRequirement: 'by a creature of good alignment',
          bodyStart: 'This talisman is a mighty symbol of goodness',
        },
        {
          key: 'magic-item:talisman-of-ultimate-evil',
          itemType: 'Wondrous item',
          rarity: 'legendary',
          attunementRequirement: 'by a creature of evil alignment',
          bodyStart: 'This item symbolizes unrepentant evil',
        },
        {
          key: 'magic-item:wand-of-polymorph',
          itemType: 'Wand',
          rarity: 'very rare',
          attunementRequirement: 'by a spellcaster',
          bodyStart: 'This wand has 7 charges',
        },
        {
          key: 'magic-item:wand-of-web',
          itemType: 'Wand',
          rarity: 'uncommon',
          attunementRequirement: 'by a spellcaster',
          bodyStart: 'This wand has 7 charges',
        },
      ];

      for (const expected of cases) {
        const data = magicItemData(expected.key);
        expect(data).toMatchObject({
          itemType: expected.itemType,
          rarity: expected.rarity,
          requiresAttunement: true,
          attunementRequirement: expected.attunementRequirement,
        });
        const description = magicItemDescription(expected.key);
        expect(description).toContain(expected.bodyStart);
        expect(description).not.toContain('requires attunement');
        expect(description).not.toMatch(/^\w+\)/);
      }
    });

    it('keeps Ring of Three Wishes spell wording intact', () => {
      const description = magicItemDescription(
        'magic-item:ring-of-three-wishes',
      );
      expect(description).toContain('cast the wish spell from it');
      expect(description).not.toContain('cast the wish it');
    });
  });

  // loreweaver-yli: the nesting-aware rule parser keys body boundaries off
  // per-line font tiers. The SRD's gray callout boxes render their heading at a
  // sub-leaf size (h≈10.8), so the parser must recognize that tier — otherwise
  // a box heading reads as body and its whole rule is swallowed into the
  // preceding record. These assertions pin the box rules and the boundaries
  // around them so the corruption cannot return (the Hiding rule, with its
  // inline Passive Perception / What Can You See? lead-ins, was once buried in
  // the Dexterity "Initiative" sidebar).
  describe('rule body-boundary regression (loreweaver-yli)', () => {
    const rules = pack.records.filter((record) => record.kind === 'rule');

    function ruleText(key: string): string {
      const record = rules.find((r) => r.key === key);
      expect(record, `expected ${key} in the committed pack`).toBeDefined();
      const data = record?.data as { text?: unknown };
      expect(typeof data.text).toBe('string');
      return data.text as string;
    }

    it('committed pack rule keys match the checked-in baseline exactly', () => {
      expect(rules.map((record) => record.key).sort()).toEqual(
        [...EXPECTED_SRD_5_1_RULE_KEYS].sort(),
      );
    });

    it('EXPECTED_SRD_5_1_RULE_KEYS has no duplicates', () => {
      expect(new Set(EXPECTED_SRD_5_1_RULE_KEYS).size).toBe(
        EXPECTED_SRD_5_1_RULE_KEYS.length,
      );
    });

    it('keeps the Madness rules distinct and excludes their effect tables', () => {
      const madness = ruleText('rule:madness');
      expect(madness).toContain('campaign has a strong horror theme');
      expect(madness).not.toContain('Going Mad');

      const goingMad = ruleText('rule:going-mad');
      expect(goingMad).toContain('Wisdom or Charisma saving throw');
      expect(goingMad).not.toContain('Madness Effects');

      const effects = ruleText('rule:madness-effects');
      expect(effects).toContain('Short-Term Madness');
      expect(effects).toContain('Long-Term Madness');
      expect(effects).toContain('Indefinite Madness');
      expect(effects).not.toContain('d100');

      const curing = ruleText('rule:curing-madness');
      expect(curing).toContain('greater restoration');
      expect(curing).not.toContain('Statistics for Objects');
    });

    it('keeps Objects prose complete and excludes table rows and Poisons', () => {
      const objects = ruleText('rule:objects');
      for (const landmark of [
        'Statistics for Objects',
        'Armor Class.',
        'Hit Points.',
        'Huge and Gargantuan Objects.',
        'Objects and Damage Types.',
        'Damage Threshold.',
      ]) {
        expect(objects).toContain(landmark);
      }
      for (const excluded of [
        'Cloth, paper, rope 11',
        'Tiny (bottle, lock)',
        'Fragile Resilient',
        'Poisons',
      ]) {
        expect(objects).not.toContain(excluded);
      }
    });

    it('captures the Hiding callout box as its own rule', () => {
      const hiding = ruleText('rule:hiding');
      expect(hiding).toContain(
        'When you try to hide, make a Dexterity (Stealth)',
      );
      // The box's inline bold lead-ins belong to the Hiding rule, not a neighbor.
      expect(hiding).toContain('Passive Perception');
      expect(hiding).toContain('What Can You See?');
    });

    it('does not bury the Hiding / Perception block under Dexterity Initiative', () => {
      const initiative = ruleText('rule:dexterity-initiative');
      // The Dexterity-section Initiative sidebar is only its own two sentences.
      expect(initiative).toContain('you roll initiative');
      expect(initiative).toContain('creatures’ turns in combat');
      expect(initiative).not.toContain('Dexterity (Stealth)');
      expect(initiative).not.toContain('Passive Perception');
      expect(initiative).not.toContain('What Can You See?');
    });

    it('captures the other sub-leaf callout boxes as their own rules', () => {
      expect(ruleText('rule:combat-step-by-step')).toContain(
        'Determine surprise',
      );
      expect(ruleText('rule:interacting-with-objects-around-you')).toContain(
        'draw or sheathe a sword',
      );
      expect(ruleText('rule:contests-in-combat')).toContain(
        'grappling and shoving a creature',
      );
    });

    it('keeps cross-chapter same-named rules on distinct parent-qualified keys', () => {
      // "Hit Points" appears under both Constitution and Damage and Healing.
      expect(ruleText('rule:constitution-hit-points')).toContain(
        'Constitution modifier contributes',
      );
      expect(ruleText('rule:damage-and-healing-hit-points')).toContain(
        'represent a combination of physical and mental durability',
      );
    });
  });

  // loreweaver-3hp: an inline italic run (a spell name mid-paragraph) starts at
  // a high x because the words before it on the same line consumed the column
  // width. On a sparse, effectively single-column page that opened a spurious
  // START-x gap, so `partitionItemsByColumn` cut the run into a phantom right
  // column emitted AFTER the rest of the paragraph — scrambling the source word
  // order. The extractor now rejects a tiny-island cut that slices a contiguous
  // line of text. These assertions pin the corrected reading order.
  describe('inline-flow column-split regression (loreweaver-3hp)', () => {
    function bodyOf(key: string): string {
      const record = pack.records.find((r) => r.key === key);
      expect(record, `expected ${key} in the committed pack`).toBeDefined();
      const data = record?.data as { text?: unknown; description?: unknown };
      const body = data.text ?? data.description;
      expect(typeof body).toBe('string');
      return body as string;
    }

    it('reconstructs the Combining Magical Effects bless example in source order', () => {
      const text = bodyOf('rule:combining-magical-effects');
      expect(text).toContain('if two clerics cast bless on the same target');
      // The pre-fix corruption split "bless on the same" to the end of the body
      // ("…cast target, … two bonus dice. bless on the same").
      expect(text).not.toMatch(/clerics cast target,/);
      expect(text).not.toMatch(/bless on the same\s*$/);
    });

    // The Wizard "Your Spellbook" prose ("You can copy a spell from your own…",
    // "Your spellbook is a unique…") lived on the same sparse page family and was
    // a second real-pack witness for this extractor fix when it bled into the
    // School of Evocation subclass/Overchannel records. loreweaver-6fw bounds the
    // callout out of those records, and loreweaver-0m9.5.23 now retains it in the
    // standalone `rule:wizard-your-spellbook` record. The extractor's source-order
    // behavior on that page shape remains covered directly by the synthetic-probe
    // test in extract.test.ts ("does not split a contiguous inline run into a
    // phantom column on a sparse page"); the bless example above remains the
    // real-pack guard. See the callout-box bleed regression block below.
  });

  // loreweaver-6fw: the Classes chapter prints five gray callout boxes (generic
  // class/DM procedure sidebars) at a distinct font-height tier (h≈10.8 heading,
  // h≈8.9 body), each AFTER a subclass's last feature and BEFORE the next base
  // class. Because their titles start with prose words ("Your Spellbook", "Your
  // Pact Boon", "Breaking Your Oath") or otherwise carry no feature/table anchor,
  // the parser used to run the preceding subclass description and last feature
  // body straight through them, absorbing the whole sidebar. The feature/subclass
  // parsers now bound a body at the callout-box height tier, dropping the sidebar
  // prose (DM/class procedure, not subclass or feature content). These assertions
  // pin every affected record so the bleed cannot return.
  describe('class callout-box bleed regression (loreweaver-6fw)', () => {
    function bodyOf(key: string): string {
      const record = pack.records.find((r) => r.key === key);
      expect(record, `expected ${key} in the committed pack`).toBeDefined();
      const data = record?.data as { text?: unknown; description?: unknown };
      const body = data.text ?? data.description;
      expect(typeof body).toBe('string');
      return body as string;
    }

    const expectedCalloutRules: ReadonlyArray<{
      readonly key: string;
      readonly locator: string;
      readonly bodyPhrase: string;
      readonly excludedPhrase?: string;
    }> = [
      {
        key: 'rule:druid-druids-and-the-gods',
        locator: 'p. 23',
        bodyPhrase: 'nature deities',
        excludedPhrase: 'As a fighter, you gain the following class features',
      },
      {
        key: 'rule:druid-sacred-plants-and-wood',
        locator: 'p. 22',
        bodyPhrase: 'A druid holds certain plants to be sacred',
        excludedPhrase: 'nature deities',
      },
      {
        key: 'rule:paladin-breaking-your-oath',
        locator: 'p. 33',
        bodyPhrase: 'impenitent paladin',
        excludedPhrase: 'As a ranger, you gain the following class features',
      },
      {
        key: 'rule:warlock-your-pact-boon',
        locator: 'p. 51',
        bodyPhrase: 'Pact of the Chain',
        excludedPhrase: 'As a wizard, you gain the following class features',
      },
      {
        key: 'rule:wizard-your-spellbook',
        locator: 'p. 54',
        bodyPhrase: 'the process takes 2 hours and costs 50 gp',
      },
    ];

    for (const expected of expectedCalloutRules) {
      it(`emits ${expected.key} as an independent rule`, () => {
        const record = pack.records.find(
          (candidate) => candidate.key === expected.key,
        );
        expect(
          record,
          `expected ${expected.key} in the committed pack`,
        ).toBeDefined();
        expect(record?.kind).toBe('rule');
        const data = record?.data as { text?: unknown };
        expect(typeof data.text).toBe('string');
        expect(data.text).toContain(expected.bodyPhrase);
        if (expected.excludedPhrase !== undefined) {
          expect(data.text).not.toContain(expected.excludedPhrase);
        }
        expect(record?.provenance.locator).toBe(expected.locator);
      });
    }

    // Each entry: the record whose body used to absorb the box, and a phrase
    // unique to the dropped callout-box prose that must no longer appear.
    const cases: ReadonlyArray<readonly [key: string, boxPhrase: string]> = [
      [
        'subclass:school-of-evocation',
        'Your spellbook is a unique compilation',
      ],
      [
        'feature:school-of-evocation:overchannel',
        'Copying a Spell into the Book',
      ],
      ['subclass:the-fiend', 'Pact of the Chain'],
      ['feature:the-fiend:hurl-through-hell', 'Your Pact Boon'],
      ['subclass:circle-of-the-land', 'Sacred Plants and Wood'],
      ['feature:circle-of-the-land:natural-recovery', 'Druids and the Gods'],
      ['feature:oath-of-devotion:holy-nimbus', 'Breaking Your Oath'],
    ];

    for (const [key, boxPhrase] of cases) {
      it(`bounds ${key} before the callout-box prose`, () => {
        expect(bodyOf(key)).not.toContain(boxPhrase);
      });
    }

    it('bounds the School of Evocation blurb to its overview, with feature text in its own records', () => {
      // eshyra-4a7.2: the subclass blurb is now just the arcane-tradition
      // overview; the evocation feature bodies (Empowered Evocation's "This
      // damage ignores resistance and immunity", etc.) live only in their own
      // `feature:school-of-evocation:*` records, not the subclass description.
      // The Overchannel feature still carries its full 14th-level text and is
      // still bounded before the trailing "Your Spellbook" sidebar (the
      // original loreweaver-6fw concern), proven by the cases above and here.
      const subclass = bodyOf('subclass:school-of-evocation');
      expect(subclass).toContain('You focus your study on magic');
      expect(subclass).not.toContain(
        'This damage ignores resistance and immunity',
      );
      expect(bodyOf('feature:school-of-evocation:overchannel')).toContain(
        'you can deal maximum damage with that spell',
      );
    });
  });

  // loreweaver-6ra: the gamemastering Diseases and Poisons sections emit under
  // the `hazard` kind (alongside the 8 traps), discriminated by `data.category`.
  // These assertions guard exact name-set coverage, the category discriminators,
  // and the structured poison fields — plus the p205 reading-order fix that the
  // extractor change (the inline lead-in single-column merge) made possible.
  describe('gamemastering hazards: diseases + poisons (loreweaver-6ra)', () => {
    const hazards = pack.records.filter((r) => r.kind === 'hazard');
    const dataOf = (key: string) =>
      pack.records.find((r) => r.key === key)?.data as
        | Record<string, unknown>
        | undefined;

    it('emits every sample disease, keyed under the hazard kind', () => {
      const diseases = hazards.filter(
        (r) => (r.data as { category?: unknown }).category === 'disease',
      );
      expect(diseases.map((r) => r.name).sort()).toEqual(
        [...EXPECTED_SRD_5_1_DISEASE_NAMES].sort(),
      );
    });

    it('emits every sample poison, keyed under the hazard kind', () => {
      const poisons = hazards.filter(
        (r) => (r.data as { category?: unknown }).category === 'poison',
      );
      expect(poisons.map((r) => r.name).sort()).toEqual(
        [...EXPECTED_SRD_5_1_POISON_NAMES].sort(),
      );
    });

    it('disease and poison name baselines have no duplicates and no key collisions', () => {
      expect(new Set(EXPECTED_SRD_5_1_DISEASE_NAMES).size).toBe(
        EXPECTED_SRD_5_1_DISEASE_NAMES.length,
      );
      expect(new Set(EXPECTED_SRD_5_1_POISON_NAMES).size).toBe(
        EXPECTED_SRD_5_1_POISON_NAMES.length,
      );
      // hazard keys (8 traps + 3 diseases + 14 poisons) are all distinct.
      const keys = hazards.map((r) => r.key);
      expect(new Set(keys).size).toBe(keys.length);
    });

    it('carries structured poisonType and price on every poison', () => {
      for (const name of EXPECTED_SRD_5_1_POISON_NAMES) {
        const data = dataOf(
          `hazard:${name
            .toLowerCase()
            .replace(/[’']/g, '')
            .replace(/[^a-z0-9]+/g, '-')}`,
        );
        expect(data, `expected a record for ${name}`).toBeDefined();
        expect(typeof data?.poisonType).toBe('string');
        expect(['contact', 'ingested', 'inhaled', 'injury']).toContain(
          data?.poisonType,
        );
        expect(typeof data?.price).toBe('string');
        expect(data?.price as string).toMatch(/gp$/);
      }
    });

    it('keeps traps free of a category and diseases/poisons free of trapType', () => {
      for (const r of hazards) {
        const data = r.data as { category?: unknown; trapType?: unknown };
        if (data.trapType !== undefined) {
          expect(data.category).toBeUndefined();
        } else {
          expect(['disease', 'poison']).toContain(data.category);
        }
      }
    });

    it('reconstructs the p205 Sample Poisons in source order (inline lead-in fix)', () => {
      // Before the extractor fix, page 205 was split into a phantom right column
      // and each poison's bold lead-in remainder was emitted AFTER its body,
      // scrambling the first sentence (e.g. "Pale Tincture" lost "A creature
      // subjected to", and Truth Serum's trailing "spell." was displaced).
      const pale = dataOf('hazard:pale-tincture')?.description as string;
      expect(pale).toMatch(
        /^A creature subjected to this poison must succeed on a DC 16/,
      );
      const truth = dataOf('hazard:truth-serum')?.description as string;
      expect(truth).toMatch(
        /as if under the effect of a zone of truth spell\.$/,
      );
      const wyvern = dataOf('hazard:wyvern-poison')?.description as string;
      expect(wyvern).toMatch(
        /^This poison must be harvested from a dead or incapacitated wyvern\./,
      );
    });
  });

  // loreweaver-3n6: the committed pack once collapsed to a single equipment
  // record (an inaccurate `equipment:padded`) because the equipment parser
  // assumed a row-major table layout the real SRD 5.1 PDF does not use — it
  // splits the Armor and Weapons tables into separate column-blocks. These
  // assertions guard the reconstructed per-category coverage so a parser
  // regression that drops a table (or collapses back to one record) fails here.
  describe('equipment coverage regression (loreweaver-3n6)', () => {
    const equipment = pack.records.filter((r) => r.kind === 'equipment');

    function category(key: string): string | undefined {
      const data = pack.records.find((r) => r.key === key)?.data as
        | { category?: unknown }
        | undefined;
      return typeof data?.category === 'string' ? data.category : undefined;
    }

    it('emits every reconstructed equipment category, not a single record', () => {
      const counts = new Map<string, number>();
      for (const record of equipment) {
        const cat = (record.data as { category?: unknown }).category;
        if (typeof cat === 'string') {
          counts.set(cat, (counts.get(cat) ?? 0) + 1);
        }
      }
      // The reviewed SRD 5.1 baseline (loreweaver-3n6 + loreweaver-4zu):
      // 13 armor, 37 weapons, 35 tools, 112 gear (99 Adventuring Gear + 13
      // Tack/Harness/Drawn Vehicles), 7 Equipment Packs, 8 mounts, 6 waterborne
      // vehicles.
      expect(Object.fromEntries(counts)).toEqual({
        armor: 13,
        weapon: 37,
        tool: 35,
        gear: 112,
        pack: 7,
        mount: 8,
        vehicle: 6,
      });
    });

    it('Padded armor matches the SRD armor table (stealth disadvantage + weight)', () => {
      const padded = pack.records.find((r) => r.key === 'equipment:padded');
      expect(padded?.data).toMatchObject({
        category: 'armor',
        cost: '5 gp',
        ac: '11 + Dex modifier',
        armorType: 'light',
        stealthDisadvantage: true,
        weight: '8 lb.',
      });
    });

    it('carries landmark records from each reconstructed table', () => {
      // One armor (heavy, with a strength requirement), one weapon (zipped
      // damage + weight + properties), and one tool.
      expect(category('equipment:plate')).toBe('armor');
      expect(category('equipment:longsword')).toBe('weapon');
      expect(category('equipment:smiths-tools')).toBe('tool');

      const longsword = pack.records.find(
        (r) => r.key === 'equipment:longsword',
      );
      expect(longsword?.data).toMatchObject({
        category: 'weapon',
        damageDie: '1d8',
        damageType: 'slashing',
        weight: '3 lb.',
        properties: ['Versatile (1d10)'],
      });
    });

    // loreweaver-4zu: the Adventuring Gear table is reconstructed from two
    // interleaved physical columns whose item names are fully separated from
    // their cost/weight cells; these spot-checks guard the deterministic
    // name↔value zip (a left-column item, a right-column item, a sub-item under
    // a category header, and a Container Capacity attachment).
    it('reconstructs Adventuring Gear cost/weight and container capacity', () => {
      // Left-column item (its value arrives interleaved with right-column rows).
      expect(category('equipment:backpack')).toBe('gear');
      expect(
        pack.records.find((r) => r.key === 'equipment:backpack')?.data,
      ).toMatchObject({
        category: 'gear',
        cost: '2 gp',
        weight: '5 lb.',
        capacity: '1 cubic foot/30 pounds of gear',
      });
      // Right-column complete row.
      expect(
        pack.records.find((r) => r.key === 'equipment:potion-of-healing')?.data,
      ).toMatchObject({ category: 'gear', cost: '50 gp', weight: '1/2 lb.' });
      // Sub-item under the "Arcane focus" category header (header itself has no
      // cost cell and must not become a record).
      expect(
        pack.records.find((r) => r.key === 'equipment:crystal')?.data,
      ).toMatchObject({ category: 'gear', cost: '10 gp', weight: '1 lb.' });
      expect(pack.records.some((r) => r.key === 'equipment:arcane-focus')).toBe(
        false,
      );
    });

    it('imports Mounts and Vehicles with per-table categories (loreweaver-4zu)', () => {
      expect(
        pack.records.find((r) => r.key === 'equipment:warhorse')?.data,
      ).toMatchObject({
        category: 'mount',
        cost: '400 gp',
        speed: '60 ft.',
        carryingCapacity: '540 lb.',
      });
      expect(
        pack.records.find((r) => r.key === 'equipment:galley')?.data,
      ).toMatchObject({
        category: 'vehicle',
        cost: '30,000 gp',
        speed: '4 mph',
      });
      // The Tack/Harness/Drawn Vehicles table is cost/weight gear; the "Saddle"
      // sub-header's bare variants are qualified to "Saddle, <variant>".
      expect(
        pack.records.find((r) => r.key === 'equipment:saddle-military')?.data,
      ).toMatchObject({ category: 'gear', cost: '20 gp', weight: '30 lb.' });
      expect(
        pack.records.find((r) => r.key === 'equipment:carriage')?.data,
      ).toMatchObject({ category: 'gear', cost: '100 gp', weight: '600 lb.' });
    });

    it('imports Equipment Packs as priced bundles with verbatim contents', () => {
      const burglars = pack.records.find(
        (r) => r.key === 'equipment:burglars-pack',
      );
      expect(burglars?.data).toMatchObject({ category: 'pack', cost: '16 gp' });
      const description = (burglars?.data as { description?: unknown })
        .description;
      expect(typeof description).toBe('string');
      expect(description).toContain('Includes a backpack');
      expect(description).toContain('strapped to the side of it');
    });
  });

  // loreweaver-7ok: the alphabetic Spell Descriptions section ends with "Zone
  // of Truth", immediately followed by the gamemastering "Traps" subsection;
  // and the SRD justifies paragraphs, so the "Wish" spell's right-aligned last
  // word "wish" sat just left of the page gutter on p193. Two distinct bugs
  // corrupted the final spell bodies: the spell-descriptions end anchor missed
  // "Traps" (so "Zone of Truth" absorbed the entire Traps→Poisons run), and the
  // column splitter swept "wish" into the right column (so "Word of Recall"
  // gained a stray "wish" mid-sentence). Both are fixed at the importer; these
  // assertions guard the committed pack against either regressing.
  describe('spell-section boundary regression (loreweaver-7ok)', () => {
    function spellDescription(key: string): string {
      const record = pack.records.find((r) => r.key === key);
      expect(record, `expected ${key} in the committed pack`).toBeDefined();
      const data = record?.data as { description?: unknown };
      expect(typeof data.description).toBe('string');
      return data.description as string;
    }

    it('Word of Recall body matches the SRD and carries no neighboring-spell contamination', () => {
      const description = spellDescription('spell:word-of-recall');
      // The true SRD sentence runs straight from "isn't" to "dedicated".
      expect(description).toContain(
        'in an area that isn’t dedicated to your deity, the spell has no effect.',
      );
      expect(description.endsWith('the spell has no effect.')).toBe(true);
      // The pre-fix artifact: the Wish spell's stray "wish" wedged between
      // "isn't" and "dedicated". No standalone "wish" token may remain.
      expect(description).not.toMatch(/\bwish\b/i);
    });

    it('Zone of Truth body ends at the spell boundary and excludes the Traps section', () => {
      const description = spellDescription('spell:zone-of-truth');
      expect(
        description.endsWith('it remains within the boundaries of the truth.'),
      ).toBe(true);
      // The pre-fix artifact: the end anchor missed "Traps", so the body ran on
      // through Traps, Diseases, Madness, Objects, and the Poisons table. None
      // of those landmarks may appear in the spell body.
      for (const leaked of [
        'Traps can be found',
        'Purple Worm Poison',
        'Serpent Venom',
        'Truth Serum',
      ]) {
        expect(description).not.toContain(leaked);
      }
      // A faithful Zone of Truth body is short; the contaminated one was
      // ~38k characters of trailing gamemastering text.
      expect(description.length).toBeLessThan(2000);
    });
  });

  describe('spell-embedded table linkage (eshyra-o4j7)', () => {
    const expected: Readonly<Record<string, readonly string[]>> = {
      'spell:animate-objects': ['table:animated-object-statistics'],
      'spell:confusion': ['table:confusion-behavior'],
      'spell:control-weather': [
        'table:precipitation',
        'table:temperature',
        'table:wind',
      ],
      'spell:creation': ['table:creation-material-duration'],
      'spell:reincarnate': ['table:reincarnate-race'],
      'spell:scrying': ['table:scrying-save-modifiers'],
      'spell:teleport': ['table:teleport-familiarity'],
    };

    function refsFor(spellKey: string): readonly string[] {
      const spell = pack.records.find((record) => record.key === spellKey);
      expect(spell, `expected ${spellKey} in the committed pack`).toBeDefined();
      return (spell?.data as { tableRefs?: readonly string[] }).tableRefs ?? [];
    }

    it('links every affected spell to its exact embedded table set', () => {
      for (const [spellKey, tableRefs] of Object.entries(expected)) {
        expect(refsFor(spellKey)).toEqual(tableRefs);
      }
    });

    it('links Control Weather to exactly the three weather tables', () => {
      expect(refsFor('spell:control-weather')).toEqual([
        'table:precipitation',
        'table:temperature',
        'table:wind',
      ]);
    });

    it('links Teleport to the familiarity matrix', () => {
      expect(refsFor('spell:teleport')).toEqual(['table:teleport-familiarity']);
    });

    it('resolves every spell tableRef to an existing table record', () => {
      const tables = new Set(
        pack.records
          .filter((record) => record.kind === 'table')
          .map((record) => record.key),
      );
      for (const spellKey of Object.keys(expected)) {
        for (const tableRef of refsFor(spellKey)) {
          expect(tables.has(tableRef), `${spellKey} -> ${tableRef}`).toBe(true);
        }
      }
    });

    it('makes every embedded spell table reachable from exactly one spell', () => {
      const owners = new Map<string, string[]>();
      for (const record of pack.records) {
        if (record.kind !== 'spell') continue;
        const refs = (record.data as { tableRefs?: readonly string[] })
          .tableRefs;
        for (const ref of refs ?? []) {
          const list = owners.get(ref) ?? [];
          list.push(record.key);
          owners.set(ref, list);
        }
      }
      for (const [spellKey, tableRefs] of Object.entries(expected)) {
        for (const tableRef of tableRefs) {
          expect(owners.get(tableRef)).toEqual([spellKey]);
        }
      }
    });

    it('keeps the original spell prose while adding navigation refs', () => {
      const animateObjects = pack.records.find(
        (record) => record.key === 'spell:animate-objects',
      );
      expect(
        (animateObjects?.data as { description?: string }).description,
      ).toContain('Animated Object Statistics');
    });
  });

  // The canonical table set is Difficulty Classes, two trap tables, three
  // Madness tables, and two Objects tables. XP/treasure reconstruction remains
  // fixture-only because those families are absent from this SRD source.
  describe('table coverage regression baseline (loreweaver-46m, loreweaver-hvp, loreweaver-uuk)', () => {
    const tables = pack.records.filter((record) => record.kind === 'table');

    function table(key: string) {
      const record = tables.find((candidate) => candidate.key === key);
      expect(record, `expected ${key} in the committed pack`).toBeDefined();
      return record;
    }

    it('contains exactly the reviewed table key set', () => {
      expect(tables.map((record) => record.key).sort()).toEqual([
        // Core-rules table behind an excluded caption (eshyra-10t).
        'table:ability-scores-and-modifiers',
        // The four Acolyte suggested-characteristics roll tables
        // (eshyra-0m9.17), named "<Background> <Label>s" by parseBackgrounds
        // because the SRD prints them caption-less.
        'table:acolyte-bonds',
        'table:acolyte-flaws',
        'table:acolyte-ideals',
        'table:acolyte-personality-traits',
        'table:animated-object-statistics',
        'table:apparatus-of-the-crab-levers',
        'table:armor-of-resistance',
        // Document-wide tables (eshyra-4a7.3), reconstructed by
        // parseDocumentTables from typography anchors. Caption-less tables
        // carry synthesized names: the magic-item variety/dice tables take
        // their owning item's name, the Circle of the Land terrain tables are
        // qualified "Circle of the Land (<Terrain>)", and the Sorcerer-chapter
        // Draconic Ancestry copy is "Draconic Bloodline Draconic Ancestry".
        'table:bag-of-beans',
        // Druid Wild Shape's Beast Shapes table (eshyra-4a7.6).
        'table:beast-shapes',
        'table:belt-of-giant-strength',
        'table:candle-of-invocation',
        'table:carpet-of-flying',
        'table:character-advancement',
        'table:circle-of-the-land-arctic',
        'table:circle-of-the-land-coast',
        'table:circle-of-the-land-desert',
        'table:circle-of-the-land-forest',
        'table:circle-of-the-land-grassland',
        'table:circle-of-the-land-mountain',
        'table:circle-of-the-land-swamp',
        'table:confusion-behavior',
        'table:creating-spell-slots',
        'table:creation-material-duration',
        'table:cube-of-force-charges-lost',
        'table:cube-of-force-faces',
        'table:damage-severity-by-level',
        'table:deck-of-illusions',
        'table:deck-of-many-things',
        // Cleric Destroy Undead table (eshyra-4a7.6); its caption collides by
        // name with feature:cleric:destroy-undead, mapped explicitly in source
        // coverage.
        'table:destroy-undead',
        'table:difficulty-classes',
        'table:donning-and-doffing-armor',
        'table:draconic-ancestry',
        'table:draconic-bloodline-draconic-ancestry',
        'table:dragon-scale-mail',
        'table:efreeti-bottle',
        'table:elemental-gem',
        'table:exotic-languages',
        'table:experience-points-by-challenge-rating',
        'table:feather-token',
        'table:fiend-expanded-spells',
        'table:food-drink-and-lodging',
        'table:gray-bag-of-tricks',
        'table:hit-dice-by-size',
        'table:horn-of-valhalla',
        'table:indefinite-madness',
        'table:iron-flask',
        'table:life-domain-spells',
        'table:lifestyle-expenses',
        'table:long-term-madness',
        'table:manual-of-golems',
        'table:multiclass-spellcaster-spell-slots-per-spell-level',
        'table:multiclassing-prerequisites',
        'table:multiclassing-proficiencies',
        'table:necklace-of-prayer-beads',
        'table:oath-of-devotion-spells',
        'table:object-armor-class',
        'table:object-hit-points',
        'table:potion-of-giant-strength',
        'table:potion-of-resistance',
        'table:potions-of-healing',
        'table:precipitation',
        'table:proficiency-bonus-by-challenge-rating',
        'table:reincarnate-race',
        'table:ring-of-resistance',
        'table:ring-of-shooting-stars',
        'table:robe-of-useful-items',
        'table:rust-bag-of-tricks',
        'table:scrying-save-modifiers',
        'table:sentient-magic-item-alignment',
        'table:sentient-magic-item-communication',
        'table:sentient-magic-item-senses',
        'table:sentient-magic-item-special-purpose',
        'table:services',
        'table:short-term-madness',
        'table:size-categories',
        'table:spell-scroll',
        'table:sphere-of-annihilation',
        'table:staff-of-power',
        'table:staff-of-the-magi',
        'table:standard-exchange-rates',
        'table:standard-languages',
        'table:tan-bag-of-tricks',
        'table:teleport-familiarity',
        'table:temperature',
        'table:the-barbarian',
        // The remaining 11 class progression tables (eshyra-4a7.6): Fighter and
        // Rogue extract one line per row like the Barbarian; the nine
        // spellcaster/monk tables are sheared by the two-column layout and use
        // pinned-source reconstruction (classProgressionTables.ts).
        'table:the-bard',
        'table:the-cleric',
        'table:the-druid',
        'table:the-fighter',
        'table:the-monk',
        'table:the-paladin',
        'table:the-ranger',
        'table:the-rogue',
        'table:the-sorcerer',
        'table:the-warlock',
        'table:the-wizard',
        'table:trade-goods',
        'table:trap-save-dcs-and-attack-bonuses',
        // Core-rules table behind an excluded caption (eshyra-10t).
        'table:travel-pace',
        'table:wand-of-wonder',
        'table:wind',
      ]);
    });

    it('contains exactly the reviewed table name set', () => {
      expect(tables.map((record) => record.name).sort()).toEqual(
        [...EXPECTED_SRD_5_1_TABLE_NAMES].sort(),
      );
      expect(new Set(EXPECTED_SRD_5_1_TABLE_NAMES).size).toBe(
        EXPECTED_SRD_5_1_TABLE_NAMES.length,
      );
    });

    it('the table count matches the per-kind baseline', () => {
      expect(tables).toHaveLength(EXPECTED_COUNTS_BY_KIND.table);
    });

    it('structures representative magic-item option and dice-result tables', () => {
      expect(table('table:deck-of-illusions')?.data).toMatchObject({
        columns: ['Playing Card', 'Illusion'],
        rows: expect.arrayContaining([
          ['Ace of hearts', 'Red dragon'],
          ['Jokers (2)', 'You (the deck’s owner)'],
        ]),
      });
      expect(table('table:feather-token')?.data).toMatchObject({
        columns: ['d100', 'Feather Token'],
        rows: [
          ['01–20', 'Anchor'],
          ['21–35', 'Bird'],
          ['36–50', 'Fan'],
          ['51–65', 'Swan boat'],
          ['66–90', 'Tree'],
          ['91–00', 'Whip'],
        ],
      });
    });

    it('pins every spell-embedded table row and source page (eshyra-o4j7)', () => {
      expect(table('table:animated-object-statistics')).toMatchObject({
        source: 'SRD 5.1 p. 116',
        data: {
          columns: ['Size', 'HP', 'AC', 'Attack', 'Strength', 'Dexterity'],
          rows: [
            ['Tiny', 20, 18, '+8 to hit, 1d4 + 4 damage', 4, 18],
            ['Small', 25, 16, '+6 to hit, 1d8 + 2 damage', 6, 14],
            ['Medium', 40, 13, '+5 to hit, 2d6 + 1 damage', 10, 12],
            ['Large', 50, 10, '+6 to hit, 2d10 + 2 damage', 14, 10],
            ['Huge', 80, 10, '+8 to hit, 2d12 + 4 damage', 18, 6],
          ],
        },
      });
      expect(table('table:confusion-behavior')).toMatchObject({
        source: 'SRD 5.1 p. 127',
        data: {
          columns: ['d10', 'Behavior'],
          rows: [
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
          ],
        },
      });
      expect(table('table:precipitation')?.data.rows).toEqual([
        [1, 'Clear'],
        [2, 'Light clouds'],
        [3, 'Overcast or ground fog'],
        [4, 'Rain, hail, or snow'],
        [5, 'Torrential rain, driving hail, or blizzard'],
      ]);
      expect(table('table:temperature')?.data.rows).toEqual([
        [1, 'Unbearable heat'],
        [2, 'Hot'],
        [3, 'Warm'],
        [4, 'Cool'],
        [5, 'Cold'],
        [6, 'Arctic cold'],
      ]);
      expect(table('table:wind')?.data.rows).toEqual([
        [1, 'Calm'],
        [2, 'Moderate wind'],
        [3, 'Strong wind'],
        [4, 'Gale'],
        [5, 'Storm'],
      ]);
      expect(table('table:creation-material-duration')?.data.rows).toEqual([
        ['Vegetable matter', '1 day'],
        ['Stone or crystal', '12 hours'],
        ['Precious metals', '1 hour'],
        ['Gems', '10 minutes'],
        ['Adamantine or mithral', '1 minute'],
      ]);
      expect(table('table:reincarnate-race')?.data.rows).toEqual([
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
      expect(table('table:scrying-save-modifiers')?.data.rows).toEqual([
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
      expect(table('table:teleport-familiarity')).toMatchObject({
        source: 'SRD 5.1 p. 186',
        data: {
          columns: [
            'Familiarity',
            'Mishap',
            'Similar Area',
            'Off Target',
            'On Target',
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
      });
    });

    it('pins Madness table row counts, representative data, and source pages', () => {
      const shortTerm = table('table:short-term-madness');
      const longTerm = table('table:long-term-madness');
      const indefinite = table('table:indefinite-madness');

      expect(shortTerm?.data).toMatchObject({
        columns: ['d100', 'Effect'],
        rows: expect.arrayContaining([
          ['81–90', 'The character is stunned.'],
          ['91–100', 'The character falls unconscious.'],
        ]),
      });
      expect((shortTerm?.data as { rows: unknown[] }).rows).toHaveLength(10);
      expect(shortTerm?.provenance.locator).toBe('p. 201');

      expect(longTerm?.data).toMatchObject({
        columns: ['d100', 'Effect'],
        rows: expect.arrayContaining([
          ['91–95', 'The character loses the ability to speak.'],
        ]),
      });
      expect((longTerm?.data as { rows: unknown[] }).rows).toHaveLength(12);
      expect(longTerm?.provenance.locator).toBe('p. 201');

      expect(indefinite?.data).toMatchObject({
        columns: ['d100', 'Flaw'],
        rows: expect.arrayContaining([['16–25', '“I keep whatever I find.”']]),
      });
      expect((indefinite?.data as { rows: unknown[] }).rows).toHaveLength(12);
      expect(indefinite?.provenance.locator).toBe('p. 202');
    });

    it('pins Objects table data and source pages', () => {
      const armorClass = table('table:object-armor-class');
      expect(armorClass?.data).toMatchObject({
        columns: ['Substance', 'AC'],
        rows: expect.arrayContaining([['Adamantine', 23]]),
      });
      expect((armorClass?.data as { rows: unknown[] }).rows).toHaveLength(7);
      expect(armorClass?.provenance.locator).toBe('p. 203');

      const hitPoints = table('table:object-hit-points');
      expect(hitPoints?.data).toMatchObject({
        columns: ['Size', 'Fragile', 'Resilient'],
        rows: expect.arrayContaining([
          ['Large (cart, 10-ft.-by-10-ft. window)', '5 (1d10)', '27 (5d10)'],
        ]),
      });
      expect((hitPoints?.data as { rows: unknown[] }).rows).toHaveLength(4);
      expect(hitPoints?.provenance.locator).toBe('p. 203');
    });

    it('pins Beyond-1st-Level table data and source pages (eshyra-0m9.23)', () => {
      const advancement = table('table:character-advancement');
      expect(advancement?.data).toMatchObject({
        columns: ['Experience Points', 'Level', 'Proficiency Bonus'],
        rows: expect.arrayContaining([
          [0, 1, '+2'],
          [2700, 4, '+2'],
          [355000, 20, '+6'],
        ]),
      });
      expect((advancement?.data as { rows: unknown[] }).rows).toHaveLength(20);
      expect(advancement?.provenance.locator).toBe('p. 56');

      const prerequisites = table('table:multiclassing-prerequisites');
      expect(prerequisites?.data).toMatchObject({
        columns: ['Class', 'Ability Score Minimum'],
        rows: expect.arrayContaining([
          ['Fighter', 'Strength 13 or Dexterity 13'],
          ['Monk', 'Dexterity 13 and Wisdom 13'],
        ]),
      });
      expect((prerequisites?.data as { rows: unknown[] }).rows).toHaveLength(
        12,
      );
      expect(prerequisites?.provenance.locator).toBe('p. 56');

      const proficiencies = table('table:multiclassing-proficiencies');
      expect(proficiencies?.data).toMatchObject({
        columns: ['Class', 'Proficiencies Gained'],
        // The Bard cell wraps across two extracted lines and must rejoin; the
        // Sorcerer cell is the verbatim "—" (no proficiencies).
        rows: expect.arrayContaining([
          [
            'Bard',
            'Light armor, one skill of your choice, one musical instrument of your choice',
          ],
          ['Sorcerer', '—'],
        ]),
      });
      expect((proficiencies?.data as { rows: unknown[] }).rows).toHaveLength(
        12,
      );
      expect(proficiencies?.provenance.locator).toBe('p. 57');

      const standard = table('table:standard-languages');
      expect(standard?.data).toMatchObject({
        columns: ['Language', 'Typical Speakers', 'Script'],
        rows: expect.arrayContaining([['Giant', 'Ogres, giants', 'Dwarvish']]),
      });
      expect((standard?.data as { rows: unknown[] }).rows).toHaveLength(8);
      expect(standard?.provenance.locator).toBe('p. 59');

      const exotic = table('table:exotic-languages');
      expect(exotic?.data).toMatchObject({
        columns: ['Language', 'Typical Speakers', 'Script'],
        // "Deep Speech" is a two-word language name and its script cell is "—".
        rows: expect.arrayContaining([
          ['Deep Speech', 'Aboleths, cloakers', '—'],
        ]),
      });
      expect((exotic?.data as { rows: unknown[] }).rows).toHaveLength(8);
      expect(exotic?.provenance.locator).toBe('p. 59');
    });

    it('pins the Multiclass Spellcaster spell-slot progression (eshyra-0m9.18)', () => {
      const slots = table(
        'table:multiclass-spellcaster-spell-slots-per-spell-level',
      );
      expect(slots?.name).toBe(
        'Multiclass Spellcaster: Spell Slots per Spell Level',
      );
      expect(slots?.data).toMatchObject({
        columns: [
          'Lvl.',
          '1st',
          '2nd',
          '3rd',
          '4th',
          '5th',
          '6th',
          '7th',
          '8th',
          '9th',
        ],
        // Slot counts are integers; "no slots at this level" em-dash cells
        // are preserved verbatim.
        rows: expect.arrayContaining([
          ['1st', 2, '—', '—', '—', '—', '—', '—', '—', '—'],
          ['9th', 4, 3, 3, 3, 1, '—', '—', '—', '—'],
          ['20th', 4, 3, 3, 3, 3, 2, 2, 1, 1],
        ]),
      });
      expect((slots?.data as { rows: unknown[] }).rows).toHaveLength(20);
      expect(slots?.provenance.locator).toBe('p. 58');
    });

    it('pins money/downtime table data and source pages (eshyra-0m9.19)', () => {
      const exchange = table('table:standard-exchange-rates');
      expect(exchange?.data).toMatchObject({
        columns: ['Coin', 'CP', 'SP', 'EP', 'GP', 'PP'],
        // Fractional cross-rate cells are preserved verbatim as strings.
        rows: expect.arrayContaining([
          ['Copper (cp)', '1', '1/10', '1/50', '1/100', '1/1,000'],
        ]),
      });
      expect((exchange?.data as { rows: unknown[] }).rows).toHaveLength(5);
      expect(exchange?.provenance.locator).toBe('p. 62');

      const trade = table('table:trade-goods');
      expect(trade?.data).toMatchObject({
        columns: ['Cost', 'Goods'],
        rows: expect.arrayContaining([
          ['1 cp', '1 lb. of wheat'],
          ['500 gp', '1 lb. of platinum'],
        ]),
      });
      expect((trade?.data as { rows: unknown[] }).rows).toHaveLength(13);
      expect(trade?.provenance.locator).toBe('p. 72');

      const lifestyle = table('table:lifestyle-expenses');
      expect(lifestyle?.data).toMatchObject({
        columns: ['Lifestyle', 'Price/Day'],
        // The "—" (Wretched) and "10 gp minimum" (Aristocratic) cells are
        // preserved verbatim.
        rows: expect.arrayContaining([
          ['Wretched', '—'],
          ['Aristocratic', '10 gp minimum'],
        ]),
      });
      expect((lifestyle?.data as { rows: unknown[] }).rows).toHaveLength(7);
      expect(lifestyle?.provenance.locator).toBe('p. 72');

      const food = table('table:food-drink-and-lodging');
      expect(food?.data).toMatchObject({
        columns: ['Item', 'Cost'],
        // Grouped sub-items fold into qualified, query-friendly names; ungrouped
        // top-level items keep their bare name.
        rows: expect.arrayContaining([
          ['Ale, gallon', '2 sp'],
          ['Inn stay, squalid (per day)', '7 cp'],
          ['Meat, chunk', '3 sp'],
          ['Wine, fine (bottle)', '10 gp'],
        ]),
      });
      expect((food?.data as { rows: unknown[] }).rows).toHaveLength(20);
      expect(food?.provenance.locator).toBe('p. 73');

      const services = table('table:services');
      expect(services?.data).toMatchObject({
        columns: ['Service', 'Pay'],
        rows: expect.arrayContaining([
          ['Coach cab, between towns', '3 cp per mile'],
          ['Hireling, skilled', '2 gp per day'],
          ['Messenger', '2 cp per mile'],
        ]),
      });
      expect((services?.data as { rows: unknown[] }).rows).toHaveLength(7);
      expect(services?.provenance.locator).toBe('p. 74');
    });

    it('pins the four Monsters-chapter reference tables (eshyra-0m9.22)', () => {
      // The Monsters-chapter Size Categories table (p254) carries the
      // Examples column; the same-captioned core-rules Combat table (p92,
      // Size/Space only) is NOT emitted — the parser anchors on the
      // three-column header so the core occurrence cannot shadow it.
      const sizes = table('table:size-categories');
      expect(sizes?.data).toMatchObject({
        columns: ['Size', 'Space', 'Examples'],
        rows: expect.arrayContaining([
          ['Tiny', '2½ by 2½ ft.', 'Imp, sprite'],
          ['Gargantuan', '20 by 20 ft. or larger', 'Kraken, purple worm'],
        ]),
      });
      expect((sizes?.data as { rows: unknown[] }).rows).toHaveLength(6);
      expect(sizes?.provenance.locator).toBe('p. 254');

      const hitDice = table('table:hit-dice-by-size');
      expect(hitDice?.data).toMatchObject({
        columns: ['Monster Size', 'Hit Die', 'Average HP per Die'],
        // Half-point averages are preserved verbatim.
        rows: expect.arrayContaining([
          ['Tiny', 'd4', '2½'],
          ['Gargantuan', 'd20', '10½'],
        ]),
      });
      expect((hitDice?.data as { rows: unknown[] }).rows).toHaveLength(6);
      expect(hitDice?.provenance.locator).toBe('p. 256');

      // The two paired-column tables print two logical rows per physical
      // line; reconstruction must order them CR 0 → 30 top to bottom.
      const proficiency = table('table:proficiency-bonus-by-challenge-rating');
      expect(proficiency?.data).toMatchObject({
        columns: ['Challenge', 'Proficiency Bonus'],
        rows: expect.arrayContaining([
          ['0', '+2'],
          ['1/8', '+2'],
          ['13', '+5'],
          ['14', '+5'],
          ['30', '+9'],
        ]),
      });
      const proficiencyRows = (proficiency?.data as { rows: unknown[][] }).rows;
      expect(proficiencyRows).toHaveLength(34);
      // Left pair (CR 0-13) precedes right pair (CR 14-30) in order.
      expect(proficiencyRows[0]).toEqual(['0', '+2']);
      expect(proficiencyRows[17]).toEqual(['14', '+5']);
      expect(proficiencyRows[33]).toEqual(['30', '+9']);
      expect(proficiency?.provenance.locator).toBe('p. 256');

      const xp = table('table:experience-points-by-challenge-rating');
      expect(xp?.data).toMatchObject({
        columns: ['Challenge', 'XP'],
        rows: expect.arrayContaining([
          // The CR 0 special case is preserved verbatim.
          ['0', '0 or 10'],
          ['1/8', '25'],
          ['13', '10,000'],
          ['14', '11,500'],
          ['21', '33,000'],
          ['30', '155,000'],
        ]),
      });
      const xpRows = (xp?.data as { rows: unknown[][] }).rows;
      expect(xpRows).toHaveLength(34);
      expect(xpRows[0]).toEqual(['0', '0 or 10']);
      expect(xpRows[17]).toEqual(['14', '11,500']);
      expect(xpRows[33]).toEqual(['30', '155,000']);
      expect(xp?.provenance.locator).toBe('p. 258');
    });

    it('pins the two core-rules tables behind excluded captions (eshyra-10t)', () => {
      // Both captions repeat in the core-rules slice ("Ability Scores and
      // Modifiers" is also the chapter's subsection title; "Travel Pace" is
      // also the Speed section's prose heading), so each table anchors on its
      // unique column-header row.
      const modifiers = table('table:ability-scores-and-modifiers');
      expect(modifiers?.data).toMatchObject({
        columns: ['Score', 'Modifier'],
        // Score ranges keep the SRD en-dash and modifiers the typographic
        // minus sign (U+2212) verbatim.
        rows: expect.arrayContaining([
          ['1', '−5'],
          ['10–11', '+0'],
          ['30', '+10'],
        ]),
      });
      expect((modifiers?.data as { rows: unknown[] }).rows).toHaveLength(16);
      expect(modifiers?.provenance.locator).toBe('p. 76');

      // Travel Pace rows span three extracted lines each (numeric row, the
      // "feet miles miles" units row, effect wrap lines); the units fold into
      // standalone distance cells and the Normal "—" effect stays verbatim.
      const pace = table('table:travel-pace');
      expect(pace?.data).toMatchObject({
        columns: [
          'Pace',
          'Distance per Minute',
          'Distance per Hour',
          'Distance per Day',
          'Effect',
        ],
        rows: [
          [
            'Fast',
            '400 feet',
            '4 miles',
            '30 miles',
            '−5 penalty to passive Wisdom (Perception) scores',
          ],
          ['Normal', '300 feet', '3 miles', '24 miles', '—'],
          ['Slow', '200 feet', '2 miles', '18 miles', 'Able to use stealth'],
        ],
      });
      expect(pace?.provenance.locator).toBe('p. 84');
    });

    it('pins the Dragonborn Draconic Ancestry tables (eshyra-4a7.3)', () => {
      // The Races-chapter table (p5) carries the Breath Weapon column; the
      // Sorcerer-chapter Draconic Bloodline copy (p44) drops it and is a
      // distinct record under a synthesized qualified name.
      const ancestry = table('table:draconic-ancestry');
      expect(ancestry?.name).toBe('Draconic Ancestry');
      expect(ancestry?.data).toMatchObject({
        columns: ['Dragon', 'Damage Type', 'Breath Weapon'],
        rows: [
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
        ],
      });
      expect(ancestry?.provenance.locator).toBe('p. 5');

      const bloodline = table('table:draconic-bloodline-draconic-ancestry');
      expect(bloodline?.data).toMatchObject({
        columns: ['Dragon', 'Damage Type'],
        rows: expect.arrayContaining([
          ['Black', 'Acid'],
          ['White', 'Cold'],
        ]),
      });
      expect((bloodline?.data as { rows: unknown[] }).rows).toHaveLength(10);
      expect(bloodline?.provenance.locator).toBe('p. 44');
    });

    it('pins the Barbarian progression table (eshyra-4a7.3)', () => {
      // The one SRD class progression table whose columns all live on one
      // physical line per row; the Features cell wraps onto continuation
      // lines that must re-join ("Rage, / Unarmored / Defense").
      const barbarian = table('table:the-barbarian');
      expect(barbarian?.name).toBe('The Barbarian');
      expect(barbarian?.data).toMatchObject({
        columns: [
          'Level',
          'Proficiency Bonus',
          'Features',
          'Rages',
          'Rage Damage',
        ],
        rows: expect.arrayContaining([
          ['1st', '+2', 'Rage, Unarmored Defense', '2', '+2'],
          ['9th', '+4', 'Brutal Critical (1 die)', '4', '+3'],
          // The 20th-level Rages cell is the verbatim "Unlimited".
          ['20th', '+6', 'Primal Champion', 'Unlimited', '+4'],
        ]),
      });
      expect((barbarian?.data as { rows: unknown[] }).rows).toHaveLength(20);
      expect(barbarian?.provenance.locator).toBe('p. 8');
    });

    it('pins a full spellcaster progression table — The Wizard (eshyra-4a7.6)', () => {
      // The Wizard table is sheared by the two-column layout into a
      // Level/Features run and a separate spell-slot run; reconstruction zips
      // them per level. Cantrips Known and the 1st–9th slot progression must
      // align to the correct levels.
      const wizard = table('table:the-wizard');
      expect(wizard?.name).toBe('The Wizard');
      const data = wizard?.data as {
        columns: string[];
        rows: string[][];
      };
      expect(data.columns).toEqual([
        'Level',
        'Proficiency Bonus',
        'Features',
        'Cantrips Known',
        '1st',
        '2nd',
        '3rd',
        '4th',
        '5th',
        '6th',
        '7th',
        '8th',
        '9th',
      ]);
      expect(data.rows).toHaveLength(20);
      // L1: 3 cantrips known, two 1st-level slots, nothing higher.
      expect(data.rows[0]).toEqual([
        '1st',
        '+2',
        'Spellcasting, Arcane Recovery',
        '3',
        '2',
        '',
        '',
        '',
        '',
        '',
        '',
        '',
        '',
      ]);
      // L20: 5 cantrips known, the full 4/3/3/3/3/2/2/1/1 slot row.
      expect(data.rows[19]).toEqual([
        '20th',
        '+6',
        'Signature Spell',
        '5',
        '4',
        '3',
        '3',
        '3',
        '3',
        '2',
        '2',
        '1',
        '1',
      ]);
      expect(wizard?.provenance.locator).toBe('p. 52');
    });

    it('pins the Warlock Pact Magic progression (eshyra-4a7.6)', () => {
      const warlock = table('table:the-warlock');
      const data = warlock?.data as { columns: string[]; rows: string[][] };
      // The Pact Magic resource columns must all survive reconstruction.
      expect(data.columns).toEqual([
        'Level',
        'Proficiency Bonus',
        'Features',
        'Cantrips Known',
        'Spells Known',
        'Spell Slots',
        'Slot Level',
        'Invocations Known',
      ]);
      expect(data.rows).toHaveLength(20);
      // L1: Pact Magic feature, 2 cantrips/2 spells, 1 slot at slot level 1st,
      // no invocations yet (blank).
      expect(data.rows[0]).toEqual([
        '1st',
        '+2',
        'Otherworldly Patron, Pact Magic',
        '2',
        '2',
        '1',
        '1st',
        '',
      ]);
      // L20: 4 slots at slot level 5th, 8 invocations known.
      expect(data.rows[19]).toEqual([
        '20th',
        '+6',
        'Eldritch Master',
        '4',
        '15',
        '4',
        '5th',
        '8',
      ]);
    });

    it('preserves Fighter repeated-use feature details (eshyra-4a7.6)', () => {
      // Fighter extracts one line per row (Features is the wrapping last
      // column). Repeated-use parentheticals are kept verbatim in the cell;
      // no second feature body is created.
      const fighter = table('table:the-fighter');
      const data = fighter?.data as { columns: string[]; rows: string[][] };
      expect(data.columns).toEqual(['Level', 'Proficiency Bonus', 'Features']);
      expect(data.rows).toHaveLength(20);
      expect(data.rows[1]).toEqual(['2nd', '+2', 'Action Surge (one use)']);
      // The 17th-level row's wrapped Features cell re-joins and keeps both
      // repeated-use updates verbatim.
      expect(data.rows[16]).toEqual([
        '17th',
        '+6',
        'Action Surge (two uses), Indomitable (three uses)',
      ]);
    });

    it('pins the Sorcerer Sorcery Points and Monk Ki resource columns (eshyra-4a7.6)', () => {
      const sorcerer = table('table:the-sorcerer');
      const sData = sorcerer?.data as { columns: string[]; rows: string[][] };
      expect(sData.columns).toEqual([
        'Level',
        'Proficiency Bonus',
        'Sorcery Points',
        'Features',
        'Cantrips Known',
        'Spells Known',
        '1st',
        '2nd',
        '3rd',
        '4th',
        '5th',
        '6th',
        '7th',
        '8th',
        '9th',
      ]);
      // L1 has no Sorcery Points (blank); L2 grants 2.
      expect(sData.rows[0][2]).toBe('');
      expect(sData.rows[1][2]).toBe('2');
      expect(sData.rows[19][2]).toBe('20');

      const monk = table('table:the-monk');
      const mData = monk?.data as { columns: string[]; rows: string[][] };
      expect(mData.columns).toEqual([
        'Level',
        'Proficiency Bonus',
        'Martial Arts',
        'Ki Points',
        'Unarmored Movement',
        'Features',
      ]);
      // L1: 1d4 martial arts, no Ki/Unarmored Movement yet (verbatim "—").
      expect(mData.rows[0]).toEqual([
        '1st',
        '+2',
        '1d4',
        '—',
        '—',
        'Unarmored Defense, Martial Arts',
      ]);
      expect(mData.rows[19]).toEqual([
        '20th',
        '+6',
        '1d10',
        '20',
        '+30 ft.',
        'Perfect Self',
      ]);
    });

    it('pins the Beast Shapes and Destroy Undead feature tables (eshyra-4a7.6)', () => {
      const beast = table('table:beast-shapes');
      expect(beast?.data).toMatchObject({
        columns: ['Level', 'Max. CR', 'Limitations', 'Example'],
        rows: [
          ['2nd', '1/4', 'No flying or swimming speed', 'Wolf'],
          ['4th', '1/2', 'No flying speed', 'Crocodile'],
          ['8th', '1', '—', 'Giant eagle'],
        ],
      });
      expect(beast?.provenance.locator).toBe('p. 20');

      const destroy = table('table:destroy-undead');
      expect(destroy?.data).toMatchObject({
        columns: ['Cleric Level', 'Destroys Undead of CR . . .'],
        rows: [
          ['5th', '1/2 or lower'],
          ['8th', '1 or lower'],
          ['11th', '2 or lower'],
          ['14th', '3 or lower'],
          ['17th', '4 or lower'],
        ],
      });
      expect(destroy?.provenance.locator).toBe('p. 17');
    });

    it('distinguishes source-blank cells from genuine em-dash cells (eshyra-4a7.6)', () => {
      // SRD 5.1 leaves an unavailable cell BLANK; it does NOT print a dash
      // there. Verified against the source text layer: across the whole
      // Classes chapter the only genuine table-cell em dashes are Monk L1
      // (Ki Points / Unarmored Movement) and Beast Shapes L8 (Limitations).
      // Every unavailable spell-slot cell and empty Features row carries no
      // glyph in the source, so it is emitted as "" — emitting "—" there would
      // fabricate a token the source does not print (ADR 0007). This test pins
      // both conventions so a future change that fabricates or drops a dash
      // fails loudly. (Raised in PR #205 review.)
      const rowsOf = (key: string) =>
        (table(key)?.data as { rows: string[][] }).rows;

      // --- genuine source em dashes are preserved verbatim ---
      // Monk L1: no Ki Points, no Unarmored Movement bonus yet.
      expect(rowsOf('table:the-monk')[0]).toEqual([
        '1st',
        '+2',
        '1d4',
        '—',
        '—',
        'Unarmored Defense, Martial Arts',
      ]);
      // Beast Shapes L8: no movement limitation.
      expect(rowsOf('table:beast-shapes')[2]).toEqual([
        '8th',
        '1',
        '—',
        'Giant eagle',
      ]);

      // --- source-blank cells are emitted as "" (NOT "—") ---
      // Bard empty Features rows (L7 index 6, L11 index 10) and the unavailable
      // high-level spell-slot columns at L1.
      const bard = rowsOf('table:the-bard');
      expect(bard[6][2]).toBe(''); // L7 Features: blank in source
      expect(bard[10][2]).toBe(''); // L11 Features: blank in source
      expect(bard[0].slice(6)).toEqual(['', '', '', '', '', '', '', '']); // L1 2nd–9th slots blank
      // Cleric L3 (index 2) Features blank; trailing slot columns blank.
      const cleric = rowsOf('table:the-cleric');
      expect(cleric[2][2]).toBe('');
      expect(cleric[0].slice(5)).toEqual(['', '', '', '', '', '', '', '']); // L1 2nd–9th slots blank
      // Half-casters: Paladin L1 (no spells at all) and Ranger L1 (no Spells
      // Known and no slots) leave those cells blank, not dashed.
      const paladin = rowsOf('table:the-paladin');
      expect(paladin[0]).toEqual([
        '1st',
        '+2',
        'Divine Sense, Lay on Hands',
        '',
        '',
        '',
        '',
        '',
      ]);
      const ranger = rowsOf('table:the-ranger');
      expect(ranger[0]).toEqual([
        '1st',
        '+2',
        'Favored Enemy, Natural Explorer',
        '',
        '',
        '',
        '',
        '',
        '',
      ]);
    });

    it('pins the subclass spell tables (eshyra-4a7.3)', () => {
      const oath = table('table:oath-of-devotion-spells');
      expect(oath?.data).toMatchObject({
        columns: ['Paladin Level', 'Spells'],
        rows: [
          ['3rd', 'protection from evil and good, sanctuary'],
          ['5th', 'lesser restoration, zone of truth'],
          ['9th', 'beacon of hope, dispel magic'],
          ['13th', 'freedom of movement, guardian of faith'],
          ['17th', 'commune, flame strike'],
        ],
      });
      expect(oath?.provenance.locator).toBe('p. 33');

      const life = table('table:life-domain-spells');
      expect(life?.data).toMatchObject({
        columns: ['Cleric Level', 'Spells'],
        rows: expect.arrayContaining([
          ['1st', 'bless, cure wounds'],
          ['9th', 'mass cure wounds, raise dead'],
        ]),
      });
      expect((life?.data as { rows: unknown[] }).rows).toHaveLength(5);

      // The Desert circle's 5th-level spells cell wraps across two extracted
      // lines ("protection from / energy") and must re-join.
      const desert = table('table:circle-of-the-land-desert');
      expect(desert?.name).toBe('Circle of the Land (Desert)');
      expect(desert?.data).toMatchObject({
        columns: ['Druid Level', 'Circle Spells'],
        rows: expect.arrayContaining([
          ['5th', 'create food and water, protection from energy'],
        ]),
      });
      expect((desert?.data as { rows: unknown[] }).rows).toHaveLength(4);

      const fiend = table('table:fiend-expanded-spells');
      expect(fiend?.data).toMatchObject({
        columns: ['Spell Level', 'Spells'],
        rows: expect.arrayContaining([['1st', 'burning hands, command']]),
      });
      expect((fiend?.data as { rows: unknown[] }).rows).toHaveLength(5);
    });

    it('pins the Sorcerer Creating Spell Slots table (eshyra-4a7.3)', () => {
      const slots = table('table:creating-spell-slots');
      expect(slots?.data).toMatchObject({
        columns: ['Spell Slot Level', 'Sorcery Point Cost'],
        rows: [
          ['1st', 2],
          ['2nd', 3],
          ['3rd', 5],
          ['4th', 6],
          ['5th', 7],
        ],
      });
      expect(slots?.provenance.locator).toBe('p. 43');
    });

    it('pins the magic-item option/property tables (eshyra-4a7.3)', () => {
      const gray = table('table:gray-bag-of-tricks');
      expect(gray?.data).toMatchObject({
        columns: ['d8', 'Creature'],
        rows: [
          [1, 'Weasel'],
          [2, 'Giant rat'],
          [3, 'Badger'],
          [4, 'Boar'],
          [5, 'Panther'],
          [6, 'Giant badger'],
          // The d8 7-8 rows cross the p210/p211 page break.
          [7, 'Dire wolf'],
          [8, 'Giant elk'],
        ],
      });
      expect(gray?.provenance.locator).toBe('p. 210');
      expect(
        (table('table:rust-bag-of-tricks')?.data as { rows: unknown[] }).rows,
      ).toHaveLength(8);
      expect(
        (table('table:tan-bag-of-tricks')?.data as { rows: unknown[] }).rows,
      ).toHaveLength(8);

      // Caption-less variety tables named after their owning items; the two
      // near-identical tables differ by header and rarity column values.
      const belt = table('table:belt-of-giant-strength');
      expect(belt?.data).toMatchObject({
        columns: ['Type', 'Strength', 'Rarity'],
        rows: expect.arrayContaining([
          ['Hill giant', 21, 'Rare'],
          ['Storm giant', 29, 'Legendary'],
        ]),
      });
      expect((belt?.data as { rows: unknown[] }).rows).toHaveLength(5);

      const potion = table('table:potion-of-giant-strength');
      expect(potion?.data).toMatchObject({
        columns: ['Type of Giant', 'Strength', 'Rarity'],
        rows: expect.arrayContaining([
          ['Hill giant', 21, 'Uncommon'],
          ['Storm giant', 29, 'Legendary'],
        ]),
      });
      expect((potion?.data as { rows: unknown[] }).rows).toHaveLength(5);

      const healing = table('table:potions-of-healing');
      expect(healing?.data).toMatchObject({
        columns: ['Potion of …', 'Rarity', 'HP Regained'],
        rows: [
          ['Healing', 'Common', '2d4 + 2'],
          ['Greater healing', 'Uncommon', '4d4 + 4'],
          ['Superior healing', 'Rare', '8d4 + 8'],
          ['Supreme healing', 'Very rare', '10d4 + 20'],
        ],
      });
      expect(healing?.provenance.locator).toBe('p. 234');
    });

    it('pins the magic-item dice-result tables (eshyra-4a7.3)', () => {
      // Wrapped-d100 rows: a range or zero-padded single value opens a row
      // and following cell lines re-join into the effect cell.
      const beans = table('table:bag-of-beans');
      expect(beans?.data).toMatchObject({ columns: ['d100', 'Effect'] });
      const beanRows = (beans?.data as { rows: [string, string][] }).rows;
      expect(beanRows).toHaveLength(12);
      expect(beanRows.map((row) => row[0])).toEqual([
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
      // The 81-90 effect cell crosses the p209/p210 page break intact.
      expect(beanRows[9][1]).toBe(
        'A nest of 1d4 + 3 eggs springs up. Any creature that eats an egg must make a DC 20 Constitution saving throw. On a successful save, a creature permanently increases its lowest ability score by 1, randomly choosing among equally low scores. On a failed save, the creature takes 10d6 force damage from an internal magical explosion.',
      );
      expect(beans?.provenance.locator).toBe('p. 209');

      const robe = table('table:robe-of-useful-items');
      expect(robe?.data).toMatchObject({ columns: ['d100', 'Patch'] });
      const robeRows = (robe?.data as { rows: [string, string][] }).rows;
      expect(robeRows).toHaveLength(13);
      expect(robeRows[0]).toEqual(['01–08', 'Bag of 100 gp']);
      expect(robeRows[12]).toEqual(['97–00', 'Portable ram']);

      const wand = table('table:wand-of-wonder');
      expect(wand?.data).toMatchObject({ columns: ['d100', 'Effect'] });
      const wandRows = (wand?.data as { rows: [string, string][] }).rows;
      expect(wandRows).toHaveLength(22);
      expect(wandRows[0]).toEqual(['01–05', 'You cast slow.']);
      expect(wandRows[21][0]).toBe('98–00');
      expect(wand?.provenance.locator).toBe('p. 250');
    });

    it('pins the Donning and Doffing Armor table (eshyra-4a7.3)', () => {
      const donning = table('table:donning-and-doffing-armor');
      expect(donning?.data).toMatchObject({
        columns: ['Category', 'Don', 'Doff'],
        rows: [
          ['Light Armor', '1 minute', '1 minute'],
          ['Medium Armor', '5 minutes', '1 minute'],
          ['Heavy Armor', '10 minutes', '5 minutes'],
          ['Shield', '1 action', '1 action'],
        ],
      });
      expect(donning?.provenance.locator).toBe('p. 64');
    });

    it('emits Spellcasting Services as a rule rather than lost prose (eshyra-0m9.19)', () => {
      const rule = pack.records.find(
        (record) => record.key === 'rule:spellcasting-services',
      );
      expect(
        rule,
        'expected rule:spellcasting-services in the pack',
      ).toBeDefined();
      expect(rule?.kind).toBe('rule');
      expect(rule?.name).toBe('Spellcasting Services');
      const text = (rule?.data as { text: string }).text;
      expect(text).toContain('no established pay rates exist');
      expect(text).toContain('10 to 50 gold pieces');
      // The body is one reflowed block bounded by the Feats chapter — no
      // "Feats" heading should bleed in.
      expect(text).not.toContain('Feats');
      expect(rule?.provenance.locator).toBe('p. 74');
    });
  });

  describe('Races and Equipment guidance (eshyra-4a7.10.1)', () => {
    function rule(key: string): (typeof pack.records)[number] {
      const record = pack.records.find((candidate) => candidate.key === key);
      expect(record, `expected ${key} in the committed pack`).toBeDefined();
      return record as (typeof pack.records)[number];
    }

    function ruleText(key: string): string {
      return (rule(key).data as { text: string }).text;
    }

    it('emits the complete racial-trait category hierarchy from p3', () => {
      const expectedKeys = [
        'rule:racial-traits',
        'rule:ability-score-increase',
        'rule:age',
        'rule:racial-traits-alignment',
        'rule:racial-traits-size',
        'rule:racial-traits-speed',
        'rule:racial-traits-languages',
        'rule:subraces',
      ];
      for (const key of expectedKeys) {
        expect(rule(key).provenance.locator).toBe('p. 3');
      }
      expect(ruleText('rule:racial-traits')).toContain(
        'following entries appear among the traits of most races',
      );
      expect(ruleText('rule:age')).toContain('expected lifespan');
      expect(ruleText('rule:racial-traits-size')).toContain(
        'Small characters have trouble wielding heavy weapons',
      );
      expect(ruleText('rule:subraces')).toContain('traits of the parent race');
    });

    it('emits armor and weapon guidance without table-cell leakage', () => {
      expect(
        rule('rule:getting-into-and-out-of-armor').provenance.locator,
      ).toBe('p. 64');
      expect(ruleText('rule:getting-into-and-out-of-armor')).toContain(
        'reduce this time by half',
      );
      expect(ruleText('rule:weapons')).toContain(
        'classified as either melee or ranged',
      );
      expect(rule('rule:weapons').name).toBe('Weapons Guidance');
      expect(ruleText('rule:weapon-proficiency')).toContain(
        'you do not add your proficiency bonus',
      );
      expect(ruleText('rule:weapon-properties')).toContain(
        'Ammunition. You can use a weapon',
      );
      expect(ruleText('rule:improvised-weapons')).toContain(
        'any object you can wield in one or two hands',
      );
      expect(ruleText('rule:silvered-weapons')).toContain(
        'ten pieces of ammunition for 100 gp',
      );
      expect(ruleText('rule:special-weapons')).toContain(
        'a net is restrained until it is freed',
      );
      for (const key of [
        'rule:weapon-proficiency',
        'rule:improvised-weapons',
        'rule:special-weapons',
      ]) {
        const text = ruleText(key);
        expect(text).not.toContain('Name Cost Damage Weight Properties');
        expect(text).not.toContain('Disadvantage 45 lb.');
        expect(text).not.toContain('Club 1 sp 1d4');
      }
    });

    it('emits the bounded Self-Sufficiency sidebar from p73', () => {
      const selfSufficiency = rule('rule:self-sufficiency');
      expect(selfSufficiency.provenance.locator).toBe('p. 73');
      const text = (selfSufficiency.data as { text: string }).text;
      expect(text).toContain('doesn’t require you to spend any coin');
      expect(text).toContain('equivalent of a comfortable lifestyle');
      expect(text).not.toContain('Food, Drink, and Lodging');
    });
  });

  describe('Beyond 1st Level character rules (eshyra-0m9.18)', () => {
    function ruleText(key: string): string {
      const record = pack.records.find(
        (candidate) => candidate.kind === 'rule' && candidate.key === key,
      );
      expect(record, `expected ${key} in the committed pack`).toBeDefined();
      return (record?.data as { text: string }).text;
    }

    it('emits the chapter intro as the character-advancement rule', () => {
      // The "Beyond 1st Level" chapter intro precedes any heading in the
      // slice, so it is emitted via parseRules's chapterIntro option. It IS
      // the SRD's advancement prose: gaining levels, the ability-score cap,
      // and per-level hit-point increases.
      const text = ruleText('rule:beyond-1st-level');
      expect(text).toContain('This advancement is called gaining a level.');
      expect(text).toContain('can’t increase an ability score above 20');
      expect(text).toContain('you gain 1 additional Hit Die');
      // The Character Advancement table that follows the intro is its own
      // `table` record; its rows must not bleed into the intro body.
      expect(text).not.toContain('305,000');
      const record = pack.records.find(
        (candidate) => candidate.key === 'rule:beyond-1st-level',
      );
      expect(record?.name).toBe('Beyond 1st Level');
      expect(record?.provenance.locator).toBe('p. 56');
    });

    it('emits the multiclassing rule tree with parent-qualified collisions', () => {
      expect(ruleText('rule:multiclassing')).toContain(
        'gain levels in multiple classes',
      );
      expect(ruleText('rule:prerequisites')).toContain(
        'ability score prerequisites for both your current class',
      );
      expect(ruleText('rule:experience-points')).toContain(
        'cleric 6/fighter 1',
      );
      expect(ruleText('rule:hit-points-and-hit-dice')).toContain(
        'pool of Hit Dice',
      );
      expect(ruleText('rule:proficiencies')).toContain(
        'only some of new class’s starting proficiencies',
      );
      expect(ruleText('rule:class-features')).toContain(
        'Channel Divinity, Extra Attack, Unarmored Defense, and Spellcasting',
      );
      // The chapter's "Proficiency Bonus" title collides with the core-rules
      // rule:proficiency-bonus, so it parent-qualifies; both records coexist
      // with distinct bodies.
      const multiclassPb = ruleText('rule:multiclassing-proficiency-bonus');
      expect(multiclassPb).toContain('fighter 3/rogue 2');
      const corePb = ruleText('rule:proficiency-bonus');
      expect(corePb).not.toContain('fighter 3/rogue 2');
    });

    it('keeps the multiclass Spellcasting rule complete and free of the slot table', () => {
      const text = ruleText('rule:spellcasting');
      // The run-in bold leads ("Spells Known and Prepared.", "Spell Slots.",
      // "Pact Magic.") are body paragraphs, not headings — they stay in this
      // record.
      expect(text).toContain('Spells Known and Prepared.');
      expect(text).toContain('Spell Slots.');
      expect(text).toContain('Pact Magic.');
      // The Multiclass Spellcaster table that follows is its own `table`
      // record; neither its caption nor its rows bleed in.
      expect(text).not.toContain('Lvl.');
      expect(text).not.toContain('Spell Slots per Spell Level');
    });

    it('emits the Alignment, Languages, and Inspiration sections', () => {
      const alignment = ruleText('rule:alignment');
      expect(alignment).toContain('nine distinct alignments');
      expect(alignment).toContain('Chaotic evil (CE)');
      // The "Alignment in the Multiverse" leaf is its own record, not part of
      // the parent body.
      expect(alignment).not.toContain('unaligned');
      expect(ruleText('rule:alignment-in-the-multiverse')).toContain(
        'unaligned',
      );

      const languages = ruleText('rule:languages');
      expect(languages).toContain('thieves’ cant');
      // The Standard/Exotic Languages tables are table records; no row text.
      expect(languages).not.toContain('Dwarvish Dwarves');

      expect(ruleText('rule:inspiration')).toContain(
        'reward you for playing your character',
      );
      expect(ruleText('rule:gaining-inspiration')).toContain(
        'can’t stockpile multiple “inspirations”',
      );
      expect(ruleText('rule:using-inspiration')).toContain(
        'gives you advantage on that roll',
      );
    });

    it('keeps the chapter table captions out of the rule kind', () => {
      const ruleNames = new Set(
        pack.records
          .filter((record) => record.kind === 'rule')
          .map((record) => record.name),
      );
      for (const caption of [
        'Character Advancement',
        'Multiclassing Prerequisites',
        'Multiclassing Proficiencies',
        'Multiclass Spellcaster:',
        'Spell Slots per Spell Level',
        'Standard Languages',
        'Exotic Languages',
      ]) {
        expect(ruleNames.has(caption), `no rule named "${caption}"`).toBe(
          false,
        );
      }
    });
  });

  describe('Magic Items usage rules (eshyra-0m9.21)', () => {
    function ruleRecord(key: string) {
      const record = pack.records.find(
        (candidate) => candidate.kind === 'rule' && candidate.key === key,
      );
      expect(record, `expected ${key} in the committed pack`).toBeDefined();
      return record;
    }

    function ruleText(key: string): string {
      return (ruleRecord(key)?.data as { text: string }).text;
    }

    it('emits the chapter intro as rule:magic-items with p206 provenance', () => {
      const record = ruleRecord('rule:magic-items');
      expect(record?.name).toBe('Magic Items');
      expect(record?.provenance.locator).toBe('p. 206');
      const text = ruleText('rule:magic-items');
      expect(text).toContain('gleaned from the hoards of conquered monsters');
      // The intro is bounded at the first heading; the Attunement body must
      // not bleed in.
      expect(text).not.toContain('attunement');
    });

    it('keeps the complete Attunement rule as one record', () => {
      const text = ruleText('rule:attunement');
      // The four pillars of the SRD attunement rules, in one body: the bond
      // and its prerequisites, the short-rest procedure, the three-item
      // limit, and how attunement ends.
      expect(text).toContain('This bond is called attunement');
      expect(text).toContain(
        'requires a creature to spend a short rest focused on only that item',
      );
      expect(text).toContain('no more than three magic items at a time');
      expect(text).toContain('more than 100 feet away for at least 24 hours');
      // Bounded at the next section heading.
      expect(text).not.toContain('Wearing and Wielding');
      expect(ruleRecord('rule:attunement')?.provenance.locator).toBe('p. 206');
    });

    it('emits the wearing/wielding tree with its leaves as separate records', () => {
      const wearing = ruleText('rule:wearing-and-wielding-items');
      expect(wearing).toContain('must be donned in the intended fashion');
      // The two h≈13.9 leaves are their own records, not part of the parent.
      expect(wearing).not.toContain('more than one pair of footwear');
      expect(ruleText('rule:multiple-items-of-the-same-kind')).toContain(
        'more than one pair of footwear',
      );
      expect(ruleText('rule:paired-items')).toContain(
        'impart their benefits only if both items of the pair are worn',
      );
    });

    it('emits the activation tree with its four leaves as separate records', () => {
      const activating = ruleText('rule:activating-an-item');
      expect(activating).toContain(
        'rogue’s Fast Hands can’t be used to activate the item',
      );
      expect(ruleText('rule:command-word')).toContain(
        'can’t be activated in an area where sound is prevented',
      );
      expect(ruleText('rule:consumables')).toContain(
        'Once used, a consumable item loses its magic',
      );
      // rule:spells is the "Activating an Item > Spells" leaf: casting a
      // spell FROM an item.
      const spells = ruleText('rule:spells');
      expect(spells).toContain('cast at the lowest possible spell level');
      expect(spells).toContain(
        'your spellcasting ability modifier is +0 for the item',
      );
      const charges = ruleText('rule:charges');
      expect(charges).toContain('revealed when an identify spell is cast');
      // Charges is the chapter's last rule; the A-Z slice owns everything
      // after the "Magic Items A-Z" boundary, so no item entry bleeds in.
      expect(charges).not.toContain('Adamantine');
      expect(ruleRecord('rule:charges')?.provenance.locator).toBe('p. 207');
    });
  });

  describe('Traps general rules (eshyra-0m9.20)', () => {
    function ruleRecord(key: string) {
      const record = pack.records.find(
        (candidate) => candidate.kind === 'rule' && candidate.key === key,
      );
      expect(record, `expected ${key} in the committed pack`).toBeDefined();
      return record;
    }

    function ruleText(key: string): string {
      return (ruleRecord(key)?.data as { text: string }).text;
    }

    it('emits the chapter intro as rule:traps with p195 provenance', () => {
      const record = ruleRecord('rule:traps');
      expect(record?.name).toBe('Traps');
      expect(record?.provenance.locator).toBe('p. 195');
      const text = ruleText('rule:traps');
      // The intro describes what traps are; bounded at the first heading.
      expect(text).toContain('trap');
      expect(text).not.toContain('Traps in Play');
    });

    it('emits rule:traps-in-play with body bounded at next heading', () => {
      const text = ruleText('rule:traps-in-play');
      expect(text.length).toBeGreaterThan(0);
      // Must not bleed into Triggering a Trap.
      expect(text).not.toContain('Triggering a Trap');
    });

    it('emits rule:triggering-a-trap and rule:detecting-and-disabling-a-trap', () => {
      expect(ruleText('rule:triggering-a-trap').length).toBeGreaterThan(0);
      expect(
        ruleText('rule:detecting-and-disabling-a-trap').length,
      ).toBeGreaterThan(0);
    });

    it('emits rule:trap-effects without emitting the two table captions as rules', () => {
      const text = ruleText('rule:trap-effects');
      expect(text.length).toBeGreaterThan(0);
      // TABLE_CAPTION_LEAF_TITLES prevents the two h≈12 table caption headings
      // from being emitted as standalone rule records — the `table` kind owns
      // those. The caption names DO appear in the "Trap Effects" body prose as
      // SRD cross-references; checking keys rather than body text is correct.
      const ruleKeys = pack.records
        .filter((r) => r.kind === 'rule')
        .map((r) => r.key);
      expect(ruleKeys).not.toContain('rule:trap-save-dcs-and-attack-bonuses');
      expect(ruleKeys).not.toContain('rule:damage-severity-by-level');
    });

    it('emits rule:complex-traps without leaking sample-trap entries', () => {
      const text = ruleText('rule:complex-traps');
      expect(text.length).toBeGreaterThan(0);
      // The slice is truncated before "Sample Traps"; no sample trap name
      // should appear in the complex-traps rule body.
      expect(text).not.toContain('Collapsing Roof');
    });

    it('keeps sample traps as hazard records only', () => {
      // The slice is bounded before "Sample Traps", so no sample trap name
      // appears as a rule key.
      const ruleKeys = pack.records
        .filter((r) => r.kind === 'rule')
        .map((r) => r.key);
      expect(ruleKeys).not.toContain('rule:collapsing-roof');
      expect(ruleKeys).not.toContain('rule:sphere-of-annihilation');
      expect(ruleKeys).not.toContain('rule:sample-traps');
      // All 8 sample traps remain as hazard records.
      expect(
        pack.records.find((r) => r.key === 'hazard:collapsing-roof'),
      ).toBeDefined();
      expect(
        pack.records.find((r) => r.key === 'hazard:sphere-of-annihilation'),
      ).toBeDefined();
    });
  });

  describe('Monster stat-block interpretation rules (eshyra-0m9.22)', () => {
    function ruleRecord(key: string) {
      const record = pack.records.find(
        (candidate) => candidate.kind === 'rule' && candidate.key === key,
      );
      expect(record, `expected ${key} in the committed pack`).toBeDefined();
      return record;
    }

    function ruleText(key: string): string {
      return (ruleRecord(key)?.data as { text: string }).text;
    }

    it('emits the chapter intro as rule:monsters with p254 provenance', () => {
      const record = ruleRecord('rule:monsters');
      expect(record?.name).toBe('Monsters');
      expect(record?.provenance.locator).toBe('p. 254');
      const text = ruleText('rule:monsters');
      expect(text).toContain(
        'statistics, sometimes referred to as its stat block',
      );
      // Bounded at the first heading ("Size").
      expect(text).not.toContain('Tiny, Small, Medium');
    });

    it('parent-qualifies the seven section titles other slices already own', () => {
      // The chapterIntro option seeds "Monsters" as the tier-0 ancestor, so
      // these qualify against the existing core / Beyond-1st-Level keys
      // instead of degrading to numeric suffixes. The record NAME stays the
      // bare SRD title.
      const qualified: readonly (readonly [string, string, string])[] = [
        ['rule:monsters-alignment', 'Alignment', 'alignment specified in'],
        ['rule:monsters-armor-class', 'Armor Class', 'natural armor'],
        ['rule:monsters-speed', 'Speed', 'how far it can move on its turn'],
        [
          'rule:monsters-saving-throws',
          'Saving Throws',
          'adept at resisting certain kinds of effects',
        ],
        ['rule:monsters-skills', 'Skills', 'proficient in one or more skills'],
        [
          'rule:monsters-languages',
          'Languages',
          'can speak are listed in alphabetical order',
        ],
        [
          'rule:monsters-reactions',
          'Reactions',
          'something special with its reaction',
        ],
      ];
      const ruleKeys = new Set(
        pack.records.filter((r) => r.kind === 'rule').map((r) => r.key),
      );
      for (const [key, name, snippet] of qualified) {
        expect(ruleRecord(key)?.name).toBe(name);
        expect(ruleText(key)).toContain(snippet);
        // No degenerate numeric-suffix fallback for any of them.
        const bare = key.replace('rule:monsters-', 'rule:');
        expect(ruleKeys.has(`${bare}-2`), `no ${bare}-2`).toBe(false);
      }
    });

    it('qualifies colliding leaves with their section parent', () => {
      // Blindsight / Darkvision / Truesight collide with the core Vision and
      // Light leaves; Experience Points and Spellcasting collide with
      // Beyond-1st-Level keys. Each qualifies with its nearest parent.
      expect(ruleText('rule:senses-blindsight')).toContain(
        'perceive its surroundings without relying on sight',
      );
      expect(ruleText('rule:senses-darkvision')).toContain(
        'see in the dark within a specific radius',
      );
      expect(ruleText('rule:senses-truesight')).toContain(
        'see in normal and magical darkness',
      );
      // Tremorsense has no core counterpart and keeps its bare slug.
      expect(ruleText('rule:tremorsense')).toContain(
        'detect and pinpoint the origin of vibrations',
      );
      expect(ruleRecord('rule:challenge-experience-points')?.name).toBe(
        'Experience Points',
      );
      expect(ruleText('rule:special-traits-spellcasting')).toContain(
        'spellcaster level and spell slots',
      );
    });

    it('emits each movement mode as its own bounded record', () => {
      expect(ruleText('rule:burrow')).toContain(
        'move through sand, earth, mud, or ice',
      );
      expect(ruleText('rule:climb')).toContain('vertical surfaces');
      expect(ruleText('rule:fly')).toContain('ability to hover');
      expect(ruleText('rule:swim')).toContain(
        'doesn’t need to spend extra movement to swim',
      );
      // The parent Speed section keeps only its intro prose.
      expect(ruleText('rule:monsters-speed')).not.toContain(
        'vertical surfaces',
      );
    });

    it('merges the wrapped Vulnerabilities heading into one record', () => {
      const record = ruleRecord(
        'rule:vulnerabilities-resistances-and-immunities',
      );
      expect(record?.name).toBe('Vulnerabilities, Resistances, and Immunities');
      expect(
        ruleText('rule:vulnerabilities-resistances-and-immunities'),
      ).toContain('vulnerability, resistance, or immunity');
    });

    it('emits the three gray callout boxes as standalone rules', () => {
      expect(ruleText('rule:modifying-creatures')).toContain(
        'might change its challenge rating',
      );
      expect(ruleText('rule:armor-weapon-and-tool-proficiencies')).toContain(
        'proficient with its armor, weapons, and tools',
      );
      expect(ruleText('rule:grapple-rules-for-monsters')).toContain(
        'DC is 10 + the monster’s Strength (Athletics)',
      );
    });

    it('keeps the section prose that resumes below a printed table', () => {
      // The Hit Points section continues after the Hit Dice by Size table
      // with the Constitution-modifier paragraph; excluding the caption must
      // drop only the table rows, not that resuming prose.
      const text = ruleText('rule:hit-points');
      expect(text).toContain('as shown in the Hit Dice by Size table');
      expect(text).toContain(
        'Constitution modifier also affects the number of hit points',
      );
      // The table rows themselves stay out of the rule body.
      expect(text).not.toContain('Gargantuan d20');
    });

    it('recovers the same resuming prose in the pre-existing core captions', () => {
      // Incidental, source-confirmed recoveries produced by the same fix
      // (eshyra-0m9.22): prose that resumes below the Ability Scores and
      // Modifiers, Typical Difficulty Classes, and Travel Pace tables was
      // previously swallowed with the excluded captions.
      expect(ruleText('rule:ability-scores-and-modifiers')).toContain(
        'subtract 10 from the ability score and then divide the total by 2',
      );
      expect(ruleText('rule:ability-checks')).toContain(
        'To make an ability check, roll a d20 and add the relevant ability',
      );
      const speed = ruleText('rule:speed');
      expect(speed).toContain('move at a normal, fast, or slow pace');
      expect(speed).toContain('Forced March.');
      // Table rows stay out: the Travel Pace table's distance cells do not
      // leak into the rule body.
      expect(speed).not.toContain('Fast 400 feet');
    });

    it('keeps the chapter table captions out of the rule kind', () => {
      const ruleNames = new Set(
        pack.records
          .filter((record) => record.kind === 'rule')
          .map((record) => record.name),
      );
      for (const caption of [
        'Size Categories',
        'Hit Dice by Size',
        'Proficiency Bonus by Challenge Rating',
        'Experience Points by Challenge Rating',
      ]) {
        expect(ruleNames.has(caption), `no rule named "${caption}"`).toBe(
          false,
        );
      }
    });

    it('does not leak stat-block entries into the rule kind', () => {
      // The rules sub-slice is truncated before "Monsters (A)", so no
      // alphabetic stat-block content can emit as a rule.
      const ruleKeys = pack.records
        .filter((r) => r.kind === 'rule')
        .map((r) => r.key);
      expect(ruleKeys).not.toContain('rule:aboleth');
      expect(ruleKeys).not.toContain('rule:monsters-a');
      // Regional Effects is the chapter's last rules section; the Aboleth
      // stat block that follows the boundary must not bleed into it.
      expect(ruleText('rule:regional-effects')).not.toContain('Aboleth');
      // Creature records are unaffected.
      expect(
        pack.records.find((r) => r.key === 'creature:aboleth'),
      ).toBeDefined();
    });
  });

  // eshyra-0m9.17: the SRD 5.1 Backgrounds chapter. The lone Acolyte entry is
  // a `background` record with structured grant fields and a NESTED feature
  // (`data.feature`, not a top-level `feature` record — the dnd5e feature
  // schema requires a class/subclass grantor and grant level a background
  // feature does not have). The chapter-intro sections emit as `rule` records
  // (cross-slice title repeats parent-qualified to `rule:backgrounds-*`), and
  // the entry's four caption-less roll tables emit as `table` records with
  // synthesized "<Background> <Label>s" names.
  describe('Backgrounds chapter (eshyra-0m9.17)', () => {
    const acolyte = pack.records.find(
      (record) => record.key === 'background:acolyte',
    );
    const acolyteData = acolyte?.data as Record<string, unknown>;

    function ruleText(key: string): string {
      const record = pack.records.find(
        (candidate) => candidate.kind === 'rule' && candidate.key === key,
      );
      expect(record, `expected ${key} in the committed pack`).toBeDefined();
      return (record?.data as { text: string }).text;
    }

    it('emits Acolyte as the only background record with p60 provenance', () => {
      expect(acolyte?.kind).toBe('background');
      expect(acolyte?.name).toBe('Acolyte');
      expect(acolyte?.provenance.locator).toBe('p. 60');
      expect(
        pack.records.filter((record) => record.kind === 'background'),
      ).toHaveLength(1);
    });

    it('carries the structured grant fields verbatim from the source', () => {
      expect(acolyteData.skillProficiencies).toEqual(['Insight', 'Religion']);
      expect(acolyteData.languages).toBe('Two of your choice');
      expect(acolyteData.equipment).toBe(
        'A holy symbol (a gift to you when you entered the priesthood), a prayer book or prayer wheel, 5 sticks of incense, vestments, a set of common clothes, and a pouch containing 15 gp',
      );
      // Acolyte grants no tool proficiencies; the field must be absent.
      expect(acolyteData.toolProficiencies).toBeUndefined();
      expect(acolyteData.description).toMatch(
        /^You have spent your life in the service of a temple/,
      );
      // The description is the entry's own prose: neither the chapter intro
      // before the entry nor the grant block after it may bleed in.
      expect(acolyteData.description).not.toContain('Every story has a');
      expect(acolyteData.description).not.toContain('Skill Proficiencies');
    });

    it('nests Shelter of the Faithful and emits no top-level feature record for it', () => {
      const feature = acolyteData.feature as { name: string; text: string };
      expect(feature.name).toBe('Shelter of the Faithful');
      expect(feature.text).toMatch(
        /^As an acolyte, you command the respect of those who share your faith/,
      );
      expect(feature.text).toContain('call upon the priests for assistance');
      // The Suggested Characteristics section must not bleed into the feature.
      expect(feature.text).not.toContain('shaped by their experience');
      expect(
        pack.records.filter(
          (record) =>
            record.kind === 'feature' &&
            record.name === 'Shelter of the Faithful',
        ),
      ).toEqual([]);
    });

    it('keeps the Suggested Characteristics prose without roll-table rows', () => {
      expect(acolyteData.suggestedCharacteristics).toMatch(
        /^Acolytes are shaped by their experience in temples/,
      );
      expect(acolyteData.suggestedCharacteristics).not.toContain('I idolize');
    });

    it('emits the four roll tables with source columns and full row sets', () => {
      const expected: ReadonlyArray<
        readonly [key: string, columns: readonly string[], rowCount: number]
      > = [
        ['table:acolyte-personality-traits', ['d8', 'Personality Trait'], 8],
        ['table:acolyte-ideals', ['d6', 'Ideal'], 6],
        ['table:acolyte-bonds', ['d6', 'Bond'], 6],
        ['table:acolyte-flaws', ['d6', 'Flaw'], 6],
      ];
      for (const [key, columns, rowCount] of expected) {
        const record = pack.records.find((candidate) => candidate.key === key);
        expect(record, `expected ${key} in the committed pack`).toBeDefined();
        expect(record?.provenance.locator).toBe('p. 61');
        const data = record?.data as {
          columns: readonly string[];
          rows: readonly (readonly unknown[])[];
        };
        expect(data.columns).toEqual(columns);
        expect(data.rows).toHaveLength(rowCount);
        // Rows are the die faces in order, with wrapped text re-joined.
        data.rows.forEach((row, index) => {
          expect(row[0]).toBe(index + 1);
          expect(typeof row[1]).toBe('string');
        });
      }
    });

    it('re-joins wrapped roll-table rows onto their numbered row', () => {
      const personality = pack.records.find(
        (record) => record.key === 'table:acolyte-personality-traits',
      );
      const rows = (personality?.data as { rows: readonly unknown[][] }).rows;
      expect(rows[0][1]).toBe(
        'I idolize a particular hero of my faith, and constantly refer to that person’s deeds and example.',
      );
      expect(rows[7][1]).toBe(
        'I’ve spent so long in the temple that I have little practical experience dealing with people in the outside world.',
      );
    });

    it('emits the chapter intro as rule:backgrounds with p60 provenance', () => {
      const text = ruleText('rule:backgrounds');
      expect(text).toMatch(/^Every story has a beginning/);
      expect(text).toContain('what changed?');
      // Bounded at the first intro heading ("Proficiencies").
      expect(text).not.toContain('Each background gives a character');
    });

    it('parent-qualifies the three intro leaves other slices already own', () => {
      expect(ruleText('rule:backgrounds-proficiencies')).toContain(
        'proficiency in two skills',
      );
      expect(ruleText('rule:backgrounds-languages')).toContain(
        'additional languages beyond those given by race',
      );
      expect(ruleText('rule:backgrounds-equipment')).toContain(
        'package of starting equipment',
      );
    });

    it('emits the unique-titled intro leaves on bare slugs', () => {
      expect(ruleText('rule:suggested-characteristics')).toContain(
        'suggested personal characteristics',
      );
      expect(ruleText('rule:customizing-a-background')).toContain(
        'replace one feature with any other one',
      );
      // The intro rules region is truncated before the Acolyte entry, so no
      // entry content can emit as a rule.
      const ruleKeys = pack.records
        .filter((record) => record.kind === 'rule')
        .map((record) => record.key);
      expect(ruleKeys).not.toContain('rule:acolyte');
      expect(ruleText('rule:customizing-a-background')).not.toContain(
        'You have spent your life',
      );
    });
  });

  describe('audit findings', () => {
    it('reports no suspicious records', () => {
      const audit = auditPack(pack);
      expect(audit.suspiciousRecords).toEqual([]);
    });

    it('partially-populated optional fields match the reviewed baseline', () => {
      const audit = auditPack(pack);
      const compact = audit.missingFieldSummary.map((group) => ({
        kind: group.kind,
        field: group.field,
        missingCount: group.missingCount,
        totalInKind: group.totalInKind,
      }));
      expect(compact).toEqual(EXPECTED_PARTIAL_FIELDS);
    });
  });

  describe('hidden-Unicode hygiene', () => {
    // Read the committed records.json verbatim (not the parsed pack) so the
    // assertion covers the exact bytes that ship — the durable artifact a
    // consumer downloads — rather than a post-load reconstruction.
    const recordsJson = readFileSync(join(PACK_DIR, 'records.json'), 'utf8');

    for (const { name, codePoint } of FORBIDDEN_HYPHEN_CODE_POINTS) {
      it(`contains no ${name} (PDF hyphen-cluster artifact)`, () => {
        const count = [...recordsJson].filter(
          (ch) => ch.codePointAt(0) === codePoint,
        ).length;
        expect(count).toBe(0);
      });
    }
  });

  describe('source-manifest alignment with the vendored SRD artifact', () => {
    const sourceManifest = readSourceManifest();

    it('pack source title and version match the vendored manifest', () => {
      expect(pack.meta.source.sourceTitle).toBe(sourceManifest.sourceTitle);
      expect(pack.meta.source.sourceVersion).toBe(sourceManifest.sourceVersion);
    });

    it('pack license name matches the vendored manifest', () => {
      expect(pack.meta.license.licenseName).toBe(sourceManifest.license.name);
    });

    it('pack records carry the verbatim SRD 5.1 attribution text', () => {
      // The vendored manifest's attribution.text is the verbatim Legal
      // Information preamble from the SRD PDF (loreweaver-bnb). The pack-level
      // license MUST carry that exact string; each record's per-record license
      // copy MUST also carry it. Paraphrasing is a licensing regression.
      expect(pack.meta.license.attributionText).toBe(
        sourceManifest.attribution.text,
      );
      for (const record of pack.records) {
        expect(record.license.attributionText).toBe(
          sourceManifest.attribution.text,
        );
      }
    });

    it('every record provenance references the SRD 5.1 source URL', () => {
      const sourceUrl = pack.meta.source.sourceUrl;
      expect(typeof sourceUrl).toBe('string');
      for (const record of pack.records) {
        expect(record.provenance.sourceRef).toBe(sourceUrl);
      }
    });
  });

  // -----------------------------------------------------------------------
  // Structured class progression + cross-references (eshyra-4a7.6 PR2).
  // -----------------------------------------------------------------------
  describe('structured class progression (eshyra-4a7.6)', () => {
    const byKey = new Map(pack.records.map((r) => [r.key, r]));
    const data = (key: string) => {
      const rec = byKey.get(key);
      expect(rec, `expected ${key} in the committed pack`).toBeDefined();
      return rec?.data as Record<string, unknown>;
    };

    it('links the Barbarian class to its progression table and parses level 1 + resources', () => {
      const barb = data('class:barbarian');
      expect(barb.progressionTableRef).toBe('table:the-barbarian');
      expect(barb.features).toContain('feature:barbarian:rage');
      const progression = barb.progression as Array<Record<string, unknown>>;
      expect(progression).toHaveLength(20);
      // Level 1: Rage + Unarmored Defense, linked to their feature records.
      expect(progression[0]).toMatchObject({
        level: 1,
        proficiencyBonus: '+2',
        features: [
          { name: 'Rage', ref: 'feature:barbarian:rage' },
          {
            name: 'Unarmored Defense',
            ref: 'feature:barbarian:unarmored-defense',
          },
        ],
        resources: { rages: 2, rageDamage: '+2' },
      });
      // Level 20 preserves the verbatim "Unlimited" rages token.
      expect(progression[19].resources).toEqual({
        rages: 'Unlimited',
        rageDamage: '+4',
      });
    });

    it('represents a spellcaster spell-slot progression by level (Wizard)', () => {
      const progression = data('class:wizard').progression as Array<
        Record<string, unknown>
      >;
      expect(progression).toHaveLength(20);
      // L1: 3 cantrips known, two 1st-level slots, nothing higher.
      expect(progression[0].spellcasting).toEqual({
        cantripsKnown: 3,
        slots: { '1': 2 },
      });
      // L20: full 4/3/3/3/3/2/2/1/1 slot progression keyed by spell level.
      expect(progression[19].spellcasting).toEqual({
        cantripsKnown: 5,
        slots: {
          '1': 4,
          '2': 3,
          '3': 3,
          '4': 3,
          '5': 3,
          '6': 2,
          '7': 2,
          '8': 1,
          '9': 1,
        },
      });
    });

    it('exposes the Warlock Pact Magic columns and links Pact Magic as a feature ref', () => {
      const progression = data('class:warlock').progression as Array<
        Record<string, unknown>
      >;
      expect(progression[0]).toMatchObject({
        level: 1,
        features: [
          {
            name: 'Otherworldly Patron',
            ref: 'feature:warlock:otherworldly-patron',
          },
          { name: 'Pact Magic', ref: 'feature:warlock:pact-magic' },
        ],
        spellcasting: {
          cantripsKnown: 2,
          spellsKnown: 2,
          spellSlots: 1,
          slotLevel: '1st',
          invocationsKnown: null,
        },
      });
      expect(
        (progression[19].spellcasting as Record<string, unknown>)
          .invocationsKnown,
      ).toBe(8);
    });

    it('keeps Fighter repeated-use details as detail, not duplicate feature bodies', () => {
      const progression = data('class:fighter').progression as Array<
        Record<string, unknown>
      >;
      expect(progression[1].features).toEqual([
        {
          name: 'Action Surge',
          ref: 'feature:fighter:action-surge',
          detail: 'one use',
        },
      ]);
      // L17 references the SAME action-surge feature with the updated detail,
      // plus Indomitable — no second feature record is invented.
      expect(progression[16].features).toEqual([
        {
          name: 'Action Surge',
          ref: 'feature:fighter:action-surge',
          detail: 'two uses',
        },
        {
          name: 'Indomitable',
          ref: 'feature:fighter:indomitable',
          detail: 'three uses',
        },
      ]);
    });

    it('normalizes the Druid metal-armor restriction out of the proficiency token', () => {
      const druid = data('class:druid');
      expect(druid.armorProficiencies).toEqual([
        'Light armor',
        'medium armor',
        'shields',
      ]);
      expect(druid.proficiencyNotes).toEqual([
        {
          field: 'armorProficiencies',
          text: 'druids will not wear armor or use shields made of metal',
        },
      ]);
    });

    it('links subclass spell tables and feature-owned tables without duplicating rows', () => {
      expect(data('subclass:oath-of-devotion').spellTableRefs).toEqual([
        'table:oath-of-devotion-spells',
      ]);
      expect(data('subclass:circle-of-the-land').spellTableRefs).toHaveLength(
        7,
      );
      expect(data('feature:druid:wild-shape').tableRefs).toEqual([
        'table:beast-shapes',
      ]);
      // The flattened Beast Shapes rows were trimmed out of the feature prose.
      const wildShape = data('feature:druid:wild-shape').description as string;
      expect(wildShape).not.toMatch(/Giant eagle|Limitations Example/);
      expect(wildShape).toMatch(/as shown in the Beast Shapes table/);
    });
  });
});
