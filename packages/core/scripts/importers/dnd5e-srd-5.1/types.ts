/**
 * Internal types for the D&D 5e SRD 5.1 importer.
 *
 * Distinct from the canonical `RulesRecord` shape: these are intermediate
 * extraction structures that downstream `toRulesRecords` converts to records.
 */

export interface PageText {
  readonly pageNumber: number;
  readonly lines: readonly string[];
  /**
   * Rendered max font height (PDF user-space points) of each emitted line,
   * parallel to `lines`. The real SRD 5.1 extraction always populates it;
   * fixture PDFs that omit it leave it undefined.
   *
   * `headingLineIndexes` is a coarse boolean flag (h ≥ 14) tuned for section
   * anchoring; `lineHeights` exposes the full per-line height so a consumer
   * can reconstruct the finer rule heading hierarchy. The SRD core rules nest
   * four font tiers — chapter (h≈25.9), subsection (h≈18), and the rule-leaf
   * sub-/sub-subsections at h≈13.9 / h≈12 that fall below the anchor
   * threshold. `parseRules` reads this to emit a rule per leaf subsection
   * without dropping parents (loreweaver-yli).
   */
  readonly lineHeights?: readonly number[];
  /**
   * Per-line vertical baseline gap (PDF user-space points) from the PREVIOUS
   * line in the same column, parallel to `lines`. `null` marks a reading-order
   * discontinuity — the first line of a column or page, which has no in-column
   * predecessor. The real SRD 5.1 extraction always populates it; fixture PDFs
   * that omit it leave it undefined.
   *
   * Within a paragraph the gap is roughly the line height; the SRD prints a
   * noticeably larger gap before a new paragraph. `parseCreatures` uses this to
   * separate a stat block's mechanical body from the trailing flavor paragraph
   * the SRD prints after it (both at the same font height, so otherwise
   * indistinguishable), and to refuse content that arrives across a column/page
   * discontinuity (eshyra-76b7).
   */
  readonly lineGaps?: readonly (number | null)[];
  /**
   * Indexes into `lines` of the entries the extractor identified as
   * chapter / section headings, based on rendered font height. When
   * present, section anchors with `matchHeadings: true` match only at
   * these line positions — so an `^Equipment$` body-font line that
   * appears as a class-block subsection cannot shadow the actual
   * "Equipment" chapter title at heading font size, even when both
   * occurrences live on the same page.
   *
   * Indexes are used (not just heading text) because the same string can
   * legitimately occur in `lines` both as a heading and as body prose; a
   * text-only match would not distinguish them.
   *
   * Optional: fixture PDFs built with uniform font size (no heading
   * differentiation) leave this undefined, in which case `matchHeadings`
   * falls back to matching against `lines`. Real SRD 5.1 extraction always
   * populates it.
   */
  readonly headingLineIndexes?: readonly number[];
}

/**
 * A spell entry as extracted directly from the SRD source, before the
 * class-list cross-reference pass annotates `classes`.
 */
export interface SpellExtraction {
  readonly name: string;
  readonly level: number;
  readonly school: string;
  readonly ritual: boolean;
  readonly castingTime: string;
  readonly range: string;
  readonly components: readonly string[];
  readonly componentMaterials?: string;
  readonly duration: string;
  readonly description: string;
  readonly higherLevels?: string;
  /** 1-based page in the source PDF where the spell entry begins. */
  readonly sourcePage: number;
}

export type SpellCasterClass =
  | 'Bard'
  | 'Cleric'
  | 'Druid'
  | 'Paladin'
  | 'Ranger'
  | 'Sorcerer'
  | 'Warlock'
  | 'Wizard';

/**
 * Map from a spell name (verbatim from a class spell list) to the set of
 * caster classes whose lists include it.
 */
export type SpellClassIndex = ReadonlyMap<
  string,
  ReadonlySet<SpellCasterClass>
>;

/**
 * Map from a base-class name (e.g. "Fighter") to its primary/key abilities, as
 * read from the SRD 5.1 Multiclassing "Prerequisites" listing
 * (loreweaver-0m9.5.19). Mirrors how `SpellClassIndex` carries the spell→class
 * cross-reference parsed from a separate slice: the SRD's Class Features block
 * does not print a per-class primary-ability line (ADR 0007), so this listing
 * is the canonical source the class emitter merges into `data.primaryAbilities`.
 * The ability list preserves source order (so "Strength 13 or Dexterity 13"
 * yields `['Strength', 'Dexterity']`).
 */
export type ClassPrimaryAbilityIndex = ReadonlyMap<string, readonly string[]>;

/** One level of the exhaustion condition (levels 1–6). */
export interface ExhaustionLevel {
  readonly level: number;
  readonly effect: string;
}

/**
 * A condition entry as extracted from the SRD source, before conversion to a
 * `RulesRecord`. `effects` holds the individual bullet-point rules. `levels`
 * is only present for exhaustion — see the exhaustion decision note in
 * `parseConditions.ts`.
 */
