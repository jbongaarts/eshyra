import type { SDKResultSuccess } from '@anthropic-ai/claude-agent-sdk';
import {
  buildModelCallEvent,
  type ModelCallOutcome,
  type ModelCallTrace,
  type SessionDebugSink,
} from '../debug/sessionDebug.js';
import { redactSecrets } from '../memory/turnFailureDiagnostic.js';
import { buildChildSdkEnv } from './agentSdkEnv.js';
import { loadAgentSdk } from './agentSdkLoader.js';
import type {
  ModelAdapterCapabilities,
  ModelClient,
  ModelCompleteInput,
  ModelCompleteResult,
} from './client.js';
import { ModelClientError, ModelRateLimitError } from './client.js';

/**
 * Explicit provider-auth seam for the Agent SDK adapter (loreweaver-lus).
 *
 * By default the Agent SDK inherits ambient `process.env` auth — the local-dev
 * path, where `ANTHROPIC_API_KEY` is exported in the shell. Hosted BYOK and
 * other deployments instead hand each client its own provider secret through
 * an {@link AgentSdkAuthSource}, so authentication never depends on ambient
 * process state.
 *
 * The secret is used ONLY to authenticate the SDK call. It is held in an
 * ECMAScript-private (`#`) field — invisible to `JSON.stringify`, `Object.keys`,
 * and structured-clone — and is forwarded ONLY through the SDK process
 * environment. It is never folded into the prompt, the model id, trace
 * records, logs, tool payloads, or any persisted campaign data.
 */
export interface AgentSdkAuth {
  /**
   * Environment variables injected into the Agent SDK process for the call,
   * e.g. `{ ANTHROPIC_API_KEY: '...' }`. Merged over the inherited
   * `process.env`, so unrelated variables (PATH, HOME, ...) are preserved.
   */
  env: Record<string, string>;
}

/**
 * An auth source: either a fixed {@link AgentSdkAuth}, or a function resolved
 * on every `complete()` call. The function form supports per-request secrets
 * and short-lived / rotating credentials without rebuilding the client.
 */
export type AgentSdkAuthSource = AgentSdkAuth | (() => AgentSdkAuth);

/**
 * Optional opt-in session debug wiring for the adapter (eshyra-iu18). When a
 * {@link SessionDebugSink} is supplied, every `complete()` call emits one
 * structural debug record — on both the success and failure paths — describing
 * the prompt structure, tool protocol, and the model/profile/auth labels passed
 * here. The labels are plain identifiers (never the credential); the adapter
 * keeps the secret in its `#auth` field and never routes it through the sink.
 */
export interface AgentSdkDebugOptions {
  readonly debug?: SessionDebugSink;
  /** Resolved profile name (e.g. `premium_dm`), recorded as a label. */
  readonly profile?: string;
  /** Quality tier label (e.g. `premium`). */
  readonly tier?: string;
  /** Auth mode label (`api-key` / `oauth-token`) — never the credential. */
  readonly authMode?: string;
}

/**
 * True when a provider error message indicates a rate-limit or provider-quota
 * condition. Covers both HTTP 429 patterns and Claude Code subscription exhaustion
 * messages such as "You've hit your session limit · resets 2:30am".
 */
function isRateLimitMessage(msg: string): boolean {
  const lower = msg.toLowerCase();
  return (
    lower.includes('rate limit') ||
    lower.includes('rate_limit') ||
    lower.includes('too many requests') ||
    lower.includes('session limit') ||
    lower.includes('usage limit') ||
    (lower.includes('resets') &&
      (lower.includes('session') || lower.includes('limit')))
  );
}

/**
 * Capability declaration for {@link AgentSdkModelClient} (ADR 0010). Fenced-text
 * tool transport is NOT gameplay-capable — see `gameplayCapable: false`.
 */
export const AGENT_SDK_LEGACY_ADAPTER_CAPABILITIES: ModelAdapterCapabilities = {
  adapterFamily: 'agent-harness',
  toolTransport: 'fenced-text',
  turnLoopOwner: 'provider-harness',
  vendor: 'anthropic',
  gameplayCapable: false,
};

