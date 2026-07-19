/** Source-grounded M9 spell interop and M10 roll-transform projections. */
import type {
  MagicItemMechanics,
  MagicItemOperation,
  MagicItemRollManipulation,
  MagicItemSpellContract,
  MagicItemSpellStore,
} from '../../../src/rules/magicItemMechanics.js';
import type {
  EngineHookBinding,
  ItemClauseExpectation,
  MagicItemFamilyProjection,
} from './magicItemCompiler.js';
import type { MagicItemExtraction, MagicItemVariant } from './types.js';

interface SourceClause {
  readonly id: string;
  readonly tag: 'M9' | 'M10';
  readonly phrase: string;
  readonly block: 'spellStore' | 'rollManipulation';
  readonly hooks: readonly EngineHookBinding[];
}

interface ProjectionSpec {
  readonly spellStore?: MagicItemSpellStore;
  readonly rollManipulation?: MagicItemRollManipulation;
  readonly economies?: NonNullable<MagicItemMechanics['economies']>;
  readonly operations?: readonly MagicItemOperation[];
  readonly clauses: readonly SourceClause[];
}

const F1 = {
  engine: 'F1',
  hook: 'shared seeded roll selection and roll replacement',
} as const;
const F4 = {
  engine: 'F4',
  hook: 'shared spell-slot, spell-casting, and caster-of-record execution',
} as const;
const F5 = {
  engine: 'F5',
  hook: 'per-item storage, charge, and reset state',
} as const;
const F9 = {
  engine: 'F9',
  hook: 'deterministic roll, save, check, and reflection transform',
} as const;

const clause = (
  id: string,
  tag: SourceClause['tag'],
  phrase: string,
  block: SourceClause['block'],
  hooks: readonly EngineHookBinding[],
): SourceClause => ({
  id: `${tag.toLowerCase()}-${id}`,
  tag,
  phrase,
  block,
  hooks,
});

const operation = (
  id: string,
  activation: NonNullable<MagicItemOperation['activation']>,
  rest: Omit<MagicItemOperation, 'id' | 'activation'> = {},
): MagicItemOperation => ({ id, activation, ...rest });

const spellStorage = (
  id: string,
  capacityLevels: number,
  maximumSpellLevel: number,
  initialLevels: string,
  wearer: string,
): MagicItemSpellContract => ({
  id,
  kind: 'spell-storage',
  capacityLevels,
  maximumSpellLevel,
  initialLevels,
  casterOfRecord:
    'slot level, spell save DC, spell attack bonus, and spellcasting ability of original caster',
  storeOn: {
    cost: 'free',
    trigger: 'spell is cast while caster touches item',
    requirement: `spell level 1 through ${maximumSpellLevel}; caster touches item`,
    note: 'Uses the spell’s normal casting time; spell has no effect and is stored; an over-capacity spell is expended without effect.',
  },
  castOut: {
    cost: 'free',
    requirement: wearer,
    note: 'Uses the spell’s normal casting time; cast as item user except caster-of-record values; remove spell and free its slot-level space.',
  },
  operationIds: [`m9-store-${id}`, `m9-cast-${id}`],
});

const DIRECT_SPECS: ReadonlyMap<string, ProjectionSpec> = new Map<
  string,
  ProjectionSpec
