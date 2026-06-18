import type {
  ModelClient,
  ModelCompleteResult,
  ModelMessage,
  ModelStopReason,
  ModelToolExecutor,
  ModelToolResult,
} from '../model/client.js';
import { parseToolCalls, renderToolResults } from './protocol.js';
import {
  normalizeNativeToolCalls,
  type ToolRequest,
  type ToolRequestSource,
} from './toolRequest.js';
import type { ToolContext, ToolRegistry, ToolResult } from './tools.js';

export interface RunModelLoopTrace {
  readonly campaignId?: string;
  readonly sessionId?: string;
  readonly turnId?: string;
  /**
   * Why these model calls happen, surfaced to adapter-side debug logs via
   * `ModelTraceMetadata.extra.purpose` (eshyra-iu18). The loop adds the 1-based
   * round as `extra.round` so multi-round turns are ordered in the logs.
   */
  readonly purpose?: string;
}

/**
 * Model/tool round loop (E5).
 *
 * One "loop" is the inner mechanic of a turn: hand the model an initial user
 * message, normalize native or fenced tool requests, execute them against the
 * deterministic tool layer, and feed structured results back. The loop
 * terminates when the model replies with no pending tool request (that reply is
 * the final narration) or when the round budget is exhausted.
 *
 * The loop does not own a transaction. Tool invocations mutate canon as they
 * run; the caller wraps the loop in a SAVEPOINT so a mid-loop failure rolls
 * back every accepted mutation. The loop throws `OrchestratorError` for the
 * two protocol-level failure modes (rounds exhausted, empty narration) and
 * lets any other exception (model SDK failure, tool exception) propagate
 * unchanged.
 */

export class OrchestratorError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OrchestratorError';
  }
}

export interface ExecutedToolCall {
  tool: string;
  args: unknown;
  result: ToolResult;
  /**
   * Transport the request arrived through, carried for tracing/debugging
   * provenance.
   */
  source: ToolRequestSource;
  /** Provider-assigned id for native calls; absent for fenced calls. */
  callId?: string;
  /** Normalized provider stop reason for the response containing this call. */
  stopReason?: ModelStopReason;
}

/**
 * Collect the model-requested tool actions from a single model response as
 * transport-neutral {@link ToolRequest}s.
 *
 * Native requests are ordered before fenced requests because the normalized
 * ModelClient result does not retain interleaving positions between structured
 * calls and free text. Providers normally use only one transport in a response;
 * the deterministic ordering makes mixed responses explicit and auditable.
 */
function collectToolRequests(result: ModelCompleteResult): ToolRequest[] {
  const nativeCalls = result.toolCalls ?? [];
  if (result.stopReason === 'tool_use' && nativeCalls.length === 0) {
    throw new OrchestratorError(
      'model returned stopReason="tool_use" without any consumable native tool calls',
    );
  }
  return [
    ...normalizeNativeToolCalls(nativeCalls),
    ...parseToolCalls(result.text),
  ];
}

function nativeToolResults(
  results: ReadonlyArray<{
    request: ToolRequest;
    tool: string;
    result: ToolResult;
  }>,
): ModelToolResult[] {
  return results
    .filter(({ request }) => request.source === 'native')
    .map(({ request, tool, result }) => ({
      ...(request.callId ? { callId: request.callId } : {}),
      name: tool,
      result,
    }));
}

export interface RunModelLoopInput {
  model: ModelClient;
  registry: ToolRegistry;
  toolCtx: ToolContext;
  system: string;
  /** Initial user message that opens the conversation (assembled context). */
  initialUserMessage: string;
  /** Hard cap on model rounds before the turn is judged stuck. */
  maxToolRounds: number;
  /**
   * Invoked at the start of each round, before the model is called. The
   * caller uses this to track in-flight round count for reporting on both
   * the success and failure paths.
   */
  onRoundStart?: () => void;
  /**
   * Optional trace metadata forwarded to the ModelClient on every round
   * (eshyra-0jq.11). Adapters that can route trace info to provider-side
   * logs will use it; others ignore it.
   */
  trace?: RunModelLoopTrace;
}

export interface RunModelLoopResult {
  narration: string;
  toolCalls: ExecutedToolCall[];
  rounds: number;
}

