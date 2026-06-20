import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type {
  CodexOptions,
  McpToolCallItem,
  ThreadEvent,
  ThreadOptions,
  Usage,
} from '@openai/codex-sdk';
import {
  buildModelCallEvent,
  type McpServerStatus,
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
  ModelUsage,
  ProviderExecutedToolCall,
} from './client.js';
import { ModelClientError, ModelRateLimitError } from './client.js';
import {
  buildSterileCodexEnv,
  ESHYRA_MCP_SERVER_NAME,
  ESHYRA_MCP_TOKEN_VAR,
} from './codexEnv.js';
// NOTE: `codexMcpHttpServer.js` (which statically imports the MCP SDK) and
// `@openai/codex-sdk` are loaded LAZILY inside `complete()` so importing this
// module — and the `@eshyra/core` barrel — stays free of the Codex/MCP SDKs.
// Editions that omit the Codex binary must still load core.

/**
 * Codex SDK in-process-MCP adapter (eshyra-jl8n) — the OpenAI/Codex sibling of
 * the Claude Agent SDK MCP adapter, under the same ADR 0010 seam.
 *
 * Why this shape. The Codex SDK (`@openai/codex-sdk`) wraps the `codex` CLI and
 * owns its own agentic loop, just like the Claude Agent SDK. The supported way
 * to give it custom tools is an MCP server — but Codex has no *in-process* MCP
 * option (`createSdkMcpServer`). The CLI connects to MCP servers as stdio
 * subprocesses or over Streamable HTTP. To keep Eshyra tool execution inside the
 * SAME process (and the same live, SAVEPOINT-wrapped turn transaction) as the
 * deterministic executor, this adapter hosts an in-process Streamable-HTTP MCP
 * server on loopback (see `codexMcpHttpServer.ts`) and points Codex at it via
 * `mcp_servers.eshyra.url`. Tool handlers run here and delegate to the
 * {@link ModelCompleteInput.executeTool} bridge — the adapter never reimplements
 * gameplay semantics. Because the SDK drives the loop, `complete()` returns the
 * FINAL narration plus the tool calls it executed
 * ({@link ModelCompleteResult.executedToolCalls}) for the transcript.
 *
 * Subscription, not API billing. Released gameplay authenticates from a
 * ChatGPT/Codex subscription login under `CODEX_HOME`. The adapter strips
 * `OPENAI_API_KEY`/`CODEX_API_KEY` from the spawned CLI environment (see
 * `codexEnv.ts`) so a subscription turn can never silently fall back to API
 * billing (ADR 0010). It does not inject any API key.
 *
 * Sterile harness. Each turn runs in a throwaway temp working directory (NOT the
 * Eshyra repo), with `sandbox_mode=read-only`, network and web search disabled,
 * tool approval set to `never`, only the `eshyra` MCP server configured, and
 * `project_doc_max_bytes=0` so no `AGENTS.md`/project instructions load into
 * gameplay context.
 *
 * This file plus `codexMcpHttpServer.ts` are the only ones permitted to import
 * the Codex SDK / MCP server SDK, and they do so lazily so editions without the
 * Codex binary still load. The ModelClient contract stays provider-neutral.
 *
 * Live-validation note. The Codex CLI config surface below is built from the
 * published config reference (developers.openai.com/codex/config-reference) and
 * `@openai/codex-sdk@0.141.0` types. The experimental Streamable-HTTP MCP client
 * flag (`experimental_use_rmcp_client`) and `project_doc_max_bytes` are the keys
 * most likely to drift across `codex` releases — confirm them with the manual
 * smoke test in `docs/codex-adapter.md` once Codex usage is available.
 */

/** Debug label reported for the Codex MCP tool channel (never fenced text). */
export const CODEX_SDK_MCP_TOOL_PROTOCOL = 'codex-mcp';

/** Transport/client label recorded in debug records (never a secret). */
export const CODEX_SDK_MCP_CLIENT_NAME = 'codex-sdk';

/** Auth-mode label recorded when the caller does not supply one. */
const DEFAULT_CODEX_AUTH_MODE = 'codex-subscription';

/**
 * Capability declaration for {@link CodexSdkMcpModelClient} (ADR 0010).
 * Agent-harness adapter, MCP tool transport, the Codex SDK drives the loop.
 */
