import type { SpellExtraction } from './types.js';

export const S1_SUMMONING_SPELL_KEYS = [
  'spell:animate-dead',
  'spell:animate-objects',
  'spell:conjure-animals',
  'spell:conjure-celestial',
  'spell:conjure-elemental',
  'spell:conjure-fey',
  'spell:conjure-minor-elementals',
  'spell:conjure-woodland-beings',
  'spell:create-undead',
  'spell:find-familiar',
  'spell:find-steed',
  'spell:giant-insect',
  'spell:phantom-steed',
  'spell:simulacrum',
] as const;

export type S1SummoningSpellKey = (typeof S1_SUMMONING_SPELL_KEYS)[number];

export type SummoningProfile =
  | 'control-window-undead'
  | 'animated-object'
  | 'ordinary-summon'
  | 'exceptional-concentration-summon'
  | 'persistent-familiar'
  | 'persistent-steed'
  | 'target-transformation'
  | 'phantom-steed'
  | 'simulacrum';

export interface Cardinality {
  readonly mode: 'exact' | 'maximum';
  readonly count: number;
}

interface CreatureEligibility {
  readonly creatureTypes: readonly string[];
  readonly maxChallenge?: string;
}

interface CandidateOption {
  readonly id: string;
  readonly cardinality: Cardinality;
  readonly eligibility: CreatureEligibility;
}

interface FixedForm {
  readonly name: string;
  readonly creatureRef: `creature:${string}`;
}

interface TransformationOption {
  readonly source: string;
  readonly resultRef: `creature:${string}`;
  readonly cardinality: Cardinality;
}

interface SourceAnimationOutcome {
  readonly source: string;
  readonly resultRef: `creature:${string}`;
}

export type SummoningCreation =
  | {
      readonly kind: 'candidate-menu';
      readonly selection: 'choose-one';
      readonly options: readonly CandidateOption[];
    }
  | {
      readonly kind: 'candidate';
      readonly cardinality: Cardinality;
      readonly eligibility: CreatureEligibility;
      readonly sourceEligibility?: {
        readonly kind: 'area';
        readonly shape: 'cube';
        readonly sizeFeet: number;
        readonly options: readonly string[];
        readonly withinSpellRange: true;
        readonly candidateRelationship: 'appropriate-to-source';
      };
    }
  | {
      readonly kind: 'fixed-form-menu';
      readonly selection: 'choose-one';
      readonly cardinality: Cardinality;
      readonly forms: readonly FixedForm[];
      readonly additionalForms?: 'model-adjudicated';
    }
  | {
      readonly kind: 'source-animation';
      readonly cardinality: Cardinality;
      readonly sourceEligibility: {
        readonly kind: 'remains';
        readonly creatureType: string;
        readonly sizes: readonly string[];
      };
      readonly outcomes: readonly SourceAnimationOutcome[];
      readonly distinctSourcePerActor?: true;
      readonly castingCondition?: 'night-only';
    }
  | {
      readonly kind: 'object-animation';
      readonly capacity: Cardinality;
      readonly eligibility: {
        readonly nonmagical: true;
        readonly notWornOrCarried: true;
        readonly maximumSize: string;
      };
      readonly sizeCosts: Readonly<Record<string, number>>;
    }
  | {
      readonly kind: 'target-transformation-menu';
      readonly selection: 'choose-one';
      readonly options: readonly TransformationOption[];
      readonly additionalTargets?: 'model-adjudicated';
    }
  | {
      readonly kind: 'fixed-stat-block';
      readonly cardinality: Cardinality;
      readonly creatureRef: `creature:${string}`;
      readonly description: string;
      readonly size: string;
    }
  | {
      readonly kind: 'duplicate-target';
      readonly cardinality: Cardinality;
      readonly eligibility: CreatureEligibility;
      readonly targetRange: 'touch';
      readonly rangeContinuity: 'entire-casting-time';
    };

export type TypeTreatment =
  | {
      readonly operation: 'add';
      readonly types: readonly string[];
    }
  | {
      readonly operation: 'replace';
      readonly types: readonly string[];
      readonly selection: 'choose-one';
      readonly whenCandidateType?: string;
    };

export type Placement =
  | {
      readonly kind: 'within-spell-range';
      readonly unoccupied?: true;
      readonly visible?: true;
      readonly onGround?: true;
    }
  | {
      readonly kind: 'relative-to-selected-source';
      readonly withinFeet: number;
      readonly unoccupied: true;
    }
  | { readonly kind: 'target-location' };

export interface CommandProtocol {
  readonly channel: 'mental' | 'verbal' | 'spoken';
  readonly cost?: 'bonus-action' | 'none';
  readonly timing?: 'on-each-caster-turn';
  readonly rangeFeet?: number;
  readonly batching?: {
    readonly scope: 'any-or-all';
    readonly command: 'same';
  };
  readonly generalOrders?: true;
  readonly orderPersistence?: 'until-task-complete';
  readonly fallback?: {
    readonly when: 'no-new-command' | 'no-active-order';
    readonly behavior: 'defend-self-only' | 'defend-otherwise-no-actions';
  };
  readonly alignmentLimited?: true;
}

export interface SummoningControl {
  readonly relationship: string;
  readonly initiative?: 'own-turn' | 'grouped-own-turns' | 'caster-turn';
  readonly command?: CommandProtocol;
  readonly window?: {
    readonly amount: number;
    readonly unit: 'hour';
    readonly anchor: 'control-established';
  };
}

type EffectState = 'active' | 'fading' | 'ended';
type PresenceState = 'present' | 'absent' | 'pocket-dimension';
type LinkState = 'active' | 'none';
type ControlState = 'controlled' | 'uncontrolled';
type AttitudeState = 'friendly' | 'hostile';
type FormState = 'manifested' | 'original';
type IntegrityState = 'intact' | 'destroyed';

export interface StateSelector {
  readonly effect?: EffectState | readonly EffectState[];
  readonly presence?: PresenceState | readonly PresenceState[];
  readonly link?: LinkState | readonly LinkState[];
  readonly control?: ControlState | readonly ControlState[];
  readonly attitude?: AttitudeState | readonly AttitudeState[];
  readonly form?: FormState | readonly FormState[];
  readonly integrity?: IntegrityState | readonly IntegrityState[];
}

export type StateChange =
  | { readonly axis: 'effect'; readonly to: EffectState }
  | { readonly axis: 'presence'; readonly to: PresenceState }
  | { readonly axis: 'link'; readonly to: LinkState }
  | { readonly axis: 'control'; readonly to: ControlState }
  | { readonly axis: 'attitude'; readonly to: AttitudeState }
  | { readonly axis: 'form'; readonly to: FormState }
  | { readonly axis: 'integrity'; readonly to: IntegrityState };

export type TransitionTrigger =
  | 'spell-ended'
  | 'concentration-broken'
  | 'zero-hit-points'
  | 'control-window-expired'
  | 'cast-to-reassert-control'
  | 'absolute-time-reached'
  | 'action-temporary-dismissal'
  | 'action-recall'
  | 'action-permanent-dismissal'
  | 'action-dismissal'
  | 'action-release'
  | 'cast-again'
  | 'damage-taken'
  | 'fade-completed'
  | 'dispelled';

export type TransitionOperation =
  | {
      readonly kind: 'reassert-control';
      readonly actorEligibility: 'created-by-this-spell';
      readonly deadline: 'before-current-control-window-expires';
      readonly cardinality: Cardinality;
      readonly resetsWindow: {
        readonly amount: number;
        readonly unit: 'hour';
        readonly anchor: 'reassertion-completed';
      };
    }
  | { readonly kind: 'carry-remaining-damage-to-original-form' }
  | { readonly kind: 'select-new-form' }
  | {
      readonly kind: 'restore-same-actor';
      readonly hitPoints: 'maximum';
    }
  | {
      readonly kind: 'destroy-active-duplicates';
      readonly ownership: 'created-by-caster-with-this-spell';
    }
  | {
      readonly kind: 'place-in-unoccupied-space';
      readonly withinFeet: number;
    }
  | { readonly kind: 'revert-to-snow-and-melt' };

export interface StateTransition {
  readonly id: string;
  readonly trigger: TransitionTrigger;
  readonly when: StateSelector;
  readonly changes?: readonly StateChange[];
  readonly operation?: TransitionOperation;
  readonly exceptCauses?: readonly 'concentration-broken'[];
  readonly timer?: {
    readonly amount: number;
    readonly unit: 'hour' | 'minute';
    readonly anchor: 'spell-cast' | 'transition-trigger';
  };
  readonly scope?: 'each-target' | 'all-matching-active-duplicates';
  readonly restrictions?: readonly ['caster-cannot-dismiss'];
  readonly reappearancePlacement?: 'creation-placement';
}

export type SummoningIdentity =
  | { readonly kind: 'ordinary' }
  | {
      readonly kind: 'created-actor';
      readonly provenance: 'created-by-this-spell';
    }
  | {
      readonly kind: 'persistent-linked';
      readonly maximumLinked: 1;
    }
  | { readonly kind: 'existing-targets' }
  | { readonly kind: 'duplicate' };

export type SummoningScaling =
  | {
      readonly kind: 'per-slot-cardinality';
      readonly baseSlotLevel: number;
      readonly additional: number;
      readonly appliesTo: readonly ('creation' | 'control-reassertion')[];
    }
  | {
      readonly kind: 'slot-multipliers';
      readonly multipliers: Readonly<Record<string, number>>;
      readonly appliesTo: 'creation-menu-counts';
    }
  | {
      readonly kind: 'challenge-cap-at-slot';
      readonly slotLevel: number;
      readonly maximumChallenge: string;
      readonly appliesTo: 'creation-candidate';
    }
  | {
      readonly kind: 'challenge-cap-per-slot';
      readonly baseSlotLevel: number;
      readonly increase: number;
      readonly appliesTo: 'creation-candidate';
    }
  | {
      readonly kind: 'slot-option-menu';
      readonly appliesTo: readonly ['creation', 'control-reassertion'];
      readonly selection: 'choose-one';
      readonly options: readonly {
        readonly slotLevel: number;
        readonly choices: readonly {
          readonly creatureRef: `creature:${string}`;
          readonly cardinality: Cardinality;
        }[];
      }[];
    };

