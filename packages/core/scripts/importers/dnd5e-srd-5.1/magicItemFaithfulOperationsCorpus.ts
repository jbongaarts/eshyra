/**
 * Whole-corpus completion of the faithful-or-absent operations table
 * (eshyra-o9bd.19.4.6.2, part E; bd memory magic-item-faithful-or-absent).
 *
 * Child 1 (eshyra-o9bd.19.4.6.1) reviewed the S2/S3 members. This table covers
 * every OTHER magic-item operation whose typed `activation` was not a printed
 * predicate: an `action` or `free` cost the text does not print, and a
 * requirement / trigger / target that paraphrased the source instead of
 * quoting it. Rules (same as the child 1 table):
 *
 *  - requirement / trigger / target set here is a VERBATIM span of the item's
 *    printed description (the compiler throws otherwise) or is removed;
 *  - a cost the text does not print is removed (`cost: null`) and the printed
 *    activation sentence is carried by an `adjudicated-by-design` clause with a
 *    verbatim `sourceText` span (the compiler requires the clause);
 *  - never an invented default.
 *
 * The whole-corpus screen in `magicItemOperationSourceAgreement.test.ts` asserts
 * the result over EVERY operation of EVERY magic item and variant, not over
 * the keys of this table, so an operation this table forgets fails the screen.
 */
import {
  clause,
  clausesFor,
  type FaithfulItemSpec,
  NO_COST_NOTE,
  op,
} from './magicItemFaithfulSpecKit.js';

const SPELL_CASTS_NOTE =
  'The printed text names no action cost for casting this spell from the item, so none is typed; the DM model applies the spell’s own casting time and the printed charge cost.';
const ITEM_SPELL_NORMAL_CASTING_TIME_NOTE =
  'No action cost is typed for this spell: the sentence prints “use an action” to activate the item, but rule:spells says a spell cast from an item uses its normal casting time unless the item changes it, and this item does not. The DM model applies the spell’s casting time.';

const ELEMENTAL_COMMAND_PLANES = [
  {
    plane: 'air',
    article: 'an',
    dominate: 'dominate-air-elemental',
    spells: ['cast-chain-lightning', 'cast-gust-of-wind', 'cast-wind-wall'],
    heading: 'Ring of Air Elemental Command',
    slay: 'If you help slay an air elemental while attuned to the ring',
    castSentence:
      'You can cast the following spells from the ring, expending the necessary number of charges: chain lightning (3 charges), gust of wind (2 charges), or wind wall (1 charge).',
  },
  {
    plane: 'earth',
    article: 'an',
    dominate: 'dominate-earth-elemental',
    spells: ['cast-stone-shape', 'cast-stoneskin', 'cast-wall-of-stone'],
    heading: 'Ring of Earth Elemental Command',
    slay: 'If you help slay an earth elemental while attuned to the ring',
    castSentence:
      'You can cast the following spells from the ring, expending the necessary number of charges: stone shape (2 charges), stoneskin (3 charges), or wall of stone (3 charges).',
  },
  {
    plane: 'fire',
    article: 'a',
    dominate: 'dominate-fire-elemental',
    spells: ['cast-burning-hands', 'cast-fireball', 'cast-wall-of-fire'],
    heading: 'Ring of Fire Elemental Command',
    slay: 'If you help slay a fire elemental while attuned to the ring',
    castSentence:
      'You can cast the following spells from the ring, expending the necessary number of charges: burning hands (1 charge), fireball (2 charges), and wall of fire (3 charges).',
  },
  {
    plane: 'water',
    article: 'a',
    dominate: 'dominate-water-elemental',
    spells: [
      'cast-create-or-destroy-water',
      'cast-control-water',
      'cast-ice-storm',
      'cast-wall-of-ice',
    ],
    heading: 'Ring of Water Elemental Command',
    slay: 'If you help slay a water elemental while attuned to the ring',
    castSentence:
      'You can cast the following spells from the ring, expending the necessary number of charges: create or destroy water (1 charge), control water (3 charges), ice storm (2 charges), or wall of ice (3 charges).',
  },
] as const;

