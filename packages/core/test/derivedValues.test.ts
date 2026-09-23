import { describe, expect, it } from 'vitest';
import { deriveLevel1Values } from '../src/internal.js';

const FIGHTER = {
  hitDie: 10,
  savingThrowProficiencies: ['Strength', 'Constitution'],
} as const;

const WIZARD = {
  hitDie: 6,
  savingThrowProficiencies: ['Intelligence', 'Wisdom'],
} as const;

describe('deriveLevel1Values', () => {
  it('computes ability modifiers and the level-1 proficiency bonus', () => {
    const derived = deriveLevel1Values({
      validAbilityScores: { strength: 16, dexterity: 13, charisma: 8 },
    });
    expect(derived.proficiencyBonus).toBe(2);
    expect(derived.abilityModifiers).toEqual({
      strength: 3,
      dexterity: 1,
      charisma: -1,
    });
    expect(derived.finalAbilityScores).toEqual({
      strength: 16,
      dexterity: 13,
      charisma: 8,
    });
  });

  it('omits HP when Constitution is missing', () => {
    const derived = deriveLevel1Values({
      validAbilityScores: { strength: 15 },
      classRecord: FIGHTER,
    });
    expect(derived.maxHitPoints).toBeUndefined();
  });

  it('applies class save proficiency to saving-throw modifiers', () => {
    const derived = deriveLevel1Values({
      validAbilityScores: { strength: 14, constitution: 14, dexterity: 12 },
      classRecord: FIGHTER,
    });
    // Proficient saves gain +2; non-proficient are the bare modifier.
    expect(derived.savingThrows.strength).toEqual({
      modifier: 4,
      proficient: true,
    });
    expect(derived.savingThrows.constitution).toEqual({
      modifier: 4,
      proficient: true,
    });
    expect(derived.savingThrows.dexterity).toEqual({
      modifier: 1,
      proficient: false,
    });
  });

  it('ignores increases for abilities not yet scored', () => {
    const derived = deriveLevel1Values({
      validAbilityScores: { strength: 15 },
      abilityScoreIncreases: [
        { ability: 'strength', bonus: 1 },
        { ability: 'charisma', bonus: 2 },
      ],
    });
    expect(derived.finalAbilityScores).toEqual({ strength: 16 });
  });

  it('stacks multiple increases to the same ability', () => {
    const derived = deriveLevel1Values({
      validAbilityScores: { strength: 14 },
      abilityScoreIncreases: [
        { ability: 'strength', bonus: 2 },
        { ability: 'strength', bonus: 1 },
      ],
    });
    expect(derived.finalAbilityScores).toEqual({ strength: 17 });
  });

  it('omits spell DC when the spellcasting ability has no score yet', () => {
    const derived = deriveLevel1Values({
      validAbilityScores: { strength: 12 },
      classRecord: WIZARD,
      spellcastingAbility: 'intelligence',
    });
    expect(derived.spellSaveDc).toBeUndefined();
    expect(derived.spellAttackModifier).toBeUndefined();
  });
});
