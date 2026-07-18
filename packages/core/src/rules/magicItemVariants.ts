import type {
  MagicItemMechanics,
  MagicItemOperation,
} from './magicItemMechanics.js';
import type { RulesRecord } from './types.js';

type Obj = Record<string, unknown>;

export interface MagicItemVariantDefinition {
  readonly id: string;
  readonly name: string;
  readonly rarity: string;
  readonly text: string;
  readonly mechanics?: MagicItemMechanics;
}

export class MagicItemVariantError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MagicItemVariantError';
  }
}

export function canonicalMagicItemVariantId(name: string): string {
  let id = '';
  let separatorPending = false;
  for (const character of name.toLowerCase()) {
    const code = character.charCodeAt(0);
    const isAsciiLetter = code >= 97 && code <= 122;
    const isAsciiDigit = code >= 48 && code <= 57;
    if (isAsciiLetter || isAsciiDigit) {
      if (separatorPending && id.length > 0) id += '-';
      id += character;
      separatorPending = false;
    } else if (character !== "'" && character !== '’') {
      separatorPending = true;
    }
  }
  if (id.length === 0)
    throw new MagicItemVariantError(
      'magic-item variant name has no canonical id',
    );
  return id;
}

function object(value: unknown, path: string): Obj {
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    throw new MagicItemVariantError(`${path} must be an object`);
  return value as Obj;
}

export function magicItemVariantDefinitions(
  record: RulesRecord,
): readonly MagicItemVariantDefinition[] {
  if (record.kind !== 'magic-item')
    throw new MagicItemVariantError(`${record.key} is not a magic-item record`);
  const data = object(record.data, `${record.key}.data`);
  if (data.variants === undefined) return [];
  if (!Array.isArray(data.variants) || data.variants.length === 0)
    throw new MagicItemVariantError(
      `${record.key}.data.variants must be non-empty`,
    );
  const ids = new Set<string>();
  return data.variants.map((raw, index) => {
    const path = `${record.key}.data.variants[${index}]`;
    const variant = object(raw, path);
    for (const field of ['id', 'name', 'rarity', 'text'] as const)
      if (typeof variant[field] !== 'string' || variant[field].length === 0)
        throw new MagicItemVariantError(`${path}.${field} must be non-empty`);
    const id = variant.id as string;
    if (id !== canonicalMagicItemVariantId(variant.name as string))
      throw new MagicItemVariantError(
        `${path}.id is not canonical for its name`,
      );
    if (ids.has(id))
      throw new MagicItemVariantError(
        `${record.key} has duplicate variant id '${id}'`,
      );
    ids.add(id);
    return variant as unknown as MagicItemVariantDefinition;
  });
}

export function resolveMagicItemVariant(
  record: RulesRecord,
  variantId: string | undefined,
): MagicItemVariantDefinition | undefined {
  const variants = magicItemVariantDefinitions(record);
  if (variants.length === 0) {
    if (variantId !== undefined)
      throw new MagicItemVariantError(
        `${record.key} does not declare variants`,
      );
    return undefined;
  }
  if (variantId === undefined)
    throw new MagicItemVariantError(
      `${record.key} requires variantId; expected one of ${variants.map((variant) => variant.id).join(', ')}`,
    );
  const variant = variants.find((candidate) => candidate.id === variantId);
  if (variant === undefined)
    throw new MagicItemVariantError(
      `${record.key} does not declare variantId '${variantId}'; expected one of ${variants.map((candidate) => candidate.id).join(', ')}`,
    );
  return variant;
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (typeof value === 'object' && value !== null)
    return `{${Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => `${JSON.stringify(key)}:${canonicalJson(child)}`)
      .join(',')}}`;
  return JSON.stringify(value);
}

function compatibleScalar<T>(
  operationId: string,
  field: string,
  left: T | undefined,
  right: T | undefined,
): T | undefined {
  if (left === undefined) return right;
  if (right === undefined) return left;
  if (canonicalJson(left) !== canonicalJson(right))
    throw new MagicItemVariantError(
      `magic-item variant mechanics conflict on operation '${operationId}' ${field}`,
    );
  return left;
}

function union(
  left: readonly string[] | undefined,
  right: readonly string[] | undefined,
) {
  const values = [...(left ?? [])];
  const seen = new Set(values);
  for (const value of right ?? [])
    if (!seen.has(value)) {
      seen.add(value);
      values.push(value);
    }
  return values.length === 0 ? undefined : values;
}

