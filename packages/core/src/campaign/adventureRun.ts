// Campaign-owned adventure run / module binding (eshyra-eh54.4).
//
// This is MUTABLE campaign-instance state (ADR 0012's fourth layer), NOT a
// fifth top-level content/state layer and not an "adventure instance" peer. A
// campaign may hold one or more adventure runs; each references an immutable
// adventure module by id and records that campaign's progress through it.
//
// The referenced module source is never written back here — progress lives
// only in the `adventure_run` table, so the authored module stays immutable and
// a campaign can bind to it repeatedly. Runtime reconciliation of this progress
// against the loaded module is a later concern (eshyra-eh54.5).

import type { Db } from '../persistence/db.js';
import { withTransaction } from '../persistence/db.js';
import { jsonColumn } from '../persistence/jsonColumn.js';
import { requireNonEmpty } from '../validation.js';

export class AdventureRunError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AdventureRunError';
  }
}

/** Lifecycle of a campaign's run through one module. */
export type AdventureRunStatus = 'active' | 'completed' | 'abandoned';

const RUN_STATUSES: readonly AdventureRunStatus[] = [
  'active',
  'completed',
  'abandoned',
];

/** How an encounter resolved in play. */
export type EncounterResolution =
  | 'defeated'
  | 'bypassed'
  | 'fled'
  | 'negotiated'
  | 'other';

const ENCOUNTER_RESOLUTIONS: readonly EncounterResolution[] = [
  'defeated',
  'bypassed',
  'fled',
  'negotiated',
  'other',
];

export interface AdventureEncounterOutcome {
  readonly encounterId: string;
  readonly outcome: EncounterResolution;
  readonly note?: string;
}

/** Current fill of a module clock/threat. Authored segment count lives on the
 * module; only the live fill level is campaign state. */
export interface AdventureClockState {
  readonly clockId: string;
  readonly filled: number;
}

/**
 * An explicit, player-driven divergence from an authored module assumption,
 * recorded as a campaign fact rather than an edit to the module source.
 */
export interface AdventureModuleDeviation {
  readonly id: string;
  readonly description: string;
}

/**
 * Mutable progress through one module. Every field is campaign-owned play
 * history; none of it exists on the authored module. Id arrays carry module
 * child ids (locations, scenes, secrets, objectives, treasure) the campaign has
 * touched — the module defines the possibilities, this records what happened.
 */
export interface AdventureRunProgress {
  readonly visitedLocations: readonly string[];
  readonly completedOrBypassedScenes: readonly string[];
  readonly revealedSecrets: readonly string[];
  readonly completedObjectives: readonly string[];
  readonly failedObjectives: readonly string[];
  readonly encounterOutcomes: readonly AdventureEncounterOutcome[];
  readonly claimedTreasure: readonly string[];
  readonly activeClocks: readonly AdventureClockState[];
  readonly deviations: readonly AdventureModuleDeviation[];
}

export interface AdventureRun {
  readonly campaignId: string;
  readonly runId: string;
  /** The immutable adventure module this run is bound to. */
  readonly moduleId: string;
  readonly status: AdventureRunStatus;
  readonly startedAtSessionId: string | undefined;
  readonly completedAtSessionId: string | undefined;
  readonly progress: AdventureRunProgress;
  readonly notes: string;
}

export interface AdventureRunKey {
  readonly campaignId: string;
  readonly runId: string;
}

export interface StartAdventureRunInput extends AdventureRunKey {
  readonly moduleId: string;
  readonly status?: AdventureRunStatus;
  readonly startedAtSessionId?: string;
  readonly notes?: string;
  readonly provenance: string;
  readonly sessionId: string;
  readonly updatedAt: string;
}

/**
 * An additive progress delta. Id arrays are unioned into the existing progress
 * (order-preserving, deduped), so re-recording the same id is idempotent —
 * supporting nonlinear, revisitable play. Encounter outcomes and clock states
 * upsert by their id (latest-wins); deviations upsert by id.
 */
export interface AdventureRunProgressDelta {
  readonly visitedLocations?: readonly string[];
  readonly completedOrBypassedScenes?: readonly string[];
  readonly revealedSecrets?: readonly string[];
  readonly completedObjectives?: readonly string[];
  readonly failedObjectives?: readonly string[];
  readonly encounterOutcomes?: readonly AdventureEncounterOutcome[];
  readonly claimedTreasure?: readonly string[];
  readonly activeClocks?: readonly AdventureClockState[];
  readonly deviations?: readonly AdventureModuleDeviation[];
}

