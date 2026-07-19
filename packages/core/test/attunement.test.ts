// F5 attunement slot machine (eshyra-2n1t.7). Evidence for the
// ENGINE_PROCEDURE_COVERAGE row: attunement (max three slots, no duplicate
// copies, one creature per item, requires-attunement gate from the record,
// SRD ending conditions including automatic release on death).

import { describe, expect, it } from 'vitest';
import {
  AttunementError,
  adjustHp,
  assembleContext,
  assertEffectiveAttunementCurseReady,
  attuneItem,
  claimItem,
  destroyInventoryItem,
  effectiveMagicItemMechanics,
  endAllAttunementsOnDeath,
  endAttunement,
  ensureCharacterRow,
  getActiveCharacterId,
  getBundledDnd5eSrdPack,
  giveItem,
  listAttunements,
  magicItemVariantDefinitions,
  mutateState,
  removeItem,
  renderContextMessage,
  updateClock,
} from '../src/internal.js';
import { installCursedAttunementAddon } from './support/cursedAttunementAddon.js';
import {
  DEFAULT_TEST_CAMPAIGN_ID,
  DEFAULT_TEST_SESSION_ID,
  freshDbWithSession,
} from './support/db.js';

const NOW = '2026-07-10T10:00:00.000Z';
const CAMPAIGN = DEFAULT_TEST_CAMPAIGN_ID;
const CTX = {
  provenance: 'test:attunement',
  sessionId: DEFAULT_TEST_SESSION_ID,
  at: NOW,
};

function setup() {
  const db = freshDbWithSession();
  const pcId = getActiveCharacterId(db);
  return { db, pcId };
}

function give(db: ReturnType<typeof setup>['db'], id: string, name: string) {
  giveItem(db, { id, name }, CTX);
}

