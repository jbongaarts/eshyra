import { describe, expect, it } from 'vitest';
import {
  giveItem,
  ItemTransferError,
  readItemState,
  transferItem,
  writeItemState,
} from '../src/internal.js';
import { installCursedAttunementAddon } from './support/cursedAttunementAddon.js';
import {
  DEFAULT_TEST_CAMPAIGN_ID,
  DEFAULT_TEST_SESSION_ID,
  freshDbWithSession,
} from './support/db.js';

const AT = '2026-07-18T18:00:00.000Z';
const CTX = {
  provenance: 'test:item-transfer',
  sessionId: DEFAULT_TEST_SESSION_ID,
  at: AT,
  characterId: 'pc-1',
};

function addRecipient(db: ReturnType<typeof freshDbWithSession>): void {
  db.prepare(
    `INSERT INTO character(
       id, name, ability_scores_json, provenance, session_id, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(
    'pc-2',
    'Recipient',
    JSON.stringify({
      strength: 10,
      dexterity: 10,
      constitution: 10,
      intelligence: 10,
      wisdom: 10,
      charisma: 10,
    }),
    CTX.provenance,
    CTX.sessionId,
    CTX.at,
  );
}

describe('transferItem', () => {
  it('cannot use transfer-end to bypass an existing Orb of Dragonkind bond', () => {
    const db = freshDbWithSession();
    addRecipient(db);
    const orb = giveItem(
      db,
      {
        id: 'orb',
        name: 'Orb of Dragonkind',
        packRef: 'magic-item:orb-of-dragonkind',
        stateful: true,
      },
      CTX,
    );
    db.prepare(
      `INSERT INTO attunement(
         campaign_id, character_id, item_id, item_key, display_name,
         attuned_at, provenance, session_id, updated_at
       ) VALUES (?, 'pc-1', ?, 'magic-item:orb-of-dragonkind',
                 'Orb of Dragonkind', ?, 'test', ?, ?)`,
    ).run(DEFAULT_TEST_CAMPAIGN_ID, orb.id, AT, DEFAULT_TEST_SESSION_ID, AT);

    expect(() =>
      transferItem(
        db,
        {
          campaignId: DEFAULT_TEST_CAMPAIGN_ID,
          itemId: orb.id,
          toCharacterRef: 'pc-2',
          attunement: 'end',
        },
        CTX,
      ),
    ).toThrow(/engine-pending.*transfer-end/);
    expect(
      db.prepare('SELECT character_id FROM inventory WHERE id=?').get(orb.id),
    ).toEqual({ character_id: 'pc-1' });
    expect(
      db
        .prepare('SELECT character_id FROM attunement WHERE item_id=?')
        .get(orb.id),
    ).toEqual({ character_id: 'pc-1' });
    db.close();
  });

  it('cannot transfer held undoffable armor without authoritative don/doff state', () => {
    const db = freshDbWithSession();
    addRecipient(db);
    const armor = giveItem(
      db,
      {
        id: 'demon-armor',
        name: 'Demon Armor',
        packRef: 'magic-item:demon-armor',
        location: null,
        stateful: true,
      },
      CTX,
    );
    expect(() =>
      transferItem(
        db,
        {
          campaignId: DEFAULT_TEST_CAMPAIGN_ID,
          itemId: armor.id,
          toCharacterRef: 'pc-2',
          attunement: 'require-unattuned',
        },
        CTX,
      ),
    ).toThrow(/authoritative don\/doff state is unavailable.*fail closed/);
    expect(
      db
        .prepare('SELECT character_id, location FROM inventory WHERE id=?')
        .get(armor.id),
    ).toEqual({ character_id: 'pc-1', location: null });

    const ordinary = giveItem(
      db,
      {
        id: 'ordinary-ring',
        name: 'Ring of Protection',
        packRef: 'magic-item:ring-of-protection',
        location: 'worn',
      },
      CTX,
    );
    expect(
      transferItem(
        db,
        {
          campaignId: DEFAULT_TEST_CAMPAIGN_ID,
          itemId: ordinary.id,
          toCharacterRef: 'pc-2',
          attunement: 'require-unattuned',
        },
        CTX,
      ),
    ).toMatchObject({ itemId: ordinary.id, toCharacterId: 'pc-2' });
    expect(
      db
        .prepare('SELECT character_id, location FROM inventory WHERE id=?')
        .get(ordinary.id),
    ).toEqual({ character_id: 'pc-2', location: null });
    db.close();
  });

  it('cannot end an add-on-overridden cursed bond during transfer', () => {
    const db = freshDbWithSession();
    addRecipient(db);
    const resolveRulesPack = installCursedAttunementAddon(db, AT);
    giveItem(
      db,
      {
        id: 'overridden-ring',
        name: 'Ring of Protection',
        packRef: 'magic-item:ring-of-protection',
      },
      CTX,
    );
    db.prepare(
      `INSERT INTO attunement(
         campaign_id, character_id, item_id, item_key, display_name,
         attuned_at, provenance, session_id, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      DEFAULT_TEST_CAMPAIGN_ID,
      'pc-1',
      'overridden-ring',
      'magic-item:ring-of-protection',
      'Ring of Protection',
      AT,
      CTX.provenance,
      CTX.sessionId,
      AT,
    );

    expect(() =>
      transferItem(
        db,
        {
          campaignId: DEFAULT_TEST_CAMPAIGN_ID,
          itemId: 'overridden-ring',
          toCharacterRef: 'pc-2',
          attunement: 'end',
          resolveRulesPack,
        },
        CTX,
      ),
    ).toThrow(/curse contract.*engine-pending.*transfer-end/);
    expect(
      db
        .prepare('SELECT character_id FROM inventory WHERE id=?')
        .get('overridden-ring'),
    ).toEqual({ character_id: 'pc-1' });
    expect(
      db
        .prepare('SELECT character_id FROM attunement WHERE item_id=?')
        .get('overridden-ring'),
    ).toEqual({ character_id: 'pc-1' });
    db.close();
  });

  it('keeps require-unattuned ordinary and blocks cursed transfer-with-end atomically', () => {
    const db = freshDbWithSession();
    addRecipient(db);
    const granted = giveItem(
      db,
      {
        id: 'cursed-axe',
        name: 'Berserker Axe',
        packRef: 'magic-item:berserker-axe',
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
      DEFAULT_TEST_CAMPAIGN_ID,
      'pc-1',
      granted.id,
      'magic-item:berserker-axe',
      'Berserker Axe',
      AT,
      CTX.provenance,
      CTX.sessionId,
      AT,
    );

    expect(() =>
      transferItem(
        db,
        {
          campaignId: DEFAULT_TEST_CAMPAIGN_ID,
          itemId: granted.id,
          toCharacterRef: 'pc-2',
          attunement: 'require-unattuned',
        },
        CTX,
      ),
    ).toThrow(/choose attunement 'end'/);
    expect(() =>
      transferItem(
        db,
        {
          campaignId: DEFAULT_TEST_CAMPAIGN_ID,
          itemId: granted.id,
          toCharacterRef: 'pc-2',
          attunement: 'end',
        },
        CTX,
      ),
    ).toThrow(/curse contract.*engine-pending.*transfer-end/);
    expect(
      db
        .prepare('SELECT character_id FROM inventory WHERE id=?')
        .get(granted.id),
    ).toEqual({ character_id: 'pc-1' });
    expect(
      db
        .prepare('SELECT character_id FROM attunement WHERE item_id=?')
        .get(granted.id),
    ).toEqual({ character_id: 'pc-1' });
    db.close();
  });

  it('preserves instance identity and state while making attunement policy explicit', () => {
    const db = freshDbWithSession();
    addRecipient(db);
    const granted = giveItem(
      db,
      {
        id: 'ignored',
        name: 'Ioun Stone of Agility',
        location: 'worn',
        packRef: 'magic-item:ioun-stone',
        variantId: 'agility',
        stateful: true,
      },
      CTX,
    );
    writeItemState(
      db,
      granted.id,
      {
        packRef: 'magic-item:ioun-stone',
        variantId: 'agility',
        economies: { charges: { remaining: 2 } },
      },
      CTX,
    );
    db.prepare(
      `INSERT INTO attunement(
         campaign_id, character_id, item_id, item_key, display_name,
         attuned_at, provenance, session_id, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      DEFAULT_TEST_CAMPAIGN_ID,
      'pc-1',
      granted.id,
      'magic-item:ioun-stone#variant:agility',
      'Agility',
      AT,
      CTX.provenance,
      CTX.sessionId,
      AT,
    );

    expect(() =>
      transferItem(
        db,
        {
          campaignId: DEFAULT_TEST_CAMPAIGN_ID,
          itemId: granted.id,
          toCharacterRef: 'pc-2',
          attunement: 'require-unattuned',
        },
        CTX,
      ),
    ).toThrow(ItemTransferError);
    expect(
      db
        .prepare('SELECT character_id FROM inventory WHERE id=?')
        .get(granted.id),
    ).toEqual({ character_id: 'pc-1' });

    expect(
      transferItem(
        db,
        {
          campaignId: DEFAULT_TEST_CAMPAIGN_ID,
          itemId: granted.id,
          toCharacterRef: 'pc-2',
          attunement: 'end',
        },
        CTX,
      ),
    ).toMatchObject({
      itemId: granted.id,
      fromCharacterId: 'pc-1',
      toCharacterId: 'pc-2',
      packRef: 'magic-item:ioun-stone',
      variantId: 'agility',
      attunementEnded: true,
    });
    expect(
      db
        .prepare(
          `SELECT character_id, location, world_location_id, pack_ref, variant_id
           FROM inventory WHERE id=?`,
        )
        .get(granted.id),
    ).toEqual({
      character_id: 'pc-2',
      location: null,
      world_location_id: null,
      pack_ref: 'magic-item:ioun-stone',
      variant_id: 'agility',
    });
    expect(readItemState(db, granted.id)).toMatchObject({
      variantId: 'agility',
      economies: { charges: { remaining: 2 } },
    });
    expect(
      db.prepare('SELECT 1 FROM attunement WHERE item_id=?').get(granted.id),
    ).toBeUndefined();
    db.close();
  });
});
