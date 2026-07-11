import { InspirationError, spendInspiration } from '../state/inspiration.js';
import type { Tool } from './toolRegistry.js';
import {
  asRecord,
  CHARACTER_TARGET_SCHEMA,
  err,
  ok,
  resolveTargetCharacterId,
} from './toolRegistry.js';

export const useInspirationTool: Tool = {
  name: 'use_inspiration',
  // Writes the character's durable inspiration boolean (eshyra-dwkm).
  // Spending/gifting is the player's call, not DM bookkeeping (eshyra-4ia4).
  requiresExplicitAction: true,
  mutates: true,
  description:
    "Spend or gift a character's inspiration, at the player's request. " +
    'Without giftTo, the inspiration is spent for advantage on one attack ' +
    'roll, saving throw, or ability check made now — apply that advantage ' +
    'to the roll. With giftTo, it transfers to another character (refused ' +
    'if they already have inspiration; it cannot be stockpiled). args: { ' +
    'character?: string, giftTo?: string }.',
  inputSchema: {
    type: 'object',
    properties: {
      character: CHARACTER_TARGET_SCHEMA,
      giftTo: {
        type: 'string',
        description:
          'Receiving character (name or id) when the inspiration is ' +
          'gifted instead of spent.',
        minLength: 1,
      },
    },
    additionalProperties: false,
  },
  run(args, ctx) {
    const a = asRecord(args) ?? {};
    if (
      a.giftTo !== undefined &&
      (typeof a.giftTo !== 'string' || a.giftTo.length === 0)
    ) {
      return err(
        'invalid_args',
        'use_inspiration giftTo must be a character name or id',
      );
    }
    const target = resolveTargetCharacterId(a.character, ctx);
    if ('ok' in target) {
      return target;
    }
    let giftToId: string | undefined;
    if (typeof a.giftTo === 'string') {
      const recipient = resolveTargetCharacterId(a.giftTo, ctx);
      if ('ok' in recipient) {
        return recipient;
      }
      giftToId = recipient.id;
    }
    try {
      return ok(
        spendInspiration(ctx.db, {
          ...(target.id === undefined ? {} : { characterRef: target.id }),
          ...(giftToId === undefined ? {} : { giftTo: giftToId }),
          provenance: `model:${ctx.turnId}`,
          sessionId: ctx.sessionId,
          at: ctx.at,
        }),
      );
    } catch (e) {
      if (e instanceof InspirationError) {
        return err('inspiration_error', e.message);
      }
      throw e;
    }
  },
};
