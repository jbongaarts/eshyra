import { describe, expect, it } from 'vitest';
import type { ToolContext } from '../src/internal.js';
import {
  CharacterResolutionError,
  createDefaultToolRegistry,
  createSeededRng,
  ensureCharacterRow,
  initSchema,
  mutateState,
  openDatabase,
  resolveCharacterRef,
  startSession,
} from '../src/internal.js';

const AT = '2026-05-28T00:00:00.000Z';
const registry = createDefaultToolRegistry();

function freshDb() {
  const db = openDatabase(':memory:');
  initSchema(db);
  startSession(db, {
    campaignId: 'campaign-1',
    sessionId: 'session-1',
    startedAt: AT,
  });
  return db;
}

function ctx(
  db: ReturnType<typeof freshDb>,
  overrides: Partial<ToolContext> = {},
): ToolContext {
  return {
    db,
    rng: createSeededRng(1),
    campaignId: 'campaign-1',
    sessionId: 'session-1',
    turnId: 'turn-1',
    at: AT,
    ...overrides,
  };
}

function set(
  db: ReturnType<typeof freshDb>,
  id: string,
  field: string,
  value: string | number,
) {
  mutateState(db, {
    target: 'character',
    id,
    field,
    op: 'set',
    value,
    provenance: 'test',
    sessionId: 'session-1',
    at: AT,
  });
}

function hp(db: ReturnType<typeof freshDb>, id: string): number {
  return (
    db.prepare('SELECT hp_current FROM character WHERE id = ?').get(id) as {
      hp_current: number;
    }
  ).hp_current;
}

describe('resolveCharacterRef', () => {
  it('resolves an exact id', () => {
    const db = freshDb();
    expect(resolveCharacterRef(db, 'pc-1')).toBe('pc-1');
  });

  it('resolves a name case-insensitively', () => {
    const db = freshDb();
    set(db, 'pc-1', 'name', 'Aldric');
    expect(resolveCharacterRef(db, 'aldric')).toBe('pc-1');
  });

  it('throws on an unknown ref', () => {
    const db = freshDb();
    expect(() => resolveCharacterRef(db, 'nobody')).toThrow(
      CharacterResolutionError,
    );
  });

  it('throws on an ambiguous name', () => {
    const db = freshDb();
    set(db, 'pc-1', 'name', 'Twin');
    ensureCharacterRow(db, 'pc-2', 'test', 'session-1', AT);
    set(db, 'pc-2', 'name', 'Twin');
    expect(() => resolveCharacterRef(db, 'Twin')).toThrow(
      CharacterResolutionError,
    );
  });
});

