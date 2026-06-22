import { redactSecrets } from '../memory/turnFailureDiagnostic.js';
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

/**
 * One required-but-missing tool call the auditor identified, named by tool AND
 * (when recoverable) the specific target/intent of the call (eshyra-znzn).
 *
 * Tool-name-only diagnostics are too coarse: a turn can execute `lookup_rules`
 * and still be missing additional `lookup_rules` calls for specific records
 * (chain mail, shield, longsword). Reporting only the tool name then looks
 * self-contradictory — the same tool appears in BOTH executed and missing lists,
 * and the actual missing record is recoverable only from prose. The `target`
 * field carries that record/intent so debug traces and repair prompts can say
 * exactly which call was missing.
 */
export interface MissingRequiredCall {
  /** Tool the candidate needed to call (e.g. `lookup_rules`). */
  readonly tool: string;
  /**
   * The specific record/intent the missing call should have targeted (e.g.
   * `chain mail`). Omitted when the auditor can only identify the tool, not a
   * specific target — coarse data is still acceptable (the auditor is not
   * required to semantically parse every call).
   */
  readonly target?: string;
}

/** Strict verdict an auditor returns for one candidate DM response. */
export interface AuditVerdict {
  readonly verdict: 'accept' | 'reject';
  /**
   * Tools the candidate needed but did not execute, by tool name only. Empty on
   * accept. Retained for compatibility; kept as the deduplicated set of tool
   * names across {@link missingRequiredCalls} so existing tool-name consumers
   * keep working.
   */
  readonly missingRequiredTools: readonly string[];
  /**
   * Target-specific missing calls (eshyra-znzn): the same missing requirements
   * as {@link missingRequiredTools} but each carrying the specific record/intent
   * when the auditor could recover it. Empty on accept. A single tool may appear
   * multiple times with different targets (e.g. three `lookup_rules` calls for
   * chain mail, shield, and longsword). Debug traces and repair prompts prefer
   * this richer structure; `missingRequiredTools` is the coarse projection.
   */
  readonly missingRequiredCalls: readonly MissingRequiredCall[];
  /**
   * Explicit-action-only tools the candidate executed WITHOUT explicit player
   * action intent (eshyra-4ia4). A `give_item`/`remove_item` call made merely to
   * answer an inventory query ("What am I equipped with?") lands here. Empty on
   * accept. Populated independently of {@link missingRequiredTools}: a candidate
   * can be rejected for calling a forbidden tool even while it is missing none.
   */
  readonly disallowedToolCalls: readonly string[];
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
  /**
   * Tool names that may only be called on explicit player action intent
   * (eshyra-4ia4) — from {@link import('./toolRegistry.js').ToolRegistry.listRequiresExplicitAction}.
   * The auditor must reject a candidate that executed one of these without the
   * player explicitly performing the action (e.g. calling `give_item` to answer
   * "What am I equipped with?"). Omitted/empty means no such gating this turn.
   */
  readonly requiresExplicitActionTools?: readonly string[];
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
  'claim), and no explicit-action-only tool was misused (see below), the verdict',
  'is "accept" with empty missingRequiredTools and disallowedToolCalls lists.',
  '',
  'Explicit-action-only tools — the turn lists tools that may ONLY be called when',
  'the player explicitly performs the corresponding action. You MUST evaluate the',
  'player input for explicit action intent before allowing such a call:',
  '- A read-only query about current state ("What am I equipped with?", "What is',
  '  in my pack?", "Check my inventory") is NOT explicit action intent. A',
  '  candidate that executed an explicit-action-only tool (e.g. `give_item`,',
  '  `remove_item`) to answer such a query is a violation: list that tool in',
  '  disallowedToolCalls and reject. State changes must NOT be invented to answer',
  '  a question — the DM should report current state and offer a choice instead.',
  '- An explicit player action ("I buy a torch", "I pick up the sword", "I drop',
  '  my shield", "give the gem to the merchant") DOES authorize the matching',
  '  explicit-action-only tool; do not flag it.',
  'When in doubt about whether the input authorizes the action, treat ambiguous',
  'state-query phrasing as a query and reject the mutation.',
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
    '{"verdict":"accept"|"reject","missingRequiredCalls":[{"tool":"<tool>","target":"<record/intent>"}],"disallowedToolCalls":["<tool>"],"reason":"<short>","repairInstruction":"<short>"}',
    'On "accept", both missingRequiredCalls and disallowedToolCalls MUST be empty.',
    'On "reject", populate missingRequiredCalls with the calls the candidate needed',
    'but did not make. Identify each missing call by tool AND, when you can recover',
    'it, the specific target/record the call should have addressed. A tool that was',
    'already executed can still be missing additional calls for specific records:',
    'e.g. a turn that called `lookup_rules` once but asserts stats for chain mail,',
    'a shield, and a longsword without looking each up is missing',
    '[{"tool":"lookup_rules","target":"chain mail"},{"tool":"lookup_rules","target":"shield"},{"tool":"lookup_rules","target":"longsword"}].',
    'Set "target" to the specific record/intent when you can identify it; omit it',
    'only when you genuinely cannot — coarse, tool-only entries are acceptable, but',
    'prefer target-specific ones. Also populate disallowedToolCalls with any',
    'explicit-action-only tool the candidate called without explicit player action',
    'intent. Write a repairInstruction telling the DM exactly what to fix before',
    're-narrating (which call(s) to make, including their targets, or that it must',
    'NOT mutate state to answer a query).',
  ].join('\n');
}

