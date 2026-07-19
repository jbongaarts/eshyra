/** Source-grounded M8 stochastic-device projections. Random choices are
 * declarations for F1; this module never samples dice or tables itself. */
import type {
  MagicItemMechanics,
  MagicItemRandomProcedure,
  MagicItemRandomProcedureDefinition,
} from '../../../src/rules/magicItemMechanics.js';
import type {
  EngineHookBinding,
  MagicItemFamilyProjection,
} from './magicItemCompiler.js';
import type { MagicItemExtraction } from './types.js';

interface RandomProcedureSpec {
  readonly sourcePhrases: readonly string[];
  readonly procedures: readonly MagicItemRandomProcedureDefinition[];
  readonly customState?: MagicItemRandomProcedure['customState'];
  readonly hooks?: readonly EngineHookBinding[];
}

const F1_ROLL = {
  engine: 'F1',
  hook: 'seeded dice, percentage, table, and pool selection',
} as const;
const F4_SPELLS = {
  engine: 'F4',
  hook: 'stored-spell and item-casting resolution',
} as const;
const F5_STATE = {
  engine: 'F5',
  hook: 'pack-licensed per-instance random initialization and card-pool state',
} as const;
const F6_CHARACTER = {
  engine: 'F6',
  hook: 'character condition, curse, ability, and alignment outcomes',
} as const;
const F7_CLOCK = {
  engine: 'F7',
  hook: 'one-hour declared-draw deadline and reset windows',
} as const;
const F9_RESOLUTION = {
  engine: 'F9',
  hook: 'checks, saves, damage, movement, and destruction outcomes',
} as const;
const F10_LEDGER = {
  engine: 'F10',
  hook: 'currency, property, inventory, and XP ledger outcomes',
} as const;

const ALL_CARDS = [
  'vizier',
  'sun',
  'moon',
  'star',
  'comet',
  'the-fates',
  'throne',
  'key',
  'knight',
  'gem',
  'talons',
  'the-void',
  'flames',
  'skull',
  'idiot',
  'donjon',
  'ruin',
  'euryale',
  'rogue',
  'balance',
  'fool',
  'jester',
] as const;
const THIRTEEN_CARDS = [
  'sun',
  'moon',
  'star',
  'throne',
  'key',
  'knight',
  'the-void',
  'flames',
  'skull',
  'ruin',
  'euryale',
  'rogue',
  'jester',
] as const;

const SPECS: ReadonlyMap<string, RandomProcedureSpec> = new Map<
  string,
  RandomProcedureSpec
