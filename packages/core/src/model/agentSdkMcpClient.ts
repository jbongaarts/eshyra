import type {
  SDKResultError,
  SDKResultSuccess,
  SDKSystemMessage,
} from '@anthropic-ai/claude-agent-sdk';
import {
  createSdkMcpServer,
  query,
  tool,
} from '@anthropic-ai/claude-agent-sdk';
import {
  buildModelCallEvent,
  type McpServerStatus,
  type ModelCallOutcome,
  type ModelCallTrace,
  type SessionDebugSink,
} from '../debug/sessionDebug.js';
import { redactSecrets } from '../memory/turnFailureDiagnostic.js';
import type { AgentSdkAuth, AgentSdkAuthSource } from './agentSdkClient.js';
import { buildAmbientSdkEnv, buildChildSdkEnv } from './agentSdkEnv.js';
import type {
  ModelAdapterCapabilities,
  ModelClient,
  ModelCompleteInput,
  ModelCompleteResult,
  ModelStopReason,
  ModelToolExecutionResult,
  ModelToolExecutor,
  ProviderExecutedToolCall,
} from './client.js';
import { ModelClientError, ModelRateLimitError } from './client.js';
import { toolInputSchemaToZodShape } from './jsonSchemaToZod.js';
import type { ModelToolDefinition } from './toolSchema.js';

/**
 * Agent SDK in-process MCP adapter (eshyra-eznk).
 *
 * Why this is the supported tool path. The Claude Agent SDK
 * (`@anthropic-ai/claude-agent-sdk`) owns its own agent/tool loop. The supported
 * way to give it custom tools is NOT the lower-level Anthropic Messages `tools`
 * parameter — it is the SDK's in-process MCP server: define tools with `tool()`,
 * wrap them with `createSdkMcpServer`, and pass the server to
 * `query({ options: { mcpServers } })`. The SDK then advertises the tools to the
 * model under the MCP name `mcp__{server}__{tool}` and, when the model calls one,
 * runs its handler IN THIS PROCESS — no extra service, no API key.
 *
 * This adapter converts each provider-neutral {@link ModelToolDefinition} into an
 * MCP `tool()` whose handler delegates to the deterministic Eshyra executor via
 * the {@link ModelCompleteInput.executeTool} bridge. The adapter never
 * reimplements gameplay semantics: it validates/receives args from the SDK,
 * calls the core executor, and renders the deterministic result back as an MCP
 * tool result. Because the SDK drives the loop, `complete()` returns the FINAL
 * narration plus a record of the tool calls it executed
 * ({@link ModelCompleteResult.executedToolCalls}) for the transcript/trace.
 *
 * The subscription path is preserved: the SDK authenticates from
 * `CLAUDE_CODE_OAUTH_TOKEN` (Claude Pro/Max) just as well as from
 * `ANTHROPIC_API_KEY`, so released local gameplay needs no Console API key.
 *
 * This file plus `agentSdkClient.ts` are the only ones permitted to import the
 * Claude Agent SDK. Adapt provider-surface changes ONLY here; the ModelClient
 * contract and the gameplay layer stay provider-neutral.
 */

/** Debug label reported for the Agent SDK MCP tool channel (eshyra-eznk). */
export const AGENT_SDK_MCP_TOOL_PROTOCOL = 'agent-sdk-mcp';

/** Stable in-process MCP server name. Generated tools are `mcp__eshyra__<tool>`. */
export const ESHYRA_MCP_SERVER_NAME = 'eshyra';

/** Transport/client label recorded in debug records (never a secret). */
export const AGENT_SDK_MCP_CLIENT_NAME = 'claude-agent-sdk';

/**
 * Capability declaration for {@link AgentSdkMcpModelClient} (ADR 0010).
 * Agent-harness adapter, in-process MCP tool transport, SDK drives the loop.
 */
export const AGENT_SDK_MCP_ADAPTER_CAPABILITIES: ModelAdapterCapabilities = {
  adapterFamily: 'agent-harness',
  toolTransport: 'agent-mcp',
  turnLoopOwner: 'provider-harness',
  vendor: 'anthropic',
  gameplayCapable: true,
};

/** App identifier folded into the SDK User-Agent (diagnostic, not a secret). */
const CLIENT_APP = 'eshyra-cli';

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
 * Map an Eshyra tool name to the MCP name the Agent SDK generates and the model
 * sees: `mcp__{server}__{tool}`. Keep this naming INSIDE the adapter — core
 * gameplay continues to use the bare Eshyra name (`roll`).
 */
export function toMcpToolName(
  toolName: string,
  server: string = ESHYRA_MCP_SERVER_NAME,
): string {
  return `mcp__${server}__${toolName}`;
}

/**
 * Inverse of {@link toMcpToolName}: recover the Eshyra tool name from a generated
 * MCP name. Returns `undefined` when the name is not an `mcp__{server}__` name
 * for this server, so callers never mistake an unrelated tool for an Eshyra one.
 */
export function fromMcpToolName(
  mcpName: string,
  server: string = ESHYRA_MCP_SERVER_NAME,
): string | undefined {
  const prefix = `mcp__${server}__`;
  return mcpName.startsWith(prefix) ? mcpName.slice(prefix.length) : undefined;
}