const ELEMENTAL_COMMAND_SPEC: FaithfulItemSpec = {
  operations: [
    ...ELEMENTAL_COMMAND_PLANES.flatMap((plane) => [
      // The dominate ops print their own sentence under the plane's heading and
      // name an elemental of that plane; no action cost is printed.
      op(plane.dominate, {
        cost: null,
        requirement: plane.heading,
        target: `${plane.article} ${plane.plane} elemental`,
      }),
      // The post-slay casts print BOTH gates: the linked-plane variant (the
      // plane's heading, as the dominate op) and the help-slay prerequisite.
      ...plane.spells.map((spell) =>
        op(spell, {
          cost: null,
          requirement: plane.heading,
          trigger: plane.slay,
        }),
      ),
    ]),
    // The unlock is one op for all four rings; the per-plane printed sentences
    // are carried by clauses below instead of a single paraphrased trigger.
    op('unlock-linked-plane', { cost: null, trigger: null }),
  ],
  clauses: [
    ...ELEMENTAL_COMMAND_PLANES.flatMap((plane) => [
      clause(
        `activation-${plane.dominate}`,
        { operation: plane.dominate },
        `You can expend 2 of the ring’s charges to cast dominate monster on ${plane.article} ${plane.plane} elemental.`,
        SPELL_CASTS_NOTE,
      ),
      ...clausesFor(
        'activation',
        plane.spells,
        plane.castSentence,
        SPELL_CASTS_NOTE,
      ),
      clause(
        `activation-unlock-linked-plane-${plane.plane}`,
        { operation: 'unlock-linked-plane' },
        `${plane.slay}, you gain access to the following additional properties:`,
        NO_COST_NOTE,
      ),
    ]),
  ],
};

const STAFF_CHARMING_CASTS = [
  'cast-charm-person',
  'cast-command',
  'cast-comprehend-languages',
] as const;
const STAFF_FIRE_CASTS = [
  'cast-burning-hands',
  'cast-fireball',
  'cast-wall-of-fire',
] as const;
const STAFF_FROST_CASTS = [
  'cast-cone-of-cold',
  'cast-fog-cloud',
  'cast-ice-storm',
  'cast-wall-of-ice',
] as const;
const STAFF_HEALING_CASTS = [
  'cast-cure-wounds',
  'cast-lesser-restoration',
  'cast-mass-cure-wounds',
] as const;
const STAFF_POWER_CASTS = [
  'cast-cone-of-cold',
  'cast-fireball',
  'cast-globe-of-invulnerability',
  'cast-hold-monster',
  'cast-levitate',
  'cast-lightning-bolt',
  'cast-magic-missile',
  'cast-ray-of-enfeeblement',
  'cast-wall-of-force',
] as const;
/** The charged casts and the six free casts share the one printed
 * "While holding the staff" paragraph. */
const STAFF_MAGI_CASTS = [
  'cast-conjure-elemental',
  'cast-dispel-magic',
  'cast-fireball',
  'cast-flaming-sphere',
  'cast-ice-storm',
  'cast-invisibility',
  'cast-knock',
  'cast-lightning-bolt',
  'cast-passwall',
  'cast-plane-shift',
  'cast-telekinesis',
  'cast-wall-of-fire',
  'cast-web',
  'cast-arcane-lock',
  'cast-detect-magic',
  'cast-enlarge-reduce',
  'cast-light',
  'cast-mage-hand',
  'cast-protection-from-evil-and-good',
] as const;

export const DRINK_SENTENCES: Readonly<Record<string, string>> = {
  'Philter of Love':
    'The next time you see a creature within 10 minutes after drinking this philter, you become charmed by that creature for 1 hour.',
  'Potion of Animal Friendship':
    'When you drink this potion, you can cast the animal friendship spell (save DC 13) for 1 hour at will.',
  'Potion of Clairvoyance':
    'When you drink this potion, you gain the effect of the clairvoyance spell.',
  'Potion of Climbing':
    'When you drink this potion, you gain a climbing speed equal to your walking speed for 1 hour.',
  'Potion of Diminution':
    'When you drink this potion, you gain the “reduce” effect of the enlarge/reduce spell for 1d4 hours (no concentration required).',
  'Potion of Flying':
    'When you drink this potion, you gain a flying speed equal to your walking speed for 1 hour and can hover.',
  'Potion of Gaseous Form':
    'When you drink this potion, you gain the effect of the gaseous form spell for 1 hour (no concentration required) or until you end the effect as a bonus action.',
  'Potion of Giant Strength':
    'When you drink this potion, your Strength score changes for 1 hour.',
  'Potion of Growth':
    'When you drink this potion, you gain the “enlarge” effect of the enlarge/reduce spell for 1d4 hours (no concentration required).',
  'Potion of Healing': 'You regain hit points when you drink this potion.',
  'Potion of Heroism':
    'For 1 hour after drinking it, you gain 10 temporary hit points that last for 1 hour.',
  'Potion of Invisibility':
    'When you drink it, you become invisible for 1 hour.',
  'Potion of Mind Reading':
    'When you drink this potion, you gain the effect of the detect thoughts spell (save DC 13).',
  'Potion of Poison':
    'If you drink it, you take 3d6 poison damage, and you must succeed on a DC 13 Constitution saving throw or be poisoned.',
  'Potion of Resistance':
    'When you drink this potion, you gain resistance to one type of damage for 1 hour.',
  'Potion of Speed':
    'When you drink this potion, you gain the effect of the haste spell for 1 minute (no concentration required).',
  'Potion of Water Breathing':
    'You can breathe underwater for 1 hour after drinking this potion.',
};