export type SummoningModification =
  | { readonly kind: 'cannot-attack' }
  | {
      readonly kind: 'ability-floor';
      readonly ability: 'intelligence';
      readonly minimum: number;
      readonly grantsLanguages: number;
      readonly languageEligibility: 'spoken-by-caster';
    }
  | { readonly kind: 'hit-point-maximum'; readonly value: 'half-of-original' }
  | { readonly kind: 'no-equipment' }
  | { readonly kind: 'no-advancement-or-slot-recovery' }
  | {
      readonly kind: 'speed-override';
      readonly mode: 'walk';
      readonly feet: number;
    };

export type SummoningProtocol =
  | { readonly kind: 'telepathy'; readonly rangeFeet: number }
  | {
      readonly kind: 'familiar-sense-sharing';
      readonly cost: 'action';
      readonly requiresWithinFeet: number;
      readonly duration: 'until-start-of-next-turn';
      readonly senses: 'familiar-including-special-senses';
      readonly casterOwnSenses: readonly ['deaf', 'blind'];
    }
  | {
      readonly kind: 'familiar-touch-spell-delivery';
      readonly spellRange: 'touch';
      readonly origin: 'familiar';
      readonly requiresWithinFeet: number;
      readonly familiarCost: 'reaction';
      readonly attackModifier: 'caster';
      readonly timing: 'when-caster-casts';
    }
  | {
      readonly kind: 'mounted-self-spell-sharing';
      readonly requiresMounted: true;
      readonly spellTargets: 'caster-only';
      readonly alsoTargets: 'steed';
    }
  | {
      readonly kind: 'designated-rider';
      readonly eligible: 'caster-or-chosen-creature';
    }
  | {
      readonly kind: 'created-equipment-tether';
      readonly equipment: readonly ['saddle', 'bit', 'bridle'];
      readonly maximumDistanceFeet: number;
      readonly outcome: 'vanishes';
    }
  | {
      readonly kind: 'overland-travel';
      readonly normalMilesPerHour: number;
      readonly fastMilesPerHour: number;
    }
  | {
      readonly kind: 'fade-dismount-window';
      readonly durationMinutes: 1;
      readonly eligible: 'rider';
    }
  | {
      readonly kind: 'simulacrum-repair';
      readonly requires: readonly [
        'alchemical-laboratory',
        'rare-herbs-and-minerals',
      ];
      readonly costGpPerHitPoint: number;
      readonly result: 'regain-hit-points';
    };

export interface AnimatedObjectOverlay {
  readonly creatureType: 'construct';
  readonly tableRef: `table:${string}`;
  readonly abilityScores: {
    readonly constitution: 10;
    readonly intelligence: 3;
    readonly wisdom: 3;
    readonly charisma: 1;
  };
  readonly movement: readonly [
    { readonly when: 'has-locomoting-appendages'; readonly walkFeet: 30 },
    {
      readonly when: 'lacks-locomoting-appendages';
      readonly flyFeet: 30;
      readonly hover: true;
    },
    {
      readonly when: 'securely-attached';
      readonly allSpeedsFeet: 0;
      readonly overridesOtherMovement: true;
    },
  ];
  readonly senses: {
    readonly blindsightFeet: 30;
    readonly blindBeyond: true;
  };
  readonly attack: {
    readonly count: 1;
    readonly kind: 'melee';
    readonly reachFeet: 5;
    readonly attackBonus: 'size-table';
    readonly damage: 'size-table';
    readonly defaultDamageType: 'bludgeoning';
    readonly contextualDamageTypes: readonly ['slashing', 'piercing'];
    readonly contextualClassification: 'model-adjudicated';
  };
}

export interface SummoningStatBlockBasis {
  readonly kind: 'copy-target';
  readonly copied: 'all-statistics';
  readonly interaction: 'normal-creature';
}

interface SourceClause {
  readonly id: string;
  readonly label: string;
  readonly pattern: RegExp;
  readonly field?: 'description-and-higher' | 'duration';
}

interface SourceBound<T> {
  readonly sourceClauseIds: readonly string[];
  readonly payload: T;
}

interface CuratedControl {
  readonly relationship: SourceBound<string>;
  readonly initiative?: SourceBound<SummoningControl['initiative']>;
  readonly command?: SourceBound<CommandProtocol>;
  readonly window?: SourceBound<NonNullable<SummoningControl['window']>>;
}

interface CuratedSummoningEffect {
  readonly profile: SummoningProfile;
  readonly creation: SourceBound<SummoningCreation>;
  readonly typeTreatment?: SourceBound<TypeTreatment>;
  readonly placement?: SourceBound<Placement>;
  readonly control?: CuratedControl;
  readonly identity: SourceBound<SummoningIdentity>;
  readonly initialState: SourceBound<StateSelector>;
  readonly transitions: readonly SourceBound<StateTransition>[];
  readonly causePrecedence?: SourceBound<{
    readonly higher: 'concentration-broken';
    readonly lower: 'spell-ended';
  }>;
  readonly scaling?: readonly SourceBound<SummoningScaling>[];
  readonly modifications?: readonly SourceBound<SummoningModification>[];
  readonly protocols?: readonly SourceBound<SummoningProtocol>[];
  readonly statBlockOverlay?: SourceBound<AnimatedObjectOverlay>;
  readonly statBlockBasis?: SourceBound<SummoningStatBlockBasis>;
  readonly hooks?: readonly ('F2' | 'F3' | 'F9' | 'F10')[];
  readonly contextualRulings?: readonly SourceBound<string>[];
}

export interface S1SummoningSpec {
  readonly spellKey: S1SummoningSpellKey;
  readonly sourcePage: number;
  readonly clauses: readonly SourceClause[];
  readonly effect: CuratedSummoningEffect;
}

const bound = <T>(
  sourceClauseIds: readonly string[],
  payload: T,
): SourceBound<T> => ({ sourceClauseIds, payload });

const cardinality = (
  mode: Cardinality['mode'],
  count: number,
): Cardinality => ({ mode, count });

const ordinaryEndTransitions = (
  clauses: readonly [string, string],
): readonly SourceBound<StateTransition>[] => [
  bound([clauses[0]], {
    id: 'spell-end-removal',
    trigger: 'spell-ended',
    when: { effect: 'active', presence: 'present' },
    changes: [
      { axis: 'effect', to: 'ended' },
      { axis: 'presence', to: 'absent' },
    ],
  }),
  bound([clauses[1]], {
    id: 'zero-hp-removal',
    trigger: 'zero-hit-points',
    when: { effect: 'active', presence: 'present' },
    changes: [
      { axis: 'effect', to: 'ended' },
      { axis: 'presence', to: 'absent' },
    ],
  }),
];

const friendlyCommanded = (
  relationshipClause: string,
  initiativeClause: string,
  commandClause: string,
  initiative: 'own-turn' | 'grouped-own-turns',
  alignmentLimited = false,
): CuratedControl => ({
  relationship: bound([relationshipClause], 'friendly-commanded'),
  initiative: bound([initiativeClause], initiative),
  command: bound([commandClause], {
    channel: 'verbal',
    cost: 'none',
    ...(alignmentLimited ? { alignmentLimited: true as const } : {}),
    fallback: {
      when: 'no-new-command',
      behavior: 'defend-otherwise-no-actions',
    },
  }),
});

const standardPlacement = (clause: string): SourceBound<Placement> =>
  bound([clause], {
    kind: 'within-spell-range',
    unoccupied: true,
    visible: true,
  });

const optionMenu = (creatureType: string): SummoningCreation => ({
  kind: 'candidate-menu',
  selection: 'choose-one',
  options: [
    {
      id: 'one-cr-2',
      cardinality: cardinality('exact', 1),
      eligibility: { creatureTypes: [creatureType], maxChallenge: '2' },
    },
    {
      id: 'two-cr-1',
      cardinality: cardinality('exact', 2),
      eligibility: { creatureTypes: [creatureType], maxChallenge: '1' },
    },
    {
      id: 'four-cr-half',
      cardinality: cardinality('exact', 4),
      eligibility: { creatureTypes: [creatureType], maxChallenge: '1/2' },
    },
    {
      id: 'eight-cr-quarter',
      cardinality: cardinality('exact', 8),
      eligibility: { creatureTypes: [creatureType], maxChallenge: '1/4' },
    },
  ],
});

const undeadCommand = (
  commandClause: string,
  initiativeClause: string,
  fallbackClause: string,
  persistenceClause: string,
  rangeFeet: number,
): CuratedControl => ({
  relationship: bound([commandClause, 'control-window'], 'controlled-obedient'),
  initiative: bound([initiativeClause], 'own-turn'),
  command: bound(
    [
      commandClause,
      'batch',
      'general-order',
      fallbackClause,
      persistenceClause,
    ],
    {
      channel: 'mental',
      cost: 'bonus-action',
      timing: 'on-each-caster-turn',
      rangeFeet,
      batching: { scope: 'any-or-all', command: 'same' },
      generalOrders: true,
      orderPersistence: 'until-task-complete',
      fallback: { when: 'no-active-order', behavior: 'defend-self-only' },
    },
  ),
  window: bound(['control-window'], {
    amount: 24,
    unit: 'hour',
    anchor: 'control-established',
  }),
});