function insertAttunement(
  db: ReturnType<typeof setup>['db'],
  itemId: string,
  itemKey: string,
  displayName: string,
): void {
  db.prepare(
    `INSERT INTO attunement(
       campaign_id, character_id, item_id, item_key, display_name,
       attuned_at, provenance, session_id, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    CAMPAIGN,
    'pc-1',
    itemId,
    itemKey,
    displayName,
    NOW,
    CTX.provenance,
    CTX.sessionId,
    NOW,
  );
}

describe('attuneItem', () => {
  it('uses an add-on override curse for attune and ordinary end', () => {
    const { db } = setup();
    const resolveRulesPack = installCursedAttunementAddon(db, NOW);
    giveItem(
      db,
      {
        id: 'overridden-ring',
        name: 'Ring of Protection',
        packRef: 'magic-item:ring-of-protection',
      },
      CTX,
    );

    expect(() =>
      attuneItem(db, {
        campaignId: CAMPAIGN,
        itemId: 'overridden-ring',
        resolveRulesPack,
        ...CTX,
      }),
    ).toThrow(/curse contract.*engine-pending.*attune/);
    insertAttunement(
      db,
      'overridden-ring',
      'magic-item:ring-of-protection',
      'Ring of Protection',
    );
    expect(() =>
      endAttunement(db, {
        campaignId: CAMPAIGN,
        itemId: 'overridden-ring',
        reason: 'voluntary',
        resolveRulesPack,
        ...CTX,
      }),
    ).toThrow(/curse contract.*engine-pending.*end/);
    expect(
      endAttunement(db, {
        campaignId: CAMPAIGN,
        itemId: 'overridden-ring',
        reason: 'death',
        resolveRulesPack,
        ...CTX,
      }).ended.itemId,
    ).toBe('overridden-ring');
  });

  it('fails before ledger mutation when effective mechanics declares a curse', () => {
    const { db } = setup();
    const cursedId = giveItem(
      db,
      {
        id: 'cursed-axe',
        name: 'Berserker Axe',
        packRef: 'magic-item:berserker-axe',
        stateful: true,
      },
      CTX,
    );
    expect(() =>
      attuneItem(db, {
        campaignId: CAMPAIGN,
        itemId: cursedId.id,
        ...CTX,
      }),
    ).toThrow(/curse contract.*engine-pending.*attune/);
    expect(
      db.prepare('SELECT 1 FROM attunement WHERE item_id=?').get(cursedId.id),
    ).toBeUndefined();
  });
  it('attunes a held item whose record requires attunement', () => {
    const { db, pcId } = setup();
    give(db, 'ring-1', 'Ring of Protection');

    const result = attuneItem(db, {
      campaignId: CAMPAIGN,
      itemId: 'ring-1',
      ...CTX,
    });
    expect(result.characterId).toBe(pcId);
    expect(result.attuned.itemKey).toBe('magic-item:ring-of-protection');
    expect(result.slotsUsed).toBe(1);
    expect(result.slotLimit).toBe(3);
  });

  it('surfaces the attunement prerequisite for the DM to adjudicate', () => {
    const { db } = setup();
    give(db, 'wand-1', 'Wand of Fireballs');

    const result = attuneItem(db, {
      campaignId: CAMPAIGN,
      itemId: 'wand-1',
      ...CTX,
    });
    expect(result.prerequisite).toBe('by a spellcaster');
  });

  it('uses immutable inventory pack identity and rejects a conflicting itemRef', () => {
    const { db } = setup();
    giveItem(
      db,
      {
        id: 'renamed-ring',
        name: 'Grandmother’s Keepsake',
        packRef: 'magic-item:ring-of-protection',
      },
      CTX,
    );
    expect(
      attuneItem(db, {
        campaignId: CAMPAIGN,
        itemId: 'renamed-ring',
        ...CTX,
      }).attuned.itemKey,
    ).toBe('magic-item:ring-of-protection');
    endAttunement(db, {
      campaignId: CAMPAIGN,
      itemId: 'renamed-ring',
      reason: 'voluntary',
      ...CTX,
    });
    expect(() =>
      attuneItem(db, {
        campaignId: CAMPAIGN,
        itemId: 'renamed-ring',
        itemRef: 'magic-item:wand-of-fireballs',
        ...CTX,
      }),
    ).toThrow(/does not match inventory packRef/);
  });

  it('refuses an item whose record does not require attunement', () => {
    const { db } = setup();
    give(db, 'bag-1', 'Bag of Holding');

    expect(() =>
      attuneItem(db, { campaignId: CAMPAIGN, itemId: 'bag-1', ...CTX }),
    ).toThrow(/does not require attunement/);
  });

  it('accepts a homebrew item with no resolvable record', () => {
    const { db } = setup();
    give(db, 'relic-1', 'Whisperstone of Eshyra');

    const result = attuneItem(db, {
      campaignId: CAMPAIGN,
      itemId: 'relic-1',
      ...CTX,
    });
    expect(result.attuned.itemKey).toBe('name:whisperstone-of-eshyra');
  });

  it('fails closed on an explicit itemRef that does not resolve', () => {
    const { db } = setup();
    give(db, 'relic-1', 'Whisperstone of Eshyra');

    expect(() =>
      attuneItem(db, {
        campaignId: CAMPAIGN,
        itemId: 'relic-1',
        itemRef: 'magic-item:whisperstone',
        ...CTX,
      }),
    ).toThrow(/does not resolve/);
  });

  it('fails closed when immutable pack identity does not resolve', () => {
    const { db } = setup();
    giveItem(
      db,
      {
        id: 'unavailable-relic',
        name: 'Unavailable Relic',
        packRef: 'magic-item:unavailable-relic',
      },
      CTX,
    );

    expect(() =>
      attuneItem(db, {
        campaignId: CAMPAIGN,
        itemId: 'unavailable-relic',
        ...CTX,
      }),
    ).toThrow(/inventory packRef.*exact campaign rules stack.*refusing/);
  });

  it('requires possession of the item', () => {
    const { db } = setup();

    expect(() =>
      attuneItem(db, { campaignId: CAMPAIGN, itemId: 'ghost-item', ...CTX }),
    ).toThrow(/holds no inventory item/);
  });

  it('enforces the three-slot limit', () => {
    const { db } = setup();
    give(db, 'ring-1', 'Ring of Protection');
    give(db, 'cloak-1', 'Cloak of Protection');
    give(db, 'wand-1', 'Wand of Fireballs');
    give(db, 'relic-1', 'Whisperstone of Eshyra');
    for (const itemId of ['ring-1', 'cloak-1', 'wand-1']) {
      attuneItem(db, { campaignId: CAMPAIGN, itemId, ...CTX });
    }

    expect(() =>
      attuneItem(db, { campaignId: CAMPAIGN, itemId: 'relic-1', ...CTX }),
    ).toThrow(/already attuned to 3 items/);
  });

  it('refuses a second copy of the same item and a re-attune of the same item', () => {
    const { db } = setup();
    give(db, 'ring-1', 'Ring of Protection');
    give(db, 'ring-2', 'Ring of Protection');
    attuneItem(db, { campaignId: CAMPAIGN, itemId: 'ring-1', ...CTX });

    expect(() =>
      attuneItem(db, { campaignId: CAMPAIGN, itemId: 'ring-1', ...CTX }),
    ).toThrow(/already attuned to 'Ring of Protection'/);
    expect(() =>
      attuneItem(db, { campaignId: CAMPAIGN, itemId: 'ring-2', ...CTX }),
    ).toThrow(/more than one copy/);
  });

  it('treats distinct canonical variants as distinct types and rejects the same variant twice', () => {
    const { db } = setup();
    const instanceIds = new Map<string, string>();
    for (const [id, variantId] of [
      ['agility-1', 'agility'],
      ['protection-1', 'protection'],
      ['agility-2', 'agility'],
    ] as const)
      instanceIds.set(
        id,
        giveItem(
          db,
          {
            id,
            name: 'Ioun Stone',
            packRef: 'magic-item:ioun-stone',
            variantId,
            stateful: true,
          },
          CTX,
        ).id,
      );

    const agility = attuneItem(db, {
      campaignId: CAMPAIGN,
      itemId: instanceIds.get('agility-1') as string,
      ...CTX,
    });
    const protection = attuneItem(db, {
      campaignId: CAMPAIGN,
      itemId: instanceIds.get('protection-1') as string,
      ...CTX,
    });
    expect(agility.attuned).toMatchObject({
      itemKey: 'magic-item:ioun-stone#variant:agility',
      displayName: 'Agility',
    });
    expect(protection.attuned).toMatchObject({
      itemKey: 'magic-item:ioun-stone#variant:protection',
      displayName: 'Protection',
    });
    expect(() =>
      attuneItem(db, {
        campaignId: CAMPAIGN,
        itemId: instanceIds.get('agility-2') as string,
        ...CTX,
      }),
    ).toThrow(/copy of 'Agility'.*more than one copy/);
  });

  it('enforces one creature per item until the other attunement ends', () => {
    const { db, pcId } = setup();
    ensureCharacterRow(db, 'pc-2', CTX.provenance, CTX.sessionId, CTX.at);
    give(db, 'ring-1', 'Ring of Protection');
    attuneItem(db, { campaignId: CAMPAIGN, itemId: 'ring-1', ...CTX });

    // The ring is dropped and reclaimed without the bond being broken.
    updateClock(db, { locationId: 'camp' }, CTX);
    removeItem(db, { itemId: 'ring-1', disposition: 'dropped' }, CTX);
    claimItem(db, 'ring-1', { characterId: 'pc-2', ...CTX });
    expect(() =>
      attuneItem(db, {
        campaignId: CAMPAIGN,
        characterRef: 'pc-2',
        itemId: 'ring-1',
        ...CTX,
      }),
    ).toThrow(/attuned to only one creature at a time/);

    endAttunement(db, {
      campaignId: CAMPAIGN,
      characterRef: pcId,
      itemId: 'ring-1',
      reason: 'replaced',
      ...CTX,
    });
    const result = attuneItem(db, {
      campaignId: CAMPAIGN,
      characterRef: 'pc-2',
      itemId: 'ring-1',
      ...CTX,
    });
    expect(result.characterId).toBe('pc-2');
  });

  it('refuses attunement for a dead character', () => {
    const { db } = setup();
    give(db, 'ring-1', 'Ring of Protection');
    mutateState(db, {
      target: 'character',
      field: 'life_state',
      op: 'set',
      value: 'dead',
      ...CTX,
    });

    expect(() =>
      attuneItem(db, { campaignId: CAMPAIGN, itemId: 'ring-1', ...CTX }),
    ).toThrow(/dead/);
  });
});

describe('endAttunement', () => {
  it('cannot explicitly delete a persisted cursed bond', () => {
    const { db } = setup();
    const cursedId = giveItem(
      db,
      {
        id: 'cursed-axe',
        name: 'Berserker Axe',
        packRef: 'magic-item:berserker-axe',
        stateful: true,
      },
      CTX,
    );
    insertAttunement(
      db,
      cursedId.id,
      'magic-item:berserker-axe',
      'Berserker Axe',
    );
    expect(() =>
      endAttunement(db, {
        campaignId: CAMPAIGN,
        itemId: cursedId.id,
        reason: 'voluntary',
        ...CTX,
      }),
    ).toThrow(/curse contract.*engine-pending.*end/);
    expect(
      db.prepare('SELECT 1 FROM attunement WHERE item_id=?').get(cursedId.id),
    ).toEqual({ 1: 1 });
    expect(() =>
      endAttunement(db, {
        campaignId: CAMPAIGN,
        itemId: cursedId.id,
        reason: 'item_destroyed',
        ...CTX,
      }),
    ).toThrow(/curse contract.*engine-pending/);
    expect(
      endAttunement(db, {
        campaignId: CAMPAIGN,
        itemId: cursedId.id,
        reason: 'death',
        ...CTX,
      }).ended.itemId,
    ).toBe(cursedId.id);
  });
  it('frees the slot and reports the remaining attunements', () => {
    const { db, pcId } = setup();
    give(db, 'ring-1', 'Ring of Protection');
    give(db, 'cloak-1', 'Cloak of Protection');
    attuneItem(db, { campaignId: CAMPAIGN, itemId: 'ring-1', ...CTX });
    attuneItem(db, { campaignId: CAMPAIGN, itemId: 'cloak-1', ...CTX });

    const result = endAttunement(db, {
      campaignId: CAMPAIGN,
      itemId: 'ring-1',
      reason: 'voluntary',
      ...CTX,
    });
    expect(result.ended.itemId).toBe('ring-1');
    expect(result.attunements.map((entry) => entry.itemId)).toEqual([
      'cloak-1',
    ]);
    expect(listAttunements(db, CAMPAIGN, pcId)).toHaveLength(1);
  });

  it('names the current attunements when the item is not attuned', () => {
    const { db } = setup();
    give(db, 'ring-1', 'Ring of Protection');
    attuneItem(db, { campaignId: CAMPAIGN, itemId: 'ring-1', ...CTX });

    expect(() =>
      endAttunement(db, {
        campaignId: CAMPAIGN,
        itemId: 'cloak-1',
        reason: 'voluntary',
        ...CTX,
      }),
    ).toThrow(/no attunement to item 'cloak-1'.*Ring of Protection/s);
  });

  it('rejects an unknown reason', () => {
    const { db } = setup();

    expect(() =>
      endAttunement(db, {
        campaignId: CAMPAIGN,
        itemId: 'ring-1',
        reason: 'misplaced' as never,
        ...CTX,
      }),
    ).toThrow(AttunementError);
  });
});

describe('death ends attunement (F6 hook)', () => {
  it('preserves authoritative death and destruction cleanup exceptions', () => {
    const { db, pcId } = setup();
    const instanceIds: string[] = [];
    for (const itemId of ['death-axe', 'destroyed-axe']) {
      const granted = giveItem(
        db,
        {
          id: itemId,
          name: 'Berserker Axe',
          packRef: 'magic-item:berserker-axe',
          stateful: true,
        },
        CTX,
      );
      instanceIds.push(granted.id);
      insertAttunement(
        db,
        granted.id,
        'magic-item:berserker-axe',
        'Berserker Axe',
      );
    }
    expect(
      destroyInventoryItem(db, instanceIds[1], CTX).attunementsEnded,
    ).toHaveLength(1);
    expect(endAllAttunementsOnDeath(db, pcId)).toBe(1);
    expect(listAttunements(db, CAMPAIGN, pcId)).toEqual([]);
  });
  it('releases every slot when the death machine records death', () => {
    const { db, pcId } = setup();
    for (const [field, value] of [
      ['hp_max', 20],
      ['hp_current', 20],
    ] as const) {
      mutateState(db, {
        target: 'character',
        field,
        op: 'set',
        value,
        ...CTX,
      });
    }
    give(db, 'ring-1', 'Ring of Protection');
    give(db, 'cloak-1', 'Cloak of Protection');
    attuneItem(db, { campaignId: CAMPAIGN, itemId: 'ring-1', ...CTX });
    attuneItem(db, { campaignId: CAMPAIGN, itemId: 'cloak-1', ...CTX });

    // Overflow damage >= hp_max: instant death through the F6 write path.
    const result = adjustHp(db, -40, CTX);
    expect(result.lifeState).toBe('dead');
    expect(listAttunements(db, CAMPAIGN, pcId)).toHaveLength(0);
  });
});

describe('cursed attunement corpus guard', () => {
  it('gates only explicit attunement lifecycle contracts, not every curse-family scope', () => {
    const bundled = getBundledDnd5eSrdPack();
    const blockedAttune: string[] = [];
    const blockedEnd: string[] = [];
    const curseScopes: string[] = [];
    for (const record of bundled.records.filter(
      (candidate) => candidate.kind === 'magic-item',
    )) {
      const variants = magicItemVariantDefinitions(record);
      const scopes: readonly (string | undefined)[] =
        variants.length === 0
          ? [undefined]
          : variants.map((variant) => variant.id);
      for (const variantId of scopes) {
        if (effectiveMagicItemMechanics(record, variantId)?.curse === undefined)
          continue;
        const scope = `${record.name}:${variantId ?? 'parent'}`;
        curseScopes.push(scope);
        for (const [mutation, blocked] of [
          ['attune', blockedAttune],
          ['end', blockedEnd],
        ] as const) {
          try {
            assertEffectiveAttunementCurseReady(record, variantId, mutation);
          } catch (error) {
            expect(error).toBeInstanceOf(AttunementError);
            expect(String(error)).toMatch(/engine-pending/);
            blocked.push(scope);
          }
        }
      }
    }
    expect(curseScopes).toHaveLength(12);
    expect(blockedAttune.sort()).toEqual([
      'Armor of Vulnerability:parent',
      'Berserker Axe:parent',
      'Robe of the Archmagi:parent',
      'Shield of Missile Attraction:parent',
    ]);
    expect(blockedEnd.sort()).toEqual([
      'Armor of Vulnerability:parent',
      'Berserker Axe:parent',
      'Orb of Dragonkind:parent',
      'Shield of Missile Attraction:parent',
    ]);

    const exemplar = bundled.records.find(
      (record) => record.kind === 'magic-item',
    );
    if (exemplar === undefined) throw new Error('missing magic-item exemplar');
    const syntheticVariant = {
      ...exemplar,
      key: 'magic-item:variant-curse-test',
      data: {
        itemType: 'wondrous item',
        rarity: 'rare',
        requiresAttunement: true,
        description: 'fixture',
        variants: [
          {
            id: 'cursed-form',
            name: 'Cursed Form',
            rarity: 'rare',
            text: 'fixture',
            mechanics: {
              curse: {
                blocksUnattune: true,
                note: 'synthetic variant fixture',
              },
            },
          },
        ],
      },
    };
    expect(() =>
      assertEffectiveAttunementCurseReady(
        syntheticVariant,
        'cursed-form',
        'attune',
      ),
    ).not.toThrow();
    expect(() =>
      assertEffectiveAttunementCurseReady(
        syntheticVariant,
        'cursed-form',
        'end',
      ),
    ).toThrow(/engine-pending/);
  });
});

describe('context snapshot', () => {
  it('surfaces the attuned items with slot usage', () => {
    const { db } = setup();
    give(db, 'ring-1', 'Ring of Protection');
    attuneItem(db, { campaignId: CAMPAIGN, itemId: 'ring-1', ...CTX });

    const rendered = renderContextMessage(
      assembleContext({
        db,
        campaignId: CAMPAIGN,
        sessionId: DEFAULT_TEST_SESSION_ID,
        playerInput: 'What am I wearing?',
      }),
    );
    expect(rendered).toContain(
      'Attuned items (1/3): Ring of Protection (ring-1)',
    );
  });
});
