/** Source-grounded complex M5 complement (20 reviewed items). */
import type {
  MagicItemEffect,
  MagicItemOperation,
  MagicItemStateMachine,
} from '../../../src/rules/magicItemMechanics.js';
import type { MagicItemFamilyProjection } from './magicItemCompiler.js';
import type { MagicItemExtraction } from './types.js';

interface ComplexSpec {
  readonly phrases: readonly string[];
  readonly operations: readonly MagicItemOperation[];
  readonly effects?: readonly MagicItemEffect[];
  readonly ambiguities?: MagicItemFamilyProjection['mechanics']['ambiguities'];
  readonly stateMachine: MagicItemStateMachine;
}

const op = (
  id: string,
  cost: 'action' | 'bonus-action' | 'reaction' | 'free' = 'action',
  extra: Readonly<Record<string, unknown>> = {},
): MagicItemOperation => ({ id, activation: { cost, ...extra } });
const state = (id: string, note?: string, effects?: readonly string[]) => ({
  id,
  ...(effects === undefined ? {} : { effects }),
  ...(note === undefined ? {} : { note }),
});
const procedure = (
  id: string,
  trigger: string,
  result: string,
  extra: Readonly<Record<string, unknown>> = {},
): MagicItemEffect => ({
  id,
  kind: 'triggeredEffect',
  trigger,
  result,
  ...extra,
});