const controlWindowTransitions = (
  maxCreatures: number,
  reassertClause: string,
): readonly SourceBound<StateTransition>[] => [
  bound(['control-window'], {
    id: 'control-expiry',
    trigger: 'control-window-expired',
    when: { control: 'controlled' },
    changes: [{ axis: 'control', to: 'uncontrolled' }],
  }),
  bound(['control-window', reassertClause], {
    id: 'pre-expiry-reassertion',
    trigger: 'cast-to-reassert-control',
    when: { control: 'controlled' },
    operation: {
      kind: 'reassert-control',
      actorEligibility: 'created-by-this-spell',
      deadline: 'before-current-control-window-expires',
      cardinality: cardinality('maximum', maxCreatures),
      resetsWindow: {
        amount: 24,
        unit: 'hour',
        anchor: 'reassertion-completed',
      },
    },
  }),
];

const animateDead: S1SummoningSpec = {
  spellKey: 'spell:animate-dead',
  sourcePage: 115,
  clauses: [
    {
      id: 'target',
      label: 'remains eligibility',
      pattern:
        /Choose a pile of bones or a corpse of a Medium or Small humanoid within range/,
    },
    {
      id: 'outcomes',
      label: 'bones and corpse outcomes',
      pattern:
        /target becomes a skeleton if you chose bones or a zombie if you chose a corpse/,
    },
    {
      id: 'command',
      label: 'mental bonus-action command',
      pattern:
        /on each of your turns, you can use a bonus action to mentally command any creature you made with this spell if the creature is within 60 feet/,
    },
    {
      id: 'batch',
      label: 'same-command batching',
      pattern:
        /command any or all of them at the same time, issuing the same command to each one/,
    },
    {
      id: 'general-order',
      label: 'general command option',
      pattern:
        /issue a general command, such as to guard a particular chamber or corridor/,
    },
    {
      id: 'initiative',
      label: 'next-turn order timing',
      pattern: /where it will move during its next turn/,
    },
    {
      id: 'fallback',
      label: 'no-command defense',
      pattern:
        /If you issue no commands, the creature only defends itself against hostile creatures/,
    },
    {
      id: 'persistence',
      label: 'general order persistence',
      pattern:
        /Once given an order, the creature continues to follow it until its task is complete/,
    },
    {
      id: 'control-window',
      label: 'control window and deadline',
      pattern:
        /under your control for 24 hours[\s\S]*?cast this spell on the creature again before the current 24-hour period ends/,
    },
    {
      id: 'reassert',
      label: 'reassert up to four',
      pattern:
        /reasserts your control over up to four creatures you have animated with this spell/,
    },
    {
      id: 'scaling',
      label: 'create or reassert scaling',
      pattern:
        /animate or reassert control over two additional undead creatures for each slot level above 3rd[\s\S]*?different corpse or pile of bones/,
    },
  ],
  effect: {
    profile: 'control-window-undead',
    creation: bound(['target', 'outcomes', 'scaling'], {
      kind: 'source-animation',
      cardinality: cardinality('exact', 1),
      sourceEligibility: {
        kind: 'remains',
        creatureType: 'humanoid',
        sizes: ['medium', 'small'],
      },
      outcomes: [
        { source: 'pile-of-bones', resultRef: 'creature:skeleton' },
        { source: 'corpse', resultRef: 'creature:zombie' },
      ],
      distinctSourcePerActor: true,
    }),
    placement: bound(['target'], { kind: 'target-location' }),
    control: undeadCommand(
      'command',
      'initiative',
      'fallback',
      'persistence',
      60,
    ),
    identity: bound(['command', 'reassert'], {
      kind: 'created-actor',
      provenance: 'created-by-this-spell',
    }),
    initialState: bound(['control-window'], { control: 'controlled' }),
    transitions: controlWindowTransitions(4, 'reassert'),
    scaling: [
      bound(['scaling'], {
        kind: 'per-slot-cardinality',
        baseSlotLevel: 3,
        additional: 2,
        appliesTo: ['creation', 'control-reassertion'],
      }),
    ],
    hooks: ['F2', 'F3'],
  },
};

const animateObjects: S1SummoningSpec = {
  spellKey: 'spell:animate-objects',
  sourcePage: 116,
  clauses: [
    {
      id: 'targets',
      label: 'object target limits',
      pattern:
        /Choose up to ten nonmagical objects within range that are not being worn or carried/,
    },
    {
      id: 'capacity',
      label: 'size capacity and maximum',
      pattern:
        /Medium targets count as two objects, Large targets count as four objects, Huge targets count as eight objects[\s\S]*?can.t animate any object larger than Huge/,
    },
    {
      id: 'control',
      label: 'object control duration',
      pattern:
        /becomes a creature under your control until the spell ends or until reduced to 0 hit points/,
    },
    {
      id: 'command',
      label: 'mental bonus-action command',
      pattern:
        /As a bonus action, you can mentally command any creature you made with this spell if the creature is within 500 feet/,
    },
    {
      id: 'batch',
      label: 'same-command batching',
      pattern:
        /command any or all of them at the same time, issuing the same command to each one/,
    },
    {
      id: 'general-order',
      label: 'general command option',
      pattern:
        /issue a general command, such as to guard a particular chamber or corridor/,
    },
    {
      id: 'initiative',
      label: 'next-turn order timing',
      pattern: /where it will move during its next turn/,
    },
    {
      id: 'fallback',
      label: 'no-command defense',
      pattern:
        /If you issue no commands, the creature only defends itself against hostile creatures/,
    },
    {
      id: 'persistence',
      label: 'general order persistence',
      pattern:
        /Once given an order, the creature continues to follow it until its task is complete/,
    },
    {
      id: 'overlay',
      label: 'fixed construct overlay',
      pattern:
        /animated object is a construct with AC, hit points, attacks, Strength, and Dexterity determined by its size[\s\S]*?Constitution is 10 and its Intelligence and Wisdom are 3, and its Charisma is 1/,
    },
    {
      id: 'movement',
      label: 'conditional movement',
      pattern:
        /speed is 30 feet[\s\S]*?flying speed of 30 feet and can hover[\s\S]*?securely attached[\s\S]*?speed is 0/,
    },
    {
      id: 'senses',
      label: 'blindsight and blindness',
      pattern:
        /blindsight with a radius of 30 feet and is blind beyond that distance/,
    },
    {
      id: 'zero',
      label: 'zero-hit-point reversion',
      pattern:
        /drops to 0 hit points, it reverts to its original object form, and any remaining damage carries over/,
    },
    {
      id: 'attack',
      label: 'single melee attack procedure',
      pattern:
        /make a single melee attack against a creature within 5 feet[\s\S]*?slam attack with an attack bonus and bludgeoning damage determined by its size[\s\S]*?slashing or piercing damage based on its form/,
    },
    {
      id: 'scaling',
      label: 'additional object scaling',
      pattern: /animate two additional objects for each slot level above 5th/,
    },
  ],
  effect: {
    profile: 'animated-object',
    creation: bound(['targets', 'capacity'], {
      kind: 'object-animation',
      capacity: cardinality('maximum', 10),
      eligibility: {
        nonmagical: true,
        notWornOrCarried: true,
        maximumSize: 'huge',
      },
      sizeCosts: { tiny: 1, small: 1, medium: 2, large: 4, huge: 8 },
    }),
    placement: bound(['targets'], { kind: 'target-location' }),
    control: {
      relationship: bound(['control'], 'controlled-obedient'),
      initiative: bound(['initiative'], 'own-turn'),
      command: bound(
        ['command', 'batch', 'general-order', 'fallback', 'persistence'],
        {
          channel: 'mental',
          cost: 'bonus-action',
          rangeFeet: 500,
          batching: { scope: 'any-or-all', command: 'same' },
          generalOrders: true,
          orderPersistence: 'until-task-complete',
          fallback: { when: 'no-active-order', behavior: 'defend-self-only' },
        },
      ),
    },
    identity: bound(['targets'], { kind: 'existing-targets' }),
    initialState: bound(['control'], { effect: 'active', form: 'manifested' }),
    transitions: [
      bound(['control'], {
        id: 'spell-end-reversion',
        trigger: 'spell-ended',
        when: { effect: 'active', form: 'manifested' },
        changes: [
          { axis: 'effect', to: 'ended' },
          { axis: 'form', to: 'original' },
        ],
      }),
      bound(['zero'], {
        id: 'zero-hp-reversion',
        trigger: 'zero-hit-points',
        when: { effect: 'active', form: 'manifested' },
        changes: [
          { axis: 'effect', to: 'ended' },
          { axis: 'form', to: 'original' },
        ],
        operation: { kind: 'carry-remaining-damage-to-original-form' },
      }),
    ],
    scaling: [
      bound(['scaling'], {
        kind: 'per-slot-cardinality',
        baseSlotLevel: 5,
        additional: 2,
        appliesTo: ['creation'],
      }),
    ],
    statBlockOverlay: bound(['overlay', 'movement', 'senses', 'attack'], {
      creatureType: 'construct',
      tableRef: 'table:animated-object-statistics',
      abilityScores: {
        constitution: 10,
        intelligence: 3,
        wisdom: 3,
        charisma: 1,
      },
      movement: [
        { when: 'has-locomoting-appendages', walkFeet: 30 },
        { when: 'lacks-locomoting-appendages', flyFeet: 30, hover: true },
        {
          when: 'securely-attached',
          allSpeedsFeet: 0,
          overridesOtherMovement: true,
        },
      ],
      senses: { blindsightFeet: 30, blindBeyond: true },
      attack: {
        count: 1,
        kind: 'melee',
        reachFeet: 5,
        attackBonus: 'size-table',
        damage: 'size-table',
        defaultDamageType: 'bludgeoning',
        contextualDamageTypes: ['slashing', 'piercing'],
        contextualClassification: 'model-adjudicated',
      },
    }),
    hooks: ['F2', 'F3', 'F9'],
  },
};

