import { describe, expect, it } from 'vitest';
import type { Db } from '../src/internal.js';
import {
  assembleContext,
  CharacterResolutionError,
  ensureCharacterRow,
  giveItem,
  mutateState,
  renderContextMessage,
  setActiveCharacterId,
} from '../src/internal.js';
import {
  DEFAULT_TEST_CAMPAIGN_ID as CAMPAIGN,
  DEFAULT_TEST_ABILITY_SCORES,
  DEFAULT_TEST_CAMPAIGN_POSITION,
  freshDbWithSession,
  DEFAULT_TEST_SESSION_ID as SESSION,
} from './support/db.js';

const AT = '2026-05-20T10:00:00.000Z';
const CTX = { provenance: 'test', sessionId: SESSION, at: AT };

function addPc(db: Db, id: string, name: string) {
  ensureCharacterRow(db, id, 'test', SESSION, AT);
  for (const [field, value] of [
    ['name', name],
    ['hp_max', 12],
    ['hp_current', 12],
    ['ability_scores_json', DEFAULT_TEST_ABILITY_SCORES],
  ] as const) {
    mutateState(db, {
      target: 'character',
      id,
      field,
      op: 'set',
      value,
      ...CTX,
    });
  }
}

function assemble(db: Db) {
  return assembleContext({
    db,
    campaignId: CAMPAIGN,
    campaignPosition: DEFAULT_TEST_CAMPAIGN_POSITION,
    sessionId: SESSION,
    playerInput: 'continue',
  });
}

describe('context assembler party support', () => {
  it('includes the full party roster in the assembled context', () => {
    const db = freshDbWithSession();
    mutateState(db, {
      target: 'character',
      id: 'pc-1',
      field: 'name',
      op: 'set',
      value: 'Aldric',
      ...CTX,
    });
    addPc(db, 'pc-2', 'Brielle');

    const ctx = assemble(db);
    expect(ctx.party.map((m) => m.id)).toEqual(['pc-1', 'pc-2']);
    expect(ctx.party.find((m) => m.id === 'pc-1')?.isActive).toBe(true);
    db.close();
  });

  it('renders a ## Party section only when more than one member exists', () => {
    const solo = freshDbWithSession();
    expect(renderContextMessage(assemble(solo))).not.toContain('## Party');
    solo.close();

    const db = freshDbWithSession();
    addPc(db, 'pc-2', 'Brielle');
    const text = renderContextMessage(assemble(db));
    expect(text).toContain('## Party');
    expect(text).toContain('Brielle');
    db.close();
  });

  it('scopes inventory to the active PC with no cross-PC bleed', () => {
    const db = freshDbWithSession();
    addPc(db, 'pc-2', 'Brielle');
    giveItem(
      db,
      { id: 'torch', name: 'Torch' },
      { ...CTX, characterId: 'pc-1' },
    );
    giveItem(db, { id: 'wand', name: 'Wand' }, { ...CTX, characterId: 'pc-2' });

    expect(assemble(db).state.inventory.map((i) => i.id)).toEqual(['torch']);

    setActiveCharacterId(db, 'pc-2');
    expect(assemble(db).state.inventory.map((i) => i.id)).toEqual(['wand']);
    db.close();
  });

  it('marks the acting PC in the rendered roster', () => {
    const db = freshDbWithSession();
    addPc(db, 'pc-2', 'Brielle');

    const text = renderContextMessage(
      assembleContext({
        db,
        campaignId: CAMPAIGN,
        campaignPosition: DEFAULT_TEST_CAMPAIGN_POSITION,
        sessionId: SESSION,
        playerInput: 'continue',
        actingCharacterId: 'pc-2',
      }),
    );
    expect(text).toMatch(/Brielle.*\[acting\]/);
    db.close();
  });
});

describe('context assembler stale/invalid active character', () => {
  it('throws a controlled error for a stale active_character_id', () => {
    const db = freshDbWithSession();
    // Point the active id at a row that does not exist (e.g. a deleted PC).
    db.prepare(
      "UPDATE meta SET value = 'pc-gone' WHERE key = 'active_character_id'",
    ).run();

    expect(() => assemble(db)).toThrow(CharacterResolutionError);
    db.close();
  });

  it('throws a controlled error for an invalid explicit acting character', () => {
    const db = freshDbWithSession();

    expect(() =>
      assembleContext({
        db,
        campaignId: CAMPAIGN,
        campaignPosition: DEFAULT_TEST_CAMPAIGN_POSITION,
        sessionId: SESSION,
        playerInput: 'continue',
        actingCharacterId: 'pc-missing',
      }),
    ).toThrow(CharacterResolutionError);
    db.close();
  });

  it('rejects an explicit acting character that is not a PC', () => {
    const db = freshDbWithSession();
    addPc(db, 'comp-1', 'Wolf');
    db.prepare("UPDATE character SET role = 'companion' WHERE id = ?").run(
      'comp-1',
    );

    expect(() =>
      assembleContext({
        db,
        campaignId: CAMPAIGN,
        campaignPosition: DEFAULT_TEST_CAMPAIGN_POSITION,
        sessionId: SESSION,
        playerInput: 'continue',
        actingCharacterId: 'comp-1',
      }),
    ).toThrow(CharacterResolutionError);
    db.close();
  });
});
