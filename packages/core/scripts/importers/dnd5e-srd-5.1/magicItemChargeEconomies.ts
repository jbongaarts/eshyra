/**
 * Source-grounded C1 charge-pool curation.
 *
 * This family owns finite numeric/dice pools that the source presents as
 * charges (including named gem, bead, star, and hour-charge inventories),
 * plus the two reviewed independent-property golden cases. It intentionally
 * excludes at-will, bare per-day/cooldown, consumable/dose, and duration-budget
 * economies. The emitter can merge each returned partial with sibling
 * mechanics families; `clauseExpectations` is exported separately so a future
 * clause-readiness aggregator can bind the same source evidence.
 */

import type { MagicItemMechanics } from '../../../src/rules/magicItemMechanics.js';
import type {
  ItemClauseExpectation,
  MagicItemFamilyProjection,
} from './magicItemCompiler.js';
import type { MagicItemExtraction } from './types.js';

export interface MagicItemChargeClauseExpectation {
  readonly id: string;
  readonly sourcePhrases: readonly string[];
}

interface ChargeSpec {
  readonly mechanics: Pick<MagicItemMechanics, 'economies' | 'operations'>;
  readonly sourcePhrases: readonly string[];
}

type Operation = NonNullable<MagicItemMechanics['operations']>[number];
type Economy = NonNullable<MagicItemMechanics['economies']>[string];

const op = (
  id: string,
  amount: number | string = 1,
  economy = 'charges',
): Operation => ({
  id,
  cost: [{ economy, amount }],
});

const pool = (
  max: number | string,
  recharge?: number | string | 'all',
  onDepleted?: NonNullable<Economy['onDepleted']>,
): Economy => ({
  kind: 'charges',
  charges: { max },
  ...(recharge === undefined
    ? {}
    : { reset: [{ at: 'dawn' as const, amount: recharge }] }),
  ...(onDepleted === undefined ? {} : { onDepleted }),
});

const gemPool = (max: string): Economy => ({
  ...pool(max),
  note: 'The helm loses its magic only when every gem economy is depleted.',
});

const standard = (
  max: number | string,
  recharge: number | string | 'all' | undefined,
  operations: readonly Operation[],
  sourcePhrases: readonly string[],
  onDepleted?: NonNullable<Economy['onDepleted']>,
): ChargeSpec => ({
  mechanics: {
    economies: { charges: pool(max, recharge, onDepleted) },
    operations,
  },
  sourcePhrases,
});

const DESTROY_ON_ONE = {
  roll: 'd20',
  destroyedOn: 1,
  becomes: 'destroyed' as const,
};
const NONMAGICAL_ON_ONE = {
  roll: 'd20',
  destroyedOn: 1,
  becomes: 'nonmagical' as const,
};

