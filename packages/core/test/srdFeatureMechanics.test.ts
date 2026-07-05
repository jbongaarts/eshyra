import { describe, expect, it } from 'vitest';
import { getBundledDnd5eSrdPack } from '../src/rules/bundledSrdPack.js';

/**
 * Committed-pack depth assertions for complex deterministic features
 * (eshyra-o9bd.18.7.5 review). `hasMechanicsProjection` treats ANY mechanics
 * object as "modeled", so a typed-but-partial projection (a dropped
 * maximum, minimum, or level tier) is invisible to the readiness report.
 * These tests pin the ENTIRE intended structure of the features whose
 * projections were found incomplete, so a partial regression fails here
 * even though the record still "has mechanics".
 */

function dataOf(key: string): Record<string, unknown> {
  const record = getBundledDnd5eSrdPack().records.find(
    (candidate) => candidate.key === key,
  );
  expect(record, `${key} must exist in the committed pack`).toBeDefined();
  return record?.data as Record<string, unknown>;
}

function mechanicsOf(key: string): Record<string, unknown> {
  const mechanics = dataOf(key).mechanics as Record<string, unknown>;
  expect(mechanics, `${key} must carry mechanics`).toBeDefined();
  return mechanics;
}

describe('committed feature mechanics depth (eshyra-o9bd.18.7.5)', () => {
  it('Barbarian Unarmored Defense carries the full AC formula including shield eligibility', () => {
    expect(mechanicsOf('feature:barbarian:unarmored-defense').effects).toEqual([
      {
        kind: 'acFormula',
        base: 10,
        abilities: ['dexterity', 'constitution'],
        allowsShield: true,
      },
    ]);
  });

  it('Paladin Aura of Protection carries the minimum bonus and range scope', () => {
    expect(mechanicsOf('feature:paladin:aura-of-protection').effects).toEqual([
      {
        kind: 'savingThrowBonus',
        addAbilityModifier: 'charisma',
        minimum: 1,
        subject: 'you-or-friendly-creatures',
        rangeFeet: 10,
      },
    ]);
  });

  it('Paladin Divine Smite carries the 5d8 maximum and the undead/fiend rider', () => {
    expect(mechanicsOf('feature:paladin:divine-smite').effects).toEqual([
      {
        kind: 'extraDamage',
        dice: '2d8',
        perSlotLevelIncrease: '1d8',
        maximumDice: '5d8',
        bonusDiceVsUndeadOrFiend: '1d8',
      },
    ]);
  });

  it('Barbarian Brutal Critical carries the 13th/17th-level progression', () => {
    expect(mechanicsOf('feature:barbarian:brutal-critical').effects).toEqual([
      {
        kind: 'brutalCritical',
        additionalDice: 1,
        increases: [
          { level: 13, additionalDice: 2 },
          { level: 17, additionalDice: 3 },
        ],
      },
    ]);
  });

  it('Fighter Extra Attack carries the 11th/20th-level tiers', () => {
    expect(mechanicsOf('feature:fighter:extra-attack').effects).toEqual([
      {
        kind: 'extraAttack',
        attacks: 2,
        increases: [
          { level: 11, attacks: 3 },
          { level: 20, attacks: 4 },
        ],
      },
    ]);
  });

  it('Barbarian Reckless Attack keeps the coordinated but-clause out of the actor constraint', () => {
    expect(mechanicsOf('feature:barbarian:reckless-attack').effects).toEqual([
      {
        kind: 'attackRollModifier',
        mode: 'advantage',
        attackType: 'melee',
        constraint: 'using Strength during this turn',
      },
      {
        kind: 'attackRollModifier',
        subject: 'attackers-against-you',
        mode: 'advantage',
      },
    ]);
  });

  it('Dwarf Stonecunning projects a scoped proficiency plus scoped expertise', () => {
    const traits = dataOf('ancestry:dwarf').traits as Array<{
      name: string;
      mechanics?: { effects?: unknown };
    }>;
    const stonecunning = traits.find((trait) => trait.name === 'Stonecunning');
    expect(stonecunning?.mechanics?.effects).toEqual([
      {
        kind: 'proficiency',
        grant: 'the History skill',
        condition: 'related to the origin of stonework',
      },
      {
        kind: 'expertise',
        ability: 'intelligence',
        skill: 'history',
        condition: 'related to the origin of stonework',
      },
    ]);
  });

  it('condition relations: Persistent Rage / Danger Sense are exclusions, Grappler applies restrained', () => {
    expect(mechanicsOf('feature:barbarian:persistent-rage').conditions).toEqual(
      [{ condition: 'unconscious', relation: 'exclusion' }],
    );
    expect(mechanicsOf('feature:barbarian:danger-sense').conditions).toEqual([
      { condition: 'blinded', relation: 'exclusion' },
      { condition: 'deafened', relation: 'exclusion' },
      { condition: 'incapacitated', relation: 'exclusion' },
    ]);
    expect(mechanicsOf('feat:grappler').conditions).toContainEqual({
      condition: 'restrained',
      relation: 'applies',
    });
    expect(mechanicsOf('feat:grappler').conditions).not.toContainEqual(
      expect.objectContaining({
        condition: 'restrained',
        relation: 'mention',
      }),
    );
  });
});

