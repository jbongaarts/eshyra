import { describe, expect, it } from 'vitest';
import {
  deriveActionMechanics,
  deriveCreatureEntryMechanics,
  deriveFeatureMechanics,
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
        subject: 'against-actor',
        mode: 'disadvantage',
        condition: 'you-can-see-the-attacker',
        duration: 'until-start-of-your-next-turn',
      },
      {
        kind: 'savingThrowModifier',
        subject: 'actor',
        mode: 'advantage',
        roll: 'saving-throw',
        abilities: ['dexterity'],
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
        subject: 'helped-creature',
        mode: 'advantage',
        timing: 'next-ability-check-before-start-of-your-next-turn',
        constraint: 'check-must-perform-the-task-you-helped-with',
      },
      {
        kind: 'attackRollModifier',
        subject: 'helped-friendly-creature',
        mode: 'advantage',
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

describe('creature entry effect projections (eshyra-o9bd.18.7.3)', () => {
  it('models Magic Resistance as an advantage saving-throw modifier', () => {
    const mechanics = deriveCreatureEntryMechanics(
      'Magic Resistance',
      'The hag has advantage on saving throws against spells and other magical effects.',
    );
    expect(mechanics.effects).toEqual([
      {
        kind: 'savingThrowModifier',
        mode: 'advantage',
        against: 'spells and other magical effects',
      },
    ]);
  });

  it('models Gnome Cunning with the printed ability list', () => {
    const mechanics = deriveCreatureEntryMechanics(
      'Gnome Cunning',
      'The gnome has advantage on Intelligence, Wisdom, and Charisma saving throws against magic.',
    );
    expect(mechanics.effects).toEqual([
      {
        kind: 'savingThrowModifier',
        mode: 'advantage',
        abilities: ['intelligence', 'wisdom', 'charisma'],
        against: 'magic',
      },
    ]);
  });

  it('skips a pure "against being <condition>" clause (owned by condition relations)', () => {
    const mechanics = deriveCreatureEntryMechanics(
      'Brave',
      'The knight has advantage on saving throws against being frightened.',
    );
    expect(mechanics.effects).toBeUndefined();
    expect(mechanics.conditions).toEqual([
      { condition: 'frightened', relation: 'advantage' },
    ]);
  });

  it('models Keen Hearing and Smell as an ability-check modifier with senses', () => {
    const mechanics = deriveCreatureEntryMechanics(
      'Keen Hearing and Smell',
      'The wolf has advantage on Wisdom (Perception) checks that rely on hearing or smell.',
    );
    expect(mechanics.effects).toEqual([
      {
        kind: 'abilityCheckModifier',
        mode: 'advantage',
        ability: 'wisdom',
        skill: 'perception',
        reliesOn: ['hearing', 'smell'],
      },
    ]);
  });

  it('models Sunlight Sensitivity with the shared While-condition on both modifiers', () => {
    const mechanics = deriveCreatureEntryMechanics(
      'Sunlight Sensitivity',
      'While in sunlight, the drow has disadvantage on attack rolls, as well as on Wisdom (Perception) checks that rely on sight.',
    );
    expect(mechanics.effects).toEqual([
      {
        kind: 'attackRollModifier',
        mode: 'disadvantage',
        condition: 'While in sunlight',
      },
      {
        kind: 'abilityCheckModifier',
        mode: 'disadvantage',
        ability: 'wisdom',
        skill: 'perception',
        reliesOn: ['sight'],
        condition: 'While in sunlight',
      },
    ]);
  });

  it('models Blood Frenzy as a melee attack-roll modifier with its constraint', () => {
    const mechanics = deriveCreatureEntryMechanics(
      'Blood Frenzy',
      'The shark has advantage on melee attack rolls against any creature that doesn’t have all its hit points.',
    );
    expect(mechanics.effects).toEqual([
      {
        kind: 'attackRollModifier',
        mode: 'advantage',
        attackType: 'melee',
        constraint: 'against any creature that doesn’t have all its hit points',
      },
    ]);
  });

  it('models Legendary Resistance with the per-day usage from the name', () => {
    const mechanics = deriveCreatureEntryMechanics(
      'Legendary Resistance (3/Day)',
      'If the dragon fails a saving throw, it can choose to succeed instead.',
    );
    expect(mechanics.usage).toEqual({ perDay: 3 });
    expect(mechanics.effects).toEqual([{ kind: 'legendaryResistance' }]);
  });

  it('models the Troll regeneration with typed damage-type suppression', () => {
    const mechanics = deriveCreatureEntryMechanics(
      'Regeneration',
      'The troll regains 10 hit points at the start of its turn. If the troll takes acid or fire damage, this trait doesn’t function at the start of the troll’s next turn. The troll dies only if it starts its turn with 0 hit points and doesn’t regenerate.',
    );
    expect(mechanics.effects).toEqual([
      {
        kind: 'regeneration',
        hitPoints: 10,
        timing: 'start-of-turn',
        suppressedBy: 'acid or fire damage',
        suppressedByDamageTypes: ['acid', 'fire'],
      },
    ]);
  });

  it('models the Vampire regeneration with a verbatim non-type suppression clause and condition', () => {
    const mechanics = deriveCreatureEntryMechanics(
      'Regeneration',
      'The vampire regains 20 hit points at the start of its turn if it has at least 1 hit point and isn’t in sunlight or running water. If the vampire takes radiant damage or damage from holy water, this trait doesn’t function at the start of the vampire’s next turn.',
    );
    expect(mechanics.effects).toEqual([
      {
        kind: 'regeneration',
        hitPoints: 20,
        timing: 'start-of-turn',
        condition:
          'if it has at least 1 hit point and isn’t in sunlight or running water',
        suppressedBy: 'radiant damage or damage from holy water',
      },
    ]);
  });

  it('models a Multiattack count', () => {
    const mechanics = deriveCreatureEntryMechanics(
      'Multiattack',
      'The glabrezu makes four attacks: two with its pincers and two with its fists. Alternatively, it makes two attacks with its pincers and casts one spell.',
    );
    expect(mechanics.effects).toEqual([{ kind: 'multiattack', attacks: 4 }]);
  });

  it('models Healing Touch dice healing with per-day usage', () => {
    const mechanics = deriveCreatureEntryMechanics(
      'Healing Touch (3/Day)',
      'The unicorn touches another creature with its horn. The target magically regains 11 (2d8 + 2) hit points.',
    );
    expect(mechanics.usage).toEqual({ perDay: 3 });
    expect(mechanics.effects).toEqual([
      { kind: 'healing', average: 11, dice: '2d8 + 2' },
    ]);
  });

  it('models rest-based recharges from the name parenthetical', () => {
    const mechanics = deriveCreatureEntryMechanics(
      'Leadership (Recharges after a Short or Long Rest)',
      'For 1 minute, the knight can utter a special command.',
    );
    expect(mechanics.usage).toEqual({
      rechargeAfterRest: 'short-or-long-rest',
    });
  });

  it('models legendary action costs from the name parenthetical', () => {
    const mechanics = deriveCreatureEntryMechanics(
      'Wing Attack (Costs 2 Actions)',
      'The dragon beats its wings.',
    );
    expect(mechanics.usage).toEqual({ legendaryActionCost: 2 });
  });

  it('models a legendary named-attack reference as makeAttack', () => {
    const mechanics = deriveCreatureEntryMechanics(
      'Tail Attack',
      'The dragon makes a tail attack.',
    );
    expect(mechanics.effects).toEqual([{ kind: 'makeAttack', attack: 'tail' }]);
  });

  it('models the legendary Detect option as makeAbilityCheck', () => {
    const mechanics = deriveCreatureEntryMechanics(
      'Detect',
      'The dragon makes a Wisdom (Perception) check.',
    );
    expect(mechanics.effects).toEqual([
      { kind: 'makeAbilityCheck', ability: 'wisdom', skill: 'perception' },
    ]);
  });

  it('models the Bat bite: "one creature" target and flat no-dice damage', () => {
    const mechanics = deriveCreatureEntryMechanics(
      'Bite',
      'Melee Weapon Attack: +0 to hit, reach 5 ft., one creature. Hit: 1 piercing damage.',
    );
    expect(mechanics.attacks).toEqual([
      {
        attackType: 'melee-weapon',
        attackBonus: 0,
        reachFeet: 5,
        target: 'one creature',
        hitDamage: [{ amount: 1, type: 'piercing' }],
      },
    ]);
  });

  it('models Amphibious / Water Breathing / Standing Leap (Frog, Sea Horse)', () => {
    expect(
      deriveCreatureEntryMechanics(
        'Amphibious',
        'The frog can breathe air and water.',
      ).effects,
    ).toEqual([{ kind: 'breathes', environments: ['air', 'water'] }]);
    expect(
      deriveCreatureEntryMechanics(
        'Water Breathing',
        'The sea horse can breathe only underwater.',
      ).effects,
    ).toEqual([{ kind: 'breathes', environments: ['water'], only: true }]);
    expect(
      deriveCreatureEntryMechanics(
        'Standing Leap',
        'The frog’s long jump is up to 10 feet and its high jump is up to 5 feet, with or without a running start.',
      ).effects,
    ).toEqual([
      {
        kind: 'jumpDistance',
        longJumpFeet: 10,
        highJumpFeet: 5,
        runningStartRequired: false,
      },
    ]);
  });

  it('models Parry, Magic Weapons, Immutable Form, and Siege Monster', () => {
    expect(
      deriveCreatureEntryMechanics(
        'Parry',
        'The knight adds 2 to its AC against one melee attack that would hit it. To do so the knight must see the attacker and be wielding a melee weapon.',
      ).effects,
    ).toEqual([
      {
        kind: 'acBonus',
        amount: 2,
        scope: 'one-melee-attack-that-would-hit',
      },
    ]);
    expect(
      deriveCreatureEntryMechanics(
        'Magic Weapons',
        'The oni’s weapon attacks are magical.',
      ).effects,
    ).toEqual([{ kind: 'weaponAttacksMagical' }]);
    expect(
      deriveCreatureEntryMechanics(
        'Immutable Form',
        'The golem is immune to any spell or effect that would alter its form.',
      ).effects,
    ).toEqual([{ kind: 'immunity', to: 'form-altering-spells-and-effects' }]);
    expect(
      deriveCreatureEntryMechanics(
        'Siege Monster',
        'The treant deals double damage to objects and structures.',
      ).effects,
    ).toEqual([
      {
        kind: 'damageMultiplier',
        multiplier: 2,
        against: 'objects-and-structures',
      },
    ]);
  });

  it('marks a triggered trait with its verbatim trigger clause', () => {
    const mechanics = deriveCreatureEntryMechanics(
      'Shriek',
      'When bright light or a creature is within 30 feet of the shrieker, it emits a shrill shriek audible within 300 feet of it.',
    );
    expect(mechanics.effects).toEqual([
      {
        kind: 'triggeredEffect',
        trigger:
          'When bright light or a creature is within 30 feet of the shrieker',
      },
    ]);
  });
});

describe('spell effect projections (eshyra-o9bd.18.7.4)', () => {
  const baseSpell = (over: Partial<SpellExtraction>): SpellExtraction => ({
    name: 'Test Spell',
    level: 1,
    school: 'evocation',
    ritual: false,
    castingTime: '1 action',
    range: '60 feet',
    components: { verbal: true, somatic: true, material: false },
    duration: 'Instantaneous',
    description: '',
    sourcePage: 1,
    ...over,
  });

  it('parses structured durations from the closed SRD vocabulary', () => {
    expect(
      deriveSpellMechanics(baseSpell({ description: 'x' })).duration,
    ).toEqual({ kind: 'instantaneous' });
    expect(
      deriveSpellMechanics(
        baseSpell({ duration: 'Concentration, up to 10 minutes' }),
      ).duration,
    ).toEqual({
      kind: 'timed',
      amount: 10,
      unit: 'minute',
      upTo: true,
      concentration: true,
    });
    expect(
      deriveSpellMechanics(baseSpell({ duration: '8 hours' })).duration,
    ).toEqual({ kind: 'timed', amount: 8, unit: 'hour' });
    expect(
      deriveSpellMechanics(
        baseSpell({ duration: 'Until dispelled or triggered' }),
      ).duration,
    ).toEqual({ kind: 'until-dispelled', orTriggered: true });
    // The Protection from Evil and Good comma-less source typo still parses.
    expect(
      deriveSpellMechanics(
        baseSpell({ duration: 'Concentration up to 10 minutes' }),
      ).duration,
    ).toEqual({
      kind: 'timed',
      amount: 10,
      unit: 'minute',
      upTo: true,
      concentration: true,
    });
  });

  it('parses the area from a Self range parenthetical', () => {
    expect(
      deriveSpellMechanics(baseSpell({ range: 'Self (15-foot cone)' })).area,
    ).toEqual({ shape: 'cone', size: 15, unit: 'foot', origin: 'self' });
    expect(
      deriveSpellMechanics(baseSpell({ range: 'Self (10-foot-radius sphere)' }))
        .area,
    ).toEqual({ shape: 'sphere', size: 10, unit: 'foot', origin: 'self' });
    expect(
      deriveSpellMechanics(baseSpell({ range: '60 feet' })).area,
    ).toBeUndefined();
  });

  it('projects Cure Wounds healing with the spellcasting-modifier rider and per-slot scaling', () => {
    const mechanics = deriveSpellMechanics(
      baseSpell({
        description:
          'A creature you touch regains a number of hit points equal to 1d8 + your spellcasting ability modifier.',
        higherLevels:
          'When you cast this spell using a spell slot of 2nd level or higher, the healing increases by 1d8 for each slot level above 1st.',
      }),
    );
    expect(mechanics.effects).toEqual([
      { kind: 'healing', dice: '1d8', addSpellcastingAbilityModifier: true },
    ]);
    expect(mechanics.scaling).toMatchObject({
      perSlot: { stat: 'healing', increase: '1d8', baseSlotLevel: 1 },
    });
  });

  it('marks half-damage-on-save on the save entry (Fireball)', () => {
    const mechanics = deriveSpellMechanics(
      baseSpell({
        description:
          'Each creature in a 20-foot-radius sphere must make a Dexterity saving throw. A target takes 8d6 fire damage on a failed save, or half as much damage on a successful one.',
      }),
    );
    expect(mechanics.saves).toEqual([
      { ability: 'dexterity', damageOnSuccess: 'half' },
    ]);
  });

  it('projects cantrip damage tiers (Fire Bolt)', () => {
    const mechanics = deriveSpellMechanics(
      baseSpell({
        description:
          'Hurl a mote of fire. On a hit, the target takes 1d10 fire damage. This spell’s damage increases by 1d10 when you reach 5th level (2d10), 11th level (3d10), and 17th level (4d10).',
      }),
    );
    expect(mechanics.scaling).toEqual({
      cantripDamageByLevel: { 5: '2d10', 11: '3d10', 17: '4d10' },
    });
  });

  it('projects additional-target upcasting (Hold Person) and repeat saves', () => {
    const mechanics = deriveSpellMechanics(
      baseSpell({
        description:
          'Choose a humanoid. The target must succeed on a Wisdom saving throw or be paralyzed for the duration. At the end of each of its turns, the target can make another Wisdom saving throw. On a success, the spell ends on the target.',
        higherLevels:
          'When you cast this spell using a spell slot of 3rd level or higher, you can target one additional humanoid for each slot level above 2nd.',
      }),
    );
    expect(mechanics.effects).toEqual([
      {
        kind: 'repeatSave',
        timing: 'end-of-each-of-its-turns',
        endsOnSuccess: true,
      },
    ]);
    expect(mechanics.scaling).toMatchObject({
      perSlot: { additionalTargets: 1, baseSlotLevel: 2 },
    });
  });

  it('projects the Shield AC bonus (sign directly after a space)', () => {
    const mechanics = deriveSpellMechanics(
      baseSpell({
        description:
          'An invisible barrier of magical force appears and protects you. Until the start of your next turn, you have a +5 bonus to AC.',
      }),
    );
    expect(mechanics.effects).toEqual([{ kind: 'acBonus', amount: 5 }]);
  });

  it('projects Mage Armor and Barkskin AC formulas', () => {
    expect(
      deriveSpellMechanics(
        baseSpell({
          description:
            'The target’s base AC becomes 13 + its Dexterity modifier.',
        }),
      ).effects,
    ).toEqual([{ kind: 'acFormula', base: 13, ability: 'dexterity' }]);
    expect(
      deriveSpellMechanics(
        baseSpell({
          description:
            'The target’s skin has a rough, bark-like appearance, and the target’s AC can’t be less than 16, regardless of what kind of armor it is wearing.',
        }),
      ).effects,
    ).toEqual([{ kind: 'acMinimum', value: 16 }]);
  });

  it('resolves rollModifier subjects to the NEAREST candidate before the verb (Dominate Monster)', () => {
    const mechanics = deriveSpellMechanics(
      baseSpell({
        description:
          'The target must succeed on a Wisdom saving throw or be charmed by you. If you or creatures that are friendly to you are fighting it, it has advantage on the saving throw.',
      }),
    );
    const modifiers = (mechanics.effects as Array<{ kind: string }>).filter(
      (effect) => effect.kind === 'rollModifier',
    );
    expect(modifiers).toEqual([
      {
        kind: 'rollModifier',
        subject: 'target',
        mode: 'advantage',
        scope: 'the saving throw',
      },
    ]);
  });

  it('projects Bless roll dice, Pass Without Trace check bonus, and Magic Weapon attack/damage bonus', () => {
    expect(
      deriveSpellMechanics(
        baseSpell({
          description:
            'Whenever a target makes an attack roll or a saving throw before the spell ends, the target can roll a d4 and add the number rolled to the attack roll or saving throw.',
        }),
      ).effects,
    ).toEqual([
      {
        kind: 'rollBonusDice',
        dice: 'd4',
        applies: ['attack-rolls', 'saving-throws'],
      },
    ]);
    expect(
      deriveSpellMechanics(
        baseSpell({
          description:
            'Each creature you choose within 30 feet of you (including you) has a +10 bonus to Dexterity (Stealth) checks and can’t be tracked except by magical means.',
        }),
      ).effects,
    ).toEqual([
      {
        kind: 'checkBonus',
        amount: 10,
        ability: 'dexterity',
        skill: 'stealth',
      },
    ]);
    expect(
      deriveSpellMechanics(
        baseSpell({
          description:
            'You touch a nonmagical weapon. Until the spell ends, that weapon becomes a magic weapon with a +1 bonus to attack rolls and damage rolls.',
        }),
      ).effects,
    ).toEqual([{ kind: 'attackAndDamageBonus', amount: 1 }]);
  });

  it('projects revive, death threshold, extra damage on hit, and damage-equal-to forms', () => {
    expect(
      deriveSpellMechanics(
        baseSpell({
          description:
            'You return a dead creature to life. The creature returns to life with 1 hit point.',
        }),
      ).effects,
    ).toEqual([{ kind: 'revive', hitPoints: 1 }]);
    expect(
      deriveSpellMechanics(
        baseSpell({
          description:
            'If the creature you choose has 100 hit points or fewer, it dies. Otherwise, the spell has no effect.',
        }),
      ).effects,
    ).toEqual([{ kind: 'death', hitPointThreshold: 100 }]);
    expect(
      deriveSpellMechanics(
        baseSpell({
          description:
            'You deal an extra 1d6 damage to the target whenever you hit it with a weapon attack.',
        }),
      ).effects,
    ).toEqual([
      { kind: 'extraDamageOnHit', dice: '1d6', attackType: 'weapon' },
    ]);
    expect(
      deriveSpellMechanics(
        baseSpell({
          description:
            'On a hit, the target takes force damage equal to 1d8 + your spellcasting ability modifier.',
        }),
      ).damage,
    ).toEqual([
      { dice: '1d8', type: 'force', addSpellcastingAbilityModifier: true },
    ]);
  });

  it('projects light, obscurement, darkvision, and speed changes', () => {
    expect(
      deriveSpellMechanics(
        baseSpell({
          description:
            'The object sheds bright light in a 20-foot radius and dim light for an additional 20 feet.',
        }),
      ).effects,
    ).toEqual([
      { kind: 'light', level: 'bright', radiusFeet: 20, dimAdditionalFeet: 20 },
    ]);
    expect(
      deriveSpellMechanics(
        baseSpell({
          description: 'The fog spreads and its area is heavily obscured.',
        }),
      ).effects,
    ).toEqual([{ kind: 'obscurement', level: 'heavily' }]);
    expect(
      deriveSpellMechanics(
        baseSpell({
          description:
            'For the duration, that creature has darkvision out to a range of 60 feet.',
        }),
      ).effects,
    ).toEqual([{ kind: 'sense', sense: 'darkvision', rangeFeet: 60 }]);
    expect(
      deriveSpellMechanics(
        baseSpell({
          description: 'Until the spell ends, the target’s speed is doubled.',
        }),
      ).effects,
    ).toEqual([{ kind: 'speedMultiplier', multiplier: 2 }]);
  });
});

describe('feature runtime-effect projections (eshyra-o9bd.18.7.5)', () => {
  const derive = (text: string) => deriveFeatureMechanics(text);

  it('projects Barbarian Unarmored Defense as an AC formula', () => {
    expect(
      derive(
        'While you are not wearing any armor, your Armor Class equals 10 + your Dexterity modifier + your Constitution modifier. You can use a shield and still gain this benefit.',
      ).effects,
    ).toEqual([
      {
        kind: 'acFormula',
        base: 10,
        abilities: ['dexterity', 'constitution'],
      },
    ]);
  });

  it('projects Rage: resource reset, ability check/save advantage with condition, and the unconscious early-end as exclusion', () => {
    const mechanics = derive(
      'While raging, you gain the following benefits if you aren’t wearing heavy armor: You have advantage on Strength checks and Strength saving throws. Your rage lasts for 1 minute. It ends early if you are knocked unconscious. Once you have raged the maximum number of times, you must finish a long rest before you can rage again.',
    );
    expect(mechanics.resources).toEqual([{ reset: 'long-rest' }]);
    expect(mechanics.conditions).toEqual([
      { condition: 'unconscious', relation: 'exclusion' },
    ]);
    expect(mechanics.effects).toEqual([
      {
        kind: 'abilityCheckModifier',
        mode: 'advantage',
        ability: 'strength',
        condition: 'While raging',
      },
      {
        kind: 'savingThrowModifier',
        mode: 'advantage',
        abilities: ['strength'],
        condition: 'While raging',
      },
    ]);
  });

  it('projects Reckless Attack: melee advantage plus attackers-against-you advantage', () => {
    const mechanics = derive(
      'When you make your first attack on your turn, you can decide to attack recklessly. Doing so gives you advantage on melee weapon attack rolls using Strength during this turn, but attack rolls against you have advantage until your next turn.',
    );
    expect(mechanics.effects).toEqual([
      expect.objectContaining({
        kind: 'attackRollModifier',
        mode: 'advantage',
        attackType: 'melee',
      }),
      {
        kind: 'attackRollModifier',
        subject: 'attackers-against-you',
        mode: 'advantage',
      },
    ]);
  });

  it('projects Evasion, Improved Critical, Extra Attack tiers, and Brutal Critical', () => {
    expect(
      derive(
        'You can nimbly dodge out of the way. When you are subjected to an effect that allows you to make a Dexterity saving throw to take only half damage, you instead take no damage if you succeed on the saving throw, and only half damage if you fail.',
      ).effects,
    ).toContainEqual({ kind: 'evasion' });
    expect(
      derive('Your weapon attacks score a critical hit on a roll of 19 or 20.')
        .effects,
    ).toEqual([{ kind: 'criticalRange', minimumRoll: 19 }]);
    expect(
      derive(
        'You can attack three times, instead of once, whenever you take the Attack action on your turn.',
      ).effects,
    ).toEqual([{ kind: 'extraAttack', attacks: 3 }]);
    expect(
      derive(
        'You can roll one additional weapon damage die when determining the extra damage for a critical hit with a melee attack.',
      ).effects,
    ).toEqual([{ kind: 'brutalCritical', additionalDice: 1 }]);
  });

  it('projects typed proficiency grants and expertise', () => {
    expect(
      derive('You have proficiency in the Perception skill.').effects,
    ).toEqual([{ kind: 'proficiency', grant: 'the Perception skill' }]);
    expect(
      derive(
        'Your proficiency bonus is doubled for any ability check you make that uses either of the chosen proficiencies.',
      ).effects,
    ).toEqual([{ kind: 'expertise' }]);
  });

  it('projects racial resistances including the Dragonborn ancestry-linked type', () => {
    expect(derive('You have resistance to fire damage.').effects).toEqual([
      { kind: 'damageResistance', types: ['fire'] },
    ]);
    expect(
      derive(
        'You have resistance to the damage type associated with your draconic ancestry.',
      ).effects,
    ).toEqual([{ kind: 'damageResistance', typeFrom: 'draconic-ancestry' }]);
  });

  it('projects Paladin aura/smite/health and Monk deflect formulas', () => {
    expect(
      derive(
        'Whenever you or a friendly creature within 10 feet of you must make a saving throw, the creature gains a bonus to the saving throw equal to your Charisma modifier (with a minimum bonus of +1).',
      ).effects,
    ).toEqual([{ kind: 'savingThrowBonus', addAbilityModifier: 'charisma' }]);
    expect(
      derive(
        'The extra damage is 2d8 for a 1st-level spell slot, plus 1d8 for each spell level higher than 1st, to a maximum of 5d8.',
      ).effects,
    ).toEqual([
      { kind: 'extraDamage', dice: '2d8', perSlotLevelIncrease: '1d8' },
    ]);
    expect(
      derive(
        'The divine magic flowing through you makes you immune to disease.',
      ).effects,
    ).toEqual([{ kind: 'immunity', to: 'disease' }]);
    expect(
      derive(
        'When you do so, the damage you take from the attack is reduced by 1d10 + your Dexterity modifier + your monk level.',
      ).effects,
    ).toEqual([
      {
        kind: 'damageReduction',
        dice: '1d10',
        addAbilityModifier: 'dexterity',
        addClassLevel: 'monk',
      },
    ]);
  });

  it('projects usage resources with printed uses and ability-modifier uses', () => {
    expect(
      derive(
        'You can use this feature twice. You regain all expended uses when you finish a short or long rest.',
      ).resources,
    ).toEqual([{ uses: 2, reset: 'short-or-long-rest' }]);
    expect(
      derive(
        'You can use this feature a number of times equal to your Charisma modifier. You regain expended uses when you finish a long rest.',
      ).resources,
    ).toEqual([{ uses: 'charisma-modifier', reset: 'long-rest' }]);
  });

  it('projects Primal Champion ability increases and Fast Movement speed', () => {
    expect(
      derive(
        'Your Strength and Constitution scores increase by 4. Your maximum for those scores is now 24.',
      ).effects,
    ).toEqual([
      {
        kind: 'abilityScoreIncrease',
        abilities: ['strength', 'constitution'],
        amount: 4,
        newMaximum: 24,
      },
    ]);
    expect(
      derive(
        'Starting at 5th level, your speed increases by 10 feet while you aren’t wearing heavy armor.',
      ).effects,
    ).toEqual([
      {
        kind: 'speedBonus',
        amountFeet: 10,
        condition: 'while you aren’t wearing heavy armor',
      },
    ]);
  });
});
