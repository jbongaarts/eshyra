import { CharacterResolutionError } from '../state/activeCharacter.js';
import { ItemTransferError, transferItem } from '../state/itemTransfer.js';
import type { Tool } from './toolRegistry.js';
import { asRecord, err, ok } from './toolRegistry.js';

export const transferItemTool: Tool = {
  name: 'transfer_item',
  mutates: true,
  requiresExplicitAction: true,
  description:
    'Transfer an existing inventory instance between party members without recreating it. ' +
    'The row id, pack/variant identity, charges, curse, timers, and all item state are preserved. ' +
    'Attunement behavior must be explicit: "require-unattuned" refuses an attuned item; "end" atomically ends its current attunement.',
  inputSchema: {
    type: 'object',
    properties: {
      id: {
        type: 'string',
        minLength: 1,
        description: 'Existing inventory instance id.',
      },
      from_character: {
        type: 'string',
        minLength: 1,
        description:
          'Current holder by id or name. Defaults to the acting character.',
      },
      to_character: {
        type: 'string',
        minLength: 1,
        description: 'Recipient party member by id or name.',
      },
      attunement: {
        type: 'string',
        enum: ['require-unattuned', 'end'],
        description:
          'Required policy for any current attunement. No transfer silently moves or copies attunement.',
      },
    },
    required: ['id', 'to_character', 'attunement'],
    additionalProperties: false,
  },
  run(args, ctx) {
    const input = asRecord(args);
    if (
      input === undefined ||
      typeof input.id !== 'string' ||
      typeof input.to_character !== 'string' ||
      (input.attunement !== 'require-unattuned' && input.attunement !== 'end')
    )
      return err(
        'invalid_args',
        'transfer_item requires { id, to_character, attunement }',
      );
    try {
      return ok(
        transferItem(
          ctx.db,
          {
            campaignId: ctx.campaignId,
            itemId: input.id,
            ...(typeof input.from_character === 'string'
              ? { fromCharacterRef: input.from_character }
              : {}),
            toCharacterRef: input.to_character,
            attunement: input.attunement,
          },
          {
            provenance: `model:${ctx.turnId}`,
            sessionId: ctx.sessionId,
            at: ctx.at,
            characterId: ctx.actingCharacterId,
          },
        ),
      );
    } catch (error) {
      if (
        error instanceof ItemTransferError ||
        error instanceof CharacterResolutionError
      )
        return err('transfer_error', error.message);
      throw error;
    }
  },
};
