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

  it('adds ancestry ability increases into the final scores and modifiers', () => {
    const derived = deriveLevel1Values({
      validAbilityScores: { dexterity: 13, intelligence: 13 },
      // High Elf: +2 DEX, +1 INT.
      abilityScoreIncreases: [
        { ability: 'dexterity', bonus: 2 },
        { ability: 'intelligence', bonus: 1 },
      ],
    });
    expect(derived.finalAbilityScores).toEqual({
      dexterity: 15,
      intelligence: 14,
    });
    // Modifiers derive from the final scores, not the base scores.
    expect(derived.abilityModifiers).toEqual({
      dexterity: 2,
      intelligence: 2,
    });
  });

  it('derives HP and saves from the post-increase Constitution', () => {
    const derived = deriveLevel1Values({
      validAbilityScores: { constitution: 13 },
      classRecord: FIGHTER,
      // Hill Dwarf: +2 CON pushes 13 → 15 (mod +2).
      abilityScoreIncreases: [{ ability: 'constitution', bonus: 2 }],
    });
    // Fighter d10 + final CON +2 = 12 (base CON 13 alone would give +1 → 11).
    expect(derived.maxHitPoints).toBe(12);
    expect(derived.savingThrows.constitution).toEqual({
      modifier: 4,
      proficient: true,
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

  it('computes spell save DC and attack from the spellcasting ability', () => {
    const derived = deriveLevel1Values({
      validAbilityScores: { intelligence: 16 },
      classRecord: WIZARD,
      spellcastingAbility: 'intelligence',
    });
    // INT 16 (+3): save DC = 8 + prof 2 + 3 = 13; attack = 2 + 3 = 5.
    expect(derived.spellSaveDc).toBe(13);
    expect(derived.spellAttackModifier).toBe(5);
  });

  it('derives the spell DC from the post-increase ability score', () => {
    const derived = deriveLevel1Values({
      validAbilityScores: { intelligence: 15 },
      classRecord: WIZARD,
      spellcastingAbility: 'intelligence',
      // High Elf: +1 INT pushes 15 → 16 (mod +3), raising the DC.
      abilityScoreIncreases: [{ ability: 'intelligence', bonus: 1 }],
    });
    expect(derived.spellSaveDc).toBe(13);
    expect(derived.spellAttackModifier).toBe(5);
  });

  it('omits spell DC when no spellcasting ability is supplied', () => {
    const derived = deriveLevel1Values({
      validAbilityScores: { intelligence: 16 },
      classRecord: WIZARD,
    });
    expect(derived.spellSaveDc).toBeUndefined();
    expect(derived.spellAttackModifier).toBeUndefined();
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
