import type { Db } from '../persistence/db.js';
import { withTransaction } from '../persistence/db.js';
import { jsonColumn } from '../persistence/jsonColumn.js';
import {
  isStatefulMagicItemMechanics,
  type MagicItemDurationSpec,
} from '../rules/magicItemMechanics.js';
import type { RulesRecord } from '../rules/types.js';
import {
  type CampaignRulesPackResolver,
  lookupStrictCampaignRecord,
} from './campaignRecordLookup.js';

type Obj = Record<string, unknown>;

export interface ItemEconomyState {
  readonly remaining: number;
  readonly availableAt?: string;
  readonly lastReset?: string;
}

export interface ItemInstanceState {
  readonly packRef: string;
  readonly attunedTo?: string;
  readonly economies?: Readonly<Record<string, ItemEconomyState>>;
  readonly machineState?: string;
  readonly storedSpells?: readonly {
    readonly spellRef: string;
    readonly level: number;
    readonly saveDc: number;
    readonly attackMod: number;
  }[];
  readonly curse?: { readonly attached: boolean; readonly revealed: boolean };
  readonly custom?: Readonly<Record<string, unknown>>;
}

export interface UseItemInput {
  readonly campaignId: string;
  readonly instanceId: string;
  readonly operationId: string;
  readonly args?: Readonly<Record<string, unknown>>;
  readonly characterId: string;
  readonly resolveRulesPack?: CampaignRulesPackResolver;
  readonly provenance: string;
  readonly sessionId: string;
  readonly at: string;
}

export interface UseItemResult {
  readonly instanceId: string;
  readonly packRef: string;
  readonly operationId: string;
  readonly costs: readonly {
    readonly economy: string;
    readonly amount: number;
  }[];
  readonly effects: readonly unknown[];
  readonly transition?: {
    readonly from: string;
    readonly to: string;
    readonly outcome: 'success' | 'failure';
    readonly onFailure?: {
      readonly retryAfter: MagicItemDurationSpec;
      readonly scope: 'actor' | 'target' | 'item';
      readonly to?: string;
      readonly note?: string;
    };
    /** Timer transitions now pending from the resulting state. Execution is
     * owned by the future F5/F7 scheduler/reset boundary. */
    readonly pendingTimers?: readonly {
      readonly to: string;
      readonly timer: MagicItemDurationSpec;
    }[];
    readonly duration?: MagicItemDurationSpec;
  };
  readonly state?: ItemInstanceState;
  readonly quantity?: number;
  readonly consumed: boolean;
}

export class ItemStateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ItemStateError';
  }
}

const stateColumn = jsonColumn<unknown>('item_state.state_json');
const PACK_REF = /^magic-item:[a-z0-9]+(?:-[a-z0-9]+)*$/;

function obj(value: unknown, path: string): Obj {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new ItemStateError(`${path} must be an object`);
  }
  return value as Obj;
}

function onlyKeys(value: Obj, allowed: readonly string[], path: string): void {
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) {
      throw new ItemStateError(`${path} contains unsupported key '${key}'`);
    }
  }
}

export function validatePackRef(value: unknown, path = 'packRef'): string {
  if (typeof value !== 'string' || !PACK_REF.test(value)) {
    throw new ItemStateError(
      `${path} must be a canonical magic-item:<slug> ref`,
    );
  }
  return value;
}

/** Structural validation used at every JSON read boundary. Pack licensing is
 * additionally checked by validateItemStateForRecord at semantic writes. */
