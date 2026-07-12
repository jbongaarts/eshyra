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
      spellSaveDcContributions: [{ sourceRef: 'item:a', value: 1 }],
      spellAttackContributions: [
        { sourceRef: 'item:a', value: 1 },
        { sourceRef: 'feature:x', value: 2 },
      ],
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

  it('rejects blank sources and contribution overflow without mutating inputs', () => {
    const contributions = [{ sourceRef: 'item:x', value: 1 }];
    expect(() =>
      deriveSpellcastingValues({
        proficiencyBonus: 2,
        abilityModifier: 3,
        spellSaveDcModifiers: [{ sourceRef: ' ', value: 1 }],
      }),
    ).toThrow(/malformed/);
    expect(() =>
      deriveSpellcastingValues({
        proficiencyBonus: 2,
        abilityModifier: 3,
        spellSaveDcModifiers: [
          { sourceRef: 'a', value: Number.MAX_SAFE_INTEGER },
          { sourceRef: 'b', value: 1 },
        ],
      }),
    ).toThrow(/overflow/);
    expect(contributions).toEqual([{ sourceRef: 'item:x', value: 1 }]);
  });
});
