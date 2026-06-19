import { setWorldFact } from '../state/domainMutations.js';
import type { MutateStateValue } from '../state/mutateState.js';
import { MutateStateError } from '../state/mutateState.js';
import type { Tool } from './toolRegistry.js';
import { asRecord, err, ok } from './toolRegistry.js';

export const setWorldFactTool: Tool = {
  name: 'set_world_fact',
  // Writes overlay world facts — a canon write (eshyra-dwkm).
  mutates: true,
  description:
    'Record a world-template overlay fact — a divergence from the base module ' +
    '(e.g. a location renamed, an NPC killed, a hidden path revealed).',
  inputSchema: {
    type: 'object',
    properties: {
      key: {
        type: 'string',
        description:
          'Overlay key. Use "world:{type}:{id}:{field}" format for structured overlays.',
        minLength: 1,
      },
      value: {
        description: 'Any JSON value representing the diverged state.',
      },
    },
    required: ['key', 'value'],
    additionalProperties: false,
  },
  run(args, ctx) {
    const a = asRecord(args);
    if (a === undefined || typeof a.key !== 'string') {
      return err('invalid_args', 'set_world_fact requires { key, value }');
    }
    try {
      setWorldFact(ctx.db, a.key, a.value as MutateStateValue, {
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
