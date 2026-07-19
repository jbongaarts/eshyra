import { describe, expect, it } from 'vitest';
import type { ToolContext } from '../src/internal.js';
import {
  adoptMagicItem,
  createDefaultToolRegistry,
  createSeededRng,
  MAX_MAGIC_ITEM_ADOPTION_SINGLETONS,
  resolveCharacterId,
} from '../src/internal.js';
import { freshDbWithSession } from './support/db.js';

const AT = '2026-07-18T20:00:00.000Z';

function setup(rng: ToolContext['rng'] = createSeededRng(42)) {
  const db = freshDbWithSession();
  const characterId = resolveCharacterId(db);
  const ctx: ToolContext = {
    db,
    rng,
    campaignId: 'campaign-1',
    sessionId: 'session-1',
    turnId: 'turn-1',
    at: AT,
  };
  return { db, characterId, ctx };
}

function insertLegacy(
  setupResult: ReturnType<typeof setup>,
  input: {
    id?: string;
    quantity?: number;
    properties?: Record<string, unknown>;
    packRef?: string;
    variantId?: string;
    location?: string;
  } = {},
) {
  const id = input.id ?? 'legacy-item';
  setupResult.db
    .prepare(
      `INSERT INTO inventory(
         id, character_id, name, quantity, location, world_location_id,
         properties_json, provenance, session_id, updated_at, pack_ref,
         variant_id
       ) VALUES (?, ?, 'Legacy item', ?, ?, NULL, ?, 'test:legacy', 'session-1', ?, ?, ?)`,
    )
    .run(
      id,
      setupResult.characterId,
      input.quantity ?? 1,
      input.location ?? 'backpack',
      JSON.stringify(input.properties ?? { material: 'silver' }),
      AT,
      input.packRef ?? null,
      input.variantId ?? null,
    );
  return id;
}