const SPECS: ReadonlyMap<string, ChargeSpec> = new Map([
  [
    'Cube of Force',
    standard(
      36,
      '1d20',
      [
        op('press-face-1', 1),
        op('press-face-2', 2),
        op('press-face-3', 3),
        op('press-face-4', 4),
        op('press-face-5', 5),
        { id: 'press-face-6', doesNotExpend: ['charges'] },
        op('spell-contact-loss', 'variable'),
      ],
      [
        'The cube starts with 36 charges',
        'it regains 1d20 expended charges daily at dawn',
        'expending a number of charges based on the chosen face',
        'The cube loses charges when the barrier is targeted by certain spells',
      ],
    ),
  ],
  [
    'Cubic Gate',
    standard(
      3,
      '1d3',
      [op('cast-gate'), op('cast-plane-shift')],
      [
        'The cube has 3 charges',
        'Each use of the cube expends 1 charge',
        'regains 1d3 expended charges daily at dawn',
      ],
    ),
  ],
  [
    'Eyes of Charming',
    standard(
      3,
      'all',
      [op('cast-charm-person')],
      [
        'They have 3 charges',
        'expend 1 charge as an action to cast the charm person spell',
        'regain all expended charges daily at dawn',
      ],
    ),
  ],
  [
    'Figurine of Wondrous Power',
    {
      mechanics: {
        economies: {
          'goat-of-traveling-hour-charges': {
            kind: 'charges',
            charges: { max: 24 },
            reset: [{ at: 'days', days: 7, amount: 'all' }],
            onDepleted: { becomes: 'inert' },
          },
        },
        operations: [
          op(
            'goat-of-traveling-beast-form-hour',
            1,
            'goat-of-traveling-hour-charges',
          ),
        ],
      },
      sourcePhrases: [
        'The goat of traveling',
        'It has 24 charges',
        'each hour or portion thereof it spends in beast form costs 1 charge',
        'can’t be used again until 7 days have passed',
        'when it regains all its charges',
      ],
    },
  ],
  [
    'Gem of Brightness',
    standard(
      50,
      undefined,
      [
        { id: 'shed-light', doesNotExpend: ['charges'] },
        op('blinding-beam'),
        op('blinding-cone', 5),
      ],
      [
        'This prism has 50 charges',
        'This effect doesn’t expend a charge',
        'The second command word expends 1 charge',
        'The third command word expends 5 charges',
        'the gem becomes a nonmagical jewel worth 50 gp',
      ],
      { loseProperty: true, becomes: 'nonmagical' },
    ),
  ],
  [
    'Gem of Seeing',
    standard(
      3,
      '1d3',
      [op('gain-truesight')],
      [
        'This gem has 3 charges',
        'expend 1 charge',
        'regains 1d3 expended charges daily at dawn',
      ],
    ),
  ],
  [
    'Hammer of Thunderbolts',
    standard(
      5,
      '1d4+1',
      [op('hurl-thunderclap')],
      [
        'The hammer also has 5 charges',
        'expend 1 charge and make a ranged weapon attack',
        'regains 1d4 + 1 expended charges daily at dawn',
      ],
    ),
  ],
  [
    'Helm of Brilliance',
    {
      mechanics: {
        economies: {
          diamonds: gemPool('1d10'),
          rubies: gemPool('2d10'),
          'fire-opals': gemPool('3d10'),
          opals: gemPool('4d10'),
        },
        operations: [
          op('cast-prismatic-spray', 1, 'diamonds'),
          op('cast-wall-of-fire', 1, 'rubies'),
          op('cast-fireball', 1, 'fire-opals'),
          op('cast-daylight', 1, 'opals'),
        ],
      },
      sourcePhrases: [
        'set with 1d10 diamonds, 2d10 rubies, 3d10 fire opals, and 4d10 opals',
        'using one of the helm’s gems of the specified type as a component',
        'The gem is destroyed when the spell is cast',
      ],
    },
  ],
  [
    'Helm of Teleportation',
    standard(
      3,
      '1d3',
      [op('cast-teleport')],
      [
        'This helm has 3 charges',
        'expend 1 charge to cast the teleport spell',
        'regains 1d3 expended charges daily at dawn',
      ],
    ),
  ],
  [
    'Luck Blade',
    standard(
      '1d4-1',
      undefined,
      [op('cast-wish')],
      [
        'The sword has 1d4 – 1 charges',
        'expend 1 charge and cast the wish spell',
        'loses this property if it has no charges',
      ],
      { loseProperty: true },
    ),
  ],
  [
    'Mace of Terror',
    standard(
      3,
      '1d3',
      [op('release-terror-wave')],
      [
        'has 3 charges',
        'expend 1 charge to release a wave of terror',
        'regains 1d3 expended charges daily at dawn',
      ],
    ),
  ],
  [
    'Medallion of Thoughts',
    standard(
      3,
      '1d3',
      [op('cast-detect-thoughts')],
      [
        'The medallion has 3 charges',
        'expend 1 charge to cast the detect thoughts spell',
        'regains 1d3 expended charges daily at dawn',
      ],
    ),
  ],
  [
    'Necklace of Fireballs',
    standard(
      '1d6+3',
      undefined,
      [op('throw-fireball-beads', 'variable')],
      [
        'This necklace has 1d6 + 3 beads',
        'detach a bead and throw it',
        'increase the level of the fireball by 1 for each bead beyond the first',
      ],
      { becomes: 'destroyed' },
    ),
  ],
  [
    'Nine Lives Stealer',
    standard(
      '1d8+1',
      undefined,
      [op('slay-on-critical')],
      [
        'The sword has 1d8 + 1 charges',
        'The sword loses 1 charge if the creature is slain',
        'loses this property',
      ],
      { loseProperty: true },
    ),
  ],
  [
    'Orb of Dragonkind',
    standard(
      7,
      '1d4+3',
      [
        op('cast-cure-wounds', 3),
        op('cast-daylight'),
        op('cast-death-ward', 2),
        op('cast-scrying', 3),
        { id: 'cast-detect-magic', doesNotExpend: ['charges'] },
      ],
      [
        'The orb has 7 charges',
        'regains 1d4 + 3 expended charges daily at dawn',
        'cure wounds (5th-level version, 3 charges), daylight (1 charge), death ward (2 charges), or scrying (3 charges)',
        'without using any charges',
      ],
    ),
  ],
  [
    'Pipes of Haunting',
    standard(
      3,
      '1d3',
      [op('play-haunting-tune')],
      [
        'They have 3 charges',
        'expend 1 charge to create an eerie, spellbinding tune',
        'regain 1d3 expended charges daily at dawn',
      ],
    ),
  ],
  [
    'Pipes of the Sewers',
    standard(
      3,
      '1d3',
      [op('call-rat-swarms', 'variable')],
      [
        'The pipes have 3 charges',
        'expend 1 to 3 charges',
        'one swarm of rats with each expended charge',
        'regain 1d3 expended charges daily at dawn',
      ],
    ),
  ],
  [
    'Ring of Animal Influence',
    standard(
      3,
      '1d3',
      [
        op('cast-animal-friendship'),
        op('cast-fear'),
        op('cast-speak-with-animals'),
      ],
      [
        'This ring has 3 charges',
        'regains 1d3 expended charges daily at dawn',
        'expend 1 of its charges to cast one of the following spells',
      ],
    ),
  ],
  [
    'Ring of Elemental Command',
    standard(
      5,
      '1d4+1',
      [
        op('dominate-air-elemental', 2),
        op('cast-chain-lightning', 3),
        op('cast-gust-of-wind', 2),
        op('cast-wind-wall'),
        op('dominate-earth-elemental', 2),
        op('cast-stone-shape', 2),
        op('cast-stoneskin', 3),
        op('cast-wall-of-stone', 3),
        op('dominate-fire-elemental', 2),
        op('cast-burning-hands'),
        op('cast-fireball', 2),
        op('cast-wall-of-fire', 3),
        op('dominate-water-elemental', 2),
        op('cast-create-or-destroy-water'),
        op('cast-control-water', 3),
        op('cast-ice-storm', 2),
        op('cast-wall-of-ice', 3),
      ],
      [
        'The ring has 5 charges',
        'regains 1d4 + 1 expended charges daily at dawn',
        'expending the necessary number of charges',
      ],
    ),
  ],
  [
    'Ring of Evasion',
    standard(
      3,
      '1d3',
      [op('turn-failed-dex-save-into-success')],
      [
        'This ring has 3 charges',
        'regains 1d3 expended charges daily at dawn',
        'expend 1 of its charges to succeed',
      ],
    ),
  ],
  [
    'Ring of Shooting Stars',
    standard(
      6,
      '1d6',
      [
        op('cast-faerie-fire'),
        op('create-ball-lightning', 2),
        op('launch-shooting-stars', 'variable'),
      ],
      [
        'The ring has 6 charges',
        'regains 1d6 expended charges daily at dawn',
        'expend 1 charge as an action to cast faerie fire',
        'expend 2 charges as an action to create',
        'expend 1 to 3 charges as an action',
      ],
    ),
  ],
  [
    'Ring of the Ram',
    standard(
      3,
      '1d3',
      [op('spectral-ram-attack', 'variable'), op('break-object', 'variable')],
      [
        'This ring has 3 charges',
        'regains 1d3 expended charges daily at dawn',
        'expend 1 to 3 of its charges to attack',
        'expend 1 to 3 of the ring’s charges as an action to try to break an object',
      ],
    ),
  ],
  [
    'Ring of Three Wishes',
    standard(
      3,
      undefined,
      [op('cast-wish')],
      [
        'While wearing this ring, you can use an action to expend 1 of its 3 charges',
        'The ring becomes nonmagical when you use the last charge',
      ],
      { becomes: 'nonmagical' },
    ),
  ],
  [
    'Robe of Scintillating Colors',
    standard(
      3,
      '1d3',
      [op('display-scintillating-colors')],
      [
        'This robe has 3 charges',
        'regains 1d3 expended charges daily at dawn',
        'expend 1 charge to cause the garment to display',
      ],
    ),
  ],
  [
    'Robe of Stars',
    {
      mechanics: {
        economies: {
          stars: {
            kind: 'charges',
            charges: { max: 6 },
            reset: [{ at: 'dusk', amount: '1d6' }],
          },
        },
        operations: [op('cast-magic-missile', 1, 'stars')],
      },
      sourcePhrases: [
        'Six stars, located on the robe’s upper front portion',
        'pull off one of the stars and use it to cast magic missile',
        'Daily at dusk, 1d6 removed stars reappear',
      ],
    },
  ],
  [
    'Scarab of Protection',
    standard(
      12,
      undefined,
      [op('turn-failed-save-into-success')],
      [
        'The scarab has 12 charges',
        'expend 1 charge and turn the failed save into a successful one',
        'The scarab crumbles into powder and is destroyed when its last charge is expended',
      ],
      { becomes: 'destroyed' },
    ),
  ],
  [
    'Staff of Charming',
    standard(
      10,
      '1d8+2',
      [
        op('cast-charm-person'),
        op('cast-command'),
        op('cast-comprehend-languages'),
        op('reflect-enchantment'),
      ],
      [
        'expend 1 of its 10 charges',
        'reaction to expend 1 charge',
        'regains 1d8 + 2 expended charges daily at dawn',
        'If you expend the last charge',
      ],
      NONMAGICAL_ON_ONE,
    ),
  ],
  [
    'Staff of Fire',
    standard(
      10,
      '1d6+4',
      [
        op('cast-burning-hands'),
        op('cast-fireball', 3),
        op('cast-wall-of-fire', 4),
      ],
      [
        'The staff has 10 charges',
        'burning hands (1 charge), fireball (3 charges), or wall of fire (4 charges)',
        'regains 1d6 + 4 expended charges daily at dawn',
        'If you expend the last charge',
      ],
      DESTROY_ON_ONE,
    ),
  ],
  [
    'Staff of Frost',
    standard(
      10,
      '1d6+4',
      [
        op('cast-cone-of-cold', 5),
        op('cast-fog-cloud'),
        op('cast-ice-storm', 4),
        op('cast-wall-of-ice', 4),
      ],
      [
        'The staff has 10 charges',
        'cone of cold (5 charges), fog cloud (1 charge), ice storm (4 charges), or wall of ice (4 charges)',
        'regains 1d6 + 4 expended charges daily at dawn',
        'If you expend the last charge',
      ],
      DESTROY_ON_ONE,
    ),
  ],
  [
    'Staff of Healing',
    standard(
      10,
      '1d6+4',
      [
        op('cast-cure-wounds', 'variable'),
        op('cast-lesser-restoration', 2),
        op('cast-mass-cure-wounds', 5),
      ],
      [
        'This staff has 10 charges',
        'cure wounds (1 charge per spell level, up to 4th), lesser restoration (2 charges), or mass cure wounds (5 charges)',
        'regains 1d6 + 4 expended charges daily at dawn',
        'If you expend the last charge',
      ],
      DESTROY_ON_ONE,
    ),
  ],
  [
    'Staff of Power',
    standard(
      20,
      '2d8+4',
      [
        op('power-strike'),
        op('cast-cone-of-cold', 5),
        op('cast-fireball', 5),
        op('cast-globe-of-invulnerability', 6),
        op('cast-hold-monster', 5),
        op('cast-levitate', 2),
        op('cast-lightning-bolt', 5),
        op('cast-magic-missile'),
        op('cast-ray-of-enfeeblement'),
        op('cast-wall-of-force', 5),
      ],
      [
        'The staff has 20 charges',
        'regains 2d8 + 4 expended charges daily at dawn',
        'If you expend the last charge',
        'On a 20, the staff regains 1d8 + 2 charges',
      ],
      {
        roll: 'd20',
        losePropertyOn: 1,
        regainOn: 20,
        regainAmount: '1d8+2',
      },
    ),
  ],
  [
    'Staff of Striking',
    standard(
      10,
      '1d6+4',
      [op('powerful-strike', 'variable')],
      [
        'The staff has 10 charges',
        'expend up to 3 of its charges',
        'regains 1d6 + 4 expended charges daily at dawn',
        'If you expend the last charge',
      ],
      NONMAGICAL_ON_ONE,
    ),
  ],
  [
    'Staff of Swarming Insects',
    standard(
      10,
      '1d6+4',
      [
        op('cast-giant-insect', 4),
        op('cast-insect-plague', 5),
        op('create-insect-cloud'),
      ],
      [
        'This staff has 10 charges',
        'regains 1d6 + 4 expended charges daily at dawn',
        'giant insect (4 charges) or insect plague (5 charges)',
        'expend 1 charge to cause a swarm',
        'If you expend the last charge',
      ],
      DESTROY_ON_ONE,
    ),
  ],
  [
    'Staff of the Magi',
    standard(
      50,
      '4d6+2',
      [
        op('cast-conjure-elemental', 7),
        op('cast-dispel-magic', 3),
        op('cast-fireball', 7),
        op('cast-flaming-sphere', 2),
        op('cast-ice-storm', 4),
        op('cast-invisibility', 2),
        op('cast-knock', 2),
        op('cast-lightning-bolt', 7),
        op('cast-passwall', 5),
        op('cast-plane-shift', 7),
        op('cast-telekinesis', 5),
        op('cast-wall-of-fire', 4),
        op('cast-web', 2),
        ...[
          'arcane-lock',
          'detect-magic',
          'enlarge-reduce',
          'light',
          'mage-hand',
          'protection-from-evil-and-good',
        ].map((id) => ({ id: `cast-${id}`, doesNotExpend: ['charges'] })),
      ],
      [
        'The staff has 50 charges',
        'regains 4d6 + 2 expended charges daily at dawn',
        'If you expend the last charge',
        'On a 20, the staff regains 1d12 + 1 charges',
        'without using any charges',
      ],
      { roll: 'd20', regainOn: 20, regainAmount: '1d12+1' },
    ),
  ],
  [
    'Staff of the Woodlands',
    standard(
      10,
      '1d6+4',
      [
        op('cast-animal-friendship'),
        op('cast-awaken', 5),
        op('cast-barkskin', 2),
        op('cast-locate-animals-or-plants', 2),
        op('cast-speak-with-animals'),
        op('cast-speak-with-plants', 3),
        op('cast-wall-of-thorns', 6),
        op('tree-form'),
        { id: 'cast-pass-without-trace', doesNotExpend: ['charges'] },
      ],
      [
        'The staff has 10 charges',
        'regains 1d6 + 4 expended charges daily at dawn',
        'If you expend the last charge',
        'without using any charges',
        'expend 1 charge to transform the staff into a healthy tree',
      ],
      NONMAGICAL_ON_ONE,
    ),
  ],
  [
    'Staff of Thunder and Lightning',
    {
      mechanics: {
        economies: Object.fromEntries(
          [
            'lightning',
            'thunder',
            'lightning-strike',
            'thunderclap',
            'thunder-and-lightning',
          ].map((id) => [
            id,
            {
              kind: 'per-day',
              perDay: { uses: 1 },
              reset: [{ at: 'dawn', amount: 'all' }],
            },
          ]),
        ),
        operations: [
          op('lightning', 1, 'lightning'),
          op('thunder', 1, 'thunder'),
          op('lightning-strike', 1, 'lightning-strike'),
          op('thunderclap', 1, 'thunderclap'),
          {
            ...op('thunder-and-lightning', 1, 'thunder-and-lightning'),
            activation: { cost: 'action' },
            doesNotExpend: ['lightning-strike', 'thunderclap'],
            effects: ['c2-lightning-strike-payload', 'c2-thunderclap-payload'],
          },
        ],
      },
      sourcePhrases: [
        'When one of these properties is used, it can’t be used again until the next dawn',
        'use the Lightning Strike and Thunderclap properties at the same time',
        'Doing so doesn’t expend the daily use of those properties',
      ],
    },
  ],
  [
    'Staff of Withering',
    standard(
      3,
      '1d3',
      [op('withering-strike')],
      [
        'This staff has 3 charges',
        'regains 1d3 expended charges daily at dawn',
        'expend 1 charge to deal an extra 2d10 necrotic damage',
      ],
    ),
  ],
  [
    'Talisman of Pure Good',
    standard(
      7,
      undefined,
      [op('open-fissure')],
      [
        'The talisman has 7 charges',
        'expend 1 charge from it',
        'When you expend the last charge',
        'is destroyed',
      ],
      { becomes: 'destroyed' },
    ),
  ],
  [
    'Talisman of Ultimate Evil',
    standard(
      6,
      undefined,
      [op('open-fissure')],
      [
        'The talisman has 6 charges',
        'expend 1 charge from the talisman',
        'When you expend the last charge',
        'is destroyed',
      ],
      { becomes: 'destroyed' },
    ),
  ],
  [
    'Trident of Fish Command',
    standard(
      3,
      '1d3',
      [op('cast-dominate-beast')],
      [
        'It has 3 charges',
        'expend 1 charge to cast dominate beast',
        'regains 1d3 expended charges daily at dawn',
      ],
    ),
  ],
  [
    'Rod of Lordly Might',
    {
      mechanics: {
        economies: Object.fromEntries(
          ['drain-life', 'paralyze', 'terrify'].map((id) => [
            id,
            {
              kind: 'per-day',
              perDay: { uses: 1 },
              reset: [{ at: 'dawn', amount: 'all' }],
            },
          ]),
        ),
        operations: [
          op('drain-life', 1, 'drain-life'),
          op('paralyze', 1, 'paralyze'),
          op('terrify', 1, 'terrify'),
        ],
      },
      sourcePhrases: [
        'Drain Life.',
        'Paralyze.',
        'Terrify.',
        'This property can’t be used again until the next dawn',
      ],
    },
  ],
  ...(
    [
      [
        'Wand of Binding',
        7,
        '1d6+1',
        [
          op('cast-hold-monster', 5),
          op('cast-hold-person', 2),
          op('assisted-escape'),
        ],
      ],
      ['Wand of Enemy Detection', 7, '1d6+1', [op('detect-enemy')]],
      ['Wand of Fear', 7, '1d6+1', [op('command'), op('cone-of-fear', 2)]],
      ['Wand of Fireballs', 7, '1d6+1', [op('cast-fireball', 'variable')]],
      [
        'Wand of Lightning Bolts',
        7,
        '1d6+1',
        [op('cast-lightning-bolt', 'variable')],
      ],
      ['Wand of Magic Detection', 3, '1d3', [op('cast-detect-magic')]],
      [
        'Wand of Magic Missiles',
        7,
        '1d6+1',
        [op('cast-magic-missile', 'variable')],
      ],
      ['Wand of Paralysis', 7, '1d6+1', [op('paralyzing-ray')]],
      ['Wand of Polymorph', 7, '1d6+1', [op('cast-polymorph')]],
      ['Wand of Secrets', 3, '1d3', [op('detect-secret')]],
      ['Wand of Web', 7, '1d6+1', [op('cast-web')]],
      ['Wand of Wonder', 7, '1d6+1', [op('produce-random-effect')]],
    ] as const
  ).map(
    ([name, max, recharge, operations]) =>
      [
        name,
        standard(
          max,
          recharge,
          operations,
          [
            `has ${max} charges`,
            `regains ${String(recharge).replace(/([+-])/g, ' $1 ')} expended charges daily at dawn`,
            'expend',
          ],
          max === 7 ? DESTROY_ON_ONE : undefined,
        ),
      ] as const,
  ),
]);