export interface ConditionExtraction {
  readonly name: string;
  /** Full body text (re-flowed paragraphs, bullet markers stripped). */
  readonly description: string;
  /** Individual bullet-point effects with the marker stripped. */
  readonly effects: readonly string[];
  /** Exhaustion only: the six cumulative effect levels. */
  readonly levels?: readonly ExhaustionLevel[];
  /** 1-based page in the source PDF where the condition entry begins. */
  readonly sourcePage: number;
}

/**
 * A feat entry as extracted from the SRD source, before conversion to a
 * `RulesRecord`. `prerequisites` is the raw prerequisite text (e.g.
 * "Strength 13 or higher"); `description` is the benefit body, re-flowed.
 */
export interface FeatExtraction {
  readonly name: string;
  /** Raw prerequisite text, absent when the feat has none. */
  readonly prerequisites?: string;
  /** Benefit text, re-flowed into paragraphs. */
  readonly description: string;
  /** 1-based page in the source PDF where the feat entry begins. */
  readonly sourcePage: number;
}

/**
 * A hazard entry as extracted from the SRD source, before conversion to a
 * `RulesRecord`. SRD 5.1 hazards use plain prose paragraphs; description is
 * the full body text, re-flowed.
 */
export interface HazardExtraction {
  readonly name: string;
  /** Full body text, re-flowed into paragraphs. */
  readonly description: string;
  /** 1-based page in the source PDF where the hazard entry begins. */
  readonly sourcePage: number;
}

/** Whether the SRD labels a sample trap "Mechanical trap" or "Magic trap". */
export type TrapKind = 'mechanical' | 'magic';

/**
 * A sample-trap entry as extracted from the SRD 5.1 "Traps" section, before
 * conversion to a `RulesRecord`. Traps are emitted under the `hazard` record
 * kind (schema fit: both are description-only environmental dangers; see the
 * importer README's hazard/trap decision note), with `trapType` preserving the
 * SRD's "Mechanical trap" / "Magic trap" subtitle. `description` is the full
 * body text, re-flowed into paragraphs.
 */
export interface TrapExtraction {
  readonly name: string;
  readonly trapType: TrapKind;
  /** Full body text, re-flowed into paragraphs. */
  readonly description: string;
  /** 1-based page in the source PDF where the trap entry begins. */
  readonly sourcePage: number;
}

/**
 * A sample-disease entry extracted from the SRD 5.1 gamemastering "Diseases"
 * section (Cackle Fever, Sewer Plague, Sight Rot), before conversion to a
 * `RulesRecord`. Diseases are emitted under the `hazard` record kind with
 * `data.category: 'disease'` (schema fit: like traps, a disease is a
 * description-only danger with a save DC and effects; see the importer README's
 * hazard decision note and loreweaver-6ra). `description` is the full effect
 * text, re-flowed into paragraphs.
 */
export interface DiseaseExtraction {
  readonly name: string;
  /** Full effect text, re-flowed into paragraphs. */
  readonly description: string;
  /** 1-based page in the source PDF where the disease entry begins. */
  readonly sourcePage: number;
}

/** The four SRD 5.1 poison delivery types, lowercased from the source labels. */
export type PoisonType = 'contact' | 'ingested' | 'inhaled' | 'injury';

/**
 * A sample-poison entry extracted from the SRD 5.1 gamemastering "Poisons"
 * section (14 named poisons: Assassin's Blood … Wyvern Poison), before
 * conversion to a `RulesRecord`. Poisons are emitted under the `hazard` record
 * kind with `data.category: 'poison'` (schema fit identical to traps and
 * diseases; see loreweaver-6ra), with `poisonType` preserving the SRD delivery
 * type and `price` the reference-table price per dose. `description` is the full
 * effect text (including save DC and damage), re-flowed into paragraphs.
 */
export interface PoisonExtraction {
  readonly name: string;
  readonly poisonType: PoisonType;
  /** Price per dose, verbatim from the Poisons table (e.g. "150 gp"). Absent
   *  when the entry has no matching table row. */
  readonly price?: string;
  /** Full effect text, re-flowed into paragraphs. */
  readonly description: string;
  /** 1-based page in the source PDF where the poison entry begins. */
  readonly sourcePage: number;
}

/**
 * A rule-text entry as extracted from the SRD source, before conversion to a
 * `RulesRecord`. `text` is the full rule body, re-flowed into paragraphs.
 */
export interface RuleExtraction {
  readonly name: string;
  /**
   * Disambiguated record-key slug (the part after `rule:`). The heading
   * hierarchy parser sets this so cross-chapter title collisions ("Hit Points"
   * in both Constitution and Damage and Healing) and repeated cross-reference
   * sidebars get unique keys via parent qualification, while `name` keeps the
   * bare SRD leaf title. Absent on the legacy text-heuristic path (uniform-font
   * fixtures), where `emit` falls back to `slug(name)`.
   */
  readonly keySlug?: string;
  /** Full rule body text, re-flowed into paragraphs. */
  readonly text: string;
  /** Embedded reference tables owned by this rule, emitted as record keys. */
  readonly tableRefs?: readonly string[];
  /** 1-based page in the source PDF where the rule heading begins. */
  readonly sourcePage: number;
}

