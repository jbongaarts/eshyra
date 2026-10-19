/**
 * Source-grounded M4 projection for magic-item-created, summoned, controlled,
 * and illusory entities. This is immutable pack data only: live hit points,
 * initiative, position, and ownership remain encounter-combatant/persistent-
 * actor state owned by the F3 lifecycle service.
 */
import type {
  MagicItemEntityGrant,
  MagicItemMechanics,
  MagicItemStateMachine,
} from '../../../src/rules/magicItemMechanics.js';
import type {
  EngineHookBinding,
  MagicItemFamilyProjection,
} from './magicItemCompiler.js';
import { creatureGrantLifecycleOwned } from './magicItemGrantOwnership.js';
import type { MagicItemExtraction } from './types.js';

type EntityGrantEntry = MagicItemEntityGrant['grants'][number];

interface EntityGrantSpec {
  readonly sourcePhrases: readonly string[];
  readonly entityGrant: MagicItemEntityGrant;
  readonly hooks?: readonly EngineHookBinding[];
  /** A typed external-event consequence of the grant's creature (eshyra-olc5.15),
   *  applied through item_state_event rather than a grant ending. */
  readonly stateMachine?: MagicItemStateMachine;
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
/** Landed (olc5.15): item_state_event applies a declared external-event
 *  transition whose printed effect is a durable lifecycle (nonmagical) and ends
 *  the item's live grants in the same transaction. */
export const EXTERNAL_EVENT_LIFECYCLE_HOOK = {
  engine: 'F5',
  hook: 'external-event item lifecycle consequence',
} as const;
const CONTROLLED_HOOKS = [F3_ENTITY_OWNER, F2_COMMAND, F5_ITEM_LINK] as const;
const LIFECYCLE_HOOKS = [F3_ENTITY_OWNER, F5_ITEM_LINK] as const;

/**
 * Verbatim printed control / obedience sentence(s) for the creature grants the
 * runtime owns (eshyra-c58j.1; see {@link creatureGrantLifecycleOwned}). The
 * recorded decision on eshyra-c58j / olc5.12 keeps CONTROL DM-adjudicated:
 * the controlled-entity command action budget is therefore carried by an
 * adjudicated clause (no engine hook, like every adjudicated clause) whose
 * `sourceText` is this exact span, not by an engine-pending hook. An owned grant with no entry here keeps the hook on its
 * entityGrant clause. Every span is checked verbatim against the printed
 * description by the clause integrity check.
 */
const CONTROL_SPANS: ReadonlyMap<string, string> = new Map([
  [
    'Bowl of Commanding Water Elementals',
    'summon a water elemental, as if you had cast the conjure elemental spell',
  ],
  [
    'Brazier of Commanding Fire Elementals',
    'summon a fire elemental, as if you had cast the conjure elemental spell',
  ],
  [
    'Censer of Controlling Air Elementals',
    'summon an air elemental, as if you had cast the conjure elemental spell',
  ],
  [
    'Stone of Controlling Earth Elementals',
    'summon an earth elemental, as if you had cast the conjure elemental spell',
  ],
  [
    'Elemental Gem',
    'an elemental is summoned as if you had cast the conjure elemental spell',
  ],
  [
    'Horn of Valhalla',
    'If you blow the horn without meeting its requirement, the summoned berserkers attack you. If you meet the requirement, they are friendly to you and your companions and follow your commands.',
  ],
  [
    'Ring of Djinni Summoning',
    'While summoned, the djinni is friendly to you and your companions. It obeys any commands you give it, no matter what language you use. If you fail to command it, the djinni defends itself against attackers but takes no other actions.',
  ],
]);

const CONTROL_NOTE =
  'Control, obedience and the command action budget of the summoned creature stay DM-adjudicated (recorded decision, eshyra-c58j / olc5.12); the engine owns only the grant binding, lifetime and identity, so this printed span is interpreted by the DM model.';

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

/** Horn of Valhalla types (table:horn-of-valhalla, p. 226): variant id and the
 *  row's printed count dice. The rows are checked verbatim against the emitted
 *  table (see HORN_OF_VALHALLA_TYPES in parseMagicItems.ts). */
const HORN_TYPES = [
  { variant: 'silver', countRoll: '2d4+2' },
  { variant: 'brass', countRoll: '3d4+3' },
  { variant: 'bronze', countRoll: '4d4+4' },
  { variant: 'iron', countRoll: '5d4+5' },
] as const;

const elementalVessel = (
  creatureRef: string,
  operationId: string,
  requirement: string,
): EntityGrantSpec => ({
  sourcePhrases: [
    requirement,
    // The printed single elemental the typed count of 1 is traced to.
    `summon ${/^[aeiou]/.test(creatureRef.slice('creature:'.length)) ? 'an' : 'a'} ${creatureRef.slice('creature:'.length).replace('-', ' ')}`,
    'as if you had cast the conjure elemental spell',
    'until the next dawn',
  ],
  entityGrant: {
    runtimeOwner: 'encounter-combatant',
    grants: [
      creature(operationId, creatureRef, {
        // Each vessel prints the summoning of ONE elemental ("an elemental").
        count: 1,
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

/** The printed Ivory Goats variant owns the three goat grants (S1). */
const IVORY_GOATS = ['ivory-goats'] as const;

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
    // S1: a figurine grant belongs to the variant of the same printed id
    // (Golden Lions, Onyx Dog, ...) unless the caller names another variant.
    variants: [id],
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
            // eshyra-olc5.15 source check: the printed text has NO death-
            // triggered item transition. The former curated onEntityDeath
            // ('resolve the efreeti’s normal death; the bottle outcome remains
            // spent') was a curation note, not a source consequence, so it is
            // removed and the grant is no longer held pending for it. The
            // printed item consequences ('the bottle loses its magic') are
            // table:efreeti-bottle outcomes, carried by that table and the
            // random procedure; no item transition is invented for the death.
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
            variants: ['ebony-fly'],
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
            variants: IVORY_GOATS,
            control:
              'friendly; understands owner languages and obeys spoken commands; otherwise only defends itself',
            revertOn: FIGURINE_REVERT,
            cooldownEconomy: 'goat-of-traveling-hour-charges',
            exclusiveInstance: { scope: 'item', recast: 'blocked' },
            note: 'Large goat using riding-horse statistics; duration is charged per hour or portion, with no fixed cap.',
          }),
          figurine('goat-of-travail', 'creature:giant-goat', 3, {
            variants: IVORY_GOATS,
            note: 'Thirty-day cooldown begins on reversion.',
          }),
          figurine('goat-of-terror', 'creature:giant-goat', 3, {
            variants: IVORY_GOATS,
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
          ...HORN_TYPES.map(({ variant, countRoll }) =>
            creature(`${variant}-berserkers`, 'creature:berserker', {
              tableRefs: ['table:horn-of-valhalla'],
              // The horn's type is the instance's variant (S1); its row of
              // table:horn-of-valhalla fixes the count, which the ENGINE rolls
              // per use (countRoll) and the binder enforces.
              variants: [variant],
              countRoll,
              control:
                'friendly and commanded if requirement is met; otherwise hostile to the user',
              duration: { amount: 1, unit: 'hour' },
              revertOn: ['one-hour-ended', 'reduced-to-0-hit-points'],
              cooldownEconomy: 'cooldown',
              exclusiveInstance: { scope: 'item', recast: 'blocked' },
              note: `The ${variant} horn summons ${countRoll} berserkers; the horn type's requirement is read from the variant text and checked by the DM.`,
            }),
          ),
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
            // The printed hour times how long the creature is FRIENDLY and
            // obedient, not how long it exists: after it the creature stays and
            // acts on its normal disposition. That control clock is the
            // adjudicated control paragraph, so no existence duration or
            // reversion is typed (review 19.4.6.7 S4).
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
            // eshyra-olc5.15: the printed 'the ring becomes nonmagical if the
            // djinni dies' is TYPED as the stateMachine transition below and
            // executed by item_state_event, so it is no longer a pending
            // onEntityDeath note on the grant.
            cooldownEconomy: 'cooldown',
            exclusiveInstance: { scope: 'item', recast: 'blocked' },
            note: 'This is the same particular djinni on every successful summon; every departure returns it to its home plane and starts the 24-hour cooldown.',
          }),
        ],
      },
      // The djinni's DEATH is distinct from its return home at 0 hit points
      // (an ordinary ending that only starts the cooldown). The DM adjudicates
      // that it died, possibly with no summon active, and reports the exact
      // condition through item_state_event. Any live summon ends in the same
      // transaction and no cooldown is scheduled (the ring is nonmagical). Pack
      // text stays verbatim: every state-machine note must quote the source.
      stateMachine: {
        initial: 'magical',
        states: [{ id: 'magical' }, { id: 'nonmagical' }],
        transitions: [
          {
            from: 'magical',
            to: 'nonmagical',
            condition: 'the djinni dies',
            becomes: 'nonmagical',
          },
        ],
        termination: 'the djinni dies',
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
            // eshyra-olc5.15: typed and executed. The 0-hit-point ending
            // destroys the source staff in the same transaction (the
            // bonus-action reversion leaves it intact).
            destroysItemOn: 'reduced-to-0-hit-points',
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

/** Items whose reviewed grant spec prints a death-triggered item consequence
 *  (`onEntityDeath`). The projection strips it from the pack (triage keeps
 *  only typed fields), so a reader of the pack alone cannot see it; ownership
 *  (`creatureGrantLifecycleOwned`) keeps these grants pending (PR #673 P2-2). */
export const MAGIC_ITEM_ENTITY_GRANTS_WITH_DEATH_CONSEQUENCE: ReadonlySet<string> =
  new Set(
    [...SPECS.entries()]
      .filter(([, spec]) =>
        spec.entityGrant.grants.some(
          (grant) => grant.onEntityDeath !== undefined,
        ),
      )
      .map(([name]) => name),
  );

/** The same set keyed by pack record key (`magic-item:<slug>`), for the
 *  compiler, which classifies the triaged pack mechanics the death consequence
 *  was stripped from. */
export const MAGIC_ITEM_ENTITY_GRANT_KEYS_WITH_DEATH_CONSEQUENCE: ReadonlySet<string> =
  new Set(
    [...MAGIC_ITEM_ENTITY_GRANTS_WITH_DEATH_CONSEQUENCE].map(
      (name) =>
        `magic-item:${name
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, '-')
          .replace(/^-|-$/g, '')}`,
    ),
  );

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
  const slug = item.name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
  const hooks = spec.hooks ?? LIFECYCLE_HOOKS;
  // eshyra-c58j.1: for a grant the runtime owns, the F2 command-budget hook
  // leaves the engine-pending entityGrant clause and the control is carried by
  // an adjudicated control clause with the verbatim printed control sentence.
  const controlSpan = CONTROL_SPANS.get(item.name);
  const moveControl =
    controlSpan !== undefined && creatureGrantLifecycleOwned(spec.entityGrant);
  return {
    family: 'm4-entity-lifecycles',
    mechanics: {
      entityGrant: spec.entityGrant,
      ...(spec.stateMachine === undefined
        ? {}
        : { stateMachine: spec.stateMachine }),
    } satisfies Readonly<Partial<MagicItemMechanics>>,
    clauses: [
      {
        id: `m4-${slug}`,
        tag: 'M4',
        representation: { block: 'entityGrant' },
        engineHooks: moveControl
          ? hooks.filter((hook) => hook !== F2_COMMAND)
          : hooks,
      },
      ...(spec.stateMachine === undefined
        ? []
        : [
            {
              // Tagged M4 (the grant family's own consequence), not M5: the
              // M5 census counts reviewed operation-driven state machines.
              id: `m4-lifecycle-${slug}`,
              tag: 'M4' as const,
              representation: { block: 'stateMachine' as const },
              engineHooks: [EXTERNAL_EVENT_LIFECYCLE_HOOK],
            },
          ]),
      ...(moveControl
        ? [
            {
              id: `m4-control-${slug}`,
              tag: 'M4' as const,
              representation: {
                adjudicated: true as const,
                note: CONTROL_NOTE,
                sourceText: controlSpan,
              },
              // No engineHooks: like every adjudicated clause (see the
              // triage), the DM-adjudicated control carries no engine hook.
            },
          ]
        : []),
    ],
  };
}
