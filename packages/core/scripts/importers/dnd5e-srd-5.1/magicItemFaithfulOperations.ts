/**
 * Faithful-or-absent operations and activation (eshyra-o9bd.19.4.6.1; bd
 * memory magic-item-faithful-or-absent).
 *
 * NOTE (eshyra-o9bd.19.4.6.6): this table is the reviewed INPUT layer. The
 * `magicItemTriage.ts` pass applied after it removes the free-text
 * requirement / trigger / target / note fields from the compiled pack (keeping
 * cost, commandWord and the structured `equipment` prerequisite) and carries
 * each printed sentence as an adjudicated clause.
 *
 * A typed `activation` field on a magic-item operation states the printed
 * predicate exactly or does not exist. The family producers draft candidate
 * operations (and, for generic toggles, a default `action` cost); this table is
 * the reviewed source-agreement layer applied on top of them:
 *
 *  - `requirement` / `trigger` / `target` are existing free-text activation
 *    fields. When this table sets one, the value is a VERBATIM span of the
 *    item's printed description (the compiler fails loudly otherwise), so the
 *    typed claim is the printed predicate, never a paraphrase.
 *  - `cost: null` removes an activation cost the text does not state (there is
 *    no default cost). The activation sentence is then carried by an
 *    `adjudicated-by-design` clause with a verbatim `sourceText` span so the DM
 *    model interprets the printed text; the compiler requires such a clause for
 *    every dropped cost.
 *  - `clauses` also carry any printed delivery/eligibility/lifecycle sentence
 *    that no existing field can state exactly (range, speed bounds, landing
 *    triggers, clear-space preconditions), bound to the operation or block that
 *    projects the selected ability.
 *
 * Runtime safety: `use_item` and the readiness preflight read only operation
 * ids, `cost` (economies), `excludes`, `doesNotExpend` and `effects`; they
 * never read `activation`. `dropEconomyCost` is the one edit to an economy
 * cost and is limited to a charge that the text commits only on an outcome (see
 * its use). An adjudicated clause carries no `block` representation, so it is
 * never a readiness blocker and cannot turn a green operation red.
 *
 * Scope: operations and activation (review groups S2 and S3 of
 * eshyra-o9bd.19.4.5.7) in `BASE_SPECS`, completed over the whole corpus by
 * `magicItemFaithfulOperationsCorpus.ts` (eshyra-o9bd.19.4.6.2); the two tables
 * are merged by key. State graphs, grant lifecycles, economies and containment
 * are `magicItemFaithfulLifecycles.ts`. Producers may still draft an invented
 * default cost or operation; these tables are the reviewed layer that removes
 * it, and the whole-corpus screen in
 * `magicItemOperationSourceAgreement.test.ts` fails when one survives.
 */
import type {
  MagicItemActivationSpec,
  MagicItemContainment,
  MagicItemOperation,
} from '../../../src/rules/magicItemMechanics.js';
import type {
  ItemClauseExpectation,
  MagicItemClauseTag,
  MagicItemFamilyProjection,
} from './magicItemCompiler.js';
import { CORPUS_SPECS } from './magicItemFaithfulOperationsCorpus.js';
import {
  type ActivationPatch,
  type AdjudicatedOwner,
  clause,
  clausesFor,
  type FaithfulItemSpec,
  NO_COST_NOTE,
  NOTE,
  type OperationPatch,
  op,
} from './magicItemFaithfulSpecKit.js';
import type { MagicItemExtraction } from './types.js';

export type {
  ActivationClause,
  ActivationPatch,
  AdjudicatedOwner,
  ContainmentPatch,
  FaithfulItemSpec,
  OperationPatch,
} from './magicItemFaithfulSpecKit.js';

const FIGURINE_CREATION =
  'If you use an action to speak the command word and throw the figurine to a point on the ground within 60 feet of you, the figurine becomes a living creature. If the space where the creature would appear is occupied by other creatures or objects, or if there isn’t enough space for the creature, the figurine doesn’t become a creature.';
const FIGURINE_REVERSION =
  'It reverts to a figurine early if it drops to 0 hit points or if you use an action to speak the command word again while touching it.';
