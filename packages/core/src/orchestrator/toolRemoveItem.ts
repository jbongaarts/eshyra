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
    'Apply an explicit physical disposition to a held item: destroyed, dropped, sold, or lost. ' +
    'Only destroyed deletes the row and ends attunement; destroying an unheld dropped row requires its world location to exactly match the current campaign location. A full drop, sale, or loss clears held storage and preserves the physical row, state, and disposition. Only dropped rows become discoverable and generally claimable; sold and lost rows remain outside player custody. A partial stateless stack is split into a new disposition-marked unheld row. ' +
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
      disposition: {
        type: 'string',
        enum: ['destroyed', 'dropped', 'sold', 'lost'],
        description:
          'What physically happened. This is required; only destroyed deletes the item.',
      },
      character: CHARACTER_TARGET_SCHEMA,
    },
    required: ['id', 'disposition'],
    additionalProperties: false,
  },
  run(args, ctx) {
    const a = asRecord(args);
    if (
      a === undefined ||
      typeof a.id !== 'string' ||
      !['destroyed', 'dropped', 'sold', 'lost'].includes(
        a.disposition as string,
      )
    ) {
      return err(
        'invalid_args',
        'remove_item requires { id, disposition: destroyed|dropped|sold|lost }',
      );
    }
    const target = resolveTargetCharacterId(a.character, ctx);
    if ('ok' in target) {
      return target;
    }
    try {
      const targetCharacterId = resolveCharacterId(ctx.db, target.id);
      const existing = ctx.db
        .prepare(
          `SELECT name, location, world_location_id, character_id
           FROM inventory
           WHERE id = ?
             AND (character_id = ? OR (character_id IS NULL AND ? = 'destroyed'))`,
        )
        .get(a.id, targetCharacterId, a.disposition) as
        | {
            name: string;
            location: string | null;
            world_location_id: string | null;
            character_id: string | null;
          }
        | undefined;
      const result = removeItem(
        ctx.db,
        {
          itemId: a.id,
          quantity: typeof a.quantity === 'number' ? a.quantity : undefined,
          disposition: a.disposition as
            | 'destroyed'
            | 'dropped'
            | 'sold'
            | 'lost',
          resolveRulesPack: ctx.resolveRulesPack,
        },
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
        ...(result.worldLocationId === undefined
          ? {}
          : { worldLocationId: result.worldLocationId }),
        ...(typeof a.character === 'string' ? { character: a.character } : {}),
        ...(existing?.character_id !== null &&
        existing?.character_id !== undefined
          ? { characterId: existing.character_id }
          : existing === undefined && target.id !== undefined
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
