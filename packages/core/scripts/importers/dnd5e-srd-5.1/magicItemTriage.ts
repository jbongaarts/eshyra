/**
 * Magic-item non-effect triage (eshyra-o9bd.19.4.6.6; bd memory
 * magic-item-faithful-or-absent, refined 2026-10-12).
 *
 * Rule: a non-effect magic-item structure stays TYPED only where a positive
 * engine capability is more likely than not to be wanted soon (so the pack
 * need not change when it arrives); every other structure is DM-ADJUDICATED:
 * the typed field is absent and an `adjudicated-by-design` clause carries a
 * VERBATIM span of the printed description for the DM model to interpret.
 *
 * This layer is applied last (after the reviewed operations and lifecycle
 * tables) to every item and variant scope, so the rule holds over the whole
 * corpus by construction rather than per reviewed example:
 *
 *  KEPT, typed and exact
 *   - operation ids, economy cost bindings, effect references, economies
 *     (charges/uses/per-day/cooldowns/resets), including event-anchored
 *     cooldowns (`cooldown.startsOn`; consumer eshyra-olc5.8);
 *   - the activation action type (`cost`) and `commandWord` where printed
 *     (consumer eshyra-olc5.9), and the structured `equipment` prerequisite
 *     (`worn`/`held`/`attuned`/`on-person`) derived from the printed text
 *     (consumer eshyra-olc5.10);
 *   - state machines the item owns as exactly ONE lifetime at a time (a simple
 *     active/inactive toggle with a printed duration or termination), plus the
 *     machines the executable (green) operations or an existing runtime
 *     consumer bind to (consumer eshyra-olc5.11). An item whose activation
 *     creates repeatable or independently-timed instances (a cloud, set of
 *     spheres or ignited weapon per use) is DM-adjudicated instead, and the
 *     printed duration of such an item power is typed on its effect (consumer
 *     eshyra-olc5.11, start_effect binding), never on a machine;
 *   - the economies' soft-limit safe-use cost marker (`cost[].onExhausted`,
 *     consumer eshyra-olc5.8) for a printed count of risk-free uses;
 *   - entity-grant creature references, count, duration, reversion events and
 *     cooldown-economy binding (consumer eshyra-olc5.12), and the
 *     `as spell:conjure-elemental` pointer that carries the concentration
 *     exception.
 *  DM-ADJUDICATED, typed field removed, verbatim clause added
 *   - free-text activation requirement / trigger / target / note (sight,
 *     range, size, contest, aboard, remover designation, movement caps, ...);
 *   - complex state topology (levers, clouds, flying sword, broom, ...);
 *   - grant control / obedience / exclusivity / death-consequence text;
 *   - containment, spellStore and rollManipulation blocks.
 *
 * Runtime safety: the readiness preflight and `use_item` read operation ids,
 * costs, effect/economy ownership and the clause block representations; this
 * layer never removes an operation, a cost, an economy or an effect, and it
 * only converts a block's readiness clause to adjudicated-by-design (which is
 * never a blocker) for blocks that no green operation reads. The screens in
 * `magicItemOperationSourceAgreement.test.ts` pin the unchanged green set.
 */
import type {
  MagicItemActivationSpec,
  MagicItemEconomy,
  MagicItemEntityGrant,
  MagicItemEquipmentRequirement,
  MagicItemMechanics,
  MagicItemOperation,
} from '../../../src/rules/magicItemMechanics.js';
import type {
  ItemClauseExpectation,
  MagicItemFamilyProjection,
} from './magicItemCompiler.js';
import {
  type AdjudicatedOwner,
  ownerIndex,
  ownerTag,
} from './magicItemFaithfulOperations.js';
import type { PrintedProse } from './magicItemFamilyRegistry.js';
import {
  governingSpans,
  type SpanAnchor,
  sentenceRanges,
} from './magicItemTriageSpans.js';
import type { MagicItemExtraction } from './types.js';

type Projections = readonly MagicItemFamilyProjection[];

export type TriageBlock =
  | 'stateMachine'
  | 'containment'
  | 'spellStore'
  | 'rollManipulation'
  | 'entityGrant';

const ACTIVATION_NOTE =
  'The typed activation states only the printed action cost, command word and worn/held/attuned/on-person equipment; every other printed condition, trigger, target, range and limit of this activation is in this printed sentence, which the DM model interprets from the printed text.';
const BLOCK_NOTE =
  'This printed ability stays DM-adjudicated: no typed structure is kept for it, and the DM model interprets the printed text.';
const GRANT_NOTE =
  'The typed grant states only the creature reference, count, duration, reversion events and cooldown binding; the printed control, obedience and exclusivity rules are in this sentence, which the DM model interprets.';

// ---------------------------------------------------------------------------
// Tables (all anchors are verbatim quotations of the printed description)
// ---------------------------------------------------------------------------

/**
 * Machines kept typed: single-lifetime active/inactive toggles whose duration
 * or termination the text prints, plus the machines an existing consumer binds
 * to -- the executable (green) operations (Ioun Stone, Rope of Entanglement)
 * and the Cube of Force (timer executor and campaign-rule ambiguity). Every
 * other machine is withheld below, including (review 19.4.6.7 S2) the Staff of
 * Swarming Insects, Helm of Brilliance and Ring of Shooting Stars, whose
 * activations create repeatable or independently-timed instances.
 */
export const KEPT_STATE_MACHINES: ReadonlySet<string> = new Set([
  'Animated Shield',
  'Boots of Speed',
  'Cloak of the Bat',
  // Consumer-bound: the barrier's printed one-minute duration is executed by
  // itemResetExecutor, and its same-face duration ambiguity is the source
  // ambiguity the campaign-rule runtime resolves (eshyra-jhpt rulings).
  'Cube of Force',
  'Dagger of Venom',
  'Flame Tongue',
  'Gem of Brightness',
  'Glamoured Studded Leather',
  'Immovable Rod',
  'Ioun Stone',
  'Potion of Diminution',
  'Potion of Gaseous Form',
  'Potion of Growth',
  'Ring of Invisibility',
  'Ring of Mind Shielding',
  'Rod of Alertness',
  'Rope of Entanglement',
  'Staff of the Woodlands',
  'Sun Blade',
  'Sword of Sharpness',
  'Wings of Flying',
]);

/**
 * Machines kept typed that are NOT activation-entered lifetimes: a printed
 * external event with a durable item consequence, applied by item_state_event
 * (eshyra-olc5.15). The Ring of Djinni Summoning's `the djinni dies` makes the
 * ring nonmagical (`becomes: 'nonmagical'`). They own no lifetime, so they sit
 * outside the single-lifetime review of {@link KEPT_STATE_MACHINES}.
 */
