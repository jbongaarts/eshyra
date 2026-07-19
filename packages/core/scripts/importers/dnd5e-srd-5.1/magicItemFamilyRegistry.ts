import type { MagicItemMechanics } from '../../../src/rules/magicItemMechanics.js';
import type { RulesRecord } from '../../../src/rules/types.js';
import { projectMagicItemActivatedEffects } from './magicItemActivatedEffects.js';
import { projectMagicItemChargeEconomies } from './magicItemChargeEconomies.js';
import {
  projectMagicItemStaticCombatModifiers,
  projectMagicItemStaticCombatVariantModifiers,
} from './magicItemCombatModifiers.js';
import {
  aggregateMagicItemFamilyProjections,
  type ItemClauseExpectation,
  type MagicItemClauseTag,
  type MagicItemFamilyProjection,
} from './magicItemCompiler.js';
import { projectMagicItemComplexStateMachine } from './magicItemComplexStateMachines.js';
import { projectMagicItemConsumable } from './magicItemConsumables.js';
import { projectMagicItemContainmentInteractions } from './magicItemContainmentInteractions.js';
import { projectMagicItemCurses } from './magicItemCurses.js';
import { projectMagicItemEntityGrants } from './magicItemEntityGrants.js';
import {
  projectMagicItemPassiveMechanics,
  projectMagicItemPassiveVariantMechanics,
} from './magicItemPassiveEffects.js';
import { projectMagicItemRandomProcedures } from './magicItemRandomProcedures.js';
import { projectMagicItemResidualCombatEffects } from './magicItemResidualCombatEffects.js';
import { projectMagicItemSimpleStateMachine } from './magicItemSimpleStateMachines.js';
import {
  projectMagicItemSpellRollInterop,
  projectMagicItemSpellRollInteropVariant,
} from './magicItemSpellRollInterop.js';
import {
  projectMagicItemDesignBlockedClause,
  projectMagicItemStructuredClauses,
} from './magicItemStructuredClauses.js';
import {
  projectMagicItemUseEconomies,
  projectMagicItemUseVariantEconomies,
} from './magicItemUseEconomies.js';
import type { MagicItemExtraction, MagicItemVariant } from './types.js';

type ParentProjector = (
  item: MagicItemExtraction,
) => MagicItemFamilyProjection | undefined;
type VariantProjector = (
  parentName: string,
  variant: MagicItemVariant,
) => MagicItemFamilyProjection | undefined;

/** The sole authoritative ordering-independent registry of family projectors. */
const PARENT_PROJECTORS: readonly ParentProjector[] = [
  projectMagicItemActivatedEffects,
  projectMagicItemChargeEconomies,
  projectMagicItemStaticCombatModifiers,
  projectMagicItemComplexStateMachine,
  projectMagicItemConsumable,
  projectMagicItemContainmentInteractions,
  projectMagicItemCurses,
  projectMagicItemEntityGrants,
  projectMagicItemPassiveMechanics,
  projectMagicItemRandomProcedures,
  projectMagicItemResidualCombatEffects,
  projectMagicItemSimpleStateMachine,
  projectMagicItemSpellRollInterop,
  projectMagicItemUseEconomies,
];

const VARIANT_PROJECTORS: readonly VariantProjector[] = [
  projectMagicItemStaticCombatVariantModifiers,
  projectMagicItemPassiveVariantMechanics,
  projectMagicItemSpellRollInteropVariant,
  projectMagicItemUseVariantEconomies,
];

function defined<T>(value: T | undefined): value is T {
  return value !== undefined;
}