/**
 * A combat action entry as extracted from the SRD source, before conversion
 * to a `RulesRecord`. The body is captured as prose in `description`.
 */
export interface ActionExtraction {
  readonly name: string;
  readonly description: string;
  /** 1-based page in the source PDF where the action entry begins. */
  readonly sourcePage: number;
}

/**
 * A freestanding reference table as extracted from the SRD source, before
 * conversion to a `RulesRecord`. Rows intentionally allow mixed scalar cell
 * values because SRD tables commonly combine labels with numeric thresholds.
 */
export interface TableExtraction {
  readonly name: string;
  readonly columns: readonly string[];
  readonly rows: readonly (readonly unknown[])[];
  /**
   * Optional semantic projection of reviewed table rows. The source-preserving
   * `columns`/`rows` stay authoritative; projections expose a narrow typed view
   * for gameplay systems that need to apply the table mechanically.
   */
  readonly projection?: Record<string, unknown>;
  /** 1-based page in the source PDF where the table anchor appears. */
  readonly sourcePage: number;
  /**
   * Record that owns an embedded table in the source document. Import-only
   * metadata used to add navigation refs; it is not emitted on table records.
   */
  readonly ownerRecordKey?: string;
  /**
   * Verbatim linearization of the table's source region (caption — when the
   * anchor is the printed caption — plus header line(s) plus the contiguous
   * cell-tier run), normalized exactly as a prose joiner would render it
   * (trimmed lines joined by single spaces). When an embedded table's
   * caption/header/cells fall inside an owning record's body, the prose joiner
   * absorbs this same span into the record's description/text. The importer
   * strips this span from the owner's prose so the structured table:* record is
   * the sole representation of the tabular data (eshyra-3anh). Import-only; it
   * is not emitted on table records.
   */
  readonly proseSourceText?: string;
}

/**
 * Which Equipment-chapter table an extraction came from.
 *   - `weapon` / `armor` / `tool` / `gear`: the four Equipment-chapter tables.
 *   - `mount`: the Mounts and Other Animals table (cost / speed / carrying
 *     capacity), from the separate Mounts and Vehicles section.
 *   - `vehicle`: the Waterborne Vehicles table (cost / speed). The land
 *     "Tack, Harness, and Drawn Vehicles" table shares the gear cost/weight
 *     shape and is emitted as `gear` (loreweaver-4zu decision).
 *   - `pack`: an Equipment Pack bundle (cost + verbatim contents description).
 */
export type EquipmentCategory =
  | 'weapon'
  | 'armor'
  | 'tool'
  | 'gear'
  | 'mount'
  | 'vehicle'
  | 'pack';

/**
 * An equipment entry as extracted from the SRD source, before conversion to a
 * `RulesRecord`. SRD 5.1 presents equipment as tables, so the shared fields
 * (`cost`, `weight`) are verbatim cell text; category-specific structured
 * fields are present only for the matching `category`:
 *   - weapons carry `damageDie`, `damageType`, and `properties`;
 *   - armor carries `ac`, `armorType`, `stealthDisadvantage`, and (when the
 *     table lists one) `strengthRequirement`;
 *   - gear may carry `capacity` (attached from the Container Capacity table);
 *   - mounts carry `speed` (e.g. "50 ft.") and `carryingCapacity` (e.g.
 *     "480 lb."); waterborne vehicles carry `speed` (e.g. "4 mph");
 *   - described armor, weapons, gear, and tools carry source prose in
 *     `description`; packs carry their verbatim bundled-contents sentence.
 */
export interface EquipmentExtraction {
  readonly name: string;
  readonly category: EquipmentCategory;
  /** Verbatim cost cell, e.g. "2 gp". Absent when the table lists none. */
  readonly cost?: string;
  /** Verbatim weight cell, e.g. "1 lb.". Absent when the table lists none. */
  readonly weight?: string;
  /** Weapon damage die, e.g. "1d4". */
  readonly damageDie?: string;
  /** Weapon damage type, lowercased: "bludgeoning" | "piercing" | "slashing". */
  readonly damageType?: string;
  /** Weapon properties, e.g. ["Finesse", "light", "thrown (range 20/60)"]. */
  readonly properties?: readonly string[];
  /** Armor class text, e.g. "11 + Dex modifier" or "18". */
  readonly ac?: string;
  /** Armor weight class: "light" | "medium" | "heavy" | "shield". */
  readonly armorType?: string;
  /** Armor stealth-check disadvantage flag. */
  readonly stealthDisadvantage?: boolean;
  /** Minimum Strength score the armor requires, e.g. 15 for plate. */
  readonly strengthRequirement?: number;
  /**
   * Verbatim Container Capacity cell, e.g. "1 cubic foot/30 pounds of gear".
   * Attached to the matching `gear` record from the Container Capacity table.
   */
  readonly capacity?: string;
  /** Mount/vehicle speed cell, verbatim: "50 ft." (mounts) or "4 mph" (ships). */
  readonly speed?: string;
  /** Mount carrying-capacity cell, verbatim: "480 lb.". */
  readonly carryingCapacity?: string;
  /** Equipment-pack bundled-contents sentence, verbatim. */
  readonly description?: string;
  /** Source page where `description` begins when it differs from the table row. */
  readonly descriptionSourcePage?: number;
  /** 1-based page in the source PDF where the entry's row appears. */
  readonly sourcePage: number;
}

