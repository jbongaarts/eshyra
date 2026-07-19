/**
 * Source-grounded C2 projection for static/common numeric combat modifiers and
 * defenses. Activated payloads, advantage/disadvantage, reactions, spell
 * grants, and activation/state machines are deliberately owned elsewhere.
 */
import type { MagicItemEffect } from '../../../src/rules/magicItemMechanics.js';
import type {
  EngineHookBinding,
  MagicItemFamilyProjection,
} from './magicItemCompiler.js';
import type { MagicItemExtraction, MagicItemVariant } from './types.js';

const F8 = [
  { engine: 'F8', hook: 'derived combat modifier application' },
] as const;
const F9 = [
  { engine: 'F9', hook: 'damage resistance, vulnerability, and rider math' },
] as const;
const F8_F9 = [...F8, ...F9] as const;

interface EffectSpec {
  readonly id: string;
  readonly phrase: string;
  readonly effect: Omit<MagicItemEffect, 'id'>;
  readonly hooks: readonly EngineHookBinding[];
}

const effect = (
  id: string,
  phrase: string,
  value: Omit<MagicItemEffect, 'id'>,
  hooks: readonly EngineHookBinding[],
): EffectSpec => ({ id: `c2-static-${id}`, phrase, effect: value, hooks });

const bonus = (
  id: string,
  phrase: string,
  kind: string,
  amount: number,
  appliesTo?: string,
): EffectSpec =>
  effect(
    id,
    phrase,
    { kind, amount, ...(appliesTo === undefined ? {} : { appliesTo }) },
    F8,
  );

const resistance = (
  id: string,
  phrase: string,
  types: string | readonly string[],
  extra: Readonly<Record<string, unknown>> = {},
): EffectSpec =>
  effect(id, phrase, { kind: 'damageResistance', types, ...extra }, F9);

const rider = (
  id: string,
  phrase: string,
  dice: string,
  damageType: string,
  extra: Readonly<Record<string, unknown>> = {},
): EffectSpec =>
  effect(
    id,
    phrase,
    {
      kind: 'extraDamage',
      dice,
      ...(damageType === 'weapon'
        ? { damageType: 'weapon-type' }
        : { type: damageType }),
      ...extra,
    },
    F8_F9,
  );

const RARITY_BONUS = {
  amountByRarity: [
    { rarity: 'uncommon', amount: 1 },
    { rarity: 'rare', amount: 2 },
    { rarity: 'very rare', amount: 3 },
  ],
} as const;

const ARMOR_RARITY_BONUS = {
  amountByRarity: [
    { rarity: 'rare', amount: 1 },
    { rarity: 'very rare', amount: 2 },
    { rarity: 'legendary', amount: 3 },
  ],
} as const;

