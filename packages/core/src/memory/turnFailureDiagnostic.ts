import type { Db } from '../persistence/db.js';
import { withTransaction } from '../persistence/db.js';
import { requireNonEmpty } from '../validation.js';

const REDACTED = '[redacted]';
const MAX_ERROR_MESSAGE_LENGTH = 1000;

export interface TurnFailureDiagnosticKey {
  campaignId: string;
  sessionId: string;
  turnId: string;
}

export interface TurnFailureDiagnosticRecord extends TurnFailureDiagnosticKey {
  createdAt: string;
  phase: string;
  errorName: string;
  errorMessage: string;
  modelRounds: number;
}

export interface RecordTurnFailureDiagnosticInput
  extends TurnFailureDiagnosticKey {
  createdAt: string;
  phase: string;
  error: unknown;
  modelRounds: number;
}

export class TurnFailureDiagnosticError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TurnFailureDiagnosticError';
  }
}

export function recordTurnFailureDiagnostic(
  db: Db,
  input: RecordTurnFailureDiagnosticInput,
): TurnFailureDiagnosticRecord {
  const diagnostic = normalizeDiagnostic(input);
  validateDiagnostic(diagnostic);
  withTransaction(db, (txnDb) => {
    txnDb
      .prepare(
        `INSERT INTO turn_failure_diagnostic(
           campaign_id,
           session_id,
           turn_id,
           created_at,
           phase,
           error_name,
           error_message,
           model_rounds
         )
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(campaign_id, session_id, turn_id) DO UPDATE SET
           created_at = excluded.created_at,
           phase = excluded.phase,
           error_name = excluded.error_name,
           error_message = excluded.error_message,
           model_rounds = excluded.model_rounds`,
      )
      .run(
        diagnostic.campaignId,
        diagnostic.sessionId,
        diagnostic.turnId,
        diagnostic.createdAt,
        diagnostic.phase,
        diagnostic.errorName,
        diagnostic.errorMessage,
        diagnostic.modelRounds,
      );
  });
  return diagnostic;
}

export function getTurnFailureDiagnostic(
  db: Db,
  key: TurnFailureDiagnosticKey,
): TurnFailureDiagnosticRecord | undefined {
  const row = db
    .prepare(
      `SELECT campaign_id, session_id, turn_id, created_at, phase,
              error_name, error_message, model_rounds
       FROM turn_failure_diagnostic
       WHERE campaign_id = ? AND session_id = ? AND turn_id = ?`,
    )
    .get(key.campaignId, key.sessionId, key.turnId) as
    | TurnFailureDiagnosticRow
    | undefined;
  return row === undefined ? undefined : diagnosticFromRow(row);
}

export function listTurnFailureDiagnostics(
  db: Db,
  selector: { campaignId: string; sessionId: string },
): TurnFailureDiagnosticRecord[] {
  const rows = db
    .prepare(
      `SELECT campaign_id, session_id, turn_id, created_at, phase,
              error_name, error_message, model_rounds
       FROM turn_failure_diagnostic
       WHERE campaign_id = ? AND session_id = ?
       ORDER BY created_at ASC, turn_id ASC`,
    )
    .all(selector.campaignId, selector.sessionId) as TurnFailureDiagnosticRow[];
  return rows.map(diagnosticFromRow);
}

/**
 * Strip the secret shapes Eshyra never wants in a persisted log: bearer tokens,
 * `api_key=`/`token:` style assignments, `sk-...` provider keys, and JWT-shaped
 * triples. Pure pattern replacement — no trimming, fallback, or truncation — so
 * it can also redact long captured prompt/message content without mangling it.
 * Shared by {@link sanitizeDiagnosticMessage} and the session debug logger so
 * there is one redaction source of truth.
 */
export function redactSecrets(text: string): string {
  return text
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+/gi, `Bearer ${REDACTED}`)
    .replace(
      /\b(api[_-]?key|access[_-]?token|authorization|auth|secret|password|token)\s*[:=]\s*["']?[^"',;\s]+/gi,
      `$1=${REDACTED}`,
    )
    .replace(/\bsk-[A-Za-z0-9_-]{8,}\b/g, REDACTED)
    .replace(
      /\b[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\b/g,
      REDACTED,
    );
}

export function sanitizeDiagnosticMessage(message: string): string {
  const sanitized = redactSecrets(message).trim();
  return (sanitized.length > 0 ? sanitized : 'unknown error').slice(
    0,
    MAX_ERROR_MESSAGE_LENGTH,
  );
}

function normalizeDiagnostic(
  input: RecordTurnFailureDiagnosticInput,
): TurnFailureDiagnosticRecord {
  return {
    campaignId: input.campaignId,
    sessionId: input.sessionId,
    turnId: input.turnId,
    createdAt: input.createdAt,
    phase: input.phase,
    errorName: sanitizeDiagnosticMessage(errorName(input.error)),
    errorMessage: sanitizeDiagnosticMessage(errorMessage(input.error)),
    modelRounds: input.modelRounds,
  };
}

function errorName(error: unknown): string {
  if (error instanceof Error && error.name.trim().length > 0) {
    return error.name;
  }
  return 'NonErrorThrown';
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

function validateDiagnostic(diagnostic: TurnFailureDiagnosticRecord): void {
  requireNonEmpty(
    TurnFailureDiagnosticError,
    [
      ['campaignId', diagnostic.campaignId],
      ['sessionId', diagnostic.sessionId],
      ['turnId', diagnostic.turnId],
      ['createdAt', diagnostic.createdAt],
      ['phase', diagnostic.phase],
      ['errorName', diagnostic.errorName],
      ['errorMessage', diagnostic.errorMessage],
    ],
    (field) => `turn failure diagnostic ${field} is required`,
  );
  if (!Number.isInteger(diagnostic.modelRounds) || diagnostic.modelRounds < 0) {
    throw new TurnFailureDiagnosticError(
      'turn failure diagnostic modelRounds must be a non-negative integer',
    );
  }
}

function diagnosticFromRow(
  row: TurnFailureDiagnosticRow,
): TurnFailureDiagnosticRecord {
  return {
    campaignId: row.campaign_id,
    sessionId: row.session_id,
    turnId: row.turn_id,
    createdAt: row.created_at,
    phase: row.phase,
    errorName: row.error_name,
    errorMessage: row.error_message,
    modelRounds: row.model_rounds,
  };
}

interface TurnFailureDiagnosticRow {
  campaign_id: string;
  session_id: string;
  turn_id: string;
  created_at: string;
  phase: string;
  error_name: string;
  error_message: string;
  model_rounds: number;
}
