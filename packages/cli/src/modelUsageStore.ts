import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { openDatabase } from '@eshyra/core';
import type {
  AuditRetryCause,
  Db,
  ModelUsageRecord,
  ModelUsageSink,
  ToolUsageRecord,
  TurnAuditRecord,
  TurnDiagnosticsSink,
  TurnOutcome,
  TurnOutcomeRecord,
} from '@eshyra/core/internal';
import { diagnosticsDir } from './dataRoot.js';

const CREATE_TABLE = `
  CREATE TABLE IF NOT EXISTS model_usage (
    id             TEXT    PRIMARY KEY,
    at             TEXT    NOT NULL,
    campaign_id    TEXT,
    session_id     TEXT,
    turn_id        TEXT,
    arc_id         TEXT,
    purpose        TEXT    NOT NULL,
    model          TEXT    NOT NULL,
    profile        TEXT,
    auth_mode      TEXT,
    adapter_family TEXT,
    input_tokens   INTEGER,
    output_tokens  INTEGER,
    cache_read_tokens  INTEGER,
    cache_write_tokens INTEGER,
    elapsed_ms     INTEGER NOT NULL,
    success        INTEGER NOT NULL,
    error          TEXT,
    request_id     TEXT,
    attempt        INTEGER,
    round          INTEGER,
    failure_kind   TEXT
  )
`;

// Per-tool timing spans and per-turn outcomes (eshyra-17ng). Separate tables so
// a turn's model calls, tool calls, and outcome can be reassembled into a
// timeline keyed by turn_id without widening the model_usage row.
const CREATE_TOOL_TABLE = `
  CREATE TABLE IF NOT EXISTS tool_usage (
    id          TEXT    PRIMARY KEY,
    at          TEXT    NOT NULL,
    campaign_id TEXT,
    session_id  TEXT,
    turn_id     TEXT,
    attempt     INTEGER,
    round       INTEGER,
    tool        TEXT    NOT NULL,
    source      TEXT    NOT NULL,
    mutates     INTEGER NOT NULL,
    ok          INTEGER NOT NULL,
    error_code  TEXT,
    elapsed_ms  INTEGER NOT NULL
  )
`;

const CREATE_OUTCOME_TABLE = `
  CREATE TABLE IF NOT EXISTS turn_outcome (
    id          TEXT    PRIMARY KEY,
    at          TEXT    NOT NULL,
    campaign_id TEXT,
    session_id  TEXT,
    turn_id     TEXT,
    outcome     TEXT    NOT NULL,
    attempts    INTEGER NOT NULL,
    model_rounds INTEGER NOT NULL,
    elapsed_ms  INTEGER NOT NULL,
    reason      TEXT,
    auditor_call_count INTEGER NOT NULL DEFAULT 0,
    primary_dm_candidate_count INTEGER NOT NULL DEFAULT 0,
    primary_dm_call_count INTEGER NOT NULL DEFAULT 0,
    primary_dm_retry_count INTEGER NOT NULL DEFAULT 0,
    retry_causes_json TEXT NOT NULL DEFAULT '[]',
    retry_succeeded INTEGER,
    tools_rerun_during_retry_json TEXT NOT NULL DEFAULT '[]'
  )
`;

const CREATE_AUDIT_TABLE = `
  CREATE TABLE IF NOT EXISTS turn_audit (
    id          TEXT    PRIMARY KEY,
    at          TEXT    NOT NULL,
    campaign_id TEXT,
    session_id  TEXT,
    turn_id     TEXT,
    attempt     INTEGER NOT NULL,
    verdict     TEXT    NOT NULL,
    action      TEXT    NOT NULL,
    retry_cause TEXT,
    missing_required_tools_json TEXT NOT NULL,
    disallowed_tool_calls_json  TEXT NOT NULL,
    executed_tool_names_json    TEXT NOT NULL,
    failed_tool_names_json      TEXT NOT NULL,
    mutating_tool_count INTEGER NOT NULL,
    auditor_model TEXT
  )
`;

