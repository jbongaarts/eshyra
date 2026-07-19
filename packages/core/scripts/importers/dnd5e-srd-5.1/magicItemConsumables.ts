/**
 * Source-grounded M1 consumable and single-use-payload curation.
 *
 * Exact membership is the 31 M1-tagged rows in the reviewed magic-item
 * mechanics inventory. Stackable, stateless consumables spend inventory
 * quantity; only source-defined multi-dose containers carry a per-instance
 * dose economy. Mutable quantity/dose values remain live campaign state.
 */

import type {
  MagicItemEconomy,
  MagicItemEffect,
  MagicItemMechanics,
  MagicItemOperation,
} from '../../../src/rules/magicItemMechanics.js';
import type {
  EngineHookBinding,
  ItemClauseExpectation,
  MagicItemFamilyProjection,
} from './magicItemCompiler.js';
import type { MagicItemExtraction } from './types.js';

interface ConsumableSpec {
  readonly sourcePhrases: readonly string[];
  readonly economies: Readonly<Record<string, MagicItemEconomy>>;
  readonly operations: readonly MagicItemOperation[];
  readonly effects: readonly MagicItemEffect[];
  readonly primaryEconomy: string;
  readonly engineHooks?: readonly EngineHookBinding[];
  readonly extraClauses?: readonly ItemClauseExpectation[];
}

const quantity = (): MagicItemEconomy => ({
  kind: 'single-use',
  onDepleted: { becomes: 'destroyed' },
  note: 'Spend one stack quantity; this stateless consumable has no item_state row.',
});

const doses = (count: number | string, unit: string): MagicItemEconomy => ({
  kind: 'doses',
  doses: { count },
  onDepleted: { becomes: 'inert' },
  note: `Found container holds ${count} ${unit}.`,
});

const effect = (
  id: string,
  kind: string,
  payload: Readonly<Record<string, unknown>>,
): MagicItemEffect => ({ id, kind, ...payload });

const operation = (
  id: string,
  economy: string,
  effectIds: readonly string[],
  activation: NonNullable<MagicItemOperation['activation']>,
  amount: number | string | 'variable' = 1,
  note?: string,
): MagicItemOperation => ({
  id,
  activation,
  cost: [{ economy, amount }],
  ...(effectIds.length === 0 ? {} : { effects: effectIds }),
  ...(note === undefined ? {} : { note }),
});

const duration = (amount: number | string, unit: string) => ({ amount, unit });
const spell = (
  id: string,
  spellRef: string,
  extra: Readonly<Record<string, unknown>> = {},
) => effect(id, 'castSpell', { spellRef, ...extra });

function potion(
  sourcePhrases: readonly string[],
  effects: readonly MagicItemEffect[],
  engineHooks?: readonly EngineHookBinding[],
  extraClauses?: readonly ItemClauseExpectation[],
): ConsumableSpec {
  return {
    sourcePhrases,
    economies: { quantity: quantity() },
    operations: [
      operation(
        'drink',
        'quantity',
        effects.map(({ id }) => id as string),
        {
          cost: 'consume',
          target: 'self',
        },
      ),
    ],
    effects,
    primaryEconomy: 'quantity',
    engineHooks,
    extraClauses,
  };
}

