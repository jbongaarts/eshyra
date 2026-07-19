import { RulesPackError } from './types.js';

type Obj = Record<string, unknown>;

export type MagicItemEconomyKind =
  | 'charges'
  | 'per-day'
  | 'cooldown'
  | 'budget'
  | 'doses'
  | 'single-use'
  | 'at-will';

export type MagicItemDurationUnit = 'round' | 'minute' | 'hour' | 'day';

export interface MagicItemDurationSpec {
  /** Fixed duration or source-faithful dice expression resolved by seeded RNG. */
  readonly amount: number | string;
  readonly unit: MagicItemDurationUnit;
}

export interface MagicItemActivationSpec {
  readonly cost: 'action' | 'bonus-action' | 'reaction' | 'free' | 'consume';
  readonly commandWord?: boolean;
  readonly trigger?: string;
  readonly requirement?: string;
  readonly target?: string;
  readonly note?: string;
}

export interface MagicItemEconomy {
  readonly kind: MagicItemEconomyKind;
  readonly charges?: { readonly max: number | string };
  readonly perDay?: { readonly uses: number };
  readonly cooldown?: { readonly duration: MagicItemDurationSpec };
  readonly budget?: {
    readonly total: MagicItemDurationSpec;
    readonly increment: MagicItemDurationSpec;
  };
  readonly doses?: { readonly count: number | string };
  readonly reset?: readonly {
    readonly at:
      | 'dawn'
      | 'dusk'
      | 'short-rest'
      | 'long-rest'
      | 'hour'
      | 'days'
      | 'per-period';
    readonly amount?: number | string | 'all' | MagicItemDurationSpec;
    readonly days?: number;
    readonly period?: MagicItemDurationSpec;
    readonly onlyIfUnused?: boolean;
  }[];
  readonly onDepleted?: {
    readonly roll?: string;
    readonly destroyedOn?: number;
    readonly regainOn?: number;
    readonly regainAmount?: number | string;
    readonly loseProperty?: boolean;
    readonly losePropertyOn?: number;
    readonly becomes?:
      | 'destroyed'
      | 'nonmagical'
      | 'inert'
      | { readonly itemRef: string };
  };
  readonly note?: string;
}

export interface MagicItemOperation {
  readonly id: string;
  readonly activation?: MagicItemActivationSpec;
  readonly cost?: readonly {
    readonly economy: string;
    readonly amount: number | string | 'variable';
  }[];
  readonly excludes?: readonly string[];
  readonly doesNotExpend?: readonly string[];
  readonly effects?: readonly string[];
  readonly note?: string;
}

export interface MagicItemEffect extends Readonly<Record<string, unknown>> {
  readonly kind: string;
  readonly id?: string;
}

export interface MagicItemStateMachine {
  readonly initial: string;
  readonly states: readonly {
    readonly id: string;
    readonly effects?: readonly string[];
    readonly note?: string;
  }[];
  readonly transitions: readonly {
    readonly from: string;
    readonly to: string;
    readonly via?: string;
    readonly timer?: MagicItemDurationSpec;
    readonly condition?: string;
    readonly effects?: readonly string[];
    readonly onFailure?: {
      readonly retryAfter: MagicItemDurationSpec;
      readonly scope: 'actor' | 'target' | 'item';
      readonly to?: string;
      readonly note?: string;
    };
    readonly note?: string;
  }[];
  readonly duration?: MagicItemDurationSpec;
  readonly termination?: string;
  readonly note?: string;
}

export interface MagicItemEntityGrant {
  readonly runtimeOwner:
    | 'encounter-combatant'
    | 'persistent-actor'
    | 'illusory-entity';
  readonly grants: readonly {
    readonly id: string;
    readonly kind: 'creature' | 'illusion' | 'object';
    readonly statBlockRef?: string;
    readonly creatureRefs?: readonly string[];
    readonly tableRefs?: readonly string[];
    readonly count?: number | string;
    readonly control?: string;
    readonly duration?: MagicItemDurationSpec;
    readonly revertOn?: readonly string[];
    readonly onEntityDeath?: string;
    readonly cooldownEconomy?: string;
    readonly exclusiveInstance?: {
      readonly scope: 'item' | 'owner';
      readonly recast: 'replace' | 'blocked' | 'dismiss-existing';
    };
    readonly note?: string;
  }[];
  readonly note?: string;
}

export interface MagicItemContainment {
  readonly mode:
    | 'storage'
    | 'cells'
    | 'creature-prison'
    | 'portal'
    | 'planar-travel';
  readonly tracksOccupancy?: true;
  readonly fixedWeightPounds?: number;
  readonly capacity?: {
    readonly count?: number;
    readonly weightPounds?: number;
    readonly volumeCubicFeet?: number;
    readonly diameterFeet?: number;
    readonly depthFeet?: number;
    readonly creatures?: number;
    readonly visitors?: number;
    readonly durationDays?: number;
    readonly durationDividedByOccupants?: boolean;
  };
  readonly compartments?: readonly {
    readonly id: string;
    readonly capacity: {
      readonly count?: number;
      readonly weightPounds?: number;
      readonly volumeCubicFeet?: number;
    };
    readonly accepts: string;
    readonly retrieval?: string;
  }[];
  readonly cells?: {
    readonly count: number;
    readonly occupantsPerCell: number;
    readonly environment: string;
    readonly noAging?: boolean;
    readonly noNeeds?: readonly string[];
    readonly overflowRelease: 'random-occupant';
  };
  readonly entry?: MagicItemContainmentProcedure;
  readonly exit?: MagicItemContainmentProcedure;
  readonly release?: MagicItemContainmentProcedure;
  readonly overflow?: string;
  readonly rupture?: {
    readonly triggers: readonly string[];
    readonly destroysItem: boolean;
    readonly contentsDestination: string;
    readonly note?: string;
  };
  readonly suffocation?: {
    readonly airMinutes: number;
    readonly dividedByOccupants: boolean;
    readonly minimumMinutes?: number;
  };
  readonly portal?: {
    readonly direction: 'one-way' | 'two-way' | 'round-trip';
    readonly destination: string;
    readonly opening: string;
    readonly closure: string;
    readonly returnDestination?: string;
  };
  readonly note?: string;
}

export interface MagicItemContainmentProcedure {
  readonly activation?: MagicItemActivationSpec;
  readonly trigger?: string;
  readonly check?: { readonly ability: string; readonly dc: number };
  readonly destination?: string;
  readonly result: string;
}

export interface MagicItemCurse {
  readonly revealedBy?: readonly string[];
  readonly endedBy?: readonly string[];
  readonly blocksUnattune?: boolean;
  readonly blocksDoff?: boolean;
  /** Explicit lifecycle hooks; a curse block alone is not an attunement rule. */
  readonly attunement?: {
    /** Effects that must be evaluated before the bond can be created. */
    readonly preconditionEffects?: readonly string[];
    /** Character-state definitions atomically attached when attunement begins. */
    readonly attachesStates?: readonly string[];
  };
  readonly possession?: {
    /** Active character states that prevent a voluntary custody release. */
    readonly blocksVoluntaryRelinquishmentWhileStates: readonly string[];
  };
  readonly effects?: readonly string[];
  readonly exclusiveState?: {
    readonly id: string;
    readonly replaces?: string;
    readonly endsWhen?: string;
    readonly note?: string;
  };
  /** Immutable definitions licensing live curse/target/counter state. */
  readonly stateDefinitions?: readonly MagicItemCurseStateDefinition[];
  readonly note?: string;
}

export interface MagicItemCurseStateDefinition {
  readonly id: string;
  readonly effects?: readonly string[];
  readonly onset: string;
  readonly endsOn?: readonly {
    readonly trigger: string;
    readonly replacementAvailable?: 'immediate' | 'next-dawn';
  }[];
  readonly exclusive?: {
    readonly scope: 'item-instance' | 'character';
    readonly group: string;
    readonly recast: 'replace' | 'blocked';
  };
  readonly stack?: {
    readonly counterId: string;
    readonly increment: number;
    readonly maximum?: number;
    readonly clears: 'all' | 'one';
  };
  readonly note?: string;
}

export interface MagicItemRandomProcedure {
  readonly procedures: readonly MagicItemRandomProcedureDefinition[];
  readonly customState?: MagicItemRandomProcedureCardPoolState;
  readonly note?: string;
}

export interface MagicItemRandomProcedureDefinition {
  readonly id: string;
  readonly kind:
    | 'table-roll'
    | 'initial-state'
    | 'percent-risk'
    | 'declared-draw'
    | 'nested-roll'
    | 'retributive-strike';
  readonly trigger: string;
  /** Dice expression resolved only through the campaign's seeded roll service. */
  readonly roll?: string;
  readonly tableRef?: string;
  /** Uniform selection from the named declared custom-state field. */
  readonly selectionField?: string;
  readonly risk?: {
    readonly percent: number;
    readonly cumulative?: boolean;
    readonly incrementPercent?: number;
  };
  readonly outcome: string;
  readonly procedureNote?: string;
}

/** Narrow, pack-declared license for Deck-of-Many-Things-style live state. */
export interface MagicItemRandomProcedureCardPoolState {
  readonly kind: 'card-pool';
  readonly allowedCardIds: readonly string[];
  readonly variants: readonly {
    readonly id: string;
    readonly initialCardIds: readonly string[];
  }[];
  readonly remainingField: 'remainingCardIds';
  readonly returnedField: 'returnedCardIds';
  readonly nonReturningCardIds: readonly string[];
}

export interface MagicItemSpellStore {
  readonly contracts: readonly MagicItemSpellContract[];
  readonly note?: string;
}

