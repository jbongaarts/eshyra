// Live-state JSON column shape validators.
//
// These hand-written validators guard the three structured JSON columns that
// are read and written on every turn: `character.ability_scores_json`,
// `character.conditions_json`, and `inventory.properties_json`. The shapes are
// small, gameplay-central, and stable enough to warrant strict validation at
// both the write boundary (mutateState) and the read boundary (contextAssembler).
//
// Error class: `LiveStateSchemaError` — internal surface only. The public error
// that callers see at the write boundary is `MutateStateError`; mutateState.ts
// wraps LiveStateSchemaError before re-throwing.
//
// JsonValue — standard recursive JSON-plain-data union used by extension
// fields in CharacterConditionEntry and InventoryItemProperties. `undefined`
// is intentionally absent (JSON.parse never produces it).

import {
  LIVE_STATE_MAX_ABILITY_SCORE,
  LIVE_STATE_MIN_ABILITY_SCORE,
} from '../character/abilities.js';
import type { AbilityScoreName, AbilityScores } from '../character/creation.js';

export type { AbilityScoreName, AbilityScores };

// ---------------------------------------------------------------------------
// JsonValue
// ---------------------------------------------------------------------------

export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { readonly [k: string]: JsonValue };

// ---------------------------------------------------------------------------
// CharacterConditionEntry
// ---------------------------------------------------------------------------

export interface CharacterConditionEntry {
  readonly id: string;
  readonly [key: string]: JsonValue | undefined;
}

// ---------------------------------------------------------------------------
// InventoryItemProperties
// ---------------------------------------------------------------------------

export type InventoryItemProperties = { readonly [k: string]: JsonValue };

// ---------------------------------------------------------------------------
// Error class
// ---------------------------------------------------------------------------

export class LiveStateSchemaError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LiveStateSchemaError';
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const ABILITY_SCORE_KEYS: readonly AbilityScoreName[] = [
  'strength',
  'dexterity',
  'constitution',
  'intelligence',
  'wisdom',
  'charisma',
];

function assertPlainJsonObject(
  value: unknown,
  path: string,
): asserts value is Record<string, JsonValue> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new LiveStateSchemaError(`${path} must be a non-null object`);
  }
  const proto = Object.getPrototypeOf(value) as unknown;
  if (proto !== Object.prototype && proto !== null) {
    throw new LiveStateSchemaError(`${path} must be a plain JSON object`);
  }
}

/**
 * Walk a value and verify every leaf is a valid JSON plain-data type.
 * Rejects `undefined`, `NaN`, `Infinity`, functions, and class instances.
 */
function assertJsonValue(value: unknown, path: string): void {
  if (value === null) return;
  if (typeof value === 'boolean') return;
  if (typeof value === 'string') return;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new LiveStateSchemaError(
        `${path} must be a finite number (got ${value})`,
      );
    }
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item, i) => {
      assertJsonValue(item, `${path}[${i}]`);
    });
    return;
  }
  if (typeof value === 'object') {
    assertPlainJsonObject(value, path);
    for (const [k, v] of Object.entries(value)) {
      assertJsonValue(v, `${path}.${k}`);
    }
    return;
  }
  throw new LiveStateSchemaError(
    `${path} contains a non-JSON value (type: ${typeof value})`,
  );
}

// ---------------------------------------------------------------------------
// Validators
// ---------------------------------------------------------------------------

/**
 * Validate a parsed ability-scores JSON value. Expects exactly the six
 * canonical D&D / PF2e keys, each an integer in [1, 30].
 *
 * @throws {LiveStateSchemaError}
 */
export function validateAbilityScoresJson(
  value: unknown,
  path: string,
): AbilityScores {
  assertPlainJsonObject(value, path);
  const obj = value as Record<string, unknown>;

  // Must have exactly the six canonical keys — no more, no less.
  const keys = Object.keys(obj);
  for (const key of ABILITY_SCORE_KEYS) {
    if (!Object.hasOwn(obj, key)) {
      throw new LiveStateSchemaError(
        `${path} is missing required key '${key}'`,
      );
    }
  }
  for (const key of keys) {
    if (!(ABILITY_SCORE_KEYS as readonly string[]).includes(key)) {
      throw new LiveStateSchemaError(`${path} contains unknown key '${key}'`);
    }
  }

  // Each value must be a finite integer in [0, 30].
  for (const key of ABILITY_SCORE_KEYS) {
    const score = obj[key];
    if (
      typeof score !== 'number' ||
      !Number.isFinite(score) ||
      !Number.isInteger(score)
    ) {
      throw new LiveStateSchemaError(`${path}.${key} must be a finite integer`);
    }
    if (
      score < LIVE_STATE_MIN_ABILITY_SCORE ||
      score > LIVE_STATE_MAX_ABILITY_SCORE
    ) {
      throw new LiveStateSchemaError(
        `${path}.${key} must be between ${LIVE_STATE_MIN_ABILITY_SCORE} and ${LIVE_STATE_MAX_ABILITY_SCORE} (got ${score})`,
      );
    }
  }

  return obj as unknown as AbilityScores;
}

/**
 * Validate a parsed conditions JSON value. Expects an array of objects each
 * with a non-empty `id` string; additional fields are permitted as long as
 * they are valid JSON values.
 *
 * @throws {LiveStateSchemaError}
 */
export function validateConditionsJson(
  value: unknown,
  path: string,
): readonly CharacterConditionEntry[] {
  if (!Array.isArray(value)) {
    throw new LiveStateSchemaError(`${path} must be an array`);
  }

  for (let i = 0; i < value.length; i++) {
    const entry = value[i];
    const entryPath = `${path}[${i}]`;

    assertPlainJsonObject(entry, entryPath);
    const entryObj = entry as Record<string, unknown>;
    if (typeof entryObj.id !== 'string' || entryObj.id.length === 0) {
      throw new LiveStateSchemaError(
        `${entryPath}.id must be a non-empty string`,
      );
    }

    // Validate any extra fields as JsonValue.
    for (const [k, v] of Object.entries(entryObj)) {
      if (k === 'id') continue;
      assertJsonValue(v, `${entryPath}.${k}`);
    }
  }

  return value as readonly CharacterConditionEntry[];
}

/**
 * Validate a parsed inventory properties JSON value. Expects a plain JSON
 * object whose every nested value is a valid JSON plain-data type (no NaN,
 * Infinity, undefined, or non-plain-object instances).
 *
 * @throws {LiveStateSchemaError}
 */
export function validateInventoryPropertiesJson(
  value: unknown,
  path: string,
): InventoryItemProperties {
  assertPlainJsonObject(value, path);
  for (const [k, v] of Object.entries(value)) {
    assertJsonValue(v, `${path}.${k}`);
  }

  return value as InventoryItemProperties;
}