/**
 * A magic-item entry as extracted from the SRD 5.1 "Magic Items A-Z" section,
 * before conversion to a `kind=magic-item` `RulesRecord`.
 *
 * `itemType` is the category text before the first comma in the SRD header
 * line (for example, "Armor (medium or heavy, but not hide)" or "Wondrous
 * item"). `rarity` is the remaining rarity text after removing any attunement
 * parenthetical; variant items keep the full source rarity expression, such as
 * "uncommon (+1), rare (+2), or very rare (+3)". Embedded tables remain in
 * `description` for source fidelity and are also emitted as reviewed structured
 * `table` records by the document-wide parser.
 */
export interface MagicItemExtraction {
  readonly name: string;
  readonly itemType: string;
  readonly rarity: string;
  readonly requiresAttunement: boolean;
  readonly attunementRequirement?: string;
  readonly description: string;
  /**
   * Named source variants that belong to this item rather than standalone
   * magic-item records (for example the Figurines of Wondrous Power).
   */
  readonly variants?: readonly MagicItemVariant[];
  /** 1-based page in the source PDF where the item entry begins. */
  readonly sourcePage: number;
}

export interface MagicItemVariant {
  readonly name: string;
  readonly rarity: string;
  readonly text: string;
}

/**
 * One named racial trait as extracted from the SRD source: the bold "Label."
 * lead-in and its re-flowed body text. Trait labels in the SRD races chapter
 * are short noun phrases (e.g. "Ability Score Increase", "Age", "Alignment",
 * "Size", "Speed", "Languages", "Darkvision", "Dwarven Resilience").
 */
export interface AncestryTrait {
  readonly name: string;
  readonly text: string;
}

/**
 * A race (or subrace) entry as extracted from the SRD source, before
 * conversion to a `kind=ancestry` `RulesRecord`.
 *
 * SRD 5.1 uses the term "race"; the importer normalizes the record kind to
 * `ancestry` per ADR 0005 while preserving the source term in record data.
 *
 * Subrace handling (decision recorded on loreweaver-0m9.5.6): parent races and
 * subraces are emitted as **separate** ancestry records, and each subrace
 * record is **self-contained / flattened** — its `traits` already include the
 * parent's shared traits merged with the subrace's own additions, so a name
 * lookup of e.g. "Hill Dwarf" resolves to a fully usable record without having
 * to resolve the parent. `subraceOf` points back to the parent; the parent
 * lists its children in `subraces`. The cross-pack `overrides` field is
 * deliberately NOT used (it would hide the parent from the stack).
 */
export interface AncestryExtraction {
  readonly name: string;
  /** Intro / flavor prose for this race or subrace, re-flowed into paragraphs. */
  readonly description: string;
  /** Flattened trait list (parent + own for subraces). */
  readonly traits: readonly AncestryTrait[];
  /** Medium / Small / etc., parsed from the Size trait when present. */
  readonly size?: string;
  /** Base walking speed in feet, parsed from the Speed trait when present. */
  readonly speed?: number;
  /** Parent ancestry name (e.g. "Dwarf") when this is a subrace. */
  readonly subraceOf?: string;
  /** Child ancestry names (e.g. ["Hill Dwarf"]) when this is a parent. */
  readonly subraces?: readonly string[];
  /** 1-based page in the source PDF where the race/subrace entry begins. */
  readonly sourcePage: number;
}

/**
 * Whether a parsed stat block came from the main Monsters chapter / Appendix
 * MM-A (`monster`) or from Appendix MM-B: Nonplayer Characters (`npc`). Both
 * emit under the `creature` record kind (a stat block is a stat block — AC, HP,
 * speed, ability scores, CR — and is equally encounter-usable), but the NPC
 * provenance is preserved on the emitted record as a `data.category`
 * discriminator so callers can tell the two sets apart and so the monster
 * coverage baseline (`EXPECTED_SRD_5_1_CREATURE_NAMES`, exactly 296) stays
 * distinct from the NPC coverage baseline (`EXPECTED_SRD_5_1_NPC_NAMES`). See
 * loreweaver-bn0. Monster records carry no `category` field (the absence means
 * "monster"); only NPC records carry `category: 'npc'`.
 */
export type CreatureCategory = 'monster' | 'npc';

/**
 * The six 5e ability scores. Each is the raw score (1–30), not the modifier;
 * the SRD stat block prints both ("8 (−1)") but the canonical creature record
 * stores only the score.
 */
export interface CreatureAbilityScores {
  readonly strength: number;
  readonly dexterity: number;
  readonly constitution: number;
  readonly intelligence: number;
  readonly wisdom: number;
  readonly charisma: number;
}

