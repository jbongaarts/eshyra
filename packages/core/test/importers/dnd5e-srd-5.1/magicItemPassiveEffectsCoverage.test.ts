/**
 * Exhaustive coverage/depth gate (eshyra-o9bd.18.7.7.5 PR #415 review): for
 * every one of the 58 uniquely M2/M3-tagged magic items, asserts the exact
 * projected parent `mechanics` value (including `undefined` for the three
 * families whose effects correctly live only on structured variants) against
 * the real committed-pack description text. This is a depth assertion, not
 * just a membership check: a dropped clause, a missing source condition, or
 * an over-broad grant changes the expected value here and fails the test,
 * whereas the earlier `must()` source-drift assertions alone only prove a
 * phrase is present, not that it was faithfully modeled.
 *
 * This fixture locks in regressions against the module's OWN current output
 * (re-derived here, not independently authored), so it cannot by itself prove
 * completeness relative to the source inventory — see
 * `magicItemPassiveEffectsMembership.test.ts` for the independent,
 * artifact-transcribed membership + clause-count baseline that complements it.
 *
 * Fixture descriptions and expected mechanics are taken verbatim from the
 * reviewed committed pack (`packages/core/data/rules-packs/rules__dnd5e-srd-5.1/records.json`)
 * after the PR #415 review-round-4 fixes; re-derive this fixture only when a
 * change to `magicItemPassiveEffects.ts` is intentional and reviewed.
 */
import { describe, expect, it } from 'vitest';
import { deriveMagicItemMechanics } from '../../../scripts/importers/dnd5e-srd-5.1/magicItemPassiveEffects.js';
import type { MagicItemExtraction } from '../../../scripts/importers/dnd5e-srd-5.1/types.js';

interface CoverageCase {
  readonly name: string;
  readonly description: string;
  readonly expectedMechanics: Record<string, unknown> | undefined;
}