export const KEPT_EXTERNAL_EVENT_MACHINES: ReadonlySet<string> = new Set([
  'Ring of Djinni Summoning',
]);

/**
 * spellStore stays typed ONLY as the numeric stored-level core that item
 * initialization binds (the printed "when found, it contains 1d6 - 1 levels"
 * randomProcedure resolves against it): capacity, initial levels and the bound
 * operation ids. Casting, caster-of-record and cancellation rules are
 * adjudicated. Value: the printed spans carried for the removed text.
 */
export const KEPT_SPELL_STORE_CORE: ReadonlyMap<string, readonly SpanAnchor[]> =
  new Map<string, readonly SpanAnchor[]>([
    [
      'Ring of Spell Storing',
      [
        [
          'This ring stores spells cast into it',
          'The spell cast from the ring is no longer stored in it, freeing up space',
        ],
      ],
    ],
    [
      'Ioun Stone::Reserve',
      [
        [
          'This vibrant purple prism stores spells cast into it',
          'The spell cast from the stone is no longer stored in it, freeing up space',
        ],
      ],
    ],
    [
      'Rod of Absorption',
      [
        [
          'While holding this rod, you can use your reaction to absorb a spell',
          'becomes nonmagical',
        ],
      ],
    ],
  ]);

export type BlockSpans = Partial<Record<TriageBlock, readonly SpanAnchor[]>>;