const conjureAnimals: S1SummoningSpec = {
  spellKey: 'spell:conjure-animals',
  sourcePage: 127,
  clauses: [
    {
      id: 'appearance',
      label: 'visible unoccupied placement',
      pattern:
        /take the form of beasts and appear in unoccupied spaces that you can see within range/,
    },
    {
      id: 'menu',
      label: 'exclusive option menu',
      pattern:
        /Choose one of the following options[\s\S]*?One beast of challenge rating 2 or lower[\s\S]*?Two beasts of challenge rating 1 or lower[\s\S]*?Four beasts of challenge rating 1\/2 or lower[\s\S]*?Eight beasts of challenge rating 1\/4 or lower/,
    },
    {
      id: 'type',
      label: 'additional fey type',
      pattern: /Each beast is also considered fey/,
    },
    {
      id: 'removal',
      label: 'zero and spell-end removal',
      pattern:
        /disappears when it drops to 0 hit points or when the spell ends/,
    },
    {
      id: 'friendly',
      label: 'friendly relationship',
      pattern: /friendly to you and your companions/,
    },
    {
      id: 'initiative',
      label: 'group initiative',
      pattern:
        /initiative for the summoned creatures as a group, which has its own turns/,
    },
    {
      id: 'command',
      label: 'verbal no-action command and fallback',
      pattern:
        /obey any verbal commands[\s\S]*?no action required by you[\s\S]*?If you don.t issue any commands[\s\S]*?defend themselves from hostile creatures, but otherwise take no actions/,
    },
    {
      id: 'scaling',
      label: 'slot multipliers',
      pattern:
        /twice as many with a 5th-level slot, three times as many with a 7th-level slot, and four times as many with a 9th-level slot/,
    },
  ],
  effect: {
    profile: 'ordinary-summon',
    creation: bound(['appearance', 'menu'], optionMenu('beast')),
    typeTreatment: bound(['type'], { operation: 'add', types: ['fey'] }),
    placement: standardPlacement('appearance'),
    control: friendlyCommanded(
      'friendly',
      'initiative',
      'command',
      'grouped-own-turns',
    ),
    identity: bound(['appearance'], { kind: 'ordinary' }),
    initialState: bound(['appearance'], {
      effect: 'active',
      presence: 'present',
    }),
    transitions: ordinaryEndTransitions(['removal', 'removal']),
    scaling: [
      bound(['scaling'], {
        kind: 'slot-multipliers',
        multipliers: { 5: 2, 7: 3, 9: 4 },
        appliesTo: 'creation-menu-counts',
      }),
    ],
    hooks: ['F2', 'F3'],
  },
};

const conjureCelestial: S1SummoningSpec = {
  spellKey: 'spell:conjure-celestial',
  sourcePage: 127,
  clauses: [
    {
      id: 'appearance',
      label: 'candidate and placement',
      pattern:
        /summon a celestial of challenge rating 4 or lower, which appears in an unoccupied space that you can see within range/,
    },
    {
      id: 'removal',
      label: 'zero and spell-end removal',
      pattern:
        /disappears when it drops to 0 hit points or when the spell ends/,
    },
    {
      id: 'friendly',
      label: 'friendly relationship',
      pattern: /friendly to you and your companions for the duration/,
    },
    {
      id: 'initiative',
      label: 'own initiative',
      pattern: /Roll initiative for the celestial, which has its own turns/,
    },
    {
      id: 'command',
      label: 'alignment-limited verbal command',
      pattern:
        /obeys any verbal commands[\s\S]*?no action required by you[\s\S]*?don.t violate its alignment[\s\S]*?If you don.t issue any commands[\s\S]*?defends itself[\s\S]*?otherwise takes no actions/,
    },
    {
      id: 'scaling',
      label: 'ninth-level cap',
      pattern:
        /9th-level spell slot[\s\S]*?celestial of challenge rating 5 or lower/,
    },
  ],
  effect: {
    profile: 'ordinary-summon',
    creation: bound(['appearance'], {
      kind: 'candidate',
      cardinality: cardinality('exact', 1),
      eligibility: { creatureTypes: ['celestial'], maxChallenge: '4' },
    }),
    placement: standardPlacement('appearance'),
    control: friendlyCommanded(
      'friendly',
      'initiative',
      'command',
      'own-turn',
      true,
    ),
    identity: bound(['appearance'], { kind: 'ordinary' }),
    initialState: bound(['appearance'], {
      effect: 'active',
      presence: 'present',
    }),
    transitions: ordinaryEndTransitions(['removal', 'removal']),
    scaling: [
      bound(['scaling'], {
        kind: 'challenge-cap-at-slot',
        slotLevel: 9,
        maximumChallenge: '5',
        appliesTo: 'creation-candidate',
      }),
    ],
    hooks: ['F2', 'F3'],
  },
};

const exceptionalConjure = (
  spellKey: 'spell:conjure-elemental' | 'spell:conjure-fey',
  sourcePage: number,
  clauses: readonly SourceClause[],
  creation: SummoningCreation,
  placement: Placement,
  alignmentLimited: boolean,
  scalingBase: number,
  typeTreatment?: TypeTreatment,
): S1SummoningSpec => ({
  spellKey,
  sourcePage,
  clauses,
  effect: {
    profile: 'exceptional-concentration-summon',
    creation: bound(['appearance'], creation),
    ...(typeTreatment === undefined
      ? {}
      : { typeTreatment: bound(['appearance'], typeTreatment) }),
    placement: bound(['appearance'], placement),
    control: friendlyCommanded(
      'friendly',
      'initiative',
      'command',
      'own-turn',
      alignmentLimited,
    ),
    identity: bound(['appearance'], { kind: 'ordinary' }),
    initialState: bound(['appearance', 'friendly', 'command'], {
      effect: 'active',
      presence: 'present',
      control: 'controlled',
      attitude: 'friendly',
    }),
    transitions: [
      bound(['removal', 'break'], {
        id: 'ordinary-spell-end-removal',
        trigger: 'spell-ended',
        when: {
          effect: 'active',
          presence: 'present',
          control: 'controlled',
          attitude: 'friendly',
        },
        changes: [
          { axis: 'effect', to: 'ended' },
          { axis: 'presence', to: 'absent' },
        ],
        exceptCauses: ['concentration-broken'],
      }),
      bound(['removal'], {
        id: 'zero-hp-removal',
        trigger: 'zero-hit-points',
        when: {
          effect: 'active',
          presence: 'present',
          control: ['controlled', 'uncontrolled'],
          attitude: ['friendly', 'hostile'],
        },
        changes: [
          { axis: 'effect', to: 'ended' },
          { axis: 'presence', to: 'absent' },
        ],
      }),
      bound(['break'], {
        id: 'concentration-break-loss-of-control',
        trigger: 'concentration-broken',
        when: {
          effect: 'active',
          presence: 'present',
          control: 'controlled',
          attitude: 'friendly',
        },
        changes: [
          { axis: 'control', to: 'uncontrolled' },
          { axis: 'attitude', to: 'hostile' },
        ],
        restrictions: ['caster-cannot-dismiss'],
      }),
      bound(['break'], {
        id: 'cast-anchored-removal',
        trigger: 'absolute-time-reached',
        when: {
          effect: 'active',
          presence: 'present',
          control: 'uncontrolled',
          attitude: 'hostile',
        },
        changes: [
          { axis: 'effect', to: 'ended' },
          { axis: 'presence', to: 'absent' },
        ],
        timer: { amount: 1, unit: 'hour', anchor: 'spell-cast' },
      }),
    ],
    causePrecedence: bound(['break'], {
      higher: 'concentration-broken',
      lower: 'spell-ended',
    }),
    scaling: [
      bound(['scaling'], {
        kind: 'challenge-cap-per-slot',
        baseSlotLevel: scalingBase,
        increase: 1,
        appliesTo: 'creation-candidate',
      }),
    ],
    contextualRulings: [
      bound(['hostile-actions'], 'hostile-actions-model-adjudicated'),
    ],
    hooks: ['F2', 'F3'],
  },
});

const conjureElemental = exceptionalConjure(
  'spell:conjure-elemental',
  128,
  [
    {
      id: 'appearance',
      label: 'source, candidate, and placement',
      pattern:
        /area of air, earth, fire, or water that fills a 10-foot cube within range[\s\S]*?elemental of challenge rating 5 or lower appropriate to the area[\s\S]*?unoccupied space within 10 feet of it/,
    },
    {
      id: 'removal',
      label: 'zero and spell-end removal',
      pattern:
        /elemental disappears when it drops to 0 hit points or when the spell ends/,
    },
    {
      id: 'friendly',
      label: 'friendly relationship',
      pattern:
        /elemental is friendly to you and your companions for the duration/,
    },
    {
      id: 'initiative',
      label: 'own initiative',
      pattern: /Roll initiative for the elemental, which has its own turns/,
    },
    {
      id: 'command',
      label: 'verbal commands and fallback',
      pattern:
        /obeys any verbal commands[\s\S]*?no action required by you[\s\S]*?If you don.t issue any commands[\s\S]*?defends itself[\s\S]*?otherwise takes no actions/,
    },
    {
      id: 'break',
      label: 'concentration exception and cast-anchored removal',
      pattern:
        /If your concentration is broken, the elemental doesn.t disappear[\s\S]*?lose control[\s\S]*?becomes hostile[\s\S]*?can.t be dismissed[\s\S]*?disappears 1 hour after you summoned it/,
    },
    {
      id: 'hostile-actions',
      label: 'hostile action remains adjudicated',
      pattern:
        /becomes hostile toward you and your companions, and it might attack/,
    },
    {
      id: 'scaling',
      label: 'challenge scaling',
      pattern: /challenge rating increases by 1 for each slot level above 5th/,
    },
  ],
  {
    kind: 'candidate',
    cardinality: cardinality('exact', 1),
    eligibility: { creatureTypes: ['elemental'], maxChallenge: '5' },
    sourceEligibility: {
      kind: 'area',
      shape: 'cube',
      sizeFeet: 10,
      options: ['air', 'earth', 'fire', 'water'],
      withinSpellRange: true,
      candidateRelationship: 'appropriate-to-source',
    },
  },
  { kind: 'relative-to-selected-source', withinFeet: 10, unoccupied: true },
  false,
  5,
);

