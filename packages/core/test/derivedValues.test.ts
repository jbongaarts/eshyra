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

  it('computes level-1 HP as hit die plus Constitution modifier', () => {
    const derived = deriveLevel1Values({
      validAbilityScores: { constitution: 14 },
      classRecord: FIGHTER,
    });
    // Fighter d10 + CON +2 = 12.
    expect(derived.maxHitPoints).toBe(12);
  });

  it('omits HP when the class is unknown', () => {
    const derived = deriveLevel1Values({
      validAbilityScores: { constitution: 14 },
    });
    expect(derived.maxHitPoints).toBeUndefined();
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

  it('reflects a different class hit die and save set', () => {
    const derived = deriveLevel1Values({
      validAbilityScores: { intelligence: 16, constitution: 12 },
      classRecord: WIZARD,
    });
    // Wizard d6 + CON +1 = 7.
    expect(derived.maxHitPoints).toBe(7);
    expect(derived.savingThrows.intelligence?.proficient).toBe(true);
    expect(derived.savingThrows.constitution?.proficient).toBe(false);
  });

  it('does not populate saving throws before a class is chosen', () => {
    const derived = deriveLevel1Values({
      validAbilityScores: { strength: 14 },
    });
    expect(derived.savingThrows).toEqual({});
  });
});
