import { describe, expect, it } from 'vitest';
import {
  addCondition,
  adjustHp,
  claimItem,
  donItem,
  ensureCharacterRow,
  giveItem,
  initSchema,
  listRecoverableItems,
  MutateStateError,
  mutateState,
  openDatabase,
  reacquireItem,
  readStateSnapshot,
  removeCondition,
  removeItem,
  setActiveCharacterId,
  setPlotFlag,
  setWorldFact,
  updateClock,
} from '../src/internal.js';

const CTX = {
  provenance: 'test:domain',
  sessionId: 'session-1',
  at: '2026-05-26T00:00:00.000Z',
};

function freshDb() {
  const db = openDatabase(':memory:');
  initSchema(db);
  return db;
}

describe('adjustHp', () => {
  it('heals within bounds', () => {
    const db = freshDb();
    mutateState(db, {
      target: 'character',
      field: 'hp_max',
      op: 'set',
      value: 20,
      ...CTX,
    });
    mutateState(db, {
      target: 'character',
      field: 'hp_current',
      op: 'set',
      value: 10,
      ...CTX,
    });

    const result = adjustHp(db, 5, CTX);

    expect(result).toMatchObject({
      previousHp: 10,
      newHp: 15,
      hpMax: 20,
      clamped: false,
      lifeState: 'alive',
    });
    db.close();
  });

  it('clamps healing to hp_max', () => {
    const db = freshDb();
    mutateState(db, {
      target: 'character',
      field: 'hp_max',
      op: 'set',
      value: 20,
      ...CTX,
    });
    mutateState(db, {
      target: 'character',
      field: 'hp_current',
      op: 'set',
      value: 18,
      ...CTX,
    });

    const result = adjustHp(db, 10, CTX);

    expect(result).toMatchObject({
      previousHp: 18,
      newHp: 20,
      hpMax: 20,
      clamped: true,
      lifeState: 'alive',
    });
    db.close();
  });

  it('clamps damage to zero', () => {
    const db = freshDb();
    mutateState(db, {
      target: 'character',
      field: 'hp_max',
      op: 'set',
      value: 20,
      ...CTX,
    });
    mutateState(db, {
      target: 'character',
      field: 'hp_current',
      op: 'set',
      value: 3,
      ...CTX,
    });

    const result = adjustHp(db, -10, CTX);

    expect(result).toMatchObject({
      previousHp: 3,
      newHp: 0,
      hpMax: 20,
      clamped: true,
      overflow: 7,
      lifeState: 'dying',
    });
    db.close();
  });

  it('rejects non-integer amount', () => {
    const db = freshDb();
    expect(() => adjustHp(db, 1.5, CTX)).toThrow(MutateStateError);
    db.close();
  });
});

describe('addCondition / removeCondition', () => {
  it('adds a condition with extra fields', () => {
    const db = freshDb();

    const result = addCondition(
      db,
      { id: 'poisoned', severity: 'moderate', duration: '3 rounds' },
      CTX,
    );

    expect(result.added).toBe(true);
    expect(result.conditions).toEqual([
      { id: 'poisoned', severity: 'moderate', duration: '3 rounds' },
    ]);
    db.close();
  });

  it('is idempotent when adding a duplicate', () => {
    const db = freshDb();
    addCondition(db, { id: 'poisoned' }, CTX);

    const result = addCondition(db, { id: 'poisoned' }, CTX);

    expect(result.added).toBe(false);
    expect(result.conditions).toHaveLength(1);
    db.close();
  });

  it('removes a condition', () => {
    const db = freshDb();
    addCondition(db, { id: 'poisoned' }, CTX);
    addCondition(db, { id: 'frightened' }, CTX);

    const result = removeCondition(db, 'poisoned', CTX);

    expect(result.removed).toBe(true);
    expect(result.conditions).toEqual([{ id: 'frightened' }]);
    db.close();
  });

  it('no-ops when removing a non-existent condition', () => {
    const db = freshDb();

    const result = removeCondition(db, 'stunned', CTX);

    expect(result.removed).toBe(false);
    db.close();
  });

  it('rejects empty condition id', () => {
    const db = freshDb();
    expect(() => addCondition(db, { id: '' }, CTX)).toThrow(MutateStateError);
    expect(() => removeCondition(db, '', CTX)).toThrow(MutateStateError);
    db.close();
  });
});

