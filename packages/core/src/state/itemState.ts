import { rollDice } from '../orchestrator/dice.js';
import type { Rng } from '../orchestrator/rng.js';
import type { Db } from '../persistence/db.js';
import { withTransaction } from '../persistence/db.js';
import { jsonColumn } from '../persistence/jsonColumn.js';
import {
  isStatefulMagicItemMechanics,
  type MagicItemDurationSpec,
} from '../rules/magicItemMechanics.js';
import {
  effectiveMagicItemMechanics,
  MagicItemVariantError,
  resolveMagicItemVariant,
} from '../rules/magicItemVariants.js';
import type { RulesRecord } from '../rules/types.js';
import {
  type CampaignRulesPackResolver,
  lookupStrictCampaignRecord,
} from './campaignRecordLookup.js';
import {
  ItemDepletionError,
  type ItemDepletionResolution,
  resolveItemDepletion,
} from './itemDepletion.js';
import {
  assertMagicItemOperationReady,
  ItemExecutionReadinessError,
} from './itemExecutionReadiness.js';

type Obj = Record<string, unknown>;

export interface ItemEconomyState {
  readonly remaining: number;
  readonly availableAt?: string;
  readonly lastReset?: string;
}

export interface ItemInstanceState {
  readonly packRef: string;
  readonly variantId?: string;
  readonly economies?: Readonly<Record<string, ItemEconomyState>>;
  readonly machineState?: string;
  readonly storedSpells?: readonly {
    readonly spellRef: string;
    readonly level: number;
    readonly saveDc: number;
    readonly attackMod: number;
  }[];
  readonly spellStoreLevels?: Readonly<Record<string, number>>;
  readonly curse?: { readonly attached: boolean; readonly revealed: boolean };
  readonly custom?: Readonly<Record<string, unknown>>;
  readonly initializationRolls?: readonly {
    readonly purpose: string;
    readonly notation: string;
    readonly rolls: readonly number[];
    readonly total: number;
  }[];
  readonly depletions?: readonly ItemDepletionResolution[];
  readonly lifecycle?: {
    readonly status: 'consumed' | 'inert' | 'nonmagical';
    readonly pendingTerminal?: 'destroyed';
  };
  readonly pendingTimers?: readonly {
    readonly from: string;
    readonly to: string;
    readonly startedAt: string;
    readonly amount: number;
    readonly unit: 'round' | 'minute' | 'hour' | 'day';
    readonly dueAt?: string;
    readonly roll?: {
      readonly notation: string;
      readonly rolls: readonly number[];
      readonly total: number;
    };
  }[];
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
  readonly rng?: Rng;
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
      'variantId',
      'economies',
      'machineState',
      'storedSpells',
      'spellStoreLevels',
      'curse',
      'custom',
      'initializationRolls',
      'depletions',
      'lifecycle',
      'pendingTimers',
    ],
    path,
  );
  validatePackRef(state.packRef, `${path}.packRef`);
  if (
    state.variantId !== undefined &&
    (typeof state.variantId !== 'string' ||
      !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(state.variantId))
  )
    throw new ItemStateError(`${path}.variantId must be canonical kebab-case`);
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
  if (state.spellStoreLevels !== undefined) {
    const levels = obj(state.spellStoreLevels, `${path}.spellStoreLevels`);
    for (const [contractId, value] of Object.entries(levels))
      if (
        contractId.length === 0 ||
        !Number.isInteger(value) ||
        (value as number) < 0
      )
        throw new ItemStateError(
          `${path}.spellStoreLevels must map non-empty contract ids to non-negative integers`,
        );
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
  if (state.initializationRolls !== undefined) {
    if (!Array.isArray(state.initializationRolls))
      throw new ItemStateError(`${path}.initializationRolls must be an array`);
    state.initializationRolls.forEach((raw, index) => {
      const roll = obj(raw, `${path}.initializationRolls[${index}]`);
      onlyKeys(
        roll,
        ['purpose', 'notation', 'rolls', 'total'],
        `${path}.initializationRolls[${index}]`,
      );
      if (typeof roll.purpose !== 'string' || roll.purpose.length === 0)
        throw new ItemStateError(
          `${path}.initializationRolls[${index}].purpose must be non-empty`,
        );
      if (typeof roll.notation !== 'string' || roll.notation.length === 0)
        throw new ItemStateError(
          `${path}.initializationRolls[${index}].notation must be non-empty`,
        );
      if (
        !Array.isArray(roll.rolls) ||
        !roll.rolls.every((value) => Number.isInteger(value) && value > 0)
      )
        throw new ItemStateError(
          `${path}.initializationRolls[${index}].rolls must be positive integers`,
        );
      if (!Number.isInteger(roll.total))
        throw new ItemStateError(
          `${path}.initializationRolls[${index}].total must be an integer`,
        );
    });
  }
  if (state.depletions !== undefined) {
    if (!Array.isArray(state.depletions))
      throw new ItemStateError(`${path}.depletions must be an array`);
    state.depletions.forEach((raw, index) => {
      const depletion = obj(raw, `${path}.depletions[${index}]`);
      onlyKeys(
        depletion,
        ['economyId', 'rolls', 'regain', 'loseProperty', 'becomes'],
        `${path}.depletions[${index}]`,
      );
      if (
        typeof depletion.economyId !== 'string' ||
        depletion.economyId.length === 0 ||
        !Array.isArray(depletion.rolls) ||
        typeof depletion.loseProperty !== 'boolean'
      )
        throw new ItemStateError(
          `${path}.depletions[${index}] has an invalid resolution shape`,
        );
      for (const [rollIndex, rawRoll] of depletion.rolls.entries()) {
        const roll = obj(
          rawRoll,
          `${path}.depletions[${index}].rolls[${rollIndex}]`,
        );
        onlyKeys(
          roll,
          ['purpose', 'notation', 'rolls', 'total'],
          `${path}.depletions[${index}].rolls[${rollIndex}]`,
        );
        if (
          (roll.purpose !== 'depletion' && roll.purpose !== 'regain') ||
          typeof roll.notation !== 'string' ||
          !Array.isArray(roll.rolls) ||
          !roll.rolls.every((value) => Number.isInteger(value) && value > 0) ||
          !Number.isInteger(roll.total)
        )
          throw new ItemStateError(
            `${path}.depletions[${index}].rolls[${rollIndex}] is invalid`,
          );
      }
      if (
        depletion.regain !== undefined &&
        (typeof depletion.regain !== 'number' ||
          !Number.isInteger(depletion.regain) ||
          depletion.regain < 0)
      )
        throw new ItemStateError(
          `${path}.depletions[${index}].regain must be a non-negative integer`,
        );
      if (
        depletion.becomes !== undefined &&
        depletion.becomes !== 'destroyed' &&
        depletion.becomes !== 'inert' &&
        depletion.becomes !== 'nonmagical' &&
        (typeof depletion.becomes !== 'object' ||
          depletion.becomes === null ||
          Array.isArray(depletion.becomes) ||
          typeof (depletion.becomes as Obj).itemRef !== 'string')
      )
        throw new ItemStateError(
          `${path}.depletions[${index}].becomes is invalid`,
        );
    });
  }
  if (state.lifecycle !== undefined) {
    const lifecycle = obj(state.lifecycle, `${path}.lifecycle`);
    onlyKeys(lifecycle, ['status', 'pendingTerminal'], `${path}.lifecycle`);
    if (
      lifecycle.status !== 'consumed' &&
      lifecycle.status !== 'inert' &&
      lifecycle.status !== 'nonmagical'
    )
      throw new ItemStateError(`${path}.lifecycle.status is invalid`);
    if (
      lifecycle.pendingTerminal !== undefined &&
      lifecycle.pendingTerminal !== 'destroyed'
    )
      throw new ItemStateError(`${path}.lifecycle.pendingTerminal is invalid`);
  }
  if (state.pendingTimers !== undefined) {
    if (!Array.isArray(state.pendingTimers))
      throw new ItemStateError(`${path}.pendingTimers must be an array`);
    state.pendingTimers.forEach((raw, index) => {
      const timer = obj(raw, `${path}.pendingTimers[${index}]`);
      onlyKeys(
        timer,
        ['from', 'to', 'startedAt', 'amount', 'unit', 'dueAt', 'roll'],
        `${path}.pendingTimers[${index}]`,
      );
      if (
        typeof timer.from !== 'string' ||
        typeof timer.to !== 'string' ||
        typeof timer.startedAt !== 'string' ||
        typeof timer.amount !== 'number' ||
        !Number.isFinite(timer.amount) ||
        timer.amount < 0 ||
        !['round', 'minute', 'hour', 'day'].includes(String(timer.unit)) ||
        (timer.dueAt !== undefined && typeof timer.dueAt !== 'string')
      )
        throw new ItemStateError(`${path}.pendingTimers[${index}] is invalid`);
      if (timer.roll !== undefined) {
        const roll = obj(timer.roll, `${path}.pendingTimers[${index}].roll`);
        onlyKeys(
          roll,
          ['notation', 'rolls', 'total'],
          `${path}.pendingTimers[${index}].roll`,
        );
        if (
          typeof roll.notation !== 'string' ||
          !Array.isArray(roll.rolls) ||
          !roll.rolls.every((value) => Number.isInteger(value) && value > 0) ||
          !Number.isInteger(roll.total)
        )
          throw new ItemStateError(
            `${path}.pendingTimers[${index}].roll is invalid`,
          );
      }
    });
  }
  return state as unknown as ItemInstanceState;
}