export interface MagicItemSpellContract {
  readonly id: string;
  readonly kind:
    | 'spell-storage'
    | 'spell-energy'
    | 'spell-cancellation'
    | 'slot-recovery'
    | 'free-casting'
    | 'scroll-casting'
    | 'charge-absorption';
  readonly variant?: string;
  readonly capacityLevels?: number;
  readonly lifetimeCapacityLevels?: number;
  readonly maximumSpellLevel?: number;
  readonly casterOfRecord?: string;
  readonly storeOn?: MagicItemSpellContractEvent;
  readonly castOut?: MagicItemSpellContractEvent;
  readonly absorbOn?: MagicItemSpellContractEvent;
  readonly operationIds?: readonly string[];
  readonly tableRefs?: readonly string[];
  readonly initialLevels?: string;
  readonly overflow?: string;
  readonly onExhausted?: string;
  readonly condition?: string;
  readonly note?: string;
}

export interface MagicItemSpellContractEvent {
  readonly cost: MagicItemActivationSpec['cost'] | 'spell-normal-casting-time';
  readonly trigger?: string;
  readonly requirement?: string;
  readonly target?: string;
  readonly result?: string;
  readonly note?: string;
}

export interface MagicItemRollManipulation {
  readonly transforms: readonly MagicItemRollTransform[];
  readonly note?: string;
}

export interface MagicItemRollTransform {
  readonly id: string;
  readonly kind: 'reroll' | 'replace-fail' | 'reflect' | 'pb-double' | 'cancel';
  readonly roll?: string;
  readonly trigger: string;
  readonly operationId?: string;
  readonly limitEconomy?: string;
  readonly condition?: string;
  readonly replacement?: string;
  readonly multiplier?: number;
  readonly maximumSpellLevel?: number;
  readonly note?: string;
}

export interface MagicItemInterItem {
  readonly requiresItems?: readonly {
    readonly itemRefs: readonly string[];
    readonly allRequired: boolean;
    readonly state: string;
    readonly note?: string;
  }[];
  readonly counters?: readonly {
    readonly itemRefs: readonly string[];
    readonly interaction:
      | 'dissolves'
      | 'prevents-adhesion'
      | 'enhances-control';
    readonly targetRef: string;
    readonly note?: string;
  }[];
  readonly nestingHazard?: {
    readonly withItemRefs: readonly string[];
    readonly trigger: string;
    readonly destroys: 'both-items';
    readonly affectsRadiusFeet: number;
    readonly portal: {
      readonly direction: 'one-way';
      readonly destination: string;
      readonly closure: string;
    };
  };
  readonly portalInteraction?: {
    readonly portalRefs: readonly string[];
    readonly tableRefs: readonly string[];
    readonly procedure: string;
  };
  readonly note?: string;
}

/** Immutable, source-derived capabilities. Live per-instance values never belong here. */
export interface MagicItemMechanics {
  readonly activation?: MagicItemActivationSpec;
  readonly economies?: Readonly<Record<string, MagicItemEconomy>>;
  readonly operations?: readonly MagicItemOperation[];
  readonly effects?: readonly MagicItemEffect[];
  readonly stateMachine?: MagicItemStateMachine;
  readonly entityGrant?: MagicItemEntityGrant;
  readonly containment?: MagicItemContainment;
  readonly curse?: MagicItemCurse;
  readonly randomProcedure?: MagicItemRandomProcedure;
  readonly spellStore?: MagicItemSpellStore;
  readonly rollManipulation?: MagicItemRollManipulation;
  readonly interItem?: MagicItemInterItem;
}

const ID_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const REF_RE = /^[a-z][a-z0-9-]*:[a-z0-9]+(?:[-:][a-z0-9]+)*$/;
const DICE_RE = /^(?:\d*)d\d+(?:(?:kh|kl|dh|dl)\d+)?(?:[+-]\d+)?$/i;
const DURATION_UNITS = new Set(['round', 'minute', 'hour', 'day']);
const ACTIVATION_COSTS = new Set([
  'action',
  'bonus-action',
  'reaction',
  'free',
  'consume',
]);
const ECONOMY_KINDS = new Set([
  'charges',
  'per-day',
  'cooldown',
  'budget',
  'doses',
  'single-use',
  'at-will',
]);
const RESET_EVENTS = new Set([
  'dawn',
  'dusk',
  'short-rest',
  'long-rest',
  'hour',
  'days',
  'per-period',
]);

function object(value: unknown, path: string): Obj {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new RulesPackError(`${path} must be a non-null object`);
  }
  return value as Obj;
}

function only(obj: Obj, keys: readonly string[], path: string): void {
  const allowed = new Set(keys);
  for (const key of Object.keys(obj)) {
    if (!allowed.has(key)) {
      throw new RulesPackError(
        `${path} has unsupported key ${JSON.stringify(key)}`,
      );
    }
  }
}

function string(value: unknown, path: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new RulesPackError(`${path} must be a non-empty string`);
  }
  return value;
}

function integer(value: unknown, path: string, minimum = 0): number {
  if (!Number.isInteger(value) || (value as number) < minimum) {
    throw new RulesPackError(`${path} must be an integer >= ${minimum}`);
  }
  return value as number;
}

function finite(value: unknown, path: string, minimum?: number): number {
  if (
    typeof value !== 'number' ||
    !Number.isFinite(value) ||
    (minimum !== undefined && value < minimum)
  ) {
    throw new RulesPackError(
      `${path} must be a finite number${minimum === undefined ? '' : ` >= ${minimum}`}`,
    );
  }
  return value;
}

function boolean(value: unknown, path: string): void {
  if (typeof value !== 'boolean') {
    throw new RulesPackError(`${path} must be a boolean`);
  }
}

function id(value: unknown, path: string): string {
  const result = string(value, path);
  if (!ID_RE.test(result)) {
    throw new RulesPackError(`${path} must be a stable kebab-case ID`);
  }
  return result;
}

function ref(value: unknown, path: string): string {
  const result = string(value, path);
  if (!REF_RE.test(result)) {
    throw new RulesPackError(`${path} must be a namespaced rules reference`);
  }
  return result;
}

function dice(value: unknown, path: string): string {
  const result = string(value, path).replace(/\s+/g, '');
  if (!DICE_RE.test(result)) {
    throw new RulesPackError(`${path} must be a dice expression`);
  }
  const match = /^(\d*)d(\d+)(?:(kh|kl|dh|dl)(\d+))?(?:[+-]\d+)?$/i.exec(
    result,
  );
  const count = match?.[1] === '' ? 1 : Number(match?.[1]);
  const faces = Number(match?.[2]);
  const keep = match?.[4] === undefined ? undefined : Number(match[4]);
  if (
    match === null ||
    count < 1 ||
    count > 100 ||
    faces < 2 ||
    faces > 1000 ||
    (keep !== undefined && (count < 2 || keep < 1 || keep >= count))
  ) {
    throw new RulesPackError(`${path} must be a valid dice expression`);
  }
  return result;
}

function duration(value: unknown, path: string): void {
  const obj = object(value, path);
  only(obj, ['amount', 'unit'], path);
  if (typeof obj.amount === 'string') {
    dice(obj.amount, `${path}.amount`);
  } else {
    const amount = finite(obj.amount, `${path}.amount`, 0);
    if (amount === 0) {
      throw new RulesPackError(`${path}.amount must be greater than 0`);
    }
  }
  const unit = string(obj.unit, `${path}.unit`);
  if (!DURATION_UNITS.has(unit)) {
    throw new RulesPackError(
      `${path}.unit must be one of ${[...DURATION_UNITS].join(', ')}`,
    );
  }
}

function strings(
  value: unknown,
  path: string,
  options: { ids?: boolean; refs?: boolean; nonEmpty?: boolean } = {},
): readonly string[] {
  if (
    !Array.isArray(value) ||
    (options.nonEmpty === true && value.length === 0)
  ) {
    throw new RulesPackError(
      `${path} must be ${options.nonEmpty === true ? 'a non-empty ' : 'an '}array`,
    );
  }
  const seen = new Set<string>();
  value.forEach((entry, index) => {
    const entryPath = `${path}[${index}]`;
    const parsed = options.ids
      ? id(entry, entryPath)
      : options.refs
        ? ref(entry, entryPath)
        : string(entry, entryPath);
    if (seen.has(parsed)) {
      throw new RulesPackError(`${entryPath} must be unique`);
    }
    seen.add(parsed);
  });
  return value as readonly string[];
}

function array(value: unknown, path: string): readonly unknown[] {
  if (!Array.isArray(value))
    throw new RulesPackError(`${path} must be an array`);
  return value;
}

function activation(value: unknown, path: string): void {
  const obj = object(value, path);
  only(
    obj,
    ['cost', 'commandWord', 'trigger', 'requirement', 'target', 'note'],
    path,
  );
  const cost = string(obj.cost, `${path}.cost`);
  if (!ACTIVATION_COSTS.has(cost)) {
    throw new RulesPackError(
      `${path}.cost must be one of ${[...ACTIVATION_COSTS].join(', ')}`,
    );
  }
  if (obj.commandWord !== undefined)
    boolean(obj.commandWord, `${path}.commandWord`);
  for (const key of ['trigger', 'requirement', 'target', 'note']) {
    if (obj[key] !== undefined) string(obj[key], `${path}.${key}`);
  }
}

function numberOrDice(value: unknown, path: string, minimum = 1): void {
  if (typeof value === 'number') {
    integer(value, path, minimum);
  } else {
    dice(value, path);
  }
}