const INSERT_SQL = `
  INSERT OR IGNORE INTO model_usage (
    id, at, campaign_id, session_id, turn_id, arc_id,
    purpose, model, profile, auth_mode, adapter_family,
    input_tokens, output_tokens, cache_read_tokens, cache_write_tokens,
    elapsed_ms, success, error, request_id, attempt, round, failure_kind
  ) VALUES (
    ?, ?, ?, ?, ?, ?,
    ?, ?, ?, ?, ?,
    ?, ?, ?, ?,
    ?, ?, ?, ?, ?, ?, ?
  )
`;

const INSERT_TOOL_SQL = `
  INSERT OR IGNORE INTO tool_usage (
    id, at, campaign_id, session_id, turn_id,
    attempt, round, tool, source, mutates, ok, error_code, elapsed_ms
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`;

const INSERT_OUTCOME_SQL = `
  INSERT OR IGNORE INTO turn_outcome (
    id, at, campaign_id, session_id, turn_id,
    outcome, attempts, model_rounds, elapsed_ms, reason,
    auditor_call_count, primary_dm_candidate_count, primary_dm_call_count,
    primary_dm_retry_count, retry_causes_json, retry_succeeded,
    tools_rerun_during_retry_json
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`;

const INSERT_AUDIT_SQL = `
  INSERT OR IGNORE INTO turn_audit (
    id, at, campaign_id, session_id, turn_id,
    attempt, verdict, action, retry_cause,
    missing_required_tools_json, disallowed_tool_calls_json,
    executed_tool_names_json, failed_tool_names_json,
    mutating_tool_count, auditor_model
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`;

export interface UsageSummaryByDimension {
  readonly label: string;
  readonly calls: number;
  readonly inputTokens: number | null;
  readonly outputTokens: number | null;
  readonly cacheReadTokens: number | null;
  readonly cacheWriteTokens: number | null;
  readonly elapsedMs: number;
  readonly failures: number;
}

export interface UsageSummary {
  readonly totalCalls: number;
  readonly failures: number;
  readonly inputTokens: number | null;
  readonly outputTokens: number | null;
  readonly cacheReadTokens: number | null;
  readonly cacheWriteTokens: number | null;
  readonly totalElapsedMs: number;
  readonly byPurpose: readonly UsageSummaryByDimension[];
  readonly byModel: readonly UsageSummaryByDimension[];
}

export interface UsageQueryFilters {
  readonly campaignId?: string;
  readonly sessionId?: string;
  /** Restrict to model calls stamped with this campaign arc (eshyra-f0hj). */
  readonly arcId?: string;
  readonly since?: string;
}

/** One model call within a turn timeline (eshyra-17ng). */
export interface TimelineModelCall {
  readonly purpose: string;
  readonly model: string;
  readonly attempt: number | null;
  readonly round: number | null;
  readonly elapsedMs: number;
  readonly success: boolean;
  readonly failureKind: string | null;
}

/** One tool call within a turn timeline (eshyra-17ng). */
export interface TimelineToolCall {
  readonly tool: string;
  readonly source: string;
  readonly mutates: boolean;
  readonly ok: boolean;
  readonly attempt: number | null;
  readonly round: number | null;
  readonly elapsedMs: number;
}

/** One audit verdict within a turn timeline (eshyra-d8ap.3). */
export interface TimelineAuditCall {
  readonly attempt: number;
  readonly verdict: 'accept' | 'reject';
  readonly action: 'accept' | 'retry' | 'fail';
  readonly retryCause: AuditRetryCause | null;
  readonly missingRequiredTools: readonly string[];
  readonly disallowedToolCalls: readonly string[];
  readonly executedToolNames: readonly string[];
  readonly failedToolNames: readonly string[];
  readonly mutatingToolCount: number;
  readonly auditorModel: string | null;
}

