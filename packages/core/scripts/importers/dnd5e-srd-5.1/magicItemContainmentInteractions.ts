/**
 * Source-grounded M6 containment/portal and M11 inter-item projections.
 * These blocks declare immutable capabilities and state shape only. Actual
 * occupants, open portals, locations, and cell assignments remain live state.
 */
import type {
  MagicItemContainment,
  MagicItemInterItem,
  MagicItemMechanics,
} from '../../../src/rules/magicItemMechanics.js';
import type {
  EngineHookBinding,
  ItemClauseExpectation,
  MagicItemFamilyProjection,
} from './magicItemCompiler.js';
import type { MagicItemExtraction } from './types.js';

interface ContainmentInteractionSpec {
  readonly sourcePhrases: readonly string[];
  readonly containment?: MagicItemContainment;
  readonly interItem?: MagicItemInterItem;
  readonly hooks: readonly EngineHookBinding[];
}

const F2_ACTIVATION = {
  engine: 'F2',
  hook: 'item activation and action-budget ownership',
} as const;
const F5_ITEM_STATE = {
  engine: 'F5',
  hook: 'per-instance containment occupancy and portal-state ownership',
} as const;
const F7_CLOCK = {
  engine: 'F7',
  hook: 'suffocation, duration, and planar-return clock processing',
} as const;
const F9_RESOLUTION = {
  engine: 'F9',
  hook: 'deterministic checks, forced movement, and interaction resolution',
} as const;
const STATEFUL_HOOKS = [F2_ACTIVATION, F5_ITEM_STATE, F7_CLOCK] as const;
const INTERACTION_HOOKS = [F5_ITEM_STATE, F9_RESOLUTION] as const;

const ASTRAL_ITEMS = [
  'magic-item:bag-of-holding',
  'magic-item:handy-haversack',
  'magic-item:portable-hole',
] as const;

function astralNesting(self: string): MagicItemInterItem {
  return {
    nestingHazard: {
      withItemRefs: ASTRAL_ITEMS.filter((ref) => ref !== self),
      trigger: 'one extradimensional item is placed inside another',
      destroys: 'both-items',
      affectsRadiusFeet: 10,
      portal: {
        direction: 'one-way',
        destination: 'random location on the Astral Plane',
        closure: 'closes immediately and cannot be reopened',
      },
    },
  };
}

