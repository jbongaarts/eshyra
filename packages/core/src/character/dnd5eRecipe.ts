/**
 * D&D 5e SRD character-creation recipe (eshyra-b69j.4).
 *
 * The first concrete {@link CharacterCreationRecipe}. It owns all D&D 5e SRD
 * terminology and rules the shared character-creation shell must stay ignorant
 * of: the two canonical creation modes, the step order for each, draft
 * validation, derived values, and how a finished draft finalizes into canon
 * mutations and a completion prompt.
 *
 * Validation and finalization delegate to the existing pure functions in
 * `creation.ts` (and through them to the generated-rules-pack resolver from
 * eshyra-b69j.3), so the recipe and the legacy `completeCharacterCreation`
 * entrypoint share one source of rules truth. Later slices deepen the draft
 * engine (eshyra-b69j.5) and derived-value computation (eshyra-b69j.6) and move
 * the wizard and persistence path onto this seam.
 *
 * Pathfinder future-compatibility is preserved by the generic recipe boundary;
 * no Pathfinder recipe is designed or implemented here.
 */

import { DEFAULT_DND5E_SRD_BINDING } from '../rules/binding.js';
import type { MutateStateInput } from '../state/mutateState.js';
import {
  buildCharacterCreationMutations,
  type CharacterCreationDraft,
  CharacterCreationError,
  type CharacterCreationMutationMetadata,
  type CreatedCharacter,
  validateCharacterDraft,
} from './creation.js';
import {
  type CharacterDerivedValues,
  deriveLevel1Values,
} from './derivedValues.js';
import type {
  CharacterCreationMode,
  CharacterCreationRecipe,
  CharacterCreationStep,
  RecipeDraftValidation,
  RecipeFinalization,
} from './recipe.js';
import {
  getBundledDnd5eCharacterResolver,
  type ResolvedAncestryData,
  type ResolvedClassData,
  type RulesPackCharacterResolver,
} from './rulesPackResolver.js';
import {
  type AbilityScoreIncrease,
  getAncestryAbilityScoreIncrease,
} from './srdAncestryAbilityScoreIncreases.js';
import { level1SpellcastingAbility } from './srdClassSpellcasting.js';

/** Canonical D&D 5e SRD creation modes (design: character-creation-cli.md). */
export type Dnd5eCreationMode = 'concept-first' | 'ability-first';

const MODES: readonly CharacterCreationMode[] = [
  {
    id: 'concept-first',
    label: 'Concept-first — I know what I want to play',
    summary:
      'Start with class, ancestry, and character idea, then assign ability scores to fit.',
  },
  {
    id: 'ability-first',
    label: 'Ability-first — let the dice inspire me',
    summary:
      'Generate or enter ability scores first, then choose a class and ancestry that fit.',
  },
];

const STEP_LABELS: Readonly<Record<string, string>> = {
  identity: 'Identity & concept',
  'ability-method': 'Ability score method',
  'ability-scores': 'Ability scores',
  'class-recommendations': 'Class recommendations',
  class: 'Class',
  ancestry: 'Ancestry',
  background: 'Background',
  'class-choices': 'Class choices',
  'spells-equipment': 'Spells & equipment',
  review: 'Review',
};

// Concept-first: known concept, choose class/ancestry, then fit scores.
const CONCEPT_FIRST_STEP_IDS: readonly string[] = [
  'identity',
  'class',
  'ancestry',
  'background',
  'ability-scores',
  'class-choices',
  'spells-equipment',
  'review',
];

// Ability-first: scores (and their interpretation) come before class choice.
const ABILITY_FIRST_STEP_IDS: readonly string[] = [
  'identity',
  'ability-method',
  'ability-scores',
  'class-recommendations',
  'class',
  'ancestry',
  'background',
  'class-choices',
  'spells-equipment',
  'review',
];

function toSteps(stepIds: readonly string[]): readonly CharacterCreationStep[] {
  return stepIds.map((id) => ({ id, label: STEP_LABELS[id] ?? id }));
}