/**
 * Optional opt-in session debug wiring (eshyra-iu18). When a
 * {@link SessionDebugSink} is supplied, every `complete()` call emits one
 * structural record. Labels are plain identifiers, never the credential.
 */
export interface AgentSdkMcpDebugOptions {
  readonly debug?: SessionDebugSink;
  /** Resolved profile name (e.g. `premium_dm`), recorded as a label. */
  readonly profile?: string;
  /** Quality tier label (e.g. `premium`). */
  readonly tier?: string;
  /** Auth mode label (`api-key` / `oauth-token`) — never the credential. */
  readonly authMode?: string;
}

/**
 * The MCP tool-result shape the SDK `tool()` handler returns. The SDK's
 * `CallToolResult` carries an open `[x: string]: unknown` index signature, so
 * this mirrors it to stay structurally assignable.
 */
interface McpToolResult {
  [key: string]: unknown;
  content: Array<{ type: 'text'; text: string }>;
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
}

/** Serialize a deterministic tool result into an MCP tool-result payload. */
function toResultPayload(
  result: ModelToolExecutionResult,
): Record<string, unknown> {
  return result.ok
    ? { ok: true, data: result.data }
    : { ok: false, code: result.code, message: result.message };
}

/** Render a deterministic tool result as an MCP `CallToolResult`. */
function toMcpToolResult(result: ModelToolExecutionResult): McpToolResult {
  const payload = toResultPayload(result);
  return {
    content: [{ type: 'text', text: JSON.stringify(payload) }],
    structuredContent: payload,
    ...(result.ok ? {} : { isError: true }),
  };
}

/** Map an Agent SDK stop reason string onto the neutral {@link ModelStopReason}. */
function toStopReason(
  reason: string | null | undefined,
): ModelStopReason | undefined {
  switch (reason) {
    case 'tool_use':
      return 'tool_use';
    case 'end_turn':
      return 'end_turn';
    case 'max_tokens':
      return 'max_tokens';
    case null:
    case undefined:
      return undefined;
    default:
      return 'other';
  }
}

/**
 * Build one in-process MCP tool from a provider-neutral definition. The handler
 * delegates to the executor bridge and records the call/result; it NEVER runs
 * gameplay logic itself. A tool failure is returned as a tool result (with
 * `isError`) rather than thrown, so one bad call cannot crash the agent loop.
 */
function buildMcpTool(
  def: ModelToolDefinition,
  executor: ModelToolExecutor | undefined,
  executed: ProviderExecutedToolCall[],
): ReturnType<typeof tool> {
  return tool(
    def.name,
    def.description,
    toolInputSchemaToZodShape(def.inputSchema),
    async (args: unknown) => {
      const result: ModelToolExecutionResult = executor
        ? await executor({ name: def.name, args })
        : {
            ok: false,
            code: 'no_executor',
            message: `no tool executor wired for ${def.name}`,
          };
      // Record under the Eshyra name — provider/MCP naming never reaches here.
      executed.push({ name: def.name, args, result });
      return toMcpToolResult(result);
    },
  );
}

/**
 * Agent SDK MCP model client (eshyra-eznk). Released local gameplay runs on this
 * adapter so the Eshyra tools are exposed to the model through the SDK's
 * supported in-process MCP channel, while the deterministic executor stays the
 * single owner of gameplay semantics.
 */
export class AgentSdkMcpModelClient implements ModelClient {
  /** Capability declaration (ADR 0010). Access on the concrete type. */
  readonly capabilities: ModelAdapterCapabilities =
    AGENT_SDK_MCP_ADAPTER_CAPABILITIES;

  // ECMAScript-private (`#`) so an accidentally serialized client cannot leak
  // the auth source — invisible to `JSON.stringify` and `Object.keys`.
  readonly #model: string;
  readonly #auth: AgentSdkAuthSource | undefined;
  readonly #debug: AgentSdkMcpDebugOptions | undefined;

  /**
   * @param model Provider-specific model id.
   * @param auth  Optional explicit provider-auth source. When omitted, the SDK
   *              falls back to ambient `process.env` auth (the local-dev path).
   * @param debug Optional opt-in session debug wiring (off by default).
   */
  constructor(
    model: string,
    auth?: AgentSdkAuthSource,
    debug?: AgentSdkMcpDebugOptions,
  ) {
    this.#model = model;
    this.#auth = auth;
    this.#debug = debug;
  }

