// F5 attunement slot machine (eshyra-2n1t.7). Evidence for the
// ENGINE_PROCEDURE_COVERAGE row: attunement (max three slots, no duplicate
// copies, one creature per item, requires-attunement gate from the record,
// SRD ending conditions including automatic release on death).

import { describe, expect, it } from 'vitest';
import {
  AttunementError,
  adjustHp,
  assembleContext,
  attuneItem,
  endAttunement,
  ensureCharacterRow,
  getActiveCharacterId,
  giveItem,
  listAttunements,
  mutateState,
  renderContextMessage,
} from '../src/internal.js';
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

describe('attuneItem', () => {
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

  it('enforces one creature per item until the other attunement ends', () => {
    const { db, pcId } = setup();
    ensureCharacterRow(db, 'pc-2', CTX.provenance, CTX.sessionId, CTX.at);
    give(db, 'ring-1', 'Ring of Protection');
    attuneItem(db, { campaignId: CAMPAIGN, itemId: 'ring-1', ...CTX });

    // The ring changes hands without the bond being broken.
    giveItem(
      db,
      { id: 'ring-1', name: 'Ring of Protection' },
      {
        characterId: 'pc-2',
        ...CTX,
      },
    );
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