const SPECS: ReadonlyMap<string, ContainmentInteractionSpec> = new Map([
  [
    'Bag of Devouring',
    {
      sourcePhrases: [
        '50 percent chance that the creature is pulled inside the bag',
        'successful DC 15 Strength check',
        'starts its turn inside the bag is devoured',
        'transported to a random location on the Astral Plane',
      ],
      containment: {
        mode: 'creature-prison',
        tracksOccupancy: true,
        capacity: { volumeCubicFeet: 1 },
        entry: {
          trigger: 'part of a living creature is placed in the bag',
          result: '50 percent chance the creature is pulled wholly inside',
        },
        exit: {
          activation: { cost: 'action' },
          check: { ability: 'Strength', dc: 15 },
          result: 'the trapped creature escapes',
        },
        release: {
          activation: { cost: 'action' },
          check: { ability: 'Strength', dc: 20 },
          result:
            'another creature pulls one trapped creature out after surviving the entry risk',
        },
        overflow:
          'animal or vegetable matter is lost forever; a creature inside at turn start is devoured and its body destroyed; stored objects are swallowed to a GM-chosen plane once daily',
        rupture: {
          triggers: ['pierced', 'torn'],
          destroysItem: true,
          contentsDestination: 'random location on the Astral Plane',
        },
        note: 'Turning the bag inside out closes the feeding orifice.',
      },
      hooks: [F2_ACTIVATION, F5_ITEM_STATE, F7_CLOCK, F9_RESOLUTION],
    },
  ],
  [
    'Bag of Holding',
    {
      sourcePhrases: [
        'hold up to 500 pounds',
        'not exceeding a volume of 64 cubic feet',
        '10 divided by the number of creatures',
        'opens a gate to the Astral Plane',
      ],
      containment: {
        mode: 'storage',
        tracksOccupancy: true,
        fixedWeightPounds: 15,
        capacity: { weightPounds: 500, volumeCubicFeet: 64 },
        entry: {
          activation: { cost: 'action' },
          result: 'retrieve one item from the bag',
        },
        exit: {
          trigger: 'bag turned inside out',
          result:
            'all contents spill forth unharmed; bag is unusable until put right',
        },
        rupture: {
          triggers: ['overloaded', 'pierced', 'torn'],
          destroysItem: true,
          contentsDestination: 'scattered in the Astral Plane',
        },
        suffocation: {
          airMinutes: 10,
          dividedByOccupants: true,
          minimumMinutes: 1,
        },
      },
      interItem: astralNesting('magic-item:bag-of-holding'),
      hooks: STATEFUL_HOOKS,
    },
  ],
  [
    'Efficient Quiver',
    {
      sourcePhrases: [
        'three compartments connects to an extradimensional space',
        'up to sixty arrows',
        'up to eighteen javelins',
        'up to six long objects',
      ],
      containment: {
        mode: 'storage',
        tracksOccupancy: true,
        fixedWeightPounds: 2,
        compartments: [
          {
            id: 'shortest',
            capacity: { count: 60 },
            accepts: 'arrows, bolts, or similar objects',
            retrieval: 'as from a regular quiver or scabbard',
          },
          {
            id: 'midsize',
            capacity: { count: 18 },
            accepts: 'javelins or similar objects',
            retrieval: 'as from a regular quiver or scabbard',
          },
          {
            id: 'longest',
            capacity: { count: 6 },
            accepts: 'long objects such as bows, quarterstaffs, or spears',
            retrieval: 'as from a regular quiver or scabbard',
          },
        ],
      },
      hooks: [F5_ITEM_STATE],
    },
  ],
  [
    'Handy Haversack',
    {
      sourcePhrases: [
        'two side pouches, each of which is an extradimensional space',
        'up to 20 pounds of material',
        'up to 8 cubic feet or 80 pounds',
        'opens a gate to the Astral Plane',
      ],
      containment: {
        mode: 'storage',
        tracksOccupancy: true,
        fixedWeightPounds: 5,
        compartments: [
          {
            id: 'left-side',
            capacity: { weightPounds: 20, volumeCubicFeet: 2 },
            accepts: 'material',
            retrieval: 'specific requested item is always magically on top',
          },
          {
            id: 'right-side',
            capacity: { weightPounds: 20, volumeCubicFeet: 2 },
            accepts: 'material',
            retrieval: 'specific requested item is always magically on top',
          },
          {
            id: 'central',
            capacity: { weightPounds: 80, volumeCubicFeet: 8 },
            accepts: 'material',
            retrieval: 'specific requested item is always magically on top',
          },
        ],
        exit: {
          trigger: 'haversack turned inside out',
          result:
            'all contents spill forth unharmed; haversack is unusable until put right',
        },
        rupture: {
          triggers: ['overloaded', 'pierced by a sharp object', 'torn'],
          destroysItem: true,
          contentsDestination: 'lost forever; artifacts eventually reappear',
        },
        suffocation: { airMinutes: 10, dividedByOccupants: false },
      },
      interItem: astralNesting('magic-item:handy-haversack'),
      hooks: STATEFUL_HOOKS,
    },
  ],
  [
    'Iron Flask',
    {
      sourcePhrases: [
        'hold only one creature at a time',
        'doesn’t need to breathe, eat, or drink and doesn’t age',
        'remove the flask’s stopper and release the creature',
      ],
      containment: {
        mode: 'creature-prison',
        tracksOccupancy: true,
        capacity: { creatures: 1 },
        entry: {
          activation: { cost: 'action', commandWord: true },
          trigger:
            'target within 60 feet is native to another plane and fails the declared save',
          result: 'target is trapped until released',
        },
        release: {
          activation: { cost: 'action' },
          result: 'remove stopper and release the contained creature',
        },
        note: 'Contained creature does not age or need to breathe, eat, or drink.',
      },
      hooks: [F2_ACTIVATION, F5_ITEM_STATE],
    },
  ],
  [
    'Mirror of Life Trapping',
    {
      sourcePhrases: [
        'twelve extradimensional cells',
        'already occupied, the mirror frees one trapped creature at random',
        'If the mirror is shattered, all creatures it contains are freed',
        'speak a second command word and free one creature',
      ],
      containment: {
        mode: 'cells',
        tracksOccupancy: true,
        capacity: { creatures: 12 },
        cells: {
          count: 12,
          occupantsPerCell: 1,
          environment: 'infinite expanse of thick fog; visibility 10 feet',
          noAging: true,
          noNeeds: ['eat', 'drink', 'sleep'],
          overflowRelease: 'random-occupant',
        },
        entry: {
          trigger:
            'eligible creature sees its reflection while mirror is active and fails the declared save',
          result: 'creature and everything worn or carried enter one cell',
        },
        exit: {
          trigger: 'occupant uses magic that permits planar travel',
          result: 'occupant escapes its cell',
        },
        release: {
          activation: { cost: 'action', commandWord: true },
          destination: 'nearest unoccupied space facing away from the mirror',
          result:
            'free one creature selected by name or cell number with its possessions',
        },
        overflow:
          'free one random current occupant before trapping the new prisoner',
        rupture: {
          triggers: ['mirror reduced to 0 hit points and shattered'],
          destroysItem: true,
          contentsDestination: 'unoccupied spaces near the mirror',
        },
      },
      hooks: [F2_ACTIVATION, F5_ITEM_STATE, F9_RESOLUTION],
    },
  ],
  [
    'Portable Hole',
    {
      sourcePhrases: [
        'circular sheet 6 feet in diameter',
        'extradimensional hole 10 feet deep',
        'successful check, the creature forces its way out',
        'opens a gate to the Astral Plane',
      ],
      containment: {
        mode: 'storage',
        tracksOccupancy: true,
        capacity: { diameterFeet: 6, depthFeet: 10 },
        entry: {
          activation: { cost: 'action' },
          result:
            'unfold on a solid surface to open a 6-foot-diameter, 10-foot-deep cylindrical space',
        },
        exit: {
          activation: { cost: 'action' },
          check: { ability: 'Strength', dc: 10 },
          destination: 'within 5 feet of the hole or its carrier',
          result: 'a creature forces its way out while the cloth is folded',
        },
        suffocation: { airMinutes: 10, dividedByOccupants: false },
        note: 'Folding closes the hole while all creatures and objects remain inside.',
      },
      interItem: astralNesting('magic-item:portable-hole'),
      hooks: [F2_ACTIVATION, F5_ITEM_STATE, F7_CLOCK, F9_RESOLUTION],
    },
  ],
  [
    'Robe of Stars',
    {
      sourcePhrases: [
        'use an action to enter the Astral Plane',
        'use an action to return to the plane you were on',
        'last space you occupied',
      ],
      containment: {
        mode: 'planar-travel',
        tracksOccupancy: true,
        entry: {
          activation: { cost: 'action' },
          destination: 'Astral Plane',
          result:
            'wearer and everything worn or carried enter the Astral Plane',
        },
        exit: {
          activation: { cost: 'action' },
          destination: 'last occupied space, or nearest unoccupied space',
          result: 'wearer returns to the plane previously occupied',
        },
      },
      hooks: [F2_ACTIVATION, F5_ITEM_STATE],
    },
  ],
  [
    'Rod of Security',
    {
      sourcePhrases: [
        'up to 199 other willing creatures',
        '200 days divided by the number of creatures present',
        'all visitors reappear in the location they occupied',
      ],
      containment: {
        mode: 'portal',
        tracksOccupancy: true,
        capacity: {
          visitors: 200,
          durationDays: 200,
          durationDividedByOccupants: true,
        },
        entry: {
          activation: { cost: 'action' },
          destination: 'user-shaped extraplanar paradise',
          result:
            'user and up to 199 visible willing creatures are transported',
        },
        exit: {
          trigger: 'duration expires or user ends paradise as an action',
          destination: 'original locations or nearest unoccupied spaces',
          result: 'all visitors return together',
        },
        portal: {
          direction: 'round-trip',
          destination: 'user-shaped extraplanar paradise',
          opening: 'activation transports all selected visitors',
          closure: 'duration expiry or user action returns all visitors',
          returnDestination: 'each visitor’s activation location',
        },
        note: 'Visitors do not age; paradise supplies food and water; created objects cannot leave.',
      },
      hooks: STATEFUL_HOOKS,
    },
  ],
  [
    'Well of Many Worlds',
    {
      sourcePhrases: [
        'creates a two-way portal to another world or plane of existence',
        'GM decides where it leads',
        'close an open portal',
      ],
      containment: {
        mode: 'portal',
        tracksOccupancy: true,
        entry: {
          activation: { cost: 'action' },
          result: 'unfold on a solid surface and open the portal',
        },
        exit: {
          activation: { cost: 'action' },
          result: 'fold the cloth and close the portal',
        },
        portal: {
          direction: 'two-way',
          destination: 'GM-determined world or plane on each opening',
          opening: 'unfold and place on a solid surface as an action',
          closure: 'fold the cloth as an action',
        },
      },
      hooks: [F2_ACTIVATION, F5_ITEM_STATE],
    },
  ],
  [
    'Hammer of Thunderbolts',
    {
      sourcePhrases: [
        'wearing a belt of giant strength',
        'gauntlets of ogre power to attune',
        'attunement ends if you take off either',
      ],
      interItem: {
        requiresItems: [
          {
            itemRefs: [
              'magic-item:belt-of-giant-strength',
              'magic-item:gauntlets-of-ogre-power',
            ],
            allRequired: true,
            state: 'both worn continuously while attuned',
            note: 'Removing either prerequisite ends hammer attunement.',
          },
        ],
      },
      hooks: INTERACTION_HOOKS,
    },
  ],
  [
    'Oil of Slipperiness',
    {
      sourcePhrases: ['sticky black unguent', 'flows quickly when poured'],
      interItem: {
        counters: [
          {
            itemRefs: ['magic-item:sovereign-glue'],
            interaction: 'prevents-adhesion',
            targetRef: 'magic-item:sovereign-glue',
            note: 'Coating the inside of the glue container is the required storage counter-agent.',
          },
        ],
      },
      hooks: INTERACTION_HOOKS,
    },
  ],
  [
    'Sovereign Glue',
    {
      sourcePhrases: [
        'coated inside with oil of slipperiness',
        'broken only by the application of universal solvent or oil of etherealness',
      ],
      interItem: {
        requiresItems: [
          {
            itemRefs: ['magic-item:oil-of-slipperiness'],
            allRequired: true,
            state: 'inside of storage container coated',
          },
        ],
        counters: [
          {
            itemRefs: [
              'magic-item:universal-solvent',
              'magic-item:oil-of-etherealness',
            ],
            interaction: 'dissolves',
            targetRef: 'magic-item:sovereign-glue',
            note: 'Either listed item breaks a set sovereign-glue bond; wish is the separate spell counter.',
          },
        ],
      },
      hooks: INTERACTION_HOOKS,
    },
  ],
  [
    'Universal Solvent',
    {
      sourcePhrases: [
        'instantly dissolves up to 1 square foot of adhesive',
        'including sovereign glue',
      ],
      interItem: {
        counters: [
          {
            itemRefs: ['magic-item:sovereign-glue'],
            interaction: 'dissolves',
            targetRef: 'magic-item:sovereign-glue',
            note: 'One tube dissolves up to one square foot of adhesive.',
          },
        ],
      },
      hooks: INTERACTION_HOOKS,
    },
  ],
  [
    'Talisman of the Sphere',
    {
      sourcePhrases: [
        'check to control a sphere of annihilation',
        'start your turn with control over a sphere of annihilation',
      ],
      interItem: {
        counters: [
          {
            itemRefs: ['magic-item:sphere-of-annihilation'],
            interaction: 'enhances-control',
            targetRef: 'magic-item:sphere-of-annihilation',
            note: 'While held, doubles proficiency on control checks and enhances controlled levitation.',
          },
        ],
      },
      hooks: INTERACTION_HOOKS,
    },
  ],
  [
    'Sphere of Annihilation',
    {
      sourcePhrases: [
        'comes into contact with a planar portal',
        'or an extradimensional space',
        'using the following table',
      ],
      interItem: {
        portalInteraction: {
          portalRefs: [
            'spell:gate',
            'magic-item:portable-hole',
            'magic-item:bag-of-holding',
            'magic-item:handy-haversack',
          ],
          tableRefs: ['table:sphere-of-annihilation'],
          procedure:
            'GM rolls on the source table when the sphere contacts a planar portal or extradimensional space',
        },
      },
      hooks: INTERACTION_HOOKS,
    },
  ],
]);

