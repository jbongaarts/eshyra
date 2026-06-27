// Durable character progression state and the append-only progression-event
// ledger (eshyra-lupf.2). Design: docs/design/character-progression.md.
//
// This module is storage-only: it persists and validates progression state but
// implements no advancement mechanics. The advancement-mode binding/resolution
// (eshyra-lupf.4), the higher-level award API (eshyra-lupf.6), eligibility
// (eshyra-lupf.7), and the deterministic level-up engine (eshyra-lupf.8) layer
// on top of these helpers.
//
// Three pieces of durable state:
//   - per-character progression state (`character.current_xp` + the existing
//     `character.level`), read via {@link getProgressionState}. XP is *written*
//     through the validated `mutateState` `character.current_xp` field so every
//     change is auditable on the same provenance seam as the rest of the live
//     character row.
//   - the campaign-wide advancement policy (`campaign_progression_policy`
//     singleton), read/written via {@link readCampaignProgressionPolicy} /
//     {@link writeCampaignProgressionPolicy}. Stored at campaign scope because
//     the design note fixes the mode as a campaign/rules-binding property, not
//     per-character authority.
//   - the append-only `progression_event` ledger, written via
//     {@link recordProgressionEvent} and read via {@link listProgressionEvents}
//     / {@link getProgressionEvent}. The ledger is insert-only: corrections are
//     new compensating events, never edits.

import type { Db } from '../persistence/db.js';
import { withTransaction } from '../persistence/db.js';
import { JsonColumnError, jsonColumn } from '../persistence/jsonColumn.js';
import { resolveCharacterId } from './activeCharacter.js';

const appliedChangesColumn = jsonColumn<unknown>(
  'progression_event.applied_changes_json',
);

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Campaign-wide advancement policy: XP thresholds vs DM-granted milestones. */
export type AdvancementMode = 'xp' | 'milestone';

/** The kind of a recorded progression event. */
export type ProgressionEventKind = 'xp-award' | 'milestone-award' | 'level-up';

/** Read view of a character's durable progression state. */
export interface ProgressionState {
  readonly characterId: string;
  /** Current character level (authority lives on the `character` row). */
  readonly level: number;
  /** Running XP total; meaningful in XP mode, otherwise typically 0. */
  readonly currentXp: number;
}

/** The campaign-wide advancement policy record. */
export interface CampaignProgressionPolicy {
  readonly advancementMode: AdvancementMode;
  readonly provenance: string;
  readonly sessionId: string;
  readonly updatedAt: string;
}

/** Input to set the campaign-wide advancement policy. */
export interface WriteCampaignProgressionPolicyInput {
  readonly advancementMode: AdvancementMode;
  readonly provenance: string;
  readonly sessionId: string;
  readonly at: string;
}

/** A persisted, append-only progression-event ledger row. */
export interface ProgressionEventRecord {
  readonly id: string;
  readonly characterId: string;
  readonly kind: ProgressionEventKind;
  /** XP delta for `xp-award`; absent otherwise. */
  readonly amount?: number;
  /** Milestone description for `milestone-award`; absent otherwise. */
  readonly milestoneLabel?: string;
  /** Who/what caused the event (DM ruling, encounter, quest, manual, …). */
  readonly source: string;
  /** XP total after the event; absent in milestone mode. */
  readonly resultingXp?: number;
  /** Character level after the event. */
  readonly resultingLevel: number;
  /** Deterministic level-up change set (level-up only); opaque to this module. */
  readonly appliedChanges?: unknown;
  readonly occurredAt: string;
  readonly provenance: string;
  readonly sessionId: string;
}

/** Input to append one progression event. `id` is generated when omitted. */
export interface RecordProgressionEventInput {
  readonly id?: string;
  readonly characterId?: string;
  readonly kind: ProgressionEventKind;
  readonly amount?: number;
  readonly milestoneLabel?: string;
  readonly source: string;
  readonly resultingXp?: number;
  readonly resultingLevel: number;
  readonly appliedChanges?: unknown;
  readonly occurredAt: string;
  readonly provenance: string;
  readonly sessionId: string;
}

export class ProgressionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ProgressionError';
  }
}

// ---------------------------------------------------------------------------
// Per-character progression state
// ---------------------------------------------------------------------------

interface ProgressionStateRow {
  level: number;
  current_xp: number;
}

/**
 * Read a character's durable progression state (level + current XP). Resolves
 * the active character when `characterId` is omitted.
 *
 * @throws {ProgressionError} if the character row does not exist.
 */
export function getProgressionState(
  db: Db,
  characterId?: string,
): ProgressionState {
  const id = resolveCharacterId(db, characterId);
  const row = db
    .prepare('SELECT level, current_xp FROM character WHERE id = ?')
    .get(id) as ProgressionStateRow | undefined;
  if (row === undefined) {
    throw new ProgressionError(`no character '${id}'`);
  }
  return { characterId: id, level: row.level, currentXp: row.current_xp };
}

// ---------------------------------------------------------------------------
// Campaign advancement policy (singleton)
// ---------------------------------------------------------------------------

const ADVANCEMENT_MODES = new Set<AdvancementMode>(['xp', 'milestone']);

