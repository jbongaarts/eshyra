import { randomUUID } from 'node:crypto';
import { redactSecrets } from '../memory/turnFailureDiagnostic.js';
import type {
  ModelClient,
  ModelCompleteInput,
  ModelCompleteResult,
} from './client.js';
import { ModelRateLimitError } from './client.js';

/**
 * Why a model call was made. Maps the raw purpose strings from
 * `ModelTraceMetadata.extra.purpose` (set by the orchestrator and callers)
 * to a stable set of values safe to store and display (eshyra-cuxm).
 *
 * Mapping:
 *   'turn_model_loop' → 'gameplay_turn'
 *   'turn_audit'      → 'turn_audit'
 *   <others>          → see individual values below
 */
export type ModelUsagePurpose =
  | 'gameplay_turn'
  | 'turn_audit'
  | 'session_recap'
  | 'campaign_bible'
  | 'arc_rollup'
  | 'live_test'
  | 'maintenance';

/** One model call's usage record, safe to persist and display. */
export interface ModelUsageRecord {
  readonly id: string;
  readonly at: string;
  readonly campaignId: string | null;
  readonly sessionId: string | null;
  readonly turnId: string | null;
  /**
   * Campaign arc this call belongs to (eshyra-f0hj), from `trace.arcId`.
   * Populated by cross-session maintenance calls such as arc rollup; `null`
   * for per-turn calls and any call without arc context.
   */
  readonly arcId: string | null;
  readonly purpose: ModelUsagePurpose;
  readonly model: string;
  readonly profile: string | null;
  readonly authMode: string | null;
  readonly adapterFamily: string | null;
  readonly inputTokens: number | null;
  readonly outputTokens: number | null;
  readonly cacheReadTokens: number | null;
  readonly cacheWriteTokens: number | null;
  readonly elapsedMs: number;
  readonly success: boolean;
  /** Redacted error message, present only on failure. */
  readonly error: string | null;
  readonly requestId: string | null;
  /**
   * 1-based candidate attempt this call belongs to (eshyra-17ng), taken from
   * `trace.extra.attempt`. Distinguishes an initial `gameplay_turn` from a
   * post-audit retry of the same turn. `null` for calls that carry no attempt
   * context (maintenance, recap, etc.).
   */
  readonly attempt: number | null;
  /**
   * 1-based model round within an attempt (eshyra-17ng), taken from
   * `trace.extra.round`. Lets tool spans nest under the exact gameplay round
   * they ran in. `null` for calls with no round context (e.g. the audit call).
   */
  readonly round: number | null;
  /**
   * Structural classification of a failed call (eshyra-17ng): `provider_limit`
   * for a rate/session limit, `provider_error` for any other provider failure.
   * `null` on success. Lets a slow turn's failed attempt be categorized without
   * parsing the redacted error string.
   */
  readonly failureKind: ModelFailureKind | null;
}

/** Structural failure category for a model call (eshyra-17ng). */
export type ModelFailureKind = 'provider_limit' | 'provider_error';

/** Receiver for usage records — implemented by the storage backend. */
export interface ModelUsageSink {
  record(entry: ModelUsageRecord): void;
}

/** No-op sink for use when storage is unavailable or in test contexts. */
export class NoopModelUsageSink implements ModelUsageSink {
  record(_entry: ModelUsageRecord): void {}
}

/**
 * Transport an executed tool arrived through (eshyra-17ng). Mirrors the
 * orchestrator's internal `ToolRequestSource` as a stable, persistable union so
 * the diagnostics surface does not depend on an orchestrator import.
 */
export type ToolUsageSource = 'fenced' | 'native' | 'native-mcp';

/**
 * One executed tool call's timing record (eshyra-17ng). Captures only
 * structural metadata — never tool arguments or result payloads — so it is safe
 * to persist alongside model usage and surface in debug/usage output.
 */
export interface ToolUsageRecord {
  readonly id: string;
  readonly at: string;
  readonly campaignId: string | null;
  readonly sessionId: string | null;
  readonly turnId: string | null;
  /** 1-based candidate attempt the tool ran inside. */
  readonly attempt: number | null;
  /** 1-based model round within the attempt the tool ran inside. */
  readonly round: number | null;
  /** Eshyra gameplay tool name (provider/MCP naming already mapped away). */
  readonly tool: string;
  readonly source: ToolUsageSource;
  /** Whether the tool writes canon (from the registry's classification). */
  readonly mutates: boolean;
  /** Whether the deterministic execution succeeded. */
  readonly ok: boolean;
  /** Deterministic failure code when `ok` is false; `null` on success. */
  readonly errorCode: string | null;
  readonly elapsedMs: number;
}

/** Receiver for tool-call timing records. */
export interface ToolUsageSink {
  recordTool(entry: ToolUsageRecord): void;
}

/**
 * Terminal disposition of a player turn (eshyra-17ng):
 *  - `accepted`            — a candidate was accepted (see `attempts` for retries)
 *  - `failed_after_reject` — every candidate was rejected by the audit gate
 *  - `audit_error`         — the auditor itself failed to produce a verdict
 *  - `provider_limit`      — a model call hit a provider rate/session limit
 *  - `provider_error`      — a model call failed for another provider reason
 *  - `failed_before_apply` — any other failure before the turn was applied
 */