function reset(value: unknown, path: string): void {
  if (!Array.isArray(value) || value.length === 0) {
    throw new RulesPackError(`${path} must be a non-empty array`);
  }
  value.forEach((entry, index) => {
    const entryPath = `${path}[${index}]`;
    const obj = object(entry, entryPath);
    only(obj, ['at', 'amount', 'days', 'period', 'onlyIfUnused'], entryPath);
    const at = string(obj.at, `${entryPath}.at`);
    if (!RESET_EVENTS.has(at)) {
      throw new RulesPackError(`${entryPath}.at is unsupported`);
    }
    if (obj.amount !== undefined) {
      if (typeof obj.amount === 'object')
        duration(obj.amount, `${entryPath}.amount`);
      else if (obj.amount !== 'all')
        numberOrDice(obj.amount, `${entryPath}.amount`);
    }
    if (obj.days !== undefined) integer(obj.days, `${entryPath}.days`, 1);
    if (obj.period !== undefined) duration(obj.period, `${entryPath}.period`);
    if (obj.onlyIfUnused !== undefined)
      boolean(obj.onlyIfUnused, `${entryPath}.onlyIfUnused`);
    if (at === 'days' && obj.days === undefined) {
      throw new RulesPackError(
        `${entryPath}.days is required for a days reset`,
      );
    }
    if (at === 'per-period' && obj.period === undefined) {
      throw new RulesPackError(
        `${entryPath}.period is required for a per-period reset`,
      );
    }
  });
}

function depleted(value: unknown, path: string): void {
  const obj = object(value, path);
  only(
    obj,
    [
      'roll',
      'destroyedOn',
      'regainOn',
      'regainAmount',
      'loseProperty',
      'losePropertyOn',
      'becomes',
    ],
    path,
  );
  if (obj.roll !== undefined) dice(obj.roll, `${path}.roll`);
  if (obj.destroyedOn !== undefined)
    integer(obj.destroyedOn, `${path}.destroyedOn`, 1);
  if (obj.regainOn !== undefined) integer(obj.regainOn, `${path}.regainOn`, 1);
  if (obj.regainAmount !== undefined)
    numberOrDice(obj.regainAmount, `${path}.regainAmount`);
  if (obj.loseProperty !== undefined)
    boolean(obj.loseProperty, `${path}.loseProperty`);
  if (obj.losePropertyOn !== undefined)
    integer(obj.losePropertyOn, `${path}.losePropertyOn`, 1);
  for (const conditionalField of [
    'destroyedOn',
    'regainOn',
    'losePropertyOn',
  ] as const) {
    if (obj[conditionalField] !== undefined && obj.roll === undefined) {
      throw new RulesPackError(
        `${path}.${conditionalField} requires ${path}.roll`,
      );
    }
  }
  if ((obj.regainOn === undefined) !== (obj.regainAmount === undefined)) {
    throw new RulesPackError(
      `${path}.regainOn and ${path}.regainAmount must be declared together`,
    );
  }
  if (obj.becomes !== undefined) {
    if (typeof obj.becomes === 'string') {
      if (!new Set(['destroyed', 'nonmagical', 'inert']).has(obj.becomes)) {
        throw new RulesPackError(
          `${path}.becomes has unsupported terminal state`,
        );
      }
    } else {
      const becomes = object(obj.becomes, `${path}.becomes`);
      only(becomes, ['itemRef'], `${path}.becomes`);
      ref(becomes.itemRef, `${path}.becomes.itemRef`);
    }
  }
}

function economy(value: unknown, path: string): void {
  const obj = object(value, path);
  only(
    obj,
    [
      'kind',
      'charges',
      'perDay',
      'cooldown',
      'budget',
      'doses',
      'reset',
      'onDepleted',
      'note',
    ],
    path,
  );
  const kind = string(obj.kind, `${path}.kind`);
  if (!ECONOMY_KINDS.has(kind)) {
    throw new RulesPackError(`${path}.kind has unsupported economy kind`);
  }
  const shapeKey: Record<string, string | undefined> = {
    charges: 'charges',
    'per-day': 'perDay',
    cooldown: 'cooldown',
    budget: 'budget',
    doses: 'doses',
  };
  const expected = shapeKey[kind];
  for (const key of ['charges', 'perDay', 'cooldown', 'budget', 'doses']) {
    if (key !== expected && obj[key] !== undefined) {
      throw new RulesPackError(`${path}.${key} is not valid for ${kind}`);
    }
  }
  if (expected !== undefined && obj[expected] === undefined) {
    throw new RulesPackError(`${path}.${expected} is required for ${kind}`);
  }
  if (obj.charges !== undefined) {
    const shape = object(obj.charges, `${path}.charges`);
    only(shape, ['max'], `${path}.charges`);
    numberOrDice(shape.max, `${path}.charges.max`);
  }
  if (obj.perDay !== undefined) {
    const shape = object(obj.perDay, `${path}.perDay`);
    only(shape, ['uses'], `${path}.perDay`);
    integer(shape.uses, `${path}.perDay.uses`, 1);
  }
  if (obj.cooldown !== undefined) {
    const shape = object(obj.cooldown, `${path}.cooldown`);
    only(shape, ['duration'], `${path}.cooldown`);
    duration(shape.duration, `${path}.cooldown.duration`);
  }
  if (obj.budget !== undefined) {
    const shape = object(obj.budget, `${path}.budget`);
    only(shape, ['total', 'increment'], `${path}.budget`);
    duration(shape.total, `${path}.budget.total`);
    duration(shape.increment, `${path}.budget.increment`);
  }
  if (obj.doses !== undefined) {
    const shape = object(obj.doses, `${path}.doses`);
    only(shape, ['count'], `${path}.doses`);
    numberOrDice(shape.count, `${path}.doses.count`);
  }
  if (obj.reset !== undefined) reset(obj.reset, `${path}.reset`);
  if (obj.onDepleted !== undefined)
    depleted(obj.onDepleted, `${path}.onDepleted`);
  if (obj.note !== undefined) string(obj.note, `${path}.note`);
}

function operation(value: unknown, path: string): MagicItemOperation {
  const obj = object(value, path);
  only(
    obj,
    [
      'id',
      'activation',
      'cost',
      'excludes',
      'doesNotExpend',
      'effects',
      'note',
    ],
    path,
  );
  const operationId = id(obj.id, `${path}.id`);
  if (obj.activation !== undefined)
    activation(obj.activation, `${path}.activation`);
  if (obj.cost !== undefined) {
    if (!Array.isArray(obj.cost) || obj.cost.length === 0) {
      throw new RulesPackError(`${path}.cost must be a non-empty array`);
    }
    obj.cost.forEach((entry, index) => {
      const costPath = `${path}.cost[${index}]`;
      const cost = object(entry, costPath);
      only(cost, ['economy', 'amount'], costPath);
      id(cost.economy, `${costPath}.economy`);
      if (cost.amount !== 'variable')
        numberOrDice(cost.amount, `${costPath}.amount`);
    });
  }
  for (const key of ['excludes', 'doesNotExpend', 'effects']) {
    if (obj[key] !== undefined)
      strings(obj[key], `${path}.${key}`, { ids: true, nonEmpty: true });
  }
  if (obj.note !== undefined) string(obj.note, `${path}.note`);
  return { ...obj, id: operationId } as unknown as MagicItemOperation;
}

function stateMachine(
  value: unknown,
  path: string,
  effectIds: ReadonlySet<string>,
  operationIds: ReadonlySet<string>,
): void {
  const obj = object(value, path);
  only(
    obj,
    ['initial', 'states', 'transitions', 'duration', 'termination', 'note'],
    path,
  );
  const initial = id(obj.initial, `${path}.initial`);
  if (!Array.isArray(obj.states) || obj.states.length === 0) {
    throw new RulesPackError(`${path}.states must be a non-empty array`);
  }
  const stateIds = new Set<string>();
  obj.states.forEach((entry, index) => {
    const statePath = `${path}.states[${index}]`;
    const state = object(entry, statePath);
    only(state, ['id', 'effects', 'note'], statePath);
    const stateId = id(state.id, `${statePath}.id`);
    if (stateIds.has(stateId))
      throw new RulesPackError(`${statePath}.id must be unique`);
    stateIds.add(stateId);
    if (state.effects !== undefined) {
      for (const effectId of strings(state.effects, `${statePath}.effects`, {
        ids: true,
        nonEmpty: true,
      })) {
        if (!effectIds.has(effectId))
          throw new RulesPackError(
            `${statePath}.effects references unknown effect ${JSON.stringify(effectId)}`,
          );
      }
    }
    if (state.note !== undefined) string(state.note, `${statePath}.note`);
  });
  if (!stateIds.has(initial))
    throw new RulesPackError(
      `${path}.initial references unknown state ${JSON.stringify(initial)}`,
    );
  if (!Array.isArray(obj.transitions) || obj.transitions.length === 0) {
    throw new RulesPackError(`${path}.transitions must be a non-empty array`);
  }
  obj.transitions.forEach((entry, index) => {
    const transitionPath = `${path}.transitions[${index}]`;
    const transition = object(entry, transitionPath);
    only(
      transition,
      [
        'from',
        'to',
        'via',
        'timer',
        'condition',
        'effects',
        'onFailure',
        'note',
      ],
      transitionPath,
    );
    for (const key of ['from', 'to'] as const) {
      const stateId = id(transition[key], `${transitionPath}.${key}`);
      if (!stateIds.has(stateId))
        throw new RulesPackError(
          `${transitionPath}.${key} references unknown state ${JSON.stringify(stateId)}`,
        );
    }
    const triggers = ['via', 'timer', 'condition'].filter(
      (key) => transition[key] !== undefined,
    );
    if (triggers.length !== 1)
      throw new RulesPackError(
        `${transitionPath} must declare exactly one of via, timer, or condition`,
      );
    if (transition.via !== undefined) {
      const via = id(transition.via, `${transitionPath}.via`);
      if (
        via !== 'activate' &&
        via !== 'deactivate' &&
        !operationIds.has(via)
      ) {
        throw new RulesPackError(
          `${transitionPath}.via references unknown operation ${JSON.stringify(via)}`,
        );
      }
    }
    if (transition.timer !== undefined)
      duration(transition.timer, `${transitionPath}.timer`);
    if (transition.condition !== undefined)
      string(transition.condition, `${transitionPath}.condition`);
    if (transition.effects !== undefined) {
      const transitionEffects = strings(
        transition.effects,
        `${transitionPath}.effects`,
        {
          ids: true,
          nonEmpty: true,
        },
      );
      for (const effectId of transitionEffects) {
        if (!effectIds.has(effectId)) {
          throw new RulesPackError(
            `${transitionPath}.effects references unknown effect ${JSON.stringify(effectId)}`,
          );
        }
      }
    }
    if (transition.onFailure !== undefined) {
      const failurePath = `${transitionPath}.onFailure`;
      const failure = object(transition.onFailure, failurePath);
      only(failure, ['retryAfter', 'scope', 'to', 'note'], failurePath);
      duration(failure.retryAfter, `${failurePath}.retryAfter`);
      const scope = string(failure.scope, `${failurePath}.scope`);
      if (!new Set(['actor', 'target', 'item']).has(scope)) {
        throw new RulesPackError(
          `${failurePath}.scope must be actor, target, or item`,
        );
      }
      if (failure.to !== undefined) {
        const stateId = id(failure.to, `${failurePath}.to`);
        if (!stateIds.has(stateId)) {
          throw new RulesPackError(
            `${failurePath}.to references unknown state ${JSON.stringify(stateId)}`,
          );
        }
      }
      if (failure.note !== undefined)
        string(failure.note, `${failurePath}.note`);
    }
    if (transition.note !== undefined)
      string(transition.note, `${transitionPath}.note`);
  });
  if (obj.duration !== undefined) duration(obj.duration, `${path}.duration`);
  if (obj.termination !== undefined)
    string(obj.termination, `${path}.termination`);
  if (obj.note !== undefined) string(obj.note, `${path}.note`);
}