export const WITHHELD: ReadonlyMap<string, BlockSpans> = new Map([
  [
    'Apparatus of the Crab',
    {
      stateMachine: [
        [
          'Ten levers are set in a row at the far end',
          'When certain levers are used, the apparatus transforms to resemble a giant lobster',
        ],
        [
          'A creature in the compartment can use an action to move as many as two',
          'functions as shown in the Apparatus of the Crab Levers table',
        ],
      ],
    },
  ],
  [
    'Bead of Force',
    {
      stateMachine: [
        [
          'You can use an action to throw the bead up to 60 feet',
          'then encloses the area for 1 minute',
        ],
        'An enclosed creature can use its action to push against the sphere’s wall',
      ],
    },
  ],
  [
    'Broom of Flying',
    {
      stateMachine: [
        [
          'functions like a mundane broom until you stand astride it',
          'provided that the broom is still within 1 mile of you',
        ],
      ],
    },
  ],
  [
    'Carpet of Flying',
    {
      stateMachine: [
        [
          'You can speak the carpet’s command word as an action',
          'provided that you are within 30 feet of it',
        ],
      ],
    },
  ],
  [
    'Chime of Opening',
    {
      stateMachine: [
        [
          'You can strike it as an action',
          'If no locks or latches remain, the object itself opens',
        ],
      ],
    },
  ],
  [
    'Cloak of Elvenkind',
    { stateMachine: ['Pulling the hood up or down requires an action'] },
  ],
  [
    'Dancing Sword',
    {
      stateMachine: [
        [
          'You can use a bonus action to toss this magic sword',
          'It also ceases to hover if you grasp it',
        ],
      ],
    },
  ],
  [
    'Decanter of Endless Water',
    {
      stateMachine: [
        [
          'You can use an action to remove the stopper and speak one of three command words',
          '“Geyser” produces 30 gallons of water',
        ],
      ],
    },
  ],
  [
    'Dimensional Shackles',
    {
      stateMachine: [
        [
          'You can use an action to place these shackles on an incapacitated creature',
          'The shackles adjust to fit a creature of Small to Large size',
        ],
        [
          'You and any creature you designate when you use the shackles',
          'the creature breaks free and destroys the shackles',
        ],
      ],
    },
  ],
  [
    'Dust of Dryness',
    {
      stateMachine: [
        [
          'You can use an action to sprinkle a pinch of it over water',
          'Doing so ends that pellet’s magic',
        ],
      ],
    },
  ],
  [
    'Dwarven Thrower',
    {
      stateMachine: [
        'Immediately after the attack, the weapon flies back to your hand',
      ],
    },
  ],
  [
    'Eversmoking Bottle',
    {
      stateMachine: [
        [
          'When you use an action to remove the stopper',
          'can do so after 1 round',
        ],
      ],
    },
  ],
  [
    'Feather Token',
    {
      stateMachine: [
        [
          'Different types of feather tokens exist',
          'or when you are incapacitated or die',
        ],
      ],
    },
  ],
  [
    'Folding Boat',
    {
      stateMachine: [
        [
          'This item also has three command words',
          'Any objects in the vessel that can fit inside the box do so',
        ],
      ],
    },
  ],
  [
    'Holy Avenger',
    {
      stateMachine: [
        'While you hold the drawn sword, it creates an aura in a 10-foot radius around you',
      ],
    },
  ],
  [
    'Instant Fortress',
    {
      stateMachine: [
        [
          'You can use an action to place this 1-inch metal cube on the ground',
          'which works only if the fortress is empty',
        ],
      ],
    },
  ],
  [
    'Iron Bands of Binding',
    {
      stateMachine: [
        [
          'You can use an action to speak the command word and throw the sphere',
          'they can’t be used again until the next dawn',
        ],
      ],
    },
  ],
  [
    'Marvelous Pigments',
    {
      stateMachine: [
        [
          'It takes 10 minutes to cover 100 square feet',
          'doing no harm to anything',
        ],
      ],
    },
  ],
  [
    'Ring of Elemental Command',
    {
      stateMachine: [
        [
          'This ring is linked to one of the four Elemental Planes',
          'The GM chooses or randomly determines the linked plane',
        ],
        'If you help slay an air elemental while attuned to the ring',
        'If you help slay an earth elemental while attuned to the ring',
        'If you help slay a fire elemental while attuned to the ring',
        'If you help slay a water elemental while attuned to the ring',
      ],
    },
  ],
  [
    'Robe of Useful Items',
    {
      stateMachine: [
        [
          'While wearing the robe, you can use an action to detach one of the patches',
          'the robe becomes an ordinary garment',
        ],
      ],
    },
  ],
  [
    'Rod of Lordly Might',
    {
      stateMachine: [
        [
          'You can press one of the rod’s six buttons as a bonus action',
          'indicates magnetic north',
        ],
      ],
    },
  ],
  [
    'Rope of Climbing',
    {
      stateMachine: [
        [
          'If you hold one end of the rope and use an action to speak the command word',
          'If the rope drops to 0 hit points, it is destroyed',
        ],
      ],
    },
  ],
  [
    'Helm of Brilliance',
    {
      stateMachine: [
        [
          'As long as the helm has at least one fire opal',
          'or until you drop or stow the weapon',
        ],
      ],
    },
  ],
  [
    'Ring of Shooting Stars',
    {
      stateMachine: [
        [
          'You can expend 2 charges as an action to create one to four 3-foot-diameter spheres',
          'the creature takes lightning damage based on the number of spheres you created',
        ],
      ],
    },
  ],
  [
    'Staff of Swarming Insects',
    {
      stateMachine: [
        [
          'While holding the staff, you can use an action and expend 1 charge to cause a swarm',
          'disperses the swarm and ends the effect',
        ],
      ],
    },
  ],
  [
    'Sovereign Glue',
    {
      stateMachine: [
        ['The glue takes 1 minute to set', 'or with a wish spell'],
      ],
    },
  ],
  [
    'Sphere of Annihilation',
    {
      stateMachine: [
        [
          'The sphere is stationary until someone controls it',
          'The winner of the contest gains control of the sphere and can levitate it as normal',
        ],
      ],
    },
  ],
  [
    'Staff of the Python',
    {
      stateMachine: [
        [
          'You can use an action to speak this staff’s command word and throw the staff',
          'it regains all of them',
        ],
      ],
    },
  ],
  // --- containment ----------------------------------------------------------
  [
    'Bag of Devouring',
    {
      containment: [
        [
          'Turning the bag inside out closes the orifice',
          'transported to a random location on the Astral Plane',
        ],
      ],
    },
  ],
  [
    'Bag of Holding',
    {
      containment: [
        [
          'The bag can hold up to 500 pounds',
          'The gate is one-way only and can’t be reopened',
        ],
      ],
    },
  ],
  [
    'Efficient Quiver',
    {
      containment: [
        [
          'Each of the quiver’s three compartments',
          'as if doing so from a regular quiver or scabbard',
        ],
      ],
    },
  ],
  [
    'Handy Haversack',
    {
      containment: [
        [
          'This backpack has a central pouch and two side pouches',
          'The gate is one-way only and can’t be reopened',
        ],
      ],
    },
  ],
  [
    'Mirror of Life Trapping',
    {
      containment: [
        [
          'If the mirror is hanging on a vertical surface and you are within 5 feet of it',
          'facing away from it',
        ],
      ],
    },
  ],
  [
    'Portable Hole',
    {
      containment: [
        [
          'You can use an action to unfold a portable hole and place it',
          'The gate is one-way only and can’t be reopened',
        ],
      ],
    },
  ],
  [
    'Robe of Stars',
    {
      containment: [
        [
          'While you wear the robe, you can use an action to enter the Astral Plane',
          'the nearest unoccupied space',
        ],
      ],
    },
  ],
  [
    'Rod of Security',
    {
      containment: [
        [
          'While holding this rod, you can use an action to activate it',
          'The rod can’t be used again until ten days have passed',
        ],
      ],
    },
  ],
  [
    'Well of Many Worlds',
    {
      containment: [
        [
          'You can use an action to unfold and place the well of many worlds',
          'it can’t do so again for 1d8 hours',
        ],
      ],
    },
  ],
  // --- spellStore / rollManipulation (with parent-scope blocks) ------------
  [
    'Candle of Invocation',
    {
      spellStore: [
        'a cleric or druid in the light whose alignment matches the candle’s',
      ],
    },
  ],
  [
    'Ioun Stone::Absorption',
    {
      spellStore: [
        [
          'While this pale lavender ellipsoid orbits your head',
          'the stone can’t cancel it',
        ],
      ],
    },
  ],
  [
    'Ioun Stone::Greater Absorption',
    {
      spellStore: [
        [
          'While this marbled lavender and green ellipsoid orbits your head',
          'the stone can’t cancel it',
        ],
      ],
    },
  ],
  [
    'Pearl of Power',
    {
      spellStore: [
        ['While this pearl is on your person', 'the new slot is 3rd level'],
      ],
    },
  ],
  [
    'Rod of Absorption',
    {
      rollManipulation: [
        [
          'While holding this rod, you can use your reaction to absorb a spell',
          'The energy has the same level as the spell when it was cast',
        ],
      ],
    },
  ],
  [
    'Spell Scroll',
    {
      spellStore: [
        [
          'If the spell is on your class’s spell list, you can read the scroll',
          'the spell scroll is destroyed',
        ],
      ],
    },
  ],
  [
    'Staff of the Magi',
    {
      spellStore: [
        [
          'In addition, you can use your reaction when another creature casts a spell that targets only you',
          'as if you activated its retributive strike (see below)',
        ],
      ],
    },
  ],
  [
    'Luck Blade',
    {
      rollManipulation: [
        [
          'If the sword is on your person, you can call on its luck',
          'This property can’t be used again until the next dawn',
        ],
      ],
    },
  ],
  [
    'Ring of Evasion',
    {
      rollManipulation: [
        'When you fail a Dexterity saving throw while wearing it',
      ],
    },
  ],
  [
    'Ring of Spell Turning',
    {
      rollManipulation: [
        'if you roll a 20 for the save and the spell is 7th level or lower',
      ],
    },
  ],
  [
    'Scarab of Protection',
    {
      rollManipulation: [
        'If you fail a saving throw against a necromancy spell or a harmful effect originating from an undead creature',
      ],
    },
  ],
  [
    'Staff of Charming',
    {
      rollManipulation: [
        [
          'If you are holding the staff and fail a saving throw against an enchantment spell',
          'as if you had cast the spell',
        ],
      ],
    },
  ],
  [
    'Talisman of the Sphere',
    {
      rollManipulation: [
        'When you make an Intelligence (Arcana) check to control a sphere of annihilation',
      ],
    },
  ],
  // --- entity grant that creates no entity reference ------------------------
  [
    'Orb of Dragonkind',
    {
      entityGrant: [
        [
          'While you control the orb, you can use an action to cause the artifact to issue a telepathic call',
          'Once you have used this property, it can’t be used again for 1 hour',
        ],
      ],
    },
  ],
]);

/**
 * Printed governing sentences for stripped grant control / exclusivity /
 * death-consequence text, per item. Required for every item with a grant whose
 * free text is removed.
 */