export type TurnOutcome =
  | 'accepted'
  | 'failed_after_reject'
  | 'audit_error'
  | 'provider_limit'
  | 'provider_error'
  | 'failed_before_apply';

/** One player turn's outcome + aggregate timing (eshyra-17ng). */
export interface TurnOutcomeRecord {
  readonly id: string;
  readonly at: string;
  readonly campaignId: string | null;
  readonly sessionId: string | null;
  readonly turnId: string | null;
  readonly outcome: TurnOutcome;
  /** Candidate attempts the turn reached (1 = no retry). */
  readonly attempts: number;
  /** Total model rounds across all attempts. */
  readonly modelRounds: number;
  /** Wall-clock time for the whole turn. */
  readonly elapsedMs: number;
  /** Redacted, short reason for a failure; `null` on success. */
  readonly reason: string | null;
}

/** Receiver for per-turn outcome records. */
export interface TurnOutcomeSink {
  recordOutcome(entry: TurnOutcomeRecord): void;
}

/**
 * Combined sink for the orchestrator-side turn diagnostics (eshyra-17ng): tool
 * timing spans and per-turn outcomes. Model-call timing is recorded separately
 * by {@link ModelUsageTracker}; a backing store typically implements both this
 * and {@link ModelUsageSink} so a session's spans are co-located.
 */
export interface TurnDiagnosticsSink extends ToolUsageSink, TurnOutcomeSink {}

/** No-op turn diagnostics sink for tests / when storage is unavailable. */
export class NoopTurnDiagnosticsSink implements TurnDiagnosticsSink {
  recordTool(_entry: ToolUsageRecord): void {}
  recordOutcome(_entry: TurnOutcomeRecord): void {}
}

function parseTraceNumber(raw: string | undefined): number | null {
  if (raw === undefined) {
    return null;
  }
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

export interface ModelUsageTrackerOptions {
  readonly model: string;
  readonly authMode?: string;
  readonly adapterFamily?: string;
  readonly sink: ModelUsageSink;
}

function mapPurpose(raw: string | undefined): ModelUsagePurpose {
  switch (raw) {
    case 'turn_model_loop':
      return 'gameplay_turn';
    case 'turn_audit':
      return 'turn_audit';
    case 'session_recap':
      return 'session_recap';
    case 'campaign_bible':
      return 'campaign_bible';
    case 'arc_rollup':
      return 'arc_rollup';
    case 'live_test':
      return 'live_test';
    default:
      return 'maintenance';
  }
}

/**
 * {@link ModelClient} decorator that records one {@link ModelUsageRecord} per
 * call to a {@link ModelUsageSink} (eshyra-cuxm). Records token counts when
 * the underlying adapter exposes them (the Anthropic native adapter does; the
 * Agent SDK harness does not). Failures are recorded with redacted error
 * messages — never secrets. Sink failures are swallowed so diagnostics never
 * destabilize a turn.
 */
export class ModelUsageTracker implements ModelClient {
  readonly #inner: ModelClient;
  readonly #model: string;
  readonly #authMode: string | null;
  readonly #adapterFamily: string | null;
  readonly #sink: ModelUsageSink;
  readonly #makeId: () => string;

  constructor(
    inner: ModelClient,
    opts: ModelUsageTrackerOptions,
    makeId: () => string = randomUUID,
  ) {
    this.#inner = inner;
    this.#model = opts.model;
    this.#authMode = opts.authMode ?? null;
    this.#adapterFamily = opts.adapterFamily ?? null;
    this.#sink = opts.sink;
    this.#makeId = makeId;
  }

  async complete(input: ModelCompleteInput): Promise<ModelCompleteResult> {
    const at = new Date().toISOString();
    const startMs = Date.now();
    let result: ModelCompleteResult | undefined;
    let errorMsg: string | null = null;
    let failureKind: ModelFailureKind | null = null;

    try {
      result = await this.#inner.complete(input);
      return result;
    } catch (err) {
      errorMsg = redactSecrets(
        err instanceof Error ? err.message : String(err),
      );
      failureKind =
        err instanceof ModelRateLimitError
          ? 'provider_limit'
          : 'provider_error';
      throw err;
    } finally {
      const elapsedMs = Date.now() - startMs;
      const purpose = mapPurpose(input.trace?.extra?.purpose);

      const record: ModelUsageRecord = {
        id: this.#makeId(),
        at,
        campaignId: input.trace?.campaignId ?? null,
        sessionId: input.trace?.sessionId ?? null,
        turnId: input.trace?.turnId ?? null,
        arcId: input.trace?.arcId ?? null,
        purpose,
        model: this.#model,
        profile: input.profile?.profile ?? null,
        authMode: this.#authMode,
        adapterFamily: this.#adapterFamily,
        inputTokens: result?.usage?.inputTokens ?? null,
        outputTokens: result?.usage?.outputTokens ?? null,
        cacheReadTokens: result?.usage?.cacheReadTokens ?? null,
        cacheWriteTokens: result?.usage?.cacheWriteTokens ?? null,
        elapsedMs,
        success: result !== undefined,
        error: errorMsg,
        requestId: result?.requestId ?? null,
        attempt: parseTraceNumber(input.trace?.extra?.attempt),
        round: parseTraceNumber(input.trace?.extra?.round),
        failureKind,
      };

      try {
        this.#sink.record(record);
      } catch {
        // Diagnostics must never destabilize a call.
      }
    }
  }
}