export interface RecordAdventureRunProgressInput extends AdventureRunKey {
  readonly delta?: AdventureRunProgressDelta;
  readonly status?: AdventureRunStatus;
  readonly startedAtSessionId?: string;
  readonly completedAtSessionId?: string;
  readonly notes?: string;
  readonly provenance: string;
  readonly sessionId: string;
  readonly updatedAt: string;
}

const EMPTY_PROGRESS: AdventureRunProgress = {
  visitedLocations: [],
  completedOrBypassedScenes: [],
  revealedSecrets: [],
  completedObjectives: [],
  failedObjectives: [],
  encounterOutcomes: [],
  claimedTreasure: [],
  activeClocks: [],
  deviations: [],
};

const progressColumn = jsonColumn<Partial<AdventureRunProgress>>(
  'adventure_run.progress_json',
);

interface AdventureRunRow {
  readonly campaign_id: string;
  readonly run_id: string;
  readonly module_id: string;
  readonly status: string;
  readonly started_at_session_id: string | null;
  readonly completed_at_session_id: string | null;
  readonly progress_json: string;
  readonly notes: string;
}

function assertStatus(status: AdventureRunStatus): void {
  if (!RUN_STATUSES.includes(status)) {
    throw new AdventureRunError(
      `invalid adventure run status '${status}'; expected one of: ${RUN_STATUSES.join(', ')}`,
    );
  }
}

function assertNonEmptyString(value: unknown, where: string): void {
  if (typeof value !== 'string' || value.length === 0) {
    throw new AdventureRunError(`${where} must be a non-empty string`);
  }
}

/** Optional session markers may be omitted, but never the empty string. */
function assertOptionalSessionId(
  value: string | undefined,
  name: string,
): void {
  if (value !== undefined && value.length === 0) {
    throw new AdventureRunError(`${name} must not be empty when provided`);
  }
}

/**
 * Validate a progress delta before it is merged into canonical campaign state.
 * This is the typed write boundary for `adventure_run.progress_json` (no
 * mutateState pass), so it is defensive against untyped JS/runtime callers:
 * ids must be non-empty, encounter outcomes well-formed, clock fills
 * non-negative integers, and deviations fully described.
 */
function validateProgressDelta(delta: AdventureRunProgressDelta): void {
  const idLists: readonly [string, readonly string[] | undefined][] = [
    ['visitedLocations', delta.visitedLocations],
    ['completedOrBypassedScenes', delta.completedOrBypassedScenes],
    ['revealedSecrets', delta.revealedSecrets],
    ['completedObjectives', delta.completedObjectives],
    ['failedObjectives', delta.failedObjectives],
    ['claimedTreasure', delta.claimedTreasure],
  ];
  for (const [field, ids] of idLists) {
    ids?.forEach((id, i) => {
      assertNonEmptyString(id, `${field}[${i}]`);
    });
  }
  delta.encounterOutcomes?.forEach((outcome, i) => {
    assertNonEmptyString(
      outcome.encounterId,
      `encounterOutcomes[${i}].encounterId`,
    );
    if (!ENCOUNTER_RESOLUTIONS.includes(outcome.outcome)) {
      throw new AdventureRunError(
        `encounterOutcomes[${i}].outcome must be one of: ${ENCOUNTER_RESOLUTIONS.join(', ')}`,
      );
    }
  });
  delta.activeClocks?.forEach((clock, i) => {
    assertNonEmptyString(clock.clockId, `activeClocks[${i}].clockId`);
    if (!Number.isInteger(clock.filled) || clock.filled < 0) {
      throw new AdventureRunError(
        `activeClocks[${i}].filled must be a non-negative integer`,
      );
    }
  });
  delta.deviations?.forEach((deviation, i) => {
    assertNonEmptyString(deviation.id, `deviations[${i}].id`);
    assertNonEmptyString(deviation.description, `deviations[${i}].description`);
  });
}