/**
 * Legacy fenced-text Agent SDK adapter. It references the Claude Agent SDK by
 * TYPE only; the runtime `query` comes from `agentSdkLoader.ts`, loaded lazily
 * inside `complete()` so the `@eshyra/core` barrel never requires the SDK at
 * import time (eshyra-ern3). If the installed SDK's surface differs from the
 * assumptions below, adapt here and the loader — the ModelClient contract and
 * all unit tests stay unchanged.
 *
 * Verified against @anthropic-ai/claude-agent-sdk@0.3.143:
 * - `query()` returns `Query extends AsyncGenerator<SDKMessage, void>`
 * - `SDKResultSuccess` has `type: 'result'`, `subtype: 'success'`, and `result: string`
 * - `SDKResultError` has `type: 'result'` and a non-'success' `subtype` (e.g. 'error_during_execution')
 * - Extraction narrows to `SDKResultSuccess` by checking `type === 'result'` AND
 *   `subtype === 'success'`, which correctly excludes SDKResultError.
 * - `options.env` overrides the environment of the spawned SDK process (it
 *   otherwise defaults to `process.env`); this is the BYOK auth-injection seam.
 *
 * Error path (loreweaver-jmv): a provider failure must surface as a thrown
 * `ModelClientError`, never a silent empty-string return — see ModelClient.
 */
export class AgentSdkModelClient implements ModelClient {
  /** Capability declaration (ADR 0010). Not gameplay-capable; throws if tools provided. */
  readonly capabilities: ModelAdapterCapabilities =
    AGENT_SDK_LEGACY_ADAPTER_CAPABILITIES;

  // ECMAScript-private (`#`) so an accidentally serialized client — e.g. one
  // captured into a turn trace or a log line — cannot leak the auth source.
  // TypeScript's `private` keyword would still leave an enumerable own property.
  readonly #model: string;
  readonly #auth: AgentSdkAuthSource | undefined;
  readonly #debug: AgentSdkDebugOptions | undefined;

  /**
   * @param model Provider-specific model id.
   * @param auth  Optional explicit provider-auth source. When omitted, the SDK
   *              falls back to ambient `process.env` auth (the local-dev path).
   * @param debug Optional opt-in session debug wiring (eshyra-iu18). Off by
   *              default, so the adapter emits no diagnostics unless asked.
   */
  constructor(
    model: string,
    auth?: AgentSdkAuthSource,
    debug?: AgentSdkDebugOptions,
  ) {
    this.#model = model;
    this.#auth = auth;
    this.#debug = debug;
  }