/** Structural timeline for a single player turn (eshyra-17ng). */
export interface TimelineTurn {
  readonly turnId: string;
  readonly sessionId: string | null;
  readonly campaignId: string | null;
  readonly outcome: TurnOutcome | null;
  readonly attempts: number | null;
  readonly modelRounds: number | null;
  readonly auditorCallCount: number | null;
  readonly primaryDmCandidateCount: number | null;
  readonly primaryDmCallCount: number | null;
  readonly primaryDmRetryCount: number | null;
  readonly retryCauses: readonly AuditRetryCause[];
  readonly retrySucceeded: boolean | null;
  readonly toolsRerunDuringRetry: readonly string[];
  readonly totalElapsedMs: number | null;
  readonly modelCalls: readonly TimelineModelCall[];
  readonly auditCalls: readonly TimelineAuditCall[];
  readonly toolCalls: readonly TimelineToolCall[];
}

type TotalsRow = {
  total_calls: number;
  failures: number;
  in_tok: number | null;
  out_tok: number | null;
  cr_tok: number | null;
  cw_tok: number | null;
  total_ms: number;
};

type GroupRow = {
  label: string;
  calls: number;
  in_tok: number | null;
  out_tok: number | null;
  cr_tok: number | null;
  cw_tok: number | null;
  ms: number;
  fails: number;
};

type TimelineModelRow = {
  turn_id: string | null;
  session_id: string | null;
  campaign_id: string | null;
  purpose: string;
  model: string;
  attempt: number | null;
  round: number | null;
  elapsed_ms: number;
  success: number;
  failure_kind: string | null;
};

type TimelineToolRow = {
  turn_id: string | null;
  attempt: number | null;
  round: number | null;
  tool: string;
  source: string;
  mutates: number;
  ok: number;
  elapsed_ms: number;
};

type TimelineAuditRow = {
  turn_id: string | null;
  attempt: number;
  verdict: 'accept' | 'reject';
  action: 'accept' | 'retry' | 'fail';
  retry_cause: AuditRetryCause | null;
  missing_required_tools_json: string;
  disallowed_tool_calls_json: string;
  executed_tool_names_json: string;
  failed_tool_names_json: string;
  mutating_tool_count: number;
  auditor_model: string | null;
};

type TimelineOutcomeRow = {
  turn_id: string | null;
  outcome: TurnOutcome;
  attempts: number;
  model_rounds: number;
  elapsed_ms: number;
  auditor_call_count: number | null;
  primary_dm_candidate_count: number | null;
  primary_dm_call_count: number | null;
  primary_dm_retry_count: number | null;
  retry_causes_json: string | null;
  retry_succeeded: number | null;
  tools_rerun_during_retry_json: string | null;
};

type MutableTimelineTurn = {
  turnId: string;
  sessionId: string | null;
  campaignId: string | null;
  outcome: TurnOutcome | null;
  attempts: number | null;
  modelRounds: number | null;
  auditorCallCount: number | null;
  primaryDmCandidateCount: number | null;
  primaryDmCallCount: number | null;
  primaryDmRetryCount: number | null;
  retryCauses: AuditRetryCause[];
  retrySucceeded: boolean | null;
  toolsRerunDuringRetry: string[];
  totalElapsedMs: number | null;
  modelCalls: TimelineModelCall[];
  auditCalls: TimelineAuditCall[];
  toolCalls: TimelineToolCall[];
};

/**
 * SQLite-backed store for model usage records (eshyra-cuxm). Each call to
 * {@link record} writes one row synchronously. {@link query} returns aggregate
 * summaries for the CLI usage command.
 *
 * The DB is opened with WAL mode (via {@link openDatabase}) so concurrent CLI
 * invocations can read without blocking writes. Best-effort: {@link record}
 * failures are caught by the {@link ModelUsageTracker} and never surface to
 * the caller.
 */
export class ModelUsageStore implements ModelUsageSink, TurnDiagnosticsSink {
  readonly #db: Db;

