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

describe('deriveCreatureEntryMechanics damage absorption (eshyra-o9bd.18.7.9 C6)', () => {
  it.each([
    ['Acid Absorption', 'acid', 'golem'],
    ['Lightning Absorption', 'lightning', 'golem'],
    ['Fire Absorption', 'fire', 'golem'],
    ['Lightning Absorption', 'lightning', 'shambling mound'],
  ])('projects the reviewed %s grammar for a %s', (name, type, noun) => {
    const connective = noun === 'shambling mound' ? '' : ' instead';
    const mechanics = deriveCreatureEntryMechanics(
      name,
      `Whenever the ${noun} is subjected to ${type} damage, it takes no damage and${connective} regains a number of hit points equal to the ${type} damage dealt.`,
    );
    expect(mechanics.effects).toEqual([
      {
        kind: 'damageAbsorption',
        type,
        damageTaken: 'none',
        healing: 'damage-dealt',
      },
    ]);
  });

  it('fails closed on source drift', () => {
    const mechanics = deriveCreatureEntryMechanics(
      'Acid Absorption',
      'Whenever the golem is subjected to acid damage, it takes half damage and regains hit points.',
    );
    expect(mechanics.effects).toEqual([
      {
        kind: 'triggeredEffect',
        trigger: 'Whenever the golem is subjected to acid damage',
      },
    ]);
  });
});

describe('deriveCreatureEntryMechanics C9 residual contracts (eshyra-o9bd.18.7.9)', () => {
  const shriek =
    'When bright light or a creature is within 30 feet of the shrieker, it emits a shriek audible within 300 feet of it. The shrieker continues to shriek until the disturbance moves out of range and for 1d4 of the shrieker’s turns afterward.';
  const shield =
    'When a creature makes an attack against the wearer of the guardian’s amulet, the guardian grants a +2 bonus to the wearer’s AC if the guardian is within 5 feet of the wearer.';

  it('projects the complete Shrieker sound alarm contract', () => {
    expect(deriveCreatureEntryMechanics('Shriek', shriek).effects).toEqual([
      {
        kind: 'soundAlarm',
        rangeFeet: 30,
        audibleFeet: 300,
        trigger: 'bright-light-or-creature-within-range',
        continuesAfterDisturbanceLeavesDice: '1d4',
      },
    ]);
  });

  it.each([
    'If the djinni dies, its body disintegrates into a warm breeze, leaving behind only equipment the djinni was wearing or carrying.',
    'If the efreeti dies, its body disintegrates in a flash of fire and puff of smoke, leaving behind only equipment the efreeti was wearing or carrying.',
  ])('projects the complete Elemental Demise contract', (text) => {
    expect(
      deriveCreatureEntryMechanics('Elemental Demise', text).effects,
    ).toEqual([
      {
        kind: 'onDeathBodyDisposal',
        manner: 'disintegrates',
        equipment: 'left-behind',
      },
    ]);
  });

  it('projects Shield as a reaction for the wearer against the triggering attack', () => {
    expect(deriveCreatureEntryMechanics('Shield', shield).effects).toEqual([
      {
        kind: 'reactionAcBonus',
        cost: 'reaction',
        trigger: 'attack-against-amulet-wearer',
        amount: 2,
        rangeFeet: 5,
        subject: 'amulet-wearer',
        duration: 'against-triggering-attack',
      },
    ]);
  });

  it.each([
    ['Shriek', shriek.replace('300 feet', '301 feet')],
    [
      'Elemental Demise',
      'If the djinni dies, its body vanishes, leaving behind only equipment the djinni was wearing or carrying.',
    ],
    ['Shield', shield.replace('+2 bonus', '+3 bonus')],
  ])('%s source drift fails closed', (name, text) => {
    expect(
      deriveCreatureEntryMechanics(name, text).effects?.some((effect) =>
        ['soundAlarm', 'onDeathBodyDisposal', 'reactionAcBonus'].includes(
          effect.kind as string,
        ),
      ),
    ).not.toBe(true);
  });
});

