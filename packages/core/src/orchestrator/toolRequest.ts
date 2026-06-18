import type { ModelToolCall } from '../model/client.js';

/**
 * Transport-neutral model-requested tool action (eshyra-0jq.16, prep for
 * eshyra-1q5).
 *
 * The orchestrator drives tools through a single internal representation of "the
 * model asked to run a tool", independent of how that request reached us. The
 * fenced-text protocol parser tags requests `source: 'fenced'`; native provider
 * calls returned for the outer loop are normalized here with `source: 'native'`.
 * The loop consumes {@link ToolRequest}, not either transport's original shape.
 *
 * A third provenance, `native-mcp`, tags calls a provider executed inside its
 * OWN agentic loop (the Agent SDK in-process MCP path, eshyra-eznk). Those never
 * become a {@link ToolRequest} — the provider already ran them — but the
 * executed-call record reuses this source vocabulary so the trace can attribute
 * transport for every tool call uniformly.
 *
 * Keeping this abstraction free of any dependency on the turn loop (it does not
 * import `OrchestratorError`) lets both transports produce it without a cycle.
 */
export type ToolRequestSource = 'fenced' | 'native' | 'native-mcp';

/**
 * A single tool action the model requested, in document/response order.
 * Malformed requests are represented as `ok: false` entries rather than thrown
 * so the loop can feed the parse error back to the model as a tool result.
 *
 * `callId` carries a provider-assigned tool-call id when the transport supplies
 * one (native tool use); the fenced transport leaves it unset.
 */
export type ToolRequest =
  | {
      readonly ok: true;
      readonly source: ToolRequestSource;
      readonly callId?: string;
      readonly tool: string;
      readonly args: unknown;
    }
  | {
      readonly ok: false;
      readonly source: ToolRequestSource;
      readonly callId?: string;
      readonly error: string;
      readonly raw: string;
    };

function renderRawNativeCall(call: unknown): string {
  try {
    return JSON.stringify(call);
  } catch {
    return String(call);
  }
}

/**
 * Normalize provider-adapter tool calls into the canonical request shape.
 * Runtime guards remain necessary even though ModelClient is typed: provider
 * payloads cross an untrusted JSON boundary before adapters return them.
 */
export function normalizeNativeToolCalls(
  calls: readonly ModelToolCall[],
): ToolRequest[] {
  return calls.map((typedCall) => {
    const call = typedCall as unknown;
    if (typeof call !== 'object' || call === null || Array.isArray(call)) {
      return {
        ok: false,
        source: 'native',
        error: 'native tool call must be an object',
        raw: renderRawNativeCall(call),
      };
    }

    const candidate = call as {
      id?: unknown;
      name?: unknown;
      args?: unknown;
    };
    const callId = typeof candidate.id === 'string' ? candidate.id : undefined;
    if (candidate.id !== undefined && typeof candidate.id !== 'string') {
      return {
        ok: false,
        source: 'native',
        error: 'native tool call id must be a string when provided',
        raw: renderRawNativeCall(call),
      };
    }
    if (typeof candidate.name !== 'string' || candidate.name.length === 0) {
      return {
        ok: false,
        source: 'native',
        ...(callId ? { callId } : {}),
        error: 'native tool call must have a non-empty string name',
        raw: renderRawNativeCall(call),
      };
    }

    return {
      ok: true,
      source: 'native',
      ...(callId ? { callId } : {}),
      tool: candidate.name,
      args: candidate.args ?? {},
    };
  });
}
