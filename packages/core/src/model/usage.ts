import { randomUUID } from 'node:crypto';
import { redactSecrets } from '../memory/turnFailureDiagnostic.js';
import type {
  ModelClient,
  ModelCompleteInput,
  ModelCompleteResult,
} from './client.js';

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
}

/** Receiver for usage records — implemented by the storage backend. */
export interface ModelUsageSink {
  record(entry: ModelUsageRecord): void;
}

/** No-op sink for use when storage is unavailable or in test contexts. */
export class NoopModelUsageSink implements ModelUsageSink {
  record(_entry: ModelUsageRecord): void {}
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

    try {
      result = await this.#inner.complete(input);
      return result;
    } catch (err) {
      errorMsg = redactSecrets(
        err instanceof Error ? err.message : String(err),
      );
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
      };

      try {
        this.#sink.record(record);
      } catch {
        // Diagnostics must never destabilize a call.
      }
    }
  }
}