  async complete(input: ModelCompleteInput): Promise<ModelCompleteResult> {
    // Guard: fenced-text cannot forward tools to the provider natively. Failing
    // loudly here prevents released gameplay from silently proceeding with
    // tools provided but not forwarded (ADR 0010). Use AgentSdkMcpModelClient
    // for gameplay; this adapter is research/non-tool use only.
    if (input.tools && input.tools.length > 0) {
      throw new ModelClientError(
        'AgentSdkModelClient (fenced-text) cannot forward tools to the provider — ' +
          'the model has no native tools and the fenced-text protocol is not a ' +
          'supported gameplay path (ADR 0010). Use AgentSdkMcpModelClient for gameplay.',
      );
    }

    // The Agent SDK exposes a single `prompt` string + `systemPrompt` option,
    // so the adapter flattens the structured messages internally. This is the
    // permitted-flatten path (eshyra-0jq.11): the contract above carries
    // structure, the adapter renders the SDK's actual surface. Native tool
    // channels, response-format hints, profile, and trace are not yet wired
    // through the Agent SDK and are intentionally ignored — callers can
    // populate them and other adapters will read them.
    const prompt = input.messages
      .map((m) => `${m.role}: ${m.content}`)
      .join('\n');
    const auth = this.#resolveAuth();
    // Load the Claude Agent SDK lazily so importing this module (and the
    // `@eshyra/core` barrel) does not require the SDK at runtime — installer
    // editions that omit the Claude binary (api/codex) must still load core
    // (eshyra-ern3). `import type` above is erased, so only this runtime import
    // touches the package.
    const { query } = await loadAgentSdk();
    let text: string | undefined;
    let errorSubtype: string | undefined;
    try {
      for await (const message of query({
        prompt,
        options: {
          model: this.#model,
          ...(input.system ? { systemPrompt: input.system } : {}),
          // With an explicit credential, build a child env that strips every
          // inherited provider credential before applying the selected one, so an
          // ambient ANTHROPIC_API_KEY cannot shadow a chosen subscription token
          // (eshyra-oobh). Omitted entirely when no auth source is set, so the SDK
          // keeps its default ambient-`process.env` behaviour.
          ...(auth ? { env: buildChildSdkEnv(auth.env) } : {}),
        },
      })) {
        if (message.type === 'result') {
          if (message.subtype === 'success') {
            text = (message as SDKResultSuccess).result;
          } else {
            // SDKResultError: type 'result' with a non-'success' subtype.
            errorSubtype = message.subtype;
          }
        }
      }
    } catch (err) {
      const messageText = redactSecrets(
        err instanceof Error ? err.message : String(err),
      );
      this.#recordDebug(input, { ok: false, error: messageText });
      if (isRateLimitMessage(messageText)) {
        throw new ModelRateLimitError(`Agent SDK rate limit: ${messageText}`);
      }
      throw err;
    }
    if (text === undefined) {
      const message =
        errorSubtype !== undefined
          ? `Agent SDK returned an error result (subtype: ${errorSubtype})`
          : 'Agent SDK response ended without a result message';
      this.#recordDebug(input, { ok: false, error: message });
      throw new ModelClientError(message);
    }
    this.#recordDebug(input, {
      ok: true,
      resultChars: text.length,
      resultApproxTokens: Math.ceil(text.length / 4),
      stopReason: 'end_turn',
    });
    // The Agent SDK already drives any tool use internally and surfaces only
    // the final assistant text, so the structured `toolCalls` channel stays
    // unpopulated. `stopReason` is `end_turn` whenever we got a successful
    // result message.
    return { text, stopReason: 'end_turn' };
  }

  /**
   * Emit one structural debug record for a `complete()` call, if a sink is
   * wired. Faithful about the adapter's behaviour: `forwardedToolNames` is empty
   * because the Agent SDK receives none of the provider-neutral tool
   * definitions — it drives tools through its own harness and the fenced-text
   * protocol in the system prompt. Best-effort: a sink failure must never break
   * a turn, so any throw here is swallowed.
   */
  #recordDebug(input: ModelCompleteInput, outcome: ModelCallOutcome): void {
    const sink = this.#debug?.debug;
    if (sink === undefined) {
      return;
    }
    try {
      const trace: ModelCallTrace = {
        ...(input.trace?.campaignId
          ? { campaignId: input.trace.campaignId }
          : {}),
        ...(input.trace?.sessionId ? { sessionId: input.trace.sessionId } : {}),
        ...(input.trace?.turnId ? { turnId: input.trace.turnId } : {}),
        ...(input.trace?.extra?.purpose
          ? { purpose: input.trace.extra.purpose }
          : {}),
        ...(input.trace?.extra?.round
          ? { round: input.trace.extra.round }
          : {}),
      };
      sink.record(
        buildModelCallEvent({
          trace,
          model: this.#model,
          ...(this.#debug?.profile ? { profile: this.#debug.profile } : {}),
          ...(this.#debug?.tier ? { tier: this.#debug.tier } : {}),
          ...(this.#debug?.authMode ? { authMode: this.#debug.authMode } : {}),
          // The adapter relies on the fenced-text protocol carried in the system
          // prompt; it forwards no native tool channel to the SDK.
          toolProtocolMode: 'fenced-text',
          ...(input.system !== undefined ? { system: input.system } : {}),
          messages: input.messages,
          ...(input.tools ? { providedTools: input.tools } : {}),
          forwardedToolNames: [],
          outcome,
          captureContent: sink.captureContent,
        }),
      );
    } catch {
      // Diagnostics must never destabilize a turn.
    }
  }

  /**
   * Resolve the auth source for this call. `undefined` means no explicit auth
   * was configured, so the SDK uses ambient `process.env` auth.
   */
  #resolveAuth(): AgentSdkAuth | undefined {
    if (this.#auth === undefined) {
      return undefined;
    }
    return typeof this.#auth === 'function' ? this.#auth() : this.#auth;
  }
}
