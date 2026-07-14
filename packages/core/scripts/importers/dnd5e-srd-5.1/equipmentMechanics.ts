import type { EquipmentExtraction } from './types.js';

export type EquipmentConsumption =
  | { readonly kind: 'not-consumed' }
  | { readonly kind: 'inventory-unit'; readonly quantity: 1 }
  | { readonly kind: 'ammunition'; readonly quantity: 1 }
  | {
      readonly kind: 'finite-uses';
      readonly maximum: number;
      readonly usesPerActivation: number;
      readonly reset: 'none';
    }
  | { readonly kind: 'source-defined'; readonly clause: string };

export interface EquipmentClause {
  readonly id: string;
  readonly sourcePhrase: string;
  readonly semantics: Readonly<Record<string, unknown>>;
  readonly owner: 'F2' | 'F3' | 'F5' | 'F9' | 'inventory' | 'model';
}

export interface EquipmentMechanicsSpec {
  readonly recordKey: string;
  readonly pages: readonly number[];
  readonly clauses: readonly EquipmentClause[];
  readonly consumption: EquipmentConsumption;
  readonly modelAdjudicatedQualifiers?: readonly string[];
}

const clause = (
  id: string,
  sourcePhrase: string,
  owner: EquipmentClause['owner'],
  semantics: Readonly<Record<string, unknown>>,
): EquipmentClause => ({ id, sourcePhrase, owner, semantics });

/**
 * Sole executable source for reviewed exceptional equipment semantics. Regular
 * armor and weapon-table facts are parsed structurally in parseEquipment.ts.
 * Every phrase below is matched against the emitted source description before
 * projection, so PDF/source drift fails instead of retaining stale semantics.
 */
