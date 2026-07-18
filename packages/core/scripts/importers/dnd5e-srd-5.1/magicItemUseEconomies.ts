/**
 * Source-grounded C1 use-economy curation outside the charge-pool family.
 *
 * Exact membership is the 52 C1-tagged rows in the reviewed mechanics
 * inventory that are not owned by `magicItemChargeEconomies.ts`. This family
 * covers at-will and activation-only uses, per-period limits and cooldowns,
 * duration budgets, found-quantity/dose depletion, and permanent property
 * loss. Mutable counters remain per item instance; this file emits only their
 * immutable contracts.
 */

import type {
  MagicItemEconomy,
  MagicItemMechanics,
  MagicItemOperation,
} from '../../../src/rules/magicItemMechanics.js';
import type {
  EngineHookBinding,
  MagicItemFamilyProjection,
} from './magicItemCompiler.js';
import type { MagicItemExtraction, MagicItemVariant } from './types.js';

interface UseSpec {
  readonly sourcePhrases: readonly string[];
  readonly economies: Readonly<Record<string, MagicItemEconomy>>;
  readonly operations: readonly MagicItemOperation[];
  readonly primaryEconomy: string;
  readonly engineHooks?: readonly EngineHookBinding[];
}

const cost = (
  id: string,
  economy: string,
  amount: number | string | 'variable' = 1,
  extra: Omit<MagicItemOperation, 'id' | 'cost'> = {},
): MagicItemOperation => ({ id, cost: [{ economy, amount }], ...extra });

const atWill = (
  operationId: string,
  sourcePhrases: readonly string[],
  activation?: MagicItemOperation['activation'],
): UseSpec => ({
  sourcePhrases,
  economies: { uses: { kind: 'at-will' } },
  operations: [
    {
      id: operationId,
      ...(activation === undefined ? {} : { activation }),
      doesNotExpend: ['uses'],
    },
  ],
  primaryEconomy: 'uses',
});

const perDawn = (
  operationId: string,
  sourcePhrases: readonly string[],
  uses = 1,
): UseSpec => ({
  sourcePhrases,
  economies: {
    uses: {
      kind: 'per-day',
      perDay: { uses },
      reset: [{ at: 'dawn', amount: 'all' }],
    },
  },
  operations: [cost(operationId, 'uses')],
  primaryEconomy: 'uses',
  engineHooks: [{ engine: 'F5', hook: 'per-period usage reset' }],
});

const cooldown = (
  operationId: string,
  amount: number | string,
  unit: 'hour' | 'day',
  sourcePhrases: readonly string[],
): UseSpec => ({
  sourcePhrases,
  economies: {
    cooldown: {
      kind: 'cooldown',
      cooldown: { duration: { amount, unit } },
      reset: [
        {
          at: unit === 'hour' ? 'hour' : 'days',
          ...(unit === 'day' && typeof amount === 'number'
            ? { days: amount }
            : {}),
          amount: 'all',
        },
      ],
    },
  },
  operations: [cost(operationId, 'cooldown')],
  primaryEconomy: 'cooldown',
  engineHooks: [{ engine: 'F5', hook: 'elapsed-time cooldown reset' }],
});

const singleUse = (
  operationId: string,
  sourcePhrases: readonly string[],
  becomes: 'destroyed' | 'nonmagical' | 'inert' = 'inert',
): UseSpec => ({
  sourcePhrases,
  economies: {
    use: {
      kind: 'single-use',
      onDepleted: { loseProperty: becomes !== 'destroyed', becomes },
    },
  },
  operations: [cost(operationId, 'use')],
  primaryEconomy: 'use',
});