/**
 * One named entry in a creature stat block's narrative body — a trait, action,
 * reaction, or legendary action (eshyra-yevt / eshyra-4a7.5). The `name` is the
 * SRD's bold lead-in (including any usage parenthetical it prints, e.g.
 * "Enslave (3/Day)", "Fire Breath (Recharge 5-6)"); `text` is the entry body
 * with wrapped lines re-flowed and multi-paragraph entries joined on blank
 * lines. Attack bonuses, damage expressions, save DCs, and recharge/usage text
 * are preserved verbatim in `text` — nothing is discarded.
 */
export interface CreatureStatBlockEntry {
  readonly name: string;
  readonly text: string;
}

/**
 * A creature's Legendary Actions section. The SRD prints an intro paragraph
 * ("The aboleth can take 3 legendary actions, …") before the named options, so
 * it is preserved as `description`; `entries` are the individual options
 * (Detect, Tail Swipe, …). Only legendary creatures carry this (eshyra-yevt).
 */
export interface CreatureLegendaryActions {
  readonly description?: string;
  readonly entries: readonly CreatureStatBlockEntry[];
}

/**
 * A creature variant sidebar (eshyra-70xr / eshyra-4a7.5). The SRD prints two
 * boxed "Variant: …" notes in the creature chapters — Diseased Giant Rats
 * (p378, an alternate bite + CR for the Giant Rat) and Insect Swarms (p391,
 * per-insect additions for the Swarm of Insects). `name` is the caption without
 * its "Variant: " label; `text` is the box body, verbatim with wrapped lines
 * re-joined. A variant box sits in the body of whatever creature precedes it,
 * but is attached to the creature it modifies via a reviewed target map.
 */
export interface CreatureVariant {
  readonly name: string;
  readonly text: string;
}

/**
 * A creature (monster) entry as extracted from the SRD source, before
 * conversion to a `kind=creature` `RulesRecord`. Mirrors the fields the
 * `dnd5e-srd` creature kindSchema requires (see `kindSchemas.ts`):
 *   - `size` is the capitalized size word ("Small", "Large", …);
 *   - `type` is the lowercase creature type as printed, with the subtype
 *     parenthetical preserved ("humanoid (goblinoid)", "dragon", "swarm of
 *     Tiny beasts"); validation is applied to the bare type word
 *     (loreweaver-2ze);
 *   - `armorClass` / `hitPoints` are the leading integers of the stat-block
 *     lines (the parenthetical AC source and HP dice expression are dropped);
 *   - `speed` maps movement modes to feet, the unlabeled base speed keyed as
 *     `walk` ({ walk: 30, climb: 30 });
 *   - `challengeRating` is the bare fraction/integer string ("1/4", "6"),
 *     without the XP parenthetical.
 */
export interface CreatureExtraction {
  readonly name: string;
  /**
   * Provenance discriminator: `monster` for the Monsters chapter / Appendix
   * MM-A, `npc` for Appendix MM-B: Nonplayer Characters (loreweaver-bn0). Only
   * the `npc` value is emitted onto the record (`data.category`); monster
   * records carry no category field.
   */
  readonly category: CreatureCategory;
  /**
   * Source-derived Monsters chapter taxonomy, from heading-only family/group
   * labels surrounding the stat block. Omitted for standalone monsters,
   * Appendix MM-A creatures, and Appendix MM-B NPCs.
   */
  readonly familyPath?: readonly string[];
  readonly size: string;
  readonly type: string;
  readonly alignment: string;
  readonly armorClass: number;
  readonly hitPoints: number;
  readonly speed: Readonly<Record<string, number>>;
  readonly challengeRating: string;
  readonly abilityScores: CreatureAbilityScores;
  // Keyed defensive / sense fields the SRD prints between the ability-score row
  // and the Challenge line (eshyra-ez6v / eshyra-4a7.5). Each is preserved
  // verbatim from the source, with values that wrap across extracted lines
  // re-joined. All optional — a stat block carries only the labels the SRD
  // prints for that creature (a simple beast may have only Senses + Languages).
  readonly savingThrows?: string;
  readonly skills?: string;
  readonly damageVulnerabilities?: string;
  readonly damageResistances?: string;
  readonly damageImmunities?: string;
  readonly conditionImmunities?: string;
  readonly senses?: string;
  readonly languages?: string;
  // Narrative body sections after the keyed fields (eshyra-yevt / eshyra-4a7.5).
  // Each is the SRD's bold-lead-in named entries, in source order; all optional
  // because a stat block carries only the sections it prints (a simple beast may
  // have only traits, a non-legendary creature no legendaryActions).
  readonly traits?: readonly CreatureStatBlockEntry[];
  readonly actions?: readonly CreatureStatBlockEntry[];
  readonly reactions?: readonly CreatureStatBlockEntry[];
  readonly legendaryActions?: CreatureLegendaryActions;
  /**
   * Source-derived flavor/description prose printed immediately after the stat
   * block (eshyra-76b7). Appendix MM-A creatures and Appendix MM-B NPCs print a
   * short descriptive paragraph after their last action/reaction; the SRD sets
   * it off with a larger paragraph gap (see `PageText.lineGaps`). It is moved
   * here verbatim, with blank-line paragraph breaks preserved as "\n\n", so it
   * never contaminates the mechanical action/reaction/legendary-action text.
   * Omitted when the creature prints no such prose (most Monsters-chapter
   * entries describe the creature before the stat block, not after).
   */
  readonly description?: string;
  // Boxed "Variant: …" sidebars that modify this creature (eshyra-70xr). Only
  // the Giant Rat and Swarm of Insects carry one in SRD 5.1; all other creatures
  // omit the field.
  readonly variants?: readonly CreatureVariant[];
  /** 1-based page in the source PDF where the creature stat block begins. */
  readonly sourcePage: number;
}