export const EQUIPMENT_MECHANICS_SPECS: readonly EquipmentMechanicsSpec[] = [
  {
    recordKey: 'equipment:acid-vial',
    pages: [66, 69],
    consumption: { kind: 'inventory-unit', quantity: 1 },
    clauses: [
      clause('activation', 'As an action', 'F2', { timing: 'action' }),
      clause(
        'delivery',
        'splash the contents of this vial onto a creature within 5 feet of you or throw the vial up to 20 feet',
        'model',
        {
          splashRangeFeet: 5,
          thrownRangeFeet: 20,
          targets: ['creature', 'object'],
        },
      ),
      clause(
        'attack',
        'make a ranged attack against a creature or object, treating the acid as an improvised weapon',
        'F9',
        { kind: 'ranged-weapon-attack', proficiency: 'improvised-weapon' },
      ),
      clause('damage', '2d6 acid damage', 'F9', {
        kind: 'damage',
        dice: '2d6',
        damageType: 'acid',
        trigger: 'hit',
      }),
    ],
  },
  {
    recordKey: 'equipment:alchemists-fire-flask',
    pages: [66, 69],
    consumption: { kind: 'inventory-unit', quantity: 1 },
    clauses: [
      clause('activation', 'As an action', 'F2', { timing: 'action' }),
      clause(
        'attack',
        "Make a ranged attack against a creature or object, treating the alchemist's fire as an improvised weapon",
        'F9',
        {
          kind: 'ranged-weapon-attack',
          rangeFeet: 20,
          proficiency: 'improvised-weapon',
        },
      ),
      clause(
        'damage',
        '1d4 fire damage at the start of each of its turns',
        'F9',
        {
          kind: 'damage',
          dice: '1d4',
          damageType: 'fire',
          trigger: 'start-of-affected-turn',
          repeats: true,
        },
      ),
      clause(
        'extinguish',
        'using its action to make a DC 10 Dexterity check to extinguish the flames',
        'F2',
        {
          timing: 'action',
          check: { ability: 'dexterity', dc: 10 },
          outcome: 'ends-effect',
        },
      ),
    ],
  },
  {
    recordKey: 'equipment:antitoxin-vial',
    pages: [66, 69],
    consumption: { kind: 'inventory-unit', quantity: 1 },
    clauses: [
      clause(
        'benefit',
        'gains advantage on saving throws against poison for 1 hour',
        'F3',
        {
          kind: 'saving-throw-advantage',
          against: 'poison',
          duration: { value: 1, unit: 'hour' },
          ineligibleCreatureTypes: ['undead', 'construct'],
        },
      ),
    ],
  },
  {
    recordKey: 'equipment:ball-bearings-bag-of-1-000',
    pages: [67, 69],
    consumption: {
      kind: 'source-defined',
      clause: 'spill these tiny metal balls from their pouch',
    },
    clauses: [
      clause(
        'placement',
        'As an action, you can spill these tiny metal balls from their pouch to cover a level, square area that is 10 feet on a side',
        'F2',
        {
          timing: 'action',
          area: { shape: 'square', sideFeet: 10 },
          surface: 'level',
        },
      ),
      clause('save', 'DC 10 Dexterity saving throw or fall prone', 'F3', {
        save: { ability: 'dexterity', dc: 10 },
        failureCondition: 'prone',
      }),
      clause(
        'avoidance',
        'moving through the area at half speed doesn’t need to make the save',
        'model',
        { avoidsSaveAtSpeedFraction: 0.5 },
      ),
    ],
  },
  {
    recordKey: 'equipment:caltrops-bag-of-20',
    pages: [67, 69],
    consumption: { kind: 'source-defined', clause: 'spread a bag of caltrops' },
    clauses: [
      clause(
        'placement',
        'As an action, you can spread a bag of caltrops to cover a square area that is 5 feet on a side',
        'F2',
        { timing: 'action', area: { shape: 'square', sideFeet: 5 } },
      ),
      clause(
        'save-damage',
        'DC 15 Dexterity saving throw or stop moving this turn and take 1 piercing damage',
        'F9',
        {
          save: { ability: 'dexterity', dc: 15 },
          failure: {
            stopMoving: 'current-turn',
            damage: { flat: 1, damageType: 'piercing' },
          },
        },
      ),
      clause(
        'speed',
        'reduces the creature’s walking speed by 10 feet until the creature regains at least 1 hit point',
        'F3',
        {
          speedReductionFeet: 10,
          mode: 'walking',
          endsWhenHitPointsRegainedAtLeast: 1,
        },
      ),
      clause(
        'avoidance',
        'moving through the area at half speed doesn’t need to make the save',
        'model',
        { avoidsSaveAtSpeedFraction: 0.5 },
      ),
    ],
  },
  {
    recordKey: 'equipment:healers-kit',
    pages: [67, 69],
    consumption: {
      kind: 'finite-uses',
      maximum: 10,
      usesPerActivation: 1,
      reset: 'none',
    },
    clauses: [
      clause(
        'stabilize',
        'As an action, you can expend one use of the kit to stabilize a creature that has 0 hit points, without needing to make a Wisdom (Medicine) check',
        'F5',
        {
          timing: 'action',
          targetHitPoints: 0,
          outcome: 'stable',
          bypassesCheck: { ability: 'wisdom', skill: 'medicine' },
        },
      ),
    ],
  },
  {
    recordKey: 'equipment:hunting-trap',
    pages: [67, 69],
    consumption: { kind: 'not-consumed' },
    clauses: [
      clause('placement', 'use your action to set it', 'F2', {
        timing: 'action',
        placement: 'pressure-plate',
        anchored: true,
      }),
      clause(
        'trigger',
        'DC 13 Dexterity saving throw or take 1d4 piercing damage and stop moving',
        'F9',
        {
          save: { ability: 'dexterity', dc: 13 },
          failure: {
            damage: { dice: '1d4', damageType: 'piercing' },
            stopMoving: true,
          },
        },
      ),
      clause(
        'tether',
        'movement is limited by the length of the chain (typically 3 feet long)',
        'model',
        { tetherLengthFeet: 3 },
      ),
      clause(
        'escape',
        'use its action to make a DC 13 Strength check, freeing itself or another creature within its reach on a success',
        'F2',
        {
          timing: 'action',
          check: { ability: 'strength', dc: 13 },
          target: ['self', 'creature-within-reach'],
        },
      ),
      clause(
        'failed-escape',
        'Each failed check deals 1 piercing damage',
        'F9',
        {
          damage: { flat: 1, damageType: 'piercing' },
          trigger: 'failed-escape-check',
        },
      ),
    ],
  },
  {
    recordKey: 'equipment:holy-water-flask',
    pages: [67, 69],
    consumption: { kind: 'inventory-unit', quantity: 1 },
    clauses: [
      clause('activation', 'As an action', 'F2', { timing: 'action' }),
      clause(
        'attack',
        'make a ranged attack against a target creature, treating the holy water as an improvised weapon',
        'F9',
        {
          kind: 'ranged-weapon-attack',
          splashRangeFeet: 5,
          thrownRangeFeet: 20,
          proficiency: 'improvised-weapon',
        },
      ),
      clause(
        'damage',
        'If the target is a fiend or undead, it takes 2d6 radiant damage',
        'F9',
        {
          kind: 'damage',
          dice: '2d6',
          damageType: 'radiant',
          eligibleCreatureTypes: ['fiend', 'undead'],
        },
      ),
      clause(
        'creation',
        'ritual takes 1 hour to perform, uses 25 gp worth of powdered silver, and requires the caster to expend a 1st-level spell slot',
        'model',
        {
          duration: { value: 1, unit: 'hour' },
          materialCostGp: 25,
          spellSlotLevel: 1,
          creatorClasses: ['cleric', 'paladin'],
        },
      ),
    ],
  },
  {
    recordKey: 'equipment:lance',
    pages: [65, 66],
    consumption: { kind: 'not-consumed' },
    clauses: [
      clause(
        'close-disadvantage',
        'disadvantage when you use a lance to attack a target within 5 feet of you',
        'F9',
        { attackDisadvantageWithinFeet: 5 },
      ),
      clause(
        'unmounted-hands',
        'requires two hands to wield when you aren’t mounted',
        'model',
        { hands: 2, condition: 'wielder-not-mounted' },
      ),
    ],
  },
  {
    recordKey: 'equipment:net',
    pages: [65, 66],
    consumption: { kind: 'not-consumed' },
    clauses: [
      clause(
        'restrain',
        'A Large or smaller creature hit by a net is restrained until it is freed',
        'F3',
        {
          condition: 'restrained',
          maximumSize: 'large',
          trigger: 'hit',
          duration: 'until-freed',
        },
      ),
      clause(
        'ineffective',
        'no effect on creatures that are formless, or creatures that are Huge or larger',
        'model',
        { ineligible: ['formless', 'huge-or-larger'] },
      ),
      clause(
        'escape',
        'use its action to make a DC 10 Strength check, freeing itself or another creature within its reach on a success',
        'F2',
        {
          timing: 'action',
          check: { ability: 'strength', dc: 10 },
          target: ['self', 'creature-within-reach'],
        },
      ),
      clause(
        'destroy',
        'Dealing 5 slashing damage to the net (AC 10) also frees the creature without harming it, ending the effect and destroying the net',
        'F9',
        {
          objectArmorClass: 10,
          damageRequired: 5,
          requiredDamageType: 'slashing',
          outcome: ['free-creature', 'destroy-net'],
        },
      ),
      clause(
        'one-attack',
        'you can make only one attack regardless of the number of attacks you can normally make',
        'F2',
        {
          maximumAttacks: 1,
          expenditures: ['action', 'bonus-action', 'reaction'],
        },
      ),
    ],
  },
  {
    recordKey: 'equipment:poison-basic-vial',
    pages: [68, 69],
    consumption: { kind: 'inventory-unit', quantity: 1 },
    clauses: [
      clause(
        'application',
        'coat one slashing or piercing weapon or up to three pieces of ammunition',
        'model',
        {
          eligibleWeaponDamageTypes: ['slashing', 'piercing'],
          ammunitionMaximum: 3,
        },
      ),
      clause('activation', 'Applying the poison takes an action', 'F2', {
        timing: 'action',
      }),
      clause(
        'save-damage',
        'DC 10 Constitution saving throw or take 1d4 poison damage',
        'F9',
        {
          save: { ability: 'constitution', dc: 10 },
          failureDamage: { dice: '1d4', damageType: 'poison' },
        },
      ),
      clause('duration', 'retains potency for 1 minute before drying', 'F3', {
        duration: { value: 1, unit: 'minute' },
        ends: 'dries',
      }),
    ],
  },
  {
    recordKey: 'equipment:torch',
    pages: [68, 69],
    consumption: { kind: 'source-defined', clause: 'burns for 1 hour' },
    clauses: [
      clause(
        'light',
        'burns for 1 hour, providing bright light in a 20-foot radius and dim light for an additional 20 feet',
        'F3',
        {
          duration: { value: 1, unit: 'hour' },
          light: { shape: 'radius', brightFeet: 20, dimAdditionalFeet: 20 },
        },
      ),
      clause(
        'attack',
        'make a melee attack with a burning torch and hit, it deals 1 fire damage',
        'F9',
        {
          kind: 'melee-weapon-attack',
          damage: { flat: 1, damageType: 'fire' },
          requires: 'burning',
        },
      ),
    ],
  },
  {
    recordKey: 'equipment:candle',
    pages: [67, 69],
    consumption: { kind: 'source-defined', clause: 'For 1 hour' },
    clauses: [
      clause(
        'light',
        'For 1 hour, a candle sheds bright light in a 5-foot radius and dim light for an additional 5 feet',
        'F3',
        {
          duration: { value: 1, unit: 'hour' },
          light: { shape: 'radius', brightFeet: 5, dimAdditionalFeet: 5 },
        },
      ),
    ],
  },
  {
    recordKey: 'equipment:chain-10-feet',
    pages: [67, 69],
    consumption: { kind: 'not-consumed' },
    clauses: [
      clause('durability', 'A chain has 10 hit points', 'F9', {
        hitPoints: 10,
      }),
      clause('burst', 'burst with a successful DC 20 Strength check', 'F9', {
        check: { ability: 'strength', dc: 20 },
        outcome: 'broken',
      }),
    ],
  },
  {
    recordKey: 'equipment:climbers-kit',
    pages: [67, 69],
    consumption: { kind: 'not-consumed' },
    clauses: [
      clause(
        'anchor',
        'use the climber’s kit as an action to anchor yourself; when you do, you can’t fall more than 25 feet from the point where you anchored yourself, and you can’t climb more than 25 feet away from that point without undoing the anchor',
        'model',
        {
          timing: 'action',
          maximumFallFeet: 25,
          maximumDistanceFromAnchorFeet: 25,
          ends: 'anchor-undone',
        },
      ),
    ],
  },
  {
    recordKey: 'equipment:crowbar',
    pages: [67, 69],
    consumption: { kind: 'not-consumed' },
    clauses: [
      clause(
        'leverage',
        'grants advantage to Strength checks where the crowbar’s leverage can be applied',
        'F9',
        {
          checkAdvantage: { ability: 'strength' },
          qualifier: 'leverage-can-be-applied',
        },
      ),
    ],
  },
  {
    recordKey: 'equipment:lamp',
    pages: [68, 69],
    consumption: {
      kind: 'source-defined',
      clause: 'burns for 6 hours on a flask (1 pint) of oil',
    },
    clauses: [
      clause(
        'light',
        'casts bright light in a 15-foot radius and dim light for an additional 30 feet',
        'F3',
        {
          light: { shape: 'radius', brightFeet: 15, dimAdditionalFeet: 30 },
          fuel: { item: 'oil', pints: 1, durationHours: 6 },
        },
      ),
    ],
  },
  {
    recordKey: 'equipment:lantern-bullseye',
    pages: [68, 69],
    consumption: {
      kind: 'source-defined',
      clause: 'burns for 6 hours on a flask (1 pint) of oil',
    },
    clauses: [
      clause(
        'light',
        'casts bright light in a 60-foot cone and dim light for an additional 60 feet',
        'F3',
        {
          light: { shape: 'cone', brightFeet: 60, dimAdditionalFeet: 60 },
          fuel: { item: 'oil', pints: 1, durationHours: 6 },
        },
      ),
    ],
  },
  {
    recordKey: 'equipment:lantern-hooded',
    pages: [68, 69],
    consumption: {
      kind: 'source-defined',
      clause: 'burns for 6 hours on a flask (1 pint) of oil',
    },
    clauses: [
      clause(
        'light',
        'casts bright light in a 30-foot radius and dim light for an additional 30 feet',
        'F3',
        {
          light: { shape: 'radius', brightFeet: 30, dimAdditionalFeet: 30 },
          fuel: { item: 'oil', pints: 1, durationHours: 6 },
        },
      ),
      clause(
        'hood',
        'As an action, you can lower the hood, reducing the light to dim light in a 5-foot radius',
        'F2',
        {
          timing: 'action',
          light: { shape: 'radius', dimFeet: 5, brightFeet: 0 },
        },
      ),
    ],
  },
  {
    recordKey: 'equipment:lock',
    pages: [68, 69],
    consumption: { kind: 'not-consumed' },
    clauses: [
      clause(
        'pick',
        'creature proficient with thieves’ tools can pick this lock with a successful DC 15 Dexterity check',
        'F9',
        {
          check: { ability: 'dexterity', dc: 15, proficiency: 'thieves-tools' },
          outcome: 'unlocked',
        },
      ),
    ],
    modelAdjudicatedQualifiers: [
      'The GM may make better locks available at higher prices.',
    ],
  },
  {
    recordKey: 'equipment:manacles',
    pages: [68, 69],
    consumption: { kind: 'not-consumed' },
    clauses: [
      clause('eligibility', 'can bind a Small or Medium creature', 'model', {
        eligibleSizes: ['small', 'medium'],
      }),
      clause(
        'escape',
        'Escaping the manacles requires a successful DC 20 Dexterity check',
        'F9',
        { check: { ability: 'dexterity', dc: 20 }, outcome: 'escaped' },
      ),
      clause(
        'break',
        'Breaking them requires a successful DC 20 Strength check',
        'F9',
        { check: { ability: 'strength', dc: 20 }, outcome: 'broken' },
      ),
      clause(
        'pick',
        'proficient with thieves’ tools can pick the manacles’ lock with a successful DC 15 Dexterity check',
        'F9',
        {
          check: { ability: 'dexterity', dc: 15, proficiency: 'thieves-tools' },
          outcome: 'unlocked',
        },
      ),
      clause('durability', 'Manacles have 15 hit points', 'F9', {
        hitPoints: 15,
      }),
    ],
  },
  {
    recordKey: 'equipment:oil-flask',
    pages: [68, 69],
    consumption: { kind: 'inventory-unit', quantity: 1 },
    clauses: [
      clause(
        'attack',
        'throw it up to 20 feet, shattering it on impact. Make a ranged attack against a target creature or object, treating the oil as an improvised weapon',
        'F9',
        {
          timing: 'action',
          splashRangeFeet: 5,
          thrownRangeFeet: 20,
          proficiency: 'improvised-weapon',
        },
      ),
      clause(
        'coating',
        'If the target takes any fire damage before the oil dries (after 1 minute), the target takes an additional 5 fire damage',
        'F9',
        {
          duration: { value: 1, unit: 'minute' },
          triggerDamageType: 'fire',
          additionalDamage: { flat: 5, damageType: 'fire' },
        },
      ),
      clause(
        'area',
        'cover a 5-foot-square area, provided that the surface is level',
        'model',
        { area: { shape: 'square', sideFeet: 5 }, surface: 'level' },
      ),
      clause(
        'burning-area',
        'burns for 2 rounds and deals 5 fire damage to any creature that enters the area or ends its turn in the area',
        'F9',
        {
          duration: { value: 2, unit: 'round' },
          damage: { flat: 5, damageType: 'fire' },
          triggers: ['enters-area', 'ends-turn-in-area'],
          maximumPerTurn: 1,
        },
      ),
    ],
  },
  {
    recordKey: 'equipment:ram-portable',
    pages: [68, 69],
    consumption: { kind: 'not-consumed' },
    clauses: [
      clause(
        'break-door',
        'gain a +4 bonus on the Strength check. One other character can help you use the ram, giving you advantage on this check',
        'F9',
        {
          check: { ability: 'strength', modifier: 4 },
          help: { maximumHelpers: 1, grants: 'advantage' },
          target: 'door',
        },
      ),
    ],
  },
  ...(
    ['equipment:rope-hempen-50-feet', 'equipment:rope-silk-50-feet'] as const
  ).map((recordKey) => ({
    recordKey,
    pages: [68, 69] as const,
    consumption: { kind: 'not-consumed' } as const,
    clauses: [
      clause('durability', 'has 2 hit points', 'F9', { hitPoints: 2 }),
      clause('burst', 'burst with a DC 17 Strength check', 'F9', {
        check: { ability: 'strength', dc: 17 },
        outcome: 'broken',
      }),
    ],
  })),
  {
    recordKey: 'equipment:tinderbox',
    pages: [68, 69],
    consumption: { kind: 'not-consumed' },
    clauses: [
      clause(
        'exposed-fuel',
        'light a torch—or anything else with abundant, exposed fuel—takes an action',
        'F2',
        { timing: 'action', targetFuel: 'abundant-exposed' },
      ),
      clause('other-fire', 'Lighting any other fire takes 1 minute', 'model', {
        duration: { value: 1, unit: 'minute' },
      }),
    ],
  },
] as const;