function entityGrant(
  value: unknown,
  path: string,
  economies: ReadonlySet<string>,
): void {
  const obj = object(value, path);
  only(obj, ['runtimeOwner', 'grants', 'note'], path);
  const runtimeOwner = string(obj.runtimeOwner, `${path}.runtimeOwner`);
  if (
    !new Set([
      'encounter-combatant',
      'persistent-actor',
      'illusory-entity',
    ]).has(runtimeOwner)
  ) {
    throw new RulesPackError(
      `${path}.runtimeOwner must be encounter-combatant, persistent-actor, or illusory-entity`,
    );
  }
  if (!Array.isArray(obj.grants) || obj.grants.length === 0) {
    throw new RulesPackError(`${path}.grants must be a non-empty array`);
  }
  const grantIds = new Set<string>();
  obj.grants.forEach((entry, index) => {
    const grantPath = `${path}.grants[${index}]`;
    const grant = object(entry, grantPath);
    only(
      grant,
      [
        'id',
        'kind',
        'statBlockRef',
        'creatureRefs',
        'tableRefs',
        'count',
        'control',
        'duration',
        'revertOn',
        'onEntityDeath',
        'cooldownEconomy',
        'exclusiveInstance',
        'note',
      ],
      grantPath,
    );
    const grantId = id(grant.id, `${grantPath}.id`);
    if (grantIds.has(grantId)) {
      throw new RulesPackError(`${grantPath}.id must be unique`);
    }
    grantIds.add(grantId);
    const kind = string(grant.kind, `${grantPath}.kind`);
    if (!new Set(['creature', 'illusion', 'object']).has(kind)) {
      throw new RulesPackError(
        `${grantPath}.kind must be creature, illusion, or object`,
      );
    }
    if (grant.statBlockRef !== undefined) {
      const statBlockRef = ref(grant.statBlockRef, `${grantPath}.statBlockRef`);
      if (
        !statBlockRef.startsWith('creature:') &&
        !statBlockRef.startsWith('stat-block:')
      ) {
        throw new RulesPackError(
          `${grantPath}.statBlockRef must be a creature: or stat-block: reference`,
        );
      }
    }
    if (grant.creatureRefs !== undefined) {
      const creatureRefs = strings(
        grant.creatureRefs,
        `${grantPath}.creatureRefs`,
        { refs: true, nonEmpty: true },
      );
      if (creatureRefs.some((entry) => !entry.startsWith('creature:'))) {
        throw new RulesPackError(
          `${grantPath}.creatureRefs must contain only creature: references`,
        );
      }
    }
    if (grant.tableRefs !== undefined) {
      const tableRefs = strings(grant.tableRefs, `${grantPath}.tableRefs`, {
        refs: true,
        nonEmpty: true,
      });
      if (tableRefs.some((entry) => !entry.startsWith('table:'))) {
        throw new RulesPackError(
          `${grantPath}.tableRefs must contain only table: references`,
        );
      }
    }
    if (
      grant.statBlockRef === undefined &&
      grant.creatureRefs === undefined &&
      grant.tableRefs === undefined &&
      grant.note === undefined
    ) {
      throw new RulesPackError(
        `${grantPath} must declare statBlockRef, creatureRefs, tableRefs, or an explicit note`,
      );
    }
    if (grant.count !== undefined)
      numberOrDice(grant.count, `${grantPath}.count`);
    if (grant.control !== undefined)
      string(grant.control, `${grantPath}.control`);
    if (grant.duration !== undefined)
      duration(grant.duration, `${grantPath}.duration`);
    if (grant.revertOn !== undefined)
      strings(grant.revertOn, `${grantPath}.revertOn`, { nonEmpty: true });
    if (grant.onEntityDeath !== undefined)
      string(grant.onEntityDeath, `${grantPath}.onEntityDeath`);
    if (grant.cooldownEconomy !== undefined) {
      const economyId = id(
        grant.cooldownEconomy,
        `${grantPath}.cooldownEconomy`,
      );
      if (!economies.has(economyId)) {
        throw new RulesPackError(
          `${grantPath}.cooldownEconomy references unknown economy ${JSON.stringify(economyId)}`,
        );
      }
    }
    if (grant.exclusiveInstance !== undefined) {
      const exclusivePath = `${grantPath}.exclusiveInstance`;
      const exclusive = object(grant.exclusiveInstance, exclusivePath);
      only(exclusive, ['scope', 'recast'], exclusivePath);
      const scope = string(exclusive.scope, `${exclusivePath}.scope`);
      if (scope !== 'item' && scope !== 'owner') {
        throw new RulesPackError(
          `${exclusivePath}.scope must be item or owner`,
        );
      }
      const recast = string(exclusive.recast, `${exclusivePath}.recast`);
      if (
        recast !== 'replace' &&
        recast !== 'blocked' &&
        recast !== 'dismiss-existing'
      ) {
        throw new RulesPackError(
          `${exclusivePath}.recast must be replace, blocked, or dismiss-existing`,
        );
      }
    }
    if (grant.note !== undefined) string(grant.note, `${grantPath}.note`);
  });
  if (obj.note !== undefined) string(obj.note, `${path}.note`);
}

function containmentCapacity(value: unknown, path: string): void {
  const capacity = object(value, path);
  only(
    capacity,
    [
      'count',
      'weightPounds',
      'volumeCubicFeet',
      'diameterFeet',
      'depthFeet',
      'creatures',
      'visitors',
      'durationDays',
      'durationDividedByOccupants',
    ],
    path,
  );
  if (Object.keys(capacity).length === 0)
    throw new RulesPackError(`${path} must not be empty`);
  for (const key of [
    'count',
    'weightPounds',
    'volumeCubicFeet',
    'diameterFeet',
    'depthFeet',
    'creatures',
    'visitors',
    'durationDays',
  ]) {
    if (capacity[key] !== undefined) finite(capacity[key], `${path}.${key}`, 0);
  }
  if (capacity.durationDividedByOccupants !== undefined)
    boolean(
      capacity.durationDividedByOccupants,
      `${path}.durationDividedByOccupants`,
    );
}

function containmentProcedure(value: unknown, path: string): void {
  const procedure = object(value, path);
  only(
    procedure,
    ['activation', 'trigger', 'check', 'destination', 'result'],
    path,
  );
  if (procedure.activation !== undefined)
    activation(procedure.activation, `${path}.activation`);
  if (procedure.trigger !== undefined)
    string(procedure.trigger, `${path}.trigger`);
  if (procedure.check !== undefined) {
    const check = object(procedure.check, `${path}.check`);
    only(check, ['ability', 'dc'], `${path}.check`);
    string(check.ability, `${path}.check.ability`);
    integer(check.dc, `${path}.check.dc`, 1);
  }
  if (procedure.destination !== undefined)
    string(procedure.destination, `${path}.destination`);
  string(procedure.result, `${path}.result`);
}

