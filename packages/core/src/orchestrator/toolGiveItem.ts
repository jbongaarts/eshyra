import { giveItem } from '../state/domainMutations.js';
import { MutateStateError } from '../state/mutateState.js';
import type { Tool } from './toolRegistry.js';
import {
  asRecord,
  CHARACTER_TARGET_SCHEMA,
  err,
  ok,
  resolveTargetCharacterId,
} from './toolRegistry.js';

export const giveItemTool: Tool = {
  name: 'give_item',
  // Writes inventory rows — a canon write (eshyra-dwkm).
  mutates: true,
  // Only valid when player explicitly receives or is granted an item (eshyra-4ia4).
  requiresExplicitAction: true,
  description:
    "Add an item to a character's inventory or update an existing one. " +
    'Creates the item if it does not exist; updates fields if it does. ' +
    'Call ONLY when the player explicitly receives, purchases, or is granted an item — ' +
    'never call to answer a question about what is currently equipped or carried.',
  inputSchema: {
    type: 'object',
    properties: {
      id: {
        type: 'string',
        description: 'Unique item identifier (e.g. "torch", "longsword").',
        minLength: 1,
      },
      name: {
        type: 'string',
        description: 'Display name for the item.',
        minLength: 1,
      },
      quantity: {
        type: 'integer',
        description: 'How many of this item. Defaults to 1.',
        minimum: 0,
      },
      location: {
        type: 'string',
        description: 'Where the item is stored (e.g. "backpack", "worn").',
      },
      properties: {
        type: 'object',
        description: 'Arbitrary key-value properties for the item.',
      },
      character: CHARACTER_TARGET_SCHEMA,
    },
    required: ['id', 'name'],
    additionalProperties: false,
  },
  run(args, ctx) {
    const a = asRecord(args);
    if (
      a === undefined ||
      typeof a.id !== 'string' ||
      typeof a.name !== 'string'
    ) {
      return err('invalid_args', 'give_item requires { id, name }');
    }
    const target = resolveTargetCharacterId(a.character, ctx);
    if ('ok' in target) {
      return target;
    }
    try {
      giveItem(
        ctx.db,
        {
          id: a.id,
          name: a.name,
          quantity: typeof a.quantity === 'number' ? a.quantity : undefined,
          location: typeof a.location === 'string' ? a.location : undefined,
          properties:
            typeof a.properties === 'object' &&
            a.properties !== null &&
            !Array.isArray(a.properties)
              ? (a.properties as Record<string, unknown>)
              : undefined,
        },
        {
          provenance: `model:${ctx.turnId}`,
          sessionId: ctx.sessionId,
          at: ctx.at,
          characterId: target.id,
        },
      );
      return ok({
        applied: true,
        id: a.id,
        name: a.name,
        quantity: typeof a.quantity === 'number' ? a.quantity : 1,
        ...(typeof a.location === 'string' ? { location: a.location } : {}),
        ...(typeof a.character === 'string' ? { character: a.character } : {}),
        ...(target.id !== undefined ? { characterId: target.id } : {}),
      });
    } catch (e) {
      if (e instanceof MutateStateError) {
        return err('mutate_error', e.message);
      }
      throw e;
    }
  },
};
