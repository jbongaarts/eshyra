/**
 * Character-creation recipe boundary (eshyra-b69j.4).
 *
 * Eshyra uses one shared character-creation shell (terminal UX, navigation,
 * draft persistence) with rule-pack-specific *recipes* that own everything a
 * particular rules system means: its creation modes, its step order, its
 * terminology, how a draft is validated, which values are derived, and how a
 * finished draft projects into canonical state mutations.
 *
 * This file is the system-agnostic seam. It deliberately knows nothing about
 * Fighters, ancestry boosts, hit dice, or spell slots — that knowledge lives in
 * a concrete recipe (the D&D 5e SRD recipe is the first; see `dnd5eRecipe.ts`).
 * The contract is generic over a recipe-private `Draft` shape and the
 * `Character` projection a finished draft produces, so the shared shell can
 * drive any recipe without learning its rules.
 *
 * Scope note: this slice defines the boundary and the D&D recipe's modes and
 * step order. The dependency-aware draft engine (eshyra-b69j.5) and the full
 * derived-value computation (eshyra-b69j.6) deepen the `validateDraft` and
 * `computeDerivedValues` hooks declared here; the wizard flows (eshyra-b69j.8 /
 * eshyra-b69j.9) consume `getModes` / `getStepOrder`.
 */

import type { MutateStateInput } from '../state/mutateState.js';
import type { CharacterCreationMutationMetadata } from './creation.js';

/** A character-creation mode the user picks at the start of the wizard. */
export interface CharacterCreationMode {
  /** Stable mode id used in draft state and recipe dispatch. */
  readonly id: string;
  /** Canonical user-facing label for the mode picker. */
  readonly label: string;
  /** One-line description shown under the label. */
  readonly summary: string;
}

/** A single ordered step in a recipe's creation flow. */
export interface CharacterCreationStep {
  /** Stable step id; the same logical step shares an id across modes. */
  readonly id: string;
  /** User-facing label for the step (recipe terminology). */
  readonly label: string;
}

/** Outcome of validating a draft into its canonical character projection. */
export type RecipeDraftValidation<Character> =
  | { readonly ok: true; readonly character: Character }
  | { readonly ok: false; readonly errors: readonly string[] };

/**
 * Outcome of finalizing a draft. On success the recipe returns the canonical
 * character, the canon-write mutations the shared shell should apply inside a
 * transaction, and the recipe-authored completion prompt. The shell owns the
 * persistence mechanics; the recipe owns what gets written and how completion
 * reads back.
 */
export type RecipeFinalization<Character> =
  | {
      readonly ok: true;
      readonly character: Character;
      readonly mutations: readonly MutateStateInput[];
      readonly prompt: string;
    }
  | { readonly ok: false; readonly errors: readonly string[] };

/**
 * Rule-system-specific character-creation contract. One recipe per supported
 * rules system. The shared shell depends only on this interface.
 */
export interface CharacterCreationRecipe<Draft, Character> {
  /** Rules-pack id this recipe targets (e.g. `dnd5e-srd-5.1`). */
  readonly rulesPackId: string;
  /** Stable recipe id. */
  readonly recipeId: string;
  /** Human-readable recipe label. */
  readonly label: string;

  /** Creation modes this recipe supports, in display order. */
  getModes(): readonly CharacterCreationMode[];

  /**
   * Ordered steps for a given mode. Unknown mode ids throw — callers should
   * only pass an id returned by {@link getModes}.
   */
  getStepOrder(modeId: string): readonly CharacterCreationStep[];

  /** Validate a draft into its canonical character projection. */
  validateDraft(draft: Draft): RecipeDraftValidation<Character>;

  /**
   * Compute derived values for a draft. The shape is recipe-specific; the
   * shared shell treats it as opaque display data. Deepened by eshyra-b69j.6.
   */
  computeDerivedValues(draft: Draft): Record<string, unknown>;

  /**
   * Finalize a draft into canon-write mutations plus a completion prompt, or
   * the validation errors that block finalization.
   */
  finalize(
    draft: Draft,
    metadata: CharacterCreationMutationMetadata,
    characterId?: string,
  ): RecipeFinalization<Character>;
}