const dawnSpecs = [
  [
    'Armor of Invulnerability',
    'activate-immunity',
    [
      'Once this special action is used, it can’t be used again until the next dawn',
    ],
  ],
  [
    'Bowl of Commanding Water Elementals',
    'summon-water-elemental',
    [
      'speak the bowl’s command word and summon a water elemental',
      'can’t be used this way again until the next dawn',
    ],
  ],
  [
    'Brazier of Commanding Fire Elementals',
    'summon-fire-elemental',
    [
      'speak the brazier’s command word and summon a fire elemental',
      'can’t be used this way again until the next dawn',
    ],
  ],
  [
    'Cape of the Mountebank',
    'cast-dimension-door',
    [
      'cast the dimension door spell as an action',
      'can’t be used again until the next dawn',
    ],
  ],
  [
    'Censer of Controlling Air Elementals',
    'summon-air-elemental',
    [
      'speak the censer’s command word and summon an air elemental',
      'can’t be used this way again until the next dawn',
    ],
  ],
  [
    'Circlet of Blasting',
    'cast-scorching-ray',
    [
      'cast the scorching ray spell with it',
      'can’t be used this way again until the next dawn',
    ],
  ],
  [
    'Cloak of Arachnida',
    'cast-web',
    [
      'cast the web spell (save DC 13)',
      'can’t be used again until the next dawn',
    ],
  ],
  [
    'Cloak of the Bat',
    'cast-polymorph',
    [
      'cast polymorph on yourself',
      'can’t be used this way again until the next dawn',
    ],
  ],
  [
    'Dagger of Venom',
    'coat-blade',
    [
      'cause thick, black poison to coat the blade',
      'can’t be used this way again until the next dawn',
    ],
  ],
  [
    'Dragon Scale Mail',
    'sense-nearest-dragon',
    [
      'discern the distance and direction to the closest dragon within 30 miles',
      'can’t be used again until the next dawn',
    ],
  ],
  [
    'Helm of Telepathy',
    'cast-suggestion',
    [
      'cast the suggestion spell (save DC 13)',
      'suggestion property can’t be used again until the next dawn',
    ],
  ],
  [
    'Iron Bands of Binding',
    'throw-bands',
    [
      'speak the command word and throw the sphere',
      'can’t be used again until the next dawn',
    ],
  ],
  [
    'Javelin of Lightning',
    'hurl-lightning',
    [
      'hurl it and speak its command word',
      'property can’t be used again until the next dawn',
    ],
  ],
  [
    'Pearl of Power',
    'regain-spell-slot',
    [
      'regain one expended spell slot',
      'can’t be used again until the next dawn',
    ],
  ],
  [
    'Plate Armor of Etherealness',
    'gain-etherealness',
    [
      'speak its command word as an action',
      'can’t be used again until the next dawn',
    ],
  ],
  [
    'Rod of Alertness',
    'activate-protective-aura',
    ['Protective Aura.', 'can’t be used again until the next dawn'],
  ],
  [
    'Rod of Rulership',
    'command-obedience',
    [
      'command obedience from each creature',
      'can’t be used again until the next dawn',
    ],
  ],
  [
    'Stone of Controlling Earth Elementals',
    'summon-earth-elemental',
    [
      'speak its command word and summon an earth elemental',
      'can’t be used this way again until the next dawn',
    ],
  ],
] as const;

const manual = (abilityPhrase: string): UseSpec => ({
  sourcePhrases: [
    'spend 48 hours over a period of 6 days or fewer studying',
    abilityPhrase,
    'loses its magic, but regains it in a century',
  ],
  economies: {
    study: {
      kind: 'budget',
      budget: {
        total: { amount: 48, unit: 'hour' },
        increment: { amount: 1, unit: 'hour' },
      },
      reset: [{ at: 'days', days: 36500, amount: 'all' }],
      onDepleted: { loseProperty: true, becomes: 'inert' },
      note: 'complete within 6 days; magic returns one century after completion',
    },
  },
  operations: [cost('study-and-practice', 'study', 'variable')],
  primaryEconomy: 'study',
  engineHooks: [
    { engine: 'F5', hook: 'duration-budget accounting' },
    { engine: 'F10', hook: 'downtime study window' },
  ],
});