const ITEM_SPECS: ReadonlyMap<string, readonly EffectSpec[]> = new Map([
  [
    'Adamantine Armor',
    [
      effect(
        'adamantine-critical-normalization',
        'any critical hit against you becomes a normal hit',
        {
          kind: 'triggeredEffect',
          trigger: 'critical hit against wearer',
          result: 'the critical hit becomes a normal hit',
        },
        F8,
      ),
    ],
  ],
  [
    'Ammunition, +1, +2, or +3',
    [
      effect(
        'ammunition-rarity-attack-damage',
        'bonus to attack and damage rolls',
        {
          kind: 'attackAndDamageBonus',
          ...RARITY_BONUS,
          appliesTo: 'this piece of magic ammunition',
        },
        F8,
      ),
    ],
  ],
  [
    'Armor, +1, +2, or +3',
    [
      effect(
        'armor-rarity-ac',
        'bonus to AC while wearing this armor',
        { kind: 'acBonus', ...ARMOR_RARITY_BONUS },
        F8,
      ),
    ],
  ],
  [
    'Armor of Invulnerability',
    [
      resistance(
        'armor-invulnerability-resistance',
        'resistance to nonmagical damage',
        'all',
        { excludes: ['damage from magical weapons'] },
      ),
    ],
  ],
  [
    'Armor of Resistance',
    [
      resistance(
        'armor-resistance-table',
        'resistance to one type of damage',
        [
          'acid',
          'cold',
          'fire',
          'force',
          'lightning',
          'necrotic',
          'poison',
          'psychic',
          'radiant',
          'thunder',
        ],
        { tableRef: 'table:armor-of-resistance', selection: 'one' },
      ),
    ],
  ],
  [
    'Armor of Vulnerability',
    [
      resistance(
        'armor-vulnerability-resistance',
        'resistance to one of the following damage types: bludgeoning, piercing, or slashing',
        ['bludgeoning', 'piercing', 'slashing'],
        { selection: 'one' },
      ),
      effect(
        'armor-vulnerability-two-types',
        'vulnerability to two of the three damage types associated with the armor',
        {
          kind: 'damageMultiplier',
          types: ['bludgeoning', 'piercing', 'slashing'],
          selection: 'two',
          excludesSelectedResistance: true,
          multiplier: 2,
        },
        F9,
      ),
    ],
  ],
  [
    'Arrow-Catching Shield',
    [
      bonus(
        'arrow-catching-shield-ac',
        '+2 bonus to AC against ranged attacks',
        'acBonus',
        2,
        'ranged attacks',
      ),
    ],
  ],
  [
    'Belt of Dwarvenkind',
    [
      resistance(
        'belt-dwarvenkind-poison',
        'resistance against poison damage',
        ['poison'],
        { condition: 'wearer is not a dwarf' },
      ),
    ],
  ],
  [
    'Berserker Axe',
    [
      bonus(
        'berserker-axe-attack-damage',
        '+1 bonus to attack and damage rolls made with this magic weapon',
        'attackAndDamageBonus',
        1,
      ),
    ],
  ],
  [
    'Boots of the Winterlands',
    [resistance('winterlands-cold', 'resistance to cold damage', ['cold'])],
  ],
  [
    'Bracers of Archery',
    [
      bonus(
        'bracers-archery-damage',
        '+2 bonus to damage rolls on ranged attacks made with such weapons',
        'damageBonus',
        2,
        'longbows and shortbows',
      ),
    ],
  ],
  [
    'Bracers of Defense',
    [
      bonus(
        'bracers-defense-ac',
        '+2 bonus to AC if you are wearing no armor and using no shield',
        'acBonus',
        2,
        'while wearing no armor and using no shield',
      ),
    ],
  ],
  [
    'Brooch of Shielding',
    [
      resistance('brooch-force', 'resistance to force damage', ['force']),
      effect(
        'brooch-magic-missile-immunity',
        'immunity to damage from the magic missile spell',
        { kind: 'immunity', to: 'damage from spell:magic-missile' },
        F9,
      ),
    ],
  ],
  [
    'Cloak of Arachnida',
    [resistance('arachnida-poison', 'resistance to poison damage', ['poison'])],
  ],
  [
    'Cloak of Protection',
    [
      bonus('cloak-protection-ac', '+1 bonus to AC', 'acBonus', 1),
      bonus(
        'cloak-protection-saves',
        '+1 bonus to AC and saving throws',
        'rollModifier',
        1,
        'saving throws',
      ),
    ],
  ],
  [
    'Dagger of Venom',
    [
      bonus(
        'dagger-venom-attack-damage',
        '+1 bonus to attack and damage rolls made with this magic weapon',
        'attackAndDamageBonus',
        1,
      ),
    ],
  ],
  [
    'Demon Armor',
    [
      bonus('demon-armor-ac', '+1 bonus to AC', 'acBonus', 1),
      effect(
        'demon-armor-unarmed',
        'turn unarmed strikes with your hands into magic weapons that deal slashing damage',
        {
          kind: 'naturalWeaponDamage',
          dice: '1d8',
          typeChoice: ['slashing'],
          magical: true,
          attackAndDamageBonus: 1,
          scope: 'hands',
        },
        F8_F9,
      ),
    ],
  ],
  [
    'Dragon Scale Mail',
    [
      bonus('dragon-scale-mail-ac', '+1 bonus to AC', 'acBonus', 1),
      resistance(
        'dragon-scale-mail-resistance',
        'resistance to one damage type that is determined by the kind of dragon that provided the scales',
        ['acid', 'cold', 'fire', 'lightning', 'poison'],
        { tableRef: 'table:dragon-scale-mail', selectionField: 'dragonType' },
      ),
    ],
  ],
  [
    'Dragon Slayer',
    [
      bonus(
        'dragon-slayer-attack-damage',
        '+1 bonus to attack and damage rolls made with this magic weapon',
        'attackAndDamageBonus',
        1,
      ),
      rider(
        'dragon-slayer-rider',
        'extra 3d6 damage of the weapon’s type',
        '3d6',
        'weapon',
        { targetTypes: ['dragon'] },
      ),
    ],
  ],
  [
    'Dwarven Plate',
    [bonus('dwarven-plate-ac', '+2 bonus to AC', 'acBonus', 2)],
  ],
  [
    'Dwarven Thrower',
    [
      bonus(
        'dwarven-thrower-attack-damage',
        '+3 bonus to attack and damage rolls made with this magic weapon',
        'attackAndDamageBonus',
        3,
      ),
      effect(
        'dwarven-thrower-range',
        'thrown property with a normal range of 20 feet and a long range of 60 feet',
        {
          kind: 'triggeredEffect',
          trigger: 'weapon statistics are derived',
          result:
            'grant thrown property with normal range 20 feet and long range 60 feet',
          property: 'thrown',
          range: { normalFeet: 20, longFeet: 60 },
        },
        F8,
      ),
      rider('dwarven-thrower-rider', 'extra 1d8 damage', '1d8', 'weapon', {
        mode: 'ranged-hit',
        targetTypeOverride: { types: ['giant'], dice: '2d8' },
      }),
    ],
  ],
  ['Elven Chain', [bonus('elven-chain-ac', '+1 bonus to AC', 'acBonus', 1)]],
  [
    'Flame Tongue',
    [
      rider('flame-tongue-rider', 'extra 2d6 fire damage', '2d6', 'fire', {
        condition: 'while the sword is ablaze',
      }),
    ],
  ],
  [
    'Frost Brand',
    [
      rider('frost-brand-rider', 'extra 1d6 cold damage', '1d6', 'cold'),
      resistance('frost-brand-fire', 'resistance to fire damage', ['fire']),
    ],
  ],
  [
    'Giant Slayer',
    [
      bonus(
        'giant-slayer-attack-damage',
        '+1 bonus to attack and damage rolls made with this magic weapon',
        'attackAndDamageBonus',
        1,
      ),
      rider(
        'giant-slayer-rider',
        'extra 2d6 damage of the weapon’s type',
        '2d6',
        'weapon',
        { targetTypes: ['giant'] },
      ),
    ],
  ],
  [
    'Glamoured Studded Leather',
    [bonus('glamoured-leather-ac', '+1 bonus to AC', 'acBonus', 1)],
  ],
  [
    'Hammer of Thunderbolts',
    [
      bonus(
        'hammer-thunderbolts-attack-damage',
        '+1 bonus to attack and damage rolls made with this magic weapon',
        'attackAndDamageBonus',
        1,
      ),
    ],
  ],
  [
    'Helm of Brilliance',
    [
      resistance(
        'helm-brilliance-fire-resistance',
        'resistance to fire damage',
        ['fire'],
        { condition: 'while the helm has at least one ruby' },
      ),
      rider(
        'helm-brilliance-weapon-flame',
        'extra 1d6 fire damage',
        '1d6',
        'fire',
        { condition: 'while the held weapon is blazing' },
      ),
    ],
  ],
  [
    'Holy Avenger',
    [
      bonus(
        'holy-avenger-attack-damage',
        '+3 bonus to attack and damage rolls made with this magic weapon',
        'attackAndDamageBonus',
        3,
      ),
      rider(
        'holy-avenger-rider',
        'extra 2d10 radiant damage',
        '2d10',
        'radiant',
        { targetTypes: ['fiend', 'undead'] },
      ),
    ],
  ],
  [
    'Luck Blade',
    [
      bonus(
        'luck-blade-attack-damage',
        '+1 bonus to attack and damage rolls made with this magic weapon',
        'attackAndDamageBonus',
        1,
      ),
      bonus(
        'luck-blade-saves',
        '+1 bonus to saving throws',
        'rollModifier',
        1,
        'saving throws',
      ),
    ],
  ],
  [
    'Mace of Disruption',
    [
      rider(
        'mace-disruption-rider',
        'extra 2d6 radiant damage',
        '2d6',
        'radiant',
        { targetTypes: ['fiend', 'undead'] },
      ),
    ],
  ],
  [
    'Mace of Smiting',
    [
      bonus(
        'mace-smiting-attack-damage',
        '+1 bonus to attack and damage rolls made with this magic weapon',
        'attackAndDamageBonus',
        1,
      ),
      effect(
        'mace-smiting-construct-bonus',
        'bonus increases to +3 when you use the mace to attack a construct',
        {
          kind: 'attackAndDamageBonus',
          amount: 3,
          replaces: 1,
          targetTypes: ['construct'],
        },
        F8,
      ),
      rider(
        'mace-smiting-critical-rider',
        'extra 2d6 bludgeoning damage',
        '2d6',
        'bludgeoning',
        {
          trigger: 'critical hit',
          targetTypeOverride: { types: ['construct'], dice: '4d6' },
        },
      ),
    ],
  ],
  [
    'Mithral Armor',
    [
      effect(
        'mithral-stealth-override',
        'armor normally imposes disadvantage on Dexterity (Stealth) checks',
        {
          kind: 'triggeredEffect',
          trigger: 'armor statistics are derived',
          result: 'remove Dexterity (Stealth) check disadvantage',
          property: 'stealthDisadvantage',
          value: false,
        },
        F8,
      ),
      effect(
        'mithral-strength-override',
        'has a Strength requirement, the mithral version of the armor doesn’t',
        {
          kind: 'triggeredEffect',
          trigger: 'armor statistics are derived',
          result: 'remove Strength requirement',
          property: 'strengthRequirement',
          value: null,
        },
        F8,
      ),
    ],
  ],
  [
    'Nine Lives Stealer',
    [
      bonus(
        'nine-lives-attack-damage',
        '+2 bonus to attack and damage rolls made with this magic weapon',
        'attackAndDamageBonus',
        2,
      ),
    ],
  ],
  [
    'Oil of Sharpness',
    [
      bonus(
        'oil-sharpness-attack-damage',
        '+3 bonus to attack and damage rolls',
        'attackAndDamageBonus',
        3,
        'coated weapon or ammunition for 1 hour',
      ),
    ],
  ],
  [
    'Periapt of Proof against Poison',
    [
      effect(
        'periapt-poison-immunity',
        'immunity to poison damage',
        { kind: 'immunity', to: 'poison damage', types: ['poison'] },
        F9,
      ),
      effect(
        'periapt-poisoned-immunity',
        'immune to the poisoned condition',
        {
          kind: 'immunity',
          to: 'the poisoned condition',
          conditions: ['poisoned'],
        },
        F8,
      ),
    ],
  ],
  [
    'Potion of Resistance',
    [
      resistance(
        'potion-resistance-table',
        'gain resistance to one type of damage for 1 hour',
        [
          'acid',
          'cold',
          'fire',
          'force',
          'lightning',
          'necrotic',
          'poison',
          'psychic',
          'radiant',
          'thunder',
        ],
        {
          tableRef: 'table:potion-of-resistance',
          selection: 'one',
          duration: { amount: 1, unit: 'hour' },
        },
      ),
    ],
  ],
  [
    'Ring of Protection',
    [
      bonus('ring-protection-ac', '+1 bonus to AC', 'acBonus', 1),
      bonus(
        'ring-protection-saves',
        '+1 bonus to AC and saving throws',
        'rollModifier',
        1,
        'saving throws',
      ),
    ],
  ],
  [
    'Ring of Resistance',
    [
      resistance(
        'ring-resistance-table',
        'resistance to one damage type',
        [
          'acid',
          'cold',
          'fire',
          'force',
          'lightning',
          'necrotic',
          'poison',
          'psychic',
          'radiant',
          'thunder',
        ],
        { tableRef: 'table:ring-of-resistance', selection: 'one' },
      ),
    ],
  ],
  [
    'Ring of Warmth',
    [resistance('ring-warmth-cold', 'resistance to cold damage', ['cold'])],
  ],
  [
    'Robe of Stars',
    [
      bonus(
        'robe-stars-saves',
        '+1 bonus to saving throws',
        'rollModifier',
        1,
        'saving throws',
      ),
    ],
  ],
  [
    'Robe of the Archmagi',
    [
      bonus(
        'archmagi-spell-save-dc',
        'spell save DC and spell attack bonus each increase by 2',
        'dcIncrease',
        2,
        'spell save DC',
      ),
      bonus(
        'archmagi-spell-attack',
        'spell save DC and spell attack bonus each increase by 2',
        'attackRollModifier',
        2,
        'spell attacks',
      ),
    ],
  ],
  [
    'Rod of Lordly Might',
    [
      bonus(
        'lordly-might-attack-damage',
        '+3 bonus to attack and damage rolls made with it',
        'attackAndDamageBonus',
        3,
        'mace, battleaxe, and spear forms',
      ),
    ],
  ],
  [
    'Scimitar of Speed',
    [
      bonus(
        'scimitar-speed-attack-damage',
        '+2 bonus to attack and damage rolls made with this magic weapon',
        'attackAndDamageBonus',
        2,
      ),
    ],
  ],
  [
    'Shield, +1, +2, or +3',
    [
      effect(
        'shield-rarity-ac',
        'bonus to AC determined by the shield’s rarity',
        { kind: 'acBonus', ...RARITY_BONUS, stacksWith: 'normal shield bonus' },
        F8,
      ),
    ],
  ],
  [
    'Shield of Missile Attraction',
    [
      effect(
        'missile-attraction-ranged-weapon',
        'resistance to damage from ranged weapon attacks',
        { kind: 'resistance', to: 'damage from ranged weapon attacks' },
        F9,
      ),
    ],
  ],
  [
    'Staff of Fire',
    [
      resistance('staff-fire-resistance', 'resistance to fire damage', [
        'fire',
      ]),
    ],
  ],
  [
    'Staff of Frost',
    [
      resistance('staff-frost-resistance', 'resistance to cold damage', [
        'cold',
      ]),
    ],
  ],
  [
    'Staff of Power',
    [
      bonus(
        'staff-power-weapon-attack-damage',
        '+2 bonus to attack and damage rolls made with it',
        'attackAndDamageBonus',
        2,
      ),
      bonus('staff-power-ac', '+2 bonus to Armor Class', 'acBonus', 2),
      bonus(
        'staff-power-saves',
        '+2 bonus to Armor Class, saving throws, and spell attack rolls',
        'rollModifier',
        2,
        'saving throws',
      ),
      bonus(
        'staff-power-spell-attacks',
        '+2 bonus to Armor Class, saving throws, and spell attack rolls',
        'attackRollModifier',
        2,
        'spell attacks',
      ),
    ],
  ],
  [
    'Staff of Striking',
    [
      bonus(
        'staff-striking-attack-damage',
        '+3 bonus to attack and damage rolls made with it',
        'attackAndDamageBonus',
        3,
      ),
    ],
  ],
  [
    'Staff of the Magi',
    [
      bonus(
        'staff-magi-weapon-attack-damage',
        '+2 bonus to attack and damage rolls made with it',
        'attackAndDamageBonus',
        2,
      ),
      bonus(
        'staff-magi-spell-attacks',
        '+2 bonus to spell attack rolls',
        'attackRollModifier',
        2,
        'spell attacks',
      ),
    ],
  ],
  [
    'Staff of the Woodlands',
    [
      bonus(
        'staff-woodlands-weapon-attack-damage',
        '+2 bonus to attack and damage rolls made with it',
        'attackAndDamageBonus',
        2,
      ),
      bonus(
        'staff-woodlands-spell-attacks',
        '+2 bonus to spell attack rolls',
        'attackRollModifier',
        2,
        'spell attacks',
      ),
    ],
  ],
  [
    'Stone of Good Luck (Luckstone)',
    [
      bonus(
        'luckstone-saves',
        '+1 bonus to ability checks and saving throws',
        'rollModifier',
        1,
        'saving throws',
      ),
    ],
  ],
  [
    'Sun Blade',
    [
      bonus(
        'sun-blade-attack-damage',
        '+2 bonus to attack and damage rolls made with this weapon',
        'attackAndDamageBonus',
        2,
      ),
      effect(
        'sun-blade-radiant',
        'deals radiant damage instead of slashing damage',
        {
          kind: 'triggeredEffect',
          trigger: 'weapon damage is derived',
          result: 'replace slashing damage with radiant damage',
          property: 'damageType',
          from: 'slashing',
          to: 'radiant',
        },
        F8_F9,
      ),
      effect(
        'sun-blade-finesse',
        'magic longsword has the finesse property',
        {
          kind: 'triggeredEffect',
          trigger: 'weapon statistics are derived',
          result: 'grant finesse property',
          property: 'finesse',
          value: true,
        },
        F8,
      ),
      rider(
        'sun-blade-undead-rider',
        'extra 1d8 radiant damage',
        '1d8',
        'radiant',
        { targetTypes: ['undead'] },
      ),
    ],
  ],
  [
    'Sword of Life Stealing',
    [
      rider(
        'life-stealing-critical-rider',
        'extra 3d6 necrotic damage',
        '3d6',
        'necrotic',
        {
          trigger: 'critical hit',
          excludesTargetTypes: ['construct', 'undead'],
        },
      ),
    ],
  ],
  [
    'Sword of Sharpness',
    [
      effect(
        'sharpness-object-maximize',
        'maximize your weapon damage dice against the target',
        {
          kind: 'triggeredEffect',
          trigger: 'weapon hits an object',
          result: 'maximize the weapon damage dice',
          targets: ['object'],
        },
        F9,
      ),
      rider(
        'sharpness-natural-twenty-rider',
        'extra 4d6 slashing damage',
        '4d6',
        'slashing',
        { trigger: 'attack roll 20' },
      ),
    ],
  ],
  [
    'Talisman of Pure Good',
    [
      bonus(
        'pure-good-spell-attacks',
        '+2 bonus to spell attack rolls',
        'attackRollModifier',
        2,
        'good cleric or paladin wearing the talisman',
      ),
    ],
  ],
  [
    'Talisman of Ultimate Evil',
    [
      bonus(
        'ultimate-evil-spell-attacks',
        '+2 bonus to spell attack rolls',
        'attackRollModifier',
        2,
        'evil cleric or paladin wearing the talisman',
      ),
    ],
  ],
  [
    'Vicious Weapon',
    [
      rider(
        'vicious-natural-twenty-rider',
        'extra 2d6 damage of the weapon’s type',
        '2d6',
        'weapon',
        { trigger: 'attack roll 20' },
      ),
    ],
  ],
  [
    'Vorpal Sword',
    [
      bonus(
        'vorpal-attack-damage',
        '+3 bonus to attack and damage rolls made with this magic weapon',
        'attackAndDamageBonus',
        3,
      ),
      effect(
        'vorpal-ignore-resistance',
        'ignores resistance to slashing damage',
        {
          kind: 'triggeredEffect',
          trigger: 'slashing damage is applied',
          result: 'ignore resistance to slashing damage',
          types: ['slashing'],
        },
        F9,
      ),
      rider(
        'vorpal-no-decapitation-rider',
        'extra 6d8 slashing damage',
        '6d8',
        'slashing',
        {
          trigger: 'attack roll 20',
          condition:
            'target cannot be decapitated or is immune to decapitation',
        },
      ),
    ],
  ],
  [
    'Wand of the War Mage, +1, +2, or +3',
    [
      effect(
        'war-mage-rarity-spell-attack',
        'bonus to spell attack rolls determined by the wand’s rarity',
        {
          kind: 'attackRollModifier',
          ...RARITY_BONUS,
          appliesTo: 'spell attacks',
        },
        F8,
      ),
    ],
  ],
  [
    'Weapon, +1, +2, or +3',
    [
      effect(
        'weapon-rarity-attack-damage',
        'bonus to attack and damage rolls made with this magic weapon',
        { kind: 'attackAndDamageBonus', ...RARITY_BONUS },
        F8,
      ),
    ],
  ],
]);

