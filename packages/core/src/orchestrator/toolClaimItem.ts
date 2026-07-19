import { claimItem } from '../state/domainMutations.js';
import { MutateStateError } from '../state/mutateState.js';
import type { Tool } from './toolRegistry.js';
import {
  asRecord,
  CHARACTER_TARGET_SCHEMA,
  err,
  ok,
  resolveTargetCharacterId,
} from './toolRegistry.js';

export const claimItemTool: Tool = {
  name: 'claim_item',
  mutates: true,
  requiresExplicitAction: true,
  description:
    'Claim an existing unheld physical inventory row after a character explicitly picks it up or recovers it. Preserves the exact row id, pack/variant identity, quantity, properties, mutable item state, pickup world location, and any still-existing attunement. Refuses items already held by anyone.',
  inputSchema: {
    type: 'object',
    properties: {
      id: {
        type: 'string',
        minLength: 1,
        description: 'Exact id of an unheld physical inventory row.',
      },
      character: CHARACTER_TARGET_SCHEMA,
    },
    required: ['id'],
    additionalProperties: false,
  },
  run(args, ctx) {
    const input = asRecord(args);
    if (input === undefined || typeof input.id !== 'string')
      return err('invalid_args', 'claim_item requires { id }');
    const target = resolveTargetCharacterId(input.character, ctx);
    if ('ok' in target) return target;
    try {
      return ok(
        claimItem(ctx.db, input.id, {
          provenance: `model:${ctx.turnId}`,
          sessionId: ctx.sessionId,
          at: ctx.at,
          characterId: target.id,
        }),
      );
    } catch (error) {
      if (error instanceof MutateStateError)
        return err('mutate_error', error.message);
      throw error;
    }
  },
};