function containment(value: unknown, path: string): void {
  const obj = object(value, path);
  only(
    obj,
    [
      'mode',
      'tracksOccupancy',
      'fixedWeightPounds',
      'capacity',
      'compartments',
      'cells',
      'entry',
      'exit',
      'release',
      'overflow',
      'rupture',
      'suffocation',
      'portal',
      'note',
    ],
    path,
  );
  const mode = string(obj.mode, `${path}.mode`);
  if (
    !new Set([
      'storage',
      'cells',
      'creature-prison',
      'portal',
      'planar-travel',
    ]).has(mode)
  ) {
    throw new RulesPackError(`${path}.mode has unsupported containment mode`);
  }
  if (obj.tracksOccupancy !== undefined && obj.tracksOccupancy !== true)
    throw new RulesPackError(`${path}.tracksOccupancy must be true`);
  if (obj.fixedWeightPounds !== undefined)
    finite(obj.fixedWeightPounds, `${path}.fixedWeightPounds`, 0);
  if (obj.capacity !== undefined)
    containmentCapacity(obj.capacity, `${path}.capacity`);
  if (obj.compartments !== undefined) {
    if (!Array.isArray(obj.compartments) || obj.compartments.length === 0)
      throw new RulesPackError(
        `${path}.compartments must be a non-empty array`,
      );
    const ids = new Set<string>();
    obj.compartments.forEach((entry, index) => {
      const compartmentPath = `${path}.compartments[${index}]`;
      const compartment = object(entry, compartmentPath);
      only(
        compartment,
        ['id', 'capacity', 'accepts', 'retrieval'],
        compartmentPath,
      );
      const compartmentId = id(compartment.id, `${compartmentPath}.id`);
      if (ids.has(compartmentId))
        throw new RulesPackError(`${compartmentPath}.id must be unique`);
      ids.add(compartmentId);
      containmentCapacity(compartment.capacity, `${compartmentPath}.capacity`);
      string(compartment.accepts, `${compartmentPath}.accepts`);
      if (compartment.retrieval !== undefined)
        string(compartment.retrieval, `${compartmentPath}.retrieval`);
    });
  }
  if (obj.cells !== undefined) {
    const cells = object(obj.cells, `${path}.cells`);
    only(
      cells,
      [
        'count',
        'occupantsPerCell',
        'environment',
        'noAging',
        'noNeeds',
        'overflowRelease',
      ],
      `${path}.cells`,
    );
    integer(cells.count, `${path}.cells.count`, 1);
    integer(cells.occupantsPerCell, `${path}.cells.occupantsPerCell`, 1);
    string(cells.environment, `${path}.cells.environment`);
    if (cells.noAging !== undefined)
      boolean(cells.noAging, `${path}.cells.noAging`);
    if (cells.noNeeds !== undefined)
      strings(cells.noNeeds, `${path}.cells.noNeeds`, { nonEmpty: true });
    if (cells.overflowRelease !== 'random-occupant')
      throw new RulesPackError(
        `${path}.cells.overflowRelease must be random-occupant`,
      );
  }
  for (const key of ['entry', 'exit', 'release']) {
    if (obj[key] !== undefined)
      containmentProcedure(obj[key], `${path}.${key}`);
  }
  if (obj.overflow !== undefined) string(obj.overflow, `${path}.overflow`);
  if (obj.rupture !== undefined) {
    const rupture = object(obj.rupture, `${path}.rupture`);
    only(
      rupture,
      ['triggers', 'destroysItem', 'contentsDestination', 'note'],
      `${path}.rupture`,
    );
    strings(rupture.triggers, `${path}.rupture.triggers`, { nonEmpty: true });
    boolean(rupture.destroysItem, `${path}.rupture.destroysItem`);
    string(rupture.contentsDestination, `${path}.rupture.contentsDestination`);
    if (rupture.note !== undefined)
      string(rupture.note, `${path}.rupture.note`);
  }
  if (obj.suffocation !== undefined) {
    const suffocation = object(obj.suffocation, `${path}.suffocation`);
    only(
      suffocation,
      ['airMinutes', 'dividedByOccupants', 'minimumMinutes'],
      `${path}.suffocation`,
    );
    finite(suffocation.airMinutes, `${path}.suffocation.airMinutes`, 0);
    boolean(
      suffocation.dividedByOccupants,
      `${path}.suffocation.dividedByOccupants`,
    );
    if (suffocation.minimumMinutes !== undefined)
      finite(
        suffocation.minimumMinutes,
        `${path}.suffocation.minimumMinutes`,
        0,
      );
  }
  if (obj.portal !== undefined) {
    const portal = object(obj.portal, `${path}.portal`);
    only(
      portal,
      ['direction', 'destination', 'opening', 'closure', 'returnDestination'],
      `${path}.portal`,
    );
    const direction = string(portal.direction, `${path}.portal.direction`);
    if (!new Set(['one-way', 'two-way', 'round-trip']).has(direction))
      throw new RulesPackError(`${path}.portal.direction is unsupported`);
    string(portal.destination, `${path}.portal.destination`);
    string(portal.opening, `${path}.portal.opening`);
    string(portal.closure, `${path}.portal.closure`);
    if (portal.returnDestination !== undefined)
      string(portal.returnDestination, `${path}.portal.returnDestination`);
  }
  if (obj.note !== undefined) string(obj.note, `${path}.note`);
}

function curse(
  value: unknown,
  path: string,
  effectIds: ReadonlySet<string>,
  operationIds: ReadonlySet<string>,
): void {
  const obj = object(value, path);
  only(
    obj,
    [
      'revealedBy',
      'endedBy',
      'blocksUnattune',
      'blocksDoff',
      'attunement',
      'possession',
      'effects',
      'exclusiveState',
      'stateDefinitions',
      'note',
    ],
    path,
  );
  for (const key of ['revealedBy', 'endedBy']) {
    if (obj[key] !== undefined)
      strings(obj[key], `${path}.${key}`, { nonEmpty: true });
  }
  for (const key of ['blocksUnattune', 'blocksDoff']) {
    if (obj[key] !== undefined) boolean(obj[key], `${path}.${key}`);
  }
  let attachedStateIds: readonly string[] = [];
  let possessionBlockingStateIds: readonly string[] = [];
  if (obj.attunement !== undefined) {
    const attunement = object(obj.attunement, `${path}.attunement`);
    only(
      attunement,
      ['preconditionEffects', 'attachesStates'],
      `${path}.attunement`,
    );
    if (attunement.preconditionEffects !== undefined) {
      for (const effectId of strings(
        attunement.preconditionEffects,
        `${path}.attunement.preconditionEffects`,
        { ids: true, nonEmpty: true },
      )) {
        if (!effectIds.has(effectId))
          throw new RulesPackError(
            `${path}.attunement.preconditionEffects references unknown effect ${JSON.stringify(effectId)}`,
          );
      }
    }
    if (attunement.attachesStates !== undefined)
      attachedStateIds = strings(
        attunement.attachesStates,
        `${path}.attunement.attachesStates`,
        { ids: true, nonEmpty: true },
      );
    if (
      attunement.preconditionEffects === undefined &&
      attunement.attachesStates === undefined
    )
      throw new RulesPackError(`${path}.attunement must not be empty`);
  }
  if (obj.possession !== undefined) {
    const possession = object(obj.possession, `${path}.possession`);
    only(
      possession,
      ['blocksVoluntaryRelinquishmentWhileStates'],
      `${path}.possession`,
    );
    possessionBlockingStateIds = strings(
      possession.blocksVoluntaryRelinquishmentWhileStates,
      `${path}.possession.blocksVoluntaryRelinquishmentWhileStates`,
      { ids: true, nonEmpty: true },
    );
  }
  if (obj.effects !== undefined) {
    for (const effectId of strings(obj.effects, `${path}.effects`, {
      ids: true,
      nonEmpty: true,
    })) {
      if (!effectIds.has(effectId))
        throw new RulesPackError(
          `${path}.effects references unknown effect ${JSON.stringify(effectId)}`,
        );
    }
  }
  if (obj.exclusiveState !== undefined) {
    const state = object(obj.exclusiveState, `${path}.exclusiveState`);
    only(
      state,
      ['id', 'replaces', 'endsWhen', 'note'],
      `${path}.exclusiveState`,
    );
    id(state.id, `${path}.exclusiveState.id`);
    if (state.replaces !== undefined)
      string(state.replaces, `${path}.exclusiveState.replaces`);
    if (state.endsWhen !== undefined)
      string(state.endsWhen, `${path}.exclusiveState.endsWhen`);
    if (state.note !== undefined)
      string(state.note, `${path}.exclusiveState.note`);
  }
  if (obj.stateDefinitions !== undefined) {
    if (
      !Array.isArray(obj.stateDefinitions) ||
      obj.stateDefinitions.length === 0
    ) {
      throw new RulesPackError(
        `${path}.stateDefinitions must be a non-empty array`,
      );
    }
    const stateIds = new Set<string>();
    obj.stateDefinitions.forEach((entry, index) => {
      const statePath = `${path}.stateDefinitions[${index}]`;
      const state = object(entry, statePath);
      only(
        state,
        ['id', 'effects', 'onset', 'endsOn', 'exclusive', 'stack', 'note'],
        statePath,
      );
      const stateId = id(state.id, `${statePath}.id`);
      if (stateIds.has(stateId))
        throw new RulesPackError(`${statePath}.id must be unique`);
      stateIds.add(stateId);
      if (state.effects !== undefined) {
        for (const effectId of strings(state.effects, `${statePath}.effects`, {
          ids: true,
          nonEmpty: true,
        })) {
          if (!effectIds.has(effectId))
            throw new RulesPackError(
              `${statePath}.effects references unknown effect ${JSON.stringify(effectId)}`,
            );
        }
      }
      const onset = string(state.onset, `${statePath}.onset`);
      if (onset.startsWith('operation:')) {
        const operationId = onset.slice('operation:'.length);
        if (!operationIds.has(operationId))
          throw new RulesPackError(
            `${statePath}.onset references unknown operation ${JSON.stringify(operationId)}`,
          );
      }
      let hasReplacementAvailability = false;
      if (state.endsOn !== undefined) {
        if (!Array.isArray(state.endsOn) || state.endsOn.length === 0)
          throw new RulesPackError(
            `${statePath}.endsOn must be a non-empty array`,
          );
        const triggers = new Set<string>();
        state.endsOn.forEach((endEntry, endIndex) => {
          const endPath = `${statePath}.endsOn[${endIndex}]`;
          const end = object(endEntry, endPath);
          only(end, ['trigger', 'replacementAvailable'], endPath);
          const trigger = string(end.trigger, `${endPath}.trigger`);
          if (triggers.has(trigger))
            throw new RulesPackError(`${endPath}.trigger must be unique`);
          triggers.add(trigger);
          for (const prefix of ['operation:', 'successful-operation:']) {
            if (trigger.startsWith(prefix)) {
              const operationId = trigger.slice(prefix.length);
              if (!operationIds.has(operationId))
                throw new RulesPackError(
                  `${endPath}.trigger references unknown operation ${JSON.stringify(operationId)}`,
                );
            }
          }
          if (end.replacementAvailable !== undefined) {
            hasReplacementAvailability = true;
            if (
              end.replacementAvailable !== 'immediate' &&
              end.replacementAvailable !== 'next-dawn'
            )
              throw new RulesPackError(
                `${endPath}.replacementAvailable must be immediate or next-dawn`,
              );
          }
        });
      }
      if (state.exclusive !== undefined) {
        const exclusivePath = `${statePath}.exclusive`;
        const exclusive = object(state.exclusive, exclusivePath);
        only(exclusive, ['scope', 'group', 'recast'], exclusivePath);
        if (
          exclusive.scope !== 'item-instance' &&
          exclusive.scope !== 'character'
        )
          throw new RulesPackError(
            `${exclusivePath}.scope must be item-instance or character`,
          );
        id(exclusive.group, `${exclusivePath}.group`);
        if (exclusive.recast !== 'replace' && exclusive.recast !== 'blocked')
          throw new RulesPackError(
            `${exclusivePath}.recast must be replace or blocked`,
          );
      } else if (hasReplacementAvailability) {
        throw new RulesPackError(
          `${statePath}.endsOn replacementAvailable requires an exclusive definition`,
        );
      }
      if (state.stack !== undefined) {
        const stackPath = `${statePath}.stack`;
        const stack = object(state.stack, stackPath);
        only(stack, ['counterId', 'increment', 'maximum', 'clears'], stackPath);
        id(stack.counterId, `${stackPath}.counterId`);
        const increment = integer(stack.increment, `${stackPath}.increment`, 1);
        if (stack.maximum !== undefined) {
          const maximum = integer(stack.maximum, `${stackPath}.maximum`, 1);
          if (maximum < increment)
            throw new RulesPackError(
              `${stackPath}.maximum must be >= increment`,
            );
        }
        if (stack.clears !== 'all' && stack.clears !== 'one')
          throw new RulesPackError(`${stackPath}.clears must be all or one`);
      }
      if (
        state.effects === undefined &&
        state.endsOn === undefined &&
        state.exclusive === undefined &&
        state.stack === undefined &&
        state.note === undefined
      )
        throw new RulesPackError(
          `${statePath} must define effects, endings, exclusivity, stacking, or a note`,
        );
      if (state.note !== undefined) string(state.note, `${statePath}.note`);
    });
    for (const stateId of attachedStateIds) {
      if (!stateIds.has(stateId))
        throw new RulesPackError(
          `${path}.attunement.attachesStates references unknown state ${JSON.stringify(stateId)}`,
        );
    }
    for (const stateId of possessionBlockingStateIds) {
      if (!stateIds.has(stateId))
        throw new RulesPackError(
          `${path}.possession.blocksVoluntaryRelinquishmentWhileStates references unknown state ${JSON.stringify(stateId)}`,
        );
    }
  } else if (
    attachedStateIds.length > 0 ||
    possessionBlockingStateIds.length > 0
  ) {
    throw new RulesPackError(
      `${path} attunement/possession state references require stateDefinitions`,
    );
  }
  if (obj.note !== undefined) string(obj.note, `${path}.note`);
}

