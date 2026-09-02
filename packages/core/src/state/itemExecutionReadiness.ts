import type { DeterministicCapabilityContract } from '../rules/deterministicCapabilityContract.js';
import { canonicalMagicItemVariantId } from '../rules/magicItemVariants.js';
import type { RulesRecord } from '../rules/types.js';

type Obj = Record<string, unknown>;

export class ItemExecutionReadinessError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ItemExecutionReadinessError';
  }
}

function object(value: unknown): Obj | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Obj)
    : undefined;
}

function inSelectedScope(
  scope: unknown,
  variantId: string | undefined,
): boolean {
  const value = object(scope);
  if (value?.kind === 'parent') return true;
  if (value?.kind === 'variant' && typeof value.variantKey === 'string')
    return (
      variantId !== undefined &&
      canonicalMagicItemVariantId(value.variantKey) === variantId
    );
  throw new ItemExecutionReadinessError(
    'execution-readiness clause has an unrecognized scope',
  );
}

function hookLabel(raw: unknown): string | undefined {
  const hook = object(raw);
  return typeof hook?.engine === 'string' && typeof hook.hook === 'string'
    ? `${hook.engine}:${hook.hook}`
    : undefined;
}

export interface ItemOperationReadinessInput {
  readonly operationId: string;
  readonly economyIds: ReadonlySet<string>;
  readonly operationEffectIds: ReadonlySet<string>;
  readonly effectIds: ReadonlySet<string>;
  readonly usesStateMachine: boolean;
  readonly usesSpellStore: boolean;
}

/**
 * Positive capability contract for the magic-item mutation preflight.
 *
 * This declares only whether a particular, already-selected operation has a
 * trusted readiness binding. It does not execute item semantics or decide
 * whether an item operation is applicable; those remain with the item engine
 * and the DM respectively. Unknown readiness shapes fail closed below.
 */
export const MAGIC_ITEM_OPERATION_READINESS_CAPABILITY: DeterministicCapabilityContract =
  Object.freeze({
    revision: 'derived-magic-item-clauses-v1',
    operationId: 'assertMagicItemOperationReady',
    operation:
      'Preflight a selected magic-item operation before live state mutation.',
    requiredInputs: [
      'A magic-item RulesRecord carrying the trusted derived execution-readiness contract.',
      'The selected parent or canonical variant identity.',
      'A validated operation id and its bound economies, effects, state-machine, and spell-store inputs.',
    ],
    exclusions: [
      'Does not execute the item operation or supply missing item semantics.',
      'Does not claim that every clause of the item record is implemented.',
      'Does not infer a capability from typed mechanics fields or an absent readiness binding.',
    ],
    residualDmInterpretation: [
      'Whether the player may attempt the operation and how source prose applies remain DM rulings.',
      'Any item semantics outside the positively bound operation remain with the DM or another explicit capability.',
    ],
  });

/**
 * Enforces the compiler's executable-ownership boundary before live state is
 * mutated. The runtime considers only the selected parent/variant scope and
 * the operation's bound mechanics. Item-wide singleton blocks are conservative
 * by design because the compiler does not claim a narrower operation binding.
 */
export function assertMagicItemOperationReady(
  record: RulesRecord,
  variantId: string | undefined,
  input: ItemOperationReadinessInput,
): void {
  const data = object(record.data);
  const readiness = object(data?.executionReadiness);
  if (
    readiness?.source !== 'derived-magic-item-clauses-v1' ||
    !Array.isArray(readiness.clauses)
  )
    throw new ItemExecutionReadinessError(
      `${record.key} has no trusted derived execution-readiness contract`,
    );

  const blockers: string[] = [];
  const ownedEconomyIds = new Set<string>();
  const representedEffectIds = new Set<string>();
  let hasOperationOutcomeOwner = false;
  for (const rawClause of readiness.clauses) {
    const clause = object(rawClause);
    if (clause === undefined || !inSelectedScope(clause.scope, variantId))
      continue;
    const representation = object(clause.representation);
    let relevant =
      clause.readiness === 'red' ||
      clause.readiness === 'transitional' ||
      representation?.designBlocked === true;
    if (representation?.block === 'operations')
      relevant = representation.operationId === input.operationId;
    else if (representation?.block === 'economies')
      relevant =
        typeof representation.economyId === 'string' &&
        input.economyIds.has(representation.economyId);
    else if (representation?.block === 'effects')
      relevant =
        typeof representation.effectId === 'string' &&
        input.effectIds.has(representation.effectId);
    else if (representation?.block === 'stateMachine')
      relevant = input.usesStateMachine;
    else if (representation?.block === 'spellStore')
      relevant = input.usesSpellStore;
    else if (
      typeof representation?.block === 'string' &&
      representation.block !== 'structuredField'
    )
      relevant = true;
    if (!relevant) continue;
    if (
      representation?.block === 'economies' &&
      typeof representation.economyId === 'string'
    )
      ownedEconomyIds.add(representation.economyId);
    if (
      representation?.block === 'effects' ||
      representation?.block === 'stateMachine' ||
      representation?.block === 'spellStore'
    )
      hasOperationOutcomeOwner = true;
    if (
      representation?.block === 'effects' &&
      typeof representation.effectId === 'string'
    )
      representedEffectIds.add(representation.effectId);
    if (
      clause.readiness !== 'engine-pending' &&
      clause.readiness !== 'design-blocked' &&
      clause.readiness !== 'red' &&
      clause.readiness !== 'transitional'
    )
      continue;
    const hooks = (
      Array.isArray(clause.missingHooks) ? clause.missingHooks : []
    )
      .map(hookLabel)
      .filter((value): value is string => value !== undefined);
    blockers.push(
      `${String(clause.clauseId ?? 'unscoped-clause')} (${String(clause.readiness)}${hooks.length === 0 ? '' : `: ${hooks.join(', ')}`})`,
    );
  }
  for (const economyId of input.economyIds)
    if (!ownedEconomyIds.has(economyId) && !hasOperationOutcomeOwner)
      blockers.push(
        `economy '${economyId}' has no trusted semantic owner connecting this spend to an effect, transition, spell-store contract, or reviewed economy clause`,
      );
  for (const effectId of input.operationEffectIds)
    if (!representedEffectIds.has(effectId))
      blockers.push(
        `operation effect '${effectId}' has no exact trusted readiness clause`,
      );
  if (blockers.length > 0)
    throw new ItemExecutionReadinessError(
      `${record.key} operation '${input.operationId}' is not safely executable: ${blockers.join('; ')}`,
    );
}