export const GRANT_SPANS: ReadonlyMap<string, readonly SpanAnchor[]> = new Map([
  [
    'Bag of Tricks',
    [
      [
        'The creature is friendly to you and your companions',
        'the creature acts in a fashion appropriate to its nature',
      ],
    ],
  ],
  [
    'Bowl of Commanding Water Elementals',
    [
      'summon a water elemental, as if you had cast the conjure elemental spell',
    ],
  ],
  [
    'Brazier of Commanding Fire Elementals',
    ['as if you had cast the conjure elemental spell'],
  ],
  [
    'Censer of Controlling Air Elementals',
    ['as if you had cast the conjure elemental spell'],
  ],
  [
    'Stone of Controlling Earth Elementals',
    ['as if you had cast the conjure elemental spell'],
  ],
  [
    'Elemental Gem',
    ['an elemental is summoned as if you had cast the conjure elemental spell'],
  ],
  [
    'Deck of Illusions',
    [
      [
        'While you are within 120 feet of the illusory creature and can see it',
        'The creature then appears translucent',
      ],
    ],
  ],
  [
    'Efreeti Bottle',
    [
      'The first time the bottle is opened, the GM rolls to determine what happens',
    ],
  ],
  [
    'Feather Token',
    [
      [
        'The bird has the statistics of a roc',
        'You can dismiss the bird as an action',
      ],
      [
        'As a bonus action on your turn, you can direct the whip',
        'or when you are incapacitated or die',
      ],
    ],
  ],
  [
    'Figurine of Wondrous Power',
    [
      [
        'The creature is friendly to you and your companions',
        'defends itself but takes no other actions',
      ],
      [
        'When the creature becomes a figurine again, its property can’t be used again',
        'as specified in the figurine’s description',
      ],
      ['It can become a griffon for up to 6 hours', 'until 5 days have passed'],
      [
        'It can become a giant fly for up to 12 hours',
        'until 2 days have passed',
      ],
      [
        'These gold statuettes of lions are always created in pairs',
        'until 7 days have passed',
      ],
      [
        'The goat of traveling can become a Large goat',
        'until 15 days have passed',
      ],
      [
        'It can become an elephant for up to 24 hours',
        'until 7 days have passed',
      ],
      [
        'This polished obsidian horse can become a nightmare for up to 24 hours',
        'including a command to revert to figurine form',
      ],
      [
        'This onyx statuette of a dog can become a mastiff for up to 6 hours',
        'until 7 days have passed',
      ],
      [
        'This serpentine statuette of an owl can become a giant owl for up to 8 hours',
        'on the same plane of existence',
      ],
      [
        'This silver statuette of a raven can become a raven for up to 12 hours',
        'animal messenger spell on it at will',
      ],
    ],
  ],
  [
    'Horn of Valhalla',
    [
      [
        'The horn’s type determines how many berserkers answer its summons',
        'they are friendly to you and your companions and follow your commands',
      ],
    ],
  ],
  [
    'Iron Flask',
    [
      [
        'You can use an action to remove the flask’s stopper and release the creature',
        'acts in accordance with its normal disposition and alignment',
      ],
    ],
  ],
  [
    'Manual of Golems',
    [
      [
        'The golem becomes animate when the ashes of the manual are sprinkled on it',
        'it understands and obeys your spoken commands',
      ],
    ],
  ],
  [
    'Pipes of the Sewers',
    [
      'Called swarms move toward the music by the shortest available route but aren’t under your control otherwise',
      [
        'Whenever a swarm of rats that isn’t under another creature’s control comes within 30 feet of you',
        'your control over that swarm ends, and the swarm behaves as it normally would and can’t be swayed by the pipes’ music for the next 24 hours',
      ],
    ],
  ],
  [
    'Ring of Djinni Summoning',
    [
      [
        'While summoned, the djinni is friendly to you and your companions',
        'the djinni defends itself against attackers but takes no other actions',
      ],
      'After the djinni departs, it can’t be summoned again for 24 hours',
    ],
  ],
  [
    'Staff of the Python',
    [
      [
        'On your turn, you can mentally command the snake if it is within 60 feet of you',
        'such as to attack your enemies or guard a location',
      ],
      [
        'If the snake is reduced to 0 hit points, it dies and reverts to its staff form',
        'it regains all of them',
      ],
    ],
  ],
]);

/**
 * Printed sentences that govern an operation beyond its removed activation
 * text (a stripped note, or an equipment gate stated by a section header).
 */
export const OPERATION_SPANS: ReadonlyMap<string, readonly SpanAnchor[]> =
  new Map([
    [
      'Dust of Dryness::sprinkle-dust',
      ['You can use an action to sprinkle a pinch of it over water'],
    ],
    ['Oil of Etherealness::apply-oil', ['Applying the oil takes 10 minutes']],
    ['Oil of Sharpness::apply-oil', ['Applying the oil takes 1 minute']],
    [
      'Oil of Slipperiness::apply-oil',
      [
        'Applying the oil takes 10 minutes',
        'one additional vial is required for each size category above Medium',
      ],
    ],
    [
      'Spell Scroll::cast-spell',
      [
        'Casting the spell by reading the scroll requires the spell’s normal casting time',
      ],
    ],
    [
      'Helm of Brilliance::ignite-weapon',
      [
        'You gain the following benefits while wearing it',
        [
          'As long as the helm has at least one fire opal',
          'or until you drop or stow the weapon',
        ],
      ],
    ],
    [
      'Hammer of Thunderbolts::giant-slaying-critical',
      [
        [
          'Giant’s Bane (Requires Attunement)',
          'the giant must succeed on a DC 17 Constitution saving throw or die',
        ],
      ],
    ],
    [
      'Winged Boots::fly',
      [
        'While you wear these boots, you have a flying speed equal to your walking speed',
      ],
    ],
  ]);

/** Equipment the printed text states for an operation but no activation
 * field carried (a section header gates the whole property). */
export const EQUIPMENT_EXTRA: ReadonlyMap<
  string,
  readonly MagicItemEquipmentRequirement[]
> = new Map([
  ['Helm of Brilliance::ignite-weapon', ['worn']],
  ['Hammer of Thunderbolts::giant-slaying-critical', ['attuned']],
  ['Winged Boots::fly', ['worn']],
]);

/** Event-anchored cooldown waits: the printed wait starts at the termination
 * event, not at the activation that spends the pool. */
export const COOLDOWN_ANCHORS: ReadonlyMap<
  string,
  Readonly<{
    economy: string;
    startsOn: NonNullable<MagicItemEconomy['cooldown']>['startsOn'];
  }>
> = new Map([
  [
    'Ring of Djinni Summoning',
    {
      economy: 'cooldown',
      startsOn: { event: 'grant-ended', grantId: 'particular-djinni' },
    },
  ],
  [
    'Wings of Flying',
    {
      economy: 'cooldown',
      startsOn: { event: 'state-entered', stateId: 'inactive' },
    },
  ],
]);

// ---------------------------------------------------------------------------
// Mechanics
// ---------------------------------------------------------------------------

/**
 * The printed text an anchor is resolved in: the variant's own paragraph when
 * the scope is a variant (a substring of the item description, and the only
 * place a repeated variant phrase is unambiguous), else the whole description.
 */
interface PrintedSource {
  readonly description: string;
  readonly variantText: string | undefined;
}

function spansOf(
  source: PrintedSource,
  anchors: readonly SpanAnchor[],
  where: string,
): readonly string[] {
  if (source.variantText !== undefined) {
    try {
      return governingSpans(source.variantText, anchors, where);
    } catch {
      // fall through to the whole description
    }
  }
  return governingSpans(source.description, anchors, where);
}

