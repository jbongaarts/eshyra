import type {
  MagicItemEffect,
  MagicItemMechanics,
  MagicItemOperation,
} from '../../../src/rules/magicItemMechanics.js';
import { mergeMagicItemVariantMechanics } from '../../../src/rules/magicItemVariants.js';
import type { RulesRecord } from '../../../src/rules/types.js';
import { MAGIC_ITEM_ENTITY_GRANT_KEYS_WITH_DEATH_CONSEQUENCE } from './magicItemEntityGrants.js';
import {
  CREATURE_GRANT_LIFECYCLE_HOOKS,
  creatureGrantLifecycleOwned,
} from './magicItemGrantOwnership.js';

export const MAGIC_ITEM_ENGINE_FAMILIES = [
  'F1',
  'F2',
  'F3',
  'F4',
  'F5',
  'F6',
  'F7',
  'F8',
  'F9',
  'F10',
] as const;

export type MagicItemEngineFamily = (typeof MAGIC_ITEM_ENGINE_FAMILIES)[number];
export type MagicItemClauseTag =
  | 'C1'
  | 'C2'
  | 'S'
  | 'DB'
  | 'M1'
  | 'M2'
  | 'M3'
  | 'M4'
  | 'M5'
  | 'M6'
  | 'M7'
  | 'M8'
  | 'M9'
  | 'M10'
  | 'M11';

export interface EngineHookBinding {
  readonly engine: MagicItemEngineFamily;
  readonly hook: string;
}

export type ItemClauseRepresentation =
  | {
      readonly block:
        | 'stateMachine'
        | 'spellStore'
        | 'curse'
        | 'containment'
        | 'entityGrant'
        | 'randomProcedure'
        | 'rollManipulation'
        | 'interItem';
    }
  | { readonly block: 'economies'; readonly economyId: string }
  | { readonly block: 'operations'; readonly operationId: string }
  | { readonly block: 'effects'; readonly effectId: string }
  | {
      readonly block: 'structuredField';
      readonly field: string;
      readonly ref?: string;
    }
  | {
      readonly adjudicated: true;
      readonly note: string;
      /** Verbatim span of the item's printed description the DM model reads
       * and interprets; validated as an exact substring of that text. */
      readonly sourceText: string;
    }
  | { readonly designBlocked: true; readonly reason: string };

export interface ItemClauseExpectation {
  readonly id: string;
  readonly tag: MagicItemClauseTag;
  /** Exactly one representation or reviewed terminal disposition. */
  readonly representation: ItemClauseRepresentation;
  readonly engineHooks?: readonly EngineHookBinding[];
}

/**
 * The deliberately small API implemented by each source-grounded family
 * projector. A projector returns data only; aggregation owns composition.
 */
export interface MagicItemFamilyProjection {
  readonly family: string;
  readonly mechanics: Readonly<Partial<MagicItemMechanics>>;
  readonly clauses: readonly ItemClauseExpectation[];
}

const SINGLETON_BLOCKS = [
  'ambiguities',
  'activation',
  'stateMachine',
  'entityGrant',
  'containment',
  'curse',
  'randomProcedure',
  'spellStore',
  'rollManipulation',
  'interItem',
] as const;

