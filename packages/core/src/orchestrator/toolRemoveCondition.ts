import { removeCondition } from '../state/domainMutations.js';
import { MutateStateError } from '../state/mutateState.js';
import type { Tool } from './toolRegistry.js';
import {
  asRecord,
  CHARACTER_TARGET_SCHEMA,
  err,
  ok,
  resolveTargetCharacterId,
} from './toolRegistry.js';

export const removeConditionTool: Tool = {
  name: 'remove_condition',
  // Writes character conditions — a canon write (eshyra-dwkm).
  mutates: true,
  description:
    'Remove a condition from a character by id. No-op if the condition is not present.',
  inputSchema: {
    type: 'object',
    properties: {
      id: {
        type: 'string',
        description: 'The condition id to remove.',
        minLength: 1,
      },
      character: CHARACTER_TARGET_SCHEMA,
    },
    required: ['id'],
    additionalProperties: false,
  },
  run(args, ctx) {
    const a = asRecord(args);
    if (a === undefined || typeof a.id !== 'string') {
      return err('invalid_args', 'remove_condition requires { id: string }');
    }
    const target = resolveTargetCharacterId(a.character, ctx);
    if ('ok' in target) {
      return target;
    }
    try {
      const result = removeCondition(ctx.db, a.id, {
        provenance: `model:${ctx.turnId}`,
        sessionId: ctx.sessionId,
        at: ctx.at,
        characterId: target.id,
      });
      return ok(result);
    } catch (e) {
      if (e instanceof MutateStateError) {
        return err('mutate_error', e.message);
      }
      throw e;
    }
  },
};