/** Exact reviewed membership for this bounded source profile (53 records). */
export const EXPECTED_MAGIC_ITEM_CHARGE_ECONOMY_NAMES: ReadonlySet<string> =
  new Set([
    'Cube of Force',
    'Cubic Gate',
    'Eyes of Charming',
    'Figurine of Wondrous Power',
    'Gem of Brightness',
    'Gem of Seeing',
    'Hammer of Thunderbolts',
    'Helm of Brilliance',
    'Helm of Teleportation',
    'Luck Blade',
    'Mace of Terror',
    'Medallion of Thoughts',
    'Necklace of Fireballs',
    'Nine Lives Stealer',
    'Orb of Dragonkind',
    'Pipes of Haunting',
    'Pipes of the Sewers',
    'Ring of Animal Influence',
    'Ring of Elemental Command',
    'Ring of Evasion',
    'Ring of Shooting Stars',
    'Ring of the Ram',
    'Ring of Three Wishes',
    'Robe of Scintillating Colors',
    'Robe of Stars',
    'Scarab of Protection',
    'Staff of Charming',
    'Staff of Fire',
    'Staff of Frost',
    'Staff of Healing',
    'Staff of Power',
    'Staff of Striking',
    'Staff of Swarming Insects',
    'Staff of the Magi',
    'Staff of the Woodlands',
    'Staff of Thunder and Lightning',
    'Staff of Withering',
    'Talisman of Pure Good',
    'Talisman of Ultimate Evil',
    'Trident of Fish Command',
    'Rod of Lordly Might',
    'Wand of Binding',
    'Wand of Enemy Detection',
    'Wand of Fear',
    'Wand of Fireballs',
    'Wand of Lightning Bolts',
    'Wand of Magic Detection',
    'Wand of Magic Missiles',
    'Wand of Paralysis',
    'Wand of Polymorph',
    'Wand of Secrets',
    'Wand of Web',
    'Wand of Wonder',
  ]);

