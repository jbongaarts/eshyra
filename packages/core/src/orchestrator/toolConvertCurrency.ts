import {
  convertCharacterCurrency,
  DND5E_CURRENCY_DENOMINATIONS,
} from '../character/currency.js';
import {
  CURRENCY_DENOMINATION_SCHEMA,
  CURRENCY_TARGET_PROPERTY,
  currencyArgs,
  currencyContext,
  currencyError,
  isToolFailure,
} from './toolCurrencyShared.js';
import type { Tool } from './toolRegistry.js';

export const convertCurrencyTool: Tool = {
  name: 'convert_currency',
  mutates: true,
  requiresExplicitAction: true,
  description:
    'Record a completed exact denomination conversion without changing total value. Use explicitly before a payment when re-denomination or change is required; this is not a purchase or sale.',
  inputSchema: {
    type: 'object',
    properties: {
      amount: { type: 'integer', minimum: 1 },
      from: { ...CURRENCY_DENOMINATION_SCHEMA },
      to: { ...CURRENCY_DENOMINATION_SCHEMA },
      ...CURRENCY_TARGET_PROPERTY,
    },
    required: ['amount', 'from', 'to'],
    additionalProperties: false,
  },
  run(args, ctx) {
    const record = currencyArgs(args);
    if (isToolFailure(record)) return record;
    if (
      typeof record.amount !== 'number' ||
      !Number.isInteger(record.amount) ||
      record.amount < 1 ||
      typeof record.from !== 'string' ||
      typeof record.to !== 'string' ||
      !DND5E_CURRENCY_DENOMINATIONS.includes(record.from as never) ||
      !DND5E_CURRENCY_DENOMINATIONS.includes(record.to as never)
    ) {
      return {
        ok: false,
        code: 'currency_error',
        message: 'invalid currency conversion',
      };
    }
    const target = currencyContext(ctx, record.character);
    if ('ok' in target) return target;
    try {
      return {
        ok: true,
        data: convertCharacterCurrency(
          ctx.db,
          {
            amount: record.amount,
            from: record.from as never,
            to: record.to as never,
          },
          target,
        ),
      };
    } catch (error) {
      return currencyError(error);
    }
  },
};
