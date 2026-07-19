import { MagicItemVariantError } from '../rules/magicItemVariants.js';
import { resolveCharacterId } from '../state/activeCharacter.js';
import { adoptMagicItem, ItemAdoptionError } from '../state/itemAdoption.js';
import { ItemStateError } from '../state/itemState.js';
import type { Tool } from './toolRegistry.js';
import {
  asRecord,
  CHARACTER_TARGET_SCHEMA,
  err,
  ok,
  resolveTargetCharacterId,
} from './toolRegistry.js';

export const adoptItemTool: Tool = {
  name: 'adopt_item',
  mutates: true,
  requiresExplicitAction: true,
  description:
    'Recognize one legacy held inventory row as an exact canonical magic item from the active campaign rules stack. ' +
    'Supply the inventory id and exact packRef (plus required variantId); this tool never guesses from the display name. ' +
    'It safely splits stateful legacy stacks of at most 100 instances and quarantines incompatible or malformed legacy evidence for GM review. Set resolveReview only after explicit GM reconciliation to discard quarantined legacy projections and retry the supplied exact identity.',
  inputSchema: {
    type: 'object',
    properties: {
      id: {
        type: 'string',
        minLength: 1,
        description: 'Exact id of the held legacy inventory row.',
      },
      packRef: {
        type: 'string',
        pattern: '^magic-item:[a-z0-9]+(?:-[a-z0-9]+)*$',
        description:
          'Exact canonical magic-item ref from the active campaign rules stack.',
      },
      variantId: {
        type: 'string',
        pattern: '^[a-z0-9]+(?:-[a-z0-9]+)*$',
        description:
          'Exact canonical variant id; required when the selected record declares variants.',
      },
      resolveReview: {
        type: 'boolean',
        description:
          'Explicitly resolve an existing GM-review quarantine by discarding its quarantined legacy projection and retrying this exact canonical identity.',
      },
      character: CHARACTER_TARGET_SCHEMA,
    },
    required: ['id', 'packRef'],
    additionalProperties: false,
  },
  run(args, ctx) {
    const input = asRecord(args);
    if (
      input === undefined ||
      typeof input.id !== 'string' ||
      typeof input.packRef !== 'string'
    )
      return err('invalid_args', 'adopt_item requires { id, packRef }');
    const target = resolveTargetCharacterId(input.character, ctx);
    if ('ok' in target) return target;
    try {
      return ok(
        adoptMagicItem(ctx.db, {
          campaignId: ctx.campaignId,
          inventoryId: input.id,
          characterId: resolveCharacterId(ctx.db, target.id),
          packRef: input.packRef,
          ...(typeof input.variantId === 'string'
            ? { variantId: input.variantId }
            : {}),
          ...(input.resolveReview === true ? { resolveReview: true } : {}),
          resolveRulesPack: ctx.resolveRulesPack,
          rng: ctx.rng,
          provenance: `model:${ctx.turnId}`,
          sessionId: ctx.sessionId,
          at: ctx.at,
        }),
      );
    } catch (error) {
      if (
        error instanceof ItemAdoptionError ||
        error instanceof ItemStateError ||
        error instanceof MagicItemVariantError
      )
        return err('adoption_error', error.message);
      throw error;
    }
  },
};