/**
 * Hit points of an abbreviated inline stat block (eshyra-4a7.4). The SRD prints
 * these two forms, both of which the strict integer `creature.hitPoints` cannot
 * represent:
 *   - a fixed amount with its dice expression — Giant Fly's "19 (3d10 + 3)"
 *     yields `{ value: 19, formula: "3d10 + 3" }`;
 *   - a derived/textual amount — Avatar of Death's "half the hit point maximum
 *     of its summoner" yields `{ special: "half the hit point maximum of its
 *     summoner" }`.
 * At least one field is always present.
 */
export interface StatBlockHitPoints {
  readonly value?: number;
  readonly formula?: string;
  readonly special?: string;
}

/**
 * Provenance for an inline stat block: the containing entry it was printed under
 * and the page it begins on. Source placement is recorded but does NOT gate
 * discoverability — the stat block is a top-level, name-resolvable record.
 */
export interface StatBlockInlineSource {
  readonly containingItem: string;
  readonly page: number;
}

/**
 * An abbreviated combat stat block defined INLINE under another entry — Avatar
 * of Death inside the Deck of Many Things, Giant Fly inside the Figurine of
 * Wondrous Power (eshyra-4a7.4) — extracted before conversion to a
 * `kind=stat-block` `RulesRecord`. These are NOT full creatures: their hit
 * points may be derived/textual and their challenge rating may be absent, so
 * they ride the permissive `stat-block` kindSchema instead of the strict
 * `creature` one. The shared combat fields mirror `CreatureExtraction`.
 */
export interface StatBlockExtraction {
  readonly name: string;
  readonly size: string;
  readonly type: string;
  readonly alignment: string;
  readonly armorClass: number;
  readonly hitPoints: StatBlockHitPoints;
  readonly speed: Readonly<Record<string, number>>;
  readonly abilityScores: CreatureAbilityScores;
  // Keyed trailing fields, preserved verbatim from the source so the record is
  // not silently incomplete (eshyra-4a7.4). All optional — an abbreviated block
  // carries only the ones the SRD prints.
  readonly savingThrows?: string;
  readonly skills?: string;
  readonly damageVulnerabilities?: string;
  readonly damageResistances?: string;
  readonly damageImmunities?: string;
  readonly conditionImmunities?: string;
  readonly senses?: string;
  readonly languages?: string;
  /**
   * The CR token verbatim, INCLUDING the "—" the SRD prints for a creature with
   * no meaningful challenge rating (Avatar of Death). Absent when the block has
   * no Challenge line at all (Giant Fly).
   */
  readonly challengeRating?: string;
  /** XP from the "Challenge … (N XP)" line when present. */
  readonly experiencePoints?: number;
  readonly traits?: readonly CreatureStatBlockEntry[];
  readonly actions?: readonly CreatureStatBlockEntry[];
  /** 1-based page in the source PDF where the stat block begins. */
  readonly sourcePage: number;
  /** The entry this block was printed inline under (e.g. "Deck of Many Things"). */
  readonly containingItem: string;
}

/**
 * A base-class entry as extracted from the SRD source, before conversion to a
 * `kind=class` `RulesRecord`. Mirrors the fields the `dnd5e-srd` class
 * kindSchema requires (see `validateDnd5eClass` in `kindSchemas.ts`):
 *   - `hitDie` is the die size N from "Hit Dice: 1dN per <class> level";
 *   - `armorProficiencies` / `weaponProficiencies` / `savingThrowProficiencies`
 *     are the parsed list values of the "Armor:" / "Weapons:" / "Saving Throws:"
 *     lines in the class's "Class Features" block ("None" maps to an empty
 *     array for proficiencies);
 *   - `primaryAbilities` is the parsed "Primary Ability" line.
 *
 * Scope (ADR 0009 / loreweaver-0m9.5.2): base classes only. Subclasses and
 * class features are separate record kinds parsed by separate beads
 * (loreweaver-0m9.5.16/0m9.5.17 and 0m9.5.15/0m9.5.18).
 */