describe('giveItem', () => {
  it('updates only the target holder and routes custody changes to their owners', () => {
    const db = freshDb();
    ensureCharacterRow(db, 'pc-2', 'test', CTX.sessionId, CTX.at);
    giveItem(db, { id: 'torch', name: 'Torch', quantity: 1 }, CTX);

    expect(() =>
      giveItem(
        db,
        { id: 'torch', name: 'Stolen Torch', quantity: 9 },
        { ...CTX, characterId: 'pc-2' },
      ),
    ).toThrow(/transfer_item/);
    updateClock(db, { locationId: 'gatehouse' }, CTX);
    removeItem(db, { itemId: 'torch', disposition: 'dropped' }, CTX);
    expect(() =>
      giveItem(
        db,
        { id: 'torch', name: 'Recreated Torch', quantity: 9 },
        { ...CTX, characterId: 'pc-2' },
      ),
    ).toThrow(/claim_item/);
    expect(
      db
        .prepare(
          'SELECT character_id, name, quantity, location, world_location_id FROM inventory WHERE id=?',
        )
        .get('torch'),
    ).toEqual({
      character_id: null,
      name: 'Torch',
      quantity: 1,
      location: null,
      world_location_id: 'gatehouse',
    });
    db.close();
  });

  it('persists canonical pack variant identity and rejects invalid ids', () => {
    const db = freshDb();
    expect(() =>
      giveItem(
        db,
        {
          id: 'stone',
          name: 'Ioun Stone',
          packRef: 'magic-item:ioun-stone',
          variantId: 'Greater Absorption',
        },
        CTX,
      ),
    ).toThrow(/canonical kebab-case/);
    giveItem(
      db,
      {
        id: 'stone',
        name: 'Ioun Stone',
        packRef: 'magic-item:ioun-stone',
        variantId: 'greater-absorption',
      },
      CTX,
    );
    expect(
      db
        .prepare('SELECT pack_ref, variant_id FROM inventory WHERE id = ?')
        .get('stone'),
    ).toEqual({
      pack_ref: 'magic-item:ioun-stone',
      variant_id: 'greater-absorption',
    });
    db.close();
  });

  it('creates a new inventory item', () => {
    const db = freshDb();

    giveItem(
      db,
      {
        id: 'torch',
        name: 'Torch',
        quantity: 5,
        location: 'backpack',
        properties: { light_radius: 20 },
      },
      CTX,
    );

    const row = db
      .prepare(
        'SELECT id, name, quantity, location, properties_json FROM inventory WHERE id = ?',
      )
      .get('torch') as Record<string, unknown>;
    expect(row).toEqual({
      id: 'torch',
      name: 'Torch',
      quantity: 5,
      location: 'backpack',
      properties_json: '{"light_radius":20}',
    });
    db.close();
  });

  it('defaults quantity to 1', () => {
    const db = freshDb();

    giveItem(db, { id: 'sword', name: 'Longsword' }, CTX);

    const row = db
      .prepare('SELECT quantity FROM inventory WHERE id = ?')
      .get('sword') as { quantity: number };
    expect(row.quantity).toBe(1);
    db.close();
  });

  it('updates an existing item', () => {
    const db = freshDb();
    giveItem(db, { id: 'torch', name: 'Torch', quantity: 3 }, CTX);

    giveItem(db, { id: 'torch', name: 'Torch', quantity: 5 }, CTX);

    const row = db
      .prepare('SELECT quantity FROM inventory WHERE id = ?')
      .get('torch') as { quantity: number };
    expect(row.quantity).toBe(5);
    db.close();
  });

  it('rejects empty item id', () => {
    const db = freshDb();
    expect(() => giveItem(db, { id: '', name: 'Nothing' }, CTX)).toThrow(
      MutateStateError,
    );
    db.close();
  });
});