export const CODEX_SDK_MCP_ADAPTER_CAPABILITIES: ModelAdapterCapabilities = {
  adapterFamily: 'agent-harness',
  toolTransport: 'agent-mcp',
  turnLoopOwner: 'provider-harness',
  vendor: 'openai',
  gameplayCapable: true,
};

/**
 * Enables Codex's Streamable-HTTP MCP client, required for `url`-based MCP
 * servers on Codex builds where the legacy client is stdio-only. Isolated here
 * as the primary live-validation risk (see the file header).
 */
const ENABLE_RMCP_CLIENT = true;

/**
 * Map an Eshyra tool name to the namespaced label recorded in debug records.
 * Codex surfaces MCP tools as `<server>/<tool>`; the `mcp__eshyra__<tool>` form
 * matches the convention the Claude adapter already records, so forwarded-name
 * diagnostics read the same across providers. Naming stays inside the adapter —
 * core gameplay continues to use the bare Eshyra name.
 */
export function toMcpToolName(toolName: string): string {
  return `mcp__${ESHYRA_MCP_SERVER_NAME}__${toolName}`;
}

/**
 * True when a provider error indicates a rate-limit / usage-quota condition
 * (HTTP 429, ChatGPT/Codex subscription usage limits, weekly-limit messages).
 */
function isRateLimitMessage(msg: string): boolean {
  const lower = msg.toLowerCase();
  return (
    lower.includes('rate limit') ||
    lower.includes('rate_limit') ||
    lower.includes('too many requests') ||
    lower.includes('429') ||
    lower.includes('usage limit') ||
    lower.includes('quota') ||
    (lower.includes('limit') &&
      (lower.includes('reset') || lower.includes('weekly')))
  );
}

/**
 * True when a provider error indicates the Codex CLI is not authenticated with a
 * subscription. The adapter surfaces these clearly and does NOT fall back to an
 * API key (ADR 0010): the API credential path is stripped from the environment.
 */
function isAuthFailureMessage(msg: string): boolean {
  const lower = msg.toLowerCase();
  return (
    lower.includes('not logged in') ||
    lower.includes('not authenticated') ||
    lower.includes('unauthorized') ||
    lower.includes('please run') ||
    lower.includes('codex login') ||
    lower.includes('sign in')
  );
}

/** True when the Codex SDK package itself could not be imported (wrong edition). */
function isMissingCodexSdk(err: unknown): boolean {
  const code = (err as { code?: string } | null)?.code;
  if (code === 'ERR_MODULE_NOT_FOUND' || code === 'MODULE_NOT_FOUND') {
    return true;
  }
  const msg = err instanceof Error ? err.message : String(err);
  return msg.includes('@openai/codex-sdk');
}

/** Map a Codex turn's token usage onto the neutral {@link ModelUsage}. */
function mapUsage(usage: Usage | null | undefined): ModelUsage | undefined {
  if (!usage) {
    return undefined;
  }
  return {
    inputTokens: usage.input_tokens,
    outputTokens: usage.output_tokens,
    ...(usage.cached_input_tokens
      ? { cacheReadTokens: usage.cached_input_tokens }
      : {}),
  };
}

/**
 * Recover the bare Eshyra tool name from a Codex `mcp_tool_call` item. Codex
 * reports the MCP `server` ("eshyra") and the `tool` it invoked; whether `tool`
 * is the bare name (`roll`) or a namespaced label (`mcp__eshyra__roll`,
 * `eshyra__roll`, `eshyra/roll`) is not contractually guaranteed and may vary by
 * `codex` build, so strip any leading server namespace before correlating. This
 * only affects transcript call-id attachment, never deterministic execution.
 */
export function bareToolName(item: McpToolCallItem): string {
  const server = item.server;
  for (const prefix of [`mcp__${server}__`, `${server}__`, `${server}/`]) {
    if (item.tool.startsWith(prefix)) {
      return item.tool.slice(prefix.length);
    }
  }
  return item.tool;
}

/**
 * Attach Codex-assigned MCP call ids to the in-process executed records by
 * correlating on tool name in call order. The deterministic result always comes
 * from the in-process handler; the stream only supplies the provider call id.
 * Item tool names are normalized to the bare Eshyra name first (see
 * {@link bareToolName}) so namespaced labels still correlate.
 */
