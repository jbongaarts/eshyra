import { adjustCharacterCurrency } from '../character/currency.js';
import {
  CURRENCY_AMOUNTS_SCHEMA,
  CURRENCY_TARGET_PROPERTY,
  currencyArgs,
  currencyContext,
  currencyError,
  isToolFailure,
  parseCurrencyAmounts,
} from './toolCurrencyShared.js';
import type { Tool } from './toolRegistry.js';

export const spendCurrencyTool: Tool = {
  name: 'spend_currency',
  mutates: true,
  requiresExplicitAction: true,
  description:
    'Record a completed canonical exact-denomination payment. Use only when the player actually pays; do not break larger coins, make change, or answer affordability questions.',
  inputSchema: {
    type: 'object',
    properties: {
      amounts: CURRENCY_AMOUNTS_SCHEMA,
      ...CURRENCY_TARGET_PROPERTY,
    },
    required: ['amounts'],
    additionalProperties: false,
  },
  run(args, ctx) {
    const record = currencyArgs(args);
    if (isToolFailure(record)) return record;
    const amounts = parseCurrencyAmounts(record.amounts);
    if ('ok' in amounts) return amounts;
    const target = currencyContext(ctx, record.character);
    if ('ok' in target) return target;
    try {
      return {
        ok: true,
        data: adjustCharacterCurrency(
          ctx.db,
          { kind: 'spend', amounts },
          target,
        ),
      };
    } catch (error) {
      return currencyError(error);
    }
  },
};
