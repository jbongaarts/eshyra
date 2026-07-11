import { restoreUsage, UsageCounterError } from '../state/usageCounters.js';
import type { Tool } from './toolRegistry.js';
import { asRecord, err, ok } from './toolRegistry.js';
import {
  PARTICIPANT_SCHEMA_PROPERTIES,
  parseTurnParticipant,
} from './toolTurnParticipant.js';

export const restoreUsageTool: Tool = {
  name: 'restore_usage',
  // Writes the owner's durable usage-counter record (eshyra-dwkm).
  mutates: true,
  description:
    'Restore a spent limited-use ability or item charges. Two modes: (1) ' +
    "recharge roll — at the start of the creature's turn, roll its " +
    'recharge die via `roll` first, then pass the natural result as ' +
    '`roll`; the engine recharges the ability iff the roll meets the ' +
    "record's threshold (e.g. 5-6). (2) amount — regain a specific number " +
    'of uses/charges, e.g. the rolled "1d6+1" dawn recharge of a wand ' +
    '(roll it via `roll` first) or a DM ruling. Pass exactly one of roll ' +
    'or amount. Rest/dawn resets go through reset_usage instead. args: { ' +
    'ability?: string, itemId?: string, combatantId?: string, character?: ' +
    'string, roll?: integer, amount?: integer }.',
  inputSchema: {
    type: 'object',
    properties: {
      ability: {
        type: 'string',
        description:
          'Ability name as the statblock prints it, e.g. "Fire Breath". ' +
          'Omit for item-charge restores.',
        minLength: 1,
      },
      itemId: {
        type: 'string',
        description: 'Inventory item id for item-charge restores.',
        minLength: 1,
      },
      ...PARTICIPANT_SCHEMA_PROPERTIES,
      roll: {
        type: 'integer',
        description:
          'Natural recharge-die result (rolled via the roll tool), for a ' +
          'Recharge X-Y ability.',
        minimum: 1,
      },
      amount: {
        type: 'integer',
        description: 'Uses/charges regained.',
        minimum: 1,
      },
    },
    additionalProperties: false,
  },
  run(args, ctx) {
    const a = asRecord(args) ?? {};
    if (a.ability !== undefined && typeof a.ability !== 'string') {
      return err('invalid_args', 'restore_usage ability must be a string');
    }
    if (a.itemId !== undefined && typeof a.itemId !== 'string') {
      return err('invalid_args', 'restore_usage itemId must be a string');
    }
    if (a.ability === undefined && a.itemId === undefined) {
      return err(
        'invalid_args',
        'restore_usage requires ability (statblock name) or itemId',
      );
    }
    if (a.roll !== undefined && typeof a.roll !== 'number') {
      return err('invalid_args', 'restore_usage roll must be an integer');
    }
    if (a.amount !== undefined && typeof a.amount !== 'number') {
      return err('invalid_args', 'restore_usage amount must be an integer');
    }
    const owner = parseTurnParticipant(a, ctx, 'restore_usage');
    if ('ok' in owner) {
      return owner;
    }
    try {
      return ok(
        restoreUsage(ctx.db, {
          campaignId: ctx.campaignId,
          owner,
          ...(typeof a.ability === 'string' ? { ability: a.ability } : {}),
          ...(typeof a.itemId === 'string' ? { itemId: a.itemId } : {}),
          ...(typeof a.roll === 'number' ? { roll: a.roll } : {}),
          ...(typeof a.amount === 'number' ? { amount: a.amount } : {}),
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
