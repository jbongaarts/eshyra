import { MagicItemVariantError } from '../rules/magicItemVariants.js';
import { resolveCharacterId } from '../state/activeCharacter.js';
import { adoptMagicItem, ItemAdoptionError } from '../state/itemAdoption.js';
import type { ItemAdoptionResolution } from '../state/itemAdoptionReview.js';
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
    'It safely splits stateful legacy stacks of at most 100 instances and quarantines incompatible or malformed legacy evidence for GM review. Resolve a quarantine only with one typed resolution action and durable GM evidence; the action and canonical adoption commit atomically.',
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
      resolution: {
        type: 'object',
        properties: {
          action: {
            type: 'string',
            enum: [
              'discard-evidence',
              'set-reviewed-quantity',
              'discard-legacy-attunement',
              'discard-legacy-counter',
            ],
          },
          evidence: { type: 'string', minLength: 1 },
          quantity: { type: 'integer', minimum: 1, maximum: 100 },
        },
        required: ['action', 'evidence'],
        additionalProperties: false,
        description:
          'Typed structural reconciliation with durable GM evidence. quantity is required only for set-reviewed-quantity.',
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
    const rawResolution = asRecord(input.resolution);
    const resolution = (() => {
      if (rawResolution === undefined) return undefined;
      if (
        ![
          'discard-evidence',
          'set-reviewed-quantity',
          'discard-legacy-attunement',
          'discard-legacy-counter',
        ].includes(rawResolution.action as string) ||
        typeof rawResolution.evidence !== 'string'
      )
        return err(
          'invalid_args',
          'adopt_item resolution requires a typed action and evidence',
        );
      if (
        rawResolution.action === 'set-reviewed-quantity' &&
        typeof rawResolution.quantity !== 'number'
      )
        return err(
          'invalid_args',
          'adopt_item set-reviewed-quantity resolution requires quantity',
        );
      if (
        rawResolution.action !== 'set-reviewed-quantity' &&
        rawResolution.quantity !== undefined
      )
        return err(
          'invalid_args',
          'adopt_item quantity is valid only for set-reviewed-quantity',
        );
      return {
        action: rawResolution.action as
          | 'discard-evidence'
          | 'set-reviewed-quantity'
          | 'discard-legacy-attunement'
          | 'discard-legacy-counter',
        evidence: rawResolution.evidence,
        ...(rawResolution.action === 'set-reviewed-quantity'
          ? { quantity: rawResolution.quantity as number }
          : {}),
      } as ItemAdoptionResolution;
    })();
    if (resolution !== undefined && 'ok' in resolution) return resolution;
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
          ...(resolution === undefined ? {} : { resolution }),
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
