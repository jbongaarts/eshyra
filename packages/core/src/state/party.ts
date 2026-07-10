import type { Db } from '../persistence/db.js';
import { jsonColumn } from '../persistence/jsonColumn.js';
import { tryGetActiveCharacterId } from './activeCharacter.js';
import type { LifeState } from './hpLifecycle.js';
import type { CharacterConditionEntry } from './liveStateSchema.js';
import { validateConditionsJson } from './liveStateSchema.js';

/**
 * Compact roster entry for one party member. Detailed sheets (ability scores,
 * inventory) are read per-character via the context assembler; this projection
 * is the at-a-glance status the prompt and CLI use to show the whole party.
 */
export interface PartyMember {
  id: string;
  name: string | undefined;
  ancestry: string | undefined;
  className: string | undefined;
  level: number;
  hpCurrent: number;
  hpMax: number;
  hpTemp: number;
  lifeState: LifeState;
  deathSaveSuccesses: number;
  deathSaveFailures: number;
  conditions: readonly CharacterConditionEntry[];
  role: string;
  isActive: boolean;
}

const conditionsColumn = jsonColumn<unknown>('character.conditions_json');

interface PartyRow {
  id: string;
  name: string | null;
  ancestry: string | null;
  class_name: string | null;
  level: number;
  hp_current: number;
  hp_max: number;
  hp_temp: number;
  life_state: LifeState;
  death_save_successes: number;
  death_save_failures: number;
  conditions_json: string;
  role: string;
}

/**
 * List every party member. Player characters (`role = 'pc'`) sort first, then
 * other roles (companions, familiars, hirelings); within each group rows sort
 * by id so the order is deterministic. The active PC
 * (`meta.active_character_id`) is flagged.
 */
export function listParty(db: Db): PartyMember[] {
  const activeId = tryGetActiveCharacterId(db);
  const rows = db
    .prepare(
      `SELECT id, name, ancestry, class_name, level, hp_current, hp_max,
              hp_temp, life_state, death_save_successes, death_save_failures,
              conditions_json, role
       FROM character
       ORDER BY CASE WHEN role = 'pc' THEN 0 ELSE 1 END, id`,
    )
    .all() as PartyRow[];

  return rows.map((row) => ({
    id: row.id,
    name: row.name ?? undefined,
    ancestry: row.ancestry ?? undefined,
    className: row.class_name ?? undefined,
    level: row.level,
    hpCurrent: row.hp_current,
    hpMax: row.hp_max,
    hpTemp: row.hp_temp,
    lifeState: row.life_state,
    deathSaveSuccesses: row.death_save_successes,
    deathSaveFailures: row.death_save_failures,
    conditions: validateConditionsJson(
      conditionsColumn.decode(row.conditions_json),
      `character[${row.id}].conditions_json`,
    ),
    role: row.role,
    isActive: row.id === activeId,
  }));
}
