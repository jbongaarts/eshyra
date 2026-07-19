/** Source-grounded residual C2 combat/defense projection. */
import type {
  MagicItemEffect,
  MagicItemOperation,
} from '../../../src/rules/magicItemMechanics.js';
import type {
  EngineHookBinding,
  MagicItemFamilyProjection,
} from './magicItemCompiler.js';
import type { MagicItemExtraction } from './types.js';

const F1 = {
  engine: 'F1',
  hook: 'condition and eligibility relations',
} as const;
const F2 = { engine: 'F2', hook: 'reaction and action economy' } as const;
const F8 = { engine: 'F8', hook: 'roll mode and targeting modifiers' } as const;
const F9 = {
  engine: 'F9',
  hook: 'damage, range, cover, and forced movement',
} as const;

interface ClauseSpec {
  readonly id: string;
  readonly phrase: string;
  readonly effect: MagicItemEffect;
  readonly hooks: readonly EngineHookBinding[];
  readonly operation?: MagicItemOperation;
}

const advantage = (
  id: string,
  phrase: string,
  roll: string,
  condition?: string,
): ClauseSpec => ({
  id,
  phrase,
  effect: {
    kind: 'advantage',
    roll,
    ...(condition === undefined ? {} : { condition }),
  },
  hooks: [F8],
});

const disadvantage = (
  id: string,
  phrase: string,
  roll: string,
  condition?: string,
): ClauseSpec => ({
  id,
  phrase,
  effect: {
    kind: 'rollPenaltyDice',
    mode: 'disadvantage',
    roll,
    ...(condition === undefined ? {} : { condition }),
  },
  hooks: [F8],
});

const immunity = (
  id: string,
  phrase: string,
  to: string,
  extra: Readonly<Record<string, unknown>> = {},
): ClauseSpec => ({
  id,
  phrase,
  effect: { kind: 'immunity', to, ...extra },
  hooks: [F1, F8],
});

const triggered = (
  id: string,
  phrase: string,
  trigger: string,
  result: string,
  extra: Readonly<Record<string, unknown>> = {},
  hooks: readonly EngineHookBinding[] = [F1, F8, F9],
  operation?: MagicItemOperation,
): ClauseSpec => ({
  id,
  phrase,
  effect: { kind: 'triggeredEffect', trigger, result, ...extra },
  hooks,
  ...(operation === undefined ? {} : { operation }),
});

const reaction = (
  id: string,
  phrase: string,
  trigger: string,
  action: string,
  extra: Readonly<Record<string, unknown>> = {},
): ClauseSpec => ({
  id,
  phrase,
  effect: { kind: 'reaction', trigger, action, ...extra },
  hooks: [F2, F8, F9],
  operation: {
    id,
    activation: { cost: 'reaction', trigger },
    effects: [`c2-residual-${id}`],
  },
});

