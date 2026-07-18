/**
 * Source-grounded M4 projection for magic-item-created, summoned, controlled,
 * and illusory entities. This is immutable pack data only: live hit points,
 * initiative, position, and ownership remain encounter-combatant/persistent-
 * actor state owned by the F3 lifecycle service.
 */
import type {
  MagicItemEntityGrant,
  MagicItemMechanics,
} from '../../../src/rules/magicItemMechanics.js';
import type {
  EngineHookBinding,
  MagicItemFamilyProjection,
} from './magicItemCompiler.js';
import type { MagicItemExtraction } from './types.js';

type EntityGrantEntry = MagicItemEntityGrant['grants'][number];

interface EntityGrantSpec {
  readonly sourcePhrases: readonly string[];
  readonly entityGrant: MagicItemEntityGrant;
  readonly hooks?: readonly EngineHookBinding[];
}

const F3_ENTITY_OWNER = {
  engine: 'F3',
  hook: 'encounter combatant, persistent actor, and owned-entity lifecycle',
} as const;
const F2_COMMAND = {
  engine: 'F2',
  hook: 'controlled-entity command action budget',
} as const;
const F5_ITEM_LINK = {
  engine: 'F5',
  hook: 'item-instance cooldown and owned-entity identity link',
} as const;
const CONTROLLED_HOOKS = [F3_ENTITY_OWNER, F2_COMMAND, F5_ITEM_LINK] as const;
const LIFECYCLE_HOOKS = [F3_ENTITY_OWNER, F5_ITEM_LINK] as const;

const creature = (
  id: string,
  creatureRef: string,
  rest: Omit<EntityGrantEntry, 'id' | 'kind' | 'creatureRefs'> = {},
): EntityGrantEntry => ({
  id,
  kind: 'creature',
  creatureRefs: [creatureRef],
  ...rest,
});

const elementalVessel = (
  creatureRef: string,
  operationId: string,
  requirement: string,
): EntityGrantSpec => ({
  sourcePhrases: [
    requirement,
    'as if you had cast the conjure elemental spell',
    'until the next dawn',
  ],
  entityGrant: {
    runtimeOwner: 'encounter-combatant',
    grants: [
      creature(operationId, creatureRef, {
        control: 'as spell:conjure-elemental',
        duration: { amount: 1, unit: 'hour' },
        revertOn: [
          'concentration-ended',
          'reduced-to-0-hit-points',
          'one-hour-ended',
        ],
        cooldownEconomy: 'uses',
        exclusiveInstance: { scope: 'item', recast: 'blocked' },
        note: 'Uses the conjure elemental spell lifecycle and concentration contract.',
      }),
    ],
  },
  hooks: CONTROLLED_HOOKS,
});

const FIGURINE_REVERT = [
  'duration-ended',
  'reduced-to-0-hit-points',
  'owner-command-while-touching',
] as const;
const figurine = (
  id: string,
  ref: string,
  durationHours: number,
  rest: Omit<
    EntityGrantEntry,
    'id' | 'kind' | 'creatureRefs' | 'duration' | 'revertOn'
  > = {},
): EntityGrantEntry =>
  creature(id, ref, {
    control:
      'friendly; understands owner languages and obeys spoken commands; otherwise only defends itself',
    duration: { amount: durationHours, unit: 'hour' },
    revertOn: FIGURINE_REVERT,
    exclusiveInstance: { scope: 'item', recast: 'blocked' },
    ...rest,
  });

