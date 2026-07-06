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

  it('accepts every emitted shape of the eshyra-o9bd.18.7.5 re-audit kinds', () => {
    const eligibility = {
      wielding: 'unarmed-or-monk-weapons-only',
      armor: false,
      shield: false,
    };
    const emitted: Record<string, unknown>[] = [
      { kind: 'attackOrDamageBonus', addAbilityModifier: 'wisdom' },
      {
        kind: 'autoSucceedSave',
        targets: 'chosen-creatures',
        countFormula: '1 + spell-level',
        noDamageInsteadOfHalf: true,
      },
      { kind: 'climbWithoutExtraMovement' },
      { kind: 'evasion' },
      { kind: 'damageBonus', amount: 2 },
      {
        kind: 'damageBonus',
        addAbilityModifier: 'charisma',
        scope: 'one-damage-roll',
      },
      {
        kind: 'damageDieReplacement',
        die: 'd4',
        appliesTo: 'your unarmed strike or monk weapon',
        progression: { classRef: 'class:monk', resource: 'martialArts' },
        eligibility,
      },
      {
        kind: 'damageOnSuccessfulSave',
        portion: 'half',
        scope: 'your-cantrips',
      },
      { kind: 'extraTurn', round: 1, secondTurnInitiativeOffset: -10 },
      { kind: 'expertise' },
      {
        kind: 'expertise',
        ability: 'intelligence',
        skill: 'history',
        condition: 'related to the origin of stonework',
      },
      { kind: 'halfProficiencyToChecks', round: 'down', scope: 'ability' },
      {
        kind: 'jumpDistanceBonus',
        addAbilityModifier: 'dexterity',
        appliesTo: 'running-jump',
      },
      { kind: 'maximizeHealingDice', appliesTo: 'spell-healing' },
      { kind: 'slowAging', periodYears: 10, agesYears: 1 },
      { kind: 'speedSet', speed: 0, subject: 'conditioned' },
      {
        kind: 'speedSet',
        mode: 'fly',
        value: 'current-speed',
        activation: { cost: 'bonus-action' },
        deactivation: { cost: 'bonus-action' },
        eligibility: { armor: 'accommodating-armor-only' },
      },
      {
        kind: 'bonusAction',
        options: ['unarmed-strike'],
        prerequisite: 'attack-action-with-unarmed-strike-or-monk-weapon',
        eligibility,
      },
      {
        kind: 'abilitySubstitution',
        use: 'dexterity',
        insteadOf: 'strength',
        for: ['attack-rolls', 'damage-rolls'],
        appliesTo: 'your unarmed strikes and monk weapons',
        eligibility,
      },
    ];
    for (const effect of emitted) {
      expect(() => validate(effect), JSON.stringify(effect)).not.toThrow();
    }
  });

  it('rejects malformed payloads for the eshyra-o9bd.18.7.5 re-audit kinds', () => {
    expect(() =>
      validate({ kind: 'attackOrDamageBonus', addAbilityModifier: 'luck' }),
    ).toThrow(/ability name/);
    expect(() =>
      validate({ kind: 'autoSucceedSave', targets: 'chosen-creatures' }),
    ).toThrow(/countFormula/);
    expect(() =>
      validate({
        kind: 'autoSucceedSave',
        targets: 'chosen-creatures',
        countFormula: '1 + spell-level',
        noDamageInsteadOfHalf: 'yes',
      }),
    ).toThrow(/noDamageInsteadOfHalf/);
    // Marker-only kinds must not carry payload fields at all.
    expect(() =>
      validate({ kind: 'climbWithoutExtraMovement', speed: 30 }),
    ).toThrow(/marker-only/);
    expect(() => validate({ kind: 'evasion', portion: 'half' })).toThrow(
      /marker-only/,
    );
    expect(() => validate({ kind: 'damageBonus' })).toThrow(
      /exactly one of amount or addAbilityModifier/,
    );
    expect(() =>
      validate({
        kind: 'damageBonus',
        amount: 2,
        addAbilityModifier: 'charisma',
      }),
    ).toThrow(/exactly one of amount or addAbilityModifier/);
    expect(() => validate({ kind: 'damageBonus', amount: 2.5 })).toThrow(
      /integer/,
    );
    expect(() => validate({ kind: 'damageDieReplacement', die: 'd4' })).toThrow(
      /appliesTo/,
    );
    expect(() =>
      validate({
        kind: 'damageDieReplacement',
        die: 'four-sided',
        appliesTo: 'unarmed strikes',
      }),
    ).toThrow(/dice expression/);
    expect(() =>
      validate({
        kind: 'damageDieReplacement',
        die: 'd4',
        appliesTo: 'unarmed strikes',
        progression: { classRef: 'monk', resource: 'martialArts' },
      }),
    ).toThrow(/class:/);
    expect(() =>
      validate({
        kind: 'damageDieReplacement',
        die: 'd4',
        appliesTo: 'unarmed strikes',
        eligibility: { armor: 'no-heavy' },
      }),
    ).toThrow(/eligibility\.armor/);
    expect(() =>
      validate({
        kind: 'damageDieReplacement',
        die: 'd4',
        appliesTo: 'unarmed strikes',
        eligibility: { stance: 'defensive' },
      }),
    ).toThrow(/unsupported key/);
    expect(() =>
      validate({
        kind: 'damageOnSuccessfulSave',
        portion: 'quarter',
        scope: 'your-cantrips',
      }),
    ).toThrow(/portion/);
    expect(() =>
      validate({
        kind: 'extraTurn',
        round: 0,
        secondTurnInitiativeOffset: -10,
      }),
    ).toThrow(/round/);
    expect(() =>
      validate({
        kind: 'extraTurn',
        round: 1,
        secondTurnInitiativeOffset: 'minus ten',
      }),
    ).toThrow(/secondTurnInitiativeOffset/);
    expect(() => validate({ kind: 'expertise', ability: 'luck' })).toThrow(
      /ability name/,
    );
    expect(() =>
      validate({
        kind: 'halfProficiencyToChecks',
        round: 'sideways',
        scope: 'ability',
      }),
    ).toThrow(/round/);
    expect(() =>
      validate({ kind: 'halfProficiencyToChecks', round: 'up' }),
    ).toThrow(/scope/);
    expect(() =>
      validate({ kind: 'jumpDistanceBonus', appliesTo: 'running-jump' }),
    ).toThrow(/addAbilityModifier/);
    expect(() => validate({ kind: 'maximizeHealingDice' })).toThrow(
      /appliesTo/,
    );
    expect(() =>
      validate({ kind: 'slowAging', periodYears: 0, agesYears: 1 }),
    ).toThrow(/periodYears/);
    expect(() =>
      validate({ kind: 'speedSet', mode: 'teleport', value: 30 }),
    ).toThrow(/mode/);
    expect(() =>
      validate({ kind: 'speedSet', mode: 'fly', value: 'twice-current' }),
    ).toThrow(/value/);
    expect(() =>
      validate({
        kind: 'speedSet',
        mode: 'fly',
        value: 'current-speed',
        activation: { cost: 'free' },
      }),
    ).toThrow(/cost/);
    expect(() =>
      validate({
        kind: 'bonusAction',
        options: ['unarmed-strike'],
        prerequisite: '',
      }),
    ).toThrow(/prerequisite/);
  });
});
