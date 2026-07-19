import { reacquireItem } from '../state/domainMutations.js';
import { MutateStateError } from '../state/mutateState.js';
import type { Tool } from './toolRegistry.js';
import {
  asRecord,
  CHARACTER_TARGET_SCHEMA,
  err,
  ok,
  resolveTargetCharacterId,
} from './toolRegistry.js';

export const reacquireItemTool: Tool = {
  name: 'reacquire_item',
  mutates: true,
  requiresExplicitAction: true,
  description:
    'Restore custody of one specifically identified sold or lost inventory row after an explicit, adjudicated recovery. Requires exact current-world co-location, non-empty custody evidence, and a disposition-compatible basis; preserves the original row id, state, and attunement. Use claim_item only for dropped rows.',
  inputSchema: {
    type: 'object',
    properties: {
      id: {
        type: 'string',
        minLength: 1,
        description: 'Exact id of the sold or lost inventory row.',
      },
      basis: {
        type: 'string',
        enum: ['found', 'repurchased', 'returned'],
        description: 'Adjudicated basis by which custody returned.',
      },
      evidence: {
        type: 'string',
        minLength: 1,
        description:
          'Concise canon evidence establishing this specific custody recovery.',
      },
      character: CHARACTER_TARGET_SCHEMA,
    },
    required: ['id', 'basis', 'evidence'],
    additionalProperties: false,
  },
  run(args, ctx) {
    const input = asRecord(args);
    if (
      input === undefined ||
      typeof input.id !== 'string' ||
      (input.basis !== 'found' &&
        input.basis !== 'repurchased' &&
        input.basis !== 'returned') ||
      typeof input.evidence !== 'string'
    )
      return err(
        'invalid_args',
        'reacquire_item requires { id, basis, evidence }',
      );
    const target = resolveTargetCharacterId(input.character, ctx);
    if ('ok' in target) return target;
    try {
      return ok(
        reacquireItem(
          ctx.db,
          {
            itemId: input.id,
            basis: input.basis,
            evidence: input.evidence,
          },
          {
            provenance: `model:${ctx.turnId}`,
            sessionId: ctx.sessionId,
            at: ctx.at,
            characterId: target.id,
          },
        ),
      );
    } catch (error) {
      if (error instanceof MutateStateError)
        return err('mutate_error', error.message);
      throw error;
    }
  },
};
