import { redactSecrets } from '../memory/turnFailureDiagnostic.js';
import type { ModelClient, ModelTraceMetadata } from '../model/client.js';
import type { RecentSceneEvidence, StateSnapshot } from './contextAssembler.js';
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

export interface PresentationOnlyRepair {
  readonly kind: 'roll_ledger';
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
   * action intent (eshyra-4ia4). A `give_item`/`claim_item`/`use_item`/`transfer_item`/`remove_item` call made merely to
   * answer an inventory query ("What am I equipped with?") lands here. Empty on
   * accept. Populated independently of {@link missingRequiredTools}: a candidate
   * can be rejected for calling a forbidden tool even while it is missing none.
   */
  readonly disallowedToolCalls: readonly string[];
  /** One-line justification (developer/debug facing). */
  readonly reason: string;
  /** Corrective instruction fed back to the DM on a retry. */
  readonly repairInstruction: string;
  /**
   * Structured escape hatch for presentation-only defects that code can repair
   * from already-valid tool evidence. Omit/null unless the auditor is rejecting
   * only a model-authored roll ledger/presentation mismatch; state/tool/evidence
   * failures and missing/incorrect roll visibility/category metadata must leave
   * this unset so the orchestrator retries or fails closed.
   */
  readonly presentationOnlyRepair?: PresentationOnlyRepair;
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
   * Structured current state already present in the DM's bounded context. This
   * is evidence for read-only claims and avoids requiring memory drilldown for
   * facts (including an empty inventory) that are available in the snapshot.
   */
  readonly currentStateSnapshot?: StateSnapshot;
  /**
   * Compact evidence derived only from accepted DM scene-log entries in the
   * current open scene. This is weaker than module canon, campaign state, and
   * campaign overlay lore: it supports immediate same-scene continuity, but
   * durable consequential recall still requires `record_world_fact`.
   */
  readonly recentSceneEvidence?: readonly RecentSceneEvidence[];
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
  '- Player-affecting roll visibility is part of the mechanical claim: evaluate',
  '  whether each executed `roll` used appropriate `visibility` and `category`',
  '  metadata for the situation. Reject if player-affecting rolls are hidden as',
  '  visibility:"dm_only" or have misleading category metadata. Reject if a',
  '  visible narrated hit, miss, damage result, saving throw, death save,',
  '  initiative result, or ability-check outcome is unsupported by executed',
  '  rolls. Reject if a hand-written roll result contradicts tool output. Do',
  '  not depend on English reason-string heuristics; reason is debug context,',
  '  while visibility/category are the model-declared decisions to audit. Hidden',
  '  rolls are acceptable only for valid reasons such as secret checks, hidden',
  '  enemy stealth/perception, or monster-vs-monster rolls that do not directly',
  '  affect the player.',
  '- A rules/mechanics fact that needs source truth (a creature stat, a spell or',
  '  rule detail) requires the appropriate lookup/rules tool (e.g. `lookup_rules`).',
  '- A narrated leveled-spell cast requires a successful `spend_spell_slot` for',
  '  the exact casting character and canonical spell. Its selected slot must',
  '  match the narrated slot. A spell lookup alone does not substantiate a cast,',
  '  and a failed, different-character, different-spell, or different-slot spend',
  '  is not evidence. Cantrips are at will and must not fabricate a slot spend.',
  '- Any narrated upcast dice, flat amount, count, target constraint, bonus,',
  '  duration, spell-level threshold, or summon scaling must exactly match a',
  '  successful `resolve_spell_upcast` result or the upcast result embedded in',
  '  the successful matching `spend_spell_slot`. Match character, spell, selected',
  '  slot, clause/source binding, semantic subject, branch choice, and resolved',
  '  value. Reject hand-computed, mismatched, failed, or lookup-only scaling.',
  '- A change to HP, conditions, inventory, time/location, plot flags, or world',
  '  facts requires the matching state tool (e.g. `adjust_hp`, `add_condition`,',
  '  `give_item`, `claim_item`, `use_item`, `transfer_item`, `remove_item`, `update_clock`, `set_plot_flag`, `set_world_fact`).',
  '- Wallet balances are valid read-only evidence from the Current State Snapshot.',
  '  Narrated currency gains, spending, or denomination changes require the',
  '  corresponding `gain_currency`, `spend_currency`, or `convert_currency` call.',
  '  These three tools are explicit-action-only mutations. Wallet, affordability,',
  '  and price questions do not authorize them. A completed payment, purchase,',
  '  sale, reward, or conversion does when supported by the player action and scene.',
  '  Examples: “How much gold do I have?” → no mutation; “How much is the room?”',
  '  → no mutation until paid; “I pay the innkeeper 2 sp.” → `spend_currency`;',
  '  “I buy the torch.” → `spend_currency` + `give_item`; “I sell the gem for the',
  '  agreed price.” → `remove_item` with disposition `sold` + `gain_currency`.',
  '- Monster/NPC encounter combatants are campaign state. If the candidate',
  '  narrates damaging, killing, knocking out, or conditioning an encounter',
  '  creature, it must be backed by live combatant state and `update_combatant`',
  '  for the exact combatant id. Do not accept creature death represented only',
  '  as improvised lore, overlay lore, or prose when active combatants exist.',
  '- Combat instances are live episodes and module encounters are templates.',
  '  Only one active combat instance is allowed per campaign for now; session_id',
  '  is provenance/logging scope, not game-state scope. Reject starting a new',
  '  combat in a later session while an earlier session combat is still active.',
  '  Reject reactivating an inactive/completed/abandoned/fled/interrupted',
  '  combat instance; returning to a prior encounter or location must create a',
  '  new combat instance. Reject current narration that relies on stale',
  '  inactive combatant state when newer persistent actor state exists.',
  '- Named or recurring NPCs/monsters require explicit persistent actor',
  '  identity. Reject treating an evidenced recurring actor as a fresh',
  '  anonymous combatant, and reject resetting an explicitly injured or altered',
  '  actor to pristine rules baseline unless the tool/state result supports it.',
  '  Do not depend on English label heuristics; evaluate the model-declared',
  '  identity_ref and the structured state/tool results.',
  '- Consequential improvised lore that creates a hook, clue, NPC belief,',
  '  evidence, or a future-relevant world fact requires `record_world_fact`.',
  '- Stable visible continuity dressing may also be recorded with',
  '  `record_world_fact`; tier `continuity_dressing` supports descriptive',
  '  consistency only, not plot significance, clue status, or proof of a',
  '  consequential fact unless another evidence tier supports that claim.',
  '- A claim that resolves or advances a location/NPC/lore requires the canonical',
  '  tool (e.g. `world_query`); opening/closing a scene requires `mark_scene`.',
  '- Failed tool calls (`ok:false`) are never evidence for factual assertions.',
  '  Do not accept a candidate that relies on a failed `world_query` or failed',
  '  `record_world_fact` result.',
  '- A successful `record_world_fact` call in the current turn supports the newly',
  '  recorded campaign overlay lore. A successful `world_query` can support',
  '  module canon, campaign state overlays, campaign overlay lore, and',
  '  continuity dressing returned in its result.',
  '- Recent Scene Evidence is accepted same-scene continuity evidence only. It is',
  '  weaker than module canon, campaign state, and campaign overlay lore, but it',
  '  can support immediate follow-up dialogue and exact visible details from the',
  '  current scene. Do NOT treat it as durable campaign memory after the scene',
  '  changes; consequential long-term facts still require `record_world_fact`.',
  '- Truth status is binding: a rumor/reported/believed record supports claims',
  '  such as "NPCs say/believe/report X"; it does NOT support "X is true" unless',
  '  the evidence has true/confirmed/observed status or another tool result',
  '  establishes that stronger claim.',
  '- Overlay visibility is binding: player-facing narration can rely only on',
  '  `player_visible` overlay lore. `dm_only` overlay lore may guide hidden DM',
  '  reasoning/debugging but must not be narrated as player-facing support; keep',
  '  `mixed` records attributed to the visible portion and do not reveal hidden',
  '  content verbatim.',
  '- Decorative scene color does not need a tool, but if the candidate treats a',
  '  new improvised detail as consequential established canon, it must be',
  '  recorded first.',
  '- The Current State Snapshot is evidence for read-only claims about current',
  '  character state, including HP, conditions, inventory/equipment, flags, and',
  '  clock/location. Do NOT require `memory_drilldown` when the answer is fully',
  '  supported by that snapshot. In particular, an empty inventory array supports',
  '  a response that says the character has no recorded equipment.',
  '- Require `memory_drilldown` for a memory claim only when it depends on older,',
  '  archived, or otherwise absent state not contained in the bounded current',
  '  snapshot or other supplied evidence. Reject claims that contradict or add',
  '  facts beyond the snapshot unless executed tool evidence supports them.',
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
  '  `claim_item`, `use_item`, `transfer_item`, `remove_item`) to answer such a query is a violation: list that tool in',
  '  disallowedToolCalls and reject. State changes must NOT be invented to answer',
  '  a question — the DM should report current state and offer a choice instead.',
  '- An explicit player action ("I buy a torch", "I pick up the sword", "I drop',
  '  my shield", "give the gem to the merchant") DOES authorize the matching',
  '  explicit-action-only tool; do not flag it.',
  'When in doubt about whether the input authorizes the action, treat ambiguous',
  'state-query phrasing as a query and reject the mutation.',
  '',
  'Retry guidance for lore/world rejections: tell the DM not to rely on failed',
  '`world_query` results; if introducing a consequential new detail, record it',
  'with `record_world_fact` before treating it as established; if not recording',
  'it, phrase it as tentative, attributed, or non-consequential color.',
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
    '{"verdict":"accept"|"reject","missingRequiredCalls":[{"tool":"<tool>","target":"<record/intent>"}],"disallowedToolCalls":["<tool>"],"reason":"<short>","repairInstruction":"<short>","presentationOnlyRepair":null|{"kind":"roll_ledger"}}',
    'On "accept", missingRequiredCalls and disallowedToolCalls MUST be empty and presentationOnlyRepair MUST be null.',
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
    'Set presentationOnlyRepair to {"kind":"roll_ledger"} ONLY when all executed',
    'tools and state mutations are valid, every relevant roll already has correct',
    'model-declared visibility and category metadata, and the only defect is a',
    'model-authored roll ledger/presentation mismatch that the engine can replace',
    'from structured roll results. Leave it null for missing tools, failed tools,',
    'state errors, world-evidence errors, disallowed tools, unsupported prose roll',
    'claims, or missing/incorrect roll visibility/category metadata.',
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

function summarizeCanonTierEvidence(
  call: ExecutedToolCall,
): Record<string, unknown> | undefined {
  if (!call.result.ok) {
    return {
      tool: call.tool,
      ok: false,
      reason: 'failed_tool_call_not_evidence',
      code: call.result.code,
    };
  }
  const data = call.result.data;
  if (call.tool === 'record_world_fact') {
    const record = readRecord(data, 'record');
    return {
      tool: call.tool,
      tier: readString(data, 'canonTier') ?? 'campaign_overlay_lore',
      id: readString(record, 'id'),
      truthStatus: readString(record, 'truthStatus'),
      visibility: readString(record, 'visibility'),
      summary: readString(record, 'fact'),
    };
  }
  if (call.tool === 'world_query') {
    return {
      tool: call.tool,
      tier: 'world_query_result',
      evidence: boundedAuditJson(readUnknown(data, 'evidence')),
    };
  }
  if (call.mutates) {
    return { tool: call.tool, tier: 'campaign_state' };
  }
  return undefined;
}

function readUnknown(value: unknown, key: string): unknown {
  return typeof value === 'object' && value !== null
    ? (value as Record<string, unknown>)[key]
    : undefined;
}

function readRecord(
  value: unknown,
  key: string,
): Record<string, unknown> | undefined {
  const nested = readUnknown(value, key);
  return typeof nested === 'object' && nested !== null
    ? (nested as Record<string, unknown>)
    : undefined;
}

function readString(value: unknown, key: string): string | undefined {
  const field = readUnknown(value, key);
  return typeof field === 'string' ? field : undefined;
}

/** Build the auditor user message describing the turn to judge. */
export function buildAuditUserMessage(input: TurnAuditInput): string {
  const executed = input.executedToolCalls.map(summarizeExecutedCall);
  const canonEvidence = input.executedToolCalls
    .map(summarizeCanonTierEvidence)
    .filter((entry): entry is Record<string, unknown> => entry !== undefined);
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
    '## Canon-Tier Evidence Summary',
    canonEvidence.length > 0
      ? JSON.stringify(canonEvidence)
      : '(no successful canon evidence)',
    '',
    '## Recent Scene Evidence',
    input.recentSceneEvidence !== undefined &&
    input.recentSceneEvidence.length > 0
      ? [
          'Accepted same-scene evidence only; tier `scene_fact`, weaker than module canon, campaign state, and campaign overlay lore. Use for immediate continuity, not durable recall.',
          JSON.stringify(input.recentSceneEvidence),
        ].join('\n')
      : '(none)',
    '',
    '## Current State Snapshot',
    input.currentStateSnapshot === undefined
      ? '(not supplied)'
      : boundedAuditJson(input.currentStateSnapshot),
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
    ...(typeof obj.presentationOnlyRepair === 'object' &&
    obj.presentationOnlyRepair !== null &&
    (obj.presentationOnlyRepair as Record<string, unknown>).kind ===
      'roll_ledger'
      ? { presentationOnlyRepair: { kind: 'roll_ledger' as const } }
      : {}),
  };
}

