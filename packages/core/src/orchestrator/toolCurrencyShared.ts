import {
  type CurrencyDenomination,
  DND5E_CURRENCY_DENOMINATIONS,
} from '../character/currency.js';
import type { JsonSchema } from '../model/toolSchema.js';
import { MutateStateError } from '../state/mutateState.js';
import type { ToolContext, ToolResult } from './toolRegistry.js';
import {
  asRecord,
  CHARACTER_TARGET_SCHEMA,
  err,
  resolveTargetCharacterId,
} from './toolRegistry.js';

export const CURRENCY_DENOMINATION_SCHEMA: JsonSchema = {
  type: 'string',
  enum: [...DND5E_CURRENCY_DENOMINATIONS],
};

export const CURRENCY_AMOUNTS_SCHEMA: JsonSchema = {
  type: 'object',
  description:
    'Exact-denomination coin amounts; at least one must be positive.',
  properties: Object.fromEntries(
    DND5E_CURRENCY_DENOMINATIONS.map((denomination) => [
      denomination,
      {
        type: 'integer',
        minimum: 0,
        maximum: Number.MAX_SAFE_INTEGER,
      },
    ]),
  ),
  additionalProperties: false,
};

export const CURRENCY_TARGET_PROPERTY = {
  character: CHARACTER_TARGET_SCHEMA,
} as const;

export function parseCurrencyAmounts(
  value: unknown,
): Record<CurrencyDenomination, number> | ToolResult {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return err('currency_error', 'amounts must be a denomination map');
  }
  const input = value as Record<string, unknown>;
  const amounts = {} as Record<CurrencyDenomination, number>;
  let total = 0;
  for (const key of Object.keys(input)) {
    if (!DND5E_CURRENCY_DENOMINATIONS.includes(key as CurrencyDenomination)) {
      return err('currency_error', `unknown currency denomination '${key}'`);
    }
  }
  for (const denomination of DND5E_CURRENCY_DENOMINATIONS) {
    const amount = input[denomination] ?? 0;
    if (
      typeof amount !== 'number' ||
      !Number.isSafeInteger(amount) ||
      amount < 0
    ) {
      return err(
        'currency_error',
        `${denomination} must be a non-negative integer`,
      );
    }
    amounts[denomination] = amount;
    total += amount;
  }
  if (total === 0) {
    return err(
      'currency_error',
      'amounts must include at least one positive coin',
    );
  }
  return amounts;
}

export function currencyContext(ctx: ToolContext, character: unknown) {
  const target = resolveTargetCharacterId(character, ctx);
  if ('ok' in target) return target;
  return {
    source: 'model-tool',
    provenance: `model:${ctx.turnId}`,
    sessionId: ctx.sessionId,
    at: ctx.at,
    ...(target.id === undefined ? {} : { characterId: target.id }),
  };
}

export function currencyArgs(
  args: unknown,
): Record<string, unknown> | ToolResult {
  const record = asRecord(args);
  return (
    record ?? err('currency_error', 'currency tool arguments must be an object')
  );
}

export function isToolFailure(value: unknown): value is ToolResult {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as Record<string, unknown>).ok === false
  );
}

export function currencyError(error: unknown): ToolResult {
  if (error instanceof MutateStateError) {
    return err('currency_error', error.message);
  }
  throw error;
}
