/**
 * Deterministic level-1 derived-value computation (eshyra-b69j.6).
 *
 * The draft engine (eshyra-b69j.5) and the recipe's derived hook
 * (eshyra-b69j.4) both need the same derived numbers, and a player must never
 * have to hand-enter hit points. This module is the single, pure source for
 * everything a level-1 D&D 5e SRD character's derived stats can be computed
 * from the generated rules pack today:
 *
 *   - ability modifiers and final ability scores;
 *   - the level-1 proficiency bonus (+2);
 *   - level-1 hit point maximum (class hit die + Constitution modifier);
 *   - saving-throw modifiers, with class save proficiencies applied.
 *
 * Prerequisite gating, not cascades: a value is simply absent until its inputs
 * exist (HP needs a class hit die *and* a valid Constitution; saving-throw
 * proficiency needs a class). Callers turn an absent value into a "waiting on
 * …" message; this module never invents nonsense numbers.
 *
 * Deferred derived values and why:
 *   - spell save DC / spell attack modifier — need each class's spellcasting
 *     ability, which the generated pack does not yet expose as structured data
 *     (it lives in class prose); modeled in eshyra-b69j.12, not parsed here;
 *   - passive Perception — needs the chosen skills (skill selection lands with
 *     eshyra-b69j.13);
 *   - armor class / attack bonuses — need equipment (eshyra-b69j.13).
 */

import { ABILITY_SCORE_NAMES, abilityModifier } from './abilities.js';
import type { AbilityScoreName } from './creation.js';

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
   * Final scores per ability. Equal to base scores until ancestry ability
   * bonuses are modeled (eshyra-b69j.12).
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
}

/** Display (full) name for each ability score, as stored on class records. */
const ABILITY_FULL_NAMES: Readonly<Record<AbilityScoreName, string>> = {
  strength: 'Strength',
  dexterity: 'Dexterity',
  constitution: 'Constitution',
  intelligence: 'Intelligence',
  wisdom: 'Wisdom',
  charisma: 'Charisma',
};

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

  for (const name of ABILITY_SCORE_NAMES) {
    const score = validAbilityScores[name];
    if (score === undefined) {
      continue;
    }
    const modifier = abilityModifier(score);
    // Ancestry ability bonuses are not yet modeled (eshyra-b69j.12), so the
    // final score equals the base score for now.
    finalAbilityScores[name] = score;
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

  const constitution = validAbilityScores.constitution;
  const maxHitPoints =
    classRecord !== undefined && constitution !== undefined
      ? classRecord.hitDie + abilityModifier(constitution)
      : undefined;

  return {
    proficiencyBonus: LEVEL_1_PROFICIENCY_BONUS,
    abilityModifiers,
    finalAbilityScores,
    savingThrows,
    ...(maxHitPoints !== undefined ? { maxHitPoints } : {}),
  };
}
