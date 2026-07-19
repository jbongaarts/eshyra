import { withTransaction } from '../persistence/db.js';
import { lookupRulesRecord } from '../rules/lookup.js';
import {
  MagicItemVariantError,
  resolveMagicItemVariant,
} from '../rules/magicItemVariants.js';
import { lookupStrictCampaignRecord } from '../state/campaignRecordLookup.js';
import { giveItem } from '../state/domainMutations.js';
import {
  createInitialItemState,
  ItemStateError,
  isStatefulMagicItem,
  validatePackRef,
  writeItemState,
} from '../state/itemState.js';
import { MutateStateError } from '../state/mutateState.js';
import type { Tool } from './toolRegistry.js';
import {
  asRecord,
  CHARACTER_TARGET_SCHEMA,
  err,
  ok,
  resolveTargetCharacterId,
} from './toolRegistry.js';

export const giveItemTool: Tool = {
  name: 'give_item',
  // Writes inventory rows — a canon write (eshyra-dwkm).
  mutates: true,
  // Only valid when player explicitly receives or is granted an item (eshyra-4ia4).
  requiresExplicitAction: true,
  description:
    "Add a new item to a character's inventory or update an item already held by that same character. " +
    'Never changes custody of an existing row: use transfer_item for another holder or claim_item for an unheld physical row. ' +
    'Call ONLY when the player explicitly receives, purchases, or is granted an item — ' +
    'never call to answer a question about what is currently equipped or carried.',
  inputSchema: {
    type: 'object',
    properties: {
      id: {
        type: 'string',
        description: 'Unique item identifier (e.g. "torch", "longsword").',
        minLength: 1,
      },
      name: {
        type: 'string',
        description: 'Display name for the item.',
        minLength: 1,
      },
      quantity: {
        type: 'integer',
        description: 'How many of this item. Defaults to 1.',
        minimum: 0,
      },
      location: {
        type: 'string',
        description: 'Where the item is stored (e.g. "backpack", "worn").',
      },
      properties: {
        type: 'object',
        description: 'Arbitrary key-value properties for the item.',
      },
      packRef: {
        type: 'string',
        description:
          'Canonical magic-item rules ref (for example "magic-item:wand-of-fireballs").',
        pattern: '^magic-item:[a-z0-9]+(?:-[a-z0-9]+)*$',
      },
      variantId: {
        type: 'string',
        description:
          'Required canonical variant id when packRef declares variants.',
        pattern: '^[a-z0-9]+(?:-[a-z0-9]+)*$',
      },
      character: CHARACTER_TARGET_SCHEMA,
    },
    required: ['id', 'name'],
    additionalProperties: false,
  },
  run(args, ctx) {
    const a = asRecord(args);
    if (
      a === undefined ||
      typeof a.id !== 'string' ||
      typeof a.name !== 'string'
    ) {
      return err('invalid_args', 'give_item requires { id, name }');
    }
    const requestedId = a.id;
    const requestedName = a.name;
    const target = resolveTargetCharacterId(a.character, ctx);
    if ('ok' in target) {
      return target;
    }
    try {
      const result = withTransaction(ctx.db, (txnDb) => {
        const packRef =
          a.packRef === undefined
            ? undefined
            : validatePackRef(a.packRef, 'give_item.packRef');
        const hit =
          packRef === undefined
            ? undefined
            : lookupStrictCampaignRecord(
                txnDb,
                'magic-item',
                packRef,
                ctx.resolveRulesPack,
              );
        if (packRef !== undefined && hit === undefined) {
          throw new ItemStateError(
            `packRef '${packRef}' does not resolve in the active campaign rules stack`,
          );
        }
        const variantId =
          a.variantId === undefined
            ? undefined
            : typeof a.variantId === 'string'
              ? a.variantId
              : (() => {
                  throw new ItemStateError(
                    'give_item.variantId must be a string',
                  );
                })();
        if (hit === undefined) {
          if (variantId !== undefined)
            throw new ItemStateError('give_item.variantId requires packRef');
        } else {
          resolveMagicItemVariant(hit.record, variantId);
        }
        const stateful =
          hit === undefined
            ? false
            : isStatefulMagicItem(hit.record, variantId);
        const granted = giveItem(
          txnDb,
          {
            id: requestedId,
            name: requestedName,
            quantity: typeof a.quantity === 'number' ? a.quantity : undefined,
            location: typeof a.location === 'string' ? a.location : undefined,
            properties:
              typeof a.properties === 'object' &&
              a.properties !== null &&
              !Array.isArray(a.properties)
                ? (a.properties as Record<string, unknown>)
                : undefined,
            ...(packRef === undefined ? {} : { packRef }),
            ...(variantId === undefined ? {} : { variantId }),
            stateful,
          },
          {
            provenance: `model:${ctx.turnId}`,
            sessionId: ctx.sessionId,
            at: ctx.at,
            characterId: target.id,
          },
        );
        if (stateful && hit !== undefined && packRef !== undefined) {
          writeItemState(
            txnDb,
            granted.id,
            createInitialItemState(packRef, hit.record, {
              variantId,
              rng: ctx.rng,
              resolveTable: (ref) => {
                const result = lookupRulesRecord(hit.stack, {
                  kind: 'table',
                  ref,
                });
                return result.ok ? result.record : undefined;
              },
            }),
            {
              provenance: `model:${ctx.turnId}`,
              sessionId: ctx.sessionId,
              at: ctx.at,
            },
          );
        }
        return { ...granted, packRef, variantId, stateful };
      });
      return ok({
        applied: true,
        id: result.id,
        name: a.name,
        quantity: typeof a.quantity === 'number' ? a.quantity : 1,
        ...(typeof a.location === 'string' ? { location: a.location } : {}),
        ...(typeof a.character === 'string' ? { character: a.character } : {}),
        ...(target.id !== undefined ? { characterId: target.id } : {}),
        ...(result.packRef === undefined ? {} : { packRef: result.packRef }),
        ...(result.variantId === undefined
          ? {}
          : { variantId: result.variantId }),
        ...(result.stateful ? { stateful: true } : {}),
      });
    } catch (e) {
      if (
        e instanceof MutateStateError ||
        e instanceof ItemStateError ||
        e instanceof MagicItemVariantError
      ) {
        return err('mutate_error', e.message);
      }
      throw e;
    }
  },
};