interface CampaignProgressionPolicyRow {
  advancement_mode: AdvancementMode;
  provenance: string;
  session_id: string;
  updated_at: string;
}

/**
 * Read the campaign-wide advancement policy, or `undefined` when none has been
 * set yet. Defaulting/resolution against the rules binding is owned by
 * eshyra-lupf.4; this module returns exactly what is stored.
 */
export function readCampaignProgressionPolicy(
  db: Db,
): CampaignProgressionPolicy | undefined {
  const row = db
    .prepare(
      `SELECT advancement_mode, provenance, session_id, updated_at
       FROM campaign_progression_policy WHERE id = 1`,
    )
    .get() as CampaignProgressionPolicyRow | undefined;
  if (row === undefined) {
    return undefined;
  }
  return {
    advancementMode: row.advancement_mode,
    provenance: row.provenance,
    sessionId: row.session_id,
    updatedAt: row.updated_at,
  };
}

/**
 * Set (or replace) the campaign-wide advancement policy.
 *
 * @throws {ProgressionError} on an unknown advancement mode or empty audit
 *   fields.
 */
export function writeCampaignProgressionPolicy(
  db: Db,
  input: WriteCampaignProgressionPolicyInput,
): CampaignProgressionPolicy {
  if (!ADVANCEMENT_MODES.has(input.advancementMode)) {
    throw new ProgressionError(
      `unsupported advancement mode '${input.advancementMode}'`,
    );
  }
  requireNonEmpty('provenance', input.provenance);
  requireNonEmpty('sessionId', input.sessionId);
  requireNonEmpty('at', input.at);

  db.prepare(
    `INSERT OR REPLACE INTO campaign_progression_policy(
       id, advancement_mode, provenance, session_id, updated_at
     ) VALUES (1, ?, ?, ?, ?)`,
  ).run(input.advancementMode, input.provenance, input.sessionId, input.at);

  return {
    advancementMode: input.advancementMode,
    provenance: input.provenance,
    sessionId: input.sessionId,
    updatedAt: input.at,
  };
}

// ---------------------------------------------------------------------------
// Append-only progression-event ledger
// ---------------------------------------------------------------------------

const PROGRESSION_EVENT_KINDS = new Set<ProgressionEventKind>([
  'xp-award',
  'milestone-award',
  'level-up',
]);

interface ProgressionEventRow {
  id: string;
  character_id: string;
  kind: ProgressionEventKind;
  amount: number | null;
  milestone_label: string | null;
  source: string;
  resulting_xp: number | null;
  resulting_level: number;
  applied_changes_json: string | null;
  occurred_at: string;
  provenance: string;
  session_id: string;
}

/**
 * Append one event to the progression ledger. The ledger is insert-only:
 * corrections are recorded as new compensating events, never edits. Resolves
 * the active character when `characterId` is omitted and generates a
 * per-character `id` when one is not supplied.
 *
 * Validates structure only (kind enum, per-kind required/forbidden fields,
 * integer bounds, JSON-serializable change set). Award business rules belong to
 * the higher-level award API (eshyra-lupf.6).
 *
 * @throws {ProgressionError} on a structural violation.
 */
