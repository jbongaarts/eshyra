import type { ModelClient, ModelTraceMetadata } from '../model/client.js';
import type { ExecutedToolCall } from './turnLoop.js';

/**
 * Mechanics-audit / turn-referee gate (eshyra-oobh).
 *
 * Exposing tools to the model (eshyra-eznk) does not by itself stop the model
 * from improvising a mechanical result — narrating a die roll, an HP change, or a
 * rules fact WITHOUT calling the tool that owns it. Deciding whether a candidate
 * DM response required a tool is a reasoning task, not a regex: a sentence can
 * imply a random outcome a dozen ways. So before a candidate response is shown or
 * persisted as canon, a second, lightweight model call audits it against the
 * turn's executed tool calls and a concise tool-use policy, and returns a strict
 * verdict.
 *
 * This module owns ONLY that judgement. It is deliberately not a full rules
 * validator — it answers one question: did the candidate assert a mechanical
 * outcome that a provided tool should have produced, with no such tool executed?
 * The orchestrator turns the verdict into accept / retry-once / fail.
 */

/** Strict verdict an auditor returns for one candidate DM response. */
export interface AuditVerdict {
  readonly verdict: 'accept' | 'reject';
  /** Tools the candidate needed but did not execute. Empty on accept. */
  readonly missingRequiredTools: readonly string[];
  /** One-line justification (developer/debug facing). */
  readonly reason: string;
  /** Corrective instruction fed back to the DM on a retry. */
  readonly repairInstruction: string;
}

/** Inputs the auditor judges. */
export interface TurnAuditInput {
  readonly playerInput: string;
  readonly candidateResponse: string;
  /** Eshyra tool names available to the DM this turn. */
  readonly providedToolNames: readonly string[];
  /**
   * Tool calls the turn executed — fenced, native, AND provider-executed MCP
   * calls (`source: 'native-mcp'`) from {@link import('../model/agentSdkMcpClient.js').AgentSdkMcpModelClient}
   * all count as executed evidence.
   */
  readonly executedToolCalls: readonly ExecutedToolCall[];
  /** Trace forwarded to the auditor model call for debug labelling. */
  readonly trace?: ModelTraceMetadata;
}

/** A {@link TurnAuditor} judges a candidate DM response before it is shown. */
export interface TurnAuditor {
  audit(input: TurnAuditInput): Promise<AuditVerdict>;
  /** Provider model id the auditor calls, for debug labelling (optional). */
  readonly modelId?: string;
}

/**
 * Raised when the auditor model returns something that is not a usable verdict.
 * The orchestrator fails the turn loudly (fail-closed) rather than letting an
 * unaudited candidate through.
 */
export class AuditError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AuditError';
  }
}

const AUDIT_POLICY = [
  'Tool-use policy — a candidate DM response MUST have executed the matching',
  'tool for any mechanical claim it makes:',
  '- Any dice roll, random outcome, or numeric result of chance requires `roll`.',
  '  A stated die result (e.g. "you rolled a 14", "2d8 = 11") with no executed',
  '  `roll` is a violation.',
  '- A rules/mechanics fact that needs source truth (a creature stat, a spell or',
  '  rule detail) requires the appropriate lookup/rules tool (e.g. `lookup_rules`).',
  '- A change to HP, conditions, inventory, time/location, plot flags, or world',
  '  facts requires the matching state tool (e.g. `adjust_hp`, `add_condition`,',
  '  `give_item`, `update_clock`, `set_plot_flag`, `set_world_fact`).',
  '- A claim that resolves or advances a location/NPC/lore requires the canonical',
  '  tool (e.g. `world_query`); opening/closing a scene requires `mark_scene`.',
  '- Pure narration, dialogue, description, and pacing need NO tool.',
  'Only flag a tool that is in the provided tool list. If every mechanical claim',
  'in the candidate is backed by an executed tool (or there is no mechanical',
  'claim), the verdict is "accept" with an empty missingRequiredTools list.',
].join('\n');

/** Build the auditor system prompt. */
export function buildAuditSystemPrompt(): string {
  return [
    'You are a strict mechanics referee for a tabletop RPG engine. You do not',
    'narrate. You audit one candidate Dungeon Master response and decide whether',
    'it asserted a mechanical outcome that a tool should have produced without',
    'that tool having been executed this turn.',
    '',
    AUDIT_POLICY,
    '',
    'Respond with ONLY a single JSON object, no prose and no code fences, of the',
    'exact shape:',
    '{"verdict":"accept"|"reject","missingRequiredTools":["<tool>"],"reason":"<short>","repairInstruction":"<short>"}',
    'On "accept", missingRequiredTools MUST be empty. On "reject", list the',
    'missing tools and write a repairInstruction telling the DM exactly which',
    'tool(s) to call before re-narrating.',
  ].join('\n');
}