describe('deriveCreatureEntryMechanics Berserk state machine (eshyra-o9bd.18.7.9 C7)', () => {
  const clayText =
    'Whenever the golem starts its turn with 60 hit points or fewer, roll a d6. On a 6, the golem goes berserk. On each of its turns while berserk, the golem attacks the nearest creature it can see. If no creature is near enough to move to and attack, the golem attacks an object, with preference for an object smaller than itself. Once the golem goes berserk, it continues to do so until it is destroyed or regains all its hit points.';
  const fleshText =
    'Whenever the golem starts its turn with 40 hit points or fewer, roll a d6. On a 6, the golem goes berserk. On each of its turns while berserk, the golem attacks the nearest creature it can see. If no creature is near enough to move to and attack, the golem attacks an object, with preference for an object smaller than itself. Once the golem goes berserk, it continues to do so until it is destroyed or regains all its hit points. The golem’s creator, if within 60 feet of the berserk golem, can try to calm it by speaking firmly and persuasively. The golem must be able to hear its creator, who must take an action to make a DC 15 Charisma (Persuasion) check. If the check succeeds, the golem ceases being berserk. If it takes damage while still at 40 hit points or fewer, the golem might go berserk again.';

  const baseTransitions = (hitPointsAtMost: number) => [
    {
      id: 'low-hit-points-entry',
      from: 'calm',
      to: 'berserk',
      trigger: 'start-of-turn-at-or-below-hit-points',
      hitPointsAtMost,
      roll: { die: 'd6', entersOn: 6 },
    },
    {
      id: 'berserk-turn-behavior',
      from: 'berserk',
      to: 'berserk',
      trigger: 'each-turn',
      behavior: {
        action: 'attack',
        target: 'nearest-visible-creature',
        fallback: {
          when: 'no-creature-near-enough-to-move-to-and-attack',
          target: 'object',
          preference: 'smaller-than-self',
        },
      },
    },
    {
      id: 'destroyed-exit',
      from: 'berserk',
      to: 'destroyed',
      trigger: 'destroyed',
    },
    {
      id: 'fully-healed-exit',
      from: 'berserk',
      to: 'calm',
      trigger: 'all-hit-points-regained',
    },
  ];

  it('projects Clay Golem entry, continuation, and terminal exits exactly', () => {
    expect(deriveCreatureEntryMechanics('Berserk', clayText).effects).toEqual([
      {
        kind: 'berserk',
        initialState: 'calm',
        transitions: baseTransitions(60),
      },
    ]);
  });

  it('projects Flesh Golem’s calming transition and model-adjudicated re-entry eligibility', () => {
    expect(deriveCreatureEntryMechanics('Berserk', fleshText).effects).toEqual([
      {
        kind: 'berserk',
        initialState: 'calm',
        transitions: [
          ...baseTransitions(40),
          {
            id: 'creator-calming-exit',
            from: 'berserk',
            to: 'calm',
            trigger: 'creator-calming-check',
            actor: 'creator',
            rangeFeet: 60,
            requiresHearing: true,
            cost: 'action',
            check: { dc: 15, ability: 'charisma', skill: 'persuasion' },
            outcome: 'on-success',
          },
        ],
        reentryEligibility: {
          after: 'creator-calming-exit',
          trigger: 'damage-while-at-or-below-hit-points',
          hitPointsAtMost: 40,
          disposition: 'model-adjudicated',
          sourceOutcome: 'might-go-berserk-again',
        },
      },
    ]);
  });

  it.each([
    ['entry threshold', clayText.replace('60 hit points', '61 hit points')],
    ['entry die', clayText.replace('roll a d6', 'roll a d8')],
    [
      'continuation fallback',
      clayText.replace('object smaller than itself', 'large object'),
    ],
    ['calming DC', fleshText.replace('DC 15', 'DC 16')],
    [
      'calming actor gate',
      fleshText.replace('golem’s creator', 'nearby creature'),
    ],
    [
      'qualified re-entry clause',
      fleshText.replace('might go berserk again', 'goes berserk again'),
    ],
  ])('fails closed on %s source drift', (_label, text) => {
    expect(deriveCreatureEntryMechanics('Berserk', text).effects).toEqual([
      expect.objectContaining({ kind: 'triggeredEffect' }),
    ]);
  });
});

