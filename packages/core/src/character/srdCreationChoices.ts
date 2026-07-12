/**
 * Deterministic ancestry & background character-creation choices (eshyra-ngcj.5).
 *
 * Ancestry and background records are source-complete but still carry several
 * build choices only in prose: a Dragonborn's draconic ancestry, a Dwarf's
 * artisan-tool proficiency, a Half-Elf's two skill proficiencies, a High Elf's
 * wizard cantrip and extra language, and an Acolyte's personality/ideal/bond/
 * flaw rolls plus its equipment grant. This module models each as a typed,
 * machine-readable choice (or equipment grant) so character creation can resolve
 * them without parsing prose.
 *
 * Choices that ALREADY have a dedicated typed field stay there and are NOT
 * duplicated here: ability-score choices live in `abilityScoreIncreases[].choice`
 * and base-language choices in `languages[].choose` (both from creationFacts).
 * This module owns only the remaining prose-bound choices.
 *
 * The authored data is source-cited via each choice's `sourceText` — verbatim
 * SRD prose for enumerable/prose-bound choices, but a constructed
 * "<table name> (<die>)." pointer label for rolled-table choices (Acolyte's
 * personality/ideal/bond/flaw), since those have no quotable sentence of
 * their own (see `CreationChoice.sourceText`, eshyra-o9bd.18.8.7). It is
 * shared by the importer (which attaches it to ancestry/background records)
 * and the runtime; ref/tableRef reachability is checked fail-closed by an
 * importer guard.
 */

import type { StartingEquipmentFilterSelect } from './srdStartingEquipmentGrants.js';

/**
 * A background equipment line item. Like a pack content it has an explicit
 * `quantity` + `name`, an optional concrete `equipment:` `ref`, and an optional
 * `detail`. It additionally supports an open `select` filter (e.g. an Acolyte's
 * "a holy symbol", which is a `holy-symbol` category choice, not one fixed
 * record) so deterministic tooling can prompt from that category — the same
 * filter vocabulary class starting equipment uses (eshyra-ngcj.3/.5).
 */
export interface BackgroundEquipmentGrant {
  readonly quantity: number;
  readonly name: string;
  readonly ref?: string;
  readonly select?: StartingEquipmentFilterSelect;
  readonly detail?: string;
  readonly currencyGp?: number;
}

/** Closed vocabulary of ancestry/background creation-choice categories. */
export type CreationChoiceCategory =
  | 'draconicAncestry'
  | 'tool'
  | 'skill'
  | 'cantrip'
  | 'language'
  | 'personalityTrait'
  | 'ideal'
  | 'bond'
  | 'flaw';

/** A single typed character-creation choice on an ancestry or background. */
export interface CreationChoice {
  /** Stable, kebab-case id unique within the record. */
  readonly id: string;
  readonly category: CreationChoiceCategory;
  /** Player-facing prompt. */
  readonly prompt: string;
  /** How many options to pick. */
  readonly choose: number;
  /** Discrete options (record keys or labels), when the set is enumerable. */
  readonly from?: readonly string[];
  /** Table record key the options come from (draconic ancestry, trait rolls). */
  readonly tableRef?: string;
  /** Dice for a rolled table, e.g. "1d8" (personality) or "1d6" (ideal/bond/flaw). */
  readonly roll?: string;
  /**
   * Source-cited display label, for auditability — NOT guaranteed verbatim
   * SRD prose. Enumerable/prose-bound choices (draconicAncestry, tool, skill,
   * cantrip, language) carry the actual SRD sentence. Rolled-table choices
   * (personalityTrait, ideal, bond, flaw) instead carry a constructed
   * "<table name> (<die>)." pointer built from the table's own title and
   * `roll` (e.g. "Acolyte Bonds (d6)."), since the SRD prose for those is the
   * table itself, not a quotable sentence. See eshyra-o9bd.18.8.7.
   */
  readonly sourceText: string;
}

/** The 18 SRD 5.1 skills, the universe for an open "skills of your choice". */
export const SRD_5_1_SKILLS: readonly string[] = [
  'Acrobatics',
  'Animal Handling',
  'Arcana',
  'Athletics',
  'Deception',
  'History',
  'Insight',
  'Intimidation',
  'Investigation',
  'Medicine',
  'Nature',
  'Perception',
  'Performance',
  'Persuasion',
  'Religion',
  'Sleight of Hand',
  'Stealth',
  'Survival',
];