  constructor(dbPath: string) {
    mkdirSync(dirname(dbPath), { recursive: true });
    this.#db = openDatabase(dbPath);
    this.#db.exec(CREATE_TABLE);
    this.#db.exec(CREATE_TOOL_TABLE);
    this.#db.exec(CREATE_OUTCOME_TABLE);
    this.#db.exec(CREATE_AUDIT_TABLE);
    // Migrate diagnostics DBs created before eshyra-17ng so older usage.db files
    // gain the new model_usage columns rather than failing every insert.
    this.#addColumnIfMissing('model_usage', 'attempt', 'INTEGER');
    this.#addColumnIfMissing('model_usage', 'round', 'INTEGER');
    this.#addColumnIfMissing('model_usage', 'failure_kind', 'TEXT');
    // eshyra-f0hj: arc attribution for cross-session maintenance calls.
    this.#addColumnIfMissing('model_usage', 'arc_id', 'TEXT');
    this.#addColumnIfMissing(
      'turn_outcome',
      'auditor_call_count',
      'INTEGER NOT NULL DEFAULT 0',
    );
    this.#addColumnIfMissing(
      'turn_outcome',
      'primary_dm_candidate_count',
      'INTEGER NOT NULL DEFAULT 0',
    );
    this.#addColumnIfMissing(
      'turn_outcome',
      'primary_dm_call_count',
      'INTEGER NOT NULL DEFAULT 0',
    );
    this.#addColumnIfMissing(
      'turn_outcome',
      'primary_dm_retry_count',
      'INTEGER NOT NULL DEFAULT 0',
    );
    this.#addColumnIfMissing(
      'turn_outcome',
      'retry_causes_json',
      "TEXT NOT NULL DEFAULT '[]'",
    );
    this.#addColumnIfMissing('turn_outcome', 'retry_succeeded', 'INTEGER');
    this.#addColumnIfMissing(
      'turn_outcome',
      'tools_rerun_during_retry_json',
      "TEXT NOT NULL DEFAULT '[]'",
    );
  }

  #addColumnIfMissing(table: string, column: string, decl: string): void {
    const cols = this.#db
      .prepare(`PRAGMA table_info(${table})`)
      .all() as Array<{
      name: string;
    }>;
    if (!cols.some((c) => c.name === column)) {
      this.#db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${decl}`);
    }
  }

  record(entry: ModelUsageRecord): void {
    this.#db
      .prepare(INSERT_SQL)
      .run(
        entry.id,
        entry.at,
        entry.campaignId,
        entry.sessionId,
        entry.turnId,
        entry.arcId,
        entry.purpose,
        entry.model,
        entry.profile,
        entry.authMode,
        entry.adapterFamily,
        entry.inputTokens,
        entry.outputTokens,
        entry.cacheReadTokens,
        entry.cacheWriteTokens,
        entry.elapsedMs,
        entry.success ? 1 : 0,
        entry.error,
        entry.requestId,
        entry.attempt,
        entry.round,
        entry.failureKind,
      );
  }

  recordTool(entry: ToolUsageRecord): void {
    this.#db
      .prepare(INSERT_TOOL_SQL)
      .run(
        entry.id,
        entry.at,
        entry.campaignId,
        entry.sessionId,
        entry.turnId,
        entry.attempt,
        entry.round,
        entry.tool,
        entry.source,
        entry.mutates ? 1 : 0,
        entry.ok ? 1 : 0,
        entry.errorCode,
        entry.elapsedMs,
      );
  }

  recordAudit(entry: TurnAuditRecord): void {
    this.#db
      .prepare(INSERT_AUDIT_SQL)
      .run(
        entry.id,
        entry.at,
        entry.campaignId,
        entry.sessionId,
        entry.turnId,
        entry.attempt,
        entry.verdict,
        entry.action,
        entry.retryCause,
        JSON.stringify(entry.missingRequiredTools),
        JSON.stringify(entry.disallowedToolCalls),
        JSON.stringify(entry.executedToolNames),
        JSON.stringify(entry.failedToolNames),
        entry.mutatingToolCount,
        entry.auditorModel,
      );
  }

  recordOutcome(entry: TurnOutcomeRecord): void {
    this.#db
      .prepare(INSERT_OUTCOME_SQL)
      .run(
        entry.id,
        entry.at,
        entry.campaignId,
        entry.sessionId,
        entry.turnId,
        entry.outcome,
        entry.attempts,
        entry.modelRounds,
        entry.elapsedMs,
        entry.reason,
        entry.auditorCallCount,
        entry.primaryDmCandidateCount,
        entry.primaryDmCallCount,
        entry.primaryDmRetryCount,
        JSON.stringify(entry.retryCauses),
        entry.retrySucceeded === null ? null : entry.retrySucceeded ? 1 : 0,
        JSON.stringify(entry.toolsRerunDuringRetry),
      );
  }

  query(filters: UsageQueryFilters = {}): UsageSummary {
    const { where, params } = buildWhere(filters);

    const totalsRow = this.#db
      .prepare(
        `SELECT
          COUNT(*) AS total_calls,
          SUM(CASE WHEN success = 0 THEN 1 ELSE 0 END) AS failures,
          SUM(input_tokens)       AS in_tok,
          SUM(output_tokens)      AS out_tok,
          SUM(cache_read_tokens)  AS cr_tok,
          SUM(cache_write_tokens) AS cw_tok,
          SUM(elapsed_ms)         AS total_ms
        FROM model_usage${where}`,
      )
      .get(...params) as TotalsRow | undefined;

    if (totalsRow === undefined || totalsRow.total_calls === 0) {
      return {
        totalCalls: 0,
        failures: 0,
        inputTokens: null,
        outputTokens: null,
        cacheReadTokens: null,
        cacheWriteTokens: null,
        totalElapsedMs: 0,
        byPurpose: [],
        byModel: [],
      };
    }

    const byPurpose = (
      this.#db
        .prepare(
          `SELECT
            purpose AS label,
            COUNT(*) AS calls,
            SUM(input_tokens)       AS in_tok,
            SUM(output_tokens)      AS out_tok,
            SUM(cache_read_tokens)  AS cr_tok,
            SUM(cache_write_tokens) AS cw_tok,
            SUM(elapsed_ms)         AS ms,
            SUM(CASE WHEN success = 0 THEN 1 ELSE 0 END) AS fails
          FROM model_usage${where}
          GROUP BY purpose
          ORDER BY calls DESC`,
        )
        .all(...params) as GroupRow[]
    ).map(toSummaryRow);

    const byModel = (
      this.#db
        .prepare(
          `SELECT
            model AS label,
            COUNT(*) AS calls,
            SUM(input_tokens)       AS in_tok,
            SUM(output_tokens)      AS out_tok,
            SUM(cache_read_tokens)  AS cr_tok,
            SUM(cache_write_tokens) AS cw_tok,
            SUM(elapsed_ms)         AS ms,
            SUM(CASE WHEN success = 0 THEN 1 ELSE 0 END) AS fails
          FROM model_usage${where}
          GROUP BY model
          ORDER BY calls DESC`,
        )
        .all(...params) as GroupRow[]
    ).map(toSummaryRow);

    return {
      totalCalls: totalsRow.total_calls,
      failures: totalsRow.failures ?? 0,
      inputTokens: totalsRow.in_tok ?? null,
      outputTokens: totalsRow.out_tok ?? null,
      cacheReadTokens: totalsRow.cr_tok ?? null,
      cacheWriteTokens: totalsRow.cw_tok ?? null,
      totalElapsedMs: totalsRow.total_ms ?? 0,
      byPurpose,
      byModel,
    };
  }

  /**
   * Reassemble per-turn timelines (eshyra-17ng) from the model-call, tool-call,
   * and outcome tables, keyed by turn id. Only rows that carry a `turn_id` are
   * included (maintenance/recap calls without a turn are omitted). Turns are
   * ordered by the earliest model call; within a turn, model and tool calls keep
   * their insertion order (`rowid`).
   */
  timeline(filters: UsageQueryFilters = {}): TimelineTurn[] {
    const { where, params } = buildWhere(filters);
    const turnFilter =
      where === ''
        ? ' WHERE turn_id IS NOT NULL'
        : `${where} AND turn_id IS NOT NULL`;

    const modelRows = this.#db
      .prepare(
        `SELECT turn_id, session_id, campaign_id, purpose, model, attempt, round,
                elapsed_ms, success, failure_kind
         FROM model_usage${turnFilter}
         ORDER BY rowid`,
      )
      .all(...params) as TimelineModelRow[];

    const toolRows = this.#db
      .prepare(
        `SELECT turn_id, attempt, round, tool, source, mutates, ok, elapsed_ms
         FROM tool_usage${turnFilter}
         ORDER BY rowid`,
      )
      .all(...params) as TimelineToolRow[];

    const auditRows = this.#db
      .prepare(
        `SELECT turn_id, attempt, verdict, action, retry_cause,
                missing_required_tools_json, disallowed_tool_calls_json,
                executed_tool_names_json, failed_tool_names_json,
                mutating_tool_count, auditor_model
         FROM turn_audit${turnFilter}
         ORDER BY rowid`,
      )
      .all(...params) as TimelineAuditRow[];

    const outcomeRows = this.#db
      .prepare(
        `SELECT turn_id, outcome, attempts, model_rounds, elapsed_ms,
                auditor_call_count, primary_dm_candidate_count,
                primary_dm_call_count, primary_dm_retry_count,
                retry_causes_json, retry_succeeded,
                tools_rerun_during_retry_json
         FROM turn_outcome${turnFilter}
         ORDER BY rowid`,
      )
      .all(...params) as TimelineOutcomeRow[];

    const turns = new Map<string, MutableTimelineTurn>();
    const ensure = (
      turnId: string,
      sessionId: string | null,
      campaignId: string | null,
    ): MutableTimelineTurn => {
      let t = turns.get(turnId);
      if (t === undefined) {
        t = {
          turnId,
          sessionId,
          campaignId,
          outcome: null,
          attempts: null,
          modelRounds: null,
          auditorCallCount: null,
          primaryDmCandidateCount: null,
          primaryDmCallCount: null,
          primaryDmRetryCount: null,
          retryCauses: [],
          retrySucceeded: null,
          toolsRerunDuringRetry: [],
          totalElapsedMs: null,
          modelCalls: [],
          auditCalls: [],
          toolCalls: [],
        };
        turns.set(turnId, t);
      }
      return t;
    };

    for (const r of modelRows) {
      if (r.turn_id === null) {
        continue;
      }
      ensure(r.turn_id, r.session_id, r.campaign_id).modelCalls.push({
        purpose: r.purpose,
        model: r.model,
        attempt: r.attempt,
        round: r.round,
        elapsedMs: r.elapsed_ms,
        success: r.success === 1,
        failureKind: r.failure_kind,
      });
    }
    for (const r of toolRows) {
      if (r.turn_id === null) {
        continue;
      }
      const t = turns.get(r.turn_id);
      if (t === undefined) {
        continue;
      }
      t.toolCalls.push({
        tool: r.tool,
        source: r.source,
        mutates: r.mutates === 1,
        ok: r.ok === 1,
        attempt: r.attempt,
        round: r.round,
        elapsedMs: r.elapsed_ms,
      });
    }
    for (const r of auditRows) {
      if (r.turn_id === null) {
        continue;
      }
      const t = turns.get(r.turn_id);
      if (t === undefined) {
        continue;
      }
      t.auditCalls.push({
        attempt: r.attempt,
        verdict: r.verdict,
        action: r.action,
        retryCause: r.retry_cause,
        missingRequiredTools: parseStringArray(r.missing_required_tools_json),
        disallowedToolCalls: parseStringArray(r.disallowed_tool_calls_json),
        executedToolNames: parseStringArray(r.executed_tool_names_json),
        failedToolNames: parseStringArray(r.failed_tool_names_json),
        mutatingToolCount: r.mutating_tool_count,
        auditorModel: r.auditor_model,
      });
    }
    for (const r of outcomeRows) {
      if (r.turn_id === null) {
        continue;
      }
      const t = turns.get(r.turn_id);
      if (t === undefined) {
        continue;
      }
      t.outcome = r.outcome;
      t.attempts = r.attempts;
      t.modelRounds = r.model_rounds;
      t.auditorCallCount = r.auditor_call_count ?? 0;
      t.primaryDmCandidateCount = r.primary_dm_candidate_count ?? r.attempts;
      t.primaryDmCallCount = r.primary_dm_call_count ?? r.model_rounds;
      t.primaryDmRetryCount = r.primary_dm_retry_count ?? 0;
      t.retryCauses = parseRetryCauseArray(r.retry_causes_json);
      t.retrySucceeded =
        r.retry_succeeded === null ? null : r.retry_succeeded === 1;
      t.toolsRerunDuringRetry = parseStringArray(
        r.tools_rerun_during_retry_json,
      );
      t.totalElapsedMs = r.elapsed_ms;
    }
    return [...turns.values()];
  }

  close(): void {
    this.#db.close();
  }
}