function randomProcedure(value: unknown, path: string): void {
  const obj = object(value, path);
  only(obj, ['procedures', 'customState', 'note'], path);
  const procedures = array(obj.procedures, `${path}.procedures`);
  if (procedures.length === 0)
    throw new RulesPackError(`${path}.procedures must not be empty`);
  const ids = new Set<string>();
  procedures.forEach((raw, index) => {
    const procedurePath = `${path}.procedures[${index}]`;
    const procedure = object(raw, procedurePath);
    only(
      procedure,
      [
        'id',
        'kind',
        'trigger',
        'roll',
        'tableRef',
        'selectionField',
        'risk',
        'outcome',
        'procedureNote',
      ],
      procedurePath,
    );
    const procedureId = id(procedure.id, `${procedurePath}.id`);
    if (ids.has(procedureId))
      throw new RulesPackError(
        `${path} contains duplicate procedure id '${procedureId}'`,
      );
    ids.add(procedureId);
    const kind = string(procedure.kind, `${procedurePath}.kind`);
    if (
      ![
        'table-roll',
        'initial-state',
        'percent-risk',
        'declared-draw',
        'nested-roll',
        'retributive-strike',
      ].includes(kind)
    )
      throw new RulesPackError(`${procedurePath}.kind is unsupported`);
    string(procedure.trigger, `${procedurePath}.trigger`);
    string(procedure.outcome, `${procedurePath}.outcome`);
    if (procedure.roll !== undefined)
      dice(procedure.roll, `${procedurePath}.roll`);
    if (procedure.tableRef !== undefined) {
      const tableRef = ref(procedure.tableRef, `${procedurePath}.tableRef`);
      if (!tableRef.startsWith('table:'))
        throw new RulesPackError(
          `${procedurePath}.tableRef must be a table: reference`,
        );
    }
    if (procedure.selectionField !== undefined)
      string(procedure.selectionField, `${procedurePath}.selectionField`);
    if (
      procedure.roll === undefined &&
      procedure.selectionField === undefined &&
      procedure.risk === undefined
    )
      throw new RulesPackError(
        `${procedurePath} must declare roll, selectionField, or risk`,
      );
    if (procedure.risk !== undefined) {
      const riskPath = `${procedurePath}.risk`;
      const risk = object(procedure.risk, riskPath);
      only(risk, ['percent', 'cumulative', 'incrementPercent'], riskPath);
      const percent = finite(risk.percent, `${riskPath}.percent`, 0);
      if (percent > 100)
        throw new RulesPackError(`${riskPath}.percent must be <= 100`);
      if (risk.cumulative !== undefined)
        boolean(risk.cumulative, `${riskPath}.cumulative`);
      if (risk.incrementPercent !== undefined) {
        const increment = finite(
          risk.incrementPercent,
          `${riskPath}.incrementPercent`,
          0,
        );
        if (increment > 100)
          throw new RulesPackError(
            `${riskPath}.incrementPercent must be <= 100`,
          );
        if (risk.cumulative !== true)
          throw new RulesPackError(
            `${riskPath}.incrementPercent requires cumulative true`,
          );
      }
    }
    if (procedure.procedureNote !== undefined)
      string(procedure.procedureNote, `${procedurePath}.procedureNote`);
  });
  if (obj.customState !== undefined) {
    const statePath = `${path}.customState`;
    const state = object(obj.customState, statePath);
    only(
      state,
      [
        'kind',
        'allowedCardIds',
        'variants',
        'remainingField',
        'returnedField',
        'nonReturningCardIds',
      ],
      statePath,
    );
    if (state.kind !== 'card-pool')
      throw new RulesPackError(`${statePath}.kind must be card-pool`);
    const allowed = strings(
      state.allowedCardIds,
      `${statePath}.allowedCardIds`,
    );
    const allowedSet = new Set(allowed);
    if (allowed.length === 0 || allowedSet.size !== allowed.length)
      throw new RulesPackError(
        `${statePath}.allowedCardIds must be non-empty and unique`,
      );
    if (state.remainingField !== 'remainingCardIds')
      throw new RulesPackError(
        `${statePath}.remainingField must be remainingCardIds`,
      );
    if (state.returnedField !== 'returnedCardIds')
      throw new RulesPackError(
        `${statePath}.returnedField must be returnedCardIds`,
      );
    const nonReturning = strings(
      state.nonReturningCardIds,
      `${statePath}.nonReturningCardIds`,
    );
    for (const cardId of nonReturning)
      if (!allowedSet.has(cardId))
        throw new RulesPackError(
          `${statePath}.nonReturningCardIds contains undeclared card '${cardId}'`,
        );
    const variants = array(state.variants, `${statePath}.variants`);
    if (variants.length === 0)
      throw new RulesPackError(`${statePath}.variants must not be empty`);
    const variantIds = new Set<string>();
    variants.forEach((raw, index) => {
      const variantPath = `${statePath}.variants[${index}]`;
      const variant = object(raw, variantPath);
      only(variant, ['id', 'initialCardIds'], variantPath);
      const variantId = id(variant.id, `${variantPath}.id`);
      if (variantIds.has(variantId))
        throw new RulesPackError(
          `${statePath} contains duplicate variant id '${variantId}'`,
        );
      variantIds.add(variantId);
      const cards = strings(
        variant.initialCardIds,
        `${variantPath}.initialCardIds`,
      );
      if (cards.length === 0 || new Set(cards).size !== cards.length)
        throw new RulesPackError(
          `${variantPath}.initialCardIds must be non-empty and unique`,
        );
      for (const cardId of cards)
        if (!allowedSet.has(cardId))
          throw new RulesPackError(
            `${variantPath}.initialCardIds contains undeclared card '${cardId}'`,
          );
    });
    const selectionFields = procedures
      .map((raw) => object(raw, `${path}.procedures[]`).selectionField)
      .filter((field) => field !== undefined);
    if (!selectionFields.includes(state.remainingField))
      throw new RulesPackError(
        `${statePath} requires a procedure selecting remainingCardIds`,
      );
  }
  if (obj.note !== undefined) string(obj.note, `${path}.note`);
}

function spellContractEvent(value: unknown, path: string): void {
  const obj = object(value, path);
  only(
    obj,
    ['cost', 'trigger', 'requirement', 'target', 'result', 'note'],
    path,
  );
  const cost = string(obj.cost, `${path}.cost`);
  if (!ACTIVATION_COSTS.has(cost) && cost !== 'spell-normal-casting-time')
    throw new RulesPackError(`${path}.cost is unsupported`);
  for (const key of [
    'trigger',
    'requirement',
    'target',
    'result',
    'note',
  ] as const)
    if (obj[key] !== undefined) string(obj[key], `${path}.${key}`);
}