export function attachCallIds(
  executed: readonly ProviderExecutedToolCall[],
  toolCallItems: readonly McpToolCallItem[],
): ProviderExecutedToolCall[] {
  const idsByTool = new Map<string, string[]>();
  for (const item of toolCallItems) {
    const name = bareToolName(item);
    const ids = idsByTool.get(name) ?? [];
    ids.push(item.id);
    idsByTool.set(name, ids);
  }
  const cursor = new Map<string, number>();
  return executed.map((call) => {
    const ids = idsByTool.get(call.name);
    if (!ids) {
      return call;
    }
    const i = cursor.get(call.name) ?? 0;
    cursor.set(call.name, i + 1);
    const callId = ids[i];
    return callId ? { ...call, callId } : call;
  });
}

/**
 * Optional opt-in session debug wiring (mirrors the Claude MCP adapter). Labels
 * are plain identifiers, never a credential.
 */
export interface CodexSdkMcpDebugOptions {
  readonly debug?: SessionDebugSink;
  /** Resolved profile name (e.g. `premium_dm`), recorded as a label. */
  readonly profile?: string;
  /** Quality tier label (e.g. `premium`). */
  readonly tier?: string;
  /** Auth mode label — defaults to `codex-subscription`; never the credential. */
  readonly authMode?: string;
}

/**
 * Codex SDK MCP model client (eshyra-jl8n). A second subscription-backed
 * gameplay adapter under the ADR 0010 agent-harness family, exposing Eshyra
 * tools through an in-process Streamable-HTTP MCP server.
 */
export class CodexSdkMcpModelClient implements ModelClient {
  /** Capability declaration (ADR 0010). Access on the concrete type. */
  readonly capabilities: ModelAdapterCapabilities =
    CODEX_SDK_MCP_ADAPTER_CAPABILITIES;

  readonly #model: string;
  readonly #debug: CodexSdkMcpDebugOptions | undefined;

  /**
   * @param model Codex model id (e.g. `gpt-5-codex`).
   * @param debug Optional opt-in session debug wiring (off by default).
   */
  constructor(model: string, debug?: CodexSdkMcpDebugOptions) {
    this.#model = model;
    this.#debug = debug;
  }

