import { resolveCharacterId } from '../state/activeCharacter.js';
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
  // Only valid when player explicitly drops, uses, or loses an item (eshyra-4ia4).
  requiresExplicitAction: true,
  description:
    'Remove an item or reduce its quantity. Omit quantity to remove the item entirely. ' +
    'If quantity would drop to zero or below, the item is deleted. ' +
    'Call ONLY when the player explicitly drops, uses, sells, or loses an item — ' +
    'never call to answer a question about what is currently equipped or carried.',
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
      const targetCharacterId = resolveCharacterId(ctx.db, target.id);
      const existing = ctx.db
        .prepare(
          `SELECT name, location, character_id
           FROM inventory
           WHERE id = ? AND (character_id = ? OR character_id IS NULL)`,
        )
        .get(a.id, targetCharacterId) as
        | { name: string; location: string | null; character_id: string | null }
        | undefined;
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
      return ok({
        ...result,
        id: a.id,
        ...(existing !== undefined ? { name: existing.name } : {}),
        quantity:
          typeof a.quantity === 'number' ? a.quantity : result.previousQuantity,
        ...(existing?.location !== null && existing?.location !== undefined
          ? { location: existing.location }
          : {}),
        ...(typeof a.character === 'string' ? { character: a.character } : {}),
        ...(existing?.character_id !== null &&
        existing?.character_id !== undefined
          ? { characterId: existing.character_id }
          : target.id !== undefined
            ? { characterId: target.id }
            : {}),
      });
    } catch (e) {
      if (e instanceof MutateStateError) {
        return err('mutate_error', e.message);
      }
      throw e;
    }
  },
};
