/**
 * Level-1 required-choice enumeration (eshyra-b69j.12).
 *
 * Complete level-1 D&D 5e creation needs more than a class, ancestry, and
 * ability scores: a character also picks skill proficiencies, starting
 * equipment, cantrips/spells, languages, and applies ancestry ability bonuses.
 * The design rule (docs/design/character-creation-cli.md) is that the CLI must
 * never parse prose to discover these — a required choice is either backed by
 * structured pack metadata or it is an explicit, tracked gap.
 *
 * This module turns a resolved class (and optional ancestry/background) into a
 * flat list of {@link Level1RequiredChoice} descriptors, each tagged
 * `structured` (enumerable now from generated pack metadata) or `unstructured`
 * (the option set or count lives only in prose; tracked by a `blockingBead`
 * for any record the pack does not yet cover). It deliberately
 * does NOT parse the prose: an `unstructured` choice carries the verbatim
 * `sourceText` for display and the `blockingBead`, nothing more.
 *
 * Spellcasting metadata is structured in the generated pack: the spellcasting
 * ability is an auto-resolved fact (not a prompt, like a fixed ancestry
 * increase), and the level-1 spell-selection count is structured for known
 * casters (progression `spellsKnown`), Wizards (fixed spellbook size), and
 * prepared full casters (ability modifier + level, exact when modifiers are
 * supplied via {@link EnumerateRequiredChoicesInput.abilityModifiers}).
 *
 * Starting equipment is likewise structured in the generated pack: each SRD
 * class's choose-one groups become structured equipment choices (`choose: 1`
 * with the option texts in `from`), while fixed grants are auto-applied and not
 * prompted.
 *
 * Languages are structured in the generated pack: an ancestry's/background's
 * fixed languages are granted automatically, and only a free-choice component
 * (Half-Elf/Human "one extra", Acolyte "two of your choice") is surfaced as a
 * structured `choose`/`from` language choice drawn from the SRD standard
 * languages.
 *
 * The inventory of what is structured vs prose-only today lives in
 * docs/design/character-creation-level1-metadata-inventory.md.
 */

import { ABILITY_FULL_NAMES } from './abilities.js';
import type { AbilityScoreName } from './creation.js';
import type {
  ResolvedAncestryData,
  ResolvedBackgroundData,
  ResolvedChoiceSpec,
  ResolvedClassData,
  ResolvedLanguageGrant,
} from './rulesPackResolver.js';

/** Whether a required choice can be enumerated from structured pack data yet. */
export type Level1RequiredChoiceStatus = 'structured' | 'unstructured';

/** Which record a required choice originates from. */
export type Level1RequiredChoiceSource = 'class' | 'ancestry' | 'background';

/** The category of a level-1 required choice. */
export type Level1RequiredChoiceKind =
  | 'skills'
  | 'tools'
  | 'equipment'
  | 'cantrips'
  | 'spells'
  | 'spellcasting_ability'
  | 'ability_increase'
  | 'languages';

/**
 * One required level-1 choice. `structured` descriptors carry `choose`/`from`
 * where known and can drive an interactive picker; `unstructured` descriptors
 * carry the verbatim `sourceText` and the `blockingBead` that tracks adding the
 * missing metadata, and must not be auto-resolved by parsing that text.
 */
export interface Level1RequiredChoice {
  /** Stable identifier, e.g. `class.skills`, `class.equipment.0`, `ancestry.abilityIncrease`. */
  readonly id: string;
  readonly kind: Level1RequiredChoiceKind;
  readonly source: Level1RequiredChoiceSource;
  readonly status: Level1RequiredChoiceStatus;
  /** Human-readable prompt. */
  readonly label: string;
  /** Number to choose, when a structured count is known. */
  readonly choose?: number;
  /** The option set, when structured. */
  readonly from?: readonly string[];
  /** Verbatim source prose for an unstructured gap — for display only, never parsed. */
  readonly sourceText?: string;
  /** Follow-up bead that will make an unstructured choice structured. */
  readonly blockingBead?: string;
}

