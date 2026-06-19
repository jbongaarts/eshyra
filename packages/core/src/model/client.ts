import type { ModelToolDefinition } from './toolSchema.js';

/**
 * Hint to the provider about the expected response shape. `text` is the
 * default; `json` asks the provider for a JSON-shaped response when its API
 * supports a structured-output mode (e.g. Anthropic / OpenAI JSON modes).
 * Adapters that have no such mode SHOULD ignore the hint rather than fail.
 */
export type ModelResponseFormat = 'text' | 'json';

/**
 * Whether the adapter talks to a provider API directly (Eshyra owns the full
 * call lifecycle) or delegates to a provider-owned agent harness (SDK drives
 * its own tool loop; Eshyra bridges in via an executor delegate).
 *
 * ADR 0010: these are separate modes, not interchangeable auth variants.
 */
export type AdapterFamily = 'api-native' | 'agent-harness';

/**
 * How the adapter delivers Eshyra tool definitions to the provider.
 *
 * - `api-native`: native `tools` parameter on a REST API request (provider
 *   returns structured `tool_use` blocks for the outer turn loop to execute).
 * - `agent-mcp`: in-process MCP server handed to the provider SDK; the SDK
 *   runs its own tool loop and calls Eshyra handlers in-process.
 * - `fenced-text`: tools described only in the system prompt as fenced JSON
 *   blocks — NOT a supported gameplay protocol (ADR 0010). The provider has
 *   no native tools and can truthfully report that. Retained only as a
 *   historical research adapter.
 */
export type ToolTransport = 'api-native' | 'agent-mcp' | 'fenced-text';

/**
 * Who drives the tool-call/response loop.
 *
 * - `eshyra`: the Eshyra orchestrator (`runModelLoop`) drives the loop,
 *   calling the adapter once per round and executing tools between rounds.
 * - `provider-harness`: the provider SDK drives its own loop; Eshyra hooks in
 *   via the {@link ModelCompleteInput.executeTool} delegate or accepts the
 *   harness output as a single completed result.
 */
export type TurnLoopOwner = 'eshyra' | 'provider-harness';

/**
 * Static capability declaration every concrete adapter class exposes as a
 * `capabilities` property (ADR 0010). Makes the adapter family, tool
 * transport, turn-loop ownership, and gameplay support explicit and
 * inspectable without requiring a live call.
 *
 * The `ModelClient` interface does not include `capabilities` — test doubles
 * implement only `complete()`. Access `capabilities` on the concrete class
 * before widening to `ModelClient`.
 */
export interface ModelAdapterCapabilities {
  /** API-native or agent-harness (ADR 0010). */
  readonly adapterFamily: AdapterFamily;
  /** How tools are delivered to the provider. */
  readonly toolTransport: ToolTransport;
  /** Who drives the turn loop. */
  readonly turnLoopOwner: TurnLoopOwner;
  /** Provider vendor identifier (e.g. `'anthropic'`, `'openai'`). */
  readonly vendor: string;
  /**
   * Whether this adapter supports released gameplay (i.e. native or MCP tool
   * forwarding). Adapters with `toolTransport === 'fenced-text'` set this
   * `false` and throw at `complete()` time when tools are provided, so a
   * misconfigured gameplay path fails loudly rather than silently dropping
   * tools.
   */
  readonly gameplayCapable: boolean;
}

/**
 * Provider-neutral profile metadata threaded through the call site
 * (eshyra-0jq.11). Adapters may use this for routing, logging, or
 * rate-limit shaping. Never contains provider-specific identifiers.
 */
export interface ModelProfileMetadata {
  /** Profile name from `MODEL_PROFILES`. */
  readonly profile: string;
  /** Quality tier ("premium", "standard", "auxiliary", "experimental"). */
  readonly tier?: string;
  /** Whether this call is permitted to drive canon-changing operations. */
  readonly canonChanging?: boolean;
}

/**
 * Trace metadata an adapter may forward to provider-side logs or its own
 * tracing channel. Free-form by design so callers can add keys without
 * churning the contract; the core never inspects `extra`.
 */
export interface ModelTraceMetadata {
  readonly campaignId?: string;
  readonly sessionId?: string;
  readonly turnId?: string;
  /** Free-form extra fields (e.g. experiment id, ramp bucket). */
  readonly extra?: Readonly<Record<string, string>>;
}

