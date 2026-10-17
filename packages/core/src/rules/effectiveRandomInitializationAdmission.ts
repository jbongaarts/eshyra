import {
  initialStateTableRefs,
  randomInitializationTableViolation,
} from '../state/itemRandomInitialization.js';
import type { ResolvedRulesStack } from './stack.js';
import { RulesPackError } from './types.js';

/**
 * Effective-stack admission for magic-item `randomInitialization` tables
 * (eshyra-3xi0), the sibling of `assertEffectiveEconomyDeductions`.
 *
 * Item creation and state validation read each `initial-state` procedure's
 * table through the layered stack, so a table-only add-on that overrides the
 * table is valid standalone yet can break the shape the procedure needs. Each
 * magic item in the effective stack (base and variant mechanics) is checked
 * against the table that wins the same precedence execution resolves, by the
 * same contract execution throws on (`randomInitializationTableViolation`).
 * Only items whose winning record or winning table comes from an add-on are
 * checked; `validateRulesPack` is not widened. Execution keeps its refusal.
 */
export function assertEffectiveRandomInitializationTables(
  stack: ResolvedRulesStack,
): void {
  if (stack.addons.length === 0) return;
  const tables = stack.recordsByKind.get('table')?.byKey;
  const items = stack.recordsByKind.get('magic-item')?.byKey;
  if (items === undefined) return;
  for (const [key, item] of items) {
    const data = item.record.data as {
      mechanics?: unknown;
      variants?: unknown;
    } | null;
    const variants = Array.isArray(data?.variants) ? data.variants : [];
    const refs = new Set([
      ...initialStateTableRefs(data?.mechanics),
      ...variants.flatMap((variant) =>
        initialStateTableRefs((variant as { mechanics?: unknown })?.mechanics),
      ),
    ]);
    for (const tableRef of refs) {
      const table = tables?.get(tableRef);
      const contributor =
        item.pack !== stack.base
          ? item.pack.meta.packId
          : table !== undefined && table.pack !== stack.base
            ? table.pack.meta.packId
            : undefined;
      if (contributor === undefined) continue;
      const violation = randomInitializationTableViolation(
        tableRef,
        table?.record,
      );
      if (violation !== undefined)
        throw new RulesPackError(
          `add-on ${contributor} yields an effective randomInitialization table ${tableRef} on ${key} that is invalid in the layered stack: ${violation}`,
        );
    }
  }
}
