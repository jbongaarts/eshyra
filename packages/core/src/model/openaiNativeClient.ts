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
  ModelUsage,
} from './client.js';
import { ModelClientError, ModelRateLimitError } from './client.js';
import type { ModelToolDefinition } from './toolSchema.js';

/** Debug label reported for OpenAI's native function-tool channel. */
export const OPENAI_NATIVE_TOOL_PROTOCOL = 'openai-native';

/** Capability declaration for {@link OpenAiNativeModelClient} (ADR 0010). */
export const OPENAI_NATIVE_ADAPTER_CAPABILITIES: ModelAdapterCapabilities = {
  adapterFamily: 'api-native',
  toolTransport: 'api-native',
  turnLoopOwner: 'eshyra',
  vendor: 'openai',
  gameplayCapable: true,
};

const CHAT_COMPLETIONS_URL = 'https://api.openai.com/v1/chat/completions';
const MAX_OUTPUT_TOKENS = 8192;

/** Explicit OpenAI API authentication supplied by the config layer. */
export interface OpenAiAuth {
  /** Contains only `OPENAI_API_KEY`. */
  env: Record<string, string>;
}

/** Fixed or per-call OpenAI authentication. */
export type OpenAiAuthSource = OpenAiAuth | (() => OpenAiAuth);

/** Optional opt-in session debug wiring. */
export interface OpenAiNativeDebugOptions {
  readonly debug?: SessionDebugSink;
  readonly profile?: string;
  readonly tier?: string;
  readonly authMode?: string;
}

interface OpenAiFunctionTool {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: ModelToolDefinition['inputSchema'];
  };
}

interface OpenAiToolCall {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
}

type OpenAiMessage =
  | { role: 'developer' | 'user'; content: string }
  | {
      role: 'assistant';
      content: string | null;
      tool_calls?: OpenAiToolCall[];
    }
  | { role: 'tool'; tool_call_id: string; content: string };

interface OpenAiChatCompletion {
  id: string;
  choices: Array<{
    message: {
      content?: string | Array<{ type?: string; text?: string }> | null;
      tool_calls?: OpenAiToolCall[] | null;
    };
    finish_reason?: string | null;
  }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    prompt_tokens_details?: { cached_tokens?: number };
  };
}

function toNativeTools(
  defs: readonly ModelToolDefinition[] | undefined,
): OpenAiFunctionTool[] {
  return (defs ?? []).map((def) => ({
    type: 'function',
    function: {
      name: def.name,
      description: def.description,
      parameters: def.inputSchema,
    },
  }));
}

function toResultPayload(result: ModelToolResult['result']): unknown {
  return result.ok
    ? { ok: true, data: result.data }
    : { ok: false, code: result.code, message: result.message };
}

function toNativeMessages(message: ModelMessage): OpenAiMessage[] {
  if (message.role === 'assistant') {
    const calls = message.toolCalls ?? [];
    return [
      {
        role: 'assistant',
        content: message.content || null,
        ...(calls.length > 0
          ? {
              tool_calls: calls.map((call, index) => ({
                id: call.id ?? `tool_${index}`,
                type: 'function' as const,
                function: {
                  name: call.name,
                  arguments: JSON.stringify(call.args ?? {}),
                },
              })),
            }
          : {}),
      },
    ];
  }

  const messages: OpenAiMessage[] = (message.toolResults ?? []).map(
    (result) => ({
      role: 'tool' as const,
      tool_call_id: result.callId ?? '',
      content: JSON.stringify(toResultPayload(result.result)),
    }),
  );
  if (message.content.length > 0 || messages.length === 0) {
    messages.push({ role: 'user', content: message.content });
  }
  return messages;
}

function toStopReason(
  reason: string | null | undefined,
): ModelStopReason | undefined {
  switch (reason) {
    case 'tool_calls':
    case 'function_call':
      return 'tool_use';
    case 'stop':
      return 'end_turn';
    case 'length':
      return 'max_tokens';
    case null:
    case undefined:
      return undefined;
    default:
      return 'other';
  }
}

function responseText(
  content: OpenAiChatCompletion['choices'][number]['message']['content'],
): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .filter((part) => part.type === 'text' && typeof part.text === 'string')
    .map((part) => part.text)
    .join('');
}

function parseToolCalls(
  calls: OpenAiToolCall[] | null | undefined,
): ModelToolCall[] {
  return (calls ?? []).map((call) => {
    if (call.type !== 'function') {
      throw new ModelClientError(
        `OpenAI API returned unsupported tool call type: ${String(call.type)}`,
      );
    }
    let args: unknown;
    try {
      args = JSON.parse(call.function.arguments);
    } catch {
      throw new ModelClientError(
        `OpenAI API returned invalid JSON arguments for tool "${call.function.name}"`,
      );
    }
    return { id: call.id, name: call.function.name, args };
  });
}

function retryAfterSeconds(response: Response): number | undefined {
  const raw = response.headers.get('retry-after');
  if (raw === null) return undefined;
  const seconds = Number.parseInt(raw, 10);
  return Number.isFinite(seconds) ? seconds : undefined;
}