/**
 * A source-backed proficiency/skill CHOICE entry (eshyra-4a7.6). The verbatim
 * source `text` is always preserved; `choose`/`from`/`any` carry the structure
 * parsed out of it where the shape is recognized ("Choose two from A, B, C",
 * "Choose any three", "Three musical instruments of your choice").
 */
export interface ClassChoiceEntry {
  readonly text: string;
  readonly choose?: number;
  readonly from?: readonly string[] | string;
  readonly any?: boolean;
}

/** A class's starting-equipment block: verbatim text plus per-option entries. */
export interface ClassStartingEquipment {
  readonly text: string;
  readonly entries?: readonly string[];
}

/**
 * A proficiency restriction/note lifted OUT of a normalized proficiency token
 * (eshyra-4a7.6) — e.g. the Druid's "druids will not wear armor or use shields
 * made of metal", which must not stay inside the `shields` armor token.
 */
export interface ClassProficiencyNote {
  readonly field: string;
  readonly text: string;
}

export interface ClassExtraction {
  readonly name: string;
  readonly hitDie: number;
  readonly primaryAbilities: readonly string[];
  readonly savingThrowProficiencies: readonly string[];
  readonly armorProficiencies: readonly string[];
  readonly weaponProficiencies: readonly string[];
  /** Tools: fixed grants ("Herbalism kit"); "None" -> []; absent -> undefined. */
  readonly toolProficiencies?: readonly string[];
  /** Tools: choice grants ("Three musical instruments of your choice"). */
  readonly toolProficiencyChoices?: readonly ClassChoiceEntry[];
  /** Skills: the source choice ("Choose two from …", Bard's "Choose any three"). */
  readonly skillChoices?: readonly ClassChoiceEntry[];
  /** The class's Equipment block (starting-equipment options). */
  readonly startingEquipment?: ClassStartingEquipment;
  /** Restrictions lifted out of normalized proficiency tokens (Druid metal). */
  readonly proficiencyNotes?: readonly ClassProficiencyNote[];
  /** 1-based page in the source PDF where the class's Hit Dice line begins. */
  readonly sourcePage: number;
}

/**
 * A subclass entry as extracted from the SRD source, before conversion to a
 * `kind=subclass` `RulesRecord`. Per ADR 0009 a subclass links to its parent
 * base class via `data.parentClass` (the parent class record's key); this
 * extraction carries the parent class NAME and `emit.ts` keys it as
 * `class:<slug>` (mirroring how ancestry `subraceOf` is keyed).
 *
 * The `dnd5e-srd` subclass kindSchema (`validateDnd5eSubclass`) requires
 * `parentClass` and a non-empty `description`. The optional granted-`features`
 * reference array is the responsibility of the feature parser
 * (loreweaver-0m9.5.18) and is intentionally not populated here.
 *
 * Scope (ADR 0009 / loreweaver-0m9.5.17): one record per SRD 5.1 subclass
 * (Champion, Life domain, School of Evocation, …). Base classes are separate
 * `class` records (loreweaver-0m9.5.2); class features are a separate `feature`
 * kind (loreweaver-0m9.5.18).
 */
export interface SubclassExtraction {
  readonly name: string;
  /** Parent base-class name (e.g. "Fighter"); emit keys it as class:<slug>. */
  readonly parentClass: string;
  /** Subclass body prose, re-flowed into paragraphs. */
  readonly description: string;
  /**
   * Named sub-subsection prose blocks that belong to this subclass but are not
   * granted features or spell tables (e.g. "Tenets of Devotion" on the Oath of
   * Devotion). Each carries the heading name and re-flowed body text.
   */
  readonly sections?: ReadonlyArray<{
    readonly name: string;
    readonly text: string;
  }>;
  /** 1-based page in the source PDF where the subclass heading begins. */
  readonly sourcePage: number;
}

/**
 * A class- or subclass-granted feature as extracted from the SRD source,
 * before conversion to a `kind=feature` `RulesRecord`. Per ADR 0009 a feature
 * links to its grantor through `data.source` (the granting class/subclass
 * record key) and records the `data.level` at which it is gained; `emit.ts`
 * keys the grantor from `grantorKind` + `grantorName` (mirroring how the
 * subclass parser carries the parent class NAME for emit to key).
 *
 * The `dnd5e-srd` feature kindSchema (`validateDnd5eFeature`) requires a
 * non-empty `description`, a `source` grantor key, and an integer `level >= 1`.
 *
 * Level note: `parseFeatures` treats class/subclass progression-table rows as
 * the primary source for the grant level. Leading prose clauses ("Starting at
 * 2nd level, ...", "Beginning when you choose this archetype at 3rd level,
 * ...") are only a fallback when no table anchor exists. A no-leadin feature
 * without a table anchor is not emitted, because silently defaulting to level 1
 * would corrupt the canonical record. Scope (ADR 0009 / loreweaver-0m9.5.18).
 */
