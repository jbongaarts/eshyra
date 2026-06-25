/**
 * Deterministic level-1 derived-value computation (eshyra-b69j.6).
 *
 * The draft engine (eshyra-b69j.5) and the recipe's derived hook
 * (eshyra-b69j.4) both need the same derived numbers, and a player must never
 * have to hand-enter hit points. This module is the single, pure source for
 * everything a level-1 D&D 5e SRD character's derived stats can be computed
 * from the generated rules pack today:
 *
 *   - final ability scores (base scores plus ancestry ability increases) and
 *     the modifiers, saving throws, and HP that derive from them;
 *   - the level-1 proficiency bonus (+2);
 *   - level-1 hit point maximum (class hit die + Constitution modifier);
 *   - saving-throw modifiers, with class save proficiencies applied.
 *
 * Ancestry ability increases arrive as an already-resolved list of
 * `{ ability, bonus }` (the source-cited overlay in
 * `srdAncestryAbilityScoreIncreases.ts`, eshyra-b69j.12.1). This module stays
 * pure math: it applies whatever increases it is given — the fixed ancestry
 * bonuses today, plus any player-chosen ones (Half-Elf) the wizard later threads
 * in — and derives modifiers, saves, and HP from the resulting *final* scores,
 * never the base scores.
 *
 * Prerequisite gating, not cascades: a value is simply absent until its inputs
 * exist (HP needs a class hit die *and* a valid Constitution; saving-throw
 * proficiency needs a class). Callers turn an absent value into a "waiting on
 * …" message; this module never invents nonsense numbers.
 *
 * Deferred derived values and why:
 *   - spell save DC / spell attack modifier — need each class's spellcasting
 *     ability, which the generated pack does not yet expose as structured data
 *     (it lives in class prose); modeled in eshyra-b69j.12.2, not parsed here;
 *   - passive Perception — needs the chosen skills (skill selection lands with
 *     eshyra-b69j.13);
 *   - armor class / attack bonuses — need equipment (eshyra-b69j.13).
 */

import {
  ABILITY_FULL_NAMES,
  ABILITY_SCORE_NAMES,
  abilityModifier,
} from './abilities.js';
import type { AbilityScoreName } from './creation.js';
import type { AbilityScoreIncrease } from './srdAncestryAbilityScoreIncreases.js';

/** Level-1 proficiency bonus is +2 for every D&D 5e class. */
export const LEVEL_1_PROFICIENCY_BONUS = 2;

/** A derived saving-throw modifier and whether the class grants proficiency. */
export interface SavingThrowDerived {
  readonly modifier: number;
  readonly proficient: boolean;
}

/**
 * The full derived-value snapshot for a (possibly partial) level-1 draft.
 * Declared as a type alias (not an interface) so it carries the implicit index
 * signature that satisfies the recipe contract's `Record<string, unknown>`
 * derived-values return.
 */
export type CharacterDerivedValues = {
  readonly proficiencyBonus: number;
  /** Modifiers for each valid ability score present so far. */
  readonly abilityModifiers: Partial<Record<AbilityScoreName, number>>;
  /**
   * Final scores per ability: the base score plus any ancestry ability
   * increases applied (eshyra-b69j.12.1). Modifiers, saving throws, and HP all
   * derive from these final scores.
   */
  readonly finalAbilityScores: Partial<Record<AbilityScoreName, number>>;
  /**
   * Saving-throw modifiers per valid ability. Populated only once the class is
   * known, since save proficiency depends on it.
   */
  readonly savingThrows: Partial<Record<AbilityScoreName, SavingThrowDerived>>;
  /** Level-1 max HP, present only once class hit die and Constitution exist. */
  readonly maxHitPoints?: number;
};

/** The class fields derived computation reads. */
export interface DerivedClassInput {
  readonly hitDie: number;
  /** Full-name ability saves the class is proficient in, e.g. `Constitution`. */
  readonly savingThrowProficiencies: readonly string[];
}

/** Inputs to {@link deriveLevel1Values}. */
export interface DeriveLevel1Input {
  /**
   * Ability scores already validated by the caller (in range, integer). Absent
   * abilities are simply not yet chosen.
   */
  readonly validAbilityScores: Partial<Record<AbilityScoreName, number>>;
  /** The resolved class, when one has been chosen and resolves cleanly. */
  readonly classRecord?: DerivedClassInput;
  /**
   * Ancestry ability-score increases to add to the base scores — the fixed
   * bonuses from {@link getAncestryAbilityScoreIncrease} plus any player-chosen
   * increases (Half-Elf). Increases for an ability whose base score is not yet
   * set are ignored until that score exists. Absent when no ancestry is chosen.
   */
  readonly abilityScoreIncreases?: readonly AbilityScoreIncrease[];
}

/** Compute every level-1 derived value the current inputs support. */
export function deriveLevel1Values(
  input: DeriveLevel1Input,
): CharacterDerivedValues {
  const { validAbilityScores, classRecord } = input;

  const abilityModifiers: Partial<Record<AbilityScoreName, number>> = {};
  const finalAbilityScores: Partial<Record<AbilityScoreName, number>> = {};
  const savingThrows: Partial<Record<AbilityScoreName, SavingThrowDerived>> =
    {};

  const proficientSaves = new Set(classRecord?.savingThrowProficiencies ?? []);
  const bonusByAbility = sumIncreasesByAbility(input.abilityScoreIncreases);

  for (const name of ABILITY_SCORE_NAMES) {
    const base = validAbilityScores[name];
    if (base === undefined) {
      continue;
    }
    // Apply ancestry increases to reach the final score, then derive everything
    // (modifier, saves) from that final score.
    const finalScore = base + (bonusByAbility[name] ?? 0);
    const modifier = abilityModifier(finalScore);
    finalAbilityScores[name] = finalScore;
    abilityModifiers[name] = modifier;

    // Save proficiency depends on the class; skip until one is known.
    if (classRecord !== undefined) {
      const proficient = proficientSaves.has(ABILITY_FULL_NAMES[name]);
      savingThrows[name] = {
        modifier: modifier + (proficient ? LEVEL_1_PROFICIENCY_BONUS : 0),
        proficient,
      };
    }
  }

  const finalConstitution = finalAbilityScores.constitution;
  const maxHitPoints =
    classRecord !== undefined && finalConstitution !== undefined
      ? classRecord.hitDie + abilityModifier(finalConstitution)
      : undefined;

  return {
    proficiencyBonus: LEVEL_1_PROFICIENCY_BONUS,
    abilityModifiers,
    finalAbilityScores,
    savingThrows,
    ...(maxHitPoints !== undefined ? { maxHitPoints } : {}),
  };
}

/** Total bonus per ability across all increases (multiple increases stack). */
function sumIncreasesByAbility(
  increases: readonly AbilityScoreIncrease[] | undefined,
): Partial<Record<AbilityScoreName, number>> {
  const totals: Partial<Record<AbilityScoreName, number>> = {};
  for (const { ability, bonus } of increases ?? []) {
    totals[ability] = (totals[ability] ?? 0) + bonus;
  }
  return totals;
}