>([
  [
    'Ring of Spell Storing',
    {
      spellStore: {
        contracts: [
          spellStorage(
            'ring-spell',
            5,
            5,
            '1d6-1',
            'attuned wearer wearing ring',
          ),
        ],
        note: 'Stored-spell identities and occupied levels are live item_state, never pack state.',
      },
      operations: [
        operation('m9-store-ring-spell', {
          cost: 'free',
          trigger: 'spell is cast while caster touches ring',
        }),
        operation('m9-cast-ring-spell', {
          cost: 'free',
          requirement: 'attuned wearer is wearing ring',
        }),
      ],
      clauses: [
        clause(
          'ring-capacity',
          'M9',
          'store up to 5 levels worth of spells at a time',
          'spellStore',
          [F4, F5],
        ),
        clause(
          'ring-initial',
          'M9',
          'contains 1d6 − 1 levels of stored spells chosen by the GM',
          'spellStore',
          [F4, F5],
        ),
        clause(
          'ring-overflow',
          'M9',
          'If the ring can’t hold the spell, the spell is expended without effect',
          'spellStore',
          [F4, F5],
        ),
        clause(
          'ring-caster',
          'M9',
          'spell save DC, spell attack bonus, and spellcasting ability of the original caster',
          'spellStore',
          [F4, F9],
        ),
        clause(
          'ring-free-space',
          'M9',
          'no longer stored in it, freeing up space',
          'spellStore',
          [F4, F5],
        ),
      ],
    },
  ],
  [
    'Rod of Absorption',
    {
      spellStore: {
        contracts: [
          {
            id: 'rod-energy',
            kind: 'spell-energy',
            capacityLevels: 50,
            lifetimeCapacityLevels: 50,
            maximumSpellLevel: 5,
            initialLevels: '1d10',
            absorbOn: {
              cost: 'reaction',
              trigger: 'spell targets only holder and is not area of effect',
              result: 'cancel spell and store energy equal to cast level',
            },
            castOut: {
              cost: 'spell-normal-casting-time',
              requirement: 'spellcaster holding rod; spell prepared or known',
              result:
                'spend stored energy in place of slot, at level no higher than own slots and at most 5th',
            },
            operationIds: ['m9-absorb-rod-spell', 'm9-cast-with-rod-energy'],
            onExhausted:
              'when lifetime absorbed levels equal 50 and current stored energy is 0, rod becomes nonmagical',
            note: 'Lifetime absorbed and currently stored energy are distinct live item_state counters.',
          },
        ],
      },
      operations: [
        operation('m9-absorb-rod-spell', {
          cost: 'reaction',
          trigger: 'eligible spell targets only holder',
        }),
        operation('m9-cast-with-rod-energy', {
          cost: 'free',
          requirement: 'known/prepared spell and eligible slot level',
        }),
      ],
      rollManipulation: {
        transforms: [
          {
            id: 'm10-rod-cancel',
            kind: 'cancel',
            trigger:
              'holder uses reaction against eligible single-target non-area spell',
            operationId: 'm9-absorb-rod-spell',
            condition: 'remaining lifetime capacity can store the spell level',
            replacement:
              'spell effect is canceled; store energy, not the spell',
          },
        ],
      },
      clauses: [
        clause(
          'rod-absorb',
          'M9',
          'spell’s energy—not the spell itself—is stored in the rod',
          'spellStore',
          [F4, F5],
        ),
        clause(
          'rod-lifetime',
          'M9',
          'up to 50 levels of energy over the course of its existence',
          'spellStore',
          [F4, F5],
        ),
        clause(
          'rod-slots',
          'M9',
          'convert energy stored in it into spell slots to cast spells you have prepared or know',
          'spellStore',
          [F4, F5],
        ),
        clause(
          'rod-slot-cap',
          'M9',
          'up to a maximum of 5th level',
          'spellStore',
          [F4],
        ),
        clause(
          'rod-initial',
          'M9',
          'newly found rod has 1d10 levels of spell energy stored',
          'spellStore',
          [F4, F5],
        ),
        clause(
          'rod-exhausted',
          'M9',
          'no longer absorb spell energy and has no energy remaining becomes nonmagical',
          'spellStore',
          [F5],
        ),
        clause(
          'rod-cancel',
          'M10',
          'absorbed spell’s effect is canceled',
          'rollManipulation',
          [F1, F4, F9],
        ),
      ],
    },
  ],
  [
    'Pearl of Power',
    {
      spellStore: {
        contracts: [
          {
            id: 'pearl-slot',
            kind: 'slot-recovery',
            maximumSpellLevel: 3,
            operationIds: ['regain-spell-slot'],
            condition:
              'choose one expended slot; if it was 4th level or higher, recover a 3rd-level slot instead',
            note: 'Shared F4 slot ledger performs recovery; item owns only its once-per-dawn use.',
          },
        ],
      },
      operations: [
        operation(
          'regain-spell-slot',
          { cost: 'action', commandWord: true },
          { cost: [{ economy: 'uses', amount: 1 }] },
        ),
      ],
      clauses: [
        clause(
          'pearl-slot',
          'M9',
          'regain one expended spell slot',
          'spellStore',
          [F4, F5],
        ),
        clause(
          'pearl-cap',
          'M9',
          'If the expended slot was of 4th level or higher, the new slot is 3rd level',
          'spellStore',
          [F4, F9],
        ),
      ],
    },
  ],
  [
    'Spell Scroll',
    {
      spellStore: {
        contracts: [
          {
            id: 'scroll-spell',
            kind: 'scroll-casting',
            casterOfRecord:
              'scroll table sets save DC and attack bonus by spell level',
            operationIds: ['cast-spell', 'copy-spell'],
            tableRefs: ['table:spell-scroll'],
            condition:
              'casting requires spell on reader class list; higher-than-normally-castable spell requires spellcasting ability check DC 10 + spell level',
            onExhausted:
              'cast success or failed higher-level check consumes scroll; copy attempt destroys scroll on success or failure; interrupted casting does not consume',
            note: 'The structured table determines rarity, save DC, and attack bonus.',
          },
        ],
      },
      clauses: [
        clause(
          'scroll-class-list',
          'M9',
          'If the spell is on your class’s spell list',
          'spellStore',
          [F4],
        ),
        clause(
          'scroll-higher-check',
          'M9',
          'DC equals 10 + the spell’s level',
          'spellStore',
          [F4, F9],
        ),
        clause(
          'scroll-failed-check',
          'M9',
          'On a failed check, the spell disappears from the scroll',
          'spellStore',
          [F4, F5],
        ),
        clause(
          'scroll-table',
          'M9',
          'determines the spell’s saving throw DC and attack bonus',
          'spellStore',
          [F4, F9],
        ),
        clause(
          'scroll-copy',
          'M9',
          'Whether the check succeeds or fails, the spell scroll is destroyed',
          'spellStore',
          [F4, F5, F9],
        ),
      ],
    },
  ],
  [
    'Candle of Invocation',
    {
      spellStore: {
        contracts: [
          {
            id: 'candle-free-casting',
            kind: 'free-casting',
            maximumSpellLevel: 1,
            operationIds: ['m9-cast-candle-spell'],
            condition:
              'cleric or druid in candle light whose alignment matches candle; spell must be prepared',
            note: 'No slot is expended and effect is always as if cast with a 1st-level slot.',
          },
        ],
      },
      operations: [
        operation(
          'm9-cast-candle-spell',
          {
            cost: 'free',
            requirement:
              'eligible matching-alignment cleric or druid in candle light',
          },
          { doesNotExpend: ['burn-time'] },
        ),
      ],
      clauses: [
        clause(
          'candle-free-casting',
          'M9',
          'without expending spell slots',
          'spellStore',
          [F4, F5],
        ),
        clause(
          'candle-slot-level',
          'M9',
          'spell’s effect is as if cast with a 1st-level slot',
          'spellStore',
          [F4],
        ),
      ],
    },
  ],
  [
    'Staff of the Magi',
    {
      spellStore: {
        contracts: [
          {
            id: 'staff-charge-absorption',
            kind: 'charge-absorption',
            capacityLevels: 50,
            absorbOn: {
              cost: 'reaction',
              trigger: 'another creature casts spell targeting only holder',
              result: 'cancel spell and gain charges equal to spell level',
            },
            operationIds: ['m9-absorb-staff-spell'],
            overflow:
              'if gained charges would raise total above 50, staff explodes as retributive strike',
            note: 'Shared item charge economy receives absorbed spell level; no private counter.',
          },
        ],
      },
      operations: [
        operation('m9-absorb-staff-spell', {
          cost: 'reaction',
          trigger: 'eligible spell targets only holder',
        }),
      ],
      clauses: [
        clause(
          'staff-absorb',
          'M9',
          'staff absorbs the magic of the spell, canceling its effect and gaining a number of charges equal to the absorbed spell’s level',
          'spellStore',
          [F4, F5],
        ),
        clause(
          'staff-overflow',
          'M9',
          'brings the staff’s total number of charges above 50, the staff explodes',
          'spellStore',
          [F4, F5, F9],
        ),
      ],
    },
  ],
  [
    'Luck Blade',
    {
      economies: {
        luck: {
          kind: 'per-day',
          perDay: { uses: 1 },
          reset: [{ at: 'dawn', amount: 'all' }],
        },
      },
      operations: [
        operation(
          'm10-use-luck',
          {
            cost: 'free',
            trigger:
              'after an attack roll, ability check, or saving throw bearer dislikes',
          },
          { cost: [{ economy: 'luck', amount: 1 }] },
        ),
      ],
      rollManipulation: {
        transforms: [
          {
            id: 'm10-luck-reroll',
            kind: 'reroll',
            roll: 'one attack roll, ability check, or saving throw',
            trigger: 'bearer calls on luck after disliking roll',
            operationId: 'm10-use-luck',
            limitEconomy: 'luck',
            replacement: 'must use second roll',
          },
        ],
      },
      clauses: [
        clause(
          'luck-reroll',
          'M10',
          'reroll one attack roll, ability check, or saving throw you dislike',
          'rollManipulation',
          [F1, F5, F9],
        ),
        clause(
          'luck-second',
          'M10',
          'must use the second roll',
          'rollManipulation',
          [F1, F9],
        ),
        clause(
          'luck-limit',
          'M10',
          'property can’t be used again until the next dawn',
          'rollManipulation',
          [F5],
        ),
      ],
    },
  ],
  [
    'Ring of Evasion',
    {
      operations: [
        operation(
          'turn-failed-dex-save-into-success',
          { cost: 'reaction', trigger: 'wearer fails Dexterity saving throw' },
          { cost: [{ economy: 'charges', amount: 1 }] },
        ),
      ],
      rollManipulation: {
        transforms: [
          {
            id: 'm10-evasion-success',
            kind: 'replace-fail',
            roll: 'Dexterity saving throw',
            trigger: 'wearer fails',
            operationId: 'turn-failed-dex-save-into-success',
            limitEconomy: 'charges',
            replacement: 'success',
          },
        ],
      },
      clauses: [
        clause(
          'evasion',
          'M10',
          'fail a Dexterity saving throw',
          'rollManipulation',
          [F1, F5, F9],
        ),
        clause(
          'evasion-success',
          'M10',
          'succeed on that saving throw instead',
          'rollManipulation',
          [F1, F9],
        ),
      ],
    },
  ],
  [
    'Scarab of Protection',
    {
      operations: [
        operation(
          'turn-failed-save-into-success',
          { cost: 'reaction', trigger: 'eligible failed save' },
          { cost: [{ economy: 'charges', amount: 1 }] },
        ),
      ],
      rollManipulation: {
        transforms: [
          {
            id: 'm10-scarab-success',
            kind: 'replace-fail',
            roll: 'saving throw',
            trigger: 'holder fails saving throw',
            operationId: 'turn-failed-save-into-success',
            limitEconomy: 'charges',
            condition:
              'save is against necromancy spell or harmful effect originating from undead',
            replacement: 'success',
          },
        ],
      },
      clauses: [
        clause(
          'scarab-trigger',
          'M10',
          'fail a saving throw against a necromancy spell or a harmful effect originating from an undead creature',
          'rollManipulation',
          [F1, F5, F9],
        ),
        clause(
          'scarab-success',
          'M10',
          'turn the failed save into a successful one',
          'rollManipulation',
          [F1, F9],
        ),
      ],
    },
  ],
  [
    'Staff of Charming',
    {
      economies: {
        'enchantment-save-flip': {
          kind: 'per-day',
          perDay: { uses: 1 },
          reset: [{ at: 'dawn', amount: 'all' }],
        },
      },
      operations: [
        operation(
          'm10-flip-enchantment-save',
          { cost: 'free', trigger: 'holder fails eligible enchantment save' },
          { cost: [{ economy: 'enchantment-save-flip', amount: 1 }] },
        ),
        operation(
          'reflect-enchantment',
          {
            cost: 'reaction',
            trigger: 'holder succeeds eligible enchantment save',
          },
          { cost: [{ economy: 'charges', amount: 1 }] },
        ),
      ],
      rollManipulation: {
        transforms: [
          {
            id: 'm10-charming-save-flip',
            kind: 'replace-fail',
            roll: 'saving throw',
            trigger:
              'holder fails save against single-target enchantment spell',
            operationId: 'm10-flip-enchantment-save',
            limitEconomy: 'enchantment-save-flip',
            replacement: 'success',
          },
          {
            id: 'm10-charming-reflect',
            kind: 'reflect',
            roll: 'successful saving throw',
            trigger:
              'holder succeeds against single-target enchantment spell, with or without staff intervention',
            operationId: 'reflect-enchantment',
            limitEconomy: 'charges',
            replacement: 'turn spell back on caster as if holder cast it',
          },
        ],
      },
      clauses: [
        clause(
          'charming-flip',
          'M10',
          'turn your failed save into a successful one',
          'rollManipulation',
          [F1, F5, F9],
        ),
        clause(
          'charming-limit',
          'M10',
          'can’t use this property of the staff again until the next dawn',
          'rollManipulation',
          [F5],
        ),
        clause(
          'charming-reflect',
          'M10',
          'turn the spell back on its caster as if you had cast the spell',
          'rollManipulation',
          [F1, F4, F5, F9],
        ),
      ],
    },
  ],
  [
    'Ring of Spell Turning',
    {
      operations: [
        operation('m10-reflect-spell', {
          cost: 'free',
          trigger: 'wearer rolls natural 20 on eligible spell save',
        }),
      ],
      rollManipulation: {
        transforms: [
          {
            id: 'm10-spell-turning-reflect',
            kind: 'reflect',
            roll: 'saving throw natural 20',
            trigger: 'single-target non-area spell of 7th level or lower',
            operationId: 'm10-reflect-spell',
            maximumSpellLevel: 7,
            replacement:
              'spell has no effect on wearer and targets caster using original caster values',
          },
        ],
      },
      clauses: [
        clause(
          'spell-turning-natural-20',
          'M10',
          'roll a 20 for the save and the spell is 7th level or lower',
          'rollManipulation',
          [F1, F4, F9],
        ),
        clause(
          'spell-turning-reflect',
          'M10',
          'instead targets the caster',
          'rollManipulation',
          [F4, F9],
        ),
      ],
    },
  ],
  [
    'Talisman of the Sphere',
    {
      rollManipulation: {
        transforms: [
          {
            id: 'm10-sphere-pb-double',
            kind: 'pb-double',
            roll: 'Intelligence (Arcana) check to control sphere of annihilation',
            trigger: 'holder makes control check while holding talisman',
            multiplier: 2,
            replacement: 'double proficiency bonus on the check',
          },
        ],
      },
      clauses: [
        clause(
          'sphere-pb-double',
          'M10',
          'double your proficiency bonus on the check',
          'rollManipulation',
          [F1, F9],
        ),
      ],
    },
  ],
]);