const specs = new Map<string, UseSpec>([
  [
    'Ammunition, +1, +2, or +3',
    singleUse(
      'hit-target',
      ['Once it hits a target, the ammunition is no longer magical'],
      'nonmagical',
    ),
  ],
  [
    'Animated Shield',
    atWill('speak-command-word', ['speak its command word as a bonus action'], {
      cost: 'bonus-action',
      commandWord: true,
    }),
  ],
  ...dawnSpecs.map(
    ([name, operation, phrases]) =>
      [name, perDawn(operation, phrases)] as const,
  ),
  [
    'Arrow of Slaying',
    singleUse(
      'deal-extra-damage',
      [
        'Once an arrow of slaying deals its extra damage',
        'it becomes a nonmagical arrow',
      ],
      'nonmagical',
    ),
  ],
  [
    'Bag of Beans',
    {
      sourcePhrases: [
        'Inside this heavy cloth bag are 3d4 dry beans',
        'dump the bag’s contents out on the ground',
        'remove a bean from the bag',
      ],
      economies: {
        beans: {
          kind: 'doses',
          doses: { count: '3d4' },
          onDepleted: { loseProperty: true, becomes: 'inert' },
        },
      },
      operations: [
        cost('plant-bean', 'beans'),
        cost('dump-all-beans', 'beans', 'variable'),
      ],
      primaryEconomy: 'beans',
    },
  ],
  [
    'Bag of Tricks',
    perDawn(
      'pull-fuzzy-object',
      [
        'Once three fuzzy objects have been pulled from the bag',
        'can’t be used again until the next dawn',
      ],
      3,
    ),
  ],
  [
    'Boots of Levitation',
    atWill('cast-levitate', ['cast the levitate spell on yourself at will'], {
      cost: 'action',
    }),
  ],
  [
    'Boots of Speed',
    {
      sourcePhrases: [
        'used for a total of 10 minutes',
        'until you finish a long rest',
      ],
      economies: {
        speed: {
          kind: 'budget',
          budget: {
            total: { amount: 10, unit: 'minute' },
            increment: { amount: 1, unit: 'round' },
          },
          reset: [{ at: 'long-rest', amount: 'all' }],
        },
      },
      operations: [cost('maintain-speed', 'speed', 1)],
      primaryEconomy: 'speed',
      engineHooks: [
        { engine: 'F5', hook: 'duration-budget accounting' },
        { engine: 'F7', hook: 'long-rest reset' },
      ],
    },
  ],
  [
    'Candle of Invocation',
    {
      sourcePhrases: [
        'After burning for 4 hours, the candle is destroyed',
        'Deduct the time it burned in increments of 1 minute',
        'Doing so destroys the candle',
      ],
      economies: {
        'burn-time': {
          kind: 'budget',
          budget: {
            total: { amount: 4, unit: 'hour' },
            increment: { amount: 1, unit: 'minute' },
          },
          onDepleted: { becomes: 'destroyed' },
        },
        'gate-use': {
          kind: 'single-use',
          onDepleted: { becomes: 'destroyed' },
          note: 'first-light alternative; mutually exclusive with continued burning',
        },
      },
      operations: [
        cost('burn', 'burn-time'),
        cost('cast-gate', 'gate-use', 1, { excludes: ['burn'] }),
      ],
      primaryEconomy: 'burn-time',
      engineHooks: [{ engine: 'F5', hook: 'duration-budget accounting' }],
    },
  ],
  [
    'Chime of Opening',
    {
      sourcePhrases: [
        'can be used ten times',
        'After the tenth time, it cracks and becomes useless',
      ],
      economies: {
        uses: {
          kind: 'doses',
          doses: { count: 10 },
          onDepleted: { loseProperty: true, becomes: 'inert' },
        },
      },
      operations: [cost('strike-chime', 'uses')],
      primaryEconomy: 'uses',
    },
  ],
  [
    'Deck of Illusions',
    {
      sourcePhrases: [
        'A full deck has 34 cards',
        'usually missing 1d20 − 1 cards',
        'that card can’t be used again',
      ],
      economies: {
        cards: {
          kind: 'doses',
          doses: { count: 34 },
          note: 'a found deck starts with 34 cards minus 1d20 − 1 missing cards',
          onDepleted: { becomes: 'inert' },
        },
      },
      operations: [cost('draw-and-throw-card', 'cards')],
      primaryEconomy: 'cards',
    },
  ],
  [
    'Flame Tongue',
    atWill(
      'toggle-flames',
      ['speak this magic sword’s command word', 'speak the command word again'],
      { cost: 'bonus-action', commandWord: true },
    ),
  ],
  [
    'Frost Brand',
    cooldown('extinguish-flames', 1, 'hour', [
      'This property can be used no more than once per hour',
    ]),
  ],
  [
    'Hat of Disguise',
    atWill(
      'cast-disguise-self',
      ['cast the disguise self spell from it at will'],
      { cost: 'action' },
    ),
  ],
  [
    'Helm of Comprehending Languages',
    atWill(
      'cast-comprehend-languages',
      ['cast the comprehend languages spell from it at will'],
      { cost: 'action' },
    ),
  ],
  [
    'Horn of Valhalla',
    cooldown('blow-horn', 7, 'day', [
      'can’t be used again until 7 days have passed',
    ]),
  ],
  ['Manual of Bodily Health', manual('Constitution score increases by 2')],
  ['Manual of Gainful Exercise', manual('Strength score increases by 2')],
  ['Manual of Quickness of Action', manual('Dexterity score increases by 2')],
  [
    'Manual of Golems',
    singleUse(
      'complete-golem',
      [
        'Once you finish creating the golem',
        'the book is consumed in eldritch flames',
      ],
      'destroyed',
    ),
  ],
  [
    'Necklace of Prayer Beads',
    {
      sourcePhrases: [
        'has 1d4 + 2 magic beads',
        'If a magic bead is removed from the necklace, that bead loses its magic',
        'Each bead contains a spell',
        'that bead can’t be used again until the next dawn',
      ],
      economies: {
        beads: {
          kind: 'doses',
          doses: { count: '1d4+2' },
          note: 'found bead inventory; removing one permanently depletes that bead',
        },
        'bead-spells': {
          kind: 'per-day',
          perDay: { uses: 1 },
          reset: [{ at: 'dawn', amount: 'all' }],
          note: 'independent once-per-dawn counter for each magic bead',
        },
      },
      operations: [
        cost('remove-bead', 'beads'),
        cost('cast-bead-spell', 'bead-spells'),
      ],
      primaryEconomy: 'bead-spells',
      engineHooks: [{ engine: 'F5', hook: 'independent per-bead dawn reset' }],
    },
  ],
  [
    'Ring of Djinni Summoning',
    cooldown('summon-djinni', 24, 'hour', [
      'can’t be summoned again for 24 hours',
    ]),
  ],
  [
    'Ring of Jumping',
    atWill(
      'cast-jump',
      ['cast the jump spell from it as a bonus action at will'],
      { cost: 'bonus-action' },
    ),
  ],
  [
    'Ring of Telekinesis',
    atWill('cast-telekinesis', ['cast the telekinesis spell at will']),
  ],
  [
    'Ring of X-ray Vision',
    {
      sourcePhrases: [
        'Whenever you use the ring again before taking a long rest',
        'gain one level of exhaustion',
      ],
      economies: {
        'safe-use': {
          kind: 'per-day',
          perDay: { uses: 1 },
          reset: [{ at: 'long-rest', amount: 'all' }],
          note: 'reuse remains allowed after depletion but triggers the Constitution-save exhaustion risk',
        },
      },
      operations: [cost('activate-x-ray-vision', 'safe-use')],
      primaryEconomy: 'safe-use',
      engineHooks: [
        { engine: 'F7', hook: 'long-rest reset and early-reuse gate' },
      ],
    },
  ],
  [
    'Robe of Useful Items',
    {
      sourcePhrases: [
        'detach one of the patches',
        'Once the last patch is removed, the robe becomes an ordinary garment',
        'robe has 4d4 other patches',
      ],
      economies: {
        patches: {
          kind: 'doses',
          doses: { count: '4d4+12' },
          onDepleted: { loseProperty: true, becomes: 'nonmagical' },
        },
      },
      operations: [cost('detach-patch', 'patches')],
      primaryEconomy: 'patches',
    },
  ],
  [
    'Rod of Security',
    cooldown('enter-paradise', 10, 'day', [
      'can’t be used again until ten days have passed',
    ]),
  ],
  ['Tome of Clear Thought', manual('Intelligence score increases by 2')],
  ['Tome of Leadership and Influence', manual('Charisma score increases by 2')],
  ['Tome of Understanding', manual('Wisdom score increases by 2')],
  [
    'Well of Many Worlds',
    cooldown('open-portal', '1d8', 'hour', ['can’t do so again for 1d8 hours']),
  ],
  [
    'Wind Fan',
    {
      sourcePhrases: [
        'shouldn’t be used again until the next dawn',
        'cumulative 20 percent chance of not working',
        'tearing into useless, nonmagical tatters',
      ],
      economies: {
        'safe-use': {
          kind: 'per-day',
          perDay: { uses: 1 },
          reset: [{ at: 'dawn', amount: 'all' }],
          note: 'early reuse remains allowed; each early reuse adds a cumulative 20 percent failure-and-destruction chance',
        },
      },
      operations: [cost('cast-gust-of-wind', 'safe-use')],
      primaryEconomy: 'safe-use',
      engineHooks: [
        { engine: 'F5', hook: 'dawn reset with nonblocking early-reuse risk' },
      ],
    },
  ],
  [
    'Winged Boots',
    {
      sourcePhrases: [
        'fly for up to 4 hours',
        'each one using a minimum of 1 minute',
        'regain 2 hours of flying capability for every 12 hours they aren’t in use',
      ],
      economies: {
        flight: {
          kind: 'budget',
          budget: {
            total: { amount: 4, unit: 'hour' },
            increment: { amount: 1, unit: 'minute' },
          },
          reset: [
            {
              at: 'per-period',
              period: { amount: 12, unit: 'hour' },
              amount: { amount: 2, unit: 'hour' },
              onlyIfUnused: true,
            },
          ],
        },
      },
      operations: [cost('fly', 'flight')],
      primaryEconomy: 'flight',
      engineHooks: [
        {
          engine: 'F5',
          hook: 'duration budget and conditional periodic recharge',
        },
      ],
    },
  ],
  [
    'Wings of Flying',
    cooldown('manifest-wings', '1d12', 'hour', [
      'for 1 hour or until you repeat the command word',
      'can’t use them again for 1d12 hours',
    ]),
  ],
]);

