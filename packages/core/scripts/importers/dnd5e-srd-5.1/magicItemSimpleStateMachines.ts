/** Source-grounded regular/simple M5 magic-item state machines. */
import type {
  MagicItemOperation,
  MagicItemStateMachine,
} from '../../../src/rules/magicItemMechanics.js';
import type { MagicItemFamilyProjection } from './magicItemCompiler.js';
import type { MagicItemExtraction } from './types.js';

interface SimpleStateSpec {
  readonly sourcePhrases: readonly string[];
  readonly operations: readonly MagicItemOperation[];
  readonly stateMachine: MagicItemStateMachine;
}

const operation = (
  id: string,
  cost: 'action' | 'bonus-action' | 'reaction' | 'free' | 'consume' = 'action',
  extra: Readonly<Record<string, unknown>> = {},
): MagicItemOperation => ({ id, activation: { cost, ...extra } });

const toggle = (
  activateId: string,
  deactivateId: string,
  activeNote: string,
  options: {
    activateCost?: 'action' | 'bonus-action' | 'free';
    deactivateCost?: 'action' | 'bonus-action' | 'free';
    duration?: MagicItemStateMachine['duration'];
    termination?: string;
    commandWord?: boolean;
  } = {},
): Pick<SimpleStateSpec, 'operations' | 'stateMachine'> => ({
  operations: [
    operation(activateId, options.activateCost ?? 'action', {
      ...(options.commandWord === true ? { commandWord: true } : {}),
    }),
    operation(deactivateId, options.deactivateCost ?? 'action', {
      ...(options.commandWord === true ? { commandWord: true } : {}),
    }),
  ],
  stateMachine: {
    initial: 'inactive',
    states: [{ id: 'inactive' }, { id: 'active', note: activeNote }],
    transitions: [
      { from: 'inactive', to: 'active', via: activateId },
      { from: 'active', to: 'inactive', via: deactivateId },
      ...(options.duration === undefined
        ? []
        : [
            {
              from: 'active' as const,
              to: 'inactive' as const,
              timer: options.duration,
            },
          ]),
    ],
    ...(options.duration === undefined ? {} : { duration: options.duration }),
    ...(options.termination === undefined
      ? {}
      : { termination: options.termination }),
  },
});