const AUDIT_VALUE_MAX_DEPTH = 3;
const AUDIT_VALUE_MAX_ENTRIES = 20;
const AUDIT_VALUE_MAX_STRING_LENGTH = 200;
const AUDIT_JSON_MAX_LENGTH = 800;

/** Bound and redact model-supplied tool data before placing it in an audit prompt. */
function boundedAuditJson(value: unknown): string {
  const seen = new WeakSet<object>();
  const project = (candidate: unknown, depth: number): unknown => {
    if (typeof candidate === 'string') {
      return redactSecrets(candidate).slice(0, AUDIT_VALUE_MAX_STRING_LENGTH);
    }
    if (
      candidate === null ||
      typeof candidate === 'number' ||
      typeof candidate === 'boolean'
    ) {
      return candidate;
    }
    if (typeof candidate !== 'object') {
      return String(candidate).slice(0, AUDIT_VALUE_MAX_STRING_LENGTH);
    }
    if (depth >= AUDIT_VALUE_MAX_DEPTH || seen.has(candidate)) {
      return '[truncated]';
    }
    seen.add(candidate);
    if (Array.isArray(candidate)) {
      return candidate
        .slice(0, AUDIT_VALUE_MAX_ENTRIES)
        .map((entry) => project(entry, depth + 1));
    }
    return Object.fromEntries(
      Object.entries(candidate)
        .slice(0, AUDIT_VALUE_MAX_ENTRIES)
        .map(([key, entry]) => [
          redactSecrets(key).slice(0, AUDIT_VALUE_MAX_STRING_LENGTH),
          project(entry, depth + 1),
        ]),
    );
  };

  let json: string;
  try {
    json = JSON.stringify(project(value, 0));
  } catch {
    json = '"[unserializable]"';
  }
  return json.length > AUDIT_JSON_MAX_LENGTH
    ? `${json.slice(0, AUDIT_JSON_MAX_LENGTH)}…`
    : json;
}

/** Compact, bounded JSON summary of one executed tool call for the auditor. */
function summarizeExecutedCall(
  call: ExecutedToolCall,
): Record<string, unknown> {
  const base = {
    tool: call.tool,
    source: call.source,
    ok: call.result.ok,
    args: boundedAuditJson(call.args),
  };
  if (call.result.ok) {
    return {
      ...base,
      data: boundedAuditJson(call.result.data),
    };
  }
  return { ...base, code: call.result.code };
}

/** Build the auditor user message describing the turn to judge. */
export function buildAuditUserMessage(input: TurnAuditInput): string {
  const executed = input.executedToolCalls.map(summarizeExecutedCall);
  const explicitActionTools = input.requiresExplicitActionTools ?? [];
  return [
    '## Provided Tools',
    input.providedToolNames.length > 0
      ? input.providedToolNames.join(', ')
      : '(none)',
    '',
    '## Explicit-Action-Only Tools',
    explicitActionTools.length > 0
      ? `${explicitActionTools.join(', ')} — only valid when the player explicitly performs the action, never to answer a state query.`
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
  // The richer target-specific shape (eshyra-znzn) is preferred, but the auditor
  // may still emit the legacy tool-name-only `missingRequiredTools`. Parse both
  // and reconcile so the two stay consistent: `missingRequiredCalls` is the
  // union of structured entries plus any tool-only names not already covered,
  // and `missingRequiredTools` is the deduplicated tool-name projection of it.
  const structuredCalls = Array.isArray(obj.missingRequiredCalls)
    ? obj.missingRequiredCalls.flatMap((c): MissingRequiredCall[] => {
        if (typeof c !== 'object' || c === null) {
          return [];
        }
        const entry = c as Record<string, unknown>;
        if (typeof entry.tool !== 'string') {
          return [];
        }
        return [
          typeof entry.target === 'string' && entry.target.trim() !== ''
            ? { tool: entry.tool, target: entry.target }
            : { tool: entry.tool },
        ];
      })
    : [];
  const legacyTools = Array.isArray(obj.missingRequiredTools)
    ? obj.missingRequiredTools.filter((t): t is string => typeof t === 'string')
    : [];
  const missingRequiredCalls: MissingRequiredCall[] = [...structuredCalls];
  for (const tool of legacyTools) {
    // Only fold in a legacy tool-only name when the structured list does not
    // already cover that tool, so a tool with target-specific entries is not
    // diluted by a redundant coarse one.
    if (!missingRequiredCalls.some((c) => c.tool === tool)) {
      missingRequiredCalls.push({ tool });
    }
  }
  const missingRequiredTools = [
    ...new Set(missingRequiredCalls.map((c) => c.tool)),
  ];
  const disallowedToolCalls = Array.isArray(obj.disallowedToolCalls)
    ? obj.disallowedToolCalls.filter((t): t is string => typeof t === 'string')
    : [];
  return {
    verdict: obj.verdict,
    missingRequiredTools,
    missingRequiredCalls,
    disallowedToolCalls,
    reason: typeof obj.reason === 'string' ? obj.reason : '',
    repairInstruction:
      typeof obj.repairInstruction === 'string' ? obj.repairInstruction : '',
  };
}

/**
 * Format one missing required call for human/debug display: `tool` alone when no
 * target is known, or `tool (target: <target>)` when target-specific.
 */
export function formatMissingCall(call: MissingRequiredCall): string {
  return call.target ? `${call.tool} (target: ${call.target})` : call.tool;
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
