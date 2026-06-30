import { describe, expect, it } from 'vitest';
import {
  deriveActionMechanics,
  deriveCreatureEntryMechanics,
  deriveSpellMechanics,
} from '../../../scripts/importers/dnd5e-srd-5.1/mechanicsProjections.js';
import type { SpellExtraction } from '../../../scripts/importers/dnd5e-srd-5.1/types.js';

describe('deriveCreatureEntryMechanics recharge parsing (eshyra-54di)', () => {
  it('parses an en-dash recharge range as minimum..maximum, not minimum..minimum', () => {
    const mechanics = deriveCreatureEntryMechanics(
      'Fire Breath (Recharge 5–6)',
      'The dragon exhales fire in a 60-foot cone.',
    );
    expect(mechanics.recharge).toEqual({ roll: 'd6', minimum: 5, maximum: 6 });
  });

  it('parses a 4-6 en-dash recharge range', () => {
    const mechanics = deriveCreatureEntryMechanics(
      'Whirlwind (Recharge 4–6)',
      'The elemental forms a whirlwind.',
    );
    expect(mechanics.recharge).toEqual({ roll: 'd6', minimum: 4, maximum: 6 });
  });

  it('parses a single fixed recharge value as minimum == maximum', () => {
    const mechanics = deriveCreatureEntryMechanics(
      'Frightful Presence (Recharge 6)',
      'Each creature must succeed on a saving throw.',
    );
    expect(mechanics.recharge).toEqual({ roll: 'd6', minimum: 6, maximum: 6 });
  });

  it('omits recharge when the name has no Recharge clause', () => {
    const mechanics = deriveCreatureEntryMechanics(
      'Bite',
      'Melee Weapon Attack: +9 to hit, reach 5 ft., one target.',
    );
    expect(mechanics.recharge).toBeUndefined();
  });
});

function spell(partial: Pick<SpellExtraction, 'description'>): SpellExtraction {
  return {
    name: 'Test Spell',
    level: 1,
    school: 'evocation',
    ritual: false,
    castingTime: '1 action',
    range: '60 feet',
    components: ['V', 'S'],
    duration: 'Instantaneous',
    sourcePage: 1,
    ...partial,
  };
}

describe('condition relation classification (eshyra-qqyj)', () => {
  it('spell:shield — "An invisible barrier" describes the barrier, not an applied condition', () => {
    const mechanics = deriveSpellMechanics(
      spell({
        description:
          'An invisible barrier of magical force appears and protects you. Until the start of your next turn, you have a +5 bonus to AC, including against the triggering attack, and you take no damage from magic missile.',
      }),
    );
    expect(mechanics.conditions).toEqual([
      { condition: 'invisible', relation: 'mention' },
    ]);
  });

  it('spell:sleep — charmed is an immunity clause, unconscious is the applied effect', () => {
    const mechanics = deriveSpellMechanics(
      spell({
        description:
          "This spell sends creatures into a magical slumber. Roll 5d8; the total is how many hit points of creatures this spell can affect. Creatures within 20 feet of a point you choose within range are affected in ascending order of their current hit points (ignoring unconscious creatures). Starting with the creature that has the lowest current hit points, each creature affected by this spell falls unconscious until the spell ends, the sleeper takes damage, or someone uses an action to shake or slap the sleeper awake. Subtract each creature's hit points from the total before moving on to the creature with the next lowest hit points. A creature's hit points must be equal to or less than the remaining total for that creature to be affected. Undead and creatures immune to being charmed aren't affected by this spell.",
      }),
    );
    expect(mechanics.conditions).toEqual(
      expect.arrayContaining([
        { condition: 'charmed', relation: 'immune' },
        { condition: 'unconscious', relation: 'applies' },
      ]),
    );
  });

  it('spell:color-spray — unconscious is a targeting exclusion, blinded is the applied effect', () => {
    const mechanics = deriveSpellMechanics(
      spell({
        description:
          "A dazzling array of flashing, colored light springs from your hand. Roll 6d10; the total is how many hit points of creatures this spell can effect. Creatures in a 15-foot cone originating from you are affected in ascending order of their current hit points (ignoring unconscious creatures and creatures that can't see). Starting with the creature that has the lowest current hit points, each creature affected by this spell is blinded until the spell ends. Subtract each creature's hit points from the total before moving on to the creature with the next lowest hit points. A creature's hit points must be equal to or less than the remaining total for that creature to be affected.",
      }),
    );
    expect(mechanics.conditions).toEqual(
      expect.arrayContaining([
        { condition: 'unconscious', relation: 'exclusion' },
        { condition: 'blinded', relation: 'applies' },
      ]),
    );
  });

  it('creature:death-dog Two-Headed — grants advantage against conditions, does not apply them', () => {
    const mechanics = deriveCreatureEntryMechanics(
      'Two-Headed',
      'The dog has advantage on Wisdom (Perception) checks and on saving throws against being blinded, charmed, deafened, frightened, stunned, or knocked unconscious.',
    );
    expect(mechanics.conditions).toEqual([
      { condition: 'blinded', relation: 'advantage' },
      { condition: 'charmed', relation: 'advantage' },
      { condition: 'deafened', relation: 'advantage' },
      { condition: 'frightened', relation: 'advantage' },
      { condition: 'stunned', relation: 'advantage' },
      { condition: 'unconscious', relation: 'advantage' },
    ]);
  });

  it('action:dodge — incapacitated is a prerequisite for losing the benefit, not an applied condition', () => {
    const mechanics = deriveActionMechanics({
      name: 'Dodge',
      sourcePage: 1,
      description:
        'When you take the Dodge action, you focus entirely on avoiding attacks. Until the start of your next turn, any attack roll made against you has disadvantage if you can see the attacker, and you make Dexterity saving throws with advantage. You lose this benefit if you are incapacitated (as explained in appendix PH-A) or if your speed drops to 0.',
    });
    expect(mechanics.conditions).toEqual([
      { condition: 'incapacitated', relation: 'exclusion' },
    ]);
  });

  it('classifies an explicit condition-removal sentence as "removes"', () => {
    const mechanics = deriveCreatureEntryMechanics(
      'Swallow',
      'If the creature dies, a swallowed creature is no longer restrained by it and can escape.',
    );
    expect(mechanics.conditions).toEqual([
      { condition: 'restrained', relation: 'removes' },
    ]);
  });

  it('classifies a disadvantage-against-condition sentence as "disadvantage"', () => {
    const mechanics = deriveCreatureEntryMechanics(
      'Test Trait',
      'The creature has disadvantage on saving throws against being frightened.',
    );
    expect(mechanics.conditions).toEqual([
      { condition: 'frightened', relation: 'disadvantage' },
    ]);
  });
});
