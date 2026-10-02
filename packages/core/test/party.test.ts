import { describe, expect, it } from 'vitest';
import {
  CharacterResolutionError,
  ensureCharacterRow,
  initSchema,
  listParty,
  mutateState,
  openDatabase,
  setActiveCharacterId,
} from '../src/internal.js';

const CTX = {
  provenance: 'test:party',
  sessionId: 'session-1',
  at: '2026-05-28T00:00:00.000Z',
};

function freshDb() {
  const db = openDatabase(':memory:');
  initSchema(db);
  return db;
}

function setField(
  db: ReturnType<typeof freshDb>,
  id: string,
  field: string,
  value: string | number,
) {
  mutateState(db, { target: 'character', id, field, op: 'set', value, ...CTX });
}

describe('listParty', () => {
  it('returns the bootstrap one-member party with the active PC flagged', () => {
    const db = freshDb();
    const party = listParty(db);
    expect(party).toHaveLength(1);
    expect(party[0]?.id).toBe('pc-1');
    expect(party[0]?.role).toBe('pc');
    expect(party[0]?.isActive).toBe(true);
  });

  it('lists multiple PCs ordered with PCs first, then by id', () => {
    const db = freshDb();
    ensureCharacterRow(db, 'pc-2', CTX.provenance, CTX.sessionId, CTX.at);
    setField(db, 'pc-2', 'name', 'Brielle');
    setField(db, 'pc-1', 'name', 'Aldric');
    setActiveCharacterId(db, 'pc-2');

    const party = listParty(db);
    expect(party.map((m) => m.id)).toEqual(['pc-1', 'pc-2']);
    expect(party.find((m) => m.id === 'pc-2')?.isActive).toBe(true);
    expect(party.find((m) => m.id === 'pc-1')?.isActive).toBe(false);
    expect(party.find((m) => m.id === 'pc-2')?.name).toBe('Brielle');
  });

  it('distinguishes companions by role and sorts them after PCs', () => {
    const db = freshDb();
    ensureCharacterRow(db, 'comp-1', CTX.provenance, CTX.sessionId, CTX.at);
    db.prepare("UPDATE character SET role = 'companion' WHERE id = ?").run(
      'comp-1',
    );
    ensureCharacterRow(db, 'pc-2', CTX.provenance, CTX.sessionId, CTX.at);

    const party = listParty(db);
    expect(party.map((m) => m.id)).toEqual(['pc-1', 'pc-2', 'comp-1']);
    expect(party.find((m) => m.id === 'comp-1')?.role).toBe('companion');
  });

  it('projects level, hit points, and conditions per member', () => {
    const db = freshDb();
    setField(db, 'pc-1', 'level', 3);
    setField(db, 'pc-1', 'hp_max', 24);
    setField(db, 'pc-1', 'hp_current', 18);
    mutateState(db, {
      target: 'character',
      id: 'pc-1',
      field: 'conditions_json',
      op: 'set',
      value: [{ id: 'prone' }],
      ...CTX,
    });

    const [member] = listParty(db);
    expect(member?.level).toBe(3);
    expect(member?.hpMax).toBe(24);
    expect(member?.hpCurrent).toBe(18);
    expect(member?.conditions).toEqual([{ id: 'prone' }]);
  });

  it('projects an exhausted nonacting member with the effective HP maximum', () => {
    const db = freshDb();
    ensureCharacterRow(db, 'pc-2', CTX.provenance, CTX.sessionId, CTX.at);
    setField(db, 'pc-2', 'hp_max', 20);
    setField(db, 'pc-2', 'hp_current', 10);
    mutateState(db, {
      target: 'character',
      id: 'pc-2',
      field: 'conditions_json',
      op: 'set',
      value: [{ id: 'exhaustion', level: 4 }],
      ...CTX,
    });
    const member = listParty(db).find((row) => row.id === 'pc-2');
    expect(member?.isActive).toBe(false);
    expect(member).toMatchObject({ hpCurrent: 10, hpMax: 10 });
  });
});

describe('setActiveCharacterId validation', () => {
  function activeId(db: ReturnType<typeof freshDb>): string {
    return (
      db
        .prepare("SELECT value FROM meta WHERE key = 'active_character_id'")
        .get() as { value: string }
    ).value;
  }

  it('rejects an unknown character id without changing the active id', () => {
    const db = freshDb();
    expect(() => setActiveCharacterId(db, 'pc-404')).toThrow(
      CharacterResolutionError,
    );
    expect(activeId(db)).toBe('pc-1');
  });

  it('rejects a non-PC party member', () => {
    const db = freshDb();
    ensureCharacterRow(db, 'comp-1', CTX.provenance, CTX.sessionId, CTX.at);
    db.prepare("UPDATE character SET role = 'companion' WHERE id = ?").run(
      'comp-1',
    );
    expect(() => setActiveCharacterId(db, 'comp-1')).toThrow(
      CharacterResolutionError,
    );
    expect(activeId(db)).toBe('pc-1');
  });

  it('accepts a second player character', () => {
    const db = freshDb();
    ensureCharacterRow(db, 'pc-2', CTX.provenance, CTX.sessionId, CTX.at);
    setActiveCharacterId(db, 'pc-2');
    expect(activeId(db)).toBe('pc-2');
  });
});
