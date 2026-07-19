import { CharacterResolutionError } from '../state/activeCharacter.js';
import {
  doffItem,
  donItem,
  InventoryWearError,
} from '../state/inventoryWear.js';
import type { Tool } from './toolRegistry.js';
import { asRecord, err, ok } from './toolRegistry.js';

function makeWearTool(operation: 'don' | 'doff'): Tool {
  return {
    name: `${operation}_item`,
    mutates: true,
    requiresExplicitAction: true,
    description:
      operation === 'don'
        ? 'Semantically don one exact held inventory item. Wear state is authoritative; storage prose is not. Ambiguous legacy placement fails closed.'
        : 'Semantically doff one exact worn inventory item. Source-declared cursed doff restrictions are enforced; do not infer wear from inventory.location.',
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
        return err('invalid_args', `${operation}_item requires { id }`);
      try {
        const result = (operation === 'don' ? donItem : doffItem)(ctx.db, {
          itemId: input.id,
          ...(typeof input.character === 'string'
            ? { characterRef: input.character }
            : {}),
          provenance: `model:${ctx.turnId}`,
          sessionId: ctx.sessionId,
          at: ctx.at,
          characterId: ctx.actingCharacterId,
          resolveRulesPack: ctx.resolveRulesPack,
        });
        return ok(result);
      } catch (error) {
        if (
          error instanceof InventoryWearError ||
          error instanceof CharacterResolutionError
        )
          return err('wear_error', error.message);
        throw error;
      }
    },
  };
}

export const donItemTool = makeWearTool('don');
export const doffItemTool = makeWearTool('doff');