function slug(value: string): string {
  return value
    .toLowerCase()
    .replace(/[’']/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/** Family-local clause ids are readable in their owning specs. The compiled
 * registry namespaces them by source item/variant so readiness evidence is
 * globally stable and cannot alias an unrelated item's similarly named use. */
function namespaceProjection(
  projection: MagicItemFamilyProjection,
  scope: string,
): MagicItemFamilyProjection {
  return {
    ...projection,
    clauses: projection.clauses.map((clause) => ({
      ...clause,
      id: `${scope}/${clause.id}`,
    })),
  };
}

/** S and DB are centralized below; discard legacy family-local dispositions. */
function withoutCentralDispositions(
  projection: MagicItemFamilyProjection,
): MagicItemFamilyProjection {
  return {
    ...projection,
    clauses: projection.clauses.filter(
      (clause) => clause.tag !== 'S' && clause.tag !== 'DB',
    ),
  };
}

function parentProjections(
  item: MagicItemExtraction,
): readonly MagicItemFamilyProjection[] {
  return PARENT_PROJECTORS.map((project) => project(item))
    .filter(defined)
    .map(withoutCentralDispositions)
    .map((projection) =>
      namespaceProjection(projection, `magic-item:${slug(item.name)}`),
    );
}

function variantProjections(
  parentName: string,
  variant: MagicItemVariant,
): readonly MagicItemFamilyProjection[] {
  return VARIANT_PROJECTORS.map((project) => project(parentName, variant))
    .filter(defined)
    .map(withoutCentralDispositions)
    .map((projection) =>
      namespaceProjection(
        projection,
        `magic-item:${slug(parentName)}/variant:${slug(variant.name)}`,
      ),
    );
}

export interface CompiledMagicItemFamilies {
  readonly mechanics: MagicItemMechanics | undefined;
  readonly clauses: readonly ItemClauseExpectation[];
  readonly variants: ReadonlyMap<
    string,
    {
      readonly mechanics: MagicItemMechanics | undefined;
      readonly clauses: readonly ItemClauseExpectation[];
    }
  >;
}

/** Compile every parent and variant family exactly once per mechanics scope. */
export function compileMagicItemFamilies(
  item: MagicItemExtraction,
): CompiledMagicItemFamilies {
  const parent = aggregateMagicItemFamilyProjections(parentProjections(item));
  const variants = new Map<
    string,
    {
      readonly mechanics: MagicItemMechanics | undefined;
      readonly clauses: readonly ItemClauseExpectation[];
    }
  >();
  for (const variant of item.variants ?? []) {
    if (variants.has(variant.name)) {
      throw new Error(
        `magic-item family registry: duplicate variant ${JSON.stringify(variant.name)} in ${JSON.stringify(item.name)}`,
      );
    }
    variants.set(
      variant.name,
      aggregateMagicItemFamilyProjections(
        variantProjections(item.name, variant),
      ),
    );
  }
  return { ...parent, variants };
}

function itemKey(name: string): string {
  return `magic-item:${slug(name)}`;
}

export const MAGIC_ITEM_REVIEWED_TAG_ITEM_COUNTS = Object.freeze({
  C1: 105,
  C2: 169,
  S: 50,
  DB: 1,
  M1: 31,
  M2: 23,
  M3: 38,
  M4: 17,
  M5: 50,
  M6: 10,
  M7: 12,
  M8: 18,
  M9: 7,
  M10: 7,
  M11: 9,
} satisfies Partial<Record<MagicItemClauseTag, number>>);

export function magicItemClauseTagCensus(
  clausesByItemKey: ReadonlyMap<string, readonly ItemClauseExpectation[]>,
): Readonly<Record<string, number>> {
  const counts: Record<string, number> = {};
  for (const clauses of clausesByItemKey.values()) {
    for (const tag of new Set(clauses.map((entry) => entry.tag))) {
      counts[tag] = (counts[tag] ?? 0) + 1;
    }
  }
  return counts;
}

function assertFullCorpusCensus(
  clausesByItemKey: ReadonlyMap<string, readonly ItemClauseExpectation[]>,
): void {
  if (clausesByItemKey.size !== 240) return;
  const actual = magicItemClauseTagCensus(clausesByItemKey);
  for (const [tag, expected] of Object.entries(
    MAGIC_ITEM_REVIEWED_TAG_ITEM_COUNTS,
  )) {
    if ((actual[tag] ?? 0) !== expected) {
      throw new Error(
        `magic-item family registry census: ${tag} projected for ${actual[tag] ?? 0} items; reviewed inventory requires ${expected}`,
      );
    }
  }
  const unexpected = Object.keys(actual).filter(
    (tag) => !Object.hasOwn(MAGIC_ITEM_REVIEWED_TAG_ITEM_COUNTS, tag),
  );
  if (unexpected.length > 0) {
    throw new Error(
      `magic-item family registry census: unexpected clause tags ${unexpected.sort().join(', ')}`,
    );
  }
}

/**
 * Build the one clause registry consumed by readiness validation. Structured S
 * bindings are added only after table ownership links have landed on records.
 */
export function buildMagicItemClausesByItemKey(
  items: readonly MagicItemExtraction[],
  records: readonly RulesRecord[],
  options: { readonly assertReviewedCensus?: false } = {},
): ReadonlyMap<string, readonly ItemClauseExpectation[]> {
  const recordsByKey = new Map(
    records
      .filter((record) => record.kind === 'magic-item')
      .map((record) => [record.key, record] as const),
  );
  const result = new Map<string, readonly ItemClauseExpectation[]>();
  for (const item of items) {
    const key = itemKey(item.name);
    const record = recordsByKey.get(key);
    if (record === undefined) {
      throw new Error(
        `magic-item family registry: extraction ${JSON.stringify(item.name)} has no emitted record`,
      );
    }
    const compiled = compileMagicItemFamilies(item);
    const structured = projectMagicItemStructuredClauses(record);
    const designBlocked = projectMagicItemDesignBlockedClause(item);
    const parent = aggregateMagicItemFamilyProjections([
      ...parentProjections(item),
      ...(structured === undefined
        ? []
        : [namespaceProjection(structured, key)]),
      ...(designBlocked === undefined
        ? []
        : [namespaceProjection(designBlocked, key)]),
    ]);
    const clauses = [
      ...parent.clauses,
      ...[...compiled.variants.values()].flatMap((variant) => variant.clauses),
    ].sort((a, b) => a.id.localeCompare(b.id));
    if (result.has(key)) {
      throw new Error(
        `magic-item family registry: duplicate extraction key ${JSON.stringify(key)}`,
      );
    }
    result.set(key, clauses);
  }
  for (const key of recordsByKey.keys()) {
    if (!result.has(key)) {
      throw new Error(
        `magic-item family registry: emitted record ${JSON.stringify(key)} has no source extraction`,
      );
    }
  }
  if (options.assertReviewedCensus !== false) assertFullCorpusCensus(result);
  return result;
}
