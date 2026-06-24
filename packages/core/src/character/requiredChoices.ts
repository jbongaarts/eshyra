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
 * flat list of {@link Level1RequiredChoice} descriptors, each tagged `structured`
 * (enumerable now from the generated pack) or `unstructured` (the option set or
 * count lives only in prose; a follow-up bead — eshyra-b69j.12.1..4 — tracks
 * adding the metadata). It deliberately does NOT parse the prose: an
 * `unstructured` choice carries the verbatim `sourceText` for display and the
 * `blockingBead` that will make it structured, nothing more.
 *
 * The inventory of what is structured vs prose-only today lives in
 * docs/design/character-creation-level1-metadata-inventory.md.
 */

import type {
  ResolvedAncestryData,
  ResolvedBackgroundData,
  ResolvedChoiceSpec,
  ResolvedClassData,
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
}

const BEAD_ABILITY_INCREASE = 'eshyra-b69j.12.1';
const BEAD_SPELLCASTING = 'eshyra-b69j.12.2';
const BEAD_EQUIPMENT = 'eshyra-b69j.12.3';
const BEAD_LANGUAGES = 'eshyra-b69j.12.4';

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
  collectClassChoices(input.classData, choices);
  if (input.ancestry !== undefined) {
    collectAncestryChoices(input.ancestry, choices);
  }
  if (input.background !== undefined) {
    collectBackgroundChoices(input.background, choices);
  }
  return choices;
}

function collectClassChoices(
  classData: ResolvedClassData,
  choices: Level1RequiredChoice[],
): void {
  (classData.skillChoices ?? []).forEach((spec, index) => {
    choices.push(structuredProficiencyChoice('skills', spec, index));
  });
  (classData.toolProficiencyChoices ?? []).forEach((spec, index) => {
    choices.push(structuredProficiencyChoice('tools', spec, index));
  });

  collectSpellcastingChoices(classData, choices);

  (classData.startingEquipment?.entries ?? []).forEach((entry, index) => {
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
  choices: Level1RequiredChoice[],
): void {
  const spellcasting = classData.level1?.spellcasting;
  if (spellcasting === undefined) {
    return; // non-caster at level 1
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

  // Known-casters (Bard, Sorcerer, ...) carry a structured spellsKnown count.
  // Prepared-casters (Wizard, Cleric, ...) prepare a number derived from their
  // spellcasting ability modifier — a prose formula, so it stays unstructured
  // until eshyra-b69j.12.2 adds the metadata.
  if (spellcasting.spellsKnown !== undefined) {
    choices.push({
      id: 'class.spells',
      kind: 'spells',
      source: 'class',
      status: 'structured',
      label: `Choose ${spellcasting.spellsKnown} level-1 spells`,
      choose: spellcasting.spellsKnown,
    });
  } else {
    choices.push({
      id: 'class.spells',
      kind: 'spells',
      source: 'class',
      status: 'unstructured',
      label:
        'Choose your prepared/known level-1 spells (count derives from the spellcasting ability)',
      blockingBead: BEAD_SPELLCASTING,
    });
  }

  // The spellcasting ability itself (INT/WIS/CHA) is prose-only today and gates
  // spell save DC / spell attack as well as prepared-spell counts.
  choices.push({
    id: 'class.spellcastingAbility',
    kind: 'spellcasting_ability',
    source: 'class',
    status: 'unstructured',
    label: 'Spellcasting ability is not yet structured in the rules pack',
    blockingBead: BEAD_SPELLCASTING,
  });
}

function collectAncestryChoices(
  ancestry: ResolvedAncestryData,
  choices: Level1RequiredChoice[],
): void {
  for (const trait of ancestry.traits ?? []) {
    if (/ability score increase/i.test(trait.name)) {
      choices.push({
        id: 'ancestry.abilityIncrease',
        kind: 'ability_increase',
        source: 'ancestry',
        status: 'unstructured',
        label: 'Apply ancestry ability score increase',
        sourceText: trait.text,
        blockingBead: BEAD_ABILITY_INCREASE,
      });
    } else if (
      /languages?/i.test(trait.name) &&
      /\bchoice\b|choose/i.test(trait.text)
    ) {
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
  }
}

function collectBackgroundChoices(
  background: ResolvedBackgroundData,
  choices: Level1RequiredChoice[],
): void {
  const languages = background.languages;
  if (languages !== undefined && /\bchoice\b|choose/i.test(languages)) {
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
