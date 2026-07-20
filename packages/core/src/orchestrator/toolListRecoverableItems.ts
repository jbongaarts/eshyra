import { listRecoverableItems } from '../state/domainMutations.js';
import { MutateStateError } from '../state/mutateState.js';
import type { Tool } from './toolRegistry.js';
import { asRecord, err, ok } from './toolRegistry.js';

export const listRecoverableItemsTool: Tool = {
  name: 'list_recoverable_items',
  mutates: false,
  description:
    'Bounded read-only discovery of exact sold/lost row ids eligible for a scene-adjudicated recovery at the current world location. Use found after finding a lost item, returned when a counterparty returns lost property, and repurchased only for a sold item being bought back with payment. This never changes custody or reveals ordinary dropped loot.',
  inputSchema: {
    type: 'object',
    properties: {
      basis: {
        type: 'string',
        enum: ['found', 'repurchased', 'returned'],
        description:
          'Recovery basis already established by the current scene; found/returned discover lost rows, while repurchased discovers sold rows.',
      },
    },
    required: ['basis'],
    additionalProperties: false,
  },
  run(args, ctx) {
    const input = asRecord(args);
    if (
      input === undefined ||
      (input.basis !== 'found' &&
        input.basis !== 'repurchased' &&
        input.basis !== 'returned')
    )
      return err(
        'invalid_args',
        'list_recoverable_items requires { basis: found|repurchased|returned }',
      );
    try {
      return ok(listRecoverableItems(ctx.db, input.basis));
    } catch (error) {
      if (error instanceof MutateStateError)
        return err('mutate_error', error.message);
      throw error;
    }
  },
};
