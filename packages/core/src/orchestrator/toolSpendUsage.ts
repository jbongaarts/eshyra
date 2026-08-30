import type {
  DeclaredUsageEconomy,
  UsageResetKind,
} from '../state/usageCounters.js';
import { spendUsage, UsageCounterError } from '../state/usageCounters.js';
import type { Tool } from './toolRegistry.js';
import { asRecord, err, ok } from './toolRegistry.js';
import {
  PARTICIPANT_SCHEMA_PROPERTIES,
  parseTurnParticipant,
} from './toolTurnParticipant.js';

const RESET_KINDS: readonly UsageResetKind[] = [
  'recharge_roll',
  'short_rest',
  'short_or_long_rest',
  'long_rest',
  'dawn',
];

export const spendUsageTool: Tool = {
  name: 'spend_usage',
  // Writes the owner's durable usage-counter record (eshyra-dwkm).
  mutates: true,
  description:
    'Spend a use of a limited-use ability (X/Day, Recharge X-Y, ' +
    'recharge-after-rest, per-day innate spell) or charges of a legacy/ad-hoc unbound item. ' +
    "A combatant's economy derives from its creature record — pass only " +
    'ability (the statblock name, e.g. "Fire Breath" or "misty step"). ' +
    'Canonical pack-bound item operations and economies must use use_item. ' +
    'For character abilities and unbound item charges there is no structured ' +
    'economy yet: look the feature/item up via lookup_rules first, then ' +
    'pass maxUses + reset (and rechargeMinimum for recharge_roll, or ' +
    'rechargeFormula like "1d6+1" for partial dawn recharges) on the ' +
    'FIRST spend; later spends use the recorded economy. The engine ' +
    'refuses over-spends. args: { ability?: string, itemId?: string, ' +
    'combatantId?: string, character?: string, uses?: integer, maxUses?: ' +
    'integer, reset?: "recharge_roll"|"short_rest"|"short_or_long_rest"|' +
    '"long_rest"|"dawn", rechargeMinimum?: integer, rechargeFormula?: ' +
    'string }.',
  inputSchema: {
    type: 'object',
    properties: {
      ability: {
        type: 'string',
        description:
          'Ability/feature/spell name as the statblock or sheet prints it, ' +
          'e.g. "Fire Breath", "Legendary Resistance", "misty step". Omit ' +
          'only for item-charge spends.',
        minLength: 1,
      },
      itemId: {
        type: 'string',
        description:
          'Inventory item id for item-charge spends (the owning character ' +
          'must hold the item).',
        minLength: 1,
      },
      ...PARTICIPANT_SCHEMA_PROPERTIES,
      uses: {
        type: 'integer',
        description: 'Uses/charges expended (default 1).',
        minimum: 1,
      },
      maxUses: {
        type: 'integer',
        description:
          'First spend of a declared economy only: total uses/charges, ' +
          'transcribed from the record via lookup_rules.',
        minimum: 1,
      },
      reset: {
        type: 'string',
        enum: RESET_KINDS,
        description:
          'First spend of a declared economy only: the event that restores ' +
          'it.',
      },
      rechargeMinimum: {
        type: 'integer',
        description:
          'With reset "recharge_roll": recharges on this d6 result or ' +
          'higher (2-6).',
        minimum: 2,
        maximum: 6,
      },
      rechargeFormula: {
        type: 'string',
        description:
          'With reset "dawn": partial recharge formula, e.g. "1d6+1" for ' +
          '"regains 1d6 + 1 expended charges daily at dawn".',
        minLength: 1,
      },
    },
    additionalProperties: false,
  },
  run(args, ctx) {
    const a = asRecord(args) ?? {};
    if (a.ability !== undefined && typeof a.ability !== 'string') {
      return err('invalid_args', 'spend_usage ability must be a string');
    }
    if (a.itemId !== undefined && typeof a.itemId !== 'string') {
      return err('invalid_args', 'spend_usage itemId must be a string');
    }
    if (a.ability === undefined && a.itemId === undefined) {
      return err(
        'invalid_args',
        'spend_usage requires ability (statblock name) or itemId',
      );
    }
    const owner = parseTurnParticipant(a, ctx, 'spend_usage');
    if ('ok' in owner) {
      return owner;
    }
    let declared: DeclaredUsageEconomy | undefined;
    if (a.maxUses !== undefined || a.reset !== undefined) {
      if (typeof a.maxUses !== 'number' || typeof a.reset !== 'string') {
        return err(
          'invalid_args',
          'a declared economy needs both maxUses and reset',
        );
      }
      if (!RESET_KINDS.includes(a.reset as UsageResetKind)) {
        return err(
          'invalid_args',
          `spend_usage reset must be one of: ${RESET_KINDS.join(', ')}`,
        );
      }
      declared = {
        maxUses: a.maxUses,
        reset: a.reset as UsageResetKind,
        ...(typeof a.rechargeMinimum === 'number'
          ? { rechargeMinimum: a.rechargeMinimum }
          : {}),
        ...(typeof a.rechargeFormula === 'string'
          ? { rechargeFormula: a.rechargeFormula }
          : {}),
      };
    } else if (
      a.rechargeMinimum !== undefined ||
      a.rechargeFormula !== undefined
    ) {
      return err(
        'invalid_args',
        'rechargeMinimum/rechargeFormula apply only with a declared economy (maxUses + reset)',
      );
    }
    try {
      return ok(
        spendUsage(ctx.db, {
          campaignId: ctx.campaignId,
          owner,
          ...(typeof a.ability === 'string' ? { ability: a.ability } : {}),
          ...(typeof a.itemId === 'string' ? { itemId: a.itemId } : {}),
          ...(typeof a.uses === 'number' ? { uses: a.uses } : {}),
          ...(declared === undefined ? {} : { declared }),
          resolveRulesPack: ctx.resolveRulesPack,
          provenance: `model:${ctx.turnId}`,
          sessionId: ctx.sessionId,
          at: ctx.at,
        }),
      );
    } catch (e) {
      if (e instanceof UsageCounterError) {
        return err('usage_error', e.message);
      }
      throw e;
    }
  },
};
