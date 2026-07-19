import type { Db } from '../persistence/db.js';
import { withTransaction } from '../persistence/db.js';
import { JsonColumnError, jsonColumn } from '../persistence/jsonColumn.js';
import { requireNonEmpty } from '../validation.js';
import { resolveCharacterId } from './activeCharacter.js';
import { itemAdoptionReviewBlockMessage } from './itemAdoptionReview.js';
import {
  LiveStateSchemaError,
  validateAbilityScoresJson,
  validateConditionsJson,
  validateInventoryPropertiesJson,
} from './liveStateSchema.js';

// Trust boundary (2026-07-12 F3 mutation audit,
// docs/audits/2026-07-12-f3-mutation-lifecycle-audit.md §5/§6):
// `mutateState` / `mutateStateBatch` are the TRUSTED INTERNAL persistence
// seam the domain operations are built on. They validate shape, field
// allowlists, and provenance, but deliberately perform NO lifecycle
// reactions — writing a lifecycle-owned field here (hp_current, hp_temp,
// life_state, death saves, conditions_json, and the combatant analogues)
// skips the F6 death machine, attunement release, and F3 concentration
// breaks. Those fields are written through their domain operations
// (hpLifecycle, domainMutations, activeEffects, encounterCombatants);
// direct calls are reserved for trusted domain code, creation/import/
// level-up projection, and test setup. This module is exported from
// `@eshyra/core/internal` only and MUST NOT be wrapped into a model-facing
// tool: the historical general `mutate_state` tool wrapper was deleted by
// PR #437 for exactly this reason, and tools.test.ts pins that no such
// tool exists in the default registry.

/**
 * Codec for the JSON-valued columns mutate_state writes — plot_flags /
 * overlay_facts `value_json` and the character / inventory `*_json` fields.
 * {@link serializeJsonValue} / {@link parseOrUseJsonValue} wrap it so a codec
 * failure surfaces as the domain {@link MutateStateError}.
 */
const jsonValueColumn = jsonColumn<unknown>('mutate_state JSON value');

export type MutateStateTarget =
  | 'character'
  | 'inventory'
  | 'plot_flags'
  | 'clock'
  | 'overlay_facts';
export type MutateStateOp = 'set';
export type MutateStateValue =
  | string
  | number
  | boolean
  | null
  | Record<string, unknown>
  | Array<unknown>;

export interface MutateStateInput {
  target: MutateStateTarget;
  id?: string;
  field: string;
  op: MutateStateOp;
  value: MutateStateValue;
  provenance: string;
  sessionId: string;
  at: string;
}

export interface MutateStateBatchOptions {
  /**
   * Invoked once per mutation, with that mutation's index, immediately after it
   * is applied. The call happens **inside the batch transaction, before
   * commit** (see {@link mutateStateBatch}): it observes state that is not yet
   * durable, and throwing from it rolls the whole batch back. It is a supported
   * veto / mid-batch failure hook — not a post-commit or progress-durability
   * signal. A caller that needs a durable per-mutation signal must react to a
   * successful return of `mutateStateBatch`, not to this callback.
   */
  afterMutation?: (index: number) => void;
}

export interface StateProvenanceQuery {
  target: MutateStateTarget;
  id?: string;
  field: string;
}

export interface StateProvenanceRecord {
  target: MutateStateTarget;
  id?: string;
  field: string;
  provenance: string;
  sessionId: string;
  updatedAt: string;
}

/**
 * Per-table descriptor for every column mutate_state is allowed to write.
 *
 * Single source of truth for two coupled concerns: which fields are writable
 * (SQL safety — the field name is interpolated into UPDATE/INSERT statements
 * so it must be allowlisted) and how the incoming value must be typed before
 * being bound. Adding or renaming a writable column means editing one entry
 * here instead of two parallel Sets. The descriptors still have to be kept in
 * sync with `persistence/schema.ts` by hand.
 */
type FieldDescriptor =
  | { kind: 'text'; nullable: boolean }
  | { kind: 'text-enum'; values: readonly string[] }
  | { kind: 'integer'; min: number; max?: number }
  | { kind: 'json'; root: 'array' | 'object' }
  | {
      kind: 'shaped-json';
      root: 'array' | 'object';
      validate: (parsed: unknown, label: string) => void;
    };