const SPECS: ReadonlyMap<string, EntityGrantSpec> = new Map([
  [
    'Bag of Tricks',
    {
      sourcePhrases: [
        'rolling a d8 and consulting the table that corresponds to the bag’s color',
        'vanishes at the next dawn or when it is reduced to 0 hit points',
        'use a bonus action to command',
      ],
      entityGrant: {
        runtimeOwner: 'encounter-combatant',
        grants: [
          {
            id: 'bag-creature',
            kind: 'creature',
            tableRefs: [
              'table:gray-bag-of-tricks',
              'table:rust-bag-of-tricks',
              'table:tan-bag-of-tricks',
            ],
            count: 1,
            control:
              'friendly; acts on owner turn; bonus-action specific or general commands; otherwise acts according to its nature',
            revertOn: ['next-dawn', 'reduced-to-0-hit-points'],
            cooldownEconomy: 'uses',
            note: 'Each pull creates a separately owned combatant; item state stores only the three-pulls-per-dawn economy.',
          },
        ],
      },
      hooks: CONTROLLED_HOOKS,
    },
  ],
  [
    'Bowl of Commanding Water Elementals',
    elementalVessel(
      'creature:water-elemental',
      'water-elemental',
      'While this bowl is filled with water',
    ),
  ],
  [
    'Brazier of Commanding Fire Elementals',
    elementalVessel(
      'creature:fire-elemental',
      'fire-elemental',
      'While a fire burns in this brass brazier',
    ),
  ],
  [
    'Censer of Controlling Air Elementals',
    elementalVessel(
      'creature:air-elemental',
      'air-elemental',
      'While incense is burning in this censer',
    ),
  ],
  [
    'Stone of Controlling Earth Elementals',
    elementalVessel(
      'creature:earth-elemental',
      'earth-elemental',
      'If the stone is touching the ground',
    ),
  ],
  [
    'Efreeti Bottle',
    {
      sourcePhrases: [
        'The first time the bottle is opened, the GM rolls to determine what happens',
      ],
      entityGrant: {
        runtimeOwner: 'persistent-actor',
        grants: [
          creature('hostile-efreeti', 'creature:efreeti', {
            tableRefs: ['table:efreeti-bottle'],
            duration: { amount: 5, unit: 'round' },
            control: 'hostile; attacks opener',
            revertOn: ['five-rounds-ended'],
            onEntityDeath:
              'resolve the efreeti’s normal death; the bottle outcome remains spent',
            exclusiveInstance: { scope: 'item', recast: 'blocked' },
          }),
          creature('serving-efreeti', 'creature:efreeti', {
            tableRefs: ['table:efreeti-bottle'],
            duration: { amount: 1, unit: 'hour' },
            control: 'serves opener and does as commanded',
            revertOn: ['one-hour-ended'],
            exclusiveInstance: { scope: 'item', recast: 'blocked' },
            note: 'Returns to bottle; the same outcome occurs on the next two openings, each separated by 24 hours; fourth opening frees it and ends the bottle’s magic.',
          }),
          creature('wish-granting-efreeti', 'creature:efreeti', {
            tableRefs: ['table:efreeti-bottle'],
            duration: { amount: 1, unit: 'hour' },
            control: 'casts wish up to three times for opener',
            revertOn: ['third-wish-granted', 'one-hour-ended'],
            exclusiveInstance: { scope: 'item', recast: 'blocked' },
            note: 'Disappears and the bottle loses its magic when either termination occurs.',
          }),
        ],
        note: 'Exactly one first-open d100 outcome applies; the table, not item live state, identifies the conditional grant.',
      },
      hooks: CONTROLLED_HOOKS,
    },
  ],
  [
    'Elemental Gem',
    {
      sourcePhrases: [
        'use an action to break the gem',
        'summoned as if you had cast the conjure elemental spell',
        'type of gem determines the elemental summoned',
      ],
      entityGrant: {
        runtimeOwner: 'encounter-combatant',
        grants: [
          {
            id: 'gem-elemental',
            kind: 'creature',
            creatureRefs: [
              'creature:air-elemental',
              'creature:earth-elemental',
              'creature:fire-elemental',
              'creature:water-elemental',
            ],
            tableRefs: ['table:elemental-gem'],
            count: 1,
            control: 'as spell:conjure-elemental',
            duration: { amount: 1, unit: 'hour' },
            revertOn: [
              'concentration-ended',
              'reduced-to-0-hit-points',
              'one-hour-ended',
            ],
            cooldownEconomy: 'quantity',
            exclusiveInstance: { scope: 'item', recast: 'blocked' },
            note: 'Gem type selects exactly one elemental; breaking the gem consumes it.',
          },
        ],
      },
      hooks: CONTROLLED_HOOKS,
    },
  ],
  [
    'Feather Token',
    {
      sourcePhrases: [
        'bird has the statistics of a roc',
        'obeys your simple commands and can’t attack',
        'floating whip takes its place',
        'whip disappears after 1 hour',
      ],
      entityGrant: {
        runtimeOwner: 'persistent-actor',
        grants: [
          creature('bird-token', 'creature:roc', {
            tableRefs: ['table:feather-token'],
            control: 'obeys simple commands; cannot attack',
            revertOn: [
              'maximum-daily-flight-distance-reached',
              'reduced-to-0-hit-points',
              'owner-dismisses-as-action',
            ],
            cooldownEconomy: 'quantity',
            exclusiveInstance: { scope: 'item', recast: 'blocked' },
            note: 'Carries 500 pounds at 16 mph for at most 144 miles/day or 1,000 pounds at half speed; rests one hour per three hours flown.',
          }),
          {
            id: 'whip-token',
            kind: 'object',
            tableRefs: ['table:feather-token'],
            count: 1,
            control:
              'owner bonus action moves it up to 20 feet and makes its melee spell attack',
            duration: { amount: 1, unit: 'hour' },
            revertOn: [
              'owner-dismisses-as-action',
              'owner-incapacitated',
              'owner-dies',
            ],
            cooldownEconomy: 'quantity',
            exclusiveInstance: { scope: 'item', recast: 'blocked' },
            note: 'Floating attacking object; never a creature combatant.',
          },
        ],
        note: 'Only the Bird and Whip table selections create live owned entities.',
      },
      hooks: CONTROLLED_HOOKS,
    },
  ],
  [
    'Figurine of Wondrous Power',
    {
      sourcePhrases: [
        'becomes a living creature',
        'reverts to a figurine early if it drops to 0 hit points',
        'These gold statuettes of lions are always created in pairs',
        'same statistics as a riding horse',
        '10 percent chance each time you use it to ignore your orders',
      ],
      entityGrant: {
        runtimeOwner: 'persistent-actor',
        grants: [
          figurine('bronze-griffon', 'creature:griffon', 6, {
            note: 'Five-day per-figurine cooldown begins on reversion.',
          }),
          {
            id: 'ebony-fly',
            kind: 'creature',
            statBlockRef: 'stat-block:giant-fly',
            control:
              'friendly; understands owner languages and obeys spoken commands; otherwise only defends itself',
            duration: { amount: 12, unit: 'hour' },
            revertOn: FIGURINE_REVERT,
            exclusiveInstance: { scope: 'item', recast: 'blocked' },
            note: 'Rideable mount; two-day cooldown begins on reversion.',
          },
          figurine('golden-lions', 'creature:lion', 1, {
            count: 2,
            exclusiveInstance: { scope: 'item', recast: 'dismiss-existing' },
            note: 'The pair may transform separately or simultaneously; each lion has its own seven-day cooldown.',
          }),
          creature('goat-of-traveling', 'creature:riding-horse', {
            control:
              'friendly; understands owner languages and obeys spoken commands; otherwise only defends itself',
            revertOn: FIGURINE_REVERT,
            cooldownEconomy: 'goat-of-traveling-hour-charges',
            exclusiveInstance: { scope: 'item', recast: 'blocked' },
            note: 'Large goat using riding-horse statistics; duration is charged per hour or portion, with no fixed cap.',
          }),
          figurine('goat-of-travail', 'creature:giant-goat', 3, {
            note: 'Thirty-day cooldown begins on reversion.',
          }),
          figurine('goat-of-terror', 'creature:giant-goat', 3, {
            control: 'friendly and commanded but cannot attack',
            note: 'Fifteen-day cooldown begins on reversion; horns and terror aura are represented by their C2 clauses.',
          }),
          figurine('marble-elephant', 'creature:elephant', 24, {
            note: 'Seven-day cooldown begins on reversion.',
          }),
          figurine('obsidian-steed', 'creature:nightmare', 24, {
            control:
              'normally fights only to defend itself; for a good-aligned user, 10% chance per use to ignore all orders',
            note: 'Five-day cooldown begins on reversion; mounting while it disobeys transports both to Hades and reverts it.',
          }),
          figurine('onyx-dog', 'creature:mastiff', 6, {
            note: 'Mastiff has Intelligence 8, Common, darkvision 60 feet, and sees invisible within 60 feet; seven-day cooldown.',
          }),
          figurine('serpentine-owl', 'creature:giant-owl', 8, {
            note: 'Same-plane unlimited-range telepathy with owner; two-day cooldown.',
          }),
          figurine('silver-raven', 'creature:raven', 12, {
            note: 'Animal messenger may be cast on it at will; two-day cooldown.',
          }),
        ],
        note: 'Each physical figurine is the durable identity; live creature state is an owned persistent actor, never item state.',
      },
      hooks: CONTROLLED_HOOKS,
    },
  ],
  [
    'Horn of Valhalla',
    {
      sourcePhrases: [
        'They use the statistics of a berserker',
        'return to Valhalla after 1 hour or when they drop to 0 hit points',
        'summoned berserkers attack you',
      ],
      entityGrant: {
        runtimeOwner: 'encounter-combatant',
        grants: [
          creature('valhalla-berserkers', 'creature:berserker', {
            tableRefs: ['table:horn-of-valhalla'],
            control:
              'friendly and commanded if requirement is met; otherwise hostile to the user',
            duration: { amount: 1, unit: 'hour' },
            revertOn: ['one-hour-ended', 'reduced-to-0-hit-points'],
            cooldownEconomy: 'cooldown',
            exclusiveInstance: { scope: 'item', recast: 'blocked' },
            note: 'Horn-type table supplies 2d4+2, 3d4+3, 4d4+4, or 5d4+5 and its proficiency requirement.',
          }),
        ],
      },
      hooks: CONTROLLED_HOOKS,
    },
  ],
  [
    'Iron Flask',
    {
      sourcePhrases: [
        'friendly to you and your companions for 1 hour',
        'obeys your commands for that duration',
        'acts in accordance with its normal disposition and alignment',
      ],
      entityGrant: {
        runtimeOwner: 'persistent-actor',
        grants: [
          {
            id: 'released-flask-creature',
            kind: 'creature',
            tableRefs: ['table:iron-flask'],
            count: 1,
            control:
              'friendly and obedient for one hour; refuses likely-suicidal commands and otherwise only defends itself',
            duration: { amount: 1, unit: 'hour' },
            revertOn: ['one-hour-control-ended'],
            exclusiveInstance: { scope: 'item', recast: 'blocked' },
            note: 'The released creature remains the same persistent actor; after control ends it resumes its normal disposition and alignment.',
          },
        ],
      },
      hooks: CONTROLLED_HOOKS,
    },
  ],
  [
    'Manual of Golems',
    {
      sourcePhrases: [
        'To create a golem',
        'The golem becomes animate when the ashes of the manual are sprinkled on it',
        'under your control, and it understands and obeys your spoken commands',
      ],
      entityGrant: {
        runtimeOwner: 'persistent-actor',
        grants: [
          {
            id: 'created-golem',
            kind: 'creature',
            creatureRefs: [
              'creature:clay-golem',
              'creature:flesh-golem',
              'creature:iron-golem',
              'creature:stone-golem',
            ],
            tableRefs: ['table:manual-of-golems'],
            count: 1,
            control:
              'permanent owner control; understands and obeys spoken commands',
            cooldownEconomy: 'use',
            exclusiveInstance: { scope: 'item', recast: 'blocked' },
            note: 'Table selection also supplies uninterrupted creation time and supply cost; completion consumes the book.',
          },
        ],
      },
      hooks: CONTROLLED_HOOKS,
    },
  ],
  [
    'Orb of Dragonkind',
    {
      sourcePhrases: [
        'telepathic call that extends in all directions for 40 miles',
        'Evil dragons in range feel compelled to come to the orb',
        'might be hostile toward you for compelling them against their will',
      ],
      entityGrant: {
        runtimeOwner: 'persistent-actor',
        grants: [
          {
            id: 'called-evil-dragons',
            kind: 'creature',
            control:
              'not controlled; in-range evil dragons are compelled to approach by the most direct route and may be hostile on arrival',
            revertOn: ['compelled-dragon-reaches-orb'],
            exclusiveInstance: { scope: 'item', recast: 'blocked' },
            note: 'Conditional open-world selection: every evil dragon within 40 miles except dragon deities. The call has a one-hour item cooldown; existing persistent dragon actors are linked, never copied into item state.',
          },
        ],
      },
      hooks: LIFECYCLE_HOOKS,
    },
  ],
  [
    'Pipes of the Sewers',
    {
      sourcePhrases: [
        'one swarm of rats with each expended charge',
        'aren’t under your control otherwise',
        'becomes friendly to you and your companions for as long as you continue to play the pipes each round as an action',
      ],
      entityGrant: {
        runtimeOwner: 'encounter-combatant',
        grants: [
          creature('called-rat-swarms', 'creature:swarm-of-rats', {
            control:
              'initially uncontrolled; each eligible swarm is controlled only after owner wins Charisma-vs-Wisdom contest and while it hears pipes played each round',
            cooldownEconomy: 'charges',
            note: 'Actual count equals charges spent (1 to 3), subject to enough rats within half a mile. Multiple swarms may coexist. A failed sway or ended control locks that swarm out for 24 hours.',
          }),
        ],
      },
      hooks: CONTROLLED_HOOKS,
    },
  ],
  [
    'Ring of Djinni Summoning',
    {
      sourcePhrases: [
        'summon a particular djinni',
        'remains as long as you concentrate',
        'ring becomes nonmagical if the djinni dies',
      ],
      entityGrant: {
        runtimeOwner: 'persistent-actor',
        grants: [
          creature('particular-djinni', 'creature:djinni', {
            count: 1,
            control:
              'friendly; obeys commands in any language; otherwise only defends itself',
            duration: { amount: 1, unit: 'hour' },
            revertOn: [
              'concentration-ended',
              'reduced-to-0-hit-points',
              'one-hour-ended',
            ],
            onEntityDeath: 'make the ring nonmagical',
            cooldownEconomy: 'cooldown',
            exclusiveInstance: { scope: 'item', recast: 'blocked' },
            note: 'This is the same particular djinni on every successful summon; every departure returns it to its home plane and starts the 24-hour cooldown.',
          }),
        ],
      },
      hooks: CONTROLLED_HOOKS,
    },
  ],
  [
    'Staff of the Python',
    {
      sourcePhrases: [
        'becomes a giant constrictor snake under your control',
        'snake is reduced to 0 hit points, it dies and reverts to its staff form',
        'staff then shatters and is destroyed',
      ],
      entityGrant: {
        runtimeOwner: 'persistent-actor',
        grants: [
          creature('python-form', 'creature:giant-constrictor-snake', {
            count: 1,
            control:
              'owner mentally commands within 60 feet while not incapacitated; otherwise follows its last general command',
            revertOn: ['owner-bonus-action-command', 'reduced-to-0-hit-points'],
            onEntityDeath:
              'on 0 hit points the snake dies, reverts, and the staff shatters and is destroyed',
            exclusiveInstance: { scope: 'item', recast: 'dismiss-existing' },
            note: 'Early reversion restores all hit points; live snake HP belongs to the persistent actor, not item state.',
          }),
        ],
      },
      hooks: CONTROLLED_HOOKS,
    },
  ],
  [
    'Deck of Illusions',
    {
      sourcePhrases: [
        'An illusion of one or more creatures forms over the thrown card',
        'can do no harm',
        'illusion lasts until its card is moved or the illusion is dispelled',
      ],
      entityGrant: {
        runtimeOwner: 'illusory-entity',
        grants: [
          {
            id: 'card-illusion',
            kind: 'illusion',
            tableRefs: ['table:deck-of-illusions'],
            count: 1,
            control:
              'owner may spend an action within 120 feet while seeing it to move it within 30 feet of its card',
            revertOn: ['card-moved', 'dispelled'],
            cooldownEconomy: 'cards',
            note: 'Each drawn card creates its own illusion, so multiple illusions may coexist. A result may depict one or more creatures but never creates a creature combatant; physical interaction reveals it and DC 15 Intelligence (Investigation) inspection makes it translucent.',
          },
        ],
      },
      hooks: LIFECYCLE_HOOKS,
    },
  ],
]);