export function validateItemStateJson(
  value: unknown,
  path = 'item_state.state_json',
): ItemInstanceState {
  const state = obj(value, path);
  onlyKeys(
    state,
    [
      'packRef',
      'attunedTo',
      'economies',
      'machineState',
      'storedSpells',
      'curse',
      'custom',
    ],
    path,
  );
  validatePackRef(state.packRef, `${path}.packRef`);
  if (
    state.attunedTo !== undefined &&
    (typeof state.attunedTo !== 'string' || state.attunedTo.length === 0)
  ) {
    throw new ItemStateError(`${path}.attunedTo must be a non-empty string`);
  }
  if (
    state.machineState !== undefined &&
    (typeof state.machineState !== 'string' || state.machineState.length === 0)
  ) {
    throw new ItemStateError(`${path}.machineState must be a non-empty string`);
  }
  if (state.economies !== undefined) {
    const economies = obj(state.economies, `${path}.economies`);
    for (const [id, raw] of Object.entries(economies)) {
      if (id.length === 0)
        throw new ItemStateError(`${path}.economies contains an empty id`);
      const economy = obj(raw, `${path}.economies.${id}`);
      onlyKeys(
        economy,
        ['remaining', 'availableAt', 'lastReset'],
        `${path}.economies.${id}`,
      );
      if (
        typeof economy.remaining !== 'number' ||
        !Number.isFinite(economy.remaining) ||
        economy.remaining < 0
      ) {
        throw new ItemStateError(
          `${path}.economies.${id}.remaining must be a finite non-negative number`,
        );
      }
      for (const key of ['availableAt', 'lastReset'] as const) {
        if (economy[key] !== undefined && typeof economy[key] !== 'string') {
          throw new ItemStateError(
            `${path}.economies.${id}.${key} must be a string`,
          );
        }
      }
    }
  }
  if (state.storedSpells !== undefined) {
    if (!Array.isArray(state.storedSpells))
      throw new ItemStateError(`${path}.storedSpells must be an array`);
    state.storedSpells.forEach((raw, index) => {
      const spell = obj(raw, `${path}.storedSpells[${index}]`);
      onlyKeys(
        spell,
        ['spellRef', 'level', 'saveDc', 'attackMod'],
        `${path}.storedSpells[${index}]`,
      );
      if (
        typeof spell.spellRef !== 'string' ||
        !spell.spellRef.startsWith('spell:')
      )
        throw new ItemStateError(
          `${path}.storedSpells[${index}].spellRef must be a spell ref`,
        );
      for (const key of ['level', 'saveDc', 'attackMod'] as const) {
        if (!Number.isInteger(spell[key]))
          throw new ItemStateError(
            `${path}.storedSpells[${index}].${key} must be an integer`,
          );
      }
    });
  }
  if (state.curse !== undefined) {
    const curse = obj(state.curse, `${path}.curse`);
    onlyKeys(curse, ['attached', 'revealed'], `${path}.curse`);
    if (
      typeof curse.attached !== 'boolean' ||
      typeof curse.revealed !== 'boolean'
    )
      throw new ItemStateError(
        `${path}.curse must contain boolean attached and revealed fields`,
      );
  }
  if (state.custom !== undefined) obj(state.custom, `${path}.custom`);
  return state as unknown as ItemInstanceState;
}

function mechanicsFor(record: RulesRecord): Obj {
  const data = obj(record.data, `${record.key}.data`);
  return data.mechanics === undefined
    ? {}
    : obj(data.mechanics, `${record.key}.data.mechanics`);
}

function licensesStoredSpells(mechanics: Obj): boolean {
  if (mechanics.spellStore === undefined) return false;
  const spellStore = obj(mechanics.spellStore, 'mechanics.spellStore');
  return (
    Array.isArray(spellStore.contracts) &&
    spellStore.contracts.some(
      (raw) =>
        obj(raw, 'mechanics.spellStore.contracts[]').kind === 'spell-storage',
    )
  );
}

function validateCardPoolCustomState(
  raw: Readonly<Record<string, unknown>>,
  declaration: Obj,
  packRef: string,
): void {
  const path = 'item_state.state_json.custom';
  onlyKeys(
    raw as Obj,
    ['variantId', 'remainingCardIds', 'returnedCardIds'],
    path,
  );
  if (typeof raw.variantId !== 'string' || raw.variantId.length === 0)
    throw new ItemStateError(`${path}.variantId must be a non-empty string`);
  const variants = Array.isArray(declaration.variants)
    ? declaration.variants.map((value, index) =>
        obj(
          value,
          `${packRef}.mechanics.randomProcedure.customState.variants[${index}]`,
        ),
      )
    : [];
  if (!variants.some((variant) => variant.id === raw.variantId))
    throw new ItemStateError(
      `${path}.variantId '${raw.variantId}' is not declared by ${packRef}`,
    );
  const allowed = new Set(
    Array.isArray(declaration.allowedCardIds)
      ? declaration.allowedCardIds.filter(
          (cardId): cardId is string => typeof cardId === 'string',
        )
      : [],
  );
  const nonReturning = new Set(
    Array.isArray(declaration.nonReturningCardIds)
      ? declaration.nonReturningCardIds.filter(
          (cardId): cardId is string => typeof cardId === 'string',
        )
      : [],
  );
  const lists = new Map<string, string[]>();
  for (const field of ['remainingCardIds', 'returnedCardIds'] as const) {
    const value = raw[field];
    if (
      !Array.isArray(value) ||
      !value.every((entry) => typeof entry === 'string')
    )
      throw new ItemStateError(`${path}.${field} must be a string array`);
    const cards = value as string[];
    if (new Set(cards).size !== cards.length)
      throw new ItemStateError(`${path}.${field} must contain unique card ids`);
    for (const cardId of cards)
      if (!allowed.has(cardId))
        throw new ItemStateError(
          `${path}.${field} contains card '${cardId}' not declared by ${packRef}`,
        );
    lists.set(field, cards);
  }
  const remaining = new Set(lists.get('remainingCardIds'));
  for (const cardId of lists.get('returnedCardIds') ?? []) {
    if (!remaining.has(cardId))
      throw new ItemStateError(
        `${path}.returnedCardIds card '${cardId}' must also be remaining`,
      );
    if (nonReturning.has(cardId))
      throw new ItemStateError(
        `${path}.returnedCardIds cannot contain non-returning card '${cardId}'`,
      );
  }
}