/** Inputs to {@link enumerateLevel1RequiredChoices}. */
export interface EnumerateRequiredChoicesInput {
  readonly classData: ResolvedClassData;
  readonly ancestry?: ResolvedAncestryData;
  readonly background?: ResolvedBackgroundData;
  /**
   * Final ability modifiers, when known. A prepared full caster's level-1 spell
   * count is its spellcasting-ability modifier + level (eshyra-b69j.12.2), so
   * supplying these lets the enumeration carry the exact `choose` count for
   * Cleric/Druid. When absent, that choice stays structured but without a fixed
   * count (the count is still derivable via `level1PreparedSpellCount`).
   */
  readonly abilityModifiers?: Partial<Record<AbilityScoreName, number>>;
}

const BEAD_ABILITY_INCREASE = 'eshyra-b69j.12.1';
const BEAD_SPELLCASTING = 'eshyra-b69j.12.2';
const BEAD_EQUIPMENT = 'eshyra-b69j.12.3';
const BEAD_LANGUAGES = 'eshyra-b69j.12.4';
const SRD_STANDARD_LANGUAGES: readonly string[] = [
  'Common',
  'Dwarvish',
  'Elvish',
  'Giant',
  'Gnomish',
  'Goblin',
  'Halfling',
  'Orc',
];

/**
 * Enumerate every required level-1 choice implied by the given class (and
 * optional ancestry/background), in a stable order: class skills, tools,
 * spellcasting, equipment, then ancestry and background. Each is tagged
 * structured or unstructured.
 */
export function enumerateLevel1RequiredChoices(
  input: EnumerateRequiredChoicesInput,
): readonly Level1RequiredChoice[] {
  const choices: Level1RequiredChoice[] = [];
  // Languages a free choice must exclude span BOTH sources: a character already
  // has every fixed language from its ancestry and its background, so each
  // free-choice `from` pool subtracts the combined set (not just the same
  // entry's own fixed languages).
  const grantedLanguages = combinedFixedLanguages(input);
  collectClassChoices(input.classData, input.abilityModifiers, choices);
  if (input.ancestry !== undefined) {
    collectAncestryChoices(input.ancestry, grantedLanguages, choices);
  }
  if (input.background !== undefined) {
    collectBackgroundChoices(input.background, grantedLanguages, choices);
  }
  return choices;
}

/** Every fixed language granted by the chosen ancestry and background records. */
function combinedFixedLanguages(
  input: EnumerateRequiredChoicesInput,
): readonly string[] {
  const fixed: string[] = [];
  if (input.ancestry !== undefined) {
    fixed.push(...fixedLanguages(input.ancestry.languages));
  }
  if (input.background !== undefined) {
    fixed.push(...fixedLanguages(input.background.languages));
  }
  return fixed;
}

function collectClassChoices(
  classData: ResolvedClassData,
  abilityModifiers: Partial<Record<AbilityScoreName, number>> | undefined,
  choices: Level1RequiredChoice[],
): void {
  (classData.skillChoices ?? []).forEach((spec, index) => {
    choices.push(structuredProficiencyChoice('skills', spec, index));
  });
  (classData.toolProficiencyChoices ?? []).forEach((spec, index) => {
    choices.push(structuredProficiencyChoice('tools', spec, index));
  });

  collectSpellcastingChoices(classData, abilityModifiers, choices);
  collectEquipmentChoices(classData, choices);
}

/**
 * Starting-equipment choose-one groups. Structured generated pack entries split
 * each SRD class's equipment into choice groups (with labelled options) and
 * fixed grants. Only the choose-one groups are required choices — fixed grants
 * are auto-applied and need no prompt. A legacy pack with prose-only entries
 * falls back to unstructured choices so the gap stays tracked.
 */
