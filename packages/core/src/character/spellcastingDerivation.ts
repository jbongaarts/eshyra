export interface DerivedModifierContribution {
  readonly sourceRef: string;
  readonly value: number;
}

export interface DeriveSpellcastingValuesInput {
  readonly proficiencyBonus: number;
  readonly abilityModifier: number;
  readonly spellSaveDcModifiers?: readonly DerivedModifierContribution[];
  readonly spellAttackModifiers?: readonly DerivedModifierContribution[];
}

export interface DerivedSpellcastingValues {
  readonly baseSpellSaveDc: number;
  readonly baseSpellAttackModifier: number;
  readonly spellSaveDcModifierTotal: number;
  readonly spellAttackModifierTotal: number;
  readonly spellSaveDc: number;
  readonly spellAttackModifier: number;
}

function total(
  contributions: readonly DerivedModifierContribution[] | undefined,
): number {
  return (contributions ?? []).reduce((sum, contribution) => {
    if (
      contribution.sourceRef.trim().length === 0 ||
      !Number.isSafeInteger(contribution.value)
    ) {
      throw new Error('spellcasting modifier contribution is malformed');
    }
    return sum + contribution.value;
  }, 0);
}

export function deriveSpellcastingValues(
  input: DeriveSpellcastingValuesInput,
): DerivedSpellcastingValues {
  if (
    !Number.isSafeInteger(input.proficiencyBonus) ||
    !Number.isSafeInteger(input.abilityModifier)
  ) {
    throw new Error('spellcasting base modifiers must be safe integers');
  }
  const baseSpellSaveDc = 8 + input.proficiencyBonus + input.abilityModifier;
  const baseSpellAttackModifier =
    input.proficiencyBonus + input.abilityModifier;
  const spellSaveDcModifierTotal = total(input.spellSaveDcModifiers);
  const spellAttackModifierTotal = total(input.spellAttackModifiers);
  return {
    baseSpellSaveDc,
    baseSpellAttackModifier,
    spellSaveDcModifierTotal,
    spellAttackModifierTotal,
    spellSaveDc: baseSpellSaveDc + spellSaveDcModifierTotal,
    spellAttackModifier: baseSpellAttackModifier + spellAttackModifierTotal,
  };
}
