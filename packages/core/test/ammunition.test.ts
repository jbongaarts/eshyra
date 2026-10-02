import { describe, expect, it } from 'vitest';
import type { ToolContext } from '../src/internal.js';
import {
  createDefaultToolRegistry,
  createSeededRng,
  readStateSnapshot,
} from '../src/internal.js';
import {
  DEFAULT_TEST_CAMPAIGN_ID,
  DEFAULT_TEST_SESSION_ID,
  freshDbWithSession,
} from './support/db.js';

const NOW = '2026-10-01T12:00:00.000Z';
const LOCATION = 'battlefield';

function setup() {
  const db = freshDbWithSession();
  db.prepare(
    "UPDATE clock SET current_location_id=?, provenance='test', updated_at=? WHERE id=1",
  ).run(LOCATION, NOW);
  const registry = createDefaultToolRegistry();
  const ctx: ToolContext = {
    db,
    rng: createSeededRng(1),
    campaignId: DEFAULT_TEST_CAMPAIGN_ID,
    sessionId: DEFAULT_TEST_SESSION_ID,
    turnId: 'ammo-test',
    at: NOW,
  };
  return { db, registry, ctx };
}

function combat(
  db: ReturnType<typeof freshDbWithSession>,
  id = 'combat-1',
  status = 'active',
) {
  db.prepare(`INSERT INTO combat_instance(
    campaign_id, combat_instance_id, status, location_id, provenance, session_id,
    opened_at, updated_at, closed_at
  ) VALUES (?, ?, ?, ?, 'test', ?, ?, ?, ?)`).run(
    DEFAULT_TEST_CAMPAIGN_ID,
    id,
    status,
    LOCATION,
    DEFAULT_TEST_SESSION_ID,
    NOW,
    NOW,
    status === 'active' ? null : NOW,
  );
}

function stack(
  db: ReturnType<typeof freshDbWithSession>,
  id: string,
  quantity: number,
  name = 'Arrow',
  identity: 'wood' | 'silver' = 'wood',
) {
  db.prepare(`INSERT INTO inventory(
    id, character_id, name, quantity, properties_json, provenance, session_id, updated_at,
    pack_ref, variant_id, world_location_id, unheld_disposition
  ) VALUES (?, 'pc-1', ?, ?, ?, 'test', ?, ?, ?, ?, NULL, NULL)`).run(
    id,
    name,
    quantity,
    JSON.stringify({ material: identity }),
    DEFAULT_TEST_SESSION_ID,
    NOW,
    null,
    null,
  );
}

function invoke(
  registry: ReturnType<typeof createDefaultToolRegistry>,
  name: string,
  args: unknown,
  ctx: ToolContext,
) {
  return registry.invoke(name, args, ctx);
}

function spend(
  registry: ReturnType<typeof createDefaultToolRegistry>,
  ctx: ToolContext,
  id: string,
  quantity = 1,
) {
  const result = invoke(
    registry,
    'expend_ammunition',
    { itemId: id, quantity },
    ctx,
  );
  if (!result.ok) throw new Error(result.message);
  return result.data as { expendedInventoryId: string };
}

function close(db: ReturnType<typeof freshDbWithSession>, id = 'combat-1') {
  db.prepare(
    "UPDATE combat_instance SET status='completed', closed_at=?, updated_at=? WHERE campaign_id=? AND combat_instance_id=?",
  ).run(NOW, NOW, DEFAULT_TEST_CAMPAIGN_ID, id);
}

function recover(
  registry: ReturnType<typeof createDefaultToolRegistry>,
  ctx: ToolContext,
  id = 'combat-1',
) {
  return invoke(registry, 'recover_ammunition', { combatInstanceId: id }, ctx);
}