const APPARATUS_LEVERS = [
  ...Array.from({ length: 9 }, (_, index) => `set-lever-${index + 1}`),
  'set-lever-10-up',
  'set-lever-10-down',
];
const TALISMAN_TARGET =
  'one creature you can see on the ground within 120 feet of you';

/**
 * Table key: the item name, or `Item name::Variant name` for a variant scope.
 */
const BASE_SPECS: ReadonlyMap<string, FaithfulItemSpec> = new Map([
  // --- S2 -----------------------------------------------------------------
  [
    'Dagger of Venom',
    // The coating is created by the action; "the dagger is coated" belongs to
    // the later hit payload, so it is not a prerequisite of coat-blade.
    { operations: [op('coat-blade', { requirement: null })] },
  ],
  [
    'Animated Shield',
    {
      operations: [
        op('speak-command-word', { requirement: 'While holding this shield' }),
        // Ending the animation needs only a bonus action, not the word.
        op('end-animation', { commandWord: null }),
      ],
    },
  ],
  [
    'Bowl of Commanding Water Elementals',
    {
      operations: [
        op('summon-water-elemental', {
          cost: 'action',
          commandWord: true,
          requirement: 'While this bowl is filled with water',
        }),
      ],
    },
  ],
  [
    'Brazier of Commanding Fire Elementals',
    {
      operations: [
        op('summon-fire-elemental', {
          cost: 'action',
          commandWord: true,
          requirement: 'While a fire burns in this brass brazier',
        }),
      ],
    },
  ],
  [
    'Censer of Controlling Air Elementals',
    {
      operations: [
        op('summon-air-elemental', {
          cost: 'action',
          commandWord: true,
          requirement: 'While incense is burning in this censer',
        }),
      ],
    },
  ],
  [
    'Stone of Controlling Earth Elementals',
    {
      operations: [
        op('summon-earth-elemental', {
          cost: 'action',
          commandWord: true,
          requirement: 'If the stone is touching the ground',
        }),
      ],
    },
  ],
  [
    'Bead of Force',
    {
      operations: [
        op('move-force-sphere', { requirement: 'An enclosed creature' }),
      ],
      clauses: [
        clause(
          'activation-move-force-sphere',
          { operation: 'move-force-sphere' },
          'An enclosed creature can use its action to push against the sphere’s wall, moving the sphere up to half the creature’s walking speed.',
        ),
      ],
    },
  ],
  [
    'Broom of Flying',
    {
      operations: [
        op('mount-broom', {
          cost: null,
          commandWord: true,
          requirement: 'stand astride it',
        }),
        op('send-broom', {
          cost: null,
          commandWord: true,
          target: 'a destination within 1 mile of you',
          requirement: 'name the location, and are familiar with that place',
        }),
        op('recall-broom', {
          cost: null,
          commandWord: true,
          requirement: 'the broom is still within 1 mile of you',
        }),
      ],
      clauses: [
        clause(
          'activation-mount-broom',
          { operation: 'mount-broom' },
          'until you stand astride it and speak its command word',
          NO_COST_NOTE,
        ),
        clause(
          'activation-send-broom',
          { operation: 'send-broom' },
          'You can send the broom to travel alone to a destination within 1 mile of you if you speak the command word, name the location, and are familiar with that place.',
          NO_COST_NOTE,
        ),
        clause(
          'activation-recall-broom',
          { operation: 'recall-broom' },
          'The broom comes back to you when you speak another command word, provided that the broom is still within 1 mile of you.',
          NO_COST_NOTE,
        ),
      ],
    },
  ],
  [
    'Carpet of Flying',
    {
      operations: [
        op('command-flight', { commandWord: true }),
        op('end-flight', { cost: null }),
      ],
      clauses: [
        clause(
          'activation-command-flight',
          { operation: 'command-flight' },
          'It moves according to your spoken directions, provided that you are within 30 feet of it.',
        ),
        clause(
          'activation-end-flight',
          { operation: 'end-flight' },
          'It moves according to your spoken directions, provided that you are within 30 feet of it.',
          NO_COST_NOTE,
        ),
      ],
    },
  ],
  [
    'Cloak of the Bat',
    {
      operations: [
        op('cast-polymorph', {
          requirement:
            'While wearing the cloak in an area of dim light or darkness',
        }),
        // Ending the form is the cast polymorph spell's own ending; the text
        // names no action cost for it.
        op('end-polymorph', { cost: null }),
      ],
      clauses: [
        clause(
          'activation-end-polymorph',
          { operation: 'end-polymorph' },
          'you can use your action to cast polymorph on yourself, transforming into a bat',
          'The cloak prints no ending of its own and names no action cost for ending the bat form. The ending is inherited from the polymorph spell it casts: the transformation lasts for the spell’s duration, or until the target drops to 0 hit points or dies (spell:polymorph). The cited sentence is the only printed passage that casts that spell, so the DM model applies the polymorph spell’s own ending rule.',
        ),
      ],
    },
  ],
  [
    'Dancing Sword',
    {
      operations: [
        op('launch-sword', { commandWord: true }),
        op('command-attack', { requirement: 'While the sword hovers' }),
        op('catch-sword', { cost: null }),
      ],
      clauses: [
        clause(
          'activation-command-attack',
          { operation: 'command-attack' },
          'you can use a bonus action to cause it to fly up to 30 feet to another spot within 30 feet of you. As part of the same bonus action, you can cause the sword to attack one creature within 5 feet of it.',
        ),
        clause(
          'activation-catch-sword',
          { operation: 'catch-sword' },
          'After the hovering sword attacks for the fourth time, it flies up to 30 feet and tries to return to your hand.',
          NO_COST_NOTE,
        ),
      ],
    },
  ],
  [
    'Decanter of Endless Water',
    {
      operations: [
        ...['produce-stream', 'produce-fountain', 'produce-geyser'].map((id) =>
          op(id, { commandWord: true, requirement: 'remove the stopper' }),
        ),
      ],
    },
  ],
  [
    'Feather Token',
    {
      operations: [
        // "varies by token kind" is not printed; each kind carries its own
        // printed delivery below.
        op('use-token', { target: null }),
        op('use-anchor', { target: 'a boat or ship' }),
        op('use-bird', { requirement: 'toss the token 5 feet into the air' }),
        op('use-fan', { requirement: 'If you are on a boat or ship' }),
        op('use-swan-boat', {
          target: 'a body of water at least 60 feet in diameter',
        }),
        op('use-tree', {
          requirement: 'You must be outdoors to use this token',
          target: 'an unoccupied space on the ground',
        }),
        op('use-whip', { target: 'a point within 10 feet of you' }),
      ],
      clauses: [
        clause(
          'activation-use-fan',
          { operation: 'use-fan' },
          'If you are on a boat or ship, you can use an action to toss the token up to 10 feet in the air.',
        ),
      ],
    },
  ],
  [
    'Folding Boat',
    {
      operations: [
        ...['become-boat', 'become-ship'].map((id) =>
          op(id, { commandWord: true }),
        ),
        op('fold-boat', {
          commandWord: true,
          requirement: 'provided that no creatures are aboard',
        }),
      ],
    },
  ],
  [
    'Eversmoking Bottle',
    { operations: [op('close-bottle', { commandWord: true })] },
  ],
  [
    'Gem of Brightness',
    {
      operations: [
        op('shed-light', { requirement: 'While you are holding it' }),
      ],
    },
  ],
  [
    'Gem of Seeing',
    {
      operations: [op('gain-truesight', { cost: 'action', commandWord: true })],
    },
  ],
  [
    'Helm of Brilliance',
    {
      operations: [
        op('ignite-weapon', {
          requirement: 'As long as the helm has at least one fire opal',
        }),
      ],
    },
  ],
  [
    'Instant Fortress',
    {
      operations: [
        op('deploy-fortress', {
          commandWord: true,
          requirement: 'place this 1-inch metal cube on the ground',
        }),
        op('dismiss-fortress', {
          commandWord: true,
          requirement: 'works only if the fortress is empty',
        }),
      ],
    },
  ],
  [
    'Iron Bands of Binding',
    {
      operations: [
        op('throw-bands', {
          commandWord: true,
          target:
            'a Huge or smaller creature you can see within 60 feet of you',
        }),
      ],
    },
  ],
  [
    'Pearl of Power',
    {
      operations: [
        op('regain-spell-slot', {
          requirement: 'While this pearl is on your person',
        }),
      ],
    },
  ],
  [
    'Plate Armor of Etherealness',
    {
      operations: [
        op('gain-etherealness', {
          cost: 'action',
          commandWord: true,
          requirement: 'While you’re wearing this armor',
        }),
      ],
    },
  ],
  [
    'Ring of Djinni Summoning',
    {
      operations: [
        op('summon-djinni', {
          cost: 'action',
          commandWord: true,
          requirement: 'While wearing this ring',
          target: 'an unoccupied space you choose within 120 feet of you',
        }),
      ],
    },
  ],
  [
    'Ring of Shooting Stars',
    {
      operations: [
        op('create-ball-lightning', {
          target: 'an unoccupied space you can see within 120 feet of you',
        }),
        op('move-ball-lightning', {
          requirement: 'no farther than 120 feet away from you',
        }),
        op('launch-shooting-stars', {
          target: 'a point you can see within 60 feet of you',
        }),
        // Automatic discharge: no action cost is printed, only its trigger.
        op('discharge-ball-lightning', {
          cost: null,
          trigger:
            'When a creature other than you comes within 5 feet of a sphere',
        }),
      ],
      clauses: [
        clause(
          'activation-discharge-ball-lightning',
          { operation: 'discharge-ball-lightning' },
          'When a creature other than you comes within 5 feet of a sphere, the sphere discharges lightning at that creature and disappears.',
          NO_COST_NOTE,
        ),
      ],
    },
  ],
  [
    'Ring of the Ram',
    {
      operations: [
        op('break-object', {
          cost: 'action',
          target:
            'an object you can see within 60 feet of you that isn’t being worn or carried',
        }),
      ],
    },
  ],
  [
    'Rod of Alertness',
    {
      operations: [
        'cast-detect-evil-and-good',
        'cast-detect-magic',
        'cast-detect-poison-and-disease',
        'cast-see-invisibility',
      ].map((id) => op(id, { requirement: 'While holding the rod' })),
    },
  ],
  [
    'Rod of Rulership',
    {
      operations: [
        op('command-obedience', {
          cost: 'action',
          requirement: 'present the rod',
          target:
            'each creature of your choice that you can see within 120 feet of you',
        }),
      ],
    },
  ],
  [
    'Rod of Security',
    {
      operations: [
        op('enter-paradise', {
          cost: 'action',
          requirement: 'While holding this rod',
        }),
      ],
      containment: [
        {
          procedure: 'entry',
          activation: { requirement: 'While holding this rod' },
        },
      ],
    },
  ],
  [
    'Rope of Climbing',
    {
      operations: [
        op('animate-rope', {
          commandWord: true,
          requirement: 'you hold one end of the rope',
        }),
        op('fasten-rope', { cost: null }),
        op('knot-rope', { cost: null }),
        op('release-rope', { cost: null }),
      ],
      clauses: clausesFor(
        'activation',
        ['fasten-rope', 'knot-rope', 'release-rope'],
        'You can also tell the rope to fasten itself securely to an object or to unfasten itself, to knot or unknot itself, or to coil itself for carrying.',
        NO_COST_NOTE,
      ),
    },
  ],
  [
    'Rope of Entanglement',
    { operations: [op('release-creature', { commandWord: true })] },
  ],
  [
    'Staff of the Python',
    {
      operations: [
        op('become-python', {
          commandWord: true,
          requirement: 'throw the staff on the ground within 10 feet of you',
        }),
      ],
    },
  ],
  [
    'Staff of the Woodlands',
    {
      operations: [
        // The word is required to RETURN the staff, not to plant it.
        op('tree-form', {
          commandWord: null,
          requirement: 'plant one end of the staff in fertile earth',
        }),
        op('return-from-tree', { requirement: 'While touching the tree' }),
      ],
    },
  ],
  [
    'Staff of Thunder and Lightning',
    {
      operations: ['lightning', 'thunder'].map((id) =>
        op(id, { trigger: 'When you hit with a melee attack using the staff' }),
      ),
    },
  ],
  [
    'Talisman of Pure Good',
    {
      operations: [
        op('open-fissure', {
          cost: 'action',
          requirement: 'If you are wearing or holding it',
          target: TALISMAN_TARGET,
        }),
      ],
    },
  ],
  [
    'Talisman of Ultimate Evil',
    {
      operations: [
        op('open-fissure', {
          cost: 'action',
          requirement: 'If you are wearing or holding it',
          target: TALISMAN_TARGET,
        }),
      ],
    },
  ],
  [
    'Wand of Binding',
    {
      operations: [
        op('assisted-escape', {
          requirement: 'While holding the wand',
          trigger:
            'a saving throw you make to avoid being paralyzed or restrained, or you can expend 1 charge and gain advantage on any check you make to escape a grapple',
        }),
      ],
    },
  ],
  [
    'Wand of Enemy Detection',
    {
      operations: [
        op('detect-enemy', {
          cost: 'action',
          commandWord: true,
          requirement: 'While holding it',
        }),
      ],
    },
  ],
  [
    'Wand of Secrets',
    {
      operations: [
        op('detect-secret', {
          cost: 'action',
          requirement: 'While holding it',
        }),
      ],
    },
  ],
  [
    'Wand of Wonder',
    {
      operations: [
        op('produce-random-effect', {
          cost: 'action',
          requirement: 'While holding it',
          target: 'a target within 120 feet of you',
        }),
      ],
    },
  ],
  [
    'Bag of Tricks',
    {
      operations: [
        op('pull-fuzzy-object', {
          cost: 'action',
          requirement:
            'pull the fuzzy object from the bag and throw it up to 20 feet',
        }),
      ],
      clauses: [
        clause(
          'activation-fuzzy-object-creature',
          { block: 'entityGrant' },
          'When the object lands, it transforms into a creature you determine by rolling a d8 and consulting the table that corresponds to the bag’s color.',
        ),
      ],
    },
  ],
  [
    'Deck of Illusions',
    {
      operations: [
        op('draw-and-throw-card', {
          cost: 'action',
          requirement:
            'draw a card at random from the deck and throw it to the ground at a point within 30 feet of you',
        }),
      ],
      clauses: [
        clause(
          'activation-card-illusion',
          { block: 'entityGrant' },
          'An illusion of one or more creatures forms over the thrown card and remains until dispelled.',
        ),
      ],
    },
  ],
  [
    'Horn of Valhalla',
    {
      operations: [op('blow-horn', { cost: 'action' })],
      clauses: [
        clause(
          'activation-valhalla-berserkers',
          { block: 'entityGrant' },
          'In response, warrior spirits from the Valhalla appear within 60 feet of you.',
        ),
      ],
    },
  ],
  [
    'Frost Brand',
    {
      operations: [
        op('extinguish-flames', {
          trigger: 'When you draw this weapon',
          target: 'all nonmagical flames within 30 feet of you',
        }),
      ],
    },
  ],
  [
    'Ring of X-ray Vision',
    {
      operations: [
        op('activate-x-ray-vision', {
          cost: 'action',
          commandWord: true,
          requirement: 'While wearing this ring',
        }),
      ],
    },
  ],
  [
    'Pipes of the Sewers',
    {
      operations: [
        op('call-rat-swarms', {
          cost: 'bonus-action',
          requirement: 'If you play the pipes as an action',
        }),
      ],
      clauses: [
        clause(
          'activation-call-rat-swarms',
          { operation: 'call-rat-swarms' },
          'You must be proficient with wind instruments to use these pipes.',
        ),
      ],
    },
  ],
  [
    'Crystal Ball::Crystal Ball of Telepathy',
    {
      operations: [
        op('cast-suggestion', {
          cost: 'action',
          requirement: 'While scrying with the crystal ball',
        }),
      ],
      clauses: [
        clause(
          'activation-cast-suggestion',
          { operation: 'cast-suggestion' },
          'You can also use an action to cast the suggestion spell (save DC 17) through the sensor on one of those creatures. You don’t need to concentrate on this suggestion to maintain it during its duration, but it ends if scrying ends.',
        ),
      ],
    },
  ],
  [
    'Figurine of Wondrous Power',
    {
      clauses: [
        clause(
          'activation-figurine-creation',
          { block: 'entityGrant' },
          FIGURINE_CREATION,
        ),
        clause(
          'activation-figurine-reversion',
          { block: 'entityGrant' },
          FIGURINE_REVERSION,
        ),
      ],
    },
  ],
  [
    'Orb of Dragonkind',
    {
      clauses: [
        clause(
          'activation-called-evil-dragons',
          { block: 'entityGrant' },
          'While you control the orb, you can use an action to cause the artifact to issue a telepathic call that extends in all directions for 40 miles.',
        ),
      ],
    },
  ],
  [
    'Mirror of Life Trapping',
    {
      containment: [
        {
          procedure: 'release',
          activation: { requirement: 'While within 5 feet of the mirror' },
        },
      ],
    },
  ],
  // --- S3 -----------------------------------------------------------------
  [
    'Apparatus of the Crab',
    {
      // One action moves as many as two levers; a per-lever action cost is not
      // printed.
      operations: APPARATUS_LEVERS.map((id) =>
        op(id, { cost: null, requirement: 'A creature in the compartment' }),
      ),
      clauses: clausesFor(
        'activation',
        APPARATUS_LEVERS,
        'A creature in the compartment can use an action to move as many as two of the apparatus’s levers up or down.',
        'The printed action moves as many as two levers; no per-lever cost is typed, so the DM model interprets the printed sentence.',
      ),
    },
  ],
  [
    'Candle of Invocation',
    {
      operations: [
        op('m9-cast-candle-spell', {
          cost: null,
          requirement:
            'a cleric or druid in the light whose alignment matches the candle’s',
        }),
      ],
      clauses: [
        clause(
          'activation-cast-candle-spell',
          { operation: 'm9-cast-candle-spell' },
          'a cleric or druid in the light whose alignment matches the candle’s can cast',
          'The printed sentence lets the matching cleric or druid cast prepared 1st-level spells without expending spell slots; casting without a slot is not casting without time, so the spell keeps its normal casting time, interpreted by the DM model.',
        ),
      ],
    },
  ],
  [
    'Sword of Sharpness',
    {
      operations: [
        op('shed-light', { cost: null, commandWord: true }),
        op('end-light', { cost: null, commandWord: null }),
      ],
      clauses: [
        clause(
          'activation-shed-light',
          { operation: 'shed-light' },
          'you can speak the sword’s command word to cause the blade to shed bright light',
          NO_COST_NOTE,
        ),
        clause(
          'activation-end-light',
          { operation: 'end-light' },
          'Speaking the command word again or sheathing the sword puts out the light.',
          NO_COST_NOTE,
        ),
      ],
    },
  ],
  [
    'Boots of Speed',
    {
      operations: [
        op('activate-speed', { requirement: 'While you wear these boots' }),
        // Ending the effect restates no bonus action.
        op('deactivate-speed', {
          cost: null,
          trigger: 'If you click your heels together again',
        }),
      ],
      clauses: [
        clause(
          'activation-deactivate-speed',
          { operation: 'deactivate-speed' },
          'If you click your heels together again, you end the effect.',
          NO_COST_NOTE,
        ),
      ],
    },
  ],
  // --- Folded in from eshyra-vcm3 -----------------------------------------
  [
    'Nine Lives Stealer',
    {
      operations: [
        {
          operationId: 'slay-on-critical',
          activation: {
            cost: null,
            trigger:
              'If you score a critical hit against a creature that has fewer than 100 hit points',
          },
          // The sword loses a charge only if the creature is slain; the clause
          // slay-on-critical-charge-loss (effects table) carries that printed
          // outcome, so the unconditional operation cost is removed.
          dropEconomyCost: true,
        },
      ],
      clauses: [
        clause(
          'activation-slay-on-critical',
          { operation: 'slay-on-critical' },
          'If you score a critical hit against a creature that has fewer than 100 hit points, it must succeed on a DC 15 Constitution saving throw or be slain instantly as the sword tears its life force from its body (a construct or an undead is immune).',
          NO_COST_NOTE,
        ),
      ],
    },
  ],
  [
    'Rod of Lordly Might',
    {
      operations: ['drain-life', 'paralyze'].map((id) =>
        op(id, {
          cost: null,
          trigger: 'When you hit a creature with a melee attack using the rod',
        }),
      ),
      clauses: [
        clause(
          'activation-drain-life',
          { operation: 'drain-life' },
          'When you hit a creature with a melee attack using the rod, you can force the target to make a DC 17 Constitution saving throw.',
          NO_COST_NOTE,
        ),
        clause(
          'activation-paralyze',
          { operation: 'paralyze' },
          'When you hit a creature with a melee attack using the rod, you can force the target to make a DC 17 Strength saving throw.',
          NO_COST_NOTE,
        ),
      ],
    },
  ],
  [
    'Hammer of Thunderbolts',
    {
      operations: [
        op('giant-slaying-critical', {
          cost: null,
          trigger:
            'When you roll a 20 on an attack roll made with this weapon against a giant',
        }),
        op('hurl-thunderclap', {
          cost: null,
          requirement: 'While attuned to it',
          target: null,
        }),
      ],
      clauses: [
        clause(
          'activation-giant-slaying-critical',
          { operation: 'giant-slaying-critical' },
          'When you roll a 20 on an attack roll made with this weapon against a giant, the giant must succeed on a DC 17 Constitution saving throw or die.',
          NO_COST_NOTE,
        ),
        clause(
          'activation-hurl-thunderclap',
          { operation: 'hurl-thunderclap' },
          'you can expend 1 charge and make a ranged weapon attack with the hammer, hurling it as if it had the thrown property with a normal range of 20 feet and a long range of 60 feet.',
          NO_COST_NOTE,
        ),
      ],
    },
  ],
]);

