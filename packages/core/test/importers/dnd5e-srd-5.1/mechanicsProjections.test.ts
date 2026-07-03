import { describe, expect, it } from 'vitest';
import {
  deriveActionMechanics,
  deriveCreatureEntryMechanics,
  deriveSpellMechanics,
} from '../../../scripts/importers/dnd5e-srd-5.1/mechanicsProjections.js';
import type {
  ActionExtraction,
  SpellExtraction,
} from '../../../scripts/importers/dnd5e-srd-5.1/types.js';

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

function action(
  name: string,
  description: string = `${name} description.`,
): ActionExtraction {
  return {
    name,
    description,
    sourcePage: 1,
  };
}

describe('deriveActionMechanics standard action semantics (eshyra-o9bd.18.7.2)', () => {
  it('projects action economy for every canonical combat action', () => {
    for (const name of [
      'Attack',
      'Cast a Spell',
      'Dash',
      'Disengage',
      'Dodge',
      'Help',
      'Hide',
      'Ready',
      'Search',
      'Use an Object',
    ]) {
      expect(deriveActionMechanics(action(name)).actionEconomy, name).toEqual({
        cost: 'action',
      });
    }
  });

  it('Attack records one melee or ranged attack and the Extra Attack boundary', () => {
    expect(deriveActionMechanics(action('Attack')).effects).toEqual([
      {
        kind: 'makeAttack',
        count: 1,
        attackKinds: ['melee', 'ranged'],
        ruleRef: 'rule:making-an-attack',
        extraAttacksFromFeatures: true,
      },
    ]);
  });

  it('Cast a Spell links the action to 1-action casting times only', () => {
    expect(deriveActionMechanics(action('Cast a Spell')).effects).toEqual([
      {
        kind: 'castSpell',
        castingTime: '1 action',
        ruleRef: 'rule:casting-a-spell',
        note: 'Only spells with a casting time of 1 action use this action in combat.',
      },
    ]);
  });

  it('Dash records extra movement equal to current speed after modifiers', () => {
    expect(deriveActionMechanics(action('Dash')).effects).toEqual([
      {
        kind: 'extraMovement',
        amount: 'speed-after-modifiers',
        duration: 'current-turn',
      },
    ]);
  });

  it('Disengage prevents opportunity attacks from your movement for the turn', () => {
    expect(deriveActionMechanics(action('Disengage')).effects).toEqual([
      {
        kind: 'preventOpportunityAttacks',
        scope: 'your-movement',
        duration: 'rest-of-turn',
        ruleRef: 'rule:opportunity-attacks',
      },
    ]);
  });

  it('Dodge keeps attack disadvantage, Dexterity-save advantage, and loss conditions typed', () => {
    expect(deriveActionMechanics(action('Dodge')).effects).toEqual([
      {
        kind: 'attackRollModifier',
        modifier: 'disadvantage',
        appliesTo: 'attack-rolls-against-you',
        condition: 'you-can-see-the-attacker',
        duration: 'until-start-of-your-next-turn',
      },
      {
        kind: 'savingThrowModifier',
        modifier: 'advantage',
        ability: 'dexterity',
        appliesTo: 'you',
        duration: 'until-start-of-your-next-turn',
      },
      {
        kind: 'benefitEndsWhen',
        conditions: ['you-are-incapacitated', 'your-speed-is-0'],
      },
    ]);
  });

  it('Help models both aided checks and friendly attack timing constraints', () => {
    expect(deriveActionMechanics(action('Help')).effects).toEqual([
      {
        kind: 'abilityCheckModifier',
        modifier: 'advantage',
        appliesTo: 'creature-you-aid',
        timing: 'next-ability-check-before-start-of-your-next-turn',
        constraint: 'check-must-perform-the-task-you-helped-with',
      },
      {
        kind: 'attackRollModifier',
        modifier: 'advantage',
        appliesTo: 'friendly-creature-first-attack-roll',
        timing: 'before-your-next-turn',
        targetConstraint: 'target-creature-within-5-feet-of-you',
      },
    ]);
  });

  it('Hide links the Dexterity Stealth check to hiding and unseen-attacker rules', () => {
    expect(deriveActionMechanics(action('Hide')).effects).toEqual([
      {
        kind: 'makeAbilityCheck',
        ability: 'dexterity',
        skill: 'stealth',
        purpose: 'hide',
        ruleRef: 'rule:hiding',
      },
      {
        kind: 'gainRuleBenefitsOnSuccess',
        ruleRef: 'rule:unseen-attackers-and-targets',
      },
    ]);
  });

  it('Ready models trigger choice, reaction release, and spell concentration caveat', () => {
    expect(deriveActionMechanics(action('Ready')).effects).toEqual([
      {
        kind: 'readyAction',
        trigger: 'perceivable-circumstance',
        responseOptions: ['action', 'move-up-to-speed'],
        releaseCost: 'reaction',
        timing: 'after-trigger-finishes-before-start-of-your-next-turn',
        mayIgnoreTrigger: true,
        ruleRef: 'rule:ready',
      },
      {
        kind: 'readySpell',
        spellCastingTime: '1 action',
        heldByConcentration: true,
        releaseCost: 'reaction',
        failure: 'spell-dissipates-if-concentration-breaks',
        ruleRef: 'rule:concentration',
      },
    ]);
  });

  it('Search links GM-selected Perception or Investigation checks', () => {
    expect(deriveActionMechanics(action('Search')).effects).toEqual([
      {
        kind: 'makeAbilityCheck',
        abilityOptions: ['wisdom', 'intelligence'],
        skillOptions: ['perception', 'investigation'],
        purpose: 'find-something',
        chosenBy: 'gm',
        ruleRef: 'rule:ability-checks',
      },
    ]);
  });

  it('Use an Object distinguishes action-required use from ordinary object interaction', () => {
    expect(deriveActionMechanics(action('Use an Object')).effects).toEqual([
      {
        kind: 'objectInteraction',
        useWhen: 'object-requires-your-action',
        alsoUseWhen: 'interact-with-more-than-one-object-on-your-turn',
        ordinaryInteractionRuleRef: 'rule:interacting-with-objects',
      },
    ]);
  });
});

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

