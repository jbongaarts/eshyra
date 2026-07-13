import { adjustHp } from '../state/hpLifecycle.js';
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
    'Positive heals, negative damages. Damage consumes temporary hit points ' +
    'first; dropping to 0 HP makes the character dying (or dead outright ' +
    'when the leftover damage beyond 0 reaches their HP maximum — the result ' +
    'reports the overflow); damage taken at 0 HP adds a death-save failure ' +
    '(two if critical=true) and knocks a stable character back to dying. ' +
    'Healing a dying or stable character returns them to consciousness; ' +
    'healing a dead character is refused. Death state and death-save ' +
    'counters are maintained by this tool — never track them in prose. ' +
    'If the damaged character is concentrating, the result reports the ' +
    'required Constitution save (concentrationCheck with its DC — resolve ' +
    'it with resolve_concentration, which rolls the save itself) or that ' +
    'concentration broke outright from incapacitation (concentrationBroken).',
  inputSchema: {
    type: 'object',
    properties: {
      amount: {
        type: 'integer',
        description: 'Signed integer: positive to heal, negative to damage.',
      },
      critical: {
        type: 'boolean',
        description:
          'The damage came from a critical hit. Only matters for damage ' +
          'dealt to a character already at 0 HP (two death-save failures ' +
          'instead of one).',
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
      const result = adjustHp(
        ctx.db,
        a.amount,
        {
          provenance: `model:${ctx.turnId}`,
          sessionId: ctx.sessionId,
          at: ctx.at,
          characterId: target.id,
        },
        { critical: a.critical === true },
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