/**
 * Format one missing required call for human/debug display: `tool` alone when no
 * target is known, or `tool (target: <target>)` when target-specific.
 */
export function formatMissingCall(call: MissingRequiredCall): string {
  return call.target ? `${call.tool} (target: ${call.target})` : call.tool;
}

function repairMissingCallsForInvalidDisallowedTools(
  verdict: AuditVerdict,
  input: TurnAuditInput,
  invalidDisallowedTools: readonly string[],
): readonly MissingRequiredCall[] {
  const missingRequiredCalls: MissingRequiredCall[] = [
    ...verdict.missingRequiredCalls,
  ];
  if (
    invalidDisallowedTools.includes('set_plot_flag') &&
    input.providedToolNames.includes('record_world_fact') &&
    !missingRequiredCalls.some((call) => call.tool === 'record_world_fact')
  ) {
    missingRequiredCalls.push({
      tool: 'record_world_fact',
      target: 'consequential improvised lore asserted with set_plot_flag',
    });
  }
  return missingRequiredCalls;
}

function sanitizeAuditVerdict(
  verdict: AuditVerdict,
  input: TurnAuditInput,
): AuditVerdict {
  const allowedDisallowedTools = new Set(
    input.requiresExplicitActionTools ?? [],
  );
  const disallowedToolCalls = verdict.disallowedToolCalls.filter((tool) =>
    allowedDisallowedTools.has(tool),
  );
  const invalidDisallowedTools = verdict.disallowedToolCalls.filter(
    (tool) => !allowedDisallowedTools.has(tool),
  );
  if (invalidDisallowedTools.length === 0) {
    return verdict;
  }

  const missingRequiredCalls = repairMissingCallsForInvalidDisallowedTools(
    verdict,
    input,
    invalidDisallowedTools,
  );
  const missingRequiredTools = [
    ...new Set(missingRequiredCalls.map((call) => call.tool)),
  ];
  const correction = `Sanitized invalid disallowedToolCalls classification(s): ${invalidDisallowedTools.join(', ')}.`;
  return {
    ...verdict,
    missingRequiredTools,
    missingRequiredCalls,
    disallowedToolCalls,
    reason: verdict.reason ? `${verdict.reason} ${correction}` : correction,
    repairInstruction:
      invalidDisallowedTools.includes('set_plot_flag') &&
      input.providedToolNames.includes('record_world_fact') &&
      !verdict.missingRequiredTools.includes('record_world_fact')
        ? [
            verdict.repairInstruction,
            'Use record_world_fact for consequential improvised lore; set_plot_flag alone is not lore evidence.',
          ]
            .filter((line) => line.length > 0)
            .join(' ')
        : verdict.repairInstruction,
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
    return sanitizeAuditVerdict(parseAuditVerdict(completion.text), input);
  }
}