/**
 * The p78 "Skills" per-ability mapping (eshyra-erf5.1): which of the 18 SRD
 * skills falls under each ability score, keyed by lowercase ability name.
 * Constitution has no associated skills. The SRD prints this as a caption +
 * bullet list per ability rather than a literal table, and the importer
 * deliberately excludes those captions from becoming their own prose `rule`
 * records (they collide by name with the real "Using Each Ability"
 * subsections and are list scaffolding, not adjudication text) — this
 * canonical mapping is what `rule:skills` carries instead, so deterministic
 * tools can still resolve every skill to its governing ability.
 */
export const SRD_5_1_SKILL_ABILITIES: Readonly<
  Record<string, readonly string[]>
> = {
  strength: ['Athletics'],
  dexterity: ['Acrobatics', 'Sleight of Hand', 'Stealth'],
  constitution: [],
  intelligence: ['Arcana', 'History', 'Investigation', 'Nature', 'Religion'],
  wisdom: ['Animal Handling', 'Insight', 'Medicine', 'Perception', 'Survival'],
  charisma: ['Deception', 'Intimidation', 'Performance', 'Persuasion'],
};

/** The Dwarf/Hill Dwarf artisan-tool proficiency options. */
const ARTISAN_TOOL_OPTIONS: readonly string[] = [
  'Smith’s tools',
  'Brewer’s supplies',
  'Mason’s tools',
];

/**
 * The 8 SRD 5.1 Standard Languages table entries (eshyra-8r8f) — the domain
 * for an open "one/two extra language(s) of your choice", per `rule:languages`'
 * own precedence ("Choose your languages from the Standard Languages table").
 * The Exotic Languages table (Abyssal, Celestial, Draconic, Deep Speech,
 * Infernal, Primordial, Sylvan, Undercommon) is GM-permission-gated in the
 * source prose, not part of the default domain, so it is intentionally
 * excluded here.
 */
export const SRD_5_1_STANDARD_LANGUAGES: readonly string[] = [
  'Common',
  'Dwarvish',
  'Elvish',
  'Giant',
  'Gnomish',
  'Goblin',
  'Halfling',
  'Orc',
];

/** The 17 SRD 5.1 Artisan's Tools table entries (eshyra-8r8f). */
export const SRD_5_1_ARTISAN_TOOLS: readonly string[] = [
  'Alchemist’s supplies',
  'Brewer’s supplies',
  "Calligrapher's supplies",
  'Carpenter’s tools',
  'Cartographer’s tools',
  'Cobbler’s tools',
  'Cook’s utensils',
  'Glassblower’s tools',
  'Jeweler’s tools',
  'Leatherworker’s tools',
  'Mason’s tools',
  'Painter’s supplies',
  'Potter’s tools',
  'Smith’s tools',
  'Tinker’s tools',
  'Weaver’s tools',
  'Woodcarver’s tools',
];

/** The 10 SRD 5.1 Musical Instrument table entries (eshyra-8r8f). */
export const SRD_5_1_MUSICAL_INSTRUMENTS: readonly string[] = [
  'Bagpipes',
  'Drum',
  'Dulcimer',
  'Flute',
  'Horn',
  'Lute',
  'Lyre',
  'Pan flute',
  'Shawm',
  'Viol',
];

/** Context the importer supplies (pack-derived, enumerable option sets). */
export interface CreationChoiceContext {
  /** Sorted `spell:` keys of every wizard cantrip in the pack. */
  readonly wizardCantrips: readonly string[];
}

/**
 * The ancestry creation choices for a record key, or `undefined` when the
 * ancestry has none. `from` sets that depend on the pack (the High Elf wizard
 * cantrip) are filled from `ctx`.
 */
