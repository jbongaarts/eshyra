import type {
  MagicItemEffect,
  MagicItemMechanics,
  MagicItemOperation,
} from '../../../src/rules/magicItemMechanics.js';
import type { RulesRecord } from '../../../src/rules/types.js';

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
  | { readonly adjudicated: true; readonly note: string }
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
  readonly readiness: MagicItemReadiness;
  readonly missingEngines?: readonly MagicItemEngineFamily[];
  readonly reason?: string;
}

type Obj = Record<string, unknown>;

function asObject(value: unknown): Obj | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Obj)
    : undefined;
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

function mechanicsScopes(data: Obj): readonly Obj[] {
  const scopes: Obj[] = [];
  const direct = asObject(data.mechanics);
  if (direct !== undefined) scopes.push(direct);
  if (Array.isArray(data.variants)) {
    for (const variant of data.variants) {
      const nested = asObject(asObject(variant)?.mechanics);
      if (nested !== undefined) scopes.push(nested);
    }
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

function representationResolves(data: Obj, representation: Obj): boolean {
  const kind = representationKind(representation);
  if (kind !== 'block') return true;
  const block = representation.block;
  if (block === 'structuredField') {
    if (typeof representation.field !== 'string') return false;
    const value = data[representation.field];
    return (
      value !== undefined &&
      (representation.ref === undefined ||
        (typeof representation.ref === 'string' &&
          fieldContainsRef(value, representation.ref)))
    );
  }
  const scopes = mechanicsScopes(data);
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

function validateOperationReferences(itemKey: string, data: Obj): void {
  for (const scope of mechanicsScopes(data)) {
    const economies = asObject(scope.economies) ?? {};
    const effects = new Set(
      (Array.isArray(scope.effects) ? scope.effects : [])
        .map((effect) => asObject(effect)?.id)
        .filter((id): id is string => typeof id === 'string'),
    );
    const operationIds = new Set<string>();
    for (const raw of Array.isArray(scope.operations) ? scope.operations : []) {
      const operation = asObject(raw);
      if (operation === undefined) continue;
      const operationId = operation.id;
      if (typeof operationId !== 'string') continue;
      if (operationIds.has(operationId)) duplicateId('operation', operationId);
      operationIds.add(operationId);
      for (const rawCost of Array.isArray(operation.cost)
        ? operation.cost
        : []) {
        const economy = asObject(rawCost)?.economy;
        if (typeof economy !== 'string' || !Object.hasOwn(economies, economy)) {
          throw new Error(
            `magic-item clause integrity: ${itemKey} operation ${operationId} references unknown economy ${JSON.stringify(economy)}`,
          );
        }
      }
      for (const effectId of Array.isArray(operation.effects)
        ? operation.effects
        : []) {
        if (typeof effectId !== 'string' || !effects.has(effectId)) {
          throw new Error(
            `magic-item clause integrity: ${itemKey} operation ${operationId} references unknown effect ${JSON.stringify(effectId)}`,
          );
        }
      }
    }
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
  readonly landedEngineFamilies?: ReadonlySet<MagicItemEngineFamily>;
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
  const landed = input.landedEngineFamilies ?? new Set<MagicItemEngineFamily>();
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
      if (disposition === 'adjudicated') {
        result.push({
          itemKey,
          clauseId: clause.id,
          readiness: 'adjudicated-by-design',
        });
        continue;
      }
      if (disposition === 'designBlocked') {
        result.push({
          itemKey,
          clauseId: clause.id,
          readiness: 'design-blocked',
        });
        continue;
      }
      if (!representationResolves(data, representation)) {
        throw new Error(
          `magic-item clause integrity: ${clause.id} representation binding does not resolve in ${itemKey}`,
        );
      }
      const missing = (clause.engineHooks ?? [])
        .map((hook) => hook.engine)
        .filter((engine) => !landed.has(engine));
      result.push(
        missing.length === 0
          ? { itemKey, clauseId: clause.id, readiness: 'green' }
          : {
              itemKey,
              clauseId: clause.id,
              readiness: 'engine-pending',
              missingEngines: [...new Set(missing)].sort(),
            },
      );
    }
  }
  return result;
}