export function recordProgressionEvent(
  db: Db,
  input: RecordProgressionEventInput,
): ProgressionEventRecord {
  validateEventInput(input);
  return withTransaction(db, (txnDb) => {
    const characterId = resolveCharacterId(txnDb, input.characterId);
    const id = input.id ?? nextProgressionEventId(txnDb, characterId);
    const appliedChangesJson =
      input.appliedChanges === undefined
        ? null
        : encodeAppliedChanges(input.appliedChanges);

    txnDb
      .prepare(
        `INSERT INTO progression_event(
           id, character_id, kind, amount, milestone_label, source,
           resulting_xp, resulting_level, applied_changes_json, occurred_at,
           provenance, session_id
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        characterId,
        input.kind,
        input.amount ?? null,
        input.milestoneLabel ?? null,
        input.source,
        input.resultingXp ?? null,
        input.resultingLevel,
        appliedChangesJson,
        input.occurredAt,
        input.provenance,
        input.sessionId,
      );

    const record = getProgressionEvent(txnDb, id);
    if (record === undefined) {
      throw new ProgressionError(`failed to record progression event '${id}'`);
    }
    return record;
  });
}

/** Read a single progression event by id. */
export function getProgressionEvent(
  db: Db,
  id: string,
): ProgressionEventRecord | undefined {
  const row = db
    .prepare('SELECT * FROM progression_event WHERE id = ?')
    .get(id) as ProgressionEventRow | undefined;
  return row === undefined ? undefined : rowToRecord(row);
}

/**
 * List a character's progression events in chronological order
 * (`occurred_at`, then `id` to break ties deterministically). Resolves the
 * active character when `characterId` is omitted.
 */
export function listProgressionEvents(
  db: Db,
  characterId?: string,
): ProgressionEventRecord[] {
  const id = resolveCharacterId(db, characterId);
  const rows = db
    .prepare(
      `SELECT * FROM progression_event
       WHERE character_id = ?
       ORDER BY occurred_at, id`,
    )
    .all(id) as ProgressionEventRow[];
  return rows.map(rowToRecord);
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

function validateEventInput(input: RecordProgressionEventInput): void {
  if (!PROGRESSION_EVENT_KINDS.has(input.kind)) {
    throw new ProgressionError(
      `unsupported progression event kind '${input.kind}'`,
    );
  }
  requireNonEmpty('source', input.source);
  requireNonEmpty('occurredAt', input.occurredAt);
  requireNonEmpty('provenance', input.provenance);
  requireNonEmpty('sessionId', input.sessionId);
  if (input.id !== undefined) requireNonEmpty('id', input.id);

  requireInteger('resultingLevel', input.resultingLevel, { min: 1 });
  if (input.amount !== undefined) {
    requireInteger('amount', input.amount, { min: 0 });
  }
  if (input.resultingXp !== undefined) {
    requireInteger('resultingXp', input.resultingXp, { min: 0 });
  }
  if (input.milestoneLabel !== undefined) {
    requireNonEmpty('milestoneLabel', input.milestoneLabel);
  }

  // Per-kind shape. Each branch declares every field as required or forbidden so
  // the columns mean exactly what the migration/design comments promise:
  //   - xp-award:        amount + resultingXp; no milestoneLabel/appliedChanges.
  //   - milestone-award: milestoneLabel; no amount/resultingXp/appliedChanges
  //                      (resulting_xp is null in milestone mode).
  //   - level-up:        appliedChanges (the deterministic change set for
  //                      replay/audit); no amount/milestoneLabel. resultingXp is
  //                      optional (present in XP mode, absent in milestone mode).
  switch (input.kind) {
    case 'xp-award':
      if (input.amount === undefined) {
        throw new ProgressionError('xp-award requires an amount');
      }
      if (input.resultingXp === undefined) {
        throw new ProgressionError('xp-award requires resultingXp');
      }
      if (input.milestoneLabel !== undefined) {
        throw new ProgressionError('xp-award must not carry a milestoneLabel');
      }
      if (input.appliedChanges !== undefined) {
        throw new ProgressionError('xp-award must not carry appliedChanges');
      }
      break;
    case 'milestone-award':
      if (input.milestoneLabel === undefined) {
        throw new ProgressionError('milestone-award requires a milestoneLabel');
      }
      if (input.amount !== undefined) {
        throw new ProgressionError('milestone-award must not carry an amount');
      }
      if (input.resultingXp !== undefined) {
        throw new ProgressionError(
          'milestone-award must not carry resultingXp',
        );
      }
      if (input.appliedChanges !== undefined) {
        throw new ProgressionError(
          'milestone-award must not carry appliedChanges',
        );
      }
      break;
    case 'level-up':
      if (input.appliedChanges === undefined) {
        throw new ProgressionError('level-up requires appliedChanges');
      }
      if (input.amount !== undefined) {
        throw new ProgressionError('level-up must not carry an amount');
      }
      if (input.milestoneLabel !== undefined) {
        throw new ProgressionError('level-up must not carry a milestoneLabel');
      }
      break;
  }
}

function encodeAppliedChanges(value: unknown): string {
  try {
    return appliedChangesColumn.encode(value);
  } catch (error) {
    if (error instanceof JsonColumnError) {
      throw new ProgressionError('appliedChanges must be JSON-serializable');
    }
    throw error;
  }
}

function decodeAppliedChanges(json: string): unknown {
  try {
    return appliedChangesColumn.decode(json);
  } catch (error) {
    if (error instanceof JsonColumnError) {
      throw new ProgressionError(
        'stored applied_changes_json is not valid JSON',
      );
    }
    throw error;
  }
}

function nextProgressionEventId(db: Db, characterId: string): string {
  const row = db
    .prepare(
      'SELECT COUNT(*) AS count FROM progression_event WHERE character_id = ?',
    )
    .get(characterId) as { count: number };
  return `prog-${characterId}-${row.count + 1}`;
}

function rowToRecord(row: ProgressionEventRow): ProgressionEventRecord {
  return {
    id: row.id,
    characterId: row.character_id,
    kind: row.kind,
    ...(row.amount === null ? {} : { amount: row.amount }),
    ...(row.milestone_label === null
      ? {}
      : { milestoneLabel: row.milestone_label }),
    source: row.source,
    ...(row.resulting_xp === null ? {} : { resultingXp: row.resulting_xp }),
    resultingLevel: row.resulting_level,
    ...(row.applied_changes_json === null
      ? {}
      : { appliedChanges: decodeAppliedChanges(row.applied_changes_json) }),
    occurredAt: row.occurred_at,
    provenance: row.provenance,
    sessionId: row.session_id,
  };
}

function requireNonEmpty(field: string, value: string): void {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new ProgressionError(`progression ${field} is required`);
  }
}

function requireInteger(
  field: string,
  value: number,
  options: { min: number },
): void {
  if (
    typeof value !== 'number' ||
    !Number.isInteger(value) ||
    value < options.min
  ) {
    throw new ProgressionError(
      `progression ${field} must be an integer >= ${options.min}`,
    );
  }
}
