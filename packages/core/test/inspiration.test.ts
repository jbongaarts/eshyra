// F5 inspiration boolean resource (eshyra-2n1t.7). Evidence for the
// ENGINE_PROCEDURE_COVERAGE rows: gaining-inspiration (no-stockpile cap)
// and the state clause of using-inspiration (spend -> advantage note,
// gifting; the advantage roll grammar itself is F1).

import { describe, expect, it } from 'vitest';
import {
  assembleContext,
  awardInspiration,
  ensureCharacterRow,
  getActiveCharacterId,
  InspirationError,
  mutateState,
  renderContextMessage,
  spendInspiration,
} from '../src/internal.js';
import {
  DEFAULT_TEST_CAMPAIGN_ID,
  DEFAULT_TEST_SESSION_ID,
  freshDbWithSession,
} from './support/db.js';

const NOW = '2026-07-10T10:00:00.000Z';
const CTX = {
  provenance: 'test:inspiration',
  sessionId: DEFAULT_TEST_SESSION_ID,
  at: NOW,
};

function setup() {
  const db = freshDbWithSession();
  const pcId = getActiveCharacterId(db);
  return { db, pcId };
}

describe('awardInspiration', () => {
  it('awards the boolean and refuses stockpiling', () => {
    const { db, pcId } = setup();

    const result = awardInspiration(db, CTX);
    expect(result.characterId).toBe(pcId);
    expect(result.inspiration).toBe(true);

    expect(() => awardInspiration(db, CTX)).toThrow(/cannot be stockpiled/);
  });

  it('refuses to inspire the dead', () => {
    const { db } = setup();
    mutateState(db, {
      target: 'character',
      field: 'life_state',
      op: 'set',
      value: 'dead',
      ...CTX,
    });

    expect(() => awardInspiration(db, CTX)).toThrow(/dead/);
  });
});

describe('spendInspiration', () => {
  it('spends for an advantage note and cannot double-spend', () => {
    const { db } = setup();
    awardInspiration(db, CTX);

    const result = spendInspiration(db, CTX);
    expect(result.outcome).toBe('spent');
    expect(result.inspiration).toBe(false);
    expect(result.advantageNote).toMatch(
      /advantage on one attack roll, saving throw, or ability check/,
    );

    expect(() => spendInspiration(db, CTX)).toThrow(/no inspiration to spend/);
  });

  it('gifts to another character under the no-stockpile cap', () => {
    const { db, pcId } = setup();
    ensureCharacterRow(db, 'pc-2', CTX.provenance, CTX.sessionId, CTX.at);
    awardInspiration(db, CTX);

    const gift = spendInspiration(db, { ...CTX, giftTo: 'pc-2' });
    expect(gift.outcome).toBe('gifted');
    expect(gift.inspiration).toBe(false);
    expect(gift.recipient).toEqual({
      characterId: 'pc-2',
      characterLabel: 'pc-2',
      inspiration: true,
    });

    // The giver is now empty-handed and the recipient is capped.
    expect(() => spendInspiration(db, { ...CTX, giftTo: 'pc-2' })).toThrow(
      /no inspiration to gift/,
    );
    awardInspiration(db, { ...CTX, characterRef: pcId });
    expect(() => spendInspiration(db, { ...CTX, giftTo: 'pc-2' })).toThrow(
      /cannot be stockpiled/,
    );
  });

  it('refuses gifting to yourself and to the dead', () => {
    const { db, pcId } = setup();
    ensureCharacterRow(db, 'pc-2', CTX.provenance, CTX.sessionId, CTX.at);
    awardInspiration(db, CTX);

    expect(() => spendInspiration(db, { ...CTX, giftTo: pcId })).toThrow(
      /themselves/,
    );
    mutateState(db, {
      target: 'character',
      id: 'pc-2',
      field: 'life_state',
      op: 'set',
      value: 'dead',
      ...CTX,
    });
    expect(() => spendInspiration(db, { ...CTX, giftTo: 'pc-2' })).toThrow(
      InspirationError,
    );
  });
});

describe('context snapshot', () => {
  it('surfaces available inspiration to the model', () => {
    const { db } = setup();
    awardInspiration(db, CTX);

    const rendered = renderContextMessage(
      assembleContext({
        db,
        campaignId: DEFAULT_TEST_CAMPAIGN_ID,
        sessionId: DEFAULT_TEST_SESSION_ID,
        playerInput: 'Do I feel inspired?',
      }),
    );
    expect(rendered).toContain('Inspiration: available');
  });
});