const CHARACTER_FIELDS: Record<string, FieldDescriptor> = {
  name: { kind: 'text', nullable: true },
  ancestry: { kind: 'text', nullable: true },
  class_name: { kind: 'text', nullable: true },
  level: { kind: 'integer', min: 1 },
  current_xp: { kind: 'integer', min: 0 },
  hp_current: { kind: 'integer', min: 0 },
  hp_max: { kind: 'integer', min: 0 },
  hp_temp: { kind: 'integer', min: 0 },
  life_state: {
    kind: 'text-enum',
    values: ['alive', 'dying', 'stable', 'dead'],
  },
  death_save_successes: { kind: 'integer', min: 0, max: 3 },
  death_save_failures: { kind: 'integer', min: 0, max: 3 },
  ability_scores_json: {
    kind: 'shaped-json',
    root: 'object',
    validate: validateAbilityScoresJson,
  },
  conditions_json: {
    kind: 'shaped-json',
    root: 'array',
    validate: validateConditionsJson,
  },
};

const INVENTORY_FIELDS: Record<string, FieldDescriptor> = {
  name: { kind: 'text', nullable: false },
  quantity: { kind: 'integer', min: 0 },
  location: { kind: 'text', nullable: true },
  properties_json: {
    kind: 'shaped-json',
    root: 'object',
    validate: validateInventoryPropertiesJson,
  },
};

const CLOCK_FIELDS: Record<string, FieldDescriptor> = {
  in_game_time: { kind: 'text', nullable: false },
  current_location_id: { kind: 'text', nullable: true },
  elapsed_minutes: { kind: 'integer', min: 0 },
  in_game_time_elapsed_minutes: { kind: 'integer', min: 0 },
};

export class MutateStateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MutateStateError';
  }
}

export function mutateState(db: Db, input: MutateStateInput): void {
  validateCommonInput(input);
  if (input.op !== 'set') {
    throw new MutateStateError(`Unsupported mutate_state op: ${input.op}`);
  }

  withTransaction(db, (txnDb) => {
    switch (input.target) {
      case 'character':
        setCharacterField(txnDb, input);
        return;
      case 'inventory':
        setInventoryField(txnDb, input);
        return;
      case 'plot_flags':
        setKeyedJsonFact(txnDb, 'plot_flags', input);
        return;
      case 'clock':
        setClockField(txnDb, input);
        return;
      case 'overlay_facts':
        setKeyedJsonFact(txnDb, 'overlay_facts', input);
        return;
      default:
        throw new MutateStateError(
          `Unsupported mutate_state target: ${input.target}`,
        );
    }
  });
}

/**
 * Apply a list of mutations as one atomic transaction: either every mutation
 * commits, or — on any thrown error — none do.
 *
 * `options.afterMutation` runs inside that transaction, after each mutation and
 * before commit, so it sees pre-commit state and a throw from it aborts the
 * whole batch. See {@link MutateStateBatchOptions.afterMutation}.
 */
export function mutateStateBatch(
  db: Db,
  inputs: MutateStateInput[],
  options: MutateStateBatchOptions = {},
): void {
  withTransaction(db, () => {
    inputs.forEach((input, index) => {
      mutateState(db, input);
      options.afterMutation?.(index);
    });
  });
}

export function getStateProvenance(
  db: Db,
  query: StateProvenanceQuery,
): StateProvenanceRecord | undefined {
  switch (query.target) {
    case 'character': {
      requireAllowedField('character', query.field, CHARACTER_FIELDS);
      const characterId = resolveCharacterId(db, query.id);
      return readCharacterProvenance(db, query, characterId);
    }
    case 'clock':
      requireAllowedField('clock', query.field, CLOCK_FIELDS);
      return readSingletonProvenance(db, query, 'clock');
    case 'inventory':
      requireNonEmpty(
        MutateStateError,
        [['id', query.id ?? '']],
        () => 'inventory provenance query id is required',
      );
      requireAllowedField('inventory', query.field, INVENTORY_FIELDS);
      return readInventoryProvenance(db, query);
    case 'plot_flags':
      return readKeyedFactProvenance(db, query, 'plot_flags');
    case 'overlay_facts':
      return readKeyedFactProvenance(db, query, 'overlay_facts');
    default:
      throw new MutateStateError(
        `Unsupported state provenance target: ${query.target}`,
      );
  }
}

function validateCommonInput(input: MutateStateInput): void {
  requireNonEmpty(
    MutateStateError,
    [
      ['provenance', input.provenance],
      ['sessionId', input.sessionId],
      ['timestamp', input.at],
    ],
    (field) => `mutate_state ${field} is required`,
  );
}

function setCharacterField(db: Db, input: MutateStateInput): void {
  const value = validatedFieldValue(
    'character',
    input.field,
    input.value,
    CHARACTER_FIELDS,
  );
  const characterId = resolveCharacterId(db, input.id);
  db.prepare(
    `UPDATE character
     SET ${input.field} = ?,
         provenance = ?,
         session_id = ?,
         updated_at = ?
     WHERE id = ?`,
  ).run(value, input.provenance, input.sessionId, input.at, characterId);
}

