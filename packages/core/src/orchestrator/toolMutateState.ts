import type {
  MutateStateTarget,
  MutateStateValue,
} from '../state/mutateState.js';
import { MutateStateError, mutateState } from '../state/mutateState.js';
import type { Tool } from './toolRegistry.js';
import { asRecord, err, ok } from './toolRegistry.js';

export const mutateStateTool: Tool = {
  name: 'mutate_state',
  // The general canon-write tool — mutating by definition (eshyra-dwkm).
  mutates: true,
  description:
    'Write canonical game state. args: { target, id?, field, op: "set", value }.',
  inputSchema: {
    type: 'object',
    properties: {
      target: {
        type: 'string',
        enum: [
          'character',
          'inventory',
          'plot_flags',
          'clock',
          'overlay_facts',
        ],
        description: 'The canonical state table to write to.',
      },
      id: {
        type: 'string',
        description:
          'Optional row identifier within the target table (e.g. inventory id).',
      },
      field: {
        type: 'string',
        description: 'The writable column name on the target table.',
        minLength: 1,
      },
      op: {
        type: 'string',
        enum: ['set'],
        description: 'Mutation operator. Only "set" is supported today.',
      },
      value: {
        description:
          'New value for the field. May be a string, number, boolean, null, ' +
          'object, or array, depending on the target column type.',
      },
    },
    required: ['target', 'field', 'op', 'value'],
    additionalProperties: false,
  },
  run(args, ctx) {
    const a = asRecord(args);
    if (
      a === undefined ||
      typeof a.target !== 'string' ||
      typeof a.field !== 'string' ||
      a.op !== 'set'
    ) {
      return err(
        'invalid_args',
        'mutate_state requires { target, field, op: "set", value }',
      );
    }
    try {
      mutateState(ctx.db, {
        target: a.target as MutateStateTarget,
        id: typeof a.id === 'string' ? a.id : undefined,
        field: a.field,
        op: 'set',
        value: a.value as MutateStateValue,
        provenance: `model:${ctx.turnId}`,
        sessionId: ctx.sessionId,
        at: ctx.at,
      });
      return ok({
        applied: true,
        target: a.target,
        field: a.field,
        id: typeof a.id === 'string' ? a.id : undefined,
      });
    } catch (e) {
      if (e instanceof MutateStateError) {
        return err('mutate_error', e.message);
      }
      throw e;
    }
  },
};
