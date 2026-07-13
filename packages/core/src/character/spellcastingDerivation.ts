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
  readonly spellSaveDcContributions: readonly DerivedModifierContribution[];
  readonly spellAttackContributions: readonly DerivedModifierContribution[];
  readonly spellSaveDcModifierTotal: number;
  readonly spellAttackModifierTotal: number;
  readonly spellSaveDc: number;
  readonly spellAttackModifier: number;
}

function total(
  contributions: readonly DerivedModifierContribution[] | undefined,
): {
  readonly total: number;
  readonly contributions: readonly DerivedModifierContribution[];
} {
  let sum = 0;
  const applied: DerivedModifierContribution[] = [];
  for (const contribution of contributions ?? []) {
    if (
      typeof contribution.sourceRef !== 'string' ||
      contribution.sourceRef.trim().length === 0 ||
      !Number.isSafeInteger(contribution.value)
    ) {
      throw new Error('spellcasting modifier contribution is malformed');
    }
    sum += contribution.value;
    if (!Number.isSafeInteger(sum)) {
      throw new Error('spellcasting modifier contribution total overflowed');
    }
    applied.push({
      sourceRef: contribution.sourceRef,
      value: contribution.value,
    });
  }
  return { total: sum, contributions: applied };
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
  if (
    !Number.isSafeInteger(baseSpellSaveDc) ||
    !Number.isSafeInteger(baseSpellAttackModifier)
  ) {
    throw new Error('spellcasting base values overflowed');
  }
  const spellSave = total(input.spellSaveDcModifiers);
  const spellAttack = total(input.spellAttackModifiers);
  const spellSaveDc = baseSpellSaveDc + spellSave.total;
  const spellAttackModifier = baseSpellAttackModifier + spellAttack.total;
  if (
    !Number.isSafeInteger(spellSaveDc) ||
    !Number.isSafeInteger(spellAttackModifier)
  ) {
    throw new Error('spellcasting derived values overflowed');
  }
  return {
    baseSpellSaveDc,
    baseSpellAttackModifier,
    spellSaveDcContributions: spellSave.contributions,
    spellAttackContributions: spellAttack.contributions,
    spellSaveDcModifierTotal: spellSave.total,
    spellAttackModifierTotal: spellAttack.total,
    spellSaveDc,
    spellAttackModifier,
  };
}
