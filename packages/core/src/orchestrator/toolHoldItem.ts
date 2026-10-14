import { CharacterResolutionError } from '../state/activeCharacter.js';
import {
  holdItem,
  InventoryHeldError,
  stowItem,
} from '../state/inventoryHeld.js';
import type { Tool } from './toolRegistry.js';
import { asRecord, err, ok } from './toolRegistry.js';

function makeHoldTool(held: boolean): Tool {
  const action = held ? 'hold' : 'stow';
  return {
    name: `${action}_item`,
    mutates: true,
    requiresExplicitAction: true,
    description: held
      ? 'Record that the acting character takes one exact inventory item in hand. Requires the character to have custody.'
      : 'Record that the acting character puts one exact held inventory item away. Requires the character to have custody.',
    inputSchema: {
      type: 'object',
      properties: {
        id: {
          type: 'string',
          minLength: 1,
          description: 'Exact inventory instance id.',
        },
        character: {
          type: 'string',
          minLength: 1,
          description:
            'Holder by id or name; defaults to the acting character.',
        },
      },
      required: ['id'],
      additionalProperties: false,
    },
    run(args, ctx) {
      const input = asRecord(args);
      if (input === undefined || typeof input.id !== 'string')
        return err('invalid_args', `${action}_item requires { id }`);
      try {
        const result = (held ? holdItem : stowItem)(ctx.db, {
          itemId: input.id,
          ...(typeof input.character === 'string'
            ? { characterRef: input.character }
            : {}),
          provenance: `model:${ctx.turnId}`,
          sessionId: ctx.sessionId,
          at: ctx.at,
          characterId: ctx.actingCharacterId,
        });
        return ok(result);
      } catch (error) {
        if (
          error instanceof InventoryHeldError ||
          error instanceof CharacterResolutionError
        )
          return err('held_error', error.message);
        throw error;
      }
    },
  };
}

export const holdItemTool = makeHoldTool(true);
export const stowItemTool = makeHoldTool(false);
