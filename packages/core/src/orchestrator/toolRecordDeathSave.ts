import { recordDeathSave } from '../state/hpLifecycle.js';
import { MutateStateError } from '../state/mutateState.js';
import type { Tool } from './toolRegistry.js';
import {
  asRecord,
  CHARACTER_TARGET_SCHEMA,
  err,
  ok,
  resolveTargetCharacterId,
} from './toolRegistry.js';

export const recordDeathSaveTool: Tool = {
  name: 'record_death_save',
  // Writes death-save counters and life state — a canon write (eshyra-dwkm).
  mutates: true,
  description:
    'Record the result of a death saving throw for a dying character. Roll ' +
    'the d20 first via `roll` (category "death_save", player_visible), then ' +
    'pass the natural die result here — never a modified total. This tool ' +
    'owns the outcome: 10+ is a success, 9 or lower a failure, a natural 1 ' +
    'counts as two failures, and a natural 20 restores 1 HP. Three ' +
    'successes stabilize; three failures kill. Never track death saves in ' +
    'prose.',
  inputSchema: {
    type: 'object',
    properties: {
      roll: {
        type: 'integer',
        description: 'Natural d20 result (1-20), unmodified.',
        minimum: 1,
        maximum: 20,
      },
      character: CHARACTER_TARGET_SCHEMA,
    },
    required: ['roll'],
    additionalProperties: false,
  },
  run(args, ctx) {
    const a = asRecord(args);
    if (a === undefined || typeof a.roll !== 'number') {
      return err('invalid_args', 'record_death_save requires { roll: 1-20 }');
    }
    const target = resolveTargetCharacterId(a.character, ctx);
    if ('ok' in target) {
      return target;
    }
    try {
      const result = recordDeathSave(ctx.db, a.roll, {
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