function setInventoryField(db: Db, input: MutateStateInput): void {
  requireNonEmpty(
    MutateStateError,
    [['id', input.id ?? '']],
    () => 'inventory mutate_state id is required',
  );
  const quarantine = itemAdoptionReviewBlockMessage(
    db,
    input.id as string,
    'mutate_state',
  );
  if (quarantine !== undefined) throw new MutateStateError(quarantine);
  const value = validatedFieldValue(
    'inventory',
    input.field,
    input.value,
    INVENTORY_FIELDS,
  );
  if (
    input.field === 'quantity' &&
    typeof value === 'number' &&
    value !== 1 &&
    db
      .prepare('SELECT 1 FROM item_state WHERE inventory_id = ?')
      .get(input.id) !== undefined
  ) {
    throw new MutateStateError(
      `stateful inventory item '${input.id}' must have quantity 1`,
    );
  }

  db.prepare(
    `INSERT INTO inventory(
       id,
       name,
       provenance,
       session_id,
       updated_at
     )
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(id) DO NOTHING`,
  ).run(
    input.id,
    input.field === 'name' ? value : input.id,
    input.provenance,
    input.sessionId,
    input.at,
  );
  db.prepare(
    `UPDATE inventory
     SET ${input.field} = ?,
         provenance = ?,
         session_id = ?,
         updated_at = ?
     WHERE id = ?`,
  ).run(value, input.provenance, input.sessionId, input.at, input.id);
}

function setClockField(db: Db, input: MutateStateInput): void {
  const value = validatedFieldValue(
    'clock',
    input.field,
    input.value,
    CLOCK_FIELDS,
  );
  db.prepare(
    `UPDATE clock
     SET ${input.field} = ?,
         provenance = ?,
         session_id = ?,
         updated_at = ?
     WHERE id = 1`,
  ).run(value, input.provenance, input.sessionId, input.at);
}

function requireAllowedField(
  target: string,
  field: string,
  fields: Record<string, FieldDescriptor>,
): void {
  if (!Object.hasOwn(fields, field)) {
    throw new MutateStateError(
      `Unsupported ${target} mutate_state field: ${field}`,
    );
  }
}

function readSingletonProvenance(
  db: Db,
  query: StateProvenanceQuery,
  table: 'character' | 'clock',
): StateProvenanceRecord | undefined {
  const row = db
    .prepare(
      `SELECT provenance, session_id, updated_at
       FROM ${table}
       WHERE id = 1`,
    )
    .get() as ProvenanceRow | undefined;
  return provenanceRecordFromRow(query, row);
}

function readCharacterProvenance(
  db: Db,
  query: StateProvenanceQuery,
  characterId: string,
): StateProvenanceRecord | undefined {
  const row = db
    .prepare(
      `SELECT provenance, session_id, updated_at
       FROM character
       WHERE id = ?`,
    )
    .get(characterId) as ProvenanceRow | undefined;
  return provenanceRecordFromRow(query, row);
}

function readInventoryProvenance(
  db: Db,
  query: StateProvenanceQuery,
): StateProvenanceRecord | undefined {
  const row = db
    .prepare(
      `SELECT provenance, session_id, updated_at
       FROM inventory
       WHERE id = ?`,
    )
    .get(query.id) as ProvenanceRow | undefined;
  return provenanceRecordFromRow(query, row);
}

function readKeyedFactProvenance(
  db: Db,
  query: StateProvenanceQuery,
  table: 'plot_flags' | 'overlay_facts',
): StateProvenanceRecord | undefined {
  const row = db
    .prepare(
      `SELECT provenance, session_id, updated_at
       FROM ${table}
       WHERE key = ?`,
    )
    .get(query.field) as ProvenanceRow | undefined;
  return provenanceRecordFromRow(query, row);
}

interface ProvenanceRow {
  provenance: string;
  session_id: string;
  updated_at: string;
}

function provenanceRecordFromRow(
  query: StateProvenanceQuery,
  row: ProvenanceRow | undefined,
): StateProvenanceRecord | undefined {
  if (row === undefined) {
    return undefined;
  }
  return {
    target: query.target,
    id: query.id,
    field: query.field,
    provenance: row.provenance,
    sessionId: row.session_id,
    updatedAt: row.updated_at,
  };
}

function setKeyedJsonFact(
  db: Db,
  table: 'plot_flags' | 'overlay_facts',
  input: MutateStateInput,
): void {
  const valueJson = serializeJsonValue(input.value, `${table}.${input.field}`);
  db.prepare(
    `INSERT INTO ${table}(
       key,
       value_json,
       provenance,
       session_id,
       updated_at
     )
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET
       value_json = excluded.value_json,
       provenance = excluded.provenance,
       session_id = excluded.session_id,
       updated_at = excluded.updated_at`,
  ).run(input.field, valueJson, input.provenance, input.sessionId, input.at);
}

