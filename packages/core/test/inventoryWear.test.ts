import { describe, expect, it } from 'vitest';
import {
  doffItem,
  donItem,
  getInventoryWearState,
  giveItem,
  InventoryWearError,
  removeCondition,
} from '../src/internal.js';
import {
  DEFAULT_TEST_CAMPAIGN_ID,
  DEFAULT_TEST_SESSION_ID,
  freshDbWithSession,
} from './support/db.js';

const CTX = {
  provenance: 'test:wear',
  sessionId: DEFAULT_TEST_SESSION_ID,
  at: '2026-07-19T18:00:00.000Z',
  characterId: 'pc-1',
};

describe('inventory wear state', () => {
  it('owns exact don/doff transitions and preserves a curse after doff', () => {
    const db = freshDbWithSession();
    const armor = giveItem(
      db,
      {
        id: 'demon-armor',
        name: 'Demon Armor',
        packRef: 'magic-item:demon-armor',
        stateful: true,
      },
      CTX,
    );
    expect(getInventoryWearState(db, armor.id)).toBe('not_worn');
    expect(donItem(db, { ...CTX, itemId: armor.id })).toMatchObject({
      wearState: 'worn',
    });
    expect(
      db.prepare('SELECT id FROM character WHERE id=?').get('pc-1'),
    ).toBeTruthy();
    expect(() => doffItem(db, { ...CTX, itemId: armor.id })).toThrow(
      InventoryWearError,
    );
    expect(getInventoryWearState(db, armor.id)).toBe('worn');
    db.close();
  });

  it('allows doff after the live don-onset curse condition is removed', () => {
    const db = freshDbWithSession();
    const armor = giveItem(
      db,
      {
        id: 'resolved-demon-armor',
        name: 'Demon Armor',
        packRef: 'magic-item:demon-armor',
        stateful: true,
      },
      CTX,
    );
    donItem(db, { ...CTX, itemId: armor.id });
    expect(() => doffItem(db, { ...CTX, itemId: armor.id })).toThrow(
      InventoryWearError,
    );
    removeCondition(db, 'm7-demon-armor-curse', CTX);
    expect(doffItem(db, { ...CTX, itemId: armor.id })).toMatchObject({
      wearState: 'not_worn',
    });
    expect(
      db.prepare('SELECT character_id FROM inventory WHERE id=?').get(armor.id),
    ).toEqual({ character_id: 'pc-1' });
    db.close();
  });

  it('does not infer legacy placement and fails closed for don', () => {
    const db = freshDbWithSession();
    db.prepare(
      `INSERT INTO inventory(id, character_id, name, quantity, location, provenance, session_id, updated_at)
       VALUES ('legacy', 'pc-1', 'Legacy item', 1, 'worn maybe', 'test', ?, ?)`,
    ).run(CTX.sessionId, CTX.at);
    expect(() => donItem(db, { ...CTX, itemId: 'legacy' })).toThrow(
      /ambiguous legacy placement.*'don' fails closed/,
    );
    db.close();
  });

  it('fails closed for doff when a held blocksDoff item has no wear row', () => {
    const db = freshDbWithSession();
    const armor = giveItem(
      db,
      {
        id: 'legacy-demon-armor-doff',
        name: 'Demon Armor',
        packRef: 'magic-item:demon-armor',
        stateful: true,
      },
      CTX,
    );
    db.prepare('DELETE FROM inventory_wear_state WHERE inventory_id=?').run(
      armor.id,
    );
    expect(() => doffItem(db, { ...CTX, itemId: armor.id })).toThrow(
      /ambiguous legacy placement.*'doff' fails closed/,
    );
    db.close();
  });

  it('requires exact semantic operation names in the model tool registry', async () => {
    const { createDefaultToolRegistry } = await import(
      '../src/orchestrator/tools.js'
    );
    const registry = createDefaultToolRegistry();
    expect(registry.has('don_item')).toBe(true);
    expect(registry.has('doff_item')).toBe(true);
    expect(registry.has('wear_item')).toBe(false);
    expect(registry.has('equip_item')).toBe(false);
    expect(registry.has('remove_equipment')).toBe(false);
  });

  it('keeps the campaign id available for callers that end attunement separately', () => {
    expect(DEFAULT_TEST_CAMPAIGN_ID).toBe('campaign-1');
  });
});