const SPECS: ReadonlyMap<string, ComplexSpec> = new Map([
  [
    'Apparatus of the Crab',
    {
      phrases: [
        'Ten levers are set in a row at the far end, each in a neutral position',
        'functions as shown in the Apparatus of the Crab Levers table',
        'hidden catch, which can be found with a successful DC 20 Intelligence (Investigation) check',
        'Below that, the vehicle takes 2d6 bludgeoning damage per minute from pressure',
      ],
      operations: Array.from({ length: 10 }, (_, i) =>
        op(`set-lever-${i + 1}`),
      ),
      effects: [
        procedure(
          'm5-complex-apparatus-controls',
          'a lever changes position',
          'apply the exact vehicle control from the source table',
          {
            tableRef: 'table:apparatus-of-the-crab-levers',
            airSupplyHours: 10,
            depthDamageThresholdFeet: 900,
            depthDamage: {
              dice: '2d6',
              type: 'bludgeoning',
              interval: { amount: 1, unit: 'minute' },
            },
          },
        ),
      ],
      stateMachine: {
        initial: 'sealed',
        states: [
          state(
            'sealed',
            'hatch closed; two occupants; ten-hour shared air supply',
            ['m5-complex-apparatus-controls'],
          ),
          state('open', 'hatch open'),
          state('disabled', 'apparatus reduced to 0 hit points'),
        ],
        transitions: [
          { from: 'sealed', to: 'open', via: 'set-lever-1' },
          { from: 'open', to: 'sealed', via: 'set-lever-1' },
          { from: 'sealed', to: 'sealed', via: 'set-lever-2' },
          { from: 'sealed', to: 'sealed', via: 'set-lever-3' },
          { from: 'sealed', to: 'sealed', via: 'set-lever-4' },
          { from: 'sealed', to: 'sealed', via: 'set-lever-5' },
          { from: 'sealed', to: 'sealed', via: 'set-lever-6' },
          { from: 'sealed', to: 'sealed', via: 'set-lever-7' },
          { from: 'sealed', to: 'sealed', via: 'set-lever-8' },
          { from: 'sealed', to: 'sealed', via: 'set-lever-9' },
          { from: 'sealed', to: 'sealed', via: 'set-lever-10' },
          {
            from: 'sealed',
            to: 'disabled',
            condition: 'apparatus reaches 0 hit points',
          },
          {
            from: 'open',
            to: 'disabled',
            condition: 'apparatus reaches 0 hit points',
          },
        ],
        termination: 'destruction',
      },
    },
  ],
  [
    'Bead of Force',
    {
      phrases: [
        'sphere of transparent force then encloses the area for 1 minute',
        'sphere can be picked up, and its magic causes it to weigh only 1 pound',
      ],
      operations: [
        op('throw-bead', 'action', { target: 'point within 60 feet' }),
        op('move-force-sphere'),
      ],
      stateMachine: {
        initial: 'bead',
        states: [
          state('bead'),
          state(
            'sphere',
            'ten-foot-radius transparent sphere; trapped creatures move with it',
          ),
          state('destroyed'),
        ],
        transitions: [
          { from: 'bead', to: 'sphere', via: 'throw-bead' },
          { from: 'sphere', to: 'sphere', via: 'move-force-sphere' },
          {
            from: 'sphere',
            to: 'destroyed',
            timer: { amount: 1, unit: 'minute' },
          },
        ],
        duration: { amount: 1, unit: 'minute' },
        termination: 'one minute after impact',
      },
    },
  ],
  [
    'Broom of Flying',
    {
      phrases: [
        'stand astride it and speak its command word',
        'send the broom to travel alone to a destination within 1 mile',
      ],
      operations: [
        op('mount-broom'),
        op('dismount-broom'),
        op('send-broom'),
        op('recall-broom'),
      ],
      stateMachine: {
        initial: 'parked',
        states: [state('parked'), state('ridden'), state('remote')],
        transitions: [
          { from: 'parked', to: 'ridden', via: 'mount-broom' },
          { from: 'ridden', to: 'parked', via: 'dismount-broom' },
          { from: 'parked', to: 'remote', via: 'send-broom' },
          {
            from: 'remote',
            to: 'parked',
            condition: 'broom reaches named destination',
          },
          { from: 'remote', to: 'remote', via: 'recall-broom' },
        ],
        termination: 'dismounted or remote route completed',
      },
    },
  ],
  [
    'Carpet of Flying',
    {
      phrases: [
        'speak the carpet’s command word as an action',
        'moves according to your spoken directions',
      ],
      operations: [op('command-flight'), op('end-flight')],
      effects: [
        procedure(
          'm5-complex-carpet-table',
          'carpet begins flight',
          'select speed and capacity from carpet size',
          { tableRef: 'table:carpet-of-flying' },
        ),
      ],
      stateMachine: {
        initial: 'grounded',
        states: [
          state('grounded'),
          state('flying', 'spoken directions control movement', [
            'm5-complex-carpet-table',
          ]),
        ],
        transitions: [
          { from: 'grounded', to: 'flying', via: 'command-flight' },
          { from: 'flying', to: 'grounded', via: 'end-flight' },
        ],
        termination: 'commanded landing',
      },
    },
  ],
  [
    'Chime of Opening',
    {
      phrases: [
        'strike it as an action, pointing it at an object within 120 feet of you that can be opened',
        'one lock or latch on the object opens',
      ],
      operations: [op('strike-chime')],
      stateMachine: {
        initial: 'ready',
        states: [state('ready'), state('resolving')],
        transitions: [
          { from: 'ready', to: 'resolving', via: 'strike-chime' },
          {
            from: 'resolving',
            to: 'ready',
            condition:
              'one audible-path lock or latch within 120 feet opens, or no eligible closure exists',
          },
        ],
        termination:
          'resolution is instantaneous; use economy separately owns ten-use depletion',
      },
    },
  ],
  [
    'Cube of Force',
    {
      phrases: [
        'press one of the cube’s faces',
        'forming a cube 15 feet on a side',
        'lasts for 1 minute, until you use an action to press the cube',
        'expending the requisite number of charges, resetting the duration',
        'cube loses charges when the barrier is targeted by certain spells',
      ],
      operations: [
        ...Array.from({ length: 6 }, (_, i) => op(`press-face-${i + 1}`)),
        op('spell-contact-loss', 'free', {
          trigger: 'listed spell contacts barrier',
        }),
      ],
      effects: [
        procedure(
          'm5-complex-cube-faces',
          'a cube face is pressed',
          'activate the exact barrier exclusion and charge rate',
          { tableRef: 'table:cube-of-force-faces' },
        ),
        procedure(
          'm5-complex-cube-contact',
          'a listed spell contacts the barrier',
          'deduct the source-defined charges',
          { tableRef: 'table:cube-of-force-charges-lost' },
        ),
      ],
      stateMachine: {
        initial: 'inactive',
        states: [
          state('inactive'),
          ...Array.from({ length: 5 }, (_, i) =>
            state(`face-${i + 1}`, `barrier face ${i + 1} active`, [
              'm5-complex-cube-faces',
            ]),
          ),
        ],
        transitions: [
          ...Array.from({ length: 5 }, (_, i) => ({
            from: 'inactive',
            to: `face-${i + 1}`,
            via: `press-face-${i + 1}`,
          })),
          // Source: activating a face creates a barrier that lasts for 1
          // minute. Whether pressing the already-active face restates that
          // duration is unresolved; retain both source interpretations.
          ...Array.from({ length: 5 }, (_, from) =>
            Array.from({ length: 5 }, (_, to) => ({
              from: `face-${from + 1}`,
              to: `face-${to + 1}`,
              via: `press-face-${to + 1}`,
              ...(from === to
                ? {
                    resetsDuration: {
                      kind: 'source-ambiguity' as const,
                      ambiguityId:
                        'ambiguity:cube-of-force-same-face-duration-reset',
                    },
                  }
                : {}),
            })),
          ).flat(),
          ...Array.from({ length: 5 }, (_, i) => ({
            from: `face-${i + 1}`,
            to: `face-${i + 1}`,
            via: 'spell-contact-loss',
            effects: ['m5-complex-cube-contact'],
          })),
          ...Array.from({ length: 5 }, (_, i) => ({
            from: `face-${i + 1}`,
            to: 'inactive',
            via: 'press-face-6',
          })),
          // Source: the barrier "lasts for 1 minute"; pressing another face
          // expends charges "resetting the duration", which re-anchors the
          // timer of the face state that press enters.
          ...Array.from({ length: 5 }, (_, i) => ({
            from: `face-${i + 1}`,
            to: 'inactive',
            timer: { amount: 1, unit: 'minute' } as const,
          })),
        ],
        duration: { amount: 1, unit: 'minute' },
        termination: 'one minute after last face press or depletion',
      },
      ambiguities: [
        {
          id: 'ambiguity:cube-of-force-same-face-duration-reset',
          question:
            "whether pressing the already-active face restates the barrier's one-minute duration",
          source: [
            {
              locator: 'p. 215, barrier duration',
              clauseId: 'barrier-duration',
            },
            {
              locator: 'p. 215, different-face reset',
              clauseId: 'different-face-reset',
            },
          ],
          affects: [
            'face-1 -> face-1 via press-face-1',
            'face-2 -> face-2 via press-face-2',
            'face-3 -> face-3 via press-face-3',
            'face-4 -> face-4 via press-face-4',
            'face-5 -> face-5 via press-face-5',
          ],
          interpretations: [
            {
              id: 'same-face-resets',
              summary:
                'Pressing the already-active face restates the barrier duration.',
            },
            {
              id: 'different-face-only-resets',
              summary:
                'Only pressing a different face resets the barrier duration.',
            },
          ],
          canonicalResolution: null,
          runtimeDisposition: {
            status: 'engine-pending',
            owner: 'campaign-ruling',
          },
        },
      ],
    },
  ],
  [
    'Decanter of Endless Water',
    {
      phrases: [
        'an amount of fresh water or salt water (your choice) pours out of the flask',
        'produces 1 gallon of water',
        'produces 5 gallons of water',
        'produces 30 gallons of water',
      ],
      operations: [
        op('produce-stream'),
        op('produce-fountain'),
        op('produce-geyser'),
        op('stop-water'),
      ],
      stateMachine: {
        initial: 'closed',
        states: [
          state('closed'),
          state('stream', 'one gallon'),
          state('fountain', 'five gallons'),
          state('geyser', 'thirty gallons and source push/attack payload'),
        ],
        transitions: [
          { from: 'closed', to: 'stream', via: 'produce-stream' },
          { from: 'closed', to: 'fountain', via: 'produce-fountain' },
          { from: 'closed', to: 'geyser', via: 'produce-geyser' },
          { from: 'stream', to: 'closed', via: 'stop-water' },
          { from: 'fountain', to: 'closed', via: 'stop-water' },
          { from: 'geyser', to: 'closed', via: 'stop-water' },
        ],
        termination: 'mode output completes or stop command',
      },
    },
  ],
  [
    'Eversmoking Bottle',
    {
      phrases: [
        'cloud of thick smoke pours out in a 60-foot radius',
        'radius increases by 10 feet',
        'maximum radius of 120 feet',
        'Closing the bottle requires you to speak its command word',
      ],
      operations: [op('open-bottle'), op('close-bottle')],
      stateMachine: {
        initial: 'closed',
        states: [
          state('closed'),
          state('cloud-60'),
          state('cloud-growing'),
          state('cloud-120'),
        ],
        transitions: [
          { from: 'closed', to: 'cloud-60', via: 'open-bottle' },
          {
            from: 'cloud-60',
            to: 'cloud-growing',
            timer: { amount: 1, unit: 'minute' },
          },
          {
            from: 'cloud-growing',
            to: 'cloud-120',
            condition:
              'radius reaches 120 feet after adding 10 feet per minute',
          },
          { from: 'cloud-60', to: 'closed', via: 'close-bottle' },
          { from: 'cloud-growing', to: 'closed', via: 'close-bottle' },
          { from: 'cloud-120', to: 'closed', via: 'close-bottle' },
        ],
        termination:
          'stoppered by command or smoke dispersed by source wind tiers',
      },
    },
  ],
  [
    'Feather Token',
    {
      phrases: [
        'Different types of feather tokens exist',
        'Different types of feather tokens exist',
      ],
      operations: [
        op('use-anchor'),
        op('use-bird'),
        op('use-fan'),
        op('use-swan-boat'),
        op('use-tree'),
        op('use-whip'),
      ],
      effects: [
        procedure(
          'm5-complex-feather-selection',
          'token is used',
          'apply selected token lifecycle and geometry',
          { tableRef: 'table:feather-token' },
        ),
      ],
      stateMachine: {
        initial: 'token',
        states: [
          state('token'),
          state(
            'manifested',
            'selected anchor, bird, fan, boat, tree, or whip exists',
            ['m5-complex-feather-selection'],
          ),
          state('consumed'),
        ],
        transitions: [
          ...['anchor', 'bird', 'fan', 'swan-boat', 'tree', 'whip'].map(
            (id) => ({ from: 'token', to: 'manifested', via: `use-${id}` }),
          ),
          {
            from: 'manifested',
            to: 'consumed',
            condition: 'selected token duration or dismissal condition ends',
          },
        ],
        termination: 'single-use manifestation ends',
      },
    },
  ],
  [
    'Folding Boat',
    {
      phrases: [
        'One command word causes the box to unfold into a boat',
        'The second command word causes the box to unfold into a ship',
        'The third command word causes the folding boat to fold back',
      ],
      operations: [op('become-boat'), op('become-ship'), op('fold-boat')],
      stateMachine: {
        initial: 'box',
        states: [
          state('box'),
          state('boat', 'ten-foot rowboat; four creatures'),
          state('ship', 'twenty-four-foot vessel; fifteen creatures'),
        ],
        transitions: [
          { from: 'box', to: 'boat', via: 'become-boat' },
          { from: 'box', to: 'ship', via: 'become-ship' },
          { from: 'boat', to: 'ship', via: 'become-ship' },
          { from: 'ship', to: 'boat', via: 'become-boat' },
          { from: 'boat', to: 'box', via: 'fold-boat' },
          { from: 'ship', to: 'box', via: 'fold-boat' },
        ],
        termination: 'third command word when no creatures remain aboard',
      },
    },
  ],
  [
    'Holy Avenger',
    {
      phrases: [
        'While you hold the drawn sword',
        'creates an aura in a 10-foot radius around you',
      ],
      operations: [op('draw-sword', 'free'), op('sheathe-sword', 'free')],
      stateMachine: {
        initial: 'sheathed',
        states: [
          state('sheathed'),
          state(
            'drawn-aura',
            '10-foot aura; 30 feet for paladin level 17 or higher',
          ),
        ],
        transitions: [
          { from: 'sheathed', to: 'drawn-aura', via: 'draw-sword' },
          { from: 'drawn-aura', to: 'sheathed', via: 'sheathe-sword' },
        ],
        termination: 'sword no longer held drawn',
      },
    },
  ],
  [
    'Instant Fortress',
    {
      phrases: [
        'cube rapidly grows into a fortress',
        'use an action to speak the command word that dismisses it',
      ],
      operations: [op('deploy-fortress'), op('dismiss-fortress')],
      stateMachine: {
        initial: 'cube',
        states: [
          state('cube'),
          state(
            'fortress',
            '20-foot square, 30 feet high, battlements, source door/wall rules',
          ),
          state('destroyed'),
        ],
        transitions: [
          { from: 'cube', to: 'fortress', via: 'deploy-fortress' },
          { from: 'fortress', to: 'cube', via: 'dismiss-fortress' },
          {
            from: 'fortress',
            to: 'destroyed',
            condition: 'walls reduced to 0 hit points',
          },
        ],
        termination:
          'dismissed only while empty; wish repairs but does not resurrect destroyed ownership',
      },
    },
  ],
  [
    'Marvelous Pigments',
    {
      phrases: [
        'create three-dimensional objects by painting them in two dimensions',
        'takes 10 minutes to cover 100 square feet',
        'value greater than 25 gp',
      ],
      operations: [op('paint-object')],
      stateMachine: {
        initial: 'pigment',
        states: [state('pigment'), state('painting'), state('realized')],
        transitions: [
          { from: 'pigment', to: 'painting', via: 'paint-object' },
          {
            from: 'painting',
            to: 'realized',
            condition:
              'ten minutes per 100 square feet completes and value is at most 25 gp',
          },
        ],
        termination:
          'painted energy effects dissipate harmlessly; invalid/high-value depictions remain representations',
      },
    },
  ],
  [
    'Ring of Elemental Command',
    {
      phrases: [
        'If you help slay an air elemental',
        'If you help slay an earth elemental',
        'If you help slay a fire elemental',
        'If you help slay a water elemental',
      ],
      operations: [
        op('unlock-linked-plane', 'free', {
          trigger: 'wearer helps slay elemental from linked plane',
        }),
      ],
      stateMachine: {
        initial: 'base',
        states: [
          state('base', 'base linked-plane properties'),
          state(
            'unlocked',
            'all linked-plane slaying benefits permanently available',
          ),
        ],
        transitions: [
          { from: 'base', to: 'unlocked', via: 'unlock-linked-plane' },
        ],
        termination: 'permanent for this attuned ring/wearer progression',
      },
    },
  ],
  [
    'Ring of Shooting Stars',
    {
      phrases: [
        'create one to four 3-foot-diameter spheres of lightning',
        'spheres last as long as you concentrate',
        'As a bonus action, you can move each sphere',
      ],
      operations: [
        op('create-ball-lightning'),
        op('move-ball-lightning', 'bonus-action'),
        op('discharge-ball-lightning', 'free', {
          trigger: 'creature comes within 5 feet',
        }),
      ],
      stateMachine: {
        initial: 'inactive',
        states: [
          state('inactive'),
          state(
            'active',
            'one to four sphere instances; each individually discharges',
          ),
          state('depleted'),
        ],
        transitions: [
          { from: 'inactive', to: 'active', via: 'create-ball-lightning' },
          { from: 'active', to: 'active', via: 'move-ball-lightning' },
          {
            from: 'active',
            to: 'depleted',
            condition: 'all created spheres have discharged',
          },
          {
            from: 'active',
            to: 'inactive',
            timer: { amount: 1, unit: 'minute' },
          },
          { from: 'depleted', to: 'inactive', condition: 'activation ends' },
        ],
        duration: { amount: 1, unit: 'minute' },
        termination: 'concentration ends, one minute, or all spheres discharge',
      },
    },
  ],
  [
    'Robe of Useful Items',
    {
      phrases: [
        'detach one of the patches',
        'causing it to become the object or creature it represents',
        'Once the last patch is removed',
      ],
      operations: [op('detach-patch')],
      effects: [
        procedure(
          'm5-complex-useful-patch',
          'patch is detached',
          'create represented source-table object or creature',
          { tableRef: 'table:robe-of-useful-items' },
        ),
      ],
      stateMachine: {
        initial: 'patched',
        states: [
          state('patched', 'one or more patches remain', [
            'm5-complex-useful-patch',
          ]),
          state('ordinary'),
        ],
        transitions: [
          { from: 'patched', to: 'patched', via: 'detach-patch' },
          {
            from: 'patched',
            to: 'ordinary',
            condition: 'last patch is removed',
          },
        ],
        termination: 'ordinary garment after last patch',
      },
    },
  ],
  [
    'Rod of Alertness',
    {
      phrases: [
        'plant the haft end of the rod in the ground',
        'effect ends after 10 minutes',
        'creature uses an action to pull the rod from the ground',
      ],
      operations: [op('activate-aura'), op('pull-rod')],
      stateMachine: {
        initial: 'held',
        states: [
          state('held'),
          state(
            'planted-aura',
            'source 60-foot bright/dim aura and friendly benefits',
          ),
        ],
        transitions: [
          { from: 'held', to: 'planted-aura', via: 'activate-aura' },
          { from: 'planted-aura', to: 'held', via: 'pull-rod' },
          {
            from: 'planted-aura',
            to: 'held',
            timer: { amount: 10, unit: 'minute' },
          },
        ],
        duration: { amount: 10, unit: 'minute' },
        termination: 'ten minutes or rod pulled',
      },
    },
  ],
  [
    'Rod of Lordly Might',
    {
      phrases: [
        'properties associated with six different buttons',
        'press one of the rod’s six buttons as a bonus action',
      ],
      operations: Array.from({ length: 6 }, (_, i) =>
        op(`press-button-${i + 1}`, 'bonus-action'),
      ),
      stateMachine: {
        initial: 'mace',
        states: [
          state('mace'),
          state('flame-tongue'),
          state('battleaxe'),
          state('spear'),
          state('climbing-pole'),
          state('battering-ram'),
        ],
        transitions: [
          ...Array.from({ length: 6 }, (_, i) => ({
            from: 'mace',
            to: [
              'flame-tongue',
              'battleaxe',
              'spear',
              'climbing-pole',
              'battering-ram',
              'mace',
            ][i],
            via: `press-button-${i + 1}`,
          })),
          ...[
            'flame-tongue',
            'battleaxe',
            'spear',
            'climbing-pole',
            'battering-ram',
          ].flatMap((from, fromIndex) =>
            Array.from({ length: 6 }, (_, i) => ({
              from,
              to:
                i === fromIndex
                  ? 'mace'
                  : [
                      'flame-tongue',
                      'battleaxe',
                      'spear',
                      'climbing-pole',
                      'battering-ram',
                      'mace',
                    ][i],
              via: `press-button-${i + 1}`,
            })),
          ),
        ],
        termination:
          'same button or button 6 restores mace form; pole overload/lack of anchor also restores',
      },
    },
  ],
  [
    'Sphere of Annihilation',
    {
      phrases: [
        'sphere is stationary until someone controls it',
        'make a DC 25 Intelligence (Arcana) check',
        'check contested by the other creature’s Intelligence (Arcana) check',
      ],
      operations: [
        {
          ...op('attempt-control'),
          effects: ['m5-complex-sphere-failed-control'],
        },
        op('contest-control'),
        op('move-sphere'),
      ],
      effects: [
        procedure(
          'm5-complex-sphere-failed-control',
          'the DC 25 Intelligence (Arcana) check fails',
          'the sphere moves 10 feet toward the actor who attempted control',
        ),
      ],
      stateMachine: {
        initial: 'uncontrolled',
        states: [
          state('uncontrolled'),
          state(
            'controlled',
            'controller may levitate 5 × Intelligence modifier feet, minimum 5',
          ),
          state('contested'),
        ],
        transitions: [
          {
            from: 'uncontrolled',
            to: 'controlled',
            via: 'attempt-control',
          },
          { from: 'controlled', to: 'contested', via: 'contest-control' },
          {
            from: 'contested',
            to: 'controlled',
            condition:
              'winner of contested Intelligence (Arcana) check becomes controller',
          },
          { from: 'controlled', to: 'controlled', via: 'move-sphere' },
        ],
        termination:
          'control changes by contest; portal contact is owned by M8/M11',
      },
    },
  ],
  [
    'Staff of Swarming Insects',
    {
      phrases: [
        'cause a swarm of harmless flying insects to spread out in a 30-foot radius',
        'insects remain for 10 minutes',
      ],
      operations: [op('create-insect-cloud'), op('dismiss-insect-cloud')],
      stateMachine: {
        initial: 'clear',
        states: [
          state('clear'),
          state(
            'cloud',
            '30-foot heavily obscured cloud except 10-foot clear radius around user',
          ),
        ],
        transitions: [
          { from: 'clear', to: 'cloud', via: 'create-insect-cloud' },
          { from: 'cloud', to: 'clear', via: 'dismiss-insect-cloud' },
          { from: 'cloud', to: 'clear', timer: { amount: 10, unit: 'minute' } },
        ],
        duration: { amount: 10, unit: 'minute' },
        termination: 'dismissal, user moves more than 20 feet, or ten minutes',
      },
    },
  ],
]);