const OP_STOP_WORDS = new Set(['cast', 'use', 'the', 'of', 'and']);

/**
 * A repeated activation fragment resolved to the occurrence that belongs to
 * the operation: the one whose sentence (or the heading sentence just before
 * it) shares the most words with the operation id, ties and zero scores
 * unresolved. Returned as a range anchor wide enough to select that
 * occurrence only.
 */
function resolveRepeated(
  text: string,
  fragment: string,
  operationId: string,
): SpanAnchor | undefined {
  const words = operationId
    .split('-')
    .filter((word) => word.length > 1 && !OP_STOP_WORDS.has(word));
  const ranges = sentenceRanges(text);
  const positions: number[] = [];
  for (
    let at = text.indexOf(fragment);
    at >= 0;
    at = text.indexOf(fragment, at + 1)
  )
    positions.push(at);
  const scored = positions.map((at) => {
    const index = ranges.findIndex(([from, to]) => at >= from && at < to);
    const near = [ranges[index - 1], ranges[index]]
      .filter((range): range is [number, number] => range !== undefined)
      .map(([from, to]) => text.slice(from, to).toLowerCase())
      .join(' ');
    const score =
      words.filter((word) => near.includes(word.slice(0, 5))).length +
      (operationId.startsWith('cast-') && /\bcast\b/.test(near) ? 1 : 0);
    return { at, score };
  });
  const best = Math.max(...scored.map(({ score }) => score));
  const winners = scored.filter(({ score }) => score === best);
  if (best === 0 || winners.length !== 1) return undefined;
  const at = winners[0]?.at ?? 0;
  // Make the anchor unique by widening it backwards over the preceding text.
  let start = at;
  const end = at + fragment.length;
  while (
    start > 0 &&
    text.indexOf(text.slice(start, end)) !==
      text.lastIndexOf(text.slice(start, end))
  )
    start -= 1;
  const anchor = text.slice(start, end);
  return text.indexOf(anchor) === text.lastIndexOf(anchor) ? anchor : undefined;
}

function fail(scope: string, message: string): never {
  throw new Error(`magic-item triage: ${scope} ${message}`);
}

/** Authoring aid: `ESHYRA_TRIAGE_REPORT=1` lists every unresolved disposition
 * instead of stopping at the first. */
const REPORT = process.env.ESHYRA_TRIAGE_REPORT === '1';
function failOrReport(scope: string, message: string): void {
  if (REPORT) console.error(`TRIAGE ${scope} ${message}`);
  else fail(scope, message);
}

/**
 * Equipment named by a printed requirement (and, for `worn`, trigger) clause,
 * as alternatives in disjunctive normal form (see
 * `MagicItemActivationSpec.equipment`). A printed "wearing or holding it"
 * yields two alternatives, each also carrying any other printed conjunct.
 */
