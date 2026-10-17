import { magicItemEconomyDeductionViolation } from './magicItemMechanics.js';
import type { ResolvedRulesStack } from './stack.js';
import { RulesPackError } from './types.js';

/**
 * Effective-stack admission for magic-item `economyDeduction` (eshyra-w750).
 *
 * `validateRulesPack` checks a deduction only against the table of the pack
 * that declares it, so a table-only add-on that overrides the table by key is
 * valid standalone yet changes what the deduction reads. This runs where the
 * layered result is known: each magic item in the effective stack is checked,
 * by the same shared contract execution uses
 * (`magicItemEconomyDeductionViolation`), against the table that wins the same
 * precedence execution resolves (`stack.recordsByKind` `table` by key).
 *
 * Only items whose winning record or winning table comes from an add-on are
 * checked: a base-only deduction is already admitted by `validateRulesPack`,
 * which this deliberately does not widen. Execution keeps its own refusal
 * (`itemResetExecutor.ts`) as defence in depth.
 */
export function assertEffectiveEconomyDeductions(
  stack: ResolvedRulesStack,
): void {
  if (stack.addons.length === 0) return;
  const tables = stack.recordsByKind.get('table')?.byKey;
  const items = stack.recordsByKind.get('magic-item')?.byKey;
  if (items === undefined) return;
  for (const [key, item] of items) {
    let contributor: string | undefined =
      item.pack === stack.base ? undefined : item.pack.meta.packId;
    const violation = magicItemEconomyDeductionViolation(
      item.record.data,
      (tableRef) => {
        const table = tables?.get(tableRef);
        if (table !== undefined && table.pack !== stack.base)
          contributor = table.pack.meta.packId;
        return table?.record.data;
      },
    );
    if (violation !== undefined && contributor !== undefined)
      throw new RulesPackError(
        `add-on ${contributor} yields an effective economyDeduction on ${key} that is invalid in the layered stack: ${violation}`,
      );
  }
}