const CRYSTAL_BALL_TELEPATHY = perDawn('cast-suggestion', [
  'cast the suggestion spell (save DC 17)',
  'suggestion power of the crystal ball can’t be used again until the next dawn',
]);

/** Exact reviewed membership: 52 non-charge C1 records. */
export const EXPECTED_MAGIC_ITEM_USE_ECONOMY_NAMES: ReadonlySet<string> =
  new Set([...specs.keys(), 'Crystal Ball']);

function projection(spec: UseSpec): MagicItemFamilyProjection {
  if (!Object.hasOwn(spec.economies, spec.primaryEconomy)) {
    throw new Error(
      `magic-item C1 use-economy projection: primary economy ${JSON.stringify(spec.primaryEconomy)} is missing`,
    );
  }
  return {
    family: 'C1-use-economies',
    mechanics: {
      economies: spec.economies,
      operations: spec.operations,
    } satisfies Pick<MagicItemMechanics, 'economies' | 'operations'>,
    clauses: [
      {
        id: `c1-${spec.primaryEconomy}`,
        tag: 'C1',
        representation: {
          block: 'economies',
          economyId: spec.primaryEconomy,
        },
        ...(spec.engineHooks === undefined
          ? {}
          : { engineHooks: spec.engineHooks }),
      },
    ],
  };
}