const COVERAGE_CASES: readonly CoverageCase[] = [
  {
    name: 'Amulet of Health',
    description:
      'Your Constitution score is 19 while you wear this amulet. It has no effect on you if your Constitution is already 19 or higher.',
    expectedMechanics: {
      effects: [
        {
          kind: 'abilityScoreSet',
          ability: 'constitution',
          value: 19,
        },
      ],
    },
  },
  {
    name: 'Belt of Dwarvenkind',
    description:
      'While wearing this belt, you gain the following benefits: • Your Constitution score increases by 2, to a maximum of 20. • You have advantage on Charisma (Persuasion) checks made to interact with dwarves. In addition, while attuned to the belt, you have a 50 percent chance each day at dawn of growing a full beard if you’re capable of growing one, or a visibly thicker beard if you already have one. If you aren’t a dwarf, you gain the following additional benefits while wearing the belt: • You have advantage on saving throws against poison, and you have resistance against poison damage. • You have darkvision out to a range of 60 feet. • You can speak, read, and write Dwarvish.',
    expectedMechanics: {
      effects: [
        {
          kind: 'abilityScoreIncrease',
          abilities: ['constitution'],
          amount: 2,
          newMaximum: 20,
        },
        {
          kind: 'proficiency',
          grant: 'speak, read, and write Dwarvish',
          condition: 'if you aren’t a dwarf',
        },
        {
          kind: 'sense',
          sense: 'darkvision',
          rangeFeet: 60,
          condition: 'if you aren’t a dwarf',
        },
      ],
    },
  },
  {
    name: 'Belt of Giant Strength',
    description:
      'While wearing this belt, your Strength score changes to a score granted by the belt. If your Strength is already equal to or greater than the belt’s score, the item has no effect on you. Six varieties of this belt exist, corresponding with and having rarity according to the six kinds of true giants. The belt of stone giant strength and the belt of frost giant strength look different, but they have the same effect.',
    expectedMechanics: {
      effects: [
        {
          kind: 'abilityScoreSet',
          ability: 'strength',
          tableRef: 'table:belt-of-giant-strength',
        },
      ],
    },
  },
  {
    name: 'Berserker Axe',
    description:
      'You gain a +1 bonus to attack and damage rolls made with this magic weapon. In addition, while you are attuned to this weapon, your hit point maximum increases by 1 for each level you have attained. Curse. This axe is cursed, and becoming attuned to it extends the curse to you. As long as you remain cursed, you are unwilling to part with the axe, keeping it within reach at all times. You also have disadvantage on attack rolls with weapons other than this one, unless no foe is within 60 feet of you that you can see or hear. Whenever a hostile creature damages you while the axe is in your possession, you must succeed on a DC 15 Wisdom saving throw or go berserk. While berserk, you must use your action each round to attack the creature nearest to you with the axe. If you can make extra attacks as part of the Attack action, you use those extra attacks, moving to attack the next nearest creature after you fell your current target. If you have multiple possible targets, you attack one at random. You are berserk until you start your turn with no creatures within 60 feet of you that you can see or hear.',
    expectedMechanics: {
      effects: [
        {
          kind: 'hitPointMaximumIncrease',
          perLevel: 1,
        },
      ],
    },
  },
  {
    name: 'Boots of Speed',
    description:
      'While you wear these boots, you can use a bonus action and click the boots’ heels together. If you do, the boots double your walking speed, and any creature that makes an opportunity attack against you has disadvantage on the attack roll. If you click your heels together again, you end the effect. When the boots’ property has been used for a total of 10 minutes, the magic ceases to function until you finish a long rest.',
    expectedMechanics: {
      effects: [
        {
          kind: 'speedMultiplier',
          multiplier: 2,
        },
      ],
    },
  },
  {
    name: 'Boots of Striding and Springing',
    description:
      'While you wear these boots, your walking speed becomes 30 feet, unless your walking speed is higher, and your speed isn’t reduced if you are encumbered or wearing heavy armor. In addition, you can jump three times the normal distance, though you can’t jump farther than your remaining movement would allow.',
    expectedMechanics: {
      effects: [
        {
          kind: 'speedSet',
          mode: 'walk',
          value: 30,
          floor: true,
        },
        {
          kind: 'ignoreMovementRestriction',
          source: 'being encumbered or wearing heavy armor',
        },
        {
          kind: 'jumpDistanceMultiplier',
          multiplier: 3,
          condition:
            'you can’t jump farther than your remaining movement would allow',
        },
      ],
    },
  },
  {
    name: 'Boots of the Winterlands',
    description:
      'These furred boots are snug and feel quite warm. While you wear them, you gain the following benefits: • You have resistance to cold damage. • You ignore difficult terrain created by ice or snow. • You can tolerate temperatures as low as −50 degrees Fahrenheit without any additional protection. If you wear heavy clothes, you can tolerate temperatures as low as −100 degrees Fahrenheit.',
    expectedMechanics: {
      effects: [
        {
          kind: 'ignoreDifficultTerrain',
          terrain: ['ice', 'snow'],
        },
        {
          kind: 'temperatureTolerance',
          minimumFahrenheit: -50,
          withHeavyClothesMinimumFahrenheit: -100,
        },
      ],
    },
  },
  {
    name: 'Bracers of Archery',
    description:
      'While wearing these bracers, you have proficiency with the longbow and shortbow, and you gain a +2 bonus to damage rolls on ranged attacks made with such weapons.',
    expectedMechanics: {
      effects: [
        {
          kind: 'proficiency',
          grant: 'longbow and shortbow',
        },
      ],
    },
  },
  {
    name: 'Broom of Flying',
    description:
      'This wooden broom, which weighs 3 pounds, functions like a mundane broom until you stand astride it and speak its command word. It then hovers beneath you and can be ridden in the air. It has a flying speed of 50 feet. It can carry up to 400 pounds, but its flying speed becomes 30 feet while carrying over 200 pounds. The broom stops hovering when you land. You can send the broom to travel alone to a destination within 1 mile of you if you speak the command word, name the location, and are familiar with that place. The broom comes back to you when you speak another command word, provided that the broom is still within 1 mile of you.',
    expectedMechanics: {
      effects: [
        {
          kind: 'speedSet',
          mode: 'fly',
          value: 50,
          weightCapacity: {
            maximumPounds: 400,
            reducedValue: 30,
            reducedAboveWeightPounds: 200,
          },
        },
      ],
    },
  },
  {
    name: 'Carpet of Flying',
    description:
      'You can speak the carpet’s command word as an action to make the carpet hover and fly. It moves according to your spoken directions, provided that you are within 30 feet of it. Four sizes of carpet of flying exist. The GM chooses the size of a given carpet or determines it randomly. A carpet can carry up to twice the weight shown on the table, but it flies at half speed if it carries more than its normal capacity.',
    expectedMechanics: {
      effects: [
        {
          kind: 'speedSet',
          mode: 'fly',
          valueTableRef: 'table:carpet-of-flying',
        },
        {
          kind: 'speedMultiplier',
          multiplier: 0.5,
          threshold: {
            tableRef: 'table:carpet-of-flying',
            multiplier: 1,
          },
          maximumCapacity: {
            tableRef: 'table:carpet-of-flying',
            multiplier: 2,
          },
        },
      ],
    },
  },
  {
    name: 'Cloak of Arachnida',
    description:
      'This fine garment is made of black silk interwoven with faint silvery threads. While wearing it, you gain the following benefits: • You have resistance to poison damage. • You have a climbing speed equal to your walking speed. • You can move up, down, and across vertical surfaces and upside down along ceilings, while leaving your hands free. • You can’t be caught in webs of any sort and can move through webs as if they were difficult terrain. • You can use an action to cast the web spell (save DC 13). The web created by the spell fills twice its normal area. Once used, this property of the cloak can’t be used again until the next dawn.',
    expectedMechanics: {
      effects: [
        {
          kind: 'speedSet',
          mode: 'climb',
          value: 'walking-speed',
        },
        {
          kind: 'climbAnywhere',
        },
        {
          kind: 'immunity',
          to: 'being caught in webs of any sort',
        },
        {
          kind: 'movementCostMultiplier',
          feetPerFoot: 2,
          terrain: ['webs'],
        },
      ],
    },
  },
  {
    name: 'Cloak of the Bat',
    description:
      'While wearing this cloak, you have advantage on Dexterity (Stealth) checks. In an area of dim light or darkness, you can grip the edges of the cloak with both hands and use it to fly at a speed of 40 feet. If you ever fail to grip the cloak’s edges while flying in this way, or if you are no longer in dim light or darkness, you lose this flying speed. While wearing the cloak in an area of dim light or darkness, you can use your action to cast polymorph on yourself, transforming into a bat. While you are in the form of the bat, you retain your Intelligence, Wisdom, and Charisma scores. The cloak can’t be used this way again until the next dawn.',
    expectedMechanics: {
      effects: [
        {
          kind: 'speedSet',
          mode: 'fly',
          value: 40,
          condition:
            'only in dim light or darkness, while gripping the cloak’s edges with both hands; ends if you stop gripping or leave dim light/darkness',
        },
      ],
    },
  },
  {
    name: 'Cloak of the Manta Ray',
    description:
      'While wearing this cloak with its hood up, you can breathe underwater, and you have a swimming speed of 60 feet. Pulling the hood up or down requires an action.',
    expectedMechanics: {
      effects: [
        {
          kind: 'breathes',
          environments: ['water'],
          condition: 'while wearing the cloak with its hood up',
        },
        {
          kind: 'speedSet',
          mode: 'swim',
          value: 60,
          condition: 'while wearing the cloak with its hood up',
        },
      ],
    },
  },
  {
    name: 'Crystal Ball',
    description:
      'The typical crystal ball, a very rare item, is about 6 inches in diameter. While touching it, you can cast the scrying spell (save DC 17) with it. The following crystal ball variants are legendary items and have additional properties. Crystal Ball of Mind Reading. You can use an action to cast the detect thoughts spell (save DC 17) while you are scrying with the crystal ball, targeting creatures you can see within 30 feet of the spell’s sensor. You don’t need to concentrate on this detect thoughts to maintain it during its duration, but it ends if scrying ends. Crystal Ball of Telepathy. While scrying with the crystal ball, you can communicate telepathically with creatures you can see within 30 feet of the spell’s sensor. You can also use an action to cast the suggestion spell (save DC 17) through the sensor on one of those creatures. You don’t need to concentrate on this suggestion to maintain it during its duration, but it ends if scrying ends. Once used, the suggestion power of the crystal ball can’t be used again until the next dawn. Crystal Ball of True Seeing. While scrying with the crystal ball, you have truesight with a radius of 120 feet centered on the spell’s sensor.',
    expectedMechanics: undefined,
  },
  {
    name: 'Demon Armor',
    description:
      'While wearing this armor, you gain a +1 bonus to AC, and you can understand and speak Abyssal. In addition, the armor’s clawed gauntlets turn unarmed strikes with your hands into magic weapons that deal slashing damage, with a +1 bonus to attack rolls and damage rolls and a damage die of 1d8. Curse. Once you don this cursed armor, you can’t doff it unless you are targeted by the remove curse spell or similar magic. While wearing the armor, you have disadvantage on attack rolls against demons and on saving throws against their spells and special abilities.',
    expectedMechanics: {
      effects: [
        {
          kind: 'proficiency',
          grant: 'understand and speak Abyssal',
        },
      ],
    },
  },
  {
    name: 'Dragon Scale Mail',
    description:
      'Dragon scale mail is made of the scales of one kind of dragon. Sometimes dragons collect their cast-off scales and gift them to humanoids. Other times, hunters carefully skin and preserve the hide of a dead dragon. In either case, dragon scale mail is highly valued. While wearing this armor, you gain a +1 bonus to AC, you have advantage on saving throws against the Frightful Presence and breath weapons of dragons, and you have resistance to one damage type that is determined by the kind of dragon that provided the scales (see the table). Additionally, you can focus your senses as an action to magically discern the distance and direction to the closest dragon within 30 miles of you that is of the same type as the armor. This special action can’t be used again until the next dawn.',
    expectedMechanics: {
      effects: [
        {
          kind: 'sense',
          sense: 'nearest-dragon-of-matching-type',
          rangeMiles: 30,
          condition: 'as an action; usable once per dawn',
        },
      ],
    },
  },
  {
    name: 'Elven Chain',
    description:
      'You gain a +1 bonus to AC while you wear this armor. You are considered proficient with this armor even if you lack proficiency with medium armor.',
    expectedMechanics: {
      effects: [
        {
          kind: 'proficiency',
          grant: 'this armor',
          condition:
            'considered proficient even if you lack proficiency with medium armor',
        },
      ],
    },
  },
  {
    name: 'Gauntlets of Ogre Power',
    description:
      'Your Strength score is 19 while you wear these gauntlets. They have no effect on you if your Strength is already 19 or higher.',
    expectedMechanics: {
      effects: [
        {
          kind: 'abilityScoreSet',
          ability: 'strength',
          value: 19,
        },
      ],
    },
  },
  {
    name: 'Gem of Seeing',
    description:
      'This gem has 3 charges. As an action, you can speak the gem’s command word and expend 1 charge. For the next 10 minutes, you have truesight out to 120 feet when you peer through the gem. The gem regains 1d3 expended charges daily at dawn.',
    expectedMechanics: {
      effects: [
        {
          kind: 'sense',
          sense: 'truesight',
          rangeFeet: 120,
          durationMinutes: 10,
          condition: 'while peering through the gem',
        },
      ],
    },
  },
  {
    name: 'Gloves of Swimming and Climbing',
    description:
      'While wearing these gloves, climbing and swimming don’t cost you extra movement, and you gain a +5 bonus to Strength (Athletics) checks made to climb or swim.',
    expectedMechanics: {
      effects: [
        {
          kind: 'climbWithoutExtraMovement',
        },
        {
          kind: 'swimWithoutExtraMovement',
        },
      ],
    },
  },
  {
    name: 'Goggles of Night',
    description:
      'While wearing these dark lenses, you have darkvision out to a range of 60 feet. If you already have darkvision, wearing the goggles increases its range by 60 feet.',
    expectedMechanics: {
      effects: [
        {
          kind: 'sense',
          sense: 'darkvision',
          rangeFeet: 60,
          bonusRangeFeetIfAlreadyHasSense: 60,
        },
      ],
    },
  },
  {
    name: 'Hammer of Thunderbolts',
    description:
      'You gain a +1 bonus to attack and damage rolls made with this magic weapon. Giant’s Bane (Requires Attunement). You must be wearing a belt of giant strength (any variety) and gauntlets of ogre power to attune to this weapon. The attunement ends if you take off either of those items. While you are attuned to this weapon and holding it, your Strength score increases by 4 and can exceed 20, but not 30. When you roll a 20 on an attack roll made with this weapon against a giant, the giant must succeed on a DC 17 Constitution saving throw or die. The hammer also has 5 charges. While attuned to it, you can expend 1 charge and make a ranged weapon attack with the hammer, hurling it as if it had the thrown property with a normal range of 20 feet and a long range of 60 feet. If the attack hits, the hammer unleashes a thunderclap audible out to 300 feet. The target and every creature within 30 feet of it must succeed on a DC 17 Constitution saving throw or be stunned until the end of your next turn. The hammer regains 1d4 + 1 expended charges daily at dawn.',
    expectedMechanics: {
      effects: [
        {
          kind: 'abilityScoreIncrease',
          abilities: ['strength'],
          amount: 4,
          newMaximum: 30,
          condition: 'while attuned to this weapon and holding it',
        },
      ],
    },
  },
  {
    name: 'Headband of Intellect',
    description:
      'Your Intelligence score is 19 while you wear this headband. It has no effect on you if your Intelligence is already 19 or higher.',
    expectedMechanics: {
      effects: [
        {
          kind: 'abilityScoreSet',
          ability: 'intelligence',
          value: 19,
        },
      ],
    },
  },
  {
    name: 'Helm of Telepathy',
    description:
      'While wearing this helm, you can use an action to cast the detect thoughts spell (save DC 13) from it. As long as you maintain concentration on the spell, you can use a bonus action to send a telepathic message to a creature you are focused on. It can reply—using a bonus action to do so—while your focus on it continues. While focusing on a creature with detect thoughts, you can use an action to cast the suggestion spell (save DC 13) from the helm on that creature. Once used, the suggestion property can’t be used again until the next dawn.',
    expectedMechanics: {
      effects: [
        {
          kind: 'telepathicRelay',
          requires: 'concentrating on the helm’s detect thoughts',
        },
      ],
    },
  },
  {
    name: 'Horseshoes of Speed',
    description:
      'These iron horseshoes come in a set of four. While all four shoes are affixed to the hooves of a horse or similar creature, they increase the creature’s walking speed by 30 feet.',
    expectedMechanics: {
      effects: [
        {
          kind: 'speedBonus',
          amountFeet: 30,
          condition:
            'requires all four horseshoes affixed to the hooves of a horse or similar creature',
        },
      ],
    },
  },
  {
    name: 'Horseshoes of a Zephyr',
    description:
      'These iron horseshoes come in a set of four. While all four shoes are affixed to the hooves of a horse or similar creature, they allow the creature to move normally while floating 4 inches above the ground. This effect means the creature can cross or stand above nonsolid or unstable surfaces, such as water or lava. The creature leaves no tracks and ignores difficult terrain. In addition, the creature can move at normal speed for up to 12 hours a day without suffering exhaustion from a forced march.',
    expectedMechanics: {
      effects: [
        {
          kind: 'hover',
          heightInches: 4,
          condition:
            'requires all four horseshoes affixed to the hooves of a horse or similar creature',
        },
        {
          kind: 'walkOnLiquids',
          surfaces: 'nonsolid or unstable surfaces, such as water or lava',
          condition:
            'requires all four horseshoes affixed to the hooves of a horse or similar creature',
        },
        {
          kind: 'leavesNoTracks',
          condition:
            'requires all four horseshoes affixed to the hooves of a horse or similar creature',
        },
        {
          kind: 'ignoreDifficultTerrain',
          terrain: ['all'],
          condition:
            'requires all four horseshoes affixed to the hooves of a horse or similar creature',
        },
        {
          kind: 'immunity',
          to: 'exhaustion from a forced march',
          condition:
            'requires all four horseshoes affixed to the hooves of a horse or similar creature; for up to 12 hours per day',
        },
      ],
    },
  },
  {
    name: 'Ioun Stone',
    description:
      'An Ioun stone is named after Ioun, a god of knowledge and prophecy revered on some worlds. Many types of Ioun stone exist, each type a distinct combination of shape and color. When you use an action to toss one of these stones into the air, the stone orbits your head at a distance of 1d3 feet and confers a benefit to you. Thereafter, another creature must use an action to grasp or net the stone to separate it from you, either by making a successful attack roll against AC 24 or a successful DC 24 Dexterity (Acrobatics) check. You can use an action to seize and stow the stone, ending its effect. A stone has AC 24, 10 hit points, and resistance to all damage. It is considered to be an object that is being worn while it orbits your head. Absorption (Very Rare). While this pale lavender ellipsoid orbits your head, you can use your reaction to cancel a spell of 4th level or lower cast by a creature you can see and targeting only you. Once the stone has canceled 20 levels of spells, it burns out and turns dull gray, losing its magic. If you are targeted by a spell whose level is higher than the number of spell levels the stone has left, the stone can’t cancel it. Agility (Very Rare). Your Dexterity score increases by 2, to a maximum of 20, while this deep red sphere orbits your head. Awareness (Rare). You can’t be surprised while this dark blue rhomboid orbits your head. Fortitude (Very Rare). Your Constitution score increases by 2, to a maximum of 20, while this pink rhomboid orbits your head. Greater Absorption (Legendary). While this marbled lavender and green ellipsoid orbits your head, you can use your reaction to cancel a spell of 8th level or lower cast by a creature you can see and targeting only you. Once the stone has canceled 50 levels of spells, it burns out and turns dull gray, losing its magic. If you are targeted by a spell whose level is higher than the number of spell levels the stone has left, the stone can’t cancel it. Insight (Very Rare). Your Wisdom score increases by 2, to a maximum of 20, while this incandescent blue sphere orbits your head. Intellect (Very Rare). Your Intelligence score increases by 2, to a maximum of 20, while this marbled scarlet and blue sphere orbits your head. Leadership (Very Rare). Your Charisma score increases by 2, to a maximum of 20, while this marbled pink and green sphere orbits your head. Mastery (Legendary). Your proficiency bonus increases by 1 while this pale green prism orbits your head. Protection (Rare). You gain a +1 bonus to AC while this dusty rose prism orbits your head. Regeneration (Legendary). You regain 15 hit points at the end of each hour this pearly white spindle orbits your head, provided that you have at least 1 hit point. Reserve (Rare). This vibrant purple prism stores spells cast into it, holding them until you use them. The stone can store up to 3 levels worth of spells at a time. When found, it contains 1d4 − 1 levels of stored spells chosen by the GM. Any creature can cast a spell of 1st through 3rd level into the stone by touching it as the spell is cast. The spell has no effect, other than to be stored in the stone. If the stone can’t hold the spell, the spell is expended without effect. The level of the slot used to cast the spell determines how much space it uses. While this stone orbits your head, you can cast any spell stored in it. The spell uses the slot level, spell save DC, spell attack bonus, and spellcasting ability of the original caster, but is otherwise treated as if you cast the spell. The spell cast from the stone is no longer stored in it, freeing up space. Strength (Very Rare). Your Strength score increases by 2, to a maximum of 20, while this pale blue rhomboid orbits your head. Sustenance (Rare). You don’t need to eat or drink while this clear spindle orbits your head.',
    expectedMechanics: undefined,
  },
  {
    name: 'Lantern of Revealing',
    description:
      'While lit, this hooded lantern burns for 6 hours on 1 pint of oil, shedding bright light in a 30-foot radius and dim light for an additional 30 feet. Invisible creatures and objects are visible as long as they are in the lantern’s bright light. You can use an action to lower the hood, reducing the light to dim light in a 5-foot radius.',
    expectedMechanics: {
      effects: [
        {
          kind: 'light',
          level: 'bright',
          radiusFeet: 30,
          dimAdditionalFeet: 30,
          condition: 'while lit; burns for 6 hours per pint of oil',
        },
        {
          kind: 'light',
          level: 'dim',
          radiusFeet: 5,
          condition: 'hood lowered (an action)',
        },
        {
          kind: 'sense',
          sense: 'reveal-invisible-in-bright-light',
          condition:
            'creatures/objects in the lantern’s bright light are visible; lowering the hood (an action) removes the bright light, so the reveal does not apply while the hood is down',
        },
      ],
    },
  },
  {
    name: 'Manual of Bodily Health',
    description:
      'This book contains health and diet tips, and its words are charged with magic. If you spend 48 hours over a period of 6 days or fewer studying the book’s contents and practicing its guidelines, your Constitution score increases by 2, as does your maximum for that score. The manual then loses its magic, but regains it in a century.',
    expectedMechanics: {
      effects: [
        {
          kind: 'abilityScoreIncrease',
          abilities: ['constitution'],
          amount: 2,
          alsoIncreasesMaximum: true,
        },
      ],
    },
  },
  {
    name: 'Manual of Gainful Exercise',
    description:
      'This book describes fitness exercises, and its words are charged with magic. If you spend 48 hours over a period of 6 days or fewer studying the book’s contents and practicing its guidelines, your Strength score increases by 2, as does your maximum for that score. The manual then loses its magic, but regains it in a century.',
    expectedMechanics: {
      effects: [
        {
          kind: 'abilityScoreIncrease',
          abilities: ['strength'],
          amount: 2,
          alsoIncreasesMaximum: true,
        },
      ],
    },
  },
  {
    name: 'Manual of Quickness of Action',
    description:
      'This book contains coordination and balance exercises, and its words are charged with magic. If you spend 48 hours over a period of 6 days or fewer studying the book’s contents and practicing its guidelines, your Dexterity score increases by 2, as does your maximum for that score. The manual then loses its magic, but regains it in a century.',
    expectedMechanics: {
      effects: [
        {
          kind: 'abilityScoreIncrease',
          abilities: ['dexterity'],
          amount: 2,
          alsoIncreasesMaximum: true,
        },
      ],
    },
  },
  {
    name: 'Necklace of Adaptation',
    description:
      'While wearing this necklace, you can breathe normally in any environment, and you have advantage on saving throws made against harmful gases and vapors (such as cloudkill and stinking cloud effects, inhaled poisons, and the breath weapons of some dragons).',
    expectedMechanics: {
      effects: [
        {
          kind: 'breathes',
          anyEnvironment: true,
        },
      ],
    },
  },
  {
    name: 'Periapt of Wound Closure',
    description:
      'While you wear this pendant, you stabilize whenever you are dying at the start of your turn. In addition, whenever you roll a Hit Die to regain hit points, double the number of hit points it restores.',
    expectedMechanics: {
      effects: [
        {
          kind: 'stabilize',
          trigger: 'start of your turn while dying',
        },
        {
          kind: 'healingMultiplier',
          multiplier: 2,
          appliesTo: 'hit-dice-spent-to-regain-hit-points',
        },
      ],
    },
  },
  {
    name: 'Potion of Climbing',
    description:
      'When you drink this potion, you gain a climbing speed equal to your walking speed for 1 hour. During this time, you have advantage on Strength (Athletics) checks you make to climb. The potion is separated into brown, silver, and gray layers resembling bands of stone. Shaking the bottle fails to mix the colors.',
    expectedMechanics: {
      effects: [
        {
          kind: 'speedSet',
          mode: 'climb',
          value: 'walking-speed',
          condition: 'for 1 hour after drinking',
        },
      ],
    },
  },
  {
    name: 'Potion of Flying',
    description:
      'When you drink this potion, you gain a flying speed equal to your walking speed for 1 hour and can hover. If you’re in the air when the potion wears off, you fall unless you have some other means of staying aloft. This potion’s clear liquid floats at the top of its container and has cloudy white impurities drifting in it.',
    expectedMechanics: {
      effects: [
        {
          kind: 'speedSet',
          mode: 'fly',
          value: 'walking-speed',
          hover: true,
          condition:
            'for 1 hour; if still aloft when the potion wears off, you fall unless you have another means of staying aloft',
        },
      ],
    },
  },
  {
    name: 'Potion of Giant Strength',
    description:
      'When you drink this potion, your Strength score changes for 1 hour. The type of giant determines the score (see the table below). The potion has no effect on you if your Strength is equal to or greater than that score. This potion’s transparent liquid has floating in it a sliver of fingernail from a giant of the appropriate type. The potion of frost giant strength and the potion of stone giant strength have the same effect.',
    expectedMechanics: {
      effects: [
        {
          kind: 'abilityScoreSet',
          ability: 'strength',
          tableRef: 'table:potion-of-giant-strength',
          condition: 'for 1 hour',
        },
      ],
    },
  },
  {
    name: 'Potion of Water Breathing',
    description:
      'You can breathe underwater for 1 hour after drinking this potion. Its cloudy green fluid smells of the sea and has a jellyfish-like bubble floating in it.',
    expectedMechanics: {
      effects: [
        {
          kind: 'breathes',
          environments: ['water'],
          condition: 'for 1 hour after drinking',
        },
      ],
    },
  },
  {
    name: 'Ring of Elemental Command',
    description:
      'This ring is linked to one of the four Elemental Planes. The GM chooses or randomly determines the linked plane. While wearing this ring, you have advantage on attack rolls against elementals from the linked plane, and they have disadvantage on attack rolls against you. In addition, you have access to properties based on the linked plane. The ring has 5 charges. It regains 1d4 + 1 expended charges daily at dawn. Spells cast from the ring have a save DC of 17. Ring of Air Elemental Command. You can expend 2 of the ring’s charges to cast dominate monster on an air elemental. In addition, when you fall, you descend 60 feet per round and take no damage from falling. You can also speak and understand Auran. If you help slay an air elemental while attuned to the ring, you gain access to the following additional properties: • You have resistance to lightning damage. • You have a flying speed equal to your walking speed and can hover. • You can cast the following spells from the ring, expending the necessary number of charges: chain lightning (3 charges), gust of wind (2 charges), or wind wall (1 charge). Ring of Earth Elemental Command. You can expend 2 of the ring’s charges to cast dominate monster on an earth elemental. In addition, you can move in difficult terrain that is composed of rubble, rocks, or dirt as if it were normal terrain. You can also speak and understand Terran. If you help slay an earth elemental while attuned to the ring, you gain access to the following additional properties: • You have resistance to acid damage. • You can move through solid earth or rock as if those areas were difficult terrain. If you end your turn there, you are shunted out to the nearest unoccupied space you last occupied. • You can cast the following spells from the ring, expending the necessary number of charges: stone shape (2 charges), stoneskin (3 charges), or wall of stone (3 charges). Ring of Fire Elemental Command. You can expend 2 of the ring’s charges to cast dominate monster on a fire elemental. In addition, you have resistance to fire damage. You can also speak and understand Ignan. If you help slay a fire elemental while attuned to the ring, you gain access to the following additional properties: • You are immune to fire damage. • You can cast the following spells from the ring, expending the necessary number of charges: burning hands (1 charge), fireball (2 charges), and wall of fire (3 charges). Ring of Water Elemental Command. You can expend 2 of the ring’s charges to cast dominate monster on a water elemental. In addition, you can stand on and walk across liquid surfaces as if they were solid ground. You can also speak and understand Aquan. If you help slay a water elemental while attuned to the ring, you gain access to the following additional properties: • You can breathe underwater and have a swimming speed equal to your walking speed. • You can cast the following spells from the ring, expending the necessary number of charges: create or destroy water (1 charge), control water (3 charges), ice storm (2 charges), or wall of ice (3 charges).',
    expectedMechanics: undefined,
  },
  {
    name: 'Ring of Feather Falling',
    description:
      'When you fall while wearing this ring, you descend 60 feet per round and take no damage from falling.',
    expectedMechanics: {
      effects: [
        {
          kind: 'slowFall',
          descentFeetPerRound: 60,
          noFallingDamageOnLanding: true,
        },
      ],
    },
  },
  {
    name: 'Ring of Free Action',
    description:
      'While you wear this ring, difficult terrain doesn’t cost you extra movement. In addition, magic can neither reduce your speed nor cause you to be paralyzed or restrained.',
    expectedMechanics: {
      effects: [
        {
          kind: 'ignoreDifficultTerrain',
          terrain: ['all'],
        },
      ],
    },
  },
  {
    name: 'Ring of Regeneration',
    description:
      'While wearing this ring, you regain 1d6 hit points every 10 minutes, provided that you have at least 1 hit point. If you lose a body part, the ring causes the missing part to regrow and return to full functionality after 1d6 + 1 days if you have at least 1 hit point the whole time.',
    expectedMechanics: {
      effects: [
        {
          kind: 'regeneration',
          hitDice: '1d6',
          timing: 'every-10-minutes',
          condition: 'if it has at least 1 hit point',
          limbRegrowthDays: '1d6 + 1',
          limbRegrowthCondition:
            'if you have at least 1 hit point the whole time',
        },
      ],
    },
  },
  {
    name: 'Ring of Swimming',
    description:
      'You have a swimming speed of 40 feet while wearing this ring.',
    expectedMechanics: {
      effects: [
        {
          kind: 'speedSet',
          mode: 'swim',
          value: 40,
        },
      ],
    },
  },
  {
    name: 'Ring of Warmth',
    description:
      'While wearing this ring, you have resistance to cold damage. In addition, you and everything you wear and carry are unharmed by temperatures as low as −50 degrees Fahrenheit.',
    expectedMechanics: {
      effects: [
        {
          kind: 'temperatureTolerance',
          minimumFahrenheit: -50,
        },
      ],
    },
  },
  {
    name: 'Ring of Water Walking',
    description:
      'While wearing this ring, you can stand on and move across any liquid surface as if it were solid ground.',
    expectedMechanics: {
      effects: [
        {
          kind: 'walkOnLiquids',
        },
      ],
    },
  },
  {
    name: 'Ring of X-ray Vision',
    description:
      'While wearing this ring, you can use an action to speak its command word. When you do so, you can see into and through solid matter for 1 minute. This vision has a radius of 30 feet. To you, solid objects within that radius appear transparent and don’t prevent light from passing through them. The vision can penetrate 1 foot of stone, 1 inch of common metal, or up to 3 feet of wood or dirt. Thicker substances block the vision, as does a thin sheet of lead. Whenever you use the ring again before taking a long rest, you must succeed on a DC 15 Constitution saving throw or gain one level of exhaustion.',
    expectedMechanics: {
      effects: [
        {
          kind: 'sense',
          sense: 'x-ray-vision',
          rangeFeet: 30,
          durationMinutes: 1,
          detects:
            'penetrates up to 1 foot of stone, 1 inch of common metal, or up to 3 feet of wood or dirt; blocked by thicker substances or a thin sheet of lead',
        },
      ],
    },
  },
  {
    name: 'Robe of Eyes',
    description:
      'This robe is adorned with eyelike patterns. While you wear the robe, you gain the following benefits: • The robe lets you see in all directions, and you have advantage on Wisdom (Perception) checks that rely on sight. • You have darkvision out to a range of 120 feet. • You can see invisible creatures and objects, as well as see into the Ethereal Plane, out to a range of 120 feet. The eyes on the robe can’t be closed or averted. Although you can close or avert your own eyes, you are never considered to be doing so while wearing this robe. A light spell cast on the robe or a daylight spell cast within 5 feet of the robe causes you to be blinded for 1 minute. At the end of each of your turns, you can make a Constitution saving throw (DC 11 for light or DC 15 for daylight), ending the blindness on a success.',
    expectedMechanics: {
      effects: [
        {
          kind: 'sense',
          sense: 'all-around-vision',
        },
        {
          kind: 'sense',
          sense: 'darkvision',
          rangeFeet: 120,
        },
        {
          kind: 'sense',
          sense: 'see-invisible-and-ethereal',
          rangeFeet: 120,
        },
      ],
    },
  },
  {
    name: 'Robe of the Archmagi',
    description:
      'This elegant garment is made from exquisite cloth of white, gray, or black and adorned with silvery runes. The robe’s color corresponds to the alignment for which the item was created. A white robe was made for good, gray for neutral, and black for evil. You can’t attune to a robe of the archmagi that doesn’t correspond to your alignment. You gain these benefits while wearing the robe: • If you aren’t wearing armor, your base Armor Class is 15 + your Dexterity modifier. • You have advantage on saving throws against spells and other magical effects. • Your spell save DC and spell attack bonus each increase by 2.',
    expectedMechanics: {
      effects: [
        {
          kind: 'acFormula',
          base: 15,
          abilities: ['dexterity'],
          condition: 'if you aren’t wearing armor',
        },
      ],
    },
  },
  {
    name: 'Rod of Alertness',
    description:
      'This rod has a flanged head and the following properties. Alertness. While holding the rod, you have advantage on Wisdom (Perception) checks and on rolls for initiative. Spells. While holding the rod, you can use an action to cast one of the following spells from it: detect evil and good, detect magic, detect poison and disease, or see invisibility. Protective Aura. As an action, you can plant the haft end of the rod in the ground, whereupon the rod’s head sheds bright light in a 60-foot radius and dim light for an additional 60 feet. While in that bright light, you and any creature that is friendly to you gain a +1 bonus to AC and saving throws and can sense the location of any invisible hostile creature that is also in the bright light. The rod’s head stops glowing and the effect ends after 10 minutes, or when a creature uses an action to pull the rod from the ground. This property can’t be used again until the next dawn.',
    expectedMechanics: {
      effects: [
        {
          kind: 'sense',
          sense: 'invisible-hostile-location',
          rangeFeet: 60,
          condition:
            'while standing in the planted rod’s bright light (10-minute duration, once per dawn)',
        },
      ],
    },
  },
  {
    name: 'Rod of Lordly Might',
    description:
      'This rod has a flanged head, and it functions as a magic mace that grants a +3 bonus to attack and damage rolls made with it. The rod has properties associated with six different buttons that are set in a row along the haft. It has three other properties as well, detailed below. Six Buttons. You can press one of the rod’s six buttons as a bonus action. A button’s effect lasts until you push a different button or until you push the same button again, which causes the rod to revert to its normal form. If you press button 1, the rod becomes a flame tongue, as a fiery blade sprouts from the end opposite the rod’s flanged head. If you press button 2, the rod’s flanged head folds down and two crescent-shaped blades spring out, transforming the rod into a magic battleaxe that grants a +3 bonus to attack and damage rolls made with it. If you press button 3, the rod’s flanged head folds down, a spear point springs from the rod’s tip, and the rod’s handle lengthens into a 6-foot haft, transforming the rod into a magic spear that grants a +3 bonus to attack and damage rolls made with it. If you press button 4, the rod transforms into a climbing pole up to 50 feet long, as you specify. In surfaces as hard as granite, a spike at the bottom and three hooks at the top anchor the pole. Horizontal bars 3 inches long fold out from the sides, 1 foot apart, forming a ladder. The pole can bear up to 4,000 pounds. More weight or lack of solid anchoring causes the rod to revert to its normal form. If you press button 5, the rod transforms into a handheld battering ram and grants its user a +10 bonus to Strength checks made to break through doors, barricades, and other barriers. If you press button 6, the rod assumes or remains in its normal form and indicates magnetic north. (Nothing happens if this function of the rod is used in a location that has no magnetic north.) The rod also gives you knowledge of your approximate depth beneath the ground or your height above it. Drain Life. When you hit a creature with a melee attack using the rod, you can force the target to make a DC 17 Constitution saving throw. On a failure, the target takes an extra 4d6 necrotic damage, and you regain a number of hit points equal to half that necrotic damage. This property can’t be used again until the next dawn. Paralyze. When you hit a creature with a melee attack using the rod, you can force the target to make a DC 17 Strength saving throw. On a failure, the target is paralyzed for 1 minute. The target can repeat the saving throw at the end of each of its turns, ending the effect on a success. This property can’t be used again until the next dawn. Terrify. While holding the rod, you can use an action to force each creature you can see within 30 feet of you to make a DC 17 Wisdom saving throw. On a failure, a target is frightened of you for 1 minute. A frightened target can repeat the saving throw at the end of each of its turns, ending the effect on itself on a success. This property can’t be used again until the next dawn.',
    expectedMechanics: {
      effects: [
        {
          kind: 'sense',
          sense: 'magnetic-north-and-depth',
          condition:
            'the magnetic-north function does nothing in a location with no magnetic north',
        },
      ],
    },
  },
  {
    name: 'Slippers of Spider Climbing',
    description:
      'While you wear these light shoes, you can move up, down, and across vertical surfaces and upside down along ceilings, while leaving your hands free. You have a climbing speed equal to your walking speed. However, the slippers don’t allow you to move this way on a slippery surface, such as one covered by ice or oil.',
    expectedMechanics: {
      effects: [
        {
          kind: 'speedSet',
          mode: 'climb',
          value: 'walking-speed',
          condition:
            'does not work on a slippery surface, such as one covered by ice or oil',
        },
        {
          kind: 'climbAnywhere',
          condition:
            'does not work on a slippery surface, such as one covered by ice or oil',
        },
      ],
    },
  },
  {
    name: 'Sun Blade',
    description:
      'This item appears to be a longsword hilt. While grasping the hilt, you can use a bonus action to cause a blade of pure radiance to spring into existence, or make the blade disappear. While the blade exists, this magic longsword has the finesse property. If you are proficient with shortswords or longswords, you are proficient with the sun blade. You gain a +2 bonus to attack and damage rolls made with this weapon, which deals radiant damage instead of slashing damage. When you hit an undead with it, that target takes an extra 1d8 radiant damage. The sword’s luminous blade emits bright light in a 15-foot radius and dim light for an additional 15 feet. The light is sunlight. While the blade persists, you can use an action to expand or reduce its radius of bright and dim light by 5 feet each, to a maximum of 30 feet each or a minimum of 10 feet each.',
    expectedMechanics: {
      effects: [
        {
          kind: 'proficiency',
          grant: 'the sun blade',
          condition: 'if you are proficient with shortswords or longswords',
        },
      ],
    },
  },
  {
    name: 'Tome of Clear Thought',
    description:
      'This book contains memory and logic exercises, and its words are charged with magic. If you spend 48 hours over a period of 6 days or fewer studying the book’s contents and practicing its guidelines, your Intelligence score increases by 2, as does your maximum for that score. The manual then loses its magic, but regains it in a century.',
    expectedMechanics: {
      effects: [
        {
          kind: 'abilityScoreIncrease',
          abilities: ['intelligence'],
          amount: 2,
          alsoIncreasesMaximum: true,
        },
      ],
    },
  },
  {
    name: 'Tome of Leadership and Influence',
    description:
      'This book contains guidelines for influencing and charming others, and its words are charged with magic. If you spend 48 hours over a period of 6 days or fewer studying the book’s contents and practicing its guidelines, your Charisma score increases by 2, as does your maximum for that score. The manual then loses its magic, but regains it in a century.',
    expectedMechanics: {
      effects: [
        {
          kind: 'abilityScoreIncrease',
          abilities: ['charisma'],
          amount: 2,
          alsoIncreasesMaximum: true,
        },
      ],
    },
  },
  {
    name: 'Tome of Understanding',
    description:
      'This book contains intuition and insight exercises, and its words are charged with magic. If you spend 48 hours over a period of 6 days or fewer studying the book’s contents and practicing its guidelines, your Wisdom score increases by 2, as does your maximum for that score. The manual then loses its magic, but regains it in a century.',
    expectedMechanics: {
      effects: [
        {
          kind: 'abilityScoreIncrease',
          abilities: ['wisdom'],
          amount: 2,
          alsoIncreasesMaximum: true,
        },
      ],
    },
  },
  {
    name: 'Wand of Enemy Detection',
    description:
      'This wand has 7 charges. While holding it, you can use an action and expend 1 charge to speak its command word. For the next minute, you know the direction of the nearest creature hostile to you within 60 feet, but not its distance from you. The wand can sense the presence of hostile creatures that are ethereal, invisible, disguised, or hidden, as well as those in plain sight. The effect ends if you stop holding the wand. The wand regains 1d6 + 1 expended charges daily at dawn. If you expend the wand’s last charge, roll a d20. On a 1, the wand crumbles into ashes and is destroyed.',
    expectedMechanics: {
      effects: [
        {
          kind: 'sense',
          sense: 'nearest-hostile-direction',
          rangeFeet: 60,
          durationMinutes: 1,
          detects:
            'ethereal, invisible, disguised, or hidden hostile creatures, as well as those in plain sight (direction only, not distance)',
          condition: 'ends if you stop holding the wand',
        },
      ],
    },
  },
  {
    name: 'Wand of Secrets',
    description:
      'The wand has 3 charges. While holding it, you can use an action to expend 1 of its charges, and if a secret door or trap is within 30 feet of you, the wand pulses and points at the one nearest to you. The wand regains 1d3 expended charges daily at dawn.',
    expectedMechanics: {
      effects: [
        {
          kind: 'sense',
          sense: 'nearest-secret-door-or-trap',
          rangeFeet: 30,
        },
      ],
    },
  },
  {
    name: 'Winged Boots',
    description:
      'While you wear these boots, you have a flying speed equal to your walking speed. You can use the boots to fly for up to 4 hours, all at once or in several shorter flights, each one using a minimum of 1 minute from the duration. If you are flying when the duration expires, you descend at a rate of 30 feet per round until you land. The boots regain 2 hours of flying capability for every 12 hours they aren’t in use.',
    expectedMechanics: {
      effects: [
        {
          kind: 'speedSet',
          mode: 'fly',
          value: 'walking-speed',
        },
        {
          kind: 'slowFall',
          descentFeetPerRound: 30,
          condition:
            'if still flying when the boots’ flight duration expires, until you land',
        },
      ],
    },
  },
  {
    name: 'Wings of Flying',
    description:
      'While wearing this cloak, you can use an action to speak its command word. This turns the cloak into a pair of bat wings or bird wings on your back for 1 hour or until you repeat the command word as an action. The wings give you a flying speed of 60 feet. When they disappear, you can’t use them again for 1d12 hours.',
    expectedMechanics: {
      effects: [
        {
          kind: 'speedSet',
          mode: 'fly',
          value: 60,
          condition:
            'for 1 hour or until the command word is repeated; a 1d12-hour cooldown applies afterward',
        },
      ],
    },
  },
];

function item(name: string, description: string): MagicItemExtraction {
  return {
    name,
    itemType: 'Wondrous item',
    rarity: 'rare',
    requiresAttunement: false,
    description,
    sourcePage: 1,
  };
}

function withoutEffectIds(
  mechanics: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
  if (mechanics === undefined) return undefined;
  return {
    ...mechanics,
    effects: (mechanics.effects as readonly Record<string, unknown>[]).map(
      ({ id: _id, ...effect }) => effect,
    ),
  };
}

describe('deriveMagicItemMechanics exhaustive coverage (eshyra-o9bd.18.7.7.5)', () => {
  it('the fixture has no duplicate item names', () => {
    const names = COVERAGE_CASES.map((c) => c.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it.each(COVERAGE_CASES)('projects the exact reviewed mechanics for $name', ({
    name,
    description,
    expectedMechanics,
  }) => {
    const mechanics = deriveMagicItemMechanics(item(name, description));
    expect(withoutEffectIds(mechanics)).toEqual(expectedMechanics);
  });

  it('covers exactly the 58 uniquely M2/M3-tagged items (23 M2 + 38 M3 rows, 3 tagged both)', () => {
    expect(COVERAGE_CASES).toHaveLength(58);
  });
});