export const MAGIC_ITEM_CHARGE_SOURCE_EXPECTATIONS: ReadonlyMap<
  string,
  readonly MagicItemChargeClauseExpectation[]
> = new Map(
  [...SPECS].map(([name, spec]) => [
    name,
    [{ id: 'charge-economy', sourcePhrases: spec.sourcePhrases }],
  ]),
);

function clausesFor(spec: ChargeSpec): readonly ItemClauseExpectation[] {
  const engineHooks = [
    { engine: 'F5' as const, hook: 'magic-item-usage-recharge' },
  ];
  return [
    ...Object.keys(spec.mechanics.economies ?? {}).map(
      (economyId): ItemClauseExpectation => ({
        id: `c1-economy-${economyId}`,
        tag: 'C1',
        representation: { block: 'economies', economyId },
        engineHooks,
      }),
    ),
    ...(spec.mechanics.operations ?? []).map(
      (operation): ItemClauseExpectation => ({
        id: `c1-operation-${operation.id}`,
        tag: 'C1',
        representation: {
          block: 'operations',
          operationId: operation.id,
        },
        engineHooks,
      }),
    ),
  ];
}

export const MAGIC_ITEM_CHARGE_CLAUSE_EXPECTATIONS: ReadonlyMap<
  string,
  readonly ItemClauseExpectation[]
> = new Map([...SPECS].map(([name, spec]) => [name, clausesFor(spec)]));

export function deriveMagicItemChargeMechanics(
  item: MagicItemExtraction,
): Pick<MagicItemMechanics, 'economies' | 'operations'> | undefined {
  const spec = SPECS.get(item.name);
  if (spec === undefined) return undefined;
  for (const phrase of spec.sourcePhrases) {
    if (!item.description.includes(phrase)) {
      throw new Error(
        `magic-item C1 charge projection: expected source phrase ${JSON.stringify(phrase)} not found in "${item.name}" description`,
      );
    }
  }
  return spec.mechanics;
}

/** Framework-facing family API; aggregation and emission remain separate. */
export function projectMagicItemChargeEconomies(
  item: MagicItemExtraction,
): MagicItemFamilyProjection | undefined {
  const mechanics = deriveMagicItemChargeMechanics(item);
  if (mechanics === undefined) return undefined;
  return {
    family: 'c1-charge-economies',
    mechanics,
    clauses: MAGIC_ITEM_CHARGE_CLAUSE_EXPECTATIONS.get(item.name) ?? [],
  };
}