const IounVariantSpecs: ReadonlyMap<string, ProjectionSpec> = new Map<
  string,
  ProjectionSpec
>([
  [
    'Reserve',
    {
      spellStore: {
        contracts: [
          {
            ...spellStorage(
              'ioun-reserve',
              3,
              3,
              '1d4-1',
              'owner while stone orbits',
            ),
            variant: 'Reserve',
          },
        ],
      },
      operations: [
        operation('m9-store-ioun-reserve', {
          cost: 'free',
          trigger: 'spell is cast while caster touches stone',
        }),
        operation('m9-cast-ioun-reserve', {
          cost: 'free',
          requirement: 'stone orbits owner',
        }),
      ],
      clauses: [
        clause(
          'ioun-reserve-capacity',
          'M9',
          'store up to 3 levels worth of spells at a time',
          'spellStore',
          [F4, F5],
        ),
        clause(
          'ioun-reserve-initial',
          'M9',
          'contains 1d4 − 1 levels of stored spells chosen by the GM',
          'spellStore',
          [F4, F5],
        ),
        clause(
          'ioun-reserve-caster',
          'M9',
          'spellcasting ability of the original caster',
          'spellStore',
          [F4, F9],
        ),
      ],
    },
  ],
  [
    'Absorption',
    {
      spellStore: {
        contracts: [
          {
            id: 'ioun-absorption',
            kind: 'spell-cancellation',
            variant: 'Absorption',
            lifetimeCapacityLevels: 20,
            maximumSpellLevel: 4,
            absorbOn: {
              cost: 'reaction',
              trigger: 'visible creature casts spell targeting only owner',
              result:
                'cancel spell and count its level against lifetime budget',
            },
            operationIds: ['m9-cancel-ioun-absorption'],
            onExhausted:
              'after canceling 20 spell levels, stone burns out and becomes dull gray and nonmagical',
          },
        ],
      },
      operations: [
        operation('m9-cancel-ioun-absorption', {
          cost: 'reaction',
          trigger: 'eligible spell targets only owner',
        }),
      ],
      clauses: [
        clause(
          'ioun-absorption-cancel',
          'M9',
          'cancel a spell of 4th level or lower',
          'spellStore',
          [F4, F5],
        ),
        clause(
          'ioun-absorption-budget',
          'M9',
          'canceled 20 levels of spells',
          'spellStore',
          [F4, F5],
        ),
        clause(
          'ioun-absorption-burnout',
          'M9',
          'burns out and turns dull gray, losing its magic',
          'spellStore',
          [F5],
        ),
      ],
    },
  ],
  [
    'Greater Absorption',
    {
      spellStore: {
        contracts: [
          {
            id: 'ioun-greater-absorption',
            kind: 'spell-cancellation',
            variant: 'Greater Absorption',
            lifetimeCapacityLevels: 50,
            maximumSpellLevel: 8,
            absorbOn: {
              cost: 'reaction',
              trigger: 'visible creature casts spell targeting only owner',
              result:
                'cancel spell and count its level against lifetime budget',
            },
            operationIds: ['m9-cancel-ioun-greater-absorption'],
            onExhausted:
              'after canceling 50 spell levels, stone burns out and becomes dull gray and nonmagical',
          },
        ],
      },
      operations: [
        operation('m9-cancel-ioun-greater-absorption', {
          cost: 'reaction',
          trigger: 'eligible spell targets only owner',
        }),
      ],
      clauses: [
        clause(
          'ioun-greater-cancel',
          'M9',
          'cancel a spell of 8th level or lower',
          'spellStore',
          [F4, F5],
        ),
        clause(
          'ioun-greater-budget',
          'M9',
          'canceled 50 levels of spells',
          'spellStore',
          [F4, F5],
        ),
        clause(
          'ioun-greater-burnout',
          'M9',
          'burns out and turns dull gray, losing its magic',
          'spellStore',
          [F5],
        ),
      ],
    },
  ],
]);