function mechanicsFor(record: RulesRecord, variantId?: string): Obj {
  try {
    const mechanics = effectiveMagicItemMechanics(record, variantId);
    return mechanics === undefined
      ? {}
      : obj(mechanics, `${record.key}.effectiveMechanics`);
  } catch (error) {
    if (error instanceof MagicItemVariantError)
      throw new ItemStateError(error.message);
    throw error;
  }
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

export function isStatefulMagicItem(
  record: RulesRecord,
  variantId?: string,
): boolean {
  const data = obj(record.data, `${record.key}.data`);
  return isStatefulMagicItemMechanics(
    effectiveMagicItemMechanics(record, variantId),
    data.requiresAttunement === true,
  );
}

function durationMinutes(raw: unknown, amount: number): number | undefined {
  const duration = obj(raw, 'duration');
  if (
    !Number.isFinite(amount) ||
    amount < 0 ||
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
    : amount * multiplier[duration.unit];
}

type InitializationRoll = NonNullable<
  ItemInstanceState['initializationRolls']
>[number];

function resolvedInitialAmount(
  value: unknown,
  purpose: string,
  rng: Rng | undefined,
  rolls: InitializationRoll[],
): number | undefined {
  if (typeof value === 'number') return value;
  if (typeof value !== 'string') return undefined;
  if (rng === undefined)
    throw new ItemStateError(
      `${purpose} is dice-defined (${value}); seeded RNG is required for item initialization`,
    );
  const rolled = rollDice(value, rng);
  rolls.push({
    purpose,
    notation: rolled.notation,
    rolls: rolled.rolls,
    total: rolled.total,
  });
  return rolled.total;
}

function initialRemaining(
  raw: unknown,
  economyId: string,
  rng: Rng | undefined,
  rolls: InitializationRoll[],
): number | undefined {
  const economy = obj(raw, 'item economy');
  if (economy.kind === 'charges') {
    const charges = obj(economy.charges, 'item economy.charges');
    return resolvedInitialAmount(
      charges.max,
      `economy:${economyId}:charges.max`,
      rng,
      rolls,
    );
  }
  if (economy.kind === 'per-day') {
    const perDay = obj(economy.perDay, 'item economy.perDay');
    return resolvedInitialAmount(
      perDay.uses,
      `economy:${economyId}:perDay.uses`,
      rng,
      rolls,
    );
  }
  if (economy.kind === 'budget') {
    const total = obj(economy.budget, 'item economy.budget').total;
    const duration = obj(total, 'item economy.budget.total');
    const amount = resolvedInitialAmount(
      duration.amount,
      `economy:${economyId}:budget.total`,
      rng,
      rolls,
    );
    return amount === undefined ? undefined : durationMinutes(total, amount);
  }
  if (economy.kind === 'doses') {
    const doses = obj(economy.doses, 'item economy.doses');
    return resolvedInitialAmount(
      doses.count,
      `economy:${economyId}:doses.count`,
      rng,
      rolls,
    );
  }
  if (economy.kind === 'cooldown') return 1;
  if (economy.kind === 'single-use') return 1;
  return undefined;
}

export interface CreateInitialItemStateOptions {
  readonly variantId?: string;
  readonly rng?: Rng;
}

export function createInitialItemState(
  packRef: string,
  record: RulesRecord,
  options: CreateInitialItemStateOptions = {},
): ItemInstanceState {
  const mechanics = mechanicsFor(record, options.variantId);
  const stateEconomies: Record<string, ItemEconomyState> = {};
  const initializationRolls: InitializationRoll[] = [];
  if (mechanics.economies !== undefined) {
    for (const [id, raw] of Object.entries(
      obj(mechanics.economies, 'mechanics.economies'),
    )) {
      const remaining = initialRemaining(
        raw,
        id,
        options.rng,
        initializationRolls,
      );
      if (remaining !== undefined) stateEconomies[id] = { remaining };
    }
  }
  let custom: Readonly<Record<string, unknown>> | undefined;
  if (mechanics.randomProcedure !== undefined) {
    const randomProcedure = obj(
      mechanics.randomProcedure,
      'mechanics.randomProcedure',
    );
    if (randomProcedure.customState !== undefined) {
      const declaration = obj(
        randomProcedure.customState,
        'mechanics.randomProcedure.customState',
      );
      if (declaration.kind === 'card-pool') {
        const variants = Array.isArray(declaration.variants)
          ? declaration.variants.map((raw, index) =>
              obj(
                raw,
                `mechanics.randomProcedure.customState.variants[${index}]`,
              ),
            )
          : [];
        if (variants.length === 0)
          throw new ItemStateError(`${packRef} card-pool has no variants`);
        let selected = variants[0];
        if (variants.length > 1) {
          if (options.rng === undefined)
            throw new ItemStateError(
              `${packRef} card-pool variant is dice-defined; seeded RNG is required for item initialization`,
            );
          const initialStateProcedure = Array.isArray(
            randomProcedure.procedures,
          )
            ? randomProcedure.procedures
                .map((raw, index) =>
                  obj(raw, `mechanics.randomProcedure.procedures[${index}]`),
                )
                .find((procedure) => procedure.kind === 'initial-state')
            : undefined;
          const risk =
            initialStateProcedure?.risk === undefined
              ? undefined
              : obj(initialStateProcedure.risk, 'initial-state.risk');
          if (
            typeof risk?.percent !== 'number' ||
            !Number.isInteger(risk.percent) ||
            risk.percent < 0 ||
            risk.percent > 100
          )
            throw new ItemStateError(
              `${packRef} multi-variant card-pool lacks an initial-state percentage`,
            );
          const rolled = rollDice('1d100', options.rng);
          initializationRolls.push({
            purpose: 'custom:card-pool:variant',
            notation: rolled.notation,
            rolls: rolled.rolls,
            total: rolled.total,
          });
          const outcome = initialStateProcedure?.outcome;
          if (typeof outcome !== 'string')
            throw new ItemStateError(
              `${packRef} card-pool initial-state procedure lacks an outcome`,
            );
          const normalizedOutcome = outcome.toLowerCase();
          const outcomeNamesVariant = (prefix: string, id: string): boolean =>
            [id, id.replaceAll('-', ' ')].some((label) =>
              normalizedOutcome.includes(`${prefix}${label} variant`),
            );
          const thresholdVariant = variants.find(
            ({ id }) =>
              typeof id === 'string' &&
              outcomeNamesVariant(
                `${risk.percent} percent initializes the `,
                id,
              ),
          );
          const otherwiseVariant = variants.find(
            ({ id }) =>
              typeof id === 'string' &&
              outcomeNamesVariant('otherwise initialize the ', id),
          );
          if (
            thresholdVariant === undefined ||
            otherwiseVariant === undefined ||
            thresholdVariant === otherwiseVariant
          )
            throw new ItemStateError(
              `${packRef} card-pool initial-state outcome does not unambiguously bind its declared variants`,
            );
          selected =
            rolled.total <= risk.percent ? thresholdVariant : otherwiseVariant;
        }
        if (!Array.isArray(selected.initialCardIds))
          throw new ItemStateError(
            `${packRef} card-pool variant has no initial cards`,
          );
        custom = {
          variantId: selected.id,
          remainingCardIds: [...selected.initialCardIds],
          returnedCardIds: [],
        };
      }
    }
  }
  const spellStoreLevels: Record<string, number> = {};
  if (mechanics.spellStore !== undefined) {
    const spellStore = obj(mechanics.spellStore, 'mechanics.spellStore');
    for (const [index, raw] of (Array.isArray(spellStore.contracts)
      ? spellStore.contracts
      : []
    ).entries()) {
      const contract = obj(raw, `mechanics.spellStore.contracts[${index}]`);
      if (contract.initialLevels === undefined) continue;
      if (typeof contract.id !== 'string' || contract.id.length === 0)
        throw new ItemStateError(
          'spell-store initialization contract needs id',
        );
      const levels = resolvedInitialAmount(
        contract.initialLevels,
        `spellStore:${contract.id}:initialLevels`,
        options.rng,
        initializationRolls,
      );
      if (levels === undefined)
        throw new ItemStateError(
          `${packRef} spell-store contract '${contract.id}' has invalid initialLevels`,
        );
      if (
        typeof contract.capacityLevels === 'number' &&
        levels > contract.capacityLevels
      )
        throw new ItemStateError(
          `${packRef} spell-store contract '${contract.id}' initialized above capacity`,
        );
      spellStoreLevels[contract.id] = levels;
    }
  }
  const state: ItemInstanceState = {
    packRef,
    ...(options.variantId === undefined
      ? {}
      : { variantId: options.variantId }),
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
    ...(custom === undefined ? {} : { custom }),
    ...(Object.keys(spellStoreLevels).length === 0 ? {} : { spellStoreLevels }),
    ...(initializationRolls.length === 0 ? {} : { initializationRolls }),
  };
  return validateItemStateForRecord(state, packRef, record, options.variantId);
}

export function validateItemStateForRecord(
  value: unknown,
  packRef: string,
  record: RulesRecord,
  variantId?: string,
): ItemInstanceState {
  const state = validateItemStateJson(value);
  if (state.packRef !== packRef)
    throw new ItemStateError(
      `item state packRef '${state.packRef}' does not match inventory packRef '${packRef}'`,
    );
  if (state.variantId !== variantId)
    throw new ItemStateError(
      `item state variantId ${JSON.stringify(state.variantId)} does not match inventory variantId ${JSON.stringify(variantId)}`,
    );
  try {
    resolveMagicItemVariant(record, variantId);
  } catch (error) {
    if (error instanceof MagicItemVariantError)
      throw new ItemStateError(error.message);
    throw error;
  }
  const mechanics = mechanicsFor(record, variantId);
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
  for (const resolution of state.depletions ?? []) {
    const declared = declaredEconomies[resolution.economyId];
    if (declared === undefined)
      throw new ItemStateError(
        `item depletion economy '${resolution.economyId}' is not declared by ${packRef}`,
      );
    const onDepleted = obj(
      declared,
      `${packRef}.economies.${resolution.economyId}`,
    ).onDepleted;
    if (onDepleted === undefined)
      throw new ItemStateError(
        `${packRef} economy '${resolution.economyId}' does not license depletion state`,
      );
  }
  if (state.lifecycle !== undefined && (state.depletions?.length ?? 0) === 0)
    throw new ItemStateError(
      `${packRef} lifecycle status requires a source-declared depletion resolution`,
    );
  if (mechanics.stateMachine === undefined) {
    if (state.machineState !== undefined)
      throw new ItemStateError(`${packRef} does not license machineState`);
    if ((state.pendingTimers?.length ?? 0) > 0)
      throw new ItemStateError(`${packRef} does not license pendingTimers`);
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
    const transitions = Array.isArray(machine.transitions)
      ? machine.transitions.map((raw, index) =>
          obj(raw, `${packRef}.mechanics.stateMachine.transitions[${index}]`),
        )
      : [];
    for (const timer of state.pendingTimers ?? [])
      if (
        !transitions.some(
          (transition) =>
            transition.from === timer.from &&
            transition.to === timer.to &&
            transition.timer !== undefined,
        )
      )
        throw new ItemStateError(
          `${packRef} does not declare pending timer '${timer.from}' -> '${timer.to}'`,
        );
  }
  if (state.storedSpells !== undefined && !licensesStoredSpells(mechanics))
    throw new ItemStateError(
      `${packRef} does not license storedSpells through a spell-storage contract`,
    );
  if (state.spellStoreLevels !== undefined) {
    const contracts = new Set(
      mechanics.spellStore === undefined
        ? []
        : (Array.isArray(obj(mechanics.spellStore, 'spellStore').contracts)
            ? (obj(mechanics.spellStore, 'spellStore').contracts as unknown[])
            : []
          ).map((raw) => String(obj(raw, 'spellStore.contract').id)),
    );
    for (const id of Object.keys(state.spellStoreLevels))
      if (!contracts.has(id))
        throw new ItemStateError(
          `${packRef} does not license spellStoreLevels contract '${id}'`,
        );
  }
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

function resolvePendingTimerState(
  transition: SelectedStateTransition | undefined,
  at: string,
  rng: Rng | undefined,
): NonNullable<ItemInstanceState['pendingTimers']> {
  const pending = transition?.result.pendingTimers ?? [];
  return pending.map(({ to, timer }) => {
    const resolved =
      typeof timer.amount === 'number'
        ? { amount: timer.amount }
        : (() => {
            if (rng === undefined)
              throw new ItemStateError(
                `state timer is dice-defined (${timer.amount}); seeded RNG is required before applying the transition`,
              );
            const rolled = rollDice(timer.amount, rng);
            return {
              amount: rolled.total,
              roll: {
                notation: rolled.notation,
                rolls: rolled.rolls,
                total: rolled.total,
              },
            };
          })();
    const milliseconds: Partial<Record<MagicItemDurationSpec['unit'], number>> =
      {
        minute: 60_000,
        hour: 3_600_000,
        day: 86_400_000,
      };
    const multiplier = milliseconds[timer.unit];
    const started = Date.parse(at);
    if (!Number.isFinite(started))
      throw new ItemStateError('use_item.at must be an ISO timestamp');
    return {
      from: transition?.nextState ?? '',
      to,
      startedAt: at,
      amount: resolved.amount,
      unit: timer.unit,
      ...(multiplier === undefined
        ? {}
        : {
            dueAt: new Date(
              started + resolved.amount * multiplier,
            ).toISOString(),
          }),
      ...('roll' in resolved ? { roll: resolved.roll } : {}),
    };
  });
}

function isDeferredDestroyedLifecycle(
  selectedTransition: SelectedStateTransition | undefined,
): boolean {
  if (selectedTransition === undefined) return false;
  return !['destroyed', 'consumed'].includes(selectedTransition.nextState);
}

export function useItem(db: Db, input: UseItemInput): UseItemResult {
  return withTransaction(db, (txnDb) => {
    const row = txnDb
      .prepare(
        'SELECT id, pack_ref, variant_id, quantity FROM inventory WHERE id = ? AND character_id = ?',
      )
      .get(input.instanceId, input.characterId) as
      | {
          id: string;
          pack_ref: string | null;
          variant_id: string | null;
          quantity: number;
        }
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
    const variantId = row.variant_id ?? undefined;
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
    const itemData = obj(hit.record.data, `${packRef}.data`);
    if (itemData.requiresAttunement === true) {
      const attuned = txnDb
        .prepare(
          `SELECT item_key FROM attunement
           WHERE campaign_id = ? AND character_id = ? AND item_id = ?`,
        )
        .get(input.campaignId, input.characterId, input.instanceId) as
        | { item_key: string }
        | undefined;
      if (attuned === undefined || attuned.item_key !== packRef)
        throw new ItemStateError(
          `${packRef} requires authoritative attunement by character '${input.characterId}' before use`,
        );
    }
    const mechanics = mechanicsFor(hit.record, variantId);
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
    const operationEffectIds = Array.isArray(operation.effects)
      ? (operation.effects as string[])
      : [];
    const machineForReadiness =
      mechanics.stateMachine === undefined
        ? undefined
        : obj(mechanics.stateMachine, `${packRef}.mechanics.stateMachine`);
    const operationTransitions = Array.isArray(machineForReadiness?.transitions)
      ? machineForReadiness.transitions
          .map((raw, index) =>
            obj(raw, `${packRef}.mechanics.stateMachine.transitions[${index}]`),
          )
          .filter(({ via }) => via === input.operationId)
      : [];
    const possibleTransitionEffectIds = operationTransitions.flatMap(
      (transition) =>
        Array.isArray(transition.effects)
          ? (transition.effects as string[])
          : [],
    );
    try {
      assertMagicItemOperationReady(hit.record, variantId, {
        operationId: input.operationId,
        economyIds: new Set(
          (Array.isArray(operation.cost) ? operation.cost : []).map((raw) =>
            String(obj(raw, 'operation cost').economy),
          ),
        ),
        effectIds: new Set([
          ...operationEffectIds,
          ...possibleTransitionEffectIds,
        ]),
        usesStateMachine: operationTransitions.length > 0,
      });
    } catch (error) {
      if (error instanceof ItemExecutionReadinessError)
        throw new ItemStateError(error.message);
      throw error;
    }
    const stateful = isStatefulMagicItem(hit.record, variantId);
    if (stateful && row.quantity !== 1)
      throw new ItemStateError(
        `stateful item '${input.instanceId}' must have quantity 1`,
      );
    let state = readItemState(txnDb, input.instanceId);
    if (stateful && state === undefined) {
      state = createInitialItemState(packRef, hit.record, {
        variantId,
        rng: input.rng,
      });
    }
    if (state !== undefined)
      state = validateItemStateForRecord(state, packRef, hit.record, variantId);
    if (
      state?.lifecycle?.status === 'inert' ||
      state?.lifecycle?.status === 'nonmagical'
    )
      throw new ItemStateError(
        `${packRef} is ${state.lifecycle.status} and has no executable magic-item operations`,
      );

    const selectedTransition = selectStateTransition(
      mechanics,
      packRef,
      input.operationId,
      input.args,
      state?.machineState,
    );
    const transitionEffectIds = selectedTransition?.effectIds ?? [];
    const pendingTimers = resolvePendingTimerState(
      selectedTransition,
      input.at,
      input.rng,
    );

    const costs: { economy: string; amount: number }[] = [];
    let stackedSingleUse = 0;
    let spentStatefulSingleUse = false;
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
      if (economy.kind === 'single-use' && !stateful) {
        stackedSingleUse += amount;
        continue;
      }
      if (economy.kind === 'single-use') spentStatefulSingleUse = true;
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
    if (stackedSingleUse > row.quantity)
      throw new ItemStateError(
        `insufficient inventory quantity: ${row.quantity} remaining, ${stackedSingleUse} required`,
      );

    const depletionResolutions: ItemDepletionResolution[] = [];
    for (const [economyId, next] of Object.entries(nextEconomies)) {
      const previous = state?.economies?.[economyId];
      if (
        previous === undefined ||
        previous.remaining === 0 ||
        next.remaining !== 0
      )
        continue;
      try {
        const resolution = resolveItemDepletion(
          economyId,
          refs.economies[economyId],
          input.rng,
        );
        if (resolution !== undefined) {
          depletionResolutions.push(resolution);
          if (resolution.regain !== undefined)
            nextEconomies[economyId] = {
              ...next,
              remaining: resolution.regain,
            };
        }
      } catch (error) {
        if (error instanceof ItemDepletionError)
          throw new ItemStateError(error.message);
        throw error;
      }
    }

    let quantity = row.quantity;
    let consumed = spentStatefulSingleUse;
    if (stackedSingleUse > 0) {
      quantity -= stackedSingleUse;
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
      const becomes = depletionResolutions
        .map((resolution) => resolution.becomes)
        .filter((value) => value !== undefined);
      const replacement = becomes.find((value) => typeof value === 'object');
      if (replacement !== undefined)
        throw new ItemStateError(
          `${packRef} depletion replaces the instance with another item and requires a dedicated atomic replacement owner`,
        );
      const destroyed = becomes.includes('destroyed');
      const deferredDestroyed =
        destroyed && isDeferredDestroyedLifecycle(selectedTransition);
      const status = becomes.includes('nonmagical')
        ? 'nonmagical'
        : becomes.includes('inert')
          ? 'inert'
          : deferredDestroyed
            ? 'consumed'
            : undefined;
      state = validateItemStateForRecord(
        {
          ...state,
          economies: nextEconomies,
          ...(depletionResolutions.length === 0
            ? {}
            : {
                depletions: [
                  ...(state.depletions ?? []),
                  ...depletionResolutions,
                ],
              }),
          ...(status === undefined
            ? {}
            : {
                lifecycle: {
                  status,
                  ...(deferredDestroyed
                    ? { pendingTerminal: 'destroyed' as const }
                    : {}),
                },
              }),
          ...(pendingTimers.length === 0
            ? {}
            : {
                pendingTimers: [
                  ...(state.pendingTimers ?? []),
                  ...pendingTimers,
                ],
              }),
          ...(selectedTransition === undefined
            ? {}
            : { machineState: selectedTransition.nextState }),
        },
        packRef,
        hit.record,
        variantId,
      );
      if (destroyed && !deferredDestroyed) {
        txnDb
          .prepare('DELETE FROM inventory WHERE id = ?')
          .run(input.instanceId);
        quantity = 0;
        consumed = true;
      } else {
        writeItemState(txnDb, input.instanceId, state, input);
      }
    }
    const effectIds = [...operationEffectIds, ...transitionEffectIds];
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