const conjureFey = exceptionalConjure(
  'spell:conjure-fey',
  128,
  [
    {
      id: 'appearance',
      label: 'exclusive fey or beast-spirit alternatives and placement',
      pattern:
        /summon a fey creature of challenge rating 6 or lower, or a fey spirit that takes the form of a beast of challenge rating 6 or lower[\s\S]*?unoccupied space that you can see within range/,
    },
    {
      id: 'removal',
      label: 'zero and spell-end removal',
      pattern:
        /fey creature disappears when it drops to 0 hit points or when the spell ends/,
    },
    {
      id: 'friendly',
      label: 'friendly relationship',
      pattern:
        /fey creature is friendly to you and your companions for the duration/,
    },
    {
      id: 'initiative',
      label: 'own initiative',
      pattern: /Roll initiative for the creature, which has its own turns/,
    },
    {
      id: 'command',
      label: 'alignment-limited verbal commands',
      pattern:
        /obeys any verbal commands[\s\S]*?no action required by you[\s\S]*?don.t violate its alignment[\s\S]*?If you don.t issue any commands[\s\S]*?defends itself[\s\S]*?otherwise takes no actions/,
    },
    {
      id: 'break',
      label: 'concentration exception and cast-anchored removal',
      pattern:
        /If your concentration is broken, the fey creature doesn.t disappear[\s\S]*?lose control[\s\S]*?becomes hostile[\s\S]*?can.t be dismissed[\s\S]*?disappears 1 hour after you summoned it/,
    },
    {
      id: 'hostile-actions',
      label: 'hostile action remains adjudicated',
      pattern:
        /becomes hostile toward you and your companions, and it might attack/,
    },
    {
      id: 'scaling',
      label: 'challenge scaling',
      pattern: /challenge rating increases by 1 for each slot level above 6th/,
    },
  ],
  {
    kind: 'candidate-menu',
    selection: 'choose-one',
    options: [
      {
        id: 'fey-creature',
        cardinality: cardinality('exact', 1),
        eligibility: { creatureTypes: ['fey'], maxChallenge: '6' },
      },
      {
        id: 'beast-form-fey-spirit',
        cardinality: cardinality('exact', 1),
        eligibility: { creatureTypes: ['beast'], maxChallenge: '6' },
      },
    ],
  },
  { kind: 'within-spell-range', unoccupied: true, visible: true },
  true,
  6,
  {
    operation: 'replace',
    types: ['fey'],
    selection: 'choose-one',
    whenCandidateType: 'beast',
  },
);

const simpleMenuSpec = (
  spellKey: 'spell:conjure-minor-elementals' | 'spell:conjure-woodland-beings',
  sourcePage: number,
  creatureType: string,
  clauses: readonly SourceClause[],
): S1SummoningSpec => ({
  spellKey,
  sourcePage,
  clauses,
  effect: {
    profile: 'ordinary-summon',
    creation: bound(['appearance', 'menu'], optionMenu(creatureType)),
    placement: standardPlacement('appearance'),
    control: friendlyCommanded(
      'friendly',
      'initiative',
      'command',
      'grouped-own-turns',
    ),
    identity: bound(['appearance'], { kind: 'ordinary' }),
    initialState: bound(['appearance'], {
      effect: 'active',
      presence: 'present',
    }),
    transitions: ordinaryEndTransitions(['removal', 'removal']),
    scaling: [
      bound(['scaling'], {
        kind: 'slot-multipliers',
        multipliers: { 6: 2, 8: 3 },
        appliesTo: 'creation-menu-counts',
      }),
    ],
    hooks: ['F2', 'F3'],
  },
});

const conjureMinorElementals = simpleMenuSpec(
  'spell:conjure-minor-elementals',
  128,
  'elemental',
  [
    {
      id: 'appearance',
      label: 'elemental placement',
      pattern:
        /summon elementals that appear in unoccupied spaces that you can see within range/,
    },
    {
      id: 'menu',
      label: 'exclusive option menu',
      pattern:
        /choose one the following options[\s\S]*?One elemental of challenge rating 2 or lower[\s\S]*?Two elementals of challenge rating 1 or lower[\s\S]*?Four elementals of challenge rating 1\/2 or lower[\s\S]*?Eight elementals of challenge rating 1\/4 or lower/,
    },
    {
      id: 'removal',
      label: 'zero and spell-end removal',
      pattern:
        /disappears when it drops to 0 hit points or when the spell ends/,
    },
    {
      id: 'friendly',
      label: 'friendly relationship',
      pattern: /friendly to you and your companions/,
    },
    {
      id: 'initiative',
      label: 'group initiative',
      pattern:
        /initiative for the summoned creatures as a group, which has its own turns/,
    },
    {
      id: 'command',
      label: 'verbal commands and fallback',
      pattern:
        /obey any verbal commands[\s\S]*?no action required by you[\s\S]*?If you don.t issue any commands[\s\S]*?defend themselves[\s\S]*?otherwise take no actions/,
    },
    {
      id: 'scaling',
      label: 'slot multipliers',
      pattern:
        /twice as many with a 6th-level slot and three times as many with an 8th-level slot/,
    },
  ],
);

const conjureWoodlandBeings = simpleMenuSpec(
  'spell:conjure-woodland-beings',
  129,
  'fey',
  [
    {
      id: 'appearance',
      label: 'fey placement',
      pattern:
        /summon fey creatures that appear in unoccupied spaces that you can see within range/,
    },
    {
      id: 'menu',
      label: 'exclusive option menu',
      pattern:
        /Choose one of the following options[\s\S]*?One fey creature of challenge rating 2 or lower[\s\S]*?Two fey creatures of challenge rating 1 or lower[\s\S]*?Four fey creatures of challenge rating 1\/2 or lower[\s\S]*?Eight fey creatures of challenge rating 1\/4 or lower/,
    },
    {
      id: 'removal',
      label: 'zero and spell-end removal',
      pattern:
        /disappears when it drops to 0 hit points or when the spell ends/,
    },
    {
      id: 'friendly',
      label: 'friendly relationship',
      pattern: /friendly to you and your companions/,
    },
    {
      id: 'initiative',
      label: 'group initiative',
      pattern:
        /initiative for the summoned creatures as a group, which have their own turns/,
    },
    {
      id: 'command',
      label: 'verbal commands and fallback',
      pattern:
        /obey any verbal commands[\s\S]*?no action required by you[\s\S]*?If you don.t issue any commands[\s\S]*?defend themselves[\s\S]*?otherwise take no actions/,
    },
    {
      id: 'scaling',
      label: 'slot multipliers',
      pattern:
        /twice as many with a 6th-level slot and three times as many with an 8th-level slot/,
    },
  ],
);

const createUndeadOptions: SummoningScaling = {
  kind: 'slot-option-menu',
  appliesTo: ['creation', 'control-reassertion'],
  selection: 'choose-one',
  options: [
    {
      slotLevel: 7,
      choices: [
        {
          creatureRef: 'creature:ghoul',
          cardinality: cardinality('maximum', 4),
        },
      ],
    },
    {
      slotLevel: 8,
      choices: [
        {
          creatureRef: 'creature:ghoul',
          cardinality: cardinality('maximum', 5),
        },
        {
          creatureRef: 'creature:ghast',
          cardinality: cardinality('maximum', 2),
        },
        {
          creatureRef: 'creature:wight',
          cardinality: cardinality('maximum', 2),
        },
      ],
    },
    {
      slotLevel: 9,
      choices: [
        {
          creatureRef: 'creature:ghoul',
          cardinality: cardinality('maximum', 6),
        },
        {
          creatureRef: 'creature:ghast',
          cardinality: cardinality('maximum', 3),
        },
        {
          creatureRef: 'creature:wight',
          cardinality: cardinality('maximum', 3),
        },
        {
          creatureRef: 'creature:mummy',
          cardinality: cardinality('maximum', 2),
        },
      ],
    },
  ],
};

