import { describe, expect, it } from 'vitest';
import {
  addCondition,
  adjustHp,
  ensureCharacterRow,
  giveItem,
  initSchema,
  MutateStateError,
  mutateState,
  openDatabase,
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
  it('removes entire item when quantity omitted', () => {
    const db = freshDb();
    giveItem(db, { id: 'torch', name: 'Torch', quantity: 5 }, CTX);

    const result = removeItem(db, 'torch', undefined, CTX);

    expect(result).toEqual({
      removed: true,
      previousQuantity: 5,
      newQuantity: 0,
    });
    expect(
      db.prepare('SELECT id FROM inventory WHERE id = ?').get('torch'),
    ).toBeUndefined();
    db.close();
  });

  it('decrements quantity', () => {
    const db = freshDb();
    giveItem(db, { id: 'torch', name: 'Torch', quantity: 5 }, CTX);

    const result = removeItem(db, 'torch', 2, CTX);

    expect(result).toEqual({
      removed: false,
      previousQuantity: 5,
      newQuantity: 3,
    });
    db.close();
  });

  it('deletes item when quantity would drop to zero', () => {
    const db = freshDb();
    giveItem(db, { id: 'torch', name: 'Torch', quantity: 2 }, CTX);

    const result = removeItem(db, 'torch', 5, CTX);

    expect(result).toEqual({
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

    const result = removeItem(db, 'nonexistent', undefined, CTX);

    expect(result).toEqual({
      removed: false,
      previousQuantity: 0,
      newQuantity: 0,
    });
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
    const result = removeItem(db, 'gem', undefined, CTX);

    expect(result.removed).toBe(false);
    expect(result.previousQuantity).toBe(0);

    const pc1Row = db
      .prepare('SELECT id FROM inventory WHERE id = ?')
      .get('gem');
    expect(pc1Row).toBeDefined();
    db.close();
  });
});