/**
 * A structured player choice a feature requires at creation/level-up
 * (eshyra-o9bd.9) — Fighting Style, subclass selection, Metamagic, favored
 * enemy, ASI-vs-feat, etc. Mirrors the core `FeatureChoice` shape
 * (packages/core/src/rules/featureChoices.ts) that `emit.ts` writes to the
 * `feature.data.choices[]` field and the `choice-coverage` audit gate reads.
 * Each entry is EITHER structured (`choose` + optional `from`) OR a named
 * out-of-scope marker (`unsupported.reason`).
 */
export interface FeatureChoiceEntry {
  readonly id: string;
  readonly category: string;
  readonly prompt: string;
  readonly level: number;
  readonly choose?: number;
  readonly from?: readonly string[] | Record<string, unknown> | string;
  readonly options?: readonly {
    readonly id: string;
    readonly name: string;
    readonly text: string;
    readonly prerequisite?: string;
    readonly source: string;
  }[];
  readonly unsupported?: { readonly reason: string };
}

export interface FeatureExtraction {
  readonly name: string;
  /** Whether the feature is granted by a base class or a subclass. */
  readonly grantorKind: 'class' | 'subclass';
  /** Grantor display name (e.g. "Fighter" or "Champion"); emit keys it. */
  readonly grantorName: string;
  /** Character level at which the feature is gained (1–20). */
  readonly level: number;
  /** Feature body prose, re-flowed into paragraphs. */
  readonly description: string;
  /**
   * Structured player choices this feature requires (eshyra-o9bd.9). Absent
   * until a choice-derivation pass populates it; emitted to `data.choices`.
   */
  readonly choices?: readonly FeatureChoiceEntry[];
  /** 1-based page in the source PDF where the feature heading begins. */
  readonly sourcePage: number;
}

/**
 * The feature a background grants ("Feature: Shelter of the Faithful"), kept
 * as a NESTED field of the background record rather than a top-level `feature`
 * record (eshyra-0m9.17 decision): `validateDnd5eFeature` requires a
 * class/subclass grantor key and an integer grant level, neither of which a
 * background feature has — and the background's primary lookup use is the
 * proficiencies + feature text together, mirroring how ancestry traits nest
 * in their ancestry record.
 */
export interface BackgroundFeatureExtraction {
  readonly name: string;
  /** Feature body prose, re-flowed into paragraphs. */
  readonly text: string;
}

/**
 * A background entry as extracted from the SRD 5.1 "Backgrounds" chapter
 * (eshyra-0m9.17), before conversion to a `kind=background` `RulesRecord`.
 * Mirrors the fields the `dnd5e-srd` background kindSchema requires (see
 * `validateDnd5eBackground` in `kindSchemas.ts`): a description, the
 * skill-proficiency grant list, and the nested feature. The tool-proficiency,
 * language, equipment, and suggested-characteristics fields are optional
 * because not every background grants them (SRD 5.1 publishes only Acolyte,
 * which has no tool proficiencies). The entry's suggested-characteristics
 * roll tables emit separately under the `table` kind (see `parseBackgrounds`).
 */
export interface BackgroundExtraction {
  readonly name: string;
  /** Intro/flavor prose for the background, re-flowed into paragraphs. */
  readonly description: string;
  /** Parsed "Skill Proficiencies:" list (e.g. ["Insight", "Religion"]). */
  readonly skillProficiencies: readonly string[];
  /** Parsed "Tool Proficiencies:" list, when the background grants any. */
  readonly toolProficiencies?: readonly string[];
  /** Verbatim "Languages:" grant text (e.g. "Two of your choice"). */
  readonly languages?: string;
  /** Verbatim "Equipment:" package text, re-joined across wrapped lines. */
  readonly equipment?: string;
  readonly feature: BackgroundFeatureExtraction;
  /** Suggested Characteristics intro prose (the roll tables emit separately). */
  readonly suggestedCharacteristics?: string;
  /** 1-based page in the source PDF where the background entry begins. */
  readonly sourcePage: number;
}

export interface ImporterCounts {
  readonly spells: number;
  readonly creatures: number;
  /**
   * Count of Appendix MM-B Nonplayer-Character stat blocks (loreweaver-bn0).
   * These emit under the `creature` record kind too, so the pack's
   * `creature` per-kind count is `creatures + npcs`; this field reports the NPC
   * subset separately so the Monsters baseline and the NPC baseline stay
   * legible in the importer's count output.
   */
  readonly npcs: number;
  /**
   * Count of abbreviated inline stat blocks (Avatar of Death, Giant Fly;
   * eshyra-4a7.4). These emit under the `stat-block` record kind, separate from
   * `creature`, so they are reported on their own line.
   */
  readonly statBlocks: number;
  readonly classes: number;
  readonly subclasses: number;
  readonly features: number;
  readonly conditions: number;
  readonly feats: number;
  readonly hazards: number;
  readonly traps: number;
  readonly diseases: number;
  readonly poisons: number;
  readonly actions: number;
  readonly rules: number;
  readonly tables: number;
  readonly equipment: number;
  readonly magicItems: number;
  readonly ancestries: number;
  readonly backgrounds: number;
}

export interface ImporterRunResult {
  readonly outDir: string;
  readonly sourceHash: string;
  readonly counts: ImporterCounts;
}