const createUndead: S1SummoningSpec = {
  spellKey: 'spell:create-undead',
  sourcePage: 132,
  clauses: [
    {
      id: 'night',
      label: 'night casting',
      pattern: /cast this spell only at night/,
    },
    {
      id: 'target',
      label: 'maximum three eligible corpses',
      pattern:
        /Choose up to three corpses of Medium or Small humanoids within range[\s\S]*?Each corpse becomes a ghoul/,
    },
    {
      id: 'command',
      label: 'mental bonus-action command',
      pattern:
        /As a bonus action on each of your turns, you can mentally command any creature you animated with this spell if the creature is within 120 feet/,
    },
    {
      id: 'batch',
      label: 'same-command batching',
      pattern:
        /command any or all of them at the same time, issuing the same command to each one/,
    },
    {
      id: 'general-order',
      label: 'general command option',
      pattern:
        /issue a general command, such as to guard a particular chamber or corridor/,
    },
    {
      id: 'initiative',
      label: 'next-turn order timing',
      pattern: /where it will move during its next turn/,
    },
    {
      id: 'fallback',
      label: 'no-command defense',
      pattern:
        /If you issue no commands, the creature only defends itself against hostile creatures/,
    },
    {
      id: 'persistence',
      label: 'order persistence',
      pattern:
        /Once given an order, the creature continues to follow it until its task is complete/,
    },
    {
      id: 'control-window',
      label: 'control window and deadline',
      pattern:
        /under your control for 24 hours[\s\S]*?cast this spell on the creature before the current 24-hour period ends/,
    },
    {
      id: 'reassert',
      label: 'reassert up to three',
      pattern:
        /reasserts your control over up to three creatures you have animated with this spell/,
    },
    {
      id: 'scaling',
      label: 'higher-slot exclusive maximum menus',
      pattern:
        /7th-level spell slot[\s\S]*?four ghouls[\s\S]*?8th-level spell slot[\s\S]*?five ghouls or two ghasts or wights[\s\S]*?9th-level spell slot[\s\S]*?six ghouls, three ghasts or wights, or two mummies/,
    },
  ],
  effect: {
    profile: 'control-window-undead',
    creation: bound(['night', 'target'], {
      kind: 'source-animation',
      cardinality: cardinality('maximum', 3),
      sourceEligibility: {
        kind: 'remains',
        creatureType: 'humanoid',
        sizes: ['medium', 'small'],
      },
      outcomes: [{ source: 'corpse', resultRef: 'creature:ghoul' }],
      castingCondition: 'night-only',
    }),
    placement: bound(['target'], { kind: 'target-location' }),
    control: undeadCommand(
      'command',
      'initiative',
      'fallback',
      'persistence',
      120,
    ),
    identity: bound(['command', 'reassert'], {
      kind: 'created-actor',
      provenance: 'created-by-this-spell',
    }),
    initialState: bound(['control-window'], { control: 'controlled' }),
    transitions: controlWindowTransitions(3, 'reassert'),
    scaling: [bound(['scaling'], createUndeadOptions)],
    hooks: ['F2', 'F3'],
  },
};

const familiarForms: readonly FixedForm[] = [
  ['bat', 'bat'],
  ['cat', 'cat'],
  ['crab', 'crab'],
  ['frog (toad)', 'frog'],
  ['hawk', 'hawk'],
  ['lizard', 'lizard'],
  ['octopus', 'octopus'],
  ['owl', 'owl'],
  ['poisonous snake', 'poisonous-snake'],
  ['fish (quipper)', 'quipper'],
  ['rat', 'rat'],
  ['raven', 'raven'],
  ['sea horse', 'sea-horse'],
  ['spider', 'spider'],
  ['weasel', 'weasel'],
].map(([name, slug]) => ({ name, creatureRef: `creature:${slug}` as const }));

const findFamiliar: S1SummoningSpec = {
  spellKey: 'spell:find-familiar',
  sourcePage: 143,
  clauses: [
    {
      id: 'forms',
      label: 'fixed familiar forms and statistics',
      pattern:
        /animal form you choose: bat, cat, crab, frog \(toad\), hawk, lizard, octopus, owl, poisonous snake, fish \(quipper\), rat, raven, sea horse, spider, or weasel[\s\S]*?statistics of the chosen form/,
    },
    {
      id: 'placement-type',
      label: 'placement and replacement type',
      pattern:
        /Appearing in an unoccupied space within range[\s\S]*?celestial, fey, or fiend \(your choice\) instead of a beast/,
    },
    {
      id: 'control',
      label: 'independent obedience and initiative',
      pattern:
        /acts independently of you, but it always obeys your commands[\s\S]*?rolls its own initiative and acts on its own turn/,
    },
    {
      id: 'attack',
      label: 'cannot attack',
      pattern: /familiar can.t attack, but it can take other actions as normal/,
    },
    {
      id: 'zero',
      label: 'zero-hit-point absence and recast return',
      pattern:
        /drops to 0 hit points, it disappears, leaving behind no physical form[\s\S]*?reappears after you cast this spell again/,
    },
    {
      id: 'telepathy',
      label: 'telepathy range',
      pattern:
        /familiar is within 100 feet of you, you can communicate with it telepathically/,
    },
    {
      id: 'senses',
      label: 'sense sharing procedure',
      pattern:
        /as an action, you can see through your familiar.s eyes and hear what it hears until the start of your next turn, gaining the benefits of any special senses[\s\S]*?deaf and blind with regard to your own senses/,
    },
    {
      id: 'dismissal',
      label: 'pocket dismissal, recall, and permanent dismissal',
      pattern:
        /As an action, you can temporarily dismiss your familiar[\s\S]*?pocket dimension[\s\S]*?dismiss it forever[\s\S]*?As an action while it is temporarily dismissed[\s\S]*?unoccupied space within 30 feet/,
    },
    {
      id: 'exclusive-reform',
      label: 'exclusive linked familiar and recast form change',
      pattern:
        /can.t have more than one familiar at a time[\s\S]*?cast this spell while you already have a familiar[\s\S]*?adopt a new form/,
    },
    {
      id: 'delivery',
      label: 'touch spell delivery procedure',
      pattern:
        /spell with a range of touch[\s\S]*?deliver the spell as if it had cast[\s\S]*?within 100 feet[\s\S]*?use its reaction[\s\S]*?If the spell requires an attack roll, you use your attack modifier/,
    },
  ],
  effect: {
    profile: 'persistent-familiar',
    creation: bound(['forms'], {
      kind: 'fixed-form-menu',
      selection: 'choose-one',
      cardinality: cardinality('exact', 1),
      forms: familiarForms,
    }),
    typeTreatment: bound(['placement-type'], {
      operation: 'replace',
      types: ['celestial', 'fey', 'fiend'],
      selection: 'choose-one',
    }),
    placement: bound(['placement-type'], {
      kind: 'within-spell-range',
      unoccupied: true,
    }),
    control: {
      relationship: bound(['control'], 'independent-always-obeys'),
      initiative: bound(['control'], 'own-turn'),
    },
    identity: bound(['exclusive-reform'], {
      kind: 'persistent-linked',
      maximumLinked: 1,
    }),
    initialState: bound(['forms', 'placement-type', 'exclusive-reform'], {
      presence: 'present',
      link: 'active',
    }),
    transitions: [
      bound(['zero'], {
        id: 'zero-hp-absence',
        trigger: 'zero-hit-points',
        when: { presence: 'present', link: 'active' },
        changes: [{ axis: 'presence', to: 'absent' }],
      }),
      bound(['dismissal'], {
        id: 'temporary-pocket-dismissal',
        trigger: 'action-temporary-dismissal',
        when: { presence: 'present', link: 'active' },
        changes: [{ axis: 'presence', to: 'pocket-dimension' }],
      }),
      bound(['dismissal'], {
        id: 'pocket-recall',
        trigger: 'action-recall',
        when: { presence: 'pocket-dimension', link: 'active' },
        changes: [{ axis: 'presence', to: 'present' }],
        operation: { kind: 'place-in-unoccupied-space', withinFeet: 30 },
      }),
      bound(['dismissal'], {
        id: 'permanent-dismissal',
        trigger: 'action-permanent-dismissal',
        when: {
          presence: ['present', 'absent', 'pocket-dimension'],
          link: 'active',
        },
        changes: [
          { axis: 'presence', to: 'absent' },
          { axis: 'link', to: 'none' },
        ],
      }),
      bound(['exclusive-reform'], {
        id: 'reform-present-familiar',
        trigger: 'cast-again',
        when: { presence: 'present', link: 'active' },
        operation: { kind: 'select-new-form' },
      }),
      bound(['zero', 'exclusive-reform', 'placement-type'], {
        id: 'restore-and-reform-absent-familiar',
        trigger: 'cast-again',
        when: { presence: 'absent', link: 'active' },
        changes: [{ axis: 'presence', to: 'present' }],
        operation: { kind: 'select-new-form' },
        reappearancePlacement: 'creation-placement',
      }),
      bound(['dismissal', 'exclusive-reform'], {
        id: 'reform-pocketed-familiar',
        trigger: 'cast-again',
        when: { presence: 'pocket-dimension', link: 'active' },
        operation: { kind: 'select-new-form' },
      }),
    ],
    modifications: [bound(['attack'], { kind: 'cannot-attack' })],
    protocols: [
      bound(['telepathy'], { kind: 'telepathy', rangeFeet: 100 }),
      bound(['senses'], {
        kind: 'familiar-sense-sharing',
        cost: 'action',
        requiresWithinFeet: 100,
        duration: 'until-start-of-next-turn',
        senses: 'familiar-including-special-senses',
        casterOwnSenses: ['deaf', 'blind'],
      }),
      bound(['delivery'], {
        kind: 'familiar-touch-spell-delivery',
        spellRange: 'touch',
        origin: 'familiar',
        requiresWithinFeet: 100,
        familiarCost: 'reaction',
        attackModifier: 'caster',
        timing: 'when-caster-casts',
      }),
    ],
    hooks: ['F2'],
  },
};

const steedForms: readonly FixedForm[] = [
  'warhorse',
  'pony',
  'camel',
  'elk',
  'mastiff',
].map((name) => ({ name, creatureRef: `creature:${name}` as const }));

