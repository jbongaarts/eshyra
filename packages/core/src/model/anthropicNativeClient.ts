import Anthropic from '@anthropic-ai/sdk';
import {
  buildModelCallEvent,
  type ModelCallOutcome,
  type ModelCallTrace,
  type SessionDebugSink,
} from '../debug/sessionDebug.js';
import { redactSecrets } from '../memory/turnFailureDiagnostic.js';
import type {
  ModelAdapterCapabilities,
  ModelClient,
  ModelCompleteInput,
  ModelCompleteResult,
  ModelMessage,
  ModelStopReason,
  ModelToolCall,
  ModelToolResult,
} from './client.js';
import { ModelClientError } from './client.js';
import type { ModelToolDefinition } from './toolSchema.js';

/**
 * Why this adapter exists (eshyra-eznk).
 *
 * The Claude Agent SDK (`@anthropic-ai/claude-agent-sdk`, used by
 * {@link import('./agentSdkClient.js').AgentSdkModelClient}) runs its OWN
 * agentic harness internally: it exposes a single `prompt` string, drives its
 * own built-in tools, and returns only the final assistant text. It has no seam
 * to (a) hand it the provider-neutral Eshyra tool definitions, (b) get raw
 * provider tool-use blocks back for the Eshyra turn loop to execute, or (c)
 * transport tool results back in the native format. The released gameplay path
 * therefore fell back to the custom fenced-text protocol described in the system
 * prompt — but the underlying model never actually received any tools, so it
 * truthfully reported that the described DM tools were "not present".
 *
 * This adapter talks to the Anthropic Messages API directly via the
 * lower-level `@anthropic-ai/sdk`, which DOES expose the native `tools` channel.
 * It converts each {@link ModelToolDefinition} into a native tool declaration,
 * sends them on the request, and parses native `tool_use` blocks back into
 * {@link ModelToolCall}s. Deterministic validation and execution stay in the
 * Eshyra turn loop (`runModelLoop`): this adapter only transports tool calls and
 * results across the provider boundary — it never executes a game tool itself.
 *
 * The ModelClient contract is unchanged, so the core gameplay layer stays
 * provider-neutral; only this file imports the Anthropic SDK.
 *
 * Role after eznk rework: this is the API-KEY-native alternative, NOT the
 * released default. Released local `eshyra play` uses
 * {@link import('./agentSdkMcpClient.js').AgentSdkMcpModelClient}, the SUPPORTED
 * Agent SDK in-process MCP path, so the subscription-backed flow needs no Console
 * API key. This Messages adapter is retained for callers that authenticate with
 * an `ANTHROPIC_API_KEY` and want native tool calls returned to the outer loop.
 */

/** Debug label reported for the native provider tool channel (eshyra-eznk). */
export const ANTHROPIC_NATIVE_TOOL_PROTOCOL = 'anthropic-native';

/**
 * Capability declaration for {@link AnthropicNativeModelClient} (ADR 0010).
 * API-native adapter, native tool channel, Eshyra drives the turn loop.
 */
export const ANTHROPIC_NATIVE_ADAPTER_CAPABILITIES: ModelAdapterCapabilities = {
  adapterFamily: 'api-native',
  toolTransport: 'api-native',
  turnLoopOwner: 'eshyra',
  vendor: 'anthropic',
  gameplayCapable: true,
};

/**
 * Per-response output cap. Kept under the ~16K threshold above which the SDK
 * recommends streaming to avoid HTTP timeouts — a single DM round (narration
 * plus any tool calls) fits comfortably, and the turn loop drives multiple
 * rounds when more work is needed.
 */
const MAX_OUTPUT_TOKENS = 8192;

/**
 * Provider-auth seam for the native Anthropic adapter. Mirrors the Agent SDK
 * adapter's shape so the CLI can inject the same resolved credential: exactly
 * one of `ANTHROPIC_API_KEY` (Anthropic Console key) or `CLAUDE_CODE_OAUTH_TOKEN`
 * (Claude Pro/Max subscription token) lives in `env`. The secret is used ONLY to
 * authenticate the SDK client; it is held in an ECMAScript-private field and is
 * never folded into the prompt, model id, trace records, logs, or tool payloads.
 */
export interface AnthropicAuth {
  /** The single credential variable in use, e.g. `{ ANTHROPIC_API_KEY: '...' }`. */
  env: Record<string, string>;
}

/**
 * An auth source: a fixed {@link AnthropicAuth} or a function resolved on every
 * `complete()` call (for per-request / rotating credentials).
 */
