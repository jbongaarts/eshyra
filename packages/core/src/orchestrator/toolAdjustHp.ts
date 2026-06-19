import { adjustHp } from '../state/domainMutations.js';
import { MutateStateError } from '../state/mutateState.js';
import type { Tool } from './toolRegistry.js';
import {
  asRecord,
  CHARACTER_TARGET_SCHEMA,
  err,
  ok,
  resolveTargetCharacterId,
} from './toolRegistry.js';

export const adjustHpTool: Tool = {
  name: 'adjust_hp',
  // Writes character HP — a canon write (eshyra-dwkm).
  mutates: true,
  description:
    "Adjust a character's current hit points by a signed amount. " +
    'Positive heals, negative damages. Clamped to [0, hp_max].',
  inputSchema: {
    type: 'object',
    properties: {
      amount: {
        type: 'integer',
        description: 'Signed integer: positive to heal, negative to damage.',
      },
      character: CHARACTER_TARGET_SCHEMA,
    },
    required: ['amount'],
    additionalProperties: false,
  },
  run(args, ctx) {
    const a = asRecord(args);
    if (a === undefined || typeof a.amount !== 'number') {
      return err('invalid_args', 'adjust_hp requires { amount: integer }');
    }
    const target = resolveTargetCharacterId(a.character, ctx);
    if ('ok' in target) {
      return target;
    }
    try {
      const result = adjustHp(ctx.db, a.amount, {
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