const findSteed: S1SummoningSpec = {
  spellKey: 'spell:find-steed',
  sourcePage: 143,
  clauses: [
    {
      id: 'bond-forms',
      label: 'persistent bond and forms',
      pattern:
        /spirit that assumes the form of an unusually intelligent, strong, and loyal steed, creating a long-lasting bond[\s\S]*?form that you choose: a warhorse, a pony, a camel, an elk, or a mastiff/,
    },
    {
      id: 'other-forms',
      label: 'GM-approved additional steed forms',
      pattern: /GM might allow other animals to be summoned as steeds/,
    },
    {
      id: 'placement-type',
      label: 'placement and replacement type',
      pattern:
        /Appearing in an unoccupied space within range[\s\S]*?celestial, fey, or fiend \(your choice\) instead of its normal type/,
    },
    {
      id: 'int-language',
      label: 'intelligence floor and caster-spoken language',
      pattern:
        /Intelligence of 5 or less, its Intelligence becomes 6[\s\S]*?understand one language of your choice that you speak/,
    },
    {
      id: 'mount',
      label: 'mount relationship',
      pattern: /steed serves you as a mount, both in combat and out/,
    },
    {
      id: 'sharing',
      label: 'mounted self-spell sharing',
      pattern:
        /while mounted on your steed[\s\S]*?spell you cast that targets only you also target your steed/,
    },
    {
      id: 'absence-restore',
      label: 'recoverable absence and same-actor restoration',
      pattern:
        /drops to 0 hit points, it disappears[\s\S]*?dismiss your steed[\s\S]*?In either case, casting this spell again summons the same steed, restored to its hit point maximum/,
    },
    {
      id: 'telepathy',
      label: 'one-mile telepathy',
      pattern:
        /within 1 mile of you, you can communicate with it telepathically/,
    },
    {
      id: 'exclusive-release',
      label: 'exclusive bond and terminal release',
      pattern:
        /can.t have more than one steed bonded by this spell at a time[\s\S]*?release the steed from its bond[\s\S]*?causing it to disappear/,
    },
  ],
  effect: {
    profile: 'persistent-steed',
    creation: bound(['bond-forms', 'other-forms'], {
      kind: 'fixed-form-menu',
      selection: 'choose-one',
      cardinality: cardinality('exact', 1),
      forms: steedForms,
      additionalForms: 'model-adjudicated',
    }),
    typeTreatment: bound(['placement-type'], {
      operation: 'replace',
      types: ['celestial', 'fey', 'fiend'],
      selection: 'choose-one',
    }),
    placement: bound(['placement-type'], {
      kind: 'within-spell-range',
      unoccupied: true,
    }),
    control: { relationship: bound(['bond-forms', 'mount'], 'bonded-mount') },
    identity: bound(['bond-forms', 'exclusive-release'], {
      kind: 'persistent-linked',
      maximumLinked: 1,
    }),
    initialState: bound(['bond-forms'], {
      presence: 'present',
      link: 'active',
    }),
    transitions: [
      bound(['absence-restore'], {
        id: 'zero-hp-absence',
        trigger: 'zero-hit-points',
        when: { presence: 'present', link: 'active' },
        changes: [{ axis: 'presence', to: 'absent' }],
      }),
      bound(['absence-restore'], {
        id: 'action-dismissal',
        trigger: 'action-dismissal',
        when: { presence: 'present', link: 'active' },
        changes: [{ axis: 'presence', to: 'absent' }],
      }),
      bound(['exclusive-release'], {
        id: 'release-bond',
        trigger: 'action-release',
        when: { presence: ['present', 'absent'], link: 'active' },
        changes: [
          { axis: 'presence', to: 'absent' },
          { axis: 'link', to: 'none' },
        ],
      }),
      bound(['absence-restore', 'placement-type'], {
        id: 'restore-same-steed',
        trigger: 'cast-again',
        when: { presence: 'absent', link: 'active' },
        changes: [{ axis: 'presence', to: 'present' }],
        operation: { kind: 'restore-same-actor', hitPoints: 'maximum' },
        reappearancePlacement: 'creation-placement',
      }),
    ],
    modifications: [
      bound(['int-language'], {
        kind: 'ability-floor',
        ability: 'intelligence',
        minimum: 6,
        grantsLanguages: 1,
        languageEligibility: 'spoken-by-caster',
      }),
    ],
    protocols: [
      bound(['telepathy'], { kind: 'telepathy', rangeFeet: 5280 }),
      bound(['sharing'], {
        kind: 'mounted-self-spell-sharing',
        requiresMounted: true,
        spellTargets: 'caster-only',
        alsoTargets: 'steed',
      }),
    ],
    contextualRulings: [
      bound(['other-forms'], 'gm-may-allow-other-steed-forms'),
    ],
    hooks: ['F2'],
  },
};

const giantInsect: S1SummoningSpec = {
  spellKey: 'spell:giant-insect',
  sourcePage: 149,
  clauses: [
    {
      id: 'menu',
      label: 'exclusive maximum target menu and mappings',
      pattern:
        /transform up to ten centipedes, three spiders, five wasps, or one scorpion[\s\S]*?centipede becomes a giant centipede[\s\S]*?spider becomes a giant spider[\s\S]*?wasp becomes a giant wasp[\s\S]*?scorpion becomes a giant scorpion/,
    },
    {
      id: 'control',
      label: 'verbal obedience and caster-turn initiative',
      pattern:
        /obeys your verbal commands, and in combat, they act on your turn each round/,
    },
    {
      id: 'gm-resolution',
      label: 'GM action and movement resolution',
      pattern:
        /GM has the statistics for these creatures and resolves their actions and movement/,
    },
    {
      id: 'end',
      label: 'duration, zero, and per-target dismissal',
      pattern:
        /remains in its giant size for the duration, until it drops to 0 hit points, or until you use an action to dismiss the effect on it/,
    },
    {
      id: 'other-targets',
      label: 'GM alternative targets',
      pattern: /GM might allow you to choose different targets/,
    },
  ],
  effect: {
    profile: 'target-transformation',
    creation: bound(['menu', 'other-targets'], {
      kind: 'target-transformation-menu',
      selection: 'choose-one',
      options: [
        {
          source: 'centipede',
          resultRef: 'creature:giant-centipede',
          cardinality: cardinality('maximum', 10),
        },
        {
          source: 'spider',
          resultRef: 'creature:giant-spider',
          cardinality: cardinality('maximum', 3),
        },
        {
          source: 'wasp',
          resultRef: 'creature:giant-wasp',
          cardinality: cardinality('maximum', 5),
        },
        {
          source: 'scorpion',
          resultRef: 'creature:giant-scorpion',
          cardinality: cardinality('maximum', 1),
        },
      ],
      additionalTargets: 'model-adjudicated',
    }),
    placement: bound(['menu'], { kind: 'target-location' }),
    control: {
      relationship: bound(['control'], 'obeys-verbal-commands'),
      initiative: bound(['control'], 'caster-turn'),
      command: bound(['control'], { channel: 'verbal' }),
    },
    identity: bound(['menu'], { kind: 'existing-targets' }),
    initialState: bound(['menu'], { effect: 'active', form: 'manifested' }),
    transitions: [
      bound(['end'], {
        id: 'spell-end-reversion',
        trigger: 'spell-ended',
        when: { effect: 'active', form: 'manifested' },
        changes: [
          { axis: 'effect', to: 'ended' },
          { axis: 'form', to: 'original' },
        ],
        scope: 'each-target',
      }),
      bound(['end'], {
        id: 'zero-hp-reversion',
        trigger: 'zero-hit-points',
        when: { effect: 'active', form: 'manifested' },
        changes: [
          { axis: 'effect', to: 'ended' },
          { axis: 'form', to: 'original' },
        ],
        scope: 'each-target',
      }),
      bound(['end'], {
        id: 'action-dismissal-reversion',
        trigger: 'action-dismissal',
        when: { effect: 'active', form: 'manifested' },
        changes: [
          { axis: 'effect', to: 'ended' },
          { axis: 'form', to: 'original' },
        ],
        scope: 'each-target',
      }),
    ],
    contextualRulings: [
      bound(['other-targets'], 'gm-may-map-analogous-targets'),
      bound(['gm-resolution'], 'gm-resolves-actions-and-movement'),
    ],
    hooks: ['F2', 'F3'],
  },
};

const phantomSteed: S1SummoningSpec = {
  spellKey: 'spell:phantom-steed',
  sourcePage: 167,
  clauses: [
    {
      id: 'appearance',
      label: 'large horselike ground placement',
      pattern:
        /Large quasi-real, horselike creature appears on the ground in an unoccupied space of your choice within range/,
    },
    {
      id: 'appearance-choice',
      label: 'caster chooses creature appearance',
      pattern: /You decide the creature.s appearance/,
    },
    {
      id: 'equipment',
      label: 'created equipment distance tether',
      pattern:
        /equipped with a saddle, bit, and bridle[\s\S]*?equipment created by the spell vanishes[\s\S]*?more than 10 feet away from the steed/,
    },
    {
      id: 'rider',
      label: 'designated rider',
      pattern: /you or a creature you choose can ride the steed/,
    },
    {
      id: 'stats',
      label: 'riding horse stat block and speed',
      pattern:
        /uses the statistics for a riding horse, except it has a speed of 100 feet/,
    },
    {
      id: 'travel',
      label: 'travel rates',
      pattern: /travel 10 miles in an hour, or 13 miles at a fast pace/,
    },
    {
      id: 'fade',
      label: 'fade duration and end causes',
      pattern:
        /When the spell ends, the steed gradually fades, giving the rider 1 minute to dismount[\s\S]*?ends if you use an action to dismiss it or if the steed takes any damage/,
    },
  ],
  effect: {
    profile: 'phantom-steed',
    creation: bound(['appearance', 'stats'], {
      kind: 'fixed-stat-block',
      cardinality: cardinality('exact', 1),
      creatureRef: 'creature:riding-horse',
      description: 'quasi-real-horselike',
      size: 'large',
    }),
    placement: bound(['appearance'], {
      kind: 'within-spell-range',
      unoccupied: true,
      onGround: true,
    }),
    identity: bound(['appearance'], { kind: 'ordinary' }),
    initialState: bound(['appearance'], {
      effect: 'active',
      presence: 'present',
    }),
    transitions: [
      ...(['spell-ended', 'action-dismissal', 'damage-taken'] as const).map(
        (trigger) =>
          bound<StateTransition>(['fade'], {
            id: `${trigger}-fade`,
            trigger,
            when: { effect: 'active', presence: 'present' },
            changes: [{ axis: 'effect' as const, to: 'fading' as const }],
            timer: {
              amount: 1,
              unit: 'minute' as const,
              anchor: 'transition-trigger' as const,
            },
          }),
      ),
      bound(['fade'], {
        id: 'fade-complete',
        trigger: 'fade-completed',
        when: { effect: 'fading', presence: 'present' },
        changes: [
          { axis: 'effect', to: 'ended' },
          { axis: 'presence', to: 'absent' },
        ],
      }),
    ],
    modifications: [
      bound(['stats'], {
        kind: 'speed-override',
        mode: 'walk',
        feet: 100,
      }),
    ],
    protocols: [
      bound(['equipment'], {
        kind: 'created-equipment-tether',
        equipment: ['saddle', 'bit', 'bridle'],
        maximumDistanceFeet: 10,
        outcome: 'vanishes',
      }),
      bound(['rider'], {
        kind: 'designated-rider',
        eligible: 'caster-or-chosen-creature',
      }),
      bound(['travel'], {
        kind: 'overland-travel',
        normalMilesPerHour: 10,
        fastMilesPerHour: 13,
      }),
      bound(['fade'], {
        kind: 'fade-dismount-window',
        durationMinutes: 1,
        eligible: 'rider',
      }),
    ],
    contextualRulings: [
      bound(['appearance-choice'], 'caster-chooses-appearance'),
    ],
    hooks: ['F2', 'F3'],
  },
};