/** `requirement` only: the printed holding/wearing clause for charged casts. */
const req = (
  name: string,
  operationIds: readonly string[],
  requirement: string,
): readonly [string, FaithfulItemSpec] => [
  name,
  { operations: operationIds.map((id) => op(id, { requirement })) },
];

export const CORPUS_SPECS: ReadonlyMap<string, FaithfulItemSpec> = new Map<
  string,
  FaithfulItemSpec
>([
  [
    'Armor of Invulnerability',
    // The printed actor and wearing-duration sentence governs immunity. These
    // contextual predicates stay untyped and survive as an adjudicated span.
    {
      operations: [
        op('activate-immunity', { requirement: null, target: null }),
      ],
      clauses: [
        clause(
          'activation-activate-immunity',
          { operation: 'activate-immunity' },
          'Additionally, you can use an action to make yourself immune to nonmagical damage for 10 minutes or until you are no longer wearing the armor.',
          'The printed actor and duration condition are not typed activation predicates; the DM model interprets this printed sentence.',
        ),
      ],
    },
  ],
  [
    'Arrow-Catching Shield',
    {
      operations: [
        op('redirect-ranged-attack', {
          trigger:
            'whenever an attacker makes a ranged attack against a target within 5 feet of you',
        }),
      ],
    },
  ],
  [
    'Arrow of Slaying',
    {
      operations: [
        op('deal-extra-damage', {
          cost: null,
          trigger:
            'If a creature belonging to the type, race, or group associated with an arrow of slaying takes damage from the arrow',
        }),
      ],
      clauses: [
        clause(
          'activation-deal-extra-damage',
          { operation: 'deal-extra-damage' },
          'If a creature belonging to the type, race, or group associated with an arrow of slaying takes damage from the arrow, the creature must make a DC 17 Constitution saving throw, taking an extra 6d10 piercing damage on a failed save, or half as much extra damage on a successful one.',
          NO_COST_NOTE,
        ),
      ],
    },
  ],
  [
    'Bead of Force',
    {
      operations: [
        op('throw-bead', { target: 'throw the bead up to 60 feet' }),
      ],
    },
  ],
  [
    'Cloak of Arachnida',
    { operations: [op('cast-web', { requirement: 'While wearing it' })] },
  ],
  [
    'Cube of Force',
    {
      operations: [
        op('spell-contact-loss', {
          cost: null,
          trigger:
            'when the barrier is targeted by certain spells or comes into contact with certain spell or magic item effects',
        }),
      ],
      clauses: [
        clause(
          'activation-spell-contact-loss',
          { operation: 'spell-contact-loss' },
          'The cube loses charges when the barrier is targeted by certain spells or comes into contact with certain spell or magic item effects, as shown in the table below.',
          NO_COST_NOTE,
        ),
      ],
    },
  ],
  [
    'Cubic Gate',
    {
      operations: [
        op('cast-plane-shift', { requirement: 'press one side twice' }),
      ],
    },
  ],
  [
    'Dimensional Shackles',
    {
      operations: [
        op('attach-shackles', { target: 'an incapacitated creature' }),
        op('escape-shackles', { cost: null }),
      ],
      clauses: [
        clause(
          'activation-escape-shackles',
          { operation: 'escape-shackles' },
          'Once every 30 days, the bound creature can make a DC 30 Strength (Athletics) check. On a success, the creature breaks free and destroys the shackles.',
          NO_COST_NOTE,
        ),
      ],
    },
  ],
  [
    'Dust of Disappearance',
    {
      operations: [
        op('throw-dust', {
          target: 'you and each creature and object within 10 feet of you',
        }),
      ],
    },
  ],
  [
    'Dust of Sneezing and Choking',
    {
      operations: [
        op('throw-dust', {
          target:
            'you and each creature that needs to breathe within 30 feet of you',
        }),
      ],
    },
  ],
  [
    'Dwarven Thrower',
    {
      operations: [
        op('throw-weapon', { cost: null }),
        op('return-to-hand', {
          cost: null,
          trigger: 'Immediately after the attack',
        }),
      ],
      clauses: [
        clause(
          'activation-throw-weapon',
          { operation: 'throw-weapon' },
          'It has the thrown property with a normal range of 20 feet and a long range of 60 feet.',
          NO_COST_NOTE,
        ),
        clause(
          'activation-return-to-hand',
          { operation: 'return-to-hand' },
          'Immediately after the attack, the weapon flies back to your hand.',
          NO_COST_NOTE,
        ),
      ],
    },
  ],
  ['Elemental Gem', { operations: [op('break-gem', { target: null })] }],
  [
    'Eyes of Charming',
    {
      operations: [
        op('cast-charm-person', {
          requirement: 'While wearing them',
          target: 'a humanoid within 30 feet of you',
        }),
      ],
    },
  ],
  [
    'Gem of Brightness',
    {
      operations: [
        op('blinding-beam', {
          commandWord: true,
          requirement: 'While you are holding it',
          target: 'one creature you can see within 60 feet of you',
        }),
        op('blinding-cone', {
          commandWord: true,
          requirement: 'While you are holding it',
        }),
      ],
    },
  ],
  [
    'Gloves of Missile Snaring',
    {
      operations: [
        op('snare-missile', {
          trigger:
            'When a ranged weapon attack hits you while you’re wearing them, you can use your reaction to reduce the damage by 1d10 + your Dexterity modifier, provided that you have a free hand',
        }),
      ],
    },
  ],
  [
    'Helm of Telepathy',
    {
      operations: [
        op('cast-suggestion', {
          requirement: 'While focusing on a creature with detect thoughts',
        }),
        op('cast-detect-thoughts', { requirement: 'While wearing this helm' }),
      ],
    },
  ],
  req('Helm of Teleportation', ['cast-teleport'], 'While wearing it'),
  [
    'Holy Avenger',
    {
      operations: [
        op('draw-sword', { cost: null }),
        op('sheathe-sword', { cost: null }),
      ],
      clauses: [
        ...clausesFor(
          'activation',
          ['draw-sword', 'sheathe-sword'],
          'While you hold the drawn sword, it creates an aura in a 10-foot radius around you.',
          NO_COST_NOTE,
        ),
      ],
    },
  ],
  [
    'Horn of Blasting',
    {
      operations: [
        op('blow-horn', {
          requirement: 'speak the horn’s command word and then blow the horn',
        }),
      ],
    },
  ],
  [
    'Ioun Stone::Absorption',
    {
      operations: [
        op('m9-cancel-ioun-absorption', {
          requirement: 'While this pale lavender ellipsoid orbits your head',
          trigger:
            'a spell of 4th level or lower cast by a creature you can see and targeting only you',
        }),
      ],
    },
  ],
  [
    'Ioun Stone::Greater Absorption',
    {
      operations: [
        op('m9-cancel-ioun-greater-absorption', {
          requirement:
            'While this marbled lavender and green ellipsoid orbits your head',
          trigger:
            'a spell of 8th level or lower cast by a creature you can see and targeting only you',
        }),
      ],
    },
  ],
  [
    'Ioun Stone::Reserve',
    {
      operations: [
        op('m9-store-ioun-reserve', {
          cost: null,
          trigger: 'by touching it as the spell is cast',
        }),
        op('m9-cast-ioun-reserve', {
          cost: null,
          requirement: 'While this stone orbits your head',
        }),
      ],
      clauses: [
        clause(
          'activation-m9-store-ioun-reserve',
          { operation: 'm9-store-ioun-reserve' },
          'Any creature can cast a spell of 1st through 3rd level into the stone by touching it as the spell is cast.',
          NO_COST_NOTE,
        ),
        clause(
          'activation-m9-cast-ioun-reserve',
          { operation: 'm9-cast-ioun-reserve' },
          'While this stone orbits your head, you can cast any spell stored in it.',
          NO_COST_NOTE,
        ),
      ],
    },
  ],
  [
    'Javelin of Lightning',
    {
      operations: [
        op('hurl-lightning', {
          cost: null,
          trigger: 'When you hurl it and speak its command word',
          target: 'a target within 120 feet',
        }),
      ],
      clauses: [
        clause(
          'activation-hurl-lightning',
          { operation: 'hurl-lightning' },
          'When you hurl it and speak its command word, it transforms into a bolt of lightning, forming a line 5 feet wide that extends out from you to a target within 120 feet.',
          NO_COST_NOTE,
        ),
      ],
    },
  ],
  [
    'Luck Blade',
    {
      operations: [
        op('cast-wish', { requirement: 'While holding it' }),
        op('m10-use-luck', {
          requirement: 'If the sword is on your person',
          trigger:
            'reroll one attack roll, ability check, or saving throw you dislike',
        }),
      ],
    },
  ],
  req('Mace of Terror', ['release-terror-wave'], 'While holding it'),
  [
    'Marvelous Pigments',
    {
      operations: [op('paint-object', { cost: null })],
      clauses: [
        clause(
          'activation-paint-object',
          { operation: 'paint-object' },
          'It takes 10 minutes to cover 100 square feet. When you complete the painting, the object or terrain feature depicted becomes a real, nonmagical object.',
          NO_COST_NOTE,
        ),
      ],
    },
  ],
  req('Medallion of Thoughts', ['cast-detect-thoughts'], 'While wearing it'),
  [
    'Oathbow',
    {
      operations: [
        op('m7-swear-enemy', {
          cost: null,
          commandWord: null,
          trigger: 'When you use this weapon to make a ranged attack',
          target: 'The target of your attack',
        }),
      ],
      clauses: [
        clause(
          'activation-m7-swear-enemy',
          { operation: 'm7-swear-enemy' },
          'When you use this weapon to make a ranged attack, you can, as a command phrase, say, “Swift death to you who have wronged me.”',
          'The printed text names a spoken command phrase and no action cost, so neither a cost nor a command word is typed; the DM model interprets the printed sentence.',
        ),
      ],
    },
  ],
  [
    'Oil of Etherealness',
    {
      operations: [
        op('apply-oil', {
          target:
            'a Medium or smaller creature, along with the equipment it’s wearing and carrying',
        }),
      ],
    },
  ],
  [
    'Oil of Sharpness',
    {
      operations: [
        op('apply-oil', {
          target:
            'one slashing or piercing weapon or up to 5 pieces of slashing or piercing ammunition',
        }),
      ],
    },
  ],
  [
    'Oil of Slipperiness',
    {
      operations: [
        op('apply-oil', {
          target:
            'a Medium or smaller creature, along with the equipment it’s wearing and carrying',
        }),
        op('pour-oil', { target: 'on the ground' }),
      ],
    },
  ],
  [
    'Orb of Dragonkind',
    {
      operations: [
        op('cast-scrying', {
          cost: null,
          requirement: 'If you control the orb',
        }),
        ...[
          'cast-cure-wounds',
          'cast-daylight',
          'cast-death-ward',
          'cast-detect-magic',
        ].map((id) => op(id, { requirement: 'If you control the orb' })),
        op('m7-attempt-orb-control', {
          requirement: 'While attuned to an orb',
        }),
      ],
      clauses: [
        clause(
          'activation-cast-scrying',
          { operation: 'cast-scrying' },
          // Narrow span: the full shared sentence stays in the triage clause
          // that governs all five orb casts.
          'scrying (3 charges)',
          ITEM_SPELL_NORMAL_CASTING_TIME_NOTE,
        ),
      ],
    },
  ],
  ...[
    'Philter of Love',
    'Potion of Animal Friendship',
    'Potion of Clairvoyance',
    'Potion of Climbing',
    'Potion of Diminution',
    'Potion of Flying',
    'Potion of Gaseous Form',
    'Potion of Giant Strength',
    'Potion of Growth',
    'Potion of Healing',
    'Potion of Heroism',
    'Potion of Invisibility',
    'Potion of Mind Reading',
    'Potion of Poison',
    'Potion of Resistance',
    'Potion of Speed',
    'Potion of Water Breathing',
    // Drinking targets the drinker; no printed target phrase exists.
  ].map((name): readonly [string, FaithfulItemSpec] => [
    name,
    {
      operations: [op('drink', { target: null })],
      clauses: [
        clause(
          'activation-drink',
          { operation: 'drink' },
          DRINK_SENTENCES[name] as string,
          'The printed drinker/delivery meaning is not typed as a target; the DM model interprets the printed text.',
        ),
      ],
    },
  ]),
  [
    'Restorative Ointment',
    {
      operations: [
        op('use-ointment', {
          target:
            'one dose of the ointment can be swallowed or applied to the skin',
        }),
      ],
    },
  ],
  ['Ring of Elemental Command', ELEMENTAL_COMMAND_SPEC],
  [
    'Ring of Evasion',
    {
      operations: [
        op('turn-failed-dex-save-into-success', {
          trigger: 'When you fail a Dexterity saving throw while wearing it',
        }),
      ],
    },
  ],
  [
    'Ring of Mind Shielding',
    {
      operations: [
        op('m7-soul-depart', {
          cost: null,
          trigger: 'depart for the afterlife',
        }),
      ],
      clauses: [
        clause(
          'activation-m7-soul-depart',
          { operation: 'm7-soul-depart' },
          'If you die while wearing the ring, your soul enters it, unless it already houses a soul. You can remain in the ring or depart for the afterlife.',
          NO_COST_NOTE,
        ),
      ],
    },
  ],
  [
    'Ring of Shooting Stars',
    {
      operations: [
        // "While wearing this ring in dim light or darkness" governs only the
        // two at-will spells; faerie fire carries no wearing sentence of its own.
        op('cast-faerie-fire', { requirement: null }),
        op('cast-dancing-lights', {
          requirement: 'While wearing this ring in dim light or darkness',
        }),
        op('cast-light', {
          requirement: 'While wearing this ring in dim light or darkness',
        }),
      ],
    },
  ],
  [
    'Ring of Spell Storing',
    {
      operations: [
        op('m9-store-ring-spell', {
          cost: null,
          trigger: 'by touching the ring as the spell is cast',
        }),
        op('m9-cast-ring-spell', {
          cost: null,
          requirement: 'While wearing this ring',
        }),
      ],
      clauses: [
        clause(
          'activation-m9-store-ring-spell',
          { operation: 'm9-store-ring-spell' },
          'Any creature can cast a spell of 1st through 5th level into the ring by touching the ring as the spell is cast.',
          NO_COST_NOTE,
        ),
        clause(
          'activation-m9-cast-ring-spell',
          { operation: 'm9-cast-ring-spell' },
          'While wearing this ring, you can cast any spell stored in it.',
          NO_COST_NOTE,
        ),
      ],
    },
  ],
  [
    'Ring of Spell Turning',
    {
      operations: [
        op('m10-reflect-spell', {
          cost: null,
          // "In addition" continues the wearing sentence whose saving throw
          // the reflected spell is rolled against.
          requirement: 'While wearing this ring',
          trigger:
            'if you roll a 20 for the save and the spell is 7th level or lower',
        }),
      ],
      clauses: [
        clause(
          'activation-m10-reflect-spell',
          { operation: 'm10-reflect-spell' },
          'In addition, if you roll a 20 for the save and the spell is 7th level or lower, the spell has no effect on you and instead targets the caster, using the slot level, spell save DC, attack bonus, and spellcasting ability of the caster.',
          NO_COST_NOTE,
        ),
      ],
    },
  ],
  [
    'Ring of the Ram',
    {
      operations: [
        op('spectral-ram-attack', {
          requirement: 'While wearing the ring',
          target: 'one creature you can see within 60 feet of you',
        }),
      ],
    },
  ],
  req('Ring of Three Wishes', ['cast-wish'], 'While wearing this ring'),
  req(
    'Robe of Scintillating Colors',
    ['display-scintillating-colors'],
    'While you wear it',
  ),
  req('Robe of Stars', ['cast-magic-missile'], 'While wearing this robe'),
  [
    'Rod of Absorption',
    {
      operations: [
        op('m9-absorb-rod-spell', {
          requirement: 'While holding this rod',
          trigger:
            'a spell that is targeting only you and not with an area of effect',
        }),
        op('m9-cast-with-rod-energy', {
          cost: null,
          requirement: 'If you are a spellcaster holding the rod',
        }),
      ],
      clauses: [
        clause(
          'activation-m9-cast-with-rod-energy',
          { operation: 'm9-cast-with-rod-energy' },
          'If you are a spellcaster holding the rod, you can convert energy stored in it into spell slots to cast spells you have prepared or know.',
          NO_COST_NOTE,
        ),
      ],
    },
  ],
  [
    'Rope of Entanglement',
    {
      operations: [
        op('entangle-creature', {
          commandWord: true,
          requirement: 'If you hold one end of the rope',
          target: 'a creature you can see within 20 feet of you',
        }),
      ],
    },
  ],
  [
    'Scarab of Protection',
    {
      operations: [
        op('turn-failed-save-into-success', {
          // The section header "It provides two benefits while it is on your
          // person" governs both benefits, including this reaction.
          requirement: 'while it is on your person',
          trigger:
            'If you fail a saving throw against a necromancy spell or a harmful effect originating from an undead creature',
        }),
      ],
    },
  ],
  [
    'Sovereign Glue',
    {
      operations: [
        op('apply-glue', {
          cost: null,
          target: 'a 1-foot square surface',
        }),
      ],
      clauses: [
        clause(
          'activation-apply-glue',
          { operation: 'apply-glue' },
          'One ounce of the glue can cover a 1-foot square surface.',
          NO_COST_NOTE,
        ),
      ],
    },
  ],
  [
    'Spell Scroll',
    {
      operations: [
        op('cast-spell', {
          requirement: 'If the spell is on your class’s spell list',
        }),
        op('copy-spell', {
          requirement:
            'A wizard spell on a spell scroll can be copied just as spells in spellbooks can be copied',
        }),
      ],
    },
  ],
  [
    'Sphere of Annihilation',
    {
      operations: [
        op('sphere-space-entry', {
          cost: null,
          trigger: 'A creature whose space the sphere enters',
        }),
        op('attempt-control', {
          requirement: 'If you are within 60 feet of an uncontrolled sphere',
        }),
        op('contest-control', { cost: null }),
        op('move-sphere', { cost: null }),
      ],
      clauses: [
        clause(
          'activation-sphere-space-entry',
          { operation: 'sphere-space-entry' },
          'A creature whose space the sphere enters must succeed on a DC 13 Dexterity saving throw or be touched by it, taking 4d10 force damage.',
          NO_COST_NOTE,
        ),
        clause(
          'activation-contest-control',
          { operation: 'contest-control' },
          'If you attempt to control a sphere that is under another creature’s control, you make an Intelligence (Arcana) check contested by the other creature’s Intelligence (Arcana) check.',
          NO_COST_NOTE,
        ),
        clause(
          'activation-move-sphere',
          { operation: 'move-sphere' },
          'The winner of the contest gains control of the sphere and can levitate it as normal.',
          NO_COST_NOTE,
        ),
      ],
    },
  ],
  [
    'Staff of Charming',
    {
      operations: [
        ...STAFF_CHARMING_CASTS.map((id) =>
          op(id, { requirement: 'While holding this staff' }),
        ),
        op('reflect-enchantment', {
          trigger:
            'If you succeed on a save against an enchantment spell that targets only you',
        }),
        op('m10-flip-enchantment-save', {
          cost: null,
          requirement: 'If you are holding the staff',
          trigger:
            'fail a saving throw against an enchantment spell that targets only you',
        }),
      ],
      clauses: [
        clause(
          'activation-m10-flip-enchantment-save',
          { operation: 'm10-flip-enchantment-save' },
          'If you are holding the staff and fail a saving throw against an enchantment spell that targets only you, you can turn your failed save into a successful one.',
          NO_COST_NOTE,
        ),
      ],
    },
  ],
  [
    'Staff of Power',
    {
      operations: [
        ...STAFF_POWER_CASTS.map((id) =>
          op(id, { requirement: 'While holding this staff' }),
        ),
        op('power-strike', {
          cost: null,
          trigger: 'When you hit with a melee attack using the staff',
        }),
      ],
      clauses: [
        clause(
          'activation-power-strike',
          { operation: 'power-strike' },
          'When you hit with a melee attack using the staff, you can expend 1 charge to deal an extra 1d6 force damage to the target.',
          NO_COST_NOTE,
        ),
      ],
    },
  ],
  [
    'Staff of Striking',
    {
      operations: [
        op('powerful-strike', {
          cost: null,
          trigger: 'When you hit with a melee attack using it',
        }),
      ],
      clauses: [
        clause(
          'activation-powerful-strike',
          { operation: 'powerful-strike' },
          'When you hit with a melee attack using it, you can expend up to 3 of its charges.',
          NO_COST_NOTE,
        ),
      ],
    },
  ],
  [
    'Staff of Withering',
    {
      operations: [op('withering-strike', { cost: null, trigger: 'On a hit' })],
      clauses: [
        clause(
          'activation-withering-strike',
          { operation: 'withering-strike' },
          'On a hit, it deals damage as a normal quarterstaff, and you can expend 1 charge to deal an extra 2d10 necrotic damage to the target.',
          NO_COST_NOTE,
        ),
      ],
    },
  ],
  [
    'Staff of the Magi',
    {
      operations: [
        op('cast-conjure-elemental', {
          cost: null,
          requirement: 'While holding the staff',
        }),
        ...STAFF_MAGI_CASTS.filter((id) => id !== 'cast-conjure-elemental').map(
          (id) => op(id, { requirement: 'While holding the staff' }),
        ),
        op('m9-absorb-staff-spell', {
          requirement: 'While holding the staff',
          trigger: 'when another creature casts a spell that targets only you',
        }),
      ],
      clauses: [
        clause(
          'activation-cast-conjure-elemental',
          { operation: 'cast-conjure-elemental' },
          'While holding the staff, you can use an action to expend some of its charges to cast one of the following spells from it, using your spell save DC and spellcasting ability: conjure elemental (7 charges), dispel magic (3 charges), fireball (7th-level version, 7 charges), flaming sphere (2 charges), ice storm (4 charges), invisibility (2 charges), knock (2 charges), lightning bolt (7th-level version, 7 charges), passwall (5 charges), plane shift (7 charges), telekinesis (5 charges), wall of fire (4 charges), or web (2 charges).',
          ITEM_SPELL_NORMAL_CASTING_TIME_NOTE,
        ),
      ],
    },
  ],
  [
    'Staff of the Woodlands',
    {
      operations: [op('cast-awaken', { cost: null })],
      clauses: [
        clause(
          'activation-cast-awaken',
          { operation: 'cast-awaken' },
          'You can use an action to expend 1 or more of the staff’s charges to cast one of the following spells from it, using your spell save DC: animal friendship (1 charge), awaken (5 charges), barkskin (2 charges), locate animals or plants (2 charges), speak with animals (1 charge), speak with plants (3 charges), or wall of thorns (6 charges).',
          ITEM_SPELL_NORMAL_CASTING_TIME_NOTE,
        ),
      ],
    },
  ],
  [
    'Sword of Wounding',
    {
      operations: [
        op('m7-apply-wound', {
          cost: null,
          trigger:
            'Once per turn, when you hit a creature with an attack using this magic weapon',
          target: 'the target',
        }),
        op('m7-end-wounds-save', {
          cost: null,
          trigger: 'At the start of each of the wounded creature’s turns',
          target: null,
        }),
        op('m7-treat-wounds', {
          requirement:
            'the wounded creature, or a creature within 5 feet of it',
          target: null,
        }),
      ],
      clauses: [
        clause(
          'activation-m7-apply-wound',
          { operation: 'm7-apply-wound' },
          'Once per turn, when you hit a creature with an attack using this magic weapon, you can wound the target.',
          NO_COST_NOTE,
        ),
        clause(
          'activation-m7-end-wounds-save',
          { operation: 'm7-end-wounds-save' },
          'At the start of each of the wounded creature’s turns, it takes 1d4 necrotic damage for each time you’ve wounded it, and it can then make a DC 15 Constitution saving throw, ending the effect of all such wounds on itself on a success.',
          NO_COST_NOTE,
        ),
      ],
    },
  ],
  req('Trident of Fish Command', ['cast-dominate-beast'], 'While you carry it'),
  [
    'Universal Solvent',
    { operations: [op('pour-solvent', { target: 'a surface within reach' })] },
  ],
  [
    'Wand of Binding',
    {
      operations: [
        ...['cast-hold-monster', 'cast-hold-person'].map((id) =>
          op(id, { requirement: 'While holding the wand' }),
        ),
      ],
      clauses: [
        clause(
          'activation-assisted-escape',
          { operation: 'assisted-escape' },
          'Assisted Escape. While holding the wand, you can use your reaction to expend 1 charge and gain advantage on a saving throw you make to avoid being paralyzed or restrained, or you can expend 1 charge and gain advantage on any check you make to escape a grapple.',
          'The printed reaction applies only to the saving-throw branch; no common activation cost is typed for both branches.',
        ),
      ],
    },
  ],
  [
    'Dwarven Plate',
    {
      operations: [
        op('reduce-forced-movement', {
          trigger: 'if an effect moves you against your will along the ground',
        }),
      ],
    },
  ],
  req('Wand of Fireballs', ['cast-fireball'], 'While holding it'),
  req('Wand of Lightning Bolts', ['cast-lightning-bolt'], 'While holding it'),
  req('Wand of Magic Detection', ['cast-detect-magic'], 'While holding it'),
  req('Wand of Magic Missiles', ['cast-magic-missile'], 'While holding it'),
  [
    'Wand of Paralysis',
    {
      operations: [
        op('paralyzing-ray', {
          requirement: 'While holding it',
          target: 'a creature you can see within 60 feet of you',
        }),
      ],
    },
  ],
  req('Wand of Polymorph', ['cast-polymorph'], 'While holding it'),
  req('Wand of Web', ['cast-web'], 'While holding it'),
  req('Wind Fan', ['cast-gust-of-wind'], 'While holding this fan'),
  // --- eshyra-o9bd.19.4.6.4 (review 19.4.6.3 S1): printed holding / wearing
  // / target predicates that earlier passes omitted --------------------------
  req('Staff of Fire', STAFF_FIRE_CASTS, 'While holding it'),
  req('Staff of Frost', STAFF_FROST_CASTS, 'While holding it'),
  req('Staff of Healing', STAFF_HEALING_CASTS, 'While holding it'),
  req(
    'Staff of Swarming Insects',
    ['cast-giant-insect', 'cast-insect-plague', 'create-insect-cloud'],
    'While holding the staff',
  ),
  req('Boots of Levitation', ['cast-levitate'], 'While you wear these boots'),
  req('Cape of the Mountebank', ['cast-dimension-door'], 'While wearing it'),
  req(
    'Circlet of Blasting',
    ['cast-scorching-ray'],
    'While wearing this circlet',
  ),
  req('Hat of Disguise', ['cast-disguise-self'], 'While wearing this hat'),
  req(
    'Helm of Comprehending Languages',
    ['cast-comprehend-languages'],
    'While wearing this helm',
  ),
  req('Ring of Invisibility', ['become-invisible'], 'While wearing this ring'),
  req('Ring of Jumping', ['cast-jump'], 'While wearing this ring'),
  req('Ring of Telekinesis', ['cast-telekinesis'], 'While wearing this ring'),
  req('Robe of Useful Items', ['detach-patch'], 'While wearing the robe'),
  req('Wings of Flying', ['manifest-wings'], 'While wearing this cloak'),
  // Review 19.4.6.7 S1: printed gates and non-spell action costs that no
  // producer draft carried (eshyra-o9bd.19.4.6.8).
  req(
    'Sun Blade',
    ['manifest-blade', 'dismiss-blade'],
    'While grasping the hilt',
  ),
  [
    'Dragon Scale Mail',
    { operations: [op('sense-nearest-dragon', { cost: 'action' })] },
  ],
  [
    'Well of Many Worlds',
    { operations: [op('open-portal', { cost: 'action' })] },
  ],
  [
    'Chime of Opening',
    {
      operations: [
        op('strike-chime', {
          target: 'an object within 120 feet of you that can be opened',
        }),
      ],
    },
  ],
  [
    'Iron Flask',
    {
      containment: [
        {
          procedure: 'entry',
          activation: {
            target: 'a creature that you can see within 60 feet of you',
          },
        },
      ],
    },
  ],
  // The helm's four spell casts sit under "You gain the following benefits
  // while wearing it".
  req(
    'Helm of Brilliance',
    [
      'cast-prismatic-spray',
      'cast-wall-of-fire',
      'cast-fireball',
      'cast-daylight',
    ],
    'while wearing it',
  ),
]);