export const MAGIC_ITEM_ENTITY_GRANT_NAMES = Object.freeze([...SPECS.keys()]);

export const MAGIC_ITEM_ENTITY_GRANT_REFERENCES = Object.freeze(
  [...SPECS.values()].flatMap(({ entityGrant }) =>
    entityGrant.grants.flatMap((grant) => [
      ...(grant.statBlockRef === undefined ? [] : [grant.statBlockRef]),
      ...(grant.creatureRefs ?? []),
      ...(grant.tableRefs ?? []),
    ]),
  ),
);

/** Project exactly the reviewed M4 census; unrelated items fail closed. */
export function projectMagicItemEntityGrants(
  item: MagicItemExtraction,
): MagicItemFamilyProjection | undefined {
  const spec = SPECS.get(item.name);
  if (spec === undefined) return undefined;
  for (const phrase of spec.sourcePhrases) {
    if (!item.description.includes(phrase)) {
      throw new Error(
        `magic-item M4 entity projection: expected source phrase ${JSON.stringify(phrase)} not found in ${JSON.stringify(item.name)}`,
      );
    }
  }
  return {
    family: 'm4-entity-lifecycles',
    mechanics: {
      entityGrant: spec.entityGrant,
    } satisfies Readonly<Partial<MagicItemMechanics>>,
    clauses: [
      {
        id: `m4-${item.name
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, '-')
          .replace(/^-|-$/g, '')}`,
        tag: 'M4',
        representation: { block: 'entityGrant' },
        engineHooks: spec.hooks ?? LIFECYCLE_HOOKS,
      },
    ],
  };
}