export const MAGIC_ITEM_COMPLEX_M5_NAMES = Object.freeze([...SPECS.keys()]);
export const MAGIC_ITEM_COMPLEX_M5_REFERENCES = Object.freeze(
  [...SPECS.values()].flatMap((spec) =>
    (spec.effects ?? []).flatMap((effect) =>
      [effect.tableRef].filter(
        (value): value is string => typeof value === 'string',
      ),
    ),
  ),
);

export function projectMagicItemComplexStateMachine(
  item: MagicItemExtraction,
): MagicItemFamilyProjection | undefined {
  const spec = SPECS.get(item.name);
  if (spec === undefined) return undefined;
  for (const phrase of spec.phrases)
    if (!item.description.includes(phrase))
      throw new Error(
        `magic-item M5 complex state projection: expected source phrase ${JSON.stringify(phrase)} not found in ${JSON.stringify(item.name)}`,
      );
  return {
    family: 'm5-complex-state-machines',
    mechanics: {
      operations: spec.operations,
      ...(spec.effects === undefined ? {} : { effects: spec.effects }),
      ...(spec.ambiguities === undefined
        ? {}
        : { ambiguities: spec.ambiguities }),
      stateMachine: spec.stateMachine,
    },
    clauses: [
      {
        id: `m5-complex-${item.name
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, '-')
          .replace(/^-|-$/g, '')}`,
        tag: 'M5',
        representation: { block: 'stateMachine' },
        engineHooks: [
          { engine: 'F2', hook: 'activation action economy' },
          { engine: 'F5', hook: 'complex item state and duration processing' },
          {
            engine: 'F9',
            hook: 'geometry, targeting, movement, and contest resolution',
          },
        ],
      },
      ...(item.name === 'Apparatus of the Crab'
        ? [
            {
              id: 'm5-complex-apparatus-hidden-catch',
              tag: 'M5' as const,
              representation: {
                adjudicated: true as const,
                note: 'The source-stated DC 20 Intelligence (Investigation) hidden-catch discovery procedure is accepted as prose-only: it is a one-time exploration adjudication with no persistent item state or deterministic engine hook beyond the source text.',
              },
            },
          ]
        : []),
    ],
  };
}