export async function runModelLoop(
  input: RunModelLoopInput,
): Promise<RunModelLoopResult> {
  const {
    model,
    registry,
    toolCtx,
    system,
    initialUserMessage,
    maxToolRounds,
    onRoundStart,
    trace,
  } = input;

  const messages: ModelMessage[] = [
    { role: 'user', content: initialUserMessage },
  ];
  const toolCalls: ExecutedToolCall[] = [];
  const tools = registry.definitions();
  // Bridge for adapters that own their own agentic loop (the Agent SDK MCP path,
  // eshyra-eznk): the provider's in-process tool handlers call this so the call
  // runs through the SAME deterministic executor the outer loop uses below. The
  // adapter is handed the Eshyra tool name (provider/MCP naming is mapped away
  // inside it), so this is exactly `registry.invoke`.
  const executeTool: ModelToolExecutor = (call) =>
    registry.invoke(call.name, call.args, toolCtx);
  let rounds = 0;
  let narration: string | undefined;

  while (rounds < maxToolRounds) {
    rounds += 1;
    onRoundStart?.();
    const completion = await model.complete({
      system,
      messages,
      // Provider-neutral tool definitions (eshyra-0jq.10) — adapters with
      // a native tool channel may use them; the fenced-text protocol below
      // does not consult them and is unchanged.
      tools,
      // Execution bridge for a provider that drives its own tool loop; ignored
      // by adapters that return tool calls for the outer loop to run.
      executeTool,
      // Forward trace ids plus this round's ordinal and the loop's purpose so
      // adapter-side debug logs can label and order each model call.
      ...(trace
        ? {
            trace: {
              ...(trace.campaignId ? { campaignId: trace.campaignId } : {}),
              ...(trace.sessionId ? { sessionId: trace.sessionId } : {}),
              ...(trace.turnId ? { turnId: trace.turnId } : {}),
              extra: {
                ...(trace.purpose ? { purpose: trace.purpose } : {}),
                round: String(rounds),
              },
            },
          }
        : {}),
    });
    // Provider-owned-loop path (Agent SDK MCP, eshyra-eznk): the adapter already
    // ran the tools in-process through the executeTool bridge and resolved its
    // own loop, so this reply IS the final narration. Record the executed calls
    // (under their Eshyra names) for the trace and finish — do NOT re-execute.
    const providerExecuted = completion.executedToolCalls ?? [];
    if (providerExecuted.length > 0) {
      for (const call of providerExecuted) {
        toolCalls.push({
          tool: call.name,
          args: call.args,
          result: call.result,
          source: 'native-mcp',
          ...(call.callId ? { callId: call.callId } : {}),
          ...(completion.stopReason
            ? { stopReason: completion.stopReason }
            : {}),
        });
      }
      narration = completion.text.trim();
      break;
    }

    // Normalize every transport into ToolRequest before validation/execution.
    const requests = collectToolRequests(completion);
    const modelText = completion.text;
    if (requests.length === 0) {
      narration = modelText.trim();
      break;
    }

    const roundResults: Array<{
      request: ToolRequest;
      tool: string;
      result: ToolResult;
    }> = [];
    for (const req of requests) {
      if (req.ok) {
        const result = registry.invoke(req.tool, req.args, toolCtx);
        toolCalls.push({
          tool: req.tool,
          args: req.args,
          result,
          source: req.source,
          ...(req.callId ? { callId: req.callId } : {}),
          ...(completion.stopReason
            ? { stopReason: completion.stopReason }
            : {}),
        });
        roundResults.push({ request: req, tool: req.tool, result });
      } else {
        const result: ToolResult = {
          ok: false,
          code: 'parse_error',
          message: req.error,
        };
        toolCalls.push({
          tool: 'unknown',
          args: req.raw,
          result,
          source: req.source,
          ...(req.callId ? { callId: req.callId } : {}),
          ...(completion.stopReason
            ? { stopReason: completion.stopReason }
            : {}),
        });
        roundResults.push({ request: req, tool: 'unknown', result });
      }
    }
    const nativeResults = nativeToolResults(roundResults);
    const fencedResults = roundResults
      .filter(({ request }) => request.source === 'fenced')
      .map(({ tool, result }) => ({ tool, result }));
    messages.push({
      role: 'assistant',
      content: modelText,
      ...(completion.toolCalls && completion.toolCalls.length > 0
        ? { toolCalls: completion.toolCalls }
        : {}),
      ...(completion.stopReason ? { stopReason: completion.stopReason } : {}),
    });
    messages.push({
      role: 'user',
      content:
        fencedResults.length > 0
          ? renderToolResults(fencedResults)
          : 'Tool results are attached. Continue the turn: call more tools if needed, otherwise reply with final narration only.',
      ...(nativeResults.length > 0 ? { toolResults: nativeResults } : {}),
    });
  }

  if (narration === undefined) {
    throw new OrchestratorError(
      `turn exceeded ${maxToolRounds} tool rounds without final narration`,
    );
  }
  if (narration.length === 0) {
    throw new OrchestratorError('model returned empty narration');
  }
  return { narration, toolCalls, rounds };
}