const VARIANT_SPECS: ReadonlyMap<
  string,
  ReadonlyMap<string, readonly EffectSpec[]>
> = new Map([
  [
    'Ioun Stone',
    new Map([
      [
        'Protection',
        [bonus('ioun-protection-ac', '+1 bonus to AC', 'acBonus', 1)],
      ],
    ]),
  ],
  [
    'Ring of Elemental Command',
    new Map([
      [
        'Ring of Air Elemental Command',
        [
          resistance(
            'elemental-ring-air-lightning',
            'resistance to lightning damage',
            ['lightning'],
            { condition: 'after helping slay an air elemental while attuned' },
          ),
        ],
      ],
      [
        'Ring of Earth Elemental Command',
        [
          resistance(
            'elemental-ring-earth-acid',
            'resistance to acid damage',
            ['acid'],
            {
              condition: 'after helping slay an earth elemental while attuned',
            },
          ),
        ],
      ],
      [
        'Ring of Fire Elemental Command',
        [
          resistance(
            'elemental-ring-fire-resistance',
            'resistance to fire damage',
            ['fire'],
          ),
          effect(
            'elemental-ring-fire-immunity',
            'immune to fire damage',
            {
              kind: 'immunity',
              to: 'fire damage',
              types: ['fire'],
              condition: 'after helping slay a fire elemental while attuned',
            },
            F9,
          ),
        ],
      ],
    ]),
  ],
]);

