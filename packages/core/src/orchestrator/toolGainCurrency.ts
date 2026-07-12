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

export const gainCurrencyTool: Tool = {
  name: 'gain_currency',
  mutates: true,
  requiresExplicitAction: true,
  description:
    'Record a completed canonical currency gain for actual rewards, earnings, sales, refunds, or coins physically received. Do not call for prices, offers, or hypothetical rewards.',
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
          { kind: 'gain', amounts },
          target,
        ),
      };
    } catch (error) {
      return currencyError(error);
    }
  },
};
