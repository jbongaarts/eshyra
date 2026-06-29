import { describe, expect, it } from 'vitest';
import {
  castsAtLevel1,
  getBundledDnd5eCharacterResolver,
  getClassSpellcasting,
  level1PreparedSpellCount,
  level1SpellcastingAbility,
} from '../src/internal.js';

/**
 * Source-cited spellcasting constants are retained as regression oracles.
 * Runtime creation/level-up reads generated pack fields; these tests assert
 * that the generated fields still match the SRD-derived oracle values.
 */

const resolver = getBundledDnd5eCharacterResolver();

function classRecord(name: string) {
  const result = resolver.resolveClass(name);
  if (!result.ok) {
    throw new Error(`class not resolved: ${name}`);
  }
  return result.record;
}

describe('per-class spellcasting oracle', () => {
  it('matches generated pack spellcasting fields for every modeled caster', () => {
    for (const name of [
      'Bard',
      'Cleric',
      'Druid',
      'Paladin',
      'Ranger',
      'Sorcerer',
      'Warlock',
      'Wizard',
    ]) {
      const record = classRecord(name);
      const oracle = getClassSpellcasting(record.key);
      if (oracle === undefined) {
        throw new Error(`missing oracle for ${record.key}`);
      }
      expect(record.spellcastingAbility).toBe(oracle.ability);
      expect(record.spellPreparation).toEqual({
        kind: oracle.preparation,
        ...(oracle.spellbookStartingSpells !== undefined
          ? { spellbookStartingSpells: oracle.spellbookStartingSpells }
          : {}),
        sourceText: oracle.sourceText,
      });
    }
  });

  it('maps each caster to its SRD spellcasting ability', () => {
    expect(getClassSpellcasting('class:wizard')?.ability).toBe('intelligence');
    expect(getClassSpellcasting('class:cleric')?.ability).toBe('wisdom');
    expect(getClassSpellcasting('class:druid')?.ability).toBe('wisdom');
    expect(getClassSpellcasting('class:bard')?.ability).toBe('charisma');
    expect(getClassSpellcasting('class:sorcerer')?.ability).toBe('charisma');
    expect(getClassSpellcasting('class:warlock')?.ability).toBe('charisma');
    // Half-casters carry the fact even though they start casting at level 2.
    expect(getClassSpellcasting('class:paladin')?.ability).toBe('charisma');
    expect(getClassSpellcasting('class:ranger')?.ability).toBe('wisdom');
  });

  it('classifies known vs prepared casters and the Wizard spellbook', () => {
    expect(getClassSpellcasting('class:bard')?.preparation).toBe('known');
    expect(getClassSpellcasting('class:sorcerer')?.preparation).toBe('known');
    expect(getClassSpellcasting('class:warlock')?.preparation).toBe('known');
    expect(getClassSpellcasting('class:cleric')?.preparation).toBe('prepared');
    expect(getClassSpellcasting('class:druid')?.preparation).toBe('prepared');

    const wizard = getClassSpellcasting('class:wizard');
    expect(wizard?.preparation).toBe('prepared');
    // Only the Wizard has a creation-time spellbook (six 1st-level spells).
    expect(wizard?.spellbookStartingSpells).toBe(6);
    expect(getClassSpellcasting('class:cleric')?.spellbookStartingSpells).toBe(
      undefined,
    );
  });

  it('returns undefined for non-casters and unknown keys', () => {
    expect(getClassSpellcasting('class:fighter')).toBeUndefined();
    expect(getClassSpellcasting('class:barbarian')).toBeUndefined();
    expect(getClassSpellcasting('class:artificer')).toBeUndefined();
  });

  it("cites SRD prose faithful to the overlay's own structured fields", () => {
    const wizard = getClassSpellcasting('class:wizard');
    expect(wizard?.sourceText).toMatch(/six 1st-level wizard spells/i);
    expect(wizard?.sourceText).toMatch(
      /Intelligence is your spellcasting ability/i,
    );
    expect(getClassSpellcasting('class:cleric')?.sourceText).toMatch(
      /Wisdom modifier \+ your cleric level/i,
    );
  });

  it('computes the level-1 prepared count as ability modifier + level (min 1)', () => {
    expect(level1PreparedSpellCount(3)).toBe(4); // +3 mod → 4 prepared
    expect(level1PreparedSpellCount(0)).toBe(1); // floor at one spell
    expect(level1PreparedSpellCount(-1)).toBe(1); // negative mod still floors
  });

  it('gates level-1 casting on the progression row, not overlay membership', () => {
    // Wizard, Cleric, Bard cast at level 1.
    expect(castsAtLevel1(classRecord('Wizard'))).toBe(true);
    expect(level1SpellcastingAbility(classRecord('Wizard'))).toBe(
      'intelligence',
    );
    expect(level1SpellcastingAbility(classRecord('Cleric'))).toBe('wisdom');

    // Paladin and Ranger have an overlay ability but no level-1 spellcasting.
    expect(castsAtLevel1(classRecord('Paladin'))).toBe(false);
    expect(castsAtLevel1(classRecord('Ranger'))).toBe(false);
    expect(level1SpellcastingAbility(classRecord('Paladin'))).toBeUndefined();
    expect(level1SpellcastingAbility(classRecord('Ranger'))).toBeUndefined();

    // Non-casters never cast.
    expect(castsAtLevel1(classRecord('Fighter'))).toBe(false);
    expect(level1SpellcastingAbility(classRecord('Fighter'))).toBeUndefined();
    expect(level1SpellcastingAbility(undefined)).toBeUndefined();
  });

  it('covers every frozen class that casts at level 1', () => {
    for (const name of [
      'Bard',
      'Cleric',
      'Druid',
      'Sorcerer',
      'Warlock',
      'Wizard',
    ]) {
      const record = classRecord(name);
      expect(castsAtLevel1(record)).toBe(true);
      expect(getClassSpellcasting(record.key)).toBeDefined();
    }
  });
});