/** The child 1 table and the whole-corpus completion table, merged by key. */
function mergeSpecs(
  ...tables: readonly ReadonlyMap<string, FaithfulItemSpec>[]
): ReadonlyMap<string, FaithfulItemSpec> {
  const merged = new Map<string, FaithfulItemSpec>();
  for (const table of tables)
    for (const [key, spec] of table) {
      const existing = merged.get(key);
      merged.set(
        key,
        existing === undefined
          ? spec
          : {
              operations: [
                ...(existing.operations ?? []),
                ...(spec.operations ?? []),
              ],
              containment: [
                ...(existing.containment ?? []),
                ...(spec.containment ?? []),
              ],
              clauses: [...(existing.clauses ?? []), ...(spec.clauses ?? [])],
            },
      );
    }
  return merged;
}

const SPECS: ReadonlyMap<string, FaithfulItemSpec> = mergeSpecs(
  BASE_SPECS,
  CORPUS_SPECS,
);

/** Table keys (item names, or `Item::Variant`), for tests and reports. */
export const MAGIC_ITEM_FAITHFUL_OPERATION_SPECS: ReadonlyMap<
  string,
  FaithfulItemSpec
> = SPECS;

/** Items whose operations were repaired outside this table (producer-level). */
export const MAGIC_ITEM_PRODUCER_FAITHFUL_OPERATION_ITEMS: readonly string[] =
  Object.freeze(['Glamoured Studded Leather']);

