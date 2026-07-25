import { describe, expect, it } from 'vitest';
import type { ToolContext } from '../src/internal.js';
import {
  adoptMagicItem,
  assembleContext,
  createDefaultToolRegistry,
  createSeededRng,
  MAX_MAGIC_ITEM_ADOPTION_SINGLETONS,
  mutateState,
  renderContextMessage,
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

function adoptionReview(db: ReturnType<typeof setup>['db'], id: string) {
  return db
    .prepare(
      `SELECT requested_pack_ref, requested_variant_id, review_kind, reason,
              raw_properties_json, raw_item_state_json
       FROM inventory_adoption_review WHERE inventory_id=?`,
    )
    .get(id) as
    | {
        requested_pack_ref: string;
        requested_variant_id: string | null;
        review_kind: string;
        reason: string;
        raw_properties_json: string | null;
        raw_item_state_json: string | null;
      }
    | undefined;
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
        reviewKind: 'oversized-stack',
        requiredResolutionAction: 'set-reviewed-quantity',
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
    expect(JSON.parse(row.properties_json)).toEqual({ material: 'silver' });
    expect(adoptionReview(s.db, 'oversized-stack')).toMatchObject({
      requested_pack_ref: 'magic-item:necklace-of-fireballs',
      reason: expect.stringContaining('reviewed adoption maximum of 100'),
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
    expect(
      createDefaultToolRegistry().invoke(
        'adopt_item',
        {
          id: 'oversized-stack',
          packRef: 'magic-item:necklace-of-fireballs',
          resolution: {
            action: 'set-reviewed-quantity',
            quantity: 2,
            evidence:
              'The GM verified that the legacy stack represented two necklaces.',
          },
        },
        s.ctx,
      ),
    ).toMatchObject({
      ok: true,
      data: {
        adopted: true,
        instanceIds: ['oversized-stack', 'oversized-stack#2'],
      },
    });
    expect(
      s.db
        .prepare(
          `SELECT action, reviewed_quantity, discarded_structure_json
           FROM inventory_adoption_resolution WHERE inventory_id='oversized-stack'`,
        )
        .get(),
    ).toMatchObject({
      action: 'set-reviewed-quantity',
      reviewed_quantity: 2,
      discarded_structure_json: '{"previousQuantity":101}',
    });
  });

  it('resolves a reclassified formerly oversized review by discarding preserved evidence', () => {
    const s = setup();
    insertLegacy(s, {
      id: 'reclassified-stack',
      quantity: 40,
      properties: { material: 'silver' },
    });
    s.db
      .prepare(
        `INSERT INTO inventory_adoption_review(
           inventory_id, requested_pack_ref, review_kind, reason,
           raw_properties_json, raw_item_state_json, provenance, session_id,
           updated_at
         ) VALUES (?, ?, 'malformed-evidence', ?, ?, ?, 'test', ?, ?)`,
      )
      .run(
        'reclassified-stack',
        'magic-item:necklace-of-fireballs',
        'legacy oversized evidence [reclassified by 0023: inventory quantity <= 100]',
        '{"legacy":true}',
        '{"legacyState":true}',
        s.ctx.sessionId,
        s.ctx.at,
      );

    const result = adoptMagicItem(s.db, {
      campaignId: s.ctx.campaignId,
      inventoryId: 'reclassified-stack',
      characterId: s.characterId,
      packRef: 'magic-item:necklace-of-fireballs',
      resolution: {
        action: 'discard-evidence',
        evidence: 'The GM discarded the preserved malformed legacy evidence.',
      },
      rng: s.ctx.rng,
      provenance: 'test:adoption',
      sessionId: s.ctx.sessionId,
      at: s.ctx.at,
    });

    expect(result).toMatchObject({ adopted: true, reviewRequired: false });
    expect(
      s.db
        .prepare(
          `SELECT COUNT(*) AS rows, SUM(quantity) AS quantity,
                  MIN(pack_ref) AS pack_ref
           FROM inventory WHERE id=? OR id LIKE ?`,
        )
        .get('reclassified-stack', 'reclassified-stack#%'),
    ).toEqual({
      rows: 40,
      quantity: 40,
      pack_ref: 'magic-item:necklace-of-fireballs',
    });
    expect(
      s.db
        .prepare(
          'SELECT action, previous_review_kind FROM inventory_adoption_resolution WHERE inventory_id=?',
        )
        .get('reclassified-stack'),
    ).toEqual({
      action: 'discard-evidence',
      previous_review_kind: 'malformed-evidence',
    });
  });

  it('resolves a zero-quantity malformed-evidence review and deletes the empty row', () => {
    const s = setup();
    insertLegacy(s, {
      id: 'zero-quantity-review',
      quantity: 0,
      properties: { material: 'silver' },
    });
    s.db
      .prepare(
        `INSERT INTO inventory_adoption_review(
           inventory_id, requested_pack_ref, review_kind, reason,
           raw_properties_json, provenance, session_id, updated_at
         ) VALUES (?, ?, 'malformed-evidence', ?, ?, 'test', ?, ?)`,
      )
      .run(
        'zero-quantity-review',
        'magic-item:necklace-of-fireballs',
        'zero quantity is malformed evidence',
        '{"legacy":true}',
        s.ctx.sessionId,
        s.ctx.at,
      );

    const result = adoptMagicItem(s.db, {
      campaignId: s.ctx.campaignId,
      inventoryId: 'zero-quantity-review',
      characterId: s.characterId,
      packRef: 'magic-item:necklace-of-fireballs',
      resolution: {
        action: 'discard-evidence',
        evidence: 'The GM discarded the empty malformed legacy row.',
      },
      rng: s.ctx.rng,
      provenance: 'test:adoption',
      sessionId: s.ctx.sessionId,
      at: s.ctx.at,
    });

    expect(result).toMatchObject({
      adopted: true,
      reviewRequired: false,
      originalInstanceId: 'zero-quantity-review',
      instanceIds: [],
    });
    expect(
      s.db
        .prepare('SELECT 1 FROM inventory WHERE id=?')
        .get('zero-quantity-review'),
    ).toBeUndefined();
    expect(adoptionReview(s.db, 'zero-quantity-review')).toBeUndefined();
    expect(
      s.db
        .prepare(
          'SELECT action FROM inventory_adoption_resolution WHERE inventory_id=?',
        )
        .get('zero-quantity-review'),
    ).toEqual({ action: 'discard-evidence' });
  });

  it('atomically reconciles surviving attunement when resolving an empty reviewed row', () => {
    const s = setup();
    insertLegacy(s, { id: 'zero-quantity-attuned', quantity: 0 });
    s.db
      .prepare(
        `INSERT INTO inventory_adoption_review(
           inventory_id, requested_pack_ref, review_kind, reason,
           raw_properties_json, provenance, session_id, updated_at
         ) VALUES (?, ?, 'malformed-evidence', ?, ?, 'test', ?, ?)`,
      )
      .run(
        'zero-quantity-attuned',
        'magic-item:necklace-of-fireballs',
        'zero quantity is malformed evidence',
        '{"legacy":true}',
        s.ctx.sessionId,
        s.ctx.at,
      );
    s.db
      .prepare(
        `INSERT INTO attunement(
           campaign_id, character_id, item_id, item_key, display_name,
           attuned_at, provenance, session_id, updated_at
         ) VALUES (?, ?, 'zero-quantity-attuned',
                   'magic-item:necklace-of-fireballs', 'Empty Necklace', ?,
                   'test', ?, ?)`,
      )
      .run(
        s.ctx.campaignId,
        s.characterId,
        s.ctx.at,
        s.ctx.sessionId,
        s.ctx.at,
      );

    // end_attunement is blocked by the quarantine itself, so the resolution
    // must reconcile the surviving attunement atomically rather than deadlock.
    const result = adoptMagicItem(s.db, {
      campaignId: s.ctx.campaignId,
      inventoryId: 'zero-quantity-attuned',
      characterId: s.characterId,
      packRef: 'magic-item:necklace-of-fireballs',
      resolution: {
        action: 'discard-evidence',
        evidence: 'The GM discarded the empty malformed legacy row.',
      },
      rng: s.ctx.rng,
      provenance: 'test:adoption',
      sessionId: s.ctx.sessionId,
      at: s.ctx.at,
    });

    expect(result).toMatchObject({
      adopted: true,
      reviewRequired: false,
      originalInstanceId: 'zero-quantity-attuned',
      instanceIds: [],
    });
    expect(
      s.db
        .prepare('SELECT 1 FROM inventory WHERE id=?')
        .get('zero-quantity-attuned'),
    ).toBeUndefined();
    expect(adoptionReview(s.db, 'zero-quantity-attuned')).toBeUndefined();
    expect(
      s.db
        .prepare('SELECT 1 FROM attunement WHERE item_id=?')
        .get('zero-quantity-attuned'),
    ).toBeUndefined();
    const resolution = s.db
      .prepare(
        `SELECT action, discarded_structure_json
         FROM inventory_adoption_resolution WHERE inventory_id=?`,
      )
      .get('zero-quantity-attuned') as {
      action: string;
      discarded_structure_json: string;
    };
    expect(resolution.action).toBe('discard-evidence');
    expect(
      JSON.parse(resolution.discarded_structure_json) as {
        attunements: { item_id: string; display_name: string }[];
      },
    ).toMatchObject({
      attunements: [
        { item_id: 'zero-quantity-attuned', display_name: 'Empty Necklace' },
      ],
    });
  });

  it('rejects a zero-quantity adoption without a review resolution', () => {
    const s = setup();
    insertLegacy(s, { id: 'zero-quantity-unreviewed', quantity: 0 });
    expect(() =>
      adoptMagicItem(s.db, {
        campaignId: s.ctx.campaignId,
        inventoryId: 'zero-quantity-unreviewed',
        characterId: s.characterId,
        packRef: 'magic-item:necklace-of-fireballs',
        provenance: 'test:adoption',
        sessionId: s.ctx.sessionId,
        at: s.ctx.at,
      }),
    ).toThrow(/positive integer quantity/);
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
      if (id === 'ordinary') {
        expect(
          createDefaultToolRegistry().invoke(
            'adopt_item',
            {
              id,
              packRef,
              resolution: {
                action: 'discard-legacy-attunement',
                evidence: 'The GM removed the impossible legacy bond.',
              },
            },
            s.ctx,
          ),
        ).toMatchObject({ ok: true, data: { adopted: true } });
        expect(
          s.db.prepare('SELECT 1 FROM attunement WHERE item_id=?').get(id),
        ).toBeUndefined();
        expect(
          s.db.prepare('SELECT pack_ref FROM inventory WHERE id=?').get(id),
        ).toEqual({ pack_ref: packRef });
      }
      s.db.close();
    }
  });

  it('makes review quarantine code-owned and blocks every model-facing bypass until explicit resolution', () => {
    const s = setup();
    insertLegacy(s, { id: 'orb' });
    s.db
      .prepare(
        `INSERT INTO attunement(
           campaign_id, character_id, item_id, item_key, display_name,
           attuned_at, provenance, session_id, updated_at
         ) VALUES ('campaign-1', ?, 'orb', 'name:orb', 'Legacy Orb', ?,
                   'test:legacy', 'session-1', ?)`,
      )
      .run(s.characterId, AT, AT);
    expect(
      createDefaultToolRegistry().invoke(
        'adopt_item',
        { id: 'orb', packRef: 'magic-item:orb-of-dragonkind' },
        s.ctx,
      ),
    ).toMatchObject({
      ok: true,
      data: { adopted: false, reviewRequired: true },
    });
    s.db
      .prepare(
        `INSERT INTO character(
         id, name, ability_scores_json, provenance, session_id, updated_at
       ) VALUES ('pc-2', 'Recipient', ?, 'test', 'session-1', ?)`,
      )
      .run(
        JSON.stringify({
          strength: 10,
          dexterity: 10,
          constitution: 10,
          intelligence: 10,
          wisdom: 10,
          charisma: 10,
        }),
        AT,
      );

    const registry = createDefaultToolRegistry();
    for (const [tool, args] of [
      ['end_attunement', { itemId: 'orb', reason: 'voluntary' }],
      ['remove_item', { id: 'orb', disposition: 'destroyed' }],
      ['give_item', { id: 'orb', name: 'Replacement' }],
      ['use_item', { instanceId: 'orb', operationId: 'inspect' }],
      ['transfer_item', { id: 'orb', to_character: 'pc-2', attunement: 'end' }],
    ] as const) {
      expect(registry.invoke(tool, args, s.ctx)).toMatchObject({
        ok: false,
        message: expect.stringContaining('quarantined for GM adoption review'),
      });
    }
    expect(() =>
      mutateState(s.db, {
        target: 'inventory',
        id: 'orb',
        field: 'properties',
        op: 'set',
        value: { magicItemAdoption: null },
        provenance: 'model:bypass',
        sessionId: 'session-1',
        at: AT,
      }),
    ).toThrow(/quarantined for GM adoption review/);
    expect(adoptionReview(s.db, 'orb')).toBeDefined();
    expect(
      s.db
        .prepare('SELECT item_key FROM attunement WHERE item_id=?')
        .get('orb'),
    ).toEqual({ item_key: 'name:orb' });

    expect(
      registry.invoke(
        'adopt_item',
        {
          id: 'orb',
          packRef: 'magic-item:orb-of-dragonkind',
          resolution: {
            action: 'discard-legacy-attunement',
            evidence: 'The GM ruled the pre-canonical bond invalid.',
          },
        },
        s.ctx,
      ),
    ).toMatchObject({ ok: true, data: { adopted: true } });
    expect(adoptionReview(s.db, 'orb')).toBeUndefined();
    expect(
      s.db
        .prepare('SELECT item_key FROM attunement WHERE item_id=?')
        .get('orb'),
    ).toBeUndefined();
    expect(
      s.db.prepare('SELECT pack_ref FROM inventory WHERE id=?').get('orb'),
    ).toEqual({ pack_ref: 'magic-item:orb-of-dragonkind' });
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
    expect(JSON.parse(row.properties_json)).toEqual({});
    expect(adoptionReview(s.db, 'legacy-item')).toMatchObject({
      requested_pack_ref: 'magic-item:necklace-of-fireballs',
      reason: expect.stringContaining('not licensed'),
      raw_properties_json: expect.stringContaining('invented'),
    });
    expect(
      s.db
        .prepare(
          "SELECT COUNT(*) AS n FROM inventory WHERE id LIKE 'legacy-item#%'",
        )
        .get(),
    ).toEqual({ n: 0 });
    expect(
      createDefaultToolRegistry().invoke(
        'adopt_item',
        {
          id: 'legacy-item',
          packRef: 'magic-item:necklace-of-fireballs',
          resolution: {
            action: 'discard-evidence',
            evidence: 'The GM discarded the unlicensed property projection.',
          },
        },
        s.ctx,
      ),
    ).toMatchObject({
      ok: true,
      data: {
        adopted: true,
        instanceIds: ['legacy-item', 'legacy-item#2'],
      },
    });
    expect(adoptionReview(s.db, 'legacy-item')).toBeUndefined();
  });

  it('quarantines an unlicensed legacy item_state row outside live state', () => {
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
    ).toBeUndefined();
    const properties = s.db
      .prepare('SELECT properties_json FROM inventory WHERE id=?')
      .get('legacy-item') as { properties_json: string };
    expect(JSON.parse(properties.properties_json)).toEqual({
      material: 'silver',
    });
    expect(adoptionReview(s.db, 'legacy-item')).toMatchObject({
      raw_item_state_json: JSON.stringify(legacyState),
    });
    expect(
      createDefaultToolRegistry().invoke(
        'adopt_item',
        {
          id: 'legacy-item',
          packRef: 'magic-item:necklace-of-fireballs',
          resolution: {
            action: 'discard-evidence',
            evidence: 'The GM discarded the unlicensed persisted projection.',
          },
        },
        s.ctx,
      ),
    ).toMatchObject({ ok: true, data: { adopted: true } });
    expect(adoptionReview(s.db, 'legacy-item')).toBeUndefined();
  });

  it('successfully resolves every remaining malformed-evidence producer branch', () => {
    for (const testCase of [
      {
        name: 'dual legacy evidence sources',
        packRef: 'magic-item:necklace-of-fireballs',
        reason: 'multiple legacy mechanics sources',
        arrange(s: ReturnType<typeof setup>) {
          insertLegacy(s, {
            properties: {
              material: 'silver',
              mechanics: { economies: { charges: { remaining: 2 } } },
            },
          });
          s.db
            .prepare(
              `INSERT INTO item_state(
                 inventory_id, state_json, provenance, session_id, updated_at
               ) VALUES ('legacy-item', ?, 'test:legacy', 'session-1', ?)`,
            )
            .run(
              JSON.stringify({
                packRef: 'magic-item:necklace-of-fireballs',
                economies: { charges: { remaining: 3 } },
              }),
              AT,
            );
        },
      },
      {
        name: 'invalid persisted JSON',
        packRef: 'magic-item:necklace-of-fireballs',
        reason: 'not valid JSON',
        arrange(s: ReturnType<typeof setup>) {
          insertLegacy(s);
          s.db
            .prepare(
              `INSERT INTO item_state(
                 inventory_id, state_json, provenance, session_id, updated_at
               ) VALUES ('legacy-item', '{', 'test:legacy', 'session-1', ?)`,
            )
            .run(AT);
        },
      },
      {
        name: 'state on a stateless target',
        packRef: 'magic-item:potion-of-healing',
        reason: 'stateless and cannot license legacy mechanics',
        arrange(s: ReturnType<typeof setup>) {
          insertLegacy(s, {
            properties: {
              material: 'silver',
              mechanics: { legacyDose: { remaining: 1 } },
            },
          });
        },
      },
    ]) {
      const s = setup();
      testCase.arrange(s);
      const registry = createDefaultToolRegistry();
      expect(
        registry.invoke(
          'adopt_item',
          { id: 'legacy-item', packRef: testCase.packRef },
          s.ctx,
        ),
        testCase.name,
      ).toMatchObject({
        ok: true,
        data: {
          adopted: false,
          reviewRequired: true,
          reviewKind: 'malformed-evidence',
          requiredResolutionAction: 'discard-evidence',
          reason: expect.stringContaining(testCase.reason),
        },
      });
      expect(
        registry.invoke(
          'adopt_item',
          {
            id: 'legacy-item',
            packRef: testCase.packRef,
            resolution: {
              action: 'discard-evidence',
              evidence: `The GM discarded ${testCase.name}.`,
            },
          },
          s.ctx,
        ),
        testCase.name,
      ).toMatchObject({ ok: true, data: { adopted: true } });
      expect(
        adoptionReview(s.db, 'legacy-item'),
        testCase.name,
      ).toBeUndefined();
      expect(
        s.db
          .prepare(
            "SELECT action FROM inventory_adoption_resolution WHERE inventory_id='legacy-item'",
          )
          .get(),
        testCase.name,
      ).toEqual({ action: 'discard-evidence' });
      s.db.close();
    }
  });

  it('flags and preserves a legacy item usage counter instead of creating dual spend owners', () => {
    const s = setup();
    insertLegacy(s, {
      quantity: 2,
      properties: {
        material: 'silver',
        mechanics: { economies: { charges: { remaining: 2 } } },
      },
    });
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
        reviewKind: 'legacy-counter',
        requiredResolutionAction: 'discard-legacy-counter',
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
    expect(adoptionReview(s.db, 'legacy-item')).toMatchObject({
      reason: expect.stringContaining('usage counter'),
    });
    const registry = createDefaultToolRegistry();
    for (const [tool, args] of [
      ['spend_usage', { itemId: 'legacy-item' }],
      ['restore_usage', { itemId: 'legacy-item', amount: 1 }],
    ] as const)
      expect(registry.invoke(tool, args, s.ctx)).toMatchObject({
        ok: false,
        message: expect.stringContaining('quarantined for GM adoption review'),
      });
    expect(
      registry.invoke('reset_usage', { event: 'dawn' }, s.ctx),
    ).toMatchObject({ ok: true, data: { reset: [], needsRolledRestore: [] } });
    expect(
      s.db
        .prepare(
          "SELECT uses_used FROM entity_usage_counter WHERE owner_kind='item' AND owner_ref='legacy-item'",
        )
        .get(),
    ).toEqual({ uses_used: 2 });
    const context = renderContextMessage(
      assembleContext({
        db: s.db,
        campaignId: 'campaign-1',
        sessionId: 'session-1',
        playerInput: 'Inspect the quarantined item.',
      }),
    );
    expect(context).not.toContain('Legacy charges');

    expect(
      registry.invoke(
        'adopt_item',
        {
          id: 'legacy-item',
          packRef: 'magic-item:wand-of-fireballs',
          resolution: {
            action: 'discard-legacy-counter',
            evidence: 'Attempted identity substitution.',
          },
        },
        s.ctx,
      ),
    ).toMatchObject({
      ok: false,
      message: expect.stringContaining(
        "quarantined for exact identity 'magic-item:necklace-of-fireballs'",
      ),
    });
    expect(
      registry.invoke(
        'adopt_item',
        {
          id: 'legacy-item',
          packRef: 'magic-item:necklace-of-fireballs',
          resolution: {
            action: 'discard-legacy-counter',
            evidence: 'Quantity must not accompany this action.',
            quantity: 1,
          },
        },
        s.ctx,
      ),
    ).toMatchObject({
      ok: false,
      message: expect.stringContaining(
        'quantity is valid only for set-reviewed-quantity',
      ),
    });

    expect(
      registry.invoke(
        'adopt_item',
        {
          id: 'legacy-item',
          packRef: 'magic-item:necklace-of-fireballs',
          resolution: {
            action: 'discard-evidence',
            evidence: 'Wrong structural action.',
          },
        },
        s.ctx,
      ),
    ).toMatchObject({
      ok: false,
      message: expect.stringContaining(
        "review kind 'legacy-counter' requires resolution action 'discard-legacy-counter'",
      ),
    });
    expect(adoptionReview(s.db, 'legacy-item')).toMatchObject({
      review_kind: 'legacy-counter',
    });
    expect(
      s.db
        .prepare(
          "SELECT uses_used FROM entity_usage_counter WHERE owner_kind='item' AND owner_ref='legacy-item'",
        )
        .get(),
    ).toEqual({ uses_used: 2 });

    expect(
      registry.invoke(
        'adopt_item',
        {
          id: 'legacy-item',
          packRef: 'magic-item:necklace-of-fireballs',
          resolution: {
            action: 'discard-legacy-counter',
            evidence: 'The GM ruled the ad-hoc charge ledger noncanonical.',
          },
        },
        s.ctx,
      ),
    ).toMatchObject({
      ok: true,
      data: { adopted: true, liftedLegacyState: true },
    });
    expect(adoptionReview(s.db, 'legacy-item')).toBeUndefined();
    expect(
      s.db
        .prepare(
          "SELECT 1 FROM entity_usage_counter WHERE owner_kind='item' AND owner_ref='legacy-item'",
        )
        .get(),
    ).toBeUndefined();
    const resolution = s.db
      .prepare(
        `SELECT action, evidence, discarded_structure_json
         FROM inventory_adoption_resolution WHERE inventory_id='legacy-item'`,
      )
      .get() as {
      action: string;
      evidence: string;
      discarded_structure_json: string;
    };
    expect(resolution).toMatchObject({
      action: 'discard-legacy-counter',
      evidence: 'The GM ruled the ad-hoc charge ledger noncanonical.',
    });
    expect(resolution.discarded_structure_json).toContain('Legacy charges');
    expect(
      JSON.parse(
        (
          s.db
            .prepare(
              "SELECT state_json FROM item_state WHERE inventory_id='legacy-item'",
            )
            .get() as { state_json: string }
        ).state_json,
      ),
    ).toMatchObject({
      packRef: 'magic-item:necklace-of-fireballs',
      economies: { charges: { remaining: 2 } },
    });
    expect(
      registry.invoke(
        'remove_item',
        { id: 'legacy-item', disposition: 'destroyed' },
        s.ctx,
      ),
    ).toMatchObject({ ok: true });
    expect(
      s.db
        .prepare(
          "SELECT action FROM inventory_adoption_resolution WHERE inventory_id='legacy-item'",
        )
        .get(),
    ).toEqual({ action: 'discard-legacy-counter' });
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
  ])(
    'quarantines %s properties and keeps assembled context readable',
    (_case, rawProperties, expectedMessage) => {
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
        ok: true,
        data: {
          adopted: false,
          reviewRequired: true,
          reason: expect.stringContaining(expectedMessage),
        },
      });
      expect(
        s.db
          .prepare(
            'SELECT quantity, pack_ref, properties_json FROM inventory WHERE id=?',
          )
          .get('legacy-item'),
      ).toEqual({
        quantity: 1,
        pack_ref: null,
        properties_json: '{}',
      });
      expect(adoptionReview(s.db, 'legacy-item')).toMatchObject({
        raw_properties_json: rawProperties,
        reason: expect.stringContaining(expectedMessage),
      });
      expect(
        s.db
          .prepare('SELECT 1 FROM item_state WHERE inventory_id=?')
          .get('legacy-item'),
      ).toBeUndefined();
      const rendered = renderContextMessage(
        assembleContext({
          db: s.db,
          campaignId: 'campaign-1',
          sessionId: 'session-1',
          playerInput: 'Inspect the legacy item.',
        }),
      );
      expect(rendered).toContain('adoption=gm-review-required');
      expect(rendered).toContain(expectedMessage);
      expect(rendered).not.toContain(rawProperties);
      expect(
        createDefaultToolRegistry().invoke(
          'adopt_item',
          {
            id: 'legacy-item',
            packRef: 'magic-item:necklace-of-fireballs',
            resolution: {
              action: 'discard-evidence',
              evidence: 'The GM discarded the malformed legacy projection.',
            },
          },
          s.ctx,
        ),
      ).toMatchObject({ ok: true, data: { adopted: true } });
      expect(adoptionReview(s.db, 'legacy-item')).toBeUndefined();
    },
  );

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