export function isStatefulMagicItem(record: RulesRecord): boolean {
  const data = obj(record.data, `${record.key}.data`);
  return isStatefulMagicItemMechanics(
    data.mechanics,
    data.requiresAttunement === true,
  );
}

function durationMinutes(raw: unknown): number | undefined {
  const duration = obj(raw, 'duration');
  // Rolled durations stay unresolved until a seeded engine transition rolls
  // the pack-declared expression. Never replace source dice with an average or
  // other numeric placeholder during state initialization.
  if (typeof duration.amount === 'string') return undefined;
  if (
    typeof duration.amount !== 'number' ||
    !Number.isFinite(duration.amount) ||
    duration.amount < 0 ||
    typeof duration.unit !== 'string'
  )
    return undefined;
  const multiplier: Record<string, number> = {
    round: 0.1,
    minute: 1,
    hour: 60,
    day: 1440,
  };
  return multiplier[duration.unit] === undefined
    ? undefined
    : duration.amount * multiplier[duration.unit];
}

function initialRemaining(raw: unknown): number | undefined {
  const economy = obj(raw, 'item economy');
  if (economy.kind === 'charges') {
    const charges = obj(economy.charges, 'item economy.charges');
    return typeof charges.max === 'number' ? charges.max : undefined;
  }
  if (economy.kind === 'per-day') {
    const perDay = obj(economy.perDay, 'item economy.perDay');
    return typeof perDay.uses === 'number' ? perDay.uses : undefined;
  }
  if (economy.kind === 'budget')
    return durationMinutes(obj(economy.budget, 'item economy.budget').total);
  if (economy.kind === 'doses') {
    const doses = obj(economy.doses, 'item economy.doses');
    return typeof doses.count === 'number' ? doses.count : undefined;
  }
  if (economy.kind === 'cooldown') return 1;
  return undefined;
}

export function createInitialItemState(
  packRef: string,
  record: RulesRecord,
): ItemInstanceState {
  const mechanics = mechanicsFor(record);
  const stateEconomies: Record<string, ItemEconomyState> = {};
  if (mechanics.economies !== undefined) {
    for (const [id, raw] of Object.entries(
      obj(mechanics.economies, 'mechanics.economies'),
    )) {
      const remaining = initialRemaining(raw);
      if (remaining !== undefined) stateEconomies[id] = { remaining };
    }
  }
  const state: ItemInstanceState = {
    packRef,
    ...(Object.keys(stateEconomies).length === 0
      ? {}
      : { economies: stateEconomies }),
    ...(mechanics.stateMachine === undefined
      ? {}
      : {
          machineState: String(
            obj(mechanics.stateMachine, 'mechanics.stateMachine').initial,
          ),
        }),
  };
  return validateItemStateForRecord(state, packRef, record);
}