function assertSourcePhrases(
  itemName: string,
  description: string,
  spec: UseSpec,
): void {
  for (const phrase of spec.sourcePhrases) {
    if (!description.includes(phrase)) {
      throw new Error(
        `magic-item C1 use-economy projection: expected source phrase ${JSON.stringify(phrase)} not found in "${itemName}" description`,
      );
    }
  }
}

export function projectMagicItemUseEconomies(
  item: MagicItemExtraction,
): MagicItemFamilyProjection | undefined {
  const spec = specs.get(item.name);
  if (spec === undefined) return undefined;
  assertSourcePhrases(item.name, item.description, spec);
  return projection(spec);
}

/** Projects the sole variant-scoped C1 economy without leaking it to siblings. */
export function projectMagicItemUseVariantEconomies(
  parentName: string,
  variant: MagicItemVariant,
): MagicItemFamilyProjection | undefined {
  if (
    parentName !== 'Crystal Ball' ||
    variant.name !== 'Crystal Ball of Telepathy'
  ) {
    return undefined;
  }
  assertSourcePhrases(
    `${parentName} / ${variant.name}`,
    variant.text,
    CRYSTAL_BALL_TELEPATHY,
  );
  return projection(CRYSTAL_BALL_TELEPATHY);
}

/** Compatibility helper for focused importer tests and adapter-local callers. */
export function deriveMagicItemUseMechanics(
  item: MagicItemExtraction,
): Pick<MagicItemMechanics, 'economies' | 'operations'> | undefined {
  return projectMagicItemUseEconomies(item)?.mechanics as
    | Pick<MagicItemMechanics, 'economies' | 'operations'>
    | undefined;
}