function buildWhere(filters: UsageQueryFilters): {
  where: string;
  params: unknown[];
} {
  const clauses: string[] = [];
  const params: unknown[] = [];
  if (filters.campaignId !== undefined) {
    clauses.push('campaign_id = ?');
    params.push(filters.campaignId);
  }
  if (filters.sessionId !== undefined) {
    clauses.push('session_id = ?');
    params.push(filters.sessionId);
  }
  if (filters.arcId !== undefined) {
    clauses.push('arc_id = ?');
    params.push(filters.arcId);
  }
  if (filters.since !== undefined) {
    clauses.push('at >= ?');
    params.push(filters.since);
  }
  return {
    where: clauses.length > 0 ? ` WHERE ${clauses.join(' AND ')}` : '',
    params,
  };
}

function toSummaryRow(row: GroupRow): UsageSummaryByDimension {
  return {
    label: row.label,
    calls: row.calls,
    inputTokens: row.in_tok ?? null,
    outputTokens: row.out_tok ?? null,
    cacheReadTokens: row.cr_tok ?? null,
    cacheWriteTokens: row.cw_tok ?? null,
    elapsedMs: row.ms ?? 0,
    failures: row.fails ?? 0,
  };
}

function parseStringArray(raw: string | null): string[] {
  if (raw === null) {
    return [];
  }
  try {
    const value: unknown = JSON.parse(raw);
    return Array.isArray(value)
      ? value.filter((entry): entry is string => typeof entry === 'string')
      : [];
  } catch {
    return [];
  }
}