const keySet = new Set(EQUIPMENT_MECHANICS_SPECS.map((spec) => spec.recordKey));
if (keySet.size !== EQUIPMENT_MECHANICS_SPECS.length)
  throw new Error('duplicate equipment mechanics record key');
for (const spec of EQUIPMENT_MECHANICS_SPECS) {
  const ids = new Set(spec.clauses.map((entry) => entry.id));
  if (ids.size !== spec.clauses.length || spec.clauses.length === 0)
    throw new Error(`${spec.recordKey}: duplicate or empty clause ids`);
}

function pagesFor(item: EquipmentExtraction): number[] {
  return [
    ...new Set(
      [item.sourcePage, item.descriptionSourcePage].filter(
        (page): page is number => page !== undefined,
      ),
    ),
  ].sort((a, b) => a - b);
}

export function equipmentMechanicsFor(
  item: EquipmentExtraction,
  recordKey: string,
): Record<string, unknown> | undefined {
  const spec = EQUIPMENT_MECHANICS_SPECS.find(
    (entry) => entry.recordKey === recordKey,
  );
  if (spec === undefined) return undefined;
  const actualPages = pagesFor(item);
  if (JSON.stringify(actualPages) !== JSON.stringify(spec.pages))
    throw new Error(
      `${recordKey}: source pages drifted; expected ${spec.pages.join(',')}, got ${actualPages.join(',')}`,
    );
  if (item.description === undefined)
    throw new Error(
      `${recordKey}: reviewed mechanics source description disappeared`,
    );
  for (const entry of spec.clauses) {
    if (!item.description.includes(entry.sourcePhrase))
      throw new Error(
        `${recordKey}#${entry.id}: bound source phrase drifted: ${JSON.stringify(entry.sourcePhrase)}`,
      );
  }
  return {
    consumption: spec.consumption,
    clauses: spec.clauses.map(({ id, sourcePhrase, owner, semantics }) => ({
      id,
      sourcePhrase,
      owner,
      semantics,
    })),
    ...(spec.modelAdjudicatedQualifiers === undefined
      ? {}
      : { modelAdjudicatedQualifiers: spec.modelAdjudicatedQualifiers }),
  };
}