describe('legacy magic-item adoption', () => {
  it('atomically splits stateful stacks into uniquely initialized singleton instances', () => {
    let roll = 0;
    const s = setup({
      nextInt(maxExclusive) {
        const result = roll % maxExclusive;
        roll += 1;
        return result;
      },
    });
    insertLegacy(s, { quantity: 3, location: 'bandolier' });
    insertLegacy(s, { id: 'legacy-item#2' });

    const result = createDefaultToolRegistry().invoke(
      'adopt_item',
      {
        id: 'legacy-item',
        packRef: 'magic-item:necklace-of-fireballs',
      },
      s.ctx,
    );
    expect(result).toMatchObject({
      ok: true,
      data: {
        adopted: true,
        instanceIds: ['legacy-item', 'legacy-item#3', 'legacy-item#4'],
        stateful: true,
      },
    });
    expect(
      s.db
        .prepare(
          `SELECT id, quantity, location, world_location_id, properties_json,
                  pack_ref, variant_id
           FROM inventory WHERE id IN (?, ?, ?) ORDER BY id`,
        )
        .all('legacy-item', 'legacy-item#3', 'legacy-item#4'),
    ).toEqual([
      {
        id: 'legacy-item',
        quantity: 1,
        location: 'bandolier',
        world_location_id: null,
        properties_json: '{"material":"silver"}',
        pack_ref: 'magic-item:necklace-of-fireballs',
        variant_id: null,
      },
      {
        id: 'legacy-item#3',
        quantity: 1,
        location: 'bandolier',
        world_location_id: null,
        properties_json: '{"material":"silver"}',
        pack_ref: 'magic-item:necklace-of-fireballs',
        variant_id: null,
      },
      {
        id: 'legacy-item#4',
        quantity: 1,
        location: 'bandolier',
        world_location_id: null,
        properties_json: '{"material":"silver"}',
        pack_ref: 'magic-item:necklace-of-fireballs',
        variant_id: null,
      },
    ]);
    const states = s.db
      .prepare(
        `SELECT inventory_id, state_json FROM item_state
         WHERE inventory_id IN (?, ?, ?) ORDER BY inventory_id`,
      )
      .all('legacy-item', 'legacy-item#3', 'legacy-item#4') as {
      inventory_id: string;
      state_json: string;
    }[];
    expect(
      states.map(
        ({ state_json }) =>
          (
            JSON.parse(state_json) as {
              economies: { charges: { remaining: number } };
            }
          ).economies.charges.remaining,
      ),
    ).toEqual([4, 5, 6]);
  });

  it('adopts exactly the reviewed maximum as a complete deterministic transaction', () => {
    let rngDraws = 0;
    const s = setup({
      nextInt(maxExclusive) {
        rngDraws += 1;
        return (rngDraws - 1) % maxExclusive;
      },
    });
    insertLegacy(s, {
      id: 'maximum-stack',
      quantity: MAX_MAGIC_ITEM_ADOPTION_SINGLETONS,
    });

    const result = createDefaultToolRegistry().invoke(
      'adopt_item',
      {
        id: 'maximum-stack',
        packRef: 'magic-item:necklace-of-fireballs',
      },
      s.ctx,
    );
    expect(result).toMatchObject({
      ok: true,
      data: { adopted: true, reviewRequired: false },
    });
    if (!result.ok) throw new Error(result.message);
    expect((result.data as { instanceIds: string[] }).instanceIds).toHaveLength(
      MAX_MAGIC_ITEM_ADOPTION_SINGLETONS,
    );
    expect(rngDraws).toBe(MAX_MAGIC_ITEM_ADOPTION_SINGLETONS);
    expect(
      s.db
        .prepare(
          `SELECT COUNT(*) AS rows, SUM(quantity) AS quantity
           FROM inventory WHERE id='maximum-stack' OR id LIKE 'maximum-stack#%'`,
        )
        .get(),
    ).toEqual({
      rows: MAX_MAGIC_ITEM_ADOPTION_SINGLETONS,
      quantity: MAX_MAGIC_ITEM_ADOPTION_SINGLETONS,
    });
    expect(
      s.db
        .prepare(
          `SELECT COUNT(*) AS states FROM item_state
           WHERE inventory_id='maximum-stack' OR inventory_id LIKE 'maximum-stack#%'`,
        )
        .get(),
    ).toEqual({ states: MAX_MAGIC_ITEM_ADOPTION_SINGLETONS });
  });

  it('flags a stateful stack above the reviewed maximum without draws or partial materialization', () => {
    let rngDraws = 0;
    const s = setup({
      nextInt() {
        rngDraws += 1;
        return 0;
      },
    });
    insertLegacy(s, {
      id: 'oversized-stack',
      quantity: MAX_MAGIC_ITEM_ADOPTION_SINGLETONS + 1,
    });

    expect(
      createDefaultToolRegistry().invoke(
        'adopt_item',
        {
          id: 'oversized-stack',
          packRef: 'magic-item:necklace-of-fireballs',
        },
        s.ctx,
      ),
    ).toMatchObject({
      ok: true,
      data: {
        adopted: false,
        reviewRequired: true,
        reason: expect.stringContaining('reviewed adoption maximum of 100'),
      },
    });
    expect(rngDraws).toBe(0);
    const row = s.db
      .prepare(
        'SELECT quantity, pack_ref, properties_json FROM inventory WHERE id=?',
      )
      .get('oversized-stack') as {
      quantity: number;
      pack_ref: string | null;
      properties_json: string;
    };
    expect(row).toMatchObject({
      quantity: MAX_MAGIC_ITEM_ADOPTION_SINGLETONS + 1,
      pack_ref: null,
    });
    expect(JSON.parse(row.properties_json)).toMatchObject({
      magicItemAdoption: { status: 'gm-review-required' },
    });
    expect(
      s.db
        .prepare(
          `SELECT COUNT(*) AS rows FROM inventory
           WHERE id='oversized-stack' OR id LIKE 'oversized-stack#%'`,
        )
        .get(),
    ).toEqual({ rows: 1 });
    expect(
      s.db
        .prepare(
          `SELECT COUNT(*) AS states FROM item_state
           WHERE inventory_id='oversized-stack' OR inventory_id LIKE 'oversized-stack#%'`,
        )
        .get(),
    ).toEqual({ states: 0 });
  });

  it('lifts a compatible mechanics envelope and canonicalizes existing attunement identity', () => {
    const s = setup();
    insertLegacy(s, {
      properties: {
        material: 'crystal',
        mechanics: { economies: { charges: { remaining: 2 } } },
      },
    });
    s.db
      .prepare(
        `INSERT INTO attunement(
           campaign_id, character_id, item_id, item_key, display_name,
           attuned_at, provenance, session_id, updated_at
         ) VALUES ('campaign-1', ?, 'legacy-item', 'name:legacy-item',
                   'Legacy item', ?, 'test:legacy', 'session-1', ?)`,
      )
      .run(s.characterId, AT, AT);

    const result = createDefaultToolRegistry().invoke(
      'adopt_item',
      {
        id: 'legacy-item',
        packRef: 'magic-item:wand-of-fireballs',
      },
      s.ctx,
    );
    expect(result).toMatchObject({
      ok: true,
      data: { adopted: true, liftedLegacyState: true },
    });
    const inventory = s.db
      .prepare('SELECT properties_json FROM inventory WHERE id=?')
      .get('legacy-item') as { properties_json: string };
    expect(JSON.parse(inventory.properties_json)).toEqual({
      material: 'crystal',
    });
    const state = s.db
      .prepare('SELECT state_json FROM item_state WHERE inventory_id=?')
      .get('legacy-item') as { state_json: string };
    expect(JSON.parse(state.state_json)).toMatchObject({
      packRef: 'magic-item:wand-of-fireballs',
      economies: { charges: { remaining: 2 } },
    });
    expect(
      s.db
        .prepare(
          'SELECT item_key, display_name FROM attunement WHERE item_id=?',
        )
        .get('legacy-item'),
    ).toEqual({
      item_key: 'magic-item:wand-of-fireballs',
      display_name: 'Wand of Fireballs',
    });
  });

  it('does not canonicalize a legacy bond that the normal attunement boundary rejects', () => {
    for (const [id, packRef, expected] of [
      [
        'ordinary',
        'magic-item:adamantine-armor',
        'does not require attunement',
      ],
      ['orb', 'magic-item:orb-of-dragonkind', 'engine-pending'],
    ] as const) {
      const s = setup();
      insertLegacy(s, { id });
      s.db
        .prepare(
          `INSERT INTO attunement(
             campaign_id, character_id, item_id, item_key, display_name,
             attuned_at, provenance, session_id, updated_at
           ) VALUES ('campaign-1', ?, ?, ?, 'Legacy item', ?,
                     'test:legacy', 'session-1', ?)`,
        )
        .run(s.characterId, id, `name:${id}`, AT, AT);

      const result = createDefaultToolRegistry().invoke(
        'adopt_item',
        { id, packRef },
        s.ctx,
      );
      expect(result).toMatchObject({
        ok: true,
        data: {
          adopted: false,
          reviewRequired: true,
          reason: expect.stringContaining(expected),
        },
      });
      expect(
        s.db
          .prepare('SELECT pack_ref, properties_json FROM inventory WHERE id=?')
          .get(id),
      ).toMatchObject({ pack_ref: null });
      expect(
        s.db.prepare('SELECT item_key FROM attunement WHERE item_id=?').get(id),
      ).toEqual({ item_key: `name:${id}` });
      s.db.close();
    }
  });

  it('durably flags unlicensed transitional mechanics without binding or splitting', () => {
    const s = setup();
    insertLegacy(s, {
      quantity: 2,
      properties: {
        mechanics: { economies: { invented: { remaining: 99 } } },
      },
    });
    const result = createDefaultToolRegistry().invoke(
      'adopt_item',
      {
        id: 'legacy-item',
        packRef: 'magic-item:necklace-of-fireballs',
      },
      s.ctx,
    );
    expect(result).toMatchObject({
      ok: true,
      data: { adopted: false, reviewRequired: true },
    });
    const row = s.db
      .prepare(
        'SELECT quantity, pack_ref, variant_id, properties_json FROM inventory WHERE id=?',
      )
      .get('legacy-item') as {
      quantity: number;
      pack_ref: string | null;
      variant_id: string | null;
      properties_json: string;
    };
    expect(row).toMatchObject({
      quantity: 2,
      pack_ref: null,
      variant_id: null,
    });
    expect(JSON.parse(row.properties_json)).toMatchObject({
      mechanics: { economies: { invented: { remaining: 99 } } },
      magicItemAdoption: {
        status: 'gm-review-required',
        requestedPackRef: 'magic-item:necklace-of-fireballs',
        reason: expect.stringContaining('not licensed'),
      },
    });
    expect(
      s.db
        .prepare(
          "SELECT COUNT(*) AS n FROM inventory WHERE id LIKE 'legacy-item#%'",
        )
        .get(),
    ).toEqual({ n: 0 });
  });

  it('flags an unlicensed legacy item_state row without replacing it', () => {
    const s = setup();
    insertLegacy(s);
    const legacyState = {
      packRef: 'magic-item:necklace-of-fireballs',
      economies: { invented: { remaining: 1 } },
    };
    s.db
      .prepare(
        `INSERT INTO item_state(
           inventory_id, state_json, provenance, session_id, updated_at
         ) VALUES ('legacy-item', ?, 'test:legacy', 'session-1', ?)`,
      )
      .run(JSON.stringify(legacyState), AT);

    expect(
      createDefaultToolRegistry().invoke(
        'adopt_item',
        { id: 'legacy-item', packRef: 'magic-item:necklace-of-fireballs' },
        s.ctx,
      ),
    ).toMatchObject({
      ok: true,
      data: { adopted: false, reviewRequired: true },
    });
    expect(
      s.db
        .prepare('SELECT pack_ref FROM inventory WHERE id=?')
        .get('legacy-item'),
    ).toEqual({ pack_ref: null });
    expect(
      s.db
        .prepare('SELECT state_json FROM item_state WHERE inventory_id=?')
        .get('legacy-item'),
    ).toEqual({ state_json: JSON.stringify(legacyState) });
    const properties = s.db
      .prepare('SELECT properties_json FROM inventory WHERE id=?')
      .get('legacy-item') as { properties_json: string };
    expect(JSON.parse(properties.properties_json)).toMatchObject({
      magicItemAdoption: { status: 'gm-review-required' },
    });
  });

  it('flags and preserves a legacy item usage counter instead of creating dual spend owners', () => {
    const s = setup();
    insertLegacy(s, { quantity: 2 });
    s.db
      .prepare(
        `INSERT INTO entity_usage_counter(
           campaign_id, owner_kind, owner_ref, counter_key, display_name,
           uses_max, uses_used, reset_kind, source, provenance, session_id,
           updated_at
         ) VALUES ('campaign-1', 'item', 'legacy-item', 'charges',
                   'Legacy charges', 7, 2, 'dawn', 'declared',
                   'test:legacy', 'session-1', ?)`,
      )
      .run(AT);

    expect(
      createDefaultToolRegistry().invoke(
        'adopt_item',
        { id: 'legacy-item', packRef: 'magic-item:necklace-of-fireballs' },
        s.ctx,
      ),
    ).toMatchObject({
      ok: true,
      data: {
        adopted: false,
        reviewRequired: true,
        reason: expect.stringContaining('usage counter'),
      },
    });
    expect(
      s.db
        .prepare('SELECT quantity, pack_ref FROM inventory WHERE id=?')
        .get('legacy-item'),
    ).toEqual({ quantity: 2, pack_ref: null });
    expect(
      s.db
        .prepare(
          "SELECT uses_used FROM entity_usage_counter WHERE owner_kind='item' AND owner_ref='legacy-item'",
        )
        .get(),
    ).toEqual({ uses_used: 2 });
    expect(
      s.db
        .prepare(
          "SELECT COUNT(*) AS n FROM inventory WHERE id LIKE 'legacy-item#%'",
        )
        .get(),
    ).toEqual({ n: 0 });
    const properties = s.db
      .prepare('SELECT properties_json FROM inventory WHERE id=?')
      .get('legacy-item') as { properties_json: string };
    expect(JSON.parse(properties.properties_json)).toMatchObject({
      magicItemAdoption: {
        status: 'gm-review-required',
        reason: expect.stringContaining('usage counter'),
      },
    });
  });

  it('requires exact variants and preserves stateless stacks without item state', () => {
    const s = setup();
    insertLegacy(s);
    const registry = createDefaultToolRegistry();
    expect(
      registry.invoke(
        'adopt_item',
        { id: 'legacy-item', packRef: 'magic-item:crystal-ball' },
        s.ctx,
      ),
    ).toMatchObject({ ok: false });
    expect(
      registry.invoke(
        'adopt_item',
        {
          id: 'legacy-item',
          packRef: 'magic-item:crystal-ball',
          variantId: 'unknown',
        },
        s.ctx,
      ),
    ).toMatchObject({ ok: false });
    expect(
      registry.invoke(
        'adopt_item',
        {
          id: 'legacy-item',
          packRef: 'magic-item:crystal-ball',
          variantId: 'crystal-ball-of-telepathy',
        },
        s.ctx,
      ),
    ).toMatchObject({ ok: true, data: { stateful: true } });

    insertLegacy(s, { id: 'legacy-potions', quantity: 5 });
    expect(
      registry.invoke(
        'adopt_item',
        { id: 'legacy-potions', packRef: 'magic-item:potion-of-healing' },
        s.ctx,
      ),
    ).toMatchObject({
      ok: true,
      data: {
        stateful: false,
        instanceIds: ['legacy-potions'],
      },
    });
    expect(
      s.db
        .prepare('SELECT quantity, pack_ref FROM inventory WHERE id=?')
        .get('legacy-potions'),
    ).toEqual({ quantity: 5, pack_ref: 'magic-item:potion-of-healing' });
    expect(
      s.db
        .prepare('SELECT 1 FROM item_state WHERE inventory_id=?')
        .get('legacy-potions'),
    ).toBeUndefined();
  });

  it('rejects wrong-holder and different-binding collisions while exact binding is idempotent', () => {
    const s = setup();
    insertLegacy(s);
    expect(() =>
      adoptMagicItem(s.db, {
        campaignId: 'campaign-1',
        inventoryId: 'legacy-item',
        characterId: 'someone-else',
        packRef: 'magic-item:potion-of-healing',
        provenance: 'test:adopt',
        sessionId: 'session-1',
        at: AT,
      }),
    ).toThrow(/does not hold/);

    s.db
      .prepare(
        "UPDATE inventory SET pack_ref='magic-item:potion-of-healing' WHERE id='legacy-item'",
      )
      .run();
    expect(
      createDefaultToolRegistry().invoke(
        'adopt_item',
        { id: 'legacy-item', packRef: 'magic-item:potion-of-healing' },
        s.ctx,
      ),
    ).toMatchObject({ ok: true, data: { alreadyBound: true } });

    insertLegacy(s, {
      id: 'bound-stateful-stack',
      quantity: 2,
      packRef: 'magic-item:necklace-of-fireballs',
    });
    expect(
      createDefaultToolRegistry().invoke(
        'adopt_item',
        {
          id: 'bound-stateful-stack',
          packRef: 'magic-item:necklace-of-fireballs',
        },
        s.ctx,
      ),
    ).toMatchObject({ ok: false });
    expect(
      createDefaultToolRegistry().invoke(
        'adopt_item',
        { id: 'legacy-item', packRef: 'magic-item:necklace-of-fireballs' },
        s.ctx,
      ),
    ).toMatchObject({ ok: false });

    s.db
      .prepare("UPDATE inventory SET quantity=2 WHERE id='legacy-item'")
      .run();
    expect(
      createDefaultToolRegistry().invoke(
        'adopt_item',
        { id: 'legacy-item', packRef: 'magic-item:potion-of-healing' },
        s.ctx,
      ),
    ).toMatchObject({ ok: true, data: { alreadyBound: true } });
  });

  it('rejects stale cross-campaign attunement before binding or idempotent return', () => {
    const s = setup();
    insertLegacy(s, { quantity: 2 });
    s.db
      .prepare(
        `INSERT INTO attunement(
           campaign_id, character_id, item_id, item_key, display_name,
           attuned_at, provenance, session_id, updated_at
         ) VALUES ('campaign-stale', ?, 'legacy-item', 'name:legacy-item',
                   'Legacy item', ?, 'test:legacy', 'session-1', ?)`,
      )
      .run(s.characterId, AT, AT);

    expect(
      createDefaultToolRegistry().invoke(
        'adopt_item',
        { id: 'legacy-item', packRef: 'magic-item:necklace-of-fireballs' },
        s.ctx,
      ),
    ).toMatchObject({
      ok: false,
      code: 'adoption_error',
      message: expect.stringContaining('campaign-stale'),
    });
    expect(
      s.db
        .prepare(
          'SELECT quantity, pack_ref, properties_json FROM inventory WHERE id=?',
        )
        .get('legacy-item'),
    ).toEqual({
      quantity: 2,
      pack_ref: null,
      properties_json: '{"material":"silver"}',
    });
    expect(
      s.db
        .prepare(
          "SELECT COUNT(*) AS rows FROM inventory WHERE id LIKE 'legacy-item#%'",
        )
        .get(),
    ).toEqual({ rows: 0 });

    s.db
      .prepare(
        "UPDATE inventory SET pack_ref='magic-item:potion-of-healing', quantity=1 WHERE id='legacy-item'",
      )
      .run();
    expect(
      createDefaultToolRegistry().invoke(
        'adopt_item',
        { id: 'legacy-item', packRef: 'magic-item:potion-of-healing' },
        s.ctx,
      ),
    ).toMatchObject({ ok: false, code: 'adoption_error' });
  });

  it.each([
    ['invalid JSON', '{', 'contains invalid JSON'],
    ['non-object JSON', '[]', 'must be an object'],
  ])('reports %s properties as a controlled adoption error without changing data', (_case, rawProperties, expectedMessage) => {
    const s = setup();
    insertLegacy(s);
    s.db
      .prepare('UPDATE inventory SET properties_json=? WHERE id=?')
      .run(rawProperties, 'legacy-item');

    const result = createDefaultToolRegistry().invoke(
      'adopt_item',
      { id: 'legacy-item', packRef: 'magic-item:necklace-of-fireballs' },
      s.ctx,
    );
    expect(result).toMatchObject({
      ok: false,
      code: 'adoption_error',
      message: expect.stringContaining(expectedMessage),
    });
    if (result.ok) throw new Error('expected controlled adoption failure');
    expect(result.message).not.toMatch(/SyntaxError|Unexpected/);
    expect(
      s.db
        .prepare(
          'SELECT quantity, pack_ref, properties_json FROM inventory WHERE id=?',
        )
        .get('legacy-item'),
    ).toEqual({
      quantity: 1,
      pack_ref: null,
      properties_json: rawProperties,
    });
    expect(
      s.db
        .prepare('SELECT 1 FROM item_state WHERE inventory_id=?')
        .get('legacy-item'),
    ).toBeUndefined();
  });

  it('rolls back binding, splitting, and attunement rewrites when initialization fails', () => {
    const s = setup({
      nextInt() {
        throw new Error('rng failed');
      },
    });
    insertLegacy(s, { quantity: 2 });
    s.db
      .prepare(
        `INSERT INTO attunement(
           campaign_id, character_id, item_id, item_key, display_name,
           attuned_at, provenance, session_id, updated_at
         ) VALUES ('campaign-1', ?, 'legacy-item', 'name:legacy-item',
                   'Legacy item', ?, 'test:legacy', 'session-1', ?)`,
      )
      .run(s.characterId, AT, AT);
    expect(
      createDefaultToolRegistry().invoke(
        'adopt_item',
        {
          id: 'legacy-item',
          packRef: 'magic-item:necklace-of-prayer-beads',
        },
        s.ctx,
      ),
    ).toMatchObject({ ok: false });
    expect(
      s.db
        .prepare('SELECT quantity, pack_ref FROM inventory WHERE id=?')
        .get('legacy-item'),
    ).toEqual({ quantity: 2, pack_ref: null });
    expect(
      s.db
        .prepare(
          "SELECT COUNT(*) AS n FROM inventory WHERE id LIKE 'legacy-item#%'",
        )
        .get(),
    ).toEqual({ n: 0 });
    expect(
      s.db
        .prepare(
          'SELECT item_key, display_name FROM attunement WHERE item_id=?',
        )
        .get('legacy-item'),
    ).toEqual({ item_key: 'name:legacy-item', display_name: 'Legacy item' });
  });
});