export function validateItemStateForRecord(
  value: unknown,
  packRef: string,
  record: RulesRecord,
): ItemInstanceState {
  const state = validateItemStateJson(value);
  if (state.packRef !== packRef)
    throw new ItemStateError(
      `item state packRef '${state.packRef}' does not match inventory packRef '${packRef}'`,
    );
  const data = obj(record.data, `${record.key}.data`);
  const mechanics = mechanicsFor(record);
  const declaredEconomies =
    mechanics.economies === undefined
      ? {}
      : obj(mechanics.economies, 'mechanics.economies');
  for (const id of Object.keys(state.economies ?? {})) {
    if (declaredEconomies[id] === undefined)
      throw new ItemStateError(
        `item state economy '${id}' is not declared by ${packRef}`,
      );
  }
  if (state.attunedTo !== undefined && data.requiresAttunement !== true)
    throw new ItemStateError(`${packRef} does not license attunedTo state`);
  if (mechanics.stateMachine === undefined) {
    if (state.machineState !== undefined)
      throw new ItemStateError(`${packRef} does not license machineState`);
  } else {
    const machine = obj(
      mechanics.stateMachine,
      `${packRef}.mechanics.stateMachine`,
    );
    if (state.machineState === undefined)
      throw new ItemStateError(`${packRef} requires machineState`);
    const declaredStates = Array.isArray(machine.states)
      ? machine.states.map((raw, index) =>
          obj(raw, `${packRef}.mechanics.stateMachine.states[${index}]`),
        )
      : [];
    if (!declaredStates.some(({ id }) => id === state.machineState))
      throw new ItemStateError(
        `${packRef} machineState '${state.machineState}' is not declared`,
      );
  }
  if (state.storedSpells !== undefined && !licensesStoredSpells(mechanics))
    throw new ItemStateError(
      `${packRef} does not license storedSpells through a spell-storage contract`,
    );
  if (state.curse !== undefined && mechanics.curse === undefined)
    throw new ItemStateError(`${packRef} does not license curse state`);
  if (state.custom !== undefined) {
    const randomProcedure =
      mechanics.randomProcedure === undefined
        ? undefined
        : obj(
            mechanics.randomProcedure,
            `${packRef}.mechanics.randomProcedure`,
          );
    const declaration =
      randomProcedure?.customState === undefined
        ? undefined
        : obj(
            randomProcedure.customState,
            `${packRef}.mechanics.randomProcedure.customState`,
          );
    if (declaration?.kind !== 'card-pool')
      throw new ItemStateError(
        `${packRef} does not declare a validated custom state shape`,
      );
    validateCardPoolCustomState(state.custom, declaration, packRef);
  }
  return state;
}

export function writeItemState(
  db: Db,
  inventoryId: string,
  state: ItemInstanceState,
  ctx: Pick<UseItemInput, 'provenance' | 'sessionId' | 'at'>,
): void {
  const row = db
    .prepare('SELECT quantity FROM inventory WHERE id = ?')
    .get(inventoryId) as { quantity: number } | undefined;
  if (row === undefined)
    throw new ItemStateError(`inventory item '${inventoryId}' does not exist`);
  if (row.quantity !== 1)
    throw new ItemStateError(
      `stateful item '${inventoryId}' must have quantity 1`,
    );
  db.prepare(`INSERT INTO item_state(inventory_id, state_json, provenance, session_id, updated_at)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(inventory_id) DO UPDATE SET state_json=excluded.state_json, provenance=excluded.provenance, session_id=excluded.session_id, updated_at=excluded.updated_at`).run(
    inventoryId,
    stateColumn.encode(state),
    ctx.provenance,
    ctx.sessionId,
    ctx.at,
  );
}

export function readItemState(
  db: Db,
  inventoryId: string,
): ItemInstanceState | undefined {
  const row = db
    .prepare('SELECT state_json FROM item_state WHERE inventory_id = ?')
    .get(inventoryId) as { state_json: string } | undefined;
  return row === undefined
    ? undefined
    : validateItemStateJson(
        stateColumn.decode(row.state_json),
        `item_state[${inventoryId}].state_json`,
      );
}

