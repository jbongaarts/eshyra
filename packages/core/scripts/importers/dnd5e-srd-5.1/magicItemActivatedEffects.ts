/**
 * Source-grounded C2 spell grants and activated save/DC payloads.
 *
 * C1/M1 own depletion and recharge.  This family deliberately reuses their
 * operation IDs so aggregation joins the activation payload to the same use.
 * Static modifiers, reactions, roll manipulation, and device state machines
 * are outside this bounded family.
 */

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
const F2 = { engine: 'F2', hook: 'action-economy activation' } as const;
const F3 = { engine: 'F3', hook: 'concentration lifecycle' } as const;
const F4 = { engine: 'F4', hook: 'canonical spell execution' } as const;
const F6 = {
  engine: 'F6',
  hook: 'hit points and condition lifecycle',
} as const;
const F8 = {
  engine: 'F8',
  hook: 'save DC and spell attack resolution',
} as const;
const F9 = {
  engine: 'F9',
  hook: 'damage, saving throws, and targeting',
} as const;

type Activation = NonNullable<MagicItemOperation['activation']>;

interface EffectSpec {
  readonly id: string;
  readonly operationId: string;
  readonly effect: MagicItemEffect;
  readonly activation?: Activation;
  readonly hooks: readonly EngineHookBinding[];
}

interface ItemSpec {
  readonly sourcePhrases: readonly string[];
  readonly effects: readonly EffectSpec[];
}

const action = (requirement?: string, target?: string): Activation => ({
  cost: 'action',
  ...(requirement === undefined ? {} : { requirement }),
  ...(target === undefined ? {} : { target }),
});

const spell = (
  operationId: string,
  spellRef: string,
  options: Readonly<Record<string, unknown>> = {},
  activation: Activation | null = action(),
): EffectSpec => ({
  id: `c2-${operationId}`,
  operationId,
  ...(activation === null ? {} : { activation }),
  effect: { kind: 'castSpell', spellRef, ...options },
  hooks: [F2, F4, F8, ...(options.concentrationRequired === true ? [F3] : [])],
});

const payload = (
  operationId: string,
  kind: string,
  value: Readonly<Record<string, unknown>>,
  hooks: readonly EngineHookBinding[] = [F2, F6, F8, F9],
  activation: Activation = action(),
): EffectSpec => ({
  id: `c2-${operationId}-payload`,
  operationId,
  activation,
  effect: { kind, ...value },
  hooks,
});

const ownDc = { saveDc: 'owner-spell-save-dc' } as const;
const fixedDc = (saveDc: number) => ({ saveDc });
const noConcentration = { concentrationRequired: false } as const;