const SPECS: ReadonlyMap<string, SimpleStateSpec> = new Map([
  [
    'Animated Shield',
    {
      sourcePhrases: [
        'speak its command word as a bonus action to cause it to animate',
        'remains animated for 1 minute',
        'until you are incapacitated or die',
      ],
      ...toggle(
        'speak-command-word',
        'end-animation',
        'shield hovers in wielder space, grants its normal protection, and leaves both hands free',
        {
          activateCost: 'bonus-action',
          deactivateCost: 'bonus-action',
          duration: { amount: 1, unit: 'minute' },
          commandWord: true,
          termination:
            'deactivation, wearer incapacitation, wearer death, or one minute',
        },
      ),
    },
  ],
  [
    'Boots of Speed',
    {
      sourcePhrases: [
        'click the boots’ heels together',
        'click your heels together again, you end the effect',
      ],
      ...toggle(
        'activate-speed',
        'deactivate-speed',
        'walking speed is doubled and opportunity attacks against wearer have disadvantage',
        {
          activateCost: 'bonus-action',
          deactivateCost: 'bonus-action',
          termination:
            'deactivation or exhaustion of the separate ten-minute budget',
        },
      ),
    },
  ],
  [
    'Cloak of Displacement',
    {
      sourcePhrases: [
        'If you take damage, the property ceases to function until the start of your next turn',
        'suppressed while you are incapacitated, restrained, or otherwise unable to move',
      ],
      operations: [
        operation('suppress-displacement', 'free', {
          trigger: 'wearer takes damage or cannot move',
        }),
        operation('restore-displacement', 'free', {
          trigger: 'start of wearer next turn while wearer can move',
        }),
      ],
      stateMachine: {
        initial: 'displacing',
        states: [{ id: 'displacing' }, { id: 'suppressed' }],
        transitions: [
          {
            from: 'displacing',
            to: 'suppressed',
            via: 'suppress-displacement',
          },
          {
            from: 'suppressed',
            to: 'displacing',
            via: 'restore-displacement',
          },
        ],
        termination:
          'damage suppresses until next turn; incapacitated, restrained, or unable-to-move keeps suppression active',
      },
    },
  ],
  [
    'Cloak of Elvenkind',
    {
      sourcePhrases: ['Pulling the hood up or down requires an action'],
      ...toggle(
        'raise-hood',
        'lower-hood',
        'hood grants the cloak’s sight-based concealment benefits',
      ),
    },
  ],
  [
    'Cloak of the Bat',
    {
      sourcePhrases: [
        'cast polymorph on yourself, transforming into a bat',
        'retain your Intelligence, Wisdom, and Charisma scores',
      ],
      ...toggle(
        'cast-polymorph',
        'end-polymorph',
        'wearer is a bat but retains Intelligence, Wisdom, and Charisma',
        { termination: 'deactivation or normal polymorph termination' },
      ),
    },
  ],
  [
    'Dagger of Venom',
    {
      sourcePhrases: [
        'cause thick, black poison to coat the blade',
        'poison remains for 1 minute or until an attack using this weapon hits',
      ],
      operations: [operation('coat-blade')],
      stateMachine: {
        initial: 'uncoated',
        states: [
          { id: 'uncoated' },
          { id: 'coated', note: 'next hit carries the source poison payload' },
        ],
        transitions: [
          { from: 'uncoated', to: 'coated', via: 'coat-blade' },
          {
            from: 'coated',
            to: 'uncoated',
            timer: { amount: 1, unit: 'minute' },
          },
          {
            from: 'coated',
            to: 'uncoated',
            condition: 'an attack using the dagger hits',
          },
        ],
        duration: { amount: 1, unit: 'minute' },
        termination: 'first hit or one minute',
      },
    },
  ],
  [
    'Dancing Sword',
    {
      sourcePhrases: [
        'sword begins to hover, flies up to 30 feet, and attacks one creature',
        'After the hovering sword attacks for the fourth time',
        'flies up to 30 feet and tries to return to your hand',
      ],
      operations: [
        operation('launch-sword', 'bonus-action'),
        operation('command-attack', 'bonus-action'),
        operation('catch-sword', 'free'),
      ],
      stateMachine: {
        initial: 'held',
        states: [
          { id: 'held' },
          { id: 'attack-zero' },
          { id: 'attack-one' },
          { id: 'attack-two' },
          { id: 'attack-three' },
          { id: 'returning' },
          { id: 'grounded' },
        ],
        transitions: [
          { from: 'held', to: 'attack-zero', via: 'launch-sword' },
          { from: 'attack-zero', to: 'attack-one', via: 'command-attack' },
          { from: 'attack-one', to: 'attack-two', via: 'command-attack' },
          { from: 'attack-two', to: 'attack-three', via: 'command-attack' },
          { from: 'attack-three', to: 'returning', via: 'command-attack' },
          { from: 'returning', to: 'held', via: 'catch-sword' },
          {
            from: 'returning',
            to: 'grounded',
            condition: 'owner has no free hand or is more than 30 feet away',
          },
        ],
        termination:
          'caught by owner after fourth attack, or falls at owner feet / nearest space',
      },
    },
  ],
  [
    'Dimensional Shackles',
    {
      sourcePhrases: [
        'place these shackles on an incapacitated creature',
        'creature you designate when you use the shackles',
        'make a DC 30 Strength (Athletics) check',
      ],
      operations: [
        operation('attach-shackles'),
        operation('designated-remove'),
        operation('escape-shackles'),
      ],
      stateMachine: {
        initial: 'unbound',
        states: [
          { id: 'unbound' },
          {
            id: 'bound',
            note: 'incapacitated Small through Large target is dimensionally bound',
          },
          { id: 'broken' },
        ],
        transitions: [
          { from: 'unbound', to: 'bound', via: 'attach-shackles' },
          { from: 'bound', to: 'unbound', via: 'designated-remove' },
          {
            from: 'bound',
            to: 'broken',
            via: 'escape-shackles',
            onFailure: {
              retryAfter: { amount: 30, unit: 'day' },
              scope: 'actor',
              to: 'bound',
              note: 'The same bound creature cannot retry until 30 days pass.',
            },
          },
        ],
        termination:
          'designated removal or successful once-per-30-days escape destroys shackles',
      },
    },
  ],
  [
    'Dust of Dryness',
    {
      sourcePhrases: [
        'turns a cube of water 15 feet on a side into one marble-sized pellet',
        'smash the pellet against a hard surface',
      ],
      operations: [
        operation('sprinkle-dust', 'action', {
          target: 'water or a water-composed elemental',
        }),
        operation('smash-pellet'),
      ],
      stateMachine: {
        initial: 'dust',
        states: [
          { id: 'dust' },
          {
            id: 'pellet',
            note: 'stores one fifteen-foot cube of absorbed water',
          },
          { id: 'released' },
        ],
        transitions: [
          { from: 'dust', to: 'pellet', via: 'sprinkle-dust' },
          { from: 'pellet', to: 'released', via: 'smash-pellet' },
        ],
        termination: 'pellet smashed and absorbed water released',
      },
    },
  ],
  [
    'Dwarven Thrower',
    {
      sourcePhrases: [
        'Immediately after the attack, the weapon flies back to your hand',
      ],
      operations: [
        operation('throw-weapon'),
        operation('return-to-hand', 'free'),
      ],
      stateMachine: {
        initial: 'held',
        states: [{ id: 'held' }, { id: 'in-flight' }],
        transitions: [
          { from: 'held', to: 'in-flight', via: 'throw-weapon' },
          { from: 'in-flight', to: 'held', via: 'return-to-hand' },
        ],
        termination: 'returns immediately after ranged attack',
      },
    },
  ],
  [
    'Flame Tongue',
    {
      sourcePhrases: [
        'speak this magic sword’s command word',
        'speak the command word again',
      ],
      ...toggle(
        'toggle-flames',
        'extinguish-flames',
        'blade is ablaze, emits source light, and carries its fire rider',
        {
          activateCost: 'bonus-action',
          deactivateCost: 'bonus-action',
          commandWord: true,
          termination: 'repeat command word or drop/stow weapon',
        },
      ),
    },
  ],
  [
    'Gem of Brightness',
    {
      sourcePhrases: [
        'first command word causes the gem to shed bright light',
        'use a bonus action to repeat the command word or until you use another function',
      ],
      ...toggle(
        'shed-light',
        'end-light',
        'gem sheds bright light 30 feet and dim light an additional 30 feet',
        {
          deactivateCost: 'bonus-action',
          commandWord: true,
          termination: 'repeat first command word or use another gem function',
        },
      ),
    },
  ],
  [
    'Glamoured Studded Leather',
    {
      sourcePhrases: [
        'speak the armor’s command word',
        'decide what it looks like',
      ],
      ...toggle(
        'set-appearance',
        'restore-appearance',
        'armor displays a wearer-chosen normal clothing or armor appearance',
        { commandWord: true },
      ),
    },
  ],
  [
    'Helm of Brilliance',
    {
      sourcePhrases: [
        'cause one weapon you are holding to burst into flames',
        'use a bonus action to speak the command word again',
      ],
      ...toggle(
        'ignite-weapon',
        'extinguish-weapon',
        'held weapon burns harmlessly, emits source light, and carries fire rider',
        {
          deactivateCost: 'bonus-action',
          commandWord: true,
          termination: 'repeat command word, drop weapon, or stow weapon',
        },
      ),
    },
  ],
  [
    'Immovable Rod',
    {
      sourcePhrases: [
        'press the button, which causes the rod to become magically fixed in place',
        'push the button again',
      ],
      ...toggle(
        'fix-rod',
        'release-rod',
        'rod is fixed in place until overloaded or released',
        {
          termination:
            'button release, more than 8,000 pounds, or successful DC 30 Strength check moves it 10 feet',
        },
      ),
    },
  ],
  [
    'Ioun Stone',
    {
      sourcePhrases: [
        'use an action to toss one of these stones into the air',
        'orbits your head at a distance of 1d3 feet',
        'use an action to seize and stow the stone',
      ],
      operations: [
        operation('start-orbit'),
        operation('seize-and-stow'),
        operation('grab-orbiting-stone'),
      ],
      stateMachine: {
        initial: 'stowed',
        states: [
          { id: 'stowed' },
          {
            id: 'orbiting',
            note: 'benefits apply; AC 24, 10 hit points, resistance to all damage',
          },
          { id: 'seized' },
        ],
        transitions: [
          { from: 'stowed', to: 'orbiting', via: 'start-orbit' },
          { from: 'orbiting', to: 'stowed', via: 'seize-and-stow' },
          {
            from: 'orbiting',
            to: 'seized',
            condition:
              'another creature succeeds on DC 24 Dexterity (Acrobatics) check',
          },
        ],
        termination:
          'owner stows stone, stone is destroyed, or another creature seizes it',
      },
    },
  ],
  [
    'Iron Bands of Binding',
    {
      sourcePhrases: [
        'On a hit, the target is restrained',
        'bonus action to speak the command word again to release it',
        'DC 20 Strength check to break the iron bands',
      ],
      operations: [
        operation('throw-bands'),
        operation('release-bands', 'bonus-action', { commandWord: true }),
        operation('break-bands'),
      ],
      stateMachine: {
        initial: 'sphere',
        states: [{ id: 'sphere' }, { id: 'restraining' }, { id: 'destroyed' }],
        transitions: [
          { from: 'sphere', to: 'restraining', via: 'throw-bands' },
          { from: 'restraining', to: 'sphere', via: 'release-bands' },
          {
            from: 'restraining',
            to: 'destroyed',
            via: 'break-bands',
            onFailure: {
              retryAfter: { amount: 24, unit: 'hour' },
              scope: 'actor',
              to: 'restraining',
              note: 'Only the creature that failed is locked out.',
            },
          },
        ],
        termination:
          'release command or successful break; failed breaker is locked out for 24 hours',
      },
    },
  ],
  [
    'Potion of Diminution',
    {
      sourcePhrases: [
        '“reduce” effect of the enlarge/reduce spell for 1d4 hours',
        'no concentration required',
      ],
      operations: [operation('drink', 'consume', { target: 'self' })],
      stateMachine: {
        initial: 'normal',
        states: [{ id: 'normal' }, { id: 'reduced' }],
        transitions: [
          { from: 'normal', to: 'reduced', via: 'drink' },
          {
            from: 'reduced',
            to: 'normal',
            timer: { amount: '1d4', unit: 'hour' },
          },
        ],
        duration: { amount: '1d4', unit: 'hour' },
        termination: 'rolled duration expires',
      },
    },
  ],
  [
    'Potion of Gaseous Form',
    {
      sourcePhrases: [
        'gain the effect of the gaseous form spell for 1 hour',
        'until you end the effect as a bonus action',
      ],
      operations: [
        operation('drink', 'consume', { target: 'self' }),
        operation('end-gaseous-form', 'bonus-action'),
      ],
      stateMachine: {
        initial: 'normal',
        states: [{ id: 'normal' }, { id: 'gaseous' }],
        transitions: [
          { from: 'normal', to: 'gaseous', via: 'drink' },
          { from: 'gaseous', to: 'normal', via: 'end-gaseous-form' },
          { from: 'gaseous', to: 'normal', timer: { amount: 1, unit: 'hour' } },
        ],
        duration: { amount: 1, unit: 'hour' },
        termination: 'bonus-action end or one hour',
      },
    },
  ],
  [
    'Potion of Growth',
    {
      sourcePhrases: [
        '“enlarge” effect of the enlarge/reduce spell for 1d4 hours',
        'no concentration required',
      ],
      operations: [operation('drink', 'consume', { target: 'self' })],
      stateMachine: {
        initial: 'normal',
        states: [{ id: 'normal' }, { id: 'enlarged' }],
        transitions: [
          { from: 'normal', to: 'enlarged', via: 'drink' },
          {
            from: 'enlarged',
            to: 'normal',
            timer: { amount: '1d4', unit: 'hour' },
          },
        ],
        duration: { amount: '1d4', unit: 'hour' },
        termination: 'rolled duration expires',
      },
    },
  ],
  [
    'Ring of Invisibility',
    {
      sourcePhrases: [
        'turn invisible as an action',
        'use a bonus action to become visible again',
      ],
      ...toggle(
        'become-invisible',
        'become-visible',
        'wearer and worn/carried objects are invisible',
        {
          deactivateCost: 'bonus-action',
          termination:
            'ring removed, wearer attacks or casts a spell, or bonus-action deactivation',
        },
      ),
    },
  ],
  [
    'Ring of Mind Shielding',
    {
      sourcePhrases: [
        'cause the ring to become invisible',
        'another action to make it visible',
      ],
      ...toggle('hide-ring', 'show-ring', 'ring is invisible', {
        termination: 'show action, ring removal, or wearer death',
      }),
    },
  ],
  [
    'Rope of Climbing',
    {
      sourcePhrases: [
        'command the other end to move toward a destination you choose',
        'tell the rope to fasten itself securely',
      ],
      operations: [
        operation('animate-rope'),
        operation('fasten-rope'),
        operation('knot-rope'),
        operation('release-rope'),
      ],
      stateMachine: {
        initial: 'loose',
        states: [
          { id: 'loose' },
          { id: 'moving' },
          { id: 'fastened' },
          { id: 'knotted' },
        ],
        transitions: [
          { from: 'loose', to: 'moving', via: 'animate-rope' },
          { from: 'moving', to: 'fastened', via: 'fasten-rope' },
          { from: 'fastened', to: 'knotted', via: 'knot-rope' },
          { from: 'moving', to: 'loose', via: 'release-rope' },
          { from: 'fastened', to: 'loose', via: 'release-rope' },
          { from: 'knotted', to: 'loose', via: 'release-rope' },
        ],
        termination: 'release command or destruction',
      },
    },
  ],
  [
    'Rope of Entanglement',
    {
      sourcePhrases: [
        'darts forward to entangle a creature',
        'release the creature by using a bonus action',
        'DC 15 Strength or Dexterity check',
      ],
      operations: [
        operation('entangle-creature'),
        operation('release-creature', 'bonus-action'),
        operation('escape-rope'),
      ],
      stateMachine: {
        initial: 'loose',
        states: [{ id: 'loose' }, { id: 'restraining' }, { id: 'destroyed' }],
        transitions: [
          { from: 'loose', to: 'restraining', via: 'entangle-creature' },
          { from: 'restraining', to: 'loose', via: 'release-creature' },
          {
            from: 'restraining',
            to: 'loose',
            condition:
              'restrained target succeeds on DC 15 Strength or Dexterity check',
          },
          {
            from: 'loose',
            to: 'destroyed',
            condition: 'rope reaches 0 hit points',
          },
          {
            from: 'restraining',
            to: 'destroyed',
            condition: 'rope reaches 0 hit points',
          },
        ],
        termination: 'release word, successful escape, or destruction',
      },
    },
  ],
  [
    'Sovereign Glue',
    {
      sourcePhrases: [
        'takes 1 minute to set',
        'bond it creates can be broken only by the application of universal solvent or oil of etherealness, or with a wish spell',
      ],
      operations: [
        operation('apply-glue', 'consume', {
          target: '1-square-foot surface',
        }),
      ],
      stateMachine: {
        initial: 'unset',
        states: [{ id: 'unset' }, { id: 'setting' }, { id: 'bonded' }],
        transitions: [
          { from: 'unset', to: 'setting', via: 'apply-glue' },
          {
            from: 'setting',
            to: 'bonded',
            timer: { amount: 1, unit: 'minute' },
          },
          {
            from: 'bonded',
            to: 'unset',
            condition:
              'universal solvent, oil of etherealness, or wish breaks bond',
          },
        ],
        termination: 'named counter-agent or wish only',
      },
    },
  ],
  [
    'Staff of the Python',
    {
      sourcePhrases: [
        'throw the staff on the ground within 10 feet of you',
        'becomes a giant constrictor snake under your control',
        'using a bonus action to speak the command word again',
      ],
      operations: [
        operation('become-python'),
        operation('return-to-staff', 'bonus-action', { commandWord: true }),
      ],
      stateMachine: {
        initial: 'staff',
        states: [
          { id: 'staff' },
          {
            id: 'python',
            note: 'persistent actor owns live HP and control state',
          },
          { id: 'destroyed' },
        ],
        transitions: [
          { from: 'staff', to: 'python', via: 'become-python' },
          { from: 'python', to: 'staff', via: 'return-to-staff' },
          {
            from: 'python',
            to: 'destroyed',
            condition: 'python is reduced to 0 hit points',
          },
        ],
        termination:
          'owner command returns fully healed staff; 0 HP destroys staff',
      },
    },
  ],
  [
    'Staff of the Woodlands',
    {
      sourcePhrases: [
        'transform the staff into a healthy tree',
        'return the staff to its normal form',
      ],
      ...toggle(
        'tree-form',
        'return-from-tree',
        'staff is a healthy 60-foot tree with source geometry',
        {
          commandWord: true,
          termination: 'touching tree and speaking command word with an action',
        },
      ),
    },
  ],
  [
    'Sun Blade',
    {
      sourcePhrases: [
        'cause a blade of pure radiance to spring into existence',
        'make the blade disappear',
      ],
      ...toggle(
        'manifest-blade',
        'dismiss-blade',
        'radiant blade is manifested',
        { activateCost: 'bonus-action', deactivateCost: 'bonus-action' },
      ),
    },
  ],
  [
    'Sword of Sharpness',
    {
      sourcePhrases: [
        'shed bright light',
        'Speaking the command word again or sheathing the sword puts out the light',
      ],
      ...toggle(
        'shed-light',
        'end-light',
        'sword sheds bright light 10 feet and dim light an additional 10 feet',
        {
          commandWord: true,
          termination: 'repeat command word or sheathe sword',
        },
      ),
    },
  ],
  [
    'Wings of Flying',
    {
      sourcePhrases: [
        'turns the cloak into a pair of bat wings or bird wings',
        'for 1 hour or until you repeat the command word',
      ],
      ...toggle(
        'manifest-wings',
        'dismiss-wings',
        'cloak is transformed into wings',
        {
          duration: { amount: 1, unit: 'hour' },
          commandWord: true,
          termination: 'repeat command word or one hour',
        },
      ),
    },
  ],
]);