/** Order-preserving union of two id lists. */
function unionIds(
  existing: readonly string[],
  added: readonly string[] | undefined,
): string[] {
  if (added === undefined || added.length === 0) {
    return [...existing];
  }
  const seen = new Set(existing);
  const out = [...existing];
  for (const id of added) {
    if (!seen.has(id)) {
      seen.add(id);
      out.push(id);
    }
  }
  return out;
}

/** Upsert items keyed by `keyOf` (latest-wins), preserving first-seen order. */
function upsertBy<T>(
  existing: readonly T[],
  added: readonly T[] | undefined,
  keyOf: (item: T) => string,
): T[] {
  if (added === undefined || added.length === 0) {
    return [...existing];
  }
  const out = [...existing];
  for (const item of added) {
    const key = keyOf(item);
    const idx = out.findIndex((e) => keyOf(e) === key);
    if (idx === -1) {
      out.push(item);
    } else {
      out[idx] = item;
    }
  }
  return out;
}

function mergeProgress(
  base: AdventureRunProgress,
  delta: AdventureRunProgressDelta | undefined,
): AdventureRunProgress {
  if (delta === undefined) {
    return base;
  }
  return {
    visitedLocations: unionIds(base.visitedLocations, delta.visitedLocations),
    completedOrBypassedScenes: unionIds(
      base.completedOrBypassedScenes,
      delta.completedOrBypassedScenes,
    ),
    revealedSecrets: unionIds(base.revealedSecrets, delta.revealedSecrets),
    completedObjectives: unionIds(
      base.completedObjectives,
      delta.completedObjectives,
    ),
    failedObjectives: unionIds(base.failedObjectives, delta.failedObjectives),
    encounterOutcomes: upsertBy(
      base.encounterOutcomes,
      delta.encounterOutcomes,
      (e) => e.encounterId,
    ),
    claimedTreasure: unionIds(base.claimedTreasure, delta.claimedTreasure),
    activeClocks: upsertBy(
      base.activeClocks,
      delta.activeClocks,
      (c) => c.clockId,
    ),
    deviations: upsertBy(base.deviations, delta.deviations, (d) => d.id),
  };
}

/** Fill any progress fields missing from a stored blob with empty defaults. */
function normalizeProgress(
  partial: Partial<AdventureRunProgress>,
): AdventureRunProgress {
  return {
    visitedLocations: partial.visitedLocations ?? [],
    completedOrBypassedScenes: partial.completedOrBypassedScenes ?? [],
    revealedSecrets: partial.revealedSecrets ?? [],
    completedObjectives: partial.completedObjectives ?? [],
    failedObjectives: partial.failedObjectives ?? [],
    encounterOutcomes: partial.encounterOutcomes ?? [],
    claimedTreasure: partial.claimedTreasure ?? [],
    activeClocks: partial.activeClocks ?? [],
    deviations: partial.deviations ?? [],
  };
}

function rowToRun(row: AdventureRunRow): AdventureRun {
  return {
    campaignId: row.campaign_id,
    runId: row.run_id,
    moduleId: row.module_id,
    status: row.status as AdventureRunStatus,
    startedAtSessionId: row.started_at_session_id ?? undefined,
    completedAtSessionId: row.completed_at_session_id ?? undefined,
    progress: normalizeProgress(progressColumn.decode(row.progress_json)),
    notes: row.notes,
  };
}

export function getAdventureRun(
  db: Db,
  key: AdventureRunKey,
): AdventureRun | undefined {
  const row = db
    .prepare(
      `SELECT campaign_id, run_id, module_id, status, started_at_session_id,
              completed_at_session_id, progress_json, notes
         FROM adventure_run WHERE campaign_id = ? AND run_id = ?`,
    )
    .get(key.campaignId, key.runId) as AdventureRunRow | undefined;
  return row === undefined ? undefined : rowToRun(row);
}

export function listAdventureRuns(
  db: Db,
  selector: { readonly campaignId: string },
): AdventureRun[] {
  const rows = db
    .prepare(
      `SELECT campaign_id, run_id, module_id, status, started_at_session_id,
              completed_at_session_id, progress_json, notes
         FROM adventure_run WHERE campaign_id = ? ORDER BY run_id`,
    )
    .all(selector.campaignId) as AdventureRunRow[];
  return rows.map(rowToRun);
}