function fail(label: string, message: string): never {
  throw new Error(`magic-item faithful operations: ${label} ${message}`);
}

function applyPatch(
  label: string,
  description: string,
  base: MagicItemActivationSpec | undefined,
  patch: ActivationPatch,
): MagicItemActivationSpec | undefined {
  const next: Record<string, unknown> = { ...(base ?? {}) };
  for (const [field, value] of Object.entries(patch)) {
    if (value === null) {
      delete next[field];
      continue;
    }
    if (
      (field === 'requirement' || field === 'trigger' || field === 'target') &&
      (typeof value !== 'string' ||
        value.length === 0 ||
        !description.includes(value))
    )
      fail(
        label,
        `${field} ${JSON.stringify(value)} is not a verbatim span of the printed description`,
      );
    next[field] = value;
  }
  return Object.keys(next).length === 0
    ? undefined
    : (next as unknown as MagicItemActivationSpec);
}

function patchOperation(
  existing: MagicItemOperation,
  patch: OperationPatch,
  label: string,
  description: string,
): MagicItemOperation {
  const { activation: _a, cost: _c, ...rest } = existing;
  const activation =
    patch.activation === undefined
      ? existing.activation
      : applyPatch(label, description, existing.activation, patch.activation);
  const cost = patch.dropEconomyCost === true ? undefined : existing.cost;
  return {
    ...rest,
    ...(activation === undefined ? {} : { activation }),
    ...(cost === undefined ? {} : { cost }),
  } as MagicItemOperation;
}