  async complete(input: ModelCompleteInput): Promise<ModelCompleteResult> {
    const defs = input.tools ?? [];
    const executed: ProviderExecutedToolCall[] = [];
    const mcpTools = defs.map((def) =>
      buildMcpTool(def, input.executeTool, executed),
    );
    const server = createSdkMcpServer({
      name: ESHYRA_MCP_SERVER_NAME,
      version: '0.1.0',
      tools: mcpTools,
    });

    // The generated MCP names are what the model actually sees and what we
    // pre-approve, so Claude can call them without a permission round trip.
    const forwardedToolNames = defs.map((def) => toMcpToolName(def.name));

    // The Agent SDK exposes a single `prompt` string + `systemPrompt` option, so
    // the adapter flattens the structured messages (the permitted-flatten path).
    const prompt = input.messages
      .map((m) => `${m.role}: ${m.content}`)
      .join('\n');
    const env = this.#buildEnv();

    let resultText: string | undefined;
    let stopReasonRaw: string | null | undefined;
    let errorSubtype: string | undefined;
    let errorStopReason: string | null | undefined;
    let mcpServers: readonly McpServerStatus[] = [];

    try {
      for await (const message of query({
        prompt,
        options: {
          model: this.#model,
          ...(input.system ? { systemPrompt: input.system } : {}),
          // Supported custom-tool path: hand the in-process MCP server to the
          // SDK and pre-approve exactly the generated Eshyra tool names.
          mcpServers: { [ESHYRA_MCP_SERVER_NAME]: server },
          allowedTools: forwardedToolNames,
          // Strip every Claude Code built-in tool so only the Eshyra MCP tools
          // remain in the gameplay context.
          tools: [],
          env,
        },
      })) {
        if (message.type === 'system' && message.subtype === 'init') {
          mcpServers = (message as SDKSystemMessage).mcp_servers ?? [];
        } else if (message.type === 'result') {
          if (message.subtype === 'success') {
            const success = message as SDKResultSuccess;
            resultText = success.result;
            stopReasonRaw = success.stop_reason;
          } else {
            errorSubtype = message.subtype;
            errorStopReason = (message as SDKResultError).stop_reason;
          }
        }
      }
    } catch (err) {
      const messageText = redactSecrets(
        err instanceof Error ? err.message : String(err),
      );
      this.#recordDebug(input, forwardedToolNames, mcpServers, {
        ok: false,
        error: messageText,
      });
      if (isRateLimitMessage(messageText)) {
        throw new ModelRateLimitError(
          `Agent SDK MCP rate limit: ${messageText}`,
        );
      }
      throw new ModelClientError(`Agent SDK MCP call failed: ${messageText}`);
    }

    if (resultText === undefined) {
      const isRateLimit =
        errorStopReason === 'rate_limit' ||
        (errorSubtype !== undefined && isRateLimitMessage(errorSubtype));
      const messageText =
        errorSubtype !== undefined
          ? `Agent SDK returned an error result (subtype: ${errorSubtype})`
          : 'Agent SDK response ended without a result message';
      this.#recordDebug(input, forwardedToolNames, mcpServers, {
        ok: false,
        error: messageText,
      });
      if (isRateLimit) {
        throw new ModelRateLimitError(
          `Agent SDK MCP rate limit: ${messageText}`,
        );
      }
      throw new ModelClientError(messageText);
    }

    const stopReason = toStopReason(stopReasonRaw);
    this.#recordDebug(input, forwardedToolNames, mcpServers, {
      ok: true,
      resultChars: resultText.length,
      resultApproxTokens: Math.ceil(resultText.length / 4),
      ...(stopReason ? { stopReason } : {}),
    });

    return {
      text: resultText,
      ...(executed.length > 0 ? { executedToolCalls: executed } : {}),
      ...(stopReason ? { stopReason } : {}),
    };
  }

  /**
   * Build the SDK subprocess environment. `ENABLE_TOOL_SEARCH=false` keeps the
   * small Eshyra tool set loaded upfront with no tool-search round trip. When an
   * explicit credential is resolved, {@link buildChildSdkEnv} strips every
   * inherited provider credential before applying it, so an ambient
   * `ANTHROPIC_API_KEY` can never shadow a selected subscription token
   * (eshyra-oobh). With no explicit credential the ambient environment is used
   * as-is (local-dev path).
   */
  #buildEnv(): Record<string, string> {
    const extra = {
      ENABLE_TOOL_SEARCH: 'false',
      CLAUDE_AGENT_SDK_CLIENT_APP: CLIENT_APP,
    };
    const auth = this.#resolveAuth();
    return auth ? buildChildSdkEnv(auth.env, extra) : buildAmbientSdkEnv(extra);
  }

  /**
   * Emit one structural debug record for a `complete()` call, if a sink is wired.
   * Unlike the text-only Agent SDK adapter, `forwardedToolNames` is populated
   * (the generated `mcp__eshyra__*` names) and the protocol mode is
   * {@link AGENT_SDK_MCP_TOOL_PROTOCOL}, never `fenced-text`. The MCP server
   * connection status from the SDK init message and the transport/client name are
   * recorded too. Best-effort: any sink failure is swallowed.
   */
  #recordDebug(
    input: ModelCompleteInput,
    forwardedToolNames: readonly string[],
    mcpServers: readonly McpServerStatus[],
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
          toolProtocolMode: AGENT_SDK_MCP_TOOL_PROTOCOL,
          clientName: AGENT_SDK_MCP_CLIENT_NAME,
          mcpServers,
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
  #resolveAuth(): AgentSdkAuth | undefined {
    if (this.#auth === undefined) {
      return undefined;
    }
    return typeof this.#auth === 'function' ? this.#auth() : this.#auth;
  }
}