>([
  [
    'Amulet of the Planes',
    {
      sourcePhrases: ['Roll a d100', 'On a 1–60', 'On a 61–100'],
      procedures: [
        {
          id: 'failed-plane-shift',
          kind: 'table-roll',
          trigger: 'the DC 15 Intelligence check fails',
          roll: '1d100',
          outcome:
            '1–60 reaches a random location on the named plane; 61–100 reaches a randomly determined plane',
        },
      ],
      hooks: [F9_RESOLUTION],
    },
  ],
  [
    'Bag of Beans',
    {
      sourcePhrases: [
        'Inside this heavy cloth bag are 3d4 dry beans',
        'determine it randomly',
      ],
      procedures: [
        {
          id: 'initial-beans',
          kind: 'initial-state',
          trigger: 'bag instance is discovered',
          roll: '3d4',
          outcome: 'initialize the number of beans',
        },
        {
          id: 'planted-bean-effect',
          kind: 'table-roll',
          trigger: 'a removed bean is planted and watered and 1 minute elapses',
          roll: '1d100',
          tableRef: 'table:bag-of-beans',
          outcome:
            'apply the rolled planted-bean effect; the GM may instead choose or create an effect',
        },
      ],
      hooks: [F5_STATE, F9_RESOLUTION],
    },
  ],
  [
    'Deck of Illusions',
    {
      sourcePhrases: [
        'usually missing 1d20 − 1 cards',
        'cards are drawn at random',
      ],
      procedures: [
        {
          id: 'initial-missing-cards',
          kind: 'initial-state',
          trigger: 'treasure deck instance is discovered',
          roll: '1d20-1',
          tableRef: 'table:deck-of-illusions',
          outcome:
            'remove that many randomly selected cards from the full 34-card deck',
        },
        {
          id: 'draw-illusion',
          kind: 'table-roll',
          trigger: 'a card is drawn at random',
          roll: '1d34',
          tableRef: 'table:deck-of-illusions',
          outcome:
            'resolve the matching illusion among cards still present; the used card cannot be used again',
        },
      ],
      hooks: [F5_STATE, F9_RESOLUTION],
    },
  ],
  [
    'Deck of Many Things',
    {
      sourcePhrases: [
        'Most (75 percent) of these decks have only thirteen cards',
        'declare how many cards you intend to draw',
        'no more than 1 hour after the previous draw',
        'Unless the card is the Fool or the Jester, the card reappears in the deck',
      ],
      procedures: [
        {
          id: 'initial-deck-variant',
          kind: 'initial-state',
          trigger: 'deck instance is discovered',
          risk: { percent: 75 },
          outcome:
            '75 percent initializes the thirteen-card variant; otherwise initialize the twenty-two-card variant',
        },
        {
          id: 'declared-card-draw',
          kind: 'declared-draw',
          trigger: 'after declaring a positive number of intended draws',
          selectionField: 'remainingCardIds',
          tableRef: 'table:deck-of-many-things',
          outcome:
            'draw uniformly from the live pool; apply the card immediately; excess draws have no effect; each required draw is due within 1 hour or all remaining declared draws fly out together',
          procedureNote:
            'Every card except Fool and Jester returns to the pool after resolution. Fool/Jester adjustments alter the declared-draw count exactly as their table outcomes state.',
        },
      ],
      customState: {
        kind: 'card-pool',
        allowedCardIds: ALL_CARDS,
        variants: [
          { id: 'thirteen-card', initialCardIds: THIRTEEN_CARDS },
          { id: 'twenty-two-card', initialCardIds: ALL_CARDS },
        ],
        remainingField: 'remainingCardIds',
        returnedField: 'returnedCardIds',
        nonReturningCardIds: ['fool', 'jester'],
      },
      hooks: [F5_STATE, F6_CHARACTER, F7_CLOCK, F9_RESOLUTION, F10_LEDGER],
    },
  ],
  [
    'Efreeti Bottle',
    {
      sourcePhrases: [
        'The first time the bottle is opened',
        'rolls to determine what happens',
      ],
      procedures: [
        {
          id: 'first-opening',
          kind: 'table-roll',
          trigger: 'the bottle is opened for the first time',
          roll: '1d100',
          tableRef: 'table:efreeti-bottle',
          outcome: 'apply the rolled efreeti disposition and duration',
        },
      ],
      hooks: [F5_STATE, F9_RESOLUTION],
    },
  ],
  [
    'Figurine of Wondrous Power',
    {
      sourcePhrases: [
        'has a 10 percent chance each time you use it to ignore your orders',
        'random location on the plane of Hades',
      ],
      procedures: [
        {
          id: 'obsidian-steed-disobedience',
          kind: 'percent-risk',
          trigger: 'a good-aligned owner uses the obsidian steed',
          risk: { percent: 10 },
          outcome:
            'the nightmare ignores orders; mounting it transports rider and nightmare to a random Hades location and reverts it',
        },
      ],
      hooks: [F6_CHARACTER, F9_RESOLUTION],
    },
  ],
  [
    'Helm of Brilliance',
    {
      sourcePhrases: [
        'set with 1d10 diamonds, 2d10 rubies, 3d10 fire opals, and 4d10 opals',
        'Roll a d20 if you are wearing the helm and take fire damage',
      ],
      procedures: [
        ...(
          [
            ['diamonds', '1d10'],
            ['rubies', '2d10'],
            ['fire-opals', '3d10'],
            ['opals', '4d10'],
          ] as const
        ).map(([id, roll]) => ({
          id: `initial-${id}`,
          kind: 'initial-state' as const,
          trigger: 'helm instance is discovered',
          roll,
          outcome: `initialize remaining ${id}`,
        })),
        {
          id: 'failed-fire-save-destruction',
          kind: 'nested-roll',
          trigger:
            'wearer takes fire damage after failing a save against a spell',
          roll: '1d20',
          outcome:
            'on 1, discharge every remaining gem as beams; each creature within 60 feet of the helm other than the wearer makes a DC 17 Dexterity saving throw, taking radiant damage equal to the number of gems on a failed save; destroy the helm and gems',
          procedureNote:
            'The source says the helm and its gems are destroyed after the beam resolution.',
        },
      ],
      hooks: [F5_STATE, F9_RESOLUTION],
    },
  ],
  [
    'Horn of Blasting',
    {
      sourcePhrases: [
        'Each use of the horn’s magic has a 20 percent chance',
        'destroys the horn',
      ],
      procedures: [
        {
          id: 'explosion-risk',
          kind: 'percent-risk',
          trigger: 'each use of the horn magic',
          risk: { percent: 20 },
          outcome: 'deal 10d6 fire damage to the blower and destroy the horn',
        },
      ],
      hooks: [F9_RESOLUTION],
    },
  ],
  [
    'Iron Flask',
    {
      sourcePhrases: [
        'newly discovered bottle might already contain a creature',
        'determined randomly',
      ],
      procedures: [
        {
          id: 'initial-creature',
          kind: 'initial-state',
          trigger: 'newly discovered flask contents are determined randomly',
          roll: '1d100',
          tableRef: 'table:iron-flask',
          outcome:
            'initialize the flask with the rolled creature; GM choice remains allowed',
        },
      ],
      hooks: [F5_STATE],
    },
  ],
  [
    'Necklace of Prayer Beads',
    {
      sourcePhrases: ['has 1d4 + 2 magic beads', 'determines it randomly'],
      procedures: [
        {
          id: 'initial-bead-count',
          kind: 'initial-state',
          trigger: 'necklace instance is discovered',
          roll: '1d4+2',
          outcome: 'initialize the number of magic beads',
        },
        {
          id: 'initial-bead-types',
          kind: 'initial-state',
          trigger: 'each initial magic bead type is randomly determined',
          roll: '1d20',
          tableRef: 'table:necklace-of-prayer-beads',
          outcome: 'add the rolled bead type; duplicates are allowed',
        },
      ],
      hooks: [F5_STATE, F4_SPELLS],
    },
  ],
  [
    'Ring of Spell Storing',
    {
      sourcePhrases: [
        'contains 1d6 − 1 levels of stored spells chosen by the GM',
      ],
      procedures: [
        {
          id: 'initial-stored-levels',
          kind: 'initial-state',
          trigger: 'ring instance is discovered',
          roll: '1d6-1',
          outcome:
            'initialize the total stored spell levels; the GM chooses qualifying spells',
        },
      ],
      hooks: [F5_STATE, F4_SPELLS],
    },
  ],
  [
    'Robe of Useful Items',
    {
      sourcePhrases: ['robe has 4d4 other patches', 'determines them randomly'],
      procedures: [
        {
          id: 'initial-extra-patch-count',
          kind: 'initial-state',
          trigger: 'robe instance is discovered',
          roll: '4d4',
          outcome:
            'initialize the extra patch count in addition to the twelve fixed patches',
        },
        {
          id: 'initial-extra-patches',
          kind: 'initial-state',
          trigger: 'each extra patch is randomly determined',
          roll: '1d100',
          tableRef: 'table:robe-of-useful-items',
          outcome: 'add the rolled patch; the GM may choose instead',
        },
      ],
      hooks: [F5_STATE, F10_LEDGER],
    },
  ],
  [
    'Sphere of Annihilation',
    {
      sourcePhrases: [
        'comes into contact with a planar portal',
        'determines randomly what happens',
      ],
      procedures: [
        {
          id: 'portal-contact',
          kind: 'table-roll',
          trigger: 'sphere contacts a planar portal or extradimensional space',
          roll: '1d100',
          tableRef: 'table:sphere-of-annihilation',
          outcome: 'apply the rolled portal interaction',
        },
      ],
      hooks: [F9_RESOLUTION],
    },
  ],
  ...(['Staff of Power', 'Staff of the Magi'] as const).map(
    (name) =>
      [
        name,
        {
          sourcePhrases: [
            'Retributive Strike',
            '50 percent chance to instantly travel to a random plane of existence',
            'damage based on how far away it is',
          ],
          procedures: [
            {
              id: 'retributive-escape',
              kind: 'retributive-strike',
              trigger: 'the staff is broken for a retributive strike',
              risk: { percent: 50 },
              tableRef:
                name === 'Staff of Power'
                  ? 'table:staff-of-power'
                  : 'table:staff-of-the-magi',
              outcome:
                'on success the breaker travels to a random plane and avoids the explosion; otherwise the breaker takes force damage equal to 16 × the number of charges and every other creature makes a DC 17 Dexterity saving throw, taking the distance-table damage on a failure or half as much on a success',
            },
            {
              id: 'last-charge-roll',
              kind: 'nested-roll',
              trigger: 'the last charge is expended',
              roll: '1d20',
              outcome:
                name === 'Staff of Power'
                  ? 'on 1 lose all properties except the weapon bonus; on 20 trigger seeded 1d8+2 charge recovery'
                  : 'on 20 trigger seeded 1d12+1 charge recovery',
            },
            {
              id: 'last-charge-recovery',
              kind: 'nested-roll',
              trigger: 'the last-charge d20 result is 20',
              roll: name === 'Staff of Power' ? '1d8+2' : '1d12+1',
              outcome: 'regain the rolled number of charges',
            },
          ],
          hooks: [F5_STATE, F9_RESOLUTION],
        },
      ] as const,
  ),
  [
    'Sword of Sharpness',
    {
      sourcePhrases: [
        'roll a 20 on the attack roll',
        'Then roll another d20',
        'If you roll a 20, you lop off one of the target’s limbs',
      ],
      procedures: [
        {
          id: 'critical-severance',
          kind: 'nested-roll',
          trigger:
            'an attack against a creature rolls a natural 20 and applies the extra 4d6 slashing damage',
          roll: '1d20',
          outcome:
            'on 20 sever a limb, or a body portion if no limb exists, with the loss adjudicated by the GM',
        },
      ],
      hooks: [F9_RESOLUTION],
    },
  ],
  [
    'Wand of Wonder',
    {
      sourcePhrases: [
        'Roll d100 and consult the following table',
        'If an effect has multiple possible subjects, the GM randomly determines',
        'If you expend the wand’s last charge, roll a d20',
      ],
      procedures: [
        {
          id: 'wonder-effect',
          kind: 'table-roll',
          trigger:
            'an action expends one charge and chooses a target within 120 feet',
          roll: '1d100',
          tableRef: 'table:wand-of-wonder',
          outcome:
            'apply the rolled row with save DC 15, range 120 feet where applicable, area centered on and including the target, and seeded random subject selection',
          procedureNote:
            'Any subordinate random roll named by the selected row is also resolved through F1.',
        },
        {
          id: 'last-charge-destruction',
          kind: 'nested-roll',
          trigger: 'the last charge is expended',
          roll: '1d20',
          outcome: 'on 1 the wand crumbles to dust and is destroyed',
        },
      ],
      hooks: [F4_SPELLS, F9_RESOLUTION],
    },
  ],
  [
    'Wind Fan',
    {
      sourcePhrases: [
        'Each time it is used again before then',
        'cumulative 20 percent chance',
      ],
      procedures: [
        {
          id: 'premature-reuse-failure',
          kind: 'percent-risk',
          trigger: 'each reuse before the next dawn',
          risk: { percent: 20, cumulative: true, incrementPercent: 20 },
          outcome:
            'on failure the spell does not occur and the fan tears into useless nonmagical tatters; the risk resets at dawn',
        },
      ],
      hooks: [F5_STATE, F7_CLOCK, F9_RESOLUTION],
    },
  ],
]);