export function equipmentFromPrintedText(
  requirement: string | undefined,
  trigger: string | undefined,
): readonly (readonly MagicItemEquipmentRequirement[])[] {
  const found = new Set<MagicItemEquipmentRequirement>();
  const text = requirement ?? '';
  const alternative =
    /\b(?:wearing or holding|holding or wearing|wear or hold|hold or wear)\b/i;
  const isAlternative = alternative.test(text);
  if (!isAlternative) {
    if (/\b(?:wearing|wear|wears)\b/i.test(text)) found.add('worn');
    if (/\b(?:hold(?:ing)?|grasp(?:ing)?)\b/i.test(text)) found.add('held');
  }
  if (/\battuned to (?:it|an orb|the ring)\b/i.test(text)) found.add('attuned');
  if (/\bon your person\b/i.test(text) || /\bwhile you carry it\b/i.test(text))
    found.add('on-person');
  if (
    trigger !== undefined &&
    /\bwhile (?:you(?:’|')re |you are )?wearing (?:it|them)\b/i.test(trigger)
  )
    found.add('worn');
  const ordered = (set: ReadonlySet<MagicItemEquipmentRequirement>) =>
    (['worn', 'held', 'attuned', 'on-person'] as const).filter((value) =>
      set.has(value),
    );
  if (isAlternative)
    return (['worn', 'held'] as const).map((choice) =>
      ordered(new Set([...found, choice])),
    );
  const conjunct = ordered(found);
  return conjunct.length === 0 ? [] : [conjunct];
}

function allClauseTexts(projections: Projections): string[] {
  return projections.flatMap((projection) =>
    projection.clauses.flatMap((entry) =>
      'sourceText' in entry.representation
        ? [entry.representation.sourceText]
        : [],
    ),
  );
}

function addClauses(
  projections: Projections,
  owner: { readonly operation: string } | { readonly block: TriageBlock },
  idBase: string,
  texts: readonly string[],
  note: string,
): Projections {
  let result = projections;
  let n = 0;
  for (const text of texts) {
    if (allClauseTexts(result).some((existing) => existing.includes(text)))
      continue;
    const index = ownerIndex(result, owner as AdjudicatedOwner);
    if (index < 0) fail(idBase, 'names an owner no family projects');
    if (!result.some((projection) => projection.clauses.length > 0))
      failOrReport(idBase, 'has no existing clause to take a tag from');
    const adjudicated: ItemClauseExpectation = {
      id: texts.length === 1 ? idBase : `${idBase}-${n}`,
      tag: ownerTag(result, index),
      representation: { adjudicated: true, note, sourceText: text },
    };
    n += 1;
    result = result.map((projection, at) =>
      at === index
        ? { ...projection, clauses: [...projection.clauses, adjudicated] }
        : projection,
    );
  }
  return result;
}

/** Strip the producer-draft free text from every operation activation, derive
 * the structured equipment prerequisite, and carry the printed sentences. */
function triageActivations(
  scope: string,
  source: PrintedSource,
  projections: Projections,
): Projections {
  const description = source.description;
  const pending: {
    readonly operationId: string;
    readonly anchors: SpanAnchor[];
  }[] = [];
  let result: Projections = projections.map((projection) => {
    const operations = projection.mechanics.operations;
    if (operations === undefined) return projection;
    return {
      ...projection,
      mechanics: {
        ...projection.mechanics,
        operations: operations.map((operation): MagicItemOperation => {
          const key = `${scope}::${operation.id}`;
          const extraEquipment = EQUIPMENT_EXTRA.get(key) ?? [];
          const extraAnchors = OPERATION_SPANS.get(key) ?? [];
          const activation = operation.activation;
          if (
            activation === undefined &&
            extraAnchors.length === 0 &&
            extraEquipment.length === 0
          )
            return operation;
          const anchors: SpanAnchor[] = [...extraAnchors];
          for (const field of ['requirement', 'trigger', 'target'] as const) {
            const text = activation?.[field];
            if (text === undefined) continue;
            if (!description.includes(text))
              fail(
                key,
                `${field} ${JSON.stringify(text)} is not a verbatim span of the printed description`,
              );
            // A repeated fragment resolves in the variant's own paragraph, then
            // by the operation's own name (the occurrence in the operation's
            // sentence or under its printed heading); anything still ambiguous
            // must be named in OPERATION_SPANS.
            const unique = (haystack: string | undefined) =>
              haystack?.includes(text) === true &&
              haystack.indexOf(text) === haystack.lastIndexOf(text);
            if (unique(source.variantText) || unique(description))
              anchors.push(text);
            else {
              const resolved = resolveRepeated(
                source.variantText ?? description,
                text,
                operation.id,
              );
              if (resolved !== undefined) anchors.push(resolved);
              else if (extraAnchors.length === 0)
                failOrReport(
                  key,
                  `${field} ${JSON.stringify(text)} is ambiguous; add an OPERATION_SPANS entry`,
                );
            }
          }
          if (activation?.note !== undefined && extraAnchors.length === 0)
            failOrReport(
              key,
              `note ${JSON.stringify(activation.note)} needs an OPERATION_SPANS entry`,
            );
          if (anchors.length > 0)
            pending.push({ operationId: operation.id, anchors });
          const printed = equipmentFromPrintedText(
            activation?.requirement,
            activation?.trigger,
          );
          const order = ['worn', 'held', 'attuned', 'on-person'] as const;
          const withExtra = (alt: readonly MagicItemEquipmentRequirement[]) =>
            order.filter((v) => alt.includes(v) || extraEquipment.includes(v));
          const equipment =
            printed.length > 0
              ? printed.map(withExtra)
              : extraEquipment.length > 0
                ? [withExtra([])]
                : [];
          const next: Record<string, unknown> = {};
          if (activation?.cost !== undefined) next.cost = activation.cost;
          if (activation?.commandWord !== undefined)
            next.commandWord = activation.commandWord;
          if (equipment.length > 0) next.equipment = equipment;
          const { activation: _drop, ...rest } = operation;
          return Object.keys(next).length === 0
            ? rest
            : { ...rest, activation: next as MagicItemActivationSpec };
        }),
      },
    };
  });
  // One clause per distinct printed span per scope, owned by the first
  // operation it governs; later operations sharing the span are named in the
  // note.
  const governed = new Map<string, { owner: string; ops: string[] }>();
  for (const { operationId, anchors } of pending) {
    for (const text of spansOf(source, anchors, scope)) {
      const entry = governed.get(text);
      if (entry === undefined)
        governed.set(text, { owner: operationId, ops: [operationId] });
      else if (!entry.ops.includes(operationId)) entry.ops.push(operationId);
    }
  }
  const counters = new Map<string, number>();
  for (const [text, { owner, ops }] of governed) {
    const n = counters.get(owner) ?? 0;
    counters.set(owner, n + 1);
    result = addClauses(
      result,
      { operation: owner },
      `triage-activation-${owner}-${n}`,
      [text],
      ops.length > 1
        ? `${ACTIVATION_NOTE} Governs operations: ${ops.join(', ')}.`
        : ACTIVATION_NOTE,
    );
  }
  return result;
}

function removeBlock(
  projections: Projections,
  block: TriageBlock,
): Projections {
  return projections.map((projection) => {
    if (projection.mechanics[block] === undefined) return projection;
    const { [block]: _removed, ...mechanics } = projection.mechanics;
    return { ...projection, mechanics };
  });
}

/** Operation ids a typed block binds (the operations whose readiness the
 * block's clause blocked). */
function boundOperations(
  mechanics: Readonly<Partial<MagicItemMechanics>>,
  block: TriageBlock,
): readonly string[] {
  const ids = new Set<string>();
  if (block === 'stateMachine')
    for (const transition of mechanics.stateMachine?.transitions ?? [])
      if (transition.via !== undefined) ids.add(transition.via);
  if (block === 'spellStore')
    for (const contract of mechanics.spellStore?.contracts ?? [])
      for (const id of contract.operationIds ?? []) ids.add(id);
  if (block === 'rollManipulation')
    for (const transform of mechanics.rollManipulation?.transforms ?? [])
      if (transform.operationId !== undefined) ids.add(transform.operationId);
  const declared = new Set(
    (mechanics.operations ?? []).map((operation) => operation.id),
  );
  return [...ids].filter((id) => declared.has(id));
}

/** Convert the readiness clauses of a withheld block to adjudicated-by-design
 * clauses carrying the verbatim spans (surplus block clauses are dropped; a
 * shortfall adds new clauses to the projection that held the block). */
function withholdBlock(
  scope: string,
  source: PrintedSource,
  projections: Projections,
  block: TriageBlock,
  anchors: readonly SpanAnchor[],
  baseNote: string,
): Projections {
  // A source ambiguity whose affected mechanic is this machine has nothing
  // left to reference once it is withheld; the question stays a campaign
  // ruling for the DM through the printed span, named in the clause note.
  const ambiguities =
    block === 'stateMachine'
      ? projections.flatMap(
          (projection) => projection.mechanics.ambiguities ?? [],
        )
      : [];
  const note =
    ambiguities.length === 0
      ? baseNote
      : `${baseNote} Source ambiguity ${ambiguities.map((entry) => `${entry.id} (${entry.question})`).join('; ')} stays a campaign ruling for the DM.`;
  const spans = spansOf(source, anchors, `${scope} ${block}`);
  if (process.env.ESHYRA_TRIAGE_DEBUG === scope)
    console.error(
      'SPANS',
      JSON.stringify(spans),
      '\nDESC',
      JSON.stringify(source.description.slice(0, 700)),
    );
  const holder = projections.findIndex(
    (projection) => projection.mechanics[block] !== undefined,
  );
  if (holder < 0) fail(scope, `has no ${block} block to withhold`);
  // The block's engine-pending clause is what kept its bound operations from
  // being executable. Withholding the block must not free those operations:
  // each keeps an operation-bound engine-pending clause (same hooks), so the
  // ready set is unchanged and use_item still refuses them.
  const blockHooks = projections
    .flatMap((projection) => projection.clauses)
    .find(
      (entry) =>
        'block' in entry.representation && entry.representation.block === block,
    )?.engineHooks;
  const bound = projections.flatMap((projection) =>
    boundOperations(projection.mechanics, block).map((operationId) => ({
      operationId,
    })),
  );
  let next = 0;
  let seen = 0;
  const converted = projections.map((projection) => ({
    ...projection,
    clauses: projection.clauses.flatMap((entry) => {
      const representation = entry.representation;
      if (!('block' in representation) || representation.block !== block)
        return [entry];
      seen += 1;
      const span = spans[next];
      if (span === undefined) return [];
      next += 1;
      const { engineHooks: _hooks, ...rest } = entry;
      return [
        {
          ...rest,
          representation: {
            adjudicated: true as const,
            note,
            sourceText: span,
          },
        } satisfies ItemClauseExpectation,
      ];
    }),
  }));
  if (seen === 0) fail(scope, `has no ${block} readiness clause to withhold`);
  const withoutBlock = removeBlock(converted, block).map((projection) => {
    if (
      ambiguities.length === 0 ||
      projection.mechanics.ambiguities === undefined
    )
      return projection;
    const { ambiguities: _ambiguities, ...mechanics } = projection.mechanics;
    return { ...projection, mechanics };
  });
  const hasOperationClause = (operationId: string): boolean =>
    withoutBlock.some((projection) =>
      projection.clauses.some(
        (entry) =>
          'block' in entry.representation &&
          entry.representation.block === 'operations' &&
          'operationId' in entry.representation &&
          entry.representation.operationId === operationId,
      ),
    );
  const operationClauses: ItemClauseExpectation[] = [
    ...new Set(bound.map(({ operationId }) => operationId)),
  ]
    .filter((operationId) => !hasOperationClause(operationId))
    .map((operationId) => ({
      id: `triage-${block}-op-${operationId}`,
      tag: ownerTag(withoutBlock, holder),
      representation: { block: 'operations', operationId },
      ...(blockHooks === undefined ? {} : { engineHooks: blockHooks }),
    }));
  const known = allClauseTexts(withoutBlock);
  const extra: ItemClauseExpectation[] = spans
    .slice(next)
    .filter((text) => !known.some((existing) => existing.includes(text)))
    .map((text, n) => ({
      id: `triage-${block}-${n}`,
      tag: ownerTag(withoutBlock, holder),
      representation: { adjudicated: true, note, sourceText: text },
    }));
  return withoutBlock.map((projection, at) =>
    at === holder
      ? {
          ...projection,
          clauses: [...projection.clauses, ...extra, ...operationClauses],
        }
      : projection,
  );
}

const SPELL_POINTER = /^as spell:[a-z0-9-]+$/;
const GRANT_KEEP = [
  'id',
  'kind',
  'statBlockRef',
  'creatureRefs',
  'tableRefs',
  // The printed variant identity a grant belongs to (S1): structural, not free text.
  'variants',
  'count',
  'countRoll',
  'creatureRoll',
  'duration',
  'revertOn',
  'cooldownEconomy',
  // olc5.15: the typed, executed source-item destruction (Staff of the Python).
  'destroysItemOn',
] as const;

function triageGrants(
  scope: string,
  source: PrintedSource,
  projections: Projections,
): Projections {
  let stripped = false;
  const result = projections.map((projection) => {
    const block = projection.mechanics.entityGrant;
    if (block === undefined) return projection;
    const grants = block.grants.map((grant) => {
      const kept: Record<string, unknown> = {};
      for (const field of GRANT_KEEP)
        if (grant[field] !== undefined) kept[field] = grant[field];
      if (grant.control !== undefined && SPELL_POINTER.test(grant.control))
        kept.control = grant.control;
      if (
        (grant.control !== undefined && kept.control === undefined) ||
        grant.onEntityDeath !== undefined ||
        grant.exclusiveInstance !== undefined ||
        grant.note !== undefined
      )
        stripped = true;
      // A kept duration / reversion times the creature's EXISTENCE (physical
      // disappearance or return); a clock on how long it is controlled is the
      // adjudicated control policy and is never typed (review 19.4.6.7 S4).
      for (const event of grant.revertOn ?? [])
        if (/control/i.test(event))
          fail(
            scope,
            `grant ${grant.id} types a control clock (${event}) as a duration/reversion`,
          );
      if (
        kept.statBlockRef === undefined &&
        kept.creatureRefs === undefined &&
        kept.tableRefs === undefined
      )
        fail(
          scope,
          `grant ${grant.id} has no creature, stat-block or table reference once its free text is removed`,
        );
      return kept as unknown as MagicItemEntityGrant['grants'][number];
    });
    const { note: _note, ...rest } = block;
    if (block.note !== undefined) stripped = true;
    return {
      ...projection,
      mechanics: {
        ...projection.mechanics,
        entityGrant: { ...rest, grants },
      },
    };
  });
  if (!stripped) return result;
  const anchors = GRANT_SPANS.get(scope);
  if (anchors === undefined)
    fail(scope, 'strips grant free text but has no GRANT_SPANS entry');
  return addClauses(
    result,
    { block: 'entityGrant' },
    'triage-entityGrant',
    spansOf(source, anchors, `${scope} entityGrant`),
    GRANT_NOTE,
  );
}

function anchorCooldowns(scope: string, projections: Projections): Projections {
  const anchor = COOLDOWN_ANCHORS.get(scope);
  if (anchor === undefined) return projections;
  if (anchor.startsOn === undefined)
    fail(scope, 'has no reviewed cooldown start event');
  const startsOn = anchor.startsOn;
  let found = false;
  const result = projections.map((projection) => {
    const economy = projection.mechanics.economies?.[anchor.economy];
    if (economy?.cooldown === undefined) return projection;
    found = true;
    const hook =
      startsOn.event === 'state-entered'
        ? 'state-anchored cooldown reset'
        : 'grant-anchored cooldown reset';
    return {
      ...projection,
      mechanics: {
        ...projection.mechanics,
        economies: {
          ...projection.mechanics.economies,
          [anchor.economy]: {
            ...economy,
            cooldown: { ...economy.cooldown, startsOn },
          },
        },
      },
      clauses: projection.clauses.map((clause) => {
        const representation = clause.representation;
        return 'block' in representation &&
          representation.block === 'economies' &&
          'economyId' in representation &&
          representation.economyId === anchor.economy
          ? {
              ...clause,
              engineHooks: [{ engine: 'F5', hook }] as const,
            }
          : clause;
      }),
    };
  });
  if (!found) fail(scope, `has no ${anchor.economy} cooldown to anchor`);
  return result;
}

/** The Efreeti Bottle stopper wait is printed by the referenced table row
 * (d100 11-90): after the one-hour service the efreeti returns, a new stopper
 * contains it, and the stopper cannot be removed for 24 hours. */
function efreetiStopper(projections: Projections): Projections {
  const economy: MagicItemEconomy = {
    kind: 'cooldown',
    cooldown: {
      duration: { amount: 24, unit: 'hour' },
      startsOn: { event: 'grant-ended', grantId: 'serving-efreeti' },
    },
    reset: [{ at: 'hour', amount: 'all' }],
    note: 'table:efreeti-bottle (d100 11–90): “The stopper can’t be removed for 24 hours.”',
  };
  const index = projections.findIndex(
    (projection) => projection.mechanics.entityGrant !== undefined,
  );
  if (index < 0) fail('Efreeti Bottle', 'has no entityGrant block');
  return projections.map((projection, at) => {
    if (at !== index) return projection;
    const grants = (projection.mechanics.entityGrant as MagicItemEntityGrant)
      .grants;
    if (!grants.some((grant) => grant.id === 'serving-efreeti'))
      fail('Efreeti Bottle', 'has no serving-efreeti grant');
    return {
      ...projection,
      mechanics: {
        ...projection.mechanics,
        economies: { ...projection.mechanics.economies, stopper: economy },
        // "When you use an action to remove the stopper" is the printed
        // activation; its cost is the stopper pool, spent here and restored
        // by the grant-anchored wait above.
        operations: [
          {
            id: 'remove-stopper',
            activation: { cost: 'action' },
            cost: [{ economy: 'stopper', amount: 1 }],
          },
        ],
        entityGrant: {
          ...(projection.mechanics.entityGrant as MagicItemEntityGrant),
          grants: grants.map((grant) =>
            grant.id === 'serving-efreeti'
              ? { ...grant, cooldownEconomy: 'stopper' }
              : grant,
          ),
        },
      } as MagicItemMechanics,
      clauses: [
        ...projection.clauses,
        {
          id: 'm4-stopper',
          tag: 'M4',
          representation: { block: 'economies', economyId: 'stopper' },
          engineHooks: [
            { engine: 'F5', hook: 'grant-anchored cooldown reset' },
          ],
        } as ItemClauseExpectation,
        {
          id: 'c1-remove-stopper',
          tag: 'C1',
          representation: {
            block: 'operations',
            operationId: 'remove-stopper',
          },
          engineHooks: [
            { engine: 'F2', hook: 'olc5.11 pack-tested paid item operation' },
          ],
        } as ItemClauseExpectation,
      ],
    };
  });
}

/** Iron Flask: itemRandomInitialization binds a rolled occupant to
 * `containment.tracksOccupancy` (the printed "already contain a creature"
 * sentence), so exactly that consumer-bound structure stays typed; every
 * other printed containment rule is adjudicated. */
const IRON_FLASK_CONTAINMENT_SPANS: readonly SpanAnchor[] = [
  ['You can use an action to speak the flask’s command word', 'doesn’t age'],
  [
    'You can use an action to remove the flask’s stopper and release the creature',
    'A newly discovered bottle might already contain a creature chosen by the GM',
  ],
];

function ironFlaskContainment(
  scope: string,
  source: PrintedSource,
  projections: Projections,
): Projections {
  const reduced = projections.map((projection) =>
    projection.mechanics.containment === undefined
      ? projection
      : {
          ...projection,
          mechanics: {
            ...projection.mechanics,
            containment: {
              mode: 'creature-prison' as const,
              tracksOccupancy: true as const,
              capacity: { creatures: 1 },
            },
          },
        },
  );
  return addClauses(
    reduced,
    { block: 'containment' },
    'triage-containment',
    spansOf(source, IRON_FLASK_CONTAINMENT_SPANS, scope),
    'Only the creature-prison mode, one-creature capacity and occupancy tracking stay typed, because item initialization binds a rolled occupant to them; every other printed trapping, release and disposition rule is in this printed text, which the DM model interprets.',
  );
}

function spellStoreCore(
  scope: string,
  source: PrintedSource,
  projections: Projections,
  anchors: readonly SpanAnchor[],
): Projections {
  const reduced = projections.map((projection) => {
    const store = projection.mechanics.spellStore;
    if (store === undefined) return projection;
    return {
      ...projection,
      mechanics: {
        ...projection.mechanics,
        spellStore: {
          contracts: store.contracts.map((contract) => ({
            id: contract.id,
            kind: contract.kind,
            ...(contract.variant === undefined
              ? {}
              : { variant: contract.variant }),
            ...(contract.capacityLevels === undefined
              ? {}
              : { capacityLevels: contract.capacityLevels }),
            ...(contract.lifetimeCapacityLevels === undefined
              ? {}
              : { lifetimeCapacityLevels: contract.lifetimeCapacityLevels }),
            ...(contract.initialLevels === undefined
              ? {}
              : { initialLevels: contract.initialLevels }),
            ...(contract.operationIds === undefined
              ? {}
              : { operationIds: contract.operationIds }),
          })),
        },
      } as MagicItemMechanics,
    };
  });
  return addClauses(
    reduced,
    { block: 'spellStore' },
    'triage-spellStore',
    spansOf(source, anchors, `${scope} spellStore`),
    'Only the stored-level counters (capacity and initial levels) stay typed because item initialization binds them; the printed storing, casting, caster-of-record and cancellation rules are in this printed text, which the DM model interprets.',
  );
}

/** Apply the triage to one scope's un-namespaced family projections. */
export function applyMagicItemTriage(
  item: MagicItemExtraction,
  prose: PrintedProse | undefined,
  projections: Projections,
  variantName?: string,
): Projections {
  const scope =
    variantName === undefined ? item.name : `${item.name}::${variantName}`;
  const source: PrintedSource = {
    description: prose?.description ?? item.description,
    variantText:
      variantName === undefined
        ? undefined
        : (prose?.variants.get(variantName) ??
          item.variants?.find((variant) => variant.name === variantName)?.text),
  };
  let result = triageActivations(scope, source, projections);

  const withheld = WITHHELD.get(scope);
  for (const block of [
    'stateMachine',
    'containment',
    'spellStore',
    'rollManipulation',
    'entityGrant',
  ] as const) {
    const present = result.some(
      (projection) => projection.mechanics[block] !== undefined,
    );
    if (!present) continue;
    if (
      block === 'stateMachine' &&
      (KEPT_STATE_MACHINES.has(scope) ||
        KEPT_EXTERNAL_EVENT_MACHINES.has(scope))
    )
      continue;
    if (block === 'spellStore' && KEPT_SPELL_STORE_CORE.has(scope)) {
      result = spellStoreCore(
        scope,
        source,
        result,
        KEPT_SPELL_STORE_CORE.get(scope) ?? [],
      );
      continue;
    }
    if (scope === 'Iron Flask' && block === 'containment') {
      result = ironFlaskContainment(scope, source, result);
      continue;
    }
    if (block === 'entityGrant' && withheld?.entityGrant === undefined)
      continue;
    const anchors = withheld?.[block];
    if (anchors === undefined)
      fail(scope, `has a ${block} block with no keep/withhold disposition`);
    result = withholdBlock(scope, source, result, block, anchors, BLOCK_NOTE);
  }

  result = triageGrants(scope, source, result);
  result = anchorCooldowns(scope, result);
  if (scope === 'Efreeti Bottle') result = efreetiStopper(result);
  return result;
}
