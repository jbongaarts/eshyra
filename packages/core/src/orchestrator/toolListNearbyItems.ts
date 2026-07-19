import { isConcreteWorldLocation } from '../state/inventoryWorldLocation.js';
import { validatePackRef } from '../state/itemState.js';
import type { Tool } from './toolRegistry.js';
import { asRecord, err, ok } from './toolRegistry.js';

const MAX_LIMIT = 20;

/** Read-only, clock-scoped discovery for exact ids accepted by claim_item. */
export const listNearbyItemsTool: Tool = {
  name: 'list_nearby_items',
  mutates: false,
  description:
    'List bounded claim-selection identity for unheld physical inventory rows at the current campaign location, ordered by exact id. Returns only id, name, quantity, world location, and pack/variant identity. Use nextCursor for stable pagination; remote and unknown-location rows are never exposed.',
  inputSchema: {
    type: 'object',
    properties: {
      cursor: {
        type: 'string',
        description: 'Exclusive last-seen item id from the previous page.',
      },
      limit: { type: 'integer', minimum: 1, maximum: MAX_LIMIT },
    },
    additionalProperties: false,
  },
  run(args, ctx) {
    const input = asRecord(args);
    if (input === undefined) return err('invalid_args', 'expected an object');
    const cursor = input.cursor;
    const limit = input.limit ?? MAX_LIMIT;
    if (
      (cursor !== undefined && typeof cursor !== 'string') ||
      typeof limit !== 'number' ||
      !Number.isInteger(limit) ||
      limit < 1 ||
      limit > MAX_LIMIT
    )
      return err(
        'invalid_args',
        'cursor must be a string and limit must be 1-20',
      );
    const clock = ctx.db
      .prepare('SELECT current_location_id FROM clock WHERE id=1')
      .get() as { current_location_id: string | null } | undefined;
    const locationId = clock?.current_location_id ?? null;
    if (!isConcreteWorldLocation(locationId))
      return ok({ locationId: null, items: [], nextCursor: undefined });
    const rows = ctx.db
      .prepare(
        `SELECT id, name, quantity, world_location_id, pack_ref, variant_id
         FROM inventory
         WHERE character_id IS NULL
           AND world_location_id=?
           AND trim(world_location_id) <> ''
           AND id>?
         ORDER BY id LIMIT ?`,
      )
      .all(locationId, cursor ?? '', limit + 1) as Array<{
      id: string;
      name: string;
      quantity: number;
      world_location_id: string;
      pack_ref: string | null;
      variant_id: string | null;
    }>;
    const page = rows.slice(0, limit);
    return ok({
      locationId,
      items: page.map((row) => ({
        id: row.id,
        name: row.name,
        quantity: row.quantity,
        worldLocationId: row.world_location_id,
        ...(row.pack_ref === null
          ? {}
          : { packRef: validatePackRef(row.pack_ref, 'inventory.pack_ref') }),
        ...(row.variant_id === null ? {} : { variantId: row.variant_id }),
      })),
      ...(rows.length <= limit || page.length === 0
        ? {}
        : { nextCursor: page[page.length - 1]?.id }),
    });
  },
};