async function errorMessage(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as {
      error?: { message?: unknown };
    };
    if (typeof body.error?.message === 'string') return body.error.message;
  } catch {
    // Fall through to the status text when the body is empty or not JSON.
  }
  return response.statusText || `HTTP ${response.status}`;
}

/**
 * OpenAI Chat Completions adapter. Eshyra owns the turn loop and deterministic
 * tool execution; this class only transports native function calls and results.
 */
export class OpenAiNativeModelClient implements ModelClient {
  readonly capabilities: ModelAdapterCapabilities =
    OPENAI_NATIVE_ADAPTER_CAPABILITIES;

  readonly #model: string;
  readonly #auth: OpenAiAuthSource | undefined;
  readonly #debug: OpenAiNativeDebugOptions | undefined;

  constructor(
    model: string,
    auth?: OpenAiAuthSource,
    debug?: OpenAiNativeDebugOptions,
  ) {
    this.#model = model;
    this.#auth = auth;
    this.#debug = debug;
  }

  async complete(input: ModelCompleteInput): Promise<ModelCompleteResult> {
    const tools = toNativeTools(input.tools);
    const forwardedToolNames = tools.map((tool) => tool.function.name);
    const messages: OpenAiMessage[] = [
      ...(input.system !== undefined
        ? [{ role: 'developer' as const, content: input.system }]
        : []),
      ...input.messages.flatMap(toNativeMessages),
    ];
    const apiKey = this.#resolveAuth().env.OPENAI_API_KEY;
    if (!apiKey) {
      const message = 'OPENAI_API_KEY is required for the OpenAI API adapter';
      this.#recordDebug(input, forwardedToolNames, {
        ok: false,
        error: message,
      });
      throw new ModelClientError(message);
    }

    let response: Response;
    try {
      response = await fetch(CHAT_COMPLETIONS_URL, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${apiKey}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          model: this.#model,
          max_completion_tokens: MAX_OUTPUT_TOKENS,
          messages,
          ...(tools.length > 0 ? { tools } : {}),
        }),
      });
    } catch (err) {
      const message = redactSecrets(
        err instanceof Error ? err.message : String(err),
      );
      this.#recordDebug(input, forwardedToolNames, {
        ok: false,
        error: message,
      });
      throw new ModelClientError(`OpenAI API call failed: ${message}`);
    }

    if (!response.ok) {
      const message = redactSecrets(await errorMessage(response));
      this.#recordDebug(input, forwardedToolNames, {
        ok: false,
        error: message,
      });
      if (response.status === 429) {
        throw new ModelRateLimitError(
          `OpenAI API rate limit: ${message}`,
          retryAfterSeconds(response),
        );
      }
      throw new ModelClientError(
        `OpenAI API call failed (${response.status}): ${message}`,
      );
    }

    let completion: OpenAiChatCompletion;
    try {
      completion = (await response.json()) as OpenAiChatCompletion;
    } catch {
      const message = 'OpenAI API returned a non-JSON response';
      this.#recordDebug(input, forwardedToolNames, {
        ok: false,
        error: message,
      });
      throw new ModelClientError(message);
    }
    const choice = completion.choices?.[0];
    if (!choice?.message) {
      const message = 'OpenAI API response contained no completion choice';
      this.#recordDebug(input, forwardedToolNames, {
        ok: false,
        error: message,
      });
      throw new ModelClientError(message);
    }

    let toolCalls: ModelToolCall[];
    try {
      toolCalls = parseToolCalls(choice.message.tool_calls);
    } catch (err) {
      const message = redactSecrets(
        err instanceof Error ? err.message : String(err),
      );
      this.#recordDebug(input, forwardedToolNames, {
        ok: false,
        error: message,
      });
      throw err;
    }
    const text = responseText(choice.message.content);
    const stopReason = toStopReason(choice.finish_reason);
    const usage: ModelUsage | undefined = completion.usage
      ? {
          inputTokens: completion.usage.prompt_tokens ?? 0,
          outputTokens: completion.usage.completion_tokens ?? 0,
          ...(completion.usage.prompt_tokens_details?.cached_tokens !==
          undefined
            ? {
                cacheReadTokens:
                  completion.usage.prompt_tokens_details.cached_tokens,
              }
            : {}),
        }
      : undefined;

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
      ...(usage ? { usage } : {}),
      requestId: completion.id,
    };
  }

  #resolveAuth(): OpenAiAuth {
    if (this.#auth === undefined) {
      return { env: { OPENAI_API_KEY: process.env.OPENAI_API_KEY ?? '' } };
    }
    return typeof this.#auth === 'function' ? this.#auth() : this.#auth;
  }

  #recordDebug(
    input: ModelCompleteInput,
    forwardedToolNames: readonly string[],
    outcome: ModelCallOutcome,
  ): void {
    const sink = this.#debug?.debug;
    if (sink === undefined) return;
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
          toolProtocolMode: OPENAI_NATIVE_TOOL_PROTOCOL,
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