  async complete(input: ModelCompleteInput): Promise<ModelCompleteResult> {
    const defs = input.tools ?? [];
    const executed: ProviderExecutedToolCall[] = [];
    const forwardedToolNames = defs.map((def) => toMcpToolName(def.name));

    const { startEshyraMcpHttpServer } = await import(
      './codexMcpHttpServer.js'
    );
    const mcp = await startEshyraMcpHttpServer(
      defs,
      input.executeTool,
      executed,
    );
    const workingDirectory = await mkdtemp(join(tmpdir(), 'eshyra-codex-'));

    let resultText: string | undefined;
    let usage: ModelUsage | undefined;
    let failureMessage: string | undefined;
    const toolCallItems: McpToolCallItem[] = [];
    let mcpServers: readonly McpServerStatus[] = [];

    try {
      const codexModule = await import('@openai/codex-sdk');
      const { Codex } = codexModule;
      const codex = new Codex({
        env: buildSterileCodexEnv(mcp.token),
        config: this.#buildCodexConfig(mcp.url),
      });
      const thread = codex.startThread(
        this.#buildThreadOptions(workingDirectory),
      );
      const prompt = buildPrompt(input.system, input.messages);

      const { events } = await thread.runStreamed(prompt);
      for await (const event of events as AsyncGenerator<ThreadEvent>) {
        switch (event.type) {
          case 'item.completed':
            if (event.item.type === 'agent_message') {
              resultText = event.item.text;
            } else if (event.item.type === 'mcp_tool_call') {
              toolCallItems.push(event.item);
            } else if (event.item.type === 'error') {
              failureMessage ??= event.item.message;
            }
            break;
          case 'turn.completed':
            usage = mapUsage(event.usage);
            // The model server reported the eshyra MCP tools as reachable.
            mcpServers = [
              { name: ESHYRA_MCP_SERVER_NAME, status: 'connected' },
            ];
            break;
          case 'turn.failed':
            failureMessage ??= event.error.message;
            break;
          case 'error':
            failureMessage ??= event.message;
            break;
          default:
            break;
        }
      }
    } catch (err) {
      const messageText = redactSecrets(
        err instanceof Error ? err.message : String(err),
      );
      this.#recordDebug(input, forwardedToolNames, [], undefined, {
        ok: false,
        error: messageText,
      });
      throw this.#classifyError(messageText, err);
    } finally {
      await mcp.close().catch(() => {});
      await rm(workingDirectory, { recursive: true, force: true }).catch(
        () => {},
      );
    }

    if (failureMessage !== undefined || resultText === undefined) {
      const messageText = redactSecrets(
        failureMessage ?? 'Codex turn ended without an agent message',
      );
      this.#recordDebug(input, forwardedToolNames, mcpServers, undefined, {
        ok: false,
        error: messageText,
      });
      throw this.#classifyError(messageText);
    }

    const executedWithIds = attachCallIds(executed, toolCallItems);
    this.#recordDebug(input, forwardedToolNames, mcpServers, usage, {
      ok: true,
      resultChars: resultText.length,
      resultApproxTokens: Math.ceil(resultText.length / 4),
      stopReason: 'end_turn',
    });

    return {
      text: resultText,
      ...(executedWithIds.length > 0
        ? { executedToolCalls: executedWithIds }
        : {}),
      stopReason: 'end_turn',
      ...(usage ? { usage } : {}),
    };
  }

  /**
   * Build the global Codex CLI config overrides. Only keys NOT exposed as typed
   * thread options live here: the in-process MCP server pointer and the
   * AGENTS.md suppression. `experimental_use_rmcp_client` enables the
   * Streamable-HTTP MCP client (see the file header live-validation note).
   */
  #buildCodexConfig(mcpUrl: string): NonNullable<CodexOptions['config']> {
    return {
      mcp_servers: {
        [ESHYRA_MCP_SERVER_NAME]: {
          url: mcpUrl,
          bearer_token_env_var: ESHYRA_MCP_TOKEN_VAR,
        },
      },
      // Suppress all AGENTS.md / project-instruction loading into gameplay.
      project_doc_max_bytes: 0,
      ...(ENABLE_RMCP_CLIENT ? { experimental_use_rmcp_client: true } : {}),
    };
  }

  /** Build the sterile per-turn thread options. */
  #buildThreadOptions(workingDirectory: string): ThreadOptions {
    return {
      model: this.#model,
      sandboxMode: 'read-only',
      workingDirectory,
      skipGitRepoCheck: true,
      networkAccessEnabled: false,
      webSearchEnabled: false,
      approvalPolicy: 'never',
    };
  }

  /** Classify a redacted error message into the typed ModelClient errors. */
  #classifyError(messageText: string, raw?: unknown): ModelClientError {
    if (raw !== undefined && isMissingCodexSdk(raw)) {
      return new ModelClientError(
        'Codex SDK (@openai/codex-sdk) is not installed in this edition. ' +
          'Install the "codex" or "full" edition to use the Codex provider.',
      );
    }
    if (isRateLimitMessage(messageText)) {
      return new ModelRateLimitError(
        `Codex SDK MCP rate limit: ${messageText}`,
      );
    }
    if (isAuthFailureMessage(messageText)) {
      return new ModelClientError(
        'Codex subscription auth failed (no API-key fallback by design): ' +
          `${messageText}. Run \`codex login\` to authenticate the subscription.`,
      );
    }
    return new ModelClientError(`Codex SDK MCP call failed: ${messageText}`);
  }

  /**
   * Emit one structural debug record for a `complete()` call, if a sink is
   * wired. Protocol mode is {@link CODEX_SDK_MCP_TOOL_PROTOCOL} (never fenced),
   * and the forwarded MCP tool names + server status are recorded. Best-effort:
   * any sink failure is swallowed so diagnostics never destabilize a turn.
   */
  #recordDebug(
    input: ModelCompleteInput,
    forwardedToolNames: readonly string[],
    mcpServers: readonly McpServerStatus[],
    _usage: ModelUsage | undefined,
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
          authMode: this.#debug?.authMode ?? DEFAULT_CODEX_AUTH_MODE,
          toolProtocolMode: CODEX_SDK_MCP_TOOL_PROTOCOL,
          clientName: CODEX_SDK_MCP_CLIENT_NAME,
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
}

/**
 * Flatten the structured system + messages into the single prompt string the
 * Codex SDK accepts (the permitted-flatten path; the Codex SDK exposes no
 * separate system-prompt parameter, so the system block is prepended).
 */
function buildPrompt(
  system: string | undefined,
  messages: ModelCompleteInput['messages'],
): string {
  const body = messages.map((m) => `${m.role}: ${m.content}`).join('\n');
  return system ? `${system}\n\n${body}` : body;
}