const SPECS: ReadonlyMap<string, readonly ClauseSpec[]> = new Map([
  [
    'Amulet of Proof against Detection and Location',
    [
      immunity(
        'proof-against-divination',
        'can’t be targeted by such magic',
        'divination magic and magical scrying sensors',
      ),
    ],
  ],
  [
    'Arrow-Catching Shield',
    [
      reaction(
        'redirect-ranged-attack',
        'use your reaction to become the target of the attack instead',
        'ranged attack targets a creature within 5 feet of wielder',
        'redirect attack to wielder',
        {
          requirement:
            'wielder is visible to attacker and not behind total cover',
        },
      ),
    ],
  ],
  [
    'Belt of Dwarvenkind',
    [
      advantage(
        'dwarven-persuasion',
        'advantage on Charisma (Persuasion) checks made to interact with dwarves',
        'Charisma (Persuasion) checks',
        'interacting with dwarves',
      ),
      advantage(
        'dwarven-poison-save',
        'advantage on saving throws against poison',
        'saving throws',
        'against poison; wearer is not a dwarf',
      ),
    ],
  ],
  [
    'Boots of Elvenkind',
    [
      advantage(
        'elvenkind-stealth',
        'advantage on Dexterity (Stealth) checks that rely on moving silently',
        'Dexterity (Stealth) checks',
        'rely on moving silently',
      ),
      triggered(
        'silent-steps',
        'steps make no sound',
        'wearer walks',
        'footsteps make no sound',
      ),
    ],
  ],
  [
    'Boots of Speed',
    [
      disadvantage(
        'speed-opportunity-attacks',
        'opportunity attack against you has disadvantage on the attack roll',
        'opportunity attacks against wearer',
        'boots active',
      ),
    ],
  ],
  [
    'Candle of Invocation',
    [
      advantage(
        'invocation-zone',
        'makes attack rolls, saving throws, and ability checks with advantage',
        'attack rolls, saving throws, and ability checks',
        'alignment matches candle and creature is within 30 feet of burning candle',
      ),
    ],
  ],
  [
    'Cloak of Displacement',
    [
      disadvantage(
        'displacement-attacks',
        'disadvantage on attack rolls against you',
        'attack rolls against wearer',
        'displacement active',
      ),
    ],
  ],
  [
    'Cloak of Elvenkind',
    [
      disadvantage(
        'elvenkind-perception',
        'Wisdom (Perception) checks made to see you have disadvantage',
        'Wisdom (Perception) checks',
        'made to see wearer while hood is up',
      ),
      advantage(
        'elvenkind-stealth',
        'advantage on Dexterity (Stealth) checks made to hide',
        'Dexterity (Stealth) checks',
        'hood is up',
      ),
    ],
  ],
  [
    'Cloak of the Bat',
    [
      advantage(
        'bat-stealth',
        'advantage on Dexterity (Stealth) checks',
        'Dexterity (Stealth) checks',
      ),
    ],
  ],
  [
    'Dragon Scale Mail',
    [
      advantage(
        'dragon-presence-save',
        'advantage on saving throws against the Frightful Presence',
        'saving throws',
        'against dragons’ Frightful Presence',
      ),
      advantage(
        'dragon-breath-save',
        'advantage on saving throws against the Frightful Presence and breath weapons of dragons',
        'saving throws',
        'against dragon breath weapons',
      ),
    ],
  ],
  [
    'Dwarven Plate',
    [
      reaction(
        'reduce-forced-movement',
        'use your reaction to reduce the distance you are moved by up to 10 feet',
        'effect moves wearer against wearer’s will along ground',
        'reduce forced ground movement by up to 10 feet',
      ),
    ],
  ],
  [
    'Eyes of Minute Seeing',
    [
      advantage(
        'minute-investigation',
        'advantage on Intelligence (Investigation) checks that rely on sight',
        'Intelligence (Investigation) checks',
        'object or area no more than 1 foot away',
      ),
    ],
  ],
  [
    'Eyes of the Eagle',
    [
      advantage(
        'eagle-perception',
        'advantage on Wisdom (Perception) checks that rely on sight',
        'Wisdom (Perception) checks',
        'rely on sight',
      ),
    ],
  ],
  [
    'Gloves of Missile Snaring',
    [
      reaction(
        'snare-missile',
        'use your reaction to reduce the damage by 1d10 + your Dexterity modifier',
        'wearer is hit by a ranged weapon attack',
        'reduce damage and catch missile if damage becomes 0',
        {
          reductionDice: '1d10',
          addAbilityModifier: 'dexterity',
          catchRequirements: [
            'damage reduced to 0',
            'missile small enough to hold',
            'wearer has a free hand',
          ],
        },
      ),
    ],
  ],
  [
    'Holy Avenger',
    [
      advantage(
        'holy-avenger-aura-saves',
        'advantage on saving throws against spells and other magical effects',
        'saving throws',
        'friendly creature in drawn-sword aura; 10 feet, or 30 feet for level 17+ paladin',
      ),
    ],
  ],
  [
    'Iron Flask',
    [
      advantage(
        'iron-flask-known-save',
        'has advantage on the saving throw',
        'Wisdom saving throw',
        'target has been trapped by this flask before',
      ),
    ],
  ],
  [
    'Mantle of Spell Resistance',
    [
      advantage(
        'spell-resistance-saves',
        'advantage on saving throws against spells',
        'saving throws',
        'against spells',
      ),
    ],
  ],
  [
    'Mirror of Life Trapping',
    [
      advantage(
        'mirror-known-save',
        'saving throw is made with advantage',
        'Charisma saving throw',
        'creature knows mirror’s nature',
      ),
      immunity(
        'mirror-construct-auto-success',
        'constructs succeed on the saving throw automatically',
        'mirror trapping',
        { appliesTo: 'constructs', resolution: 'automatic success' },
      ),
    ],
  ],
  [
    'Necklace of Adaptation',
    [
      advantage(
        'adaptation-gas-saves',
        'advantage on saving throws made against harmful gases and vapors',
        'saving throws',
        'against harmful gases and vapors',
      ),
    ],
  ],
  [
    'Oathbow',
    [
      advantage(
        'oathbow-sworn-enemy-attacks',
        'you have advantage on the roll',
        'attack rolls',
        'target is sworn enemy',
      ),
      triggered(
        'oathbow-ignore-cover-range',
        'target gains no benefit from cover, other than total cover',
        'attack targets sworn enemy',
        'ignore non-total cover and long-range disadvantage',
        {
          ignoresCover: ['half', 'three-quarters'],
          ignoresLongRangeDisadvantage: true,
        },
      ),
    ],
  ],
  [
    'Periapt of Health',
    [
      immunity(
        'disease-immunity',
        'immune to contracting any disease',
        'contracting disease',
      ),
      triggered(
        'suppress-existing-disease',
        'effects of the disease are suppressed',
        'wearer is already infected with a disease',
        'suppress disease effects while periapt is worn',
      ),
    ],
  ],
  [
    'Pipes of the Sewers',
    [
      triggered(
        'rat-indifference',
        'ordinary rats and giant rats are indifferent toward you',
        'rat encounters pipe wearer',
        'ordinary and giant rats begin indifferent unless threatened or commanded otherwise',
      ),
    ],
  ],
  [
    'Potion of Climbing',
    [
      advantage(
        'potion-climb-checks',
        'advantage on Strength (Athletics) checks you make to climb',
        'Strength (Athletics) checks',
        'checks to climb during one-hour duration',
      ),
    ],
  ],
  [
    'Ring of Elemental Command',
    [
      advantage(
        'elemental-command-attacks',
        'advantage on attack rolls against elementals from the linked plane',
        'attack rolls',
        'target elemental is from linked plane',
      ),
      disadvantage(
        'elemental-command-defense',
        'they have disadvantage on attack rolls against you',
        'attack rolls against wearer',
        'attacker elemental is from linked plane',
      ),
    ],
  ],
  [
    'Ring of Free Action',
    [
      immunity(
        'free-action-speed',
        'magic can neither reduce your speed',
        'magical speed reduction',
      ),
      immunity(
        'free-action-paralyzed',
        'cause you to be paralyzed',
        'magically imposed paralyzed condition',
      ),
      immunity(
        'free-action-restrained',
        'cause you to be paralyzed or restrained',
        'magically imposed restrained condition',
      ),
    ],
  ],
  [
    'Ring of Mind Shielding',
    [
      immunity(
        'mind-shield-thoughts',
        'immune to magic that allows other creatures to read your thoughts',
        'magical thought reading',
      ),
      immunity(
        'mind-shield-lie',
        'determine whether you are lying',
        'magical lie detection',
      ),
      immunity(
        'mind-shield-type-alignment',
        'know your alignment, or know your creature type',
        'magical creature-type or alignment detection',
      ),
    ],
  ],
  [
    'Ring of Spell Turning',
    [
      advantage(
        'spell-turning-saves',
        'advantage on saving throws against any spell that targets only you',
        'saving throws',
        'spell targets only wearer',
      ),
    ],
  ],
  [
    'Robe of Eyes',
    [
      advantage(
        'robe-eyes-perception',
        'advantage on Wisdom (Perception) checks that rely on sight',
        'Wisdom (Perception) checks',
        'rely on sight',
      ),
      triggered(
        'robe-eyes-cannot-avert',
        'eyes on the robe can’t be closed or averted',
        'wearer would avert gaze from a creature',
        'cannot avert eyes from creature',
      ),
    ],
  ],
  [
    'Robe of the Archmagi',
    [
      advantage(
        'archmagi-magic-saves',
        'advantage on saving throws against spells and other magical effects',
        'saving throws',
        'against spells and magical effects',
      ),
    ],
  ],
  [
    'Scarab of Protection',
    [
      advantage(
        'scarab-spell-saves',
        'advantage on saving throws against spells',
        'saving throws',
        'against spells',
      ),
    ],
  ],
  [
    'Spellguard Shield',
    [
      advantage(
        'spellguard-saves',
        'advantage on saving throws against spells and other magical effects',
        'saving throws',
        'against spells and magical effects',
      ),
      disadvantage(
        'spellguard-attacks',
        'spell attacks have disadvantage against you',
        'spell attacks against wearer',
      ),
    ],
  ],
  [
    'Staff of the Magi',
    [
      advantage(
        'magi-spell-saves',
        'advantage on saving throws against spells',
        'saving throws',
        'against spells',
      ),
    ],
  ],
  [
    'Wand of Binding',
    [
      {
        ...advantage(
          'assisted-escape-save',
          'gain advantage on a saving throw you make to avoid being paralyzed or restrained',
          'saving throw',
          'avoid paralyzed or restrained',
        ),
        operation: {
          id: 'assisted-escape',
          activation: {
            cost: 'reaction',
            trigger:
              'make a save to avoid paralyzed/restrained or a check to escape grapple',
          },
          effects: [
            'c2-residual-assisted-escape-save',
            'c2-residual-assisted-escape-check',
          ],
        },
      },
      advantage(
        'assisted-escape-check',
        'gain advantage on any check you make to escape a grapple',
        'ability check',
        'escape a grapple',
      ),
    ],
  ],
  [
    'Wand of the War Mage, +1, +2, or +3',
    [
      triggered(
        'ignore-half-cover',
        'ignore half cover when making a spell attack',
        'wearer makes spell attack',
        'ignore target half cover',
      ),
    ],
  ],
  [
    'Amulet of the Planes',
    [
      triggered(
        'plane-shift-check',
        'make a DC 15 Intelligence check',
        'wearer names destination and uses an action',
        'cast plane shift on success; invoke source mishap procedure on failure',
        {
          check: { ability: 'intelligence', dc: 15 },
          spellRef: 'spell:plane-shift',
        },
      ),
    ],
  ],
  [
    'Animated Shield',
    [
      triggered(
        'hands-free-shield',
        'protect you as if you were wielding it',
        'shield is animated',
        'grant normal shield AC without occupying a hand',
      ),
    ],
  ],
  [
    'Arrow of Slaying',
    [
      triggered(
        'slaying-damage',
        'taking an extra 6d10 piercing damage on a failed save, or half as much extra damage on a successful one',
        'slaying arrow hits eligible target',
        'resolve DC 17 Constitution save and extra damage',
        {
          save: { ability: 'constitution', dc: 17 },
          failedSaveDamage: { dice: '6d10', type: 'piercing' },
          successfulSaveDamage: 'half',
        },
        [F1, F8, F9],
        {
          id: 'deal-extra-damage',
          effects: ['c2-residual-slaying-damage'],
        },
      ),
    ],
  ],
  [
    'Bag of Beans',
    [
      triggered(
        'dump-beans-explosion',
        'must make a DC 15 Dexterity saving throw, taking 5d4 fire damage on a failed save',
        'bag contents are dumped on ground',
        'resolve 10-foot-radius explosion',
        {
          radiusFeet: 10,
          save: { ability: 'dexterity', dc: 15 },
          failedSaveDamage: { dice: '5d4', type: 'fire' },
          successfulSaveDamage: 'none',
        },
      ),
    ],
  ],
  [
    'Bead of Force',
    [
      triggered(
        'bead-force-damage',
        'take 5d4 force damage',
        'thrown bead impacts',
        'resolve DC 15 Dexterity save; failed save takes force damage',
        {
          radiusFeet: 10,
          save: { ability: 'dexterity', dc: 15 },
          failedSaveDamage: { dice: '5d4', type: 'force' },
          successfulSaveDamage: 'none',
        },
      ),
    ],
  ],
  [
    'Boots of Levitation',
    [
      triggered(
        'levitate-self',
        'cast the levitate spell on yourself at will',
        'wearer uses an action',
        'cast levitate targeting wearer',
        { spellRef: 'spell:levitate', target: 'self' },
        [F2, F8],
      ),
    ],
  ],
  [
    'Cape of the Mountebank',
    [
      triggered(
        'dimension-door',
        'cast the dimension door spell',
        'wearer uses an action',
        'cast dimension door',
        { spellRef: 'spell:dimension-door' },
        [F2, F8],
      ),
    ],
  ],
  [
    'Circlet of Blasting',
    [
      triggered(
        'scorching-ray',
        'cast the scorching ray spell with it',
        'wearer uses an action',
        'cast scorching ray with +5 attack bonus',
        { spellRef: 'spell:scorching-ray', attackModifier: 5 },
        [F2, F8],
      ),
    ],
  ],
  [
    'Crystal Ball',
    [
      triggered(
        'crystal-scrying',
        'cast the scrying spell (save DC 17)',
        'user uses an action',
        'cast scrying with fixed DC',
        { spellRef: 'spell:scrying', saveDc: 17 },
        [F2, F8],
      ),
    ],
  ],
  [
    'Dancing Sword',
    [
      triggered(
        'dancing-attack-statistics',
        'uses your attack roll and ability score modifier to damage rolls',
        'animated sword attacks',
        'use owner attack roll and damage ability modifier',
      ),
    ],
  ],
  [
    'Decanter of Endless Water',
    [
      triggered(
        'geyser-impact',
        'must succeed on a DC 13 Strength saving throw or take 1d4 bludgeoning damage and fall prone',
        'geyser targets creature',
        'resolve save, damage, and prone rider',
        {
          save: { ability: 'strength', dc: 13 },
          failedSaveDamage: { dice: '1d4', type: 'bludgeoning' },
          failedSaveCondition: 'prone',
          objectPushFeet: 15,
        },
      ),
    ],
  ],
  [
    'Defender',
    [
      triggered(
        'defender-bonus-transfer',
        'transfer some or all of the sword’s bonus to your Armor Class',
        'wielder makes first attack on turn',
        'choose attack/damage bonus transferred to AC until next turn',
        { totalBonus: 3, duration: 'until start of next turn' },
      ),
    ],
  ],
  [
    'Dimensional Shackles',
    [
      immunity(
        'dimensional-movement-block',
        'prevent a creature bound by them from using any method of extradimensional movement',
        'extradimensional movement',
        { examples: ['teleportation', 'travel to another plane'] },
      ),
    ],
  ],
  [
    'Dust of Disappearance',
    [
      triggered(
        'area-invisibility',
        'become invisible for 2d4 minutes',
        'dust is thrown into air',
        'make creatures and objects within 10 feet invisible',
        {
          radiusFeet: 10,
          duration: { amount: '2d4', unit: 'minute' },
          endsOn: ['attack', 'cast-spell'],
        },
      ),
    ],
  ],
  [
    'Dust of Dryness',
    [
      triggered(
        'water-elemental-damage',
        'taking 10d6 necrotic damage on a failed save, or half as much damage on a successful one',
        'pinch is thrown at water-composed elemental',
        'resolve DC 13 Constitution save and necrotic damage',
        {
          save: { ability: 'constitution', dc: 13 },
          failedSaveDamage: { dice: '10d6', type: 'necrotic' },
          successfulSaveDamage: 'half',
        },
      ),
    ],
  ],
  [
    'Dust of Sneezing and Choking',
    [
      triggered(
        'choking-dust',
        'incapacitated and suffocating',
        'dust is thrown into air',
        'on failed DC 15 Constitution save impose incapacitated and suffocating with repeat saves',
        {
          save: { ability: 'constitution', dc: 15 },
          conditions: ['incapacitated', 'suffocating'],
          repeatSave: 'end of each turn while conscious',
          endsOn: ['successful-repeat-save', 'spell:lesser-restoration'],
        },
      ),
    ],
  ],
  [
    'Feather Token',
    [
      triggered(
        'whip-attack',
        'melee spell attack against a creature within 10 feet of the whip, with an attack bonus of +9',
        'whip token attacks',
        'resolve +9 attack for 1d6+5 slashing damage',
        { attackModifier: 9, damage: { dice: '1d6+5', type: 'slashing' } },
      ),
    ],
  ],
  [
    'Figurine of Wondrous Power',
    [
      triggered(
        'goat-terror-aura',
        'succeed on a DC 15 Wisdom saving throw or be frightened of the goat',
        'hostile creature starts turn within 30 feet of goat of terror',
        'resolve frightened save and duration',
        {
          save: { ability: 'wisdom', dc: 15 },
          condition: 'frightened',
          duration: { amount: 1, unit: 'minute' },
        },
      ),
    ],
  ],
  [
    'Gloves of Swimming and Climbing',
    [
      triggered(
        'athletics-bonus',
        '+5 bonus to Strength (Athletics) checks made to climb or swim',
        'wearer makes qualifying check',
        'add +5 to climb or swim Athletics check',
        { amount: 5 },
      ),
    ],
  ],
  [
    'Instant Fortress',
    [
      triggered(
        'fortress-appearance-damage',
        'taking 10d10 bludgeoning damage on a failed save, or half as much damage on a successful one',
        'fortress appears',
        'resolve DC 15 Dexterity save, damage, and push',
        {
          save: { ability: 'dexterity', dc: 15 },
          failedSaveDamage: { dice: '10d10', type: 'bludgeoning' },
          successfulSaveDamage: 'half',
          pushToNearestUnoccupied: true,
        },
      ),
    ],
  ],
  [
    'Ioun Stone',
    [
      immunity(
        'awareness-no-surprise',
        'can’t be surprised',
        'surprised condition',
        { variant: 'Awareness' },
      ),
    ],
  ],
  [
    'Iron Bands of Binding',
    [
      triggered(
        'bands-ranged-attack',
        'Make a ranged attack roll with an attack bonus equal to your Dexterity modifier plus your proficiency bonus',
        'user attacks with bands',
        'derive ranged attack bonus from Dexterity modifier plus proficiency bonus',
        {
          attackModifierFormula: 'dexterity-modifier + proficiency-bonus',
          rangeFeet: 60,
        },
      ),
    ],
  ],
  [
    'Manual of Golems',
    [
      triggered(
        'unqualified-reading-damage',
        'takes 6d6 psychic damage',
        'unqualified creature reads manual',
        'deal psychic damage',
        { damage: { dice: '6d6', type: 'psychic' } },
      ),
    ],
  ],
  [
    'Oil of Etherealness',
    [
      triggered(
        'etherealness-effect',
        'gains the effect of the etherealness spell for 1 hour',
        'oil application completes',
        'apply etherealness for one hour',
        {
          spellRef: 'spell:etherealness',
          duration: { amount: 1, unit: 'hour' },
        },
      ),
    ],
  ],
  [
    'Oil of Slipperiness',
    [
      triggered(
        'freedom-of-movement-effect',
        'gains the effect of a freedom of movement spell for 8 hours',
        'oil application completes',
        'apply freedom of movement for eight hours',
        {
          spellRef: 'spell:freedom-of-movement',
          duration: { amount: 8, unit: 'hour' },
        },
      ),
      triggered(
        'grease-effect',
        'duplicating the effect of the grease spell in that area for 8 hours',
        'oil is poured on ground',
        'apply grease to 10-foot square for eight hours',
        { spellRef: 'spell:grease', duration: { amount: 8, unit: 'hour' } },
      ),
    ],
  ],
  [
    'Philter of Love',
    [
      triggered(
        'love-charm',
        'become charmed by that creature for 1 hour',
        'drinker next sees creature within 10 minutes',
        'impose charmed for one hour',
        {
          condition: 'charmed',
          triggerWindow: { amount: 10, unit: 'minute' },
          duration: { amount: 1, unit: 'hour' },
        },
      ),
    ],
  ],
  [
    'Plate Armor of Etherealness',
    [
      triggered(
        'etherealness',
        'gain the effect of the etherealness spell, which last for 10 minutes',
        'wearer uses an action',
        'apply etherealness for ten minutes',
        {
          spellRef: 'spell:etherealness',
          duration: { amount: 10, unit: 'minute' },
        },
      ),
    ],
  ],
  [
    'Potion of Invisibility',
    [
      triggered(
        'invisibility',
        'become invisible for 1 hour',
        'potion is drunk',
        'apply invisibility to drinker and worn/carried objects',
        {
          duration: { amount: 1, unit: 'hour' },
          endsOn: ['attack', 'cast-spell'],
        },
      ),
    ],
  ],
  [
    'Restorative Ointment',
    [
      triggered(
        'ointment-restoration',
        'regains 2d8 + 2 hit points, ceases to be poisoned, and is cured of any disease',
        'ointment dose is swallowed or applied',
        'heal and end poison and disease',
        { healing: '2d8+2', ends: ['poisoned', 'disease'] },
      ),
    ],
  ],
  [
    'Ring of Invisibility',
    [
      triggered(
        'invisibility',
        'turn invisible as an action',
        'wearer uses an action',
        'make wearer and worn/carried objects invisible until attack, spell cast, or deactivation',
        { endsOn: ['attack', 'cast-spell', 'bonus-action-deactivate'] },
      ),
    ],
  ],
  [
    'Ring of X-ray Vision',
    [
      triggered(
        'xray-exhaustion',
        'succeed on a DC 15 Constitution saving throw or gain one level of exhaustion',
        'ring is reused before long rest',
        'resolve save and exhaustion',
        {
          save: { ability: 'constitution', dc: 15 },
          failedSaveCondition: 'one exhaustion level',
        },
      ),
    ],
  ],
  [
    'Rod of Rulership',
    [
      triggered(
        'rulership-charm',
        'must succeed on a DC 15 Wisdom saving throw or be charmed by you for 8 hours',
        'rod command is issued',
        'resolve charm save and breaking conditions',
        {
          save: { ability: 'wisdom', dc: 15 },
          condition: 'charmed',
          duration: { amount: 8, unit: 'hour' },
          endsOn: [
            'harmed-by-user-or-companions',
            'command-contrary-to-nature',
          ],
        },
      ),
    ],
  ],
  [
    'Sword of Wounding',
    [
      triggered(
        'apply-wound',
        'Once per turn, when you hit a creature with an attack using this magic weapon',
        'weapon attack hits',
        'apply one wound counter once per turn',
        { maximumApplicationsPerTurn: 1 },
      ),
    ],
  ],
  [
    'Talisman of the Sphere',
    [
      triggered(
        'enhanced-sphere-levitation',
        'levitate it 10 feet plus a number of additional feet equal to 10 × your Intelligence modifier',
        'wearer controls sphere of annihilation',
        'increase sphere movement using source formula',
        { additionalFeetFormula: '10 + 10 × intelligence-modifier' },
      ),
    ],
  ],
]);

