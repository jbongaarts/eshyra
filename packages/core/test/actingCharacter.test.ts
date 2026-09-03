import { describe, expect, it } from 'vitest';
import type { ToolContext } from '../src/internal.js';
import {
  assembleContext,
  createDefaultToolRegistry,
  createSeededRng,
  ensureCharacterRow,
  initSchema,
  mutateState,
  openDatabase,
  setActiveCharacterId,
  startSession,
} from '../src/internal.js';

const registry = createDefaultToolRegistry();

const AT = '2026-05-28T00:00:00.000Z';

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

function makeCtx(
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

function setHp(
  db: ReturnType<typeof freshDb>,
  id: string,
  current: number,
  max: number,
) {
  for (const [field, value] of [
    ['hp_max', max],
    ['hp_current', current],
  ] as const) {
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
}

function hp(db: ReturnType<typeof freshDb>, id: string): number {
  return (
    db.prepare('SELECT hp_current FROM character WHERE id = ?').get(id) as {
      hp_current: number;
    }
  ).hp_current;
}

describe('acting-character attribution', () => {
  it('routes a character-scoped tool to the acting PC, not the active PC', () => {
    const db = freshDb();
    ensureCharacterRow(db, 'pc-2', 'test', 'session-1', AT);
    setHp(db, 'pc-1', 10, 10);
    setHp(db, 'pc-2', 10, 10);
    // pc-1 stays active; the turn is acted by pc-2.
    const result = registry.invoke(
      'adjust_hp',
      { amount: -4 },
      makeCtx(db, { actingCharacterId: 'pc-2' }),
    );

    expect(result.ok).toBe(true);
    expect(hp(db, 'pc-2')).toBe(6);
    expect(hp(db, 'pc-1')).toBe(10);
  });

  it('falls back to the active PC when no acting PC is given', () => {
    const db = freshDb();
    ensureCharacterRow(db, 'pc-2', 'test', 'session-1', AT);
    setHp(db, 'pc-1', 10, 10);
    setHp(db, 'pc-2', 10, 10);
    setActiveCharacterId(db, 'pc-2');

    registry.invoke('adjust_hp', { amount: -3 }, makeCtx(db));

    expect(hp(db, 'pc-2')).toBe(7);
    expect(hp(db, 'pc-1')).toBe(10);
  });

  it('renders the acting PC sheet as the context subject', () => {
    const db = freshDb();
    ensureCharacterRow(db, 'pc-2', 'test', 'session-1', AT);
    mutateState(db, {
      target: 'character',
      id: 'pc-2',
      field: 'name',
      op: 'set',
      value: 'Brielle',
      provenance: 'test',
      sessionId: 'session-1',
      at: AT,
    });

    const assembled = assembleContext({
      db,
      campaignId: 'campaign-1',
      campaignPosition: 'test-position',
      sessionId: 'session-1',
      playerInput: 'look around',
      actingCharacterId: 'pc-2',
    });

    expect(assembled.state.character.id).toBe('pc-2');
    expect(assembled.state.character.name).toBe('Brielle');
  });
});