function collectEquipmentChoices(
  classData: ResolvedClassData,
  choices: Level1RequiredChoice[],
): void {
  (classData.startingEquipment?.entries ?? []).forEach((entry, index) => {
    if (typeof entry === 'string') {
      if (!isEquipmentOption(entry)) {
        return; // a fixed grant (e.g. "A spellbook"), not a choice
      }
      choices.push({
        id: `class.equipment.${index}`,
        kind: 'equipment',
        source: 'class',
        status: 'unstructured',
        label: `Choose your starting equipment: ${entry}`,
        sourceText: entry,
        blockingBead: BEAD_EQUIPMENT,
      });
      return;
    }
    if (entry.kind === 'fixed') {
      return; // fixed grant — applied automatically, no prompt needed
    }
    choices.push({
      id: `class.equipment.${index}`,
      kind: 'equipment',
      source: 'class',
      status: 'structured',
      label: `Choose your starting equipment: ${entry.sourceText}`,
      choose: 1,
      from: entry.options.map((option) => option.text),
      sourceText: entry.sourceText,
    });
  });
}

function structuredProficiencyChoice(
  kind: 'skills' | 'tools',
  spec: ResolvedChoiceSpec,
  index: number,
): Level1RequiredChoice {
  const noun = kind === 'skills' ? 'skill proficiencies' : 'tool proficiencies';
  return {
    id: `class.${kind}${index === 0 ? '' : `.${index}`}`,
    kind,
    source: 'class',
    status: 'structured',
    label: spec.text || `Choose ${spec.choose ?? ''} ${noun}`.trim(),
    choose: spec.choose,
    from: spec.from,
  };
}

function collectSpellcastingChoices(
  classData: ResolvedClassData,
  abilityModifiers: Partial<Record<AbilityScoreName, number>> | undefined,
  choices: Level1RequiredChoice[],
): void {
  // A class casts at level 1 only when its progression row grants cantrips,
  // spells, or slots there — this drops non-casters and the half-casters
  // (Paladin, Ranger) whose spellcasting begins at level 2.
  if (!castsAtLevel1(classData)) {
    return;
  }
  const spellcasting = classData.level1?.spellcasting;
  if (spellcasting === undefined) {
    return; // unreachable once castsAtLevel1 is true; narrows the type
  }

  // A legacy pack with level-1 casting but no modeled ability still surfaces a
  // tracked gap so a real spellcasting ability is never silently dropped.
  if (classData.spellcastingAbility === undefined) {
    choices.push({
      id: 'class.spellcastingAbility',
      kind: 'spellcasting_ability',
      source: 'class',
      status: 'unstructured',
      label: 'Spellcasting ability is not yet structured in the rules pack',
      blockingBead: BEAD_SPELLCASTING,
    });
  }

  // Cantrip count is structured; the eligible cantrip list is derivable from
  // the spell records (level 0 + class) — surfaced/validated in eshyra-b69j.11.
  if (spellcasting.cantripsKnown !== undefined) {
    choices.push({
      id: 'class.cantrips',
      kind: 'cantrips',
      source: 'class',
      status: 'structured',
      label: `Choose ${spellcasting.cantripsKnown} cantrips`,
      choose: spellcasting.cantripsKnown,
    });
  }

  choices.push(spellSelectionChoice(classData, abilityModifiers));
}

/**
 * The level-1 spell-selection choice for a caster. Known casters (Bard,
 * Sorcerer, Warlock) carry a fixed `spellsKnown` count on the progression row.
 * Prepared casters use generated `spellPreparation`: a Wizard picks a fixed-size
 * starting spellbook, while Cleric/Druid prepare a list whose size is their
 * spellcasting-ability modifier + level — a count this fills in when the
 * modifiers are known and otherwise leaves to `level1PreparedSpellCount`.
 */