export const MAGIC_ITEM_RESIDUAL_COMBAT_NAMES = Object.freeze([
  ...SPECS.keys(),
]);
export const MAGIC_ITEM_RESIDUAL_COMBAT_CLAUSE_IDS = Object.freeze(
  [...SPECS].flatMap(([name, clauses]) =>
    clauses.map(({ id }) => `${name}::${id}`),
  ),
);

export function projectMagicItemResidualCombatEffects(
  item: MagicItemExtraction,
): MagicItemFamilyProjection | undefined {
  const specs = SPECS.get(item.name);
  if (specs === undefined) return undefined;
  for (const spec of specs) {
    if (!item.description.includes(spec.phrase)) {
      throw new Error(
        `magic-item C2 residual combat projection: expected source phrase ${JSON.stringify(spec.phrase)} not found in ${JSON.stringify(item.name)}`,
      );
    }
  }
  const effects = specs.map(({ id, effect }) => ({
    id: `c2-residual-${id}`,
    ...effect,
  }));
  const operations = specs.flatMap(({ operation }) =>
    operation === undefined ? [] : [operation],
  );
  return {
    family: 'c2-residual-combat-and-defense',
    mechanics: {
      effects,
      ...(operations.length === 0 ? {} : { operations }),
    },
    clauses: specs.map(({ id, hooks }) => ({
      id: `c2-residual-${id}`,
      tag: 'C2' as const,
      representation: {
        block: 'effects' as const,
        effectId: `c2-residual-${id}`,
      },
      engineHooks: hooks,
    })),
  };
}