function spellStore(
  value: unknown,
  path: string,
  operations: ReadonlySet<string>,
): void {
  const obj = object(value, path);
  only(obj, ['contracts', 'note'], path);
  const contracts = array(obj.contracts, `${path}.contracts`);
  if (contracts.length === 0)
    throw new RulesPackError(`${path}.contracts must not be empty`);
  const ids = new Set<string>();
  contracts.forEach((raw, index) => {
    const contractPath = `${path}.contracts[${index}]`;
    const contract = object(raw, contractPath);
    only(
      contract,
      [
        'id',
        'kind',
        'variant',
        'capacityLevels',
        'lifetimeCapacityLevels',
        'maximumSpellLevel',
        'casterOfRecord',
        'storeOn',
        'castOut',
        'absorbOn',
        'operationIds',
        'tableRefs',
        'initialLevels',
        'overflow',
        'onExhausted',
        'condition',
        'note',
      ],
      contractPath,
    );
    const contractId = id(contract.id, `${contractPath}.id`);
    if (ids.has(contractId))
      throw new RulesPackError(
        `${path} contains duplicate contract id '${contractId}'`,
      );
    ids.add(contractId);
    const kind = string(contract.kind, `${contractPath}.kind`);
    const kinds = new Set([
      'spell-storage',
      'spell-energy',
      'spell-cancellation',
      'slot-recovery',
      'free-casting',
      'scroll-casting',
      'charge-absorption',
    ]);
    if (!kinds.has(kind))
      throw new RulesPackError(`${contractPath}.kind is unsupported`);
    if (contract.variant !== undefined)
      string(contract.variant, `${contractPath}.variant`);
    for (const key of [
      'capacityLevels',
      'lifetimeCapacityLevels',
      'maximumSpellLevel',
    ] as const)
      if (contract[key] !== undefined)
        integer(contract[key], `${contractPath}.${key}`, 1);
    for (const key of [
      'casterOfRecord',
      'overflow',
      'onExhausted',
      'condition',
      'note',
    ] as const)
      if (contract[key] !== undefined)
        string(contract[key], `${contractPath}.${key}`);
    for (const key of ['storeOn', 'castOut', 'absorbOn'] as const)
      if (contract[key] !== undefined)
        spellContractEvent(contract[key], `${contractPath}.${key}`);
    if (contract.initialLevels !== undefined)
      dice(contract.initialLevels, `${contractPath}.initialLevels`);
    if (contract.operationIds !== undefined) {
      const operationIds = strings(
        contract.operationIds,
        `${contractPath}.operationIds`,
        { ids: true, nonEmpty: true },
      );
      if (operations.size > 0)
        for (const operationId of operationIds)
          if (!operations.has(operationId))
            throw new RulesPackError(
              `${contractPath}.operationIds references unknown operation '${operationId}'`,
            );
    }
    if (contract.tableRefs !== undefined) {
      const tableRefs = strings(
        contract.tableRefs,
        `${contractPath}.tableRefs`,
        {
          refs: true,
          nonEmpty: true,
        },
      );
      if (tableRefs.some((entry) => !entry.startsWith('table:')))
        throw new RulesPackError(
          `${contractPath}.tableRefs must contain table: references`,
        );
    }
    const required: Readonly<Record<string, readonly string[]>> = {
      'spell-storage': [
        'capacityLevels',
        'maximumSpellLevel',
        'casterOfRecord',
        'storeOn',
        'castOut',
        'operationIds',
      ],
      'spell-energy': [
        'capacityLevels',
        'lifetimeCapacityLevels',
        'maximumSpellLevel',
        'absorbOn',
        'castOut',
        'operationIds',
        'onExhausted',
      ],
      'spell-cancellation': [
        'lifetimeCapacityLevels',
        'maximumSpellLevel',
        'absorbOn',
        'operationIds',
        'onExhausted',
      ],
      'slot-recovery': ['maximumSpellLevel', 'operationIds', 'condition'],
      'free-casting': ['maximumSpellLevel', 'operationIds', 'condition'],
      'scroll-casting': [
        'casterOfRecord',
        'operationIds',
        'tableRefs',
        'condition',
        'onExhausted',
      ],
      'charge-absorption': [
        'capacityLevels',
        'absorbOn',
        'operationIds',
        'overflow',
      ],
    };
    for (const key of required[kind] ?? [])
      if (contract[key] === undefined)
        throw new RulesPackError(
          `${contractPath}.${key} is required for ${kind}`,
        );
    if (
      kind === 'spell-cancellation' &&
      (contract.capacityLevels !== undefined || contract.castOut !== undefined)
    )
      throw new RulesPackError(
        `${contractPath} spell-cancellation cannot store or cast spell energy`,
      );
  });
  if (obj.note !== undefined) string(obj.note, `${path}.note`);
}

function rollManipulation(
  value: unknown,
  path: string,
  economies: ReadonlySet<string>,
  operations: ReadonlySet<string>,
): void {
  const obj = object(value, path);
  only(obj, ['transforms', 'note'], path);
  const transforms = array(obj.transforms, `${path}.transforms`);
  if (transforms.length === 0)
    throw new RulesPackError(`${path}.transforms must not be empty`);
  const ids = new Set<string>();
  transforms.forEach((raw, index) => {
    const transformPath = `${path}.transforms[${index}]`;
    const transform = object(raw, transformPath);
    only(
      transform,
      [
        'id',
        'kind',
        'roll',
        'trigger',
        'operationId',
        'limitEconomy',
        'condition',
        'replacement',
        'multiplier',
        'maximumSpellLevel',
        'note',
      ],
      transformPath,
    );
    const transformId = id(transform.id, `${transformPath}.id`);
    if (ids.has(transformId))
      throw new RulesPackError(
        `${path} contains duplicate transform id '${transformId}'`,
      );
    ids.add(transformId);
    const kind = string(transform.kind, `${transformPath}.kind`);
    if (
      !new Set([
        'reroll',
        'replace-fail',
        'reflect',
        'pb-double',
        'cancel',
      ]).has(kind)
    )
      throw new RulesPackError(`${transformPath}.kind is unsupported`);
    string(transform.trigger, `${transformPath}.trigger`);
    for (const key of ['roll', 'condition', 'replacement', 'note'] as const)
      if (transform[key] !== undefined)
        string(transform[key], `${transformPath}.${key}`);
    if (transform.operationId !== undefined) {
      const operationId = id(
        transform.operationId,
        `${transformPath}.operationId`,
      );
      if (operations.size > 0 && !operations.has(operationId))
        throw new RulesPackError(
          `${transformPath}.operationId references unknown operation '${operationId}'`,
        );
    }
    if (transform.limitEconomy !== undefined) {
      const economyId = id(
        transform.limitEconomy,
        `${transformPath}.limitEconomy`,
      );
      if (economies.size > 0 && !economies.has(economyId))
        throw new RulesPackError(
          `${transformPath}.limitEconomy references unknown economy '${economyId}'`,
        );
    }
    if (transform.multiplier !== undefined) {
      const multiplier = finite(
        transform.multiplier,
        `${transformPath}.multiplier`,
        1,
      );
      if (multiplier === 1)
        throw new RulesPackError(
          `${transformPath}.multiplier must be greater than 1`,
        );
    }
    if (transform.maximumSpellLevel !== undefined)
      integer(
        transform.maximumSpellLevel,
        `${transformPath}.maximumSpellLevel`,
        1,
      );
    if (kind === 'pb-double' && transform.multiplier === undefined)
      throw new RulesPackError(
        `${transformPath}.multiplier is required for pb-double`,
      );
    if (kind !== 'pb-double' && transform.operationId === undefined)
      throw new RulesPackError(
        `${transformPath}.operationId is required for ${kind}`,
      );
    if (
      (kind === 'reroll' ||
        kind === 'replace-fail' ||
        kind === 'reflect' ||
        kind === 'cancel') &&
      transform.replacement === undefined
    )
      throw new RulesPackError(
        `${transformPath}.replacement is required for ${kind}`,
      );
  });
  if (obj.note !== undefined) string(obj.note, `${path}.note`);
}