export function ownerIndex(
  projections: readonly MagicItemFamilyProjection[],
  owner: AdjudicatedOwner,
): number {
  return projections.findIndex((projection) =>
    'operation' in owner
      ? (projection.mechanics.operations ?? []).some(
          (operation) => operation.id === owner.operation,
        )
      : projection.mechanics[owner.block] !== undefined,
  );
}

/** The adjudicated clause carries its owning family's tag so the reviewed
 * per-tag item census is unchanged by this layer. */
export function ownerTag(
  projections: readonly MagicItemFamilyProjection[],
  index: number,
): MagicItemClauseTag {
  const tag =
    projections[index]?.clauses[0]?.tag ??
    projections.find((projection) => projection.clauses.length > 0)?.clauses[0]
      ?.tag;
  return tag ?? 'C1';
}

/** Apply the faithful-or-absent operations table to one scope's un-namespaced
 * family projections. Scopes outside the table are returned unchanged. */
export function applyFaithfulMagicItemOperations(
  item: MagicItemExtraction,
  projections: readonly MagicItemFamilyProjection[],
  variantName?: string,
): readonly MagicItemFamilyProjection[] {
  const key =
    variantName === undefined ? item.name : `${item.name}::${variantName}`;
  const spec = SPECS.get(key);
  if (spec === undefined) return projections;
  const description = item.description;
  let result = [...projections];

  const seenOperations = new Set<string>();
  for (const patch of spec.operations ?? []) {
    const label = `${JSON.stringify(key)} operation ${patch.operationId}`;
    if (seenOperations.has(patch.operationId)) fail(label, 'is patched twice');
    seenOperations.add(patch.operationId);
    let found = false;
    result = result.map((projection) => {
      const operations = projection.mechanics.operations;
      if (
        operations === undefined ||
        !operations.some((candidate) => candidate.id === patch.operationId)
      )
        return projection;
      found = true;
      return {
        ...projection,
        mechanics: {
          ...projection.mechanics,
          operations: operations.map((candidate) =>
            candidate.id === patch.operationId
              ? patchOperation(candidate, patch, label, description)
              : candidate,
          ),
        },
      };
    });
    if (!found) fail(label, 'is not projected by any family');
    const dropsCost =
      patch.activation !== undefined &&
      'cost' in patch.activation &&
      patch.activation.cost === null;
    if (
      (dropsCost || patch.dropEconomyCost === true) &&
      !(spec.clauses ?? []).some(
        (entry) =>
          'operation' in entry.owner &&
          entry.owner.operation === patch.operationId,
      )
    )
      fail(
        label,
        'drops an unprinted cost without an adjudicated clause carrying the printed sentence',
      );
  }

  for (const patch of spec.containment ?? []) {
    const label = `${JSON.stringify(key)} containment ${patch.procedure}`;
    let found = false;
    result = result.map((projection) => {
      const containment = projection.mechanics.containment;
      const procedure = containment?.[patch.procedure];
      if (containment === undefined || procedure === undefined)
        return projection;
      found = true;
      const activation = applyPatch(
        label,
        description,
        procedure.activation,
        patch.activation,
      );
      const { activation: _a, ...rest } = procedure;
      return {
        ...projection,
        mechanics: {
          ...projection.mechanics,
          containment: {
            ...containment,
            [patch.procedure]: {
              ...rest,
              ...(activation === undefined ? {} : { activation }),
            },
          } as MagicItemContainment,
        },
      };
    });
    if (!found) fail(label, 'is not projected by any family');
  }

  const clauseIds = new Set<string>();
  for (const entry of spec.clauses ?? []) {
    const label = `${JSON.stringify(key)} clause ${entry.id}`;
    if (clauseIds.has(entry.id)) fail(label, 'is declared twice');
    clauseIds.add(entry.id);
    if (
      entry.sourceText.length === 0 ||
      !description.includes(entry.sourceText)
    )
      fail(
        label,
        'sourceText is not a verbatim span of the printed description',
      );
    const index = ownerIndex(result, entry.owner);
    if (index < 0) fail(label, 'names an owner no family projects');
    const adjudicated: ItemClauseExpectation = {
      id: entry.id,
      tag: ownerTag(result, index),
      representation: {
        adjudicated: true,
        note: entry.note ?? NOTE,
        sourceText: entry.sourceText,
      },
    };
    result = result.map((projection, at) =>
      at === index
        ? { ...projection, clauses: [...projection.clauses, adjudicated] }
        : projection,
    );
  }
  return result;
}