describe('removeItem', () => {
  it('rolls back every surviving unheld disposition when world placement is unknown', () => {
    const db = freshDb();
    giveItem(
      db,
      { id: 'supplies', name: 'Supplies', quantity: 3, location: 'pack' },
      CTX,
    );
    for (const disposition of ['dropped', 'sold', 'lost'] as const) {
      expect(() =>
        removeItem(db, { itemId: 'supplies', quantity: 1, disposition }, CTX),
      ).toThrow(/concrete current campaign location/);
      expect(
        db
          .prepare(
            'SELECT character_id, quantity, location, world_location_id FROM inventory WHERE id=?',
          )
          .get('supplies'),
      ).toEqual({
        character_id: 'pc-1',
        quantity: 3,
        location: 'pack',
        world_location_id: null,
      });
    }
    for (const legacyLocation of ['', '   ']) {
      db.prepare('UPDATE clock SET current_location_id=? WHERE id=1').run(
        legacyLocation,
      );
      expect(() =>
        removeItem(
          db,
          { itemId: 'supplies', quantity: 1, disposition: 'dropped' },
          CTX,
        ),
      ).toThrow(/concrete current campaign location/);
      expect(
        db.prepare('SELECT quantity FROM inventory WHERE id=?').get('supplies'),
      ).toEqual({ quantity: 3 });
    }
    db.close();
  });

  it('removes entire item when quantity omitted', () => {
    const db = freshDb();
    giveItem(db, { id: 'torch', name: 'Torch', quantity: 5 }, CTX);

    const result = removeItem(
      db,
      { itemId: 'torch', disposition: 'destroyed' },
      CTX,
    );

    expect(result).toEqual({
      disposition: 'destroyed',
      removed: true,
      previousQuantity: 5,
      newQuantity: 0,
    });
    expect(
      db.prepare('SELECT id FROM inventory WHERE id = ?').get('torch'),
    ).toBeUndefined();
    db.close();
  });

  it('atomically releases attunement with item_destroyed evidence when removing an item', () => {
    const db = freshDb();
    giveItem(db, { id: 'ring', name: 'Ring of Protection' }, CTX);
    db.prepare(
      `INSERT INTO attunement(
         campaign_id, character_id, item_id, item_key, display_name,
         attuned_at, provenance, session_id, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      'campaign-1',
      'pc-1',
      'ring',
      'magic-item:ring-of-protection',
      'Ring of Protection',
      CTX.at,
      CTX.provenance,
      CTX.sessionId,
      CTX.at,
    );

    const result = removeItem(
      db,
      { itemId: 'ring', disposition: 'destroyed' },
      CTX,
    );

    expect(result.attunementsEnded).toEqual([
      {
        ended: {
          characterId: 'pc-1',
          itemId: 'ring',
          itemKey: 'magic-item:ring-of-protection',
          displayName: 'Ring of Protection',
          attunedAt: CTX.at,
        },
        reason: 'item_destroyed',
        provenance: CTX.provenance,
        sessionId: CTX.sessionId,
        endedAt: CTX.at,
      },
    ]);
    expect(
      db.prepare('SELECT 1 FROM attunement WHERE item_id = ?').get('ring'),
    ).toBeUndefined();
    expect(
      db.prepare('SELECT 1 FROM inventory WHERE id = ?').get('ring'),
    ).toBeUndefined();
    db.close();
  });

  it('decrements quantity', () => {
    const db = freshDb();
    giveItem(db, { id: 'torch', name: 'Torch', quantity: 5 }, CTX);

    const result = removeItem(
      db,
      { itemId: 'torch', quantity: 2, disposition: 'destroyed' },
      CTX,
    );

    expect(result).toEqual({
      disposition: 'destroyed',
      removed: false,
      previousQuantity: 5,
      newQuantity: 3,
    });
    db.close();
  });

  it('deletes item when quantity would drop to zero', () => {
    const db = freshDb();
    giveItem(db, { id: 'torch', name: 'Torch', quantity: 2 }, CTX);

    const result = removeItem(
      db,
      { itemId: 'torch', quantity: 5, disposition: 'destroyed' },
      CTX,
    );

    expect(result).toEqual({
      disposition: 'destroyed',
      removed: true,
      previousQuantity: 2,
      newQuantity: 0,
    });
    expect(
      db.prepare('SELECT id FROM inventory WHERE id = ?').get('torch'),
    ).toBeUndefined();
    db.close();
  });

  it('returns removed=false for non-existent item', () => {
    const db = freshDb();

    const result = removeItem(
      db,
      { itemId: 'nonexistent', disposition: 'destroyed' },
      CTX,
    );

    expect(result).toEqual({
      disposition: 'destroyed',
      removed: false,
      previousQuantity: 0,
      newQuantity: 0,
    });
    db.close();
  });

  it('fully relinquishes the same physical row at the world location without ending attunement or losing state', () => {
    const db = freshDb();
    const granted = giveItem(
      db,
      {
        id: 'stone',
        name: 'Ioun Stone',
        packRef: 'magic-item:ioun-stone',
        variantId: 'agility',
        properties: { color: 'deep red' },
        location: 'orbiting',
        stateful: true,
      },
      CTX,
    );
    const stateJson = JSON.stringify({
      packRef: 'magic-item:ioun-stone',
      variantId: 'agility',
      machineState: 'orbiting',
    });
    db.prepare(
      `INSERT INTO item_state(inventory_id, state_json, provenance, session_id, updated_at)
       VALUES (?, ?, ?, ?, ?)`,
    ).run(granted.id, stateJson, CTX.provenance, CTX.sessionId, CTX.at);
    db.prepare(
      `INSERT INTO attunement(
         campaign_id, character_id, item_id, item_key, display_name,
         attuned_at, provenance, session_id, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      'campaign-1',
      'pc-1',
      granted.id,
      'magic-item:ioun-stone#variant:agility',
      'Agility',
      CTX.at,
      CTX.provenance,
      CTX.sessionId,
      CTX.at,
    );
    updateClock(db, { locationId: 'market-square' }, CTX);

    const result = removeItem(
      db,
      { itemId: granted.id, disposition: 'dropped' },
      CTX,
    );

    expect(result).toMatchObject({
      disposition: 'dropped',
      removed: true,
      relinquishedItemId: granted.id,
      previousQuantity: 1,
      newQuantity: 0,
    });
    expect(
      db
        .prepare(
          `SELECT id, character_id, quantity, location, world_location_id,
                  properties_json, pack_ref, variant_id
           FROM inventory WHERE id=?`,
        )
        .get(granted.id),
    ).toEqual({
      id: granted.id,
      character_id: null,
      quantity: 1,
      location: null,
      world_location_id: 'market-square',
      properties_json: JSON.stringify({ color: 'deep red' }),
      pack_ref: 'magic-item:ioun-stone',
      variant_id: 'agility',
    });
    expect(
      db
        .prepare('SELECT state_json FROM item_state WHERE inventory_id=?')
        .get(granted.id),
    ).toEqual({ state_json: stateJson });
    expect(
      db
        .prepare('SELECT item_id FROM attunement WHERE item_id=?')
        .get(granted.id),
    ).toEqual({ item_id: granted.id });
    db.close();
  });

  it('blocks only source-declared active curse custody constraints', () => {
    const db = freshDb();
    updateClock(db, { locationId: 'market-square' }, CTX);
    const axe = giveItem(
      db,
      {
        id: 'berserker-axe',
        name: 'Berserker Axe',
        packRef: 'magic-item:berserker-axe',
        location: 'carried',
        stateful: true,
      },
      CTX,
    );
    db.prepare(
      `INSERT INTO attunement(
         campaign_id, character_id, item_id, item_key, display_name,
         attuned_at, provenance, session_id, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      'campaign-1',
      'pc-1',
      axe.id,
      'magic-item:berserker-axe',
      'Berserker Axe',
      CTX.at,
      CTX.provenance,
      CTX.sessionId,
      CTX.at,
    );

    for (const disposition of ['dropped', 'sold'] as const) {
      expect(() =>
        removeItem(db, { itemId: axe.id, disposition }, CTX),
      ).toThrow(/prevents voluntary relinquishment/);
    }
    expect(
      db.prepare('SELECT character_id FROM inventory WHERE id=?').get(axe.id),
    ).toEqual({ character_id: 'pc-1' });
    expect(
      removeItem(db, { itemId: axe.id, disposition: 'lost' }, CTX),
    ).toMatchObject({ disposition: 'lost', removed: true });
    ensureCharacterRow(db, 'pc-2', 'test', CTX.sessionId, CTX.at);
    const secondHolder = { ...CTX, characterId: 'pc-2' };
    expect(() => claimItem(db, axe.id, secondHolder)).toThrow(
      /not a generally claimable drop/,
    );
    expect(
      db
        .prepare('SELECT character_id FROM attunement WHERE item_id=?')
        .get(axe.id),
    ).toEqual({ character_id: 'pc-1' });
    expect(() =>
      removeItem(
        db,
        { itemId: axe.id, disposition: 'destroyed' },
        secondHolder,
      ),
    ).toThrow(/not under the acting character's custody/);

    const unattuned = giveItem(
      db,
      {
        id: 'unattuned-axe',
        name: 'Berserker Axe',
        packRef: 'magic-item:berserker-axe',
        stateful: true,
      },
      CTX,
    );
    expect(
      removeItem(db, { itemId: unattuned.id, disposition: 'dropped' }, CTX),
    ).toMatchObject({ disposition: 'dropped', removed: true });

    const oathbow = giveItem(
      db,
      {
        id: 'oathbow',
        name: 'Oathbow',
        packRef: 'magic-item:oathbow',
        stateful: true,
      },
      CTX,
    );
    expect(
      removeItem(db, { itemId: oathbow.id, disposition: 'sold' }, CTX),
    ).toMatchObject({ disposition: 'sold', removed: true });
    db.close();
  });

  it('fails closed for every surviving Demon Armor custody change without authoritative don/doff state', () => {
    const db = freshDb();
    updateClock(db, { locationId: 'market-square' }, CTX);
    for (const [index, location, disposition] of [
      [1, null, 'dropped'],
      [2, 'backpack', 'sold'],
      [3, 'equipped', 'lost'],
    ] as const) {
      const armor = giveItem(
        db,
        {
          id: `demon-armor-${index}`,
          name: 'Demon Armor',
          packRef: 'magic-item:demon-armor',
          location,
          stateful: true,
        },
        CTX,
      );
      donItem(db, { ...CTX, itemId: armor.id });
      expect(() =>
        removeItem(db, { itemId: armor.id, disposition }, CTX),
      ).toThrow(/source-declared as impossible to doff/);
    }

    const destroyedArmor = giveItem(
      db,
      {
        id: 'destroyed-demon-armor',
        name: 'Demon Armor',
        packRef: 'magic-item:demon-armor',
        location: 'backpack',
        stateful: true,
      },
      CTX,
    );
    expect(
      removeItem(
        db,
        { itemId: destroyedArmor.id, disposition: 'destroyed' },
        CTX,
      ),
    ).toMatchObject({ disposition: 'destroyed', removed: true });

    const ordinary = giveItem(
      db,
      {
        id: 'ordinary-worn-ring',
        name: 'Ring of Protection',
        packRef: 'magic-item:ring-of-protection',
        location: 'worn',
      },
      CTX,
    );
    expect(
      removeItem(db, { itemId: ordinary.id, disposition: 'dropped' }, CTX),
    ).toMatchObject({ disposition: 'dropped', removed: true });
    db.close();
  });

  it('fails closed when a held blocksDoff item has no wear row', () => {
    const db = freshDb();
    updateClock(db, { locationId: 'market-square' }, CTX);
    const armor = giveItem(
      db,
      {
        id: 'legacy-demon-armor',
        name: 'Demon Armor',
        packRef: 'magic-item:demon-armor',
        stateful: true,
      },
      CTX,
    );
    db.prepare('DELETE FROM inventory_wear_state WHERE inventory_id=?').run(
      armor.id,
    );

    for (const disposition of ['dropped', 'sold', 'lost'] as const) {
      expect(() =>
        removeItem(db, { itemId: armor.id, disposition }, CTX),
      ).toThrow(/source-declared as impossible to doff/);
    }
    db.close();
  });

  it('splits partial relinquishment into collision-safe unheld physical rows with conserved identity', () => {
    const db = freshDb();
    giveItem(
      db,
      {
        id: 'arrows',
        name: 'Silvered Arrow',
        quantity: 5,
        location: 'quiver',
        properties: { silvered: true },
        packRef: 'magic-item:bead-of-force',
      },
      CTX,
    );
    updateClock(db, { locationId: 'forest-road' }, CTX);
    const first = removeItem(
      db,
      { itemId: 'arrows', quantity: 1, disposition: 'sold' },
      CTX,
    );
    const second = removeItem(
      db,
      { itemId: 'arrows', quantity: 1, disposition: 'sold' },
      CTX,
    );
    expect(first.relinquishedItemId).toBe('arrows#sold-1');
    expect(second.relinquishedItemId).toBe('arrows#sold-2');
    const rows = db
      .prepare(
        `SELECT id, character_id, quantity, location, world_location_id,
                properties_json, pack_ref, variant_id
         FROM inventory WHERE id LIKE 'arrows%' ORDER BY id`,
      )
      .all() as {
      id: string;
      character_id: string | null;
      quantity: number;
      location: string | null;
      world_location_id: string | null;
      properties_json: string;
      pack_ref: string;
      variant_id: string | null;
    }[];
    expect(
      rows.map(({ id, character_id, quantity }) => ({
        id,
        character_id,
        quantity,
      })),
    ).toEqual([
      { id: 'arrows', character_id: 'pc-1', quantity: 3 },
      { id: 'arrows#sold-1', character_id: null, quantity: 1 },
      { id: 'arrows#sold-2', character_id: null, quantity: 1 },
    ]);
    expect(rows.reduce((sum, row) => sum + row.quantity, 0)).toBe(5);
    for (const row of rows) {
      expect(row).toMatchObject({
        location: row.character_id === null ? null : 'quiver',
        world_location_id: row.character_id === null ? 'forest-road' : null,
        properties_json: JSON.stringify({ silvered: true }),
        pack_ref: 'magic-item:bead-of-force',
        variant_id: null,
      });
    }
    expect(
      db
        .prepare(
          `SELECT wear.inventory_id
           FROM inventory_wear_state AS wear
           LEFT JOIN inventory AS item ON item.id=wear.inventory_id
           WHERE item.id IS NULL OR item.character_id IS NULL
              OR item.character_id <> wear.character_id`,
        )
        .all(),
    ).toEqual([]);

    const dropped = removeItem(
      db,
      { itemId: 'arrows', quantity: 1, disposition: 'dropped' },
      CTX,
    );
    expect(
      claimItem(db, dropped.relinquishedItemId as string, CTX),
    ).toMatchObject({
      itemId: dropped.relinquishedItemId,
      characterId: 'pc-1',
    });
    expect(() =>
      reacquireItem(
        db,
        {
          itemId: first.relinquishedItemId as string,
          basis: 'returned',
          evidence: 'The sold arrow bundle was returned at the market.',
        },
        CTX,
      ),
    ).toThrow(/repurchased.*atomic payment/);
    expect(
      db
        .prepare(
          `SELECT wear.inventory_id
           FROM inventory_wear_state AS wear
           LEFT JOIN inventory AS item ON item.id=wear.inventory_id
           WHERE item.id IS NULL OR item.character_id IS NULL
              OR item.character_id <> wear.character_id`,
        )
        .all(),
    ).toEqual([]);
    db.close();
  });

  it('refuses partial copying of item state and refuses unheld removal', () => {
    const db = freshDb();
    giveItem(db, { id: 'stateful-stack', name: 'Stateful', quantity: 2 }, CTX);
    db.prepare(
      `INSERT INTO item_state(inventory_id, state_json, provenance, session_id, updated_at)
       VALUES (?, '{}', ?, ?, ?)`,
    ).run('stateful-stack', CTX.provenance, CTX.sessionId, CTX.at);
    expect(() =>
      removeItem(
        db,
        { itemId: 'stateful-stack', quantity: 1, disposition: 'lost' },
        CTX,
      ),
    ).toThrow(/cannot be partially disposed/);
    expect(() =>
      removeItem(
        db,
        {
          itemId: 'stateful-stack',
          quantity: 1,
          disposition: 'destroyed',
        },
        CTX,
      ),
    ).toThrow(/cannot be partially disposed/);
    giveItem(db, { id: 'counter-stack', name: 'Counter', quantity: 2 }, CTX);
    db.prepare(
      `INSERT INTO entity_usage_counter(
         campaign_id, owner_kind, owner_ref, counter_key, display_name,
         uses_max, uses_used, reset_kind, source, provenance, session_id,
         updated_at
       ) VALUES (?, 'item', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      'campaign-1',
      'counter-stack',
      'charges',
      'Charges',
      3,
      1,
      'dawn',
      'record',
      CTX.provenance,
      CTX.sessionId,
      CTX.at,
    );
    expect(() =>
      removeItem(
        db,
        { itemId: 'counter-stack', quantity: 1, disposition: 'sold' },
        CTX,
      ),
    ).toThrow(/cannot be partially disposed/);
    updateClock(db, { locationId: 'storehouse' }, CTX);
    removeItem(db, { itemId: 'counter-stack', disposition: 'sold' }, CTX);
    expect(
      db
        .prepare(
          `SELECT inventory.character_id, entity_usage_counter.uses_used
           FROM inventory
           JOIN entity_usage_counter
             ON entity_usage_counter.owner_kind='item'
            AND entity_usage_counter.owner_ref=inventory.id
           WHERE inventory.id=?`,
        )
        .get('counter-stack'),
    ).toEqual({ character_id: null, uses_used: 1 });
    giveItem(db, { id: 'attuned-stack', name: 'Attuned', quantity: 2 }, CTX);
    db.prepare(
      `INSERT INTO attunement(
         campaign_id, character_id, item_id, item_key, display_name,
         attuned_at, provenance, session_id, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      'campaign-1',
      'pc-1',
      'attuned-stack',
      'name:attuned',
      'Attuned',
      CTX.at,
      CTX.provenance,
      CTX.sessionId,
      CTX.at,
    );
    expect(() =>
      removeItem(
        db,
        { itemId: 'attuned-stack', quantity: 1, disposition: 'dropped' },
        CTX,
      ),
    ).toThrow(/cannot be partially disposed/);
    expect(
      db
        .prepare('SELECT quantity FROM inventory WHERE id=?')
        .get('attuned-stack'),
    ).toEqual({ quantity: 2 });
    expect(
      db
        .prepare('SELECT quantity FROM inventory WHERE id=?')
        .get('stateful-stack'),
    ).toEqual({ quantity: 2 });

    removeItem(db, { itemId: 'stateful-stack', disposition: 'lost' }, CTX);
    expect(() =>
      removeItem(db, { itemId: 'stateful-stack', disposition: 'dropped' }, CTX),
    ).toThrow(/is unheld/);
    db.close();
  });

  it('destroys a dropped physical row and atomically releases its retained attunement', () => {
    const db = freshDb();
    giveItem(db, { id: 'ring', name: 'Ring of Protection' }, CTX);
    db.prepare(
      `INSERT INTO attunement(
         campaign_id, character_id, item_id, item_key, display_name,
         attuned_at, provenance, session_id, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      'campaign-1',
      'pc-1',
      'ring',
      'magic-item:ring-of-protection',
      'Ring of Protection',
      CTX.at,
      CTX.provenance,
      CTX.sessionId,
      CTX.at,
    );
    for (const ownerKind of ['item', 'character'])
      db.prepare(
        `INSERT INTO entity_usage_counter(
           campaign_id, owner_kind, owner_ref, counter_key, display_name,
           uses_max, uses_used, reset_kind, source, provenance, session_id,
           updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        'campaign-1',
        ownerKind,
        'ring',
        'charges',
        'Charges',
        3,
        1,
        'dawn',
        'record',
        CTX.provenance,
        CTX.sessionId,
        CTX.at,
      );
    updateClock(db, { locationId: 'vault' }, CTX);
    removeItem(db, { itemId: 'ring', disposition: 'dropped' }, CTX);

    const destroyed = removeItem(
      db,
      { itemId: 'ring', disposition: 'destroyed' },
      CTX,
    );

    expect(destroyed).toMatchObject({
      disposition: 'destroyed',
      removed: true,
      attunementsEnded: [
        {
          reason: 'item_destroyed',
          ended: { itemId: 'ring' },
        },
      ],
    });
    expect(
      db.prepare('SELECT 1 FROM inventory WHERE id=?').get('ring'),
    ).toBeUndefined();
    expect(
      db.prepare('SELECT 1 FROM attunement WHERE item_id=?').get('ring'),
    ).toBeUndefined();
    expect(
      db
        .prepare(
          `SELECT owner_kind FROM entity_usage_counter
           WHERE owner_ref=? ORDER BY owner_kind`,
        )
        .all('ring'),
    ).toEqual([{ owner_kind: 'character' }]);
    db.close();
  });

  it('partially destroys a dropped unheld stateless stack in place', () => {
    const db = freshDb();
    giveItem(db, { id: 'firewood', name: 'Firewood', quantity: 5 }, CTX);
    updateClock(db, { locationId: 'camp' }, CTX);
    removeItem(db, { itemId: 'firewood', disposition: 'dropped' }, CTX);

    expect(
      removeItem(
        db,
        { itemId: 'firewood', quantity: 2, disposition: 'destroyed' },
        CTX,
      ),
    ).toEqual({
      disposition: 'destroyed',
      removed: false,
      previousQuantity: 5,
      newQuantity: 3,
    });
    expect(
      db
        .prepare('SELECT character_id, quantity FROM inventory WHERE id=?')
        .get('firewood'),
    ).toEqual({ character_id: null, quantity: 3 });
    db.close();
  });

  it('preserves sold and lost custody without making either row claimable or seller-controlled', () => {
    const db = freshDb();
    updateClock(db, { locationId: 'market' }, CTX);
    for (const disposition of ['sold', 'lost'] as const) {
      const itemId = `${disposition}-relic`;
      giveItem(db, { id: itemId, name: `${disposition} relic` }, CTX);
      removeItem(db, { itemId, disposition }, CTX);
      expect(
        db
          .prepare(
            `SELECT character_id, world_location_id, unheld_disposition
             FROM inventory WHERE id=?`,
          )
          .get(itemId),
      ).toEqual({
        character_id: null,
        world_location_id: 'market',
        unheld_disposition: disposition,
      });
      expect(() => claimItem(db, itemId, CTX)).toThrow(
        /not a generally claimable drop/,
      );
      expect(() =>
        giveItem(db, { id: itemId, name: 'Re-granted relic' }, CTX),
      ).toThrow(/not available to give or claim/);
      expect(() =>
        removeItem(db, { itemId, disposition: 'destroyed' }, CTX),
      ).toThrow(/not under the acting character's custody/);
      expect(
        listRecoverableItems(db, disposition === 'sold' ? 'returned' : 'found')
          .items,
      ).toEqual(
        disposition === 'sold'
          ? []
          : [
              expect.objectContaining({
                itemId,
                disposition,
                worldLocationId: 'market',
              }),
            ],
      );
      if (disposition === 'sold') {
        expect(() =>
          reacquireItem(
            db,
            {
              itemId,
              basis: 'returned',
              evidence: 'The merchant returned the sold relic.',
            },
            CTX,
          ),
        ).toThrow(/repurchased.*atomic payment/);
      } else {
        expect(
          reacquireItem(
            db,
            {
              itemId,
              basis: 'returned',
              evidence:
                'The counterparty returned the lost relic in the market scene.',
            },
            CTX,
          ),
        ).toMatchObject({
          itemId,
          previousDisposition: disposition,
          characterId: 'pc-1',
        });
      }
      if (disposition === 'sold') continue;
      expect(
        db
          .prepare(
            `SELECT from_disposition, basis, evidence
             FROM inventory_custody_event WHERE inventory_id=?`,
          )
          .get(itemId),
      ).toEqual({
        from_disposition: disposition,
        basis: 'returned',
        evidence:
          'The counterparty returned the lost relic in the market scene.',
      });
    }
    db.close();
  });

  it('reacquires the exact sold row without resetting state or attunement', () => {
    const db = freshDb();
    updateClock(db, { locationId: 'market' }, CTX);
    const returning = giveItem(
      db,
      {
        id: 'returning-orb',
        name: 'Returning Orb',
        packRef: 'magic-item:crystal-ball',
        variantId: 'crystal-ball-of-telepathy',
        stateful: true,
      },
      CTX,
    );
    db.prepare(
      `INSERT INTO item_state(
         inventory_id, state_json, provenance, session_id, updated_at
       ) VALUES (?, ?, 'test', 'session-1', ?)`,
    ).run(
      returning.id,
      JSON.stringify({
        packRef: 'magic-item:crystal-ball',
        variantId: 'crystal-ball-of-telepathy',
        custom: { scar: 'unchanged' },
      }),
      CTX.at,
    );
    db.prepare(
      `INSERT INTO attunement(
         campaign_id, character_id, item_id, item_key, display_name,
         attuned_at, provenance, session_id, updated_at
       ) VALUES ('campaign-1', 'pc-1', ?,
                 'magic-item:crystal-ball', 'Returning Orb', ?, 'test',
                 'session-1', ?)`,
    ).run(returning.id, CTX.at, CTX.at);
    removeItem(db, { itemId: returning.id, disposition: 'sold' }, CTX);

    expect(() =>
      reacquireItem(
        db,
        {
          itemId: returning.id,
          basis: 'returned',
          evidence: 'The merchant rescinded the sale and handed it back.',
        },
        CTX,
      ),
    ).toThrow(/repurchased.*atomic payment/);
    expect(
      db
        .prepare('SELECT state_json FROM item_state WHERE inventory_id=?')
        .get(returning.id),
    ).toEqual({
      state_json: JSON.stringify({
        packRef: 'magic-item:crystal-ball',
        variantId: 'crystal-ball-of-telepathy',
        custom: { scar: 'unchanged' },
      }),
    });
    expect(
      db
        .prepare('SELECT character_id FROM attunement WHERE item_id=?')
        .get(returning.id),
    ).toEqual({ character_id: 'pc-1' });
    db.close();
  });

  it('claims an unheld row without changing identity or item state and refuses held rows', () => {
    const db = freshDb();
    giveItem(
      db,
      {
        id: 'relic',
        name: 'Ioun Stone',
        packRef: 'magic-item:ioun-stone',
        variantId: 'agility',
      },
      CTX,
    );
    db.prepare(
      `INSERT INTO item_state(inventory_id, state_json, provenance, session_id, updated_at)
       VALUES (?, '{"custom":{"mark":1}}', ?, ?, ?)`,
    ).run('relic', CTX.provenance, CTX.sessionId, CTX.at);
    updateClock(db, { locationId: 'ruined-shrine' }, CTX);
    removeItem(db, { itemId: 'relic', disposition: 'dropped' }, CTX);

    expect(claimItem(db, 'relic', CTX)).toMatchObject({
      itemId: 'relic',
      characterId: 'pc-1',
      name: 'Ioun Stone',
      quantity: 1,
      packRef: 'magic-item:ioun-stone',
      variantId: 'agility',
    });
    expect(
      db
        .prepare('SELECT state_json FROM item_state WHERE inventory_id=?')
        .get('relic'),
    ).toEqual({ state_json: '{"custom":{"mark":1}}' });
    expect(
      db
        .prepare('SELECT id, pack_ref, variant_id FROM inventory WHERE id=?')
        .get('relic'),
    ).toEqual({
      id: 'relic',
      pack_ref: 'magic-item:ioun-stone',
      variant_id: 'agility',
    });
    expect(
      db
        .prepare('SELECT location, world_location_id FROM inventory WHERE id=?')
        .get('relic'),
    ).toEqual({ location: null, world_location_id: null });
    expect(() => claimItem(db, 'relic', CTX)).toThrow(/already held/);
    db.close();
  });

  it('rejects remote or unknown-location claim and destruction', () => {
    const db = freshDb();
    updateClock(db, { locationId: 'north-gate' }, CTX);
    giveItem(db, { id: 'crate', name: 'Crate' }, CTX);
    removeItem(db, { itemId: 'crate', disposition: 'dropped' }, CTX);
    updateClock(db, { locationId: 'south-gate' }, CTX);

    expect(() => claimItem(db, 'crate', CTX)).toThrow(/co-location/);
    expect(() =>
      removeItem(db, { itemId: 'crate', disposition: 'destroyed' }, CTX),
    ).toThrow(/co-location/);
    updateClock(db, { locationId: null }, CTX);
    expect(() => claimItem(db, 'crate', CTX)).toThrow(
      /concrete current campaign location/,
    );
    expect(
      db
        .prepare(
          'SELECT character_id, world_location_id FROM inventory WHERE id=?',
        )
        .get('crate'),
    ).toEqual({ character_id: null, world_location_id: 'north-gate' });
    db.exec(
      'DROP TRIGGER inventory_location_insert_guard; DROP TRIGGER inventory_location_update_guard;',
    );
    db.prepare(
      "UPDATE inventory SET world_location_id='   ' WHERE id='crate'",
    ).run();
    db.prepare("UPDATE clock SET current_location_id='   ' WHERE id=1").run();
    expect(() => claimItem(db, 'crate', CTX)).toThrow(
      /concrete current campaign location/,
    );
    expect(() =>
      removeItem(db, { itemId: 'crate', disposition: 'destroyed' }, CTX),
    ).toThrow(/concrete current campaign location/);
    db.close();
  });
});

describe('updateClock', () => {
  it('updates time and location', () => {
    const db = freshDb();

    updateClock(
      db,
      { inGameTime: 'Day 3, dusk', locationId: 'green-hollow' },
      CTX,
    );

    const row = db
      .prepare(
        'SELECT in_game_time, current_location_id FROM clock WHERE id = 1',
      )
      .get() as { in_game_time: string; current_location_id: string };
    expect(row).toEqual({
      in_game_time: 'Day 3, dusk',
      current_location_id: 'green-hollow',
    });
    db.close();
  });

  it('updates only location', () => {
    const db = freshDb();

    updateClock(db, { locationId: 'tavern' }, CTX);

    const row = db
      .prepare('SELECT current_location_id FROM clock WHERE id = 1')
      .get() as { current_location_id: string };
    expect(row.current_location_id).toBe('tavern');
    db.close();
  });

  it('rejects empty update', () => {
    const db = freshDb();
    expect(() => updateClock(db, {}, CTX)).toThrow(MutateStateError);
    for (const locationId of ['', '   ']) {
      expect(() => updateClock(db, { locationId }, CTX)).toThrow(
        /non-whitespace/,
      );
    }
    expect(
      db.prepare('SELECT current_location_id FROM clock WHERE id=1').get(),
    ).toEqual({ current_location_id: null });
    updateClock(db, { locationId: '  north-gate  ' }, CTX);
    expect(
      db.prepare('SELECT current_location_id FROM clock WHERE id=1').get(),
    ).toEqual({ current_location_id: '  north-gate  ' });
    updateClock(db, { locationId: null }, CTX);
    db.close();
  });
});

describe('setPlotFlag', () => {
  it('sets a boolean flag', () => {
    const db = freshDb();

    setPlotFlag(db, 'met_warden', true, CTX);

    const row = db
      .prepare('SELECT value_json FROM plot_flags WHERE key = ?')
      .get('met_warden') as { value_json: string };
    expect(row.value_json).toBe('true');
    db.close();
  });

  it('sets a complex flag value', () => {
    const db = freshDb();

    setPlotFlag(db, 'quest_progress', { step: 3, complete: false }, CTX);

    const row = db
      .prepare('SELECT value_json FROM plot_flags WHERE key = ?')
      .get('quest_progress') as { value_json: string };
    expect(JSON.parse(row.value_json)).toEqual({
      step: 3,
      complete: false,
    });
    db.close();
  });
});

describe('setWorldFact', () => {
  it('sets an overlay fact', () => {
    const db = freshDb();

    setWorldFact(
      db,
      'world:location:green-hollow:name',
      'The Hidden Grove',
      CTX,
    );

    const row = db
      .prepare('SELECT value_json FROM overlay_facts WHERE key = ?')
      .get('world:location:green-hollow:name') as { value_json: string };
    expect(JSON.parse(row.value_json)).toBe('The Hidden Grove');
    db.close();
  });
});

describe('inventory ownership isolation', () => {
  function freshDbWithTwoCharacters() {
    const db = freshDb();
    ensureCharacterRow(db, 'pc-2', 'test:init', 'session-1', CTX.at);
    mutateState(db, {
      target: 'character',
      id: 'pc-2',
      field: 'ability_scores_json',
      op: 'set',
      value: {
        strength: 10,
        dexterity: 10,
        constitution: 10,
        intelligence: 10,
        wisdom: 10,
        charisma: 10,
      },
      ...CTX,
    });
    return db;
  }

  it('giveItem assigns character_id to the active character', () => {
    const db = freshDbWithTwoCharacters();

    giveItem(db, { id: 'sword', name: 'Longsword' }, CTX);

    const row = db
      .prepare('SELECT character_id FROM inventory WHERE id = ?')
      .get('sword') as { character_id: string };
    expect(row.character_id).toBe('pc-1');
    db.close();
  });

  it('giveItem assigns character_id to an explicit target character', () => {
    const db = freshDbWithTwoCharacters();

    giveItem(
      db,
      { id: 'shield', name: 'Shield' },
      { ...CTX, characterId: 'pc-2' },
    );

    const row = db
      .prepare('SELECT character_id FROM inventory WHERE id = ?')
      .get('shield') as { character_id: string };
    expect(row.character_id).toBe('pc-2');
    db.close();
  });

  it('items given to pc-2 do not appear in pc-1 snapshot', () => {
    const db = freshDbWithTwoCharacters();

    giveItem(db, { id: 'torch', name: 'Torch', quantity: 3 }, CTX);
    giveItem(
      db,
      { id: 'potion', name: 'Health Potion' },
      { ...CTX, characterId: 'pc-2' },
    );

    const pc1Snapshot = readStateSnapshot(db, 'pc-1');
    const pc2Snapshot = readStateSnapshot(db, 'pc-2');

    expect(pc1Snapshot.inventory.map((i) => i.id)).toEqual(['torch']);
    expect(pc2Snapshot.inventory.map((i) => i.id)).toEqual(['potion']);
    db.close();
  });

  it('removeItem only affects items owned by the active character', () => {
    const db = freshDbWithTwoCharacters();

    giveItem(db, { id: 'gem', name: 'Ruby' }, CTX);
    giveItem(
      db,
      { id: 'gem2', name: 'Sapphire' },
      { ...CTX, characterId: 'pc-2' },
    );

    setActiveCharacterId(db, 'pc-2');
    expect(() =>
      removeItem(db, { itemId: 'gem', disposition: 'lost' }, CTX),
    ).toThrow(/held by another character/);

    const pc1Row = db
      .prepare('SELECT id FROM inventory WHERE id = ?')
      .get('gem');
    expect(pc1Row).toBeDefined();
    db.close();
  });
});