export type AnthropicAuthSource = AnthropicAuth | (() => AnthropicAuth);

/**
 * Optional opt-in session debug wiring (eshyra-iu18). When a
 * {@link SessionDebugSink} is supplied, every `complete()` call emits one
 * structural record describing the prompt structure, the tool protocol, and the
 * model/profile/auth labels. Labels are plain identifiers, never the credential.
 */
export interface AnthropicNativeDebugOptions {
  readonly debug?: SessionDebugSink;
  /** Resolved profile name (e.g. `premium_dm`), recorded as a label. */
  readonly profile?: string;
  /** Quality tier label (e.g. `premium`). */
  readonly tier?: string;
  /** Auth mode label (`api-key` / `oauth-token`) — never the credential. */
  readonly authMode?: string;
}

/** Convert provider-neutral tool definitions into native Anthropic tools. */
function toNativeTools(
  defs: readonly ModelToolDefinition[] | undefined,
): Anthropic.Tool[] {
  if (defs === undefined) {
    return [];
  }
  return defs.map((def) => ({
    name: def.name,
    description: def.description,
    // The Eshyra tool input schema is a deliberate JSON-Schema subset chosen to
    // lift directly into `input_schema` with no translation (see toolSchema.ts).
    input_schema: def.inputSchema as unknown as Anthropic.Tool.InputSchema,
  }));
}

/** Serialize a deterministic tool result for the native `tool_result` block. */
function toResultPayload(result: ModelToolResult['result']): unknown {
  return result.ok
    ? { ok: true, data: result.data }
    : { ok: false, code: result.code, message: result.message };
}

/**
 * Render one provider-neutral {@link ModelMessage} into the native Anthropic
 * message shape, projecting structured tool calls onto `tool_use` blocks and
 * structured tool results onto `tool_result` blocks so the provider can
 * correlate them by id across rounds.
 */
function toNativeMessage(message: ModelMessage): Anthropic.MessageParam {
  if (message.role === 'assistant') {
    const calls = message.toolCalls ?? [];
    if (calls.length === 0) {
      return { role: 'assistant', content: message.content };
    }
    const blocks: Anthropic.ContentBlockParam[] = [];
    if (message.content.length > 0) {
      blocks.push({ type: 'text', text: message.content });
    }
    for (const [index, call] of calls.entries()) {
      blocks.push({
        type: 'tool_use',
        id: call.id ?? `tool_${index}`,
        name: call.name,
        input: call.args ?? {},
      });
    }
    return { role: 'assistant', content: blocks };
  }

  const results = message.toolResults ?? [];
  if (results.length === 0) {
    return { role: 'user', content: message.content };
  }
  const blocks: Anthropic.ContentBlockParam[] = results.map((result) => ({
    type: 'tool_result',
    tool_use_id: result.callId ?? '',
    content: JSON.stringify(toResultPayload(result.result)),
    ...(result.result.ok ? {} : { is_error: true }),
  }));
  if (message.content.length > 0) {
    blocks.push({ type: 'text', text: message.content });
  }
  return { role: 'user', content: blocks };
}

/** Map an Anthropic stop reason onto the provider-neutral {@link ModelStopReason}. */
function toStopReason(
  reason: Anthropic.Message['stop_reason'],
): ModelStopReason | undefined {
  switch (reason) {
    case 'tool_use':
      return 'tool_use';
    case 'end_turn':
      return 'end_turn';
    case 'max_tokens':
      return 'max_tokens';
    case null:
      return undefined;
    default:
      return 'other';
  }
}

/**
 * Native Anthropic Messages adapter (eshyra-eznk). The ONLY file besides
 * `agentSdkClient.ts` permitted to import an Anthropic SDK — here the
 * lower-level `@anthropic-ai/sdk`, which exposes the native tool channel the
 * Agent SDK wrapper does not. Adapt provider-surface changes ONLY here; the
 * ModelClient contract and the gameplay layer stay unchanged.
 */
export class AnthropicNativeModelClient implements ModelClient {
  /** Capability declaration (ADR 0010). Access on the concrete type. */
  readonly capabilities: ModelAdapterCapabilities =
    ANTHROPIC_NATIVE_ADAPTER_CAPABILITIES;

  // ECMAScript-private (`#`) so an accidentally serialized client cannot leak
  // the auth source — invisible to `JSON.stringify` and `Object.keys`.
  readonly #model: string;
  readonly #auth: AnthropicAuthSource | undefined;
  readonly #debug: AnthropicNativeDebugOptions | undefined;