export const MAGIC_ITEM_M8_NAMES = Object.freeze([...SPECS.keys()]);
export const MAGIC_ITEM_M8_REFERENCES = Object.freeze(
  [...SPECS.values()].flatMap((spec) =>
    spec.procedures.flatMap((procedure) =>
      procedure.tableRef === undefined ? [] : [procedure.tableRef],
    ),
  ),
);

export function projectMagicItemRandomProcedures(
  item: MagicItemExtraction,
): MagicItemFamilyProjection | undefined {
  const spec = SPECS.get(item.name);
  if (spec === undefined) return undefined;
  for (const phrase of spec.sourcePhrases)
    if (!item.description.includes(phrase))
      throw new Error(
        `magic-item M8 projection: expected source phrase ${JSON.stringify(phrase)} not found in ${JSON.stringify(item.name)}`,
      );
  return {
    family: 'm8-random-procedures',
    mechanics: {
      randomProcedure: {
        procedures: spec.procedures,
        ...(spec.customState === undefined
          ? {}
          : { customState: spec.customState }),
      },
    } as Readonly<Partial<MagicItemMechanics>>,
    clauses: [
      {
        id: `m8-${item.name
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, '-')
          .replace(/^-|-$/g, '')}`,
        tag: 'M8',
        representation: { block: 'randomProcedure' },
        engineHooks: [F1_ROLL, ...(spec.hooks ?? [])],
      },
    ],
  };
}
