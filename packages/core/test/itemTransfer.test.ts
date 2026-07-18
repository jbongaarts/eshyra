import { describe, expect, it } from 'vitest';
import {
  giveItem,
  ItemTransferError,
  readItemState,
  transferItem,
  writeItemState,
} from '../src/internal.js';
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
  it('preserves instance identity and state while making attunement policy explicit', () => {
    const db = freshDbWithSession();
    addRecipient(db);
    const granted = giveItem(
      db,
      {
        id: 'ignored',
        name: 'Ioun Stone of Agility',
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
          'SELECT character_id, pack_ref, variant_id FROM inventory WHERE id=?',
        )
        .get(granted.id),
    ).toEqual({
      character_id: 'pc-2',
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