type SqlValue = string | number | null;

function validatedFieldValue(
  target: string,
  field: string,
  value: MutateStateValue,
  fields: Record<string, FieldDescriptor>,
): SqlValue {
  const descriptor = fields[field];
  if (descriptor === undefined) {
    throw new MutateStateError(
      `Unsupported ${target} mutate_state field: ${field}`,
    );
  }
  switch (descriptor.kind) {
    case 'text':
      return descriptor.nullable
        ? nullableStringValue(target, field, value)
        : requiredStringValue(target, field, value);
    case 'text-enum':
      return enumStringValue(target, field, value, descriptor.values);
    case 'integer':
      return nonNegativeIntegerValue(target, field, value, {
        min: descriptor.min,
        max: descriptor.max,
      });
    case 'json':
      return jsonColumnValue(target, field, value, {
        expectedRoot: descriptor.root,
      });
    case 'shaped-json':
      return shapedJsonColumnValue(target, field, value, {
        expectedRoot: descriptor.root,
        validate: descriptor.validate,
      });
  }
}

function requiredStringValue(
  target: string,
  field: string,
  value: MutateStateValue,
): string {
  if (typeof value !== 'string') {
    throw new MutateStateError(`${target}.${field} must be a string`);
  }
  return value;
}

function nullableStringValue(
  target: string,
  field: string,
  value: MutateStateValue,
): string | null {
  if (value === null) {
    return null;
  }
  return requiredStringValue(target, field, value);
}

function enumStringValue(
  target: string,
  field: string,
  value: MutateStateValue,
  values: readonly string[],
): string {
  if (typeof value !== 'string' || !values.includes(value)) {
    throw new MutateStateError(
      `${target}.${field} must be one of: ${values.join(', ')}`,
    );
  }
  return value;
}

function nonNegativeIntegerValue(
  target: string,
  field: string,
  value: MutateStateValue,
  options: { min: number; max?: number },
): number {
  if (
    typeof value !== 'number' ||
    !Number.isInteger(value) ||
    value < options.min ||
    (options.max !== undefined && value > options.max)
  ) {
    const bounds =
      options.max === undefined
        ? `>= ${options.min}`
        : `between ${options.min} and ${options.max}`;
    throw new MutateStateError(
      `${target}.${field} must be an integer ${bounds}`,
    );
  }
  return value;
}

function jsonColumnValue(
  target: string,
  field: string,
  value: MutateStateValue,
  options: { expectedRoot: 'array' | 'object' },
): string {
  const parsed = parseOrUseJsonValue(target, field, value);
  const rootIsArray = Array.isArray(parsed);
  if (
    (options.expectedRoot === 'array' && !rootIsArray) ||
    (options.expectedRoot === 'object' &&
      (rootIsArray || typeof parsed !== 'object' || parsed === null))
  ) {
    throw new MutateStateError(
      `${target}.${field} must be a JSON ${options.expectedRoot}`,
    );
  }
  return serializeJsonValue(parsed, `${target}.${field}`);
}

function shapedJsonColumnValue(
  target: string,
  field: string,
  value: MutateStateValue,
  options: {
    expectedRoot: 'array' | 'object';
    validate: (parsed: unknown, label: string) => void;
  },
): string {
  const parsed = parseOrUseJsonValue(target, field, value);
  const rootIsArray = Array.isArray(parsed);
  if (
    (options.expectedRoot === 'array' && !rootIsArray) ||
    (options.expectedRoot === 'object' &&
      (rootIsArray || typeof parsed !== 'object' || parsed === null))
  ) {
    throw new MutateStateError(
      `${target}.${field} must be a JSON ${options.expectedRoot}`,
    );
  }
  const label = `${target}.${field}`;
  try {
    options.validate(parsed, label);
  } catch (error) {
    if (error instanceof LiveStateSchemaError) {
      throw new MutateStateError(error.message);
    }
    throw error;
  }
  return serializeJsonValue(parsed, label);
}

function parseOrUseJsonValue(
  target: string,
  field: string,
  value: MutateStateValue,
): unknown {
  if (typeof value !== 'string') {
    return value;
  }
  try {
    return jsonValueColumn.decode(value);
  } catch (error) {
    if (error instanceof JsonColumnError) {
      throw new MutateStateError(`${target}.${field} must be valid JSON`);
    }
    throw error;
  }
}

function serializeJsonValue(value: unknown, label: string): string {
  try {
    return jsonValueColumn.encode(value);
  } catch (error) {
    if (error instanceof JsonColumnError) {
      throw new MutateStateError(`${label} must be JSON-serializable`);
    }
    throw error;
  }
}
