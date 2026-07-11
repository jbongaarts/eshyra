import type { AttunementEndReason } from '../state/attunement.js';
import {
  ATTUNEMENT_END_REASONS,
  AttunementError,
  endAttunement,
} from '../state/attunement.js';
import type { Tool } from './toolRegistry.js';
import {
  asRecord,
  CHARACTER_TARGET_SCHEMA,
  err,
  ok,
  resolveTargetCharacterId,
} from './toolRegistry.js';

export const endAttunementTool: Tool = {
  name: 'end_attunement',
  // Writes the durable attunement record (eshyra-dwkm).
  mutates: true,
  description:
    "End a character's attunement to an item, freeing the slot. Reasons " +
    'follow the rules-text ending conditions: voluntary (a short rest spent ' +
    'breaking the bond), distance (more than 100 feet away for at least ' +
    '24 hours), death, replaced (another creature attunes), ' +
    'item_destroyed, or other. Death also ends attunements automatically ' +
    'when the death machine records it. args: { itemId: string, ' +
    'character?: string, reason: "voluntary"|"distance"|"death"|' +
    '"replaced"|"item_destroyed"|"other" }.',
  inputSchema: {
    type: 'object',
    properties: {
      itemId: {
        type: 'string',
        description: 'Inventory item id of the attuned item.',
        minLength: 1,
      },
      character: CHARACTER_TARGET_SCHEMA,
      reason: {
        type: 'string',
        enum: ATTUNEMENT_END_REASONS,
        description: 'Which rules-text ending condition applies.',
      },
    },
    required: ['itemId', 'reason'],
    additionalProperties: false,
  },
  run(args, ctx) {
    const a = asRecord(args);
    if (
      a === undefined ||
      typeof a.itemId !== 'string' ||
      typeof a.reason !== 'string'
    ) {
      return err('invalid_args', 'end_attunement requires { itemId, reason }');
    }
    if (!ATTUNEMENT_END_REASONS.includes(a.reason as AttunementEndReason)) {
      return err(
        'invalid_args',
        `end_attunement reason must be one of: ${ATTUNEMENT_END_REASONS.join(', ')}`,
      );
    }
    const target = resolveTargetCharacterId(a.character, ctx);
    if ('ok' in target) {
      return target;
    }
    try {
      return ok(
        endAttunement(ctx.db, {
          campaignId: ctx.campaignId,
          ...(target.id === undefined ? {} : { characterRef: target.id }),
          itemId: a.itemId,
          reason: a.reason as AttunementEndReason,
          provenance: `model:${ctx.turnId}`,
          sessionId: ctx.sessionId,
          at: ctx.at,
        }),
      );
    } catch (e) {
      if (e instanceof AttunementError) {
        return err('attunement_error', e.message);
      }
      throw e;
    }
  },
};