function parseRetryCauseArray(raw: string | null): AuditRetryCause[] {
  return parseStringArray(raw).filter((entry): entry is AuditRetryCause =>
    isAuditRetryCause(entry),
  );
}

function isAuditRetryCause(value: string): value is AuditRetryCause {
  return (
    value === 'missing_roll_visibility' ||
    value === 'missing_state' ||
    value === 'missing_world_evidence' ||
    value === 'invalid_target' ||
    value === 'disallowed_tool' ||
    value === 'auditor_over_rejection' ||
    value === 'unknown'
  );
}

/**
 * A usage sink with a lifecycle `close()` method so callers can manage the
 * underlying resource without depending on the concrete {@link ModelUsageStore}.
 * Implements both the model-call sink and the per-turn diagnostics sink
 * (eshyra-17ng) so one store handles model, tool, and outcome records.
 */
export type CloseableModelUsageSink = ModelUsageSink &
  TurnDiagnosticsSink & { close(): void };

/**
 * Best-effort factory for the diagnostics usage sink (eshyra-cuxm). Opens
 * `<dataRoot>/diagnostics/usage.db` wrapped in a {@link ModelUsageStore}. If
 * initialization fails (e.g. a read-only filesystem or a file at the expected
 * directory path), emits one warning via `warn` and returns a no-op sink so
 * the calling session continues unaffected.
 *
 * The `eshyra usage` command bypasses this helper and opens the store
 * directly, so it can surface DB errors to the user.
 */
export function createUsageSink(
  dataRoot: string,
  warn?: (message: string) => void,
): CloseableModelUsageSink {
  try {
    return new ModelUsageStore(join(diagnosticsDir(dataRoot), 'usage.db'));
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    warn?.(`Usage tracking disabled: ${msg}`);
    return {
      record: () => {},
      recordTool: () => {},
      recordAudit: () => {},
      recordOutcome: () => {},
      close: () => {},
    };
  }
}
