import { resolveCharacterId } from '../state/activeCharacter.js';
import { AmmunitionError, expendAmmunition } from '../state/ammunition.js';
import { MutateStateError } from '../state/mutateState.js';
import type { Tool } from './toolRegistry.js';
import {
  asRecord,
  CHARACTER_TARGET_SCHEMA,
  err,
  ok,
  resolveTargetCharacterId,
} from './toolRegistry.js';

export const expendAmmunitionTool: Tool = {
  name: 'expend_ammunition',
  mutates: true,
  requiresExplicitAction: true,
  description:
    'Spend ammunition from a character’s held inventory after an attack with an ammunition weapon. Requires an active combat instance; call after each attack, one piece per attack. The tool records the expended pieces at the current battlefield location. It does not resolve attacks or decide which weapons require ammunition.',
  inputSchema: {
    type: 'object',
    properties: {
      itemId: {
        type: 'string',
        minLength: 1,
        description: 'Exact id of the held ammunition stack.',
      },
      quantity: {
        type: 'integer',
        minimum: 1,
        description: 'Pieces expended (defaults to 1).',
      },
      character: CHARACTER_TARGET_SCHEMA,
    },
    required: ['itemId'],
    additionalProperties: false,
  },
  run(args, ctx) {
    const input = asRecord(args);
    if (
      input === undefined ||
      typeof input.itemId !== 'string' ||
      (input.quantity !== undefined && typeof input.quantity !== 'number')
    )
      return err(
        'invalid_args',
        'expend_ammunition requires { itemId, quantity? }',
      );
    const target = resolveTargetCharacterId(input.character, ctx);
    if ('ok' in target) return target;
    try {
      const characterId = resolveCharacterId(ctx.db, target.id);
      return ok(
        expendAmmunition(
          ctx.db,
          {
            itemId: input.itemId,
            quantity: input.quantity as number | undefined,
          },
          {
            campaignId: ctx.campaignId,
            characterId,
            provenance: `model:${ctx.turnId}`,
            sessionId: ctx.sessionId,
            at: ctx.at,
          },
        ),
      );
    } catch (error) {
      if (error instanceof AmmunitionError || error instanceof MutateStateError)
        return err('mutate_error', error.message);
      throw error;
    }
  },
};