export const MAGIC_ITEM_SPELL_INTEROP_NAMES = Object.freeze([
  'Ring of Spell Storing',
  'Rod of Absorption',
  'Ioun Stone',
  'Pearl of Power',
  'Spell Scroll',
  'Candle of Invocation',
  'Staff of the Magi',
]);
export const MAGIC_ITEM_SPELL_INTEROP_VARIANTS = Object.freeze(
  [...IounVariantSpecs.keys()].map((name) => `Ioun Stone::${name}`),
);
export const MAGIC_ITEM_ROLL_MANIPULATION_NAMES = Object.freeze([
  'Luck Blade',
  'Ring of Evasion',
  'Scarab of Protection',
  'Staff of Charming',
  'Ring of Spell Turning',
  'Rod of Absorption',
  'Talisman of the Sphere',
]);
export const MAGIC_ITEM_SPELL_ROLL_REFERENCES = Object.freeze([
  'table:spell-scroll',
  'magic-item:sphere-of-annihilation',
]);

function project(
  name: string,
  text: string,
  spec: ProjectionSpec,
): MagicItemFamilyProjection {
  for (const sourceClause of spec.clauses) {
    if (!text.includes(sourceClause.phrase))
      throw new Error(
        `magic-item ${sourceClause.tag} projection: expected source phrase ${JSON.stringify(sourceClause.phrase)} not found in ${JSON.stringify(name)}`,
      );
  }
  const clauses: ItemClauseExpectation[] = spec.clauses.map((entry) => ({
    id: entry.id,
    tag: entry.tag,
    representation: { block: entry.block },
    engineHooks: entry.hooks,
  }));
  return {
    family: 'm9-m10-spell-roll-interop',
    mechanics: {
      ...(spec.spellStore === undefined ? {} : { spellStore: spec.spellStore }),
      ...(spec.rollManipulation === undefined
        ? {}
        : { rollManipulation: spec.rollManipulation }),
      ...(spec.economies === undefined ? {} : { economies: spec.economies }),
      ...(spec.operations === undefined ? {} : { operations: spec.operations }),
    } satisfies Readonly<Partial<MagicItemMechanics>>,
    clauses,
  };
}

export function projectMagicItemSpellRollInterop(
  item: MagicItemExtraction,
): MagicItemFamilyProjection | undefined {
  const spec = DIRECT_SPECS.get(item.name);
  return spec === undefined
    ? undefined
    : project(item.name, item.description, spec);
}

export function projectMagicItemSpellRollInteropVariant(
  parentName: string,
  variant: MagicItemVariant,
): MagicItemFamilyProjection | undefined {
  if (parentName !== 'Ioun Stone') return undefined;
  const spec = IounVariantSpecs.get(variant.name);
  return spec === undefined
    ? undefined
    : project(`${parentName} variant ${variant.name}`, variant.text, spec);
}