/**
 * Structured input to a single ModelClient call. Adapters MAY flatten the
 * structured fields back into a single prompt string internally — the
 * Agent SDK adapter still does — but the contract preserves the structure so
 * future adapters can render native messages, native tool calls, and per-call
 * routing/trace metadata without changing core call sites.
 */
export interface ModelCompleteInput {
  system?: string;
  messages: readonly ModelMessage[];
  /**
   * Provider-neutral tool definitions the model may invoke (eshyra-0jq.10).
   * The fenced-text tool-call protocol does not consult this list — it's the
   * seam for adapters that target native provider tool channels.
   */
  tools?: readonly ModelToolDefinition[];
  /**
   * Adapter-side execution bridge for providers that own their OWN agentic loop
   * (eshyra-eznk). The Claude Agent SDK drives the tool loop internally and calls
   * tool handlers in-process; it does not hand tool calls back to the outer turn
   * loop. Such an adapter invokes this delegate from each tool handler so the
   * call runs through the SAME deterministic Eshyra executor the outer loop uses
   * — the adapter never reimplements gameplay semantics. The delegate is passed
   * the Eshyra tool name (provider/MCP names are mapped back inside the adapter),
   * so core gameplay records never see provider naming. Adapters that return
   * {@link ModelToolCall}s for the outer loop ignore this field.
   */
  executeTool?: ModelToolExecutor;
  responseFormat?: ModelResponseFormat;
  profile?: ModelProfileMetadata;
  trace?: ModelTraceMetadata;
}

/**
 * Deterministic outcome of executing one Eshyra tool. Structurally identical to
 * the orchestrator's `ToolResult`; redeclared here so the model layer stays free
 * of an orchestrator import.
 */
export type ModelToolExecutionResult = ModelToolResult['result'];

/**
 * Bridge a provider that runs its own tool loop (the Agent SDK MCP path) uses to
 * execute an Eshyra tool through the deterministic core executor. Receives the
 * Eshyra tool name and parsed args; resolves with the deterministic result. Must
 * not throw across the seam — tool failures come back as `{ ok: false, ... }` so
 * the provider can surface them as a tool result rather than crashing its loop.
 */
export type ModelToolExecutor = (call: {
  readonly name: string;
  readonly args: unknown;
}) => ModelToolExecutionResult | Promise<ModelToolExecutionResult>;

/**
 * A tool call a provider EXECUTED itself, inside its own agentic loop, via the
 * {@link ModelCompleteInput.executeTool} bridge (eshyra-eznk). Unlike
 * {@link ModelToolCall} — which the outer turn loop must still execute — these
 * have already run; the loop only records them for the transcript/trace. `name`
 * is always the Eshyra gameplay name (e.g. `roll`), never a provider/MCP name.
 */
export interface ProviderExecutedToolCall {
  /** Eshyra gameplay tool name (provider/MCP naming already mapped away). */
  readonly name: string;
  /** Parsed arguments the provider passed to the tool. */
  readonly args: unknown;
  /** Deterministic result the core executor returned. */
  readonly result: ModelToolExecutionResult;
  /** Provider/MCP-assigned call id, when the transport supplies one. */
  readonly callId?: string;
}

/**
 * A structured tool call returned by a provider that supports a native
 * tool-use channel. Adapters that flatten to text leave this absent;
 * orchestrators that already parse fenced `tool_call` blocks out of
 * {@link ModelCompleteResult.text} keep working unchanged.
 */
export interface ModelToolCall {
  /**
   * Provider-assigned id, when available. Used by adapters to correlate a
   * subsequent `tool_result` message with the call.
   */
  readonly id?: string;
  /** Tool name (must match a registered {@link ModelToolDefinition.name}). */
  readonly name: string;
  /** Parsed JSON arguments. */
  readonly args: unknown;
}

/**
 * Provider-neutral result for a native tool call. Adapters render this into
 * their provider's required history shape (for example, Anthropic
 * `tool_result` blocks or OpenAI `tool` messages).
 */
export interface ModelToolResult {
  /** Provider-assigned id copied from the corresponding tool call. */
  readonly callId?: string;
  /** Tool name, retained for providers and traces that use name correlation. */
  readonly name: string;
  /** Deterministic Eshyra tool outcome. */
  readonly result:
    | { readonly ok: true; readonly data: unknown }
    | {
        readonly ok: false;
        readonly code: string;
        readonly message: string;
      };
}

