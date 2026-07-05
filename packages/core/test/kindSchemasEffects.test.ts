import { describe, expect, it } from 'vitest';
import { validateRecordKindSchema } from '../src/rules/kindSchemas.js';
import type { RulesRecord } from '../src/rules/types.js';

/**
 * Negative payload-contract tests for the structured mechanics effect kinds
 * (eshyra-o9bd.18.7.5 review): a recognized `kind` string with a malformed
 * payload must FAIL pack validation, not slide through on the kind
 * whitelist alone.
 */

function featureWithEffect(effect: Record<string, unknown>): RulesRecord {
  return {
    systemId: 'dnd5e-srd',
    kind: 'feature',
    key: 'feature:test:effect',
    name: 'Effect Test',
    data: {
      source: 'class:test',
      level: 1,
      description: 'Test feature.',
      mechanics: { effects: [effect] },
    },
  } as RulesRecord;
}

const validate = (effect: Record<string, unknown>): void =>
  validateRecordKindSchema(featureWithEffect(effect), 'records[0]');

describe('mechanics effect payload contracts', () => {
  it('accepts the emitted damageReduction shapes', () => {
    expect(() =>
      validate({
        kind: 'damageReduction',
        dice: '1d10',
        addAbilityModifier: 'dexterity',
        addClassLevel: 'monk',
      }),
    ).not.toThrow();
    expect(() =>
      validate({
        kind: 'damageReduction',
        multiplier: 0.5,
        scope: 'triggering-attack',
      }),
    ).not.toThrow();
    expect(() =>
      validate({
        kind: 'damageReduction',
        scope: 'falling',
        amountFormula: '5 × monk-level',
      }),
    ).not.toThrow();
  });

  it('rejects malformed damageReduction payloads', () => {
    expect(() => validate({ kind: 'damageReduction' })).toThrow(
      /must carry dice, multiplier, or amountFormula/,
    );
    expect(() =>
      validate({ kind: 'damageReduction', multiplier: 'half' }),
    ).toThrow(/multiplier must be a finite number/);
    expect(() => validate({ kind: 'damageReduction', multiplier: 2 })).toThrow(
      /multiplier must be a finite number/,
    );
    expect(() =>
      validate({ kind: 'damageReduction', amountFormula: 42 }),
    ).toThrow(/amountFormula/);
    expect(() =>
      validate({
        kind: 'damageReduction',
        dice: '1d10',
        addAbilityModifier: 'luck',
      }),
    ).toThrow(/must be an ability name/);
    expect(() => validate({ kind: 'damageReduction', dice: 'a lot' })).toThrow(
      /dice expression/,
    );
  });

  it('rejects malformed payloads for the other structured kinds', () => {
    expect(() =>
      validate({ kind: 'brutalCritical', additionalDice: 'one' }),
    ).toThrow(/additionalDice/);
    expect(() =>
      validate({
        kind: 'abilityScoreIncrease',
        abilities: ['strength', 'luck'],
        amount: 4,
      }),
    ).toThrow(/ability-name array/);
    expect(() =>
      validate({ kind: 'saveDcFormula', base: 8, ability: 'luck' }),
    ).toThrow(/ability name/);
    expect(() => validate({ kind: 'acFormula', base: 10 })).toThrow(
      /abilities/,
    );
    expect(() => validate({ kind: 'extraAttack', attacks: 1 })).toThrow(
      /attacks/,
    );
    expect(() => validate({ kind: 'bonusAction', options: [] })).toThrow(
      /non-empty string array/,
    );
    expect(() =>
      validate({ kind: 'reaction', action: 'melee-weapon-attack' }),
    ).toThrow(/trigger/);
    expect(() =>
      validate({
        kind: 'resourceRegain',
        resource: 'ki-points',
        amount: 0,
        trigger: 't',
      }),
    ).toThrow(/amount/);
    expect(() =>
      validate({ kind: 'permanentSpellEffect', spell: 'not-a-ref' }),
    ).toThrow(/spell:/);
    expect(() =>
      validate({
        kind: 'abilitySubstitution',
        use: 'dexterity',
        insteadOf: 'vigor',
      }),
    ).toThrow(/ability name/);
    expect(() =>
      validate({ kind: 'weaponAttacksMagical', scope: 'everything' }),
    ).toThrow(/scope/);
  });
});