function spellSelectionChoice(
  classData: ResolvedClassData,
  abilityModifiers: Partial<Record<AbilityScoreName, number>> | undefined,
): Level1RequiredChoice {
  const spellcasting = classData.level1?.spellcasting;
  const base = {
    id: 'class.spells',
    kind: 'spells',
    source: 'class',
  } as const;

  // Known caster: a fixed number of spells from the progression row.
  if (spellcasting?.spellsKnown !== undefined) {
    return {
      ...base,
      status: 'structured',
      label: `Choose ${spellcasting.spellsKnown} level-1 spells`,
      choose: spellcasting.spellsKnown,
    };
  }

  // Prepared caster with no structured preparation: keep a tracked gap.
  if (
    classData.spellcastingAbility === undefined ||
    classData.spellPreparation?.kind !== 'prepared'
  ) {
    return {
      ...base,
      status: 'unstructured',
      label:
        'Choose your prepared/known level-1 spells (count derives from the spellcasting ability)',
      blockingBead: BEAD_SPELLCASTING,
    };
  }

  // Wizard: a fixed-size starting spellbook to prepare from.
  if (classData.spellPreparation.spellbookStartingSpells !== undefined) {
    return {
      ...base,
      status: 'structured',
      label: `Choose ${classData.spellPreparation.spellbookStartingSpells} level-1 spells for your spellbook`,
      choose: classData.spellPreparation.spellbookStartingSpells,
    };
  }

  // Cleric/Druid: prepare (ability modifier + level) spells; the exact count
  // needs the modifier, so it is filled only when modifiers are supplied.
  const abilityName = ABILITY_FULL_NAMES[classData.spellcastingAbility];
  const modifier = abilityModifiers?.[classData.spellcastingAbility];
  const count =
    modifier !== undefined ? level1PreparedSpellCount(modifier) : undefined;
  return {
    ...base,
    status: 'structured',
    label:
      count !== undefined
        ? `Prepare ${count} level-1 spells (${abilityName} modifier + level)`
        : `Prepare level-1 spells (${abilityName} modifier + level)`,
    ...(count !== undefined ? { choose: count } : {}),
  };
}

function collectAncestryChoices(
  ancestry: ResolvedAncestryData,
  grantedLanguages: readonly string[],
  choices: Level1RequiredChoice[],
): void {
  collectAncestryAbilityIncrease(ancestry, choices);
  collectAncestryLanguages(ancestry, grantedLanguages, choices);
}

/**
 * Ancestry languages come from generated pack metadata — never parsed from the
 * trait prose. Fixed languages (e.g. Elf's Common + Elvish) are granted
 * automatically and need no prompt; only a free-choice component (Half-Elf /
 * Human "one extra language of your choice") is a required choice, surfaced
 * structured with `choose`/`from` (the SRD standard languages minus
 * `grantedLanguages` — the combined fixed languages from this ancestry AND the
 * background, so a pick never offers a language the character already has). An
 * ancestry with no structured languages falls back to the prose trait as a
 * tracked unstructured gap, so a real language choice is never dropped.
 */
function collectAncestryLanguages(
  ancestry: ResolvedAncestryData,
  grantedLanguages: readonly string[],
  choices: Level1RequiredChoice[],
): void {
  const grant = firstLanguageGrant(ancestry.languages);
  if (grant === undefined) {
    const trait = (ancestry.traits ?? []).find(
      (entry) =>
        /languages?/i.test(entry.name) && /\bchoice\b|choose/i.test(entry.text),
    );
    if (trait !== undefined) {
      choices.push({
        id: 'ancestry.languages',
        kind: 'languages',
        source: 'ancestry',
        status: 'unstructured',
        label: 'Choose ancestry language(s)',
        sourceText: trait.text,
        blockingBead: BEAD_LANGUAGES,
      });
    }
    return;
  }
  if (grant.choose === undefined) {
    return; // fixed languages only — granted automatically, no prompt needed
  }
  choices.push({
    id: 'ancestry.languages',
    kind: 'languages',
    source: 'ancestry',
    status: 'structured',
    label: `Choose ${grant.choose} language(s)`,
    choose: grant.choose,
    from: chooseableLanguages(grantedLanguages),
    sourceText: grant.sourceText,
  });
}

/**
 * Ancestry ability-score increases come from generated pack metadata — never
 * parsed from the trait prose. A *fixed* increase (e.g. Elf's +2 Dexterity) is
 * applied automatically in `deriveLevel1Values` and needs no prompt, so it is
 * not a required choice. Only the player-choice component (the Half-Elf's "two
 * other ability scores of your choice +1") is a required choice, surfaced
 * structured with `choose`/`from`. An ancestry with no structured increases
 * falls back to the prose trait as a tracked unstructured gap, so a real
 * increase is never dropped.
 */
