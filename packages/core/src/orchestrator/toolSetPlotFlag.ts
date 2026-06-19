import { setPlotFlag } from '../state/domainMutations.js';
import type { MutateStateValue } from '../state/mutateState.js';
import { MutateStateError } from '../state/mutateState.js';
import type { Tool } from './toolRegistry.js';
import { asRecord, err, ok } from './toolRegistry.js';

export const setPlotFlagTool: Tool = {
  name: 'set_plot_flag',
  // Writes plot flags — a canon write (eshyra-dwkm).
  mutates: true,
  description:
    'Set a narrative plot flag. Use for story progression, quest state, NPC attitudes, ' +
    'and any named boolean/string/object facts about the campaign.',
  inputSchema: {
    type: 'object',
    properties: {
      key: {
        type: 'string',
        description:
          'Flag name (e.g. "met_old_road_warden", "quest_accepted").',
        minLength: 1,
      },
      value: {
        description:
          'Any JSON value: boolean, string, number, object, array, or null.',
      },
    },
    required: ['key', 'value'],
    additionalProperties: false,
  },
  run(args, ctx) {
    const a = asRecord(args);
    if (a === undefined || typeof a.key !== 'string') {
      return err('invalid_args', 'set_plot_flag requires { key, value }');
    }
    try {
      setPlotFlag(ctx.db, a.key, a.value as MutateStateValue, {
        provenance: `model:${ctx.turnId}`,
        sessionId: ctx.sessionId,
        at: ctx.at,
      });
      return ok({ applied: true, key: a.key });
    } catch (e) {
      if (e instanceof MutateStateError) {
        return err('mutate_error', e.message);
      }
      throw e;
    }
  },
};