function validateRecordReferences(
  mechanics: Obj,
  packRef: string,
): { operations: Obj[]; effects: Map<string, unknown>; economies: Obj } {
  const economies =
    mechanics.economies === undefined
      ? {}
      : obj(mechanics.economies, `${packRef}.mechanics.economies`);
  const rawOperations = mechanics.operations ?? [];
  if (!Array.isArray(rawOperations))
    throw new ItemStateError(
      `${packRef}.mechanics.operations must be an array`,
    );
  const operations = rawOperations.map((raw, index) =>
    obj(raw, `${packRef}.mechanics.operations[${index}]`),
  );
  const operationIds = new Set(
    operations.map((operation) => String(operation.id)),
  );
  const effects = new Map<string, unknown>();
  if (mechanics.effects !== undefined) {
    if (!Array.isArray(mechanics.effects))
      throw new ItemStateError(`${packRef}.mechanics.effects must be an array`);
    for (const raw of mechanics.effects) {
      const effect = obj(raw, `${packRef}.mechanics.effects[]`);
      if (typeof effect.id === 'string') effects.set(effect.id, raw);
    }
  }
  for (const operation of operations) {
    if (typeof operation.id !== 'string' || operation.id.length === 0)
      throw new ItemStateError(
        `${packRef} contains an operation without an id`,
      );
    for (const rawCost of Array.isArray(operation.cost) ? operation.cost : []) {
      const cost = obj(rawCost, `${packRef} operation '${operation.id}' cost`);
      if (
        typeof cost.economy !== 'string' ||
        economies[cost.economy] === undefined
      )
        throw new ItemStateError(
          `${packRef} operation '${operation.id}' references undeclared economy '${String(cost.economy)}'`,
        );
    }
    for (const excluded of Array.isArray(operation.excludes)
      ? operation.excludes
      : [])
      if (typeof excluded !== 'string' || !operationIds.has(excluded))
        throw new ItemStateError(
          `${packRef} operation '${operation.id}' excludes undeclared operation '${String(excluded)}'`,
        );
    for (const id of Array.isArray(operation.doesNotExpend)
      ? operation.doesNotExpend
      : [])
      if (typeof id !== 'string' || economies[id] === undefined)
        throw new ItemStateError(
          `${packRef} operation '${operation.id}' references undeclared non-expenditure economy '${String(id)}'`,
        );
    for (const id of Array.isArray(operation.effects) ? operation.effects : [])
      if (typeof id !== 'string' || !effects.has(id))
        throw new ItemStateError(
          `${packRef} operation '${operation.id}' references undeclared effect '${String(id)}'`,
        );
  }
  return { operations, effects, economies };
}

interface SelectedStateTransition {
  readonly nextState: string;
  readonly effectIds: readonly string[];
  readonly result: NonNullable<UseItemResult['transition']>;
}