export const MAGIC_ITEM_STATIC_COMBAT_ITEM_NAMES = Object.freeze([
  ...ITEM_SPECS.keys(),
]);
export const MAGIC_ITEM_STATIC_COMBAT_VARIANT_MEMBERSHIP = Object.freeze(
  [...VARIANT_SPECS].flatMap(([parent, variants]) =>
    [...variants.keys()].map((variant) => `${parent}::${variant}`),
  ),
);

function project(
  name: string,
  text: string,
  specs: readonly EffectSpec[],
): MagicItemFamilyProjection {
  const effects = specs.map((spec) => {
    if (!text.includes(spec.phrase)) {
      throw new Error(
        `magic-item C2 static combat projection: expected source phrase ${JSON.stringify(spec.phrase)} not found in ${JSON.stringify(name)}`,
      );
    }
    return { id: spec.id, ...spec.effect } as MagicItemEffect;
  });
  return {
    family: 'c2-static-combat-modifiers',
    mechanics: { effects },
    clauses: specs.map((spec) => ({
      id: spec.id,
      tag: 'C2' as const,
      representation: { block: 'effects' as const, effectId: spec.id },
      engineHooks: spec.hooks,
    })),
  };
}

export function projectMagicItemStaticCombatModifiers(
  item: MagicItemExtraction,
): MagicItemFamilyProjection | undefined {
  const specs = ITEM_SPECS.get(item.name);
  return specs === undefined
    ? undefined
    : project(item.name, item.description, specs);
}

export function projectMagicItemStaticCombatVariantModifiers(
  parentName: string,
  variant: MagicItemVariant,
): MagicItemFamilyProjection | undefined {
  const specs = VARIANT_SPECS.get(parentName)?.get(variant.name);
  return specs === undefined
    ? undefined
    : project(`${parentName} variant ${variant.name}`, variant.text, specs);
}