function duplicateId(kind: string, id: string): never {
  throw new Error(
    `magic-item mechanics aggregation: duplicate ${kind} id ${JSON.stringify(id)}`,
  );
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (typeof value === 'object' && value !== null) {
    return `{${Object.entries(value)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, child]) => `${JSON.stringify(key)}:${canonicalJson(child)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

function mergeOptionalScalar<T>(
  operationId: string,
  field: string,
  left: T | undefined,
  right: T | undefined,
): T | undefined {
  if (left === undefined) return right;
  if (right === undefined) return left;
  if (canonicalJson(left) !== canonicalJson(right)) {
    throw new Error(
      `magic-item mechanics aggregation: conflicting ${field} for operation ${JSON.stringify(operationId)}`,
    );
  }
  return left;
}

function unionStrings(
  left: readonly string[] | undefined,
  right: readonly string[] | undefined,
): readonly string[] | undefined {
  const result = [...(left ?? [])];
  const seen = new Set(result);
  for (const value of right ?? []) {
    if (!seen.has(value)) {
      seen.add(value);
      result.push(value);
    }
  }
  return result.length === 0 ? undefined : result;
}

function mergeActivation(
  operationId: string,
  left: MagicItemOperation['activation'],
  right: MagicItemOperation['activation'],
): MagicItemOperation['activation'] {
  if (left === undefined) return right;
  if (right === undefined) return left;
  const merged: Record<string, unknown> = { ...left };
  for (const [field, value] of Object.entries(right)) {
    if (
      Object.hasOwn(merged, field) &&
      canonicalJson(merged[field]) !== canonicalJson(value)
    ) {
      throw new Error(
        `magic-item mechanics aggregation: conflicting activation.${field} for operation ${JSON.stringify(operationId)}`,
      );
    }
    merged[field] = value;
  }
  return merged as unknown as MagicItemOperation['activation'];
}

function mergeOperations(
  left: MagicItemOperation,
  right: MagicItemOperation,
): MagicItemOperation {
  const costs = [...(left.cost ?? [])];
  const costsByEconomy = new Map(costs.map((cost) => [cost.economy, cost]));
  for (const cost of right.cost ?? []) {
    const existing = costsByEconomy.get(cost.economy);
    if (existing === undefined) {
      costsByEconomy.set(cost.economy, cost);
      costs.push(cost);
    } else if (canonicalJson(existing.amount) !== canonicalJson(cost.amount)) {
      throw new Error(
        `magic-item mechanics aggregation: conflicting cost for economy ${JSON.stringify(cost.economy)} on operation ${JSON.stringify(left.id)}`,
      );
    }
  }
  const activation = mergeActivation(
    left.id,
    left.activation,
    right.activation,
  );
  const note = mergeOptionalScalar(left.id, 'note', left.note, right.note);
  const excludes = unionStrings(left.excludes, right.excludes);
  const doesNotExpend = unionStrings(left.doesNotExpend, right.doesNotExpend);
  const effects = unionStrings(left.effects, right.effects);
  return {
    id: left.id,
    ...(activation === undefined ? {} : { activation }),
    ...(costs.length === 0 ? {} : { cost: costs }),
    ...(excludes === undefined ? {} : { excludes }),
    ...(doesNotExpend === undefined ? {} : { doesNotExpend }),
    ...(effects === undefined ? {} : { effects }),
    ...(note === undefined ? {} : { note }),
  };
}

/** Deterministically combines orthogonal family projections without mutation. */
export function aggregateMagicItemFamilyProjections(
  projections: readonly MagicItemFamilyProjection[],
): {
  readonly mechanics: MagicItemMechanics | undefined;
  readonly clauses: readonly ItemClauseExpectation[];
} {
  const ordered = [...projections].sort((a, b) =>
    a.family.localeCompare(b.family),
  );
  const families = new Set<string>();
  const clauses: ItemClauseExpectation[] = [];
  const clauseIds = new Set<string>();
  const mechanics: Record<string, unknown> = {};
  const economies: Record<string, unknown> = {};
  const operations: MagicItemOperation[] = [];
  const operationIndexes = new Map<string, number>();
  const effects: MagicItemEffect[] = [];
  const effectIds = new Set<string>();

  for (const projection of ordered) {
    if (families.has(projection.family)) {
      throw new Error(
        `magic-item mechanics aggregation: duplicate family ${JSON.stringify(projection.family)}`,
      );
    }
    families.add(projection.family);

    for (const block of SINGLETON_BLOCKS) {
      const value = projection.mechanics[block];
      if (value === undefined) continue;
      if (mechanics[block] !== undefined) {
        throw new Error(
          `magic-item mechanics aggregation: conflicting ${block} blocks from family ${JSON.stringify(projection.family)}`,
        );
      }
      mechanics[block] = value;
    }
    for (const [economyId, economy] of Object.entries(
      projection.mechanics.economies ?? {},
    ).sort(([a], [b]) => a.localeCompare(b))) {
      if (Object.hasOwn(economies, economyId))
        duplicateId('economy', economyId);
      economies[economyId] = economy;
    }
    const familyOperationIds = new Set<string>();
    for (const operation of projection.mechanics.operations ?? []) {
      if (familyOperationIds.has(operation.id))
        duplicateId('operation', operation.id);
      familyOperationIds.add(operation.id);
      const existingIndex = operationIndexes.get(operation.id);
      if (existingIndex === undefined) {
        operationIndexes.set(operation.id, operations.length);
        operations.push(operation);
      } else {
        operations[existingIndex] = mergeOperations(
          operations[existingIndex],
          operation,
        );
      }
    }
    for (const effect of projection.mechanics.effects ?? []) {
      if (effect.id !== undefined) {
        if (effectIds.has(effect.id)) duplicateId('effect', effect.id);
        effectIds.add(effect.id);
      }
      effects.push(effect);
    }
    for (const clause of projection.clauses) {
      if (clauseIds.has(clause.id)) duplicateId('clause', clause.id);
      clauseIds.add(clause.id);
      clauses.push(clause);
    }
  }

  if (Object.keys(economies).length > 0) mechanics.economies = economies;
  if (operations.length > 0) mechanics.operations = operations;
  if (effects.length > 0) mechanics.effects = effects;
  clauses.sort((a, b) => a.id.localeCompare(b.id));
  return {
    mechanics:
      Object.keys(mechanics).length === 0
        ? undefined
        : (mechanics as unknown as MagicItemMechanics),
    clauses,
  };
}

export type MagicItemReadiness =
  | 'green'
  | 'engine-pending'
  | 'adjudicated-by-design'
  | 'design-blocked'
  | 'transitional'
  | 'red';

export interface MagicItemReadinessEntry {
  readonly itemKey: string;
  readonly clauseId?: string;
  readonly scope?:
    | { readonly kind: 'parent' }
    | { readonly kind: 'variant'; readonly variantKey: string };
  readonly tag?: MagicItemClauseTag;
  readonly readiness: MagicItemReadiness;
  readonly representation?: ItemClauseRepresentation;
  readonly engineHooks?: readonly EngineHookBinding[];
  readonly missingHooks?: readonly EngineHookBinding[];
  readonly missingEngines?: readonly MagicItemEngineFamily[];
  readonly reason?: string;
}

export interface MagicItemExecutionReadiness {
  readonly source: 'derived-magic-item-clauses-v1';
  readonly clauses: readonly Omit<MagicItemReadinessEntry, 'itemKey'>[];
}

/** Stable identity for exact runtime-hook evidence. Family-only evidence is
 * intentionally insufficient: F5 owning one clock path does not imply that
 * every unrelated F5 hook has landed. */
export function magicItemEngineHookKey(binding: EngineHookBinding): string {
  return JSON.stringify([binding.engine, binding.hook]);
}

/**
 * Reviewed exact hooks whose complete contract is owned by the live item
 * runtime. Keep this registry at hook granularity: several other F5 hooks
 * deliberately combine a landed mutation (spend or state transition) with an
 * unlanded responsibility (recharge or timer execution), so family-level
 * ownership would overstate playability.
 *
 * `duration-budget accounting` is implemented end to end by
 * `createInitialItemState` (total duration -> exact declared-increment units)
 * and `useItem` (validated increment cost -> persisted decrement and depletion
 * handling).
 * `elapsed-time cooldown reset` is implemented by useItem scheduling from the
 * spend time and the reset executor restoring the economy at its deadline.
 * `state-anchored cooldown reset` is implemented by state transitions calling
 * the anchor scheduler at the transition boundary.
 * `grant-anchored cooldown reset` is implemented by every grant ending (expiry,
 * 0 hit points, concentration, DM end) calling applyItemCooldownAnchorEvent in
 * the same transaction, for a grant bound through start_effect whose spend is
 * coupled to that binding (olc5.12.2).
 * The long-rest and dawn hooks own both the soft-limit spend rule (exhausted
 * uses remain permitted without spending) and the matching reset that restores
 * the safe use.
 */
export const LANDED_MAGIC_ITEM_ENGINE_HOOKS: ReadonlySet<string> = new Set([
  // olc5.11 pack conformance: use_item applies a printed action cost and
  // declared state outcomes, while item_state_event and the timer executor
  // apply the matching state/timer changes. Condition/save truth is supplied
  // by DM adjudication and is not part of these hooks.
  magicItemEngineHookKey({
    engine: 'F2',
    hook: 'olc5.11 pack-tested paid item operation',
  }),
  magicItemEngineHookKey({
    engine: 'F5',
    hook: 'olc5.11 pack-tested item state and timer transition',
  }),
  magicItemEngineHookKey({
    engine: 'F5',
    hook: 'duration-budget accounting',
  }),
  // useItem schedules at spend; the reset executor restores at that deadline.
  magicItemEngineHookKey({ engine: 'F5', hook: 'elapsed-time cooldown reset' }),
  // State transitions schedule depleted economies at their entered boundary.
  magicItemEngineHookKey({
    engine: 'F5',
    hook: 'state-anchored cooldown reset',
  }),
  // Grant ends schedule the depleted economy anchored to that grant.
  magicItemEngineHookKey({
    engine: 'F5',
    hook: 'grant-anchored cooldown reset',
  }),
  // Exhausted safe-use pools remain usable; long rest restores the safe use.
  magicItemEngineHookKey({
    engine: 'F7',
    hook: 'long-rest reset and early-reuse gate',
  }),
  // Exhausted safe-use pools remain usable; dawn restores the safe use.
  magicItemEngineHookKey({
    engine: 'F5',
    hook: 'dawn reset with nonblocking early-reuse risk',
  }),
]);

/**
 * The F2 activation-economy hooks (eshyra-xwau.1). They are deliberately NOT
 * in {@link LANDED_MAGIC_ITEM_ENGINE_HOOKS}: landing them globally would mark
 * every clause naming them as owned, including clauses whose activation is
 * untyped (DM-adjudicated). Instead the classifier removes one of them from a
 * clause's `missingHooks` only under {@link activationEconomyOwned}.
 */
export const ACTIVATION_ECONOMY_HOOK_KEYS: ReadonlySet<string> = new Set(
  [
    'action-economy activation',
    'activation action economy',
    'reaction and action economy',
    'item activation and action-budget ownership',
  ].map((hook) => magicItemEngineHookKey({ engine: 'F2', hook })),
);

/**
 * The F3 lifecycle and F5 identity-link hooks of a creature grant
 * (eshyra-c58j.1). Not in {@link LANDED_MAGIC_ITEM_ENGINE_HOOKS}: the
 * classifier removes them from an `entityGrant` clause's `missingHooks` only
 * under `creatureGrantLifecycleOwned` (see magicItemGrantOwnership.ts).
 */
export const CREATURE_GRANT_LIFECYCLE_HOOK_KEYS: ReadonlySet<string> = new Set(
  CREATURE_GRANT_LIFECYCLE_HOOKS.map(magicItemEngineHookKey),
);

/** Typed activation costs `use_item` spends from the actor's turn resources
 * (state/itemTurnResource.ts). `free` and `consume` spend nothing. */
const SPENT_ACTIVATION_COSTS: ReadonlySet<string> = new Set([
  'action',
  'bonus-action',
  'reaction',
]);

type Obj = Record<string, unknown>;

function asObject(value: unknown): Obj | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Obj)
    : undefined;
}

function clauseScope(
  itemKey: string,
  clauseId: string,
): NonNullable<MagicItemReadinessEntry['scope']> {
  const variantPrefix = `${itemKey}/variant:`;
  if (!clauseId.startsWith(variantPrefix)) return { kind: 'parent' };
  const remainder = clauseId.slice(variantPrefix.length);
  const separator = remainder.indexOf('/');
  const variantKey = separator < 0 ? remainder : remainder.slice(0, separator);
  if (variantKey.length === 0)
    throw new Error(
      `magic-item clause integrity: ${clauseId} has an empty variant scope`,
    );
  if (separator < 0 || separator === remainder.length - 1)
    throw new Error(
      `magic-item clause integrity: ${clauseId} has a missing clause suffix after variant scope`,
    );
  return { kind: 'variant', variantKey };
}

function representationKind(representation: Obj): string {
  const kinds = [
    typeof representation.block === 'string' ? 'block' : undefined,
    representation.adjudicated === true ? 'adjudicated' : undefined,
    representation.designBlocked === true ? 'designBlocked' : undefined,
  ].filter((value): value is string => value !== undefined);
  if (kinds.length !== 1) {
    throw new Error(
      'must have exactly one representation binding or disposition',
    );
  }
  return kinds[0];
}

function selectedVariant(data: Obj, variantKey: string): Obj | undefined {
  if (!Array.isArray(data.variants)) return undefined;
  return data.variants
    .map(asObject)
    .find((variant) => variant?.id === variantKey);
}

function representationDataScopes(
  data: Obj,
  scope: NonNullable<MagicItemReadinessEntry['scope']>,
): readonly Obj[] {
  if (scope.kind === 'parent') return [data];
  const variant = selectedVariant(data, scope.variantKey);
  return variant === undefined
    ? []
    : [{ ...data, variants: [variant] }, variant];
}

function representationMechanicsScopes(
  data: Obj,
  scope: NonNullable<MagicItemReadinessEntry['scope']>,
): readonly Obj[] {
  const scopes: Obj[] = [];
  const parent = asObject(data.mechanics);
  if (parent !== undefined) scopes.push(parent);
  if (scope.kind === 'variant') {
    const variant = selectedVariant(data, scope.variantKey);
    const nested = asObject(variant?.mechanics);
    if (nested !== undefined) scopes.push(nested);
  }
  return scopes;
}

function hasEffect(scopes: readonly Obj[], effectId: string): boolean {
  return scopes.some(
    (scope) =>
      Array.isArray(scope.effects) &&
      scope.effects.some((effect) => asObject(effect)?.id === effectId),
  );
}

function hasOperation(scopes: readonly Obj[], operationId: string): boolean {
  return scopes.some(
    (scope) =>
      Array.isArray(scope.operations) &&
      scope.operations.some(
        (operation) => asObject(operation)?.id === operationId,
      ),
  );
}

function fieldContainsRef(value: unknown, ref: string): boolean {
  if (value === ref) return true;
  if (Array.isArray(value))
    return value.some((entry) => fieldContainsRef(entry, ref));
  const obj = asObject(value);
  return (
    obj !== undefined &&
    ['ref', 'key', 'id', 'name', 'tableRef', 'statBlockRef'].some(
      (key) => obj[key] === ref,
    )
  );
}

function representationResolves(
  data: Obj,
  representation: Obj,
  scope: NonNullable<MagicItemReadinessEntry['scope']>,
): boolean {
  const kind = representationKind(representation);
  if (kind !== 'block') return true;
  const block = representation.block;
  if (block === 'structuredField') {
    if (typeof representation.field !== 'string') return false;
    return representationDataScopes(data, scope).some((dataScope) => {
      const value = dataScope[representation.field as string];
      return (
        value !== undefined &&
        (representation.ref === undefined ||
          (typeof representation.ref === 'string' &&
            fieldContainsRef(value, representation.ref)))
      );
    });
  }
  const scopes = representationMechanicsScopes(data, scope);
  if (block === 'economies') {
    return (
      typeof representation.economyId === 'string' &&
      scopes.some((scope) =>
        Object.hasOwn(
          asObject(scope.economies) ?? {},
          representation.economyId as string,
        ),
      )
    );
  }
  if (block === 'operations') {
    return (
      typeof representation.operationId === 'string' &&
      hasOperation(scopes, representation.operationId)
    );
  }
  if (block === 'effects') {
    return (
      typeof representation.effectId === 'string' &&
      hasEffect(scopes, representation.effectId)
    );
  }
  return (
    typeof block === 'string' &&
    scopes.some((scope) => scope[block] !== undefined)
  );
}

function effectiveMechanicsFor(
  data: Obj,
  scope: NonNullable<MagicItemReadinessEntry['scope']>,
): Obj | undefined {
  const parent = asObject(data.mechanics);
  if (scope.kind === 'parent') return parent;
  const child = asObject(selectedVariant(data, scope.variantKey)?.mechanics);
  if (child === undefined) return parent;
  return mergeMagicItemVariantMechanics(
    parent as MagicItemMechanics | undefined,
    child as MagicItemMechanics,
  ) as Obj | undefined;
}

function operationSpendsTurnResource(operation: Obj | undefined): boolean {
  const cost = asObject(operation?.activation)?.cost;
  return typeof cost === 'string' && SPENT_ACTIVATION_COSTS.has(cost);
}

/**
 * Per-clause ownership of the activation-economy hooks (eshyra-xwau.1).
 *
 * True only when the clause's activation is carried by operation(s) whose
 * TYPED `activation.cost` is action / bonus-action / reaction, which `use_item`
 * spends through the turn-resource path (eshyra-olc5.9). By representation:
 *  - `operations`: that operation is typed.
 *  - `stateMachine`: the machine has at least one operation-driven (`via`)
 *    transition and EVERY `via` operation is typed. One untyped activate or
 *    deactivate operation keeps the whole machine clause pending.
 *  - `effects`: EXACTLY ONE operation references the effect (and no state
 *    transition does), and that operation is typed. An effect shared by
 *    several operations, or by none (a passive/residual effect), is not owned.
 *  - every other block (interItem, containment, ...) is never owned here.
 * An untyped (DM-adjudicated) operation or transition never loses the hook.
 */
function activationEconomyOwned(
  data: Obj,
  representation: Obj,
  scope: NonNullable<MagicItemReadinessEntry['scope']>,
): boolean {
  const mechanics = effectiveMechanicsFor(data, scope);
  if (mechanics === undefined) return false;
  const operations = (
    Array.isArray(mechanics.operations) ? mechanics.operations : []
  )
    .map(asObject)
    .filter((operation): operation is Obj => operation !== undefined);
  const rawTransitions = asObject(mechanics.stateMachine)?.transitions;
  const transitions = (Array.isArray(rawTransitions) ? rawTransitions : [])
    .map(asObject)
    .filter((transition): transition is Obj => transition !== undefined);
  const block = representation.block;
  if (block === 'operations') {
    return operationSpendsTurnResource(
      operations.find(({ id }) => id === representation.operationId),
    );
  }
  if (block === 'stateMachine') {
    const vias = new Set(
      transitions
        .map(({ via }) => via)
        .filter((via): via is string => typeof via === 'string'),
    );
    return (
      vias.size > 0 &&
      [...vias].every((via) =>
        operationSpendsTurnResource(operations.find(({ id }) => id === via)),
      )
    );
  }
  if (block === 'effects') {
    const effectId = representation.effectId;
    if (typeof effectId !== 'string') return false;
    const referencing = operations.filter(
      ({ effects }) => Array.isArray(effects) && effects.includes(effectId),
    );
    const transitionReferences = transitions.some(
      ({ effects }) => Array.isArray(effects) && effects.includes(effectId),
    );
    return (
      referencing.length === 1 &&
      !transitionReferences &&
      operationSpendsTurnResource(referencing[0])
    );
  }
  return false;
}

function operationIds(scope: Obj): Set<string> {
  return new Set(
    (Array.isArray(scope.operations) ? scope.operations : [])
      .map((operation) => asObject(operation)?.id)
      .filter((id): id is string => typeof id === 'string'),
  );
}

function assertUniqueOperationIds(scope: Obj): void {
  const seen = new Set<string>();
  for (const raw of Array.isArray(scope.operations) ? scope.operations : []) {
    const operationId = asObject(raw)?.id;
    if (typeof operationId !== 'string') continue;
    if (seen.has(operationId)) duplicateId('operation', operationId);
    seen.add(operationId);
  }
}

function validateEffectiveOperationReferences(
  itemKey: string,
  scopeName: string,
  scope: Obj,
): void {
  const economies = asObject(scope.economies) ?? {};
  const effects = new Set(
    (Array.isArray(scope.effects) ? scope.effects : [])
      .map((effect) => asObject(effect)?.id)
      .filter((id): id is string => typeof id === 'string'),
  );
  const operations = operationIds(scope);
  for (const raw of Array.isArray(scope.operations) ? scope.operations : []) {
    const operation = asObject(raw);
    if (operation === undefined || typeof operation.id !== 'string') continue;
    for (const rawCost of Array.isArray(operation.cost) ? operation.cost : []) {
      const economy = asObject(rawCost)?.economy;
      if (typeof economy !== 'string' || !Object.hasOwn(economies, economy))
        throw new Error(
          `magic-item clause integrity: ${itemKey} ${scopeName} operation ${operation.id} references unknown economy ${JSON.stringify(economy)}`,
        );
    }
    for (const economy of Array.isArray(operation.doesNotExpend)
      ? operation.doesNotExpend
      : []) {
      if (typeof economy !== 'string' || !Object.hasOwn(economies, economy))
        throw new Error(
          `magic-item clause integrity: ${itemKey} ${scopeName} operation ${operation.id} references unknown economy ${JSON.stringify(economy)}`,
        );
    }
    for (const effectId of Array.isArray(operation.effects)
      ? operation.effects
      : []) {
      if (typeof effectId !== 'string' || !effects.has(effectId))
        throw new Error(
          `magic-item clause integrity: ${itemKey} ${scopeName} operation ${operation.id} references unknown effect ${JSON.stringify(effectId)}`,
        );
    }
    for (const excludedId of Array.isArray(operation.excludes)
      ? operation.excludes
      : []) {
      if (typeof excludedId !== 'string' || !operations.has(excludedId))
        throw new Error(
          `magic-item clause integrity: ${itemKey} ${scopeName} operation ${operation.id} references unknown operation ${JSON.stringify(excludedId)}`,
        );
      if (excludedId === operation.id)
        throw new Error(
          `magic-item clause integrity: ${itemKey} ${scopeName} operation ${operation.id} excludes cannot reference itself`,
        );
    }
  }
}

function validateOperationReferences(itemKey: string, data: Obj): void {
  const parent = asObject(data.mechanics);
  if (parent !== undefined) {
    assertUniqueOperationIds(parent);
    validateEffectiveOperationReferences(itemKey, 'parent', parent);
  }
  for (const rawVariant of Array.isArray(data.variants) ? data.variants : []) {
    const variant = asObject(rawVariant);
    const variantKey = variant?.id;
    const child = asObject(variant?.mechanics);
    if (typeof variantKey !== 'string' || child === undefined) continue;
    assertUniqueOperationIds(child);
    let effective: MagicItemMechanics | undefined;
    try {
      effective = mergeMagicItemVariantMechanics(
        parent as MagicItemMechanics | undefined,
        child as MagicItemMechanics,
      );
    } catch (error) {
      throw new Error(
        `magic-item clause integrity: ${itemKey} variant ${JSON.stringify(variantKey)} cannot merge with parent mechanics: ${(error as Error).message}`,
      );
    }
    if (effective !== undefined)
      validateEffectiveOperationReferences(
        itemKey,
        `variant ${JSON.stringify(variantKey)}`,
        effective as Obj,
      );
  }
}

/**
 * Validates the full magic-item record set and returns readiness as a derived
 * view. Missing registrations are deliberate red gaps, not integrity errors.
 */
export function validateMagicItemClausesAndClassify(input: {
  readonly records: readonly RulesRecord[];
  readonly clausesByItemKey: ReadonlyMap<
    string,
    readonly ItemClauseExpectation[]
  >;
  readonly landedEngineHooks?: ReadonlySet<string>;
  readonly transitionalItemKeys?: ReadonlySet<string>;
}): readonly MagicItemReadinessEntry[] {
  const items = new Map(
    input.records
      .filter((record) => record.kind === 'magic-item')
      .map((record) => [record.key, record] as const),
  );
  for (const key of input.clausesByItemKey.keys()) {
    if (!items.has(key)) {
      throw new Error(
        `magic-item clause integrity: unknown item key ${JSON.stringify(key)}`,
      );
    }
  }
  for (const key of items.keys()) {
    if (!input.clausesByItemKey.has(key)) {
      throw new Error(
        `magic-item clause integrity: registry is missing item key ${JSON.stringify(key)}`,
      );
    }
  }
  const landed = input.landedEngineHooks ?? new Set<string>();
  const transitional = input.transitionalItemKeys ?? new Set<string>();
  const engineVocabulary = new Set<string>(MAGIC_ITEM_ENGINE_FAMILIES);
  const result: MagicItemReadinessEntry[] = [];

  for (const [itemKey, record] of [...items].sort(([a], [b]) =>
    a.localeCompare(b),
  )) {
    const data = record.data as Obj;
    validateOperationReferences(itemKey, data);
    if (transitional.has(itemKey)) {
      result.push({ itemKey, readiness: 'transitional' });
      continue;
    }
    const clauses = input.clausesByItemKey.get(itemKey) ?? [];
    if (clauses.length === 0) {
      result.push({
        itemKey,
        readiness: 'red',
        reason: 'no registered clause expectations',
      });
      continue;
    }
    const seen = new Set<string>();
    for (const clause of clauses) {
      if (seen.has(clause.id)) duplicateId('clause', clause.id);
      seen.add(clause.id);
      const scope = clauseScope(itemKey, clause.id);
      if (
        scope.kind === 'variant' &&
        selectedVariant(data, scope.variantKey) === undefined
      )
        throw new Error(
          `magic-item clause integrity: ${clause.id} references unknown variant ${JSON.stringify(scope.variantKey)} in ${itemKey}`,
        );
      const representation = asObject(clause.representation);
      if (representation === undefined) {
        throw new Error(
          `magic-item clause integrity: ${clause.id} has no representation object`,
        );
      }
      let disposition: string;
      try {
        disposition = representationKind(representation);
      } catch (error) {
        throw new Error(
          `magic-item clause integrity: ${clause.id} ${(error as Error).message}`,
        );
      }
      for (const hook of clause.engineHooks ?? []) {
        if (!engineVocabulary.has(hook.engine)) {
          throw new Error(
            `magic-item clause integrity: ${clause.id} names unknown engine family ${JSON.stringify(hook.engine)}`,
          );
        }
        if (hook.hook.trim().length === 0) {
          throw new Error(
            `magic-item clause integrity: ${clause.id} has an empty engine hook`,
          );
        }
      }
      const declaredHooks =
        (clause.engineHooks?.length ?? 0) === 0
          ? undefined
          : clause.engineHooks;
      if (disposition === 'adjudicated') {
        const sourceText =
          'sourceText' in clause.representation
            ? clause.representation.sourceText
            : undefined;
        const description = data.description;
        if (
          typeof sourceText !== 'string' ||
          sourceText.length === 0 ||
          typeof description !== 'string' ||
          !description.includes(sourceText)
        ) {
          throw new Error(
            `magic-item clause integrity: ${clause.id} adjudicated sourceText is not a non-empty verbatim span of ${itemKey}'s printed description`,
          );
        }
        result.push({
          itemKey,
          clauseId: clause.id,
          scope,
          tag: clause.tag,
          readiness: 'adjudicated-by-design',
          representation: clause.representation,
          ...(declaredHooks === undefined
            ? {}
            : { engineHooks: declaredHooks }),
          reason:
            'note' in clause.representation
              ? clause.representation.note
              : undefined,
        });
        continue;
      }
      if (disposition === 'designBlocked') {
        result.push({
          itemKey,
          clauseId: clause.id,
          scope,
          tag: clause.tag,
          readiness: 'design-blocked',
          representation: clause.representation,
          ...(declaredHooks === undefined
            ? {}
            : { engineHooks: declaredHooks }),
          reason:
            'reason' in clause.representation
              ? clause.representation.reason
              : undefined,
        });
        continue;
      }
      if (!representationResolves(data, representation, scope)) {
        throw new Error(
          `magic-item clause integrity: ${clause.id} representation binding does not resolve in ${itemKey}`,
        );
      }
      const activationOwned =
        (declaredHooks ?? []).some((hook) =>
          ACTIVATION_ECONOMY_HOOK_KEYS.has(magicItemEngineHookKey(hook)),
        ) && activationEconomyOwned(data, representation, scope);
      const grantMechanics = effectiveMechanicsFor(data, scope);
      const grantOwned =
        representation.block === 'entityGrant' &&
        // The triaged mechanics no longer carry the printed death consequence
        // (PR #673 P2-2), so it is read from the reviewed spec by item key.
        !MAGIC_ITEM_ENTITY_GRANT_KEYS_WITH_DEATH_CONSEQUENCE.has(itemKey) &&
        creatureGrantLifecycleOwned(
          grantMechanics?.entityGrant,
          grantMechanics,
        );
      const missingHooks = (declaredHooks ?? []).filter((hook) => {
        const key = magicItemEngineHookKey(hook);
        if (landed.has(key)) return false;
        if (grantOwned && CREATURE_GRANT_LIFECYCLE_HOOK_KEYS.has(key))
          return false;
        return !(activationOwned && ACTIVATION_ECONOMY_HOOK_KEYS.has(key));
      });
      const common = {
        itemKey,
        clauseId: clause.id,
        scope,
        tag: clause.tag,
        representation: clause.representation,
        ...(declaredHooks === undefined ? {} : { engineHooks: declaredHooks }),
      };
      result.push(
        missingHooks.length === 0
          ? { ...common, readiness: 'green' }
          : {
              ...common,
              readiness: 'engine-pending',
              missingHooks,
              missingEngines: [
                ...new Set(missingHooks.map(({ engine }) => engine)),
              ].sort(),
            },
      );
    }
  }
  return result;
}

/** Persists the derived classifier output beside each source-grounded item.
 * This is not a second registry: entries are copied directly from the clause
 * registry/classifier result produced in the same compiler invocation. */
export function attachMagicItemExecutionReadiness(
  records: readonly RulesRecord[],
  readiness: readonly MagicItemReadinessEntry[],
): readonly RulesRecord[] {
  const byItem = new Map<string, MagicItemReadinessEntry[]>();
  for (const entry of readiness) {
    const entries = byItem.get(entry.itemKey) ?? [];
    entries.push(entry);
    byItem.set(entry.itemKey, entries);
  }
  return records.map((record) => {
    if (record.kind !== 'magic-item') return record;
    const entries = byItem.get(record.key);
    if (entries === undefined || entries.length === 0)
      throw new Error(
        `magic-item readiness persistence: no derived entries for ${record.key}`,
      );
    const clauses = entries.map(({ itemKey: _itemKey, ...entry }) => entry);
    return {
      ...record,
      data: {
        ...(record.data as Record<string, unknown>),
        executionReadiness: {
          source: 'derived-magic-item-clauses-v1',
          clauses,
        } satisfies MagicItemExecutionReadiness,
      },
    };
  });
}