describe('condition relation prevention/removal semantics (eshyra-o9bd.18.3)', () => {
  // SRD 5.1 p. 123: the target becomes visible and CANNOT become invisible —
  // recording relation "applies" would make a deterministic tool do the
  // opposite of the spell.
  it('spell:branding-smite — "can\'t become invisible" is prevents, not applies', () => {
    const mechanics = deriveSpellMechanics(
      spell({
        description:
          "The next time you hit a creature with a weapon attack before this spell ends, the weapon gleams with astral radiance as you strike. The attack deals an extra 2d6 radiant damage to the target, which becomes visible if it's invisible, and the target sheds dim light in a 5-foot radius and can't become invisible until the spell ends.",
      }),
    );
    expect(mechanics.conditions).toEqual([
      { condition: 'invisible', relation: 'prevents' },
    ]);
  });

  it('spell:calm-emotions — suppressing charmed/frightened is suppresses, not applies', () => {
    const mechanics = deriveSpellMechanics(
      spell({
        description:
          'You attempt to suppress strong emotions in a group of people. You can suppress any effect causing a target to be charmed or frightened.',
      }),
    );
    expect(mechanics.conditions).toEqual([
      { condition: 'charmed', relation: 'suppresses' },
      { condition: 'frightened', relation: 'suppresses' },
    ]);
  });

  it('spell:lesser-restoration — the whole removable-condition list is removes, not applies', () => {
    const mechanics = deriveSpellMechanics(
      spell({
        description:
          'You touch a creature and can end either one disease or one condition afflicting it. The condition can be blinded, deafened, paralyzed, or poisoned.',
      }),
    );
    expect(mechanics.conditions).toEqual([
      { condition: 'blinded', relation: 'removes' },
      { condition: 'deafened', relation: 'removes' },
      { condition: 'paralyzed', relation: 'removes' },
      { condition: 'poisoned', relation: 'removes' },
    ]);
  });

  it('spell:protection-from-evil-and-good — "can\'t be charmed, frightened, or possessed" is prevents for every listed condition', () => {
    const mechanics = deriveSpellMechanics(
      spell({
        description:
          'The target also can’t be charmed, frightened, or possessed by them. If the target is already charmed, frightened, or possessed by such a creature, the target has advantage on any new saving throw against the relevant effect.',
      }),
    );
    expect(mechanics.conditions).toEqual([
      { condition: 'charmed', relation: 'prevents' },
      { condition: 'frightened', relation: 'prevents' },
    ]);
  });

  it('spell:hold-person — a true condition-inflicting spell still classifies as applies (no overcorrection)', () => {
    const mechanics = deriveSpellMechanics(
      spell({
        description:
          'Choose a humanoid that you can see within range. The target must succeed on a Wisdom saving throw or be paralyzed for the duration.',
      }),
    );
    expect(mechanics.conditions).toEqual([
      { condition: 'paralyzed', relation: 'applies' },
    ]);
  });

  it('creature grapple riders and save-or-suffer clauses still classify as applies (no overcorrection)', () => {
    const mechanics = deriveCreatureEntryMechanics(
      'Tentacle',
      'If the target is a Large or smaller creature, it is grappled (escape DC 13). Until this grapple ends, the target is restrained, and the creature must succeed on a DC 12 Constitution saving throw or be poisoned for 1 minute.',
    );
    expect(mechanics.conditions).toEqual(
      expect.arrayContaining([
        { condition: 'grappled', relation: 'applies' },
        { condition: 'restrained', relation: 'applies' },
        { condition: 'poisoned', relation: 'applies' },
      ]),
    );
  });

  it("spell:suggestion — a can't-be-charmed immunity gate is gates, not applies or prevents", () => {
    const mechanics = deriveSpellMechanics(
      spell({
        description:
          'You suggest a course of activity and magically influence a creature. Creatures that can’t be charmed are immune to this effect.',
      }),
    );
    expect(mechanics.conditions).toEqual([
      { condition: 'charmed', relation: 'gates' },
    ]);
  });

  it('spell:dispel-evil-and-good — removal outranks the touch-target gating clause', () => {
    const mechanics = deriveSpellMechanics(
      spell({
        description:
          'As your action, you touch a creature you can reach that is charmed, frightened, or possessed by a celestial, an elemental, a fey, a fiend, or an undead. The creature you touch is no longer charmed, frightened, or possessed by such creatures.',
      }),
    );
    expect(mechanics.conditions).toEqual([
      { condition: 'charmed', relation: 'removes' },
      { condition: 'frightened', relation: 'removes' },
    ]);
  });

  it('spell:polymorph — a negated "isn\'t knocked unconscious" is not applies', () => {
    const mechanics = deriveSpellMechanics(
      spell({
        description:
          'As long as the excess damage doesn’t reduce the creature’s normal form to 0 hit points, it isn’t knocked unconscious.',
      }),
    );
    expect(mechanics.conditions).toEqual([
      { condition: 'unconscious', relation: 'mention' },
    ]);
  });

  it('creature:kraken Freedom of Movement — negated causation is prevents, not applies', () => {
    const mechanics = deriveCreatureEntryMechanics(
      'Freedom of Movement',
      'The kraken ignores difficult terrain, and magical effects can’t reduce its speed or cause it to be restrained.',
    );
    expect(mechanics.conditions).toEqual([
      { condition: 'restrained', relation: 'prevents' },
    ]);
  });

  it('creature:vampire stake trait — a while-incapacitated precondition is gates; the applied paralysis stays applies', () => {
    const mechanics = deriveCreatureEntryMechanics(
      'Stake to the Heart',
      'If a piercing weapon made of wood is driven into the vampire’s heart while the vampire is incapacitated in its resting place, the vampire is paralyzed until the stake is removed.',
    );
    expect(mechanics.conditions).toEqual(
      expect.arrayContaining([
        { condition: 'incapacitated', relation: 'gates' },
        { condition: 'paralyzed', relation: 'applies' },
      ]),
    );
  });

  it('spell:hallow — a condition that is removed, prevented, AND inflicted aggregates to the state mutation applies', () => {
    const mechanics = deriveSpellMechanics(
      spell({
        description:
          'Any creature charmed, frightened, or possessed by such a creature is no longer charmed, frightened, or possessed upon entering the area. Courage. Affected creatures can’t be frightened while in the area. Fear. Affected creatures are frightened while in the area.',
      }),
    );
    expect(mechanics.conditions).toEqual(
      expect.arrayContaining([
        { condition: 'frightened', relation: 'applies' },
        { condition: 'charmed', relation: 'removes' },
      ]),
    );
  });
});