describe('re-audited action-economy and numeric features (eshyra-o9bd.18.7.5 re-review)', () => {
  it('Cunning Action carries the full bonus-action option set', () => {
    expect(mechanicsOf('feature:rogue:cunning-action').effects).toEqual([
      {
        kind: 'bonusAction',
        options: ['dash', 'disengage', 'hide'],
        frequency: 'each-turn',
      },
    ]);
  });

  it('Martial Arts carries the bonus-action strike, ability substitution, and die replacement', () => {
    expect(mechanicsOf('feature:monk:martial-arts').effects).toEqual([
      { kind: 'bonusAction', options: ['unarmed-strike'] },
      {
        kind: 'abilitySubstitution',
        use: 'dexterity',
        insteadOf: 'strength',
        for: ['attack-rolls', 'damage-rolls'],
        appliesTo: 'your unarmed strikes and monk weapons',
      },
      {
        kind: 'damageDieReplacement',
        die: 'd4',
        appliesTo: 'your unarmed strike or monk weapon',
      },
    ]);
  });

  it('Frenzy carries the bonus-action attack and applies exhaustion when rage ends', () => {
    const mechanics = mechanicsOf('feature:path-of-the-berserker:frenzy');
    expect(mechanics.effects).toEqual([
      {
        kind: 'bonusAction',
        options: ['melee-weapon-attack'],
        frequency: 'each-turn',
      },
    ]);
    expect(mechanics.conditions).toEqual([
      { condition: 'exhaustion', relation: 'applies' },
    ]);
  });

  it('Retaliation is a typed reaction attack with its trigger', () => {
    expect(
      mechanicsOf('feature:path-of-the-berserker:retaliation').effects,
    ).toEqual([
      {
        kind: 'reaction',
        action: 'melee-weapon-attack',
        trigger: 'take damage from a creature within 5 feet of you',
      },
    ]);
  });

  it('Perfect Self and Superior Inspiration are typed resource regains', () => {
    expect(mechanicsOf('feature:monk:perfect-self').effects).toEqual([
      {
        kind: 'resourceRegain',
        resource: 'ki-points',
        amount: 4,
        trigger: 'roll-initiative-with-none-remaining',
      },
    ]);
    expect(mechanicsOf('feature:bard:superior-inspiration').effects).toEqual([
      {
        kind: 'resourceRegain',
        resource: 'bardic-inspiration',
        amount: 1,
        trigger: 'roll-initiative-with-none-remaining',
      },
    ]);
  });

  it('Purity of Spirit resolves its always-on spell reference', () => {
    expect(
      mechanicsOf('feature:oath-of-devotion:purity-of-spirit').effects,
    ).toEqual([
      {
        kind: 'permanentSpellEffect',
        spell: 'spell:protection-from-evil-and-good',
      },
    ]);
  });

  it('Second-Story Work carries the climb cost and running-jump formulas', () => {
    expect(mechanicsOf('feature:thief:second-story-work').effects).toEqual([
      { kind: 'climbWithoutExtraMovement' },
      {
        kind: 'jumpDistanceBonus',
        addAbilityModifier: 'dexterity',
        appliesTo: 'running-jump',
      },
    ]);
  });

  it('Sculpt Spells and Potent Cantrip carry typed save-outcome semantics', () => {
    expect(
      mechanicsOf('feature:school-of-evocation:sculpt-spells').effects,
    ).toEqual([
      {
        kind: 'autoSucceedSave',
        targets: 'chosen-creatures',
        countFormula: '1 + spell-level',
        noDamageInsteadOfHalf: true,
      },
    ]);
    expect(
      mechanicsOf('feature:school-of-evocation:potent-cantrip').effects,
    ).toEqual([
      {
        kind: 'damageOnSuccessfulSave',
        portion: 'half',
        scope: 'your-cantrips',
      },
    ]);
  });
});
