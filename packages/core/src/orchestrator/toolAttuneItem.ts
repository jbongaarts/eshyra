import { AttunementError, attuneItem } from '../state/attunement.js';
import type { Tool } from './toolRegistry.js';
import {
  asRecord,
  CHARACTER_TARGET_SCHEMA,
  err,
  ok,
  resolveTargetCharacterId,
} from './toolRegistry.js';

export const attuneItemTool: Tool = {
  name: 'attune_item',
  // Writes the durable attunement record (eshyra-dwkm).
  mutates: true,
  description:
    "Record a character's attunement to a magic item they hold, after " +
    'narrating the short rest spent attuning. The engine enforces the ' +
    'slot machine: at most three attuned items, no second copy of the ' +
    'same item, one creature per item, and the item must require ' +
    'attunement per its magic-item record (an item the record says works ' +
    'without attunement is refused). Class/spellcaster prerequisites are ' +
    'returned for you to adjudicate. args: { itemId: string, character?: ' +
    'string, itemRef?: string }.',
  inputSchema: {
    type: 'object',
    properties: {
      itemId: {
        type: 'string',
        description: "Inventory item id from the character's inventory.",
        minLength: 1,
      },
      character: CHARACTER_TARGET_SCHEMA,
      itemRef: {
        type: 'string',
        description:
          'Magic-item record key (e.g. "magic-item:ring-of-protection") ' +
          'when known; otherwise the item name is resolved against the ' +
          'rules pack.',
        minLength: 1,
      },
    },
    required: ['itemId'],
    additionalProperties: false,
  },
  run(args, ctx) {
    const a = asRecord(args);
    if (a === undefined || typeof a.itemId !== 'string') {
      return err('invalid_args', 'attune_item requires { itemId }');
    }
    if (
      a.itemRef !== undefined &&
      (typeof a.itemRef !== 'string' || a.itemRef.length === 0)
    ) {
      return err(
        'invalid_args',
        'attune_item itemRef must be a non-empty magic-item record key',
      );
    }
    const target = resolveTargetCharacterId(a.character, ctx);
    if ('ok' in target) {
      return target;
    }
    try {
      return ok(
        attuneItem(ctx.db, {
          campaignId: ctx.campaignId,
          ...(target.id === undefined ? {} : { characterRef: target.id }),
          itemId: a.itemId,
          ...(typeof a.itemRef === 'string' ? { itemRef: a.itemRef } : {}),
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