describe('damage type canonicalization (eshyra-erf5.4)', () => {
  it('excludes a "<dice> <word> damage" match whose word is not a canonical SRD damage type', () => {
    const mechanics = deriveSpellMechanics(
      spell({
        description:
          'While these weapons are enlarged, the target’s attacks with them deal 1d4 extra damage.',
      }),
    );
    expect(mechanics.damage).toBeUndefined();
  });

  it('still captures a genuine canonical-type damage phrase', () => {
    const mechanics = deriveSpellMechanics(
      spell({
        description: 'The target takes 8d6 fire damage.',
      }),
    );
    expect(mechanics.damage).toEqual([{ dice: '8d6', type: 'fire' }]);
  });

  it('models Enlarge/Reduce style weapon-damage deltas as weaponDamageModifiers, not damage', () => {
    const mechanics = deriveSpellMechanics(
      spell({
        description:
          'While these weapons are enlarged, the target’s attacks with them deal 1d4 extra damage. ' +
          'While these weapons are reduced, the target’s attacks with them deal 1d4 less damage.',
      }),
    );
    expect(mechanics.damage).toBeUndefined();
    expect(mechanics.weaponDamageModifiers).toEqual([
      { dice: '1d4', operation: 'increase' },
      { dice: '1d4', operation: 'decrease' },
    ]);
  });
});