function selectStateTransition(
  mechanics: Obj,
  packRef: string,
  operationId: string,
  args: Readonly<Record<string, unknown>> | undefined,
  currentState: string | undefined,
): SelectedStateTransition | undefined {
  if (mechanics.stateMachine === undefined) {
    if (
      args?.transitionTo !== undefined ||
      args?.transitionOutcome !== undefined
    )
      throw new ItemStateError(
        `${packRef} operation '${operationId}' does not declare a state transition`,
      );
    return undefined;
  }
  const machine = obj(
    mechanics.stateMachine,
    `${packRef}.mechanics.stateMachine`,
  );
  if (currentState === undefined)
    throw new ItemStateError(`${packRef} has no initialized machineState`);
  if (!Array.isArray(machine.transitions))
    throw new ItemStateError(
      `${packRef}.mechanics.stateMachine.transitions must be an array`,
    );
  const transitions = machine.transitions.map((raw, index) =>
    obj(raw, `${packRef}.mechanics.stateMachine.transitions[${index}]`),
  );
  const operationTransitions = transitions.filter(
    ({ via }) => via === operationId,
  );
  if (operationTransitions.length === 0) {
    if (
      args?.transitionTo !== undefined ||
      args?.transitionOutcome !== undefined
    )
      throw new ItemStateError(
        `${packRef} operation '${operationId}' does not declare a state transition`,
      );
    return undefined;
  }
  const currentCandidates = operationTransitions.filter(
    ({ from }) => from === currentState,
  );
  if (currentCandidates.length === 0)
    throw new ItemStateError(
      `${packRef} operation '${operationId}' is invalid from machineState '${currentState}'`,
    );

  const rawOutcome = args?.transitionOutcome;
  if (
    rawOutcome !== undefined &&
    rawOutcome !== 'success' &&
    rawOutcome !== 'failure'
  )
    throw new ItemStateError(
      `args.transitionOutcome must be 'success' or 'failure'`,
    );
  const outcome = rawOutcome ?? 'success';
  const rawTransitionTo = args?.transitionTo;
  if (
    rawTransitionTo !== undefined &&
    (typeof rawTransitionTo !== 'string' || rawTransitionTo.length === 0)
  )
    throw new ItemStateError(
      'args.transitionTo must be a non-empty declared state id',
    );

  const candidates = currentCandidates.flatMap((transition) => {
    if (outcome === 'success')
      return typeof transition.to === 'string'
        ? [{ transition, destination: transition.to }]
        : [];
    if (transition.onFailure === undefined) return [];
    const failure = obj(
      transition.onFailure,
      `${packRef} operation '${operationId}' onFailure`,
    );
    return typeof failure.to === 'string'
      ? [{ transition, destination: failure.to }]
      : [];
  });
  if (candidates.length === 0)
    throw new ItemStateError(
      `${packRef} operation '${operationId}' declares no '${outcome}' transition from '${currentState}'`,
    );
  if (candidates.length > 1 && rawTransitionTo === undefined)
    throw new ItemStateError(
      `${packRef} operation '${operationId}' has multiple transitions from '${currentState}'; args.transitionTo is required`,
    );
  const matching =
    rawTransitionTo === undefined
      ? candidates
      : candidates.filter(({ destination }) => destination === rawTransitionTo);
  if (matching.length !== 1)
    throw new ItemStateError(
      `${packRef} operation '${operationId}' has no unambiguous '${outcome}' transition from '${currentState}' to '${String(rawTransitionTo)}'`,
    );
  const selected = matching[0];
  const failure =
    selected.transition.onFailure === undefined
      ? undefined
      : (selected.transition.onFailure as NonNullable<
          NonNullable<UseItemResult['transition']>['onFailure']
        >);
  const pendingTimers = transitions.flatMap((transition) =>
    transition.from === selected.destination &&
    typeof transition.to === 'string' &&
    transition.timer !== undefined
      ? [
          {
            to: transition.to,
            timer: transition.timer as MagicItemDurationSpec,
          },
        ]
      : [],
  );
  return {
    nextState: selected.destination,
    effectIds: Array.isArray(selected.transition.effects)
      ? (selected.transition.effects as string[])
      : [],
    result: {
      from: currentState,
      to: selected.destination,
      outcome,
      ...(failure === undefined ? {} : { onFailure: failure }),
      ...(pendingTimers.length === 0 ? {} : { pendingTimers }),
      ...(machine.duration === undefined
        ? {}
        : { duration: machine.duration as MagicItemDurationSpec }),
    },
  };
}

function costAmount(
  raw: unknown,
  economyId: string,
  args: Readonly<Record<string, unknown>> | undefined,
): number {
  if (typeof raw === 'number' && Number.isInteger(raw) && raw > 0) return raw;
  if (raw === 'variable') {
    const costs = args?.costs;
    if (typeof costs === 'object' && costs !== null && !Array.isArray(costs)) {
      const amount = (costs as Obj)[economyId];
      if (typeof amount === 'number' && Number.isInteger(amount) && amount > 0)
        return amount;
    }
    throw new ItemStateError(
      `operation requires args.costs.${economyId} as a positive integer`,
    );
  }
  throw new ItemStateError(
    `economy '${economyId}' has a dice-derived or invalid operation cost; initialize/resolve it through a seeded semantic path`,
  );
}