export function getAncestryCreationChoices(
  ancestryKey: string,
  ctx: CreationChoiceContext,
): readonly CreationChoice[] | undefined {
  switch (ancestryKey) {
    case 'ancestry:dragonborn':
      return [
        {
          id: 'draconic-ancestry',
          category: 'draconicAncestry',
          prompt: 'Choose one type of dragon for your draconic ancestry.',
          choose: 1,
          tableRef: 'table:draconic-ancestry',
          sourceText:
            'You have draconic ancestry. Choose one type of dragon from the Draconic Ancestry table. Your breath weapon and damage resistance are determined by the dragon type, as shown in the table.',
        },
      ];
    case 'ancestry:dwarf':
    case 'ancestry:hill-dwarf':
      return [
        {
          id: 'tool-proficiency',
          category: 'tool',
          prompt: 'Choose an artisan’s tool proficiency.',
          choose: 1,
          from: ARTISAN_TOOL_OPTIONS,
          sourceText:
            'You gain proficiency with the artisan’s tools of your choice: smith’s tools, brewer’s supplies, or mason’s tools.',
        },
      ];
    case 'ancestry:half-elf':
      return [
        {
          id: 'skill-versatility',
          category: 'skill',
          prompt: 'Choose two skill proficiencies.',
          choose: 2,
          from: SRD_5_1_SKILLS,
          sourceText: 'You gain proficiency in two skills of your choice.',
        },
      ];
    case 'ancestry:high-elf':
      return [
        {
          id: 'cantrip',
          category: 'cantrip',
          prompt: 'Choose one wizard cantrip.',
          choose: 1,
          from: ctx.wizardCantrips,
          sourceText:
            'You know one cantrip of your choice from the wizard spell list. Intelligence is your spellcasting ability for it.',
        },
        {
          id: 'extra-language',
          category: 'language',
          prompt: 'Choose one extra language.',
          choose: 1,
          from: SRD_5_1_STANDARD_LANGUAGES,
          sourceText:
            'You can speak, read, and write one extra language of your choice.',
        },
      ];
    default:
      return undefined;
  }
}

/** Structured background creation facts: choices plus equipment grants. */
export interface BackgroundCreationFacts {
  readonly choices: readonly CreationChoice[];
  readonly equipmentGrants: readonly BackgroundEquipmentGrant[];
}

const ACOLYTE_FACTS: BackgroundCreationFacts = {
  choices: [
    {
      id: 'personality-trait',
      category: 'personalityTrait',
      prompt: 'Choose or roll a personality trait.',
      choose: 1,
      tableRef: 'table:acolyte-personality-traits',
      roll: '1d8',
      sourceText: 'Acolyte Personality Traits (d8).',
    },
    {
      id: 'ideal',
      category: 'ideal',
      prompt: 'Choose or roll an ideal.',
      choose: 1,
      tableRef: 'table:acolyte-ideals',
      roll: '1d6',
      sourceText: 'Acolyte Ideals (d6).',
    },
    {
      id: 'bond',
      category: 'bond',
      prompt: 'Choose or roll a bond.',
      choose: 1,
      tableRef: 'table:acolyte-bonds',
      roll: '1d6',
      sourceText: 'Acolyte Bonds (d6).',
    },
    {
      id: 'flaw',
      category: 'flaw',
      prompt: 'Choose or roll a flaw.',
      choose: 1,
      tableRef: 'table:acolyte-flaws',
      roll: '1d6',
      sourceText: 'Acolyte Flaws (d6).',
    },
  ],
  equipmentGrants: [
    {
      quantity: 1,
      name: 'holy symbol',
      select: 'holy-symbol',
      detail: 'a gift to you when you entered the priesthood',
    },
    { quantity: 1, name: 'prayer book or prayer wheel' },
    { quantity: 5, name: 'stick of incense' },
    { quantity: 1, name: 'vestments' },
    {
      quantity: 1,
      name: 'set of common clothes',
      ref: 'equipment:clothes-common',
    },
    {
      quantity: 1,
      name: 'pouch',
      ref: 'equipment:pouch',
      detail: 'containing 15 gp',
      currencyGp: 15,
    },
  ],
};

/** The background creation facts for a record key, or `undefined` for none. */
export function getBackgroundCreationFacts(
  backgroundKey: string,
): BackgroundCreationFacts | undefined {
  if (backgroundKey === 'background:acolyte') return ACOLYTE_FACTS;
  return undefined;
}