const simulacrum: S1SummoningSpec = {
  spellKey: 'spell:simulacrum',
  sourcePage: 180,
  clauses: [
    {
      id: 'target',
      label: 'target and full-cast range continuity',
      pattern:
        /duplicate of one beast or humanoid that is within range for the entire casting time of the spell/,
    },
    {
      id: 'duration',
      label: 'until-dispelled duration',
      pattern: /^Until dispelled$/,
      field: 'duration',
    },
    {
      id: 'creature',
      label: 'normal creature interaction',
      pattern:
        /duplicate is a creature[\s\S]*?can take actions and otherwise be affected as a normal creature/,
    },
    {
      id: 'stats',
      label: 'half hit points, no equipment, otherwise copied statistics',
      pattern:
        /half the creature.s hit point maximum and is formed without any equipment[\s\S]*?uses all the statistics of the creature it duplicates/,
    },
    {
      id: 'control',
      label: 'friendly spoken commands and caster turn',
      pattern:
        /friendly to you and creatures you designate[\s\S]*?obeys your spoken commands[\s\S]*?acting on your turn in combat/,
    },
    {
      id: 'advancement',
      label: 'no advancement or slot recovery',
      pattern:
        /lacks the ability to learn or become more powerful[\s\S]*?never increases its level or other abilities[\s\S]*?nor can it regain expended spell slots/,
    },
    {
      id: 'repair',
      label: 'repair prerequisites and cost',
      pattern:
        /repair it in an alchemical laboratory, using rare herbs and minerals worth 100 gp per hit point it regains/,
    },
    {
      id: 'zero',
      label: 'zero-hit-point destruction form',
      pattern:
        /lasts until it drops to 0 hit points, at which point it reverts to snow and melts instantly/,
    },
    {
      id: 'recast',
      label: 'active duplicate cleanup',
      pattern:
        /cast this spell again, any currently active duplicates you created with this spell are instantly destroyed/,
    },
  ],
  effect: {
    profile: 'simulacrum',
    creation: bound(['target'], {
      kind: 'duplicate-target',
      cardinality: cardinality('exact', 1),
      eligibility: { creatureTypes: ['beast', 'humanoid'] },
      targetRange: 'touch',
      rangeContinuity: 'entire-casting-time',
    }),
    control: {
      relationship: bound(
        ['control'],
        'friendly-to-caster-and-designated-obeys-spoken',
      ),
      initiative: bound(['control'], 'caster-turn'),
      command: bound(['control'], { channel: 'spoken' }),
    },
    identity: bound(['creature', 'recast'], { kind: 'duplicate' }),
    initialState: bound(['creature'], {
      effect: 'active',
      integrity: 'intact',
    }),
    transitions: [
      bound(['zero'], {
        id: 'zero-hp-destruction',
        trigger: 'zero-hit-points',
        when: { effect: 'active', integrity: 'intact' },
        changes: [
          { axis: 'effect', to: 'ended' },
          { axis: 'integrity', to: 'destroyed' },
        ],
        operation: { kind: 'revert-to-snow-and-melt' },
      }),
      bound(['recast'], {
        id: 'recast-cleanup',
        trigger: 'cast-again',
        when: { effect: 'active', integrity: 'intact' },
        changes: [
          { axis: 'effect', to: 'ended' },
          { axis: 'integrity', to: 'destroyed' },
        ],
        operation: {
          kind: 'destroy-active-duplicates',
          ownership: 'created-by-caster-with-this-spell',
        },
        scope: 'all-matching-active-duplicates',
      }),
      bound(['duration'], {
        id: 'dispel-end',
        trigger: 'dispelled',
        when: { effect: 'active', integrity: 'intact' },
        changes: [{ axis: 'effect', to: 'ended' }],
      }),
    ],
    modifications: [
      bound(['stats'], {
        kind: 'hit-point-maximum',
        value: 'half-of-original',
      }),
      bound(['stats'], { kind: 'no-equipment' }),
      bound(['advancement'], { kind: 'no-advancement-or-slot-recovery' }),
    ],
    statBlockBasis: bound(['creature', 'stats'], {
      kind: 'copy-target',
      copied: 'all-statistics',
      interaction: 'normal-creature',
    }),
    protocols: [
      bound(['repair'], {
        kind: 'simulacrum-repair',
        requires: ['alchemical-laboratory', 'rare-herbs-and-minerals'],
        costGpPerHitPoint: 100,
        result: 'regain-hit-points',
      }),
    ],
    hooks: ['F3', 'F9', 'F10'],
  },
};

export const S1_SUMMONING_SPECS: Readonly<
  Record<S1SummoningSpellKey, S1SummoningSpec>
> = {
  'spell:animate-dead': animateDead,
  'spell:animate-objects': animateObjects,
  'spell:conjure-animals': conjureAnimals,
  'spell:conjure-celestial': conjureCelestial,
  'spell:conjure-elemental': conjureElemental,
  'spell:conjure-fey': conjureFey,
  'spell:conjure-minor-elementals': conjureMinorElementals,
  'spell:conjure-woodland-beings': conjureWoodlandBeings,
  'spell:create-undead': createUndead,
  'spell:find-familiar': findFamiliar,
  'spell:find-steed': findSteed,
  'spell:giant-insect': giantInsect,
  'spell:phantom-steed': phantomSteed,
  'spell:simulacrum': simulacrum,
};

function spellKey(name: string): string {
  return `spell:${name
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replaceAll('’', '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')}`;
}

function assertSpecGrounding(spec: S1SummoningSpec): void {
  const clauseIds = new Set(spec.clauses.map((clause) => clause.id));
  if (clauseIds.size !== spec.clauses.length) {
    throw new Error(`${spec.spellKey} has duplicate source clause IDs`);
  }
  const visit = (value: unknown, path: string): void => {
    if (typeof value !== 'object' || value === null) return;
    if (Array.isArray(value)) {
      value.forEach((entry, index) => {
        visit(entry, `${path}[${index}]`);
      });
      return;
    }
    const obj = value as Record<string, unknown>;
    if ('sourceClauseIds' in obj || 'payload' in obj) {
      if (
        !Array.isArray(obj.sourceClauseIds) ||
        obj.sourceClauseIds.length === 0 ||
        !('payload' in obj)
      ) {
        throw new Error(
          `${spec.spellKey} ${path} has an invalid source binding`,
        );
      }
      for (const clauseId of obj.sourceClauseIds) {
        if (typeof clauseId !== 'string' || !clauseIds.has(clauseId)) {
          throw new Error(
            `${spec.spellKey} ${path} binds unknown source clause ${String(clauseId)}`,
          );
        }
      }
      visit(obj.payload, `${path}.payload`);
      return;
    }
    for (const [key, entry] of Object.entries(obj))
      visit(entry, `${path}.${key}`);
  };
  visit(spec.effect, 'effect');
}

function materialize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(materialize);
  if (typeof value !== 'object' || value === null) return value;
  const obj = value as Record<string, unknown>;
  if ('sourceClauseIds' in obj && 'payload' in obj)
    return materialize(obj.payload);
  return Object.fromEntries(
    Object.entries(obj).map(([key, entry]) => [key, materialize(entry)]),
  );
}

export function materializeS1SummoningEffect(
  key: S1SummoningSpellKey,
): Record<string, unknown> {
  const spec = S1_SUMMONING_SPECS[key];
  assertSpecGrounding(spec);
  return {
    kind: 'summoning',
    ...(materialize(spec.effect) as Record<string, unknown>),
  };
}

export function projectS1SummoningEffects(
  spell: SpellExtraction,
): readonly Record<string, unknown>[] {
  const key = spellKey(spell.name);
  if (!Object.hasOwn(S1_SUMMONING_SPECS, key)) return [];
  const spec = S1_SUMMONING_SPECS[key as S1SummoningSpellKey];
  assertSpecGrounding(spec);
  if (spell.sourcePage !== spec.sourcePage) {
    throw new Error(
      `S1 spell projection for ${spell.name} moved from reviewed source page ${spec.sourcePage} to ${spell.sourcePage}`,
    );
  }
  const source = `${spell.description} ${spell.higherLevels ?? ''}`;
  for (const clause of spec.clauses) {
    const flags = clause.pattern.flags.includes('i')
      ? clause.pattern.flags
      : `${clause.pattern.flags}i`;
    const clauseSource = clause.field === 'duration' ? spell.duration : source;
    if (!new RegExp(clause.pattern.source, flags).test(clauseSource)) {
      throw new Error(
        `S1 spell projection for ${spell.name} is missing reviewed source clause: ${clause.label} (${clause.id})`,
      );
    }
  }
  return [materializeS1SummoningEffect(spec.spellKey)];
}