/**
 * Start a new campaign-owned adventure run bound to `moduleId`. Throws if a run
 * with the same id already exists in the campaign. The module is referenced by
 * id only; its source is not read or copied here.
 */
export function startAdventureRun(
  db: Db,
  input: StartAdventureRunInput,
): AdventureRun {
  requireNonEmpty(
    AdventureRunError,
    [
      ['campaignId', input.campaignId],
      ['runId', input.runId],
      ['moduleId', input.moduleId],
      ['provenance', input.provenance],
      ['sessionId', input.sessionId],
      ['updatedAt', input.updatedAt],
    ],
    (name) => `startAdventureRun ${name} is required`,
  );
  const status = input.status ?? 'active';
  assertStatus(status);
  assertOptionalSessionId(input.startedAtSessionId, 'startedAtSessionId');

  return withTransaction(db, (txnDb) => {
    if (getAdventureRun(txnDb, input) !== undefined) {
      throw new AdventureRunError(
        `adventure run '${input.runId}' already exists in campaign '${input.campaignId}'`,
      );
    }
    txnDb
      .prepare(
        `INSERT INTO adventure_run(
           campaign_id, run_id, module_id, status, started_at_session_id,
           completed_at_session_id, progress_json, notes,
           provenance, session_id, updated_at
         ) VALUES (?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, ?)`,
      )
      .run(
        input.campaignId,
        input.runId,
        input.moduleId,
        status,
        input.startedAtSessionId ?? null,
        progressColumn.encode(EMPTY_PROGRESS),
        input.notes ?? '',
        input.provenance,
        input.sessionId,
        input.updatedAt,
      );
    return {
      campaignId: input.campaignId,
      runId: input.runId,
      moduleId: input.moduleId,
      status,
      startedAtSessionId: input.startedAtSessionId,
      completedAtSessionId: undefined,
      progress: EMPTY_PROGRESS,
      notes: input.notes ?? '',
    };
  });
}

/**
 * Record progress against an existing run: merge an additive progress delta and
 * optionally update status, session markers, and notes. Returns the updated
 * run. Never touches the authored module source. Throws if the run is missing.
 */
export function recordAdventureRunProgress(
  db: Db,
  input: RecordAdventureRunProgressInput,
): AdventureRun {
  requireNonEmpty(
    AdventureRunError,
    [
      ['campaignId', input.campaignId],
      ['runId', input.runId],
      ['provenance', input.provenance],
      ['sessionId', input.sessionId],
      ['updatedAt', input.updatedAt],
    ],
    (name) => `recordAdventureRunProgress ${name} is required`,
  );
  if (input.status !== undefined) {
    assertStatus(input.status);
  }
  assertOptionalSessionId(input.startedAtSessionId, 'startedAtSessionId');
  assertOptionalSessionId(input.completedAtSessionId, 'completedAtSessionId');
  if (input.delta !== undefined) {
    validateProgressDelta(input.delta);
  }

  return withTransaction(db, (txnDb) => {
    const current = getAdventureRun(txnDb, input);
    if (current === undefined) {
      throw new AdventureRunError(
        `adventure run '${input.runId}' does not exist in campaign '${input.campaignId}'`,
      );
    }
    const progress = mergeProgress(current.progress, input.delta);
    const status = input.status ?? current.status;
    const startedAtSessionId =
      input.startedAtSessionId ?? current.startedAtSessionId;
    const completedAtSessionId =
      input.completedAtSessionId ?? current.completedAtSessionId;
    const notes = input.notes ?? current.notes;

    txnDb
      .prepare(
        `UPDATE adventure_run
            SET status = ?, started_at_session_id = ?,
                completed_at_session_id = ?, progress_json = ?, notes = ?,
                provenance = ?, session_id = ?, updated_at = ?
          WHERE campaign_id = ? AND run_id = ?`,
      )
      .run(
        status,
        startedAtSessionId ?? null,
        completedAtSessionId ?? null,
        progressColumn.encode(progress),
        notes,
        input.provenance,
        input.sessionId,
        input.updatedAt,
        input.campaignId,
        input.runId,
      );
    return {
      campaignId: input.campaignId,
      runId: input.runId,
      moduleId: current.moduleId,
      status,
      startedAtSessionId,
      completedAtSessionId,
      progress,
      notes,
    };
  });
}