describe('deriveCreatureEntryMechanics Rampage (eshyra-o9bd.18.7.9 C8)', () => {
  const rampage = (actor: 'hyena' | 'gnoll') =>
    `When the ${actor} reduces a creature to 0 hit points with a melee attack on its turn, the ${actor} can take a bonus action to move up to half its speed and make a bite attack.`;

  it.each([
    'hyena',
    'gnoll',
  ] as const)('projects %s Rampage as one trigger-linked bonus action', (actor) => {
    expect(
      deriveCreatureEntryMechanics('Rampage', rampage(actor)).effects,
    ).toEqual([
      {
        kind: 'triggeredBonusAction',
        trigger: {
          event: 'reduce-creature-to-0-hit-points',
          attackType: 'melee',
          timing: 'on-its-turn',
        },
        action: { movement: 'up-to-half-speed', attack: 'bite' },
      },
    ]);
  });

  it.each([
    rampage('hyena').replace('melee attack', 'ranged attack'),
    rampage('gnoll').replace('make a bite attack', 'make a claw attack'),
    rampage('hyena').replace('half its speed', 'its speed'),
    rampage('gnoll').replace('the gnoll can', 'the hyena can'),
  ])('fails closed when the reviewed grammar drifts', (text) => {
    expect(deriveCreatureEntryMechanics('Rampage', text).effects).toEqual([
      expect.objectContaining({ kind: 'triggeredEffect' }),
    ]);
  });
});

