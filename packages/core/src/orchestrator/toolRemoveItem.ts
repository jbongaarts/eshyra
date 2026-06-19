import { removeItem } from '../state/domainMutations.js';
import { MutateStateError } from '../state/mutateState.js';
import type { Tool } from './toolRegistry.js';
import {
  asRecord,
  CHARACTER_TARGET_SCHEMA,
  err,
  ok,
  resolveTargetCharacterId,
} from './toolRegistry.js';

export const removeItemTool: Tool = {
  name: 'remove_item',
  // Writes inventory rows — a canon write (eshyra-dwkm).
  mutates: true,
  description:
    'Remove an item or reduce its quantity. Omit quantity to remove the item entirely. ' +
    'If quantity would drop to zero or below, the item is deleted.',
  inputSchema: {
    type: 'object',
    properties: {
      id: {
        type: 'string',
        description: 'The item id to remove or reduce.',
        minLength: 1,
      },
      quantity: {
        type: 'integer',
        description: 'How many to remove. Omit to remove the item entirely.',
        minimum: 1,
      },
      character: CHARACTER_TARGET_SCHEMA,
    },
    required: ['id'],
    additionalProperties: false,
  },
  run(args, ctx) {
    const a = asRecord(args);
    if (a === undefined || typeof a.id !== 'string') {
      return err('invalid_args', 'remove_item requires { id }');
    }
    const target = resolveTargetCharacterId(a.character, ctx);
    if ('ok' in target) {
      return target;
    }
    try {
      const result = removeItem(
        ctx.db,
        a.id,
        typeof a.quantity === 'number' ? a.quantity : undefined,
        {
          provenance: `model:${ctx.turnId}`,
          sessionId: ctx.sessionId,
          at: ctx.at,
          characterId: target.id,
        },
      );
      return ok(result);
    } catch (e) {
      if (e instanceof MutateStateError) {
        return err('mutate_error', e.message);
      }
      throw e;
    }
  },
};