describe('tool character targeting', () => {
  it('adjust_hp targets a non-active PC by id', () => {
    const db = freshDb();
    ensureCharacterRow(db, 'pc-2', 'test', 'session-1', AT);
    set(db, 'pc-1', 'hp_max', 10);
    set(db, 'pc-1', 'hp_current', 10);
    set(db, 'pc-2', 'hp_max', 10);
    set(db, 'pc-2', 'hp_current', 10);

    const result = registry.invoke(
      'adjust_hp',
      { amount: -4, character: 'pc-2' },
      ctx(db),
    );

    expect(result.ok).toBe(true);
    expect(hp(db, 'pc-2')).toBe(6);
    expect(hp(db, 'pc-1')).toBe(10);
  });

  it('give_item targets a PC by name and scopes ownership', () => {
    const db = freshDb();
    ensureCharacterRow(db, 'pc-2', 'test', 'session-1', AT);
    set(db, 'pc-2', 'name', 'Brielle');

    const result = registry.invoke(
      'give_item',
      { id: 'torch', name: 'Torch', character: 'Brielle' },
      ctx(db),
    );

    expect(result.ok).toBe(true);
    expect(result).toMatchObject({
      ok: true,
      data: {
        id: 'torch',
        name: 'Torch',
        quantity: 1,
        character: 'Brielle',
        characterId: 'pc-2',
      },
    });
    const owner = (
      db
        .prepare('SELECT character_id FROM inventory WHERE id = ?')
        .get('torch') as {
        character_id: string;
      }
    ).character_id;
    expect(owner).toBe('pc-2');

    const removed = registry.invoke(
      'remove_item',
      {
        id: 'torch',
        quantity: 1,
        disposition: 'destroyed',
        character: 'Brielle',
      },
      ctx(db),
    );
    expect(removed).toMatchObject({
      ok: true,
      data: {
        id: 'torch',
        name: 'Torch',
        quantity: 1,
        character: 'Brielle',
        characterId: 'pc-2',
      },
    });
  });

  it('claim_item targets a PC by name while preserving the unheld row id', () => {
    const db = freshDb();
    ensureCharacterRow(db, 'pc-2', 'test', 'session-1', AT);
    set(db, 'pc-2', 'name', 'Brielle');
    registry.invoke(
      'give_item',
      { id: 'found-ring', name: 'Found Ring' },
      ctx(db),
    );
    registry.invoke(
      'remove_item',
      { id: 'found-ring', disposition: 'dropped' },
      ctx(db),
    );

    expect(
      registry.invoke(
        'claim_item',
        { id: 'found-ring', character: 'Brielle' },
        ctx(db),
      ),
    ).toMatchObject({
      ok: true,
      data: { itemId: 'found-ring', characterId: 'pc-2' },
    });
    expect(
      db
        .prepare('SELECT character_id FROM inventory WHERE id=?')
        .get('found-ring'),
    ).toEqual({ character_id: 'pc-2' });
  });

  it('remove_item does not report metadata from another character inventory row', () => {
    const db = freshDb();
    ensureCharacterRow(db, 'pc-2', 'test', 'session-1', AT);
    registry.invoke(
      'give_item',
      {
        id: 'torch',
        name: 'Torch',
        quantity: 3,
        location: 'pc-1 pack',
        character: 'pc-1',
      },
      ctx(db),
    );

    const result = registry.invoke(
      'remove_item',
      { id: 'torch', quantity: 1, disposition: 'lost', character: 'pc-2' },
      ctx(db),
    );

    expect(result).toMatchObject({
      ok: false,
      code: 'mutate_error',
    });
    expect(
      db.prepare('SELECT quantity FROM inventory WHERE id = ?').get('torch'),
    ).toEqual({ quantity: 3 });
  });

  it('add_condition does not store the character target in the condition entry', () => {
    const db = freshDb();
    ensureCharacterRow(db, 'pc-2', 'test', 'session-1', AT);

    registry.invoke(
      'add_condition',
      { id: 'poisoned', character: 'pc-2' },
      ctx(db),
    );

    const conditions = JSON.parse(
      (
        db
          .prepare('SELECT conditions_json FROM character WHERE id = ?')
          .get('pc-2') as { conditions_json: string }
      ).conditions_json,
    );
    expect(conditions).toEqual([{ id: 'poisoned' }]);
  });

  it('returns an invalid_target correction for an unknown character', () => {
    const db = freshDb();
    const result = registry.invoke(
      'adjust_hp',
      { amount: -1, character: 'ghost' },
      ctx(db),
    );
    expect(result).toMatchObject({ ok: false, code: 'invalid_target' });
  });

  it('defaults to the acting PC when character is omitted', () => {
    const db = freshDb();
    ensureCharacterRow(db, 'pc-2', 'test', 'session-1', AT);
    set(db, 'pc-1', 'hp_max', 10);
    set(db, 'pc-1', 'hp_current', 10);
    set(db, 'pc-2', 'hp_max', 10);
    set(db, 'pc-2', 'hp_current', 10);

    registry.invoke(
      'adjust_hp',
      { amount: -2 },
      ctx(db, { actingCharacterId: 'pc-2' }),
    );

    expect(hp(db, 'pc-2')).toBe(8);
    expect(hp(db, 'pc-1')).toBe(10);
  });
});