describe('ammunition expenditure and battlefield recovery tools', () => {
  it('computes half of original expenditure, capped by the pieces still present', () => {
    const { db, registry, ctx } = setup();
    combat(db);
    stack(db, 'arrows', 4);
    const expenditure = spend(registry, ctx, 'arrows', 4);
    db.prepare('UPDATE inventory SET quantity=2 WHERE id=?').run(
      expenditure.expendedInventoryId,
    );
    close(db);
    expect(recover(registry, ctx)).toMatchObject({
      ok: true,
      data: {
        entitlement: 2,
        recovered: 2,
        destroyed: 0,
        unavailable: 2,
      },
    });
    expect(
      db.prepare("SELECT quantity FROM inventory WHERE id='arrows'").get(),
    ).toEqual({ quantity: 2 });
    db.close();
  });

  it.each([
    [2, 2],
    [4, 2],
    [3, 3],
  ])(
    'allows recovered physical rows to be expended in a later battle (%i pieces, spend %i)',
    (quantity, firstSpend) => {
      const { db, registry, ctx } = setup();
      combat(db, 'battle-one');
      stack(db, 'arrows', quantity);
      const first = spend(registry, ctx, 'arrows', firstSpend);
      close(db, 'battle-one');
      const recovered = recover(registry, ctx, 'battle-one');
      expect(recovered).toMatchObject({ ok: true, data: { recovered: 1 } });
      combat(db, 'battle-two');
      expect(spend(registry, ctx, first.expendedInventoryId)).toMatchObject({
        expendedInventoryId: first.expendedInventoryId,
      });
      expect(
        db
          .prepare(
            "SELECT status FROM ammunition_expenditure WHERE combat_instance_id='battle-one'",
          )
          .get(),
      ).toEqual({ status: 'resolved' });
      expect(
        db
          .prepare(
            "SELECT status FROM ammunition_expenditure WHERE combat_instance_id='battle-two'",
          )
          .get(),
      ).toEqual({ status: 'expended' });
      db.close();
    },
  );

  it('expend_ammunition splits a partial stack and records its active combat row', () => {
    const { db, registry, ctx } = setup();
    combat(db);
    stack(db, 'arrows', 3);
    const result = invoke(
      registry,
      'expend_ammunition',
      { itemId: 'arrows' },
      ctx,
    );
    expect(result.ok).toBe(true);
    expect(
      db.prepare("SELECT quantity FROM inventory WHERE id='arrows'").get(),
    ).toEqual({ quantity: 2 });
    const record = db
      .prepare(
        'SELECT combat_instance_id, source_inventory_id, expended_inventory_id, quantity, world_location_id, status FROM ammunition_expenditure',
      )
      .get();
    expect(record).toMatchObject({
      combat_instance_id: 'combat-1',
      source_inventory_id: 'arrows',
      quantity: 1,
      world_location_id: LOCATION,
      status: 'expended',
    });
    expect(
      db
        .prepare(
          'SELECT id, quantity, character_id, unheld_disposition FROM inventory WHERE id=?',
        )
        .get(
          (record as { expended_inventory_id: string }).expended_inventory_id,
        ),
    ).toMatchObject({
      quantity: 1,
      character_id: null,
      unheld_disposition: 'dropped',
    });
  });

  it('refuses expenditure without an active combat instance', () => {
    const { db, registry, ctx } = setup();
    stack(db, 'arrows', 1);
    expect(
      invoke(registry, 'expend_ammunition', { itemId: 'arrows' }, ctx),
    ).toMatchObject({
      ok: false,
      message: expect.stringContaining('active combat'),
    });
  });

  it('refuses expenditure greater than the held quantity', () => {
    const { db, registry, ctx } = setup();
    combat(db);
    stack(db, 'arrows', 1);
    expect(
      invoke(
        registry,
        'expend_ammunition',
        { itemId: 'arrows', quantity: 2 },
        ctx,
      ),
    ).toMatchObject({
      ok: false,
      message: expect.stringContaining('cannot expend 2'),
    });
  });

  it('refuses expenditure from an item not held by the target character', () => {
    const { db, registry, ctx } = setup();
    combat(db);
    stack(db, 'arrows', 1);
    expect(
      invoke(
        registry,
        'expend_ammunition',
        { itemId: 'other-arrows', character: 'pc-1' },
        ctx,
      ),
    ).toMatchObject({
      ok: false,
      message: expect.stringContaining('does not hold'),
    });
  });

  it('recovers zero of N=1 and destroys the unrecovered piece', () => {
    const { db, registry, ctx } = setup();
    combat(db);
    stack(db, 'arrows', 1);
    spend(registry, ctx, 'arrows');
    close(db);
    expect(recover(registry, ctx)).toMatchObject({
      ok: true,
      data: { recovered: 0, destroyed: 1, movedAway: 0 },
    });
    expect(
      db.prepare("SELECT id FROM inventory WHERE id='arrows'").get(),
    ).toBeUndefined();
  });

  it('recovers one of N=2', () => {
    const { db, registry, ctx } = setup();
    combat(db);
    stack(db, 'arrows', 2);
    spend(registry, ctx, 'arrows', 2);
    close(db);
    expect(recover(registry, ctx)).toMatchObject({
      ok: true,
      data: { recovered: 1, destroyed: 1 },
    });
  });

  it('recovers three of N=7 using round-down division', () => {
    const { db, registry, ctx } = setup();
    combat(db);
    stack(db, 'arrows', 7);
    spend(registry, ctx, 'arrows', 7);
    close(db);
    expect(recover(registry, ctx)).toMatchObject({
      ok: true,
      data: { recovered: 3, destroyed: 4 },
    });
  });

  it('computes recovery separately for two ammunition identities', () => {
    const { db, registry, ctx } = setup();
    combat(db);
    stack(db, 'arrows', 3);
    stack(db, 'silver-arrows', 3, 'Silver Arrow', 'silver');
    spend(registry, ctx, 'arrows', 3);
    spend(registry, ctx, 'silver-arrows', 3);
    close(db);
    expect(recover(registry, ctx)).toMatchObject({
      ok: true,
      data: { recovered: 2, destroyed: 4 },
    });
    expect(
      db
        .prepare(
          "SELECT SUM(quantity) AS quantity FROM inventory WHERE character_id='pc-1' AND properties_json=?",
        )
        .get(JSON.stringify({ material: 'wood' })),
    ).toEqual({ quantity: 1 });
    expect(
      db
        .prepare(
          "SELECT SUM(quantity) AS quantity FROM inventory WHERE character_id='pc-1' AND properties_json=?",
        )
        .get(JSON.stringify({ material: 'silver' })),
    ).toEqual({ quantity: 1 });
  });

  it('reserves an expended row from claim until recovery accounts for it', () => {
    const { db, registry, ctx } = setup();
    combat(db);
    stack(db, 'arrows', 4);
    spend(registry, ctx, 'arrows');
    spend(registry, ctx, 'arrows');
    spend(registry, ctx, 'arrows');
    spend(registry, ctx, 'arrows');
    const row = db
      .prepare(
        'SELECT expended_inventory_id FROM ammunition_expenditure ORDER BY expenditure_id LIMIT 1',
      )
      .get() as { expended_inventory_id: string };
    expect(
      invoke(registry, 'claim_item', { id: row.expended_inventory_id }, ctx),
    ).toMatchObject({
      ok: false,
      message: expect.stringContaining('recover_ammunition'),
    });
    expect(invoke(registry, 'list_nearby_items', {}, ctx)).toMatchObject({
      ok: true,
      data: {
        items: expect.not.arrayContaining([
          expect.objectContaining({ id: row.expended_inventory_id }),
        ]),
      },
    });
    expect(
      readStateSnapshot(db, 'pc-1', DEFAULT_TEST_CAMPAIGN_ID).nearbyInventory,
    ).not.toContainEqual(
      expect.objectContaining({ id: row.expended_inventory_id }),
    );
    expect(
      invoke(
        registry,
        'give_item',
        {
          id: row.expended_inventory_id,
          name: 'Arrow',
        },
        ctx,
      ),
    ).toMatchObject({
      ok: false,
      message: expect.stringContaining('recover_ammunition'),
    });
    close(db);
    expect(recover(registry, ctx)).toMatchObject({
      ok: true,
      data: { recovered: 2, destroyed: 2, movedAway: 0 },
    });
  });

  it('tracks each physical split row once and never returns more than half expended', () => {
    const { db, registry, ctx } = setup();
    combat(db);
    stack(db, 'arrow-stack', 4);
    const first = spend(registry, ctx, 'arrow-stack', 2);
    const second = spend(registry, ctx, 'arrow-stack', 2);
    expect(first.expendedInventoryId).not.toBe(second.expendedInventoryId);
    close(db);
    expect(recover(registry, ctx)).toMatchObject({
      ok: true,
      data: { recovered: 2 },
    });
    const total = (
      db
        .prepare(
          "SELECT COALESCE(SUM(quantity),0) AS quantity FROM inventory WHERE character_id='pc-1' AND name='Arrow'",
        )
        .get() as { quantity: number }
    ).quantity;
    expect(total).toBe(2);
    db.close();
  });

  it('refuses recovery at a different current location', () => {
    const { db, registry, ctx } = setup();
    combat(db);
    stack(db, 'arrows', 2);
    spend(registry, ctx, 'arrows', 2);
    close(db);
    db.prepare(
      "UPDATE clock SET current_location_id='elsewhere' WHERE id=1",
    ).run();
    expect(recover(registry, ctx)).toMatchObject({
      ok: false,
      message: expect.stringContaining('another location'),
    });
  });

  it('refuses recovery while the combat instance remains active', () => {
    const { db, registry, ctx } = setup();
    combat(db);
    stack(db, 'arrows', 1);
    spend(registry, ctx, 'arrows');
    expect(recover(registry, ctx)).toMatchObject({
      ok: false,
      message: expect.stringContaining('only after'),
    });
  });

  it('refuses a second recovery call for the same character and instance', () => {
    const { db, registry, ctx } = setup();
    combat(db);
    stack(db, 'arrows', 2);
    spend(registry, ctx, 'arrows', 2);
    close(db);
    recover(registry, ctx);
    expect(recover(registry, ctx)).toMatchObject({
      ok: false,
      message: expect.stringContaining('no expended ammunition'),
    });
  });

  it('returns recovered pieces to character custody with exact inventory identity', () => {
    const { db, registry, ctx } = setup();
    combat(db);
    stack(db, 'arrows', 2);
    spend(registry, ctx, 'arrows', 2);
    close(db);
    recover(registry, ctx);
    const held = db
      .prepare(
        "SELECT name, quantity, character_id, pack_ref, variant_id, properties_json FROM inventory WHERE character_id='pc-1'",
      )
      .all();
    expect(held).toHaveLength(1);
    expect(held[0]).toMatchObject({
      name: 'Arrow',
      quantity: 1,
      character_id: 'pc-1',
      pack_ref: null,
      variant_id: null,
      properties_json: JSON.stringify({ material: 'wood' }),
    });
  });

  it('returns recovered pieces through the claim path with a wear-state row', () => {
    // Custody goes back through claim_item's own write path, so a recovered
    // row is indistinguishable from any other claimed physical row.
    const { db, registry, ctx } = setup();
    combat(db);
    stack(db, 'arrows', 5);
    spend(registry, ctx, 'arrows', 5);
    close(db);
    recover(registry, ctx);
    const held = db
      .prepare(
        `SELECT i.id, i.quantity, w.wear_state FROM inventory i
         LEFT JOIN inventory_wear_state w ON w.inventory_id = i.id
         WHERE i.character_id='pc-1'`,
      )
      .all() as { id: string; quantity: number; wear_state: string | null }[];
    expect(held).toHaveLength(1);
    expect(held[0]).toMatchObject({ quantity: 2, wear_state: 'not_worn' });
    // The unrecovered pieces are gone, not left lying at the location.
    expect(
      db
        .prepare(
          "SELECT COUNT(*) AS n FROM inventory WHERE character_id IS NULL AND unheld_disposition='dropped'",
        )
        .get(),
    ).toEqual({ n: 0 });
  });

  it('gives expenditures deterministic identities', () => {
    const { db, registry, ctx } = setup();
    combat(db);
    stack(db, 'arrows', 3);
    spend(registry, ctx, 'arrows', 1);
    spend(registry, ctx, 'arrows', 1);
    expect(
      db
        .prepare(
          'SELECT expenditure_id FROM ammunition_expenditure ORDER BY expenditure_id',
        )
        .all(),
    ).toEqual([
      { expenditure_id: 'ammo-combat-1-1' },
      { expenditure_id: 'ammo-combat-1-2' },
    ]);
  });
});