const SPECS: ReadonlyMap<string, ItemSpec> = new Map([
  [
    'Cloak of Arachnida',
    {
      sourcePhrases: [
        'use an action to cast the web spell (save DC 13)',
        'web created by the spell fills twice its normal area',
      ],
      effects: [
        spell(
          'cast-web',
          'spell:web',
          { ...fixedDc(13), areaMultiplier: 2 },
          action('wearing the cloak'),
        ),
      ],
    },
  ],
  [
    'Dagger of Venom',
    {
      sourcePhrases: [
        'use an action to cause thick, black poison to coat the blade',
        'poison remains for 1 minute or until an attack using this weapon hits a creature',
        'DC 15 Constitution saving throw or take 2d10 poison damage and become poisoned for 1 minute',
      ],
      effects: [
        payload(
          'coat-blade',
          'triggeredEffect',
          {
            trigger: 'an attack using the coated dagger hits a creature',
            save: { ability: 'constitution', dc: 15 },
            failedSaveDamage: { dice: '2d10', type: 'poison' },
            failedSaveCondition: 'poisoned',
            conditionDuration: { amount: 1, unit: 'minute' },
          },
          [F6, F8, F9],
          action('dagger is coated'),
        ),
      ],
    },
  ],
  [
    'Armor of Invulnerability',
    {
      sourcePhrases: [
        'use an action to make yourself immune to nonmagical damage for 10 minutes',
        'until you are no longer wearing the armor',
      ],
      effects: [
        payload(
          'activate-immunity',
          'immunity',
          {
            to: 'nonmagical damage',
            duration: { amount: 10, unit: 'minute' },
            endsOn: ['armor-removed'],
          },
          [F2, F6, F9],
          action('wearing the armor', 'self'),
        ),
      ],
    },
  ],
  [
    'Cubic Gate',
    {
      sourcePhrases: [
        'cast the gate spell with it',
        'cast the plane shift spell (save DC 17)',
      ],
      effects: [
        spell('cast-gate', 'spell:gate', {
          targetPlane: 'plane keyed to pressed side',
        }),
        spell('cast-plane-shift', 'spell:plane-shift', {
          ...fixedDc(17),
          targetPlane: 'plane keyed to pressed side',
        }),
      ],
    },
  ],
  [
    'Eyes of Charming',
    {
      sourcePhrases: [
        'cast the charm person spell (save DC 13) on a humanoid within 30 feet',
        'provided that you and the target can see each other',
      ],
      effects: [
        spell(
          'cast-charm-person',
          'spell:charm-person',
          {
            ...fixedDc(13),
            rangeFeet: 30,
            target: 'one humanoid',
            requiresMutualSight: true,
          },
          action('wearing the lenses'),
        ),
      ],
    },
  ],
  [
    'Hat of Disguise',
    {
      sourcePhrases: [
        'cast the disguise self spell from it at will',
        'spell ends if the hat is removed',
      ],
      effects: [
        spell('cast-disguise-self', 'spell:disguise-self', {
          endsOn: ['hat-removed'],
        }),
      ],
    },
  ],
  [
    'Helm of Brilliance',
    {
      sourcePhrases: [
        'cast one of the following spells (save DC 18)',
        'daylight (opal), fireball (fire opal), prismatic spray (diamond), or wall of fire (ruby)',
      ],
      effects: [
        spell('cast-daylight', 'spell:daylight', fixedDc(18)),
        spell('cast-fireball', 'spell:fireball', fixedDc(18)),
        spell('cast-prismatic-spray', 'spell:prismatic-spray', fixedDc(18)),
        spell('cast-wall-of-fire', 'spell:wall-of-fire', fixedDc(18)),
      ],
    },
  ],
  [
    'Helm of Comprehending Languages',
    {
      sourcePhrases: ['cast the comprehend languages spell from it at will'],
      effects: [
        spell('cast-comprehend-languages', 'spell:comprehend-languages'),
      ],
    },
  ],
  [
    'Helm of Telepathy',
    {
      sourcePhrases: [
        'cast the detect thoughts spell (save DC 13)',
        'cast the suggestion spell (save DC 13) from the helm on that creature',
      ],
      effects: [
        spell(
          'cast-detect-thoughts',
          'spell:detect-thoughts',
          { ...fixedDc(13), concentrationRequired: true },
          action('wearing the helm'),
        ),
        spell(
          'cast-suggestion',
          'spell:suggestion',
          {
            ...fixedDc(13),
            target: 'creature currently focused on with detect thoughts',
          },
          action('focusing on target with detect thoughts'),
        ),
      ],
    },
  ],
  [
    'Helm of Teleportation',
    {
      sourcePhrases: ['cast the teleport spell from it'],
      effects: [
        spell(
          'cast-teleport',
          'spell:teleport',
          {},
          action('wearing the helm'),
        ),
      ],
    },
  ],
  [
    'Luck Blade',
    {
      sourcePhrases: ['cast the wish spell from it'],
      effects: [
        spell('cast-wish', 'spell:wish', {}, action('holding the sword')),
      ],
    },
  ],
  [
    'Medallion of Thoughts',
    {
      sourcePhrases: ['cast the detect thoughts spell (save DC 13)'],
      effects: [
        spell(
          'cast-detect-thoughts',
          'spell:detect-thoughts',
          { ...fixedDc(13), concentrationRequired: true },
          action('wearing the medallion'),
        ),
      ],
    },
  ],
  [
    'Necklace of Fireballs',
    {
      sourcePhrases: [
        'detonates as a 3rd-level fireball spell (save DC 15)',
        'increase the level of the fireball by 1 for each bead beyond the first',
      ],
      effects: [
        spell('throw-fireball-beads', 'spell:fireball', {
          ...fixedDc(15),
          castLevel: 3,
          additionalLevelPerAdditionalBead: 1,
          rangeFeet: 60,
        }),
      ],
    },
  ],
  [
    'Necklace of Prayer Beads',
    {
      sourcePhrases: [
        'Each bead contains a spell that you can cast from it as a bonus action',
        'using your spell save DC if a save is necessary',
      ],
      effects: [
        {
          id: 'c2-cast-bead-spell',
          operationId: 'cast-bead-spell',
          activation: {
            cost: 'bonus-action',
            requirement: 'wearing the necklace',
          },
          effect: {
            kind: 'castSpell',
            spellRefs: [
              'spell:bless',
              'spell:cure-wounds',
              'spell:lesser-restoration',
              'spell:greater-restoration',
              'spell:branding-smite',
              'spell:planar-ally',
              'spell:wind-walk',
            ],
            ...ownDc,
            spellSelectionTableRef: 'table:necklace-of-prayer-beads',
            cureWoundsCastLevel: 2,
          },
          hooks: [F2, F4, F8],
        },
      ],
    },
  ],
  [
    'Orb of Dragonkind',
    {
      sourcePhrases: [
        'cast one of the following spells (save DC 18) from it: cure wounds (5th-level version, 3 charges), daylight (1 charge), death ward (2 charges), or scrying (3 charges)',
        'cast the detect magic spell from the orb without using any charges',
      ],
      effects: [
        spell(
          'cast-cure-wounds',
          'spell:cure-wounds',
          { ...fixedDc(18), castLevel: 5 },
          action('control the orb'),
        ),
        spell(
          'cast-daylight',
          'spell:daylight',
          fixedDc(18),
          action('control the orb'),
        ),
        spell(
          'cast-death-ward',
          'spell:death-ward',
          fixedDc(18),
          action('control the orb'),
        ),
        spell(
          'cast-scrying',
          'spell:scrying',
          fixedDc(18),
          action('control the orb'),
        ),
        spell(
          'cast-detect-magic',
          'spell:detect-magic',
          {},
          action('control the orb'),
        ),
      ],
    },
  ],
  [
    'Potion of Animal Friendship',
    {
      sourcePhrases: [
        'cast the animal friendship spell (save DC 13) for 1 hour at will',
      ],
      effects: [
        spell(
          'drink',
          'spell:animal-friendship',
          {
            ...fixedDc(13),
            duration: { amount: 1, unit: 'hour' },
            atWillDuringDuration: true,
          },
          { cost: 'consume', target: 'self' },
        ),
      ],
    },
  ],
  [
    'Potion of Clairvoyance',
    {
      sourcePhrases: ['gain the effect of the clairvoyance spell'],
      effects: [
        spell('drink', 'spell:clairvoyance', noConcentration, {
          cost: 'consume',
          target: 'self',
        }),
      ],
    },
  ],
  [
    'Potion of Healing',
    {
      sourcePhrases: [
        'number of hit points depends on the potion’s rarity',
        'Potions of Healing table',
      ],
      effects: [
        payload(
          'drink',
          'healing',
          { tableRef: 'table:potions-of-healing', selectRowBy: 'item rarity' },
          [F6, F9],
          { cost: 'consume', target: 'self' },
        ),
      ],
    },
  ],
  [
    'Potion of Heroism',
    {
      sourcePhrases: [
        'gain 10 temporary hit points that last for 1 hour',
        'bless spell (no concentration required)',
      ],
      effects: [
        payload(
          'drink',
          'temporaryHitPoints',
          { amount: 10, duration: { amount: 1, unit: 'hour' } },
          [F6],
          { cost: 'consume', target: 'self' },
        ),
        {
          ...spell(
            'drink-bless',
            'spell:bless',
            { ...noConcentration, duration: { amount: 1, unit: 'hour' } },
            { cost: 'consume', target: 'self' },
          ),
          operationId: 'drink',
        },
      ],
    },
  ],
  [
    'Potion of Mind Reading',
    {
      sourcePhrases: ['detect thoughts spell (save DC 13)'],
      effects: [
        spell(
          'drink',
          'spell:detect-thoughts',
          { ...fixedDc(13), concentrationRequired: true },
          { cost: 'consume', target: 'self' },
        ),
      ],
    },
  ],
  [
    'Potion of Poison',
    {
      sourcePhrases: [
        'take 3d6 poison damage',
        'repeat the saving throw',
        'subsequent turns decreases by 1d6',
      ],
      effects: [
        payload(
          'drink',
          'triggeredEffect',
          {
            trigger: 'drink disguised potion',
            initialDamage: { dice: '3d6', type: 'poison' },
            save: { ability: 'constitution', dc: 13 },
            failedSaveCondition: 'poisoned',
            recurringDamage: { dice: '3d6', timing: 'start of each turn' },
            repeatSave: 'end of each turn',
            successReductionDice: '1d6',
            endsWhenDamageDice: 0,
          },
          [F6, F8, F9],
          { cost: 'consume', target: 'self' },
        ),
      ],
    },
  ],
  [
    'Potion of Speed',
    {
      sourcePhrases: ['haste spell for 1 minute (no concentration required)'],
      effects: [
        spell(
          'drink',
          'spell:haste',
          { ...noConcentration, duration: { amount: 1, unit: 'minute' } },
          { cost: 'consume', target: 'self' },
        ),
      ],
    },
  ],
  [
    'Ring of Animal Influence',
    {
      sourcePhrases: [
        'Animal friendship (save DC 13)',
        'Fear (save DC 13), targeting only beasts that have an Intelligence of 3 or lower',
        'Speak with animals',
      ],
      effects: [
        spell(
          'cast-animal-friendship',
          'spell:animal-friendship',
          fixedDc(13),
          action('wearing the ring'),
        ),
        spell(
          'cast-fear',
          'spell:fear',
          { ...fixedDc(13), target: 'beasts with Intelligence 3 or lower' },
          action('wearing the ring'),
        ),
        spell(
          'cast-speak-with-animals',
          'spell:speak-with-animals',
          {},
          action('wearing the ring'),
        ),
      ],
    },
  ],
  [
    'Ring of Elemental Command',
    {
      sourcePhrases: [
        'Spells cast from the ring have a save DC of 17',
        'expending the necessary number of charges',
      ],
      effects: [
        spell('dominate-air-elemental', 'spell:dominate-monster', {
          ...fixedDc(17),
          target: 'air elemental',
        }),
        spell('cast-chain-lightning', 'spell:chain-lightning', fixedDc(17)),
        spell('cast-gust-of-wind', 'spell:gust-of-wind', fixedDc(17)),
        spell('cast-wind-wall', 'spell:wind-wall', fixedDc(17)),
        spell('dominate-earth-elemental', 'spell:dominate-monster', {
          ...fixedDc(17),
          target: 'earth elemental',
        }),
        spell('cast-stone-shape', 'spell:stone-shape', fixedDc(17)),
        spell('cast-stoneskin', 'spell:stoneskin', fixedDc(17)),
        spell('cast-wall-of-stone', 'spell:wall-of-stone', fixedDc(17)),
        spell('dominate-fire-elemental', 'spell:dominate-monster', {
          ...fixedDc(17),
          target: 'fire elemental',
        }),
        spell('cast-burning-hands', 'spell:burning-hands', fixedDc(17)),
        spell('cast-fireball', 'spell:fireball', fixedDc(17)),
        spell('cast-wall-of-fire', 'spell:wall-of-fire', fixedDc(17)),
        spell('dominate-water-elemental', 'spell:dominate-monster', {
          ...fixedDc(17),
          target: 'water elemental',
        }),
        spell(
          'cast-create-or-destroy-water',
          'spell:create-or-destroy-water',
          fixedDc(17),
        ),
        spell('cast-control-water', 'spell:control-water', fixedDc(17)),
        spell('cast-ice-storm', 'spell:ice-storm', fixedDc(17)),
        spell('cast-wall-of-ice', 'spell:wall-of-ice', fixedDc(17)),
      ],
    },
  ],
  [
    'Ring of Jumping',
    {
      sourcePhrases: [
        'cast the jump spell from it as a bonus action at will',
        'target only yourself',
      ],
      effects: [
        spell(
          'cast-jump',
          'spell:jump',
          { target: 'self' },
          { cost: 'bonus-action' },
        ),
      ],
    },
  ],
  [
    'Ring of Shooting Stars',
    {
      sourcePhrases: [
        'cast dancing lights and light from the ring at will',
        'cast faerie fire from the ring',
      ],
      effects: [
        spell(
          'cast-dancing-lights',
          'spell:dancing-lights',
          { concentrationRequired: true },
          action('wearing the ring in dim light or darkness'),
        ),
        spell(
          'cast-light',
          'spell:light',
          {},
          action('wearing the ring in dim light or darkness'),
        ),
        spell(
          'cast-faerie-fire',
          'spell:faerie-fire',
          { concentrationRequired: true },
          action('wearing the ring'),
        ),
      ],
    },
  ],
  [
    'Ring of Telekinesis',
    {
      sourcePhrases: [
        'cast the telekinesis spell at will',
        'target only objects that aren’t being worn or carried',
      ],
      effects: [
        spell(
          'cast-telekinesis',
          'spell:telekinesis',
          { concentrationRequired: true, target: 'unattended objects only' },
          null,
        ),
      ],
    },
  ],
  [
    'Ring of Three Wishes',
    {
      sourcePhrases: ['cast the wish spell from it'],
      effects: [
        spell('cast-wish', 'spell:wish', {}, action('wearing the ring')),
      ],
    },
  ],
  [
    'Robe of Stars',
    {
      sourcePhrases: ['cast magic missile as a 5th-level spell'],
      effects: [
        spell(
          'cast-magic-missile',
          'spell:magic-missile',
          { castLevel: 5 },
          action('wearing the robe'),
        ),
      ],
    },
  ],
  [
    'Rod of Alertness',
    {
      sourcePhrases: [
        'cast one of the following spells from it: detect evil and good, detect magic, detect poison and disease, or see invisibility',
      ],
      effects: [
        spell('cast-detect-evil-and-good', 'spell:detect-evil-and-good'),
        spell('cast-detect-magic', 'spell:detect-magic'),
        spell(
          'cast-detect-poison-and-disease',
          'spell:detect-poison-and-disease',
        ),
        spell('cast-see-invisibility', 'spell:see-invisibility'),
      ],
    },
  ],
  [
    'Staff of Charming',
    {
      sourcePhrases: [
        'cast charm person, command, or comprehend languages from it using your spell save DC',
      ],
      effects: [
        spell('cast-charm-person', 'spell:charm-person', ownDc),
        spell('cast-command', 'spell:command', ownDc),
        spell('cast-comprehend-languages', 'spell:comprehend-languages', ownDc),
      ],
    },
  ],
  [
    'Staff of Fire',
    {
      sourcePhrases: [
        'burning hands (1 charge), fireball (3 charges), or wall of fire (4 charges)',
      ],
      effects: [
        spell('cast-burning-hands', 'spell:burning-hands', ownDc),
        spell('cast-fireball', 'spell:fireball', ownDc),
        spell('cast-wall-of-fire', 'spell:wall-of-fire', ownDc),
      ],
    },
  ],
  [
    'Staff of Frost',
    {
      sourcePhrases: [
        'cone of cold (5 charges), fog cloud (1 charge), ice storm (4 charges), or wall of ice (4 charges)',
      ],
      effects: [
        spell('cast-cone-of-cold', 'spell:cone-of-cold', fixedDc(17)),
        spell('cast-fog-cloud', 'spell:fog-cloud'),
        spell('cast-ice-storm', 'spell:ice-storm', fixedDc(17)),
        spell('cast-wall-of-ice', 'spell:wall-of-ice', fixedDc(17)),
      ],
    },
  ],
  [
    'Staff of Healing',
    {
      sourcePhrases: [
        'cure wounds (1 charge per spell level, up to 4th), lesser restoration (2 charges), or mass cure wounds (5 charges)',
        'using your spell save DC and spellcasting ability modifier',
      ],
      effects: [
        spell('cast-cure-wounds', 'spell:cure-wounds', {
          castLevel: '1-4 selected by charges',
          spellcastingAbilityModifier: 'owner',
        }),
        spell('cast-lesser-restoration', 'spell:lesser-restoration', {
          spellcastingAbilityModifier: 'owner',
        }),
        spell('cast-mass-cure-wounds', 'spell:mass-cure-wounds', {
          spellcastingAbilityModifier: 'owner',
        }),
      ],
    },
  ],
  [
    'Staff of Power',
    {
      sourcePhrases: [
        'using your spell save DC and spell attack bonus',
        'fireball (5th-level version, 5 charges)',
        'lightning bolt (5th-level version, 5 charges)',
      ],
      effects: [
        spell('cast-cone-of-cold', 'spell:cone-of-cold', ownDc),
        spell('cast-fireball', 'spell:fireball', { ...ownDc, castLevel: 5 }),
        spell(
          'cast-globe-of-invulnerability',
          'spell:globe-of-invulnerability',
          ownDc,
        ),
        spell('cast-hold-monster', 'spell:hold-monster', ownDc),
        spell('cast-levitate', 'spell:levitate', ownDc),
        spell('cast-lightning-bolt', 'spell:lightning-bolt', {
          ...ownDc,
          castLevel: 5,
        }),
        spell('cast-magic-missile', 'spell:magic-missile', ownDc),
        spell('cast-ray-of-enfeeblement', 'spell:ray-of-enfeeblement', {
          ...ownDc,
          attackModifier: 'owner-spell-attack-bonus',
        }),
        spell('cast-wall-of-force', 'spell:wall-of-force', ownDc),
      ],
    },
  ],
  [
    'Staff of Swarming Insects',
    {
      sourcePhrases: ['giant insect (4 charges) or insect plague (5 charges)'],
      effects: [
        spell('cast-giant-insect', 'spell:giant-insect', ownDc),
        spell('cast-insect-plague', 'spell:insect-plague', ownDc),
      ],
    },
  ],
  [
    'Staff of the Magi',
    {
      sourcePhrases: [
        'using your spell save DC and spellcasting ability',
        'fireball (7th-level version, 7 charges)',
        'without using any charges: arcane lock, detect magic, enlarge/reduce, light, mage hand, or protection from evil and good',
      ],
      effects: [
        spell('cast-conjure-elemental', 'spell:conjure-elemental', ownDc),
        spell('cast-dispel-magic', 'spell:dispel-magic', ownDc),
        spell('cast-fireball', 'spell:fireball', { ...ownDc, castLevel: 7 }),
        spell('cast-flaming-sphere', 'spell:flaming-sphere', ownDc),
        spell('cast-ice-storm', 'spell:ice-storm', ownDc),
        spell('cast-invisibility', 'spell:invisibility', ownDc),
        spell('cast-knock', 'spell:knock', ownDc),
        spell('cast-lightning-bolt', 'spell:lightning-bolt', {
          ...ownDc,
          castLevel: 7,
        }),
        spell('cast-passwall', 'spell:passwall', ownDc),
        spell('cast-plane-shift', 'spell:plane-shift', ownDc),
        spell('cast-telekinesis', 'spell:telekinesis', {
          ...ownDc,
          concentrationRequired: true,
        }),
        spell('cast-wall-of-fire', 'spell:wall-of-fire', ownDc),
        spell('cast-web', 'spell:web', ownDc),
        spell('cast-arcane-lock', 'spell:arcane-lock', ownDc),
        spell('cast-detect-magic', 'spell:detect-magic', ownDc),
        spell('cast-enlarge-reduce', 'spell:enlarge-reduce', ownDc),
        spell('cast-light', 'spell:light', ownDc),
        spell('cast-mage-hand', 'spell:mage-hand', ownDc),
        spell(
          'cast-protection-from-evil-and-good',
          'spell:protection-from-evil-and-good',
          ownDc,
        ),
      ],
    },
  ],
  [
    'Staff of the Woodlands',
    {
      sourcePhrases: [
        'animal friendship (1 charge), awaken (5 charges), barkskin (2 charges), locate animals or plants (2 charges), speak with animals (1 charge), speak with plants (3 charges), or wall of thorns (6 charges)',
        'pass without trace spell from the staff without using any charges',
      ],
      effects: [
        spell('cast-animal-friendship', 'spell:animal-friendship', ownDc),
        spell('cast-awaken', 'spell:awaken', ownDc),
        spell('cast-barkskin', 'spell:barkskin', ownDc),
        spell(
          'cast-locate-animals-or-plants',
          'spell:locate-animals-or-plants',
          ownDc,
        ),
        spell('cast-speak-with-animals', 'spell:speak-with-animals', ownDc),
        spell('cast-speak-with-plants', 'spell:speak-with-plants', ownDc),
        spell('cast-wall-of-thorns', 'spell:wall-of-thorns', ownDc),
        spell('cast-pass-without-trace', 'spell:pass-without-trace', {
          ...ownDc,
          concentrationRequired: true,
        }),
      ],
    },
  ],
  [
    'Trident of Fish Command',
    {
      sourcePhrases: [
        'cast dominate beast (save DC 15)',
        'beast that has an innate swimming speed',
      ],
      effects: [
        spell(
          'cast-dominate-beast',
          'spell:dominate-beast',
          {
            ...fixedDc(15),
            target: 'beast with an innate swimming speed',
            concentrationRequired: true,
          },
          action('carrying the trident'),
        ),
      ],
    },
  ],
  [
    'Wand of Binding',
    {
      sourcePhrases: ['hold monster (5 charges) or hold person (2 charges)'],
      effects: [
        spell(
          'cast-hold-monster',
          'spell:hold-monster',
          { ...fixedDc(17), concentrationRequired: true },
          action('holding the wand'),
        ),
        spell(
          'cast-hold-person',
          'spell:hold-person',
          { ...fixedDc(17), concentrationRequired: true },
          action('holding the wand'),
        ),
      ],
    },
  ],
  [
    'Wand of Fireballs',
    {
      sourcePhrases: [
        'cast the fireball spell (save DC 15)',
        'increase the spell slot level by one for each additional charge',
      ],
      effects: [
        spell(
          'cast-fireball',
          'spell:fireball',
          {
            ...fixedDc(15),
            castLevel: 3,
            additionalLevelPerAdditionalCharge: 1,
          },
          action('holding the wand'),
        ),
      ],
    },
  ],
  [
    'Wand of Lightning Bolts',
    {
      sourcePhrases: [
        'cast the lightning bolt spell (save DC 15)',
        'increase the spell slot level by one for each additional charge',
      ],
      effects: [
        spell(
          'cast-lightning-bolt',
          'spell:lightning-bolt',
          {
            ...fixedDc(15),
            castLevel: 3,
            additionalLevelPerAdditionalCharge: 1,
          },
          action('holding the wand'),
        ),
      ],
    },
  ],
  [
    'Wand of Magic Detection',
    {
      sourcePhrases: ['cast the detect magic spell from it'],
      effects: [
        spell(
          'cast-detect-magic',
          'spell:detect-magic',
          {},
          action('holding the wand'),
        ),
      ],
    },
  ],
  [
    'Wand of Magic Missiles',
    {
      sourcePhrases: [
        'cast the magic missile spell from it',
        'increase the spell slot level by one for each additional charge',
      ],
      effects: [
        spell(
          'cast-magic-missile',
          'spell:magic-missile',
          { castLevel: 1, additionalLevelPerAdditionalCharge: 1 },
          action('holding the wand'),
        ),
      ],
    },
  ],
  [
    'Wand of Polymorph',
    {
      sourcePhrases: ['cast the polymorph spell (save DC 15)'],
      effects: [
        spell(
          'cast-polymorph',
          'spell:polymorph',
          { ...fixedDc(15), concentrationRequired: true },
          action('holding the wand'),
        ),
      ],
    },
  ],
  [
    'Wand of Web',
    {
      sourcePhrases: ['cast the web spell (save DC 15)'],
      effects: [
        spell(
          'cast-web',
          'spell:web',
          { ...fixedDc(15), concentrationRequired: true },
          action('holding the wand'),
        ),
      ],
    },
  ],
  [
    'Wind Fan',
    {
      sourcePhrases: ['cast the gust of wind spell (save DC 13)'],
      effects: [
        spell(
          'cast-gust-of-wind',
          'spell:gust-of-wind',
          { ...fixedDc(13), concentrationRequired: true },
          action('holding the fan'),
        ),
      ],
    },
  ],

  [
    'Gem of Brightness',
    {
      sourcePhrases: [
        'DC 15 Constitution saving throw or become blinded for 1 minute',
        'repeat the saving throw at the end of each of its turns',
      ],
      effects: [
        payload(
          'blinding-beam',
          'imposesCondition',
          {
            conditions: ['blinded'],
            save: { ability: 'constitution', dc: 15 },
            duration: { amount: 1, unit: 'minute' },
            repeatSave: 'end of each turn',
            endsOn: ['successful-repeat-save'],
            rangeFeet: 60,
          },
          undefined,
          action(
            'holding the gem; speak second command word',
            'one visible creature',
          ),
        ),
        payload(
          'blinding-cone',
          'imposesCondition',
          {
            conditions: ['blinded'],
            save: { ability: 'constitution', dc: 15 },
            duration: { amount: 1, unit: 'minute' },
            repeatSave: 'end of each turn',
            endsOn: ['successful-repeat-save'],
            area: { shape: 'cone', feet: 30 },
          },
          undefined,
          action('holding the gem; speak third command word'),
        ),
      ],
    },
  ],
  [
    'Horn of Blasting',
    {
      sourcePhrases: [
        'takes 5d6 thunder damage and is deafened for 1 minute',
        'takes half as much damage and isn’t deafened',
      ],
      effects: [
        payload(
          'blow-horn',
          'triggeredEffect',
          {
            trigger: 'command word is spoken and horn is blown',
            save: { ability: 'constitution', dc: 15 },
            area: { shape: 'cone', feet: 30 },
            failedSaveDamage: { dice: '5d6', type: 'thunder' },
            successfulSaveDamage: 'half',
            failedSaveCondition: 'deafened',
            conditionDuration: { amount: 1, unit: 'minute' },
            glassOrCrystalDamageDice: '10d6',
          },
          undefined,
          {
            cost: 'action',
            commandWord: true,
            requirement: 'speak command word then blow horn',
          },
        ),
      ],
    },
  ],
  [
    'Javelin of Lightning',
    {
      sourcePhrases: [
        'taking 4d6 lightning damage on a failed save, and half as much damage on a successful one',
        'target takes damage from the javelin plus 4d6 lightning damage',
      ],
      effects: [
        payload(
          'hurl-lightning',
          'triggeredEffect',
          {
            trigger: 'javelin is hurled and command word spoken',
            line: { widthFeet: 5, lengthFeet: 120 },
            excludes: ['user', 'attack-target'],
            save: { ability: 'dexterity', dc: 13 },
            failedSaveDamage: { dice: '4d6', type: 'lightning' },
            successfulSaveDamage: 'half',
            attackTargetExtraDamage: { dice: '4d6', type: 'lightning' },
          },
          undefined,
          {
            cost: 'action',
            commandWord: true,
            target: 'one target within 120 feet',
          },
        ),
      ],
    },
  ],
  [
    'Mace of Terror',
    {
      sourcePhrases: [
        'DC 15 Wisdom saving throw or become frightened of you for 1 minute',
        'repeat the saving throw, ending the effect on itself on a success',
      ],
      effects: [
        payload(
          'release-terror-wave',
          'imposesCondition',
          {
            conditions: ['frightened'],
            save: { ability: 'wisdom', dc: 15 },
            targets: 'creatures of your choice within 30 feet',
            duration: { amount: 1, unit: 'minute' },
            behavior:
              'must move as far away as possible; cannot willingly approach within 30 feet; cannot react; action limited to Dash, escape, or Dodge if unable to move',
            repeatSave: 'end of each turn',
            endsOn: ['successful-repeat-save'],
          },
          undefined,
          action('holding the mace'),
        ),
      ],
    },
  ],
  [
    'Pipes of Haunting',
    {
      sourcePhrases: [
        'must succeed on a DC 15 Wisdom saving throw or become frightened of you for 1 minute',
        'immune to the effect of these pipes for 24 hours',
      ],
      effects: [
        payload(
          'play-haunting-tune',
          'imposesCondition',
          {
            conditions: ['frightened'],
            save: { ability: 'wisdom', dc: 15 },
            targets: 'hearing creatures within 30 feet',
            duration: { amount: 1, unit: 'minute' },
            repeatSave: 'end of each turn',
            endsOn: ['successful-repeat-save'],
            optionalAutoSuccess: 'nonhostile creatures',
            onSuccessfulSave: {
              immunityDuration: { amount: 24, unit: 'hour' },
            },
          },
          undefined,
          action('proficient with wind instruments'),
        ),
      ],
    },
  ],
  [
    'Ring of the Ram',
    {
      sourcePhrases: [
        'makes its attack roll with a +7 bonus',
        'for each charge you spend, the target takes 2d10 force damage and is pushed 5 feet',
      ],
      effects: [
        payload(
          'spectral-ram-attack',
          'triggeredEffect',
          {
            trigger: 'spectral ram attack hits',
            attackModifier: 7,
            rangeFeet: 60,
            damagePerCharge: { dice: '2d10', type: 'force' },
            pushFeetPerCharge: 5,
            charges: '1-3',
          },
          [F2, F8, F9],
          action('wearing the ring', 'one visible creature'),
        ),
      ],
    },
  ],
  [
    'Robe of Scintillating Colors',
    {
      sourcePhrases: [
        'DC 15 Wisdom saving throw or become stunned until the effect ends',
        'until the end of your next turn',
      ],
      effects: [
        payload(
          'display-scintillating-colors',
          'imposesCondition',
          {
            conditions: ['stunned'],
            save: { ability: 'wisdom', dc: 15 },
            targets:
              'creatures in bright light that can see wearer at activation',
            duration: 'until end of wearer next turn',
          },
          undefined,
          action('wearing the robe'),
        ),
      ],
    },
  ],
  [
    'Rod of Lordly Might',
    {
      sourcePhrases: ['Drain Life.', 'Paralyze.', 'Terrify.'],
      effects: [
        payload(
          'drain-life',
          'triggeredEffect',
          {
            trigger: 'melee hit with rod',
            save: { ability: 'constitution', dc: 17 },
            failedSaveDamage: { dice: '4d6', type: 'necrotic' },
            healing: 'half necrotic damage dealt',
          },
          undefined,
          { cost: 'free', trigger: 'melee hit with rod' },
        ),
        payload(
          'paralyze',
          'imposesCondition',
          {
            conditions: ['paralyzed'],
            trigger: 'melee hit with rod',
            save: { ability: 'strength', dc: 17 },
            duration: { amount: 1, unit: 'minute' },
            repeatSave: 'end of each turn',
            endsOn: ['successful-repeat-save'],
          },
          undefined,
          { cost: 'free', trigger: 'melee hit with rod' },
        ),
        payload(
          'terrify',
          'imposesCondition',
          {
            conditions: ['frightened'],
            save: { ability: 'wisdom', dc: 17 },
            targets: 'visible creatures within 30 feet',
            duration: { amount: 1, unit: 'minute' },
            repeatSave: 'end of each turn',
            endsOn: ['successful-repeat-save'],
          },
          undefined,
          action('holding the rod'),
        ),
      ],
    },
  ],
  [
    'Rope of Entanglement',
    {
      sourcePhrases: [
        'DC 15 Dexterity saving throw or become restrained',
        'DC 15 Strength or Dexterity check',
      ],
      effects: [
        payload(
          'entangle-creature',
          'imposesCondition',
          {
            conditions: ['restrained'],
            save: { ability: 'dexterity', dc: 15 },
            rangeFeet: 20,
            escapeCheck: {
              abilityChoice: ['strength', 'dexterity'],
              dc: 15,
              activation: 'action',
            },
            endsOn: ['successful-escape-check', 'release-command-word'],
          },
          undefined,
          {
            cost: 'action',
            commandWord: true,
            requirement: 'holding one end of rope',
            target: 'one visible creature',
          },
        ),
      ],
    },
  ],
  [
    'Sphere of Annihilation',
    {
      sourcePhrases: [
        'must succeed on a DC 13 Dexterity saving throw or be touched by it, taking 4d10 force damage',
      ],
      effects: [
        payload(
          'sphere-space-entry',
          'triggeredEffect',
          {
            trigger: 'sphere enters creature space',
            save: { ability: 'dexterity', dc: 13 },
            failedSaveDamage: { dice: '4d10', type: 'force' },
            successfulSaveDamage: 'none',
          },
          [F8, F9],
          { cost: 'free', trigger: 'sphere enters creature space' },
        ),
      ],
    },
  ],
  [
    'Staff of Thunder and Lightning',
    {
      sourcePhrases: [
        'taking 9d6 lightning damage on a failed save, or half as much damage on a successful one',
        'takes 2d6 thunder damage and becomes deafened for 1 minute',
      ],
      effects: [
        payload('lightning-strike', 'triggeredEffect', {
          trigger: 'lightning strike property activated',
          line: { widthFeet: 5, lengthFeet: 120 },
          save: { ability: 'dexterity', dc: 17 },
          failedSaveDamage: { dice: '9d6', type: 'lightning' },
          successfulSaveDamage: 'half',
        }),
        payload('thunderclap', 'triggeredEffect', {
          trigger: 'thunderclap property activated',
          radiusFeet: 60,
          excludes: ['user'],
          save: { ability: 'constitution', dc: 17 },
          failedSaveDamage: { dice: '2d6', type: 'thunder' },
          successfulSaveDamage: 'half',
          failedSaveCondition: 'deafened',
          conditionDuration: { amount: 1, unit: 'minute' },
        }),
      ],
    },
  ],
  [
    'Hammer of Thunderbolts',
    {
      sourcePhrases: [
        'roll a 20 on an attack roll made with this weapon against a giant',
        'make a ranged weapon attack with the hammer, hurling it as if it had the thrown property with a normal range of 20 feet and a long range of 60 feet',
        'target and every creature within 30 feet of it must succeed on a DC 17 Constitution saving throw or be stunned until the end of your next turn',
      ],
      effects: [
        payload(
          'giant-slaying-critical',
          'triggeredEffect',
          {
            trigger: 'natural 20 attack against a giant with the hammer',
            save: { ability: 'constitution', dc: 17 },
            failedSaveEffect: 'die',
          },
          [F1, F8, F9],
          { cost: 'free', trigger: 'natural 20 attack against a giant' },
        ),
        payload(
          'hurl-thunderclap',
          'triggeredEffect',
          {
            trigger: 'hurl-thunderbolts attack hits',
            range: { normalFeet: 20, longFeet: 60 },
            area: { shape: 'radius', feet: 30, centeredOn: 'attack target' },
            save: { ability: 'constitution', dc: 17 },
            failedSaveCondition: 'stunned',
            duration: 'until end of your next turn',
          },
          [F2, F8, F9],
          action(
            'attuned to and holding the hammer',
            'one target within 60 feet',
          ),
        ),
      ],
    },
  ],
  [
    'Nine Lives Stealer',
    {
      sourcePhrases: [
        'score a critical hit against a creature that has fewer than 100 hit points',
        'DC 15 Constitution saving throw or be slain instantly',
        'sword loses 1 charge if the creature is slain',
      ],
      effects: [
        payload(
          'slay-on-critical',
          'triggeredEffect',
          {
            trigger:
              'critical hit against creature with fewer than 100 hit points',
            save: { ability: 'constitution', dc: 15 },
            immuneTypes: ['construct', 'undead'],
            failedSaveEffect: 'slain instantly',
            chargeCost: 1,
          },
          [F1, F8, F9],
          { cost: 'free', trigger: 'critical hit against eligible creature' },
        ),
      ],
    },
  ],
  [
    'Staff of Withering',
    {
      sourcePhrases: [
        'extra 2d10 necrotic damage',
        'DC 15 Constitution saving throw or have disadvantage for 1 hour',
      ],
      effects: [
        payload(
          'withering-strike',
          'triggeredEffect',
          {
            trigger: 'hit with staff',
            extraDamage: { dice: '2d10', type: 'necrotic' },
            save: { ability: 'constitution', dc: 15 },
            failedSaveEffect:
              'disadvantage on Strength or Constitution ability checks and saving throws',
            duration: { amount: 1, unit: 'hour' },
          },
          undefined,
          { cost: 'free', trigger: 'hit with staff' },
        ),
      ],
    },
  ],
  [
    'Wand of Fear',
    {
      sourcePhrases: [
        'command another creature to flee or grovel, as with the command spell (save DC 15)',
        'DC 15 Wisdom saving throw or become frightened of you for 1 minute',
      ],
      effects: [
        spell(
          'command',
          'spell:command',
          { ...fixedDc(15), options: ['flee', 'grovel'] },
          action('holding the wand'),
        ),
        payload(
          'cone-of-fear',
          'imposesCondition',
          {
            conditions: ['frightened'],
            save: { ability: 'wisdom', dc: 15 },
            area: { shape: 'cone', feet: 60 },
            duration: { amount: 1, unit: 'minute' },
            behavior:
              'must move as far away as possible; cannot willingly approach within 30 feet; cannot react; action limited to Dash, escape, or Dodge if unable to move',
            repeatSave: 'end of each turn',
            endsOn: ['successful-repeat-save'],
          },
          undefined,
          action('holding the wand'),
        ),
      ],
    },
  ],
  [
    'Wand of Paralysis',
    {
      sourcePhrases: [
        'DC 15 Constitution saving throw or be paralyzed for 1 minute',
        'repeat the saving throw, ending the effect on itself on a success',
      ],
      effects: [
        payload(
          'paralyzing-ray',
          'imposesCondition',
          {
            conditions: ['paralyzed'],
            save: { ability: 'constitution', dc: 15 },
            rangeFeet: 60,
            duration: { amount: 1, unit: 'minute' },
            repeatSave: 'end of each turn',
            endsOn: ['successful-repeat-save'],
          },
          undefined,
          action('holding the wand', 'one visible creature'),
        ),
      ],
    },
  ],
]);