function spell(
  partial: Partial<SpellExtraction> & Pick<SpellExtraction, 'description'>,
): SpellExtraction {
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

describe('deriveCreatureEntryMechanics C5 Split grammar', () => {
  const splitText = (noun: 'pudding' | 'jelly'): string =>
    `When a ${noun} that is Medium or larger is subjected to lightning or slashing damage, it splits into two new ${noun === 'pudding' ? 'puddings' : 'jellies'} if it has at least 10 hit points. Each new ${noun} has hit points equal to half the original ${noun}'s, rounded down. New ${noun === 'pudding' ? 'puddings' : 'jellies'} are one size smaller than the original ${noun}.`;

  const expected = {
    kind: 'splitOnDamage',
    damageTypes: ['lightning', 'slashing'],
    minimumSize: 'medium',
    minimumHitPoints: 10,
    resultingCreatureCount: 2,
    hitPointsFraction: 'half-rounded-down',
    sizeCategoriesDown: 1,
  };

  it('projects the exact Black Pudding source grammar without a bare trigger marker', () => {
    expect(
      deriveCreatureEntryMechanics('Split', splitText('pudding')).effects,
    ).toEqual([expected]);
  });

  it('projects the exact Ochre Jelly source grammar with the same semantics', () => {
    expect(
      deriveCreatureEntryMechanics('Split', splitText('jelly')).effects,
    ).toEqual([expected]);
  });

  it.each([
    ['changed damage type', 'lightning or slashing', 'lightning or fire'],
    ['missing size eligibility', ' that is Medium or larger', ''],
    [
      'changed HP threshold',
      'at least 10 hit points',
      'at least 11 hit points',
    ],
    [
      'missing two-result clause',
      'it splits into two new puddings',
      'it splits into new puddings',
    ],
    [
      'changed half-HP clause',
      "hit points equal to half the original pudding's, rounded down",
      "hit points equal to the original pudding's",
    ],
    [
      'missing size reduction',
      ' New puddings are one size smaller than the original pudding.',
      '',
    ],
  ])('%s fails closed', (_label, target, replacement) => {
    const source = splitText('pudding');
    const changed = source.replace(target, replacement);
    expect(changed).not.toBe(source);
    expect(deriveCreatureEntryMechanics('Split', changed).effects).not.toEqual([
      expected,
    ]);
    expect(
      deriveCreatureEntryMechanics('Split', changed).effects?.some(
        (effect) => effect.kind === 'splitOnDamage',
      ),
    ).not.toBe(true);
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
  it('projects the reviewed C1 change-shape grammars and fails closed on source drift', () => {
    expect(
      deriveCreatureEntryMechanics(
        'Change Shape',
        'The dragon magically polymorphs into a humanoid or beast that has a challenge rating no higher than its own, or back into its true form. It reverts to its true form if it dies. Any equipment it is wearing or carrying is absorbed or borne by the new form (the dragon’s choice). In a new form, the dragon retains its alignment, hit points, Hit Dice, ability to speak, proficiencies, Legendary Resistance, lair actions, and Intelligence, Wisdom, and Charisma scores, as well as this action. Its statistics and capabilities are otherwise replaced by those of the new form, except any class features or legendary actions of that form.',
      ).effects,
    ).toEqual([
      {
        kind: 'changeShape',
        cost: 'action',
        forms: [
          {
            kind: 'category',
            types: ['humanoid', 'beast'],
            maxChallenge: 'own',
          },
        ],
        statistics: {
          model: 'retain-listed',
          retains: [
            'alignment',
            'hit points',
            'Hit Dice',
            'ability to speak',
            'proficiencies',
            'Legendary Resistance and lair actions',
            'Intelligence, Wisdom, and Charisma scores',
            'this action',
          ],
        },
        equipment: { disposition: 'absorbed-or-borne' },
        reversion: { on: ['death'] },
        excludedCapabilities: ['class-features', 'legendary-actions'],
      },
    ]);
    expect(
      deriveCreatureEntryMechanics(
        'Change Shape',
        'The couatl magically polymorphs into a humanoid or beast that has a challenge rating equal to or less than its own, or back into its true form. It reverts to its true form if it dies. Any equipment it is wearing or carrying is absorbed or borne by the new form (the couatl’s choice). In a new form, the couatl retains its game statistics and ability to speak, but its AC, movement modes, Strength, Dexterity, and other actions are replaced by those of the new form, and it gains any statistics and capabilities (except class features, legendary actions, and lair actions) that the new form has but that it lacks. If the new form has a bite attack, the couatl can use its bite in that form.',
      ).effects,
    ).toEqual([
      {
        kind: 'changeShape',
        cost: 'action',
        forms: [
          {
            kind: 'category',
            types: ['humanoid', 'beast'],
            maxChallenge: 'own',
          },
        ],
        statistics: {
          model: 'retain-listed',
          retains: ['game statistics', 'ability to speak'],
          replaces: [
            'AC',
            'movement modes',
            'Strength',
            'Dexterity',
            'other actions',
          ],
          gainsMissingCapabilities: true,
        },
        equipment: { disposition: 'absorbed-or-borne' },
        reversion: { on: ['death'] },
        excludedCapabilities: [
          'class-features',
          'legendary-actions',
          'lair-actions',
        ],
        retainedCapabilities: [
          { name: 'bite', whenFormHas: { attack: 'bite' } },
        ],
      },
    ]);
    expect(
      deriveCreatureEntryMechanics(
        'Change Shape',
        'The oni magically polymorphs into a Small or Medium humanoid, into a Large giant, or back into its true form. Other than its size, its statistics are the same in each form. The only equipment that is transformed is its glaive, which shrinks so that it can be wielded in humanoid form. If the oni dies, it reverts to its true form, and its glaive reverts to its normal size.',
      ).effects,
    ).toEqual([
      {
        kind: 'changeShape',
        cost: 'action',
        forms: [
          { kind: 'descriptor', sizes: ['small', 'medium'], type: 'humanoid' },
          { kind: 'descriptor', sizes: ['large'], type: 'giant' },
        ],
        statistics: { model: 'same-except', except: ['size'] },
        equipment: {
          disposition: 'specific',
          items: [
            {
              name: 'glaive',
              behavior: 'transforms-with-form',
              revertsOnDeath: true,
            },
          ],
        },
        reversion: { on: ['death'] },
      },
    ]);
    expect(
      deriveCreatureEntryMechanics(
        'Shapechanger',
        'The imp can use its action to polymorph into a beast form that resembles a rat (speed 20 ft.), a raven (20 ft., fly 60 ft.), or a spider (20 ft., climb 20 ft.), or back into its true form. Its statistics are the same in each form, except for the speed changes noted. Any equipment it is wearing or carrying isn’t transformed. It reverts to its true form if it dies.',
      ).effects,
    ).toEqual([
      {
        kind: 'changeShape',
        cost: 'action',
        forms: [
          { kind: 'fixed', name: 'rat', speedOverrides: { walk: 20 } },
          {
            kind: 'fixed',
            name: 'raven',
            speedOverrides: { walk: 20, fly: 60 },
          },
          {
            kind: 'fixed',
            name: 'spider',
            speedOverrides: { walk: 20, climb: 20 },
          },
        ],
        statistics: { model: 'same-except', except: ['speed'] },
        equipment: { disposition: 'not-transformed' },
        reversion: { on: ['death'] },
      },
    ]);
    expect(
      deriveCreatureEntryMechanics(
        'Shapechanger',
        'The werebear can use its action to polymorph into a Large bear-humanoid hybrid or into a Large bear, or back into its true form, which is humanoid. Its statistics, other than its size and AC, are the same in each form. Any equipment it is wearing or carrying isn’t transformed. It reverts to its true form if it dies.',
      ).effects,
    ).toEqual([
      {
        kind: 'changeShape',
        cost: 'action',
        forms: [
          {
            kind: 'statline-variant',
            variant: 'bear-humanoid hybrid',
            size: 'large',
            statlineRefs: [
              {
                kind: 'armor-class-variant',
                condition: 'in bear and hybrid form',
              },
              { kind: 'speed-variant', condition: 'in bear or hybrid form' },
            ],
          },
          {
            kind: 'statline-variant',
            variant: 'bear',
            size: 'large',
            statlineRefs: [
              {
                kind: 'armor-class-variant',
                condition: 'in bear and hybrid form',
              },
              { kind: 'speed-variant', condition: 'in bear or hybrid form' },
            ],
          },
        ],
        statistics: { model: 'same-except', except: ['size', 'ac'] },
        equipment: { disposition: 'not-transformed' },
        reversion: { on: ['death'] },
      },
    ]);
    const lycanthropes = [
      [
        "The wereboar can use its action to polymorph into a boar-humanoid hybrid or into a boar, or back into its true form, which is humanoid. Its statistics, other than its AC, are the same in each form. Any equipment it is wearing or carrying isn't transformed. It reverts to its true form if it dies.",
        [
          {
            kind: 'statline-variant',
            variant: 'boar-humanoid hybrid',
            statlineRefs: [
              {
                kind: 'armor-class-variant',
                condition: 'in boar or hybrid form',
              },
            ],
          },
          {
            kind: 'statline-variant',
            variant: 'boar',
            statlineRefs: [
              {
                kind: 'armor-class-variant',
                condition: 'in boar or hybrid form',
              },
              { kind: 'speed-variant', condition: 'in boar form' },
            ],
          },
        ],
        ['ac'],
      ],
      [
        "The wererat can use its action to polymorph into a rat-humanoid hybrid or into a giant rat, or back into its true form, which is humanoid. Its statistics, other than its size, are the same in each form. Any equipment it is wearing or carrying isn't transformed. It reverts to its true form if it dies.",
        [
          {
            kind: 'statline-variant',
            variant: 'rat-humanoid hybrid',
            size: 'medium',
          },
          { kind: 'statline-variant', variant: 'giant rat', size: 'small' },
        ],
        ['size'],
      ],
      [
        "The weretiger can use its action to polymorph into a tiger-humanoid hybrid or into a tiger, or back into its true form, which is humanoid. Its statistics, other than its size, are the same in each form. Any equipment it is wearing or carrying isn't transformed. It reverts to its true form if it dies.",
        [
          {
            kind: 'statline-variant',
            variant: 'tiger-humanoid hybrid',
            size: 'medium',
          },
          {
            kind: 'statline-variant',
            variant: 'tiger',
            size: 'large',
            statlineRefs: [
              { kind: 'speed-variant', condition: 'in tiger form' },
            ],
          },
        ],
        ['size'],
      ],
      [
        "The werewolf can use its action to polymorph into a wolf-humanoid hybrid or into a wolf, or back into its true form, which is humanoid. Its statistics, other than its AC, are the same in each form. Any equipment it is wearing or carrying isn't transformed. It reverts to its true form if it dies.",
        [
          {
            kind: 'statline-variant',
            variant: 'wolf-humanoid hybrid',
            statlineRefs: [
              {
                kind: 'armor-class-variant',
                condition: 'in wolf or hybrid form',
              },
            ],
          },
          {
            kind: 'statline-variant',
            variant: 'wolf',
            statlineRefs: [
              {
                kind: 'armor-class-variant',
                condition: 'in wolf or hybrid form',
              },
              { kind: 'speed-variant', condition: 'in wolf form' },
            ],
          },
        ],
        ['ac'],
      ],
    ] as const;
    for (const [text, forms, except] of lycanthropes) {
      expect(
        deriveCreatureEntryMechanics('Shapechanger', text).effects,
      ).toEqual([
        expect.objectContaining({
          kind: 'changeShape',
          forms,
          statistics: { model: 'same-except', except },
        }),
      ]);
    }
    const werebear =
      "The werebear can use its action to polymorph into a Large bear-humanoid hybrid or into a Large bear, or back into its true form, which is humanoid. Its statistics, other than its size and AC, are the same in each form. Any equipment it is wearing or carrying isn't transformed. It reverts to its true form if it dies.";
    expect(
      deriveCreatureEntryMechanics(
        'Shapechanger',
        werebear.replace('Large bear,', 'bear,'),
      ).effects,
    ).toBeUndefined();
    expect(
      deriveCreatureEntryMechanics(
        'Shapechanger',
        werebear.replace('bear-humanoid hybrid', 'boar-humanoid hybrid'),
      ).effects,
    ).toBeUndefined();
    expect(
      deriveCreatureEntryMechanics(
        'Shapechanger',
        werebear.replace('size and AC', 'size'),
      ).effects,
    ).toBeUndefined();
    expect(
      deriveCreatureEntryMechanics(
        'Change Shape',
        'The dragon changes form when it dies.',
      ).effects,
    ).toBeUndefined();
  });

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
    expect(mechanics.effects).toEqual([
      {
        kind: 'multiattack',
        attacks: 4,
        routine: [
          { attack: 'pincers', attacks: 2 },
          { attack: 'fists', attacks: 2 },
        ],
      },
    ]);
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
      deriveFeatureMechanics(
        'Your unarmed strikes count as magical for the purpose of overcoming resistance and immunity to nonmagical attacks and damage.',
      ).effects,
    ).toEqual([{ kind: 'weaponAttacksMagical', scope: 'unarmed-strikes' }]);
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

  it('fails closed for S2 reviewed spell names when the reviewed source clause is absent', () => {
    expect(() =>
      deriveSpellMechanics(
        baseSpell({
          name: 'Augury',
          description:
            'By casting marked sticks, you receive a harmless narrative omen.',
        }),
      ),
    ).toThrow(/missing reviewed source clause: repeat-casting chance/);
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
    ).toEqual([{ kind: 'acFormula', base: 13, abilities: ['dexterity'] }]);
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
        // The explicit "You can use a shield and still gain this benefit."
        // sentence is part of the deterministic contract.
        allowsShield: true,
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
    // Exact objects: the actor-side constraint must NOT absorb the
    // coordinated ", but attack rolls against you …" continuation, which is
    // its own effect.
    expect(mechanics.effects).toEqual([
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

  it('projects Martial Arts: shared eligibility, progression-backed die, and the bonus-action prerequisite', () => {
    const mechanics = derive(
      'At 1st level, your practice of martial arts gives you mastery of combat styles that use unarmed strikes and monk weapons, which are shortswords and any simple melee weapons that don’t have the two-handed or heavy property. You gain the following benefits while you are unarmed or wielding only monk weapons and you aren’t wearing armor or wielding a shield: • You can use Dexterity instead of Strength for the attack and damage rolls of your unarmed strikes and monk weapons. • You can roll a d4 in place of the normal damage of your unarmed strike or monk weapon. This die changes as you gain monk levels, as shown in the Martial Arts column of the Monk table. • When you use the Attack action with an unarmed strike or a monk weapon on your turn, you can make one unarmed strike as a bonus action.',
    );
    const eligibility = {
      wielding: 'unarmed-or-monk-weapons-only',
      armor: false,
      shield: false,
    };
    expect(mechanics.effects).toEqual([
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
      {
        kind: 'damageDieReplacement',
        die: 'd4',
        appliesTo: 'your unarmed strike or monk weapon',
        // The die is progression-backed: it resolves against the Monk
        // table's martialArts resource column, not a fixed d4.
        progression: { classRef: 'class:monk', resource: 'martialArts' },
        eligibility,
      },
    ]);
  });

  it('projects Dragon Wings: fly speed with bonus-action activation/dismissal and the armor restriction', () => {
    expect(
      derive(
        'At 14th level, you gain the ability to sprout a pair of dragon wings from your back, gaining a flying speed equal to your current speed. You can create these wings as a bonus action on your turn. They last until you dismiss them as a bonus action on your turn. You can’t manifest your wings while wearing armor unless the armor is made to accommodate them, and clothing not made to accommodate your wings might be destroyed when you manifest them.',
      ).effects,
    ).toEqual([
      {
        kind: 'speedSet',
        mode: 'fly',
        value: 'current-speed',
        activation: { cost: 'bonus-action' },
        deactivation: { cost: 'bonus-action' },
        eligibility: { armor: 'accommodating-armor-only' },
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
        'You can attack twice, instead of once, whenever you take the Attack action on your turn. The number of attacks increases to three when you reach 11th level in this class and to four when you reach 20th level in this class.',
      ).effects,
    ).toEqual([
      {
        kind: 'extraAttack',
        attacks: 2,
        increases: [
          { level: 11, attacks: 3 },
          { level: 20, attacks: 4 },
        ],
      },
    ]);
    expect(
      derive(
        'You can roll one additional weapon damage die when determining the extra damage for a critical hit with a melee attack. This increases to two additional dice at 13th level and three additional dice at 17th level.',
      ).effects,
    ).toEqual([
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

  it('projects Stonecunning as a scoped proficiency plus scoped expertise, not prose in the grant string', () => {
    const mechanics = derive(
      'Whenever you make an Intelligence (History) check related to the origin of stonework, you are considered proficient in the History skill and add double your proficiency bonus to the check, instead of your normal proficiency bonus.',
    );
    expect(mechanics.effects).toEqual([
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
    ).toEqual([
      {
        kind: 'savingThrowBonus',
        addAbilityModifier: 'charisma',
        minimum: 1,
        subject: 'you-or-friendly-creatures',
        rangeFeet: 10,
      },
    ]);
    expect(
      derive(
        'The extra damage is 2d8 for a 1st-level spell slot, plus 1d8 for each spell level higher than 1st, to a maximum of 5d8. The damage increases by 1d8 if the target is an undead or a fiend.',
      ).effects,
    ).toEqual([
      {
        kind: 'extraDamage',
        dice: '2d8',
        perSlotLevelIncrease: '1d8',
        maximumDice: '5d8',
        bonusDiceVsUndeadOrFiend: '1d8',
      },
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