function mergeOperation(
  left: MagicItemOperation,
  right: MagicItemOperation,
): MagicItemOperation {
  const activation =
    left.activation === undefined
      ? right.activation
      : right.activation === undefined
        ? left.activation
        : ({
            ...left.activation,
            ...Object.fromEntries(
              Object.entries(right.activation).map(([field, value]) => [
                field,
                compatibleScalar(
                  left.id,
                  `activation.${field}`,
                  (left.activation as unknown as Obj)[field],
                  value,
                ),
              ]),
            ),
          } as MagicItemOperation['activation']);
  const costs = [...(left.cost ?? [])];
  const byEconomy = new Map(costs.map((cost) => [cost.economy, cost]));
  for (const cost of right.cost ?? []) {
    const existing = byEconomy.get(cost.economy);
    if (existing === undefined) {
      byEconomy.set(cost.economy, cost);
      costs.push(cost);
    } else if (canonicalJson(existing.amount) !== canonicalJson(cost.amount))
      throw new MagicItemVariantError(
        `magic-item variant mechanics conflict on operation '${left.id}' economy '${cost.economy}'`,
      );
  }
  return {
    id: left.id,
    ...(activation === undefined ? {} : { activation }),
    ...(costs.length === 0 ? {} : { cost: costs }),
    ...(union(left.excludes, right.excludes) === undefined
      ? {}
      : { excludes: union(left.excludes, right.excludes) }),
    ...(union(left.doesNotExpend, right.doesNotExpend) === undefined
      ? {}
      : { doesNotExpend: union(left.doesNotExpend, right.doesNotExpend) }),
    ...(union(left.effects, right.effects) === undefined
      ? {}
      : { effects: union(left.effects, right.effects) }),
    ...(compatibleScalar(left.id, 'note', left.note, right.note) === undefined
      ? {}
      : { note: compatibleScalar(left.id, 'note', left.note, right.note) }),
  };
}

const SINGLETONS = [
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

export function mergeMagicItemVariantMechanics(
  parent: MagicItemMechanics | undefined,
  variant: MagicItemMechanics | undefined,
): MagicItemMechanics | undefined {
  if (parent === undefined) return variant;
  if (variant === undefined) return parent;
  const result: Obj = { ...parent };
  for (const singleton of SINGLETONS) {
    if (parent[singleton] !== undefined && variant[singleton] !== undefined)
      throw new MagicItemVariantError(
        `magic-item variant mechanics conflict on singleton block '${singleton}'`,
      );
    if (variant[singleton] !== undefined)
      result[singleton] = variant[singleton];
  }
  const economies = { ...(parent.economies ?? {}) };
  for (const [id, economy] of Object.entries(variant.economies ?? {})) {
    if (Object.hasOwn(economies, id))
      throw new MagicItemVariantError(
        `magic-item variant mechanics duplicate economy id '${id}'`,
      );
    economies[id] = economy;
  }
  if (Object.keys(economies).length > 0) result.economies = economies;
  const effects = [...(parent.effects ?? [])];
  const effectIds = new Set(
    effects.map((effect) => effect.id).filter((id) => id !== undefined),
  );
  for (const effect of variant.effects ?? []) {
    if (effect.id !== undefined && effectIds.has(effect.id))
      throw new MagicItemVariantError(
        `magic-item variant mechanics duplicate effect id '${effect.id}'`,
      );
    if (effect.id !== undefined) effectIds.add(effect.id);
    effects.push(effect);
  }
  if (effects.length > 0) result.effects = effects;
  const operations = new Map(
    (parent.operations ?? []).map((operation) => [operation.id, operation]),
  );
  for (const operation of variant.operations ?? []) {
    const existing = operations.get(operation.id);
    operations.set(
      operation.id,
      existing === undefined ? operation : mergeOperation(existing, operation),
    );
  }
  if (operations.size > 0) result.operations = [...operations.values()];
  return result as unknown as MagicItemMechanics;
}

export function effectiveMagicItemMechanics(
  record: RulesRecord,
  variantId: string | undefined,
): MagicItemMechanics | undefined {
  const data = object(record.data, `${record.key}.data`);
  const selected = resolveMagicItemVariant(record, variantId);
  return mergeMagicItemVariantMechanics(
    data.mechanics as MagicItemMechanics | undefined,
    selected?.mechanics,
  );
}
