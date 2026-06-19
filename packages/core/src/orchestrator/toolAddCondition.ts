import { addCondition } from '../state/domainMutations.js';
import { MutateStateError } from '../state/mutateState.js';
import type { Tool } from './toolRegistry.js';
import {
  asRecord,
  CHARACTER_TARGET_SCHEMA,
  err,
  ok,
  resolveTargetCharacterId,
} from './toolRegistry.js';

export const addConditionTool: Tool = {
  name: 'add_condition',
  // Writes character conditions — a canon write (eshyra-dwkm).
  mutates: true,
  description:
    'Add a condition to a character. No-op if a condition with the same id already exists. ' +
    'Extra fields (duration, severity, etc.) are preserved.',
  inputSchema: {
    type: 'object',
    properties: {
      id: {
        type: 'string',
        description:
          'Unique condition identifier (e.g. "poisoned", "frightened").',
        minLength: 1,
      },
      character: CHARACTER_TARGET_SCHEMA,
    },
    required: ['id'],
  },
  run(args, ctx) {
    const a = asRecord(args);
    if (a === undefined || typeof a.id !== 'string') {
      return err('invalid_args', 'add_condition requires { id: string }');
    }
    const target = resolveTargetCharacterId(a.character, ctx);
    if ('ok' in target) {
      return target;
    }
    // `character` targets a PC; it is not part of the stored condition entry.
    const { character: _character, ...condition } = a;
    try {
      const result = addCondition(
        ctx.db,
        condition as { id: string; [key: string]: unknown },
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