export const MAGIC_ITEM_M6_NAMES = Object.freeze(
  [...SPECS.entries()]
    .filter(([, spec]) => spec.containment !== undefined)
    .map(([name]) => name),
);

export const MAGIC_ITEM_M11_NAMES = Object.freeze(
  [...SPECS.entries()]
    .filter(([, spec]) => spec.interItem !== undefined)
    .map(([name]) => name),
);

export const MAGIC_ITEM_M6_M11_REFERENCES = Object.freeze(
  [...SPECS.values()].flatMap((spec) => {
    const interaction = spec.interItem;
    if (interaction === undefined) return [];
    return [
      ...(interaction.requiresItems ?? []).flatMap((entry) => entry.itemRefs),
      ...(interaction.counters ?? []).flatMap((entry) => [
        ...entry.itemRefs,
        entry.targetRef,
      ]),
      ...(interaction.nestingHazard?.withItemRefs ?? []),
      ...(interaction.portalInteraction?.portalRefs ?? []),
      ...(interaction.portalInteraction?.tableRefs ?? []),
    ];
  }),
);

export function projectMagicItemContainmentInteractions(
  item: MagicItemExtraction,
): MagicItemFamilyProjection | undefined {
  const spec = SPECS.get(item.name);
  if (spec === undefined) return undefined;
  for (const phrase of spec.sourcePhrases) {
    if (!item.description.includes(phrase)) {
      throw new Error(
        `magic-item M6/M11 projection: expected source phrase ${JSON.stringify(phrase)} not found in ${JSON.stringify(item.name)}`,
      );
    }
  }
  const clauses: ItemClauseExpectation[] = [];
  if (spec.containment !== undefined) {
    clauses.push({
      id: `m6-${item.name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '')}`,
      tag: 'M6',
      representation: { block: 'containment' },
      engineHooks: spec.hooks,
    });
  }
  if (spec.interItem !== undefined) {
    clauses.push({
      id: `m11-${item.name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '')}`,
      tag: 'M11',
      representation: { block: 'interItem' },
      engineHooks: spec.hooks,
    });
  }
  return {
    family: 'm6-m11-containment-interactions',
    mechanics: {
      ...(spec.containment === undefined
        ? {}
        : { containment: spec.containment }),
      ...(spec.interItem === undefined ? {} : { interItem: spec.interItem }),
    } as Readonly<Partial<MagicItemMechanics>>,
    clauses,
  };
}