export function useItem(db: Db, input: UseItemInput): UseItemResult {
  return withTransaction(db, (txnDb) => {
    const row = txnDb
      .prepare(
        'SELECT id, pack_ref, quantity FROM inventory WHERE id = ? AND character_id = ?',
      )
      .get(input.instanceId, input.characterId) as
      | { id: string; pack_ref: string | null; quantity: number }
      | undefined;
    if (row === undefined)
      throw new ItemStateError(
        `character '${input.characterId}' holds no inventory instance '${input.instanceId}'`,
      );
    if (row.pack_ref === null)
      throw new ItemStateError(
        `inventory instance '${input.instanceId}' is not bound to a rules-pack item`,
      );
    const packRef = validatePackRef(row.pack_ref, 'inventory.pack_ref');
    const hit = lookupStrictCampaignRecord(
      txnDb,
      'magic-item',
      packRef,
      input.resolveRulesPack,
    );
    if (hit === undefined)
      throw new ItemStateError(
        `inventory packRef '${packRef}' does not resolve in the active campaign rules stack`,
      );
    const mechanics = mechanicsFor(hit.record);
    const refs = validateRecordReferences(mechanics, packRef);
    let operation = refs.operations.find(
      (candidate) => candidate.id === input.operationId,
    );
    if (
      operation === undefined &&
      (input.operationId === 'activate' || input.operationId === 'deactivate')
    ) {
      const machine =
        mechanics.stateMachine === undefined
          ? undefined
          : obj(mechanics.stateMachine, `${packRef}.mechanics.stateMachine`);
      if (
        Array.isArray(machine?.transitions) &&
        machine.transitions.some(
          (raw) =>
            obj(raw, `${packRef}.mechanics.stateMachine.transitions[]`).via ===
            input.operationId,
        )
      )
        operation = { id: input.operationId };
    }
    if (operation === undefined)
      throw new ItemStateError(
        `${packRef} declares no operation '${input.operationId}'`,
      );
    const stateful = isStatefulMagicItem(hit.record);
    if (stateful && row.quantity !== 1)
      throw new ItemStateError(
        `stateful item '${input.instanceId}' must have quantity 1`,
      );
    let state = readItemState(txnDb, input.instanceId);
    if (stateful && state === undefined) {
      state = createInitialItemState(packRef, hit.record);
      writeItemState(txnDb, input.instanceId, state, input);
    }
    if (state !== undefined)
      state = validateItemStateForRecord(state, packRef, hit.record);

    const selectedTransition = selectStateTransition(
      mechanics,
      packRef,
      input.operationId,
      input.args,
      state?.machineState,
    );

    const costs: { economy: string; amount: number }[] = [];
    let singleUse = 0;
    const nextEconomies: Record<string, ItemEconomyState> = {
      ...(state?.economies ?? {}),
    };
    for (const rawCost of Array.isArray(operation.cost) ? operation.cost : []) {
      const cost = obj(rawCost, 'operation cost');
      const economyId = String(cost.economy);
      const amount = costAmount(cost.amount, economyId, input.args);
      const economy = obj(refs.economies[economyId], `economy '${economyId}'`);
      costs.push({ economy: economyId, amount });
      if (economy.kind === 'at-will') continue;
      if (economy.kind === 'single-use') {
        singleUse += amount;
        continue;
      }
      const current = nextEconomies[economyId];
      if (current === undefined)
        throw new ItemStateError(
          `economy '${economyId}' is not initialized; its maximum is dice-derived and must be initialized through a seeded semantic path`,
        );
      if (current.remaining < amount)
        throw new ItemStateError(
          `insufficient ${economyId}: ${current.remaining} remaining, ${amount} required`,
        );
      nextEconomies[economyId] = {
        ...current,
        remaining: current.remaining - amount,
      };
    }
    if (singleUse > row.quantity)
      throw new ItemStateError(
        `insufficient inventory quantity: ${row.quantity} remaining, ${singleUse} required`,
      );

    let quantity = row.quantity;
    let consumed = false;
    if (singleUse > 0) {
      quantity -= singleUse;
      consumed = true;
      if (quantity === 0)
        txnDb
          .prepare('DELETE FROM inventory WHERE id = ?')
          .run(input.instanceId);
      else
        txnDb
          .prepare(
            'UPDATE inventory SET quantity=?, provenance=?, session_id=?, updated_at=? WHERE id=?',
          )
          .run(
            quantity,
            input.provenance,
            input.sessionId,
            input.at,
            input.instanceId,
          );
    } else if (state !== undefined) {
      state = validateItemStateForRecord(
        {
          ...state,
          economies: nextEconomies,
          ...(selectedTransition === undefined
            ? {}
            : { machineState: selectedTransition.nextState }),
        },
        packRef,
        hit.record,
      );
      writeItemState(txnDb, input.instanceId, state, input);
    }
    const effectIds = [
      ...(Array.isArray(operation.effects)
        ? (operation.effects as string[])
        : []),
      ...(selectedTransition?.effectIds ?? []),
    ];
    return {
      instanceId: input.instanceId,
      packRef,
      operationId: input.operationId,
      costs,
      effects: effectIds.map((id) => refs.effects.get(id)),
      ...(selectedTransition === undefined
        ? {}
        : { transition: selectedTransition.result }),
      ...(quantity === 0 ? {} : { quantity }),
      ...(state === undefined || quantity === 0 ? {} : { state }),
      consumed,
    };
  });
}