function resolveClassRecord(
  resolver: RulesPackCharacterResolver,
  className: string,
): ResolvedClassData | undefined {
  const result = resolver.resolveClass(className);
  return result.ok ? result.record : undefined;
}

function resolveAncestryRecord(
  resolver: RulesPackCharacterResolver,
  ancestry: string,
): ResolvedAncestryData | undefined {
  const result = resolver.resolveAncestry(ancestry);
  return result.ok ? result.record : undefined;
}

function ancestryAbilityScoreIncreases(
  ancestry: ResolvedAncestryData | undefined,
): readonly AbilityScoreIncrease[] {
  if (ancestry === undefined) {
    return [];
  }
  if (ancestry.abilityScoreIncreases !== undefined) {
    return ancestry.abilityScoreIncreases.flatMap((entry) => entry.fixed);
  }
  return getAncestryAbilityScoreIncrease(ancestry.key)?.fixed ?? [];
}

function completionPrompt(character: CreatedCharacter): string {
  return `Character creation complete: ${character.name} is a level ${character.level} ${character.ancestry} ${character.className}.`;
}

/**
 * The D&D 5e SRD character-creation recipe. Bound to the D&D draft and
 * created-character shapes from `creation.ts`.
 */
export const DND5E_SRD_CHARACTER_RECIPE: CharacterCreationRecipe<
  CharacterCreationDraft,
  CreatedCharacter
> = {
  rulesPackId: DEFAULT_DND5E_SRD_BINDING.base.packId,
  recipeId: 'dnd5e-srd',
  label: 'D&D 5e SRD',

  getModes(): readonly CharacterCreationMode[] {
    return MODES;
  },

  getStepOrder(modeId: string): readonly CharacterCreationStep[] {
    switch (modeId as Dnd5eCreationMode) {
      case 'concept-first':
        return toSteps(CONCEPT_FIRST_STEP_IDS);
      case 'ability-first':
        return toSteps(ABILITY_FIRST_STEP_IDS);
      default:
        throw new Error(`unknown D&D 5e creation mode: ${modeId}`);
    }
  },

  validateDraft(
    draft: CharacterCreationDraft,
  ): RecipeDraftValidation<CreatedCharacter> {
    try {
      const { character } = validateCharacterDraft(draft);
      return { ok: true, character };
    } catch (error) {
      if (error instanceof CharacterCreationError) {
        return { ok: false, errors: error.errors };
      }
      throw error;
    }
  },

  computeDerivedValues(draft: CharacterCreationDraft): CharacterDerivedValues {
    const resolver = getBundledDnd5eCharacterResolver();
    const classRecord = resolveClassRecord(resolver, draft.className);
    const ancestryRecord = resolveAncestryRecord(resolver, draft.ancestry);
    return deriveLevel1Values({
      validAbilityScores: draft.abilityScores,
      classRecord,
      abilityScoreIncreases: ancestryAbilityScoreIncreases(ancestryRecord),
      spellcastingAbility: level1SpellcastingAbility(classRecord),
    });
  },

  finalize(
    draft: CharacterCreationDraft,
    metadata: CharacterCreationMutationMetadata,
    characterId?: string,
  ): RecipeFinalization<CreatedCharacter> {
    const validation = this.validateDraft(draft);
    if (!validation.ok) {
      return { ok: false, errors: validation.errors };
    }

    const mutations: readonly MutateStateInput[] =
      buildCharacterCreationMutations(draft, metadata, undefined, characterId);

    return {
      ok: true,
      character: validation.character,
      mutations,
      prompt: completionPrompt(validation.character),
    };
  },
};

/**
 * Resolve the character-creation recipe for a rules system id (the `systemId`
 * on a bundled rules pack). Returns `undefined` for systems without a recipe so
 * callers can surface a correction rather than throw. Mirrors the dispatch in
 * `completeCharacterCreation`; Pathfinder is intentionally not wired here.
 */
export function resolveCharacterCreationRecipe(
  systemId: string,
):
  | CharacterCreationRecipe<CharacterCreationDraft, CreatedCharacter>
  | undefined {
  return systemId === 'dnd5e-srd' ? DND5E_SRD_CHARACTER_RECIPE : undefined;
}
