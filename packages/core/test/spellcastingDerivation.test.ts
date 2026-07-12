import { describe, expect, it } from 'vitest';
import { deriveSpellcastingValues } from '../src/internal.js';

describe('spellcasting derivation hook', () => {
  it('preserves base values and sums independently auditable contributions', () => {
    expect(
      deriveSpellcastingValues({
        proficiencyBonus: 3,
        abilityModifier: 4,
        spellSaveDcModifiers: [{ sourceRef: 'item:a', value: 1 }],
        spellAttackModifiers: [
          { sourceRef: 'item:a', value: 1 },
          { sourceRef: 'feature:x', value: 2 },
        ],
      }),
    ).toMatchObject({
      baseSpellSaveDc: 15,
      baseSpellAttackModifier: 7,
      spellSaveDc: 16,
      spellAttackModifier: 10,
    });
  });

  it('fails closed on invalid contribution values', () => {
    expect(() =>
      deriveSpellcastingValues({
        proficiencyBonus: 2,
        abilityModifier: 3,
        spellSaveDcModifiers: [{ sourceRef: 'item:x', value: Number.NaN }],
      }),
    ).toThrow(/malformed/);
  });
});