export const MAGIC_ITEM_ACTIVATED_EFFECT_NAMES = Object.freeze([
  ...SPECS.keys(),
]);

export const MAGIC_ITEM_ACTIVATED_EFFECT_REFERENCES = Object.freeze(
  [...SPECS.values()].flatMap(({ effects }) =>
    effects.flatMap(({ effect }) => {
      const refs = [
        effect.spellRef,
        effect.spellSelectionTableRef,
        effect.tableRef,
        ...(Array.isArray(effect.spellRefs) ? effect.spellRefs : []),
      ].filter((value): value is string => typeof value === 'string');
      return refs;
    }),
  ),
);

/** Project exactly the reviewed spell/activated-payload slice; all others fail closed. */
export function projectMagicItemActivatedEffects(
  item: MagicItemExtraction,
): MagicItemFamilyProjection | undefined {
  const spec = SPECS.get(item.name);
  if (spec === undefined) return undefined;
  for (const phrase of spec.sourcePhrases) {
    if (!item.description.includes(phrase)) {
      throw new Error(
        `magic-item C2 activated projection: expected source phrase ${JSON.stringify(phrase)} not found in ${JSON.stringify(item.name)}`,
      );
    }
  }
  const operations = new Map<string, MagicItemOperation>();
  for (const { operationId, id, activation } of spec.effects) {
    const existing = operations.get(operationId);
    if (existing !== undefined) {
      operations.set(operationId, {
        ...existing,
        effects: [...(existing.effects ?? []), id],
      });
    } else {
      operations.set(operationId, {
        id: operationId,
        ...(activation === undefined ? {} : { activation }),
        effects: [id],
      });
    }
  }
  return {
    family: 'c2-spells-and-activated-effects',
    mechanics: {
      operations: [...operations.values()],
      effects: spec.effects.map(({ id, effect }) => ({ id, ...effect })),
    },
    clauses: spec.effects.map(({ id, hooks }) => ({
      id: `c2-effect-${id.replace(/^c2-/, '')}`,
      tag: 'C2' as const,
      representation: { block: 'effects' as const, effectId: id },
      engineHooks: hooks,
    })),
  };
}