function interItem(value: unknown, path: string): void {
  const obj = object(value, path);
  only(
    obj,
    ['requiresItems', 'counters', 'nestingHazard', 'portalInteraction', 'note'],
    path,
  );
  if (obj.requiresItems !== undefined) {
    if (!Array.isArray(obj.requiresItems) || obj.requiresItems.length === 0)
      throw new RulesPackError(
        `${path}.requiresItems must be a non-empty array`,
      );
    obj.requiresItems.forEach((entry, index) => {
      const requirementPath = `${path}.requiresItems[${index}]`;
      const requirement = object(entry, requirementPath);
      only(
        requirement,
        ['itemRefs', 'allRequired', 'state', 'note'],
        requirementPath,
      );
      const itemRefs = strings(
        requirement.itemRefs,
        `${requirementPath}.itemRefs`,
        { refs: true, nonEmpty: true },
      );
      if (itemRefs.some((entry) => !entry.startsWith('magic-item:')))
        throw new RulesPackError(
          `${requirementPath}.itemRefs must contain magic-item: references`,
        );
      boolean(requirement.allRequired, `${requirementPath}.allRequired`);
      string(requirement.state, `${requirementPath}.state`);
      if (requirement.note !== undefined)
        string(requirement.note, `${requirementPath}.note`);
    });
  }
  if (obj.counters !== undefined) {
    if (!Array.isArray(obj.counters) || obj.counters.length === 0)
      throw new RulesPackError(`${path}.counters must be a non-empty array`);
    obj.counters.forEach((entry, index) => {
      const counterPath = `${path}.counters[${index}]`;
      const counter = object(entry, counterPath);
      only(
        counter,
        ['itemRefs', 'interaction', 'targetRef', 'note'],
        counterPath,
      );
      const itemRefs = strings(counter.itemRefs, `${counterPath}.itemRefs`, {
        refs: true,
        nonEmpty: true,
      });
      if (itemRefs.some((entry) => !entry.startsWith('magic-item:')))
        throw new RulesPackError(
          `${counterPath}.itemRefs must contain magic-item: references`,
        );
      const interaction = string(
        counter.interaction,
        `${counterPath}.interaction`,
      );
      if (
        !new Set(['dissolves', 'prevents-adhesion', 'enhances-control']).has(
          interaction,
        )
      )
        throw new RulesPackError(`${counterPath}.interaction is unsupported`);
      const targetRef = ref(counter.targetRef, `${counterPath}.targetRef`);
      if (!targetRef.startsWith('magic-item:'))
        throw new RulesPackError(
          `${counterPath}.targetRef must be a magic-item: reference`,
        );
      if (counter.note !== undefined)
        string(counter.note, `${counterPath}.note`);
    });
  }
  if (obj.nestingHazard !== undefined) {
    const hazardPath = `${path}.nestingHazard`;
    const hazard = object(obj.nestingHazard, hazardPath);
    only(
      hazard,
      ['withItemRefs', 'trigger', 'destroys', 'affectsRadiusFeet', 'portal'],
      hazardPath,
    );
    const itemRefs = strings(
      hazard.withItemRefs,
      `${hazardPath}.withItemRefs`,
      {
        refs: true,
        nonEmpty: true,
      },
    );
    if (itemRefs.some((entry) => !entry.startsWith('magic-item:')))
      throw new RulesPackError(
        `${hazardPath}.withItemRefs must contain magic-item: references`,
      );
    string(hazard.trigger, `${hazardPath}.trigger`);
    if (hazard.destroys !== 'both-items')
      throw new RulesPackError(`${hazardPath}.destroys must be both-items`);
    finite(hazard.affectsRadiusFeet, `${hazardPath}.affectsRadiusFeet`, 0);
    const portal = object(hazard.portal, `${hazardPath}.portal`);
    only(
      portal,
      ['direction', 'destination', 'closure'],
      `${hazardPath}.portal`,
    );
    if (portal.direction !== 'one-way')
      throw new RulesPackError(
        `${hazardPath}.portal.direction must be one-way`,
      );
    string(portal.destination, `${hazardPath}.portal.destination`);
    string(portal.closure, `${hazardPath}.portal.closure`);
  }
  if (obj.portalInteraction !== undefined) {
    const interactionPath = `${path}.portalInteraction`;
    const interaction = object(obj.portalInteraction, interactionPath);
    only(
      interaction,
      ['portalRefs', 'tableRefs', 'procedure'],
      interactionPath,
    );
    const portalRefs = strings(
      interaction.portalRefs,
      `${interactionPath}.portalRefs`,
      { refs: true, nonEmpty: true },
    );
    if (
      portalRefs.some(
        (entry) =>
          !entry.startsWith('spell:') && !entry.startsWith('magic-item:'),
      )
    )
      throw new RulesPackError(
        `${interactionPath}.portalRefs must contain spell: or magic-item: references`,
      );
    const tableRefs = strings(
      interaction.tableRefs,
      `${interactionPath}.tableRefs`,
      { refs: true, nonEmpty: true },
    );
    if (tableRefs.some((entry) => !entry.startsWith('table:')))
      throw new RulesPackError(
        `${interactionPath}.tableRefs must contain table: references`,
      );
    string(interaction.procedure, `${interactionPath}.procedure`);
  }
  if (obj.note !== undefined) string(obj.note, `${path}.note`);
  if (
    obj.requiresItems === undefined &&
    obj.counters === undefined &&
    obj.nestingHazard === undefined &&
    obj.portalInteraction === undefined
  ) {
    throw new RulesPackError(`${path} must declare an inter-item relationship`);
  }
}

export type MagicItemEffectValidator = (effect: Obj, path: string) => void;

/** Validate the strict shared magic-item mechanics contract and its internal references. */
export function validateMagicItemMechanics(
  value: unknown,
  path: string,
  validateEffect: MagicItemEffectValidator,
): asserts value is MagicItemMechanics {
  const mechanics = object(value, path);
  only(
    mechanics,
    [
      'activation',
      'economies',
      'operations',
      'effects',
      'stateMachine',
      'entityGrant',
      'containment',
      'curse',
      'randomProcedure',
      'spellStore',
      'rollManipulation',
      'interItem',
    ],
    path,
  );
  if (mechanics.activation !== undefined)
    activation(mechanics.activation, `${path}.activation`);

  const economies = new Set<string>();
  if (mechanics.economies !== undefined) {
    const map = object(mechanics.economies, `${path}.economies`);
    if (Object.keys(map).length === 0)
      throw new RulesPackError(`${path}.economies must not be empty`);
    for (const [economyId, value] of Object.entries(map)) {
      id(economyId, `${path}.economies key`);
      economies.add(economyId);
      economy(value, `${path}.economies.${economyId}`);
    }
  }

  const effectIds = new Set<string>();
  if (mechanics.effects !== undefined) {
    if (!Array.isArray(mechanics.effects) || mechanics.effects.length === 0) {
      throw new RulesPackError(`${path}.effects must be a non-empty array`);
    }
    mechanics.effects.forEach((entry, index) => {
      const effectPath = `${path}.effects[${index}]`;
      const effect = object(entry, effectPath);
      validateEffect(effect, effectPath);
      if (effect.id !== undefined) {
        const effectId = id(effect.id, `${effectPath}.id`);
        if (effectIds.has(effectId))
          throw new RulesPackError(`${effectPath}.id must be unique`);
        effectIds.add(effectId);
      }
    });
  }

  const operations = new Map<string, MagicItemOperation>();
  if (mechanics.operations !== undefined) {
    if (
      !Array.isArray(mechanics.operations) ||
      mechanics.operations.length === 0
    ) {
      throw new RulesPackError(`${path}.operations must be a non-empty array`);
    }
    mechanics.operations.forEach((entry, index) => {
      const operationPath = `${path}.operations[${index}]`;
      const parsed = operation(entry, operationPath);
      if (operations.has(parsed.id))
        throw new RulesPackError(`${operationPath}.id must be unique`);
      operations.set(parsed.id, parsed);
      for (const cost of parsed.cost ?? []) {
        if (!economies.has(cost.economy))
          throw new RulesPackError(
            `${operationPath}.cost references unknown economy ${JSON.stringify(cost.economy)}`,
          );
      }
      for (const economyId of parsed.doesNotExpend ?? []) {
        if (!economies.has(economyId))
          throw new RulesPackError(
            `${operationPath}.doesNotExpend references unknown economy ${JSON.stringify(economyId)}`,
          );
      }
      for (const effectId of parsed.effects ?? []) {
        if (!effectIds.has(effectId))
          throw new RulesPackError(
            `${operationPath}.effects references unknown effect ${JSON.stringify(effectId)}`,
          );
      }
    });
    for (const [operationId, parsed] of operations) {
      for (const excluded of parsed.excludes ?? []) {
        if (!operations.has(excluded))
          throw new RulesPackError(
            `${path}.operations.${operationId}.excludes references unknown operation ${JSON.stringify(excluded)}`,
          );
        if (excluded === operationId)
          throw new RulesPackError(
            `${path}.operations.${operationId}.excludes cannot reference itself`,
          );
      }
    }
  }

  if (mechanics.stateMachine !== undefined)
    stateMachine(
      mechanics.stateMachine,
      `${path}.stateMachine`,
      effectIds,
      new Set(operations.keys()),
    );
  if (mechanics.entityGrant !== undefined) {
    entityGrant(mechanics.entityGrant, `${path}.entityGrant`, economies);
  }
  if (mechanics.containment !== undefined)
    containment(mechanics.containment, `${path}.containment`);
  if (mechanics.curse !== undefined)
    curse(
      mechanics.curse,
      `${path}.curse`,
      effectIds,
      new Set(operations.keys()),
    );
  if (mechanics.randomProcedure !== undefined)
    randomProcedure(mechanics.randomProcedure, `${path}.randomProcedure`);
  if (mechanics.spellStore !== undefined)
    spellStore(
      mechanics.spellStore,
      `${path}.spellStore`,
      new Set(operations.keys()),
    );
  if (mechanics.rollManipulation !== undefined) {
    rollManipulation(
      mechanics.rollManipulation,
      `${path}.rollManipulation`,
      economies,
      new Set(operations.keys()),
    );
  }
  if (mechanics.interItem !== undefined)
    interItem(mechanics.interItem, `${path}.interItem`);
}

/** Pure implementation of the stateful-singleton invariant from PR #408. */
export function isStatefulMagicItemMechanics(
  mechanics: unknown,
  requiresAttunement = false,
): boolean {
  if (requiresAttunement) return true;
  if (
    typeof mechanics !== 'object' ||
    mechanics === null ||
    Array.isArray(mechanics)
  )
    return false;
  const value = mechanics as Obj;
  if (
    value.stateMachine !== undefined ||
    value.spellStore !== undefined ||
    value.curse !== undefined
  ) {
    return true;
  }
  if (typeof value.containment === 'object' && value.containment !== null) {
    if ((value.containment as Obj).tracksOccupancy === true) return true;
  }
  if (typeof value.entityGrant === 'object' && value.entityGrant !== null) {
    const grants = (value.entityGrant as Obj).grants;
    if (
      Array.isArray(grants) &&
      grants.some(
        (grant) =>
          typeof grant === 'object' &&
          grant !== null &&
          !Array.isArray(grant) &&
          (grant as Obj).cooldownEconomy !== undefined,
      )
    )
      return true;
  }
  if (
    typeof value.economies !== 'object' ||
    value.economies === null ||
    Array.isArray(value.economies)
  )
    return false;
  return Object.values(value.economies as Obj).some((entry) => {
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry))
      return true;
    const kind = (entry as Obj).kind;
    return kind !== 'at-will' && kind !== 'single-use';
  });
}