export const MAGIC_ITEM_SIMPLE_M5_NAMES = Object.freeze([...SPECS.keys()]);
export const MAGIC_ITEM_SIMPLE_M5_DEFERRED_COMPLEX_NAMES = Object.freeze([
  'Apparatus of the Crab',
  'Bead of Force',
  'Broom of Flying',
  'Carpet of Flying',
  'Chime of Opening',
  'Cube of Force',
  'Decanter of Endless Water',
  'Eversmoking Bottle',
  'Feather Token',
  'Folding Boat',
  'Holy Avenger',
  'Instant Fortress',
  'Marvelous Pigments',
  'Ring of Elemental Command',
  'Ring of Shooting Stars',
  'Robe of Useful Items',
  'Rod of Alertness',
  'Rod of Lordly Might',
  'Sphere of Annihilation',
  'Staff of Swarming Insects',
]);

export function projectMagicItemSimpleStateMachine(
  item: MagicItemExtraction,
): MagicItemFamilyProjection | undefined {
  const spec = SPECS.get(item.name);
  if (spec === undefined) return undefined;
  for (const phrase of spec.sourcePhrases)
    if (!item.description.includes(phrase))
      throw new Error(
        `magic-item M5 simple state projection: expected source phrase ${JSON.stringify(phrase)} not found in ${JSON.stringify(item.name)}`,
      );
  return {
    family: 'm5-simple-state-machines',
    mechanics: { operations: spec.operations, stateMachine: spec.stateMachine },
    clauses: [
      {
        id: `m5-${item.name
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, '-')
          .replace(/^-|-$/g, '')}`,
        tag: 'M5',
        representation: { block: 'stateMachine' },
        engineHooks: [
          { engine: 'F2', hook: 'activation action economy' },
          {
            engine: 'F5',
            hook: 'item state transition and duration processing',
          },
          {
            engine: 'F9',
            hook: 'targeting, escape, and movement consequences',
          },
        ],
      },
    ],
  };
}