/**
 * Normalized reason the model stopped. Adapters map provider-specific values:
 *  - `end_turn`: model is done; `text` holds the final response.
 *  - `tool_use`: model emitted structured `toolCalls` and is awaiting results.
 *  - `max_tokens`: response was truncated.
 *  - `other`: anything not covered above (adapter-specific).
 *
 * Optional — adapters that can't distinguish stop reasons leave it unset.
 */
export type ModelStopReason = 'end_turn' | 'tool_use' | 'max_tokens' | 'other';

/**
 * Provider-neutral conversation message. Plain-text adapters use `content`
 * only. Native-tool adapters also render `toolCalls` on assistant messages and
 * `toolResults` on user messages into the provider-specific wire format.
 */
export interface ModelMessage {
  role: 'user' | 'assistant';
  content: string;
  readonly toolCalls?: readonly ModelToolCall[];
  readonly toolResults?: readonly ModelToolResult[];
  readonly stopReason?: ModelStopReason;
}

/**
 * Actual token counts reported by the provider for a single call, when the
 * adapter can obtain them from the API response. Token counts are
 * provider-surface data: adapters that cannot retrieve them (e.g. the Agent
 * SDK harness, which hides per-round details behind its own loop) leave
 * {@link ModelCompleteResult.usage} absent.
 */
export interface ModelUsage {
  readonly inputTokens: number;
  readonly outputTokens: number;
  /** Tokens served from the provider's prompt cache (cache hit). */
  readonly cacheReadTokens?: number;
  /** Tokens written into the provider's prompt cache (cache fill). */
  readonly cacheWriteTokens?: number;
}

/**
 * Structured result of a ModelClient call (eshyra-0jq.11). `text` is
 * always populated (possibly empty) so callers that only care about narration
 * can ignore the structured fields entirely. Native tool calls are normalized
 * by the orchestrator into the same deterministic execution path as fenced
 * `tool_call` blocks. A `tool_use` stop reason without consumable calls is a
 * provider-contract error and fails the turn loudly.
 */
export interface ModelCompleteResult {
  /** Free-text assistant response. Always present, possibly empty. */
  readonly text: string;
  /** Native structured tool calls, when the provider returns them. */
  readonly toolCalls?: readonly ModelToolCall[];
  /**
   * Tool calls the provider already EXECUTED inside its own agentic loop via the
   * {@link ModelCompleteInput.executeTool} bridge (the Agent SDK MCP path,
   * eshyra-eznk). The outer turn loop records these for the trace rather than
   * executing them again. Mutually exclusive in practice with {@link toolCalls}:
   * an adapter either returns calls for the outer loop to run, or runs them
   * itself and reports them here.
   */
  readonly executedToolCalls?: readonly ProviderExecutedToolCall[];
  /** Best-effort normalized stop reason. */
  readonly stopReason?: ModelStopReason;
  /**
   * Actual token counts from the provider API response, when the adapter can
   * surface them (eshyra-cuxm). Absent for adapters that do not expose
   * per-call token data (e.g. the Agent SDK harness path).
   */
  readonly usage?: ModelUsage;
  /**
   * Provider-assigned request/message identifier, when available (eshyra-cuxm).
   * Used as a safe correlation handle in usage records — never a secret.
   */
  readonly requestId?: string;
}

/**
 * Raised by a ModelClient when the underlying provider fails to produce a
 * completion — a provider/SDK error, or a response stream that ends without a
 * result message.
 *
 * Error-path contract (decided in loreweaver-jmv): `complete` MUST reject with
 * a ModelClientError on provider failure rather than resolving with an empty
 * result. A silently-empty resolution is indistinguishable from a legitimately
 * empty completion and surfaces downstream as blank narration; a typed throw
 * lets callers — notably the atomic Orchestrator turn loop, which is
 * SAVEPOINT-wrapped — fail loudly and leave pre-turn state intact. A typed
 * Result return was rejected as the heavier option: it would ripple a
 * discriminated union through every caller and type for a path that is always
 * fatal to the turn anyway.
 *
 * This is distinct from a *successful* completion whose text happens to be
 * empty — that still resolves normally; judging an empty-but-successful
 * narration is the caller's concern, not the client's.
 */
export class ModelClientError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ModelClientError';
  }
}

export interface ModelClient {
  /**
   * Resolve with a structured completion result for the given input.
   *
   * @throws {ModelClientError} if the provider errors or the response stream
   * ends without a result. Implementations MUST NOT swallow provider failures
   * into an empty-text return.
   */
  complete(input: ModelCompleteInput): Promise<ModelCompleteResult>;
}
