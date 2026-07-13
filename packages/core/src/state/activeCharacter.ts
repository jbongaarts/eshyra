import type { Db } from '../persistence/db.js';

const ACTIVE_CHARACTER_KEY = 'active_character_id';

export class NoActiveCharacterError extends Error {
  constructor() {
    super('no active character is set');
    this.name = 'NoActiveCharacterError';
  }
}

export class CharacterResolutionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CharacterResolutionError';
  }
}

export function getActiveCharacterId(db: Db): string {
  const row = db
    .prepare('SELECT value FROM meta WHERE key = ?')
    .get(ACTIVE_CHARACTER_KEY) as { value: string } | undefined;
  if (row === undefined) {
    throw new NoActiveCharacterError();
  }
  return row.value;
}

export function tryGetActiveCharacterId(db: Db): string | undefined {
  const row = db
    .prepare('SELECT value FROM meta WHERE key = ?')
    .get(ACTIVE_CHARACTER_KEY) as { value: string } | undefined;
  return row?.value;
}

/**
 * Set the active character. The active/acting unit must be an existing
 * player-character row (`role = 'pc'`); companions, familiars, and hirelings
 * are party members but are never the active PC. Rejects a missing or non-PC
 * id with `CharacterResolutionError` rather than silently storing a dangling
 * reference that would later fault the context assembler.
 */
export function setActiveCharacterId(db: Db, characterId: string): void {
  const row = db
    .prepare('SELECT role FROM character WHERE id = ?')
    .get(characterId) as { role: string } | undefined;
  if (row === undefined) {
    throw new CharacterResolutionError(
      `cannot set active character: no character '${characterId}'`,
    );
  }
  if (row.role !== 'pc') {
    throw new CharacterResolutionError(
      `cannot set active character: '${characterId}' is a ${row.role}, not a player character`,
    );
  }
  db.prepare('INSERT OR REPLACE INTO meta(key, value) VALUES (?, ?)').run(
    ACTIVE_CHARACTER_KEY,
    characterId,
  );
}

export function resolveCharacterId(db: Db, explicitId?: string): string {
  if (explicitId !== undefined) {
    return explicitId;
  }
  return getActiveCharacterId(db);
}

/**
 * Resolve the acting player character for a turn: the explicit id when given,
 * otherwise the active character. The acting unit must be an existing row with
 * `role = 'pc'` — companions, familiars, and hirelings may be tool targets but
 * never the acting PC. Rejects a missing or non-PC id with
 * `CharacterResolutionError` so callers fail in a controlled way instead of
 * dereferencing a dangling reference. This is the single gate every
 * acting-character path (context assembly, runTurn trace, tool context) routes
 * through; broader by-id/by-name targeting stays in `resolveCharacterRef`.
 */
export function resolveActingCharacterId(db: Db, explicitId?: string): string {
  const id = resolveCharacterId(db, explicitId);
  const row = db.prepare('SELECT role FROM character WHERE id = ?').get(id) as
    | { role: string }
    | undefined;
  if (row === undefined) {
    throw new CharacterResolutionError(
      `acting character '${id}' has no character row`,
    );
  }
  if (row.role !== 'pc') {
    throw new CharacterResolutionError(
      `acting character '${id}' is a ${row.role}, not a player character`,
    );
  }
  return id;
}

/**
 * Resolve a player-or-model supplied character reference (an exact row id or a
 * character name) to a concrete `character.id`. Names match case-insensitively.
 * Throws `CharacterResolutionError` when the ref matches no member or more than
 * one — the caller turns that into a tool correction rather than a hard error.
 */
export function resolveCharacterRef(db: Db, ref: string): string {
  const byId = db.prepare('SELECT id FROM character WHERE id = ?').get(ref) as
    | { id: string }
    | undefined;
  if (byId !== undefined) {
    return byId.id;
  }

  const byName = db
    .prepare('SELECT id FROM character WHERE name = ? COLLATE NOCASE')
    .all(ref) as { id: string }[];
  const firstMatch = byName[0];
  if (byName.length === 1 && firstMatch !== undefined) {
    return firstMatch.id;
  }
  if (byName.length === 0) {
    throw new CharacterResolutionError(`unknown character: ${ref}`);
  }
  throw new CharacterResolutionError(
    `ambiguous character reference '${ref}' matches ${byName.length} party members; use the character id`,
  );
}

const DEFAULT_ABILITY_SCORES =
  '{"strength":10,"dexterity":10,"constitution":10,"intelligence":10,"wisdom":10,"charisma":10}';

export function ensureCharacterRow(
  db: Db,
  characterId: string,
  provenance: string,
  sessionId: string,
  at: string,
): void {
  db.prepare(
    `INSERT OR IGNORE INTO character(id, ability_scores_json, role, provenance, session_id, updated_at)
     VALUES (?, ?, 'pc', ?, ?, ?)`,
  ).run(characterId, DEFAULT_ABILITY_SCORES, provenance, sessionId, at);
}
