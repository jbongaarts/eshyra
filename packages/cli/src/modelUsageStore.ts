import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { openDatabase } from '@eshyra/core';
import type {
  Db,
  ModelUsageRecord,
  ModelUsageSink,
} from '@eshyra/core/internal';

const CREATE_TABLE = `
  CREATE TABLE IF NOT EXISTS model_usage (
    id             TEXT    PRIMARY KEY,
    at             TEXT    NOT NULL,
    campaign_id    TEXT,
    session_id     TEXT,
    turn_id        TEXT,
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
    request_id     TEXT
  )
`;

const INSERT_SQL = `
  INSERT OR IGNORE INTO model_usage (
    id, at, campaign_id, session_id, turn_id,
    purpose, model, profile, auth_mode, adapter_family,
    input_tokens, output_tokens, cache_read_tokens, cache_write_tokens,
    elapsed_ms, success, error, request_id
  ) VALUES (
    ?, ?, ?, ?, ?,
    ?, ?, ?, ?, ?,
    ?, ?, ?, ?,
    ?, ?, ?, ?
  )
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
  readonly since?: string;
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
export class ModelUsageStore implements ModelUsageSink {
  readonly #db: Db;

  constructor(dbPath: string) {
    mkdirSync(dirname(dbPath), { recursive: true });
    this.#db = openDatabase(dbPath);
    this.#db.exec(CREATE_TABLE);
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