  /**
   * @param model Provider-specific model id.
   * @param auth  Optional explicit provider-auth source. When omitted, the SDK
   *              falls back to ambient `process.env` auth (the local-dev path).
   * @param debug Optional opt-in session debug wiring (off by default).
   */
  constructor(
    model: string,
    auth?: AnthropicAuthSource,
    debug?: AnthropicNativeDebugOptions,
  ) {
    this.#model = model;
    this.#auth = auth;
    this.#debug = debug;
  }

  async complete(input: ModelCompleteInput): Promise<ModelCompleteResult> {
    const tools = toNativeTools(input.tools);
    const forwardedToolNames = tools.map((tool) => tool.name);
    const messages = input.messages.map(toNativeMessage);
    const client = this.#buildClient();

    let response: Anthropic.Message;
    try {
      response = await client.messages.create({
        model: this.#model,
        max_tokens: MAX_OUTPUT_TOKENS,
        ...(input.system !== undefined ? { system: input.system } : {}),
        messages,
        // Provider-native tool channel: the Eshyra tool definitions are sent as
        // first-class tools, so the model actually has them (eshyra-eznk).
        ...(tools.length > 0 ? { tools } : {}),
      });
    } catch (err) {
      const message = redactSecrets(
        err instanceof Error ? err.message : String(err),
      );
      this.#recordDebug(input, forwardedToolNames, {
        ok: false,
        error: message,
      });
      throw new ModelClientError(`Anthropic API call failed: ${message}`);
    }

    const text = response.content
      .filter((block): block is Anthropic.TextBlock => block.type === 'text')
      .map((block) => block.text)
      .join('');
    const toolCalls: ModelToolCall[] = response.content
      .filter(
        (block): block is Anthropic.ToolUseBlock => block.type === 'tool_use',
      )
      .map((block) => ({
        id: block.id,
        name: block.name,
        args: block.input,
      }));
    const stopReason = toStopReason(response.stop_reason);

    this.#recordDebug(input, forwardedToolNames, {
      ok: true,
      resultChars: text.length,
      resultApproxTokens: Math.ceil(text.length / 4),
      ...(stopReason ? { stopReason } : {}),
    });

    return {
      text,
      ...(toolCalls.length > 0 ? { toolCalls } : {}),
      ...(stopReason ? { stopReason } : {}),
    };
  }

  /**
   * Build an authenticated Anthropic client for this call. The CLI/config layer
   * resolves exactly one credential variable; map it to the SDK's matching auth
   * field. For an OAuth subscription token the SDK needs the bearer + the
   * `oauth-2025-04-20` beta header, and `apiKey: null` so it cannot fall back to
   * an ambient `ANTHROPIC_API_KEY` and send conflicting auth.
   */
  #buildClient(): Anthropic {
    const auth = this.#resolveAuth();
    if (auth === undefined) {
      return new Anthropic();
    }
    const apiKey = auth.env.ANTHROPIC_API_KEY;
    if (apiKey) {
      return new Anthropic({ apiKey });
    }
    const oauthToken = auth.env.CLAUDE_CODE_OAUTH_TOKEN;
    if (oauthToken) {
      return new Anthropic({
        apiKey: null,
        authToken: oauthToken,
        defaultHeaders: { 'anthropic-beta': 'oauth-2025-04-20' },
      });
    }
    return new Anthropic();
  }

  /**
   * Emit one structural debug record for a `complete()` call, if a sink is
   * wired. Unlike the Agent SDK adapter, `forwardedToolNames` is populated —
   * these are the tools actually sent to the provider's native channel — and the
   * protocol mode is {@link ANTHROPIC_NATIVE_TOOL_PROTOCOL}, never `fenced-text`.
   * Best-effort: any sink failure is swallowed so diagnostics never break a turn.
   */
  #recordDebug(
    input: ModelCompleteInput,
    forwardedToolNames: readonly string[],
    outcome: ModelCallOutcome,
  ): void {
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
          toolProtocolMode: ANTHROPIC_NATIVE_TOOL_PROTOCOL,
          ...(input.system !== undefined ? { system: input.system } : {}),
          messages: input.messages,
          ...(input.tools ? { providedTools: input.tools } : {}),
          forwardedToolNames,
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
  #resolveAuth(): AnthropicAuth | undefined {
    if (this.#auth === undefined) {
      return undefined;
    }
    return typeof this.#auth === 'function' ? this.#auth() : this.#auth;
  }
}