/** Compact, bounded JSON summary of one executed tool call for the auditor. */
function summarizeExecutedCall(
  call: ExecutedToolCall,
): Record<string, unknown> {
  const base = {
    tool: call.tool,
    source: call.source,
    ok: call.result.ok,
  };
  if (call.result.ok) {
    // Include a truncated view of the result data so the auditor can see, e.g.,
    // a roll total — but never an unbounded payload.
    let data = '';
    try {
      data = JSON.stringify(call.result.data);
    } catch {
      data = String(call.result.data);
    }
    return {
      ...base,
      data: data.length > 400 ? `${data.slice(0, 400)}…` : data,
    };
  }
  return { ...base, code: call.result.code };
}

/** Build the auditor user message describing the turn to judge. */
export function buildAuditUserMessage(input: TurnAuditInput): string {
  const executed = input.executedToolCalls.map(summarizeExecutedCall);
  return [
    '## Provided Tools',
    input.providedToolNames.length > 0
      ? input.providedToolNames.join(', ')
      : '(none)',
    '',
    '## Executed Tool Calls This Turn',
    executed.length > 0 ? JSON.stringify(executed) : '(none executed)',
    '',
    '## Player Input',
    input.playerInput,
    '',
    '## Candidate DM Response',
    input.candidateResponse,
  ].join('\n');
}

/** Strip a leading/trailing markdown code fence, if present. */
function stripFences(text: string): string {
  const trimmed = text.trim();
  if (!trimmed.startsWith('```')) {
    return trimmed;
  }
  return trimmed
    .replace(/^```[a-zA-Z]*\s*\n?/, '')
    .replace(/\n?```$/, '')
    .trim();
}

/** Parse the auditor's reply into a validated {@link AuditVerdict}. */
export function parseAuditVerdict(text: string): AuditVerdict {
  const cleaned = stripFences(text);
  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    // Tolerate leading/trailing prose by extracting the outermost object.
    const start = cleaned.indexOf('{');
    const end = cleaned.lastIndexOf('}');
    if (start === -1 || end <= start) {
      throw new AuditError('auditor did not return a JSON object verdict');
    }
    try {
      parsed = JSON.parse(cleaned.slice(start, end + 1));
    } catch {
      throw new AuditError('auditor returned malformed JSON verdict');
    }
  }
  if (typeof parsed !== 'object' || parsed === null) {
    throw new AuditError('auditor verdict was not a JSON object');
  }
  const obj = parsed as Record<string, unknown>;
  if (obj.verdict !== 'accept' && obj.verdict !== 'reject') {
    throw new AuditError(
      `auditor verdict field must be "accept" or "reject" (got ${JSON.stringify(obj.verdict)})`,
    );
  }
  const missingRequiredTools = Array.isArray(obj.missingRequiredTools)
    ? obj.missingRequiredTools.filter((t): t is string => typeof t === 'string')
    : [];
  return {
    verdict: obj.verdict,
    missingRequiredTools,
    reason: typeof obj.reason === 'string' ? obj.reason : '',
    repairInstruction:
      typeof obj.repairInstruction === 'string' ? obj.repairInstruction : '',
  };
}

/**
 * The {@link TurnAuditor} backed by a {@link ModelClient}. The model client is
 * injected so the auditor uses the SAME subscription-backed provider family as
 * the primary DM (never an independently API-billed call) and so tests mock it
 * with no live call. The auditor call carries NO Eshyra tools — it only judges.
 */
export class ModelTurnAuditor implements TurnAuditor {
  readonly #model: ModelClient;
  /** Provider model id this auditor targets, surfaced for debug labelling. */
  readonly modelId: string | undefined;

  constructor(model: ModelClient, modelId?: string) {
    this.#model = model;
    this.modelId = modelId;
  }

  async audit(input: TurnAuditInput): Promise<AuditVerdict> {
    const completion = await this.#model.complete({
      system: buildAuditSystemPrompt(),
      messages: [{ role: 'user', content: buildAuditUserMessage(input) }],
      responseFormat: 'json',
      ...(input.trace ? { trace: input.trace } : {}),
    });
    return parseAuditVerdict(completion.text);
  }
}
