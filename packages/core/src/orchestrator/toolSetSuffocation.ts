import { beginSuffocation, endSuffocation } from '../state/hpLifecycle.js';
import { MutateStateError } from '../state/mutateState.js';
import type { Tool } from './toolRegistry.js';
import {
  asRecord,
  CHARACTER_TARGET_SCHEMA,
  err,
  ok,
  resolveTargetCharacterId,
} from './toolRegistry.js';

export const setSuffocationTool: Tool = {
  name: 'set_suffocation',
  mutates: true,
  description:
    'Characters only. `drop` applies the moment the rule drops the character to 0 hit points (dying, recovery blocked); `breathe` records that it can breathe again. While blocked, healing and stabilize_character are refused and record_death_save does not stabilize or restore hit points.',
  inputSchema: {
    type: 'object',
    properties: {
      event: { type: 'string', enum: ['drop', 'breathe'] },
      character: CHARACTER_TARGET_SCHEMA,
    },
    required: ['event'],
    additionalProperties: false,
  },
  run(args, ctx) {
    const a = asRecord(args);
    if (a === undefined || (a.event !== 'drop' && a.event !== 'breathe'))
      return err(
        'invalid_args',
        "set_suffocation requires { event: 'drop' | 'breathe' }",
      );
    const target = resolveTargetCharacterId(a.character, ctx);
    if ('ok' in target) return target;
    const mutationContext = {
      provenance: `model:${ctx.turnId}`,
      sessionId: ctx.sessionId,
      at: ctx.at,
      characterId: target.id,
    };
    try {
      return ok(
        a.event === 'drop'
          ? beginSuffocation(ctx.db, mutationContext)
          : endSuffocation(ctx.db, mutationContext, ctx.rng),
      );
    } catch (e) {
      if (e instanceof MutateStateError) return err('mutate_error', e.message);
      throw e;
    }
  },
};