const specs: ReadonlyMap<string, ConsumableSpec> = new Map([
  [
    'Bead of Force',
    {
      sourcePhrases: [
        'use an action to throw the bead up to 60 feet',
        'bead explodes on impact and is destroyed',
        'encloses the area for 1 minute',
      ],
      economies: { quantity: quantity() },
      operations: [
        operation('throw-bead', 'quantity', ['bead-force-payload'], {
          cost: 'action',
          target: 'point within 60 feet',
        }),
      ],
      effects: [
        effect('bead-force-payload', 'triggeredEffect', {
          trigger: 'thrown bead impacts',
          radiusFeet: 10,
          save: { ability: 'dexterity', dc: 15 },
          failedSaveDamage: { dice: '5d4', type: 'force' },
          forceSphereDuration: duration(1, 'minute'),
          trappedOn: 'failed save while completely within area',
          pushesAway: 'successful save or partially within area',
        }),
      ],
      primaryEconomy: 'quantity',
      engineHooks: [
        { engine: 'F9', hook: 'area targeting and forced movement' },
      ],
    },
  ],
  [
    'Dust of Disappearance',
    {
      sourcePhrases: [
        'There is enough of it for one use',
        'invisible for 2d4 minutes',
        'dust is consumed when its magic takes effect',
      ],
      economies: { quantity: quantity() },
      operations: [
        operation('throw-dust', 'quantity', ['area-invisibility'], {
          cost: 'action',
          target: 'self, creatures, and objects within 10 feet',
        }),
      ],
      effects: [
        effect('area-invisibility', 'visibility', {
          state: 'invisible',
          radiusFeet: 10,
          duration: duration('2d4', 'minute'),
          sharedDurationRoll: true,
          endsForCreatureOn: ['attack', 'cast-spell'],
        }),
      ],
      primaryEconomy: 'quantity',
    },
  ],
  [
    'Dust of Dryness',
    {
      sourcePhrases: [
        'contains 1d6 + 4 pinches of dust',
        'sprinkle a pinch of it over water',
        'cube of water 15 feet on a side',
      ],
      economies: { doses: doses('1d6+4', 'pinches') },
      operations: [
        operation('sprinkle-dust', 'doses', ['absorb-water'], {
          cost: 'action',
          target: 'water or a water-composed elemental',
        }),
      ],
      effects: [
        effect('absorb-water', 'triggeredEffect', {
          trigger:
            'a pinch is sprinkled over water or exposed to a water-composed elemental',
          waterCubeFeetPerSide: 15,
          becomes: 'marble-sized pellet',
          pelletRelease: {
            activation: 'action',
            method: 'smash against a hard surface',
          },
          waterElemental: {
            save: { ability: 'constitution', dc: 13 },
            failedSaveDamage: { dice: '10d6', type: 'necrotic' },
            successfulSaveDamage: 'half',
          },
        }),
      ],
      primaryEconomy: 'doses',
    },
  ],
  [
    'Dust of Sneezing and Choking',
    {
      sourcePhrases: [
        'There is enough of it for one use',
        'DC 15 Constitution saving throw',
        'incapacitated and suffocating',
      ],
      economies: { quantity: quantity() },
      operations: [
        operation('throw-dust', 'quantity', ['choking-dust'], {
          cost: 'action',
          target: 'self and breathing creatures within 30 feet',
        }),
      ],
      effects: [
        effect('choking-dust', 'imposesCondition', {
          conditions: ['incapacitated', 'suffocating'],
          save: { ability: 'constitution', dc: 15 },
          repeatSave: 'end of each turn while conscious',
          endsOn: ['successful-repeat-save', 'spell:lesser-restoration'],
        }),
      ],
      primaryEconomy: 'quantity',
      engineHooks: [
        { engine: 'F6', hook: 'suffocation and condition lifecycle' },
      ],
    },
  ],
  [
    'Elemental Gem',
    {
      sourcePhrases: [
        'use an action to break the gem',
        'gem’s magic is lost',
        'type of gem determines the elemental summoned',
      ],
      economies: { quantity: quantity() },
      operations: [
        operation('break-gem', 'quantity', ['summon-elemental'], {
          cost: 'action',
          target: 'self',
        }),
      ],
      effects: [
        spell('summon-elemental', 'spell:conjure-elemental', {
          gemTypeTableRef: 'table:elemental-gem',
        }),
      ],
      primaryEconomy: 'quantity',
      engineHooks: [
        { engine: 'F4', hook: 'spell execution and summoned entity ownership' },
      ],
      extraClauses: [
        {
          id: 's-gem-type-table',
          tag: 'S',
          representation: {
            block: 'structuredField',
            field: 'effects.summon-elemental.gemTypeTableRef',
            ref: 'table:elemental-gem',
          },
        },
      ],
    },
  ],
  [
    'Feather Token',
    {
      sourcePhrases: [
        'Different types of feather tokens exist',
        'The token disappears',
        'Different types of feather tokens exist',
      ],
      economies: { quantity: quantity() },
      operations: [
        operation('use-token', 'quantity', ['token-kind-payload'], {
          cost: 'action',
          target: 'varies by token kind',
        }),
      ],
      effects: [
        effect('token-kind-payload', 'triggeredEffect', {
          trigger: 'the selected feather-token kind is activated',
          tableRef: 'table:feather-token',
          variants: {
            anchor: {
              duration: duration(24, 'hour'),
              target: 'boat or ship',
              effect: 'cannot be moved by any means',
            },
            bird: {
              creatureRef: 'creature:roc',
              cannotAttack: true,
              carryPoundsAtFullSpeed: 500,
              fullSpeedMilesPerHour: 16,
              maximumMilesPerDay: 144,
              rest: '1 hour per 3 hours flying',
              carryPoundsAtHalfSpeed: 1000,
            },
            fan: {
              shipSpeedBonusMilesPerHour: 5,
              duration: duration(8, 'hour'),
            },
            swanBoat: {
              sizeFeet: [50, 20],
              speedMilesPerHour: 6,
              capacityMediumCreatures: 32,
              duration: duration(24, 'hour'),
            },
            tree: {
              nonmagical: true,
              heightFeet: 60,
              trunkDiameterFeet: 5,
              branchRadiusFeet: 20,
            },
            whip: {
              attackBonus: 9,
              damage: { dice: '1d6+5', type: 'force' },
              moveFeet: 20,
              duration: duration(1, 'hour'),
              endsOn: ['dismiss-action', 'incapacitated', 'death'],
            },
          },
        }),
      ],
      primaryEconomy: 'quantity',
      engineHooks: [
        {
          engine: 'F9',
          hook: 'variant targeting, movement, and capacity arithmetic',
        },
      ],
      extraClauses: [
        {
          id: 's-token-kind-table',
          tag: 'S',
          representation: {
            block: 'structuredField',
            field: 'effects.token-kind-payload.tableRef',
            ref: 'table:feather-token',
          },
        },
      ],
    },
  ],
  [
    'Marvelous Pigments',
    {
      sourcePhrases: [
        'Typically found in 1d4 pots',
        'sufficient to cover 1,000 square feet',
        'takes 10 minutes to cover 100 square feet',
      ],
      economies: { doses: doses('1d4', 'pots') },
      operations: [
        operation(
          'paint',
          'doses',
          ['paint-object'],
          { cost: 'consume', target: 'surface' },
          'variable',
          'One pot covers 1,000 square feet; painting time scales by covered area.',
        ),
      ],
      effects: [
        effect('paint-object', 'objectInteraction', {
          coverageSquareFeetPerPot: 1000,
          minutesPer100SquareFeet: 10,
          maximumVolumeCubicFeet: 10000,
          result: 'real nonmagical inanimate object or terrain',
          maximumValueGp: 25,
          overValueResult: 'authentic-looking worthless material',
          energyResult: 'dissipates immediately and does no harm',
        }),
      ],
      primaryEconomy: 'doses',
      engineHooks: [
        { engine: 'F9', hook: 'coverage, time, and volume arithmetic' },
        { engine: 'F10', hook: 'canonical asset creation when retained' },
      ],
    },
  ],
  [
    'Oil of Etherealness',
    {
      sourcePhrases: [
        'one additional vial is required for each size category above Medium',
        'Applying the oil takes 10 minutes',
        'etherealness spell for 1 hour',
      ],
      economies: { quantity: quantity() },
      operations: [
        operation(
          'apply-oil',
          'quantity',
          ['etherealness'],
          {
            cost: 'consume',
            target: 'creature and worn/carried equipment',
            note: '10-minute application',
          },
          'variable',
          'Spend one vial for Medium or smaller, plus one per size category above Medium.',
        ),
      ],
      effects: [
        spell('etherealness', 'spell:etherealness', {
          duration: duration(1, 'hour'),
        }),
      ],
      primaryEconomy: 'quantity',
      engineHooks: [
        { engine: 'F4', hook: 'spell effect application' },
        { engine: 'F9', hook: 'size-scaled quantity cost' },
      ],
    },
  ],
  [
    'Oil of Sharpness',
    {
      sourcePhrases: [
        'coat one slashing or piercing weapon or up to 5 pieces',
        'Applying the oil takes 1 minute',
        '+3 bonus to attack and damage rolls',
      ],
      economies: { quantity: quantity() },
      operations: [
        operation('apply-oil', 'quantity', ['sharpness'], {
          cost: 'consume',
          target:
            'one slashing/piercing weapon or up to five pieces of such ammunition',
          note: '1-minute application',
        }),
      ],
      effects: [
        effect('sharpness', 'rollModifier', {
          attackBonus: 3,
          damageBonus: 3,
          makesMagical: true,
          duration: duration(1, 'hour'),
        }),
      ],
      primaryEconomy: 'quantity',
      engineHooks: [
        { engine: 'F8', hook: 'attack and damage modifier application' },
      ],
    },
  ],
  [
    'Oil of Slipperiness',
    {
      sourcePhrases: [
        'Applying the oil takes 10 minutes',
        'Alternatively, the oil can be poured on the ground as an action',
        'grease spell in that area for 8 hours',
      ],
      economies: { quantity: quantity() },
      operations: [
        operation(
          'apply-oil',
          'quantity',
          ['freedom-of-movement'],
          {
            cost: 'consume',
            target: 'creature and worn/carried equipment',
            note: '10-minute application; one additional vial per size above Medium',
          },
          'variable',
        ),
        operation('pour-oil', 'quantity', ['grease-area'], {
          cost: 'action',
          target: '10-foot square of ground',
        }),
      ],
      effects: [
        spell('freedom-of-movement', 'spell:freedom-of-movement', {
          duration: duration(8, 'hour'),
        }),
        spell('grease-area', 'spell:grease', {
          duration: duration(8, 'hour'),
          areaFeet: 10,
        }),
      ],
      primaryEconomy: 'quantity',
      engineHooks: [
        { engine: 'F4', hook: 'spell effect application' },
        { engine: 'F9', hook: 'size-scaled quantity cost and area targeting' },
      ],
    },
  ],
  [
    'Philter of Love',
    potion(
      [
        'next time you see a creature within 10 minutes after drinking',
        'become charmed by that creature for 1 hour',
      ],
      [
        effect('love-charm', 'imposesCondition', {
          condition: 'charmed',
          triggerWindow: duration(10, 'minute'),
          trigger: 'next creature seen',
          duration: duration(1, 'hour'),
          trueLoveIf: 'species and gender normally attractive to drinker',
        }),
      ],
    ),
  ],
  [
    'Potion of Animal Friendship',
    potion(
      ['cast the animal friendship spell (save DC 13) for 1 hour at will'],
      [
        spell('animal-friendship', 'spell:animal-friendship', {
          saveDc: 13,
          accessDuration: duration(1, 'hour'),
          frequency: 'at-will',
        }),
      ],
      [{ engine: 'F4', hook: 'spell execution' }],
    ),
  ],
  [
    'Potion of Clairvoyance',
    potion(
      ['gain the effect of the clairvoyance spell'],
      [spell('clairvoyance', 'spell:clairvoyance')],
      [{ engine: 'F4', hook: 'spell effect application' }],
    ),
  ],
  [
    'Potion of Climbing',
    potion(
      [
        'climbing speed equal to your walking speed for 1 hour',
        'advantage on Strength (Athletics) checks you make to climb',
      ],
      [
        effect('climbing', 'speedSet', {
          mode: 'climb',
          value: 'walking-speed',
          duration: duration(1, 'hour'),
        }),
        effect('climb-advantage', 'checkBonus', {
          ability: 'strength',
          skill: 'athletics',
          mode: 'advantage',
          scope: 'checks to climb',
          duration: duration(1, 'hour'),
        }),
      ],
    ),
  ],
  [
    'Potion of Diminution',
    potion(
      [
        '“reduce” effect of the enlarge/reduce spell for 1d4 hours',
        'no concentration required',
      ],
      [
        spell('reduce', 'spell:enlarge-reduce', {
          mode: 'reduce',
          duration: duration('1d4', 'hour'),
          concentrationRequired: false,
        }),
      ],
      [{ engine: 'F4', hook: 'spell effect application' }],
    ),
  ],
  [
    'Potion of Flying',
    potion(
      [
        'flying speed equal to your walking speed for 1 hour',
        'can hover',
        'you fall unless you have some other means',
      ],
      [
        effect('flight', 'speedSet', {
          mode: 'fly',
          value: 'walking-speed',
          hover: true,
          duration: duration(1, 'hour'),
          onExpiryWhileAirborne: 'fall unless another means keeps you aloft',
        }),
      ],
    ),
  ],
  [
    'Potion of Gaseous Form',
    potion(
      [
        'gaseous form spell for 1 hour',
        'no concentration required',
        'end the effect as a bonus action',
      ],
      [
        spell('gaseous-form', 'spell:gaseous-form', {
          duration: duration(1, 'hour'),
          concentrationRequired: false,
          earlyEndActivation: 'bonus-action',
        }),
      ],
      [{ engine: 'F4', hook: 'spell effect application' }],
    ),
  ],
  [
    'Potion of Giant Strength',
    potion(
      [
        'Strength score changes for 1 hour',
        'potion has no effect on you if your Strength is equal to or greater',
      ],
      [
        effect('giant-strength', 'abilityScoreSet', {
          ability: 'strength',
          tableRef: 'table:potion-of-giant-strength',
          duration: duration(1, 'hour'),
          floor: true,
        }),
      ],
      undefined,
      [
        {
          id: 's-giant-strength-table',
          tag: 'S',
          representation: {
            block: 'structuredField',
            field: 'effects.giant-strength.tableRef',
            ref: 'table:potion-of-giant-strength',
          },
        },
      ],
    ),
  ],
  [
    'Potion of Growth',
    potion(
      [
        '“enlarge” effect of the enlarge/reduce spell for 1d4 hours',
        'no concentration required',
      ],
      [
        spell('enlarge', 'spell:enlarge-reduce', {
          mode: 'enlarge',
          duration: duration('1d4', 'hour'),
          concentrationRequired: false,
        }),
      ],
      [{ engine: 'F4', hook: 'spell effect application' }],
    ),
  ],
  [
    'Potion of Healing',
    potion(
      [
        'number of hit points depends on the potion’s rarity',
        'Potions of Healing table',
      ],
      [
        effect('healing', 'healing', {
          tableRef: 'table:potions-of-healing',
          selectRowBy: 'item rarity',
        }),
      ],
      [
        { engine: 'F6', hook: 'hit-point restoration' },
        { engine: 'F9', hook: 'table row resolution by rarity' },
      ],
      [
        {
          id: 's-healing-potency-table',
          tag: 'S',
          representation: {
            block: 'structuredField',
            field: 'effects.healing.tableRef',
            ref: 'table:potions-of-healing',
          },
        },
      ],
    ),
  ],
  [
    'Potion of Heroism',
    potion(
      [
        'gain 10 temporary hit points that last for 1 hour',
        'bless spell (no concentration required)',
      ],
      [
        effect('heroic-temporary-hit-points', 'temporaryHitPoints', {
          amount: 10,
          duration: duration(1, 'hour'),
        }),
        spell('bless', 'spell:bless', {
          duration: duration(1, 'hour'),
          concentrationRequired: false,
        }),
      ],
      [
        { engine: 'F6', hook: 'temporary hit point ownership and duration' },
        { engine: 'F4', hook: 'spell effect application' },
      ],
    ),
  ],
  [
    'Potion of Invisibility',
    potion(
      [
        'become invisible for 1 hour',
        'effect ends early if you attack or cast a spell',
      ],
      [
        effect('invisibility', 'visibility', {
          state: 'invisible',
          includesWornAndCarried: true,
          duration: duration(1, 'hour'),
          endsOn: ['attack', 'cast-spell'],
        }),
      ],
    ),
  ],
  [
    'Potion of Mind Reading',
    potion(
      ['detect thoughts spell (save DC 13)'],
      [spell('detect-thoughts', 'spell:detect-thoughts', { saveDc: 13 })],
      [{ engine: 'F4', hook: 'spell effect application' }],
    ),
  ],
  [
    'Potion of Poison',
    potion(
      [
        'actually poison masked by illusion magic',
        'take 3d6 poison damage',
        'damage you take on your subsequent turns decreases by 1d6',
      ],
      [
        effect('poison', 'triggeredEffect', {
          trigger: 'drink the disguised potion',
          initialDamage: { dice: '3d6', type: 'poison' },
          save: { ability: 'constitution', dc: 13 },
          failedSaveCondition: 'poisoned',
          recurringDamage: { dice: '3d6', timing: 'start of each turn' },
          repeatSave: 'end of each turn',
          successReductionDice: '1d6',
          endsWhenDamageDice: 0,
          revealedBy: 'spell:identify',
        }),
      ],
      [
        {
          engine: 'F6',
          hook: 'damage, poisoned condition, and turn lifecycle',
        },
      ],
    ),
  ],
  [
    'Potion of Resistance',
    potion(
      [
        'gain resistance to one type of damage for 1 hour',
        'determines it randomly from the options below',
      ],
      [
        effect('damage-resistance', 'damageResistance', {
          typeFrom: 'table:potion-of-resistance',
          duration: duration(1, 'hour'),
        }),
      ],
      undefined,
      [
        {
          id: 's-resistance-type-table',
          tag: 'S',
          representation: {
            block: 'structuredField',
            field: 'effects.damage-resistance.typeFrom',
            ref: 'table:potion-of-resistance',
          },
        },
      ],
    ),
  ],
  [
    'Potion of Speed',
    potion(
      ['haste spell for 1 minute', 'no concentration required'],
      [
        spell('haste', 'spell:haste', {
          duration: duration(1, 'minute'),
          concentrationRequired: false,
        }),
      ],
      [{ engine: 'F4', hook: 'spell effect application' }],
    ),
  ],
  [
    'Potion of Water Breathing',
    potion(
      ['breathe underwater for 1 hour after drinking'],
      [
        effect('water-breathing', 'breathes', {
          environments: ['water'],
          duration: duration(1, 'hour'),
        }),
      ],
    ),
  ],
  [
    'Restorative Ointment',
    {
      sourcePhrases: [
        'contains 1d4 + 1 doses',
        'one dose of the ointment can be swallowed or applied to the skin',
        'regains 2d8 + 2 hit points',
      ],
      economies: { doses: doses('1d4+1', 'doses') },
      operations: [
        operation(
          'use-ointment',
          'doses',
          ['ointment-healing', 'ointment-restoration'],
          {
            cost: 'action',
            target: 'creature swallowing it or receiving it on the skin',
          },
        ),
      ],
      effects: [
        effect('ointment-healing', 'healing', { dice: '2d8+2' }),
        effect('ointment-restoration', 'conditionEndsWhen', {
          ends: ['poisoned', 'any-disease'],
        }),
      ],
      primaryEconomy: 'doses',
      engineHooks: [{ engine: 'F6', hook: 'hit-point and condition mutation' }],
    },
  ],
  [
    'Sovereign Glue',
    {
      sourcePhrases: [
        'contains 1d6 + 1 ounces',
        'One ounce of the glue can cover a 1-foot square surface',
        'takes 1 minute to set',
      ],
      economies: { doses: doses('1d6+1', 'ounces') },
      operations: [
        operation('apply-glue', 'doses', ['adhesive-bond'], {
          cost: 'consume',
          target: '1-square-foot surface',
        }),
      ],
      effects: [
        effect('adhesive-bond', 'objectInteraction', {
          coverageSquareFeetPerDose: 1,
          settingDuration: duration(1, 'minute'),
          result: 'permanent adhesive bond between two objects',
          removableOnlyBy: [
            'magic-item:universal-solvent',
            'magic-item:oil-of-etherealness',
            'spell:wish',
          ],
        }),
      ],
      primaryEconomy: 'doses',
    },
  ],
  [
    'Universal Solvent',
    {
      sourcePhrases: [
        'use an action to pour the contents of the tube',
        'instantly dissolves up to 1 square foot of adhesive',
        'including sovereign glue',
      ],
      economies: { quantity: quantity() },
      operations: [
        operation('pour-solvent', 'quantity', ['dissolve-adhesive'], {
          cost: 'action',
          target: 'surface within reach',
        }),
      ],
      effects: [
        effect('dissolve-adhesive', 'objectInteraction', {
          maximumAreaSquareFeet: 1,
          effect: 'instantly dissolves adhesive touched',
          includes: 'magic-item:sovereign-glue',
        }),
      ],
      primaryEconomy: 'quantity',
    },
  ],
  [
    'Spell Scroll',
    {
      sourcePhrases: [
        'If the spell is on your class’s spell list',
        'DC equals 10 + the spell’s level',
        'On a failed check, the spell disappears from the scroll',
        'Whether the check succeeds or fails, the spell scroll is destroyed',
      ],
      economies: { quantity: quantity() },
      operations: [
        operation(
          'cast-spell',
          'quantity',
          ['scroll-casting-procedure'],
          {
            cost: 'consume',
            requirement: 'scroll spell is on a class spell list of the reader',
            note: 'Uses the spell’s normal casting time.',
          },
          1,
          'Interrupted casting does not expend the scroll; success or a failed higher-level check expends it.',
        ),
        operation(
          'copy-spell',
          'quantity',
          ['scroll-copying-procedure'],
          {
            cost: 'consume',
            requirement:
              'wizard spell copied using the spellbook-copying procedure',
          },
          1,
          'Destroy the scroll whether the Arcana check succeeds or fails.',
        ),
      ],
      effects: [
        effect('scroll-casting-procedure', 'castSpell', {
          spellFromItem: true,
          intelligibleOnlyIfOnReaderClassList: true,
          materialComponentsRequired: false,
          castingTime: 'spell-normal',
          higherThanNormallyCastableCheck: {
            ability: 'reader spellcasting ability',
            dcFormula: '10 + spell level',
            onFailure: 'spell disappears with no other effect',
          },
          interruptedCasting: 'scroll not lost',
          saveDcAndAttackBonusTableRef: 'table:spell-scroll',
        }),
        effect('scroll-copying-procedure', 'makeAbilityCheck', {
          eligibility:
            'wizard spell copied as spells in spellbooks can be copied',
          ability: 'intelligence',
          skill: 'arcana',
          dcFormula: '10 + spell level',
          onSuccess: 'spell copied',
          onSuccessOrFailure: 'scroll destroyed',
        }),
      ],
      primaryEconomy: 'quantity',
      engineHooks: [
        {
          engine: 'F4',
          hook: 'class spell-list eligibility and casting/copying procedure',
        },
        {
          engine: 'F8',
          hook: 'spellcasting-ability and Intelligence (Arcana) checks',
        },
        {
          engine: 'F9',
          hook: '10 + spell-level formula and scroll table resolution',
        },
      ],
      extraClauses: [
        {
          id: 'm9-scroll-casting-procedure',
          tag: 'M9',
          representation: {
            block: 'effects',
            effectId: 'scroll-casting-procedure',
          },
          engineHooks: [
            {
              engine: 'F4',
              hook: 'class spell-list eligibility and casting procedure',
            },
            { engine: 'F8', hook: 'spellcasting ability check' },
            { engine: 'F9', hook: '10 + spell-level DC formula' },
          ],
        },
        {
          id: 'm9-scroll-copying-procedure',
          tag: 'M9',
          representation: {
            block: 'effects',
            effectId: 'scroll-copying-procedure',
          },
          engineHooks: [
            { engine: 'F4', hook: 'wizard spellbook copying procedure' },
            { engine: 'F8', hook: 'Intelligence (Arcana) check' },
            { engine: 'F9', hook: '10 + spell-level DC formula' },
          ],
        },
        {
          id: 's-scroll-level-table',
          tag: 'S',
          representation: {
            block: 'structuredField',
            field:
              'effects.scroll-casting-procedure.saveDcAndAttackBonusTableRef',
            ref: 'table:spell-scroll',
          },
        },
      ],
    },
  ],
]);