function collectAncestryAbilityIncrease(
  ancestry: ResolvedAncestryData,
  choices: Level1RequiredChoice[],
): void {
  const increase = ancestry.abilityScoreIncreases?.find(
    (entry) => entry.choice !== undefined,
  );
  if (ancestry.abilityScoreIncreases === undefined) {
    const trait = (ancestry.traits ?? []).find((entry) =>
      /ability score increase/i.test(entry.name),
    );
    if (trait !== undefined) {
      choices.push({
        id: 'ancestry.abilityIncrease',
        kind: 'ability_increase',
        source: 'ancestry',
        status: 'unstructured',
        label: 'Apply ancestry ability score increase',
        sourceText: trait.text,
        blockingBead: BEAD_ABILITY_INCREASE,
      });
    }
    return;
  }

  if (increase?.choice === undefined) {
    return; // fixed increases only — applied automatically, no prompt needed
  }

  const { choose, bonus, from } = increase.choice;
  choices.push({
    id: 'ancestry.abilityIncrease',
    kind: 'ability_increase',
    source: 'ancestry',
    status: 'structured',
    label: `Choose ${choose} ability scores to increase by ${bonus}`,
    choose,
    from: from.map((name) => ABILITY_FULL_NAMES[name]),
    sourceText: increase.sourceText,
  });
}

function collectBackgroundChoices(
  background: ResolvedBackgroundData,
  grantedLanguages: readonly string[],
  choices: Level1RequiredChoice[],
): void {
  const grant = firstLanguageGrant(background.languages);
  if (grant === undefined) {
    const languages = background.languages;
    if (typeof languages === 'string' && /\bchoice\b|choose/i.test(languages)) {
      choices.push({
        id: 'background.languages',
        kind: 'languages',
        source: 'background',
        status: 'unstructured',
        label: 'Choose background language(s)',
        sourceText: languages,
        blockingBead: BEAD_LANGUAGES,
      });
    }
    return;
  }
  if (grant.choose === undefined) {
    return; // fixed languages only — granted automatically, no prompt needed
  }
  choices.push({
    id: 'background.languages',
    kind: 'languages',
    source: 'background',
    status: 'structured',
    label: `Choose ${grant.choose} language(s)`,
    choose: grant.choose,
    from: chooseableLanguages(grantedLanguages),
    sourceText: grant.sourceText,
  });
}

function castsAtLevel1(classData: ResolvedClassData): boolean {
  const spellcasting = classData.level1?.spellcasting;
  if (spellcasting === undefined) {
    return false;
  }
  return (
    spellcasting.cantripsKnown !== undefined ||
    spellcasting.spellsKnown !== undefined ||
    spellcasting.slots !== undefined ||
    spellcasting.pactSlots !== undefined
  );
}

function level1PreparedSpellCount(abilityModifier: number): number {
  return Math.max(1, abilityModifier + 1);
}

function firstLanguageGrant(
  value:
    | ResolvedAncestryData['languages']
    | ResolvedBackgroundData['languages'],
): ResolvedLanguageGrant | undefined {
  return Array.isArray(value) ? value[0] : undefined;
}

function fixedLanguages(
  value:
    | ResolvedAncestryData['languages']
    | ResolvedBackgroundData['languages'],
): readonly string[] {
  return Array.isArray(value) ? value.flatMap((grant) => grant.fixed) : [];
}

function chooseableLanguages(fixed: readonly string[]): readonly string[] {
  const taken = new Set(fixed);
  return SRD_STANDARD_LANGUAGES.filter((language) => !taken.has(language));
}

/**
 * A starting-equipment entry is a CHOICE (rather than a fixed grant) when it
 * prints option markers — the SRD writes these as "(a) … or (b) …". This is a
 * display/grouping heuristic only; the structured option groups are added in
 * eshyra-b69j.12.3 and the entry text is never parsed for item content here.
 */
function isEquipmentOption(entry: string): boolean {
  return /\(a\)/i.test(entry) && /\bor\b/i.test(entry);
}