/** Exact reviewed M1 census: 31 records. */
export const EXPECTED_MAGIC_ITEM_CONSUMABLE_NAMES: ReadonlySet<string> =
  new Set(specs.keys());

export function projectMagicItemConsumable(
  item: MagicItemExtraction,
): MagicItemFamilyProjection | undefined {
  const spec = specs.get(item.name);
  if (spec === undefined) return undefined;
  for (const phrase of spec.sourcePhrases) {
    if (!item.description.includes(phrase)) {
      throw new Error(
        `magic-item M1 consumable projection: expected source phrase ${JSON.stringify(phrase)} not found in "${item.name}" description`,
      );
    }
  }
  if (!Object.hasOwn(spec.economies, spec.primaryEconomy)) {
    throw new Error(
      `magic-item M1 consumable projection: primary economy ${JSON.stringify(spec.primaryEconomy)} is missing for "${item.name}"`,
    );
  }
  return {
    family: 'm1-consumables',
    mechanics: {
      economies: spec.economies,
      operations: spec.operations,
      effects: spec.effects,
    } satisfies Pick<
      MagicItemMechanics,
      'economies' | 'operations' | 'effects'
    >,
    clauses: [
      {
        id: `m1-${spec.primaryEconomy}`,
        tag: 'M1',
        representation: { block: 'economies', economyId: spec.primaryEconomy },
        ...(spec.engineHooks === undefined
          ? {}
          : { engineHooks: spec.engineHooks }),
      },
      ...(spec.extraClauses ?? []),
    ],
  };
}

/** Compatibility helper for focused compiler tests. */
export function deriveMagicItemConsumableMechanics(
  item: MagicItemExtraction,
):
  | Pick<MagicItemMechanics, 'economies' | 'operations' | 'effects'>
  | undefined {
  return projectMagicItemConsumable(item)?.mechanics as
    | Pick<MagicItemMechanics, 'economies' | 'operations' | 'effects'>
    | undefined;
}
